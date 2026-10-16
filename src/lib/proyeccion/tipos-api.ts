/**
 * Contratos de M7 (docs/modulos/07-proyeccion-anual.md, sección 7). Autocontenido:
 * describe el JSON que viaja y las constantes del método; lo usan igual el
 * servidor y la pantalla. Sin imports de `@supabase/*`, de React ni de Next.
 */

// ─── Constantes del método ───

export const UMBRAL_AVANCE = 0.3;
export const UMBRAL_COBERTURA = 0.25;
export const UMBRAL_COLA_LARGA = 100;
/** Tope de un total anual (unidades): una cifra mayor no cabe en un `integer` de la base ni tiene sentido (mismo tope que una decisión). */
export const MAX_TOTAL = 100_000_000;
/**
 * `0.10.1`: una fila de cola larga con `dispon < UMBRAL_DISPONIBILIDAD` tuvo un quiebre relevante (proxy mensual: tienda-meses con
 * stock al cierre del mes ÷ tienda-meses totales; ficha 07, «Cambios 0.10.1», punto 2).
 */
export const UMBRAL_DISPONIBILIDAD = 0.75;
/** `0.10.1`: con `F < UMBRAL_APERTURA_TARDIA` la venta esperada cubre pocos meses del año de apertura (aviso `apertura_tardia`). */
export const UMBRAL_APERTURA_TARDIA = 0.25;
export const RAMPA_MADURACION: readonly number[] = [1, 1, 1];
export const RAMPA_MAX = 5;
export const MESES_MIN_AVANCE = 3;
export const MESES_UNIVERSO = 24;
export const MESES_COMPOSICION = 12;
export const ANIOS_HISTORICO = 3;
export const TANDA_GML = 60;
export const PARALELO = 3;
export const TANDA_UPSERT = 500;
export const CALCULO_CADUCA_MIN = 15;
export const RATIO_MIN = 0.05;
export const RATIO_MAX = 3;
/**
 * Entra en `resumen` para detectar fórmulas cambiadas (como `VERSION_MODELO` de M6). `2`: revisión del avance propio, el factor por
 * mes y el poco avance. `3` (`0.10.1`): venta esperada del año de apertura, cola larga con disponibilidad y participaciones con
 * periodo y eje por marca; una proyección en trabajo con `version_metodo < 3` queda desactualizada hasta recalcular.
 */
export const VERSION_METODO = 3;

// ─── Enumeraciones ───

export const ESTADOS_PROYECCION = ["en_trabajo", "cerrada", "archivada"] as const;
export type EstadoProyeccion = (typeof ESTADOS_PROYECCION)[number];
export type Bloque = "mismas" | "nuevas" | "cierres";
export type Subbloque = "nuevas_anterior" | "aperturas";
export type TemporadaFactor = "invierno" | "verano";

export type MotivoDesactualizada =
  | "cargas_nuevas"
  | "curvas_cambiadas"
  | "nivel_cambiado"
  | "tiendas_cambiadas"
  | "factores_cambiados"
  | "periodos_cambiados"
  | "recalculo_pendiente"
  /** `0.10.1`: la proyección se calculó con una versión anterior del método (`resumen.version_metodo < VERSION_METODO`). */
  | "version_metodo";

export type MotivoBloqueo = "sin_meses" | "meses_faltantes" | "tienda_sin_apertura_con_venta" | "sin_mismas_tiendas";

