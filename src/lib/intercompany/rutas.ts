import type { NextResponse } from "next/server";
import type { ZodType } from "zod";
import { error } from "@/lib/api/respuestas";

/** Ayuda de los handlers de `/api/intercompany`: leer y validar la query string. Sin acceso a datos. */

type Leido<T> = { datos: T; respuesta: null } | { datos: null; respuesta: NextResponse };

/** Valida los parámetros de consulta con zod; `""` cuenta como ausente. `400` con el primer problema en castellano. */
export function leerConsulta<T>(request: Request, esquema: ZodType<T>): Leido<T> {
  const crudo: Record<string, string> = {};
  for (const [k, v] of new URL(request.url).searchParams) if (v !== "") crudo[k] = v;
  const r = esquema.safeParse(crudo);
  if (!r.success) {
    const primero = r.error.issues[0];
    const campo = primero?.path.length ? `${primero.path.join(".")}: ` : "";
    return { datos: null, respuesta: error(`${campo}${primero?.message ?? "Datos inválidos."}`, 400) };
  }
  return { datos: r.data, respuesta: null };
}
