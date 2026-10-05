/**
 * Vista de la API de M2 para el frontend (docs/modulos/02-marcas.md,
 * "Contratos de API"). Describe el JSON que viaja, no las filas de la base;
 * el backend puede tipar sus respuestas con estos nombres o re-exportarlos
 * desde `tipos.ts`.
 */
import type { CrearCatalogoCuerpo, EditarCatalogoCuerpo } from "@/lib/arbol/tipos-api";
import type { ModoImportacion } from "@/components/importador/tipos";

export type { ModoImportacion };

// ─── Agrupaciones de marca (GET /api/agrupaciones-marca) ───

/** Fila de `agrupaciones_marca` en el listado, con el conteo de marcas (todas) y de marcas activas. */
export type AgrupacionMarcaFila = {
  id: string;
  codigo: string;
  nombre: string;
  orden: number;
  activo: boolean;
  created_at: string;
  updated_at: string;
  /** Marcas que cuelgan de ella, activas o no. */
  marcas: number;
  /** Solo las activas; lo usa el `confirm` de desactivar. */
  marcas_activas: number;
};

/** La agrupación tal como viaja embebida en cada marca. */
export type AgrupacionMarcaEmbebida = Pick<AgrupacionMarcaFila, "id" | "codigo" | "nombre" | "orden" | "activo">;

export type CrearAgrupacionMarcaCuerpo = CrearCatalogoCuerpo;
export type EditarAgrupacionMarcaCuerpo = EditarCatalogoCuerpo;

// ─── Marcas (/api/marcas) ───

export type MarcaFila = {
  id: string;
  codigo: string;
  nombre: string;
  agrupacion_marca_id: string;
  tratamiento_especial: boolean;
  /** Solo con `tratamiento_especial`; ≤ 200 caracteres. */
  nota_tratamiento: string | null;
  activo: boolean;
  created_at: string;
  updated_at: string;
  agrupacion_marca: AgrupacionMarcaEmbebida;
  /** `activo ∧ agrupacion_marca.activo`. */
  vigente: boolean;
};

export type CrearMarcaCuerpo = {
  nombre: string;
  codigo?: string;
  agrupacion_marca_id: string;
  tratamiento_especial?: boolean;
  nota_tratamiento?: string | null;
};

export type EditarMarcaCuerpo = Partial<{
  nombre: string;
  codigo: string;
  agrupacion_marca_id: string;
  tratamiento_especial: boolean;
  nota_tratamiento: string | null;
  activo: boolean;
}>;

// ─── Importador (POST /api/marcas/importar) ───

/** Una fila del archivo ya mapeada; `tratamiento_especial` es `""` si la columna no se mapeó. */
export type FilaImportacionMarca = {
  marca: string;
  agrupacion: string;
  tratamiento_especial: string;
};

export type ImportarMarcasCuerpo = {
  modo: ModoImportacion;
  filas: FilaImportacionMarca[];
};

export type MotivoOmisionMarca =
  | "marca_vacia"
  | "fila_total"
  | "agrupacion_vacia"
  | "agrupacion_desconocida"
  | "agrupacion_inactiva"
  | "tratamiento_invalido"
  | "duplicada_en_archivo";

/** Fila omitida con su contenido normalizado (`tratamiento_especial` tal como vino), para corregir el archivo. */
export type FilaOmitidaMarca = FilaImportacionMarca & {
  fila: number;
  motivo: MotivoOmisionMarca;
  detalle?: string;
  /** Solo en `duplicada_en_archivo`: la primera aparición de la misma marca. */
  fila_original?: number;
};

/** Marca existente cuyo archivo trae otra agrupación o tratamiento; informativo, el importador no la modifica. */
export type DiferenciaImportacionMarca = {
  fila: number;
  marca: string;
  campo: "agrupacion" | "tratamiento_especial";
  /** Legibles: nombre de agrupación o `SI`/`NO`. */
  en_base: string;
  en_archivo: string;
};

export type ReporteImportacionMarcas = {
  modo: ModoImportacion;
  totales: { recibidas: number; procesadas: number; omitidas: number };
  crear: { marcas: number; con_tratamiento_especial: number };
  existentes: { marcas: number };
  existentes_inactivos: { marcas: number };
  diferencias: DiferenciaImportacionMarca[];
  omitidas: FilaOmitidaMarca[];
  /** Primeras 20 como `"LEVI'S → PREMIUM"`. */
  muestra: { marcas: string[] };
};

// ─── Etiquetas de pantalla ───

export const ETIQUETA_MOTIVO_OMISION_MARCA: Record<MotivoOmisionMarca, string> = {
  marca_vacia: "Marca vacía",
  fila_total: "Fila de totales",
  agrupacion_vacia: "Agrupación vacía",
  agrupacion_desconocida: "Agrupación desconocida",
  agrupacion_inactiva: "Agrupación inactiva",
  tratamiento_invalido: "Tratamiento especial no reconocido",
  duplicada_en_archivo: "Duplicada en el archivo",
};

export const ETIQUETA_CAMPO_DIFERENCIA: Record<DiferenciaImportacionMarca["campo"], string> = {
  agrupacion: "Agrupación",
  tratamiento_especial: "Tratamiento especial",
};
