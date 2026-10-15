/**
 * Contrato de la API de M6 para el frontend (docs/modulos/06-curvas-estacionalidad.md,
 * "Contratos de API"): paso 1 (temporada de la agrupación, periodos atípicos y
 * la lectura de años atípicos que M7 consumirá) y paso 2 (corridas, curvas,
 * red comparable, efecto del Niño, elegir/retirar). Describe el JSON que viaja,
 * no las filas de la base.
 *
 * CONTRATO CON M7: M7 lee `periodos[].temporadas` (y `claseDeAnio`, `/anios`,
 * `efecto_atipico.por_temporada[]` de la corrida de referencia); `alcance` es un
 * espejo heredado del paso 1 y NO debe usarse.
 *
 * Autocontenido a propósito: no importa nada (ni componentes, ni acceso a la
 * base, ni código de cliente), así que lo pueden usar tanto el servidor como la
 * pantalla.
 * Los nombres son parte del contrato: lo que M6 añada después irá en campos
 * nuevos, sin cambiar estos.
 *
 * Fechas: en la API los meses viajan como `aaaa-mm` (`"2023-03"`); la base
 * guarda el primer día del mes y el handler convierte en los dos sentidos.
 */

// ─── Temporada de la agrupación de estacionalidad ───

/**
 * Códigos (minúsculas con guion bajo), distintos de las etiquetas de
 * `lineas.temporada` de M1 (`Verano` / `Invierno` / `Todo el año`).
 */
export const TEMPORADAS_AGRUPACION = ["invierno", "verano", "todo_el_ano"] as const;
export type TemporadaAgrupacion = (typeof TEMPORADAS_AGRUPACION)[number];

/** Texto de pantalla de cada temporada ("Toda temporada" es la etiqueta de `todo_el_ano`). */
export const ETIQUETA_TEMPORADA: Record<TemporadaAgrupacion, string> = {
  invierno: "Invierno",
  verano: "Verano",
  todo_el_ano: "Toda temporada",
};

/**
 * Campos de temporada que lleva cada agrupación de estacionalidad en
 * `GET/POST/PATCH /api/agrupaciones-estacionalidad` (y, sin el aviso, en los
 * catálogos de la lista plana de M3).
 */
export type TemporadaDeAgrupacionApi = {
  /** La fija el planner; las agrupaciones existentes nacen `todo_el_ano`. */
  temporada: TemporadaAgrupacion;
  /**
   * Temporada mayoritaria de las líneas (M1) de sus equivalencias activas, por
   * número de equivalencias. Empate o sin equivalencias: `todo_el_ano`.
   */
  temporada_sugerida: TemporadaAgrupacion;
  /**
   * Aviso `temporada_sugerida_distinta`: verdadero si la agrupación tiene al
   * menos una equivalencia activa y su `temporada` no coincide con la sugerida.
   */
  temporada_sugerida_distinta: boolean;
};

// ─── Periodos atípicos (`/api/periodos-atipicos`) ───

/**
 * ESPEJO HEREDADO del paso 1 (M7 NO debe leerlo: lee `temporadas`).
 * `invierno` si el conjunto de temporadas no cubre las tres, `todas` si las cubre.
 */
export const ALCANCES_PERIODO = ["invierno", "todas"] as const;
export type AlcancePeriodo = (typeof ALCANCES_PERIODO)[number];

export const ETIQUETA_ALCANCE: Record<AlcancePeriodo, string> = {
  invierno: "Solo agrupaciones de invierno",
  todas: "Todas las agrupaciones",
};

/** Un periodo atípico tal como lo devuelven POST (`201`) y PATCH. */
export type PeriodoAtipicoApi = {
  id: string;
  /** Primer mes incluido, `aaaa-mm`. */
  desde: string;
  /** Último mes incluido, `aaaa-mm` (inclusive; `hasta >= desde`). */
  hasta: string;
  /** 1 a 120 caracteres, tal como se escribió (sin pasar a mayúsculas). */
  motivo: string;
  /** Hasta 500 caracteres; `null` si está vacía. */
  descripcion: string | null;
  /**
   * Conjunto efectivo de temporadas de agrupación a las que aplica el periodo
   * (de una a tres, sin repetidos). Un periodo aplica a una agrupación si su
   * `temporada` está aquí. ESTE es el campo que debe leer M7.
   */
  temporadas: TemporadaAgrupacion[];
  /** Espejo heredado de `temporadas` (ver `AlcancePeriodo`); no usar. */
  alcance: AlcancePeriodo;
  /** Desactivar un periodo lo saca del cálculo sin perder el registro. */
  activo: boolean;
  created_at: string;
  updated_at: string;
};

/** Fila de `GET /api/periodos-atipicos` (`data` es un arreglo ordenado por `desde`). */
export type PeriodoAtipicoLista = PeriodoAtipicoApi & {
  /** Cuántos meses cubre (`desde = hasta` es 1). */
  meses: number;
  /** Agrupaciones activas cuya temporada está en `temporadas`. */
  agrupaciones_afectadas: number;
};

