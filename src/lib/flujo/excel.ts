import type { CompraApi } from "@/lib/compras/tipos-api";
import type { Hoja } from "@/lib/proyeccion/excel";
import { ETIQUETA_SENAL, senalDeCaracter, type ConciliacionApi, type FlujoApi, type FiltrosFlujo } from "./tipos-api";

/**
 * Hojas de la exportación a Excel de M8 (ficha 08, 4.3 y regla 10: «Excel = pantalla»). Puro: solo arma filas; SheetJS se carga bajo
 * demanda en el navegador (`descargarLibro` de M7) y nunca llama a una ruta nueva: parte de lo que la pantalla ya tiene. Las cifras
 * van como las muestra la pantalla (unidades enteras, IMI con un decimal; los porcentajes en puntos 0–100).
 *
 * Hojas del flujo: `FLUJO`, `SALDO`, `CONCILIACION`, `PARAMETROS` (y `FILTROS`); hojas de compras: `COMPRAS`, `ENTREGAS`,
 * `POR_PROVEEDOR`, `COSTO`.
 */

export type { Hoja };
export type Celda = string | number | null;

export const NOMBRE_ARCHIVO_FLUJO = "flujo-mensual.xlsx";
export const NOMBRE_ARCHIVO_COMPRAS = "compras.xlsx";

const dec = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;
const si = (v: boolean) => (v ? "Sí" : "No");

// ─── Flujo ───

export type FiltroExcelFlujo = Pick<FiltrosFlujo, "genero_id" | "mundo_id" | "agrupacion_marca_id" | "solo" | "mio">;

type FilaLista = FlujoApi["filas"][number];

function nodoDe(flujo: FlujoApi, f: FilaLista) {
  return flujo.catalogo.nodos[f.equivalencia_id ?? f.gml_id] ?? flujo.catalogo.nodos[f.gml_id];
}

/** Las filas que pasan el filtro (el servidor ya filtró: aplicarlo otra vez es inocuo y deja el Excel igual a la pantalla). */
export function filasVisibles(flujo: FlujoApi, filtro: FiltroExcelFlujo = {}): FilaLista[] {
  return flujo.filas.filter((f) => {
    const nodo = nodoDe(flujo, f);
    if (filtro.genero_id && nodo?.genero_id !== filtro.genero_id) return false;
    if (filtro.mundo_id && nodo?.mundo_id !== filtro.mundo_id) return false;
    if (filtro.agrupacion_marca_id && f.agrupacion_marca_id !== filtro.agrupacion_marca_id) return false;
    if (filtro.mio && !f.mia) return false;
    if (filtro.solo === "por_confirmar") return f.resumen.por_confirmar > 0;
    if (filtro.solo) return f.resumen.senal === filtro.solo;
    return true;
  });
}

const MAGNITUDES = [
  { titulo: "Venta real / demanda", valor: (s: FilaLista["serie"], i: number): Celda => s.demanda[i] },
  { titulo: "Ingresos", valor: (s: FilaLista["serie"], i: number): Celda => s.ingresos[i] },
  { titulo: "Reposición directa esperada", valor: (s: FilaLista["serie"], i: number): Celda => (s.reposicion ? s.reposicion[i] : null) },
  { titulo: "Stock fin de mes (cadena)", valor: (s: FilaLista["serie"], i: number): Celda => s.stock[i] },
  { titulo: "IMI", valor: (s: FilaLista["serie"], i: number): Celda => s.imi[i] },
  { titulo: "Saldo por comprar", valor: (s: FilaLista["serie"], i: number): Celda => s.saldo[i] },
  { titulo: "Exceso", valor: (s: FilaLista["serie"], i: number): Celda => s.exceso[i] },
  {
    titulo: "Señal",
    valor: (s: FilaLista["serie"], i: number): Celda => {
      const senal = senalDeCaracter(s.senal[i] ?? "");
      return senal ? ETIQUETA_SENAL[senal] : "—";
    },
  },
] as const;

