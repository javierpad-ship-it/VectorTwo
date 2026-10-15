/**
 * Contratos de M7 (docs/modulos/07-proyeccion-anual.md, sección 7). Autocontenido:
 * describe el JSON que viaja y las constantes del método; lo usan igual el
 * servidor y la pantalla. Sin imports de `@supabase/*`, de React ni de Next.
 */

// ─── Constantes del método ───

export const UMBRAL_AVANCE = 0.3;
export const UMBRAL_COBERTURA = 0.25;
export const UMBRAL_COLA_LARGA = 100;
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
/** Entra en `resumen` para detectar fórmulas cambiadas (como `VERSION_MODELO` de M6). */
export const VERSION_METODO = 2;

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
  | "recalculo_pendiente";

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
  | "canibalizacion"
  | "apertura_dudosa"
  | "cierre_dudoso";

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

export type ParametrosProyeccion = {
  crecimiento_pct_defecto: number;
  umbral_avance: number;
  umbral_cobertura: number;
  umbral_cola_larga: number;
  rampa_maduracion: number[];
  factores_usados: { anio: number; temporada: TemporadaFactor; ratio: number | null; origen: "calculado" | "manual" | null }[];
  bloques: BloquesApi;
  /** Cambiaste parámetros o «datos hasta» después de calcular: hay que recalcular (`PATCH` lo marca, `calcular` lo limpia). */
  recalculo_pendiente?: boolean;
};

// ─── Filas y años ───

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
  /** Real a `k` de las tiendas de `M(Y)` que salen de `M(Y+1)` (resta de la base del año siguiente; B2). */
  salientes: { tienda_id: string; vendido: number; meses: number[] }[];
};

export type CurvaOrigen = { agrupacion_id: string; curva_id: string; version: number; peso: number };

export type Participaciones = {
  por_clave_flujo: { clave_flujo: string; marca_id: string | null; participacion: number }[];
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
  resumen: { lineas: number; lineas_total: number; porcentaje_total: number | null; desvio_prueba_anterior_pct: number | null };
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
