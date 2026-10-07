import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth/guard";
import { error, leerCuerpo, ok } from "@/lib/api/respuestas";
import { traducirErrorDb } from "@/lib/api/errores-db";
import { crearUsuarioSchema } from "@/lib/usuarios/esquemas";
import { leerAsignaciones } from "@/lib/responsables/consultas";
import { contarPorPerfil } from "@/lib/responsables/reglas";

/**
 * Lista de usuarios (solo admin). Cada perfil suma `responsabilidades`: las
 * filas de `responsables_genero_mundo` con su `perfil_id`, vigentes o no (M1b,
 * para que `/usuarios` avise antes de desactivar, cambiar el rol o eliminar).
 */
export async function GET() {
  const { response } = await requireAdmin();
  if (response) return response;

  const db = supabaseAdmin();
  const { data, error: err } = await db
    .from("perfiles")
    .select("*")
    .order("created_at", { ascending: true });

  if (err) return error(err.message, 500);

  const asignaciones = await leerAsignaciones(db);
  if (asignaciones.error) return traducirErrorDb(asignaciones.error, "listar usuarios: contar responsabilidades");
  const conteo = contarPorPerfil(asignaciones.data);

  return ok(data.map((perfil) => ({ ...perfil, responsabilidades: conteo.get(perfil.id) ?? 0 })));
}

/** Crea el usuario en Auth y su perfil. Si el perfil falla, deshace el usuario de Auth. */
export async function POST(request: NextRequest) {
  const { response } = await requireAdmin();
  if (response) return response;

  const { datos, respuesta } = await leerCuerpo(request, crearUsuarioSchema);
  if (respuesta) return respuesta;

  const db = supabaseAdmin();
  const { data: creado, error: errAuth } = await db.auth.admin.createUser({
    email: datos.email,
    password: datos.password,
    email_confirm: true,
  });

  if (errAuth || !creado.user) {
    return error(traducirErrorAuth(errAuth?.message) ?? "No se pudo crear el usuario.");
  }

  const { data: perfil, error: errPerfil } = await db
    .from("perfiles")
    .insert({
      id: creado.user.id,
      email: datos.email,
      nombre: datos.nombre || null,
      rol: datos.rol,
    })
    .select("*")
    .single();

  if (errPerfil) {
    await db.auth.admin.deleteUser(creado.user.id);
    return error(errPerfil.message);
  }

  return ok(perfil, 201);
}

function traducirErrorAuth(mensaje?: string): string | null {
  if (!mensaje) return null;
  const m = mensaje.toLowerCase();
  if (m.includes("already") && m.includes("registered")) return "Ya existe un usuario con ese correo.";
  if (m.includes("password")) return "La contraseña no cumple los requisitos.";
  return mensaje;
}
