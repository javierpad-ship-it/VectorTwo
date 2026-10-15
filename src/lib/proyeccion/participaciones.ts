import { claveFlujo, type ConfigFlujo } from "@/lib/marcas/gml/flujo";
import type { Participaciones } from "./tipos-api";

/**
 * Participaciones históricas por fila base (ficha 07, I6 y regla 26). Puro. Solo dato: para que M8 reparta el total
 * mensual sin releer venta. Sobre `W12` y `M(Y)`: la participación en unidades de cada `claveFlujo` (02b: marca
 * relevante, "otras" y al barrer, evaluada sobre la UNIDAD de marca) y de cada agrupación de talla. `Σ = 1` por eje.
 */

/** Una fila de `detalle_w12` de `venta_proyeccion`. */
export type DetalleW12 = {
  gml_id: string;
  equivalencia_id: string | null;
  agrupacion_marca_id: string;
  marca_id: string;
  agrupacion_talla_id: string;
  unidades: number;
};

/** Una equivalencia cualquiera del nodo, para evaluar `claveFlujo` cuando la lectura no trae `equivalencia_id` (nodo GML). */
export function equivalenciaDeNodo(config: ConfigFlujo): Map<string, string> {
  const salida = new Map<string, string>();
  for (const [equivalencia, nodo] of [...config.nodoDeEquivalencia].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (!salida.has(nodo)) salida.set(nodo, equivalencia);
  }
  return salida;
}

/** Etiqueta estable de una `claveFlujo` colapsada a la fila: `marca:<id>`, `otras` o `barrido:<id>`. */
function etiquetaFlujo(clave: ReturnType<typeof claveFlujo>): { clave_flujo: string; marca_id: string | null } {
  if (clave.tipo === "barrido") return { clave_flujo: `barrido:${clave.marca_id}`, marca_id: clave.marca_id };
  if (clave.marca_id !== null) return { clave_flujo: `marca:${clave.marca_id}`, marca_id: clave.marca_id };
  return { clave_flujo: "otras", marca_id: null };
}

function normalizarPorEje<T extends { participacion: number }>(items: T[]): T[] | null {
  const total = items.reduce((a, b) => a + b.participacion, 0);
  if (!(total > 0)) return null;
  return items.map((i) => ({ ...i, participacion: i.participacion / total }));
}

/**
 * Regla 26. Participaciones de UNA fila base a partir de su `detalle_w12`. Sin venta en la ventana → `null`.
 * Las unidades netas negativas por clave se truncan a 0 antes de normalizar.
 */
export function participacionesFila(detalle: readonly DetalleW12[], config: ConfigFlujo): Participaciones | null {
  if (detalle.length === 0) return null;
  const nodoEquivalencia = equivalenciaDeNodo(config);

  const flujo = new Map<string, { clave_flujo: string; marca_id: string | null; u: number }>();
  const talla = new Map<string, number>();
  for (const h of detalle) {
    const equivalencia = h.equivalencia_id ?? nodoEquivalencia.get(h.gml_id);
    // Una marca o equivalencia que la configuración no conoce (creada después de leerla) cuenta como «otras» en vez de romper el cálculo.
    let etiqueta: { clave_flujo: string; marca_id: string | null };
    try {
      if (equivalencia === undefined) throw new Error("nodo sin equivalencia en la configuración");
      etiqueta = etiquetaFlujo(claveFlujo({ marca_id: h.marca_id, equivalencia_id: equivalencia }, config));
    } catch {
      etiqueta = { clave_flujo: "otras", marca_id: null };
    }
    const previo = flujo.get(etiqueta.clave_flujo) ?? { ...etiqueta, u: 0 };
    previo.u += h.unidades;
    flujo.set(etiqueta.clave_flujo, previo);
    talla.set(h.agrupacion_talla_id, (talla.get(h.agrupacion_talla_id) ?? 0) + h.unidades);
  }

  const porFlujo = normalizarPorEje(
    [...flujo.values()]
      .map((f) => ({ clave_flujo: f.clave_flujo, marca_id: f.marca_id, participacion: Math.max(0, f.u) }))
      .sort((a, b) => a.clave_flujo.localeCompare(b.clave_flujo))
  );
  const porTalla = normalizarPorEje(
    [...talla]
      .map(([agrupacion_talla_id, u]) => ({ agrupacion_talla_id, participacion: Math.max(0, u) }))
      .sort((a, b) => a.agrupacion_talla_id.localeCompare(b.agrupacion_talla_id))
  );
  if (porFlujo === null || porTalla === null) return null;
  return {
    por_clave_flujo: porFlujo.filter((p) => p.participacion > 0),
    por_talla: porTalla.filter((p) => p.participacion > 0),
  };
}
