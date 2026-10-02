/**
 * Vista de la API de M1 para el frontend. Todo lo que viaja en las respuestas
 * vive en `tipos.ts` (único origen) y aquí solo se re-exporta; lo propio de
 * este archivo son los cuerpos de petición (`*Cuerpo`) y las etiquetas de
 * pantalla.
 */
import type { MotivoOmision, ModoImportacion, FilaImportacion, Temporada } from "./tipos";

export type {
  AgrupacionTallaFila,
  ArbolRespuesta,
  CatalogoFila,
  ConteosCrear,
  ConteosExistentes,
  EquivalenciaArbol,
  EquivalenciaFila,
  FilaImportacion,
  FilaOmitida,
  FilaSinMundo,
  GeneroArbol,
  LineaArbol,
  LineaFila,
  ModoImportacion,
  MotivoOmision,
  MundoArbol,
  NodoFila,
  ReporteBase,
  ReporteImportacion,
  ResumenArbol,
  Temporada,
} from "./tipos";

// ─── Cuerpos de escritura ───

export type CrearCatalogoCuerpo = { nombre: string; codigo?: string; orden?: number };
export type EditarCatalogoCuerpo = Partial<{ nombre: string; codigo: string; orden: number; activo: boolean }>;
export type CrearLineaCuerpo = { nombre: string; codigo?: string; temporada?: Temporada };
export type EditarLineaCuerpo = Partial<{ nombre: string; codigo: string; temporada: Temporada; activo: boolean }>;
export type CrearNodoCuerpo = { genero_id: string; mundo_id: string; linea_id: string };
export type EditarNodoCuerpo = Partial<{ activo: boolean; mundo_id: string }>;
export type CrearEquivalenciaCuerpo = { genero_mundo_linea_id: string; nombre: string; codigo?: string };
export type EditarEquivalenciaCuerpo = Partial<{ nombre: string; codigo: string; activo: boolean }>;

export type ImportarCuerpo = {
  modo: ModoImportacion;
  filas: FilaImportacion[];
};

// ─── Etiquetas de pantalla ───

export const ETIQUETA_MOTIVO_OMISION: Record<MotivoOmision, string> = {
  linea_vacia: "Línea vacía",
  fila_total: "Fila de totales",
  genero_desconocido: "Género desconocido",
  genero_inactivo: "Género inactivo",
  mundo_desconocido: "Mundo desconocido",
  mundo_inactivo: "Mundo inactivo",
  duplicada_en_archivo: "Duplicada en el archivo",
};
