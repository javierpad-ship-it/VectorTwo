/**
 * Contratos de la propuesta con IA (docs/modulos/07e-propuesta-con-ia.md, §3.4). Autocontenido: describe el JSON que viaja y las
 * constantes de las reglas; lo usan igual el servidor y la pantalla. Sin imports de `@supabase/*`, de React ni de Next.
 *
 * Convenciones: los `*_pct` son porcentajes (8,91 = 8,91 %), sin redondear; las unidades son enteros. `desvio_suma_modelo` es una
 * fracción (0,0035 = +0,35 %), como en la fórmula de la ficha.
 *
 * Congelado al cerrar la tanda 1: la tanda 2 lo importa y nadie lo cambia.
 */

export const CAPACIDADES_IA = ["distribucion_y1"] as const;
export type CapacidadIa = (typeof CAPACIDADES_IA)[number];

// ─── Constantes de las reglas ───

/** `version_entrada` y `version_salida` del contrato con el proveedor (§3.5 y §3.6). */
export const VERSION_ENTRADA = 2;
export const VERSION_SALIDA = 2;
/** Corrida sin actividad durante tantos minutos pasa a `abandonada` (§5.3). */
export const CORRIDA_CADUCA_MIN = 30;
/** El candado de un GM vence a los tantos segundos (§2.4). */
export const CANDADO_GM_SEG = 300;
/** Esperas seguidas por 429 en el mismo paso antes de detener la corrida (§3.8). */
export const MAX_ESPERAS_429 = 10;
/** Filas por llamada: por encima de ellas, modo jerárquico (§3.8). */
export const MAX_FILAS_LLAMADA_DEFECTO = 60;
/** `meta_movida`: el GM absorbió más de este % de lo que la IA le daba a sus filas (§5.1). */
export const UMBRAL_META_MOVIDA_PCT = 5;
/** `absorcion_alta`: una fila absorbió más de este % de su cifra al generar (§5.1). */
export const UMBRAL_ABSORCION_FILA_PCT = 10;
/** `base_movida`: `B'` cambió más de este % desde que la IA propuso (§5.3). */
export const UMBRAL_BASE_MOVIDA_PCT = 2;
/** `filas_libres_nuevas`: las libres sin cifra IA pesan más de este % de `Meta_libre` (§5.3). */
export const UMBRAL_LIBRES_NUEVAS_PCT = 5;
/** Esfuerzo del GM: `meta_exigente` desde este %, `meta_holgada` desde el negativo (§5.1). */
export const UMBRAL_ESFUERZO_EXIGENTE_PCT = 10;
export const UMBRAL_ESFUERZO_HOLGADO_PCT = -5;
/** Brecha de una fila: «forzada» desde +10 %, «muy forzada» desde +25 %, «cede» desde −10 % (§4.1). */
export const UMBRAL_BRECHA_FORZADA_PCT = 10;
export const UMBRAL_BRECHA_MUY_FORZADA_PCT = 25;
export const UMBRAL_BRECHA_CEDE_PCT = -10;
/** Aviso `brecha_extrema`: `A ÷ natural` fuera de este rango (§5.2). */
export const RANGO_BRECHA_EXTREMA = { min: 0.5, max: 2 } as const;
/** Una señal de tiendas se levanta cuando el aporte pesa al menos este % de `B` (§3.5). */
export const UMBRAL_APORTE_TIENDAS_PCT = 10;
/** Validación de la salida (§5.2). */
export const TOLERANCIA_SUMA_PCT = 3;
export const TOLERANCIA_SUMA_INVALIDA_PCT = 15;
export const MAX_FALTANTES_PCT = 5;
export const FACTOR_CIFRA_EXCESIVA = 10;
export const MAX_RAZON = 280;
export const MAX_RAZON_NATURAL = 200;
export const MAX_RAZON_GM = 600;

// ─── Servicio, configuración y estados ───

export type MotivoServicioIa = "sin_clave" | "desactivada_entorno" | "sin_configuracion" | "sin_capacidades" | "clave_invalida" | "tope_mensual";
export type VeredictoCapacidadIa = "gana" | "no_gana" | "sin_dato";
export type ServicioIaApi = {
  disponible: boolean;
  motivo: MotivoServicioIa | null;
  modelo: string | null;
  version_prompt: string | null;
  capacidades: CapacidadIa[];
  gasto_mes_usd: number;
  tope_usd_mes: number | null;
  tope_usd_corrida: number | null;
  gasto_dia_usuario_usd: number;
  tope_usd_dia_usuario: number | null;
  evaluacion: { id: string; fecha: string; veredicto: Record<CapacidadIa, VeredictoCapacidadIa> } | null;
};
export type MotivoIa =
  | "version_metodo"
  | "proyeccion_desactualizada"
  | "cerrada"
  | "archivada"
  | "calculo_en_curso"
  | "anio_siguiente_atipico"
  | "factor_y"
  | "reaprobar_pendiente"
  | "meta_provisional"
  | "sin_meta"
  | "decisiones_y_pendientes";

