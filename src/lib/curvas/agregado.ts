import { recortarPeriodo } from "@/lib/ventas/periodo";
import type { FilaAgregado } from "./tipos";

/**
 * Lectura del agregado que devuelve la función `jsonb` de la base
 * (docs/modulos/06-curvas-estacionalidad.md, "Modelo de datos", `0016`). Pura:
 * valida y normaliza el JSON (los `numeric` pueden llegar como número o como
 * texto, y `date` como `aaaa-mm-dd`); no nombra ninguna tabla ni función.
 */

export type RefrescoAgregado = { filas: number; duracion_ms: number; refrescada_at: string | null };

export type AgregadoLeido = { refresco: RefrescoAgregado; filas: FilaAgregado[] };

const MENSAJE_INVALIDO = "El agregado de ventas llegó incompleto. Vuelve a intentarlo.";

function objeto(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function numero(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/** `{ refresco, filas }` de la función → filas tipadas; `null` si la forma no es la esperada (el handler responde 500 con `MENSAJE_AGREGADO_INVALIDO`). */
export function leerAgregado(json: unknown): AgregadoLeido | null {
  const raiz = objeto(json);
  if (!raiz || !Array.isArray(raiz.filas)) return null;
  const r = objeto(raiz.refresco) ?? {};
  const filas: FilaAgregado[] = [];
  for (const crudo of raiz.filas) {
    const f = objeto(crudo);
    if (!f || typeof f.tienda_id !== "string" || typeof f.periodo !== "string") return null;
    const unidades = numero(f.unidades);
    const venta = numero(f.venta_soles);
    const costo = numero(f.costo_vendido);
    if (unidades === null || venta === null || costo === null) return null;
    filas.push({
      agrupacion_id: typeof f.agrupacion_id === "string" ? f.agrupacion_id : null,
      tienda_id: f.tienda_id,
      periodo: recortarPeriodo(f.periodo),
      unidades,
      venta_soles: venta,
      costo_vendido: costo,
    });
  }
  return {
    refresco: {
      filas: numero(r.filas) ?? filas.length,
      duracion_ms: numero(r.duracion_ms) ?? 0,
      refrescada_at: typeof r.refrescada_at === "string" ? r.refrescada_at : null,
    },
    filas,
  };
}

export const MENSAJE_AGREGADO_INVALIDO = MENSAJE_INVALIDO;
