import { aPeriodo } from "@/lib/ventas/periodo";
import { indiceMes } from "./calendario";
import { MESES_UNIVERSO, type FilaVenta, type VentaProyeccion } from "./tipos";

/**
 * Universo de filas (ficha 07, sección 3, "Fila"): las filas GML × agrupación de marca con al menos una unidad vendida, en
 * cualquier tienda (sin el CD), en los últimos `MESES_UNIVERSO` (24) meses publicados hasta `k`. Puro.
 */

/** `aaaa-mm` del primer mes del universo: `hasta − 23` meses. */
export function inicioDelUniverso(anio: number, k: number, meses = MESES_UNIVERSO): string {
  const idx = indiceMes(anio, k) - (meses - 1);
  return aPeriodo(Math.floor(idx / 12), (idx % 12) + 1);
}

/** Claves `gml|equivalencia|agrupacion_marca` con venta positiva en la ventana. */
export function claveUniverso(f: Pick<FilaVenta, "gml_id" | "equivalencia_id" | "agrupacion_marca_id">): string {
  return `${f.gml_id}|${f.equivalencia_id ?? ""}|${f.agrupacion_marca_id}`;
}

/** Recorta la lectura de venta al universo de filas; `detalle_w12` y `por_tienda` se recortan a las mismas filas. */
export function filtrarUniverso(venta: VentaProyeccion, anio: number, k: number, meses = MESES_UNIVERSO): VentaProyeccion {
  const desde = inicioDelUniverso(anio, k, meses);
  const hasta = aPeriodo(anio, k);
  const suma = new Map<string, number>();
  for (const f of venta.filas) {
    const p = f.periodo.slice(0, 7);
    if (p < desde || p > hasta) continue;
    const c = claveUniverso(f);
    suma.set(c, (suma.get(c) ?? 0) + f.unidades);
  }
  const dentro = new Set([...suma].filter(([, u]) => u > 0).map(([c]) => c));
  return {
    ...venta,
    filas: venta.filas.filter((f) => dentro.has(claveUniverso(f))),
    por_tienda: venta.por_tienda.filter((f) => dentro.has(claveUniverso(f))),
    detalle_w12: venta.detalle_w12.filter((f) => dentro.has(claveUniverso(f))),
  };
}

