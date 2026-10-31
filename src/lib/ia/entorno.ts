import "server-only";

/**
 * Variables de entorno de la IA (ficha 07e, §3.10). ÚNICO archivo que lee `IA_PROVEEDOR`, `IA_MODELO` e `IA_DESACTIVADA`; la clave del
 * proveedor solo se lee en su adaptador. Ningún id de modelo vive en el código: cambiar de modelo es cambiar `IA_MODELO`.
 */

export type EntornoIa = {
  /** `IA_PROVEEDOR` en minúsculas, o `null` si falta (sin valor por defecto: encenderla es siempre un acto explícito). */
  proveedor: string | null;
  /** `IA_MODELO`: ids permitidos separados por comas, sin repetir; el primero es el que proponen los formularios. */
  modelos: string[];
  /** `IA_DESACTIVADA=1` (o `true`): interruptor de emergencia que manda sobre todo lo demás. */
  desactivada: boolean;
};

/** Lee el entorno. Recibe el objeto de entorno para poder probarlo; por defecto, el del proceso. */
export function leerEntornoIa(env: Readonly<Record<string, string | undefined>> = process.env): EntornoIa {
  const proveedor = (env.IA_PROVEEDOR ?? "").trim().toLowerCase();
  const modelos = [...new Set((env.IA_MODELO ?? "").split(",").map((m) => m.trim()).filter((m) => m !== ""))];
  const desactivada = ["1", "true"].includes((env.IA_DESACTIVADA ?? "").trim().toLowerCase());
  return { proveedor: proveedor === "" ? null : proveedor, modelos, desactivada };
}
