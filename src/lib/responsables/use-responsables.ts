"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api-client";
import { claveCelda } from "./pantalla";
import type { CeldaResponsable, MatrizResponsables } from "./tipos-api";

/**
 * Carga `GET /api/responsables` (con o sin inactivos) y expone recarga, error
 * y `aplicarCelda` (parchea una celda con la respuesta de un `PUT` sin
 * esperar a la recarga). `useColeccion` no sirve aquí: esta lectura devuelve
 * un objeto, no un arreglo. Mismo patrón que `useArbol`: el estado solo se
 * toca dentro de las promesas (react-hooks/set-state-in-effect) y las
 * respuestas que llegan fuera de orden se descartan.
 *
 * `cargando` es verdadero mientras hay una petición en vuelo: la inicial, una
 * recarga explícita o la que dispara el cambio de `incluirInactivos` (se
 * deriva de que el parámetro pedido difiere del último respondido).
 */
export function useResponsables(incluirInactivos: boolean) {
  const [datos, setDatos] = useState<MatrizResponsables | null>(null);
  const [recargando, setRecargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ultimoRespondido, setUltimoRespondido] = useState<boolean | null>(null);
  const secuencia = useRef(0);

  const cargar = useCallback(() => {
    const numero = ++secuencia.current;
    return api
      .get<MatrizResponsables>(incluirInactivos ? "/api/responsables?incluir_inactivos=1" : "/api/responsables")
      .then((d) => {
        if (numero !== secuencia.current) return;
        setDatos(d);
        setError(null);
      })
      .catch((e: unknown) => {
        if (numero !== secuencia.current) return;
        setError(e instanceof Error ? e.message : "Error al cargar los responsables");
      })
      .finally(() => {
        if (numero !== secuencia.current) return;
        setUltimoRespondido(incluirInactivos);
        setRecargando(false);
      });
  }, [incluirInactivos]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const recargar = useCallback(() => {
    setRecargando(true);
    return cargar();
  }, [cargar]);

  const aplicarCelda = useCallback((celda: CeldaResponsable) => {
    const k = claveCelda(celda.genero_id, celda.mundo_id);
    setDatos((prev) =>
      prev ? { ...prev, celdas: prev.celdas.map((c) => (claveCelda(c.genero_id, c.mundo_id) === k ? celda : c)) } : prev
    );
  }, []);

  const cargando = recargando || ultimoRespondido !== incluirInactivos;

  return { datos, cargando, error, setError, recargar, aplicarCelda };
}
