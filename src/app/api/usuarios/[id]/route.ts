import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth/guard";
import { error, idDeRuta, leerCuerpo, ok } from "@/lib/api/respuestas";
import { traducirErrorDb } from "@/lib/api/errores-db";
import type { UsuarioEliminado } from "@/lib/responsables/tipos";
import { editarUsuarioSchema } from "@/lib/usuarios/esquemas";
import { motivoRechazo } from "@/lib/usuarios/reglas";
import { traducirErrorAuth } from "@/lib/usuarios/errores-auth";

type Params = { params: Promise<{ id: string }> };

const NO_ENCONTRADO = "Usuario no encontrado.";

/** `ban_duration` de Auth: 876 000 h son cien años (el bloqueo no admite "para siempre"); `none` lo quita. */
const BAN_INDEFINIDO = "876000h";
const BAN_NINGUNO = "none";

async function cargar(id: string) {
  const db = supabaseAdmin();
  const [{ data: objetivo }, { data: todos }] = await Promise.all([
    db.from("perfiles").select("*").eq("id", id).maybeSingle(),
    db.from("perfiles").select("id, rol, activo"),
  ]);
  return { objetivo, todos: todos ?? [] };
}

/**
 * Edita nombre, rol, activo y/o contraseña (solo admin). Desactivar bloquea al
 * usuario en Auth (`ban_duration`) y reactivar lo desbloquea; si Auth falla se
 * responde el error y el perfil no se toca.
 */
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

  // Un solo cambio en Auth: la contraseña y/o el bloqueo. Desactivar banea al
  // usuario (no puede iniciar sesión ni renovar la sesión abierta); reactivar
  // quita el bloqueo. Va ANTES de tocar el perfil para que, si falla, no quede
  // un perfil que diga una cosa y Auth otra.
  const cambioAuth: { password?: string; ban_duration?: string } = {};
  if (datos.password) cambioAuth.password = datos.password;
  if (datos.activo !== undefined) cambioAuth.ban_duration = datos.activo ? BAN_NINGUNO : BAN_INDEFINIDO;
  if (Object.keys(cambioAuth).length > 0) {
    const { error: errAuth } = await db.auth.admin.updateUserById(id, cambioAuth);
    if (errAuth) return traducirErrorAuth(errAuth, "editar usuario");
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

  if (err) {
    // Si el perfil no se pudo guardar, el bloqueo de Auth vuelve a como estaba.
    if (datos.activo !== undefined && datos.activo !== objetivo.activo) {
      const { error: errRevertir } = await db.auth.admin.updateUserById(id, {
        ban_duration: objetivo.activo ? BAN_NINGUNO : BAN_INDEFINIDO,
      });
      if (errRevertir) console.error("[auth] editar usuario: no se pudo revertir el bloqueo", id, errRevertir.message);
    }
    return traducirErrorDb(err, "editar usuario");
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
  if (errAuth) return traducirErrorAuth(errAuth, "eliminar usuario");

  const eliminado: UsuarioEliminado = { id, combinaciones_liberadas: count ?? 0 };
  return ok(eliminado);
}
