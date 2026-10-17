import { createHash } from "node:crypto";
import { claveGM, type MatrizCrecimientos } from "./crecimientos";

/**
 * Huellas de la matriz de crecimientos (ficha 07c). Solo servidor: usan `node:crypto` (md5 hexadecimal; sirve para detectar cambios, no
 * es criptografía). Aparte de `crecimientos.ts` para que ese archivo siga importable desde la pantalla.
 */

const md5 = (texto: string) => createHash("md5").update(texto).digest("hex");
const num = (n: number | string) => String(Number(n));
const orden = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * `resumen.huella_crecimientos`: las celdas (género, mundo, %) y el Resto, ordenados. No depende del orden de entrada ni de las notas y
 * el objetivo global no entra (no cambia ninguna cifra).
 */
export function huellaCrecimientos(celdas: readonly { genero_id: string; mundo_id: string; pct: number | string }[], resto: number | string): string {
  const lineas = celdas.map((c) => `${claveGM(c.genero_id, c.mundo_id)}=${num(c.pct)}`).sort(orden);
  return md5([...lineas, `resto=${num(resto)}`].join("\n"));
}

/** `huellaCrecimientos` de la matriz del método (`celdas` como mapa `claveGM → pct`): la misma huella que `resumen.huella_crecimientos`. */
export function huellaDeMatriz(matriz: Pick<MatrizCrecimientos, "celdas">, resto: number | string): string {
  const celdas = [...matriz.celdas].map(([clave, pct]) => {
    const [genero_id = "", mundo_id = ""] = clave.split("|");
    return { genero_id, mundo_id, pct };
  });
  return huellaCrecimientos(celdas, resto);
}

/**
 * La `huella` del `GET`/`PUT …/crecimientos` (bloqueo optimista): celdas con su nota, el Resto con su nota y el objetivo. Cambia si
 * alguien guarda la matriz entre la lectura y el guardado.
 */
export function huellaMatriz(
  celdas: readonly { genero_id: string; mundo_id: string; pct: number | string; nota: string | null }[],
  resto: { pct: number | string; nota: string | null },
  objetivo: number | null
): string {
  const lineas = celdas.map((c) => `${claveGM(c.genero_id, c.mundo_id)}=${num(c.pct)}|${c.nota ?? ""}`).sort(orden);
  return md5([...lineas, `resto=${num(resto.pct)}|${resto.nota ?? ""}`, `objetivo=${objetivo === null ? "" : num(objetivo)}`].join("\n"));
}

/**
 * `huella_choque` del `409 filas_manuales`: la lista ordenada `(fila_id, crecimiento_pct, decidido)` de TODAS las filas en choque (de las
 * dos listas, sin repetir una fila que esté en ambas). No depende del orden y cambia si cambia el % propio o el total de una fila, o si
 * entra o sale una.
 */
export function huellaChoque(filas: readonly { fila_id: string; crecimiento_pct: number | string | null; decidido: number | null }[]): string {
  const vistas = new Map<string, string>();
  for (const f of filas) vistas.set(f.fila_id, `${f.fila_id}|${f.crecimiento_pct === null ? "" : num(f.crecimiento_pct)}|${f.decidido === null ? "" : String(f.decidido)}`);
  return md5([...vistas.values()].sort(orden).join("\n"));
}
