import { NextResponse } from "next/server";
import type { ZodType } from "zod";

/** Respuesta de éxito: `{ data }`. */
export function ok<T>(data: T, status = 200) {
  return NextResponse.json({ data }, { status });
}

/** Respuesta de error: `{ error }` con un mensaje legible para la pantalla. */
export function error(mensaje: string, status = 400) {
  return NextResponse.json({ error: mensaje }, { status });
}

type Parseado<T> = { datos: T; respuesta: null } | { datos: null; respuesta: NextResponse };

/**
 * Lee y valida el JSON del cuerpo con un esquema zod. Si no pasa, devuelve
 * una respuesta 400 con el primer problema en castellano llano.
 */
export async function leerCuerpo<T>(request: Request, esquema: ZodType<T>): Promise<Parseado<T>> {
  let crudo: unknown;
  try {
    crudo = await request.json();
  } catch {
    return { datos: null, respuesta: error("El cuerpo de la petición no es JSON válido.") };
  }

  const resultado = esquema.safeParse(crudo);
  if (!resultado.success) {
    const primero = resultado.error.issues[0];
    const campo = primero?.path.length ? `${primero.path.join(".")}: ` : "";
    return { datos: null, respuesta: error(`${campo}${primero?.message ?? "Datos inválidos."}`) };
  }

  return { datos: resultado.data, respuesta: null };
}
