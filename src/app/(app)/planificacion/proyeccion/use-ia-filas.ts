"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ErrorApi } from "@/lib/api-client";
import { mensajeError } from "@/lib/formato";
import type { IaFilaApi } from "@/lib/ia/tipos-api";
import type { ErrorAccion, ResultadoAccion } from "./use-proyeccion";

/**
 * Las filas de la IA de una línea (07e §3.1, `GET …/ia/filas?genero_id&mundo_id&linea_id`), para las columnas IA de Por línea. Es una lectura
 * APARTE (D15): si falla o la IA está apagada, Por línea sigue igual que antes. Mismo patrón que `useLectura` (el estado se toca solo dentro de
 * promesas; las respuestas fuera de orden se descartan; los datos de OTRA url nunca se muestran), con una diferencia: aquí hace falta saber POR QUÉ
 * falló.
 *
 * - IA apagada (`ia_no_disponible`, `capacidad_apagada`), sin permiso (403) o ruta inexistente (404): no es un error para el planner, es «no hay IA».
 *   `filas` queda vacío y `error` en `null`: la pantalla no muestra nada de la IA.
 * - Cualquier otro fallo: `error` con el mensaje del servidor; la pantalla lo dice en un `Alert` que no bloquea y las columnas muestran «—».
 */

/** Códigos de negocio con los que la API dice «la IA no está disponible»: no son un error que mostrar. */
const CODIGOS_IA_APAGADA: ReadonlySet<string> = new Set(["ia_no_disponible", "capacidad_apagada"]);
const STATUS_SIN_IA: ReadonlySet<number> = new Set([403, 404]);

/** ¿El fallo significa «aquí no hay IA» (y no un problema que mostrar)? Pura. */
export function esIaApagada(e: unknown): boolean {
  if (!(e instanceof ErrorApi)) return false;
  return (e.codigo !== null && CODIGOS_IA_APAGADA.has(e.codigo)) || STATUS_SIN_IA.has(e.status);
}

const SIN_FILAS: readonly IaFilaApi[] = [];

export function useIaFilas(url: string | null) {
  const [guardado, setGuardado] = useState<{ url: string; filas: readonly IaFilaApi[] } | null>(null);
  const [leidoDe, setLeidoDe] = useState<string | null>(null);
  const [fallo, setFallo] = useState<{ url: string; mensaje: string } | null>(null);
  const secuencia = useRef(0);

  const pedir = useCallback(() => {
    if (url === null) return Promise.resolve();
    const numero = ++secuencia.current;
    return api
      .get<{ filas: IaFilaApi[] }>(url)
      .then((d) => {
        if (numero !== secuencia.current) return;
        setGuardado({ url, filas: d.filas });
        setFallo(null);
      })
      .catch((e: unknown) => {
        if (numero !== secuencia.current) return;
        if (esIaApagada(e)) {
          setGuardado({ url, filas: SIN_FILAS });
          setFallo(null);
        } else {
          setFallo({ url, mensaje: mensajeError(e) });
        }
      })
      .finally(() => {
        if (numero !== secuencia.current) return;
        setLeidoDe(url);
      });
  }, [url]);

  useEffect(() => {
    void pedir();
  }, [pedir]);

  const filas = url !== null && guardado?.url === url ? guardado.filas : SIN_FILAS;
  const porFila = useMemo(() => new Map(filas.map((f) => [f.fila_id, f] as const)), [filas]);
  const error = url !== null && fallo?.url === url ? fallo.mensaje : null;
  const setError = useCallback((m: string | null) => setFallo(m === null ? null : { url: url ?? "", mensaje: m }), [url]);
  return { filas, porFila, hay: filas.length > 0, cargando: url !== null && leidoDe !== url, error, setError, recargar: pedir };
}

/** Lo que devuelve «Aceptar IA». `cambio`: la API respondió `409 ia_valor_cambio` (otra fila del GM se fijó entre leer y aceptar); `valorActual`: la cifra nueva, si vino. */
export type ResultadoAceptarIa = { ok: true } | { ok: false; cambio: boolean; valorActual: number | null };

type AccionAceptar = {
  ejecutar: <T>(accion: () => Promise<T>) => Promise<ResultadoAccion<T>>;
  limpiar: () => void;
};

/** `valor_actual` del cuerpo de un `409 ia_valor_cambio`: suelto o dentro de `data`/`detalle`. `null` si no vino. Pura. */
export function valorActualDe(detalle: ErrorAccion["detalle"]): number | null {
  if (!detalle) return null;
  const candidatos: unknown[] = [detalle.valor_actual];
  for (const k of ["data", "detalle"]) {
    const dentro = detalle[k];
    if (dentro && typeof dentro === "object") candidatos.push((dentro as Record<string, unknown>).valor_actual);
  }
  const n = candidatos.find((c) => typeof c === "number" && Number.isFinite(c));
  return typeof n === "number" ? n : null;
}

/**
 * «Aceptar IA» de una fila de `Y+1` (07e §3.1): envía la cifra que el planner vio (`valor_esperado = meta_y1`). Es una decisión como cualquier otra
 * (la API la guarda con su traza). Con `409 ia_valor_cambio` NO deja el error en la acción (la pantalla da un aviso propio, con la cifra nueva);
 * cualquier otro error queda en `accion.error` y la pantalla lo muestra con `Alert`.
 */
export async function aceptarIaFila(accion: AccionAceptar, rutaProyeccion: string, filaId: string, anio: number, ia: IaFilaApi): Promise<ResultadoAceptarIa> {
  if (ia.meta_y1 === null) return { ok: false, cambio: false, valorActual: null };
  const cuerpo = { anio, propuesta_fila_id: ia.propuesta_fila_id, valor_esperado: ia.meta_y1 };
  const r = await accion.ejecutar(() => api.post(`${rutaProyeccion}/ia/filas/${filaId}/aceptar`, cuerpo));
  if (r.ok) return { ok: true };
  if (r.error.codigo === "ia_valor_cambio") {
    accion.limpiar();
    return { ok: false, cambio: true, valorActual: valorActualDe(r.error.detalle) };
  }
  return { ok: false, cambio: false, valorActual: null };
}
