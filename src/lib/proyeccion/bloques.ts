import { TIPO_TIENDA } from "@/lib/curvas/red";
import type { TiendaMaestro } from "@/lib/curvas/tipos";
import { soloFecha } from "./calendario";
import type { BloquesAnioApi, Bloque, Subbloque, TiendaBloqueApi } from "./tipos-api";

/**
 * Bloques de tiendas por año proyectado (ficha 07, reglas 1 a 4; sección 3). Puro.
 *
 * Para el año `Z`:
 *   - mismas `M(Z)`: tipo Tienda, activa, `fecha_apertura ≤ (Z−1)-01-01` y sin cierre o con cierre `≥ Z-12-31`;
 *   - nuevas `N(Z)`: abrieron después del 1 de enero de `Z−1` y a más tardar el 31 de diciembre de `Z`
 *     (`nuevas_anterior` si abrieron en `Z−1`, `aperturas` si abren en `Z`);
 *   - cierres `C(Z)`: cierran entre el 1 de enero y el 30 de diciembre de `Z`;
 *   - fuera: CD, desactivadas, sin apertura, abren después de `Z` o cerraron antes de `Z`.
 * Cada tienda cae en exactamente un bloque por año.
 */

/** Lo que el método necesita de una tienda: las fechas de M4 más venta esperada, referente, zona y rampa propia. */
export type TiendaProy = TiendaMaestro & {
  zona: string | null;
  /** `0.10.8` (07d): venta MENSUAL promedio esperada en régimen, en soles sin IGV (M7 la multiplica por 12 y la estacionaliza en los meses abiertos). */
  venta_esperada: number | null;
  referente_id: string | null;
  /** Rampa propia de la tienda (si no, manda la de la proyección). */
  rampa?: number[] | null;
};

export type MotivoTienda =
  | "misma"
  | "nueva_anio_anterior"
  | "apertura_del_anio"
  | "cierre_del_anio"
  | "cd"
  | "desactivada"
  | "sin_apertura"
  | "planificada_despues"
  | "cerrada_antes";

export function textoMotivoTienda(motivo: string, anio: number): string {
  switch (motivo) {
    case "misma":
      return `Abierta los doce meses de ${anio - 1}`;
    case "nueva_anio_anterior":
      return `Abrió durante ${anio - 1}: opera todo ${anio} pero no estuvo todo ${anio - 1}`;
    case "apertura_del_anio":
      return `Abre durante ${anio}`;
    case "cierre_del_anio":
      return `Cierra durante ${anio}`;
    case "cd":
      return "Centro de distribución: no entra en la proyección";
    case "desactivada":
      return "Tienda desactivada";
    case "sin_apertura":
      return "Sin fecha de apertura";
    case "planificada_despues":
      return `Abre después de ${anio}`;
    case "cerrada_antes":
      return `Cerró antes de ${anio}`;
    default:
      return motivo;
  }
}

export type ClasificacionTienda = { bloque: Bloque | "fuera"; subbloque?: Subbloque; motivo: MotivoTienda };

/** Clasifica una tienda para el año `Z` (reglas 1 a 4). */
export function clasificarTienda(t: TiendaMaestro, anio: number): ClasificacionTienda {
  if (t.tipo !== TIPO_TIENDA) return { bloque: "fuera", motivo: "cd" };
  if (!t.activo) return { bloque: "fuera", motivo: "desactivada" };
  const apertura = t.fecha_apertura ? soloFecha(t.fecha_apertura) : null;
  if (!apertura) return { bloque: "fuera", motivo: "sin_apertura" };
  const cierre = t.fecha_cierre ? soloFecha(t.fecha_cierre) : null;

  if (apertura > `${anio}-12-31`) return { bloque: "fuera", motivo: "planificada_despues" };
  if (cierre !== null && cierre < `${anio}-01-01`) return { bloque: "fuera", motivo: "cerrada_antes" };
  // Cierre dentro del año (el 31 de diciembre sigue contando como año completo, regla 3).
  if (cierre !== null && cierre <= `${anio}-12-30`) return { bloque: "cierres", motivo: "cierre_del_anio" };
  if (apertura <= `${anio - 1}-01-01`) return { bloque: "mismas", motivo: "misma" };
  if (apertura <= `${anio - 1}-12-31`) return { bloque: "nuevas", subbloque: "nuevas_anterior", motivo: "nueva_anio_anterior" };
  return { bloque: "nuevas", subbloque: "aperturas", motivo: "apertura_del_anio" };
}

