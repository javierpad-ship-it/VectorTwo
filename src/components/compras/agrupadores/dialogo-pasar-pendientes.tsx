"use client";

import { useState } from "react";
import { Field, Select, Textarea } from "@/components/ui/form";
import type { PasarPendientes } from "@/lib/compras/agrupadores/esquemas";
import { MAX_MOTIVO_MOVIMIENTO } from "@/lib/compras/agrupadores/tipos";
import type { AsignacionApi, EmbarqueDetalleApi, OpcionesAgrupadoresApi, RespuestaMovimientoApi } from "@/lib/compras/agrupadores/tipos-api";
import { pasarPendientes } from "@/lib/compras/agrupadores/use-agrupadores";
import { mesCorto, unidades } from "../formato";
import { DialogoMovimiento } from "./dialogo-movimiento";

/**
 * «Pasar pendientes a…» (ficha 08b §3.5): lo pendiente de cada asignación sale a una asignación del embarque de destino (con fusión) y su
 * entrega se mueve al mes de llegada del destino; el origen conserva lo recibido. Sin asignaciones marcadas, pasa lo pendiente de todo el
 * embarque. En esta entrega «pendiente» es un estimado (primeras recepciones primero). El motivo es obligatorio.
 */
export function DialogoPasarPendientes({
  embarque,
  seleccionadas,
  opciones,
  onAplicado,
  onCerrar,
  onRecargar,
}: {
  embarque: EmbarqueDetalleApi;
  /** Las asignaciones marcadas; vacío = todo lo pendiente del embarque. */
  seleccionadas: readonly AsignacionApi[];
  opciones: OpcionesAgrupadoresApi | null;
  onAplicado: (r: RespuestaMovimientoApi) => void | Promise<void>;
  onCerrar: () => void;
  onRecargar?: () => void | Promise<void>;
}) {
  const [destinoId, setDestinoId] = useState("");
  const [paqueteId, setPaqueteId] = useState("");
  const [motivo, setMotivo] = useState("");
  const destinos = (opciones?.embarques ?? []).filter((e) => e.id !== embarque.id && (e.estado === "planificado" || e.estado === "en_transito"));
  const destino = destinos.find((e) => e.id === destinoId) ?? null;
  const paquetes = (opciones?.paquetes ?? []).filter((p) => p.estado === "abierto" && p.embarque_id === destinoId);
  const base = seleccionadas.length > 0 ? seleccionadas : embarque.asignaciones.filter((a) => !a.historica);
  const pendientes = base.reduce((a, x) => a + x.pendiente, 0);

  const cuerpo: PasarPendientes | null =
    destino && motivo.trim() !== "" && pendientes > 0
      ? {
          revision: embarque.revision,
          embarque_destino_id: destino.id,
          revision_destino: destino.revision,
          paquete_destino_id: paqueteId || null,
          ...(seleccionadas.length > 0 ? { asignaciones: seleccionadas.map((a) => a.id) } : {}),
          motivo: motivo.trim(),
        }
      : null;
  const pista = pendientes === 0 ? "No hay unidades pendientes que pasar." : !destino ? "Elige el embarque de destino." : "Escribe el motivo.";

  return (
    <DialogoMovimiento
      titulo={`Pasar pendientes · Embarque ${embarque.codigo}`}
      descripcion={`Pasa ${unidades(pendientes)} u pendientes ${seleccionadas.length > 0 ? "de las asignaciones marcadas" : "de todo el embarque"} (estimado) a otro embarque.`}
      cuerpo={cuerpo}
      llamar={(c, previsualizar) => pasarPendientes(embarque.id, c, previsualizar)}
      onAplicado={onAplicado}
      onCerrar={onCerrar}
      onRecargar={onRecargar}
      textoAplicar="Pasar pendientes"
      confirmar={(plan) => `¿Pasar ${unidades(plan.unidades_movidas)} u pendientes al embarque ${destino?.codigo ?? ""}?`}
      pista={pista}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Embarque de destino">
          <Select
            value={destinoId}
            onChange={(e) => {
              setDestinoId(e.target.value);
              setPaqueteId("");
            }}
          >
            <option value="">Elige un embarque</option>
            {destinos.map((e) => (
              <option key={e.id} value={e.id}>
                Embarque {e.codigo} · {mesCorto(e.periodo_llegada)} · {e.nombre}{e.origen ? ` · ${e.origen}` : ""}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Paquete de destino" hint="Opcional.">
          <Select value={paqueteId} onChange={(e) => setPaqueteId(e.target.value)} disabled={destinoId === ""}>
            <option value="">Sin paquete</option>
            {paquetes.map((p) => (
              <option key={p.id} value={p.id}>
                Paquete {p.codigo} · {p.nombre}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Motivo" hint="Queda en el historial de los dos embarques." className="sm:col-span-2">
          <Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={MAX_MOTIVO_MOVIMIENTO} rows={2} required aria-required />
        </Field>
      </div>
    </DialogoMovimiento>
  );
}
