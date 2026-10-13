"use client";

import { useState } from "react";
import { aCodigo, normalizarNombre } from "@/lib/arbol/normalizar";
import type { EditarMarcaCuerpo, MarcaFila } from "@/lib/marcas/tipos-api";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { Alert } from "@/components/ui/alert";
import { Modal } from "@/components/ui/modal";

export const MAX_NOTA = 200;

const MOTIVO_VACIO = "El nombre y el código no pueden quedar vacíos.";
const ID_FORM = "form-edicion-marca";

/**
 * Diálogo de edición de una marca: nombre, código y nota de tratamiento.
 * La agrupación y el tratamiento especial no están acá: se guardan al instante
 * desde la tabla. El borrador vive en el diálogo (se monta al abrir); quien lo
 * usa recibe el cuerpo ya armado en `onGuardar` y cierra si salió bien.
 */
export function EditarMarcaDialogo({
  marca,
  ocupado,
  error,
  onCerrarError,
  onGuardar,
  onCerrar,
}: {
  marca: MarcaFila;
  ocupado: boolean;
  /** Error de la API del último intento; se muestra dentro del diálogo. */
  error: string | null;
  onCerrarError: () => void;
  onGuardar: (cuerpo: EditarMarcaCuerpo) => Promise<void>;
  onCerrar: () => void;
}) {
  const [nombre, setNombre] = useState(marca.nombre);
  const [codigo, setCodigo] = useState(marca.codigo);
  const [nota, setNota] = useState(marca.nota_tratamiento ?? "");

  const nombreFinal = normalizarNombre(nombre);
  const codigoFinal = aCodigo(codigo);
  const motivo = !nombreFinal || !codigoFinal ? MOTIVO_VACIO : null;
  const conTratamiento = marca.tratamiento_especial;

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (motivo || ocupado) return;
    const cuerpo: EditarMarcaCuerpo = { nombre: nombreFinal, codigo: codigoFinal };
    // La nota solo viaja si la marca tiene la bandera: sin ella la API la rechaza.
    if (conTratamiento) cuerpo.nota_tratamiento = nota.trim() === "" ? null : nota.trim();
    void onGuardar(cuerpo);
  }

  return (
    <Modal
      titulo={`Editar marca ${marca.nombre}`}
      descripcion="El nombre y el código se guardan normalizados. Los cambios se aplican al pulsar Guardar."
      onCerrar={onCerrar}
      cerrable={!ocupado}
      ancho="max-w-xl"
      pie={
        <>
          <Button variante="fantasma" disabled={ocupado} onClick={onCerrar}>
            Cancelar
          </Button>
          <Button type="submit" form={ID_FORM} disabled={ocupado || motivo !== null} title={motivo ?? undefined}>
            {ocupado ? "Guardando…" : "Guardar"}
          </Button>
        </>
      }
    >
      <form id={ID_FORM} onSubmit={enviar} className="grid gap-4">
        {error && <Alert onCerrar={onCerrarError}>{error}</Alert>}
        <Field label="Nombre">
          <Input required autoFocus value={nombre} onChange={(e) => setNombre(e.target.value)} />
        </Field>
        <Field label="Código" hint="Solo letras, números y _.">
          <Input value={codigo} onChange={(e) => setCodigo(e.target.value)} className="font-mono" />
        </Field>
        <Field
          label="Nota de tratamiento"
          hint={
            conTratamiento
              ? `${nota.length}/${MAX_NOTA}. Por qué se trata aparte; opcional.`
              : "Solo aplica con tratamiento especial: márcalo en la tabla para agregar una nota."
          }
        >
          <Input
            value={nota}
            maxLength={MAX_NOTA}
            disabled={!conTratamiento}
            title={conTratamiento ? undefined : "Marca el tratamiento especial para agregar una nota."}
            onChange={(e) => setNota(e.target.value)}
            placeholder={conTratamiento ? "Por qué se trata aparte" : ""}
          />
        </Field>
        {motivo && <p className="text-xs text-alerta">{motivo}</p>}
      </form>
    </Modal>
  );
}
