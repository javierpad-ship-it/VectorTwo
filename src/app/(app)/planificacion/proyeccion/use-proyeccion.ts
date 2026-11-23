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
 *
 * Con `plazoMs`, una lectura que no responde en ese tiempo se da por fallida (`codigo = "plazo_agotado"`): `cargando` vuelve a `false` y
 * la pantalla muestra el error con «Reintentar» en vez de «Leyendo…» para siempre. La respuesta tardía, si llega, se descarta.
 */
export function useLectura<T>(url: string | null, conservarAnterior = false, plazoMs: number | null = null) {
  const [guardado, setGuardado] = useState<{ url: string; datos: T } | null>(null);
  const [leidoDe, setLeidoDe] = useState<string | null>(null);
  const [fallo, setFallo] = useState<{ url: string; mensaje: string; codigo: string | null } | null>(null);
  const secuencia = useRef(0);

  const pedir = useCallback(() => {
    if (url === null) return Promise.resolve();
    const numero = ++secuencia.current;
    const lectura = api.get<T>(url);
    return (plazoMs === null ? lectura : conPlazo(lectura, plazoMs))
      .then((d) => {
        if (numero !== secuencia.current) return;
        setGuardado({ url, datos: d });
        setFallo(null);
      })
      .catch((e: unknown) => {
        if (numero !== secuencia.current) return;
        setFallo({ url, mensaje: mensajeError(e), codigo: codigoDeError(e) });
      })
      .finally(() => {
        if (numero !== secuencia.current) return;
        setLeidoDe(url);
      });
  }, [url, plazoMs]);

  useEffect(() => {
    void pedir();
  }, [pedir]);

  const recargar = useCallback(() => pedir(), [pedir]);

  const datos = url !== null && (conservarAnterior || guardado?.url === url) ? (guardado?.datos ?? null) : null;
  // Cargando: hay url y todavía no terminó la primera lectura de ESA url (o está releyendo sin datos).
  const cargando = url !== null && leidoDe !== url;
  const error = url !== null && fallo?.url === url ? fallo.mensaje : null;
  // `codigo`: el código de negocio del error de la API (los `409` y `404` de M7), para ofrecer la acción que corresponde.
  const codigo = url !== null && fallo?.url === url ? fallo.codigo : null;
  const setError = useCallback((m: string | null) => setFallo(m === null ? null : { url: url ?? "", mensaje: m, codigo: null }), [url]);
  return { datos, cargando, error, codigo, setError, recargar };
}

/** Código del error que da `conPlazo` cuando una lectura no responde a tiempo. */
export const CODIGO_PLAZO_AGOTADO = "plazo_agotado";
export const MENSAJE_PLAZO_AGOTADO = "El servidor tardó demasiado en responder y se dejó de esperar.";

/**
 * Una lectura con límite de tiempo: si `promesa` no termina en `ms`, se rechaza con `ErrorApi(…, 0, "plazo_agotado")`. El temporizador se
 * limpia siempre. `api.get` no admite `AbortSignal`, así que la petición de red no se corta: su respuesta tardía se ignora (la promesa ya
 * quedó resuelta) y `useLectura` además la descarta por número de secuencia. SOLO para lecturas: una escritura con plazo dejaría la duda de
 * si se guardó (ver `src/lib/api/plazos.ts`).
 */
export function conPlazo<T>(promesa: Promise<T>, ms: number, mensaje = MENSAJE_PLAZO_AGOTADO): Promise<T> {
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  const limite = new Promise<never>((_, rechazar) => {
    temporizador = setTimeout(() => rechazar(new ErrorApi(mensaje, 0, CODIGO_PLAZO_AGOTADO)), ms);
  });
  return Promise.race([promesa, limite]).finally(() => clearTimeout(temporizador));
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

/**
 * Cronómetro y «se cerró la ventana» de una operación larga de un modal (ver `operacion-larga-vista.ts`). `empezar()` se llama en el
 * manejador antes de enviar; `segundos` cuenta mientras `activo`. `cerrarEnCurso()` marca que el usuario cerró la ventana con la operación
 * corriendo: al terminar, el modal ya no debe llamar a `onCerrar` (podría cerrar otro diálogo) y un error debe ir al panel.
 */
export function useOperacionLarga(activo: boolean) {
  const [inicio, setInicio] = useState<number | null>(null);
  const [ahora, setAhora] = useState(0);
  const cerrada = useRef(false);

  useEffect(() => {
    if (!activo) return;
    const t = setInterval(() => setAhora(Date.now()), 1000);
    return () => clearInterval(t);
  }, [activo]);

  const empezar = useCallback(() => {
    cerrada.current = false;
    const n = Date.now();
    setInicio(n);
    setAhora(n);
  }, []);
  const cerrarEnCurso = useCallback(() => {
    cerrada.current = true;
  }, []);
  const seCerro = useCallback(() => cerrada.current, []);

  const segundos = activo && inicio !== null ? Math.max(0, Math.floor((ahora - inicio) / 1000)) : 0;
  return { segundos, empezar, cerrarEnCurso, seCerro };
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
