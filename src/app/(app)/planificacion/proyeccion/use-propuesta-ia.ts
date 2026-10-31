"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, codigoDeError, ErrorApi } from "@/lib/api-client";
import { mensajeError } from "@/lib/formato";
import type { CorridaApi, GMIaDetalleApi, PasoGMApi } from "@/lib/ia/tipos-api";
import { rutaProyeccion, useAccion, useLectura, type ErrorAccion, type ResultadoAccion } from "./use-proyeccion";
import {
  gmTerminado,
  textoResumenCorrida,
  type AvanceGm,
  type EstadoIaProyeccionApi,
  type PlanGmApi,
  type RespuestaIniciarCorridaApi,
  type SeleccionGms,
} from "./propuesta-ia-vista";

/**
 * Hooks de la pestaña «Propuesta IA» (ficha 07e, §3.1 y §4.1). Todo va por `/api` con `api`/`useLectura`; nunca Supabase.
 * El navegador CONDUCE la corrida: cada `POST …/paso` hace una sola llamada al proveedor y responde (D10), así que aquí vive el bucle
 * que repite el paso mientras el servidor dice `continuar`, espera cuando dice `esperar` (429/5xx: no es un error HTTP) y pasa al GM
 * siguiente cuando dice `hecho` o `fallido`. El estado solo se toca dentro de promesas (react-hooks/set-state-in-effect).
 */

export const rutaIa = (proyeccionId: string) => `${rutaProyeccion(proyeccionId)}/ia`;

/** `GET …/ia`: servicio, prerrequisitos, corrida en curso y un resumen por GM. */
export function useEstadoIa(proyeccionId: string) {
  return useLectura<EstadoIaProyeccionApi>(rutaIa(proyeccionId));
}

/** `GET …/ia/gm/[clave]`; con `clave = null` no lee nada. */
export function useDetalleGmIa(proyeccionId: string, clave: string | null) {
  return useLectura<GMIaDetalleApi>(clave === null ? null : `${rutaIa(proyeccionId)}/gm/${encodeURIComponent(clave)}`);
}

// ─── El bucle de pasos (compartido con la evaluación de Administración) ───

export const ESPERA_DEFECTO_MS = 2000;
export const ESPERA_MIN_MS = 500;
export const ESPERA_MAX_MS = 120_000;
export const MAX_PASOS_POR_GM = 300;
/** `409 gm_en_proceso`: otra petición tiene el paso (candado); se reintenta unas veces antes de rendirse. */
export const REINTENTOS_CANDADO = 5;
export const ESPERA_CANDADO_MS = 3000;

/** Códigos con los que el servidor ya dejó la corrida en un estado terminal: no hay nada que cerrar. */
const CODIGOS_CORRIDA_TERMINADA = ["tope_corrida", "tope_mensual", "tope_dia", "datos_cambiaron", "corrida_terminada", "evaluacion_terminada", "ia_no_disponible", "cerrada", "tope"];
export const corridaTerminadaPorServidor = (codigo: string | null): boolean => codigo !== null && CODIGOS_CORRIDA_TERMINADA.includes(codigo);

export const esperaSegura = (ms: number | null | undefined): number => (ms === null || ms === undefined || !Number.isFinite(ms) ? ESPERA_DEFECTO_MS : Math.min(ESPERA_MAX_MS, Math.max(ESPERA_MIN_MS, ms)));

export function aErrorAccion(e: unknown): ErrorAccion {
  return { mensaje: mensajeError(e), codigo: codigoDeError(e), detalle: e instanceof ErrorApi ? e.cuerpo : null };
}

/** Un GM por visitar: en una propuesta `pliegue` no existe; en una evaluación, sí. */
export type ItemPaso = { gm_clave: string; pliegue?: string | null };

