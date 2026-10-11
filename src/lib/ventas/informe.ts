import {
  Acumulador,
  Entradas,
  SIN_MES,
  TablaClaves,
  empaquetarClave,
  sumarEn,
  tallyVacio,
  type Tally,
} from "./acumulador";
import { centimosASoles, aCentimos, proporcionComaDecimalAlta } from "./numeros";
import { esMesCerrado, mesAnterior } from "./periodo";
import { CAMPOS_EXIGIBLES } from "./interpretar";
import { esIdentico } from "./cargas";
import {
  CAMPOS_VENTA,
  ETIQUETAS_AVISO,
  ETIQUETAS_MEDIDA,
  MAX_ENTRADAS_REPORTE,
  MAX_REPORTE_BYTES,
  MEDIDAS_DINERO,
  MEDIDAS_VENTA,
  TOLERANCIA_CONCILIACION,
  UMBRAL_AVISO_ABIERTO,
  UMBRAL_BLOQUEO_ERRORES,
  UMBRAL_COMPARACION_MES,
  UMBRAL_EXCLUSION_RESALTADA,
  severidadDe,
  type Aviso,
  type CodigoAvisoONota,
  type Diagnostico,
  type EstadoConciliacionQlik,
  type Exclusion,
  type FilaConciliacion,
  type HuellaMes,
  type InformeCarga,
  type InformeMes,
  type MedidaVenta,
  type MedidasInforme,
  type MotivoExclusion,
  type ResumenExclusion,
  type TotalesQlik,
  esMotivoError,
  type Consolidado,
  type DetalleAviso,
} from "./tipos";
import { planificarMarcasNuevas, type CandidataMarcaNueva } from "./resolver";
import type { PrevisualizarRespuesta, ResolucionCombinacionApi } from "./tipos-api";

/**
 * Informe del reporte previo (docs/modulos/05-venta-stock.md, reglas 20–27).
 * Función pura sobre el acumulador y las resoluciones que devolvió
 * `previsualizar`: el navegador arma el reporte completo sin volver a leer el
 * archivo. Devuelve además el `Consolidado` (las filas que se cargarán,
 * fusionadas por clave real) del que salen las tandas.
 *
 * Identidad (regla 20): por mes, en las cinco medidas, `archivo = cargado +
 * Σ exclusiones`, y en filas `archivo = cargadas + fusionadas + excluidas`,
 * exactas (en céntimos).
 */

// ─── Conciliación contra QlikView ───

const esDinero = (m: MedidaVenta) => (MEDIDAS_DINERO as readonly MedidaVenta[]).includes(m);

/**
 * Regla 21. Unidades y stock en unidades coinciden solo si la diferencia es 0;
 * venta, costo y stock valorizado, con diferencia relativa menor a 0,1 %
 * (`0,0999 %` coincide y `0,1 %` no). Aritmética de céntimos enteros, sin
 * deriva de coma flotante. `qlik` es el total de QlikView; `archivo`, el del archivo.
 */
export function coincideConQlik(medida: MedidaVenta, qlik: number, archivo: number): boolean {
  if (!esDinero(medida)) return qlik === archivo;
  const q = aCentimos(qlik);
  const a = aCentimos(archivo);
  const dif = Math.abs(a - q);
  if (q === 0) return dif === 0;
  // dif / |q| < 0,1 % sin dividir: exacto en céntimos enteros.
  return dif * (1 / TOLERANCIA_CONCILIACION) < Math.abs(q);
}

export function estadoQlik(medida: MedidaVenta, qlik: number | null | undefined, archivo: number): EstadoConciliacionQlik {
  if (qlik === null || qlik === undefined || !Number.isFinite(qlik)) return "sin_qlik";
  return coincideConQlik(medida, qlik, archivo) ? "coincide" : "difiere";
}

const valorMedidaC = (m: MedidaVenta, t: Tally): number =>
  m === "unidades"
    ? t.unidades
    : m === "venta_soles"
      ? t.venta
      : m === "costo_vendido"
        ? t.costo
        : m === "stock_unidades"
          ? t.stock_unidades
          : t.stock_valorizado;

const aSoles = (m: MedidaVenta, c: number) => (esDinero(m) ? centimosASoles(c) : c);

/** Tally en céntimos → medidas del informe en soles. */
export function medidasInforme(t: Tally): MedidasInforme {
  return {
    filas: t.filas,
    unidades: t.unidades,
    venta_soles: centimosASoles(t.venta),
    costo_vendido: centimosASoles(t.costo),
    stock_unidades: t.stock_unidades,
    stock_valorizado: centimosASoles(t.stock_valorizado),
  };
}

/** Tabla `medida · QlikView (opcional) · archivo · excluido · cargado · diferencia` de un mes. */
export function conciliarMes(archivo: Tally, excluido: Tally, cargado: Tally, qlik?: TotalesQlik): FilaConciliacion[] {
  return MEDIDAS_VENTA.map((medida) => {
    const a = valorMedidaC(medida, archivo);
    const e = valorMedidaC(medida, excluido);
    const c = valorMedidaC(medida, cargado);
    const q = qlik?.[medida];
    const estado = estadoQlik(medida, q, aSoles(medida, a));
    const tieneQ = estado !== "sin_qlik" && q !== undefined;
    const archivoSoles = aSoles(medida, a);
    return {
      medida,
      qlik: tieneQ ? (q as number) : null,
      archivo: archivoSoles,
      excluido: aSoles(medida, e),
      cargado: aSoles(medida, c),
      descuadre: aSoles(medida, a - e - c),
      diferencia_qlik: tieneQ ? aSoles(medida, a - aCentimosSiDinero(medida, q as number)) : null,
      diferencia_relativa: tieneQ && (q as number) !== 0 ? Math.abs(archivoSoles - (q as number)) / Math.abs(q as number) : null,
      estado_qlik: estado,
    };
  });
}

