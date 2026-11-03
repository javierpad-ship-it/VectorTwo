/**
 * Contratos de la aprobación en bloque (docs/modulos/07g-aprobacion-en-bloque.md, §3.2). Autocontenido: describe el JSON que viaja y las
 * constantes de las reglas; lo usan igual el servidor y la pantalla. Sin imports de `@supabase/*`, de React, de Next ni de `node:*`
 * (solo tipos de `proyeccion/tipos-api` y `ia/tipos-api`, que se borran al compilar).
 *
 * Convenciones: los `*_pct` son porcentajes (8,91 = 8,91 %), sin redondear; las unidades son enteros.
 *
 * Congelado al cerrar la tanda 1: la tanda 2 lo importa y nadie lo cambia.
 */
import type { EstadoPropuestaGM, AvisoIa } from "@/lib/ia/tipos-api";
import type { AvisoFila } from "@/lib/proyeccion/tipos-api";

// ─── Constantes de las reglas ───

/** D17: tope de filas por petición (una tanda). Las tandas no parten un GM (`trocear.ts`). */
export const MAX_FILAS_LOTE = 300;
/** §4.4: desde más de estas filas la confirmación exige «Revisé el resumen por GM». */
export const REVISION_OBLIGATORIA_DESDE = 100;
/** §4.4: un GM que queda a más de este % de su meta (en valor absoluto) también exige la revisión. */
export const REVISION_DESVIO_PCT = 1;
export const MAX_NOTA_LOTE = 300;
/** Tandas de una confirmación que se revierten en una sola petición. */
export const MAX_LOTES_CONFIRMACION = 100;
/** §4.4: las filas con más unidades y con mayor |brecha| que se muestran en la confirmación. */
export const MAX_MAYORES = 10;

export const TIPOS_LOTE = ["aprobar", "reaprobar", "revertir"] as const;
export type TipoLote = (typeof TIPOS_LOTE)[number];
/** Tipos que se piden en el cuerpo de `POST …/lotes`; `revertir` tiene sus propias rutas. */
export type TipoLoteAprobar = Exclude<TipoLote, "revertir">;
export type FuenteAprobacion = "ia" | "metodo";
/** Fuente que queda en la traza de una fila del lote (`proyeccion_lote_filas.fuente`). */
export type FuenteFilaLote = FuenteAprobacion | "revertir";
export type ModoAprobacion = "aprobar" | "reaprobar";

// ─── Filtro (contexto de pantalla que se guarda con el lote) ───

/** §4.3. Todo opcional; los arreglos con los nombres o las claves que muestra la pantalla. Se guarda tal cual en `proyeccion_lotes.filtro`. */
export type FiltroLote = {
  generos?: string[];
  mundos?: string[];
  lineas?: string[];
  agrupaciones?: string[];
  /** Claves de género × mundo (`gm_clave`), p. ej. «Aprobar este GM» desde Propuesta IA. */
  gms?: string[];
  solo_sin_avisos_fuertes?: boolean;
  /** «Para revisión» (cola larga con quiebres) incluidas. */
  incluir_revision?: boolean;
  confianza?: ("alta" | "media")[];
  estado_ia?: EstadoPropuestaGM[];
  brecha_max_pct?: number;
};

// ─── Filas elegibles (GET …/aprobacion) ───

export type CodigoExclusion = "confianza_baja" | "sin_cifra_ia" | "ia_desactualizada" | "ia_no_aceptable";

export type FilaAprobacionApi = {
  fila_id: string;
  anio: number;
  gm_clave: string;
  genero: string;
  mundo: string;
  es_resto: boolean;
  linea: string;
  linea_id: string;
  equivalencia: string | null;
  agrupacion_marca: string;
  agrupacion_marca_id: string;
  motivo_cierre: "umbral" | "revision_cola_larga";
  vendido: number;
  base: number | null;
  base_corregida: number | null;
  metodo: { valor: number; pct_propio: number | null; avisos: AvisoFila[] };
  ia: null | {
    propuesta_fila_id: string;
    valor: number | null;
    natural: number | null;
    brecha_u: number | null;
    brecha_pct: number | null;
    contra_metodo_u: number | null;
    absorbido_pct: number | null;
    confianza: "alta" | "media" | "baja" | null;
    avisos: AvisoIa[];
    razon: string | null;
    aceptable: boolean;
    motivo: string | null;
  };
  /** Solo en modo reaprobar: lo aprobado en bloque. */
  decidido: number | null;
  fuente_sugerida: FuenteAprobacion | null;
  badge: "ia" | "metodo" | "metodo_gm_sin_ia" | null;
  excluida: CodigoExclusion | null;
  motivo_exclusion: string | null;
  avisos_fuertes: boolean;
};

export type GMAprobacionApi = {
  gm_clave: string;
  genero: string;
  mundo: string;
  es_resto: boolean;
  meta: number | null;
  fuente_meta: "gm" | "resto" | "resto_provisional" | null;
  base_total: number | null;
  vigente_total: number;
  crecimiento_implicito_pct: number | null;
  desvio_u: number | null;
  desvio_pct: number | null;
  libres: number;
  pendientes: number;
  estado_ia: EstadoPropuestaGM | null;
  propuesta_gm_id: string | null;
};

export type BloqueoLoteApi = { codigo: string; mensaje: string; detalle?: Record<string, unknown> };

export type PendientesCierreApi = { filas_y: number; filas_y1: number; para_revision: number; tiendas: number };