/** Hoja `FLUJO`: una fila por fila del flujo y magnitud, con una columna por periodo (como la tabla de la pantalla), y los totales. */
export function hojaFlujo(flujo: FlujoApi, filtro: FiltroExcelFlujo = {}): Hoja {
  const periodos = flujo.datos.periodos;
  const hoja: Hoja = [["GÉNERO", "MUNDO", "LÍNEA", "EQUIVALENCIA", "AGRUPACIÓN DE MARCA", "MAGNITUD", ...periodos]];
  for (const f of filasVisibles(flujo, filtro)) {
    const nodo = nodoDe(flujo, f);
    const agrupacion = flujo.catalogo.agrupaciones[f.agrupacion_marca_id] ?? "—";
    for (const m of MAGNITUDES) {
      if (m.titulo === "Reposición directa esperada" && !f.serie.reposicion) continue;
      hoja.push([nodo?.genero ?? "—", nodo?.mundo ?? "—", nodo?.linea ?? "—", nodo?.equivalencia ?? null, agrupacion, m.titulo, ...periodos.map((_, i) => m.valor(f.serie, i))]);
    }
  }
  for (const m of MAGNITUDES) {
    if (m.titulo === "Reposición directa esperada" && !flujo.totales.reposicion) continue;
    hoja.push(["TOTAL", null, null, null, null, m.titulo, ...periodos.map((_, i) => m.valor(flujo.totales, i))]);
  }
  return hoja;
}

/** Hoja `SALDO`: el saldo por comprar de cada fila por periodo y su suma sobre el horizonte, más stock y IMI de `k'`. */
export function hojaSaldo(flujo: FlujoApi, filtro: FiltroExcelFlujo = {}): Hoja {
  const periodos = flujo.datos.periodos.slice(1);
  const hoja: Hoja = [["GÉNERO", "MUNDO", "LÍNEA", "EQUIVALENCIA", "AGRUPACIÓN DE MARCA", "RESPONSABLE", "STOCK CADENA", "IMI", "SEÑAL", ...periodos, "TOTAL"]];
  for (const f of filasVisibles(flujo, filtro)) {
    const nodo = nodoDe(flujo, f);
    const resp = nodo ? flujo.catalogo.responsables[`${nodo.genero_id}|${nodo.mundo_id}`] : undefined;
    const saldos = f.serie.saldo.slice(1);
    hoja.push([
      nodo?.genero ?? "—",
      nodo?.mundo ?? "—",
      nodo?.linea ?? "—",
      nodo?.equivalencia ?? null,
      flujo.catalogo.agrupaciones[f.agrupacion_marca_id] ?? "—",
      resp?.nombre ?? null,
      f.stock_k.total,
      f.resumen.imi_k,
      ETIQUETA_SENAL[f.resumen.senal],
      ...saldos,
      saldos.reduce((a, x) => a + x, 0),
    ]);
  }
  const saldosTotales = flujo.totales.saldo.slice(1);
  hoja.push(["TOTAL", null, null, null, null, null, flujo.totales.stock[0], flujo.totales.imi[0], null, ...saldosTotales, saldosTotales.reduce((a, x) => a + x, 0)]);
  return hoja;
}

const TEXTO_AVISO_CONCILIACION = {
  ingreso_sin_registrar: "Ingreso sin registrar",
  recepcion_sin_respaldo: "Recepción sin respaldo",
  salida_neta: "Salida neta",
  sin_mes_anterior: "Sin mes anterior",
  reclasificacion_probable: "Reclasificación probable",
} as const;

/** Hoja `CONCILIACION`: las filas del mes conciliado, con las sugerencias y el % directo observado. */
export function hojaConciliacion(c: ConciliacionApi): Hoja {
  const hoja: Hoja = [
    [
      "FILA",
      "AGRUPACIÓN DE MARCA",
      "MARCA",
      "PERIODO",
      "VENTA",
      "STOCK INICIO",
      "STOCK FIN",
      "INGRESO INFERIDO",
      "SALIDA INFERIDA",
      "RECEPCIONES REGISTRADAS",
      "ENTREGAS PROGRAMADAS",
      "SIN REGISTRAR",
      "SIN RESPALDO",
      "AVISOS",
      "SUGERENCIA",
      "% DIRECTO OBSERVADO",
      "% DIRECTO REGLA",
    ],
  ];
  for (const f of c.filas) {
    hoja.push([
      f.ruta,
      f.agrupacion_marca,
      f.marca,
      f.periodo,
      f.venta,
      f.stock_inicio,
      f.stock_fin,
      f.ingreso_inferido,
      f.salida_inferida,
      f.recepciones_registradas,
      f.entregas_programadas,
      f.sin_registrar,
      f.sin_respaldo,
      f.avisos.map((a) => TEXTO_AVISO_CONCILIACION[a]).join("; ") || null,
      f.sugerencias.map((s) => `${s.compra_numero}: confirmar ${s.unidades} u en ${f.periodo} (${s.tipo}, entrega ${s.periodo_entrega})`).join("; ") || null,
      f.pct_directo_observado ? dec(f.pct_directo_observado.valor, 1) : null,
      f.pct_directo_regla,
    ]);
  }
  hoja.push(["TOTAL", null, null, c.periodo, c.totales.venta, null, null, c.totales.ingreso_inferido, c.totales.salida_inferida, c.totales.recepciones_registradas, c.totales.entregas_programadas, c.totales.sin_registrar, c.totales.sin_respaldo, null, null, null, null]);
  return hoja;
}

