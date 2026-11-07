import { MAX_FOTOS_POR_LINEA } from "./constantes";

/**
 * Reglas puras de «Traer fotos de la versión cancelada» (08c, §11.P5, decisión 104). Las usan el servicio que trae las fotos y el que
 * cuenta cuántas hay para traer (`fotos_en_cancelada`), para que el aviso de la pantalla y el botón digan siempre lo mismo.
 */

export type LineaCandidata = { id: string; compra_id: string; created_at: string };
export type CompraCandidata = { id: string; estado: string; proveedor_id: string; created_at: string; cancelada_at: string | null };

const comparar = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * El origen de las fotos de una línea nueva: la línea MÁS RECIENTE, de entre las que tienen su misma `clave_importacion`, que sea de una
 * compra CANCELADA del MISMO proveedor y distinta de la propia. «Más reciente» es por fecha de cancelación de su compra (o, si falta, de
 * creación), después por creación de la línea y, a igualdad, por id. `null` si ninguna sirve.
 */
export function elegirLineaOrigen(
  destino: { id: string; compra_id: string; proveedor_id: string },
  candidatas: readonly LineaCandidata[],
  compras: ReadonlyMap<string, CompraCandidata>,
): LineaCandidata | null {
  const instante = (l: LineaCandidata) => compras.get(l.compra_id)?.cancelada_at ?? compras.get(l.compra_id)?.created_at ?? "";
  const validas = candidatas.filter((l) => {
    const c = compras.get(l.compra_id);
    return l.id !== destino.id && c !== undefined && c.estado === "cancelada" && c.proveedor_id === destino.proveedor_id && c.id !== destino.compra_id;
  });
  validas.sort((a, b) => comparar(instante(b), instante(a)) || comparar(b.created_at, a.created_at) || comparar(b.id, a.id));
  return validas[0] ?? null;
}

/**
 * Cuántas fotos se traerían ahora: las activas del origen que la línea destino todavía no trajo (por `origen_foto_id`), sin pasar del cupo
 * que le queda hasta 3 activas.
 */
export function fotosParaTraer(fotosDelOrigen: readonly string[], yaTraidas: ReadonlySet<string>, activasDelDestino: number): number {
  const nuevas = fotosDelOrigen.filter((id) => !yaTraidas.has(id)).length;
  return Math.max(0, Math.min(nuevas, MAX_FOTOS_POR_LINEA - activasDelDestino));
}
