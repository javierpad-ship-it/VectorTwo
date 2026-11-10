import { claveIncluye } from "@/lib/proyeccion/bloques";
import type { BloquesAnioApi, BloquesApi, TiendaBloqueApi } from "@/lib/proyeccion/tipos-api";
import type { ComparativoApi, SituacionTienda } from "./tipos-api";
import { rangoMeses, variacionPct } from "./textos";

/**
 * Comparativos del tablero de dirección (ficha 14, R7). Puro. Cada % se calcula SOBRE SUMAS (nunca como promedio de %); «mismas» de «Z frente a Z−1»
 * usa el conjunto `M(Z)` arriba y abajo, leído de las claves de pertenencia GUARDADAS en `parametros.bloques` (cambiar una fecha en M4 después de
 * calcular no cambia el conjunto).
 */

// ─── Conjuntos de tiendas según los bloques guardados ───

const GRUPOS = ["mismas", "nuevas", "cierres", "fuera"] as const;

/** Todas las tiendas que aparecen en los bloques guardados (de cualquier año y grupo), una vez cada una, con su clave de pertenencia. */
export function tiendasDeBloques(bloques: BloquesApi): Map<string, TiendaBloqueApi> {
  const salida = new Map<string, TiendaBloqueApi>();
  for (const anio of Object.keys(bloques).sort()) {
    const b = bloques[Number(anio)];
    if (!b) continue;
    for (const g of GRUPOS) for (const t of b[g] ?? []) if (!salida.has(t.tienda_id)) salida.set(t.tienda_id, t);
  }
  return salida;
}

/** `M(Z)`: ids de las tiendas con la posición de `Z` de su clave en `1` (`Z` de `Y−3` a `Y+1`). */
export function mismasDe(bloques: BloquesApi, anioEnCurso: number, anio: number): Set<string> {
  const salida = new Set<string>();
  for (const [id, t] of tiendasDeBloques(bloques)) if (claveIncluye(t.clave ?? "", anioEnCurso, anio)) salida.add(id);
  return salida;
}

const grupoDe = (b: BloquesAnioApi | undefined, id: string): { grupo: (typeof GRUPOS)[number]; item: TiendaBloqueApi } | null => {
  if (!b) return null;
  for (const g of GRUPOS) {
    const item = (b[g] ?? []).find((t) => t.tienda_id === id);
    if (item) return { grupo: g, item };
  }
  return null;
};

/** Situación de una tienda en `bloques[Y+1]` (§4.7): su grupo del año siguiente; `fuera` si no está en ninguno. */
export function situacionTienda(bloques: BloquesApi, anioEnCurso: number, tiendaId: string): SituacionTienda {
  const s = grupoDe(bloques[anioEnCurso + 1], tiendaId);
  if (!s || s.grupo === "fuera") return "fuera";
  if (s.grupo === "mismas") return "mismas";
  if (s.grupo === "cierres") return "cierres";
  return s.item.subbloque === "nuevas_anterior" ? "nuevas_anterior" : "aperturas";
}

/**
 * Clase de una tienda para la atribución (la misma lectura que `clasificarTiendasVenta` de 07f): `misma` (en `bloques[Y+1].mismas` y no nueva de `Y`),
 * `entra` (en `bloques[Y+1].mismas` y en `bloques[Y].nuevas`), `sale` (en `bloques[Y].mismas` y en `bloques[Y+1].cierres`) u `otra`.
 */
export function claseTienda(bloques: BloquesApi, anioEnCurso: number, tiendaId: string): "misma" | "entra" | "sale" | "otra" {
  const y = grupoDe(bloques[anioEnCurso], tiendaId);
  const s = grupoDe(bloques[anioEnCurso + 1], tiendaId);
  if (s?.grupo === "mismas") return y?.grupo === "nuevas" ? "entra" : "misma";
  if (y?.grupo === "mismas" && s?.grupo === "cierres") return "sale";
  return "otra";
}

// ─── Variaciones ───

export type LadoComparativo = {
  actual: number | null;
  anterior: number | null;
  /** Falta un mes publicado en alguno de los dos periodos (o, en «mismas», una tienda del conjunto no estuvo abierta todo el periodo base). */
  incompleto: boolean;
};

export type EntradaComparativo = {
  clave: ComparativoApi["clave"];
  etiqueta: string;
  nino: boolean;
  total: LadoComparativo;
  /** `null`: no hay conjunto de mismas tiendas para este par. `anteriorCorregido`: la misma base corregida del Niño (solo año siguiente sobre el cierre). */
  mismas: (LadoComparativo & { tiendas: string[]; anteriorCorregido?: number | null }) | null;
  /** T3: texto de `advertencia` (o `null`); ver `advertenciaMarca`. */
  advertencia?: string | null;
};

