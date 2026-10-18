/**
 * Contrato JSON de M12 (docs/modulos/12-analisis-marcas-barrer.md, sección 7): análisis de las marcas al barrer (y
 * mixtas) por GML y reparto aprobado y versionado. ARCHIVO AUTOCONTENIDO: lo importa también la pantalla, así que no
 * importa de `@supabase/*` ni de módulos de servidor. Las constantes de aquí son las del método (`tipos.ts` las
 * re-exporta). Los tipos NO se renombran: el frontend los consume tal cual.
 *
 * Convenciones: porcentajes y participaciones en FRACCIÓN 0–1 (la pantalla multiplica por 100); `pp` en puntos
 * porcentuales; meses como `aaaa-mm`; `clave` de una unidad `g` = `gml_id|equivalencia_id` (equivalencia vacía si el nodo
 * es GML). Toda la API es de `requirePlanner`: el comprador no ve nada de esto.
 */

import type { ModalidadEfectiva } from "@/lib/marcas/tipos-api";

export type { ModalidadEfectiva };

// ─── Catálogos y constantes del método ───

export const VENTANAS = [12, 24, 36] as const;
export type Ventana = (typeof VENTANAS)[number];
export const VENTANA_DEFECTO: Ventana = 24;

/** `por_mes` es de la segunda entrega: ni la API lo acepta ni se guarda (ver `ModoReparto`). */
export const MODOS_ENTRADA = ["anual", "por_temporada"] as const;
export type ModoEntrada = (typeof MODOS_ENTRADA)[number];
export type ModoReparto = "anual" | "por_temporada" | "por_mes";
export const MODO_DEFECTO: ModoEntrada = "por_temporada";

export const FUENTES = ["historico", "cerrada"] as const;
export type FuenteReparto = (typeof FUENTES)[number];
export const FUENTE_DEFECTO: FuenteReparto = "historico";

export const TEMPORADAS = ["verano", "invierno"] as const;
export type Temporada = (typeof TEMPORADAS)[number];

/** Las únicas que se analizan aquí: una `por_gml` pura no tiene parte al barrer. */
export type ModalidadBarrer = Exclude<ModalidadEfectiva, "por_gml">;

export type RangoTemporada = { desde_mes: number; hasta_mes: number };
export type TemporadasConfig = { verano: RangoTemporada; invierno: RangoTemporada };
/** Verano octubre a marzo, invierno abril a septiembre (decisión 31); editables en M8 (`flujo_parametros.temporadas`). */
export const TEMPORADAS_DEFECTO: TemporadasConfig = {
  verano: { desde_mes: 10, hasta_mes: 3 },
  invierno: { desde_mes: 4, hasta_mes: 9 },
};

export const MIN_MESES_TEMPORADA = 6;
export const UMBRAL_GML_PEQUENO = 50;
export const ERR_ESTABLE = 10;
export const ERR_INESTABLE = 25;
export const UMBRAL_OBSOLETO_PP = 5;
export const EAT_SIMILAR = 6;
export const EAT_DISTINTA = 10;
export const TOLERANCIA_SUMA = 0.0005;
export const VERSION_METODO_BARRER = 2;
export const MAX_NOTA_REPARTO = 300;

// ─── Enumeraciones ───

export type AvisoBarrer =
  | "sin_venta_barrer"
  | "temporada_corta"
  | "sin_anio_completo"
  | "sin_backtesting"
  | "sin_cerrada"
  | "curva_incompleta"
  | "sin_factor"
  | "red_no_comparable"
  | "mixta_sin_gml"
  | "nivel_cambiado"
  | "sin_reparto";

export type MotivoObsoleto = "cargas_nuevas" | "config_cambiada" | "nivel_cambiado" | "ventana_distinta";
export type VeredictoError = "estable" | "dudoso" | "inestable";
export type VeredictoEstacionalidad = "similar" | "dudosa" | "distinta";
export type EstadoReparto = "sin_reparto" | "al_dia" | "obsoleto";

/** Códigos de error coherentes con `{ error, codigo }` de las respuestas `409`. */
export type CodigoErrorBarrer =
  | "modalidad_no_barrer"
  | "marca_en_conjunto"
  | "huella_cambiada"
  | "suma_invalida"
  | "nota_requerida"
  | "sin_cerrada"
  | "sin_venta_barrer"
  | "fila_desconocida"
  | "sin_datos";

// ─── Alcance ───

/** Ids de género, mundo y línea a los que se limita el reparto; vacío = todo. */
export type AlcanceApi = { generos: string[]; mundos: string[]; lineas: string[] };
/** Como se guarda en `repartos_marca_barrido.alcance` y como llega en el cuerpo del `POST` (las claves son opcionales). */
export type AlcanceCuerpo = { generos?: string[]; mundos?: string[]; lineas?: string[] };

// ─── Lista: GET /api/marcas-barrer ───

