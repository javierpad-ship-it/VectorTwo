import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth/guard";
import { error, ok } from "@/lib/api/respuestas";
import { traducirErrorDb } from "@/lib/api/errores-db";
import { incluirInactivos } from "@/lib/api/catalogo";
import { filtrosAperturasSchema } from "@/lib/tiendas/esquemas";
import { leerTiendas } from "@/lib/tiendas/consultas";
import { hoyLima } from "@/lib/tiendas/estado";
import { eventosTiendas } from "@/lib/tiendas/aperturas";
import type { ReporteAperturas } from "@/lib/tiendas/tipos";

/**
 * Línea de tiempo de aperturas y cierres (`requireUser`): un evento por
 * fecha registrada, por `fecha` y `codigo`, con `pasado`, el `estado` de la
 * tienda a `hoy` y el resumen. `desde`/`hasta` acotan por fecha (inclusive);
 * `hoy` simula otra fecha; `400` si alguno no es `aaaa-mm-dd`.
 * `?incluir_inactivos=1` incluye las desactivadas.
 */
export async function GET(request: NextRequest) {
  const { response } = await requireUser();
  if (response) return response;

  const crudo: Record<string, string> = {};
  for (const clave of ["desde", "hasta", "hoy"]) {
    const v = request.nextUrl.searchParams.get(clave);
    if (v !== null && v !== "") crudo[clave] = v;
  }
  const parseado = filtrosAperturasSchema.safeParse(crudo);
  if (!parseado.success) {
    const primero = parseado.error.issues[0];
    return error(`${primero.path.join(".")}: ${primero.message}`, 400);
  }
  const { desde, hasta } = parseado.data;
  const hoy = parseado.data.hoy ?? hoyLima();

  const db = supabaseAdmin();
  const { data, error: err } = await leerTiendas(db, { soloActivas: !incluirInactivos(request) });
  if (err) return traducirErrorDb(err, "listar aperturas");

  const reporte: ReporteAperturas = eventosTiendas(data, hoy, { desde, hasta });
  return ok(reporte);
}
