import { describe, expect, it } from "vitest";
import { ErrorClaveInvalida, ErrorLimiteProveedor, ErrorServicioProveedor, ErrorSolicitudInvalida, ErrorTiempoAgotado, type PeticionIa } from "@/lib/ia/proveedor";
import { armarCuerpoOpenAI, crearProveedorOpenAI, errorDeEstado, esfuerzoDeRazonamiento, esperaDeCabeceras, finDeOpenAI, hayClaveOpenAI, usoDeOpenAI } from "@/lib/ia/proveedor-openai";

/**
 * R35: el adaptador de OpenAI sin red. Clave ficticia y `fetch` falso; las respuestas tienen la forma de Chat Completions que describen los tipos del SDK
 * oficial (ficha 07e, §11.2). Esta es la ÚNICA prueba que importa `proveedor-openai`.
 */

const CLAVE = "clave-ficticia-solo-para-pruebas";
const peticion = (extra: Partial<PeticionIa> = {}): PeticionIa => ({
  modelo: "modelo-a",
  sistema: "SISTEMA",
  bloque: '{"b":1}',
  sufijo: '{"tarea":"natural"}',
  esquema: { type: "object", properties: { a: { type: "integer" } }, required: ["a"], additionalProperties: false },
  nombre_esquema: "salida_natural",
  max_tokens: 16000,
  temperatura: null,
  semilla: null,
  presupuesto_razonamiento: 0,
  timeout_ms: 5000,
  ...extra,
});

const cuerpoOk = (extra: Record<string, unknown> = {}) => ({
  id: "chatcmpl-x",
  model: "modelo-a-2026-01-01",
  choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: '{"a":1}', refusal: null } }],
  usage: { prompt_tokens: 9600, completion_tokens: 1900, total_tokens: 11500, prompt_tokens_details: { cached_tokens: 5400 }, completion_tokens_details: { reasoning_tokens: 300 } },
  ...extra,
});

type Llamada = { url: string; init: RequestInit };
function fetchFalso(respuestas: (Response | Error)[]) {
  const llamadas: Llamada[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    llamadas.push({ url: String(url), init: init ?? {} });
    const r = respuestas.shift();
    if (r === undefined) throw new Error("sin respuestas");
    if (r instanceof Error) throw r;
    return r;
  }) as typeof fetch;
  return { f, llamadas };
}
const json = (cuerpo: unknown, status = 200, cabeceras: Record<string, string> = {}) => new Response(JSON.stringify(cuerpo), { status, headers: { "content-type": "application/json", ...cabeceras } });
const proveedor = (respuestas: (Response | Error)[]) => {
  const { f, llamadas } = fetchFalso(respuestas);
  return { p: crearProveedorOpenAI({ clave: CLAVE, fetch: f }), llamadas };
};

describe("cuerpo de la petición", () => {
  it("usa salida estructurada estricta, el tope de salida y no guarda del lado del proveedor", () => {
    const c = armarCuerpoOpenAI(peticion());
    expect(c.model).toBe("modelo-a");
    expect(c.response_format).toEqual({ type: "json_schema", json_schema: { name: "salida_natural", schema: peticion().esquema, strict: true } });
    expect(c.max_completion_tokens).toBe(16000);
    expect(c.store).toBe(false);
    expect(c.temperature).toBeUndefined();
    expect(c.seed).toBeUndefined();
    expect(c.reasoning_effort).toBeUndefined();
  });

  it("el texto fijo va primero, después el bloque y al final el sufijo (prefijo estable)", () => {
    const m = armarCuerpoOpenAI(peticion()).messages as { role: string; content: string }[];
    expect(m.map((x) => x.role)).toEqual(["system", "user"]);
    expect(m[0].content).toBe("SISTEMA");
    expect(m[1].content).toBe('{"b":1}\n{"tarea":"natural"}');
  });

  it("la corrección del reintento va al final y sin datos", () => {
    const m = armarCuerpoOpenAI(peticion({ correccion: "faltan 3 filas" })).messages as { content: string }[];
    expect(m[1].content.endsWith("(faltan 3 filas). Responde de nuevo solo con el JSON del esquema.")).toBe(true);
  });

  it("temperatura y semilla solo se envían si vienen; con razonamiento no se fija la temperatura", () => {
    expect(armarCuerpoOpenAI(peticion({ temperatura: 0.2, semilla: 7 }))).toMatchObject({ temperature: 0.2, seed: 7 });
    const c = armarCuerpoOpenAI(peticion({ temperatura: 0.2, presupuesto_razonamiento: 8000 }));
    expect(c.temperature).toBeUndefined();
    expect(c.reasoning_effort).toBe("medium");
  });

  it("traduce el presupuesto de razonamiento neutral a un esfuerzo", () => {
    expect([0, 1000, 4000, 4001, 16000, 32000].map(esfuerzoDeRazonamiento)).toEqual([null, "low", "low", "medium", "medium", "high"]);
  });
});

