/**
 * Error de la API: el mensaje es el `error` de la respuesta, listo para mostrar.
 * Además guarda el `status` HTTP y el `codigo` de negocio (`{ error, codigo }`,
 * p. ej. los 409 de M6) para que la pantalla pueda ofrecer una acción distinta
 * según el caso. Sigue siendo un `Error`: `mensajeError(e)` funciona igual.
 */
export class ErrorApi extends Error {
  readonly status: number;
  readonly codigo: string | null;
  /** El cuerpo completo de la respuesta de error (algunos `409` traen listas, p. ej. `filas_sin_decidir` de M7). */
  readonly cuerpo: Record<string, unknown> | null;

  constructor(mensaje: string, status: number, codigo: string | null = null, cuerpo: Record<string, unknown> | null = null) {
    super(mensaje);
    this.name = "ErrorApi";
    this.status = status;
    this.codigo = codigo;
    this.cuerpo = cuerpo;
  }
}

/** El `codigo` de negocio de un error de la API; `null` si no es de la API o no trae. */
export function codigoDeError(e: unknown): string | null {
  return e instanceof ErrorApi ? e.codigo : null;
}

/**
 * Envoltorio de fetch para hablar con /api desde el navegador. Toda respuesta
 * de la API es `{ data }` o `{ error }`; acá se desempaqueta y los errores se
 * lanzan como `ErrorApi` con el mensaje listo para mostrar.
 */
async function llamar<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });

  let cuerpo: { data?: T; error?: string; codigo?: string; [extra: string]: unknown } = {};
  try {
    cuerpo = await res.json();
  } catch {
    // sin cuerpo
  }

  if (!res.ok) {
    throw new ErrorApi(cuerpo.error ?? `Error ${res.status}`, res.status, cuerpo.codigo ?? null, cuerpo);
  }
  return cuerpo.data as T;
}

export const api = {
  get: <T>(url: string) => llamar<T>(url),
  /** `opciones.signal` permite cancelar la petición (p. ej. una consulta obsoleta). */
  post: <T>(url: string, body: unknown, opciones?: { signal?: AbortSignal }) =>
    llamar<T>(url, { method: "POST", body: JSON.stringify(body), signal: opciones?.signal }),
  put: <T>(url: string, body: unknown) =>
    llamar<T>(url, { method: "PUT", body: JSON.stringify(body) }),
  patch: <T>(url: string, body: unknown) =>
    llamar<T>(url, { method: "PATCH", body: JSON.stringify(body) }),
  delete: <T>(url: string) => llamar<T>(url, { method: "DELETE" }),
};
