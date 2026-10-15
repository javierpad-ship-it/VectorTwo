import { recortarPeriodo } from "@/lib/ventas/periodo";
import { aniosDeCorrida, mesesDelAnio, mesesFaltantes } from "./anios";
import { periodoAplica, type PeriodoParaClase } from "./atipicos";
import type { EntradaCorrida } from "./modelo";
import {
  ETIQUETA_TEMPORADA,
  type CodigoPrerrequisito,
  type ParametrosCurvas,
  type Prerrequisito,
  type PrerrequisitosApi,
  type TemporadaAgrupacion,
} from "./tipos-api";
import type { TiendaMaestro, VentaTiendaMes } from "./tipos";
import { TIPO_TIENDA } from "./red";

/**
 * Prerrequisitos de una agrupación (docs/modulos/06b-curvas-trabajo-por-agrupacion.md,
 * "Prerrequisitos", reglas 32 y 33): lo que debe cumplirse ANTES de calcular y
 * aprobar. Funciones puras: sin base, sin HTTP, sin importar nada de `@supabase/*`
 * ni de React. Con `bloquea` no vacío no hay cálculo ni aprobación; los avisos no
 * paran nada. Todo detalle es castellano llano, para mostrarlo tal cual.
 */

/** Los prerrequisitos de una agrupación que se saben SIN calcular (los que muestra la lista por fila). */
export const BLOQUEOS_SIN_CALCULAR: readonly CodigoPrerrequisito[] = ["periodos_temporada_faltantes", "composicion_vacia", "tienda_sin_apertura"];

export type EntradaPrerrequisitos = {
  agrupacion: { id: string; nombre: string; activo: boolean; temporada: TemporadaAgrupacion; equivalencias_activas: number };
  /** Versiones guardadas alguna vez (con una, `todo_el_ano` ya no avisa `temporada_sin_confirmar`). */
  versiones: number;
  parametros: Pick<ParametrosCurvas, "solo_tiendas_completas" | "tiendas_excluidas" | "sin_periodos_confirmado">;
  /** Meses publicados en M5 (`aaaa-mm`), todos. */
  meses_publicados: readonly string[];
  /** `aaaa-mm` efectivo; `null` si no hay ningún mes publicado y cerrado. */
  hasta_periodo: string | null;
  /** Periodos ACTIVOS. */
  periodos: readonly PeriodoParaClase[];
  tiendas: readonly TiendaMaestro[];
  /** Venta total por tienda y mes (suma de `temporadas` en el cálculo; `venta_mensual_tienda()` en la lista). */
  venta_tienda: readonly VentaTiendaMes[];
  /** La entrada ya armada (`armarEntradaAgrupacion`); `null` evalúa solo lo que no necesita calcular. */
  entrada: EntradaCorrida | null;
};

const unidad = (n: number, singular: string, plural: string) => `${n} ${n === 1 ? singular : plural}`;

function lista(valores: readonly (string | number)[]): string {
  if (valores.length <= 1) return valores.join("");
  return `${valores.slice(0, -1).join(", ")} y ${valores[valores.length - 1]}`;
}

/** ¿Algún periodo activo aplica a la temporada? */
export function hayPeriodosParaTemporada(periodos: readonly PeriodoParaClase[], temporada: TemporadaAgrupacion): boolean {
  return periodos.some((p) => periodoAplica(p, temporada));
}

/** Cuántos periodos activos aplican a la temporada (para la columna de la lista). */
export function contarPeriodosAplicables(periodos: readonly PeriodoParaClase[], temporada: TemporadaAgrupacion): number {
  return periodos.filter((p) => periodoAplica(p, temporada)).length;
}

/** Temporadas que necesitan periodos del Niño: invierno y verano (toda temporada no). */
export const TEMPORADAS_CON_PERIODOS: readonly TemporadaAgrupacion[] = ["invierno", "verano"];

/**
 * Tiendas de tipo Tienda, activas, CON venta publicada (algún mes con unidades
 * positivas hasta `hasta`) y sin `fecha_apertura`: la red comparable no se puede
 * decidir. Una tienda sin venta y sin fecha no impide nada. Con
 * `solo_tiendas_completas = false` las fechas no se miran, y una tienda excluida a
 * mano tampoco cuenta.
 */
