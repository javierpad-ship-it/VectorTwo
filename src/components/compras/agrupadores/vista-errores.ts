import { MENSAJE_ERROR_AGRUPADOR, type CodigoErrorAgrupador } from "@/lib/compras/agrupadores/tipos-api";

/** Códigos que significan «lo que ibas a hacer ya no vale»: la pantalla relee antes de que la persona reintente. */
export const CODIGOS_DE_RELECTURA: readonly string[] = ["agrupador_cambio", "compra_cambio", "plan_cambio", "no_pertenece", "recepcion_cambio"];

/**
 * El texto que se muestra de un error de la API: el mensaje del servidor; si solo trae el genérico «Error 409» y el código es de negocio,
 * el texto en castellano de ese código. Sin código ni mensaje útil, el genérico.
 */
export function textoErrorAccion(e: { mensaje: string; codigo: string | null }): string {
  const generico = /^Error \d+$/.test(e.mensaje);
  if (generico && e.codigo && e.codigo in MENSAJE_ERROR_AGRUPADOR) return MENSAJE_ERROR_AGRUPADOR[e.codigo as CodigoErrorAgrupador];
  return e.mensaje;
}

export const pideRelectura = (codigo: string | null): boolean => codigo !== null && CODIGOS_DE_RELECTURA.includes(codigo);
