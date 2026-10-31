import { describe, expect, it } from "vitest";
import {
  ErrorClaveInvalida,
  ErrorLimiteProveedor,
  ErrorProveedorIa,
  ErrorServicioProveedor,
  ErrorSolicitudInvalida,
  ErrorTiempoAgotado,
  esErrorProveedorIa,
  type PeticionIa,
} from "@/lib/ia/proveedor";
import { urlBloqueada } from "./setup-sin-red";
import { claveInvalida401, jsonInvalido, limite429, negativa, ProveedorFalso, sobrecarga, tiempoAgotado, truncada, valida } from "./ia.proveedor-falso";

/** Las pruebas nunca llaman a la red (ficha 07e, §5.7): `fetch` a `openai.com` o `anthropic.com` lanza; el proveedor falso es la única salida. */

const peticion: PeticionIa = {
  modelo: "m",
  sistema: "s",
  bloque: "{}",
  sufijo: "{}",
  esquema: {},
  nombre_esquema: "x",
  max_tokens: 10,
  temperatura: null,
  semilla: null,
  presupuesto_razonamiento: 0,
  timeout_ms: 1000,
};

describe("bloqueo de la red", () => {
  it("un fetch a openai.com o anthropic.com (con cualquier forma de la URL) lanza antes de salir", async () => {
    const urls = [
      "https://api.openai.com/v1/chat/completions",
      "https://openai.com",
      "https://eu.api.openai.com/x",
      "https://api.anthropic.com/v1/messages",
      "https://anthropic.com",
      "https://eu.api.anthropic.com/x",
    ];
    for (const url of urls) {
      let error: unknown = null;
      try {
        await fetch(url, { method: "POST" });
      } catch (e) {
        error = e;
      }
      expect(error, url).toBeInstanceOf(Error);
      expect(String((error as Error).message)).toMatch(/openai\.com/);
    }
    await expect(Promise.resolve().then(() => fetch(new URL("https://api.openai.com/v1/responses")))).rejects.toThrow();
    await expect(Promise.resolve().then(() => fetch(new Request("https://api.openai.com/v1/responses")))).rejects.toThrow();
    await expect(Promise.resolve().then(() => fetch(new URL("https://api.anthropic.com/v1/messages")))).rejects.toThrow();
    await expect(Promise.resolve().then(() => fetch(new Request("https://api.anthropic.com/v1/messages")))).rejects.toThrow();
  });

  it("lo demás pasa al fetch real (aquí, una URL de datos: sin red)", async () => {
    const r = await fetch("data:text/plain,hola");
    expect(await r.text()).toBe("hola");
  });

  it("urlBloqueada reconoce el dominio y sus subdominios, no los parecidos", () => {
    expect(urlBloqueada("https://api.openai.com/v1")).toBe(true);
    expect(urlBloqueada("https://openai.com")).toBe(true);
    expect(urlBloqueada("https://notopenai.com")).toBe(false);
    expect(urlBloqueada("https://openai.com.evil.example")).toBe(false);
    expect(urlBloqueada("https://api.anthropic.com/v1")).toBe(true);
    expect(urlBloqueada("https://notanthropic.com")).toBe(false);
    expect(urlBloqueada("https://anthropic.com.evil.example")).toBe(false);
    expect(urlBloqueada(undefined)).toBe(false);
  });
});

describe("proveedor falso", () => {
  it("devuelve las respuestas guionadas en orden y cuenta las llamadas", async () => {
    const p = new ProveedorFalso([valida({ ok: 1 }), jsonInvalido(), truncada(), negativa()]);
    expect(JSON.parse((await p.llamar(peticion)).texto)).toEqual({ ok: 1 });
    expect((await p.llamar(peticion)).texto).toBe("{ esto no es json");
    expect((await p.llamar(peticion)).fin).toBe("limite_salida");
    expect((await p.llamar(peticion)).fin).toBe("rechazo");
    expect(p.llamadas).toBe(4);
    expect(p.peticiones).toHaveLength(4);
    await expect(p.llamar(peticion)).rejects.toThrow(/sin respuestas guionadas/);
  });

  it("lanza los errores guionados: 429 con retry-after, sobrecarga, tiempo agotado y 401", async () => {
    const p = new ProveedorFalso([limite429(2000), sobrecarga(), tiempoAgotado(), claveInvalida401()]);
    const errores = [] as ErrorProveedorIa[];
    for (let i = 0; i < 4; i++) {
      try {
        await p.llamar(peticion);
      } catch (e) {
        errores.push(e as ErrorProveedorIa);
      }
    }
    expect(errores.map((e) => [e.tipo, e.codigo, e.esperar_ms])).toEqual([["limite", "429", 2000], ["servicio", "503", null], ["tiempo_agotado", "tiempo", null], ["clave_invalida", "401", null]]);
    expect(p.llamadas).toBe(4);
  });
});

describe("errores tipados del proveedor", () => {
  it("cada uno tiene su tipo y código, y el mensaje es genérico (nunca datos, clave ni cabeceras)", () => {
    const todos = [new ErrorLimiteProveedor(500), new ErrorServicioProveedor("503", 1000), new ErrorTiempoAgotado(), new ErrorSolicitudInvalida(), new ErrorClaveInvalida()];
    expect(todos.map((e) => e.tipo)).toEqual(["limite", "servicio", "tiempo_agotado", "solicitud_invalida", "clave_invalida"]);
    expect(todos.map((e) => e.codigo)).toEqual(["429", "503", "tiempo", "400", "401"]);
    for (const e of todos) {
      expect(esErrorProveedorIa(e)).toBe(true);
      expect(e).toBeInstanceOf(Error);
      expect(e.message).not.toMatch(/sk-|bearer|api[-_ ]?key/i);
    }
    expect(esErrorProveedorIa(new Error("x"))).toBe(false);
    expect(new ErrorLimiteProveedor().esperar_ms).toBeNull();
  });
});