describe("respuesta", () => {
  it("traduce el uso a tokens DISJUNTOS (la entrada en caché se resta del total) y el razonamiento queda dentro de la salida", () => {
    expect(usoDeOpenAI(cuerpoOk().usage)).toEqual({ entrada: 4200, entrada_cache: 5400, salida: 1900 });
    expect(usoDeOpenAI({ prompt_tokens: 100, completion_tokens: 10 })).toEqual({ entrada: 100, entrada_cache: 0, salida: 10 });
    expect(usoDeOpenAI(undefined)).toEqual({ entrada: 0, entrada_cache: 0, salida: 0 });
    expect(usoDeOpenAI({ prompt_tokens: 10, prompt_tokens_details: { cached_tokens: 99 } }).entrada).toBe(0);
  });

  it("traduce el motivo de fin y la negativa", () => {
    expect(finDeOpenAI("stop", null)).toBe("normal");
    expect(finDeOpenAI("length", null)).toBe("limite_salida");
    expect(finDeOpenAI("content_filter", null)).toBe("rechazo");
    expect(finDeOpenAI("stop", "No puedo ayudar con eso")).toBe("rechazo");
    expect(finDeOpenAI("tool_calls", null)).toBe("otro");
  });

  it("una llamada buena devuelve texto, uso, fin, id de la petición y modelo efectivo", async () => {
    const { p, llamadas } = proveedor([json(cuerpoOk(), 200, { "x-request-id": "req_123" })]);
    const r = await p.llamar(peticion());
    expect(r).toMatchObject({ texto: '{"a":1}', uso: { entrada: 4200, entrada_cache: 5400, salida: 1900 }, fin: "normal", id_solicitud: "req_123", modelo_respuesta: "modelo-a-2026-01-01" });
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0].url).toBe("https://api.openai.com/v1/chat/completions");
    expect((llamadas[0].init.headers as Record<string, string>).Authorization).toBe(`Bearer ${CLAVE}`);
  });

  it("un corte por límite de salida y una negativa llegan como `fin`", async () => {
    const corte = proveedor([json(cuerpoOk({ choices: [{ index: 0, finish_reason: "length", message: { content: '{"a":' } }] }))]);
    expect((await corte.p.llamar(peticion())).fin).toBe("limite_salida");
    const negativa = proveedor([json(cuerpoOk({ choices: [{ index: 0, finish_reason: "stop", message: { content: null, refusal: "no" } }] }))]);
    const r = await negativa.p.llamar(peticion());
    expect(r.fin).toBe("rechazo");
    expect(r.texto).toBe("");
  });
});