export type AvisoFila =
  | "sin_curva"
  | "curva_incompleta"
  | "curva_cambio"
  | "propuesta_cambio"
  | "avance_bajo"
  | "plan_anterior"
  | "sin_venta_anio"
  | "sin_base"
  | "sin_factor"
  | "objetivo_atipico"
  | "temporadas_mezcladas"
  | "mes_negativo"
  | "quiebre"
  | "cola_larga"
  | "nivel_cambiado"
  | "bloque_cambiado"
  | "sin_venta_esperada"
  | "sin_referente"
  | "referente_sin_historia"
  | "fijadas_exceden"
  | "cierre_no_proyectado"
  | "apertura_dudosa"
  | "cierre_dudoso"
  // 0.10.1 (el aviso por zona de la 0.10.0 se eliminó: decisión 20 de la ronda 4)
  /** Cola larga con quiebres relevantes y demanda corregida bajo el umbral: informativo, se cierra con la propuesta. */
  | "cola_larga_con_quiebres"
  /**
   * Cola larga con quiebres relevantes y demanda corregida `A_f` sobre el umbral: bloquea el cierre hasta decidirla. Su PROPUESTA es
   * `A_f` y el avance normal va en `referencia_alternativa` (decisión de Javier, ronda 4).
   */
  | "revision_cola_larga"
  /** Sin stock cargado en `W12` para la fila: no se pudo medir la disponibilidad (cola larga normal). */
  | "sin_stock_historico"
  /** Tienda cuya venta esperada cubre menos del 25 % de un año maduro (abre tarde o rampa muy baja): informativo. */
  | "apertura_tardia"
  /** Una cifra del método (unidades maduras, propuesta de una tienda nueva) no es finita o pasa de `MAX_TOTAL`: no se propone (queda sin cifra). */
  | "cifra_excesiva";

export type Metodo =
  | "avance"
  | "plan_anterior"
  | "crecimiento"
  | "apertura"
  | "avance_propio"
  | "maduro_propio"
  | "cierre"
  | "sin_propuesta";

export type OrigenDecision = "propuesta" | "manual" | "escalada";
export type OrigenMes = "real" | "proyectado";
export type ClaseAnioFila = "normal" | "atipico" | "en_curso";
export type EstadoLinea = "sin_proyectar" | "parcial" | "proyectada" | "curva_cambio" | "propuesta_cambio";

// ─── Tiendas y bloques ───

export type TiendaBloqueApi = {
  tienda_id: string;
  codigo: string;
  nombre: string;
  fecha_apertura: string | null;
  fecha_cierre: string | null;
  motivo: string;
  clave: string;
  subbloque?: Subbloque;
  venta_esperada?: number | null;
  referente_id?: string | null;
  rampa?: number[];
  zona?: string | null;
};

export type BloquesAnioApi = {
  mismas: TiendaBloqueApi[];
  nuevas: TiendaBloqueApi[];
  cierres: TiendaBloqueApi[];
  fuera: TiendaBloqueApi[];
};
export type BloquesApi = Record<number, BloquesAnioApi>;

/** Quién cambió qué parámetro y cuándo (auditoría de `PATCH`): se guarda en `parametros.ediciones` (jsonb), sin tabla nueva. */
export type EdicionParametros = {
  por: string | null;
  por_id: string | null;
  /** ISO. */
  en: string;
  cambios: { campo: string; de: number | number[]; a: number | number[] }[];
};
/** Cuántas ediciones de parámetros se conservan (las más recientes). */
export const MAX_EDICIONES_PARAMETROS = 50;

export type ParametrosProyeccion = {
  crecimiento_pct_defecto: number;
  umbral_avance: number;
  umbral_cobertura: number;
  umbral_cola_larga: number;
  /** `0.10.1`: por debajo de esta disponibilidad (0 a 1) una fila de cola larga tuvo un quiebre relevante. Por defecto `UMBRAL_DISPONIBILIDAD`. */
  umbral_disponibilidad: number;
  rampa_maduracion: number[];
  factores_usados: { anio: number; temporada: TemporadaFactor; ratio: number | null; origen: "calculado" | "manual" | null }[];
  bloques: BloquesApi;
  /** `0.10.3`: historial de quién editó parámetros (umbrales, crecimiento, rampa) y qué cambió; las más recientes al final. */
  ediciones?: EdicionParametros[];
  /** Cambiaste parámetros o «datos hasta» después de calcular: hay que recalcular (`PATCH` lo marca, `calcular` lo limpia). */
  recalculo_pendiente?: boolean;
};

// ─── Filas y años ───

