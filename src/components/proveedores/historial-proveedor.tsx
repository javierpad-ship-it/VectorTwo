"use client";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { fechaHora } from "@/components/compras/formato";
import { useLectura } from "@/app/(app)/planificacion/proyeccion/use-proyeccion";
import type { EventoProveedorApi } from "@/lib/proveedores/tipos-api";
import { ETIQUETA_ACCION_PROVEEDOR } from "./vista-proveedores";

/**
 * Pestaña «Historial» del proveedor (08c, §11.P4, decisión 103): cada guardado con quién, cuándo y qué campo cambió, campo a campo
 * (antes → después). El historial no se borra. Se monta solo cuando la pestaña está abierta (quien lo usa le pone `key` para releer tras un guardado).
 */
export function HistorialProveedor({ proveedorId }: { proveedorId: string }) {
  const lectura = useLectura<EventoProveedorApi[]>(`/api/compras/proveedores/${proveedorId}/historial`);
  if (lectura.error) return <Alert onCerrar={() => lectura.setError(null)}>{lectura.error}</Alert>;
  if (lectura.cargando && !lectura.datos) return <p className="py-6 text-center text-sm text-tinta-suave">Cargando el historial…</p>;
  const eventos = lectura.datos ?? [];
  if (eventos.length === 0) return <p className="py-6 text-center text-sm text-tinta-suave">Todavía sin movimientos registrados.</p>;
  return (
    <ol className="divide-y divide-borde rounded-lg border border-borde bg-superficie" aria-label="Historial de cambios del proveedor">
      {eventos.map((e) => (
        <li key={e.id} className="space-y-1.5 px-3 py-3 text-sm">
          <p className="flex flex-wrap items-center gap-2">
            <Badge tono={e.accion === "desactivar" || e.accion === "eliminar" ? "alerta" : e.accion === "crear" || e.accion === "importar" ? "exito" : "marca"}>{ETIQUETA_ACCION_PROVEEDOR[e.accion]}</Badge>
            {e.resumen && <span className="min-w-0 break-words">{e.resumen}</span>}
          </p>
          {e.cambios.length > 0 && (
            <dl className="space-y-1 rounded-md bg-fondo/60 p-2 text-xs">
              {e.cambios.map((c) => (
                <div key={c.campo} className="grid gap-x-2 sm:grid-cols-[10rem_1fr]">
                  <dt className="font-medium text-tinta-suave">{c.campo}</dt>
                  <dd className="min-w-0 break-words">
                    <span className="text-tinta-suave">{c.antes ?? "—"}</span> <span aria-hidden>→</span>
                    <span className="sr-only"> cambió a </span> <span className="font-medium text-tinta">{c.despues ?? "—"}</span>
                  </dd>
                </div>
              ))}
            </dl>
          )}
          <p className="text-xs text-tinta-suave">
            {e.por.nombre ?? "—"} · {fechaHora(e.por.at)}
          </p>
        </li>
      ))}
    </ol>
  );
}
