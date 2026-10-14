"use client";

import { useMemo, useState } from "react";
import type { FilaDetalleGmle, FilaResumenGmle } from "@/lib/reportes/filtros";
import type { NodoGmle } from "@/lib/reportes/tipos-api";
import type { MapaColores } from "@/lib/estacionalidad/colores";
import { formatearNumero, plural } from "@/lib/formato";
import { BadgeAgrupacion } from "@/components/estacionalidad/badge-agrupacion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Punto } from "@/components/ui/punto";
import { AnomaliaBadges } from "./comunes";

/**
 * Detalle de una agrupación del Resumen (patrón de `conjunto-detalle.tsx`: la
 * `DataTable` no expande filas, así que se abre debajo): sus nodos con ruta,
 * nivel, cuántas equivalencias son de esta agrupación y cuántas tiene el
 * nodo, badge Mixto y mayoritaria; al expandir un nodo, todas sus
 * equivalencias vigentes con la genérica marcada. Solo lectura.
 */
export function AgrupacionDetalle({
  fila,
  nodos,
  filasEstructura,
  detalle,
  nombresAgrupacion,
  colores,
  onVerEnDetalle,
  onCerrar,
}: {
  fila: FilaResumenGmle;
  nodos: NodoGmle[];
  /** Vigentes que pasan los filtros del Resumen: de ahí salen los nodos de esta agrupación. */
  filasEstructura: FilaDetalleGmle[];
  /** Todas las equivalencias (para listar completo un nodo expandido). */
  detalle: FilaDetalleGmle[];
  nombresAgrupacion: ReadonlyMap<string, string>;
  colores: MapaColores;
  onVerEnDetalle: (clave: string) => void;
  onCerrar: () => void;
}) {
  const [abiertos, setAbiertos] = useState<Set<string>>(() => new Set());

  // Equivalencias de esta agrupación por nodo, y las vigentes de cada nodo.
  const propias = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of filasEstructura) if (f.agrupacion_id === fila.id) m.set(f.nodo_id, (m.get(f.nodo_id) ?? 0) + 1);
    return m;
  }, [filasEstructura, fila.id]);

  const porNodo = useMemo(() => {
    const m = new Map<string, FilaDetalleGmle[]>();
    for (const f of detalle) {
      if (!f.activo || !f.vigente) continue;
      const lista = m.get(f.nodo_id);
      if (lista) lista.push(f);
      else m.set(f.nodo_id, [f]);
    }
    return m;
  }, [detalle]);

  const delaAgrupacion = useMemo(() => nodos.filter((n) => propias.has(n.id)), [nodos, propias]);

  function alternar(id: string) {
    setAbiertos((previo) => {
      const siguiente = new Set(previo);
      if (siguiente.has(id)) siguiente.delete(id);
      else siguiente.add(id);
      return siguiente;
    });
  }


  return (
    <Card
      titulo={fila.nombre}
      descripcion={`${plural(delaAgrupacion.length, "nodo", "nodos")} con ${plural(fila.equivalencias, "equivalencia", "equivalencias")} de esta agrupación`}
      acciones={
        <div className="flex gap-2">
          <Button variante="secundario" tamano="sm" onClick={() => onVerEnDetalle(fila.clave)}>
            Ver en Detalle
          </Button>
          <Button variante="fantasma" tamano="sm" onClick={onCerrar}>
            Cerrar
          </Button>
        </div>
      }
    >
      {delaAgrupacion.length === 0 ? (
        <EmptyState titulo="Sin nodos con estos filtros." detalle="Esta agrupación no tiene equivalencias vigentes que pasen los filtros." />
      ) : (
        <ul className="divide-y divide-borde rounded-lg border border-borde">
          {delaAgrupacion.map((n) => {
            const abierto = abiertos.has(n.id);
            const delNodo = porNodo.get(n.id) ?? [];
            const totalNodo = n.reparto.reduce((s, r) => s + r.equivalencias, 0);
            const mayoritaria = n.mayoritaria_id ? nombresAgrupacion.get(n.mayoritaria_id) : undefined;
            return (
              <li key={n.id}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                  <button
                    type="button"
                    aria-expanded={abierto}
                    onClick={() => alternar(n.id)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left font-medium text-tinta hover:text-marca-oscura"
                  >
                    <span aria-hidden className="w-3 text-tinta-suave">
                      {abierto ? "▾" : "▸"}
                    </span>
                    <span className="truncate">{n.ruta}</span>
                  </button>
                  <Badge tono={n.nivel === "GMLE" ? "marca" : "neutro"}>{n.nivel}</Badge>
                  {n.agrupacion_nodo === "mixta" && (
                    <span title="El nodo es GML y tiene equivalencias en dos o más agrupaciones: M7 lo leerá con una curva mezclada.">
                      <Badge tono="alerta">Mixto</Badge>
                    </span>
                  )}
                  <span className="font-mono text-xs text-tinta-suave" title="Equivalencias de esta agrupación / equivalencias vigentes del nodo">
                    {formatearNumero(propias.get(n.id) ?? 0)} / {formatearNumero(totalNodo)}
                  </span>
                  {(n.agrupacion_nodo === "mixta" || mayoritaria) && (
                    <span className="text-xs text-tinta-suave">
                      Mayoritaria: <strong className="font-medium text-tinta">{mayoritaria ?? "empate"}</strong>
                    </span>
                  )}
                </div>
                {abierto && (
                  <ul className="space-y-1 border-t border-borde bg-fondo/60 px-3 py-2 pl-8 text-sm">
                    {delNodo.map((e) => (
                      <li key={e.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <Punto color={e.agrupacion_id ? colores.get(e.agrupacion_id)?.pleno : null} tono={e.agrupacion_id ? "gris" : "alerta"} />
                        <span className={e.agrupacion_id === fila.id ? "font-medium text-tinta" : "text-tinta-suave"}>{e.equivalencia}</span>
                        {e.es_generica && <Badge tono="neutro">Genérica</Badge>}
                        <BadgeAgrupacion
                          agrupacion={e.agrupacion_id ? { id: e.agrupacion_id, nombre: e.agrupacion, activo: e.agrupacion_activa } : null}
                          colores={colores}
                        />
                        {e.anomalias.length > 0 && <AnomaliaBadges codigos={e.anomalias} />}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