export type VeredictoColaLarga = "cierra" | "cierra_con_quiebres" | "revision" | "sin_dato";

/**
 * Validación de disponibilidad de una fila de cola larga (`0.10.1`). `disponibilidad` y `demanda_corregida` son `null` cuando no se
 * pudieron medir (`sin_dato`) o la fila no tiene curva. La disponibilidad es un PROXY mensual: tienda-meses con stock al cierre del
 * mes ÷ tienda-meses totales (M5 no tiene días con stock).
 */
export type ColaLargaApi = {
  /**
   * `A_f`: venta anual corregida por disponibilidad y estacionalidad (unidades, un decimal). Con veredicto `revision` es la propuesta del
   * registro de `Y` (`propuesto`); con otro veredicto, solo informativa.
   */
  demanda_corregida: number | null;
  /** `dispon_f` de 0 a 1. */
  disponibilidad: number | null;
  tienda_meses_con_stock: number;
  tienda_meses: number;
  meses_cd_con_stock: number;
  veredicto: VeredictoColaLarga;
  /** `ritmo_f`: unidades por tienda-mes con stock (informativo). */
  ritmo: number | null;
  /** Meses de `W12` en que ninguna tienda tenía stock de la fila (informativo). */
  meses_tiendas_sin_stock: number;
};

export type AnioFilaApi = {
  anio: number;
  bloque: Bloque;
  subbloque: Subbloque | null;
  vendido: number;
  propuesto: number | null;
  metodo: Metodo;
  referencia_alternativa: number | null;
  referencia_tres_meses: number | null;
  explicacion: string;
  crecimiento_pct: number | null;
  decidido: number | null;
  origen: OrigenDecision | null;
  propuesta_al_decidir: number | null;
  vigente: number | null;
  nota: string | null;
  decidido_por_nombre: string | null;
  decidido_at: string | null;
  meses: number[] | null;
  meses_propuestos: number[] | null;
  origen_meses: OrigenMes[] | null;
  avance: number | null;
  avisos: AvisoFila[];
  /**
   * `0.10.1`, solo en el registro de `Y` de una fila base con propuesta bajo el umbral de cola larga y solo en las respuestas que
   * leen `historico` (`/lineas` y `/filas/[filaId]`); `null` (o ausente) en el resto. La fila de `Y+1` hereda el veredicto de `Y`
   * (lo dicen sus `avisos`).
   */
  cola_larga?: ColaLargaApi | null;
  /** Id del registro (`proyeccion_fila_anios.id`); lo pone la lectura, no el método. */
  id?: string;
};

export type FilaApi = {
  id: string;
  tienda_id: string | null;
  gml_id: string;
  equivalencia_id: string | null;
  agrupacion_marca_id: string;
  nivel: "GML" | "GMLE";
  genero: string;
  mundo: string;
  linea: string;
  equivalencia: string | null;
  agrupacion_marca: string;
  agrupacion_estacionalidad: { id: string; nombre: string; temporada: string } | null;
  historico_anual: { anio: number; unidades: number; clase: ClaseAnioFila; completo: boolean; tiendas: number }[];
  anios: AnioFilaApi[];
  avisos: AvisoFila[];
  activo: boolean;
};

export type MesHistorico = {
  periodo: string;
  unidades: number;
  venta_soles: number;
  stock_fin: number;
  cobertura: number | null;
  quiebre: boolean;
  atipico: boolean;
};

export type HistoricoAnio = {
  anio: number;
  clase: ClaseAnioFila;
  meses_atipicos: string[];
  total: number;
  total_normalizado: number;
  tiendas: string[];
  meses: MesHistorico[];
};

export type HistoricoFila = {
  anios: HistoricoAnio[];
  tendencia: number | null;
  prueba_anterior: {
    anio: number;
    propuesto: number;
    real: number;
    desvio_pct: number;
    dentro_de_muestra: true;
    eat_m6: number | null;
  } | null;
  pesos_equivalencias: { equivalencia_id: string; peso: number }[];
  /** `0.10.1`: la validación de disponibilidad (solo si la propuesta de `Y` quedó bajo el umbral de cola larga). */
  cola_larga?: ColaLargaApi | null;
  /** Real a `k` de las tiendas de `M(Y)` que salen de `M(Y+1)` (resta de la base del año siguiente; B2). */
  salientes: { tienda_id: string; vendido: number; meses: number[] }[];
};

