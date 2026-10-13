/**
 * Vista de la API de M1 para el frontend. Todo lo que viaja en las respuestas
 * vive en `tipos.ts` (único origen) y aquí solo se re-exporta; lo propio de
 * este archivo son los cuerpos de petición (`*Cuerpo`) y las etiquetas de
 * pantalla.
 */
import type {
  MotivoOmision,
  MotivoOmisionNivel,
  ModoImportacion,
  FilaImportacion,
  NivelPlanificacion,
  Temporada,
} from "./tipos";

export type {
  AgrupacionTallaFila,
  ArbolRespuesta,
  CambioNivel,
  CatalogoFila,
  ConteosCrear,
  ConteosExistentes,
  EquivalenciaArbol,
  EquivalenciaFila,
  FilaImportacion,
  FilaImportacionNivel,
  FilaOmitida,
  FilaOmitidaNivel,
  GeneroArbol,
  ImportarNivelCuerpo,
  LineaArbol,
  LineaFila,
  ModoImportacion,
  MotivoOmision,
  MotivoOmisionNivel,
  MotivoResolverGml,
  MundoArbol,
  NivelBloqueCuerpo,
  NivelBloqueRespuesta,
  NivelPlanificacion,
  NodoFila,
  ReporteBase,
  ReporteImportacion,
  ReporteImportacionNivel,
  ReporteNivelBase,
  ResumenArbol,
  Temporada,
} from "./tipos";

// ─── Cuerpos de escritura ───

export type CrearCatalogoCuerpo = { nombre: string; codigo?: string; orden?: number };
export type EditarCatalogoCuerpo = Partial<{ nombre: string; codigo: string; orden: number; activo: boolean }>;
export type CrearLineaCuerpo = { nombre: string; codigo?: string; temporada?: Temporada };
export type EditarLineaCuerpo = Partial<{ nombre: string; codigo: string; temporada: Temporada; activo: boolean }>;
export type CrearNodoCuerpo = { genero_id: string; mundo_id: string; linea_id: string };
export type EditarNodoCuerpo = Partial<{ activo: boolean; mundo_id: string; nivel_planificacion: NivelPlanificacion }>;
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
  mundo_vacio: "Mundo vacío",
  mundo_desconocido: "Mundo desconocido",
  mundo_inactivo: "Mundo inactivo",
  duplicada_en_archivo: "Duplicada en el archivo",
};

/** Etiquetas de pantalla de los motivos del importador de niveles de planificación (02b). */
export const ETIQUETA_MOTIVO_OMISION_NIVEL: Record<MotivoOmisionNivel, string> = {
  fila_total: "Fila de totales",
  genero_vacio: "Género vacío",
  genero_desconocido: "Género desconocido",
  genero_inactivo: "Género inactivo",
  mundo_vacio: "Mundo vacío",
  mundo_desconocido: "Mundo desconocido",
  mundo_inactivo: "Mundo inactivo",
  linea_vacia: "Línea vacía",
  linea_desconocida: "Línea desconocida",
  linea_inactiva: "Línea inactiva",
  gml_inexistente: "Esa línea no está en ese género y mundo",
  gml_inactivo: "Nodo inactivo",
  nivel_vacio: "Nivel vacío",
  nivel_invalido: "Nivel no reconocido (usa GML o GMLE)",
  duplicada_en_archivo: "Duplicada en el archivo",
};
