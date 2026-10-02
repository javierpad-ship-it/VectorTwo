/**
 * Formas JSON de la API de M1 (docs/modulos/01-arbol-producto.md, "Contratos
 * de API"). Las usa el frontend para tipar lo que recibe y el backend para
 * tipar lo que devuelve: si cambia un contrato, cambia acá primero.
 *
 * No dependen de `Tables<>` a propósito: describen el JSON que viaja, no las
 * filas de la base.
 */
import type { Temporada } from "./normalizar";

export type { Temporada };

// ─── Catálogos planos (/api/generos, /api/mundos, /api/agrupaciones-talla) ───

/** Fila de `generos`, `mundos` o `agrupaciones_talla` tal como la devuelve la API. */
export type CatalogoFila = {
  id: string;
  codigo: string;
  nombre: string;
  orden: number;
  activo: boolean;
  created_at: string;
  updated_at: string;
};

export type AgrupacionTallaFila = CatalogoFila;

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

// ─── Cuerpos de escritura ───

export type CrearCatalogoCuerpo = { nombre: string; codigo?: string; orden?: number };
export type EditarCatalogoCuerpo = Partial<{ nombre: string; codigo: string; orden: number; activo: boolean }>;
export type CrearLineaCuerpo = { nombre: string; codigo?: string; temporada?: Temporada };
export type EditarLineaCuerpo = Partial<{ nombre: string; codigo: string; temporada: Temporada; activo: boolean }>;
export type CrearNodoCuerpo = { genero_id: string; mundo_id: string; linea_id: string };
export type EditarNodoCuerpo = Partial<{ activo: boolean; mundo_id: string }>;
export type CrearEquivalenciaCuerpo = { genero_mundo_linea_id: string; nombre: string; codigo?: string };
export type EditarEquivalenciaCuerpo = Partial<{ nombre: string; codigo: string; activo: boolean }>;

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
  lineas: number;
  nodos: number;
  equivalencias: number;
  nodos_sin_asignar: number;
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

export type ImportarCuerpo = {
  modo: ModoImportacion;
  filas: FilaImportacion[];
};

export type MotivoOmision =
  | "linea_vacia"
  | "fila_total"
  | "genero_desconocido"
  | "mundo_desconocido"
  | "duplicada_en_archivo";

export const ETIQUETA_MOTIVO_OMISION: Record<MotivoOmision, string> = {
  linea_vacia: "Línea vacía",
  fila_total: "Fila de totales",
  genero_desconocido: "Género desconocido",
  mundo_desconocido: "Mundo desconocido",
  duplicada_en_archivo: "Duplicada en el archivo",
};

/** Fila cuyo mundo venía vacío y se planifica bajo SIN ASIGNAR. `fila` es 1-based sobre `filas` enviadas. */
export type FilaSinMundo = {
  fila: number;
  genero: string;
  linea: string;
  equivalencia: string;
};

export type FilaOmitida = {
  fila: number;
  motivo: MotivoOmision;
  /** Detalle opcional (p. ej. el valor que no se reconoció). */
  detalle?: string;
};

export type ConteosCrear = {
  lineas: number;
  nodos: number;
  equivalencias: number;
  equivalencias_genericas: number;
};

export type ConteosExistentes = {
  lineas: number;
  nodos: number;
  equivalencias: number;
};

export type ReporteImportacion = {
  modo: ModoImportacion;
  totales: { recibidas: number; procesadas: number; omitidas: number };
  crear: ConteosCrear;
  existentes: ConteosExistentes;
  existentes_inactivos: ConteosExistentes;
  sin_mundo: FilaSinMundo[];
  omitidas: FilaOmitida[];
  /** Primeros 20 de cada tipo. */
  muestra: { lineas: string[]; nodos: string[] };
};
