import { claveFlujo, type ConfigFlujo } from "@/lib/marcas/gml/flujo";
import type { Participaciones, PeriodoReferencia } from "./tipos-api";

/**
 * Participaciones históricas por fila base (ficha 07, I6 y regla 26). Puro. Solo dato: para que M8 reparta el total
 * mensual sin releer venta. Sobre `W12` y `M(Y)`: la participación en unidades de cada `claveFlujo` (02b: marca
 * relevante, "otras" y al barrer, evaluada sobre la UNIDAD de marca), de cada unidad de marca (`por_marca`, `0.10.1`: toda unidad
 * con venta en `W12`, tenga o no tratamiento en 02b) y de cada agrupación de talla. `Σ = 1` por eje. `periodo_referencia`
 * (decisión 24) dice sobre qué doce meses y qué tiendas se midió.
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
 * Lee las `participaciones` guardadas. Una cerrada calculada en `0.10.0` no trae `periodo_referencia` ni `por_marca`: llegan
 * `null` (M8 avisa `cerrada_sin_periodo`). Devuelve `null` si lo guardado no tiene la forma esperada.
 */
export function leerParticipaciones(json: unknown): Participaciones | null {
  if (json === null || typeof json !== "object" || Array.isArray(json)) return null;
  const o = json as Partial<Participaciones>;
  if (!Array.isArray(o.por_clave_flujo) || !Array.isArray(o.por_talla)) return null;
  return {
    periodo_referencia: o.periodo_referencia && typeof o.periodo_referencia === "object" ? o.periodo_referencia : null,
    por_clave_flujo: o.por_clave_flujo,
    // Un elemento sin `marca_id` (dato guardado a medias) se descarta en vez de romper la lectura de toda la proyección.
    por_marca: Array.isArray(o.por_marca)
      ? o.por_marca.filter((m): m is NonNullable<Participaciones["por_marca"]>[number] => m !== null && typeof m === "object" && typeof m.marca_id === "string" && m.marca_id !== "" && typeof m.participacion === "number" && Number.isFinite(m.participacion))
      : null,
    por_talla: o.por_talla,
  };
}

/**
 * Regla 26 (y 48). Participaciones de UNA fila base a partir de su `detalle_w12`. Sin venta en la ventana → `null`.
 * Las unidades netas negativas por clave se truncan a 0 antes de normalizar. `por_marca` agrupa por UNIDAD de marca
 * (ALFA JEANS suma en ALFA); una marca que la configuración no conoce cuenta por sí misma.
 */
export function participacionesFila(detalle: readonly DetalleW12[], config: ConfigFlujo, periodoReferencia: PeriodoReferencia): Participaciones | null {
  if (detalle.length === 0) return null;
  const nodoEquivalencia = equivalenciaDeNodo(config);

  const flujo = new Map<string, { clave_flujo: string; marca_id: string | null; u: number }>();
  const talla = new Map<string, number>();
  const marca = new Map<string, number>();
  for (const h of detalle) {
    const unidadMarca = config.unidadDe.get(h.marca_id) ?? h.marca_id;
    marca.set(unidadMarca, (marca.get(unidadMarca) ?? 0) + h.unidades);
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
  const porMarca = normalizarPorEje(
    [...marca]
      .map(([marca_id, u]) => ({ marca_id, participacion: Math.max(0, u) }))
      .sort((a, b) => a.marca_id.localeCompare(b.marca_id))
  );
  const porTalla = normalizarPorEje(
    [...talla]
      .map(([agrupacion_talla_id, u]) => ({ agrupacion_talla_id, participacion: Math.max(0, u) }))
      .sort((a, b) => a.agrupacion_talla_id.localeCompare(b.agrupacion_talla_id))
  );
  if (porFlujo === null || porTalla === null || porMarca === null) return null;
  return {
    periodo_referencia: periodoReferencia,
    por_clave_flujo: porFlujo.filter((p) => p.participacion > 0),
    por_marca: porMarca.filter((p) => p.participacion > 0),
    por_talla: porTalla.filter((p) => p.participacion > 0),
  };
}
