/**
 * Contrato de la API de M6 para el frontend (docs/modulos/06-curvas-estacionalidad.md
 * y docs/modulos/06b-curvas-trabajo-por-agrupacion.md, "Contratos de API"): paso 1
 * (temporada de la agrupación, periodos atípicos y la lectura de años atípicos que
 * M7 consumirá) y paso 2 (curvas, red comparable, efecto del Niño, aprobar/retirar),
 * que desde la 0.9.7 trabaja UNA agrupación a la vez (06b): se calcula a demanda
 * (`POST /api/curvas/agrupaciones/[id]/calcular`, nunca escribe) y solo se guarda
 * la foto de cada aprobación (`PUT /api/curvas/agrupaciones/[id]`). Describe el
 * JSON que viaja, no las filas de la base.
 *
 * CONTRATO CON M7: M7 lee `periodos[].temporadas` (y `claseDeAnio`, `/anios`,
 * `efecto_atipico.por_temporada[]` calculado a demanda con `?con_volumen=1`);
 * `alcance` es un espejo heredado del paso 1 y NO debe usarse.
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
   * Ratio de volumen de la TEMPORADA de la agrupación (o la pedida), calculado a
   * demanda con `?con_volumen=1` (sin corrida de referencia, 06b); `null` sin
   * `con_volumen` o sin comparación.
   */
  ratio_volumen: number | null;
  /** Detalle del factor (nivel temporada); `null` sin `con_volumen` o si el año no es atípico. */
  volumen: VolumenAnioApi | null;
};

/** Factor de volumen de un año atípico, a nivel de temporada (I3), calculado a demanda (06b). */
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
  /** Siempre `null` desde la 0.9.7: ya no hay corrida de referencia. */
  corrida_id: null;
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
 * opcional, `?desde=2023&hasta=2026` (años) y `?con_volumen=1`.
 *
 * Sin `con_volumen` es barato (no lee venta): `ratio_volumen` y `volumen` son
 * `null`. Con `con_volumen=1` calcula a demanda con UNA lectura de
 * `venta_estacionalidad_agrupacion` y los parámetros POR DEFECTO (avisa en
 * `avisos`); con `?agrupacion_id=` la lectura incluye la agrupación y suma su
 * `ratio_agrupacion`.
 */
export type AniosAtipicosRespuesta = {
  criterio: CriterioAnios;
  /** Siempre `null` desde la 0.9.7 (sin corrida de referencia). Se conserva para no romper a M7. */
  corrida_id: null;
  /** Con `con_volumen=1`: huella de las cargas publicadas con las que se calculó el volumen; si no, `null`. */
  huella_cargas: string | null;
  /** Con `con_volumen=1`: instante del cálculo (ISO); si no, `null`. */
  calculado_at: string | null;
  /** Con `con_volumen=1`: `parametros_por_defecto` (el volumen se midió con los valores por defecto). */
  avisos: AvisoAnios[];
  anios: AnioAtipicidadApi[];
  resumen: ResumenAnios;
};

export type AvisoAnios = { codigo: "parametros_por_defecto"; detalle: string };

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

/**
 * Por qué un año quedó `descartado`: lo excluyó el planner (`excluido_manual`,
 * parámetro `anios_excluidos`), lo pidió el parámetro `tratamiento_atipicos`
 * (`parametro`), su forma se aparta más que el ruido (`forma_cambia`, modo `auto`)
 * o no había con qué compararlo o imputarlo (`sin_referencia`).
 */
export const MOTIVOS_TRATAMIENTO = ["excluido_manual", "parametro", "forma_cambia", "sin_referencia"] as const;
export type MotivoTratamiento = (typeof MOTIVOS_TRATAMIENTO)[number];

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
  "excluida_manual",
] as const;
export type MotivoRed = (typeof MOTIVOS_RED)[number];
/** Los motivos que SACAN a la tienda de la red del año; los demás son avisos y la tienda entra. */
export const MOTIVOS_EXCLUSION_RED: readonly MotivoRed[] = [
  "centro_distribucion",
  "tienda_desactivada",
  "no_abierta_todo_el_ano",
  "tienda_nueva",
  "meses_sin_venta",
  "excluida_manual",
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
  excluida_manual: "Excluida a mano",
};

