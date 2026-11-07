import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlanner, requireUser } from "@/lib/auth/guard";
import { idDeRuta, leerCuerpo, ok } from "@/lib/api/respuestas";
import { proveedorEdicionSchema } from "@/lib/proveedores/esquemas";
import { MENSAJE_ERROR_PROVEEDOR } from "@/lib/proveedores/tipos-api";
import { editarProveedor, eliminarProveedor, leerDetalleProveedor } from "@/lib/proveedores/servicio";

type Contexto = { params: Promise<{ id: string }> };

/** `GET /api/compras/proveedores/[id]` (`requireUser`): la ficha con sus contactos y el resumen de sus compras. `404 no_encontrado`. */
export async function GET(_request: NextRequest, { params }: Contexto) {
  const { rol, response } = await requireUser();
  if (response) return response;

  const t = await idDeRuta(params, MENSAJE_ERROR_PROVEEDOR.no_encontrado);
  if (t.respuesta) return t.respuesta;
  const r = await leerDetalleProveedor(supabaseAdmin(), rol, t.id);
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}

/**
 * `PATCH /api/compras/proveedores/[id]` (`requireUser`, decisión 28): ficha y contactos en una transacción, con la `revision` que vio el
 * formulario. `409 proveedor_cambio`, `409 nombre_repetido`, `409 codigo_repetido`, `403 solo_planner_intercompany` (un comprador que
 * cambia `es_intercompany`), `404`.
 */
export async function PATCH(request: NextRequest, { params }: Contexto) {
  const { perfil, rol, response } = await requireUser();
  if (response) return response;

  const t = await idDeRuta(params, MENSAJE_ERROR_PROVEEDOR.no_encontrado);
  if (t.respuesta) return t.respuesta;
  const { datos, respuesta } = await leerCuerpo(request, proveedorEdicionSchema);
  if (respuesta) return respuesta;
  const r = await editarProveedor(supabaseAdmin(), { id: perfil.id, nombre: perfil.nombre ?? perfil.email, rol }, t.id, datos);
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}

/** `DELETE /api/compras/proveedores/[id]` (`requirePlanner`): lo borra si no tiene compras de ningún estado; si tiene, lo desactiva. */
export async function DELETE(_request: NextRequest, { params }: Contexto) {
  const { perfil, rol, response } = await requirePlanner();
  if (response) return response;

  const t = await idDeRuta(params, MENSAJE_ERROR_PROVEEDOR.no_encontrado);
  if (t.respuesta) return t.respuesta;
  const r = await eliminarProveedor(supabaseAdmin(), { id: perfil.id, nombre: perfil.nombre ?? perfil.email, rol }, t.id);
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}
