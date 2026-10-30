import { mesesFaltantes } from "@/lib/curvas/anios";
import { claseDeAnio, type PeriodoParaClase } from "@/lib/curvas/atipicos";
import { redComparable } from "@/lib/curvas/red";
import { PARAMETROS_POR_DEFECTO } from "@/lib/curvas/tipos-api";
import type { VentaTiendaMes } from "@/lib/curvas/tipos";
import { recortarPeriodo } from "@/lib/ventas/periodo";
import { bloquesDeAnio, clasificarTienda, type TiendaProy } from "./bloques";
import { indiceMes } from "./calendario";
import { curvaCambio, detalleCambioCurva } from "./curva-fila";
import { estadoFactorY, type FactorParaEstado } from "./factor-nino";
import { factorDe, type FactorProy } from "./nino";
import {
  CODIGO_CRECIMIENTOS_SIN_APROBAR_ANIO,
  TEMPORADAS_FACTOR,
  VERSION_METODO,
  type AvisoFila,
  type BloquesApi,
  type CurvaOrigen,
  type EstadoFactorY,
  type MotivoDesfaseFactor,
  type Motivo,
  type ParametrosProyeccion,
  type PrerrequisitosProyeccionApi,
  type ResumenProyeccion,
  type TemporadaFactor,
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
  /**
   * M12: `proyecciones.huella_flujo` con que se calculó. `null` = calculada antes de M12 (queda desactualizada); `undefined` = quien
   * llama no la trae (no se compara).
   */
  huella_flujo?: string | null;
  /** `version_metodo` ausente = no se sabe: no se marca. */
  resumen: (Pick<ResumenProyeccion, "curvas_usadas"> & Partial<Pick<ResumenProyeccion, "version_metodo" | "huella_crecimientos" | "gm_gml" | "temporada_equivalencias">>) | null;
  parametros: Pick<ParametrosProyeccion, "factores_usados" | "bloques">;
};

export type EstadoActual = {
  cargas_publicadas: { periodo: string; publicada_at: string | null }[];
  ultimo_mes_cerrado: string | null;
  curvas_vigentes: { agrupacion_id: string; curva_id: string }[];
  /** Nodos cuyo nivel de planificación ya no es el que tenía la fila (`nivel_proyectado`). */
  niveles_cambiados: number;
  /** M12: `huella_flujo` de hoy (configuración de 02b: marcas relevantes, modalidades y conjuntos). Ausente = no se compara. */
  huella_flujo?: string | null;
  tiendas: TiendaProy[];
  factores: FactorProy[];
  /** Último `updated_at` de los periodos atípicos activos. */
  periodos_updated_at: string | null;
  /** `0.10.8` (07c): la huella de la matriz de crecimientos de hoy y el GM (`genero_id|mundo_id`) vigente de cada nodo. Sin él no se comprueba. */
  crecimientos?: CrecimientosActuales;
  /**
   * `0.14.0` (06e M6): `equivalencia_id → temporada` de hoy de las equivalencias de las agrupaciones de invierno y verano (`temporadasDeEquivalencias`) y
   * las temporadas con meses atípicos en `Y`. Con los dos y la foto del cálculo (`resumen.temporada_equivalencias`) se detecta `temporada_cambiada`. Sin ellos no se comprueba.
   */
  temporada_equivalencias?: Readonly<Record<string, string>>;
  temporadas_con_nino?: readonly string[];
};

/**
 * `equivalencia_id → temporada` de las equivalencias activas de las agrupaciones de invierno y verano (las de `todo_el_ano` y las sin agrupación no tienen
 * `φ`, así que no entran). Es la foto con que se detecta que una equivalencia cambió de agrupación (`temporada_cambiada`).
 */