export type OpcionesConducir = {
  items: readonly ItemPaso[];
  urlPaso: (i: ItemPaso) => string;
  cuerpoPaso: (i: ItemPaso) => unknown;
  llamar: <T>(url: string, cuerpo: unknown) => Promise<T>;
  esperar: (ms: number) => Promise<void>;
  /** ¿El usuario pidió detener? Se mira entre pasos: el paso en vuelo termina. */
  detenida: () => boolean;
  alPaso: (i: ItemPaso, p: PasoGMApi) => void;
  /** Se llama una vez al empezar cada GM (la evaluación prepara aquí su pliegue). */
  antesDeGm?: (i: ItemPaso) => Promise<void>;
};

export type ResultadoConducir = { fin: "completo" } | { fin: "detenido" } | { fin: "error"; error: ErrorAccion; item: ItemPaso };

/**
 * Recorre los GM del plan haciendo `POST` de pasos hasta que cada uno termina. Nunca lanza: devuelve cómo terminó. Un error de la API
 * detiene todo y se devuelve tal cual para mostrarlo con `Alert` (el único que se reintenta solo es `gm_en_proceso`).
 */
export async function conducirPasos(o: OpcionesConducir): Promise<ResultadoConducir> {
  for (const item of o.items) {
    if (o.detenida()) return { fin: "detenido" };
    if (o.antesDeGm) {
      try {
        await o.antesDeGm(item);
      } catch (e) {
        return { fin: "error", error: aErrorAccion(e), item };
      }
    }
    let pasos = 0;
    let candado = 0;
    for (;;) {
      if (o.detenida()) return { fin: "detenido" };
      if (++pasos > MAX_PASOS_POR_GM) return { fin: "error", error: { mensaje: "El GM no terminó tras demasiados pasos; se detuvo para no gastar de más.", codigo: "demasiados_pasos" }, item };
      let paso: PasoGMApi;
      try {
        paso = await o.llamar<PasoGMApi>(o.urlPaso(item), o.cuerpoPaso(item));
      } catch (e) {
        if (codigoDeError(e) === "gm_en_proceso" && candado < REINTENTOS_CANDADO) {
          candado += 1;
          await o.esperar(ESPERA_CANDADO_MS);
          continue;
        }
        return { fin: "error", error: aErrorAccion(e), item };
      }
      candado = 0;
      o.alPaso(item, paso);
      if (paso.siguiente === "esperar") {
        await o.esperar(esperaSegura(paso.esperar_ms));
        continue;
      }
      if (paso.siguiente === "hecho" || paso.siguiente === "fallido" || gmTerminado(paso.estado)) break;
    }
  }
  return { fin: "completo" };
}

export const esperarMs = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ─── Generar una propuesta ───

export type EstadoGeneracion = {
  fase: "inactiva" | "corriendo" | "terminada";
  corrida: CorridaApi | null;
  plan: PlanGmApi[];
  porGm: Record<string, AvanceGm>;
  actual: string | null;
  esperando: boolean;
  deteniendo: boolean;
  resumen: string | null;
  error: ErrorAccion | null;
};

export const GENERACION_INACTIVA: EstadoGeneracion = { fase: "inactiva", corrida: null, plan: [], porGm: {}, actual: null, esperando: false, deteniendo: false, resumen: null, error: null };

export type CuerpoCorrida = { gms: SeleccionGms; regenerar: boolean; costo_confirmado_usd: number };

/**
 * Pide una corrida (`POST …/ia/corridas`) y, si el servidor la crea, la conduce GM a GM. `iniciar` responde en cuanto el servidor
 * contesta el `POST` (con el error, p. ej. `costo_no_confirmado`, para que el modal lo trate); el resto sigue en segundo plano en la
 * página y se ve en `estado`. «Detener» termina el paso en vuelo y cancela la corrida (lo ya hecho se conserva).
 */