export type CrearPeriodoAtipicoCuerpo = {
  desde: string;
  hasta: string;
  motivo: string;
  descripcion?: string | null;
  /** Por defecto `["invierno"]`. */
  temporadas?: TemporadaAgrupacion[];
  /** Heredado: sin `temporadas`, `invierno` → `["invierno"]` y `todas` → las tres; contradictorio con `temporadas` → 400. */
  alcance?: AlcancePeriodo;
};

export type EditarPeriodoAtipicoCuerpo = Partial<{
  desde: string;
  hasta: string;
  motivo: string;
  descripcion: string | null;
  temporadas: TemporadaAgrupacion[];
  alcance: AlcancePeriodo;
  activo: boolean;
}>;

/** `DELETE /api/periodos-atipicos/[id]`. */
export type EliminarPeriodoAtipicoRespuesta = { id: string };

// ─── Años atípicos (`claseDeAnio` y `GET /api/periodos-atipicos/anios`) ───

export type ClaseAnio = "normal" | "atipico";

/** Un periodo activo que aplica a la agrupación y cubre algún mes del año. */
export type PeriodoDeAnio = { id: string; motivo: string; alcance: AlcancePeriodo; temporadas: TemporadaAgrupacion[] };

/** Lo que devuelve `claseDeAnio(anio, agrupacion, periodos, mesesPublicados)`. */
export type ClaseDeAnioApi = {
  anio: number;
  clase: ClaseAnio;
  /** Meses `aaaa-mm` del año dentro de un periodo atípico que aplica, en orden; pueden ser futuros. */
  meses_atipicos: string[];
  periodos: PeriodoDeAnio[];
  /** Los 12 meses del año están publicados en M5; un año en curso o con meses sin cargar es `false`. */
  completo: boolean;
};

/** Un año de `GET /api/periodos-atipicos/anios`. */
export type AnioAtipicidadApi = ClaseDeAnioApi & {
  /**
   * Ratio de volumen de la TEMPORADA de la agrupación (o la pedida) de la
   * corrida de REFERENCIA; `null` sin corrida de referencia o sin comparación.
   */
  ratio_volumen: number | null;
  /** Detalle del factor (nivel temporada); `null` sin corrida de referencia o si el año no es atípico. */
  volumen: VolumenAnioApi | null;
};

/** Factor de volumen de un año atípico, a nivel de temporada (I3), de la corrida de referencia. */
export type VolumenAnioApi = {
  nivel: "temporada";
  temporada: TemporadaAgrupacion;
  ratio_control: number | null;
  ratio_relativo: number | null;
  crecimiento_normal: number | null;
  anio_referencia: number | null;
  tiendas_comunes: number;
  meses_comparados: number;
  /** Agrupaciones de la temporada que suman este factor. */
  agrupaciones: number;
  /** Diagnóstico: el ratio de la agrupación pedida (solo con `?agrupacion_id=`). */
  ratio_agrupacion: number | null;
  corrida_id: string;
};

/** Lo que se evaluó: o una agrupación concreta (`agrupacion_id`) o una temporada (`agrupacion_id: null`). */
export type CriterioAnios = { agrupacion_id: string | null; temporada: TemporadaAgrupacion };

export type ResumenAnios = {
  /** Años con `clase = "atipico"`, ascendente. */
  anios_atipicos: number[];
  /** Años `normal` con `completo = true`, ascendente. */
  anios_normales_completos: number[];
};

/**
 * `data` de `GET /api/periodos-atipicos/anios`, con `?agrupacion_id=<uuid>` o
 * `?temporada=invierno|verano|todo_el_ano` (por defecto `invierno`) y,
 * opcional, `?desde=2023&hasta=2026` (años).
 */
export type AniosAtipicosRespuesta = {
  criterio: CriterioAnios;
  /** Corrida de referencia de la que salen `ratio_volumen` y `volumen`; `null` si no hay. */
  corrida_id: string | null;
  anios: AnioAtipicidadApi[];
  resumen: ResumenAnios;
};

// ═══════════════════════════════════════════════════════════════════════════
// PASO 2: curvas de estacionalidad
// ═══════════════════════════════════════════════════════════════════════════
//
// Convenciones: las participaciones y curvas son FRACCIONES (suman 1, seis
// decimales; la pantalla las muestra como porcentaje con un decimal); la EAT, el
// error máximo y las diferencias entre años viajan en PUNTOS porcentuales (0 a
// 200). Los arreglos de doce valores van de enero (índice 0) a diciembre
// (índice 11). Los meses de calendario viajan como `aaaa-mm`.

// ─── Constantes ───

