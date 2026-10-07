/**
 * Envoltorio de fetch para hablar con /api desde el navegador. Toda respuesta
 * de la API es `{ data }` o `{ error }`; acá se desempaqueta y los errores se
 * lanzan como Error con el mensaje listo para mostrar.
 */
async function llamar<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });

  let cuerpo: { data?: T; error?: string } = {};
  try {
    cuerpo = await res.json();
  } catch {
    // sin cuerpo
  }

  if (!res.ok) {
    throw new Error(cuerpo.error ?? `Error ${res.status}`);
  }
  return cuerpo.data as T;
}

export const api = {
  get: <T>(url: string) => llamar<T>(url),
  post: <T>(url: string, body: unknown) =>
    llamar<T>(url, { method: "POST", body: JSON.stringify(body) }),
  put: <T>(url: string, body: unknown) =>
    llamar<T>(url, { method: "PUT", body: JSON.stringify(body) }),
  patch: <T>(url: string, body: unknown) =>
    llamar<T>(url, { method: "PATCH", body: JSON.stringify(body) }),
  delete: <T>(url: string) => llamar<T>(url, { method: "DELETE" }),
};
