"use client";

import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { cancelarSchema } from "@/lib/compras/esquemas";
import type { CompraApi } from "@/lib/compras/tipos-api";
import { cancelarCompra, useAccion } from "@/lib/compras/use-compras";
import { textoConfirmarCancelar } from "./vista-compras";

/**
 * Cancelar una compra (ficha 08 §0.11; solo admin y planner). Pide el motivo (1 a 200 caracteres) y un `confirm` que dice qué va a pasar:
 * sin ingresos la compra queda cancelada y deja de contar; con ingresos se cierra el saldo y la compra queda como recibida parcialmente
 * (sus ingresos siguen valiendo). Todo queda en el historial con el motivo.
 */
export function DialogoCancelar({ compra, onCancelada, onRecargar, onCerrar }: { compra: CompraApi; onCancelada: (compra: CompraApi) => void; onRecargar: () => Promise<unknown>; onCerrar: () => void }) {
  const [motivo, setMotivo] = useState("");
  const [intento, setIntento] = useState(false);
  const accion = useAccion();
  const validacion = cancelarSchema.safeParse({ motivo, revision: compra.revision });
  const error = validacion.success ? null : (validacion.error.issues[0]?.message ?? "Revisa el motivo.");

  async function cancelar() {
    setIntento(true);
    if (!validacion.success) return;
    if (!confirm(textoConfirmarCancelar(compra))) return;
    const r = await accion.ejecutar(() => cancelarCompra(compra.id, { motivo: validacion.data.motivo, revision: compra.revision }));
    if (r.ok) onCancelada(r.valor);
  }

  return (
    <Modal
      titulo={`Cancelar ${compra.numero}`}
      descripcion={compra.totales.recibidas > 0 ? "Tiene ingresos confirmados: se cancela solo el saldo que falta." : "Todavía no tiene ingresos: la compra queda cancelada y deja de contar en el flujo."}
      onCerrar={onCerrar}
      cerrable={!accion.ocupado}
      ancho="max-w-lg"
      pie={
        <>
          <Button variante="secundario" onClick={onCerrar} disabled={accion.ocupado}>
            Volver
          </Button>
          <Button variante="peligro" onClick={() => void cancelar()} disabled={accion.ocupado}>
            {accion.ocupado ? "Cancelando…" : "Cancelar compra"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Motivo de la cancelación" hint="Obligatorio; queda en el historial (hasta 200 caracteres)">
          <Input value={motivo} maxLength={200} onChange={(e) => setMotivo(e.target.value)} aria-invalid={intento && error !== null} />
        </Field>
        {intento && error && <Alert>{error}</Alert>}
        {accion.error && (
          <Alert onCerrar={accion.limpiar}>
            {accion.error.mensaje}
            {accion.error.codigo === "compra_cambio" && (
              <>
                {" "}
                <button
                  type="button"
                  className="font-semibold underline underline-offset-2"
                  onClick={async () => {
                    await onRecargar();
                    onCerrar();
                  }}
                >
                  Recargar la compra
                </button>
              </>
            )}
          </Alert>
        )}
      </div>
    </Modal>
  );
}