export type EstadoMetaFila = "libre" | "fija_decidida" | "fija_pct" | "fija_cola_larga" | "sin_base";
export type MetaGMApi = {
  pct: number;
  sobre_base: "bruta" | "corregida";
  fuente: "gm" | "resto" | "resto_provisional";
  crecimiento_id: string | null;
  version: number | null;
  meta_gm: number;
  fijas: number;
  fijas_detalle: { decididas: number; pct_propio: number; cola_larga: number };
  meta_libre: number;
  filas_libres: number;
  filas_fijas: number;
  fuera_base: { filas: number; unidades: number };
};
export type EstadoPropuestaGM = "sin_propuesta" | "sin_filas_libres" | "al_dia" | "meta_movida" | "desactualizada" | "fallida" | "bloqueado_privacidad";
export type MotivoDesactualizadaIa = "historia_cambiada" | "filas_libres_nuevas" | "version_metodo" | "capacidad_apagada";
export type BanderaIa =
  | "dato_insuficiente"
  | "linea_nueva"
  | "en_salida"
  | "quiebres"
  | "nino"
  | "volatil"
  | "tiendas_entrantes"
  | "meta_exigente"
  | "meta_holgada"
  | "estacionalidad_atipica";
export type SenalIa =
  | "dato_insuficiente"
  | "linea_nueva"
  | "quiebres"
  | "nino"
  | "temporadas_mezcladas"
  | "avance_bajo"
  | "plan_anterior"
  | "revision_cola_larga"
  | "tiendas_entrantes"
  | "tiendas_salientes";
export type AvisoIa =
  | "ia_no_cuadro"
  | "ia_cifra_excesiva"
  | "brecha_extrema"
  | "sin_propuesta_ia"
  | "fijadas_exceden_meta"
  | "meta_provisional"
  | "base_movida"
  | "meta_movida"
  | "absorcion_alta"
  | "bandera_desconocida"
  | "fila_extra"
  | "fila_duplicada"
  | "razon_recortada";
export type AbsorcionApi = { delta_meta_u: number; desviacion_fijadas_u: number; otros_u: number; absorbido_u: number; absorbido_pct: number | null };
export type ConfianzaIa = "alta" | "media" | "baja";
export type IaFilaApi = {
  fila_id: string;
  propuesta_fila_id: string;
  estado_meta: EstadoMetaFila;
  estado_gm: EstadoPropuestaGM;
  motivos: MotivoDesactualizadaIa[];
  natural_y1: number | null;
  razon_natural: string | null;
  /** Vigente: `asignarMeta` de hoy; `null` si es fija o no hay reparto. Es el `valor_esperado` de «Aceptar IA». */
  meta_y1: number | null;
  meta_y1_al_generar: number | null;
  absorbido_u: number | null;
  absorbido_pct: number | null;
  brecha_u: number | null;
  brecha_pct: number | null;
  contra_metodo_u: number | null;
  pct_sobre_corregida: number | null;
  pct_sobre_real: number | null;
  razon: string | null;
  banderas: BanderaIa[];
  senales: SenalIa[];
  confianza: ConfianzaIa | null;
  avisos: AvisoIa[];
  aceptable: { y1: boolean; motivo: string | null };
};
export type GMIaResumenApi = {
  gm_clave: string;
  genero: string;
  mundo: string;
  es_resto: boolean;
  meta: MetaGMApi | null;
  estado: EstadoPropuestaGM;
  motivos: MotivoDesactualizadaIa[];
  configuracion_cambiada: boolean;
  natural_libres: number | null;
  meta_libre: number | null;
  esfuerzo_pct: number | null;
  filas_forzadas: number;
  filas_que_ceden: number;
  absorcion: AbsorcionApi | null;
  filas_y_sin_decidir: number;
  propuesta: { id: string; created_at: string; usuario_nombre: string | null; modelo: string; version_prompt: string; razon_gm: string | null; costo_usd: number } | null;
};
export type GMIaDetalleApi = GMIaResumenApi & {
  filas: (IaFilaApi & {
    linea: string;
    equivalencia: string | null;
    agrupacion_marca: string;
    base: number | null;
    base_corregida: number | null;
    aporte_entrantes: number | null;
    aporte_salientes: number | null;
    metodo_y1: number | null;
    vigente_y1: number | null;
    decidida_y1: boolean;
    vigente_y: number | null;
    decidida_y: boolean;
  })[];
  contexto: { aperturas_y1: number; cierres_y1: number; cola_larga: { filas: number; unidades: number }; vista_previa_curvas: number | null };
  anteriores: { id: string; created_at: string; modelo: string; version_prompt: string }[];
};
export type EstimacionApi = {
  gms: number;
  llamadas: number;
  filas: number;
  tokens_entrada: number;
  tokens_salida: number;
  costo_usd: number;
  tope_usd: number;
  reusables: number;
};
export type CorridaApi = {
  id: string;
  estado: string;
  gm_total: number;
  gm_hechos: number;
  gm_reusados: number;
  gm_fallidos: number;
  costo_usd: number;
  costo_estimado_usd: number;
  modelo: string;
  version_prompt: string;
  usuario_nombre: string | null;
  iniciada_at: string;
  terminada_at: string | null;
  motivo_fin: string | null;
};
export type EstadoCorridaGM = "pendiente" | "en_proceso" | "hecho" | "reusado" | "fallido" | "sin_filas_libres" | "bloqueado_privacidad";
export type PasoGMApi = {
  gm_clave: string;
  pliegue: string | null;
  estado: EstadoCorridaGM;
  pasos_hechos: number;
  pasos_total: number;
  siguiente: "continuar" | "esperar" | "hecho" | "fallido";
  esperar_ms: number | null;
  corrida: CorridaApi;
};
export type EstadoEvaluacionIa = "en_curso" | "completa" | "fallida" | "cancelada";

