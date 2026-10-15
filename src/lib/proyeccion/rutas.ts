import type { NextResponse } from "next/server";
import { z, type ZodType } from "zod";
import { error } from "@/lib/api/respuestas";
import { sinVacios } from "./esquemas";

/**
 * Ayudas de los handlers de `/api/proyeccion`: leer y validar la query string y los segmentos de la ruta. Sin acceso a datos.
 */

type Leido<T> = { datos: T; respuesta: null } | { datos: null; respuesta: NextResponse };

/** Valida los parámetros de consulta con zod; `""` cuenta como ausente. `400` con el primer problema en castellano. */
export function leerConsulta<T>(request: Request, esquema: ZodType<T>): Leido<T> {
  const crudo: Record<string, string> = {};
  for (const [k, v] of new URL(request.url).searchParams) crudo[k] = v;
  const r = esquema.safeParse(sinVacios(crudo));
  if (!r.success) {
    const primero = r.error.issues[0];
    const campo = primero?.path.length ? `${primero.path.join(".")}: ` : "";
    return { datos: null, respuesta: error(`${campo}${primero?.message ?? "Datos inválidos."}`, 400) };
  }
  return { datos: r.data, respuesta: null };
}

const uuid = z.uuid();

/**
 * Lee los segmentos dinámicos de la ruta (`params` es una Promise): los uuid deben serlo (si no, `404` como el recurso
 * inexistente) y `anio` (si se pide) debe ser un entero de cuatro cifras; sin pedirlo vale 0.
 */
export async function leerSegmentos<K extends string>(
  params: Promise<Record<string, string>>,
  uuids: readonly K[],
  noEncontrado: string,
  opciones: { anio?: boolean; libres?: readonly string[] } = {}
): Promise<({ valores: Record<K, string>; anio: number; respuesta: null }) | { valores: null; anio: null; respuesta: NextResponse }> {
  const p = await params;
  const valores = {} as Record<K, string>;
  for (const k of uuids) {
    // Un segmento "libre" no se exige uuid: el servicio lo busca primero en lo ya leído (un valor raro es `404`) y nunca lo manda a Postgres sin comprobar.
    const libre = opciones.libres?.includes(k) ?? false;
    const valido = libre ? /^[\w-]{1,64}$/.test(p[k] ?? "") : uuid.safeParse(p[k]).success;
    if (!valido) return { valores: null, anio: null, respuesta: error(noEncontrado, 404) };
    valores[k] = p[k];
  }
  let anio = 0;
  if (opciones.anio) {
    if (!/^\d{4}$/.test(p.anio ?? "")) return { valores: null, anio: null, respuesta: error("El año debe ser un número de cuatro cifras.", 404) };
    anio = Number(p.anio);
  }
  return { valores, anio, respuesta: null };
}
