/**
 * Fachada de tipos de M2b para los componentes de cliente. El origen de verdad
 * es el contrato del backend (`@/lib/marcas/tipos-api`, `@/lib/arbol/tipos-api`),
 * que no arrastra Supabase; acá solo se re-exporta con los alias que usa la
 * pantalla y se suma lo que es puramente de presentación.
 */
import type { ArbolRespuesta } from "@/lib/arbol/tipos-api";
import type { AvisoConjunto, CrearMarcaCuerpo, EditarMarcaCuerpo, FilaImportacionMarca, MarcaFila } from "@/lib/marcas/tipos-api";

export * from "@/lib/marcas/tipos-api";
export type {
  CambioNivel,
  FilaImportacionNivel,
  FilaOmitidaNivel,
  MotivoOmisionNivel,
  NivelBloqueCuerpo,
  NivelBloqueRespuesta,
  ReporteImportacionNivel,
} from "@/lib/arbol/tipos-api";
export { ETIQUETA_MOTIVO_OMISION_NIVEL } from "@/lib/arbol/tipos-api";

/** `GET /api/marcas` ya trae todo lo de M2b: la marca con modalidad, GML y conjunto. */
export type MarcaConGml = MarcaFila;
export type CrearMarcaCuerpoM2b = CrearMarcaCuerpo;
export type EditarMarcaCuerpoM2b = EditarMarcaCuerpo;
export type FilaImportacionMarcaM2b = FilaImportacionMarca;
/** `GET /api/arbol` ya trae `nivel_planificacion` por nodo y `nodos_gmle` / `equivalencias_en_gmle` en el resumen. */
export type ArbolConNivel = ArbolRespuesta;

export const ETIQUETA_AVISO_CONJUNTO: Record<AvisoConjunto, string> = {
  agrupacion_distinta: "Agrupación distinta",
  cabeza_inactiva: "Cabeza inactiva",
  config_propia_ignorada: "Configuración propia ignorada",
  cadena: "Cadena de conjuntos",
};