export function tiendasSinApertura(
  tiendas: readonly TiendaMaestro[],
  venta: readonly VentaTiendaMes[],
  hasta: string | null,
  opciones: { solo_tiendas_completas: boolean; excluidas?: readonly string[] }
): TiendaMaestro[] {
  if (!opciones.solo_tiendas_completas) return [];
  const excluidas = new Set(opciones.excluidas ?? []);
  const conVenta = new Set<string>();
  for (const v of venta) {
    if (v.unidades > 0 && (hasta === null || recortarPeriodo(v.periodo) <= hasta)) conVenta.add(v.tienda_id);
  }
  return tiendas
    .filter((t) => t.tipo === TIPO_TIENDA && t.activo && !t.fecha_apertura && conVenta.has(t.id) && !excluidas.has(t.id))
    .sort((a, b) => a.codigo.localeCompare(b.codigo, "es") || a.id.localeCompare(b.id));
}

function avisoTiendas(motivo: "apertura_dudosa" | "cierre_dudoso", entrada: EntradaCorrida, tiendas: readonly TiendaMaestro[]): Prerrequisito | null {
  const codigo = new Map(tiendas.map((t) => [t.id, t.codigo]));
  const porTienda = new Map<string, number[]>();
  for (const r of entrada.redes) {
    for (const t of r.tiendas) {
      if (t.motivos.includes(motivo)) porTienda.set(t.tienda_id, [...(porTienda.get(t.tienda_id) ?? []), r.anio]);
    }
  }
  if (porTienda.size === 0) return null;
  const ids = [...porTienda.keys()].sort((a, b) => (codigo.get(a) ?? a).localeCompare(codigo.get(b) ?? b, "es"));
  const que = motivo === "apertura_dudosa" ? "La fecha de apertura" : "La fecha de cierre";
  const detalle = ids.map((id) => `${codigo.get(id) ?? id} (${lista(porTienda.get(id) ?? [])})`);
  return {
    codigo: motivo,
    nivel: "avisa",
    detalle: `${que} parece dudosa en ${unidad(ids.length, "tienda", "tiendas")}: ${detalle.join(", ")}. Revísala en Tiendas.`,
    enlace: { pantalla: "tiendas", ...(ids.length === 1 ? { id: ids[0] } : {}) },
  };
}

/**
 * Regla 32. Evalúa los prerrequisitos de UNA agrupación. Con `entrada` (ya armada,
 * barata) mira también `sin_venta` y los avisos de apertura y cierre dudosos; sin ella,
 * solo lo evaluable sin calcular. El orden de `bloquea` es estable:
 * `sin_meses_publicados`, `sin_anio_completo`, `periodos_temporada_faltantes`,
 * `tienda_sin_apertura` (por código de tienda), `composicion_vacia`, `sin_venta`.
 */
