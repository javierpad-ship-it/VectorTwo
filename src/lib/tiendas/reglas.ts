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

export const MENSAJE_REFERENCIA_PROPIA = "Una tienda no puede ser su propia referencia.";
export const MENSAJE_REFERENCIA_NO_EXISTE = "La tienda de referencia no existe.";
export const MENSAJE_REFERENCIA_NO_TIENDA = "La tienda de referencia debe ser una Tienda, no un centro de distribución.";
export const MENSAJE_REFERENCIA_INACTIVA = "La tienda de referencia está desactivada.";
export const MENSAJE_REFERENCIA_EN_CD = "Un centro de distribución no lleva tienda de referencia.";

/**
 * M7. Rechazo de la tienda de referencia sobre la fila resultante: un CD no lleva referencia; el referente debe existir, ser de
 * tipo Tienda, estar activo y ser otra tienda (`400`). Sin cadenas: la composición se calcula siempre con los hechos del propio
 * referente, así que no se exige nada sobre el referente del referente.
 */
export function motivoRechazoReferencia(args: {
  /** Id de la tienda que se guarda (`null` en un alta). */
  tiendaId: string | null;
  /** Tipo de la tienda resultante. */
  tipo: string | null | undefined;
  referenciaId: string | null | undefined;
  /** La fila del referente, o `null` si no existe. */
  referente: { id: string; tipo: string; activo: boolean } | null;
}): string | null {
  if (args.referenciaId === null || args.referenciaId === undefined) return null;
  if (args.tipo === "Centro de Distribución") return MENSAJE_REFERENCIA_EN_CD;
  if (args.tiendaId !== null && args.referenciaId === args.tiendaId) return MENSAJE_REFERENCIA_PROPIA;
  if (!args.referente) return MENSAJE_REFERENCIA_NO_EXISTE;
  if (args.referente.tipo !== "Tienda") return MENSAJE_REFERENCIA_NO_TIENDA;
  if (!args.referente.activo) return MENSAJE_REFERENCIA_INACTIVA;
  return null;
}