export type VigenteResumenApi = {
  reparto_id: string;
  version: number;
  modo: ModoReparto;
  fuente: FuenteReparto;
  ventana_meses: number;
  aprobada_at: string;
  aprobada_por_nombre: string | null;
  error_reparto_pp: number | null;
};

export type MarcaBarrerResumenApi = {
  id: string;
  nombre: string;
  modalidad: ModalidadBarrer;
  agrupacion_marca: { id: string; nombre: string };
  /** Nombres de las marcas del conjunto cuya cabeza es esta (vacío si va sola). */
  miembros: string[];
  /** Venta total de la unidad en la ventana (en una mixta incluye su parte específica). */
  unidades_ventana: number;
  unidades_barrer: number;
  unidades_especificas: number;
  /** `unidades_barrer ÷ unidades_ventana` (1 en una `barrido`; `null` sin venta). */
  share_barrido: number | null;
  /** `g` con venta (> 0) en la ventana y cuántas son pequeñas (`< UMBRAL_GML_PEQUENO`). */
  gml_con_venta: number;
  gml_pequenos: number;
  /** GML específicos vigentes (solo una mixta). */
  gml_especificos: number;
  /** Ids donde la marca tiene venta al barrer, para los filtros de la lista (género, mundo, línea). */
  genero_ids: string[];
  mundo_ids: string[];
  linea_ids: string[];
  /** Último error del reparto aprobado (la lista no calcula backtesting); `null` sin versión o sin backtesting. */
  error_reparto: { pp: number | null; veredicto: VeredictoError | null };
  vigente: VigenteResumenApi | null;
  estado: EstadoReparto;
  /** Con cargas nuevas la LISTA no calcula la diferencia exacta: marca `cargas_nuevas` (conservador); el detalle de la marca dice si en realidad está al día. */
  obsoleto: MotivoObsoleto[];
  /** Cuánto se movería hoy el reparto vigente, en pp: `0` sin cargas nuevas; `null` con cargas nuevas (se calcula en el detalle) o sin vigente. */
  diferencia_pp: number | null;
  avisos: AvisoBarrer[];
};

export type ResumenListaBarrerApi = {
  marcas: number;
  sin_reparto: number;
  obsoletas: number;
  mixtas: number;
  inestables: number;
  unidades_barrer: number;
};

export type ListaBarrerApi = {
  datos: { hasta_periodo: string | null; desde_periodo: string | null; ventana: Ventana; cargas: number };
  marcas: MarcaBarrerResumenApi[];
  resumen: ResumenListaBarrerApi;
};

// ─── Análisis: GET /api/marcas-barrer/[marcaId] ───

export type P2Api = {
  /** `null` en modo `anual`. */
  temporada: Temporada | null;
  /** `p2` de la parte al barrer, normalizada por el Niño, en fracción. */
  historico: number;
  /** `p2` que se deduce de la cerrada de M7; `null` sin cerrada. */
  cerrada: number | null;
  /** `participacion_vigente` de la versión aprobada para esta `g` y temporada; `null` sin versión. */
  vigente: number | null;
  /** `participacion_ajustada` de esa versión (`null` = sin ajuste del planner). */
  ajustado_vigente: number | null;
};

export type FilaRepartoApi = {
  /** `gml_id|equivalencia_id`. */
  clave: string;
  gml_id: string;
  equivalencia_id: string | null;
  genero_id: string;
  mundo_id: string;
  linea_id: string;
  /** `GÉNERO · MUNDO · LÍNEA` (con ` › EQUIVALENCIA` si el nodo es GMLE). */
  ruta: string;
  nivel: "GML" | "GMLE";
  /** Unidades al barrer de la ventana (cruda, sin Niño). */
  unidades_ventana: number;
  pequena: boolean;
  /** `genero_id|mundo_id` de la fila de resto a la que pertenece (solo si `pequena`). */
  grupo_resto: string | null;
  /** `false` si el alcance la deja fuera del reparto: aparece (p1 y años) pero no tiene `p2`. */
  en_alcance: boolean;
  p1_ventana: number | null;
  p1_anual: { anio: number; valor: number | null; completo: boolean }[];
  p1_mensual: { anio: number; meses: (number | null)[] }[];
  /** Unidades al barrer por año calendario (los incompletos llevan `completo = false`), para las columnas 2024 · 2025 · 2026 (a set). */
  unidades_anual: { anio: number; unidades: number; completo: boolean }[];
  tendencia: number | null;
  p2: P2Api[];
  /** Solo una mixta: la `g` es un GML específico (compras específicas, no se reparte). */
  es_especifico: boolean;
};

export type FilaRestoApi = {
  /** `genero_id|mundo_id`. */
  grupo_resto: string;
  /** `Resto de GÉNERO · MUNDO`. */
  etiqueta: string;
  /** Claves (`gml_id|equivalencia_id`) de las `g` que agrupa. */
  miembros: string[];
  unidades_ventana: number;
  /** La suma de los miembros, con la misma forma que la de una fila (`ajustado_vigente` = suma de los ajustes si algún miembro tiene ajuste, si no `null`). */
  p2: P2Api[];
};

