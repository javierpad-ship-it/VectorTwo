/**
 * Contratos de las piezas genéricas del importador de archivos (CSV/Excel):
 * un importador concreto (árbol, marcas…) declara sus campos y la forma de
 * su fila omitida; el resto (lectura, mapeo, firma, reporte) es compartido.
 */

export type ModoImportacion = "previsualizar" | "aplicar";

/** Un campo que el archivo debe aportar, con los nombres de columna que lo autodetectan. */
export type CampoImportador<C extends string> = {
  campo: C;
  etiqueta: string;
  /** Nombres de columna (ya pasados por `aCodigo`) que lo identifican, en prioridad. */
  alias: string[];
  /** Si falta, Previsualizar se habilita igual y el campo viaja como cadena vacía. */
  opcional?: boolean;
  /** Ayuda que se muestra bajo el selector cuando el campo no está mapeado (solo opcionales). */
  hint?: string;
};

/** Campo → nombre de columna del archivo (`""` si no está mapeado). */
export type Mapeo<C extends string> = Record<C, string>;

export type ArchivoImportacion = {
  nombre: string;
  tamano: number;
  columnas: string[];
  filas: Record<string, string>[];
  /** Hojas del libro Excel (vacío para CSV) y la hoja leída. */
  hojas: string[];
  hoja: string | null;
};

/** Lo que toda fila omitida comparte, sea del importador que sea. */
export type FilaOmitidaBase = {
  fila: number;
  motivo: string;
  /** Detalle opcional (p. ej. el valor que no se reconoció). */
  detalle?: string;
  /** Solo en `duplicada_en_archivo`: la primera aparición de la misma fila. */
  fila_original?: number;
};

/** Lo que todo reporte comparte; cada importador le suma sus conteos. */
export type ReporteImportadorBase = {
  modo: ModoImportacion;
  totales: { recibidas: number; procesadas: number; omitidas: number };
  omitidas: FilaOmitidaBase[];
};

/** Columna de la fila original que se muestra en las tablas de omitidas y se exporta al CSV. */
export type ColumnaOmitida<O extends FilaOmitidaBase> = {
  clave: string;
  titulo: string;
  valor: (o: O) => string;
};
