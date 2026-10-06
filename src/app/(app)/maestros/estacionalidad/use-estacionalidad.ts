"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api-client";
import type { EquivalenciasEstacionalidadRespuesta } from "@/lib/estacionalidad/tipos-api";

/**
 * Carga `GET /api/estacionalidad/equivalencias` (con o sin inactivas) y
 * expone recarga y error. Mismo patrón que `useArbol`: el estado solo se toca
 * dentro de las promesas (react-hooks/set-state-in-effect) y las respuestas
 * fuera de orden se descartan.
 */
export function useEstacionalidad(incluirInactivas: boolean) {
  const [datos, setDatos] = useState<EquivalenciasEstacionalidadRespuesta | null>(null);
  const [recargando, setRecargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ultimoRespondido, setUltimoRespondido] = useState<boolean | null>(null);
  const secuencia = useRef(0);

  const cargar = useCallback(() => {
    const numero = ++secuencia.current;
    return api
      .get<EquivalenciasEstacionalidadRespuesta>(
        incluirInactivas ? "/api/estacionalidad/equivalencias?incluir_inactivos=1" : "/api/estacionalidad/equivalencias"
      )
      .then((d) => {
        if (numero !== secuencia.current) return;
        setDatos(d);
        setError(null);
      })
      .catch((e: unknown) => {
        if (numero !== secuencia.current) return;
        setError(e instanceof Error ? e.message : "Error al cargar las equivalencias");
      })
      .finally(() => {
        if (numero !== secuencia.current) return;
        setUltimoRespondido(incluirInactivas);
        setRecargando(false);
      });
  }, [incluirInactivas]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const recargar = useCallback(() => {
    setRecargando(true);
    return cargar();
  }, [cargar]);

  const cargando = recargando || ultimoRespondido !== incluirInactivas;

  return { datos, cargando, error, setError, recargar };
}
