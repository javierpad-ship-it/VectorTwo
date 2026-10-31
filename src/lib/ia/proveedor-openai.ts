import "server-only";
import {
  ErrorClaveInvalida,
  ErrorLimiteProveedor,
  ErrorServicioProveedor,
  ErrorSolicitudInvalida,
  ErrorTiempoAgotado,
  type FinIa,
  type PeticionIa,
  type ProveedorIA,
  type RespuestaIa,
} from "./proveedor";
import { ESPERA_MAXIMA_MS } from "./limites";

/**
 * Adaptador de OpenAI (ficha 07e, §3.11 y §11.2). ÚNICO archivo que nombra `OPENAI_API_KEY` y que habla con la API del proveedor. Usa
 * `fetch` directo sobre Chat Completions (`POST {base}/chat/completions`, `Authorization: Bearer …`), sin SDK: el SDK oficial exige Node ≥ 22
 * y este proyecto declara `>=20` (ficha §11.2, punto 13), y con `fetch` las pruebas inyectan un `fetch` falso sin red.
 *
 * Lo que sigue está tomado de los tipos del SDK oficial `openai@7.47.0` (generados de la especificación de la API), consultados el 2026-10-31;
 * la documentación web no fue accesible desde el entorno de construcción (ver ficha §11.2): `response_format` con `json_schema` y
 * `strict`, `max_completion_tokens`, `reasoning_effort`, `temperature`, `seed`, `store`; respuesta con `choices[0].finish_reason`
 * (`stop`, `length`, `content_filter`, `tool_calls`, `function_call`), `message.refusal`, `usage.prompt_tokens`, `usage.completion_tokens`,
 * `usage.prompt_tokens_details.cached_tokens`; cabeceras `x-request-id`, `retry-after-ms` y `retry-after`.
 *
 * Reglas de oro: la clave solo se lee aquí y solo viaja en la cabecera `Authorization`; ningún mensaje de error ni valor devuelto contiene la
 * clave, la petición ni la respuesta; no hay ningún id de modelo ni precio en este archivo (el modelo llega en la petición).
 */

/** Base de la API (la documentan los tipos del SDK: `https://api.openai.com/v1`). */
export const URL_BASE_OPENAI = "https://api.openai.com/v1";

export type OpcionesOpenAI = {
  /** Clave a usar; por defecto `process.env.OPENAI_API_KEY` (leída en cada llamada). Las pruebas pasan una ficticia. */
  clave?: string;
  /** `fetch` a usar; por defecto el global. Las pruebas pasan uno falso: nada llega a la red. */
  fetch?: typeof fetch;
  url_base?: string;
};

/** ¿Hay clave en el servidor? Solo mira si existe (nunca la devuelve). */
export function hayClaveOpenAI(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return (env.OPENAI_API_KEY ?? "").trim() !== "";
}

const leerClave = (opciones: OpcionesOpenAI): string => (opciones.clave ?? process.env.OPENAI_API_KEY ?? "").trim();

/**
 * Traducción propia del presupuesto de razonamiento neutral (tokens) al `reasoning_effort` del proveedor (los valores `low`, `medium` y `high`
 * existen en los tipos del SDK; los umbrales son una decisión de este adaptador, pendiente de contrastar por modelo — ficha §11.2, puntos 4 y 6).
 * `0` = sin razonamiento: no se envía el parámetro.
 */
export function esfuerzoDeRazonamiento(presupuesto: number): "low" | "medium" | "high" | null {
  if (!(presupuesto > 0)) return null;
  if (presupuesto <= 4000) return "low";
  if (presupuesto <= 16_000) return "medium";
  return "high";
}

/** Texto del mensaje de corrección del reintento (resumen de errores sin datos). */
const textoCorreccion = (resumen: string): string => `Corrección: tu respuesta anterior no fue válida (${resumen}). Responde de nuevo solo con el JSON del esquema.`;

export type CuerpoOpenAI = Record<string, unknown>;

/** Cuerpo de la petición a Chat Completions. Pura. `temperatura` y `semilla` solo se envían si vienen; con razonamiento no se fija la temperatura. */
export function armarCuerpoOpenAI(p: PeticionIa): CuerpoOpenAI {
  const usuario = `${p.bloque}\n${p.sufijo}${p.correccion ? `\n${textoCorreccion(p.correccion)}` : ""}`;
  const esfuerzo = esfuerzoDeRazonamiento(p.presupuesto_razonamiento);
  const cuerpo: CuerpoOpenAI = {
    model: p.modelo,
    messages: [
      { role: "system", content: p.sistema },
      { role: "user", content: usuario },
    ],
    response_format: { type: "json_schema", json_schema: { name: p.nombre_esquema, schema: p.esquema, strict: true } },
    max_completion_tokens: p.max_tokens,
    // No se guarda la salida del lado del proveedor para sus productos de evaluación o destilación (la traza vive en la base propia).
    store: false,
  };
  if (esfuerzo !== null) cuerpo.reasoning_effort = esfuerzo;
  else if (p.temperatura !== null) cuerpo.temperature = p.temperatura;
  if (p.semilla !== null) cuerpo.seed = p.semilla;
  return cuerpo;
}

