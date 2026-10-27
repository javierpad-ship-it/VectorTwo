import { formatearNumero } from "@/lib/formato";
import { evento, type EventoNuevo } from "./eventos";
import { fotoCompra, recalcularModelo, type ModeloCompra } from "./reglas";
import { MAX_MOTIVO_CANCELACION, type ActorCompra, type EstadoCompra } from "./tipos";

/**
 * Cancelar una compra (ficha 08, §0.11, regla 31). Decisión de Javier: cancelar una compra con recepciones es CERRAR EL SALDO.
 *  (a) Sin recepciones → `cancelada` (inmutable): todo deja de contar y la clave de importación de sus líneas queda libre.
 *  (b) Con recepciones → cada línea `unidades_canceladas = unidades − unidades_recibidas` y la compra queda `recibida` con saldo
 *      cerrado (`cancelada_at` lleno); las recepciones siguen valiendo.
 *  (c) Todo recibido (o saldo ya cerrado) → `409 recibida` («Ya llegó todo: no hay saldo que cancelar»).
 * Puro: planifica y valida; la escritura es la función SQL `cancelar_compra` (una transacción, `revision` bajo `for update`).
 */

export type PlanCancelacion =
  | { ok: false; motivo: "no_editable" | "recibida" }
  | {
      ok: true;
      /** `cancelada` (sin recepciones) o `saldo_cerrado` (con ellas: la compra queda `recibida`). */
      resultado: "cancelada" | "saldo_cerrado";
      estado: Extract<EstadoCompra, "cancelada" | "recibida">;
      unidades: number;
      unidades_recibidas: number;
      /** Lo que se cancela: `Σ (unidades − recibidas)` con saldo cerrado; 0 si la compra se cancela entera sin recepciones. */
      unidades_canceladas: number;
      /** Por línea, solo con saldo cerrado. */
      lineas: { linea_id: string; unidades_canceladas: number }[];
      /** El texto del `confirm` de la pantalla. */
      mensaje_confirmacion: string;
    };

const u = formatearNumero;

/**
 * Qué pasaría al cancelar. `numero` solo sirve para el texto del `confirm` (`C-000012`). No mira la revisión ni el motivo: eso lo
 * valida `validarCancelacion`.
 */
export function planCancelacion(compra: ModeloCompra, numero = "La compra"): PlanCancelacion {
  if (compra.estado === "cancelada") return { ok: false, motivo: "no_editable" };
  if (compra.estado === "recibida") return { ok: false, motivo: "recibida" };

  const unidades = compra.lineas.reduce((a, l) => a + l.unidades, 0);
  const recibidas = compra.lineas.reduce((a, l) => a + l.unidades_recibidas, 0);

  if (recibidas === 0) {
    return {
      ok: true,
      resultado: "cancelada",
      estado: "cancelada",
      unidades,
      unidades_recibidas: 0,
      unidades_canceladas: 0,
      lineas: [],
      mensaje_confirmacion: `${numero} se cancela entera: sus ${u(unidades)} u dejan de esperarse y la compra ya no se podrá modificar.`,
    };
  }

  const lineas = compra.lineas.map((l) => ({ linea_id: l.id, unidades_canceladas: l.unidades - l.unidades_recibidas }));
  const canceladas = lineas.reduce((a, l) => a + l.unidades_canceladas, 0);
  return {
    ok: true,
    resultado: "saldo_cerrado",
    estado: "recibida",
    unidades,
    unidades_recibidas: recibidas,
    unidades_canceladas: canceladas,
    lineas,
    mensaje_confirmacion: `${numero} tiene ${u(recibidas)} u confirmadas de ${u(unidades)}: se cancela el saldo de ${u(canceladas)} u y la compra queda como recibida parcialmente.`,
  };
}

/** Motivos con los que `cancelar_compra` rechaza sin escribir. */
export type MotivoRechazoCancelar = "compra_cambio" | "no_editable" | "recibida" | "motivo_requerido";

/**
 * Valida con el orden de la función SQL: `compra_cambio` (revisión distinta), `no_editable` (ya cancelada), `recibida` (todo llegó
 * o saldo ya cerrado) y `motivo_requerido` (de 1 a 200 caracteres sin contar los espacios de los bordes). `null` si se puede.
 */
export function validarCancelacion(compra: ModeloCompra, revision: number, motivo: string): MotivoRechazoCancelar | null {
  if (compra.revision !== revision) return "compra_cambio";
  if (compra.estado === "cancelada") return "no_editable";
  if (compra.estado === "recibida") return "recibida";
  const m = motivo.trim();
  if (m.length < 1 || m.length > MAX_MOTIVO_CANCELACION) return "motivo_requerido";
  return null;
}

export type ArgsCancelarCompra = { p_compra: string; p_revision: number; p_motivo: string; p_actor: ActorCompra };

/** `rpc("cancelar_compra", args)`: el motivo va recortado. */
export function argsCancelarCompra(entrada: { compra_id: string; revision: number; motivo: string; actor: ActorCompra }): ArgsCancelarCompra {
  return { p_compra: entrada.compra_id, p_revision: entrada.revision, p_motivo: entrada.motivo.trim(), p_actor: entrada.actor };
}

export type ResultadoCancelacion =
  | { ok: true; modelo: ModeloCompra; evento: EventoNuevo; plan: Extract<PlanCancelacion, { ok: true }> }
  | { ok: false; motivo: MotivoRechazoCancelar };

/**
 * Lo que hace `cancelar_compra` sobre el modelo: sin recepciones marca `cancelada`; con ellas cierra el saldo (canceladas =
 * unidades − recibidas; estado `recibida`). Sube `revision` y devuelve el evento `cancelar` con `antes`, `despues` y el motivo.
 */
export function aplicarCancelacion(
  compra: ModeloCompra,
  revision: number,
  motivo: string,
  opciones: { compra_id: string; actor: ActorCompra; ahora: string; numero?: string },
): ResultadoCancelacion {
  const rechazo = validarCancelacion(compra, revision, motivo);
  if (rechazo) return { ok: false, motivo: rechazo };
  const plan = planCancelacion(compra, opciones.numero) as Extract<PlanCancelacion, { ok: true }>;
  const antes = fotoCompra(compra);
  const marcada: ModeloCompra = { ...compra, cancelada_at: opciones.ahora, revision: compra.revision + 1 };
  const modelo: ModeloCompra =
    plan.resultado === "cancelada" ? { ...marcada, estado: "cancelada" } : recalcularModelo(marcada);
  return {
    ok: true,
    modelo,
    plan,
    evento: evento({
      compra_id: opciones.compra_id,
      accion: "cancelar",
      antes,
      despues: fotoCompra(modelo),
      motivo,
      resumen:
        plan.resultado === "cancelada"
          ? "Compra cancelada"
          : `Saldo cancelado: ${plan.unidades_canceladas} u; la compra queda recibida (${plan.unidades_recibidas} u recibidas)`,
      actor: opciones.actor,
      ahora: opciones.ahora,
    }),
  };
}
