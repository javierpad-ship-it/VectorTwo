"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api-client";
import type { CargasRespuesta } from "@/lib/ventas/tipos-api";

/**
 * Carga `GET /api/ventas/cargas` (la respuesta es un objeto, no una colección,
 * así que no sirve `useColeccion`). `verificar` pide además el recálculo en SQL
 * de los totales de cada mes (1 a 3 s): solo se activa a pedido.
 * El estado se toca únicamente dentro de promesas (react-hooks/set-state-in-effect)
 * y las respuestas fuera de orden se descartan.
 */
export function useCargas() {
  const [datos, setDatos] = useState<CargasRespuesta | null>(null);
  const [cargando, setCargando] = useState(true);
  const [verificando, setVerificando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const secuencia = useRef(0);

  const pedir = useCallback((verificar: boolean) => {
    const numero = ++secuencia.current;
    return api
      .get<CargasRespuesta>(verificar ? "/api/ventas/cargas?verificar=1" : "/api/ventas/cargas")
      .then((d) => {
        if (numero !== secuencia.current) return;
        setDatos(d);
        setError(null);
      })
      .catch((e: unknown) => {
        if (numero !== secuencia.current) return;
        setError(e instanceof Error ? e.message : "No se pudieron cargar las cargas");
      })
      .finally(() => {
        if (numero !== secuencia.current) return;
        setCargando(false);
        setVerificando(false);
      });
  }, []);

  useEffect(() => {
    void pedir(false);
  }, [pedir]);

  const recargar = useCallback(() => {
    setCargando(true);
    return pedir(false);
  }, [pedir]);

  const verificar = useCallback(() => {
    setVerificando(true);
    return pedir(true);
  }, [pedir]);

  return { datos, cargando, verificando, error, setError, recargar, verificar };
}