export const MOTIVOS_OBSOLETA = [
  "tienda_entra_red",
  "tienda_sale_red",
  "composicion_cambiada",
  "carga_nueva",
  "periodo_cambiado",
  "temporada_cambiada",
  /** Solo para una curva PRESTADA (`T`): cambió la composición o la temporada de otra agrupación de su temporada (o de toda temporada). */
  "temporada_recompuesta",
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
  "anio_excluido",
] as const;
export type CodigoAviso = (typeof CODIGOS_AVISO)[number];

/** Aviso con texto de pantalla en castellano llano en `detalle`. */
export type AvisoCurva = { codigo: CodigoAviso; detalle: string };

/** Medida de las curvas en esta entrega: siempre `unidades`. */
export type MedidaCurva = "unidades";

// ─── Parámetros ───

/**
 * Parámetros del cálculo de UNA agrupación (los que guarda
 * `corridas_estacionalidad.parametros`, la foto de la aprobación). `hasta_periodo`
 * NO va aquí: nunca se hereda de una aprobación a la siguiente (arranca en el
 * defecto: último mes publicado y cerrado) y se guarda en la columna de la foto.
 */
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
  /** Años que el planner saca del ajuste de ESTA agrupación (`descartado` con motivo `excluido_manual`; siguen contando para el volumen). */
  anios_excluidos: number[];
  /** Tiendas que el planner saca de la red de ESTA agrupación (motivo `excluida_manual`, en todos los años). */
  tiendas_excluidas: string[];
  /** "Confirmo que esta temporada no tiene años atípicos": levanta `periodos_temporada_faltantes`. */
  sin_periodos_confirmado: boolean;
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
  anios_excluidos: [],
  tiendas_excluidas: [],
  sin_periodos_confirmado: false,
};

/**
 * Cuerpo de `POST /api/curvas/agrupaciones/[id]/calcular` (lectura con cuerpo: NUNCA
 * escribe). Todo es opcional (valen los defectos).
 */
