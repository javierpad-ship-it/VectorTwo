import { describe, expect, it, vi } from "vitest";
import type { PostgrestError } from "@supabase/supabase-js";
import { describirErrorDb, traducirErrorDb } from "@/lib/api/errores-db";
import {
  CODIGO_LECTURA_LENTA,
  MENSAJE_LECTURA_LENTA,
  MENSAJES_LECTURA_LENTA,
  PLAZO_LECTURA_MS,
  conMensajeLecturaLenta,
  esLecturaLenta,
  plazoLectura,
} from "@/lib/api/plazos";

const error = (parcial: Partial<PostgrestError>): PostgrestError => ({ code: "", message: "", details: "", hint: "", name: "PostgrestError", ...parcial }) as PostgrestError;

describe("esLecturaLenta", () => {
  it("57014 y el aborto del fetch (AbortError / TimeoutError con code vacío) son lecturas lentas", () => {
    expect(esLecturaLenta("57014", "canceling statement due to statement timeout")).toBe(true);
    expect(esLecturaLenta("", "TimeoutError: The operation was aborted due to timeout")).toBe(true);
    expect(esLecturaLenta("", "AbortError: The user aborted a request.")).toBe(true);
    expect(esLecturaLenta(undefined, "AbortError: x")).toBe(true);
  });
  it("lo demás no lo es", () => {
    expect(esLecturaLenta("23505", "duplicate key")).toBe(false);
    expect(esLecturaLenta("XX000", "algo")).toBe(false);
    expect(esLecturaLenta("", "FetchError: fetch failed")).toBe(false);
    expect(esLecturaLenta(null, "mensaje con TimeoutError en medio")).toBe(false);
    expect(esLecturaLenta(null, null)).toBe(false);
  });
});

describe("describirErrorDb · lectura lenta → 503 lectura_lenta", () => {
  it("57014 da el mensaje común en castellano llano", () => {
    expect(describirErrorDb("57014", "canceling statement due to statement timeout")).toEqual({
      status: 503,
      mensaje: "La consulta tardó demasiado y se canceló. No se guardó ningún cambio; inténtalo de nuevo en un minuto.",
      codigo: "lectura_lenta",
    });
    expect(MENSAJE_LECTURA_LENTA).toMatch(/^La consulta tardó demasiado/);
    expect(CODIGO_LECTURA_LENTA).toBe("lectura_lenta");
  });
  it("el aborto del fetch (code vacío) también", () => {
    expect(describirErrorDb("", "TimeoutError: The operation was aborted due to timeout", "TimeoutError: …")).toMatchObject({ status: 503, codigo: "lectura_lenta" });
    expect(describirErrorDb("", "AbortError: The user aborted a request.")).toMatchObject({ status: 503, codigo: "lectura_lenta" });
  });
  it("lleva el mensaje específico de la lectura si conMensajeLecturaLenta se lo dejó", () => {
    const e = conMensajeLecturaLenta(error({ code: "57014", message: "canceling statement due to statement timeout" }), MENSAJES_LECTURA_LENTA.ventaProyeccion);
    expect(describirErrorDb(e.code, e.message, e.details)).toEqual({ status: 503, mensaje: MENSAJES_LECTURA_LENTA.ventaProyeccion, codigo: "lectura_lenta" });
  });
  it("no cambia los demás códigos (el 500 genérico y los que ya se traducían)", () => {
    expect(describirErrorDb("XX000", "boom")).toEqual({ status: 500, mensaje: "Error inesperado en la base de datos." });
    expect(describirErrorDb("55P03", "lock")).toMatchObject({ status: 409 });
    expect(describirErrorDb("23505", 'violates unique constraint "lineas_codigo_uniq"')).toMatchObject({ status: 409 });
  });
});

describe("conMensajeLecturaLenta", () => {
  it("solo toca los errores de lectura lenta y deja pasar null", () => {
    expect(conMensajeLecturaLenta(null, "x")).toBeNull();
    const otro = error({ code: "23505", message: "duplicado", details: "Key (a)=(b)" });
    expect(conMensajeLecturaLenta(otro, "x").details).toBe("Key (a)=(b)");
    const lento = conMensajeLecturaLenta(error({ message: "TimeoutError: …" }), "Vuelve a intentarlo.");
    expect(lento.details).toContain("Vuelve a intentarlo.");
  });
});

describe("traducirErrorDb · lectura lenta", () => {
  it("responde 503 con { error, codigo } y la deja en el log (es de servidor)", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const r = traducirErrorDb(conMensajeLecturaLenta(error({ code: "57014", message: "canceling statement due to statement timeout" }), MENSAJES_LECTURA_LENTA.reporte), "prueba");
    expect(r.status).toBe(503);
    expect(r.headers.get("Cache-Control")).toBe("no-store");
    expect(await r.json()).toEqual({ error: MENSAJES_LECTURA_LENTA.reporte, codigo: "lectura_lenta" });
    expect(log).toHaveBeenCalledTimes(1);
    log.mockRestore();
  });
  it("sin mensaje específico, el común; el detalle de Postgres no sale a la pantalla", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const r = traducirErrorDb(error({ code: "57014", message: "canceling statement due to statement timeout", details: "secreto" }));
    const cuerpo = await r.json();
    expect(cuerpo.error).toBe(MENSAJE_LECTURA_LENTA);
    expect(JSON.stringify(cuerpo)).not.toContain("secreto");
    expect(JSON.stringify(cuerpo)).not.toContain("statement timeout");
    log.mockRestore();
  });
  it("un 500 genérico sigue sin código", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const r = traducirErrorDb(error({ code: "XX000", message: "boom" }));
    expect(r.status).toBe(500);
    expect(await r.json()).toEqual({ error: "Error inesperado en la base de datos." });
    log.mockRestore();
  });
});

describe("plazoLectura", () => {
  it("7,5 s: por debajo del corte de 8 s de PostgREST; cada llamada da una señal nueva", () => {
    expect(PLAZO_LECTURA_MS).toBe(7_500);
    const a = plazoLectura();
    expect(a).toBeInstanceOf(AbortSignal);
    expect(a.aborted).toBe(false);
    expect(plazoLectura()).not.toBe(a);
  });
});
