import { mesesFaltantes } from "@/lib/curvas/anios";
import { redComparable } from "@/lib/curvas/red";
import { PARAMETROS_POR_DEFECTO } from "@/lib/curvas/tipos-api";
import type { VentaTiendaMes } from "@/lib/curvas/tipos";
import { recortarPeriodo } from "@/lib/ventas/periodo";
import { bloquesDeAnio, clasificarTienda, type TiendaProy } from "./bloques";
import { indiceMes } from "./calendario";
import { curvaCambio, detalleCambioCurva } from "./curva-fila";
import { factorDe, type FactorProy } from "./nino";
import {
  TEMPORADAS_FACTOR,
  VERSION_METODO,
  type AvisoFila,
  type BloquesApi,
  type CurvaOrigen,
  type Motivo,
  type ParametrosProyeccion,
  type PrerrequisitosProyeccionApi,
  type ResumenProyeccion,
} from "./tipos-api";

/**
 * Desactualización, avisos de cambio y prerrequisitos (ficha 07, reglas 33 a 35). Puro: recibe el estado actual de
 * M4, M5 y M6 que la ruta ya leyó y lo compara con la foto que la proyección guardó al calcular.
 */

export type ProyeccionParaEstado = {
  calculado_at: string | null;
  /** `aaaa-mm` (o `aaaa-mm-dd`). */
  hasta_periodo: string;
  recalculo_pendiente?: boolean;
  /** `version_metodo` ausente = no se sabe: no se marca. */
  resumen: (Pick<ResumenProyeccion, "curvas_usadas"> & Partial<Pick<ResumenProyeccion, "version_metodo">>) | null;
  parametros: Pick<ParametrosProyeccion, "factores_usados" | "bloques">;
};

export type EstadoActual = {
  cargas_publicadas: { periodo: string; publicada_at: string | null }[];
  ultimo_mes_cerrado: string | null;
  curvas_vigentes: { agrupacion_id: string; curva_id: string }[];
  /** Nodos cuyo nivel de planificación ya no es el que tenía la fila (`nivel_proyectado`). */
  niveles_cambiados: number;
  tiendas: TiendaProy[];
  factores: FactorProy[];
  /** Último `updated_at` de los periodos atípicos activos. */
  periodos_updated_at: string | null;
};


/** `a` es posterior a `b` (instantes ISO; la base devuelve `+00:00` y el cálculo guarda `Z`, así que no se comparan como texto). */
function posterior(a: string, b: string): boolean {
  const x = Date.parse(a);
  const y = Date.parse(b);
  return !Number.isNaN(x) && !Number.isNaN(y) && x > y;
}

