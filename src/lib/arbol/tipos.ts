/**
 * Formas JSON de la API de M1 (docs/modulos/01-arbol-producto.md, "Contratos
 * de API"). Único origen de verdad: el backend tipa con esto lo que devuelve y
 * `tipos-api.ts` lo re-exporta para el frontend (más los cuerpos de petición).
 *
 * No dependen de `Tables<>` a propósito: describen el JSON que viaja, no las
 * filas de la base.
 */
import type { NivelPlanificacion, Temporada } from "./normalizar";

export type { NivelPlanificacion, Temporada };

// ─── Catálogos planos (/api/generos, /api/mundos, /api/agrupaciones-talla) ───

/** Fila de `generos` o `mundos` en sus listados, con el conteo de nodos (activos o no) que cuelgan de ella. */
export type CatalogoFila = {
  id: string;
  codigo: string;
  nombre: string;
  orden: number;
  activo: boolean;
  created_at: string;
  updated_at: string;
  nodos: number;
};

/** Fila de `agrupaciones_talla`: mismo catálogo plano, pero sin nodos (no participa del árbol en M1). */
export type AgrupacionTallaFila = Omit<CatalogoFila, "nodos">;

/** Fila de `lineas` en `GET /api/lineas`, con el conteo de nodos donde está. */
export type LineaFila = {
  id: string;
  codigo: string;
  nombre: string;
  temporada: Temporada;
  activo: boolean;
  created_at: string;
  updated_at: string;
  nodos: number;
};

/** Fila de `genero_mundo_linea` (respuesta de POST/PATCH /api/arbol/nodos). */
export type NodoFila = {
  id: string;
  genero_id: string;
  mundo_id: string;
  linea_id: string;
  activo: boolean;
  /** 02b: `GML` (el nodo es una unidad) o `GMLE` (una unidad por equivalencia activa). */
  nivel_planificacion: NivelPlanificacion;
  created_at: string;
  updated_at: string;
};

/** Fila de `equivalencias` (respuestas de /api/equivalencias). Desde M3 trae `agrupacion_estacionalidad_id`. */
export type EquivalenciaFila = {
  id: string;
  genero_mundo_linea_id: string;
  codigo: string;
  nombre: string;
  es_generica: boolean;
  activo: boolean;
  /** M3: agrupación de estacionalidad asignada, o `null` (equivalencia sin curva). */
  agrupacion_estacionalidad_id: string | null;
  created_at: string;
  updated_at: string;
};

// ─── Árbol completo (GET /api/arbol) ───

/** M3: la agrupación de estacionalidad tal como viaja en cada equivalencia del árbol. */
export type AgrupacionEstacionalidadArbol = {
  id: string;
  nombre: string;
  activo: boolean;
};

export type EquivalenciaArbol = {
  id: string;
  codigo: string;
  nombre: string;
  es_generica: boolean;
  activo: boolean;
  /** M3: `null` si la equivalencia no tiene agrupación (incluye las que apuntan a una inactiva, con su `activo`). */
  agrupacion_estacionalidad: AgrupacionEstacionalidadArbol | null;
};

/** Un nodo género-mundo-línea visto desde el árbol: la línea del catálogo más las banderas del nodo. */
export type LineaArbol = {
  nodo_id: string;
  linea_id: string;
  codigo: string;
  nombre: string;
  temporada: Temporada;
  activo_linea: boolean;
  activo_nodo: boolean;
  /** `activo_nodo ∧ genero.activo ∧ mundo.activo ∧ activo_linea`. */
  vigente: boolean;
  /** 02b: nivel de planificación del nodo. */
  nivel_planificacion: NivelPlanificacion;
  equivalencias: EquivalenciaArbol[];
};

export type MundoArbol = {
  id: string;
  codigo: string;
  nombre: string;
  orden: number;
  activo: boolean;
  /** Vacío si el mundo no tiene nodos en este género; el mundo aparece igual. */
  lineas: LineaArbol[];
};

export type GeneroArbol = {
  id: string;
  codigo: string;
  nombre: string;
  orden: number;
  activo: boolean;
  /** Siempre todos los mundos del catálogo. */
  mundos: MundoArbol[];
};

/** Conteos de lo que se devolvió (no de la base completa). */
export type ResumenArbol = {
  generos: number;
  mundos: number;
  /** Líneas distintas presentes en los nodos devueltos. */
  lineas: number;
  nodos: number;
  equivalencias: number;
  /** M3: entre las equivalencias devueltas, las faltantes (activas, en nodo vigente y sin agrupación activa). */
  equivalencias_sin_agrupacion: number;
  /** 02b: nodos vigentes abiertos a GMLE (entre los devueltos). */
  nodos_gmle: number;
  /** 02b: equivalencias activas de los nodos vigentes abiertos a GMLE (entre las devueltas). */
  equivalencias_en_gmle: number;
};

export type ArbolRespuesta = {
  generos: GeneroArbol[];
  resumen: ResumenArbol;
};

// ─── Importador (POST /api/arbol/importar) ───

export type ModoImportacion = "previsualizar" | "aplicar";

/** Una fila del CSV ya mapeada por el cliente a las cuatro columnas del árbol. */
export type FilaImportacion = {
  genero: string;
  mundo: string;
  linea: string;
  equivalencia: string;
};

