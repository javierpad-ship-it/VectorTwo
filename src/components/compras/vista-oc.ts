import { MAX_MOTIVO_OC, MAX_NUMERO_OC, PATRON_NUMERO_OC } from "@/lib/compras/tipos";
import { normalizarOc } from "@/lib/compras/oc";
import type { EditarOcCuerpo } from "@/lib/compras/tipos-api";

/**
 * Lógica de la edición del número de OC en el detalle de una compra (ficha 08b-1b §2.11). Pura. `antes` es la OC que vio el formulario al
 * abrirse (no la de la compra al enviar): la API la compara y responde `409 oc_cambio` si otra persona la cambió entre medio.
 */

export type AccionOc = "registrar" | "cambiar" | "quitar";

export type ResultadoValidacionOc = { ok: true; cuerpo: EditarOcCuerpo; accion: AccionOc } | { ok: false; error: string };

export const MENSAJE_OC_INVALIDA = `La OC admite letras, números, guiones, barras, puntos, guiones bajos y espacios (hasta ${MAX_NUMERO_OC} caracteres) y empieza con letra o número.`;

/** El botón del encabezado: «Registrar OC» sin OC, «Cambiar OC» con ella. */
export const textoBotonOc = (numeroOc: string | null): string => (numeroOc === null ? "Registrar OC" : "Cambiar OC");

/** El encabezado de la compra: «OC 4500012345» o «OC sin registrar». */
export const textoOc = (numeroOc: string | null): string => (numeroOc === null ? "OC sin registrar" : `OC ${numeroOc}`);

/** Qué hace el envío según lo que se vio y lo que se escribió; `null` si no cambia nada. */
export function accionDeOc(antes: string | null, valor: string): AccionOc | null {
  const nuevo = normalizarOc(valor);
  const previo = normalizarOc(antes);
  if (nuevo === previo) return null;
  if (nuevo === null) return "quitar";
  return previo === null ? "registrar" : "cambiar";
}

/** Valida el formulario y arma el cuerpo de `PUT …/oc`. Cambiar o quitar una OC que ya tenía pide motivo (en la base es opcional, §2.11). */
export function validarEdicionOc(antesVisto: string | null, valor: string, motivo: string): ResultadoValidacionOc {
  const accion = accionDeOc(antesVisto, valor);
  const nuevo = normalizarOc(valor);
  if (accion === null) {
    return { ok: false, error: nuevo === null ? "Escribe el número de la OC." : "La OC es la misma que ya tiene la compra: no hay nada que guardar." };
  }
  if (nuevo !== null && !PATRON_NUMERO_OC.test(nuevo)) return { ok: false, error: MENSAJE_OC_INVALIDA };
  const m = motivo.trim();
  if (accion !== "registrar" && m === "") return { ok: false, error: accion === "quitar" ? "Escribe por qué quitas la OC." : "Escribe por qué cambias la OC." };
  if (m.length > MAX_MOTIVO_OC) return { ok: false, error: `El motivo no puede superar ${MAX_MOTIVO_OC} caracteres.` };
  return { ok: true, accion, cuerpo: { antes: normalizarOc(antesVisto), numero_oc: nuevo, ...(accion === "registrar" || m === "" ? {} : { motivo: m }) } };
}

/** Lo que se le dice a la persona tras guardar. */
export function textoOcGuardada(compraNumero: string, accion: AccionOc, numeroOc: string | null): string {
  if (accion === "quitar" || numeroOc === null) return `Se quitó la OC de ${compraNumero}. Queda en el historial.`;
  return `OC ${accion === "registrar" ? "registrada" : "cambiada"} en ${compraNumero}: ${numeroOc}. Queda en el historial.`;
}

/** `confirm` de quitar la OC. */
export const textoConfirmarQuitarOc = (compraNumero: string, numeroOc: string | null): string =>
  `¿Quitar la OC ${numeroOc ?? ""} de ${compraNumero}? La compra queda con «OC sin registrar»; el cambio queda en el historial.`;

/** Códigos de la API que piden releer la compra antes de reintentar. */
export const CODIGOS_OC_QUE_RELEEN: readonly string[] = ["oc_cambio", "no_editable", "sin_cambios"];

/** Texto para quien recibió un `409` que no es un error de su formulario, sino un cambio hecho por otra persona. */
export function textoConflictoOc(codigo: string | null, mensajeApi: string): string {
  switch (codigo) {
    case "oc_cambio":
      return "Otra persona cambió la OC mientras editabas. Ya mostramos la OC vigente: revisa y repite el cambio si todavía hace falta.";
    case "sin_cambios":
      return "La OC ya era esa (quizá se guardó en el intento anterior): no hay nada más que guardar.";
    case "no_editable":
      return "Esta compra está cancelada: su OC ya no se puede cambiar.";
    default:
      return mensajeApi;
  }
}

/** El formulario muestra el campo de motivo cuando la compra ya tenía una OC (cambiarla o quitarla lo exige el servidor: `409 motivo_requerido`). */
export const exigeMotivoEnPantalla = (antesVisto: string | null): boolean => normalizarOc(antesVisto) !== null;

/** La pista bajo el campo de motivo según lo que está haciendo la persona. */
export function textoPistaMotivoOc(accion: AccionOc | null): string {
  if (accion === "quitar") return "Obligatorio: quitar una OC que ya tenía la compra queda en el historial con este motivo.";
  if (accion === "cambiar") return "Obligatorio: cambiar una OC que ya tenía la compra queda en el historial con este motivo.";
  return "Obligatorio si cambias o quitas la OC que ya tiene la compra.";
}

/** El texto de un error de la API al guardar la OC: el mensaje del servidor; `motivo_requerido` siempre con su texto llano. */
export function textoErrorOc(codigo: string | null, mensajeApi: string): string {
  if (codigo === "motivo_requerido") return "Escribe el motivo para cambiar o quitar la OC que ya tenía esta compra.";
  return mensajeApi;
}