/** Regla 33. Los motivos por los que la proyección quedó desactualizada. */
export function motivosDesactualizada(p: ProyeccionParaEstado, actual: EstadoActual): Motivo[] {
  const motivos: Motivo[] = [];
  const calculado = p.calculado_at;
  const hasta = recortarPeriodo(p.hasta_periodo);

  // Cargas nuevas: publicadas después del cálculo y dentro del rango, o un mes nuevo que adelanta `k`.
  if (calculado) {
    const nuevas = actual.cargas_publicadas.filter((c) => {
      if (!c.publicada_at || !posterior(c.publicada_at, calculado)) return false;
      const periodo = recortarPeriodo(c.periodo);
      if (periodo <= hasta) return true;
      return periodo.slice(0, 4) === hasta.slice(0, 4) && actual.ultimo_mes_cerrado !== null && periodo <= actual.ultimo_mes_cerrado;
    });
    if (nuevas.length > 0) {
      motivos.push({ codigo: "cargas_nuevas", mensaje: "Se publicó venta nueva en Venta y stock después de calcular.", detalle: nuevas.map((c) => recortarPeriodo(c.periodo)).sort() });
    }
  }

  const vigentes = new Map(actual.curvas_vigentes.map((c) => [c.agrupacion_id, c.curva_id]));
  const curvas = (p.resumen?.curvas_usadas ?? []).filter((c) => vigentes.get(c.agrupacion_id) !== c.curva_id);
  if (curvas.length > 0) {
    motivos.push({ codigo: "curvas_cambiadas", mensaje: "Se aprobó una curva nueva en Curvas de estacionalidad después de calcular.", detalle: curvas.map((c) => c.agrupacion_id) });
  }

  if (actual.niveles_cambiados > 0) {
    motivos.push({ codigo: "nivel_cambiado", mensaje: "Cambió el nivel de planificación (GML o GMLE) de alguna línea." });
  }

  // Tiendas: fechas, venta esperada o referente distintos de la foto (o una tienda nueva que no estaba).
  const foto = new Map<string, { a: string | null; c: string | null; v: number | null; r: string | null; activo: boolean }>();
  for (const bloques of Object.values(p.parametros.bloques ?? {})) {
    for (const lista of [bloques.mismas, bloques.nuevas, bloques.cierres, bloques.fuera]) {
      for (const t of lista) {
        foto.set(t.tienda_id, { a: t.fecha_apertura, c: t.fecha_cierre, v: t.venta_esperada ?? null, r: t.referente_id ?? null, activo: t.motivo !== "desactivada" });
      }
    }
  }
  const cambiadas: string[] = [];
  for (const t of actual.tiendas) {
    if (t.tipo !== "Tienda") continue;
    const f = foto.get(t.id);
    if (!f) {
      cambiadas.push(t.codigo);
      continue;
    }
    const nuevoApertura = t.fecha_apertura ? t.fecha_apertura.slice(0, 10) : null;
    const nuevoCierre = t.fecha_cierre ? t.fecha_cierre.slice(0, 10) : null;
    if (f.a !== nuevoApertura || f.c !== nuevoCierre || (f.v ?? null) !== (t.venta_esperada ?? null) || (f.r ?? null) !== (t.referente_id ?? null) || f.activo !== t.activo) {
      cambiadas.push(t.codigo);
    }
  }
  if (cambiadas.length > 0) {
    motivos.push({ codigo: "tiendas_cambiadas", mensaje: "Cambiaron las fechas, la venta esperada o el referente de alguna tienda.", detalle: cambiadas.sort() });
  }

  // Factores del Niño: el efectivo de hoy frente al que se aplicó.
  const usados = p.parametros.factores_usados ?? [];
  const cambiados: string[] = [];
  for (const u of usados) {
    const hoy = factorDe(actual.factores, u.anio, u.temporada);
    if ((hoy ?? null) !== (u.ratio ?? null)) cambiados.push(`${u.temporada} ${u.anio}`);
  }
  for (const f of actual.factores) {
    const hoy = f.ratio_aplicado ?? f.ratio_calculado;
    if (hoy !== null && !usados.some((u) => u.anio === f.anio && u.temporada === f.temporada)) cambiados.push(`${f.temporada} ${f.anio}`);
  }
  if (cambiados.length > 0) {
    motivos.push({ codigo: "factores_cambiados", mensaje: "Cambió algún factor del Niño después de calcular.", detalle: [...new Set(cambiados)].sort() });
  }

  if (calculado && actual.periodos_updated_at && posterior(actual.periodos_updated_at, calculado)) {
    motivos.push({ codigo: "periodos_cambiados", mensaje: "Se editaron los periodos atípicos después de calcular." });
  }
  // `0.10.1`: calculada con un método anterior (otra fórmula de venta esperada, cola larga sin disponibilidad): recalcular.
  const version = p.resumen?.version_metodo;
  if (typeof version === "number" && version < VERSION_METODO) {
    motivos.push({ codigo: "version_metodo", mensaje: "Se calculó con una versión anterior del método: recalcula para aplicar el método nuevo (las decisiones se conservan)." });
  }
  if (p.recalculo_pendiente) motivos.push({ codigo: "recalculo_pendiente", mensaje: "Cambiaste los parámetros: recalcula para verlos aplicados." });
  return motivos;
}

/**
 * Regla 34. Avisos de un registro frente a lo vigente: `curva_cambio` (con el detalle "v2 → v3" y el reparto nuevo en
 * `meses_propuestos`), `propuesta_cambio` y `bloque_cambiado` (la tienda cambió de bloque por una fecha de M4).
 */
export function avisosDeCambio(
  registro: {
    decidido: number | null;
    propuesto: number | null;
    propuesta_al_decidir: number | null;
    curva_origen_usada: readonly CurvaOrigen[];
    bloque: string;
    subbloque: string | null;
  },
  vigente: readonly CurvaOrigen[],
  opciones: { nombres?: ReadonlyMap<string, string>; bloqueActual?: { bloque: string; subbloque?: string | null } | null } = {}
): { avisos: AvisoFila[]; detalle_curva: string[] } {
  const avisos: AvisoFila[] = [];
  let detalle: string[] = [];
  if (curvaCambio(registro.curva_origen_usada, vigente)) {
    avisos.push("curva_cambio");
    detalle = detalleCambioCurva(registro.curva_origen_usada, vigente, opciones.nombres ?? new Map());
  }
  if (registro.decidido !== null && registro.propuesta_al_decidir !== registro.propuesto) avisos.push("propuesta_cambio");
  const actual = opciones.bloqueActual;
  if (actual !== undefined && (actual === null || actual.bloque !== registro.bloque || (actual.subbloque ?? null) !== registro.subbloque)) {
    avisos.push("bloque_cambiado");
  }
  return { avisos, detalle_curva: detalle };
}

