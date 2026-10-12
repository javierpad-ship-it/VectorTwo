import type { CombinacionPeticion, Periodo } from "./tipos-api";

/**
 * Vista de la API del mapeo de combinaciones históricas (mejora M5b,
 * docs/modulos/05b-mapeo-combinaciones.md, "Contratos de API"). Es la interfaz
 * entre backend y frontend: describe el JSON que viaja. Es autocontenido: solo
 * importa tipos de `tipos-api.ts` (nada de módulos `"use client"` ni de la
 * base), así que se puede usar desde el navegador y desde el servidor.
 *
 * Toda la API cuelga de `/api/ventas/mapeos` y exige rol admin o planner. Las
 * respuestas de éxito son `{ data }` y las de error `{ error }`; algunos `409`
 * añaden `codigo` (`origen_existe_en_arbol`, `origen_repetido`,
 * `destino_inactivo`) y `indice` (posición del item que falló).
 */

/** Equivalencia comodín de un origen: "cualquier equivalencia de esa terna que no resuelva". */
export const COMODIN_EQUIVALENCIA = "*";

/** Los 11 motivos de exclusión que se pueden reasignar con un mapeo. */
export type MotivoMapeable =
  | "genero_desconocido"
  | "mundo_desconocido"
  | "linea_desconocida"
  | "nodo_inexistente"
  | "equivalencia_inexistente"
  | "genero_inactivo"
  | "mundo_inactivo"
  | "linea_inactiva"
  | "nodo_inactivo"
  | "equivalencia_inactiva"
  | "clasificacion_incompleta";

/** Ya normalizado y con la equivalencia sustituida (`-` → línea, vacío → `SIN EQUIVALENCIA`); la equivalencia puede ser `*`. */
export type OrigenMapeo = CombinacionPeticion;

export type DestinoMapeo = {
  equivalencia_id: string;
  genero: string;
  mundo: string;
  linea: string;
  equivalencia: string;
  es_generica: boolean;
  /** Equivalencia activa en un nodo vigente (nodo, línea, género y mundo activos). */
  vigente: boolean;
};

/** `obsoleto` = el origen hoy resuelve en el árbol (el mapeo no se aplica). */
export type EstadoMapeo = "vigente" | "inactivo" | "obsoleto" | "destino_inactivo";

export type MapeoApi = {
  id: string;
  origen: OrigenMapeo;
  destino: DestinoMapeo;
  motivo_origen: MotivoMapeable | null;
  nota: string | null;
  usuario_nombre: string | null;
  activo: boolean;
  estado: EstadoMapeo;
  created_at: string;
  updated_at: string;
};

/** `resumen` cuenta TODOS los mapeos (no solo los que pasan `q` y `estado`). */
export type MapeosRespuesta = { mapeos: MapeoApi[]; resumen: Record<EstadoMapeo, number> };

export type CrearMapeoItem = { origen: OrigenMapeo; equivalencia_id: string; motivo_origen?: MotivoMapeable; nota?: string };

/** 1..500 items; todo o nada. */
export type CrearMapeosPeticion = { mapeos: CrearMapeoItem[]; reemplazar?: boolean };

/** `201`. `mapeos` son los creados o actualizados (no los `sin_cambio`). */
export type CrearMapeosRespuesta = { creados: number; actualizados: number; sin_cambio: number; mapeos: MapeoApi[] };

export type EditarMapeoPeticion = { equivalencia_id?: string; nota?: string | null; activo?: boolean };

export type SugerenciaMapeo = {
  equivalencia_id: string;
  genero: string;
  mundo: string;
  linea: string;
  equivalencia: string;
  /** 0,50 a 1,00 con dos decimales. */
  puntuacion: number;
  razon: string;
  /** `puntuacion >= 0,80`. */
  fuerte: boolean;
};

/** 1..500 orígenes, sin `*`. */
export type SugerirPeticion = { combinaciones: OrigenMapeo[] };

/** Misma posición que en la petición; `[]` = sin sugerencia. Hasta 3 por origen. */
export type SugerirRespuesta = { sugerencias: SugerenciaMapeo[][] };

/** Fila del CSV de mapeos (la descarga y el importador usan estas cabeceras; `ESTADO` se ignora al importar). */
export type FilaMapeoCsv = {
  ORIGEN_GENERO: string;
  ORIGEN_MUNDO: string;
  ORIGEN_LINEA: string;
  ORIGEN_EQUIVALENCIA: string;
  DESTINO_GENERO: string;
  DESTINO_MUNDO: string;
  DESTINO_LINEA: string;
  DESTINO_EQUIVALENCIA: string;
  NOTA?: string;
};

export type MotivoOmisionMapeo =
  | "origen_sin_clasificar"
  /** `*` en género, mundo o línea, o `*` mezclado con texto en la equivalencia (el comodín solo vale solo, en la equivalencia). */
  | "origen_con_comodin_invalido"
  | "origen_existe_en_arbol"
  | "origen_repetido_en_archivo"
  | "destino_no_resuelve"
  | "destino_inactivo"
  | "existente_igual"
  | "existente_distinto";

/** 1..5 000 filas. */
export type ImportarMapeosPeticion = { modo: "previsualizar" | "aplicar"; filas: FilaMapeoCsv[] };

/** `fila` es la posición en el archivo (1 = primera fila de datos). `creados` es 0 al previsualizar. */
export type ImportarMapeosRespuesta = {
  recibidas: number;
  crear: number;
  creados: number;
  omitidas: { motivo: MotivoOmisionMapeo; fila: number; detalle: string }[];
};

/** Un mapeo activo cuyo destino dejó de ser vigente: no se aplicó y la fila conserva su motivo original. */
export type MapeoNoAplicableApi = {
  id: string;
  origen: OrigenMapeo;
  motivo: "destino_inactivo";
  /** Destino como `GENERO / MUNDO / LINEA / EQUIVALENCIA` (para mostrarlo en el aviso). */
  destino?: string;
};

/** Periodo `aaaa-mm` (reexportado para quien solo necesite este archivo). */
export type { Periodo };
