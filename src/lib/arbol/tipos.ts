/**
 * Formas JSON de la API de M1 (docs/modulos/01-arbol-producto.md, "Contratos
 * de API"). Único origen de verdad: el backend tipa con esto lo que devuelve y
 * `tipos-api.ts` lo re-exporta para el frontend (más los cuerpos de petición).
 *
 * No dependen de `Tables<>` a propósito: describen el JSON que viaja, no las
 * filas de la base.
 */
import type { Temporada } from "./normalizar";

export type { Temporada };

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
  created_at: string;
  updated_at: string;
};

/** Fila de `equivalencias` (respuestas de /api/equivalencias). */
export type EquivalenciaFila = {
  id: string;
  genero_mundo_linea_id: string;
  codigo: string;
  nombre: string;
  es_generica: boolean;
  activo: boolean;
  created_at: string;
  updated_at: string;
};

// ─── Árbol completo (GET /api/arbol) ───

export type EquivalenciaArbol = {
  id: string;
  codigo: string;
  nombre: string;
  es_generica: boolean;
  activo: boolean;
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
