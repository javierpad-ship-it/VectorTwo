"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, codigoDeError } from "@/lib/api-client";
import { mensajeError } from "@/lib/formato";
import type { CalcularAgrupacionCuerpo, ParametrosCurvas, TrabajoAgrupacionApi } from "@/lib/curvas/tipos-api";
import { CUERPO_APERTURA, cuerpoCalcular, parametrosPorDefecto, soloParametros } from "./trabajo-vista";

/** Espera (ms) antes de volver a calcular al mover un parámetro: varios cambios seguidos hacen un solo cálculo. */
export const DEMORA_RECALCULO_MS = 300;

export type ErrorTrabajo = { mensaje: string; codigo: string | null };

export type EstadoTrabajo = {
  /** El último cálculo recibido (se conserva mientras se recalcula: el gráfico no se vacía). */
  datos: TrabajoAgrupacionApi | null;
  /** Los parámetros que el planner tiene en pantalla (los de la última aprobación al abrir; `null` hasta la primera respuesta). */
  parametros: ParametrosCurvas | null;
  /** Los parámetros con que se abrió la agrupación (para saber si hay cambios sin aprobar). */
  iniciales: ParametrosCurvas | null;
  /** «Calcular hasta»: `""` es el defecto del servidor (último mes publicado y cerrado). Nunca se hereda de la vigente. */
  hasta: string;
  /** Primera lectura (todavía no hay nada que mostrar). */
  cargando: boolean;
  /** Hay un cálculo pedido o en camino. */
  recalculando: boolean;
  /** Lo que se ve no corresponde a los parámetros de pantalla (cambió algo y la respuesta no llegó, o falló). Aprobar queda deshabilitado. */
  desactualizado: boolean;
  error: ErrorTrabajo | null;
};

const INICIAL: EstadoTrabajo = { datos: null, parametros: null, iniciales: null, hasta: "", cargando: true, recalculando: false, desactualizado: false, error: null };

/**
 * Estado de la vista de trabajo de UNA agrupación (06b): pide `POST …/calcular` al abrir
 * con `{ partir_de_vigente: true }` (los parámetros de su última aprobación; `hasta_periodo`
 * siempre en el defecto) y vuelve a pedirlo, con `AbortController` y 300 ms de espera, cada
 * vez que cambia un parámetro. Nunca escribe: el cálculo es una lectura.
 *
 * El componente que lo usa se monta con `key={agrupacionId}`: al cambiar de agrupación el
 * estado empieza de cero. Solo se toca el estado dentro de promesas, temporizadores y
 * manejadores (react-hooks/set-state-in-effect).
 */
export function useTrabajoAgrupacion(agrupacionId: string) {
  const url = `/api/curvas/agrupaciones/${agrupacionId}/calcular`;
  const [estado, setEstado] = useState<EstadoTrabajo>(INICIAL);
  const control = useRef<AbortController | null>(null);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Fuente de verdad de lo que hay en pantalla (los manejadores leen de aquí, no de un cierre viejo). */
  const edicion = useRef<{ parametros: ParametrosCurvas; hasta: string } | null>(null);

  const pedir = useCallback(
    (cuerpo: CalcularAgrupacionCuerpo, apertura: boolean) => {
      control.current?.abort();
      const c = new AbortController();
      control.current = c;
      api
        .post<TrabajoAgrupacionApi>(url, cuerpo, { signal: c.signal })
        .then((d) => {
          if (c.signal.aborted) return;
          if (apertura) edicion.current = { parametros: soloParametros(d.parametros), hasta: "" };
          setEstado((e) => ({
            datos: d,
            parametros: apertura ? soloParametros(d.parametros) : e.parametros,
            iniciales: apertura ? soloParametros(d.parametros) : e.iniciales,
            hasta: apertura ? "" : e.hasta,
            cargando: false,
            recalculando: false,
            desactualizado: false,
            error: null,
          }));
        })
        .catch((err: unknown) => {
          if (c.signal.aborted) return;
          setEstado((e) => ({ ...e, cargando: false, recalculando: false, error: { mensaje: mensajeError(err), codigo: codigoDeError(err) } }));
        });
    },
    [url]
  );

  // Abrir la agrupación: un primer cálculo con los parámetros de su última aprobación.
  useEffect(() => {
    pedir(CUERPO_APERTURA, true);
    return () => {
      control.current?.abort();
      if (temporizador.current) clearTimeout(temporizador.current);
    };
  }, [pedir]);

  const aplicar = useCallback(
    (parametros: ParametrosCurvas, hasta: string, demora: number) => {
      edicion.current = { parametros, hasta };
      setEstado((e) => ({ ...e, parametros, hasta, recalculando: true, desactualizado: true, error: null }));
      if (temporizador.current) clearTimeout(temporizador.current);
      temporizador.current = setTimeout(() => pedir(cuerpoCalcular(parametros, hasta), false), demora);
    },
    [pedir]
  );

  /** Cambia parámetros (con espera de 300 ms, para que varios cambios seguidos cuesten un solo cálculo). */
  const cambiar = useCallback(
    (siguiente: (p: ParametrosCurvas) => ParametrosCurvas) => {
      const ed = edicion.current;
      if (ed) aplicar(siguiente(ed.parametros), ed.hasta, DEMORA_RECALCULO_MS);
    },
    [aplicar]
  );

  /** «Calcular hasta»: `""` vuelve al defecto. Se calcula en seguida (es una elección, no un tecleo). */
  const cambiarHasta = useCallback(
    (hasta: string) => {
      const ed = edicion.current;
      if (ed) aplicar(ed.parametros, hasta, 0);
    },
    [aplicar]
  );

  /** Valores por defecto de todos los parámetros y `hasta` en el defecto. */
  const restablecer = useCallback(() => {
    if (edicion.current) aplicar(parametrosPorDefecto(), "", 0);
  }, [aplicar]);

  /**
   * Vuelve a calcular con lo que hay en pantalla (tras `datos_cambiados` o `vigente_cambiada`). Si la
   * apertura falló (no hay parámetros todavía), reintenta la apertura.
   */
  const recalcular = useCallback(() => {
    const ed = edicion.current;
    if (ed) {
      aplicar(ed.parametros, ed.hasta, 0);
      return;
    }
    setEstado({ ...INICIAL });
    pedir(CUERPO_APERTURA, true);
  }, [aplicar, pedir]);

  const limpiarError = useCallback(() => setEstado((e) => ({ ...e, error: null })), []);

  return { ...estado, cambiar, cambiarHasta, restablecer, recalcular, limpiarError };
}
