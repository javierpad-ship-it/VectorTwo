"use client";

import { useState } from "react";
import { api } from "@/lib/api-client";
import { formatearNumero, mensajeError, plural } from "@/lib/formato";
import { avisoNoPermitidas } from "@/lib/estacionalidad/generos";
import type { AsignarCuerpo, AsignarRespuesta, EquivalenciaPlana } from "@/lib/estacionalidad/tipos-api";

/** Límite del esquema `asignarSchema`; una selección mayor se envía en tandas. */
const MAX_IDS_POR_LLAMADA = 2_000;

export type DestinoAsignacion = { id: string; nombre: string } | null;

/**
 * Asignación en bloque (`POST /api/estacionalidad/asignar`) compartida por
 * las pestañas Asignación y Faltantes: `confirm` con los conteos, bloqueo de
 * dobles envíos, `Alert` de éxito/error y recarga de la lista.
 */
export function useAsignar(onCambio: () => Promise<void>) {
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  /** Aviso en tono alerta: equivalencias que no se asignaron porque la agrupación no incluye su género. */
  const [advertencia, setAdvertencia] = useState<string | null>(null);

  /** Devuelve `true` si se aplicó (para que quien llama limpie la selección). */
  async function asignar(destino: DestinoAsignacion, filas: EquivalenciaPlana[]): Promise<boolean> {
    if (ocupado || filas.length === 0) return false;
    const n = filas.length;
    if (destino) {
      const cambian = filas.filter((f) => f.agrupacion !== null && f.agrupacion.id !== destino.id).length;
      const detalle = cambian > 0 ? ` ${formatearNumero(cambian)} de ellas ya ${cambian === 1 ? "tiene" : "tienen"} otra agrupación y ${cambian === 1 ? "cambiará" : "cambiarán"}.` : "";
      if (!confirm(`¿Asignar ${plural(n, "equivalencia", "equivalencias")} a ${destino.nombre}?${detalle}`)) return false;
    } else {
      if (!confirm(`¿Quitar la agrupación a ${plural(n, "equivalencia", "equivalencias")}? Quedarán como faltantes hasta que las reasignes.`)) return false;
    }

    setOcupado(true);
    setError(null);
    setAviso(null);
    setAdvertencia(null);
    try {
      const ids = Array.from(new Set(filas.map((f) => f.id)));
      const total: AsignarRespuesta = { asignadas: 0, sin_cambio: 0, no_encontradas: [], no_permitidas: [] };
      for (let i = 0; i < ids.length; i += MAX_IDS_POR_LLAMADA) {
        const cuerpo: AsignarCuerpo = { agrupacion_id: destino?.id ?? null, equivalencia_ids: ids.slice(i, i + MAX_IDS_POR_LLAMADA) };
        const r = await api.post<AsignarRespuesta>("/api/estacionalidad/asignar", cuerpo);
        total.asignadas += r.asignadas;
        total.sin_cambio += r.sin_cambio;
        total.no_encontradas.push(...r.no_encontradas);
        total.no_permitidas.push(...(r.no_permitidas ?? []));
      }
      const partes = [
        destino
          ? `${plural(total.asignadas, "equivalencia asignada", "equivalencias asignadas")} a ${destino.nombre}`
          : `Agrupación quitada a ${plural(total.asignadas, "equivalencia", "equivalencias")}`,
      ];
      if (total.sin_cambio > 0) partes.push(`${formatearNumero(total.sin_cambio)} sin cambio`);
      if (total.no_encontradas.length > 0) {
        partes.push(
          `${plural(total.no_encontradas.length, "equivalencia ya no existía", "equivalencias ya no existían")}: la lista estaba desactualizada y se recargó`
        );
      }
      setAviso(`${partes.join(" · ")}.`);
      setAdvertencia(avisoNoPermitidas(total.no_permitidas));
      await onCambio();
      return true;
    } catch (e) {
      setError(mensajeError(e));
      return false;
    } finally {
      setOcupado(false);
    }
  }

  return { ocupado, error, setError, aviso, setAviso, advertencia, setAdvertencia, asignar };
}
