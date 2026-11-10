import type { NextResponse } from "next/server";
import type { ZodType } from "zod";
import { error, errorConCodigo } from "@/lib/api/respuestas";

/**
 * Lectura de la query string de los handlers de `/api/direccion`. Como `leerConsulta` de M7 (`""` cuenta como ausente; `400` con el primer problema en
 * castellano), con dos diferencias: un parámetro REPETIDO se rechaza (no se queda en silencio con el último) y, si el problema trae un código
 * estable (`params.codigo` de un refinamiento, p. ej. `comparar_igual`), la respuesta lo lleva (`{ error, codigo }`). Sin acceso a datos.
 */

type Leido<T> = { datos: T; respuesta: null } | { datos: null; respuesta: NextResponse };

export function leerConsultaDireccion<T>(request: Request, esquema: ZodType<T>): Leido<T> {
  const crudo: Record<string, string> = {};
  for (const [k, v] of new URL(request.url).searchParams) {
    if (v === "") continue;
    if (k in crudo) return { datos: null, respuesta: error(`El parámetro «${k.slice(0, 40)}» está repetido: mándalo una sola vez (las listas van separadas por comas).`, 400) };
    crudo[k] = v;
  }
  const r = esquema.safeParse(crudo);
  if (r.success) return { datos: r.data, respuesta: null };
  const primero = r.error.issues[0];
  const mensaje = primero?.message ?? "Datos inválidos.";
  const codigo = primero && primero.code === "custom" ? (primero.params as { codigo?: unknown } | undefined)?.codigo : undefined;
  return { datos: null, respuesta: typeof codigo === "string" ? errorConCodigo(mensaje, 400, codigo) : error(mensaje, 400) };
}