/** Hoja `PARAMETROS`: los parámetros vigentes del flujo. */
export function hojaParametros(flujo: FlujoApi): Hoja {
  const p = flujo.datos.parametros;
  return [
    ["PARÁMETRO", "VALOR"],
    ["IMI mínimo (meses)", p.imi_min],
    ["IMI máximo (meses)", p.imi_max],
    ["Meses de la tarjeta", p.meses_tarjeta],
    ["Extender el horizonte", si(p.extender_horizonte)],
    ["Verano", `mes ${p.temporadas.verano.desde_mes} a mes ${p.temporadas.verano.hasta_mes}`],
    ["Invierno", `mes ${p.temporadas.invierno.desde_mes} a mes ${p.temporadas.invierno.hasta_mes}`],
    ["Umbral de conciliación (unidades)", p.umbral_conciliacion_u],
    ["Umbral de conciliación (%)", p.umbral_conciliacion_pct],
    ["Última edición", p.usuario_nombre],
  ];
}

/** Hoja `FILTROS`: los filtros activos y los meses del flujo. */
export function hojaFiltrosFlujo(flujo: FlujoApi, filtro: FiltroExcelFlujo = {}): Hoja {
  const texto = (v: string | undefined) => (v === undefined || v === "" ? "—" : v);
  const nombreDe = (id: string | undefined, campo: "genero" | "mundo") => {
    if (!id) return "—";
    const nodo = Object.values(flujo.catalogo.nodos).find((n) => (campo === "genero" ? n.genero_id : n.mundo_id) === id);
    return nodo ? nodo[campo] : id;
  };
  return [
    ["FILTRO", "VALOR"],
    ["genero", nombreDe(filtro.genero_id, "genero")],
    ["mundo", nombreDe(filtro.mundo_id, "mundo")],
    ["agrupacion_marca", filtro.agrupacion_marca_id ? (flujo.catalogo.agrupaciones[filtro.agrupacion_marca_id] ?? filtro.agrupacion_marca_id) : "—"],
    ["solo", texto(filtro.solo)],
    ["mis_lineas", si(filtro.mio === true)],
    ["datos_hasta", flujo.datos.k_prima],
    ["horizonte_desde", flujo.datos.horizonte.desde],
    ["horizonte_hasta", flujo.datos.horizonte.hasta],
    ["cerrada", flujo.datos.cerrada.nombre],
  ];
}

/** Las hojas del flujo. `CONCILIACION` va solo si hay un mes conciliado cargado. */
export function hojasFlujo(args: { flujo: FlujoApi; conciliacion?: ConciliacionApi | null; filtro?: FiltroExcelFlujo }): {
  FLUJO: Hoja;
  SALDO: Hoja;
  CONCILIACION: Hoja | null;
  PARAMETROS: Hoja;
  FILTROS: Hoja;
} {
  const filtro = args.filtro ?? {};
  return {
    FLUJO: hojaFlujo(args.flujo, filtro),
    SALDO: hojaSaldo(args.flujo, filtro),
    CONCILIACION: args.conciliacion ? hojaConciliacion(args.conciliacion) : null,
    PARAMETROS: hojaParametros(args.flujo),
    FILTROS: hojaFiltrosFlujo(args.flujo, filtro),
  };
}

// ─── Compras ───

const ruta = (l: CompraApi["lineas"][number]) => l.ruta ?? (l.tipo === "barrer_marca" ? "Lote al barrer" : l.tipo === "barrer_mezcla" ? "Lote de varias marcas" : "—");
const marcaOAgrupacion = (l: CompraApi["lineas"][number]) => l.marca ?? l.agrupacion_marca ?? null;
const sinCancelar = (c: CompraApi) => c.estado !== "cancelada";

