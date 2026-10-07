import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth/guard";
import { error, idDeRuta, leerCuerpo, ok } from "@/lib/api/respuestas";
import { traducirErrorDb } from "@/lib/api/errores-db";
import type { UsuarioEliminado } from "@/lib/responsables/tipos";
import { editarUsuarioSchema } from "@/lib/usuarios/esquemas";
import { motivoRechazo } from "@/lib/usuarios/reglas";

type Params = { params: Promise<{ id: string }> };

const NO_ENCONTRADO = "Usuario no encontrado.";

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

  const { id, respuesta: respuestaId } = await idDeRuta(params, NO_ENCONTRADO);
  if (respuestaId) return respuestaId;
  const { datos, respuesta } = await leerCuerpo(request, editarUsuarioSchema);
  if (respuesta) return respuesta;

  const { objetivo, todos } = await cargar(id);
  if (!objetivo) return error(NO_ENCONTRADO, 404);

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

/**
 * Elimina el usuario de Auth; el perfil y sus responsabilidades (M1b) caen en
 * cascada. Cuenta las responsabilidades antes de borrar y las devuelve en
 * `combinaciones_liberadas`; nunca responde `409` por tenerlas (esas
 * combinaciones quedan sin asignar, respuesta 3 de Javier).
 */
export async function DELETE(_request: NextRequest, { params }: Params) {
  const { perfil: actor, response } = await requireAdmin();
  if (response) return response;

  const { id, respuesta } = await idDeRuta(params, NO_ENCONTRADO);
  if (respuesta) return respuesta;
  const { objetivo, todos } = await cargar(id);
  if (!objetivo) return error(NO_ENCONTRADO, 404);

  const motivo = motivoRechazo(actor, objetivo, todos, { eliminar: true });
  if (motivo) return error(motivo, 409);

  const db = supabaseAdmin();
  const { count, error: errConteo } = await db
    .from("responsables_genero_mundo")
    .select("id", { count: "exact", head: true })
    .eq("perfil_id", id);
  if (errConteo) return traducirErrorDb(errConteo, "eliminar usuario: contar responsabilidades");

  const { error: errAuth } = await db.auth.admin.deleteUser(id);
  if (errAuth) return error(errAuth.message);

  const eliminado: UsuarioEliminado = { id, combinaciones_liberadas: count ?? 0 };
  return ok(eliminado);
}
