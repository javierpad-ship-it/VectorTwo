"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { mensajeError } from "@/lib/formato";
import type { MapeosRespuesta } from "@/lib/ventas/tipos-mapeo";
import { apiMapeos } from "./api-mapeos";

/**
 * Carga `GET /api/ventas/mapeos` (la respuesta es un objeto con el resumen por
 * estado, no una colección: no sirve `useColeccion`). La búsqueda y el filtro
 * por estado se hacen en memoria sobre esta respuesta. El estado solo se toca
 * dentro de promesas (react-hooks/set-state-in-effect) y las respuestas fuera
 * de orden se descartan.
 */
export function useMapeos() {
  const [datos, setDatos] = useState<MapeosRespuesta | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const secuencia = useRef(0);

  const pedir = useCallback(() => {
    const numero = ++secuencia.current;
    return apiMapeos
      .listar()
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
  }, []);

  useEffect(() => {
    void pedir();
  }, [pedir]);

  const recargar = useCallback(() => {
    setCargando(true);
    return pedir();
  }, [pedir]);

  return { datos, cargando, error, setError, recargar };
}
