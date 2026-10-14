import type { NextResponse } from "next/server";
import { error } from "@/lib/api/respuestas";

/**
 * Traducción de errores de Supabase Auth a mensajes de pantalla. El texto
 * crudo de Auth (`err.message`) puede nombrar proveedores, parámetros o
 * políticas internas y nunca viaja al cliente: solo se reconocen los casos
 * que el administrador puede corregir; el resto es un mensaje genérico y el
 * detalle va a `console.error`.
 *
 * `describirErrorAuth` es pura (probada en tests/usuarios.errores-auth.test.ts);
 * `traducirErrorAuth` la envuelve en la respuesta HTTP y registra el error.
 */

export type ErrorAuth = { message: string; code?: string; status?: number };
export type DescripcionErrorAuth = { status: number; mensaje: string };

export const MENSAJE_AUTH_INESPERADO = "No se pudo completar la operación con el sistema de usuarios. Inténtalo de nuevo.";

export function describirErrorAuth(err: ErrorAuth): DescripcionErrorAuth {
  const codigo = (err.code ?? "").toLowerCase();
  const m = err.message.toLowerCase();
  if (codigo === "email_exists" || codigo === "user_already_exists" || (m.includes("already") && (m.includes("registered") || m.includes("exists")))) {
    return { status: 409, mensaje: "Ya existe un usuario con ese correo." };
  }
  if (codigo === "weak_password" || m.includes("password")) {
    return { status: 400, mensaje: "La contraseña no cumple los requisitos." };
  }
  if (codigo === "user_not_found" || (m.includes("user") && m.includes("not found"))) {
    return { status: 404, mensaje: "Usuario no encontrado." };
  }
  return { status: 500, mensaje: MENSAJE_AUTH_INESPERADO };
}

/** Respuesta HTTP para un error de Auth; el detalle va solo al log del servidor. */
export function traducirErrorAuth(err: ErrorAuth, accion: string): NextResponse {
  const { status, mensaje } = describirErrorAuth(err);
  if (status === 500) console.error(`[auth] ${accion}:`, { code: err.code, status: err.status, message: err.message });
  return error(mensaje, status);
}