/** Nodos con el nivel guardado distinto del actual. */
export function nivelesCambiados(filas: readonly { gml_id: string; nivel_proyectado: string }[], nivelesActuales: ReadonlyMap<string, string>): number {
  const nodos = new Set<string>();
  for (const f of filas) {
    const nivel = nivelesActuales.get(f.gml_id);
    if (nivel !== undefined && nivel !== f.nivel_proyectado) nodos.add(f.gml_id);
  }
  return nodos.size;
}

// ─── Prerrequisitos ───

export type DudaDeRed = { tienda: string; anio: number; motivo: "apertura_dudosa" | "cierre_dudoso" | "meses_sin_venta"; meses: string[] };

/**
 * Regla "red por datos" de `redComparable` (M6): una tienda abierta todo el año por sus fechas pero sin venta en algún
 * mes exigido deja `apertura_dudosa` / `cierre_dudoso`. Solo avisa: "T06 no vendió en enero de 2025; si abrió después,
 * corrige la fecha en Tiendas".
 */
export function dudasDeRed(
  tiendas: readonly TiendaProy[],
  ventaMensual: readonly VentaTiendaMes[],
  anioEnCurso: number,
  hasta: string,
  mesesPublicados: Iterable<string>
): DudaDeRed[] {
  const maestro = tiendas.map((t) => ({ id: t.id, codigo: t.codigo, nombre: t.nombre, tipo: t.tipo, activo: t.activo, fecha_apertura: t.fecha_apertura, fecha_cierre: t.fecha_cierre }));
  const redes = redComparable(maestro, ventaMensual, [anioEnCurso - 1, anioEnCurso], hasta, PARAMETROS_POR_DEFECTO, { mesesPublicados });
  const codigos = new Map(tiendas.map((t) => [t.id, t.codigo]));
  const duda: DudaDeRed[] = [];
  for (const red of redes) {
    for (const t of red.tiendas) {
      const tienda = codigos.get(t.tienda_id) ?? t.tienda_id;
      const dudosa = (["apertura_dudosa", "cierre_dudoso"] as const).filter((m) => t.motivos.includes(m));
      for (const motivo of dudosa) duda.push({ tienda, anio: red.anio, motivo, meses: t.meses_sin_venta });
      // Un hueco en medio de la serie: no es apertura ni cierre dudosos, pero la red por datos no la deja entrar.
      if (dudosa.length === 0 && t.motivos.includes("meses_sin_venta")) duda.push({ tienda, anio: red.anio, motivo: "meses_sin_venta", meses: t.meses_sin_venta });
    }
  }
  return duda;
}

export type DatosPrerrequisitos = {
  anio: number;
  /** `aaaa-mm`: el último mes cerrado (`hastaPorDefecto`) o el `hasta_periodo` elegido. */
  hasta: string | null;
  mesesPublicados: readonly string[];
  tiendas: readonly TiendaProy[];
  tiendasConVenta: ReadonlySet<string>;
  dudasDeRed?: readonly DudaDeRed[];
  agrupacionesSinCurva?: readonly { id: string; nombre: string }[];
  curvasObsoletas?: number;
  /** Años atípicos de la temporada sin factor calculado ni aplicado. */
  factoresFaltantes?: readonly { anio: number; temporada: string }[];
  /** El año siguiente está marcado atípico en M6. */
  anioSiguienteAtipico?: boolean;
  nivelesCambiados?: number;
  referentesSinHistoria?: readonly string[];
};

