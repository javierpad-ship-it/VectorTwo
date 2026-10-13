"use client";

import { useState } from "react";
import { estadoTienda } from "@/lib/tiendas/estado";
import type { TiendaFila } from "@/lib/tiendas/tipos-api";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Modal } from "@/components/ui/modal";
import { VistaPreviaNombre } from "@/components/catalogo/vista-previa-nombre";
import { BadgeEstado } from "./comunes";
import { aFila, CamposTienda, camposDeTienda, motivoNoGuardar, type Campos } from "./formulario-tienda";

const ID_FORM = "form-edicion-tienda";

/**
 * Diálogo de edición de una tienda con todos sus campos. El borrador vive acá
 * (se monta al abrir); `onGuardar` recibe los campos ya validados en cliente y
 * quien lo usa arma el PATCH, lo envía y cierra si salió bien.
 */
export function EditarTiendaDialogo({
  tienda,
  hoy,
  idLista,
  ocupado,
  error,
  onCerrarError,
  onGuardar,
  onCerrar,
}: {
  tienda: TiendaFila;
  /** `aaaa-mm-dd` en Lima, para anticipar el estado antes de guardar. */
  hoy: string;
  /** Prefijo de los `<datalist>` de zonas y razones sociales (los renderiza el padre). */
  idLista: string;
  ocupado: boolean;
  /** Error de la API del último intento; se muestra dentro del diálogo. */
  error: string | null;
  onCerrarError: () => void;
  onGuardar: (campos: Campos) => Promise<void>;
  onCerrar: () => void;
}) {
  const [campos, setCampos] = useState<Campos>(() => camposDeTienda(tienda));
  const fila = aFila(campos);
  const motivo = motivoNoGuardar(campos);

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (motivo || ocupado) return;
    void onGuardar(campos);
  }

  return (
    <Modal
      titulo={`Editar tienda ${tienda.codigo} · ${tienda.nombre}`}
      descripcion="Código, nombre, zona y razón social se guardan normalizados. Los cambios se aplican al pulsar Guardar."
      onCerrar={onCerrar}
      cerrable={!ocupado}
      ancho="max-w-3xl"
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
      <form id={ID_FORM} onSubmit={enviar} className="grid gap-4 md:grid-cols-4">
        {error && (
          <div className="md:col-span-4">
            <Alert onCerrar={onCerrarError}>{error}</Alert>
          </div>
        )}
        <CamposTienda valor={campos} onCambio={setCampos} idLista={idLista} autoFocus />
        <div className="flex flex-wrap items-center gap-4 md:col-span-4">
          <BadgeEstado estado={estadoTienda(fila, hoy)} activo={tienda.activo} prefijo="Quedará" />
          <VistaPreviaNombre nombre={fila.nombre} codigo={fila.codigo} />
        </div>
        {motivo && <p className="text-xs text-alerta md:col-span-4">{motivo}</p>}
      </form>
    </Modal>
  );
}