const aCentimosSiDinero = (m: MedidaVenta, v: number) => (esDinero(m) ? aCentimos(v) : v);

// ─── Consolidado (lo que se cargará) ───

export const PREFIJO_MARCA_NUEVA = "nueva:";

/** Cambia los tokens `nueva:NOMBRE` por los ids que devolvió `marcas-nuevas` (nombre normalizado → id). */
export function sustituirMarcasNuevas(c: Consolidado, ids: Readonly<Record<string, string>>): Consolidado {
  return {
    ...c,
    marcas: c.marcas.map((t) => (t.startsWith(PREFIJO_MARCA_NUEVA) ? (ids[t.slice(PREFIJO_MARCA_NUEVA.length)] ?? t) : t)),
  };
}

/** Marcas que siguen sin id (no deberían quedar tras `marcas-nuevas`). */
export function marcasSinId(c: Consolidado): string[] {
  return c.marcas.filter((t) => t.startsWith(PREFIJO_MARCA_NUEVA)).map((t) => t.slice(PREFIJO_MARCA_NUEVA.length));
}

// ─── Informe ───

export type EntradaInforme = {
  acumulador: Acumulador;
  resoluciones: Pick<
    PrevisualizarRespuesta,
    "hoy" | "tiendas" | "combinaciones" | "marcas" | "periodos" | "anterior" | "huellas_stock"
  >;
  /** Totales de QlikView que escribió el usuario, por periodo `aaaa-mm` (opcionales). */
  totalesQlik?: Record<string, TotalesQlik>;
  /** Hoja `.xls` de exactamente 65 536 filas. */
  posiblementeTruncado?: boolean;
};

export type CombinacionDesconocida = {
  motivo: MotivoExclusion;
  genero: string;
  mundo: string;
  linea: string;
  /** Tal como vino: vacío sigue vacío y `-` sigue `-`. */
  equivalencia: string;
  filas: number;
  venta_soles: number;
  stock_valorizado: number;
  primera_fila: number;
};

export type ResultadoInforme = {
  informe: InformeCarga;
  consolidado: Consolidado;
  /** Combinaciones desconocidas (formato árbol), todas las de los motivos de combinación con error. */
  combinacionesDesconocidas: CombinacionDesconocida[];
};

type GrupoExclusion = Tally & {
  motivo: MotivoExclusion;
  periodo: number;
  valor: string;
  primera_fila: number;
  combinacion?: Exclusion["combinacion"];
};

const pct = (a: number, b: number): number => (b === 0 ? 0 : Math.round((a / b) * 10_000) / 100);

const MOTIVOS_COMBINACION_ERROR: readonly MotivoExclusion[] = [
  "genero_desconocido",
  "mundo_desconocido",
  "linea_desconocida",
  "nodo_inexistente",
  "equivalencia_inexistente",
];

/** Grupo de un aviso: suma y desglose por valor. */
class GrupoAviso {
  readonly total = tallyVacio();
  readonly detalle = new Map<string, Tally>();
  agregar(m: Tally | { unidades: number; venta: number; costo: number; stock_unidades: number; stock_valorizado: number }, valor?: string, filas = 1): void {
    sumarEn(this.total, m, filas);
    if (valor !== undefined) {
      let d = this.detalle.get(valor);
      if (!d) {
        d = tallyVacio();
        this.detalle.set(valor, d);
      }
      sumarEn(d, m, filas);
    }
  }
}

const NUEVO_MEDIDAS = (e: Entradas, i: number) => ({
  unidades: e.unidades[i],
  venta: e.venta[i],
  costo: e.costo[i],
  stock_unidades: e.stockUnidades[i],
  stock_valorizado: e.stockValorizado[i],
});

type Bucket = { e: Entradas; tabla: TablaClaves; fusionadas: number; repetidas: number; muestraRepetidas: DetalleAviso[] };