/** Regla 35. Qué bloquea y qué solo avisa antes de proyectar. */
export function prerrequisitos(d: DatosPrerrequisitos): PrerrequisitosProyeccionApi {
  const bloquea: Motivo[] = [];
  const avisa: Motivo[] = [];
  const publicados = d.mesesPublicados.map(recortarPeriodo);

  if (publicados.length === 0 || d.hasta === null) {
    bloquea.push({ codigo: "sin_meses", mensaje: "No hay meses publicados: carga la venta en Venta y stock." });
  } else {
    const hasta = recortarPeriodo(d.hasta);
    const faltan = mesesFaltantes(publicados, hasta);
    const anioHasta = Number(hasta.slice(0, 4));
    const mesHasta = Number(hasta.slice(5, 7));
    const inicioVentana = indiceMes(anioHasta, mesHasta) - 11;
    const enExigidos = (m: string) => {
      const a = Number(m.slice(0, 4));
      const mm = Number(m.slice(5, 7));
      return a === d.anio || indiceMes(a, mm) >= inicioVentana;
    };
    const graves = faltan.filter(enExigidos);
    const antiguos = faltan.filter((m) => !enExigidos(m));
    if (graves.length > 0) {
      bloquea.push({ codigo: "meses_faltantes", mensaje: `Faltan meses publicados dentro del año en curso o de los últimos doce meses: ${graves.join(", ")}.`, detalle: graves });
    }
    if (antiguos.length > 0) {
      avisa.push({ codigo: "meses_faltantes_anteriores", mensaje: `Hay meses sin publicar en el histórico lejano: ${antiguos.join(", ")}. No afectan al cálculo.`, detalle: antiguos });
    }
  }

  const sinApertura = d.tiendas.filter((t) => t.tipo === "Tienda" && t.activo && !t.fecha_apertura && d.tiendasConVenta.has(t.id));
  if (sinApertura.length > 0) {
    bloquea.push({
      codigo: "tienda_sin_apertura_con_venta",
      mensaje: `Hay tiendas con venta pero sin fecha de apertura: ${sinApertura.map((t) => t.codigo).join(", ")}. Complétala en Tiendas.`,
      detalle: sinApertura.map((t) => t.codigo),
    });
  }
  if (!d.tiendas.some((t) => clasificarTienda(t, d.anio).bloque === "mismas")) {
    bloquea.push({ codigo: "sin_mismas_tiendas", mensaje: `Ninguna tienda estuvo abierta los doce meses de ${d.anio - 1}: no hay base de mismas tiendas.` });
  }

  for (const x of d.dudasDeRed ?? []) {
    const meses = x.meses.join(", ");
    avisa.push({
      codigo: x.motivo,
      mensaje:
        x.motivo === "apertura_dudosa"
          ? `${x.tienda} no vendió en ${meses}; si abrió después, corrige la fecha de apertura en Tiendas.`
          : x.motivo === "cierre_dudoso"
            ? `${x.tienda} dejó de vender en ${meses}; si cerró antes, corrige la fecha de cierre en Tiendas.`
            : `${x.tienda} no vendió en ${meses}: revisa que la carga de ese mes esté completa.`,
      detalle: [x.tienda],
    });
  }
  if ((d.agrupacionesSinCurva ?? []).length > 0) {
    avisa.push({ codigo: "agrupaciones_sin_curva", mensaje: `Hay agrupaciones con venta y sin curva vigente: ${(d.agrupacionesSinCurva ?? []).map((a) => a.nombre).join(", ")}.`, detalle: (d.agrupacionesSinCurva ?? []).map((a) => a.id) });
  }
  if ((d.curvasObsoletas ?? 0) > 0) avisa.push({ codigo: "curvas_obsoletas", mensaje: `${d.curvasObsoletas} curvas vigentes están obsoletas en Curvas de estacionalidad.` });
  for (const f of d.factoresFaltantes ?? []) {
    avisa.push({ codigo: "factor_sin_calcular", mensaje: `Falta el factor del Niño de ${f.temporada} ${f.anio}: sincroniza con Curvas o escríbelo.` });
  }
  if (d.anioSiguienteAtipico) avisa.push({ codigo: "anio_siguiente_atipico", mensaje: `${d.anio + 1} está marcado como año atípico: la propuesta del año siguiente se pondera con el factor del Niño.` });
  if ((d.nivelesCambiados ?? 0) > 0) avisa.push({ codigo: "nivel_cambiado", mensaje: "Cambió el nivel de planificación de alguna línea desde el último cálculo." });

  const bloques: BloquesApi = { [d.anio]: bloquesDeAnio(d.tiendas, d.anio), [d.anio + 1]: bloquesDeAnio(d.tiendas, d.anio + 1) };
  const nuevas = [...bloques[d.anio].nuevas, ...bloques[d.anio + 1].nuevas];
  const vistas = new Set<string>();
  const sinVenta: string[] = [];
  const sinReferente: string[] = [];
  for (const t of nuevas) {
    if (vistas.has(t.tienda_id)) continue;
    vistas.add(t.tienda_id);
    if (t.venta_esperada === null || t.venta_esperada === undefined) sinVenta.push(t.codigo);
    if (!t.referente_id) sinReferente.push(t.codigo);
  }
  if (sinVenta.length > 0) avisa.push({ codigo: "tienda_sin_venta_esperada", mensaje: `Tiendas nuevas sin venta esperada: ${sinVenta.join(", ")}.`, detalle: sinVenta });
  if (sinReferente.length > 0) avisa.push({ codigo: "tienda_sin_referente", mensaje: `Tiendas nuevas sin tienda de referencia (usarán la composición promedio de las mismas tiendas): ${sinReferente.join(", ")}.`, detalle: sinReferente });
  if ((d.referentesSinHistoria ?? []).length > 0) {
    avisa.push({ codigo: "referente_sin_historia", mensaje: `Referentes sin doce meses cerrados: ${(d.referentesSinHistoria ?? []).join(", ")}.`, detalle: [...(d.referentesSinHistoria ?? [])] });
  }
  return { bloquea, avisa };
}

export { TEMPORADAS_FACTOR };
