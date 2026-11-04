"use client";

import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Field, Textarea } from "@/components/ui/form";
import type { CambiarEstado } from "@/lib/compras/agrupadores/esquemas";
import { MAX_MOTIVO_ESTADO } from "@/lib/compras/agrupadores/tipos";
import { useAccion } from "@/lib/compras/agrupadores/use-agrupadores";
import { ModalFormulario } from "./modal-formulario";
import { pideRelectura, textoErrorAccion } from "./vista-errores";

const ADVERTENCIA: Record<"Viaje" | "Embarque" | "Paquete", string> = {
  Viaje: "Un viaje solo se cancela si no tiene compras ni embarques sin cancelar. Un viaje cancelado ya no admite cambios.",
  Embarque: "Un embarque solo se cancela si no tiene mercadería asignada ni ingresos confirmados: quita o pasa antes lo que tenga.",
  Paquete: "Un paquete solo se cancela si no tiene mercadería asignada.",
};

/**
 * Cancelar un viaje, un embarque o un paquete (ficha 08b §0.3, R13): es **irreversible** y solo lo hacen admin y planner (la pantalla oculta
 * el botón al comprador y la API responde `403`). Pide el motivo y un `confirm` final. Los agrupadores nunca se borran: se cancelan.
 */
export function DialogoCancelarAgrupador({
  tipo,
  codigo,
  revision,
  llamar,
  onCancelado,
  onCerrar,
  onRecargar,
}: {
  tipo: "Viaje" | "Embarque" | "Paquete";
  codigo: string;
  /** La revisión vigente del agrupador (en un paquete, la de su embarque). */
  revision: number;
  llamar: (cuerpo: CambiarEstado) => Promise<unknown>;
  onCancelado: () => void | Promise<void>;
  onCerrar: () => void;
  onRecargar?: () => void | Promise<void>;
}) {
  const accion = useAccion();
  const [motivo, setMotivo] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);

  async function cancelar() {
    if (motivo.trim() === "") {
      setAviso("Escribe el motivo de la cancelación.");
      return;
    }
    if (!confirm(`¿Cancelar el ${tipo.toLowerCase()} ${codigo}? Es irreversible.`)) return;
    const r = await accion.ejecutar(() => llamar({ revision, accion: "cancelar", motivo: motivo.trim() }));
    if (!r.ok) {
      if (pideRelectura(r.error.codigo)) await onRecargar?.();
      return;
    }
    await onCancelado();
  }

  return (
    <ModalFormulario
      titulo={`Cancelar ${tipo.toLowerCase()} ${codigo}`}
      descripcion="Cancelar es irreversible."
      onCerrar={onCerrar}
      onEnviar={() => void cancelar()}
      ocupado={accion.ocupado}
      textoGuardar={`Cancelar ${tipo.toLowerCase()}`}
      textoOcupado="Cancelando…"
      error={aviso ?? (accion.error ? textoErrorAccion(accion.error) : null)}
      onCerrarError={() => {
        setAviso(null);
        accion.limpiar();
      }}
      ancho="max-w-lg"
    >
      <Alert tono="info">{ADVERTENCIA[tipo]}</Alert>
      <Field label="Motivo" hint="Queda en el historial.">
        <Textarea
          value={motivo}
          onChange={(e) => {
            setAviso(null);
            setMotivo(e.target.value);
          }}
          maxLength={MAX_MOTIVO_ESTADO}
          rows={2}
          required
          aria-required
        />
      </Field>
    </ModalFormulario>
  );
}