/** ¿La tienda está en `M(Z)`? */
export function esMisma(t: TiendaMaestro, anio: number): boolean {
  return clasificarTienda(t, anio).bloque === "mismas";
}

/**
 * Cadena de cinco caracteres `0`/`1` con la pertenencia a `M(Y−3) … M(Y+1)` en ese orden.
 * Una tienda que no está en ninguna es `00000`.
 */
export function clavePertenencia(t: TiendaMaestro, anioEnCurso: number): string {
  let clave = "";
  for (let z = anioEnCurso - 3; z <= anioEnCurso + 1; z++) clave += esMisma(t, z) ? "1" : "0";
  return clave;
}

/** Posición de `anio` dentro de la clave de pertenencia (0 a 4), o `null` si cae fuera de `Y−3 … Y+1`. */
export function posicionEnClave(anioEnCurso: number, anio: number): number | null {
  const p = anio - (anioEnCurso - 3);
  return p >= 0 && p <= 4 ? p : null;
}

/** `true` si la clave tiene `1` en la posición del año `anio`. */
export function claveIncluye(clave: string, anioEnCurso: number, anio: number): boolean {
  const p = posicionEnClave(anioEnCurso, anio);
  return p !== null && clave.charAt(p) === "1";
}

/** `tienda_id → clave de pertenencia` de las tiendas de tipo Tienda (el CD no entra: la lectura de venta lo excluye). */
export function clavesPertenencia(tiendas: readonly TiendaMaestro[], anioEnCurso: number): Record<string, string> {
  const salida: Record<string, string> = {};
  for (const t of tiendas) if (t.tipo === TIPO_TIENDA) salida[t.id] = clavePertenencia(t, anioEnCurso);
  return salida;
}

/**
 * Los cuatro bloques de un año. `claves` (opcional) pone la clave de pertenencia de
 * cada tienda en el resultado; las listas van por código de tienda.
 */
export function bloquesDeAnio(
  tiendas: readonly (TiendaMaestro & Partial<TiendaProy>)[],
  anio: number,
  claves: Readonly<Record<string, string>> = {}
): BloquesAnioApi {
  const salida: BloquesAnioApi = { mismas: [], nuevas: [], cierres: [], fuera: [] };
  const ordenadas = [...tiendas].sort((a, b) => a.codigo.localeCompare(b.codigo, "es") || a.id.localeCompare(b.id));
  for (const t of ordenadas) {
    const c = clasificarTienda(t, anio);
    const item: TiendaBloqueApi = {
      tienda_id: t.id,
      codigo: t.codigo,
      nombre: t.nombre,
      fecha_apertura: t.fecha_apertura ? soloFecha(t.fecha_apertura) : null,
      fecha_cierre: t.fecha_cierre ? soloFecha(t.fecha_cierre) : null,
      motivo: c.motivo,
      clave: claves[t.id] ?? "00000",
      venta_esperada: t.venta_esperada ?? null,
      referente_id: t.referente_id ?? null,
      zona: t.zona ?? null,
      ...(c.subbloque ? { subbloque: c.subbloque } : {}),
      ...(t.rampa ? { rampa: [...t.rampa] } : {}),
    };
    if (c.bloque === "fuera") salida.fuera.push(item);
    else salida[c.bloque].push(item);
  }
  return salida;
}

/** Ids de tienda de una lista de bloque. */
export const idsDe = (lista: readonly TiendaBloqueApi[]): Set<string> => new Set(lista.map((t) => t.tienda_id));
