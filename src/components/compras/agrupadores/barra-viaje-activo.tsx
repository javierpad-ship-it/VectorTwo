"use client";

import { Alert } from "@/components/ui/alert";
import { Select } from "@/components/ui/form";
import type { OpcionViajeApi } from "@/lib/compras/agrupadores/tipos-api";
import { etiquetaViaje, viajesParaSelector, VIAJE_SIN_VIAJE, VIAJE_TODOS } from "./vista-agrupadores";

/**
 * Barra del viaje activo (ficha 08b §3.8 y §4): «Todos», «Sin viaje (locales)» y los viajes abiertos y cerrados (los cerrados al final,
 * marcados). Filtra Compras, Viajes y embarques y Sin agrupador; NO filtra Huecos ni Flujo (decisión 2: se compra por oportunidad). Es una
 * preferencia por navegador: no da ni quita permisos. Presentacional: quien la usa le pasa el valor y `onCambiar` (`useViajeActivo`).
 */
export function BarraViajeActiva({
  valor,
  viajes,
  onCambiar,
  ocupado = false,
  error,
  onCerrarError,
}: {
  valor: string;
  viajes: readonly OpcionViajeApi[];
  onCambiar: (viajeId: string) => void;
  ocupado?: boolean;
  error?: string | null;
  onCerrarError?: () => void;
}) {
  const opciones = viajesParaSelector(viajes);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2 rounded-lg border border-borde bg-superficie px-4 py-3">
        <label className="block min-w-0 flex-1 basis-64">
          <span className="mb-1 block text-sm font-medium text-tinta">Viaje activo</span>
          <Select value={valor} onChange={(e) => onCambiar(e.target.value)} disabled={ocupado} aria-describedby="ayuda-viaje-activo">
            <option value={VIAJE_TODOS}>Todos los viajes</option>
            <option value={VIAJE_SIN_VIAJE}>Sin viaje (locales)</option>
            {opciones.map((v) => (
              <option key={v.id} value={v.id}>
                {etiquetaViaje(v)}
              </option>
            ))}
          </Select>
        </label>
        <p id="ayuda-viaje-activo" className="min-w-0 flex-[2] basis-72 text-xs text-tinta-suave">
          Las listas de Compras y de Viajes y embarques muestran solo este viaje. Huecos y Flujo mensual no cambian: se compra por oportunidad.
        </p>
      </div>
      {error && <Alert onCerrar={onCerrarError}>{error}</Alert>}
    </div>
  );
}
