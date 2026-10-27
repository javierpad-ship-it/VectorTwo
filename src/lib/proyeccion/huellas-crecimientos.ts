import { createHash } from "node:crypto";
import { claveGM, type MatrizCrecimientos } from "./crecimientos";

/**
 * Huella de los crecimientos que aplica una proyección (fichas 07c y 06d). Solo servidor: usa `node:crypto` (md5 hexadecimal; sirve para
 * detectar cambios, no es criptografía). Aparte de `crecimientos.ts` para que ese archivo siga importable desde la pantalla.
 */

const md5 = (texto: string) => createHash("md5").update(texto).digest("hex");
const num = (n: number | string) => String(Number(n));
const orden = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * `resumen.huella_crecimientos`: las celdas (género, mundo, %) y el Resto, ordenados. No depende del orden de entrada ni de las notas y el
 * objetivo global no entra (no cambia ninguna cifra).
 *
 * `0.12.1` (06d §3.1): la línea de cada GM lleva `#<crecimiento_id>` y la del Resto `#<restoId>` SOLO si hay id. Así, sin aprobaciones el texto
 * es idéntico al de `0.10.8` (`md5("resto=20")`) y el despliegue no marca nada; con ids, aprobar una versión nueva cambia la huella aunque
 * el % sea igual (la foto debe decir quién decidió).
 */
export function huellaCrecimientos(
  celdas: readonly { genero_id: string; mundo_id: string; pct: number | string; crecimiento_id?: string | null }[],
  resto: number | string,
  restoId?: string | null
): string {
  const lineas = celdas.map((c) => `${claveGM(c.genero_id, c.mundo_id)}=${num(c.pct)}${c.crecimiento_id ? `#${c.crecimiento_id}` : ""}`).sort(orden);
  return md5([...lineas, `resto=${num(resto)}${restoId ? `#${restoId}` : ""}`].join("\n"));
}

/**
 * `huellaCrecimientos` de la matriz del método (`celdas` como mapa `claveGM → pct`): la misma huella que `resumen.huella_crecimientos`. Los
 * ids salen de `matriz.ids` y `matriz.resto`; sin ellos, el texto es el de `0.10.8`.
 */
export function huellaDeMatriz(matriz: Pick<MatrizCrecimientos, "celdas" | "ids" | "resto">, resto: number | string): string {
  const celdas = [...matriz.celdas].map(([clave, pct]) => {
    const [genero_id = "", mundo_id = ""] = clave.split("|");
    return { genero_id, mundo_id, pct, crecimiento_id: matriz.ids?.get(clave) ?? null };
  });
  return huellaCrecimientos(celdas, resto, matriz.resto?.id ?? null);
}
