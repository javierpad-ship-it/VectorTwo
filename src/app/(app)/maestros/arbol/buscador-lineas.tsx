"use client";

import { useMemo } from "react";
import { Input } from "@/components/ui/form";
import { normalizarNombre } from "@/lib/arbol/normalizar";
import type { ArbolRespuesta, NivelPlanificacion } from "@/lib/arbol/tipos-api";
import { Button } from "@/components/ui/button";

type Coincidencia = {
  linea_id: string;
  nombre: string;
  nodos: {
    generoId: string;
    mundoId: string;
    nodoId: string;
    etiqueta: string;
    equivalencias: number;
    nivel: NivelPlanificacion;
  }[];
};

/** Índice línea → nodos sobre el árbol ya cargado. Sin llamadas a la API. */
function indexar(arbol: ArbolRespuesta | null): Coincidencia[] {
  if (!arbol) return [];
  const porLinea = new Map<string, Coincidencia>();
  for (const g of arbol.generos) {
    for (const m of g.mundos) {
      for (const l of m.lineas) {
        let c = porLinea.get(l.linea_id);
        if (!c) {
          c = { linea_id: l.linea_id, nombre: l.nombre, nodos: [] };
          porLinea.set(l.linea_id, c);
        }
        c.nodos.push({
          generoId: g.id,
          mundoId: m.id,
          nodoId: l.nodo_id,
          etiqueta: `${g.nombre} / ${m.nombre}`,
          equivalencias: l.equivalencias.length,
          nivel: l.nivel_planificacion,
        });
      }
    }
  }
  return [...porLinea.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

export function BuscadorLineas({
  arbol,
  valor,
  onCambiar,
  onElegir,
  puedeEditar = false,
  ocupadoNivel = false,
  onCambiarNivelLinea,
}: {
  arbol: ArbolRespuesta | null;
  valor: string;
  onCambiar: (v: string) => void;
  onElegir: (sel: { generoId: string; mundoId: string; nodoId: string }) => void;
  /** 02b: admin y planner ven el resumen de niveles de la línea y pueden cambiarlos todos de una vez. */
  puedeEditar?: boolean;
  ocupadoNivel?: boolean;
  /** 02b: cambia el nivel de todos los nodos de la línea (los ids vienen del árbol cargado). */
  onCambiarNivelLinea?: (nodoIds: string[], nivel: NivelPlanificacion) => Promise<void>;
}) {
  const indice = useMemo(() => indexar(arbol), [arbol]);
  const consulta = normalizarNombre(valor);
  const activo = consulta.length >= 2;
  const resultados = activo ? indice.filter((c) => c.nombre.includes(consulta)).slice(0, 30) : [];

  return (
    <div className="relative">
      <Input
        type="search"
        placeholder="Buscar línea en todo el árbol (mínimo 2 letras)…"
        value={valor}
        onChange={(e) => onCambiar(e.target.value)}
        aria-label="Buscar línea"
      />
      {activo && (
        <div className="absolute z-10 mt-1 max-h-80 w-full overflow-y-auto rounded-lg border border-borde bg-superficie p-2 shadow-lg">
          {resultados.length === 0 && (
            <p className="px-2 py-3 text-sm text-tinta-suave">Ninguna línea coincide con “{valor.trim()}”.</p>
          )}
          {resultados.map((c) => (
            <div key={c.linea_id} className="px-2 py-1.5">
              <div className="text-sm font-medium text-tinta">
                {c.nombre} <span className="font-normal text-tinta-suave">· en {c.nodos.length} nodo{c.nodos.length === 1 ? "" : "s"}</span>
              </div>
              {(() => {
                const abiertos = c.nodos.filter((n) => n.nivel === "GMLE").length;
                const cerrados = c.nodos.length - abiertos;
                return (
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-tinta-suave">
                    <span>
                      {c.nombre} está en {c.nodos.length} nodo{c.nodos.length === 1 ? "" : "s"}: {cerrados} GML · {abiertos} GMLE
                    </span>
                    {puedeEditar && onCambiarNivelLinea && (
                      <>
                        <Button
                          variante="secundario"
                          tamano="sm"
                          disabled={ocupadoNivel || cerrados === 0}
                          onClick={() => void onCambiarNivelLinea(c.nodos.map((n) => n.nodoId), "GMLE")}
                        >
                          Abrir todos a GMLE
                        </Button>
                        <Button
                          variante="secundario"
                          tamano="sm"
                          disabled={ocupadoNivel || abiertos === 0}
                          onClick={() => void onCambiarNivelLinea(c.nodos.map((n) => n.nodoId), "GML")}
                        >
                          Volver todos a GML
                        </Button>
                      </>
                    )}
                  </div>
                );
              })()}
              <div className="mt-1 flex flex-wrap gap-1">
                {c.nodos.map((n) => (
                  <button
                    key={n.nodoId}
                    type="button"
                    onClick={() => onElegir({ generoId: n.generoId, mundoId: n.mundoId, nodoId: n.nodoId })}
                    className="rounded-md border border-borde px-2 py-0.5 text-xs text-tinta-suave hover:border-marca hover:text-marca-oscura"
                  >
                    {n.etiqueta} <span className="opacity-70">({n.equivalencias} eq.{n.nivel === "GMLE" ? " · GMLE" : ""})</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
