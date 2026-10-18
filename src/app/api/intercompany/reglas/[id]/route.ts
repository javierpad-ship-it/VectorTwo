import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlanner } from "@/lib/auth/guard";
import { idDeRuta, leerCuerpo, ok } from "@/lib/api/respuestas";
import { editarReglaSchema } from "@/lib/intercompany/esquemas";
import { NO_ENCONTRADA, editarRegla, eliminarRegla } from "@/lib/intercompany/servicio";

type Params = { params: Promise<{ id: string }> };

/**
 * Edita rango IMI, porcentaje directo y/o nota de una regla (`requirePlanner`, escribe: M13). La fecha no se edita: se elimina y se
 * crea. `404` si no existe; `400` si el tope resultante es menor que el mínimo resultante (`codigo: rango_invalido`). Repetir la
 * misma edición responde la regla sin escribir.
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  const { perfil, response } = await requirePlanner();
  if (response) return response;

  const { id, respuesta: respuestaId } = await idDeRuta(params, NO_ENCONTRADA);
  if (respuestaId) return respuestaId;
  const { datos, respuesta } = await leerCuerpo(request, editarReglaSchema);
  if (respuesta) return respuesta;
  const r = await editarRegla(supabaseAdmin(), id, datos, { id: perfil.id, nombre: perfil.nombre });
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}

/**
 * Elimina una regla (`requirePlanner`, escribe: M13): borra la fila. Responde `{ id, regla_anterior_id }`: la regla anterior de la
 * misma clave exacta vuelve a regir desde entonces (`null` si no había). `404` si no existe (también al repetir).
 */
export async function DELETE(_request: NextRequest, { params }: Params) {
  const { response } = await requirePlanner();
  if (response) return response;

  const { id, respuesta } = await idDeRuta(params, NO_ENCONTRADA);
  if (respuesta) return respuesta;
  const r = await eliminarRegla(supabaseAdmin(), id);
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}