/**
 * Por qué una fila del archivo no se procesa. `mundo_vacio`: no existen líneas
 * sin mundo, así que una fila con mundo en blanco es un error del archivo.
 */
export type MotivoOmision =
  | "linea_vacia"
  | "fila_total"
  | "genero_desconocido"
  | "genero_inactivo"
  | "mundo_vacio"
  | "mundo_desconocido"
  | "mundo_inactivo"
  | "duplicada_en_archivo";

/**
 * Una fila que no se procesó, con su contenido tal como llegó (normalizado:
 * mayúsculas, espacios colapsados) para que se pueda corregir el archivo antes
 * de cargar. `fila` y `fila_original` son 1-based sobre las `filas` enviadas.
 */
export type FilaOmitida = {
  fila: number;
  motivo: MotivoOmision;
  /** Detalle opcional (p. ej. el valor que no se reconoció). */
  detalle?: string;
  genero: string;
  mundo: string;
  linea: string;
  equivalencia: string;
  /** Solo en `duplicada_en_archivo`: la primera aparición de la misma fila. */
  fila_original?: number;
};

export type ConteosCrear = {
  lineas: number;
  nodos: number;
  /** Equivalencias reales (incluye las que toman el nombre de la línea). */
  equivalencias: number;
  equivalencias_genericas: number;
  /**
   * Informativo: de las reales a crear, cuántas se llaman igual que la línea
   * del nodo (filas con `-` o con el nombre de la línea escrito literal). Ya
   * están contadas en `equivalencias`; no se suman.
   */
  equivalencias_igual_a_linea?: number;
};

export type ConteosExistentes = {
  lineas: number;
  nodos: number;
  equivalencias: number;
};

/** Reporte sin `modo`: lo produce `planificarImportacion`; el handler le agrega el modo. */
export type ReporteBase = {
  totales: { recibidas: number; procesadas: number; omitidas: number };
  crear: ConteosCrear;
  existentes: ConteosExistentes;
  existentes_inactivos: ConteosExistentes;
  omitidas: FilaOmitida[];
  /** Primeros 20 de cada tipo. */
  muestra: { lineas: string[]; nodos: string[] };
};

export type ReporteImportacion = ReporteBase & { modo: ModoImportacion };

// ─── Nivel de planificación (02b): bloque e importador ───

/** `POST /api/arbol/nodos/nivel`: cuerpo. `nodo_ids` de 1 a 600. */
export type NivelBloqueCuerpo = { nivel: NivelPlanificacion; nodo_ids: string[] };

/**
 * Respuesta del bloque. `|ids únicos| = cambiados + sin_cambio + no_encontrados.length`.
 * Los nodos no vigentes se cambian igual (el nivel es una propiedad del nodo).
 */
export type NivelBloqueRespuesta = {
  nivel: NivelPlanificacion;
  cambiados: number;
  sin_cambio: number;
  no_encontrados: string[];
};

/** Una fila del archivo de niveles ya mapeada (`GENERO, MUNDO, LINEA, NIVEL`). */
export type FilaImportacionNivel = { genero: string; mundo: string; linea: string; nivel: string };

export type ImportarNivelCuerpo = { modo: ModoImportacion; filas: FilaImportacionNivel[] };

/** Motivos con los que `resolverGml` (compartida por los importadores de nivel y de marcas relevantes) descarta una fila. */
export type MotivoResolverGml =
  | "fila_total"
  | "genero_vacio"
  | "genero_desconocido"
  | "genero_inactivo"
  | "mundo_vacio"
  | "mundo_desconocido"
  | "mundo_inactivo"
  | "linea_vacia"
  | "linea_desconocida"
  | "linea_inactiva"
  | "gml_inexistente"
  | "gml_inactivo";

export type MotivoOmisionNivel = MotivoResolverGml | "nivel_vacio" | "nivel_invalido" | "duplicada_en_archivo";

/** Fila omitida con su contenido normalizado (el nivel tal como llegó), para corregir el archivo. */
export type FilaOmitidaNivel = FilaImportacionNivel & {
  fila: number;
  motivo: MotivoOmisionNivel;
  detalle?: string;
  /** Solo en `duplicada_en_archivo`: la primera aparición del mismo nodo. */
  fila_original?: number;
};

/** Un nodo cuyo nivel cambiará (el archivo manda): `de → a`. `fila` es 1-based. */
export type CambioNivel = { fila: number; ruta: string; de: NivelPlanificacion; a: NivelPlanificacion };

export type ReporteNivelBase = {
  totales: { recibidas: number; procesadas: number; omitidas: number };
  /** Nodos cuyo nivel cambia. `procesadas = cambios.length + sin_cambio`. */
  cambios: CambioNivel[];
  /** Nodos del archivo que ya tenían ese nivel. */
  sin_cambio: number;
  omitidas: FilaOmitidaNivel[];
  /** Primeros 20 cambios como `"HOMBRE · URBANO · DENIM: GML → GMLE"`. */
  muestra: { cambios: string[] };
};

export type ReporteImportacionNivel = ReporteNivelBase & { modo: ModoImportacion };
