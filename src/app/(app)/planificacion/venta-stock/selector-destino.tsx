"use client";

import { useId, useMemo, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { formatearNumero } from "@/lib/formato";
import { coincideNodo, equivalenciaPorDefecto, useContextoMapeosObligatorio, type NodoDestino } from "./contexto-mapeos";

const MAX_VISIBLES = 40;

/** Texto `G / M / L / E` del destino elegido (para confirmaciones). */
export function textoDestino(nodo: NodoDestino, equivalencia: string): string {
  return `${nodo.texto} / ${equivalencia}`;
}

/**
 * Selector de destino de un mapeo: primero el GML (texto libre sobre
 * `GÉNERO / MUNDO / LÍNEA`, solo nodos vigentes) y después la equivalencia del
 * nodo. Al elegir un GML se preselecciona la equivalencia que se llama como la
 * línea (`-`) o, si no existe, la genérica. Controlado por `equivalenciaId`
 * (`""` = nada elegido); una sugerencia puede fijarlo desde fuera.
 */
export function SelectorDestino({
  equivalenciaId,
  onCambiar,
  disabled = false,
}: {
  equivalenciaId: string;
  onCambiar: (equivalenciaId: string) => void;
  disabled?: boolean;
}) {
  const ctx = useContextoMapeosObligatorio();
  const [consulta, setConsulta] = useState("");
  const [nodoLocal, setNodoLocal] = useState<string>("");
  const idLista = useId();

  const elegido = ctx.porEquivalencia.get(equivalenciaId);
  const nodoId = elegido?.nodo.nodoId ?? nodoLocal;
  const nodo = ctx.destinos.find((n) => n.nodoId === nodoId) ?? null;

  const { visibles, total } = useMemo(() => {
    const todos = consulta.trim() === "" ? ctx.destinos : ctx.destinos.filter((n) => coincideNodo(n, consulta));
    return { visibles: todos.slice(0, MAX_VISIBLES), total: todos.length };
  }, [ctx.destinos, consulta]);
  // El nodo elegido siempre se ve, aunque la búsqueda no lo incluya.
  const lista = nodo && !visibles.some((n) => n.nodoId === nodo.nodoId) ? [nodo, ...visibles] : visibles;

  function elegirNodo(n: NodoDestino) {
    setNodoLocal(n.nodoId);
    onCambiar(equivalenciaPorDefecto(n)?.id ?? "");
  }

  if (ctx.cargando) return <p className="text-sm text-tinta-suave">Cargando el árbol de producto…</p>;
  if (ctx.error) {
    return (
      <Alert>
        <span className="flex flex-wrap items-center gap-3">
          <span>No se pudo leer el árbol de producto: {ctx.error}</span>
          <Button tamano="sm" variante="secundario" onClick={ctx.recargar}>
            Reintentar
          </Button>
        </span>
      </Alert>
    );
  }
  if (ctx.destinos.length === 0) return <Alert tono="info">El árbol no tiene ningún nodo vigente con equivalencias: no hay destino posible.</Alert>;

  return (
    <div className="space-y-3">
      <Field label="Buscar el GML de destino" hint="Escribe parte del género, el mundo o la línea (sin tildes está bien). Solo salen nodos vigentes.">
        <Input
          type="search"
          value={consulta}
          onChange={(e) => setConsulta(e.target.value)}
          placeholder="Ej.: hombre urbano denim"
          disabled={disabled}
          aria-controls={idLista}
        />
      </Field>

      <ul id={idLista} aria-label="Nodos género, mundo y línea" className="max-h-48 divide-y divide-borde overflow-y-auto rounded-md border border-borde">
        {lista.length === 0 && <li className="px-3 py-3 text-sm text-tinta-suave">Ningún nodo coincide con la búsqueda.</li>}
        {lista.map((n) => {
          const activo = n.nodoId === nodoId;
          return (
            <li key={n.nodoId}>
              <button
                type="button"
                aria-pressed={activo}
                disabled={disabled}
                onClick={() => elegirNodo(n)}
                className={`flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-sm focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-marca ${
                  activo ? "bg-marca-suave font-medium text-marca-oscura" : "hover:bg-neutro-suave"
                }`}
              >
                <span className="break-words">{n.texto}</span>
                <span className="shrink-0 text-xs text-tinta-suave">{n.equivalencias.length === 1 ? "1 equivalencia" : `${n.equivalencias.length} equivalencias`}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {total > MAX_VISIBLES && (
        <p className="text-xs text-tinta-suave">
          Se muestran {MAX_VISIBLES} de {formatearNumero(total)} nodos: afina la búsqueda para ver los demás.
        </p>
      )}

      {nodo && (
        <Field label="Equivalencia del destino" hint="GML: la equivalencia que se llama como la línea (o la genérica). GMLE: una equivalencia propia de la línea.">
          <Select value={equivalenciaId} onChange={(e) => onCambiar(e.target.value)} disabled={disabled}>
            {nodo.equivalencias.map((e) => (
              <option key={e.id} value={e.id}>
                {e.esGml ? "GML" : "GMLE"} · {e.nombre}
              </option>
            ))}
          </Select>
        </Field>
      )}

      {nodo && elegido && (
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-tinta-suave">Destino:</span>
          <strong className="break-words">{textoDestino(nodo, elegido.eq.nombre)}</strong>
          <Badge tono={elegido.eq.esGml ? "marca" : "neutro"}>{elegido.eq.esGml ? "GML" : "GMLE"}</Badge>
        </p>
      )}
    </div>
  );
}
