"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, codigoDeError, ErrorApi } from "@/lib/api-client";
import { mensajeError } from "@/lib/formato";

/**
 * Lectura de un `GET /api/...` de M7 (patrón de `useRecurso` de M6 y de `useResponsables`). El estado se toca solo
 * dentro de promesas (react-hooks/set-state-in-effect) y las respuestas fuera de orden se descartan. Con `url = null`
 * no lee nada. Los datos de OTRA url nunca se muestran (al cambiar de línea no se ve la anterior); al recargar la
 * misma url se conservan mientras llega la nueva, así la pantalla no parpadea al decidir. Con `conservarAnterior`, al
 * cambiar de url (un filtro) se sigue mostrando lo último leído hasta que llegue lo nuevo (`cargando` indica que se relee).
 */
export function useLectura<T>(url: string | null, conservarAnterior = false) {
  const [guardado, setGuardado] = useState<{ url: string; datos: T } | null>(null);
  const [leidoDe, setLeidoDe] = useState<string | null>(null);
  const [fallo, setFallo] = useState<{ url: string; mensaje: string } | null>(null);
  const secuencia = useRef(0);

  const pedir = useCallback(() => {
    if (url === null) return Promise.resolve();
    const numero = ++secuencia.current;
    return api
      .get<T>(url)
      .then((d) => {
        if (numero !== secuencia.current) return;
        setGuardado({ url, datos: d });
        setFallo(null);
      })
      .catch((e: unknown) => {
        if (numero !== secuencia.current) return;
        setFallo({ url, mensaje: mensajeError(e) });
      })
      .finally(() => {
        if (numero !== secuencia.current) return;
        setLeidoDe(url);
      });
  }, [url]);

  useEffect(() => {
    void pedir();
  }, [pedir]);

  const recargar = useCallback(() => pedir(), [pedir]);

  const datos = url !== null && (conservarAnterior || guardado?.url === url) ? (guardado?.datos ?? null) : null;
  // Cargando: hay url y todavía no terminó la primera lectura de ESA url (o está releyendo sin datos).
  const cargando = url !== null && leidoDe !== url;
  const error = url !== null && fallo?.url === url ? fallo.mensaje : null;
  const setError = useCallback((m: string | null) => setFallo(m === null ? null : { url: url ?? "", mensaje: m }), [url]);
  return { datos, cargando, error, setError, recargar };
}

/** `detalle` = el cuerpo de la respuesta de error (las listas de algunos `409`). */
export type ErrorAccion = { mensaje: string; codigo: string | null; detalle?: Record<string, unknown> | null };

export type ResultadoAccion<T> = { ok: true; valor: T } | { ok: false; error: ErrorAccion };

/**
 * Una acción que escribe (POST/PUT/PATCH/DELETE): marca ocupado mientras envía, guarda el error con su código de
 * negocio (los `409` de M7) y devuelve el resultado. Nunca se traga el error: la pantalla lo muestra con `Alert`.
 */
export function useAccion() {
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<ErrorAccion | null>(null);

  const ejecutar = useCallback(async <T,>(accion: () => Promise<T>): Promise<ResultadoAccion<T>> => {
    setOcupado(true);
    setError(null);
    try {
      const valor = await accion();
      return { ok: true, valor };
    } catch (e) {
      const err: ErrorAccion = { mensaje: mensajeError(e), codigo: codigoDeError(e), detalle: e instanceof ErrorApi ? e.cuerpo : null };
      setError(err);
      return { ok: false, error: err };
    } finally {
      setOcupado(false);
    }
  }, []);

  const limpiar = useCallback(() => setError(null), []);
  return { ocupado, error, ejecutar, limpiar, setError };
}

/** Repite `recargar` cada `cadaMs` mientras `activo` (para ver terminar un cálculo que arrancó otra sesión). */
export function useSondeo(activo: boolean, recargar: () => unknown, cadaMs = 5000) {
  useEffect(() => {
    if (!activo) return;
    const t = setInterval(() => {
      void recargar();
    }, cadaMs);
    return () => clearInterval(t);
  }, [activo, recargar, cadaMs]);
}

export const rutaProyeccion = (id: string) => `/api/proyeccion/proyecciones/${id}`;
