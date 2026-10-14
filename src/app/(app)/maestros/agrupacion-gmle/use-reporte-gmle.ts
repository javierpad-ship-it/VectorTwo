"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api-client";
import type { ReporteAgrupacionGmle } from "@/lib/reportes/tipos-api";

/**
 * Carga `GET /api/reportes/agrupacion-gmle` (una sola respuesta, no un
 * array: `useColeccion` no encaja) y expone recarga y error. Mismo patrón que
 * `useEstacionalidad`: el estado solo se toca dentro de las promesas
 * (react-hooks/set-state-in-effect) y las respuestas fuera de orden se descartan.
 */
export function useReporteGmle() {
  const [datos, setDatos] = useState<ReporteAgrupacionGmle | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const secuencia = useRef(0);

  const cargar = useCallback(() => {
    const numero = ++secuencia.current;
    return api
      .get<ReporteAgrupacionGmle>("/api/reportes/agrupacion-gmle")
      .then((d) => {
        if (numero !== secuencia.current) return;
        setDatos(d);
        setError(null);
      })
      .catch((e: unknown) => {
        if (numero !== secuencia.current) return;
        setError(e instanceof Error ? e.message : "Error al cargar el reporte");
      })
      .finally(() => {
        if (numero !== secuencia.current) return;
        setCargando(false);
      });
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const recargar = useCallback(() => {
    setCargando(true);
    return cargar();
  }, [cargar]);

  return { datos, cargando, error, setError, recargar };
}
