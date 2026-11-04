"use client";

import { useState } from "react";
import { Field, Input, Textarea } from "@/components/ui/form";
import type { CambiarFecha } from "@/lib/compras/agrupadores/esquemas";
import { MAX_MOTIVO_MOVIMIENTO } from "@/lib/compras/agrupadores/tipos";
import type { EmbarqueDetalleApi, RespuestaMovimientoApi } from "@/lib/compras/agrupadores/tipos-api";
import { cambiarFechaLlegada } from "@/lib/compras/agrupadores/use-agrupadores";
import { DialogoMovimiento } from "./dialogo-movimiento";
import { esFechaValida, salidaDespuesDeLlegada, textoFecha } from "./vista-agrupadores";

/**
 * «Cambiar fecha de llegada» (ficha 08b §4.2, decisión 83): la fecha vive en el embarque y alinea las entregas. Si el mes cambia, mueve en
 * bloque las asignaciones activas (lo ya recibido o histórico no se mueve); si no cambia, solo cambia el embarque. El motivo es obligatorio y
 * queda en el historial; la vista previa dice cuántas líneas y compras se mueven y de qué mes a qué mes. Planner y comprador pueden.
 */
export function DialogoFecha({
  embarque,
  onAplicado,
  onCerrar,
  onRecargar,
}: {
  embarque: EmbarqueDetalleApi;
  onAplicado: (r: RespuestaMovimientoApi) => void | Promise<void>;
  onCerrar: () => void;
  onRecargar?: () => void | Promise<void>;
}) {
  const [fecha, setFecha] = useState(embarque.fecha_llegada_estimada);
  const [motivo, setMotivo] = useState("");
  const salidaMala = salidaDespuesDeLlegada(embarque.fecha_salida_estimada ?? "", fecha);
  const cambia = fecha !== embarque.fecha_llegada_estimada;
  const cuerpo: CambiarFecha | null =
    esFechaValida(fecha) && cambia && !salidaMala && motivo.trim() !== "" ? { revision: embarque.revision, fecha_llegada_estimada: fecha, motivo: motivo.trim() } : null;
  const pista = !cambia ? "Elige una fecha distinta de la actual." : salidaMala ? "La salida no puede ser posterior a la llegada." : motivo.trim() === "" ? "Escribe el motivo del cambio." : undefined;

  return (
    <DialogoMovimiento
      titulo={`Cambiar fecha de llegada · Embarque ${embarque.codigo}`}
      descripcion={`Hoy llega el ${textoFecha(embarque.fecha_llegada_estimada)}. Si cambia el mes, las entregas de este embarque pasan al mes nuevo.`}
      cuerpo={cuerpo}
      llamar={(c, previsualizar) => cambiarFechaLlegada(embarque.id, c, previsualizar)}
      onAplicado={onAplicado}
      onCerrar={onCerrar}
      onRecargar={onRecargar}
      textoAplicar="Cambiar fecha"
      pista={pista}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nueva fecha de llegada">
          <Input type="date" value={fecha} min={embarque.fecha_salida_estimada ?? undefined} onChange={(e) => setFecha(e.target.value)} aria-invalid={salidaMala} />
        </Field>
        <div className="text-xs text-tinta-suave sm:pt-6">
          {embarque.fecha_salida_estimada ? <>Sale el {textoFecha(embarque.fecha_salida_estimada)}.</> : "Sin fecha de salida."}
        </div>
        <Field label="Motivo" hint="Queda en el historial del embarque." className="sm:col-span-2">
          <Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={MAX_MOTIVO_MOVIMIENTO} rows={2} required aria-required />
        </Field>
      </div>
    </DialogoMovimiento>
  );
}
