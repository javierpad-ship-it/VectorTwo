import type { NextRequest } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlanner, requireUser } from "@/lib/auth/guard";
import { error, leerCuerpo, ok } from "@/lib/api/respuestas";
import { traducirErrorDb } from "@/lib/api/errores-db";
import { incluirInactivos } from "@/lib/api/catalogo";
import { crearEquivalenciaSchema } from "@/lib/arbol/esquemas";
import { motivoRechazoEquivalencia } from "@/lib/arbol/reglas";
import { ordenarEquivalencias } from "@/lib/arbol/armar-arbol";

const nodoIdSchema = z.uuid();

/**
 * Equivalencias de un nodo (`requireUser`): `?nodo_id=` obligatorio, reales
 * por `nombre` y la genérica al final; `?incluir_inactivos=1`.
 */
export async function GET(request: NextRequest) {
  const { response } = await requireUser();
  if (response) return response;

  const crudo = request.nextUrl.searchParams.get("nodo_id");
  const nodoId = nodoIdSchema.safeParse(crudo);
  if (!crudo) return error("Falta el parámetro nodo_id.", 400);
  if (!nodoId.success) return error("nodo_id no es un identificador válido.", 400);

  let consulta = supabaseAdmin().from("equivalencias").select("*").eq("genero_mundo_linea_id", nodoId.data);
  if (!incluirInactivos(request)) consulta = consulta.eq("activo", true);

  const { data, error: err } = await consulta.order("nombre");
  if (err) return traducirErrorDb(err);
  return ok(ordenarEquivalencias(data ?? []));
}

/**
 * Crea una equivalencia en un nodo (`requirePlanner`), 201. Un nombre vacío,
 * `-` o `SIN EQUIVALENCIA` crea la genérica del nodo. `404` nodo inexistente ·
 * `409` segunda genérica o nombre/código repetido en el nodo.
 */
export async function POST(request: NextRequest) {
  const { response } = await requirePlanner();
  if (response) return response;

  const { datos, respuesta } = await leerCuerpo(request, crearEquivalenciaSchema);
  if (respuesta) return respuesta;

  const db = supabaseAdmin();
  const [{ data: nodo, error: errNodo }, { data: hermanas, error: errHermanas }] = await Promise.all([
    db.from("genero_mundo_linea").select("id").eq("id", datos.genero_mundo_linea_id).maybeSingle(),
    db
      .from("equivalencias")
      .select("id, nombre, codigo, es_generica, activo")
      .eq("genero_mundo_linea_id", datos.genero_mundo_linea_id),
  ]);
  if (errNodo) return traducirErrorDb(errNodo);
  if (!nodo) return error("Nodo no encontrado.", 404);
  if (errHermanas) return traducirErrorDb(errHermanas);

  const motivo = motivoRechazoEquivalencia(hermanas ?? [], datos);
  if (motivo) return error(motivo, 409);

  const { data, error: err } = await db.from("equivalencias").insert(datos).select("*").single();
  if (err) return traducirErrorDb(err);
  return ok(data, 201);
}