export function prerrequisitosAgrupacion(e: EntradaPrerrequisitos): PrerrequisitosApi {
  const bloquea: Prerrequisito[] = [];
  const avisa: Prerrequisito[] = [];
  const hasta = e.hasta_periodo === null ? null : recortarPeriodo(e.hasta_periodo);
  const publicados = [...new Set(e.meses_publicados.map(recortarPeriodo))].sort();
  const usados = hasta === null ? [] : publicados.filter((m) => m <= hasta);
  const temporada = e.agrupacion.temporada;

  if (publicados.length === 0 || hasta === null) {
    bloquea.push({
      codigo: "sin_meses_publicados",
      nivel: "bloquea",
      detalle:
        publicados.length === 0
          ? "No hay meses publicados: carga la venta en Venta y stock antes de calcular."
          : "Ningún mes publicado está cerrado todavía: espera al cierre o indica hasta qué mes calcular.",
      enlace: { pantalla: "venta_stock" },
    });
  }

  if (hasta !== null && usados.length > 0) {
    const completo = aniosDeCorrida(usados, hasta).some((anio) => mesesDelAnio(anio).every((m) => m <= hasta && usados.includes(m)));
    if (!completo) {
      const faltan = mesesFaltantes(usados, hasta);
      bloquea.push({
        codigo: "sin_anio_completo",
        nivel: "bloquea",
        detalle: `Ningún año tiene sus 12 meses publicados${faltan.length > 0 ? `: faltan ${lista(faltan)}` : ""}. Carga los meses que faltan en Venta y stock.`,
        enlace: { pantalla: "venta_stock" },
      });
    }
  }

  if (TEMPORADAS_CON_PERIODOS.includes(temporada) && !hayPeriodosParaTemporada(e.periodos, temporada)) {
    const etiqueta = ETIQUETA_TEMPORADA[temporada].toLowerCase();
    if (e.parametros.sin_periodos_confirmado) {
      avisa.push({
        codigo: "periodos_temporada_faltantes",
        nivel: "avisa",
        detalle: `No hay periodos atípicos para ${etiqueta}; confirmaste que esta temporada no tiene años atípicos.`,
        enlace: { pantalla: "periodos" },
      });
    } else {
      bloquea.push({
        codigo: "periodos_temporada_faltantes",
        nivel: "bloquea",
        detalle: `No hay periodos atípicos para ${etiqueta}: crea los del Niño o confirma que esta temporada no tiene años atípicos.`,
        enlace: { pantalla: "periodos" },
      });
    }
  }

  for (const t of tiendasSinApertura(e.tiendas, e.venta_tienda, hasta, {
    solo_tiendas_completas: e.parametros.solo_tiendas_completas,
    excluidas: e.parametros.tiendas_excluidas,
  })) {
    bloquea.push({
      codigo: "tienda_sin_apertura",
      nivel: "bloquea",
      detalle: `La tienda ${t.codigo} tiene venta y no tiene fecha de apertura: sin ella no se puede decidir la red comparable. Complétala en Tiendas.`,
      enlace: { pantalla: "tiendas", id: t.id },
    });
  }

  if (e.agrupacion.equivalencias_activas === 0) {
    bloquea.push({
      codigo: "composicion_vacia",
      nivel: "bloquea",
      detalle: "La agrupación no tiene equivalencias activas: asígnale equivalencias antes de calcular.",
      enlace: { pantalla: "agrupaciones", id: e.agrupacion.id },
    });
  }

  if (e.entrada) {
    const propia = e.entrada.agrupaciones.find((a) => a.agrupacion_id === e.agrupacion.id);
    if (propia?.sin_venta) {
      bloquea.push({
        codigo: "sin_venta",
        nivel: "bloquea",
        detalle: "La agrupación no tiene unidades vendidas en ningún mes publicado: revisa su asignación de equivalencias.",
        enlace: { pantalla: "agrupaciones", id: e.agrupacion.id },
      });
    }
  }

  // ─── Avisos ───
  if (temporada === "todo_el_ano" && e.versiones === 0) {
    avisa.push({
      codigo: "temporada_sin_confirmar",
      nivel: "avisa",
      detalle: "Sigue en Toda temporada: confirma la temporada antes de aprobar (aprobar la confirma).",
      enlace: null,
    });
  }
  if (hasta !== null && usados.length > 0) {
    const faltan = mesesFaltantes(usados, hasta);
    if (faltan.length > 0) {
      avisa.push({
        codigo: "meses_sin_cargar",
        nivel: "avisa",
        detalle: `Faltan meses por cargar: ${lista(faltan)}. Los años afectados quedan incompletos y no entran en el ajuste.`,
        enlace: { pantalla: "venta_stock" },
      });
    }
  }
  const ultimo = publicados[publicados.length - 1];
  const fuera = e.periodos
    .filter((p) => periodoAplica(p, temporada) && ultimo !== undefined && recortarPeriodo(p.hasta) > ultimo)
    .sort((a, b) => a.id.localeCompare(b.id));
  if (fuera.length > 0) {
    avisa.push({
      codigo: "periodo_fuera_de_datos",
      nivel: "avisa",
      detalle: `${fuera.length === 1 ? "El periodo" : "Los periodos"} «${fuera.map((p) => p.motivo).join("», «")}» ${fuera.length === 1 ? "llega" : "llegan"} más allá del último mes publicado (${ultimo}); es normal en el año en curso.`,
      enlace: null,
    });
  }
  if (e.entrada) {
    for (const motivo of ["apertura_dudosa", "cierre_dudoso"] as const) {
      const a = avisoTiendas(motivo, e.entrada, e.tiendas);
      if (a) avisa.push(a);
    }
  }
  return { bloquea, avisa };
}

