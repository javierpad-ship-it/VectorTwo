/**
 * «Mis líneas» (ficha 08, regla 9 y §3). Es un FILTRO, nunca un permiso (decisión 28): todos ven y editan todo, así que nada de aquí
 * cambia `puede`. Una fila es mía si su `(género, mundo)` es una combinación de la que soy responsable (M1b); un lote al barrer, si
 * alguno de los `g` de su reparto lo es.
 */
export type Combinacion = { genero_id: string; mundo_id: string };

const clave = (c: Combinacion) => `${c.genero_id}|${c.mundo_id}`;

/** `true` si la unidad (una fila, o los `g` de un lote) cae en alguna de mis combinaciones. Sin combinaciones, nada es mío. */
export function esMia(unidad: Combinacion | readonly Combinacion[] | null | undefined, combinaciones: readonly Combinacion[]): boolean {
  if (!unidad || combinaciones.length === 0) return false;
  const mias = new Set(combinaciones.map(clave));
  const lista = Array.isArray(unidad) ? (unidad as readonly Combinacion[]) : [unidad as Combinacion];
  return lista.some((c) => mias.has(clave(c)));
}

/** Un planner sin combinaciones tiene «Mis líneas» vacío. */
export const tieneMisLineas = (combinaciones: readonly Combinacion[]): boolean => combinaciones.length > 0;

/** Con qué chip abre Huecos: «Mis líneas» si el usuario tiene combinaciones; si no, «Todas». */
export const filtroMioInicial = (combinaciones: readonly Combinacion[]): "mias" | "todas" => (tieneMisLineas(combinaciones) ? "mias" : "todas");
