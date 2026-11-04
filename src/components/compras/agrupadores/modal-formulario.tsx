"use client";

import { useId, type FormEvent, type ReactNode } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

/**
 * Cierre común de los formularios de agrupadores en un `Modal`: el cuerpo es un `<form>` controlado, el pie trae Cancelar y Guardar (el
 * botón Guardar queda deshabilitado mientras se envía y el modal no se cierra con Esc ni con el fondo), y los errores de la API o de la
 * validación se muestran con `Alert` arriba del formulario. Nunca se traga un error.
 */
export function ModalFormulario({
  titulo,
  descripcion,
  onCerrar,
  onEnviar,
  ocupado,
  textoGuardar = "Guardar",
  textoOcupado = "Guardando…",
  error,
  onCerrarError,
  deshabilitarGuardar = false,
  ancho = "max-w-2xl",
  children,
}: {
  titulo: string;
  descripcion?: string;
  onCerrar: () => void;
  onEnviar: () => void;
  ocupado: boolean;
  textoGuardar?: string;
  textoOcupado?: string;
  error?: string | null;
  onCerrarError?: () => void;
  deshabilitarGuardar?: boolean;
  ancho?: string;
  children: ReactNode;
}) {
  const idForm = useId();
  const enviar = (e: FormEvent) => {
    e.preventDefault();
    if (!ocupado) onEnviar();
  };
  return (
    <Modal
      titulo={titulo}
      descripcion={descripcion}
      onCerrar={onCerrar}
      cerrable={!ocupado}
      ancho={ancho}
      pie={
        <>
          <Button variante="secundario" onClick={onCerrar} disabled={ocupado}>
            Cancelar
          </Button>
          <Button type="submit" form={idForm} disabled={ocupado || deshabilitarGuardar}>
            {ocupado ? textoOcupado : textoGuardar}
          </Button>
        </>
      }
    >
      <form id={idForm} onSubmit={enviar} className="space-y-4" noValidate>
        {error && <Alert onCerrar={onCerrarError}>{error}</Alert>}
        {children}
      </form>
    </Modal>
  );
}
