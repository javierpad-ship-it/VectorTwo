"use client";

import { useState } from "react";
import { Field, Select, Textarea } from "@/components/ui/form";
import type { MoverPaquete } from "@/lib/compras/agrupadores/esquemas";
import { MAX_MOTIVO_MOVIMIENTO } from "@/lib/compras/agrupadores/tipos";
import type { EmbarqueDetalleApi, OpcionesAgrupadoresApi, PaqueteApi, RespuestaMovimientoApi } from "@/lib/compras/agrupadores/tipos-api";
import { moverPaquete } from "@/lib/compras/agrupadores/use-agrupadores";
import { mesCorto } from "../formato";
import { DialogoMovimiento } from "./dialogo-movimiento";

/**
 * «Pasar a otro embarque» un paquete (ficha 08b §3.5): el paquete pertenece a UN embarque; al moverlo, sus asignaciones se alinean al mes de
 * llegada del embarque de destino. Solo sin recepciones vinculadas (la API responde `409 asignacion_con_recepciones`). Motivo obligatorio.
 */
export function DialogoMoverPaquete({
  embarque,
  paquete,
  opciones,
  onAplicado,
  onCerrar,
  onRecargar,
}: {
  embarque: EmbarqueDetalleApi;
  paquete: PaqueteApi;
  opciones: OpcionesAgrupadoresApi | null;
  onAplicado: (r: RespuestaMovimientoApi) => void | Promise<void>;
  onCerrar: () => void;
  onRecargar?: () => void | Promise<void>;
}) {
  const [destinoId, setDestinoId] = useState("");
  const [motivo, setMotivo] = useState("");
  const destinos = (opciones?.embarques ?? []).filter((e) => e.id !== embarque.id && (e.estado === "planificado" || e.estado === "en_transito"));
  const destino = destinos.find((e) => e.id === destinoId) ?? null;
  const cuerpo: MoverPaquete | null = destino && motivo.trim() !== "" ? { revision: embarque.revision, embarque_destino_id: destino.id, revision_destino: destino.revision, motivo: motivo.trim() } : null;

  return (
    <DialogoMovimiento
      titulo={`Pasar el paquete ${paquete.codigo} a otro embarque`}
      descripcion={`Hoy está en el embarque ${embarque.codigo}. Sus asignaciones pasan al mes de llegada del destino.`}
      cuerpo={cuerpo}
      llamar={(c, previsualizar) => moverPaquete(paquete.id, c, previsualizar)}
      onAplicado={onAplicado}
      onCerrar={onCerrar}
      onRecargar={onRecargar}
      textoAplicar="Pasar paquete"
      pista={!destino ? "Elige el embarque de destino." : "Escribe el motivo."}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Embarque de destino" className="sm:col-span-2">
          <Select value={destinoId} onChange={(e) => setDestinoId(e.target.value)}>
            <option value="">Elige un embarque</option>
            {destinos.map((e) => (
              <option key={e.id} value={e.id}>
                Embarque {e.codigo} · {mesCorto(e.periodo_llegada)} · {e.nombre}{e.origen ? ` · ${e.origen}` : ""}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Motivo" hint="Queda en el historial." className="sm:col-span-2">
          <Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={MAX_MOTIVO_MOVIMIENTO} rows={2} required aria-required />
        </Field>
      </div>
    </DialogoMovimiento>
  );
}