export const MAX_MESES_HUECO = 4;
export const UMBRAL_FORMA = 3;
export const MIN_UNIDADES_ANO = 120;
export const UMBRAL_CAMBIO_VOLUMEN = 3;
export const MARGEN_RUIDO = 0.25;
export const EMPATE_EAT = 0.05;
export const PESO_MINIMO_DIAGNOSTICO = 0.05;
export const MIN_MESES_VALIDACION_PARCIAL = 6;
export const UMBRAL_LIQUIDACION = 0.15;
export const MESES_TIENDA_NUEVA = 0;
export const UMBRAL_TIENDA_DOMINANTE = 0.35;

export const CLASES_ANIO = ["normal", "con_huecos", "atipico_completo", "incompleto", "en_curso"] as const;
/** Clase de un año para el modelo (distinta de `ClaseAnio`, que es el contrato de M7: normal/atipico). */
export type ClaseAnioCurva = (typeof CLASES_ANIO)[number];

export const TRATAMIENTOS_ANIO = ["incluido", "imputado", "descartado"] as const;
export type TratamientoAnio = (typeof TRATAMIENTOS_ANIO)[number];

export const TRATAMIENTOS_ATIPICOS = ["auto", "incluir", "imputar", "descartar"] as const;
export type TratamientoAtipicos = (typeof TRATAMIENTOS_ATIPICOS)[number];

export const VEREDICTOS_FORMA = ["forma_estable", "forma_cambia", "sin_comparacion"] as const;
export type VeredictoForma = (typeof VEREDICTOS_FORMA)[number];

/** Motivos por los que una tienda queda fuera de la red de un año (los cinco primeros) y avisos que no la sacan. */
export const MOTIVOS_RED = [
  "centro_distribucion",
  "tienda_desactivada",
  "no_abierta_todo_el_ano",
  "tienda_nueva",
  "meses_sin_venta",
  "apertura_dudosa",
  "cierre_dudoso",
  "tienda_sin_apertura",
] as const;
export type MotivoRed = (typeof MOTIVOS_RED)[number];
/** Los motivos que SACAN a la tienda de la red del año; los demás son avisos y la tienda entra. */
export const MOTIVOS_EXCLUSION_RED: readonly MotivoRed[] = [
  "centro_distribucion",
  "tienda_desactivada",
  "no_abierta_todo_el_ano",
  "tienda_nueva",
  "meses_sin_venta",
];

export const ETIQUETA_MOTIVO_RED: Record<MotivoRed, string> = {
  centro_distribucion: "Centro de distribución",
  tienda_desactivada: "Tienda desactivada",
  no_abierta_todo_el_ano: "No abierta todo el año",
  tienda_nueva: "Tienda nueva",
  meses_sin_venta: "Meses sin venta",
  apertura_dudosa: "Apertura dudosa",
  cierre_dudoso: "Cierre dudoso",
  tienda_sin_apertura: "Sin fecha de apertura",
};

export const MOTIVOS_OBSOLETA = [
  "tienda_entra_red",
  "tienda_sale_red",
  "composicion_cambiada",
  "carga_nueva",
  "periodo_cambiado",
  "temporada_cambiada",
] as const;
export type MotivoObsoleta = (typeof MOTIVOS_OBSOLETA)[number];

export const MODELOS_PROPIOS = ["A", "B", "C", "D", "E"] as const;
export type ModeloPropio = (typeof MODELOS_PROPIOS)[number];
export const MODELOS_CURVA = ["A", "B", "C", "D", "E", "T"] as const;
export type ModeloCurva = (typeof MODELOS_CURVA)[number];

/** Catálogo de candidatas, en orden de desempate (`T` nunca compite). */
export type DescripcionModelo = { codigo: ModeloCurva; nombre: string; descripcion: string; prestada: boolean };
export const MODELOS: readonly DescripcionModelo[] = [
  { codigo: "A", nombre: "Promedio simple", descripcion: "Media de la participación de cada año de ajuste.", prestada: false },
  { codigo: "B", nombre: "Ponderado por volumen", descripcion: "Los años con más ventas pesan más.", prestada: false },
  { codigo: "C", nombre: "Ponderado por recencia", descripcion: "Los años recientes pesan más (1, 2, 3…).", prestada: false },
  { codigo: "D", nombre: "Suavizada", descripcion: "Promedio simple con media móvil de tres meses, para quitar picos de un solo mes.", prestada: false },
  { codigo: "E", nombre: "Promedio de tiendas", descripcion: "Media simple de las curvas de cada tienda de la red: contraste frente a la tienda dominante.", prestada: false },
  { codigo: "T", nombre: "Curva de la temporada", descripcion: "Curva agregada de todas las agrupaciones de su temporada (prestada, para agrupaciones con pocos años).", prestada: true },
];

export const MOTIVOS_RECOMENDACION = ["sin_evidencia", "menor_error", "prestada"] as const;
export type MotivoRecomendacion = (typeof MOTIVOS_RECOMENDACION)[number];

