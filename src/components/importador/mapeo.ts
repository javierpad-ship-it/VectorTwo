import { aCodigo } from "@/lib/arbol/normalizar";
import type { ArchivoImportacion, CampoImportador, Mapeo } from "./tipos";

/** Funciones puras del mapeo de columnas, probables sin navegador. */

export function mapeoVacio<C extends string>(campos: CampoImportador<C>[]): Mapeo<C> {
  const m = {} as Mapeo<C>;
  for (const { campo } of campos) m[campo] = "";
  return m;
}

/** Autodetecta la columna de cada campo por nombre (sin acentos ni caja: "género" → GENERO). */
export function detectarMapeo<C extends string>(columnas: string[], campos: CampoImportador<C>[]): Mapeo<C> {
  const mapeo = mapeoVacio(campos);
  const usadas = new Set<string>();
  for (const { campo, alias } of campos) {
    for (const a of alias) {
      const col = columnas.find((c) => !usadas.has(c) && aCodigo(c) === a);
      if (col) {
        mapeo[campo] = col;
        usadas.add(col);
        break;
      }
    }
  }
  return mapeo;
}

/** Todos los campos obligatorios tienen columna. */
export function mapeoCompleto<C extends string>(mapeo: Mapeo<C>, campos: CampoImportador<C>[]): boolean {
  return campos.every(({ campo, opcional }) => opcional || mapeo[campo] !== "");
}

/**
 * Identifica "este archivo (y hoja) con este mapeo": una previsualización
 * solo vale para aplicar si la firma no cambió.
 */
export function firmaImportacion<C extends string>(archivo: ArchivoImportacion | null, mapeo: Mapeo<C>): string {
  return archivo ? `${archivo.nombre}|${archivo.tamano}|${archivo.hoja ?? ""}|${archivo.filas.length}|${JSON.stringify(mapeo)}` : "";
}

/** Proyecta cada fila del archivo a los campos declarados; un campo sin columna viaja como `""`. */
export function filasMapeadas<C extends string>(
  archivo: ArchivoImportacion | null,
  mapeo: Mapeo<C>,
  campos: CampoImportador<C>[]
): Record<C, string>[] {
  if (!archivo) return [];
  return archivo.filas.map((f) => {
    const fila = {} as Record<C, string>;
    for (const { campo } of campos) fila[campo] = String(f[mapeo[campo]] ?? "");
    return fila;
  });
}