export function construirInforme(entrada: EntradaInforme): ResultadoInforme {
  const describirClave = (b: Bucket, i: number): string => {
    const c = dic.combinaciones.find((_, ci) => eqOrd[ci] === b.e.combo[i]);
    return `${c ? `${c.linea} / ${c.equivalencia}` : equivalenciasIds[b.e.combo[i]]} · ${dic.marcas[b.e.marca[i]]} · ${b.e.talla[i] === 1 ? "EXTREMAS" : "CENTRALES"}`;
  };

  const { acumulador: acum, resoluciones: res } = entrada;
  const dic = acum.diccionarios;
  const E = acum.entradas;

  // ── Resolución por índice de diccionario ──
  const tiendaMotivo: (MotivoExclusion | null)[] = dic.tiendas.map((_, t) => {
    const r = res.tiendas[t];
    if (!r || r.resultado === "desconocida") return "tienda_desconocida";
    if (r.resultado === "inactiva") return "tienda_inactiva";
    if (r.resultado === "excluida") return "tienda_excluida";
    return null;
  });
  const tiendaOrd = new Int32Array(dic.tiendas.length).fill(-1);
  const tiendasIds: string[] = [];
  const tiendasInfo: { id: string; nombre: string; cd: boolean; apertura: string | null; cierre: string | null }[] = [];
  {
    const porId = new Map<string, number>();
    dic.tiendas.forEach((nombre, t) => {
      const r = res.tiendas[t];
      if (!r || r.resultado !== "ok") return;
      let o = porId.get(r.id);
      if (o === undefined) {
        o = tiendasIds.length;
        porId.set(r.id, o);
        tiendasIds.push(r.id);
        tiendasInfo.push({
          id: r.id,
          nombre,
          cd: r.tipo === "Centro de Distribución",
          apertura: r.fecha_apertura,
          cierre: r.fecha_cierre,
        });
      }
      tiendaOrd[t] = o;
    });
  }

  const detalleCombo = (c: number, r: ResolucionCombinacionApi): string => {
    if (r.resultado !== "ok" && r.detalle) return r.detalle;
    const k = dic.combinaciones[c];
    return `${k.genero} / ${k.mundo} / ${k.linea} / ${k.equivalencia}`;
  };
  const comboMotivo: (MotivoExclusion | null)[] = dic.combinaciones.map((_, c) => {
    const r = res.combinaciones[c];
    if (!r) return "nodo_inexistente";
    return r.resultado === "ok" ? null : (r.resultado as MotivoExclusion);
  });
  const eqOrd = new Int32Array(dic.combinaciones.length).fill(-1);
  const equivalenciasIds: string[] = [];
  {
    const porId = new Map<string, number>();
    dic.combinaciones.forEach((_, c) => {
      const r = res.combinaciones[c];
      if (!r || r.resultado !== "ok") return;
      let o = porId.get(r.equivalencia_id);
      if (o === undefined) {
        o = equivalenciasIds.length;
        porId.set(r.equivalencia_id, o);
        equivalenciasIds.push(r.equivalencia_id);
      }
      eqOrd[c] = o;
    });
  }

  const marcaMotivo: (MotivoExclusion | null)[] = dic.marcas.map((_, m) => (res.marcas[m]?.resultado === "inactiva" ? "marca_inactiva" : null));
  const marcasTokens: string[] = dic.marcas.map((nombre, m) => {
    const r = res.marcas[m];
    return r && (r.resultado === "existe" || r.resultado === "inactiva") ? r.id : `nueva:${nombre}`;
  });
  const marcaStats = new Map<number, Tally>();

  // ── Exclusiones: las locales del acumulador más las que salen de resolver ──
  const exclusiones = new Map<string, GrupoExclusion>();
  const claveExc = (motivo: MotivoExclusion, p: number, valor: string) => `${motivo}\u0000${p}\u0000${valor}`;
  const sumarExclusion = (
    motivo: MotivoExclusion,
    p: number,
    valor: string,
    m: Tally | ReturnType<typeof NUEVO_MEDIDAS>,
    filas: number,
    primera: number,
    combinacion?: Exclusion["combinacion"]
  ) => {
    const k = claveExc(motivo, p, valor);
    let g = exclusiones.get(k);
    if (!g) {
      g = { ...tallyVacio(), motivo, periodo: p, valor, primera_fila: primera, combinacion };
      exclusiones.set(k, g);
    }
    sumarEn(g, m, filas);
    if (primera < g.primera_fila) g.primera_fila = primera;
  };
  for (const g of acum.exclusiones.values()) {
    sumarExclusion(g.motivo, g.periodo, g.valor, g, g.filas, g.primera_fila);
  }

  const desconocidas = new Map<string, CombinacionDesconocida>();
  const sumarDesconocida = (motivo: MotivoExclusion, c: number, m: ReturnType<typeof NUEVO_MEDIDAS>, filas: number, primera: number) => {
    const k = dic.combinaciones[c];
    const clave = `${motivo}\u0000${c}`;
    let d = desconocidas.get(clave);
    if (!d) {
      d = {
        motivo,
        genero: k.genero,
        mundo: k.mundo,
        linea: k.linea,
        equivalencia: k.equivalencia_original,
        filas: 0,
        venta_soles: 0,
        stock_valorizado: 0,
        primera_fila: primera,
      };
      desconocidas.set(clave, d);
    }
    d.filas += filas;
    d.venta_soles += m.venta;
    d.stock_valorizado += m.stock_valorizado;
    if (primera < d.primera_fila) d.primera_fila = primera;
  };

  // ── Primera pasada: entradas del acumulador → exclusión o clave final ──
  const buckets: Bucket[] = [];
  const revisar = new Map<number, GrupoAviso>();
  const ETIQUETA_REVISAR: Record<number, string> = { 2: "Revisar", 3: "-", 4: "(vacío)" };

  for (let i = 0; i < E.n; i++) {
    const p = E.periodo[i];
    const t = E.tienda[i];
    const c = E.combo[i];
    const m = E.marca[i];
    const med = NUEVO_MEDIDAS(E, i);
    const filas = E.filas[i];
    const primera = E.primera[i];

    const mt = tiendaMotivo[t];
    if (mt) {
      sumarExclusion(mt, p, dic.tiendas[t], med, filas, primera);
      continue;
    }
    const mc = comboMotivo[c];
    if (mc) {
      const r = res.combinaciones[c];
      const valor = r ? detalleCombo(c, r) : `${dic.combinaciones[c].genero} / ${dic.combinaciones[c].mundo} / ${dic.combinaciones[c].linea}`;
      const k = dic.combinaciones[c];
      const conPieza = mc === "equivalencia_inexistente" || mc === "equivalencia_inactiva";
      sumarExclusion(
        mc,
        p,
        valor,
        med,
        filas,
        primera,
        conPieza ? { genero: k.genero, mundo: k.mundo, linea: k.linea, equivalencia: k.equivalencia_original } : undefined
      );
      if (MOTIVOS_COMBINACION_ERROR.includes(mc)) sumarDesconocida(mc, c, med, filas, primera);
      continue;
    }
    const mm = marcaMotivo[m];
    if (mm) {
      sumarExclusion(mm, p, dic.marcas[m], med, filas, primera);
      continue;
    }

    // Cargable. Aviso de talla `Revisar` (antes de fusionar la talla).
    const cat = E.talla[i];
    if (cat >= 2) {
      let g = revisar.get(p);
      if (!g) {
        g = new GrupoAviso();
        revisar.set(p, g);
      }
      g.agregar(med, ETIQUETA_REVISAR[cat], filas);
    }
    if (marcasTokens[m].startsWith("nueva:")) {
      let s = marcaStats.get(m);
      if (!s) {
        s = tallyVacio();
        marcaStats.set(m, s);
      }
      sumarEn(s, med, filas);
    }

    let b = buckets[p];
    if (!b) {
      b = { e: new Entradas(256), tabla: new TablaClaves(256), fusionadas: 0, repetidas: 0, muestraRepetidas: [] };
      buckets[p] = b;
    }
    const talla = cat === 1 ? 1 : 0;
    const clave = empaquetarClave(0, tiendaOrd[t], eqOrd[c], m, talla);
    const existente = b.tabla.encontrarOInsertar(clave, b.e.n);
    if (existente === -1) {
      b.e.nueva(p, tiendaOrd[t], eqOrd[c], m, talla, primera, med);
      b.e.filas[b.e.n - 1] = filas;
    } else {
      const antes = b.e.filas[existente];
      b.e.sumar(existente, med);
      b.e.filas[existente] = antes + filas;
      if (primera < b.e.primera[existente]) b.e.primera[existente] = primera;
    }
  }

  // Talla desconocida: cede ante un error de tienda (precedencia).
  for (const g of acum.tallasDesconocidas.values()) {
    const mt = tiendaMotivo[g.tienda];
    if (mt) sumarExclusion(mt, g.periodo, dic.tiendas[g.tienda], g, g.filas, g.primera_fila);
    else sumarExclusion("talla_desconocida", g.periodo, g.talla, g, g.filas, g.primera_fila);
  }

  // ── Segunda pasada, mes a mes ──
  const hoy = res.hoy;
  const periodosOrden = dic.periodos.map((periodo, p) => ({ periodo, p })).sort((a, b) => a.periodo.localeCompare(b.periodo));
  const cargadoPorPeriodo = new Map<string, Tally>();
  const huellaPorPeriodo = new Map<string, HuellaMes>();
  const meses: InformeMes[] = [];
  const consolidado: Consolidado = { tiendas: tiendasIds, equivalencias: equivalenciasIds, marcas: marcasTokens, meses: new Map() };

  // Huellas de lo ya publicado, por periodo.
  const huellasPublicadas = new Map(res.huellas_stock.map((h) => [h.periodo, h]));

  // Primero las huellas de todos los meses del archivo (para compararlas entre sí).
  const cargadoMes = new Map<number, Tally>();
  for (const { periodo, p } of periodosOrden) {
    const b = buckets[p];
    const cargado = tallyVacio();
    let conStock = 0;
    if (b) {
      for (let i = 0; i < b.e.n; i++) {
        const m = NUEVO_MEDIDAS(b.e, i);
        sumarEn(cargado, m);
        if (m.stock_unidades !== 0 || m.stock_valorizado !== 0) conStock += 1;
      }
    }
    cargadoMes.set(p, cargado);
    cargadoPorPeriodo.set(periodo, cargado);
    huellaPorPeriodo.set(periodo, {
      filas_con_stock: conStock,
      stock_unidades: cargado.stock_unidades,
      stock_valorizado: centimosASoles(cargado.stock_valorizado),
    });
  }

  for (const { periodo, p } of periodosOrden) {
    const st = acum.stats[p];
    const b = buckets[p];
    const cargado = cargadoMes.get(p) as Tally;
    const huella = huellaPorPeriodo.get(periodo) as HuellaMes;

    // Fusionadas: filas que se sumaron a otra de la misma clave.
    let fusionadas = 0;
    const rep = new GrupoAviso();
    if (b) {
      for (let i = 0; i < b.e.n; i++) fusionadas += b.e.filas[i] - 1;
    }

    // Exclusiones del mes.
    const grupos = [...exclusiones.values()].filter((g) => g.periodo === p);
    const excluido = tallyVacio();
    const errores = tallyVacio();
    for (const g of grupos) {
      sumarEn(excluido, g, g.filas);
      if (esMotivoError(g.motivo)) sumarEn(errores, g, g.filas);
    }

    const identidadOk =
      st.archivo.filas === cargado.filas + fusionadas + excluido.filas &&
      MEDIDAS_VENTA.every((m) => valorMedidaC(m, st.archivo) === valorMedidaC(m, cargado) + valorMedidaC(m, excluido));

    const archivo = medidasInforme(st.archivo);
    const erroresPct = {
      pct_filas: pct(errores.filas, st.archivo.filas),
      pct_venta: st.archivo.venta > 0 ? pct(errores.venta, st.archivo.venta) : 0,
      pct_stock: st.archivo.stock_valorizado > 0 ? pct(errores.stock_valorizado, st.archivo.stock_valorizado) : 0,
      maximo: 0,
    };
    erroresPct.maximo = Math.max(erroresPct.pct_filas, erroresPct.pct_venta, erroresPct.pct_stock);
    const bloqueado =
      (st.archivo.filas > 0 && errores.filas / st.archivo.filas >= UMBRAL_BLOQUEO_ERRORES) ||
      (st.archivo.venta > 0 && errores.venta / st.archivo.venta >= UMBRAL_BLOQUEO_ERRORES) ||
      (st.archivo.stock_valorizado > 0 && errores.stock_valorizado / st.archivo.stock_valorizado >= UMBRAL_BLOQUEO_ERRORES);

    // Resumen y detalle de exclusiones.
    const porMotivo = new Map<MotivoExclusion, GrupoExclusion[]>();
    for (const g of grupos) {
      const l = porMotivo.get(g.motivo) ?? [];
      l.push(g);
      porMotivo.set(g.motivo, l);
    }
    const resumen: ResumenExclusion[] = [];
    for (const [motivo, lista] of porMotivo) {
      const t = tallyVacio();
      for (const g of lista) sumarEn(t, g, g.filas);
      const tipo = esMotivoError(motivo) ? "error" : "decision";
      const pv = st.archivo.venta !== 0 ? pct(t.venta, st.archivo.venta) : 0;
      const ps = st.archivo.stock_valorizado !== 0 ? pct(t.stock_valorizado, st.archivo.stock_valorizado) : 0;
      resumen.push({
        motivo,
        tipo,
        grupos: lista.length,
        ...medidasInforme(t),
        pct_filas: pct(t.filas, st.archivo.filas),
        pct_venta: pv,
        pct_stock: ps,
        resaltada: tipo === "decision" && (Math.abs(pv) > UMBRAL_EXCLUSION_RESALTADA * 100 || Math.abs(ps) > UMBRAL_EXCLUSION_RESALTADA * 100),
      });
    }
    resumen.sort(ordenResumen);
    const detalleExclusiones: Exclusion[] = grupos.map(aExclusion).sort(ordenExclusion);

    // Avisos del mes.
    const grupoAviso = new Map<CodigoAvisoONota, GrupoAviso>();
    const g = (c: CodigoAvisoONota) => {
      let x = grupoAviso.get(c);
      if (!x) {
        x = new GrupoAviso();
        grupoAviso.set(c, x);
      }
      return x;
    };

    if (b) {
      for (let i = 0; i < b.e.n; i++) {
        const u = b.e.unidades[i];
        const v = b.e.venta[i];
        const co = b.e.costo[i];
        const su = b.e.stockUnidades[i];
        const sv = b.e.stockValorizado[i];
        const med = NUEVO_MEDIDAS(b.e, i);
        const tienda = tiendasInfo[b.e.tienda[i]];
        if (su < 0 || sv < 0) g("stock_negativo").agregar(med, tienda.nombre);
        if (u < 0) g("unidades_negativas").agregar(med);
        if (u !== 0 && v === 0) g("unidades_sin_venta").agregar(med);
        if (v !== 0 && u === 0) g("venta_sin_unidades").agregar(med);
        if (v > 0 && co > v) g("costo_mayor_que_venta").agregar(med);
        if (co !== 0 && v === 0) g("costo_sin_venta").agregar(med);
        if (v !== 0 || co !== 0) {
          if (tienda.cd) g("venta_en_cd").agregar(med, tienda.nombre);
          if (
            (tienda.apertura && periodo < tienda.apertura.slice(0, 7)) ||
            (tienda.cierre && periodo > tienda.cierre.slice(0, 7))
          ) {
            g("fuera_de_vigencia").agregar(med, `${tienda.nombre} · ${periodo}`);
          }
        }
        if (b.e.filas[i] > 1) {
          sumarEn(rep.total, med, 0);
          if (rep.detalle.size < 50) {
            rep.detalle.set(`${tienda.nombre} · ${describirClave(b, i)} (primera fila ${b.e.primera[i]})`, {
              ...tallyVacio(),
              ...med,
              filas: b.e.filas[i],
            });
          }
        }
      }
    }

    // Claves repetidas: la suma ya está hecha; esto es lo que se informa.
    if (fusionadas > 0) {
      rep.total.filas = fusionadas;
      grupoAviso.set("claves_repetidas_se_suman", rep);
    }
    const rv = revisar.get(p);
    if (rv) grupoAviso.set("talla_revisar_a_centrales", rv);
    if (st.filas_decimales_unidades > 0) g("unidades_con_decimales").total.filas = st.filas_decimales_unidades;

    const abierto = !esMesCerrado(periodo, hoy);
    const avisos: Aviso[] = [];
    const agregarAviso = (codigo: CodigoAvisoONota, mensaje: string, gr: GrupoAviso, opciones: { rojo?: boolean; detalle?: DetalleAviso[] } = {}) => {
      const t = gr.total;
      const pv = st.archivo.venta !== 0 ? pct(t.venta, st.archivo.venta) : 0;
      const ps = st.archivo.stock_valorizado !== 0 ? pct(t.stock_valorizado, st.archivo.stock_valorizado) : 0;
      const detalle =
        opciones.detalle ??
        [...gr.detalle.entries()]
          .map(([valor, d]) => ({
            valor,
            filas: d.filas,
            venta_soles: centimosASoles(d.venta),
            costo_vendido: centimosASoles(d.costo),
            stock_unidades: d.stock_unidades,
            stock_valorizado: centimosASoles(d.stock_valorizado),
          }))
          .sort((x, y) => Math.abs(y.venta_soles) + Math.abs(y.stock_valorizado) - (Math.abs(x.venta_soles) + Math.abs(x.stock_valorizado)) || y.filas - x.filas)
          .slice(0, 50);
      avisos.push({
        codigo,
        severidad: severidadDe(codigo),
        mensaje,
        filas: t.filas,
        pct_filas: pct(t.filas, st.archivo.filas),
        venta_soles: centimosASoles(t.venta),
        costo_vendido: centimosASoles(t.costo),
        stock_unidades: t.stock_unidades,
        stock_valorizado: centimosASoles(t.stock_valorizado),
        pct_venta: pv,
        pct_stock: ps,
        plegado: !opciones.rojo && !(Math.abs(pv) > UMBRAL_AVISO_ABIERTO * 100 || Math.abs(ps) > UMBRAL_AVISO_ABIERTO * 100),
        rojo: opciones.rojo ?? false,
        detalle,
      });
    };

    for (const [codigo, gr] of grupoAviso) {
      if (codigo === "claves_repetidas_se_suman") {
        agregarAviso(codigo, `${fusionadas} filas se sumaron a otra con la misma clave tras normalizar.`, gr);
      } else if (codigo === "unidades_con_decimales") {
        agregarAviso(codigo, `${gr.total.filas} filas traían unidades con decimales y se redondearon.`, gr);
      } else {
        agregarAviso(codigo, mensajeAviso(codigo, gr.total.filas), gr);
      }
    }

    if (abierto) agregarAviso("mes_abierto", `${periodo} todavía no cerró: su venta está incompleta.`, new GrupoAviso());

    // Cifras enteras (nota): todas las filas con soles enteros.
    if (st.archivo.filas > 0 && st.filas_con_centavos === 0 && (st.archivo.venta !== 0 || st.archivo.costo !== 0 || st.archivo.stock_valorizado !== 0)) {
      agregarAviso(
        "cifras_enteras",
        "Las cifras monetarias vienen en soles enteros: error máximo por fila de S/ 0,50, despreciable en los totales.",
        new GrupoAviso()
      );
    }

    // Fechas con día distinto de 1: el día se ignora y se cuenta en una nota.
    if (st.filas_dia_distinto_de_1 > 0) {
      const f = new GrupoAviso();
      f.total.filas = st.filas_dia_distinto_de_1;
      agregarAviso("fechas_con_dia", `${st.filas_dia_distinto_de_1} filas traían una fecha con día distinto de 1: se tomó el mes completo.`, f);
    }

    // Comparación con el mes anterior (el del archivo o el ya publicado).
    const ant = mesAnterior(periodo);
    const prev = cargadoPorPeriodo.get(ant);
    const anterior = prev
      ? { filas: prev.filas, venta: centimosASoles(prev.venta), stock: centimosASoles(prev.stock_valorizado) }
      : res.anterior && res.anterior.periodo === ant
        ? { filas: res.anterior.filas, venta: res.anterior.venta_soles, stock: res.anterior.stock_valorizado }
        : null;
    if (anterior && cargado.filas > 0) {
      const cambios: DetalleAviso[] = [];
      const comparar = (nombre: string, ahora: number, antes: number) => {
        if (antes > 0 && Math.abs(ahora - antes) / antes > UMBRAL_COMPARACION_MES) {
          const signo = ahora >= antes ? "+" : "-";
          cambios.push({
            valor: `${nombre}: ${signo}${Math.round((Math.abs(ahora - antes) / antes) * 1000) / 10} % frente a ${ant} (${Math.round(antes)} → ${Math.round(ahora)})`,
            filas: 0,
            venta_soles: 0,
            costo_vendido: 0,
            stock_unidades: 0,
            stock_valorizado: 0,
          });
        }
      };
      comparar("Filas", cargado.filas, anterior.filas);
      comparar("Venta", centimosASoles(cargado.venta), anterior.venta);
      comparar("Stock valorizado", centimosASoles(cargado.stock_valorizado), anterior.stock);
      if (cambios.length > 0) {
        agregarAviso("comparacion_mes_anterior", `${periodo} difiere más del 25 % del mes anterior (${ant}).`, new GrupoAviso(), { detalle: cambios });
      }
    }

    // Red de seguridad del stock.
    if (cargado.filas > 0 && !abierto && huella.filas_con_stock === 0) {
      agregarAviso("stock_en_cero", `El stock de ${periodo} está en cero en todas las filas: QlikView pudo no exportar el stock de fin de mes.`, new GrupoAviso(), { rojo: true });
    } else if (huella.filas_con_stock > 0) {
      const igual = (h: HuellaMes) =>
        h.filas_con_stock === huella.filas_con_stock &&
        h.stock_unidades === huella.stock_unidades &&
        aCentimos(h.stock_valorizado) === aCentimos(huella.stock_valorizado);
      let otro: string | null = null;
      for (const [per, h] of huellaPorPeriodo) if (per !== periodo && igual(h)) otro = per;
      if (!otro) for (const h of res.huellas_stock) if (h.periodo !== periodo && !huellaPorPeriodo.has(h.periodo) && igual(h)) otro = h.periodo;
      if (otro) {
        agregarAviso(
          "stock_identico_a_otro_mes",
          `El stock de ${periodo} es idéntico al de ${otro}: QlikView pudo exportar el stock actual y no el de fin de mes.`,
          new GrupoAviso(),
          { rojo: true }
        );
      }
    }

    avisos.sort((x, y) => Number(y.rojo) - Number(x.rojo) || (x.severidad === y.severidad ? 0 : x.severidad === "aviso" ? -1 : 1));

    // Estado frente a lo ya publicado.
    const info = res.periodos.find((x) => x.periodo === periodo);
    const publicada = info?.publicada ?? null;
    const identico = publicada
      ? esIdentico(
          medidasInforme(cargado),
          huella,
          publicada,
          huellasPublicadas.get(periodo) ?? null
        )
      : false;

    meses.push({
      periodo,
      estado: !publicada ? "nuevo" : identico ? "identico" : "reemplaza",
      abierto,
      publicada: publicada ? { id: publicada.id, publicada_at: publicada.publicada_at, filas: publicada.filas } : null,
      en_curso: info?.en_curso
        ? {
            id: info.en_curso.id,
            usuario_nombre: info.en_curso.usuario_nombre,
            updated_at: info.en_curso.updated_at,
            caducada: info.en_curso.caducada,
          }
        : null,
      archivo,
      excluido: medidasInforme(excluido),
      cargado: medidasInforme(cargado),
      fusionadas,
      identidad_ok: identidadOk,
      conciliacion: conciliarMes(st.archivo, excluido, cargado, entrada.totalesQlik?.[periodo]),
      resumen_exclusiones: resumen,
      exclusiones: detalleExclusiones,
      avisos,
      errores: erroresPct,
      bloqueado,
      huella_stock: huella,
    });

    if (b && b.e.n > 0) {
      const n = b.e.n;
      consolidado.meses.set(periodo, {
        periodo,
        filas: n,
        tienda: b.e.tienda.slice(0, n),
        equivalencia: b.e.combo.slice(0, n),
        marca: b.e.marca.slice(0, n),
        talla: b.e.talla.slice(0, n),
        unidades: b.e.unidades.slice(0, n),
        venta: b.e.venta.slice(0, n),
        costo: b.e.costo.slice(0, n),
        stock_unidades: b.e.stockUnidades.slice(0, n),
        stock_valorizado: b.e.stockValorizado.slice(0, n),
      });
    }
  }

  // ── Sin mes y diagnósticos globales ──
  const sinMes = [...exclusiones.values()].filter((x) => x.periodo === SIN_MES);
  const diagnosticos: Diagnostico[] = [];
  if (acum.filas === 0) {
    diagnosticos.push({ codigo: "sin_filas", mensaje: "El archivo no trae filas de datos.", bloqueante: true });
  }
  if (proporcionComaDecimalAlta(acum.celdasComa, acum.celdasNumericas)) {
    diagnosticos.push({
      codigo: "coma_decimal",
      mensaje: "El archivo parece usar coma decimal; exporta de nuevo con punto decimal.",
      bloqueante: true,
    });
  }
  if (acum.filas > 0) {
    for (const campo of CAMPOS_EXIGIBLES) {
      const idx = CAMPOS_VENTA.indexOf(campo);
      if (acum.vaciosPorCampo[idx] === acum.filas) {
        diagnosticos.push({
          codigo: "columna_vacia",
          mensaje: `La columna «${etiquetaCampo(campo)}» está vacía en todo el archivo: revisa el mapeo o la exportación.`,
          bloqueante: true,
        });
      }
    }
  }
  if (entrada.posiblementeTruncado) {
    diagnosticos.push({
      codigo: "archivo_posiblemente_truncado",
      mensaje: "La hoja tiene exactamente 65 536 filas: el .xls pudo cortarse. Exporta a CSV.",
      bloqueante: false,
    });
  }
  if (acum.sinMes.filas > 0) {
    diagnosticos.push({
      codigo: "filas_sin_mes",
      mensaje: `${acum.sinMes.filas} filas tienen un mes o año que no se pudo leer y no pertenecen a ningún mes.`,
      bloqueante: acum.filas > 0 && acum.sinMes.filas / acum.filas >= UMBRAL_BLOQUEO_ERRORES,
    });
  }
  const d = acum.desbordes;
  if (d.periodos || d.tiendas || d.combinaciones || d.marcas) {
    diagnosticos.push({
      codigo: "demasiados_valores",
      mensaje: "El archivo trae más valores distintos de los que admite la previsualización (meses, tiendas, combinaciones o marcas).",
      bloqueante: true,
    });
  }

  const candidatas: CandidataMarcaNueva[] = [];
  for (const [m, t] of marcaStats) {
    const r = res.marcas[m];
    candidatas.push({
      nombre: dic.marcas[m],
      comodin: r?.resultado === "nueva" ? r.comodin : false,
      parecida: r?.resultado === "nueva" ? r.parecida : null,
      filas: t.filas,
      venta_soles: centimosASoles(t.venta),
      stock_unidades: t.stock_unidades,
      stock_valorizado: centimosASoles(t.stock_valorizado),
    });
  }

  const informe: InformeCarga = {
    hoy,
    filas_archivo: acum.filas,
    diagnosticos,
    bloqueado_global: diagnosticos.some((x) => x.bloqueante),
    meses,
    sin_mes: { filas: acum.sinMes.filas, exclusiones: sinMes.map(aExclusion).sort(ordenExclusion) },
    marcas_nuevas: planificarMarcasNuevas(candidatas),
  };

  const combinacionesDesconocidas = [...desconocidas.values()]
    .map((x) => ({ ...x, venta_soles: centimosASoles(x.venta_soles), stock_valorizado: centimosASoles(x.stock_valorizado) }))
    .sort((a, b) => b.venta_soles - a.venta_soles || a.genero.localeCompare(b.genero, "es"));

  return { informe, consolidado, combinacionesDesconocidas };
}

