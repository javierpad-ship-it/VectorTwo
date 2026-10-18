"use client";

import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { ChipsMultiples } from "@/components/ui/chips-multiples";
import { Field, Select } from "@/components/ui/form";
import {
  aplicarGenero,
  aplicarMundos,
  ETIQUETA_SOLO,
  filtrosEfectivos,
  hayFiltrosActivos,
  MESES_ADELANTE,
  MESES_ATRAS,
  ORDEN_SOLO,
  opcionesMes,
  TODOS,
  type NodoIntercompany,
  type ParametrosVista,
  type SoloReglas,
} from "./vista";

/**
 * Filtros de las dos pestañas (ficha 13, sección 4): mes, marca, género, mundo, línea y "solo". Viven en la URL. Mientras el
 * planner no elija género ni mundo rige el ámbito sugerido (hombre formal, casual y RI); es un filtro, no una restricción.
 */
export function BarraFiltros({
  parametros,
  mes,
  hoy,
  nodos,
  marcas,
  mesesConReglas,
  onCambiar,
}: {
  parametros: ParametrosVista;
  /** El mes efectivo (el de la URL o el mes en curso). */
  mes: string;
  hoy: string;
  nodos: readonly NodoIntercompany[];
  /** Las marcas que tienen alguna regla. */
  marcas: readonly { id: string; nombre: string }[];
  mesesConReglas: readonly string[];
  onCambiar: (cambios: Partial<ParametrosVista>) => void;
}) {
  const efectivos = useMemo(() => filtrosEfectivos(parametros, nodos), [parametros, nodos]);
  const generos = useMemo(() => [...new Map(nodos.map((n) => [n.generoId, n.genero])).entries()].map(([id, nombre]) => ({ id, nombre })), [nodos]);
  const mundos = useMemo(() => {
    const visibles = efectivos.generoId ? nodos.filter((n) => n.generoId === efectivos.generoId) : nodos;
    return [...new Map(visibles.map((n) => [n.mundoId, n.mundo])).entries()].map(([id, nombre]) => ({ id, nombre }));
  }, [nodos, efectivos.generoId]);
  const lineas = useMemo(() => {
    const visibles = nodos.filter((n) => (!efectivos.generoId || n.generoId === efectivos.generoId) && (!efectivos.mundoIds || efectivos.mundoIds.includes(n.mundoId)));
    return [...new Map(visibles.map((n) => [n.lineaId, n.linea])).entries()].map(([id, nombre]) => ({ id, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  }, [nodos, efectivos.generoId, efectivos.mundoIds]);
  const meses = useMemo(() => opcionesMes(hoy, MESES_ATRAS, MESES_ADELANTE, [mes, ...mesesConReglas]), [hoy, mes, mesesConReglas]);

  const mundosMarcados = efectivos.mundoIds ?? [];
  const alternarSolo = (ids: string[]) => onCambiar({ solo: ORDEN_SOLO.filter((s) => ids.includes(s)) as SoloReglas[] });

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Reglas vigentes en">
          <Select value={mes} onChange={(e) => onCambiar({ mes: e.target.value === hoy ? null : e.target.value })}>
            {meses.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nombre}
                {m.id === hoy ? " (mes en curso)" : ""}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Marca">
          <Select value={parametros.marca ?? ""} onChange={(e) => onCambiar({ marca: e.target.value === "" ? null : e.target.value })}>
            <option value="">Todas</option>
            {marcas.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nombre}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Género">
          <Select value={efectivos.generoId ?? TODOS} onChange={(e) => {
              // Elegir el género del ámbito sugerido deja también sus mundos; cualquier otra elección quita el ámbito entero.
              const genero = aplicarGenero(e.target.value, nodos);
              onCambiar({ genero, mundo: genero.tipo === "defecto" ? { tipo: "defecto" } : { tipo: "todos" }, linea: null });
            }}>
            <option value={TODOS}>Todos</option>
            {generos.map((g) => (
              <option key={g.id} value={g.id}>
                {g.nombre}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Línea">
          <Select value={parametros.linea ?? ""} onChange={(e) => onCambiar({ linea: e.target.value === "" ? null : e.target.value })}>
            <option value="">Todas</option>
            {lineas.map((l) => (
              <option key={l.id} value={l.id}>
                {l.nombre}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
        <div>
          <p className="mb-1 text-sm font-medium text-tinta">Mundo</p>
          <ChipsMultiples
            etiqueta="Filtrar por mundo"
            items={mundos.map((m) => ({ id: m.id, label: m.nombre }))}
            valor={mundosMarcados}
            onCambiar={(ids) => onCambiar({ mundo: aplicarMundos(ids, nodos) })}
          />
        </div>
        <div>
          <p className="mb-1 text-sm font-medium text-tinta">Solo</p>
          <ChipsMultiples etiqueta="Mostrar solo" items={ORDEN_SOLO.map((s) => ({ id: s, label: ETIQUETA_SOLO[s] }))} valor={parametros.solo} onCambiar={alternarSolo} />
        </div>
        {hayFiltrosActivos(parametros) && (
          <Button variante="fantasma" tamano="sm" className="self-end" onClick={() => onCambiar({ marca: null, genero: { tipo: "defecto" }, mundo: { tipo: "defecto" }, linea: null, solo: [] })}>
            Quitar filtros
          </Button>
        )}
      </div>
      <p className="text-xs text-tinta-suave">
        Sin elegir género ni mundo se muestra el ámbito sugerido (hombre formal, casual y RI); es un filtro, no una restricción: elige «Todos» en Género para ver el resto (sin ningún mundo marcado se ven todos).
      </p>
    </div>
  );
}
