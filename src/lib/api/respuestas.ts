import { NextResponse } from "next/server";
import { z, type ZodType } from "zod";

/**
 * Las respuestas de la API llevan datos de planificación y nunca deben quedar
 * en una caché del navegador, del service worker (PWA) ni de un proxy.
 */
const SIN_CACHE = { "Cache-Control": "no-store" } as const;

/** Respuesta de éxito: `{ data }`. */
export function ok<T>(data: T, status = 200) {
  return NextResponse.json({ data }, { status, headers: SIN_CACHE });
}

/** Respuesta de error: `{ error }` con un mensaje legible para la pantalla. */
export function error(mensaje: string, status = 400) {
  return NextResponse.json({ error: mensaje }, { status, headers: SIN_CACHE });
}

/**
 * Error con un código estable (`{ error, codigo }`) para que la pantalla distinga un `409` de otro sin leer el texto
 * (p. ej. `huella_cambiada`, `modalidad_destino_requerida`).
 */
export function errorConCodigo(mensaje: string, status: number, codigo: string) {
  return NextResponse.json({ error: mensaje, codigo }, { status, headers: SIN_CACHE });
}

/**
 * Tope del cuerpo JSON de cualquier petición: 6 MB. Lo más pesado que manda la
 * pantalla son tandas de venta (10 000 filas, unos 400 KB) y las cargas de
 * 10 000 filas de los importadores (pocos MB como mucho); los bloques de 2 MB
 * son de lectura del archivo en el navegador y no viajan tal cual.
 */
export const MAX_BYTES_CUERPO = 6 * 1024 * 1024;
const MENSAJE_CUERPO_GRANDE = "La petición es demasiado grande (el máximo es 6 MB). Divide el archivo en partes más pequeñas.";

type Parseado<T> = { datos: T; respuesta: null } | { datos: null; respuesta: NextResponse };

/**
 * Lee y valida el JSON del cuerpo con un esquema zod. Si no pasa, devuelve
 * una respuesta 400 con el primer problema en castellano llano.
 */
export async function leerCuerpo<T>(request: Request, esquema: ZodType<T>): Promise<Parseado<T>> {
  const declarado = Number(request.headers.get("content-length"));
  if (Number.isFinite(declarado) && declarado > MAX_BYTES_CUERPO) {
    return { datos: null, respuesta: error(MENSAJE_CUERPO_GRANDE, 413) };
  }

  let crudo: unknown;
  try {
    const texto = await request.text();
    // Sin `content-length` (transferencia por trozos) el tamaño real manda.
    if (Buffer.byteLength(texto, "utf8") > MAX_BYTES_CUERPO) return { datos: null, respuesta: error(MENSAJE_CUERPO_GRANDE, 413) };
    crudo = JSON.parse(texto);
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