/** Variación del total: `incompleto` manda; después `nueva` (el anterior es 0 y el actual mayor que 0) y `sin_base` (el anterior no es mayor que 0). */
export function variacionTotal(l: LadoComparativo): ComparativoApi["total"] {
  if (l.incompleto) return { pct: null, motivo: "incompleto" };
  if (l.actual === null || l.anterior === null) return { pct: null, motivo: "sin_base" };
  if (!(l.anterior > 0)) return { pct: null, motivo: l.anterior === 0 && l.actual > 0 ? "nueva" : "sin_base" };
  return { pct: variacionPct(l.actual, l.anterior), motivo: null };
}

export function variacionMismas(l: (LadoComparativo & { tiendas: string[]; anteriorCorregido?: number | null }) | null): ComparativoApi["mismas"] {
  if (l === null) return { pct: null, tiendas: [], motivo: "sin_base", pct_corregido: null };
  if (l.incompleto) return { pct: null, tiendas: l.tiendas, motivo: "incompleto", pct_corregido: null };
  if (l.tiendas.length === 0 || l.actual === null || l.anterior === null || !(l.anterior > 0)) return { pct: null, tiendas: l.tiendas, motivo: "sin_base", pct_corregido: null };
  return { pct: variacionPct(l.actual, l.anterior), tiendas: l.tiendas, motivo: null, pct_corregido: variacionPct(l.actual, l.anteriorCorregido ?? null) };
}

export const comparativo = (e: EntradaComparativo): ComparativoApi => ({
  clave: e.clave,
  etiqueta: e.etiqueta,
  nino: e.nino,
  total: variacionTotal(e.total),
  mismas: variacionMismas(e.mismas),
  advertencia: e.advertencia ?? null,
});

/**
 * T3: con una unidad de marca, lo proyectado (el año siguiente y el cierre del año en curso, también de enero a `k`) es lo vendido o proyectado de cada
 * fila por la participación de la marca: estimado. Un comparativo que lo pone frente a la venta REAL de la marca (de un año ya cerrado) mezcla las dos
 * cosas y lo dice; los que son real frente a real o estimado frente a estimado no llevan advertencia. Puro.
 */
export function advertenciaMarca(clave: ComparativoApi["clave"], anio: number, conMarca: boolean): string | null {
  if (!conMarca) return null;
  const [a, b] = aniosDeComparativo(clave, anio);
  switch (clave) {
    case "sig_vs_anterior":
    case "cierre_vs_anterior":
    case "cierre_vs_hace_dos":
      return `Compara ${a}${clave === "sig_vs_anterior" ? "" : " cierre"}, estimado con la participación de la marca en cada fila, con la venta real de la marca en ${b}: tómalo como orientación.`;
    default:
      return null;
  }
}

/** Los dos años de cada comparativo (`anio` = `Y`): `[actual, anterior]`. */
export function aniosDeComparativo(clave: ComparativoApi["clave"], anio: number): [number, number] {
  switch (clave) {
    case "sig_vs_cierre":
      return [anio + 1, anio];
    case "sig_vs_anterior":
      return [anio + 1, anio - 1];
    case "cierre_vs_anterior":
      return [anio, anio - 1];
    case "cierre_vs_hace_dos":
      return [anio, anio - 2];
    case "ac_vs_ac":
      return [anio, anio - 1];
    case "anterior_vs_hace_dos":
      return [anio - 1, anio - 2];
  }
}

export const CLAVES_COMPARATIVO: ComparativoApi["clave"][] = ["sig_vs_cierre", "sig_vs_anterior", "cierre_vs_anterior", "cierre_vs_hace_dos", "ac_vs_ac", "anterior_vs_hace_dos"];

/**
 * Etiqueta de un comparativo: «2027 vs 2026 cierre», «2027 vs 2025 (último año normal)», «2026 cierre vs 2025», «2026 ene–oct vs 2025 ene–oct»,
 * «2025 vs 2024». «Último año normal» se dice cuando el año base no es del Niño y el año en curso sí (D14).
 */
export function etiquetaComparativo(clave: ComparativoApi["clave"], anio: number, kPrima: number, aniosNino: ReadonlySet<number>): string {
  const [a, b] = aniosDeComparativo(clave, anio);
  const normal = (z: number) => (!aniosNino.has(z) && aniosNino.has(anio) && z < anio ? " (último año normal)" : "");
  switch (clave) {
    case "sig_vs_cierre":
      return `${a} vs ${b} cierre`;
    case "sig_vs_anterior":
      return `${a} vs ${b}${normal(b)}`;
    case "cierre_vs_anterior":
      return `${a} cierre vs ${b}${normal(b)}`;
    case "cierre_vs_hace_dos":
      return `${a} cierre vs ${b}`;
    case "ac_vs_ac":
      return `${a} ${rangoMeses(1, kPrima)} vs ${b} ${rangoMeses(1, kPrima)}`;
    case "anterior_vs_hace_dos":
      return `${a} vs ${b}`;
  }
}

/** Algún año del par es del Niño (según `periodos_atipicos`). */
export const parConNino = (clave: ComparativoApi["clave"], anio: number, aniosNino: ReadonlySet<number>): boolean => aniosDeComparativo(clave, anio).some((z) => aniosNino.has(z));
