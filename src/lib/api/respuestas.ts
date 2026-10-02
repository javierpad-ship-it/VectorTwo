import { NextResponse } from "next/server";
import { z, type ZodType } from "zod";

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

const uuidDeRuta = z.uuid();

type IdDeRuta = { id: string; respuesta: null } | { id: null; respuesta: NextResponse };

/**
 * Lee el `id` de un segmento dinámico (`params` es una Promise en esta versión
 * de Next) y exige que sea un UUID. Si no lo es, responde `404` con el mismo
 * mensaje que usaría el recurso inexistente: para el cliente da igual que el
 * id esté mal formado o que no haya fila, y así Postgres nunca ve un
 * `invalid input syntax for type uuid` (que acabaría en 500).
 */
export async function idDeRuta(params: Promise<{ id: string }>, noEncontrado: string): Promise<IdDeRuta> {
  const { id } = await params;
  if (!uuidDeRuta.safeParse(id).success) return { id: null, respuesta: error(noEncontrado, 404) };
  return { id, respuesta: null };
}