export type CurvaOrigen = { agrupacion_id: string; curva_id: string; version: number; peso: number };

/**
 * Participaciones históricas de una fila base (decisión 24, `0.10.1`). `periodo_referencia` dice sobre qué doce meses y qué tiendas se
 * midieron (`W12` sobre `M(Y)`, normalizado por el Niño). Una cerrada calculada en `0.10.0` no trae `periodo_referencia` ni
 * `por_marca`: la lectura los entrega `null`.
 */
/**
 * `normalizado_nino` dice si las participaciones se midieron con las unidades llevadas a nivel normal por el factor del Niño. Hoy es
 * SIEMPRE `false`: `detalle_w12` (de `venta_proyeccion`) no trae el mes de cada hecho y sin él no se puede dividir por `φ_{año,mes}`;
 * las participaciones son sobre unidades reales de `W12`. (La ficha 07 daba `true`; para que lo sea hay que añadir `periodo` a
 * `detalle_w12` en SQL y normalizar en `participacionesFila`.) M8 debe leerlo, no suponerlo.
 */
export type PeriodoReferencia = { desde: string; hasta: string; meses: number; tiendas: "mismas"; anio: number; normalizado_nino: boolean };
export type Participaciones = {
  periodo_referencia: PeriodoReferencia | null;
  por_clave_flujo: { clave_flujo: string; marca_id: string | null; participacion: number }[];
  /** Toda unidad de marca (`marcas_unidad`) con venta en `W12`, tenga o no tratamiento en 02b; suma 1. */
  por_marca: { marca_id: string; participacion: number }[] | null;
  por_talla: { agrupacion_talla_id: string; participacion: number }[];
};

export type OrigenComposicion = "referente" | "red" | "propia";

export type TiendaProyeccionApi = {
  tienda_id: string;
  codigo: string;
  nombre: string;
  bloque: "nuevas" | "cierres";
  subbloque: Subbloque | null;
  anio: number;
  fecha_usada: string;
  venta_esperada: number | null;
  referente: { id: string; codigo: string; nombre: string } | null;
  origen_composicion: OrigenComposicion;
  unidades_maduras: number | null;
  rampa: number[];
  vendido: number;
  propuesto: number | null;
  metodo: Metodo;
  referencia_alternativa: number | null;
  referencia_tres_meses: number | null;
  decidido: number | null;
  origen: "propuesta" | "manual" | null;
  propuesta_al_decidir: number | null;
  vigente: number | null;
  explicacion: string;
  nota: string | null;
  pasa_a_mismas: boolean;
  filas: FilaApi[];
  avisos: AvisoFila[];
};

export type NodoMatrizApi = {
  nivel: "compania" | "genero" | "mundo" | "linea" | "agrupacion_marca";
  ids: { genero_id?: string; mundo_id?: string; linea_id?: string; agrupacion_marca_id?: string };
  nombre: string;
  en_curso: {
    venta_a_la_fecha: number;
    mismas: number;
    nuevas_anterior: number;
    aperturas: number;
    cierres: number;
    total: number;
    decididas: number;
    filas: number;
  };
  siguiente: {
    mismas: number;
    nuevas_anterior: number;
    aperturas: number;
    cierres: number;
    total: number;
    decididas: number;
    filas: number;
  };
  variacion_pct: number | null;
  estado: EstadoLinea;
  avisos: AvisoFila[];
};

export type FilaMensualApi = {
  ids: NodoMatrizApi["ids"];
  genero: string;
  mundo: string;
  linea: string;
  agrupacion_marca: string | null;
  bloque: Bloque | "todas";
  anios: { anio: number; total: number; meses: (number | null)[]; origen_meses: OrigenMes[]; sin_curva: number }[];
};