export const CODIGOS_AVISO = [
  "sin_anos_utilizables",
  "pocos_anos_ajuste",
  "escaso",
  "cambio_volumen_extremo",
  "meses_sin_cargar",
  "mes_negativo",
  "forma_cambia",
  "sin_referencia",
  "sin_referencia_volumen",
  "pocos_anos_normales",
  "ano_atipico_completo",
  "temporada_sugerida_distinta",
  "temporadas_mezcladas",
  "liquidacion_fuerte",
  "sin_venta",
  "inactiva_con_curva",
  "tienda_dominante",
  "tienda_distinta",
  "sin_red_comparable",
  "prestada",
] as const;
export type CodigoAviso = (typeof CODIGOS_AVISO)[number];

/** Aviso con texto de pantalla en castellano llano en `detalle`. */
export type AvisoCurva = { codigo: CodigoAviso; detalle: string };

/** Medida de las curvas en esta entrega: siempre `unidades`. */
export type MedidaCurva = "unidades";

// ─── Parámetros ───

/** Parámetros de una corrida (los que guarda `corridas_estacionalidad.parametros`). */
export type ParametrosCurvas = {
  solo_tiendas_completas: boolean;
  exigir_venta_todo_el_ano: boolean;
  /** 0 a 36; 0 = no aplica (la tienda abierta cuenta desde su primer año calendario completo). */
  meses_tienda_nueva: number;
  /** 0,1 a 0,9. */
  umbral_tienda_dominante: number;
  tratamiento_atipicos: TratamientoAtipicos;
  /** Piso en puntos; el umbral efectivo es `max(umbral_forma, ruido_normal)`. */
  umbral_forma: number;
  max_meses_hueco: number;
  min_unidades_ano: number;
  umbral_cambio_volumen: number;
  margen_ruido: number;
  peso_minimo_diagnostico: number;
  umbral_liquidacion: number;
};

export const PARAMETROS_POR_DEFECTO: Readonly<ParametrosCurvas> = {
  solo_tiendas_completas: true,
  exigir_venta_todo_el_ano: true,
  meses_tienda_nueva: MESES_TIENDA_NUEVA,
  umbral_tienda_dominante: UMBRAL_TIENDA_DOMINANTE,
  tratamiento_atipicos: "auto",
  umbral_forma: UMBRAL_FORMA,
  max_meses_hueco: MAX_MESES_HUECO,
  min_unidades_ano: MIN_UNIDADES_ANO,
  umbral_cambio_volumen: UMBRAL_CAMBIO_VOLUMEN,
  margen_ruido: MARGEN_RUIDO,
  peso_minimo_diagnostico: PESO_MINIMO_DIAGNOSTICO,
  umbral_liquidacion: UMBRAL_LIQUIDACION,
};

/** Cuerpo de `POST /api/curvas/calcular`; todo es opcional (valen los defectos). */
export type CalcularCuerpo = Partial<ParametrosCurvas> & {
  /** `aaaa-mm`; por defecto `min(último publicado, último cerrado en Lima)`. */
  hasta_periodo?: string;
  /** La corrida nueva pasa a ser la de referencia (si no hay ninguna, siempre lo es). */
  marcar_referencia?: boolean;
};

// ─── Red comparable ───

export type RedTiendaAnio = {
  tienda_id: string;
  entra: boolean;
  /** Motivos de exclusión y avisos (`MOTIVOS_EXCLUSION_RED` frente al resto). */
  motivos: MotivoRed[];
  /** Meses `aaaa-mm` sin venta positiva que se exigían (condición 4). */
  meses_sin_venta: string[];
  /** Primer mes con venta positiva en toda la serie de la tienda; `null` si nunca vendió. */
  primer_mes_con_venta: string | null;
  /** Con motivo `tienda_nueva`: primer año en que entrará. */
  entra_desde: number | null;
  /** Unidades totales de la tienda en el año (todas las agrupaciones; los meses cargados en el año en curso). */
  unidades: number;
  /** `unidades ÷ total de la red` (suma 1 entre las que entran; 0 si no entra). */
  peso: number;
  /** Participación mensual de la tienda (12; con meses sin cargar en 0 y el resto renormalizado); `null` si no entra o sin venta. */
  participacion: number[] | null;
  /** EAT (puntos) de su participación frente a la de la red. */
  eat_vs_red: number | null;
  /** `tienda_distinta`: `eat_vs_red > max(umbral_forma, ruido)` y peso ≥ `peso_minimo_diagnostico`. */
  distinta: boolean;
};

export type RedAnio = {
  anio: number;
  tiendas: RedTiendaAnio[];
  total_unidades: number;
  /** `tienda_id` de la mayor si su peso supera `umbral_tienda_dominante`. */
  dominante: string | null;
  peso_mayor: number | null;
  /** Ninguna tienda cumple: el año no entra (`sin_red_comparable`). */
  sin_red: boolean;
  /** Participación mensual de la red (12); `null` si `sin_red` o sin venta. */
  participacion: number[] | null;
  /** Ruido usado para decidir `distinta` a nivel de red (EAT entre años normales); `null` si no hay dos. */
  ruido_normal: number | null;
};

