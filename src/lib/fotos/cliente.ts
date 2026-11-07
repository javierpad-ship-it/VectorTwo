import { LADO_MAX_FOTO, LADO_MAX_MINIATURA, MAX_BYTES_FOTO, MAX_BYTES_MINIATURA, MAX_FOTOS_POR_LINEA } from "./constantes";
import type { FichaLinea } from "./esquemas";
import type { LineaFichaApi } from "./tipos-api";

/**
 * Lógica pura de las pantallas de fotos (08c, §4.3): qué se acepta del teléfono, cuántas caben, cómo se reduce la foto en el navegador y
 * cómo se arma el cuerpo de la ficha de la línea. Sin React ni APIs del navegador: todo lo que toca `canvas` está en
 * `src/components/fotos/comprimir.ts` y recibe aquí sus decisiones. El servidor vuelve a validar todo (R2, R3).
 */

/** Se rechazan en el navegador los originales de más de 30 MB (§4.3). */
export const MAX_BYTES_ORIGINAL = 30 * 1024 * 1024;

/** Calidades JPEG que se prueban, de mejor a peor, hasta que la foto pese ≤ 400 KB (§4.3, paso 3). */
export const CALIDADES_FOTO: readonly number[] = [0.82, 0.72, 0.62];
/** La miniatura sale a 0,75 y, si pasara de 60 KB, baja de calidad (la API la rechazaría). */
export const CALIDADES_MINIATURA: readonly number[] = [0.75, 0.65, 0.55, 0.45];

export const MENSAJE_FORMATO_NO_COMPATIBLE = "Formato no compatible: expórtala como JPEG.";
export const MENSAJE_ORIGINAL_GRANDE = "La foto original pesa más de 30 MB. Elige otra o reduce su tamaño antes de subirla.";
export const MENSAJE_NO_SE_PUDO_REDUCIR = "No pudimos reducir la foto lo suficiente. Prueba con otra.";

export type ArchivoCandidato = { size: number; type: string };

/** Mensaje si el archivo no se puede ni intentar (demasiado grande, o declara un tipo que no es imagen); `null` si se puede intentar. */
export function motivoArchivoRechazado(a: ArchivoCandidato): string | null {
  if (a.size > MAX_BYTES_ORIGINAL) return MENSAJE_ORIGINAL_GRANDE;
  if (a.size <= 0) return "El archivo está vacío.";
  // Algunos teléfonos no declaran el tipo (cadena vacía): se intenta abrir igual. Si declara otro que no es imagen, no.
  if (a.type !== "" && !a.type.toLowerCase().startsWith("image/")) return "El archivo no es una imagen.";
  return null;
}

/** Cuántas fotos más caben en la línea (activas + subidas en curso contra el tope de 3). Nunca negativo. */
export function cupoDeFotos(activas: number, enCurso: number): number {
  return Math.max(0, MAX_FOTOS_POR_LINEA - Math.max(0, activas) - Math.max(0, enCurso));
}

export type SeleccionArchivos<T> = { aceptados: T[]; sobrantes: number; rechazados: { archivo: T; motivo: string }[] };

/** De lo que eligió el usuario: los que caben (en orden), cuántos sobran por el tope de 3 y los que no sirven, con su motivo. */
export function seleccionarArchivos<T extends ArchivoCandidato>(elegidos: readonly T[], cupo: number): SeleccionArchivos<T> {
  const aceptados: T[] = [];
  const rechazados: { archivo: T; motivo: string }[] = [];
  let sobrantes = 0;
  for (const archivo of elegidos) {
    const motivo = motivoArchivoRechazado(archivo);
    if (motivo) rechazados.push({ archivo, motivo });
    else if (aceptados.length < cupo) aceptados.push(archivo);
    else sobrantes += 1;
  }
  return { aceptados, sobrantes, rechazados };
}

/** «Solo caben 2 fotos más: 1 no se subió.» (o `null` si no sobró nada). */
export function avisoSobrantes(sobrantes: number, cupo: number): string | null {
  if (sobrantes <= 0) return null;
  const caben = cupo === 1 ? "Solo cabe 1 foto más" : cupo === 0 ? "La línea ya tiene 3 fotos" : `Solo caben ${cupo} fotos más`;
  return `${caben}: ${sobrantes === 1 ? "1 no se subió" : `${sobrantes} no se subieron`}.`;
}

/** `2/3`. */
export const contadorFotos = (activas: number): string => `${Math.min(Math.max(0, activas), MAX_FOTOS_POR_LINEA)}/${MAX_FOTOS_POR_LINEA}`;

export type Dimensiones = { ancho: number; alto: number };