/** Regla 33. Los códigos que bloquean a una agrupación y se saben sin calcular (`bloqueada_por` de la lista). */
export function bloqueadaPor(e: Omit<EntradaPrerrequisitos, "entrada">): CodigoPrerrequisito[] {
  const r = prerrequisitosAgrupacion({ ...e, entrada: null });
  return [...new Set(r.bloquea.map((p) => p.codigo))].filter((c) => BLOQUEOS_SIN_CALCULAR.includes(c));
}

export type EntradaGlobales = {
  meses_publicados: readonly string[];
  /** `aaaa-mm` último mes cerrado y publicado; `null` si ninguno. */
  hasta_periodo: string | null;
  periodos: readonly PeriodoParaClase[];
  /** Agrupaciones ACTIVAS. */
  agrupaciones: ReadonlyArray<{ id: string; temporada: TemporadaAgrupacion }>;
  /** Agrupaciones cuya última aprobación confirmó "sin años atípicos" (no cuentan como faltantes de periodos). */
  confirmadas_sin_periodos?: ReadonlySet<string>;
  tiendas: readonly TiendaMaestro[];
  venta_tienda: readonly VentaTiendaMes[];
};

/**
 * Regla 33. Los prerrequisitos que NO dependen de la agrupación y que la lista
 * muestra arriba: meses publicados, periodos por temporada (con cuántas agrupaciones
 * afecta), tiendas con venta sin apertura (una por tienda) y meses sin cargar.
 */
export function armarPrerrequisitosGlobales(e: EntradaGlobales): Prerrequisito[] {
  const salida: Prerrequisito[] = [];
  const publicados = [...new Set(e.meses_publicados.map(recortarPeriodo))].sort();
  if (publicados.length === 0) {
    salida.push({
      codigo: "sin_meses_publicados",
      nivel: "bloquea",
      detalle: "No hay meses publicados: carga la venta en Venta y stock antes de calcular.",
      enlace: { pantalla: "venta_stock" },
    });
  }

  const faltantes: string[] = [];
  const afectadas: string[] = [];
  for (const t of TEMPORADAS_CON_PERIODOS) {
    if (hayPeriodosParaTemporada(e.periodos, t)) continue;
    const cuantas = e.agrupaciones.filter((a) => a.temporada === t && !e.confirmadas_sin_periodos?.has(a.id)).length;
    if (cuantas === 0) continue;
    faltantes.push(t);
    afectadas.push(`${t} (${unidad(cuantas, "agrupación", "agrupaciones")})`);
  }
  if (faltantes.length > 0) {
    salida.push({
      codigo: "periodos_temporada_faltantes",
      nivel: "bloquea",
      detalle: `No hay periodos atípicos para ${afectadas.join(" ni ")}: no se pueden calcular sin ellos (o sin confirmar que no hubo años atípicos).`,
      enlace: { pantalla: "periodos" },
    });
  }

  for (const t of tiendasSinApertura(e.tiendas, e.venta_tienda, e.hasta_periodo, { solo_tiendas_completas: true })) {
    salida.push({
      codigo: "tienda_sin_apertura",
      nivel: "bloquea",
      detalle: `La tienda ${t.codigo} tiene venta y no tiene fecha de apertura. Complétala en Tiendas.`,
      enlace: { pantalla: "tiendas", id: t.id },
    });
  }

  if (publicados.length > 0) {
    const hasta = e.hasta_periodo ?? publicados[publicados.length - 1];
    const faltan = mesesFaltantes(publicados, hasta);
    if (faltan.length > 0) {
      salida.push({
        codigo: "meses_sin_cargar",
        nivel: "avisa",
        detalle: `Falta cargar ${lista(faltan)}.`,
        enlace: { pantalla: "venta_stock" },
      });
    }
  }
  return salida;
}
