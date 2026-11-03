import { MAX_FILAS_LOTE } from "./tipos-api";

/**
 * Tandas de un lote grande (ficha 07g, D17; R16). Puro: lo usa el navegador para enviar la selección de a `MAX_FILAS_LOTE` filas SIN partir un género × mundo
 * (la IA de un GM se aprueba entera, D7) y el servidor para comprobarlo. No importa nada de `node:*`.
 */

export type ResultadoTrocear<T> = {
  tandas: T[][];
  /** GM que no caben en una tanda (más de `max` filas) y por eso se partieron: la ficha cuenta hasta 119 filas por GM, así que no debería pasar. */
  gm_partidos: string[];
};

const porTexto = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * R16. Reparte `items` en tandas de a lo sumo `max` filas, con cada GM entero en una sola tanda. Orden estable (no depende del orden de entrada): los GM
 * por `gm_clave` y las filas de cada GM por `fila_id`; se va llenando cada tanda con GM completos y se abre otra cuando el siguiente no cabe (primer ajuste).
 * Un GM con más de `max` filas es imposible de no partir: se parte en tandas de `max` y se informa en `gm_partidos`.
 */
export function trocear<T extends { fila_id: string }>(items: readonly T[], gmDe: (item: T) => string, max: number = MAX_FILAS_LOTE): ResultadoTrocear<T> {
  if (!Number.isInteger(max) || max < 1) throw new Error("trocear: el máximo de filas por tanda debe ser un entero positivo.");
  const porGM = new Map<string, T[]>();
  for (const it of items) {
    const gm = gmDe(it);
    const lista = porGM.get(gm);
    if (lista) lista.push(it);
    else porGM.set(gm, [it]);
  }
  const tandas: T[][] = [];
  const gm_partidos: string[] = [];
  let actual: T[] = [];
  const cerrar = () => {
    if (actual.length > 0) tandas.push(actual);
    actual = [];
  };
  for (const gm of [...porGM.keys()].sort(porTexto)) {
    const filas = (porGM.get(gm) as T[]).slice().sort((a, b) => porTexto(a.fila_id, b.fila_id));
    if (filas.length > max) {
      cerrar();
      gm_partidos.push(gm);
      for (let i = 0; i < filas.length; i += max) tandas.push(filas.slice(i, i + max));
      continue;
    }
    if (actual.length + filas.length > max) cerrar();
    actual.push(...filas);
  }
  cerrar();
  return { tandas, gm_partidos };
}
