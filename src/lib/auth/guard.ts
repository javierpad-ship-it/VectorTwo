import type { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { Tables } from "@/lib/supabase/database.types";
import { error } from "@/lib/api/respuestas";
import { esAdmin, normalizarRol, puedeEditarMaestros, type Rol } from "./roles";

/**
 * Guards de los route handlers. Todos devuelven o bien el contexto del
 * usuario, o bien la respuesta HTTP con la que hay que cortar la petición:
 *
 *   const { perfil, response } = await requireAdmin();
 *   if (response) return response;
 */

export type Contexto = { user: User; perfil: Tables<"perfiles">; rol: Rol };

type Resultado =
  | (Contexto & { response: null })
  | { user: null; perfil: null; rol: null; response: NextResponse };

function rechazo(mensaje: string, status: number): Resultado {
  return { user: null, perfil: null, rol: null, response: error(mensaje, status) };
}

/** Sesión válida + perfil activo. Base de todos los demás guards. */
export async function requireUser(): Promise<Resultado> {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return rechazo("No autenticado.", 401);

  const { data: perfil } = await supabaseAdmin()
    .from("perfiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (!perfil) return rechazo("Tu usuario no tiene perfil en el sistema.", 403);
  if (!perfil.activo) return rechazo("Tu usuario está desactivado.", 403);

  return { user, perfil, rol: normalizarRol(perfil.rol), response: null };
}

/** Admin o planner: quienes pueden escribir maestros y planificación. */
export async function requirePlanner(): Promise<Resultado> {
  const r = await requireUser();
  if (r.response) return r;
  if (!puedeEditarMaestros(r.rol)) return rechazo("Tu rol es de solo lectura.", 403);
  return r;
}

/** Solo admin: administración de usuarios y maestros raíz. */
export async function requireAdmin(): Promise<Resultado> {
  const r = await requireUser();
  if (r.response) return r;
  if (!esAdmin(r.rol)) return rechazo("Requiere permisos de administrador.", 403);
  return r;
}

/**
 * Versión para Server Components (layouts/páginas), donde no se devuelve
 * una respuesta HTTP sino que se decide qué renderizar.
 */
export async function perfilActual(): Promise<
  | { estado: "sin_sesion" }
  | { estado: "sin_perfil"; email: string }
  | { estado: "inactivo"; email: string }
  | { estado: "ok"; perfil: Tables<"perfiles">; rol: Rol }
> {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { estado: "sin_sesion" };

  const { data: perfil } = await supabaseAdmin()
    .from("perfiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (!perfil) return { estado: "sin_perfil", email: user.email ?? "" };
  if (!perfil.activo) return { estado: "inactivo", email: perfil.email };
  return { estado: "ok", perfil, rol: normalizarRol(perfil.rol) };
}
