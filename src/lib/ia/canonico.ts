/**
 * JSON canónico (ficha 07e, §5.3): claves ordenadas, sin espacios, números como `JSON.stringify`. Puro.
 * Dos objetos iguales con las claves en otro orden dan el mismo texto. Una clave con valor `undefined` se omite (como `JSON.stringify`);
 * un número no finito es un error: no tiene representación y su huella no sería reproducible.
 */
export type ValorCanonico = string | number | boolean | null | undefined | readonly ValorCanonico[] | { readonly [clave: string]: ValorCanonico };

export function canonico(valor: ValorCanonico): string {
  if (valor === null) return "null";
  if (valor === undefined) throw new Error("canonico: un valor indefinido no se puede serializar.");
  if (typeof valor === "number") {
    if (!Number.isFinite(valor)) throw new Error("canonico: un número no finito no se puede serializar.");
    return JSON.stringify(valor);
  }
  if (typeof valor === "string" || typeof valor === "boolean") return JSON.stringify(valor);
  if (Array.isArray(valor)) return `[${valor.map((v) => canonico(v === undefined ? null : v)).join(",")}]`;
  const objeto = valor as { readonly [clave: string]: ValorCanonico };
  const partes = Object.keys(objeto)
    .filter((k) => objeto[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonico(objeto[k])}`);
  return `{${partes.join(",")}}`;
}