/** Hoja `COMPRAS`: una fila por compra, con sus totales y quién la creó y la modificó. */
export function hojaCompras(compras: readonly CompraApi[]): Hoja {
  const hoja: Hoja = [
    ["NÚMERO", "FECHA", "PROVEEDOR", "ORIGEN", "ESTADO", "SALDO CERRADO", "REFERENCIA", "MONEDA", "LÍNEAS", "UNIDADES", "COSTO", "RECIBIDAS", "PRIMERA ENTREGA", "ÚLTIMA ENTREGA", "CREADA POR", "ÚLTIMO CAMBIO", "AVISOS"],
  ];
  for (const c of compras) {
    hoja.push([
      c.numero,
      c.fecha_compra,
      c.proveedor.nombre,
      c.origen,
      c.estado,
      si(c.saldo_cerrado),
      c.referencia,
      c.moneda,
      c.lineas.length,
      c.totales.unidades,
      c.totales.costo === null ? null : dec(c.totales.costo, 2),
      c.totales.recibidas,
      c.llegadas?.desde ?? null,
      c.llegadas?.hasta ?? null,
      c.creada_por.nombre,
      c.modificada_por ? `${c.modificada_por.nombre ?? "—"} (${c.modificada_por.at.slice(0, 10)})` : null,
      c.avisos.join("; ") || null,
    ]);
  }
  return hoja;
}

/** Hoja `ENTREGAS`: una fila por entrega, con lo asignado por FIFO, lo cancelado y lo pendiente. */
export function hojaEntregas(compras: readonly CompraApi[]): Hoja {
  const hoja: Hoja = [["NÚMERO", "PROVEEDOR", "LÍNEA", "TIPO", "RUTA", "MARCA / AGRUPACIÓN", "TALLAS", "PERIODO", "UNIDADES", "RECIBIDAS", "CANCELADAS", "PENDIENTE", "VENCIDA", "ESTADO"]];
  for (const c of compras) {
    c.lineas.forEach((l, i) => {
      for (const e of l.entregas) {
        hoja.push([c.numero, c.proveedor.nombre, i + 1, l.tipo, ruta(l), marcaOAgrupacion(l), l.tallas, e.periodo, e.unidades, e.asignadas, e.canceladas, e.pendiente, si(e.vencida), c.estado]);
      }
    });
  }
  return hoja;
}

/** Hoja `POR_PROVEEDOR`: compras, unidades y costo por moneda de cada proveedor (sin las canceladas). */
export function hojaPorProveedor(compras: readonly CompraApi[]): Hoja {
  const acumulado = new Map<string, { compras: number; unidades: number; recibidas: number; pen: number; usd: number }>();
  for (const c of compras.filter(sinCancelar)) {
    const a = acumulado.get(c.proveedor.nombre) ?? { compras: 0, unidades: 0, recibidas: 0, pen: 0, usd: 0 };
    a.compras += 1;
    a.unidades += c.totales.unidades;
    a.recibidas += c.totales.recibidas;
    if (c.moneda === "PEN") a.pen += c.totales.costo ?? 0;
    else a.usd += c.totales.costo ?? 0;
    acumulado.set(c.proveedor.nombre, a);
  }
  const hoja: Hoja = [["PROVEEDOR", "COMPRAS", "UNIDADES", "RECIBIDAS", "COSTO PEN", "COSTO USD"]];
  for (const nombre of [...acumulado.keys()].sort()) {
    const a = acumulado.get(nombre)!;
    hoja.push([nombre, a.compras, a.unidades, a.recibidas, dec(a.pen, 2), dec(a.usd, 2)]);
  }
  return hoja;
}

/** Hoja `COSTO`: el costo de cada línea (unidades originales × costo unitario), sin las compras canceladas. */
export function hojaCosto(compras: readonly CompraApi[]): Hoja {
  const hoja: Hoja = [["NÚMERO", "PROVEEDOR", "MONEDA", "LÍNEA", "RUTA", "MARCA / AGRUPACIÓN", "UNIDADES", "COSTO UNITARIO", "COSTO TOTAL"]];
  for (const c of compras.filter(sinCancelar)) {
    c.lineas.forEach((l, i) => {
      hoja.push([c.numero, c.proveedor.nombre, c.moneda, i + 1, ruta(l), marcaOAgrupacion(l), l.unidades, l.costo_unitario, l.costo_unitario === null ? null : dec(l.costo_unitario * l.unidades, 2)]);
    });
  }
  return hoja;
}

/** Las hojas de compras. */
export function hojasCompras(compras: readonly CompraApi[]): { COMPRAS: Hoja; ENTREGAS: Hoja; POR_PROVEEDOR: Hoja; COSTO: Hoja } {
  return { COMPRAS: hojaCompras(compras), ENTREGAS: hojaEntregas(compras), POR_PROVEEDOR: hojaPorProveedor(compras), COSTO: hojaCosto(compras) };
}
