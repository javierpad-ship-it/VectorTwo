import { claveFlujo, type ConfigFlujo } from "@/lib/marcas/gml/flujo";
import { recortarPeriodo } from "@/lib/ventas/periodo";
import { claveG, type ClaveG, type HechoBarrer, type Mes, type SerieG, type TotalBarrer } from "./tipos";

/**
 * Clasificación de los hechos de una marca (ficha 12, reglas 1 y 2 del método). Pura: recibe lo que devuelve la función SQL
 * `venta_marca_gml` (ya agregado por unidad × `g` × mes, sin talla, solo tiendas de tipo Tienda y cargas publicadas) y decide, con
 * `claveFlujo` y la configuración vigente de 02b, si cada hecho es de la parte al barrer (`u`), de la parte específica de una
 * mixta (`e`) o del resto del GML (solo alimenta `U`):
 *
 *   `{ tipo: "barrido" }`                       → `u`
 *   `{ tipo: "unidad", marca_id: <la marca> }`  → `e`   (solo una mixta en un GML donde es relevante)
 *   cualquier otra                              → resto (no se guarda: `resto = U − u − e`)
 *
 * Un hecho de un miembro del conjunto (BETA UNO) llega ya sumado en la cabeza (la unidad); la partición es completa y disjunta.
 */

/** Una equivalencia cualquiera del nodo, para evaluar `claveFlujo` cuando el hecho no la trae (nodo GML). */
export function equivalenciaPorNodo(config: ConfigFlujo): Map<string, string> {
  const salida = new Map<string, string>();
  for (const [equivalencia, nodo] of [...config.nodoDeEquivalencia].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (!salida.has(nodo)) salida.set(nodo, equivalencia);
  }
  return salida;
}

export type ClasificacionBarrer = {
  series: Map<ClaveG, SerieG>;
  /** Hechos que la configuración no supo ubicar (nodo sin equivalencia conocida): no entran en `u` ni en `e`. */
  omitidos: number;
};

function serieDe(series: Map<ClaveG, SerieG>, gmlId: string, equivalenciaId: string | null): SerieG {
  const clave = claveG(gmlId, equivalenciaId);
  let s = series.get(clave);
  if (!s) {
    s = { clave, gml_id: gmlId, equivalencia_id: equivalenciaId, u: new Map(), e: new Map(), U: new Map() };
    series.set(clave, s);
  }
  return s;
}

const sumar = (m: Map<Mes, number>, mes: Mes, v: number) => m.set(mes, (m.get(mes) ?? 0) + v);

/**
 * Regla 1 y 2. `marcaId` es la UNIDAD (cabeza del conjunto). Los hechos de otras unidades se ignoran (la función SQL puede
 * devolver varias a la vez). `totales` es la venta de todas las marcas en las mismas `g`: da `U`. Si una `g` trae hechos y no
 * totales, `U` se completa con `u + e` (nunca queda por debajo de lo que la propia marca vendió).
 */
export function clasificarHechos(
  hechos: readonly HechoBarrer[],
  totales: readonly TotalBarrer[],
  config: ConfigFlujo,
  marcaId: string
): ClasificacionBarrer {
  const series = new Map<ClaveG, SerieG>();
  const equivalencias = equivalenciaPorNodo(config);
  let omitidos = 0;

  for (const h of hechos) {
    if (h.unidad_marca_id !== marcaId) continue;
    const mes = recortarPeriodo(h.periodo);
    const equivalencia = h.equivalencia_id ?? equivalencias.get(h.gml_id);
    if (equivalencia === undefined) {
      omitidos += 1;
      continue;
    }
    let clave;
    try {
      clave = claveFlujo({ marca_id: marcaId, equivalencia_id: equivalencia }, config);
    } catch {
      omitidos += 1;
      continue;
    }
    const s = serieDe(series, h.gml_id, h.equivalencia_id);
    if (clave.tipo === "barrido") sumar(s.u, mes, h.unidades);
    else if (clave.marca_id === marcaId) sumar(s.e, mes, h.unidades);
    // Cualquier otra clave (otras de la agrupación) no es de la marca: no puede pasar con una marca analizada vigente.
    else omitidos += 1;
  }

  const conHechos = new Set(series.keys());
  for (const t of totales) {
    const clave = claveG(t.gml_id, t.equivalencia_id);
    if (!conHechos.has(clave)) continue;
    sumar((series.get(clave) as SerieG).U, recortarPeriodo(t.periodo), t.unidades);
  }
  for (const s of series.values()) {
    const meses = new Set([...s.u.keys(), ...s.e.keys()]);
    for (const m of meses) {
      const propio = (s.u.get(m) ?? 0) + (s.e.get(m) ?? 0);
      if ((s.U.get(m) ?? 0) < propio) s.U.set(m, propio);
    }
  }
  return { series, omitidos };
}

/** `u + e + resto = U` para cada `(g, mes)` con venta de la marca: el resto del GML (lo que no es de la marca). */
export function restoDelGml(s: SerieG, mes: Mes): number {
  return (s.U.get(mes) ?? 0) - (s.u.get(mes) ?? 0) - (s.e.get(mes) ?? 0);
}