export type TiendaIdentidad = { id: string; codigo: string; nombre: string };
/** La tienda con su código y nombre (los añaden las lecturas de la API). */
export type RedTiendaAnioApi = RedTiendaAnio & { codigo: string; nombre: string };
export type RedAnioApi = Omit<RedAnio, "tiendas"> & { tiendas: RedTiendaAnioApi[] };

/** `GET /api/curvas/red-comparable` (vista previa sin corrida; mismos parámetros de red en la query). */
export type RedComparableVistaPrevia = {
  anios: RedAnioApi[];
  hasta_periodo: string;
  meses_publicados: { desde: string; hasta: string; total: number; faltantes: string[] };
};

// ─── Resultado de una corrida ───

export type PorTiendaAnio = {
  tienda_id: string;
  unidades: number;
  /** Peso sobre la venta de ESTA agrupación en el año. */
  peso: number;
  participacion: number[] | null;
  eat_vs_red: number | null;
  distinta: boolean;
};

export type AnioAgrupacion = {
  anio: number;
  clase: ClaseAnioCurva;
  /** Meses atípicos que aplican (en el año en curso, solo los cargados). */
  meses_atipicos: number;
  /** `aaaa-mm` de esos meses. */
  atipicos: string[];
  /** `null` para `incompleto`, `en_curso` o sin red. */
  tratamiento: TratamientoAnio | null;
  /** Unidades del año sobre la red (los meses cargados en el año en curso). */
  unidades: number;
  /** Unidades de la red por mes (12; ceros en meses sin cargar). */
  meses: number[];
  escaso: boolean;
  /** Entró en el ajuste de las candidatas. */
  en_ajuste: boolean;
  /** Meses cargados (12 salvo año en curso o incompleto). */
  meses_cargados: number;
  tiendas_en_red: number;
  peso_tienda_mayor: number | null;
  /** Participación usada (tal cual o imputada); `null` si el año no es utilizable. */
  participacion: number[] | null;
  /** Participación real sin imputar; `null` sin volumen. */
  participacion_real: number[] | null;
  /** Meses 1 a 12 imputados con la referencia (solo `imputado`). */
  imputados: number[];
  /** Suma de `r_m` de los meses imputados (el detalle de verano lo muestra). */
  peso_imputado: number | null;
  /** Año en curso: participación sobre los meses cargados, renormalizada (12; meses sin cargar en 0). */
  participacion_parcial: number[] | null;
  /** `aaaa-mm` de meses en liquidación (CV % alto). */
  liquidacion: string[];
  por_tienda: PorTiendaAnio[];
};

export type VolumenAnioAgrupacion = {
  anio: number;
  clase: ClaseAnioCurva;
  ratio_volumen: number | null;
  meses_comparados: number;
  anio_referencia: number | null;
  por_anio_normal: { anio: number; ratio: number | null }[];
  tiendas_comunes: number;
  unidades: number;
  unidades_referencia: number;
  ratio_mensual: (number | null)[];
};

export type FormaAnioCompleto = {
  anio: number;
  parcial: false;
  diferencia_anio: number;
  pico: number;
  pico_referencia: number;
  /** En círculo, en meses; negativo = el pico se adelanta. */
  corrimiento_pico: number;
  mes_mayor_diferencia: number;
  veredicto: VeredictoForma;
  tratamiento_aplicado: TratamientoAnio | null;
};

export type FormaAnioParcial = {
  anio: number;
  parcial: true;
  meses_comparados: number;
  /** Sobre la red completa del año en curso. */
  red_completa: { diferencia_anio: number; pico: number } | null;
  /** Sobre las tiendas comunes con el año normal de referencia (separa el efecto de la tienda nueva). */
  tiendas_comunes: { diferencia_anio: number; pico: number; tiendas: number } | null;
  veredicto: null;
  tratamiento_aplicado: null;
};

export type FormaAnio = FormaAnioCompleto | FormaAnioParcial;

export type EfectoFormaAgrupacion = {
  veredicto: VeredictoForma;
  umbral: number;
  ruido_normal: number | null;
  umbral_efectivo: number;
  /** Cifra "diluida" de la curva: EAT entre la curva con y sin los años atípicos. */
  diferencia_forma: number | null;
  c_inc: number[] | null;
  c_sin: number[] | null;
  por_anio: FormaAnio[];
};

export type EfectoAtipicoAgrupacion = {
  volumen: VolumenAnioAgrupacion[];
  /** `null` si la agrupación es `todo_el_ano` o no hay año atípico. */
  forma: EfectoFormaAgrupacion | null;
};

