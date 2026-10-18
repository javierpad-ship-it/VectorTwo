import type { ClaveG } from "./tipos";

/**
 * GML pequeños y resto (ficha 12, regla 5). Una `g` con menos de `UMBRAL_GML_PEQUENO` unidades al barrer en la ventana no se
 * muestra ni se edita sola: se agrupa con las demás pequeñas de su género × mundo en una fila "Resto de GÉNERO · MUNDO". Al
 * aprobar, la participación del resto se reparte entre sus miembros en proporción a sus unidades (`expandirResto`) y la versión
 * guarda una fila por `g`, de modo que M8 no cambia. Puras.
 */

export const claveResto = (generoId: string, mundoId: string) => `${generoId}|${mundoId}`;

export type FilaParaResto = { clave: ClaveG; genero_id: string; mundo_id: string; unidades_ventana: number };

export type GrupoResto<T extends FilaParaResto> = { grupo_resto: string; genero_id: string; mundo_id: string; miembros: T[] };

/**
 * `pequena(g)` ⇔ `unidades_ventana < umbral`. Devuelve las filas grandes y los grupos de resto (uno por género × mundo, en
 * orden estable por llave). El orden de los miembros es el de entrada.
 */
export function agruparPequenas<T extends FilaParaResto>(
  filas: readonly T[],
  umbral: number
): { grandes: T[]; restos: GrupoResto<T>[] } {
  const grandes: T[] = [];
  const grupos = new Map<string, GrupoResto<T>>();
  for (const f of filas) {
    if (f.unidades_ventana >= umbral) {
      grandes.push(f);
      continue;
    }
    const llave = claveResto(f.genero_id, f.mundo_id);
    const g = grupos.get(llave) ?? { grupo_resto: llave, genero_id: f.genero_id, mundo_id: f.mundo_id, miembros: [] };
    g.miembros.push(f);
    grupos.set(llave, g);
  }
  return { grandes, restos: [...grupos.values()].sort((a, b) => (a.grupo_resto < b.grupo_resto ? -1 : a.grupo_resto > b.grupo_resto ? 1 : 0)) };
}

/**
 * Reparte `total` en `pesos.length` partes proporcionales a `pesos` con `decimales` decimales y SUMA EXACTA (método del mayor
 * resto: lo que sobra al redondear va, de a una unidad mínima, a quienes tienen mayor fracción; empate: el de menor índice).
 * Pesos que suman 0 → reparto parejo. Pesos negativos cuentan como 0.
 */
export function repartirProporcional(total: number, pesos: readonly number[], decimales = 4): number[] {
  if (pesos.length === 0) return [];
  const escala = 10 ** decimales;
  const objetivo = Math.round(total * escala);
  const limpios = pesos.map((p) => (Number.isFinite(p) && p > 0 ? p : 0));
  const suma = limpios.reduce((a, b) => a + b, 0);
  const usados = suma > 0 ? limpios : limpios.map(() => 1);
  const sumaUsados = suma > 0 ? suma : usados.length;
  const exactos = usados.map((p) => (objetivo * p) / sumaUsados);
  const base = exactos.map((x) => Math.floor(x + 1e-9));
  let falta = objetivo - base.reduce((a, b) => a + b, 0);
  const orden = exactos.map((x, i) => ({ i, resto: x - base[i] })).sort((a, b) => b.resto - a.resto || a.i - b.i);
  for (let j = 0; falta > 0 && orden.length > 0; j = (j + 1) % orden.length) {
    base[orden[j].i] += 1;
    falta -= 1;
  }
  return base.map((x) => x / escala);
}

/**
 * `expandirResto(participacionDelResto, miembros)`: una fila por miembro con su parte del resto, en proporción a `peso`
 * (la suma de sus unidades normalizadas en la ventana), y `grupo_resto` para dejar constancia. La suma es EXACTA (4 decimales):
 * `Σ participacion = participacionDelResto` (redondeada a 4 decimales).
 */
export function expandirResto(
  grupoResto: string,
  participacion: number,
  miembros: readonly { clave: ClaveG; peso: number }[]
): { clave: ClaveG; grupo_resto: string; participacion: number }[] {
  const partes = repartirProporcional(participacion, miembros.map((m) => m.peso));
  return miembros.map((m, i) => ({ clave: m.clave, grupo_resto: grupoResto, participacion: partes[i] }));
}
