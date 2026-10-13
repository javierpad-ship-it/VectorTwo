import { aCodigo } from "@/lib/arbol/normalizar";
import { similitud } from "@/lib/ventas/sugerir-mapeo";
import { esMarcaGenerica, miembrosPorCabeza, type MarcaConjunto } from "./reglas";
import type { GrupoSugeridoConjunto, RazonSugerenciaConjunto } from "../tipos-api";

/**
 * Sugerencia de conjuntos por parecido de nombre (02b, regla 24). SOLO AYUDA:
 * nunca escribe nada y es determinista. Dos señales:
 *
 *   - `primera_palabra`: la misma primera palabra de `aCodigo` (de 3 letras o
 *     más y fuera de una lista corta de palabras vacías);
 *   - `similar`: `similitud` de 05b (Dice sobre bigramas de `aCodigo`) >= umbral.
 *
 * `similitud` se IMPORTA de `src/lib/ventas/sugerir-mapeo.ts`; aquí no se
 * reimplementa. Los grupos son las componentes conexas de las parejas unidas por
 * alguna señal, con 2 marcas o más, de mayor a menor tamaño.
 */

export const UMBRAL_CONJUNTOS = 0.5;
/** Palabras que no identifican una casa ni una licencia (lista corta y editable). */
export const PALABRAS_VACIAS = ["THE", "NEW", "LA", "EL", "BY"] as const;
const MIN_LETRAS_PRIMERA_PALABRA = 3;

export type MarcaParaSugerir = MarcaConjunto & { agrupacion_nombre: string };

const fmt2 = (x: number) => x.toFixed(2).replace(".", ",");

function primeraPalabra(nombre: string): string | null {
  const palabra = aCodigo(nombre).split("_")[0] ?? "";
  if (palabra.length < MIN_LETRAS_PRIMERA_PALABRA) return null;
  if ((PALABRAS_VACIAS as readonly string[]).includes(palabra)) return null;
  return palabra;
}

const comparar = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * `umbral` es la similitud mínima (0,3 a 0,9 en la API). Candidatas: marcas
 * activas sin conjunto, que no son cabeza de otro ni genéricas. Una marca que
 * ya es cabeza no se ofrece: para sumarle miembros está la pestaña del conjunto.
 * La cabeza propuesta es la de nombre más corto y, a igualdad, la primera de la
 * lista recibida.
 */
export function sugerirConjuntos(
  marcas: readonly MarcaParaSugerir[],
  umbral: number = UMBRAL_CONJUNTOS
): GrupoSugeridoConjunto[] {
  const miembros = miembrosPorCabeza(marcas);
  const candidatas = marcas.filter(
    (m) => m.activo && m.conjunto_marca_id === null && !(miembros.get(m.id)?.length ?? 0) && !esMarcaGenerica(m.nombre)
  );

  type Arista = { a: number; b: number; razones: RazonSugerenciaConjunto[] };
  const aristas: Arista[] = [];
  const palabras = candidatas.map((m) => primeraPalabra(m.nombre));

  for (let i = 0; i < candidatas.length; i++) {
    for (let j = i + 1; j < candidatas.length; j++) {
      const razones: RazonSugerenciaConjunto[] = [];
      const pi = palabras[i];
      if (pi !== null && pi === palabras[j]) {
        razones.push({
          a: candidatas[i].nombre,
          b: candidatas[j].nombre,
          razon: "primera_palabra",
          detalle: `primera palabra común: ${pi}`,
        });
      }
      const s = similitud(candidatas[i].nombre, candidatas[j].nombre);
      if (s >= umbral) {
        razones.push({
          a: candidatas[i].nombre,
          b: candidatas[j].nombre,
          razon: "similar",
          similitud: s,
          detalle: `similar ${fmt2(s)}`,
        });
      }
      if (razones.length > 0) aristas.push({ a: i, b: j, razones });
    }
  }

  // Componentes conexas (unión-búsqueda).
  const padre = candidatas.map((_, i) => i);
  const raiz = (i: number): number => {
    while (padre[i] !== i) {
      padre[i] = padre[padre[i]];
      i = padre[i];
    }
    return i;
  };
  for (const e of aristas) padre[raiz(e.a)] = raiz(e.b);

  const componentes = new Map<number, number[]>();
  candidatas.forEach((_, i) => {
    const r = raiz(i);
    const lista = componentes.get(r) ?? [];
    lista.push(i);
    componentes.set(r, lista);
  });

  const grupos: GrupoSugeridoConjunto[] = [];
  for (const indices of componentes.values()) {
    if (indices.length < 2) continue;
    const enGrupo = new Set(indices);
    let cabeza = indices[0];
    for (const i of indices) if (candidatas[i].nombre.length < candidatas[cabeza].nombre.length) cabeza = i;
    const razones = aristas.filter((e) => enGrupo.has(e.a)).flatMap((e) => e.razones);
    const ordenadas = [...indices].sort((x, y) => comparar(candidatas[x].nombre, candidatas[y].nombre));
    grupos.push({
      cabeza_id: candidatas[cabeza].id,
      cabeza: { id: candidatas[cabeza].id, nombre: candidatas[cabeza].nombre },
      marcas: ordenadas.map((i) => ({
        id: candidatas[i].id,
        nombre: candidatas[i].nombre,
        agrupacion_marca: { id: candidatas[i].agrupacion_marca_id, nombre: candidatas[i].agrupacion_nombre },
      })),
      razones,
    });
  }

  return grupos.sort(
    (x, y) => y.marcas.length - x.marcas.length || comparar(x.cabeza.nombre, y.cabeza.nombre)
  );
}
