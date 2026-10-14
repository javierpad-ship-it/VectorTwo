import { describe, expect, it } from "vitest";
import { MENSAJE_AUTH_INESPERADO, describirErrorAuth } from "@/lib/usuarios/errores-auth";

describe("describirErrorAuth (M-9: sin mensajes crudos de Auth)", () => {
  it("usuario duplicado", () => {
    expect(describirErrorAuth({ message: "A user with this email address has already been registered", code: "email_exists" })).toEqual({
      status: 409,
      mensaje: "Ya existe un usuario con ese correo.",
    });
    expect(describirErrorAuth({ message: "User already registered" }).status).toBe(409);
  });

  it("clave débil, sin repetir el texto de Auth", () => {
    const r = describirErrorAuth({ message: "Password should contain at least one character of each: abc, ABC, 123", code: "weak_password" });
    expect(r).toEqual({ status: 400, mensaje: "La contraseña no cumple los requisitos." });
  });

  it("usuario inexistente", () => {
    expect(describirErrorAuth({ message: "User not found", code: "user_not_found" })).toEqual({ status: 404, mensaje: "Usuario no encontrado." });
  });

  it("cualquier otro error es genérico y no filtra el detalle", () => {
    const crudo = "failed to connect to host=db.internal.example user=supabase_auth_admin: connection refused";
    const r = describirErrorAuth({ message: crudo, status: 500 });
    expect(r).toEqual({ status: 500, mensaje: MENSAJE_AUTH_INESPERADO });
    expect(r.mensaje).not.toContain("internal");
  });
});