// ─── Costo ───

/** USD por millón de tokens (la página de precios vigente del proveedor). */
export type PreciosIa = { entrada: number; salida: number; cache_escritura: number; cache_lectura: number };
export type UsoTokensIa = { entrada: number; salida: number; cache_escritura: number; cache_lectura: number };

// ─── Evaluación (backtest, §5.4) ───

export const PLIEGUES_IA = ["D25", "E25", "D24", "N26"] as const;
export type PliegueIa = (typeof PLIEGUES_IA)[number];
export type ReglaVeredictoIa = "sin_dato" | "mejora" | "bootstrap" | "mayoria_gm" | "genero" | "natural" | "contraste_d24" | "cobertura" | "estabilidad";
export type RivalIa = "metodo" | "tendencia";
export type GrupoGeneroIa = "HOMBRE" | "MUJER" | "RESTO";
/** WAPE en fracción (0,0567 = 5,67 %). */
export type MetricasRepartoApi = {
  filas: number;
  gms: number;
  wape_metodo: number | null;
  wape_tendencia: number | null;
  wape_ia: number | null;
  rival: RivalIa | null;
  wape_rival: number | null;
  /** `1 − WAPE_IA ÷ WAPE_rival`. */
  mejora: number | null;
  eat_metodo_pp: number | null;
  eat_ia_pp: number | null;
};
export type MetricasNaturalApi = {
  filas: number;
  wape_metodo: number | null;
  wape_tendencia: number | null;
  wape_ia: number | null;
  rival: RivalIa | null;
  wape_rival: number | null;
};
export type BootstrapApi = { remuestreos: number; semilla: number; p5: number | null; p95: number | null; media: number | null };
export type ResultadosEvaluacionApi = {
  d25: { reparto: MetricasRepartoApi; natural: MetricasNaturalApi; por_genero: Record<GrupoGeneroIa, MetricasRepartoApi>; gms_ganados: number; gms_evaluados: number; bootstrap: BootstrapApi } | null;
  d24: { reparto: MetricasRepartoApi; natural: MetricasNaturalApi } | null;
  estabilidad: number | null;
  cobertura: number | null;
};
export type VeredictoEvaluacionApi = { distribucion_y1: VeredictoCapacidadIa; regla_que_fallo: ReglaVeredictoIa | null };
export type EvaluacionApi = {
  id: string;
  intento: number;
  modelo: string;
  version_prompt: string;
  estado: EstadoEvaluacionIa;
  parametros: Record<string, unknown>;
  resultados: ResultadosEvaluacionApi | null;
  veredicto: VeredictoEvaluacionApi | null;
  tope_usd: number;
  costo_usd: number;
  usuario_nombre: string | null;
  iniciada_at: string;
  terminada_at: string | null;
};
export type ConfiguracionIaApi = {
  id: string;
  version: number;
  estado: "vigente" | "reemplazada";
  modelo: string;
  version_prompt: string;
  capacidades: CapacidadIa[];
  evaluacion_id: string | null;
  tope_usd_corrida: number;
  tope_usd_mes: number;
  tope_usd_dia_usuario: number;
  max_filas_llamada: number;
  incluir_cola_larga: boolean;
  presupuesto_razonamiento: number;
  precios: PreciosIa;
  terminos_extra: string[];
  nota: string | null;
  usuario_nombre: string | null;
  aprobada_at: string;
};
