"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api-client";
import type { AperturasRespuesta } from "@/lib/tiendas/tipos-api";

/**
 * Carga `GET /api/tiendas/aperturas` para una fecha `hoy` (ISO) y con o sin
 * inactivas. Mismo patrón que `useEstacionalidad`: el estado solo se toca
 * dentro de las promesas (react-hooks/set-state-in-effect) y las respuestas
 * fuera de orden se descartan. Con `hoy` inválido no consulta.
 */
export function useAperturas(hoy: string, incluirInactivos: boolean) {
  const valido = /^\d{4}-\d{2}-\d{2}$/.test(hoy);
  const url = valido ? `/api/tiendas/aperturas?hoy=${hoy}${incluirInactivos ? "&incluir_inactivos=1" : ""}` : null;

  const [datos, setDatos] = useState<AperturasRespuesta | null>(null);
  const [recargando, setRecargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ultimaUrl, setUltimaUrl] = useState<string | null>(null);
  const secuencia = useRef(0);

  const cargar = useCallback(() => {
    if (!url) return Promise.resolve();
    const numero = ++secuencia.current;
    return api
      .get<AperturasRespuesta>(url)
      .then((d) => {
        if (numero !== secuencia.current) return;
        setDatos(d);
        setError(null);
      })
      .catch((e: unknown) => {
        if (numero !== secuencia.current) return;
        setError(e instanceof Error ? e.message : "Error al cargar el calendario");
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
    setRecargando(true);
    return cargar();
  }, [cargar]);

  const cargando = url !== null && (recargando || ultimaUrl !== url);

  return { datos, cargando, error, setError, recargar, fechaValida: valido };
}
