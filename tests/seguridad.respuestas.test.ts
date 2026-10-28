import { describe, expect, it } from "vitest";
import { z } from "zod";
import { MAX_BYTES_CUERPO, error, leerCuerpo, ok } from "@/lib/api/respuestas";

const esquema = z.object({ x: z.string() });
const peticion = (cuerpo: string, cabeceras: Record<string, string> = {}) =>
  new Request("http://localhost/api/prueba", { method: "POST", body: cuerpo, headers: cabeceras });

describe("ok() y error(): nunca se guardan en caché", () => {
  it("ok lleva Cache-Control: no-store y conserva estado y cuerpo", async () => {
    const r = ok({ a: 1 }, 201);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.status).toBe(201);
    expect(await r.json()).toEqual({ data: { a: 1 } });
  });

  it("error lleva Cache-Control: no-store y conserva estado y cuerpo", async () => {
    const r = error("No autenticado.", 401);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ error: "No autenticado." });
  });
});

describe("leerCuerpo: tope de tamaño", () => {
  it("un cuerpo normal pasa", async () => {
    const { datos, respuesta } = await leerCuerpo(peticion(JSON.stringify({ x: "hola" })), esquema);
    expect(respuesta).toBeNull();
    expect(datos).toEqual({ x: "hola" });
  });

  it("un cuerpo de 2 MB (como un bloque de venta) pasa", async () => {
    const { datos, respuesta } = await leerCuerpo(peticion(JSON.stringify({ x: "a".repeat(2 * 1024 * 1024) })), esquema);
    expect(respuesta).toBeNull();
    expect(datos?.x.length).toBe(2 * 1024 * 1024);
  });

  it("content-length mayor que 6 MB se rechaza con 413 sin leer el cuerpo", async () => {
    const { datos, respuesta } = await leerCuerpo(peticion("{}", { "content-length": String(MAX_BYTES_CUERPO + 1) }), esquema);
    expect(datos).toBeNull();
    expect(respuesta?.status).toBe(413);
    expect(((await respuesta?.json()) as { error: string }).error).toMatch(/demasiado grande/);
  });

  it("sin content-length, un cuerpo de más de 6 MB también se rechaza con 413", async () => {
    const grande = JSON.stringify({ x: "a".repeat(MAX_BYTES_CUERPO + 10) });
    const { respuesta } = await leerCuerpo(peticion(grande), esquema);
    expect(respuesta?.status).toBe(413);
  });

  it("el tope cuenta bytes, no caracteres: 4 MB de «ñ» (8 MB en UTF-8) dan 413", async () => {
    const grande = JSON.stringify({ x: "ñ".repeat(4 * 1024 * 1024) });
    expect(grande.length).toBeLessThan(MAX_BYTES_CUERPO);
    const { respuesta } = await leerCuerpo(peticion(grande), esquema);
    expect(respuesta?.status).toBe(413);
  });

  it("JSON inválido sigue dando 400", async () => {
    const { respuesta } = await leerCuerpo(peticion("{no es json"), esquema);
    expect(respuesta?.status).toBe(400);
  });

  it("un cuerpo que no cumple el esquema sigue dando 400 con el campo", async () => {
    const { respuesta } = await leerCuerpo(peticion(JSON.stringify({ x: 5 })), esquema);
    expect(respuesta?.status).toBe(400);
    expect(((await respuesta?.json()) as { error: string }).error).toMatch(/^x: /);
  });
});