export function temporadasDeEquivalencias(
  nodos: readonly { equivalencias: readonly { id: string; agrupacion_estacionalidad_id: string | null }[] }[],
  agrupaciones: readonly { id: string; temporada: string }[]
): Record<string, string> {
  const temporadaDe = new Map(agrupaciones.map((a) => [a.id, a.temporada]));
  const salida: Record<string, string> = {};
  for (const n of nodos) {
    for (const q of n.equivalencias) {
      const t = q.agrupacion_estacionalidad_id ? temporadaDe.get(q.agrupacion_estacionalidad_id) : undefined;
      if (t === "invierno" || t === "verano") salida[q.id] = t;
    }
  }
  return Object.fromEntries(Object.entries(salida).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/**
 * `0.14.0` (06e M6, R29): equivalencias que cambiaron de temporada desde el cálculo y cuya temporada de antes o de ahora tiene meses atípicos en `Y`
 * (su `φ_Y` cambió). Pasar de una agrupación de `todo_el_ano` a otra no cuenta (ninguna tiene `φ`). Sin foto o sin estado de hoy, ninguna.
 */
export function equivalenciasConTemporadaCambiada(
  foto: Readonly<Record<string, string>> | undefined,
  hoy: Readonly<Record<string, string>> | undefined,
  temporadasConNino: readonly string[] | undefined
): string[] {
  if (!foto || !hoy || !temporadasConNino) return [];
  const nino = new Set(temporadasConNino);
  const ids = new Set([...Object.keys(foto), ...Object.keys(hoy)]);
  const cambiadas: string[] = [];
  for (const id of ids) {
    const antes = foto[id] ?? null;
    const ahora = hoy[id] ?? null;
    if (antes === ahora) continue;
    if ((antes !== null && nino.has(antes)) || (ahora !== null && nino.has(ahora))) cambiadas.push(id);
  }
  return cambiadas.sort();
}

/** Temporadas (de las que tienen `φ`) con al menos un mes atípico en `anio`: las que el factor del Niño corrige. */
export function temporadasConNinoEnAnio(anio: number, periodos: readonly PeriodoParaClase[], publicados: Iterable<string>): TemporadaFactor[] {
  const meses = [...publicados];
  return TEMPORADAS_FACTOR.filter((t) => claseDeAnio(anio, { temporada: t }, periodos, meses).meses_atipicos.length > 0);
}

/** Los meses `aaaa-mm` atípicos de `anio` para alguna de las `temporadas` (la unión, ordenada; pueden ser futuros). */
export function mesesAtipicosDeAnio(anio: number, temporadas: readonly TemporadaFactor[], periodos: readonly PeriodoParaClase[]): string[] {
  const meses = new Set<string>();
  for (const t of temporadas) for (const m of claseDeAnio(anio, { temporada: t }, periodos, []).meses_atipicos) meses.add(m);
  return [...meses].sort();
}

// ─── Factores de `Y`: estado y bloqueos del cierre (06e D5, B2) ───

/** Lo que se sabe hoy para evaluar el estado de los factores de `Y`. */
export type HoyFactores = {
  /** `huellaCargas` de hoy (de las mismas cargas publicadas con que sincroniza `sincronizarFactores`). */
  huella_cargas: string;
  /** Huella de composición de hoy de las agrupaciones de cada temporada y de `todo_el_ano`. */
  huella_composicion: Readonly<Record<TemporadaFactor, string>>;
  periodos: readonly PeriodoParaClase[];
  publicados: readonly string[];
};

export type EstadoFactorDeY = {
  anio: number;
  temporada: TemporadaFactor;
  estado: EstadoFactorY;
  motivos_desfase: MotivoDesfaseFactor[];
  /** `ratio_aplicado ?? ratio_calculado`. */
  efectivo: number | null;
  parcial: boolean;
};

/**
 * Meses del periodo atípico de `temporada` en `anio` que están publicados hoy (el `|P|` que se comparan en el factor: el año de referencia es un año
 * normal completo, así que basta con los publicados de `anio`). Con él `estadoFactorY` detecta un mes nuevo (`desfasado` por `meses`).
 */
export function mesesPeriodoPublicados(anio: number, temporada: TemporadaFactor, periodos: readonly PeriodoParaClase[], publicados: readonly string[]): number {
  const p = new Set(publicados.map(recortarPeriodo));
  return claseDeAnio(anio, { temporada }, periodos, [...p]).meses_atipicos.filter((m) => p.has(m)).length;
}

/**
 * R24 (B2). El estado de cada factor de `Y` (uno por temporada con meses atípicos en `Y`): `faltante` (sin fila o sin valor efectivo), `desfasado`,
 * `sin_confirmar` u `ok`. Solo temporadas con alguna agrupación activa (`temporadasActivas`).
 */
export function estadosFactoresDeY(args: {
  anioEnCurso: number;
  factores: readonly (FactorParaEstado & { anio: number; temporada: string })[];
  hoy: HoyFactores;
  temporadasActivas?: ReadonlySet<string>;
}): EstadoFactorDeY[] {
  const salida: EstadoFactorDeY[] = [];
  for (const temporada of TEMPORADAS_FACTOR) {
    if (args.temporadasActivas && !args.temporadasActivas.has(temporada)) continue;
    if (claseDeAnio(args.anioEnCurso, { temporada }, args.hoy.periodos, args.hoy.publicados).meses_atipicos.length === 0) continue;
    const f = args.factores.find((x) => x.anio === args.anioEnCurso && x.temporada === temporada);
    if (!f) {
      salida.push({ anio: args.anioEnCurso, temporada, estado: "faltante", motivos_desfase: [], efectivo: null, parcial: false });
      continue;
    }
    const r = estadoFactorY(f, {
      huella_cargas: args.hoy.huella_cargas,
      huella_composicion: args.hoy.huella_composicion[temporada],
      meses_periodo_publicados: mesesPeriodoPublicados(args.anioEnCurso, temporada, args.hoy.periodos, args.hoy.publicados),
    });
    salida.push({ anio: args.anioEnCurso, temporada, estado: r.estado, motivos_desfase: r.motivos_desfase, efectivo: f.ratio_aplicado ?? f.ratio_calculado, parcial: f.parcial });
  }
  return salida;
}

export type CrecimientosActuales = { huella: string; gm_por_nodo: ReadonlyMap<string, string> };

/**
 * `0.10.8` (07c): ¿la matriz de crecimientos guardada (celdas y Resto) ya no es la que aplicó el cálculo (`huella_crecimientos`), o algún nodo
 * con filas base cambió de mundo (`gm_gml` ≠ catálogo vigente)? Una proyección sin `huella_crecimientos` (del método anterior) no se marca
 * aquí: la cubre `version_metodo`.
 */
export function crecimientosCambiados(resumen: { huella_crecimientos?: string; gm_gml?: Record<string, string> } | null, actual: CrecimientosActuales | undefined): boolean {
  if (!resumen || actual === undefined || typeof resumen.huella_crecimientos !== "string") return false;
  if (resumen.huella_crecimientos !== actual.huella) return true;
  for (const [gml, gm] of Object.entries(resumen.gm_gml ?? {})) {
    const hoy = actual.gm_por_nodo.get(gml);
    if (hoy !== undefined && hoy !== gm) return true;
  }
  return false;
}


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

  // M12: la configuración de 02b (marcas relevantes, modalidades, conjuntos) cambió después de calcular. Una calculada antes de M12
  // (sin `huella_flujo`) también queda desactualizada. Una proyección sin calcular no tiene nada que comparar.
  if (calculado && typeof actual.huella_flujo === "string" && p.huella_flujo !== undefined && p.huella_flujo !== actual.huella_flujo) {
    motivos.push({ codigo: "config_cambiada", mensaje: "Cambió la configuración de marcas relevantes, modalidades o conjuntos después de calcular." });
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
  // `0.10.8`: la matriz de crecimientos cambió sin recalcular (falló el recálculo encadenado) o un nodo cambió de mundo. No se puede forzar al cerrar.
  if (crecimientosCambiados(p.resumen, actual.crecimientos)) {
    motivos.push({ codigo: "crecimientos_cambiados", mensaje: "Cambiaron los crecimientos por género · mundo o el mundo de un nodo después de calcular: recalcula para aplicarlos." });
  }
  // `0.14.0` (06e M6): una equivalencia con Niño cambió de agrupación (y con ella su `φ_Y`). No se puede forzar al cerrar.
  const cambiadasDeTemporada = equivalenciasConTemporadaCambiada(p.resumen?.temporada_equivalencias, actual.temporada_equivalencias, actual.temporadas_con_nino);
  if (cambiadasDeTemporada.length > 0) {
    motivos.push({ codigo: "temporada_cambiada", mensaje: "Cambió la agrupación de alguna línea con Niño y con ella su factor: recalcula.", detalle: cambiadasDeTemporada });
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
  /** `0.14.0` (06e D5): factores de `Y` calculados con datos, composición o fórmula viejos (se arregla con «Sincronizar»). Solo avisa. */
  factoresDesfasados?: readonly { anio: number; temporada: string }[];
  /** `0.14.0`: factores de `Y` parciales que nadie confirmó sobre el cálculo de hoy (se arregla escribiendo el valor). Solo avisa. */
  factoresSinConfirmar?: readonly { anio: number; temporada: string; efectivo?: number | null }[];
  /** El año siguiente está marcado atípico en M6. */
  anioSiguienteAtipico?: boolean;
  nivelesCambiados?: number;
  referentesSinHistoria?: readonly string[];
  /**
   * `0.12.1` (06d §3.1): lo aprobado hoy en el global para el año siguiente (`anio` = `Y+1`): cuántos GM de HOMBRE o MUJER y si hay Resto aprobado.
   * Sin él no se avisa. Solo informa: cerrar es lo que exige los aprobados.
   */
  crecimientosAprobados?: { anio: number; gm: number; resto: boolean };
};

/** «El factor de invierno 2026 se calculó con datos viejos o con otra fórmula: pulsa «Sincronizar» en Factores del Niño, revisa el valor y recalcula.» */
export function mensajeFactorDesfasado(f: { anio: number; temporada: string }): string {
  return `El factor de ${f.temporada} ${f.anio} se calculó con datos, composición o fórmula que ya cambiaron: pulsa «Sincronizar» en Factores del Niño, revisa el valor y recalcula.`;
}

/** «El factor de invierno 2026 (0,70) es parcial y nadie lo confirmó con los datos de hoy: escríbelo en Factores del Niño (el mismo valor lo confirma).» */
export function mensajeFactorSinConfirmar(f: { anio: number; temporada: string; efectivo?: number | null }): string {
  const valor = f.efectivo === null || f.efectivo === undefined ? "" : ` (${f.efectivo.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`;
  return `El factor de ${f.temporada} ${f.anio}${valor} es parcial y nadie lo confirmó con los datos de hoy: escríbelo en Factores del Niño (el mismo valor lo confirma).`;
}

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
    avisa.push({ codigo: "factor_sin_calcular", mensaje: `Falta el factor del Niño de ${f.temporada} ${f.anio}: la base de ${d.anio + 1} de esa temporada no se corregirá y no podrás cerrar.` });
  }
  for (const f of d.factoresDesfasados ?? []) avisa.push({ codigo: "factor_desfasado", mensaje: mensajeFactorDesfasado(f) });
  for (const f of d.factoresSinConfirmar ?? []) avisa.push({ codigo: "factor_sin_confirmar", mensaje: mensajeFactorSinConfirmar(f) });
  if (d.anioSiguienteAtipico) {
    avisa.push({ codigo: "anio_siguiente_atipico", mensaje: `${d.anio + 1} está marcado como año del Niño: puedes calcular, pero no aprobar crecimientos de ${d.anio + 1} ni cerrar hasta quitar la marca o decidir cómo modelarlo.` });
  }
  if ((d.nivelesCambiados ?? 0) > 0) avisa.push({ codigo: "nivel_cambiado", mensaje: "Cambió el nivel de planificación de alguna línea desde el último cálculo." });
  // 0.12.1: avisa (no bloquea) de lo que habrá que aprobar para cerrar mientras falte el Resto o no haya ningún GM aprobado.
  const aprobados = d.crecimientosAprobados;
  if (aprobados && (!aprobados.resto || aprobados.gm === 0)) {
    avisa.push({
      codigo: CODIGO_CRECIMIENTOS_SIN_APROBAR_ANIO,
      mensaje: `Para cerrar necesitarás aprobados los crecimientos de HOMBRE y MUJER por mundo y el Resto de ${aprobados.anio} (hoy: ${aprobados.gm} ${aprobados.gm === 1 ? "GM aprobado" : "GM aprobados"}; ${aprobados.resto ? "el Resto está aprobado" : "el Resto es provisional"}).`,
    });
  }

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
