"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import type { ArbolRespuesta } from "./tipos-api";

/**
 * Carga `GET /api/arbol` (con o sin inactivos) y expone recarga y error.
 * Mismo patrón que `useColeccion`: el estado solo se toca dentro de las
 * promesas para no violar react-hooks/set-state-in-effect.
 */
export function useArbol(incluirInactivos: boolean) {
  const [arbol, setArbol] = useState<ArbolRespuesta | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(
    () =>
      api
        .get<ArbolRespuesta>(incluirInactivos ? "/api/arbol?incluir_inactivos=1" : "/api/arbol")
        .then((d) => {
          setArbol(d);
          setError(null);
        })
        .catch((e: unknown) => setError(e instanceof Error ? e.message : "Error al cargar el árbol"))
        .finally(() => setCargando(false)),
    [incluirInactivos]
  );

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const recargar = useCallback(() => {
    setCargando(true);
    return cargar();
  }, [cargar]);

  return { arbol, cargando, error, setError, recargar };
}

/** Nodos vigentes por id de género, mundo y línea; sirve para los conteos y los `confirm` de Catálogos. */
export function contarNodosVigentes(arbol: ArbolRespuesta | null) {
  const porGenero = new Map<string, number>();
  const porMundo = new Map<string, number>();
  const porLinea = new Map<string, number>();
  if (!arbol) return { porGenero, porMundo, porLinea };
  for (const g of arbol.generos) {
    for (const m of g.mundos) {
      for (const l of m.lineas) {
        if (!l.vigente) continue;
        porGenero.set(g.id, (porGenero.get(g.id) ?? 0) + 1);
        porMundo.set(m.id, (porMundo.get(m.id) ?? 0) + 1);
        porLinea.set(l.linea_id, (porLinea.get(l.linea_id) ?? 0) + 1);
      }
    }
  }
  return { porGenero, porMundo, porLinea };
}
