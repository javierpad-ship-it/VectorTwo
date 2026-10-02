"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api-client";
import type { ArbolRespuesta } from "./tipos-api";

/**
 * Carga `GET /api/arbol` (con o sin inactivos) y expone recarga y error.
 * Mismo patrón que `useColeccion`: el estado solo se toca dentro de las
 * promesas para no violar react-hooks/set-state-in-effect.
 *
 * `cargando` es verdadero mientras hay una petición en vuelo, sea la inicial,
 * una recarga explícita o la que dispara el cambio de `incluirInactivos`: esta
 * última se deriva de que el parámetro pedido difiere del último respondido,
 * así no hace falta un `setState` síncrono en el efecto.
 */
export function useArbol(incluirInactivos: boolean) {
  const [arbol, setArbol] = useState<ArbolRespuesta | null>(null);
  const [recargando, setRecargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Parámetro con el que respondió la última petición terminada (`null` antes de la primera). */
  const [ultimoRespondido, setUltimoRespondido] = useState<boolean | null>(null);
  // Numera las peticiones para ignorar respuestas que llegan fuera de orden
  // (p. ej. al alternar el interruptor dos veces seguidas).
  const secuencia = useRef(0);

  const cargar = useCallback(() => {
    const numero = ++secuencia.current;
    return api
      .get<ArbolRespuesta>(incluirInactivos ? "/api/arbol?incluir_inactivos=1" : "/api/arbol")
      .then((d) => {
        if (numero !== secuencia.current) return;
        setArbol(d);
        setError(null);
      })
      .catch((e: unknown) => {
        if (numero !== secuencia.current) return;
        setError(e instanceof Error ? e.message : "Error al cargar el árbol");
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

  const cargando = recargando || ultimoRespondido !== incluirInactivos;

  return { arbol, cargando, error, setError, recargar };
}

/** Nodos vigentes por id de género, mundo y línea; sirve para los `confirm` de desactivar en Catálogos. */
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
