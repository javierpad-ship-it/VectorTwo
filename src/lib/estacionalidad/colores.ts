import { compararOrdenNombre } from "@/lib/arbol/armar-arbol";

/**
 * Color por agrupación de estacionalidad, consistente en toda la app: el
 * mapa, los badges de las tablas y la columna Agrupación del árbol pintan la
 * misma agrupación con el mismo color. Pura, sin React.
 *
 * El color se asigna por **posición estable** en el catálogo ordenado por
 * `orden, nombre` (el mismo orden de los `Select`) y rota si hay más de 12.
 * "Sin agrupación" nunca recibe un color de la paleta: va en tono alerta.
 */

export type ColorAgrupacion = {
  /** Fondo suave para badges y chips (legible con `texto` encima). */
  suave: string;
  /** Texto oscuro sobre `suave`. */
  texto: string;
  /** Color pleno para puntos, barras y franjas. */
  pleno: string;
};

/**
 * Doce tonos accesibles sobre blanco, armónicos con el azul de marca
 * (`#008cff`). Sin rojo ni naranja puros (se confundirían con el tono alerta
 * `#c2410c`) y con tonos vecinos alternados para que dos agrupaciones
 * consecutivas no se parezcan.
 */
export const PALETA_AGRUPACIONES: readonly ColorAgrupacion[] = [
  { suave: "#ccfbf1", texto: "#115e59", pleno: "#0d9488" }, // verde azulado
  { suave: "#ede9fe", texto: "#4c1d95", pleno: "#7c3aed" }, // violeta
  { suave: "#fef9c3", texto: "#713f12", pleno: "#ca8a04" }, // mostaza
  { suave: "#fce7f3", texto: "#831843", pleno: "#db2777" }, // rosa
  { suave: "#dcfce7", texto: "#14532d", pleno: "#16a34a" }, // verde
  { suave: "#e0e7ff", texto: "#312e81", pleno: "#4f46e5" }, // índigo
  { suave: "#cffafe", texto: "#164e63", pleno: "#0891b2" }, // cian
  { suave: "#ecfccb", texto: "#365314", pleno: "#65a30d" }, // lima
  { suave: "#f3e8ff", texto: "#581c87", pleno: "#9333ea" }, // púrpura
  { suave: "#f5ebe0", texto: "#5c3a1a", pleno: "#8b5a2b" }, // marrón
  { suave: "#e0f2fe", texto: "#0c4a6e", pleno: "#0369a1" }, // azul petróleo
  { suave: "#fae8ff", texto: "#701a75", pleno: "#c026d3" }, // fucsia
];

/** Lo mínimo que hace falta de cada agrupación para asignarle color. */
export type AgrupacionConOrden = { id: string; orden: number; nombre: string };

export type MapaColores = ReadonlyMap<string, ColorAgrupacion>;

/**
 * `id → color` para todo el catálogo (activas e inactivas: una inactiva
 * conserva su color para que no cambie el de las demás al desactivarla).
 * Calcúlalo una vez por lista (`useMemo`) y compártelo entre filas.
 */
export function mapaColores(agrupaciones: readonly AgrupacionConOrden[]): MapaColores {
  const ordenadas = [...agrupaciones].sort(compararOrdenNombre);
  const mapa = new Map<string, ColorAgrupacion>();
  ordenadas.forEach((a, i) => {
    mapa.set(a.id, PALETA_AGRUPACIONES[i % PALETA_AGRUPACIONES.length]);
  });
  return mapa;
}

/**
 * Color de una agrupación por su id; `null` para "sin agrupación" (`id`
 * nulo) o para un id que no está en el catálogo.
 */
export function colorDeAgrupacion(id: string | null | undefined, agrupaciones: readonly AgrupacionConOrden[]): ColorAgrupacion | null {
  if (!id) return null;
  return mapaColores(agrupaciones).get(id) ?? null;
}
