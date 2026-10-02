"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "./api-client";

/** Carga una colección desde /api y expone recarga y error. */
export function useColeccion<T>(url: string) {
  const [datos, setDatos] = useState<T[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Solo toca el estado dentro de las promesas: así el efecto inicial no
  // llama a setState de forma síncrona (regla react-hooks/set-state-in-effect).
  const cargar = useCallback(
    () =>
      api
        .get<T[]>(url)
        .then((d) => {
          setDatos(d);
          setError(null);
        })
        .catch((e: unknown) => setError(e instanceof Error ? e.message : "Error al cargar"))
        .finally(() => setCargando(false)),
    [url]
  );

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const recargar = useCallback(() => {
    setCargando(true);
    return cargar();
  }, [cargar]);

  return { datos, cargando, error, setError, recargar };
}
