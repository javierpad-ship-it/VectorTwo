import { normalizarNombre } from "@/lib/arbol/normalizar";
import { normalizarEquivalencia } from "./interpretar";
import { COMODIN_EQUIVALENCIA, type OrigenMapeo } from "./tipos-mapeo";

/**
 * Piezas comunes del origen de un mapeo (mejora M5b). Puras y sin base: las
 * usan el resolutor, la planificación de altas e importación y el estado de
 * cada mapeo.
 */

const SEP = "\u0001";

/** `(vacío)` para las piezas en blanco, como en los detalles de `clasificacion_incompleta`. */
export const vacioLegible = (v: string) => (v === "" ? "(vacío)" : v);

/**
 * Origen canónico: género, mundo y línea con `normalizarNombre`; la equivalencia
 * con las reglas del archivo (`-` → nombre de la línea, vacío o
 * `SIN EQUIVALENCIA` → `SIN EQUIVALENCIA`) o el comodín `*`, que se conserva.
 */
export function normalizarOrigen(o: OrigenMapeo): OrigenMapeo {
  const genero = normalizarNombre(o.genero);
  const mundo = normalizarNombre(o.mundo);
  const linea = normalizarNombre(o.linea);
  const eq = normalizarNombre(o.equivalencia);
  return {
    genero,
    mundo,
    linea,
    equivalencia: eq === COMODIN_EQUIVALENCIA ? COMODIN_EQUIVALENCIA : normalizarEquivalencia(eq, linea),
  };
}

/** Los tres en blanco: es `sin_clasificar`, que no se puede mapear. */
export const ternaVacia = (o: OrigenMapeo): boolean => o.genero === "" && o.mundo === "" && o.linea === "";

/** Clave exacta (el origen ya normalizado). */
export const claveOrigen = (o: OrigenMapeo): string => `${o.genero}${SEP}${o.mundo}${SEP}${o.linea}${SEP}${o.equivalencia}`;

/** Clave de la terna (sin la equivalencia): la de los mapeos con comodín. */
export const claveTerna = (o: OrigenMapeo): string => `${o.genero}${SEP}${o.mundo}${SEP}${o.linea}`;

/** `GENERO / MUNDO / LINEA / EQUIVALENCIA` con `(vacío)` en las piezas en blanco y `*` como "cualquier equivalencia". */
export function describirOrigen(o: OrigenMapeo): string {
  const eq = o.equivalencia === COMODIN_EQUIVALENCIA ? "cualquier equivalencia" : o.equivalencia;
  return `${vacioLegible(o.genero)} / ${vacioLegible(o.mundo)} / ${vacioLegible(o.linea)} / ${eq}`;
}

export const esComodinOrigen = (o: OrigenMapeo): boolean => o.equivalencia === COMODIN_EQUIVALENCIA;

/**
 * Comodín mal usado en un origen ya normalizado: `*` dentro de género, mundo o
 * línea, o en la equivalencia mezclado con otro texto (`FOO*`). El único
 * comodín válido es `*` solo, en la equivalencia.
 */
export const comodinInvalido = (o: OrigenMapeo): boolean =>
  o.genero.includes(COMODIN_EQUIVALENCIA) ||
  o.mundo.includes(COMODIN_EQUIVALENCIA) ||
  o.linea.includes(COMODIN_EQUIVALENCIA) ||
  (o.equivalencia.includes(COMODIN_EQUIVALENCIA) && o.equivalencia !== COMODIN_EQUIVALENCIA);