export type CandidataApi = {
  modelo: ModeloCurva;
  /** `null` si no está disponible (ver `motivo`). */
  curva: number[] | null;
  /** `sin_tiendas_validas` (E), `sin_anos_ajuste`, `sin_anos_utilizables` (T). */
  motivo: string | null;
  eat: number | null;
  error_max: number | null;
  pliegues: number;
  eat_por_pliegue: { anio: number; eat: number; error_max: number }[];
  eat_parcial: number | null;
  /** Curva idéntica a otra anterior en el orden de desempate. */
  igual_a: ModeloPropio | null;
  /** `T` (curva de la temporada) siempre. */
  prestada: boolean;
};

export type ComparacionRecomendacion = {
  /** La mejor por EAT entre las propias con backtesting. */
  mejor: ModeloPropio;
  eat_mejor: number;
  eat_a: number | null;
  margen: number;
  pliegues: number;
  /** Frase lista para pantalla ("B se equivoca 27,4 pp frente a 29,1 de A en 2 pruebas; …"). */
  frase: string;
};

export type AgrupacionResultado = {
  agrupacion_id: string;
  temporada: TemporadaAgrupacion;
  /** `null` si M3 no tiene sugerencia (las líneas no informan o coinciden con `todo_el_ano`). */
  temporada_sugerida: TemporadaAgrupacion | null;
  /** `null` si no hay curva posible (ver `avisos`). */
  origen: "propia" | "prestada" | null;
  composicion: { equivalencias: number; huella: string };
  efecto_atipico: EfectoAtipicoAgrupacion;
  anios: AnioAgrupacion[];
  candidatas: CandidataApi[];
  recomendada: ModeloCurva | null;
  motivo_recomendacion: MotivoRecomendacion | null;
  /** Puntos de EAT que otra candidata debe ganar a `A` para desbancarla. */
  margen: number | null;
  comparacion: ComparacionRecomendacion | null;
  /** 0 a 1 (1 − Σ desviación típica mensual); `null` con menos de dos años de ajuste. */
  estabilidad: number | null;
  nivel_estabilidad: "alta" | "media" | "baja" | null;
  /** Mínimo y máximo de `p_m` entre los años de ajuste (12); `null` con menos de dos años. */
  banda: { min: number; max: number }[] | null;
  /** CV % (`costo ÷ venta`) por mes de los años utilizables. */
  cv_mensual: { periodo: string; cv: number | null }[];
  avisos: AvisoCurva[];
};

export type TemporadaAnio = Omit<AnioAgrupacion, "por_tienda" | "participacion_real" | "liquidacion">;

export type TemporadaResultado = {
  temporada: TemporadaAgrupacion;
  /** Agrupaciones activas de la temporada que suman esta serie. */
  agrupaciones: number;
  anios: TemporadaAnio[];
  /** `curva_T`; `null` sin años de ajuste. */
  curva_T: number[] | null;
  anios_ajuste: number[];
};

export type ResultadoCorrida = { agrupaciones: AgrupacionResultado[]; temporadas: TemporadaResultado[] };

export type ResumenCorrida = {
  agrupaciones_activas: number;
  propias: number;
  prestadas: number;
  /** Sin curva posible (sin venta utilizable): `activas = propias + prestadas + sin_venta`. */
  sin_venta: number;
  con_avisos: number;
  anios_por_clase: Record<ClaseAnioCurva, number>;
  agregado: { filas_mv: number; refrescada_at: string | null; duracion_ms: number };
  meses_publicados: { desde: string; hasta: string; faltantes: string[] };
  unidades_sin_agrupacion: number;
  /** Huella del maestro de tiendas (obsolescencia por red). */
  red_huella: string;
  /** `{ "aaaa-mm": carga_id }` de los meses publicados usados. */
  cargas: Record<string, string>;
  duracion_ms: number;
};

// ─── Efecto del Niño a nivel de corrida (lo que lee la pestaña Años Niño y M7) ───

export type TemporadaORed = TemporadaAgrupacion | "red";

export type EfectoTemporadaAnio = {
  anio: number;
  temporada: TemporadaORed;
  agrupaciones: number;
  ratio_volumen: number | null;
  /** Ratio de `todo_el_ano` del mismo año sobre las mismas tiendas comunes; `null` para la propia `todo_el_ano` y para `red`. */
  ratio_control: number | null;
  /** `ratio_volumen ÷ ratio_control`. No existe ninguna etiqueta de "sustitución". */
  ratio_relativo: number | null;
  /** Ratio entre los dos años normales más recientes de la temporada (sobre sus tiendas comunes). */
  crecimiento_normal: number | null;
  anio_referencia: number | null;
  tiendas_comunes: number;
  meses_comparados: number;
  unidades: number;
  unidades_referencia: number;
  ratio_mensual: (number | null)[];
};

export type CrecimientoNormal = {
  temporada: TemporadaORed;
  anio: number;
  anio_referencia: number;
  ratio: number | null;
  tiendas_comunes: number;
};