export type FactorApi = {
  anio: number;
  temporada: TemporadaFactor;
  ratio_calculado: number | null;
  ratio_aplicado: number | null;
  ratio_efectivo: number | null;
  origen: "calculado" | "manual" | null;
  parcial: boolean;
  tiendas_comunes: number | null;
  meses_comparados: number | null;
  calculado_at: string | null;
  nota: string | null;
  objetivo: boolean;
};

// ─── Proyección y prerrequisitos ───

export type Motivo = { codigo: string; mensaje: string; detalle?: string[] };

export type ResumenProyeccion = {
  filas: number;
  filas_por_anio: Record<number, number>;
  decididas: Record<number, number>;
  totales: Record<number, { mismas: number; nuevas_anterior: number; aperturas: number; cierres: number; total: number }>;
  avisos: Partial<Record<AvisoFila, number>>;
  huella_cargas: string;
  curvas_usadas: { agrupacion_id: string; curva_id: string; version: number }[];
  desvio_prueba_anterior_pct: number | null;
  perfiles_apertura: { tienda: string; ratios: number[] }[];
  fuera_bloque: number;
  /** `0.10.1`: filas base con algún año `revision_cola_larga` sin decidir (lo que bloquea el cierre por cola larga). */
  filas_para_revision?: number;
  version_metodo: number;
  duracion_ms: number | null;
  /**
   * Foto interna `gml_id → nivel proyectado` con que se calculó (para detectar `nivel_cambiado` sin leer las filas). La API no
   * la entrega: `aProyeccionApi` la quita.
   */
  niveles_gml?: Record<string, string>;
};

export type ProyeccionApi = {
  id: string;
  anio_en_curso: number;
  anio_siguiente: number;
  nombre: string;
  estado: EstadoProyeccion;
  hasta_periodo: string;
  parametros: ParametrosProyeccion;
  resumen: ResumenProyeccion | null;
  calculando: boolean;
  calculando_desde: string | null;
  calculado_at: string | null;
  cerrada_at: string | null;
  cerrada_por_nombre: string | null;
  nota: string | null;
  usuario_nombre: string | null;
  created_at: string;
  updated_at: string;
  desactualizada: Motivo[];
  bloques: BloquesApi;
};

export type DatosProyeccionApi = {
  desde: string | null;
  hasta: string | null;
  meses_publicados: string[];
  meses_faltantes: string[];
  ultimo_mes_cerrado: string | null;
  curvas_vigentes: number;
  agrupaciones_sin_curva: { id: string; nombre: string }[];
  curvas_obsoletas: number;
  /**
   * Tendencia del último año completo en % (`total(Y−1) ÷ total(Y−2) − 1` sobre las mismas tiendas de `M(Y−1) ∩ M(Y)`, con el
   * Niño normalizado), referencia del crecimiento por defecto. `null` si no hay dos años completos publicados.
   */
  tendencia_ultimo_anio_pct: number | null;
};

export type PrerrequisitosProyeccionApi = { bloquea: Motivo[]; avisa: Motivo[] };

export type RespuestaProyeccionApi = {
  datos: DatosProyeccionApi;
  prerrequisitos: PrerrequisitosProyeccionApi;
  bloques_hoy: BloquesApi;
  proyecciones: ProyeccionApi[];
  factores: FactorApi[];
};

// ─── Parte 1: líneas ───

export type IndiceLineaApi = {
  genero_id: string;
  mundo_id: string;
  linea_id: string;
  genero: string;
  mundo: string;
  linea: string;
  estado: EstadoLinea;
};

