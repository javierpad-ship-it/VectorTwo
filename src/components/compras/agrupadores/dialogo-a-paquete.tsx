"use client";

import { useState } from "react";
import { Field, Select } from "@/components/ui/form";
import type { AsignacionApi, EmbarqueDetalleApi, RespuestaMovimientoApi } from "@/lib/compras/agrupadores/tipos-api";
import { esPlan, moverAPaquete, useAccion } from "@/lib/compras/agrupadores/use-agrupadores";
import { plural } from "@/lib/formato";
import { unidades } from "../formato";
import { ModalFormulario } from "./modal-formulario";
import { pideRelectura, textoErrorAccion } from "./vista-errores";

/**
 * «Mover a paquete» (ficha 08b §3.3): cambia de paquete asignaciones del MISMO embarque; no mueve meses, así que no pide vista previa ni
 * motivo. «Sin paquete» las saca del paquete. Se permite aunque el embarque tenga recepciones. Un paquete de otro embarque da
 * `409 paquete_de_otro_embarque`.
 */
export function DialogoAPaquete({
  embarque,
  asignaciones,
  onAplicado,
  onCerrar,
  onRecargar,
}: {
  embarque: EmbarqueDetalleApi;
  asignaciones: readonly AsignacionApi[];
  onAplicado: (r: RespuestaMovimientoApi) => void | Promise<void>;
  onCerrar: () => void;
  onRecargar?: () => void | Promise<void>;
}) {
  const accion = useAccion();
  const [paqueteId, setPaqueteId] = useState("");
  const paquetes = embarque.paquetes.filter((p) => p.estado === "abierto");
  const total = asignaciones.reduce((a, x) => a + x.unidades, 0);

  async function mover() {
    const r = await accion.ejecutar(() => moverAPaquete(embarque.id, { revision: embarque.revision, paquete_id: paqueteId || null, asignaciones: asignaciones.map((a) => a.id) }));
    if (!r.ok) {
      if (pideRelectura(r.error.codigo)) await onRecargar?.();
      return;
    }
    if (!esPlan(r.valor)) await onAplicado(r.valor);
  }

  return (
    <ModalFormulario
      titulo="Mover a paquete"
      descripcion={`${plural(asignaciones.length, "asignación", "asignaciones")} · ${unidades(total)} u del embarque ${embarque.codigo}. No cambia ningún mes.`}
      onCerrar={onCerrar}
      onEnviar={() => void mover()}
      ocupado={accion.ocupado}
      textoGuardar="Mover"
      textoOcupado="Moviendo…"
      error={accion.error ? textoErrorAccion(accion.error) : null}
      onCerrarError={accion.limpiar}
      ancho="max-w-lg"
    >
      <Field label="Paquete de destino">
        <Select value={paqueteId} onChange={(e) => setPaqueteId(e.target.value)}>
          <option value="">Sin paquete</option>
          {paquetes.map((p) => (
            <option key={p.id} value={p.id}>
              Paquete {p.codigo} · {p.nombre}
            </option>
          ))}
        </Select>
      </Field>
    </ModalFormulario>
  );
}