export type CalcularAgrupacionCuerpo = Partial<ParametrosCurvas> & {
  /** `aaaa-mm`; por defecto el último mes publicado y cerrado en Lima. Nunca se hereda. */
  hasta_periodo?: string;
  /**
   * Punto de partida al abrir la agrupación: con `true` el servidor usa los
   * parámetros de la última aprobación (los de su foto) e IGNORA los demás
   * parámetros del cuerpo (no `hasta_periodo`). Sin aprobación, los defectos. La
   * respuesta trae los parámetros efectivos en `parametros`.
   */
  partir_de_vigente?: boolean;
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
  /** Solo con `tratamiento = 'descartado'`; `null` en cualquier otro caso. */
  tratamiento_motivo: MotivoTratamiento | null;
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
  /** Número de pruebas (pliegues) del backtesting; `0` si no hay EAT. Es lo mismo que `pliegues`. */
  pruebas: number;
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
  /** Ruido entre años normales de la agrupación con el que se calculó el margen; `null` si no es medible. */
  ruido_normal: number | null;
  /** `margen_ruido` del cálculo: el margen es `max(0.05, margen_ruido × ruido_normal)`. */
  margen_ruido: number;
  /** Frase lista para pantalla, con el formato numérico es-PE de la pantalla ("B se equivoca 27.4 pp frente a 29.1 de A en 2 pruebas; …"). */
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
  /**
   * Ruido entre años normales de la agrupación (EAT entre los años `normal`
   * completos y no escasos; promedio de pares con tres o más), calculado SIEMPRE
   * que haya dos, tenga o no periodo atípico. `null` ("no medible") con menos de
   * dos años normales. Es el mismo valor de `efecto_atipico.forma.ruido_normal`.
   */
  ruido_normal: number | null;
  /** Los pares que dan `ruido_normal` (vacío si es `null`). */
  ruido_normal_detalle: { anios: [number, number]; eat: number }[];
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

// ═══════════════════════════════════════════════════════════════════════════
// 06b · Trabajo por agrupación (0.9.7)
// ═══════════════════════════════════════════════════════════════════════════
//
// Flujo: lista (`GET /api/curvas`) → abrir una agrupación
// (`POST /api/curvas/agrupaciones/[id]/calcular`, lectura con cuerpo, NUNCA escribe)
// → ajustar parámetros (se vuelve a pedir `calcular`) → aprobar UNA curva
// (`PUT /api/curvas/agrupaciones/[id]`, guarda la foto y la versión).
//
// Errores de negocio de M6: `{ error, codigo }` con estos códigos (el `error` es
// castellano llano, para mostrarlo tal cual):
//   400  zod (sin código) · 401 · 403 · 404 (agrupación o foto inexistente, o id no UUID)
//   409  `agrupacion_inactiva`, `prerrequisitos`, `datos_cambiados`,
//        `vigente_cambiada`, `sin_curva_posible`, `candidata_no_disponible`,
//        `sin_cambio`, `nota_requerida`, `sin_datos`, `hasta_periodo_sin_cargar`.
//
// Orden de los 409 de `PUT /api/curvas/agrupaciones/[id]` (el primero que aplica gana):
//   `agrupacion_inactiva` · `hasta_periodo_sin_cargar` · `prerrequisitos` · `sin_curva_posible` ·
//   `candidata_no_disponible` · `datos_cambiados` · `vigente_cambiada` · `sin_cambio` · `nota_requerida`;
//   y, al guardar, `vigente_cambiada` otra vez si alguien movió la vigente entre la lectura y el cambio de estado.

export const CODIGOS_ERROR_CURVAS = [
  "agrupacion_inactiva",
  "prerrequisitos",
  "datos_cambiados",
  "vigente_cambiada",
  "sin_curva_posible",
  "candidata_no_disponible",
  "sin_cambio",
  "nota_requerida",
  "sin_datos",
  "hasta_periodo_sin_cargar",
] as const;
export type CodigoErrorCurvas = (typeof CODIGOS_ERROR_CURVAS)[number];

// ─── Foto de aprobación (fila de `corridas_estacionalidad` con agrupación) ───

/**
 * `corridas_estacionalidad.resumen` de una foto. Todo menos `cargas` y `red_huella`
 * es opcional porque la corrida global heredada de la 0.9.6 no lo traía.
 */
export type ResumenFoto = {
  /** `{ "aaaa-mm": carga_id }` de los meses ≤ `hasta_periodo` usados. */
  cargas: Record<string, string>;
  /** md5 de `cargas`. */
  cargas_huella?: string;
  /** Huella del maestro de tiendas (obsolescencia por red). */
  red_huella: string;
  composicion_huella?: string;
  /** Temporada de la agrupación al aprobar. */
  temporada?: TemporadaAgrupacion;
  /** Los tríos `(id, temporada, huella de composición)` con los que se calculó `huella_temporada` (para nombrar la agrupación que cambió). */
  agrupaciones_temporada?: { id: string; temporada: TemporadaAgrupacion; huella: string }[];
  huella_calculo?: string;
  /**
   * md5 de las agrupaciones activas de la temporada y de toda temporada (id,
   * temporada, composición): de ellas sale la curva prestada `T` y el control del Niño.
   */
  huella_temporada?: string;
  hasta_periodo?: string;
  /** El `hasta_periodo` era el defecto (último publicado y cerrado) al aprobar. */
  hasta_fue_por_defecto?: boolean;
  /** Meses `aaaa-mm` atípicos que aplicaban a su temporada, ordenados. */
  atipicos?: string[];
  ruido_normal?: number | null;
  version_modelo?: number;
  sin_periodos_confirmado?: boolean;
  meses_publicados?: { desde: string; hasta: string; faltantes: string[] };
  duracion_ms?: number;
};

export type FotoResumenApi = {
  id: string;
  created_at: string;
  /** `aaaa-mm`. */
  hasta_periodo: string;
  parametros: ParametrosCurvas;
  resumen: ResumenFoto;
  usuario_nombre: string | null;
};

// ─── Curvas vigentes, obsolescencia y estado ───

/** La curva vigente de una agrupación tal como la ven la lista y la vista de trabajo. */
export type VigenteResumenApi = {
  id: string;
  version: number;
  modelo: ModeloCurva;
  origen: "propia" | "prestada";
  recomendada: boolean;
  /** La candidata que el sistema recomendaba al aprobar; `null` en curvas de la 0.9.6. */
  recomendada_entonces: ModeloCurva | null;
  eat: number | null;
  /** Ruido entre años normales al aprobar (el de `resumen.ruido_normal` de la foto), siempre junto al EAT; `null` = no medible o curva de la 0.9.6. */
  ruido_normal: number | null;
  aprobada_at: string;
  usuario_nombre: string | null;
  /** La foto de la aprobación (fila de `corridas_estacionalidad`): "Ver foto". */
  foto_id: string;
  /** `aaaa-mm`; `null` en curvas de la 0.9.6 sin el dato. */
  hasta_periodo: string | null;
  hasta_fue_por_defecto: boolean | null;
  nota: string | null;
  curva: number[];
  /** Parámetros con los que se aprobó (punto de partida al reabrir; no incluyen `hasta_periodo`); `null` en curvas de la 0.9.6. */
  parametros: ParametrosCurvas | null;
  huella_calculo: string | null;
  /** Versión de las fórmulas con las que se calculó la foto; `null` en curvas de la 0.9.6. */
  version_modelo: number | null;
  /** Años que entraron en el ajuste al aprobar; `null` en curvas de la 0.9.6. */
  anios_ajuste: number[] | null;
};

export type MotivoObsoletaApi = { codigo: MotivoObsoleta; detalle: string };
export type ObsoletaApi = { motivos: MotivoObsoletaApi[] };

export const CODIGOS_AVISO_VIGENTE = ["datos_posteriores", "modelo_anterior", "temporada_recompuesta"] as const;
/**
 * Avisos de una curva vigente que NO la vuelven obsoleta: `datos_posteriores`
 * ("hay 1 mes publicado después de 2026-08; la curva sigue al día hasta ese mes"),
 * `modelo_anterior` (la foto se calculó con una `VERSION_MODELO` menor: hoy el
 * sistema puede proponer otra cosa) y `temporada_recompuesta` (cambió otra
 * agrupación de su temporada; solo avisa si la curva es propia, si es prestada `T`
 * es un motivo de obsolescencia).
 */
export type AvisoVigenteApi = { codigo: (typeof CODIGOS_AVISO_VIGENTE)[number]; detalle: string };

export const ESTADOS_AGRUPACION = ["sin_curva", "al_dia", "al_dia_distinta", "obsoleta", "inactiva_con_curva"] as const;
/**
 * Estado de una agrupación en la lista (sin corrida): `sin_curva`; `al_dia` (vigente,
 * sin motivos y se aprobó la recomendada); `al_dia_distinta` (vigente, sin motivos,
 * pero se aprobó una candidata distinta de la recomendada); `obsoleta` (con motivo);
 * `inactiva_con_curva` (gana a los demás).
 */
export type EstadoAgrupacion = (typeof ESTADOS_AGRUPACION)[number];

// ─── Prerrequisitos ───

/** Los que bloquean el cálculo / la aprobación y los que solo avisan. */
export const CODIGOS_PRERREQUISITO_BLOQUEA = [
  "sin_meses_publicados",
  "sin_anio_completo",
  "periodos_temporada_faltantes",
  "tienda_sin_apertura",
  "sin_venta",
  "composicion_vacia",
] as const;
export const CODIGOS_PRERREQUISITO_AVISA = [
  "temporada_sin_confirmar",
  "meses_sin_cargar",
  "periodo_fuera_de_datos",
  "apertura_dudosa",
  "cierre_dudoso",
  /** Con `sin_periodos_confirmado = true`: `periodos_temporada_faltantes` baja a aviso con este mismo código. */
  "periodos_temporada_faltantes",
] as const;
export type CodigoPrerrequisito = (typeof CODIGOS_PRERREQUISITO_BLOQUEA)[number] | (typeof CODIGOS_PRERREQUISITO_AVISA)[number];

/** Pantalla donde se arregla (la tarjeta "Antes de calcular" enlaza a ella). */
export type PantallaArreglo = "venta_stock" | "periodos" | "tiendas" | "agrupaciones";

export type Prerrequisito = {
  codigo: CodigoPrerrequisito;
  nivel: "bloquea" | "avisa";
  /** Castellano llano, para mostrarlo tal cual. */
  detalle: string;
  /** `id` de la fila a la que ir (por ejemplo la tienda); sin él, la pantalla entera. */
  enlace: { pantalla: PantallaArreglo; id?: string } | null;
};

/** `bloquea` y `avisa` en orden estable. Con `bloquea` no vacío no hay cálculo (`calculo: null`) ni aprobación. */
export type PrerrequisitosApi = { bloquea: Prerrequisito[]; avisa: Prerrequisito[] };

// ─── Lista: `GET /api/curvas` ───

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
  /** Periodos activos que aplican a su temporada. */
  periodos_aplicables: number;
  vigente: VigenteResumenApi | null;
  obsoleta: ObsoletaApi | null;
  /** `datos_posteriores` y `temporada_recompuesta` (si la curva es propia): avisan, no obsoletan. */
  avisos_vigente: AvisoVigenteApi[];
  estado: EstadoAgrupacion;
  /** Prerrequisitos que bloquean y se evalúan SIN calcular: `periodos_temporada_faltantes`, `composicion_vacia`, `tienda_sin_apertura`. */
  bloqueada_por: CodigoPrerrequisito[];
  /** Versiones guardadas (vigente, reemplazadas y retiradas). */
  versiones: number;
};