export type RespuestaLineasApi = {
  filtro: { genero_id: string | null; mundo_id: string | null; linea_id: string | null; q: string | null };
  filas: FilaApi[];
  totales_por_anio: { anio: number; vigente: number; propuesto: number; decididas: number; filas: number }[];
  historico_linea: { anio: number; unidades: number; clase: ClaseAnioFila; tiendas: number }[];
  tiendas_linea: {
    anio: number;
    bloque: "nuevas" | "cierres";
    subbloque: Subbloque | null;
    tienda: string;
    vendido: number;
    vigente: number | null;
    decidida: boolean;
  }[];
  prueba_anterior: { propuesto: number; real: number; desvio_pct: number | null; eat_m6: number | null } | null;
  avisos_linea: "tienda_nueva_sin_decidir"[];
  indice_lineas: IndiceLineaApi[];
};

export type FilaDetalleApi = FilaApi & {
  historico: HistoricoFila | null;
  curva: number[] | null;
  curva_origen: CurvaOrigen[];
  factores_mes: Record<number, number[]> | null;
  participaciones: Participaciones | null;
};

/** `GET …/tiendas/[tiendaId]/filas?anio=`: las filas de UNA tienda en UN año (las que `GET …/tiendas` ya no trae). */
export type RespuestaFilasTiendaApi = {
  tienda_id: string;
  anio: number;
  filas: FilaApi[];
};

export type RespuestaTiendasApi = {
  /** `filas` viene siempre vacío: se piden con `GET …/tiendas/[tiendaId]/filas?anio=`. */
  tiendas: TiendaProyeccionApi[];
  perfiles_apertura: { tienda: string; ratios: number[] }[];
};

export type RespuestaMatrizApi = {
  filtro: FiltroMatrizApi;
  nodos: NodoMatrizApi[];
  bloques: BloquesApi;
  resumen: {
    lineas: number;
    lineas_total: number;
    porcentaje_total: number | null;
    desvio_prueba_anterior_pct: number | null;
    /** `0.10.1`: filas base (del recorte filtrado) con algún año `revision_cola_larga` sin decidir; el «12 filas para revisión» de la cabecera. */
    filas_para_revision: number;
  };
};

export type FiltroMatrizApi = {
  genero_id: string | null;
  mundo_id: string | null;
  linea_id: string | null;
  temporada: string | null;
  agrupacion_estacionalidad_id: string | null;
  agrupacion_marca_id: string | null;
  solo: SoloMatriz | null;
  por: "arbol" | "agrupacion_marca";
};

export const SOLO_MATRIZ = [
  "con_tiendas_nuevas",
  "sin_proyectar",
  "parciales",
  "curva_cambio",
  "propuesta_cambio",
  "cola_larga",
  /** `0.10.1`: líneas con alguna fila `revision_cola_larga` sin decidir. */
  "para_revision",
] as const;
export type SoloMatriz = (typeof SOLO_MATRIZ)[number];

export type RespuestaMensualApi = {
  filtro: FiltroMatrizApi & { bloque: Bloque | "todas"; por_agrupacion: boolean };
  filas: FilaMensualApi[];
  totales: { anio: number; meses: (number | null)[]; origen_meses: OrigenMes[]; total: number }[];
  bloques: BloquesApi;
};

// ─── Contrato de M8 ───

export type FilaCerradaApi = {
  gml_id: string;
  equivalencia_id: string | null;
  agrupacion_marca_id: string;
  genero: string;
  mundo: string;
  linea: string;
  equivalencia: string | null;
  agrupacion_marca: string;
  nivel: "GML" | "GMLE";
  agrupacion_estacionalidad_id: string | null;
  temporada: string | null;
  bloque: Bloque;
  subbloque: Subbloque | null;
  tienda_id: string | null;
  anio: number;
  total: number;
  meses: number[] | null;
  origen_meses: OrigenMes[] | null;
  curva_origen_usada: CurvaOrigen[];
  participaciones_historicas: Participaciones | null;
  avisos: AvisoFila[];
};

export type RespuestaCerradaApi = {
  proyeccion: ProyeccionApi;
  anio_pedido: number;
  cubre: "en_curso" | "siguiente";
  bloques: BloquesApi;
  filas: FilaCerradaApi[];
};

export const TEMPORADAS_FACTOR: readonly TemporadaFactor[] = ["invierno", "verano"];
