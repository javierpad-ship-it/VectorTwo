"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { AprobacionesApi, BloqueosCierreApi, OpcionesTableroApi, TableroApi } from "@/lib/direccion/tipos-api";
import { useLectura } from "../proyeccion/use-proyeccion";
import { urlAprobaciones, urlBloqueos, urlOpciones, urlTablero, type FiltrosVista } from "./vista-tablero";

/**
 * Lecturas del tablero de aprobación de dirección (ficha 14, §3.1), con el patrón de `use-proyeccion.ts` (`useLectura`: el estado solo se toca dentro
 * de promesas y las respuestas fuera de orden se descartan):
 *
 * - `opciones`: catálogo de filtros, proyecciones y valores por defecto (no depende de los filtros);
 * - `tablero`: el tablero del recorte. Al cambiar un filtro se sigue viendo lo último leído hasta que llega lo nuevo (`cargando` lo indica);
 * - `bloqueos`: lo que bloquearía el cierre. Se pide APARTE (carga el contexto de cálculo de M7 y puede tardar más) y solo en trabajo: el resto del
 *   tablero no la espera;
 * - `aprobaciones`: el historial de la proyección mostrada.
 */
export function useTableroDireccion(filtros: FiltrosVista) {
  const opciones = useLectura<OpcionesTableroApi>(urlOpciones());
  const tablero = useLectura<TableroApi>(urlTablero(filtros), true);
  // Con error, lo último leído es de OTRA consulta: no se usa para pedir nada más.
  const proyeccion = tablero.error === null ? (tablero.datos?.proyeccion ?? null) : null;
  const bloqueos = useLectura<BloqueosCierreApi>(proyeccion && proyeccion.estado === "en_trabajo" ? urlBloqueos(proyeccion.id) : null);
  const aprobaciones = useLectura<AprobacionesApi>(proyeccion ? urlAprobaciones(proyeccion.id) : null);

  const recargarOpciones = opciones.recargar;
  const recargarTablero = tablero.recargar;
  const recargarBloqueos = bloqueos.recargar;
  const recargarAprobaciones = aprobaciones.recargar;
  const recargarTodo = useCallback(async () => {
    await Promise.all([recargarOpciones(), recargarTablero(), recargarBloqueos(), recargarAprobaciones()]);
  }, [recargarOpciones, recargarTablero, recargarBloqueos, recargarAprobaciones]);

  return { opciones, tablero, bloqueos, aprobaciones, recargarTodo };
}

const CONSULTA_ANCHA = "(min-width: 640px)";

function suscribirAncho(alCambiar: () => void): () => void {
  const m = window.matchMedia(CONSULTA_ANCHA);
  m.addEventListener("change", alCambiar);
  return () => m.removeEventListener("change", alCambiar);
}

/** ¿La pantalla mide 640 px o más? En el servidor (y hasta hidratar) cuenta como angosta: el móvil es el caso base. */
export function usePantallaAncha(): boolean {
  return useSyncExternalStore(
    suscribirAncho,
    () => window.matchMedia(CONSULTA_ANCHA).matches,
    () => false
  );
}