export type ResumenEstadoCurvas = {
  agrupaciones_activas: number;
  por_temporada: Record<TemporadaAgrupacion, number>;
  /** Agrupaciones activas que siguen en `todo_el_ano` (hay que revisarlas). */
  sin_revisar_toda_temporada: number;
  /** `al_dia + al_dia_distintas + obsoletas` (solo activas). */
  con_curva_vigente: number;
  al_dia: number;
  al_dia_distintas: number;
  obsoletas: number;
  /** Activas sin curva vigente: `sin_curva = bloqueadas_sin_curva + calculables_sin_curva`. */
  sin_curva: number;
  /** Activas (con o sin curva) con algún prerrequisito bloqueante evaluable sin calcular. */
  bloqueadas: number;
  /** De las `sin_curva`, las que tienen algún `bloqueada_por`. */
  bloqueadas_sin_curva: number;
  calculables_sin_curva: number;
  /** Activas con curva vigente prestada (`T`). */
  vigentes_prestadas: number;
  inactivas_con_curva: number;
  /** Equivalencias activas sin agrupación (faltantes de M3). */
  equivalencias_sin_agrupacion: number;
};

/**
 * `GET /api/curvas` (`requirePlanner`). La lista NUNCA calcula ni llama a
 * `venta_estacionalidad_agrupacion`: estado, obsolescencia y prerrequisitos salen de
 * las fotos de las vigentes, el maestro de tiendas, los periodos y la venta por tienda.
 */
