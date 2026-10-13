/**
 * Lectura de query strings para los handlers de 02b. Un parámetro vacío
 * (`?desde=`) cuenta como ausente: así `z.coerce.number()` nunca convierte ""
 * en 0 y los valores por defecto del esquema funcionan.
 */

/** Los parámetros pedidos que vienen con valor, como objeto plano para un esquema zod. */
export function parametrosNoVacios(params: URLSearchParams, claves: readonly string[]): Record<string, string> {
  const salida: Record<string, string> = {};
  for (const clave of claves) {
    const valor = params.get(clave);
    if (valor !== null && valor.trim() !== "") salida[clave] = valor.trim();
  }
  return salida;
}

/** `?incluir_inactivas=1` (también `incluir_inactivos` y `true`). */
export function pideInactivas(params: URLSearchParams): boolean {
  return ["incluir_inactivas", "incluir_inactivos"].some((k) => {
    const v = params.get(k);
    return v === "1" || v === "true";
  });
}
