"use client";

import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ETIQUETA_ACCION_AGRUPADOR_EVENTO } from "@/lib/compras/agrupadores/tipos-api";
import { useHistorial, type RefHistorial } from "@/lib/compras/agrupadores/use-agrupadores";
import { fechaHora } from "../formato";

/**
 * Historial de un viaje, un embarque o un paquete (ficha 08b §2.9, `compra_agrupador_eventos`): quién hizo qué y cuándo, con el motivo que
 * escribió. Los eventos no se editan ni se borran. Solo se lee cuando la persona lo abre, para no pedir de más al entrar al detalle.
 */
export function HistorialAgrupador({ referencia, titulo = "Historial" }: { referencia: RefHistorial; titulo?: string }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <section className="space-y-2" aria-label={titulo}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{titulo}</h3>
        <Button variante="secundario" tamano="sm" onClick={() => setAbierto((a) => !a)} aria-expanded={abierto}>
          {abierto ? "Ocultar" : "Ver historial"}
        </Button>
      </div>
      {abierto && <ListaEventos referencia={referencia} />}
    </section>
  );
}

function ListaEventos({ referencia }: { referencia: RefHistorial }) {
  const lectura = useHistorial(referencia);
  if (lectura.cargando && !lectura.datos) return <p className="py-3 text-sm text-tinta-suave">Cargando el historial…</p>;
  if (lectura.error) return <Alert onCerrar={() => lectura.setError(null)}>{lectura.error}</Alert>;
  // La API los da del más antiguo al más reciente; aquí, como en el historial de una compra, lo último arriba.
  const eventos = [...(lectura.datos?.eventos ?? [])].reverse();
  if (eventos.length === 0) return <p className="py-3 text-sm text-tinta-suave">Todavía no hay movimientos.</p>;
  return (
    <ol className="divide-y divide-borde rounded-lg border border-borde bg-superficie">
      {eventos.map((ev) => (
        <li key={ev.id} className="px-3 py-2 text-sm">
          <p>
            <strong>{ETIQUETA_ACCION_AGRUPADOR_EVENTO[ev.accion]}</strong>
            <span className="text-tinta-suave">
              {" "}
              · {ev.usuario_nombre ?? "—"} · {fechaHora(ev.created_at)}
            </span>
          </p>
          {ev.resumen && <p className="text-xs text-tinta">{ev.resumen}</p>}
          {ev.motivo && <p className="text-xs text-tinta-suave">Motivo: {ev.motivo}</p>}
        </li>
      ))}
    </ol>
  );
}
