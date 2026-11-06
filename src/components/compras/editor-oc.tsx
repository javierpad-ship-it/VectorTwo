"use client";

import { useId, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/form";
import type { AvisoOcApi, CompraApi } from "@/lib/compras/tipos-api";
import { editarOc, useAccion } from "@/lib/compras/use-compras";
import { CODIGOS_OC_QUE_RELEEN, textoBotonOc, textoConfirmarQuitarOc, textoConflictoOc, textoOcGuardada, validarEdicionOc } from "./vista-oc";

/**
 * Edición en línea del número de OC de la compra (ficha 08b-1b §2.11). El encabezado del detalle muestra «Compra C-000123 · OC 4500012345»
 * y debajo va este control: el botón «Registrar OC» / «Cambiar OC» y, al abrirlo, el formulario. Los
 * tres roles pueden editarla en cualquier compra no cancelada (es un dato de identificación que no mueve el flujo). Cambiar o quitar una OC
 * que ya tenía pide motivo. `antes` viaja con lo que vio el formulario al abrirse: si otra persona la cambió, la API responde `oc_cambio`,
 * se relee la compra y se pide repetir. `oc_repetida` (otra compra viva del proveedor ya la tiene) bloquea y muestra el mensaje con esa
 * compra; `oc_de_otro_proveedor` solo avisa y se muestra tras guardar.
 */
export function EditorOc({
  compra,
  onGuardada,
  onRecargar,
  ocupadoFuera = false,
}: {
  compra: Pick<CompraApi, "id" | "numero" | "numero_oc" | "estado">;
  /** Se llama tras guardar, con el texto de lo hecho y los avisos de la API (ninguno bloquea). Debe recargar la compra. */
  onGuardada: (texto: string, avisos: AvisoOcApi[]) => void | Promise<void>;
  /** Relee la compra cuando la OC cambió por fuera (`oc_cambio`, `sin_cambios`, `no_editable`). */
  onRecargar?: () => void | Promise<void>;
  /** Otra acción de la pantalla está en curso. */
  ocupadoFuera?: boolean;
}) {
  const accion = useAccion();
  const idOc = useId();
  const idMotivo = useId();
  const [editando, setEditando] = useState(false);
  const [antesVisto, setAntesVisto] = useState<string | null>(null);
  const [valor, setValor] = useState("");
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [conflicto, setConflicto] = useState<string | null>(null);
  const editable = compra.estado !== "cancelada";
  const necesitaMotivo = antesVisto !== null;

  function abrir() {
    setAntesVisto(compra.numero_oc);
    setValor(compra.numero_oc ?? "");
    setMotivo("");
    setError(null);
    setConflicto(null);
    accion.limpiar();
    setEditando(true);
  }

  function cerrar() {
    setEditando(false);
    setError(null);
    accion.limpiar();
  }

  async function guardar() {
    setError(null);
    setConflicto(null);
    const v = validarEdicionOc(antesVisto, valor, motivo);
    if (!v.ok) return setError(v.error);
    if (v.accion === "quitar" && !confirm(textoConfirmarQuitarOc(compra.numero, antesVisto))) return;
    const r = await accion.ejecutar(() => editarOc(compra.id, v.cuerpo));
    if (!r.ok) {
      const codigo = r.error.codigo;
      if (codigo !== null && CODIGOS_OC_QUE_RELEEN.includes(codigo)) {
        // Otra persona tocó la OC (o la compra se canceló): se muestra lo vigente y se pide repetir el cambio.
        setEditando(false);
        setConflicto(textoConflictoOc(codigo, r.error.mensaje));
        accion.limpiar();
        await onRecargar?.();
      }
      return;
    }
    const { numero_oc, numero } = r.valor.compra;
    setEditando(false);
    await onGuardada(textoOcGuardada(numero, v.accion, numero_oc), r.valor.avisos);
  }

  const errorMostrado = error ?? (accion.error ? accion.error.mensaje : null);

  return (
    <div className="min-w-0">
      {editable && !editando && (
        <Button variante="secundario" tamano="sm" onClick={abrir} disabled={ocupadoFuera || accion.ocupado}>
          {textoBotonOc(compra.numero_oc)}
        </Button>
      )}
      {conflicto && (
        <div className="mt-2">
          <Alert tono="info" onCerrar={() => setConflicto(null)}>
            {conflicto}
          </Alert>
        </div>
      )}
      {editando && (
        <form
          className="mt-2 space-y-2 rounded-md border border-borde bg-fondo p-3"
          aria-label={`${textoBotonOc(antesVisto)} de ${compra.numero}`}
          onSubmit={(e) => {
            e.preventDefault();
            void guardar();
          }}
        >
          <div>
            <label htmlFor={idOc} className="mb-1 block text-sm font-medium">
              Número de OC
            </label>
            <Input
              id={idOc}
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              maxLength={60}
              autoComplete="off"
              placeholder="Ej. 4500012345"
              disabled={accion.ocupado}
              aria-invalid={error !== null}
              className="max-w-xs"
            />
            <p className="mt-1 text-xs text-tinta-suave">
              {antesVisto === null ? "La orden de compra real (por ejemplo, de SAP)." : "Déjalo vacío para quitar la OC."} Una OC es de una sola compra de este proveedor.
            </p>
          </div>
          {necesitaMotivo && (
            <div>
              <label htmlFor={idMotivo} className="mb-1 block text-sm font-medium">
                Motivo del cambio
              </label>
              <Textarea id={idMotivo} rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} disabled={accion.ocupado} placeholder="Ej. La OC original estaba mal digitada" />
            </div>
          )}
          {errorMostrado && (
            <Alert
              onCerrar={() => {
                setError(null);
                accion.limpiar();
              }}
            >
              {errorMostrado}
            </Alert>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" tamano="sm" disabled={accion.ocupado}>
              {accion.ocupado ? "Guardando…" : "Guardar OC"}
            </Button>
            <Button variante="fantasma" tamano="sm" onClick={cerrar} disabled={accion.ocupado}>
              Cancelar
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