export type EstadoCurvasApi = {
  datos: { desde: string | null; hasta: string | null; meses_publicados: number; faltantes: string[]; ultimo_mes_cerrado: string };
  /** Prerrequisitos que no dependen de la agrupación (meses, periodos por temporada, tiendas sin apertura). */
  prerrequisitos_globales: Prerrequisito[];
  agrupaciones: AgrupacionCurvasApi[];
  periodos_atipicos: PeriodoAtipicoApi[];
  resumen: ResumenEstadoCurvas;
};

// ─── Vista de trabajo: `POST /api/curvas/agrupaciones/[id]/calcular` ───

export type AgrupacionTrabajoApi = {
  id: string;
  nombre: string;
  codigo: string;
  activo: boolean;
  temporada: TemporadaAgrupacion;
  temporada_sugerida: TemporadaAgrupacion | null;
  generos: string[];
  equivalencias_activas: number;
};

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
  /**
   * `true` si el conjunto de años de ajuste de la propuesta coincide con `anios_ajuste` de
   * la vigente (la EAT entre ambas es comparable); `false` si no (la pantalla avisa: "EAT
   * no comparable con el cálculo anterior"); `null` sin comparación posible (vigente de la 0.9.6).
   */
  comparable_con_vigente: boolean | null;
};