// ─── Utilidades de presentación ───

function etiquetaCampo(campo: string): string {
  const e = (ETIQUETAS_MEDIDA as Record<string, string>)[campo];
  if (e) return e;
  const nombres: Record<string, string> = {
    mes: "Mes",
    tienda: "Tienda",
    genero: "Género",
    mundo: "Mundo",
    linea: "Línea",
    marca: "Marca",
    talla: "Talla",
  };
  return nombres[campo] ?? campo;
}

function mensajeAviso(codigo: CodigoAvisoONota, filas: number): string {
  const base = ETIQUETAS_AVISO[codigo];
  return filas > 0 ? `${base}: ${filas} filas.` : `${base}.`;
}

function aExclusion(g: GrupoExclusion): Exclusion {
  return {
    motivo: g.motivo,
    tipo: esMotivoError(g.motivo) ? "error" : "decision",
    valor: g.valor,
    ...(g.combinacion ? { combinacion: g.combinacion } : {}),
    primera_fila: g.primera_fila,
    ...medidasInforme(g),
  };
}

const peso = (x: { venta_soles: number; stock_valorizado: number }) => Math.abs(x.venta_soles) + Math.abs(x.stock_valorizado);

function ordenResumen(a: ResumenExclusion, b: ResumenExclusion): number {
  return (a.tipo === b.tipo ? 0 : a.tipo === "error" ? -1 : 1) || peso(b) - peso(a) || a.motivo.localeCompare(b.motivo);
}