export type AprobacionApi = {
  anio: number;
  anio_en_curso: number;
  modo: ModoAprobacion;
  calculado_at: string;
  editable: boolean;
  bloqueos: BloqueoLoteApi[];
  ia: { disponible: boolean; motivo: string | null; corrida_en_curso: boolean; gms_con_propuesta: number };
  filas: FilaAprobacionApi[];
  gms: GMAprobacionApi[];
  pendientes_cierre: PendientesCierreApi;
  /** Aviso de la cabecera (D13). */
  reaprobables: { y: number; y1: number };
  umbral_cola_larga: number;
};

// ─── Resultado de un lote ───

export type CodigoRechazoFila =
  | "ya_decidida"
  | "no_bloquea_cierre"
  | "no_reaprobable"
  | "sin_cambio"
  | "fila_inactiva"
  | "fila_no_encontrada"
  | "propuesta_cambio"
  | "ia_valor_cambio"
  | "ia_no_vigente"
  | "ia_desactualizada"
  | "ia_fila_ajena"
  | "fila_no_libre"
  | "ia_sin_valor"
  | "sin_cifra_ia"
  | "metodo_en_gm_con_ia"
  | "confianza_baja"
  | "grupo_rechazado"
  | "cambio_concurrente"
  | "cambiada_despues"
  | "menor_que_vendido";

export type ResultadoFilaLoteApi = {
  fila_id: string;
  anio: number;
  gm_clave: string;
  fuente: FuenteFilaLote;
  resultado: "aplicada" | "rechazada";
  codigo: CodigoRechazoFila | null;
  /** Lo que se escribe como decidido; `null` si se rechazó y en toda reversión (vuelve a la propuesta). */
  valor: number | null;
  /** Lo que valía hoy (con `propuesta_cambio` o `ia_valor_cambio`); `null` en el resto. */
  valor_actual: number | null;
  /** `valor − natural` de la IA (solo filas de IA con natural); para la lista de las 10 mayores brechas. */
  brecha_u: number | null;
};

export type EfectoGMApi = {
  gm_clave: string;
  total_antes: number;
  total_despues: number;
  crecimiento_implicito_antes_pct: number | null;
  crecimiento_implicito_despues_pct: number | null;
  meta_antes: number | null;
  meta_despues: number | null;
  desvio_antes_u: number | null;
  desvio_despues_u: number | null;
  libres_antes: number;
  libres_despues: number;
};

/** `proyeccion_lotes.resumen`: lo calcula la función SQL con lo que de verdad escribió (D11). */
export type ResumenLoteApi = {
  pedidas: number;
  aplicadas: number;
  rechazadas: Record<string, number>;
  por_fuente: Partial<Record<FuenteFilaLote, { filas: number; unidades: number }>>;
};

export type EstadoLote = "vigente" | "revertido_en_parte" | "revertido";

export type LoteApi = {
  id: string;
  confirmacion_id: string;
  proyeccion_id: string | null;
  tipo: TipoLote;
  revierte_lote_id: string | null;
  anio: number;
  created_at: string;
  usuario_nombre: string | null;
  perfil_id: string | null;
  filtro: FiltroLote;
  nota: string | null;
  revision_confirmada: boolean;
  resumen: ResumenLoteApi;
  efecto_gm_previsto: EfectoGMApi[];
  propuestas_gm: string[];
  /** Derivados al leer: filas aplicadas de este lote que otro lote de reversión ya devolvió a la propuesta. `0` en un lote `revertir`. */
  filas_revertidas: number;
  /** Derivado: `null` en un lote `revertir`. */
  estado: EstadoLote | null;
};

export type FilaLoteApi = {
  id: string;
  fila_id: string | null;
  fila_clave: string;
  gm_clave: string;
  anio: number;
  fuente: FuenteFilaLote;
  resultado: "aplicada" | CodigoRechazoFila;
  valor: number | null;
  valor_esperado: number | null;
  valor_actual: number | null;
  decidido_anterior: number | null;
  propuesta_fila_id: string | null;
};

export type TotalesLoteApi = {
  pedidas: number;
  aplicadas: number;
  rechazadas: number;
  unidades: number;
  por_fuente: Record<FuenteAprobacion, { filas: number; unidades: number }>;
};

export type CrecimientoAReaprobarApi = { gm_clave: string; genero: string; mundo: string };

export type ResultadoLoteApi = {
  lote: LoteApi | null;
  simulado: boolean;
  repetido: boolean;
  huella_simulacion: string;
  filas: ResultadoFilaLoteApi[];
  totales: TotalesLoteApi;
  efecto_gm: EfectoGMApi[];
  /** Las `MAX_MAYORES` filas aplicadas con más unidades. */
  mayores_unidades: ResultadoFilaLoteApi[];
  /** Las `MAX_MAYORES` filas aplicadas con mayor `|brecha_u|`. */
  mayores_brechas: ResultadoFilaLoteApi[];
  /** D15: GM que un lote de `Y` dejaría con crecimientos que reaprobar. Vacío en lotes de `Y+1`. */
  crecimientos_a_reaprobar: CrecimientoAReaprobarApi[];
  revision_requerida: boolean;
  pendientes_cierre: PendientesCierreApi;
};

/** `AnioFilaApi.decision_lote` (la lectura de M7 lo define con esta misma forma; `src/lib/proyeccion/` no importa este archivo). */
export type DecisionLoteApi = {
  lote_id: string;
  tipo: TipoLote;
  created_at: string;
  usuario_nombre: string | null;
  fuente: FuenteAprobacion | null;
};
