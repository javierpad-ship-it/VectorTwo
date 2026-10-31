"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, codigoDeError } from "@/lib/api-client";
import { mensajeError } from "@/lib/formato";
import type { EvaluacionApi, PasoGMApi } from "@/lib/ia/tipos-api";
import { useAccion, type ErrorAccion, type ResultadoAccion } from "@/app/(app)/planificacion/proyeccion/use-proyeccion";
import { conducirPasos, corridaTerminadaPorServidor, esperarMs } from "@/app/(app)/planificacion/proyeccion/use-propuesta-ia";
import type { AvanceGm } from "@/app/(app)/planificacion/proyeccion/propuesta-ia-vista";
import type { CuerpoEvaluacion, PlanEvaluacionApi, RespuestaIniciarEvaluacionApi } from "./ia-vista";

/**
 * Conduce una evaluación (backtest, ficha 07e §3.2 y §5.4) desde el navegador, igual que una propuesta: por cada pliegue, `preparar`
 * (arma la entrada en el servidor, sin llamar al proveedor; idempotente) y luego un `POST …/paso` por llamada de cada GM. Nunca reusa por
 * huella (lo decide el servidor). «Detener» cancela la evaluación; el error de la API se devuelve para mostrarlo con `Alert`.
 */

export const rutaEvaluaciones = "/api/ia/evaluaciones";

export type EstadoConduccionEvaluacion = {
  fase: "inactiva" | "corriendo" | "terminada";
  evaluacion: EvaluacionApi | null;
  plan: PlanEvaluacionApi[];
  /** Pliegue que se está preparando («preparando D25…»); `null` fuera de esa etapa. */
  preparando: string | null;
  porGm: Record<string, AvanceGm>;
  costoUsd: number;
  esperando: boolean;
  deteniendo: boolean;
  error: ErrorAccion | null;
};

export const CONDUCCION_INACTIVA: EstadoConduccionEvaluacion = { fase: "inactiva", evaluacion: null, plan: [], preparando: null, porGm: {}, costoUsd: 0, esperando: false, deteniendo: false, error: null };

export const claveAvance = (pliegue: string, gm: string) => `${pliegue}|${gm}`;

export function useConducirEvaluacion(alTerminar?: () => void) {
  const [estado, setEstado] = useState<EstadoConduccionEvaluacion>(CONDUCCION_INACTIVA);
  const inicio = useAccion();
  const detener = useRef(false);
  const montado = useRef(true);
  const alTerminarRef = useRef(alTerminar);

  useEffect(() => {
    montado.current = true;
    alTerminarRef.current = alTerminar;
    return () => {
      montado.current = false;
    };
  }, [alTerminar]);

  const correr = useCallback(async (r: RespuestaIniciarEvaluacionApi) => {
    const id = r.evaluacion.id;
    detener.current = false;
    const poner = (f: (e: EstadoConduccionEvaluacion) => EstadoConduccionEvaluacion) => {
      if (montado.current) setEstado(f);
    };
    poner(() => ({ ...CONDUCCION_INACTIVA, fase: "corriendo", evaluacion: r.evaluacion, plan: r.plan }));
    const preparados = new Set<string>();

    const res = await conducirPasos({
      items: r.plan,
      urlPaso: (i) => `${rutaEvaluaciones}/${id}/gm/${encodeURIComponent(i.gm_clave)}/paso`,
      cuerpoPaso: (i) => ({ pliegue: i.pliegue }),
      llamar: (url, cuerpo) => api.post(url, cuerpo),
      esperar: esperarMs,
      detenida: () => detener.current || !montado.current,
      antesDeGm: async (i) => {
        const pliegue = i.pliegue;
        if (!pliegue || preparados.has(pliegue)) return;
        poner((e) => ({ ...e, preparando: pliegue }));
        await api.post(`${rutaEvaluaciones}/${id}/pliegues/${encodeURIComponent(pliegue)}/preparar`, {});
        preparados.add(pliegue);
        poner((e) => ({ ...e, preparando: null }));
      },
      alPaso: (i, p: PasoGMApi) => {
        const avance: AvanceGm = { estado: p.estado, pasos_hechos: p.pasos_hechos, pasos_total: p.pasos_total };
        poner((e) => ({ ...e, preparando: null, costoUsd: p.corrida.costo_usd, porGm: { ...e.porGm, [claveAvance(i.pliegue ?? "", i.gm_clave)]: avance }, esperando: p.siguiente === "esperar" }));
      },
    });

    let evaluacion: EvaluacionApi | null = r.evaluacion;
    let error: ErrorAccion | null = res.fin === "error" ? res.error : null;
    const hayQueCancelar = res.fin === "detenido" || (res.fin === "error" && !corridaTerminadaPorServidor(res.error.codigo));
    try {
      if (hayQueCancelar && montado.current) evaluacion = await api.post<EvaluacionApi>(`${rutaEvaluaciones}/${id}/cancelar`, {});
      else if (res.fin === "completo") evaluacion = await api.get<EvaluacionApi>(`${rutaEvaluaciones}/${id}`);
    } catch (e) {
      const extra = `No se pudo ${hayQueCancelar ? "cancelar" : "leer"} la evaluación: ${mensajeError(e)}`;
      error = error ? { ...error, mensaje: `${error.mensaje} ${extra}` } : { mensaje: extra, codigo: codigoDeError(e) };
    }
    poner((e) => ({ ...e, fase: "terminada", evaluacion, preparando: null, esperando: false, deteniendo: false, error }));
    alTerminarRef.current?.();
  }, []);

  const iniciar = useCallback(
    async (cuerpo: CuerpoEvaluacion & { costo_confirmado_usd: number }): Promise<ResultadoAccion<RespuestaIniciarEvaluacionApi>> => {
      const r = await inicio.ejecutar(() => api.post<RespuestaIniciarEvaluacionApi>(rutaEvaluaciones, cuerpo));
      if (r.ok) void correr(r.valor);
      return r;
    },
    [inicio, correr]
  );

  const pedirDetener = useCallback(() => {
    detener.current = true;
    setEstado((e) => ({ ...e, deteniendo: true }));
  }, []);

  const reiniciar = useCallback(() => {
    setEstado(CONDUCCION_INACTIVA);
    inicio.limpiar();
  }, [inicio]);

  return { estado, iniciar, detener: pedirDetener, reiniciar, iniciando: inicio.ocupado, errorInicio: inicio.error, limpiarErrorInicio: inicio.limpiar };
}