function ordenExclusion(a: Exclusion, b: Exclusion): number {
  return (
    (a.tipo === b.tipo ? 0 : a.tipo === "error" ? -1 : 1) ||
    a.motivo.localeCompare(b.motivo) ||
    peso(b) - peso(a) ||
    b.filas - a.filas ||
    a.valor.localeCompare(b.valor, "es")
  );
}

// ─── Reporte que se guarda con la carga ───

export type OpcionesReporte = {
  archivo_nombre: string;
  codificacion?: string;
  separador?: string;
  totalesQlik?: TotalesQlik;
  /** Pasa a `reporte.porcentaje_errores` si el mes se carga forzado. */
  forzado?: boolean;
};

const recortar = <T>(lista: T[], n: number): T[] => lista.slice(0, n);

/**
 * Reporte de un mes para guardar con la carga (`abrirCargaSchema.reporte`):
 * conciliación, exclusiones por motivo con su peso, avisos, huella de stock y
 * marcas nuevas. Cada lista se recorta a `MAX_ENTRADAS_REPORTE` por motivo y,
 * si aun así supera 200 KB, se recorta más. Es informativo (auditoría): lo que
 * manda es lo que la base midió.
 */
export function armarReporteMes(informe: InformeCarga, periodo: string, opciones: OpcionesReporte): Record<string, unknown> {
  const mes = informe.meses.find((m) => m.periodo === periodo);
  if (!mes) return { periodo, archivo_nombre: opciones.archivo_nombre };

  for (const tope of [MAX_ENTRADAS_REPORTE, 100, 20, 0]) {
    const porMotivo = new Map<MotivoExclusion, number>();
    const exclusiones = mes.exclusiones.filter((e) => {
      const n = (porMotivo.get(e.motivo) ?? 0) + 1;
      porMotivo.set(e.motivo, n);
      return n <= tope;
    });
    const reporte: Record<string, unknown> = {
      periodo,
      archivo_nombre: opciones.archivo_nombre,
      codificacion: opciones.codificacion ?? null,
      separador: opciones.separador ?? null,
      generado_en: informe.hoy,
      estado: mes.estado,
      archivo: mes.archivo,
      excluido: mes.excluido,
      cargado: mes.cargado,
      fusionadas: mes.fusionadas,
      identidad_ok: mes.identidad_ok,
      conciliacion: mes.conciliacion,
      totales_qlik: opciones.totalesQlik ?? null,
      resumen_exclusiones: mes.resumen_exclusiones,
      exclusiones,
      avisos: mes.avisos.map((a) => ({ ...a, detalle: recortar(a.detalle, Math.min(tope, 50)) })),
      marcas_nuevas: recortar(informe.marcas_nuevas, tope),
      huella_stock: mes.huella_stock,
      errores: mes.errores,
      porcentaje_errores: mes.errores.maximo,
    };
    if (opciones.forzado) reporte.incompleto = { porcentaje: mes.errores.maximo };
    if (JSON.stringify(reporte).length <= MAX_REPORTE_BYTES) return reporte;
  }
  return { periodo, archivo_nombre: opciones.archivo_nombre, archivo: mes.archivo, cargado: mes.cargado, porcentaje_errores: mes.errores.maximo };
}

