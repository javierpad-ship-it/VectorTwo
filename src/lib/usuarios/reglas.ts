import type { Tables } from "@/lib/supabase/database.types";

type Perfil = Pick<Tables<"perfiles">, "id" | "rol" | "activo">;

/**
 * Reglas que evitan dejar el sistema sin administradores o que un admin se
 * bloquee a sí mismo. Son funciones puras para poder probarlas con vitest.
 */

export function esElMismo(actor: Perfil, objetivo: Perfil): boolean {
  return actor.id === objetivo.id;
}

/** ¿Después de aplicar `cambios` al objetivo quedaría al menos un admin activo? */
export function quedaAlgunAdminActivo(
  todos: Perfil[],
  objetivo: Perfil,
  cambios: { rol?: string; activo?: boolean; eliminar?: boolean }
): boolean {
  return todos.some((p) => {
    if (p.id !== objetivo.id) return p.rol === "admin" && p.activo;
    if (cambios.eliminar) return false;
    const rol = cambios.rol ?? p.rol;
    const activo = cambios.activo ?? p.activo;
    return rol === "admin" && activo;
  });
}

/**
 * Devuelve el motivo por el que un cambio no se permite, o null si está bien.
 */
export function motivoRechazo(
  actor: Perfil,
  objetivo: Perfil,
  todos: Perfil[],
  cambios: { rol?: string; activo?: boolean; eliminar?: boolean }
): string | null {
  if (esElMismo(actor, objetivo)) {
    if (cambios.eliminar) return "No puedes eliminar tu propio usuario.";
    if (cambios.activo === false) return "No puedes desactivar tu propio usuario.";
    if (cambios.rol && cambios.rol !== "admin") return "No puedes quitarte el rol de administrador.";
  }
  if (!quedaAlgunAdminActivo(todos, objetivo, cambios)) {
    return "El sistema debe conservar al menos un administrador activo.";
  }
  return null;
}
