"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api-client";

/**
 * Carga un recurso que responde un objeto (no un arreglo, por eso no sirve
 * `useColeccion`). Mismo patrón que `useResponsables`: el estado solo se toca
 * dentro de las promesas (react-hooks/set-state-in-effect), las respuestas que
 * llegan fuera de orden se descartan y `cargando` se deriva de que la URL
 * pedida difiera de la última respondida.
 *
 * Con `url = null` no se pide nada (p. ej. el rol no puede ver el recurso):
 * `datos` queda en `null` y `cargando` en `false`.
 */
export function useRecurso<T>(url: string | null) {
  const [datos, setDatos] = useState<T | null>(null);
  const [recargando, setRecargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ultimaUrl, setUltimaUrl] = useState<string | null>(null);
  const secuencia = useRef(0);

  const cargar = useCallback(() => {
    if (url === null) return Promise.resolve();
    const numero = ++secuencia.current;
    return api
      .get<T>(url)
      .then((d) => {
        if (numero !== secuencia.current) return;
        setDatos(d);
        setError(null);
      })
      .catch((e: unknown) => {
        if (numero !== secuencia.current) return;
        setError(e instanceof Error ? e.message : "Error al cargar");
      })
      .finally(() => {
        if (numero !== secuencia.current) return;
        setUltimaUrl(url);
        setRecargando(false);
      });
  }, [url]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const recargar = useCallback(() => {
    if (url === null) return Promise.resolve();
    setRecargando(true);
    return cargar();
  }, [cargar, url]);

  const cargando = url !== null && (recargando || ultimaUrl !== url);

  return { datos, cargando, error, setError, recargar };
}