export function useGeneracionIa(proyeccionId: string, alTerminar?: () => void) {
  const [estado, setEstado] = useState<EstadoGeneracion>(GENERACION_INACTIVA);
  const inicio = useAccion();
  const detener = useRef(false);
  const montado = useRef(true);
  const alTerminarRef = useRef(alTerminar);
  const ultimo = useRef<{ corrida: CorridaApi | null; porGm: Record<string, AvanceGm> }>({ corrida: null, porGm: {} });

  useEffect(() => {
    montado.current = true;
    alTerminarRef.current = alTerminar;
    return () => {
      montado.current = false;
    };
  }, [alTerminar]);

  const correr = useCallback(
    async (r: RespuestaIniciarCorridaApi) => {
      const base = `${rutaIa(proyeccionId)}/corridas/${r.corrida.id}`;
      const porGm: Record<string, AvanceGm> = Object.fromEntries(r.plan.map((p) => [p.gm_clave, { estado: "pendiente", pasos_hechos: 0, pasos_total: 0 } as AvanceGm]));
      ultimo.current = { corrida: r.corrida, porGm };
      detener.current = false;
      const poner = (f: (e: EstadoGeneracion) => EstadoGeneracion) => {
        if (montado.current) setEstado(f);
      };
      poner(() => ({ ...GENERACION_INACTIVA, fase: "corriendo", corrida: r.corrida, plan: r.plan, porGm }));

      const res = await conducirPasos({
        items: r.plan.map((p) => ({ gm_clave: p.gm_clave })),
        urlPaso: (i) => `${base}/gm/${encodeURIComponent(i.gm_clave)}/paso`,
        cuerpoPaso: () => ({}),
        llamar: (url, cuerpo) => api.post(url, cuerpo),
        esperar: esperarMs,
        detenida: () => detener.current || !montado.current,
        alPaso: (i, p) => {
          const avance: AvanceGm = { estado: p.estado, pasos_hechos: p.pasos_hechos, pasos_total: p.pasos_total };
          ultimo.current = { corrida: p.corrida, porGm: { ...ultimo.current.porGm, [i.gm_clave]: avance } };
          poner((e) => ({ ...e, corrida: p.corrida, porGm: ultimo.current.porGm, actual: i.gm_clave, esperando: p.siguiente === "esperar" }));
        },
      });

      // Cerrar la corrida: completa/parcial si se terminó; cancelada si se detuvo o falló algo que el servidor no cerró solo.
      let corridaFinal = ultimo.current.corrida;
      let error: ErrorAccion | null = res.fin === "error" ? res.error : null;
      const hayQueCerrar = res.fin !== "error" || !corridaTerminadaPorServidor(res.error.codigo);
      if (hayQueCerrar && montado.current) {
        try {
          corridaFinal = await api.post<CorridaApi>(`${base}/terminar`, { cancelar: res.fin !== "completo" });
        } catch (e) {
          const extra = `No se pudo cerrar la corrida: ${mensajeError(e)}`;
          error = error ? { ...error, mensaje: `${error.mensaje} ${extra}` } : { mensaje: extra, codigo: codigoDeError(e) };
        }
      }
      const resumen = textoResumenCorrida(ultimo.current.porGm, corridaFinal);
      poner((e) => ({ ...e, fase: "terminada", corrida: corridaFinal, actual: null, esperando: false, deteniendo: false, resumen, error }));
      alTerminarRef.current?.();
    },
    [proyeccionId]
  );

  const iniciar = useCallback(
    async (cuerpo: CuerpoCorrida): Promise<ResultadoAccion<RespuestaIniciarCorridaApi>> => {
      const r = await inicio.ejecutar(() => api.post<RespuestaIniciarCorridaApi>(`${rutaIa(proyeccionId)}/corridas`, cuerpo));
      if (r.ok) void correr(r.valor);
      return r;
    },
    [inicio, proyeccionId, correr]
  );

  const pedirDetener = useCallback(() => {
    detener.current = true;
    setEstado((e) => ({ ...e, deteniendo: true }));
  }, []);

  const reiniciar = useCallback(() => {
    setEstado(GENERACION_INACTIVA);
    inicio.limpiar();
  }, [inicio]);

  return { estado, iniciar, detener: pedirDetener, reiniciar, iniciando: inicio.ocupado, errorInicio: inicio.error, limpiarErrorInicio: inicio.limpiar };
}
