/**
 * Reglas de negocio de tiendas (docs/modulos/04-tiendas.md, reglas 4 y 5).
 * Funciones puras: devuelven el motivo del rechazo en castellano o `null`.
 * Los handlers las llaman antes de tocar la base (`400`); los `check` de la
 * migración son la red de seguridad.
 *
 * `motivoRechazoEliminar` (regla 5) es la de `src/lib/arbol/reglas.ts`, que
 * desde M4 conoce el tipo `tienda`; se re-exporta por comodidad.
 */

export { motivoRechazoEliminar } from "@/lib/arbol/reglas";

export const MENSAJE_CIERRE_SIN_APERTURA = "Para registrar un cierre, la tienda necesita fecha de apertura.";
export const MENSAJE_CIERRE_ANTES_DE_APERTURA = "La fecha de cierre no puede ser anterior a la de apertura.";
export const MENSAJE_VENTA_EN_CD = "Un centro de distribución no lleva venta esperada: quítala primero.";
export const MENSAJE_VENTA_NEGATIVA = "La venta esperada no puede ser negativa.";

/** Lo que `motivoRechazoTienda` necesita de la fila resultante (alta, o actual más cambio). `tipo` llega como texto desde la base. */
export type TiendaCoherencia = {
  tipo?: string | null;
  fecha_apertura?: string | null;
  fecha_cierre?: string | null;
  venta_esperada_promedio?: number | null;
};

export type CampoRechazoTienda = "fecha_cierre" | "venta_esperada_promedio";

/** Motivo con el campo al que apunta, para que zod y la pantalla lo cuelguen del control correcto. */
export type MotivoRechazoTienda = { mensaje: string; path: [CampoRechazoTienda] };

/**
 * Regla 4, sobre la fila resultante:
 *   - cierre sin apertura → rechazo (`fecha_cierre`);
 *   - cierre < apertura → rechazo (`fecha_cierre`); cierre = apertura se permite;
 *   - Centro de Distribución con venta esperada → rechazo (`venta_esperada_promedio`);
 *   - venta negativa → rechazo (`venta_esperada_promedio`);
 *   - si no, `null`.
 */
export function motivoRechazoTienda(fila: TiendaCoherencia): MotivoRechazoTienda | null {
  const apertura = fila.fecha_apertura ?? null;
  const cierre = fila.fecha_cierre ?? null;
  const venta = fila.venta_esperada_promedio ?? null;

  if (cierre !== null && apertura === null) {
    return { mensaje: MENSAJE_CIERRE_SIN_APERTURA, path: ["fecha_cierre"] };
  }
  if (cierre !== null && apertura !== null && cierre < apertura) {
    return { mensaje: MENSAJE_CIERRE_ANTES_DE_APERTURA, path: ["fecha_cierre"] };
  }
  if (venta !== null && fila.tipo === "Centro de Distribución") {
    return { mensaje: MENSAJE_VENTA_EN_CD, path: ["venta_esperada_promedio"] };
  }
  if (venta !== null && venta < 0) {
    return { mensaje: MENSAJE_VENTA_NEGATIVA, path: ["venta_esperada_promedio"] };
  }
  return null;
}