export type EfectoAtipicoCorrida = {
  umbral_forma: number;
  margen_ruido: number;
  por_temporada: EfectoTemporadaAnio[];
  crecimiento_normal: CrecimientoNormal[];
  forma: Partial<
    Record<
      TemporadaAgrupacion,
      { forma_estable: number; forma_cambia: number; sin_comparacion: number; ruido_normal: number[] }
    >
  >;
  avisos: AvisoCurva[];
};

// ─── Corridas ───

export type CorridaResumenApi = {
  id: string;
  created_at: string;
  hasta_periodo: string;
  referencia: boolean;
  parametros: ParametrosCurvas;
  resumen: ResumenCorrida;
  usuario_nombre: string | null;
};

/** `POST /api/curvas/calcular` → `201`. */
export type CalcularRespuesta = { corrida: CorridaResumenApi };

/** Fila de `GET /api/curvas/corridas` (las últimas 50, sin `resultado`). */
export type CorridaListaApi = CorridaResumenApi;

/** `PATCH /api/curvas/corridas/[id]` con `{ referencia: true }`. */
export type MarcarReferenciaRespuesta = { corrida: CorridaResumenApi };

/** `GET /api/curvas/corridas/[id]`. */
export type CorridaDetalleApi = {
  corrida: CorridaResumenApi;
  resultado: ResultadoCorrida;
  red_comparable: RedAnioApi[];
  efecto_atipico: EfectoAtipicoCorrida;
  agrupaciones: {
    id: string;
    nombre: string;
    codigo: string;
    activo: boolean;
    temporada: TemporadaAgrupacion;
    generos: string[];
    vigente: VigenteResumenApi | null;
  }[];
};

// ─── Curvas vigentes, obsolescencia y propuesta ───

export type VigenteResumenApi = {
  id: string;
  version: number;
  modelo: ModeloCurva;
  origen: "propia" | "prestada";
  recomendada: boolean;
  eat: number | null;
  aprobada_at: string;
  usuario_nombre: string | null;
  corrida_id: string;
  curva: number[];
};

export type MotivoObsoletaApi = { codigo: MotivoObsoleta; detalle: string };
export type ObsoletaApi = { motivos: MotivoObsoletaApi[] };

export type PropuestaApi = {
  corrida_id: string;
  recomendada: ModeloCurva | null;
  motivo_recomendacion: MotivoRecomendacion | null;
  origen: "propia" | "prestada" | null;
  eat: number | null;
  /** Curva de la recomendada (para la mini curva); `null` si no hay. */
  curva: number[] | null;
  estabilidad: number | null;
  nivel_estabilidad: "alta" | "media" | "baja" | null;
  /** Hay vigente y la propuesta difiere de ella (`difiereDeVigente`). */
  difiere_de_vigente: boolean;
  /** EAT entre la propuesta y la vigente (puntos); `null` sin vigente o sin propuesta. */
  eat_vs_vigente: number | null;
  veredicto_forma: VeredictoForma | null;
  /** Para la columna Años de la tabla. */
  anios: { anio: number; clase: ClaseAnioCurva; tratamiento: TratamientoAnio | null; escaso: boolean; en_ajuste: boolean; meses_atipicos: number }[];
  /** Para la columna Niño: ratios de volumen por año y el veredicto de forma con sus tres cifras. */
  nino: {
    volumen: { anio: number; ratio_volumen: number | null }[];
    forma: { veredicto: VeredictoForma; diferencia_anio: number | null; ruido_normal: number | null; umbral_efectivo: number } | null;
  };
  avisos: AvisoCurva[];
};

export type AgrupacionCurvasApi = {
  id: string;
  nombre: string;
  codigo: string;
  activo: boolean;
  temporada: TemporadaAgrupacion;
  /** Solo `invierno` o `verano` (las líneas informan); `null` en cualquier otro caso. */
  temporada_sugerida: TemporadaAgrupacion | null;
  generos: string[];
  equivalencias_activas: number;
  /** Tiene venta en la corrida que se está viendo (`false` sin corrida). */
  con_venta: boolean;
  vigente: VigenteResumenApi | null;
  obsoleta: ObsoletaApi | null;
  propuesta: PropuestaApi | null;
};

export type ResumenEstadoCurvas = {
  agrupaciones_activas: number;
  por_temporada: Record<TemporadaAgrupacion, number>;
  /** Agrupaciones activas que siguen en `todo_el_ano` (hay que revisarlas). */
  sin_revisar_toda_temporada: number;
  con_curva_vigente: number;
  sin_curva_con_venta: number;
  sin_venta: number;
  vigentes_prestadas: number;
  obsoletas: number;
  propuestas_distintas: number;
  inactivas_con_curva: number;
  /** Del resumen de la corrida ("agregado refrescado el …"), no de la MV. */
  unidades_sin_agrupacion: number;
  forma: { forma_estable: number; forma_cambia: number; sin_comparacion: number };
};

