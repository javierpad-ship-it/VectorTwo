import { recortarPeriodo } from "@/lib/ventas/periodo";
import { TEMPORADAS_AGRUPACION, type TemporadaAgrupacion } from "./tipos-api";

/**
 * Lectura de lo que devuelve la función `jsonb` de la base
 * `venta_estacionalidad_agrupacion` (docs/modulos/06b-curvas-trabajo-por-agrupacion.md,
 * "Modelo de datos", `0017`). Pura: valida y normaliza el JSON (los `numeric` pueden
 * llegar como número o como texto, y `date` como `aaaa-mm-dd`); no nombra ninguna
 * tabla ni función.
 */

/** Venta de la agrupación en una tienda y un mes (`periodo` = `aaaa-mm`). */
export type FilaVentaAgrupacion = {
  tienda_id: string;
  periodo: string;
  unidades: number;
  venta_soles: number;
  costo_vendido: number;
};

/** La temporada de una fila de `temporadas`: la de la agrupación ACTIVA, o `sin_agrupacion`. */
export type TemporadaDeVenta = TemporadaAgrupacion | "sin_agrupacion";

/** Unidades de una temporada en una tienda y un mes. */
export type FilaVentaTemporada = {
  temporada: TemporadaDeVenta;
  tienda_id: string;
  periodo: string;
  unidades: number;
};

export type VentaEstacionalidad = {
  /** Venta de la agrupación pedida; `null` si se pidió sin agrupación (Años Niño). */
  agrupacion: FilaVentaAgrupacion[] | null;
  temporadas: FilaVentaTemporada[];
  /** `aaaa-mm`, ascendente (las llaves de `cargas`). */
  meses_publicados: string[];
  /** `{ "aaaa-mm": carga_id }` de los meses con carga publicada: del MISMO estado que la venta. */
  cargas: Record<string, string>;
};

export const MENSAJE_VENTA_INVALIDA = "La venta de la agrupación llegó incompleta. Vuelve a intentarlo.";

function objeto(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function numero(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

const TEMPORADAS_VALIDAS: readonly string[] = [...TEMPORADAS_AGRUPACION, "sin_agrupacion"];

/**
 * `jsonb` de `venta_estacionalidad_agrupacion` → filas tipadas; `null` si la forma no
 * es la esperada (el handler responde 500 con `MENSAJE_VENTA_INVALIDA`). `cargas` es
 * obligatoria: sin ella no hay huella de cargas que describa los datos leídos.
 */
export function leerVentaEstacionalidad(json: unknown): VentaEstacionalidad | null {
  const raiz = objeto(json);
  if (!raiz || !Array.isArray(raiz.temporadas)) return null;

  let agrupacion: FilaVentaAgrupacion[] | null = null;
  if (raiz.agrupacion !== null && raiz.agrupacion !== undefined) {
    if (!Array.isArray(raiz.agrupacion)) return null;
    agrupacion = [];
    for (const crudo of raiz.agrupacion) {
      const f = objeto(crudo);
      if (!f || typeof f.tienda_id !== "string" || typeof f.periodo !== "string") return null;
      const unidades = numero(f.unidades);
      const venta = numero(f.venta_soles);
      const costo = numero(f.costo_vendido);
      if (unidades === null || venta === null || costo === null) return null;
      agrupacion.push({ tienda_id: f.tienda_id, periodo: recortarPeriodo(f.periodo), unidades, venta_soles: venta, costo_vendido: costo });
    }
  }

  const temporadas: FilaVentaTemporada[] = [];
  for (const crudo of raiz.temporadas) {
    const f = objeto(crudo);
    if (!f || typeof f.tienda_id !== "string" || typeof f.periodo !== "string" || typeof f.temporada !== "string") return null;
    if (!TEMPORADAS_VALIDAS.includes(f.temporada)) return null;
    const unidades = numero(f.unidades);
    if (unidades === null) return null;
    temporadas.push({ temporada: f.temporada as TemporadaDeVenta, tienda_id: f.tienda_id, periodo: recortarPeriodo(f.periodo), unidades });
  }

  const crudas = objeto(raiz.cargas);
  if (!crudas) return null;
  const cargas: Record<string, string> = {};
  for (const [periodo, id] of Object.entries(crudas)) {
    if (typeof id !== "string") return null;
    cargas[recortarPeriodo(periodo)] = id;
  }
  return { agrupacion, temporadas, meses_publicados: Object.keys(cargas).sort(), cargas };
}