/** Lo que se calculó (solo si ningún prerrequisito bloquea). Todo sale del cálculo a demanda; nada se guarda. */
export type CalculoAgrupacionApi = {
  /** `ruido_normal` y `ruido_normal_detalle` a nivel de agrupación; `anios[].participacion_real ?? participacion` para dibujar todos los años. */
  resultado: AgrupacionResultado;
  /** La `T` de su temporada (la curva y las series agregadas); `null` si la temporada no tiene serie. */
  temporada_curva: TemporadaResultado | null;
  /** Efecto del Niño (volumen) de su temporada y de `todo_el_ano` (control). */
  efecto_temporada: EfectoTemporadaAnio[];
  /** Red comparable de cada año (pesos sobre la venta total); los pesos de la agrupación están en `resultado.anios[].por_tienda`. */
  red: RedAnioApi[];
  tiendas: TiendaIdentidad[];
  duracion_ms: number;
};

export type DatosTrabajoApi = {
  desde: string | null;
  hasta: string | null;
  meses_publicados: number;
  faltantes: string[];
  /** El `hasta_periodo` efectivo del cálculo (`aaaa-mm`); `null` si no hay meses publicados y cerrados. Es el que `PUT` exige. Nunca se hereda de la vigente. */
  hasta_periodo: string | null;
  /** `hasta_periodo` es el último mes publicado y cerrado en Lima (el defecto). */
  hasta_fue_por_defecto: boolean;
  ultimo_mes_cerrado: string;
  /** Meses publicados DESPUÉS de `hasta_periodo` (no entran en el cálculo). */
  meses_posteriores: string[];
  /** md5 de las cargas ≤ `hasta_periodo` con las que se calculó. */
  cargas_huella: string;
};

export type TrabajoAgrupacionApi = {
  agrupacion: AgrupacionTrabajoApi;
  datos: DatosTrabajoApi;
  /** Parámetros efectivos (defectos aplicados; con `partir_de_vigente`, los de la última aprobación). */
  parametros: ParametrosCurvas;
  prerrequisitos: PrerrequisitosApi;
  /** md5 de la entrada del cálculo; `PUT` lo devuelve para rechazar con `datos_cambiados` si cambió. Viene también con `calculo: null`. */
  huella_calculo: string;
  /** md5 de las agrupaciones activas de su temporada y de toda temporada (de ellas salen `T` y el control del Niño). */
  huella_temporada: string;
  /** `VERSION_MODELO` del servidor que calculó. */
  version_modelo: number;
  /** `null` si algún prerrequisito bloquea. */
  calculo: CalculoAgrupacionApi | null;
  vigente: VigenteResumenApi | null;
  obsoleta: ObsoletaApi | null;
  avisos_vigente: AvisoVigenteApi[];
  /** La candidata pedida (`?modelo=`) o la recomendada frente a la vigente; `null` sin vigente o sin candidata. */
  comparador: ComparadorApi | null;
  versiones: number;
};

// ─── Aprobar y retirar ───

