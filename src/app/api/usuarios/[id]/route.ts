import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth/guard";
import { error, leerCuerpo, ok } from "@/lib/api/respuestas";
import { editarUsuarioSchema } from "@/lib/usuarios/esquemas";
import { motivoRechazo } from "@/lib/usuarios/reglas";

type Params = { params: Promise<{ id: string }> };

async function cargar(id: string) {
  const db = supabaseAdmin();
  const [{ data: objetivo }, { data: todos }] = await Promise.all([
    db.from("perfiles").select("*").eq("id", id).maybeSingle(),
    db.from("perfiles").select("id, rol, activo"),
  ]);
  return { objetivo, todos: todos ?? [] };
}

/** Edita nombre, rol, activo y/o contraseña (solo admin). */
export async function PATCH(request: NextRequest, { params }: Params) {
  const { perfil: actor, response } = await requireAdmin();
  if (response) return response;

  const { id } = await params;
  const { datos, respuesta } = await leerCuerpo(request, editarUsuarioSchema);
  if (respuesta) return respuesta;

  const { objetivo, todos } = await cargar(id);
  if (!objetivo) return error("Usuario no encontrado.", 404);

  const motivo = motivoRechazo(actor, objetivo, todos, datos);
  if (motivo) return error(motivo, 409);

  const db = supabaseAdmin();

  if (datos.password) {
    const { error: errAuth } = await db.auth.admin.updateUserById(id, {
      password: datos.password,
    });
    if (errAuth) return error(errAuth.message);
  }

  const cambiosPerfil: { nombre?: string | null; rol?: string; activo?: boolean } = {};
  if (datos.nombre !== undefined) cambiosPerfil.nombre = datos.nombre || null;
  if (datos.rol !== undefined) cambiosPerfil.rol = datos.rol;
  if (datos.activo !== undefined) cambiosPerfil.activo = datos.activo;

  if (Object.keys(cambiosPerfil).length === 0) return ok(objetivo);

  const { data, error: err } = await db
    .from("perfiles")
    .update(cambiosPerfil)
    .eq("id", id)
    .select("*")
    .single();

  if (err) return error(err.message);

  // Un usuario desactivado no debe seguir con sesión abierta.
  if (datos.activo === false) {
    await db.auth.admin.signOut(id, "global").catch(() => undefined);
  }

  return ok(data);
}

/** Elimina el usuario de Auth; el perfil cae en cascada. */
export async function DELETE(_request: NextRequest, { params }: Params) {
  const { perfil: actor, response } = await requireAdmin();
  if (response) return response;

  const { id } = await params;
  const { objetivo, todos } = await cargar(id);
  if (!objetivo) return error("Usuario no encontrado.", 404);

  const motivo = motivoRechazo(actor, objetivo, todos, { eliminar: true });
  if (motivo) return error(motivo, 409);

  const { error: errAuth } = await supabaseAdmin().auth.admin.deleteUser(id);
  if (errAuth) return error(errAuth.message);

  return ok({ id });
}