/**
 * Tamaños intermedios para reducir sin perder nitidez (§4.3, paso 3): si el origen es más de ×2 mayor que el destino, se reduce a la mitad
 * una y otra vez y el último paso llega al destino exacto. `[]` si el origen ya es del tamaño del destino. Siempre termina en `destino`.
 */
export function pasosDeReduccion(origen: Dimensiones, destino: Dimensiones): Dimensiones[] {
  if (!(origen.ancho > 0) || !(origen.alto > 0) || !(destino.ancho > 0) || !(destino.alto > 0)) return [];
  if (origen.ancho === destino.ancho && origen.alto === destino.alto) return [];
  const pasos: Dimensiones[] = [];
  let ancho = origen.ancho;
  let alto = origen.alto;
  while (ancho > destino.ancho * 2 || alto > destino.alto * 2) {
    ancho = Math.max(destino.ancho, Math.ceil(ancho / 2));
    alto = Math.max(destino.alto, Math.ceil(alto / 2));
    pasos.push({ ancho, alto });
  }
  pasos.push({ ancho: destino.ancho, alto: destino.alto });
  return pasos;
}

/**
 * Codifica con la primera calidad que deja el archivo dentro del peso máximo. `codificar` devuelve el JPEG (o `null` si el navegador no pudo).
 * Devuelve `null` si ninguna calidad alcanza. Las calidades se prueban en el orden dado y no se sigue después de la primera que sirve.
 */
export async function codificarHastaCaber<B extends { size: number }>(
  codificar: (calidad: number) => Promise<B | null>,
  calidades: readonly number[],
  maxBytes: number,
): Promise<B | null> {
  for (const calidad of calidades) {
    const blob = await codificar(calidad);
    if (blob && blob.size > 0 && blob.size <= maxBytes) return blob;
  }
  return null;
}

/** Los límites que el servidor exige (los mismos de `src/lib/fotos/constantes.ts`), juntos para que la pantalla y la prueba los lean de un sitio. */
export const LIMITES_SUBIDA = {
  fotoLado: LADO_MAX_FOTO,
  fotoBytes: MAX_BYTES_FOTO,
  miniaturaLado: LADO_MAX_MINIATURA,
  miniaturaBytes: MAX_BYTES_MINIATURA,
} as const;

// ─── Ficha de la línea (descripción y modelo) ───

export type BorradorFichaLinea = { descripcion: string; modelo: string };

export const borradorDeFicha = (f: { descripcion: string | null; modelo: string | null }): BorradorFichaLinea => ({ descripcion: f.descripcion ?? "", modelo: f.modelo ?? "" });

const aNulo = (s: string): string | null => (s.trim() === "" ? null : s.trim());

/** ¿El borrador difiere de lo guardado (comparando recortado y con «vacío = sin texto»)? */
export function fichaCambio(guardada: { descripcion: string | null; modelo: string | null }, borrador: BorradorFichaLinea): boolean {
  return aNulo(borrador.descripcion) !== (guardada.descripcion ?? null) || aNulo(borrador.modelo) !== (guardada.modelo ?? null);
}

/** Cuerpo de `PATCH …/ficha`: lo nuevo y, en `antes`, lo que vio el formulario (control de concurrencia `linea_cambio`). */
export function cuerpoFichaLinea(guardada: { descripcion: string | null; modelo: string | null }, borrador: BorradorFichaLinea): FichaLinea {
  return {
    descripcion: aNulo(borrador.descripcion),
    modelo: aNulo(borrador.modelo),
    antes: { descripcion: guardada.descripcion ?? null, modelo: guardada.modelo ?? null },
  };
}

/** Lo que dice `409 linea_cambio` en `actual` (`{ descripcion, modelo }`); `null` si no viene bien formado. */
export function fichaActualDeConflicto(cuerpo: Record<string, unknown> | null): { descripcion: string | null; modelo: string | null } | null {
  const a = cuerpo?.actual;
  if (typeof a !== "object" || a === null) return null;
  const { descripcion, modelo } = a as Record<string, unknown>;
  const t = (v: unknown) => (typeof v === "string" ? v : null);
  return { descripcion: t(descripcion), modelo: t(modelo) };
}

/** `Jean slim azul medio · DL-2231`, o `Sin descripción ni modelo`. */
export function textoFichaLinea(f: Pick<LineaFichaApi, "descripcion" | "modelo">): string {
  const partes = [f.descripcion, f.modelo ? `modelo ${f.modelo}` : null].filter((p): p is string => Boolean(p));
  return partes.length > 0 ? partes.join(" · ") : "Sin descripción ni modelo";
}
