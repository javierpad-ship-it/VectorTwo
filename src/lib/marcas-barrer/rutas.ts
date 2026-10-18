import type { NextResponse } from "next/server";
import { z, type ZodType } from "zod";
import { error } from "@/lib/api/respuestas";
import { NO_ENCONTRADA } from "./servicio";

/**
 * Ayudas de los handlers de `/api/marcas-barrer`: leer y validar la query string y el segmento `[marcaId]`. Sin acceso a datos.
 */

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

const uuid = z.uuid();

/** `params` es una Promise en esta versión de Next. Un `marcaId` que no es UUID responde `404` como una marca inexistente. */
export async function leerMarcaId(params: Promise<{ marcaId: string }>): Promise<{ marcaId: string; respuesta: null } | { marcaId: null; respuesta: NextResponse }> {
  const { marcaId } = await params;
  if (!uuid.safeParse(marcaId).success) return { marcaId: null, respuesta: error(NO_ENCONTRADA, 404) };
  return { marcaId, respuesta: null };
}
