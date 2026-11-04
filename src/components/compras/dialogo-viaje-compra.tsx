"use client";

import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/form";
import type { AsignarViaje } from "@/lib/compras/agrupadores/esquemas";
import type { AvisoDetalleApi, OpcionViajeApi, RespuestaAsignarViajeApi } from "@/lib/compras/agrupadores/tipos-api";
import { asignarComprasViaje, useAccion } from "@/lib/compras/agrupadores/use-agrupadores";
import type { CompraApi } from "@/lib/compras/tipos-api";
import { ModalFormulario } from "./agrupadores/modal-formulario";
import { etiquetaViaje, viajesParaSelector } from "./agrupadores/vista-agrupadores";
import { pideRelectura, textoErrorAccion } from "./agrupadores/vista-errores";

/**
 * Cambiar el viaje de UNA compra desde su detalle (ficha 08b §4.5, «Viaje: 261101 · Feria Sur [Cambiar]»). Los tres roles pueden (decisión
 * 92), también con el viaje cerrado: la API responde con el aviso `viaje_cerrado` y se muestra; solo un viaje cancelado lo rechaza. La
 * compra lleva la revisión que se vio: si otra persona la cambió, `409 compra_cambio` y se relee. Quitar el viaje pide `confirm`. Los
 * viajes abiertos van primero y los cerrados al final, marcados.
 */
export function DialogoViajeCompra({
  compra,
  viajes,
  onHecho,
  onCerrar,
  onRecargar,
}: {
  compra: Pick<CompraApi, "id" | "numero" | "revision" | "viaje">;
  viajes: readonly OpcionViajeApi[];
  onHecho: (texto: string, avisos: AvisoDetalleApi[]) => void | Promise<void>;
  onCerrar: () => void;
  /** Relee la compra cuando otra persona la cambió (`compra_cambio`). */
  onRecargar?: () => void | Promise<void>;
}) {
  const accion = useAccion();
  const actual = compra.viaje?.id ?? "";
  const [viajeId, setViajeId] = useState(actual);
  const [aviso, setAviso] = useState<string | null>(null);
  const opciones = viajesParaSelector(viajes);
  const destino = opciones.find((v) => v.id === viajeId) ?? null;

  async function llamar(viajeRuta: string, cuerpo: AsignarViaje, texto: string) {
    setAviso(null);
    const r = await accion.ejecutar<RespuestaAsignarViajeApi>(() => asignarComprasViaje(viajeRuta, cuerpo));
    if (!r.ok) {
      if (pideRelectura(r.error.codigo)) await onRecargar?.();
      return;
    }
    await onHecho(texto, r.valor.avisos);
  }

  async function asignar() {
    if (!destino) return setAviso("Elige un viaje.");
    if (destino.id === actual) return setAviso("La compra ya está en ese viaje.");
    await llamar(destino.id, { viaje_id: destino.id, compras: [{ id: compra.id, revision: compra.revision }] }, `${compra.numero}: viaje ${destino.codigo} asignado.`);
  }

  async function quitar() {
    if (!compra.viaje) return;
    if (!confirm(`¿Quitar el viaje ${compra.viaje.codigo} de ${compra.numero}? Queda sin viaje; sus embarques y entregas no cambian.`)) return;
    await llamar(compra.viaje.id, { viaje_id: null, compras: [{ id: compra.id, revision: compra.revision }] }, `${compra.numero}: viaje ${compra.viaje.codigo} quitado.`);
  }

  return (
    <ModalFormulario
      titulo={`Viaje de ${compra.numero}`}
      onCerrar={onCerrar}
      onEnviar={() => void asignar()}
      ocupado={accion.ocupado}
      textoGuardar="Asignar viaje"
      deshabilitarGuardar={!destino || destino.id === actual}
      error={aviso ?? (accion.error ? textoErrorAccion(accion.error) : null)}
      onCerrarError={() => {
        setAviso(null);
        accion.limpiar();
      }}
      ancho="max-w-lg"
    >
      <p className="text-sm text-tinta-suave">
        {compra.viaje ? `Hoy la compra está en el viaje ${compra.viaje.codigo} · ${compra.viaje.nombre}.` : "Hoy la compra no tiene viaje."} El viaje es solo el contexto de la compra: no mueve entregas.
      </p>
      <Field label="Viaje" hint="Los viajes cerrados aparecen al final y también aceptan compras.">
        <Select value={viajeId} onChange={(e) => setViajeId(e.target.value)} disabled={accion.ocupado}>
          <option value="">Elige un viaje</option>
          {opciones.map((v) => (
            <option key={v.id} value={v.id}>
              {etiquetaViaje(v)}
            </option>
          ))}
        </Select>
      </Field>
      {destino?.estado === "cerrado" && <Alert tono="info">{`El viaje ${destino.codigo} está cerrado: igual se registra.`}</Alert>}
      {compra.viaje && (
        <div>
          <Button variante="peligro" tamano="sm" onClick={() => void quitar()} disabled={accion.ocupado}>
            Quitar el viaje
          </Button>
        </div>
      )}
    </ModalFormulario>
  );
}
