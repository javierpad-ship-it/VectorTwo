import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  MENSAJE_LOGIN_CREDENCIALES,
  MENSAJE_LOGIN_DESACTIVADO,
  MENSAJE_LOGIN_GENERICO,
  mensajeDeLogin,
} from "@/lib/auth/mensaje-login";

describe("mensajeDeLogin (auditoría S-08)", () => {
  it("usuario inexistente y clave errónea dan exactamente el mismo mensaje", () => {
    // Auth responde igual a los dos casos: `invalid_credentials` / «Invalid login credentials».
    const inexistente = mensajeDeLogin({ code: "invalid_credentials", message: "Invalid login credentials", status: 400 });
    const claveErronea = mensajeDeLogin({ code: "invalid_credentials", message: "Invalid login credentials", status: 400 });
    expect(inexistente).toBe(claveErronea);
    expect(inexistente).toBe(MENSAJE_LOGIN_CREDENCIALES);
  });

  it("sin código (versiones antiguas) se apoya en el texto de credenciales inválidas", () => {
    expect(mensajeDeLogin({ message: "Invalid login credentials" })).toBe(MENSAJE_LOGIN_CREDENCIALES);
  });

  it("usuario desactivado tiene su mensaje, por código y por texto", () => {
    expect(mensajeDeLogin({ code: "user_banned", message: "User is banned" })).toBe(MENSAJE_LOGIN_DESACTIVADO);
    expect(mensajeDeLogin({ message: "User is banned" })).toBe(MENSAJE_LOGIN_DESACTIVADO);
  });

  it.each([
    { code: "email_not_confirmed", message: "Email not confirmed", status: 400 },
    { code: "over_request_rate_limit", message: "Request rate limit reached", status: 429 },
    { code: "unexpected_failure", message: "Database error querying schema", status: 500 },
    { message: "Invalid API key" },
    { code: "invalid_api_key", message: "Invalid API key", status: 401 },
    { message: "Failed to fetch", status: 0 },
    { message: "" },
    {},
  ])("%j no filtra el texto del proveedor: mensaje genérico", (err) => {
    const m = mensajeDeLogin(err);
    expect(m).toBe(MENSAJE_LOGIN_GENERICO);
    if (err.message) expect(m).not.toContain(err.message);
  });

  it("un código manda sobre el texto: «invalid» en otro código no se toma por credenciales", () => {
    expect(mensajeDeLogin({ code: "invalid_api_key", message: "Invalid login credentials?" })).toBe(MENSAJE_LOGIN_GENERICO);
  });

  it("el formulario usa mensajeDeLogin y ya no muestra err.message", () => {
    const fuente = readFileSync(path.resolve(__dirname, "..", "src", "app", "login", "login-form.tsx"), "utf8");
    expect(fuente).toContain("mensajeDeLogin(");
    expect(fuente).not.toMatch(/setError\([^)]*err\.message/);
    expect(fuente).not.toMatch(/\?\s*err\.message|:\s*err\.message/);
  });
});