export type OpcionAlcanceApi = { id: string; nombre: string };

export type AnalisisMarcaApi = {
  marca: {
    id: string;
    nombre: string;
    modalidad: ModalidadBarrer;
    agrupacion_marca: string;
    miembros: string[];
    gml_especificos: { gml_id: string; ruta: string }[];
  };
  parametros: {
    ventana_meses: Ventana;
    modo: ModoEntrada;
    /** Cae a `anual` con aviso `temporada_corta` si una temporada no tiene datos suficientes. */
    modo_efectivo: ModoEntrada;
    fuente_disponible: FuenteReparto[];
    alcance: AlcanceApi;
    normaliza_nino: boolean;
    hasta_periodo: string;
    desde_periodo: string;
    factores: { anio: number; temporada: string; ratio: number | null }[];
    temporadas: TemporadasConfig;
    /** Meses de la ventana que cae en cada temporada (para el aviso `temporada_corta`). */
    meses_por_temporada: { temporada: Temporada; meses: number }[];
  };
  filas: FilaRepartoApi[];
  restos: FilaRestoApi[];
  /** Opciones para los chips de alcance: géneros, mundos y líneas donde la marca vende al barrer. */
  opciones_alcance: { generos: OpcionAlcanceApi[]; mundos: OpcionAlcanceApi[]; lineas: OpcionAlcanceApi[] };
  fuera_de_alcance: { ruta: string; unidades: number }[];
  share_barrido: number;
  unidades_barrer: number;
  unidades_especificas: number;
  error_reparto: { pp: number | null; veredicto: VeredictoError | null; anios: { anio: number; pp: number }[] };
  estacionalidad: {
    propia: number[] | null;
    gml: number[] | null;
    eat_pp: number | null;
    veredicto: VeredictoEstacionalidad | null;
    anios_completos: number[];
  };
  tendencia_total: number | null;
  vigente: {
    reparto_id: string;
    version: number;
    modo: ModoReparto;
    fuente: FuenteReparto;
    ventana_meses: number;
    aprobada_at: string;
    aprobada_por_nombre: string | null;
    nota: string | null;
    error_reparto_pp: number | null;
    diferencia_pp: number | null;
  } | null;
  obsoleto: MotivoObsoleto[];
  avisos: AvisoBarrer[];
  /** Huella del análisis (cargas, configuración y reparto calculado): el `POST` la devuelve para que no se apruebe sobre datos que cambiaron. */
  huella: string;
};

// ─── Versiones: GET/POST /api/marcas-barrer/[marcaId]/repartos ───

export type FilaVersionApi = {
  gml_id: string;
  equivalencia_id: string | null;
  ruta: string;
  temporada: Temporada | null;
  grupo_resto: string | null;
  unidades_ventana: number;
  participacion_calculada: number;
  participacion_ajustada: number | null;
  participacion_vigente: number;
};

export type RepartoApi = {
  id: string;
  marca_id: string;
  version: number;
  vigente: boolean;
  ventana_meses: number;
  modo: ModoReparto;
  fuente: FuenteReparto;
  alcance: AlcanceApi;
  hasta_periodo: string;
  normaliza_nino: boolean;
  huella_cargas: string;
  huella_config: string;
  factores_usados: { anio: number; temporada: string; ratio: number | null }[];
  temporadas_usadas: TemporadasConfig;
  share_barrido: number | null;
  eat_pp: number | null;
  error_reparto_pp: number | null;
  nota: string | null;
  aprobada_por_id: string | null;
  aprobada_por_nombre: string | null;
  aprobada_at: string;
  filas: FilaVersionApi[];
};

export type AprobarRepartoCuerpo = {
  ventana_meses: Ventana;
  modo: ModoEntrada;
  fuente: FuenteReparto;
  alcance: AlcanceCuerpo;
  normaliza_nino: boolean;
  /** La `huella` del análisis sobre el que se decidió. */
  huella: string;
  /** Las filas de resto llegan YA expandidas por `g` (`expandirResto` de `resto.ts`). */
  filas: { genero_mundo_linea_id: string; equivalencia_id?: string | null; temporada?: Temporada | null; participacion_ajustada: number | null }[];
  nota?: string;
};

// ─── Contrato con M8 y M9: GET /api/marcas-barrer/vigentes ───

export type RepartoVigenteApi = {
  marca_id: string;
  reparto_id: string;
  version: number;
  modo: ModoReparto;
  fuente: FuenteReparto;
  alcance: AlcanceApi;
  hasta_periodo: string;
  error_reparto_pp: number | null;
  temporadas_usadas: TemporadasConfig;
  aprobada_at: string;
  filas: { gml_id: string; equivalencia_id: string | null; temporada: Temporada | null; participacion: number }[];
};

export type RepartosVigentesApi = { repartos: RepartoVigenteApi[]; sin_reparto: string[] };
