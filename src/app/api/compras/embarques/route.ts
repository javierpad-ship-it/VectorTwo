import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth/guard";
import { leerCuerpo, ok } from "@/lib/api/respuestas";
import { leerConsulta } from "@/lib/intercompany/rutas";
import { embarquesQuerySchema, guardarEmbarqueSchema } from "@/lib/compras/agrupadores/esquemas";
import { guardarEmbarque, listarEmbarques, usuarioDe } from "@/lib/compras/agrupadores/servicio";

/**
 * `GET /api/compras/embarques` (`requireUser`): los embarques con totales, responsable efectivo y avisos. Filtros:
 * `?estado&tipo&viaje_id=<uuid>|sin_viaje&desde&hasta&responsable_id&mio=1&atrasados=1&q` (`desde` y `hasta` son meses de llegada;
 * «Mis embarques» es un filtro, nunca un permiso; la cookie del viaje activo no se lee aquí: el viaje llega explícito). `{ embarques }`.
 */
export async function GET(request: NextRequest) {
  const { perfil, rol, response } = await requireUser();
  if (response) return response;

  const { datos, respuesta } = leerConsulta(request, embarquesQuerySchema);
  if (respuesta) return respuesta;
  const r = await listarEmbarques(supabaseAdmin(), usuarioDe(perfil, rol), datos);
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}

/**
 * `POST /api/compras/embarques` (`requireUser`: el comprador crea embarques): crea un embarque (guardar_embarque). La llegada estimada es
 * obligatoria al crear; sin `codigo` se numera con su mes. `409`: `local_con_viaje`, `salida_despues_de_llegada`, `viaje_cancelado`
 * (uno cerrado se acepta con el aviso `viaje_cerrado`), `codigo_duplicado`, `correlativo_agotado`, `responsable_no_asignable`.
 * Respuesta `{ embarque }` con el detalle (201).
 */
export async function POST(request: NextRequest) {
  const { perfil, rol, response } = await requireUser();
  if (response) return response;

  const { datos, respuesta } = await leerCuerpo(request, guardarEmbarqueSchema);
  if (respuesta) return respuesta;
  const r = await guardarEmbarque(supabaseAdmin(), usuarioDe(perfil, rol), datos, null);
  if (r.respuesta) return r.respuesta;
  return ok(r.data, 201);
}