export type CurvaAprobadaApi = {
  id: string;
  agrupacion_id: string;
  version: number;
  estado: "vigente" | "reemplazada" | "retirada";
  /** La foto de la aprobación (`corridas_estacionalidad.id`). */
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

/** Cuerpo de `PUT /api/curvas/agrupaciones/[id]`. */
export type AprobarCurvaCuerpo = {
  modelo: ModeloCurva;
  /** Los que vio el planner; `hasta_periodo` es OBLIGATORIO (el que devolvió `calcular`: nunca se hereda ni se infiere). */
  parametros: ParametrosCurvas & { hasta_periodo: string };
  /** La `huella_calculo` que devolvió `calcular` con esos parámetros. */
  huella_calculo: string;
  /** Versión de la vigente que vio el planner (`null` si no había): si ya cambió, `409 vigente_cambiada`. */
  version_vigente: number | null;
  /**
   * Obligatoria (`409 nota_requerida`) si `modelo` no es la recomendada, o hay
   * `anios_excluidos` / `tiendas_excluidas`, o `tratamiento_atipicos` no es `auto`.
   */
  nota?: string;
};

/** `PUT /api/curvas/agrupaciones/[id]` → `201`. */
export type AprobarCurvaRespuesta = { curva: CurvaAprobadaApi; foto_id: string };
/** `DELETE /api/curvas/agrupaciones/[id]`. */
export type RetirarCurvaRespuesta = { id: string; estado: "retirada" };

// ─── Versiones: `GET /api/curvas/agrupaciones/[id]/versiones` ───

export type VersionAgrupacionApi = {
  id: string;
  version: number;
  estado: "vigente" | "reemplazada" | "retirada";
  modelo: ModeloCurva;
  origen: "propia" | "prestada";
  recomendada: boolean;
  recomendada_entonces: ModeloCurva | null;
  eat: number | null;
  /** Ruido entre años normales de la foto de esa versión (junto al EAT); `null` = no medible o curva de la 0.9.6. */
  ruido_normal: number | null;
  curva: number[];
  nota: string | null;
  aprobada_at: string;
  usuario_nombre: string | null;
  /** La foto de esa versión ("Ver foto"). */
  foto_id: string;
  /** Solo los parámetros distintos del valor por defecto (texto de pantalla: "años excluidos: 2023"). */
  parametros_resumen: string[];
};

export type VersionesAgrupacionApi = { versiones: VersionAgrupacionApi[] };

// ─── "Ver foto": `GET /api/curvas/corridas/[id]/agrupaciones/[agrupacionId]` ───

/**
 * El detalle CONGELADO de una foto de aprobación (`?modelo=A..E|T` elige la candidata
 * dibujada; por defecto la recomendada de entonces). El comparador la confronta con
 * la curva que se aprobó con ESA foto y no hay obsolescencia (es historia). `404` si
 * la foto no es de esa agrupación.
 */
export type DetalleFotoApi = {
  foto: FotoResumenApi;
  agrupacion: AgrupacionTrabajoApi;
  resultado: AgrupacionResultado;
  temporada_curva: TemporadaResultado | null;
  red: RedAnioApi[];
  tiendas: TiendaIdentidad[];
  /** La versión de curva aprobada con esta foto; `null` si la foto quedó sin curva (fallo al guardar). */
  curva_de_la_foto: VigenteResumenApi | null;
  comparador: ComparadorApi | null;
};

// ─── Años Niño a demanda: `GET /api/curvas/anios-atipicos` ───

export type AniosAtipicosNinoApi = {
  /** Instante del cálculo (ISO). El cálculo es a demanda y no se guarda. */
  calculado_at: string;
  /** Huella de las cargas publicadas con las que se calculó. */
  huella_cargas: string;
  /** Parámetros por defecto con los que se midió. */
  parametros: ParametrosCurvas;
  datos: { desde: string | null; hasta_periodo: string | null; meses_publicados: number };
  /** `por_temporada` (volumen con control y relativo), `crecimiento_normal`, `avisos`; `forma` va vacía (requiere abrir cada agrupación). */
  efecto: EfectoAtipicoCorrida;
  periodos: PeriodoAtipicoApi[];
  anios: { anio: number; clase_por_temporada: Record<TemporadaAgrupacion, ClaseAnioCurva>; completo: boolean }[];
  /** Series agregadas por temporada (años, clases, tratamiento y `curva_T`). */
  temporadas: TemporadaResultado[];
  /** Agrupaciones activas por temporada (para "Ver" → Trabajar). */
  agrupaciones: { id: string; nombre: string; temporada: TemporadaAgrupacion }[];
};

// ─── Curvas vigentes para M7 (sin cambios) ───

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
  /** La foto de la aprobación. */
  corrida_id: string;
  aprobada_at: string;
};
