"use client";

import { api } from "@/lib/api-client";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import type { ProyeccionApi } from "@/lib/proyeccion/tipos-api";
import { AlertaError, BotonCancelarOCerrar, TextoOperacionEnCurso } from "./comunes";
import { textoFalloTrasCerrar } from "./operacion-larga-vista";
import { rutaProyeccion, useAccion, useOperacionLarga } from "./use-proyeccion";

/**
 * Archivar una proyección CERRADA. Es la única cerrada de su año (el servidor garantiza una sola), así que archivarla deja
 * al año sin proyección cerrada y al flujo de mercadería (M8) sin datos de volumen. Solo tras confirmar aquí se manda
 * `confirmar_sin_cerrada: true`; sin él, el servidor responde `409 ultima_cerrada`.
 */
export function ArchivarModal({
  proyeccion,
  onCerrar,
  onArchivada,
  onFalloTrasCerrar,
}: {
  proyeccion: ProyeccionApi;
  onCerrar: () => void;
  onArchivada: (p: ProyeccionApi) => Promise<void> | void;
  /** Si el archivado falla después de cerrar la ventana con «Cerrar», el error va al panel. */
  onFalloTrasCerrar?: (mensaje: string) => void;
}) {
  const accion = useAccion();
  const operacionLarga = useOperacionLarga(accion.ocupado);
  const y = proyeccion.anio_en_curso;

  async function archivar() {
    operacionLarga.empezar();
    const r = await accion.ejecutar(() => api.post<ProyeccionApi>(`${rutaProyeccion(proyeccion.id)}/archivar`, { confirmar_sin_cerrada: true }));
    if (!r.ok) {
      if (operacionLarga.seCerro()) onFalloTrasCerrar?.(textoFalloTrasCerrar("archivar", r.error.mensaje));
      return;
    }
    await onArchivada(r.valor);
    if (!operacionLarga.seCerro()) onCerrar();
  }

  function cerrarEnCurso() {
    operacionLarga.cerrarEnCurso();
    onCerrar();
  }

  return (
    <Modal
      titulo={`Archivar ${proyeccion.nombre}`}
      onCerrar={onCerrar}
      cerrable={!accion.ocupado}
      ancho="max-w-lg"
      pie={
        <>
          {accion.ocupado && <TextoOperacionEnCurso operacion="archivar" segundos={operacionLarga.segundos} />}
          <BotonCancelarOCerrar enCurso={accion.ocupado} onCancelar={onCerrar} onCerrarEnCurso={cerrarEnCurso} />
          <Button variante="peligro" disabled={accion.ocupado} onClick={() => void archivar()}>
            {accion.ocupado ? "Archivando…" : `Archivar y dejar ${y} sin proyección cerrada`}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {accion.error && <AlertaError error={accion.error} onCerrar={accion.limpiar} />}
        <Alert tono="alerta">
          <span className="block font-medium">Esta es la proyección cerrada de {y}.</span>
          <span className="mt-1 block">
            Si la archivas, el año {y} quedará sin proyección cerrada y M8 (flujo de mercadería) no tendrá datos de volumen para ese año ni, hasta que cierres otra, para {y + 1}.
          </span>
        </Alert>
        <p className="text-sm text-tinta-suave">
          Una proyección archivada queda de solo lectura; se puede copiar para seguir trabajando y cerrar una nueva. Si lo que quieres es reemplazarla, cierra otra proyección de {y}: la cerrada anterior pasa a archivada sola.
        </p>
      </div>
    </Modal>
  );
}