/** `GET /api/curvas` (`?corrida_id=`; por defecto la de referencia y, sin referencia, la última). */
export type EstadoCurvasApi = {
  datos: { desde: string | null; hasta: string | null; meses_publicados: number; faltantes: string[]; ultimo_mes_cerrado: string };
  corrida: CorridaResumenApi | null;
  /** Las últimas 20, para el selector. */
  corridas: {
    id: string;
    created_at: string;
    hasta_periodo: string;
    referencia: boolean;
    usuario_nombre: string | null;
    resumen: Pick<ResumenCorrida, "propias" | "prestadas" | "sin_venta">;
  }[];
  agrupaciones: AgrupacionCurvasApi[];
  periodos_atipicos: PeriodoAtipicoApi[];
  resumen: ResumenEstadoCurvas;
};

// ─── Detalle de una agrupación en una corrida ───

export type ComparadorApi = {
  /** Modelo de la propuesta comparada (por defecto la recomendada; `?modelo=` elige otro). */
  modelo: ModeloCurva;
  propuesta: number[];
  vigente: number[];
  /** EAT entre ambas, en puntos. */
  eat_vs_vigente: number;
  /** `propuesta − vigente` por mes, en puntos porcentuales (12). */
  diferencia_por_mes: number[];
  /** Mes (1 a 12) con la mayor diferencia absoluta. */
  mes_mayor_cambio: number;
  difiere: boolean;
};

/** `GET /api/curvas/corridas/[id]/agrupaciones/[agrupacionId]`: tal como lo guardó la corrida; no lee la MV. */
export type DetalleAgrupacionApi = {
  corrida: CorridaResumenApi;
  agrupacion: {
    id: string;
    nombre: string;
    codigo: string;
    activo: boolean;
    temporada: TemporadaAgrupacion;
    temporada_sugerida: TemporadaAgrupacion | null;
    generos: string[];
    equivalencias_activas: number;
  };
  resultado: AgrupacionResultado;
  /** La `T` de su temporada (la curva y los años de la serie agregada). */
  temporada_curva: TemporadaResultado | null;
  /** Red comparable de la corrida (pesos sobre la venta total); los pesos de la agrupación están en `resultado.anios[].por_tienda`. */
  red: RedAnioApi[];
  tiendas: TiendaIdentidad[];
  vigente: VigenteResumenApi | null;
  obsoleta: ObsoletaApi | null;
  comparador: ComparadorApi | null;
};

// ─── Años Niño ───

export type AniosAtipicosNinoApi = {
  corrida: CorridaResumenApi | null;
  efecto: EfectoAtipicoCorrida | null;
  periodos: PeriodoAtipicoApi[];
  anios: { anio: number; clase_por_temporada: Record<TemporadaAgrupacion, ClaseAnioCurva>; completo: boolean }[];
  agrupaciones: { id: string; nombre: string; temporada: TemporadaAgrupacion; efecto_atipico: EfectoAtipicoAgrupacion; avisos: AvisoCurva[] }[];
  temporadas: TemporadaResultado[];
};

// ─── Elegir, aprobar y retirar (una por una) ───

export type ElegirCurvaCuerpo = { corrida_id: string; modelo: ModeloCurva; nota?: string };

export type CurvaAprobadaApi = {
  id: string;
  agrupacion_id: string;
  version: number;
  estado: "vigente" | "reemplazada" | "retirada";
  corrida_id: string;
  modelo: ModeloCurva;
  origen: "propia" | "prestada";
  recomendada: boolean;
  eat: number | null;
  error_max: number | null;
  medida: MedidaCurva;
  curva: number[];
  nota: string | null;
  aprobada_at: string;
  usuario_nombre: string | null;
};

/** `PUT /api/curvas/agrupaciones/[id]` → `201`. */
export type ElegirCurvaRespuesta = { curva: CurvaAprobadaApi };
/** `DELETE /api/curvas/agrupaciones/[id]`. */
export type RetirarCurvaRespuesta = { id: string; estado: "retirada" };
export type MarcarReferenciaCuerpo = { referencia: true };

/** Huellas con las que se calculó una curva (M7 las guarda junto al `id`). */
export type HuellasCurva = { composicion: string; red_huella: string; cargas_huella: string };

/** Fila de `GET /api/curvas/vigentes`: lo que M7 leerá y el CSV (solo agrupaciones activas). */
export type CurvaVigenteApi = {
  agrupacion_id: string;
  codigo: string;
  nombre: string;
  curva_id: string;
  version: number;
  modelo: ModeloCurva;
  origen: "propia" | "prestada";
  medida: MedidaCurva;
  /** Doce participaciones (suman 1). */
  curva: number[];
  /** Curva acumulada (`C_12 = 1`): lo que M7 usará para el "avance de la estacionalidad". */
  acumulada: number[];
  huellas: HuellasCurva;
  corrida_id: string;
  aprobada_at: string;
};