const entero = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : 0);
const objeto = (v: unknown): Record<string, unknown> | null => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/**
 * `usage` → tokens neutrales DISJUNTOS: `cached_tokens` va dentro de `prompt_tokens` (así lo describe el SDK: «cached tokens present in the
 * prompt»), así que `entrada = prompt_tokens − cached_tokens`. Los tokens de razonamiento van dentro de `completion_tokens` (`reasoning_tokens` es
 * un desglose de `completion_tokens_details`), así que `salida = completion_tokens` y no se suman otra vez. Ambos puntos se infieren de los
 * tipos; confirmar en la documentación de precios (ficha §11.2, puntos 5 y 6).
 */
export function usoDeOpenAI(usage: unknown): RespuestaIa["uso"] {
  const u = objeto(usage);
  const prompt = entero(u?.prompt_tokens);
  const cache = Math.min(prompt, entero(objeto(u?.prompt_tokens_details)?.cached_tokens));
  return { entrada: prompt - cache, entrada_cache: cache, salida: entero(u?.completion_tokens) };
}

/** `finish_reason` y `refusal` → `fin` neutral. */
export function finDeOpenAI(finishReason: unknown, refusal: unknown): FinIa {
  if (typeof refusal === "string" && refusal.trim() !== "") return "rechazo";
  if (finishReason === "stop") return "normal";
  if (finishReason === "length") return "limite_salida";
  if (finishReason === "content_filter") return "rechazo";
  return "otro";
}

/** Espera pedida por el proveedor: `retry-after-ms` (milisegundos) o `retry-after` (segundos o fecha HTTP); `null` si no hay o no se entiende. */
export function esperaDeCabeceras(cabeceras: Headers, ahora: number = Date.now()): number | null {
  const ms = cabeceras.get("retry-after-ms");
  if (ms !== null && ms.trim() !== "") {
    const n = Number(ms);
    if (Number.isFinite(n) && n >= 0) return Math.min(Math.round(n), ESPERA_MAXIMA_MS);
  }
  const ra = cabeceras.get("retry-after");
  if (ra !== null && ra.trim() !== "") {
    const seg = Number(ra);
    if (Number.isFinite(seg) && seg >= 0) return Math.min(Math.round(seg * 1000), ESPERA_MAXIMA_MS);
    const fecha = Date.parse(ra);
    if (Number.isFinite(fecha)) return Math.min(Math.max(0, fecha - ahora), ESPERA_MAXIMA_MS);
  }
  return null;
}

/** Estado HTTP de error → error tipado. Los mensajes son genéricos (nunca la clave, cabeceras ni datos). */
export function errorDeEstado(status: number, cabeceras: Headers): Error {
  if (status === 401 || status === 403) return new ErrorClaveInvalida();
  if (status === 429) return new ErrorLimiteProveedor(esperaDeCabeceras(cabeceras));
  if (status === 408 || status === 409 || status >= 500) return new ErrorServicioProveedor(String(status), esperaDeCabeceras(cabeceras));
  return new ErrorSolicitudInvalida();
}

const esAborto = (e: unknown): boolean => e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");

/** Crea el proveedor de OpenAI. */
export function crearProveedorOpenAI(opciones: OpcionesOpenAI = {}): ProveedorIA {
  return {
    async llamar(peticion, llamada = {}): Promise<RespuestaIa> {
      const clave = leerClave(opciones);
      if (clave === "") throw new ErrorClaveInvalida();
      const hacer = opciones.fetch ?? globalThis.fetch;
      const url = `${(opciones.url_base ?? URL_BASE_OPENAI).replace(/\/+$/, "")}/chat/completions`;
      const tiempo = AbortSignal.timeout(Math.max(1, peticion.timeout_ms));
      const senal = llamada.senal ? AbortSignal.any([tiempo, llamada.senal]) : tiempo;
      const inicio = Date.now();

      let respuesta: Response;
      let cuerpo: unknown;
      try {
        respuesta = await hacer(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${clave}` },
          body: JSON.stringify(armarCuerpoOpenAI(peticion)),
          signal: senal,
        });
        if (!respuesta.ok) throw errorDeEstado(respuesta.status, respuesta.headers);
        cuerpo = await respuesta.json();
      } catch (e) {
        if (e instanceof ErrorClaveInvalida || e instanceof ErrorLimiteProveedor || e instanceof ErrorServicioProveedor || e instanceof ErrorSolicitudInvalida) throw e;
        if (esAborto(e)) throw new ErrorTiempoAgotado();
        // Cualquier otro fallo (red, cuerpo ilegible): se trata como un fallo del servicio. El mensaje original no se propaga.
        throw new ErrorServicioProveedor("red");
      }

      const raiz = objeto(cuerpo);
      const eleccion = objeto(Array.isArray(raiz?.choices) ? raiz.choices[0] : null);
      const mensaje = objeto(eleccion?.message);
      return {
        texto: typeof mensaje?.content === "string" ? mensaje.content : "",
        uso: usoDeOpenAI(raiz?.usage),
        fin: finDeOpenAI(eleccion?.finish_reason, mensaje?.refusal),
        id_solicitud: (respuesta.headers.get("x-request-id") ?? "").slice(0, 120) || null,
        modelo_respuesta: typeof raiz?.model === "string" ? raiz.model.slice(0, 100) : null,
        duracion_ms: Math.max(0, Date.now() - inicio),
      };
    },
  };
}
