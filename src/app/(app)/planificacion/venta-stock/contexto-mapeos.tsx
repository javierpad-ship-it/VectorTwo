"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { aCodigo, normalizarNombre } from "@/lib/arbol/normalizar";
import { useArbol } from "@/lib/arbol/use-arbol";
import type { ArbolRespuesta } from "@/lib/arbol/tipos-api";

/** Una equivalencia elegible como destino. */
export type EquivalenciaDestino = {
  id: string;
  nombre: string;
  esGenerica: boolean;
  /** "GML": la equivalencia que se llama como la línea (`-`) o la genérica; el resto es "GMLE". */
  esGml: boolean;
};

/** Un nodo género / mundo / línea vigente con sus equivalencias activas. */
export type NodoDestino = {
  nodoId: string;
  genero: string;
  mundo: string;
  linea: string;
  /** `GÉNERO / MUNDO / LÍNEA`. */
  texto: string;
  /** `aCodigo(texto)`, para buscar sin tildes ni signos. */
  codigo: string;
  equivalencias: EquivalenciaDestino[];
};

/** Todos los nodos vigentes del árbol con equivalencias activas, ordenados por nombre. */
export function listarDestinos(arbol: ArbolRespuesta | null): NodoDestino[] {
  if (!arbol) return [];
  const nodos: NodoDestino[] = [];
  for (const g of arbol.generos) {
    for (const m of g.mundos) {
      for (const l of m.lineas) {
        if (!l.vigente) continue;
        const nombreLinea = normalizarNombre(l.nombre);
        const equivalencias = l.equivalencias
          .filter((e) => e.activo)
          .map((e): EquivalenciaDestino => ({
            id: e.id,
            nombre: e.nombre,
            esGenerica: e.es_generica,
            esGml: e.es_generica || normalizarNombre(e.nombre) === nombreLinea,
          }))
          .sort((a, b) => Number(b.esGml) - Number(a.esGml) || a.nombre.localeCompare(b.nombre, "es"));
        if (equivalencias.length === 0) continue;
        const texto = `${g.nombre} / ${m.nombre} / ${l.nombre}`;
        nodos.push({ nodoId: l.nodo_id, genero: g.nombre, mundo: m.nombre, linea: l.nombre, texto, codigo: aCodigo(texto), equivalencias });
      }
    }
  }
  return nodos.sort((a, b) => a.texto.localeCompare(b.texto, "es"));
}

/** Equivalencia por defecto de un nodo: la que se llama como la línea y, si no existe, la genérica. */
export function equivalenciaPorDefecto(n: NodoDestino): EquivalenciaDestino | null {
  const comoLinea = n.equivalencias.find((e) => e.esGml && !e.esGenerica);
  return comoLinea ?? n.equivalencias.find((e) => e.esGenerica) ?? n.equivalencias[0] ?? null;
}

/** Cada palabra de la consulta (sin tildes ni signos) debe estar en el texto del nodo. */
export function coincideNodo(n: NodoDestino, consulta: string): boolean {
  const palabras = consulta.split(/\s+/).map(aCodigo).filter(Boolean);
  return palabras.every((p) => n.codigo.includes(p));
}

type ContextoMapeos = {
  cargando: boolean;
  error: string | null;
  recargar: () => void;
  destinos: NodoDestino[];
  /** Equivalencia → su nodo y ella misma. */
  porEquivalencia: Map<string, { nodo: NodoDestino; eq: EquivalenciaDestino }>;
  /** Lleva a la pestaña Mapeos. */
  irAMapeos: () => void;
};

const Contexto = createContext<ContextoMapeos | null>(null);

/**
 * Carga el árbol una sola vez por pantalla (`GET /api/arbol`) y lo reparte a
 * los selectores de destino del modal de asignación y de la pestaña Mapeos,
 * junto con el salto a la pestaña Mapeos (enlace del aviso `mapeos_no_aplicables`).
 */
export function ProveedorMapeos({ irAMapeos, children }: { irAMapeos: () => void; children: ReactNode }) {
  const { arbol, cargando, error, recargar } = useArbol(false);
  const destinos = useMemo(() => listarDestinos(arbol), [arbol]);
  const porEquivalencia = useMemo(() => {
    const m = new Map<string, { nodo: NodoDestino; eq: EquivalenciaDestino }>();
    for (const nodo of destinos) for (const eq of nodo.equivalencias) m.set(eq.id, { nodo, eq });
    return m;
  }, [destinos]);
  const valor = useMemo(
    () => ({ cargando, error, recargar: () => void recargar(), destinos, porEquivalencia, irAMapeos }),
    [cargando, error, recargar, destinos, porEquivalencia, irAMapeos]
  );
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

/** Contexto de mapeos; `null` fuera del proveedor (los componentes que lo usan de forma opcional lo toleran). */
export function useContextoMapeos(): ContextoMapeos | null {
  return useContext(Contexto);
}

/** Igual, pero exige el proveedor (selectores de destino). */
export function useContextoMapeosObligatorio(): ContextoMapeos {
  const c = useContext(Contexto);
  if (!c) throw new Error("Falta el ProveedorMapeos.");
  return c;
}
