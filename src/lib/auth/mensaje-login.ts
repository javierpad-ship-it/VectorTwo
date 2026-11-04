/**
 * Mensaje que ve la persona cuando falla `signInWithPassword`.
 *
 * Solo se distinguen dos casos con texto propio:
 *  - credenciales inválidas: un único mensaje para «el correo no existe» y
 *    «la clave es errónea» (Auth responde igual a los dos; aquí tampoco se
 *    separan, para no permitir enumerar cuentas);
 *  - usuario desactivado (baneado en Auth).
 * Todo lo demás (límite de intentos, correo sin confirmar, red caída, fallos
 * internos del proveedor) se resume en un mensaje genérico: el texto crudo de
 * Auth no se enseña (auditoría S-08).
 */

export const MENSAJE_LOGIN_CREDENCIALES = "Correo o contraseña incorrectos.";
export const MENSAJE_LOGIN_DESACTIVADO = "Tu usuario está desactivado. Contacta con un administrador.";
export const MENSAJE_LOGIN_GENERICO = "No se pudo iniciar sesión. Inténtalo de nuevo.";

/** Lo mínimo que se lee de un `AuthError` de Supabase. */
export type ErrorDeLogin = { message?: string; code?: string; status?: number };

export function mensajeDeLogin(err: ErrorDeLogin): string {
  const codigo = err.code?.toLowerCase();
  const texto = (err.message ?? "").toLowerCase();

  // Con `code` (supabase-js 2.x lo trae) se decide por él; el texto es respaldo para versiones sin código.
  if (codigo === "invalid_credentials" || (!codigo && texto.includes("invalid login credentials"))) {
    return MENSAJE_LOGIN_CREDENCIALES;
  }
  if (codigo === "user_banned" || (!codigo && texto.includes("banned"))) {
    return MENSAJE_LOGIN_DESACTIVADO;
  }
  return MENSAJE_LOGIN_GENERICO;
}