describe("errores tipados (mensajes genéricos)", () => {
  const falla = async (respuestas: (Response | Error)[]) => {
    const { p } = proveedor(respuestas);
    return p.llamar(peticion()).then(
      () => null,
      (e: unknown) => e as Error
    );
  };

  it("429 con retry-after-ms, con retry-after en segundos y sin cabecera", async () => {
    const a = (await falla([json({ error: { message: "secreto: sk-algo" } }, 429, { "retry-after-ms": "1500" })])) as ErrorLimiteProveedor;
    expect(a).toBeInstanceOf(ErrorLimiteProveedor);
    expect(a.esperar_ms).toBe(1500);
    expect(((await falla([json({}, 429, { "retry-after": "3" })])) as ErrorLimiteProveedor).esperar_ms).toBe(3000);
    expect(((await falla([json({}, 429)])) as ErrorLimiteProveedor).esperar_ms).toBeNull();
  });

  it("401 y 403 son clave inválida; 400 y 404, solicitud inválida; 408, 409 y 5xx, fallo del servicio", async () => {
    expect(await falla([json({}, 401)])).toBeInstanceOf(ErrorClaveInvalida);
    expect(await falla([json({}, 403)])).toBeInstanceOf(ErrorClaveInvalida);
    expect(await falla([json({}, 400)])).toBeInstanceOf(ErrorSolicitudInvalida);
    expect(await falla([json({}, 404)])).toBeInstanceOf(ErrorSolicitudInvalida);
    for (const s of [408, 409, 500, 502, 503, 504, 529]) {
      const e = (await falla([json({}, s)])) as ErrorServicioProveedor;
      expect(e).toBeInstanceOf(ErrorServicioProveedor);
      expect(e.codigo).toBe(String(s));
    }
  });

  it("un fallo de red es del servicio y un aborto por tiempo es tiempo agotado", async () => {
    expect(await falla([new TypeError("fetch failed: ECONNRESET host-interno")])).toBeInstanceOf(ErrorServicioProveedor);
    const tiempo = Object.assign(new Error("The operation was aborted"), { name: "TimeoutError" });
    expect(await falla([tiempo])).toBeInstanceOf(ErrorTiempoAgotado);
  });

  it("ningún mensaje de error contiene la clave, la entrada ni el cuerpo del proveedor", async () => {
    const cuerpoSecreto = { error: { message: `Incorrect API key provided: ${CLAVE}` } };
    for (const r of [json(cuerpoSecreto, 401), json(cuerpoSecreto, 429), json(cuerpoSecreto, 500), json(cuerpoSecreto, 400), new TypeError(`fallo con ${CLAVE} y {"b":1}`)]) {
      const e = await falla([r]);
      expect(e).not.toBeNull();
      expect(JSON.stringify([e?.message, e?.name])).not.toContain(CLAVE);
      expect(e?.message).not.toContain('{"b":1}');
      expect(e?.message).not.toContain("Incorrect API key");
    }
  });

  it("sin clave no llama a nadie: es una clave inválida", async () => {
    const { f, llamadas } = fetchFalso([json(cuerpoOk())]);
    await expect(crearProveedorOpenAI({ clave: "  ", fetch: f }).llamar(peticion())).rejects.toBeInstanceOf(ErrorClaveInvalida);
    expect(llamadas).toHaveLength(0);
  });

  it("errorDeEstado y esperaDeCabeceras", () => {
    expect(errorDeEstado(429, new Headers({ "retry-after-ms": "250" }))).toMatchObject({ esperar_ms: 250 });
    expect(esperaDeCabeceras(new Headers({ "retry-after": "999999" }))).toBe(60_000);
    expect(esperaDeCabeceras(new Headers({ "retry-after": new Date(Date.now() + 5000).toUTCString() }), Date.now())).toBeLessThanOrEqual(5000);
    expect(esperaDeCabeceras(new Headers())).toBeNull();
  });
});

describe("clave en el servidor", () => {
  it("hayClaveOpenAI solo dice si existe", () => {
    expect(hayClaveOpenAI({ OPENAI_API_KEY: CLAVE })).toBe(true);
    expect(hayClaveOpenAI({ OPENAI_API_KEY: "  " })).toBe(false);
    expect(hayClaveOpenAI({})).toBe(false);
  });
});
