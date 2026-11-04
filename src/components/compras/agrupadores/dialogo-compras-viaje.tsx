"use client";

import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Field, Select } from "@/components/ui/form";
import type { AsignarViaje } from "@/lib/compras/agrupadores/esquemas";
import type { AvisoDetalleApi, CompraDeViajeApi, CompraSinViajeApi, RespuestaAsignarViajeApi, ViajeApi } from "@/lib/compras/agrupadores/tipos-api";
import { asignarComprasViaje, useAccion } from "@/lib/compras/agrupadores/use-agrupadores";
import { plural } from "@/lib/formato";
import { unidades } from "../formato";
import { ModalFormulario } from "./modal-formulario";
import { TablaCompras } from "./tablas-sin-agrupador";
import { pideRelectura, textoErrorAccion } from "./vista-errores";
import { etiquetaViaje, viajesParaSelector } from "./vista-agrupadores";

/**
 * Qué compras y a qué viaje:
 *  - `agregar`: el viaje ya está elegido; se marcan compras sin viaje (la lista llega ya cargada).
 *  - `asignar`: las compras ya vienen elegidas (desde Sin agrupador); se elige el viaje (abiertos primero, cerrados al final).
 *  - `quitar`: se quitan del viaje las compras marcadas.
 */
export type ModoComprasViaje =
  | { tipo: "agregar"; viaje: ViajeApi; candidatas: readonly CompraSinViajeApi[] }
  | { tipo: "asignar"; compras: readonly CompraSinViajeApi[]; viajes: readonly ViajeApi[]; viajeInicial?: string }
  | { tipo: "quitar"; viaje: ViajeApi; compras: readonly CompraDeViajeApi[] };

/**
 * Asignar o quitar compras de un viaje (ficha 08b §0.3, §3.3, decisión 95): los tres roles lo hacen, también con el viaje cerrado (la API
 * responde con el aviso `viaje_cerrado` y se muestra); solo un viaje cancelado lo rechaza. Cada compra lleva la revisión que se vio: si otra
 * persona la cambió, la API responde `409 compra_cambio` y se relee. Quitar pide `confirm`.
 */
export function DialogoComprasViaje({
  modo,
  onHecho,
  onCerrar,
  onRecargar,
}: {
  modo: ModoComprasViaje;
  onHecho: (texto: string, avisos: AvisoDetalleApi[]) => void | Promise<void>;
  onCerrar: () => void;
  onRecargar?: () => void | Promise<void>;
}) {
  const accion = useAccion();
  const [marcadas, setMarcadas] = useState<ReadonlySet<string>>(() => (modo.tipo === "asignar" ? new Set(modo.compras.map((c) => c.id)) : new Set()));
  const [viajeId, setViajeId] = useState(modo.tipo === "asignar" ? (modo.viajeInicial ?? "") : modo.viaje.id);
  const [aviso, setAviso] = useState<string | null>(null);

  const lista: readonly (CompraDeViajeApi | CompraSinViajeApi)[] = modo.tipo === "agregar" ? modo.candidatas : modo.compras;
  const elegidas = lista.filter((c) => marcadas.has(c.id));
  const viajeDestino = modo.tipo === "asignar" ? (modo.viajes.find((v) => v.id === viajeId) ?? null) : modo.viaje;
  const quita = modo.tipo === "quitar";
  const alternar = (id: string, v: boolean) =>
    setMarcadas((m) => {
      const n = new Set(m);
      if (v) n.add(id);
      else n.delete(id);
      return n;
    });

  async function enviar() {
    setAviso(null);
    if (!viajeDestino) return setAviso("Elige un viaje.");
    if (elegidas.length === 0) return setAviso("Marca al menos una compra.");
    if (quita && !confirm(`¿Quitar ${plural(elegidas.length, "compra", "compras")} del viaje ${viajeDestino.codigo}? Quedan sin viaje.`)) return;
    const cuerpo: AsignarViaje = { viaje_id: quita ? null : viajeDestino.id, compras: elegidas.map((c) => ({ id: c.id, revision: c.revision })) };
    const r = await accion.ejecutar<RespuestaAsignarViajeApi>(() => asignarComprasViaje(viajeDestino.id, cuerpo));
    if (!r.ok) {
      if (pideRelectura(r.error.codigo)) await onRecargar?.();
      return;
    }
    await onHecho(
      quita
        ? `${plural(elegidas.length, "compra quitada", "compras quitadas")} del viaje ${viajeDestino.codigo}.`
        : `${plural(elegidas.length, "compra asignada", "compras asignadas")} al viaje ${viajeDestino.codigo}.`,
      r.valor.avisos,
    );
  }

  const titulo = modo.tipo === "agregar" ? `Agregar compras · Viaje ${modo.viaje.codigo}` : modo.tipo === "quitar" ? `Quitar compras · Viaje ${modo.viaje.codigo}` : "Asignar a viaje";
  const unidadesElegidas = elegidas.reduce((a, c) => a + c.unidades, 0);

  return (
    <ModalFormulario
      titulo={titulo}
      descripcion={
        quita
          ? "Las compras quedan sin viaje. Sus embarques y entregas no cambian."
          : modo.tipo === "agregar"
            ? "Compras que todavía no tienen viaje. Un viaje cerrado igual las acepta."
            : "Las compras elegidas pasan al viaje que escojas; un viaje cerrado igual las acepta."
      }
      onCerrar={onCerrar}
      onEnviar={() => void enviar()}
      ocupado={accion.ocupado}
      textoGuardar={`${quita ? "Quitar" : "Asignar"} ${plural(elegidas.length, "compra", "compras")}${unidadesElegidas > 0 ? ` · ${unidades(unidadesElegidas)} u` : ""}`}
      textoOcupado="Guardando…"
      deshabilitarGuardar={elegidas.length === 0 || !viajeDestino}
      error={aviso ?? (accion.error ? textoErrorAccion(accion.error) : null)}
      onCerrarError={() => {
        setAviso(null);
        accion.limpiar();
      }}
      ancho="max-w-4xl"
    >
      {modo.tipo === "asignar" && (
        <Field label="Viaje de destino" hint="Los viajes cerrados aparecen al final.">
          <Select value={viajeId} onChange={(e) => setViajeId(e.target.value)}>
            <option value="">Elige un viaje</option>
            {viajesParaSelector(modo.viajes).map((v) => (
              <option key={v.id} value={v.id}>
                {etiquetaViaje(v)}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {viajeDestino?.estado === "cerrado" && <Alert tono="info">{`El viaje ${viajeDestino.codigo} está cerrado: igual se registra.`}</Alert>}
      <TablaCompras
        compras={lista}
        seleccion={marcadas}
        onAlternar={alternar}
        conOrigen={modo.tipo !== "quitar"}
        vacio={quita ? "Este viaje no tiene compras." : "No hay compras sin viaje."}
      />
    </ModalFormulario>
  );
}
