"use client";

import { Button } from "./button";
import { Modal } from "./modal";

/**
 * Confirmación propia del kit para acciones destructivas, en lugar del `confirm()` nativo (que en el celular se ve como una ventana del
 * navegador, sin el estilo de la app y sin forma de poner el botón en rojo). Se monta cuando hay algo que confirmar y se desmonta al cerrar.
 * Mientras `ocupado`, no se puede cerrar ni volver a confirmar. El foco inicial lo pone `Modal` en la ✕ (que cancela): confirmar exige un toque a propósito.
 */
export function DialogoConfirmar({
  titulo,
  mensaje,
  confirmar = "Confirmar",
  cancelar = "Cancelar",
  peligro = true,
  ocupado = false,
  onConfirmar,
  onCancelar,
}: {
  titulo: string;
  mensaje: string;
  confirmar?: string;
  cancelar?: string;
  /** El botón de confirmar va en rojo (por defecto sí: es para acciones destructivas). */
  peligro?: boolean;
  ocupado?: boolean;
  onConfirmar: () => void;
  onCancelar: () => void;
}) {
  return (
    <Modal
      titulo={titulo}
      ancho="max-w-md"
      cerrable={!ocupado}
      onCerrar={onCancelar}
      pie={
        <>
          <Button variante="secundario" className="h-11! px-5!" onClick={onCancelar} disabled={ocupado}>
            {cancelar}
          </Button>
          <Button variante={peligro ? "peligro" : "primario"} className="h-11! px-5!" onClick={onConfirmar} disabled={ocupado}>
            {ocupado ? "Un momento…" : confirmar}
          </Button>
        </>
      }
    >
      <p className="text-sm text-tinta">{mensaje}</p>
    </Modal>
  );
}
