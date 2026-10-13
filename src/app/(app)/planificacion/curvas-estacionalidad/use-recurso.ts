"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api-client";
import { mensajeError } from "@/lib/formato";

/**
 * Carga un `GET /api/...` cuya respuesta no es una colección (un objeto, o una
 * lista que se normaliza después). El estado se toca únicamente dentro de
 * promesas (react-hooks/set-state-in-effect) y las respuestas fuera de orden
 * se descartan; mismo patrón que `useCargas` de M5.
 */
export function useRecurso<T>(url: string) {
  const [datos, setDatos] = useState<T | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const secuencia = useRef(0);

  const pedir = useCallback(() => {
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
        setError(mensajeError(e));
      })
      .finally(() => {
        if (numero !== secuencia.current) return;
        setCargando(false);
      });
  }, [url]);

  useEffect(() => {
    void pedir();
  }, [pedir]);

  const recargar = useCallback(() => {
    setCargando(true);
    return pedir();
  }, [pedir]);

  return { datos, cargando, error, setError, recargar };
}
