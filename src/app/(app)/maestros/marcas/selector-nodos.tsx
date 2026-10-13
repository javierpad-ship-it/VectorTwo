"use client";

import { useMemo, useState } from "react";
import { normalizarNombre } from "@/lib/arbol/normalizar";
import { formatearNumero } from "@/lib/formato";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Chips, type ChipItem } from "@/components/ui/chips";
import { DataTable, type Columna } from "@/components/ui/data-table";
import { Input } from "@/components/ui/form";
import type { NodoPlano } from "@/components/marcas/comunes-m2b";

const MAX_FILAS = 200;
const TODOS = "todos";

/** Filtros de género · mundo · línea compartidos por el selector de nodos y la vista Por GML. */
export type FiltroNodos = { generoId: string; mundoId: string; texto: string };
export const FILTRO_NODOS_VACIO: FiltroNodos = { generoId: TODOS, mundoId: TODOS, texto: "" };

export function filtrarNodos(nodos: readonly NodoPlano[], f: FiltroNodos): NodoPlano[] {
  const consulta = normalizarNombre(f.texto);
  return nodos.filter(
    (n) =>
      (f.generoId === TODOS || n.generoId === f.generoId) &&
      (f.mundoId === TODOS || n.mundoId === f.mundoId) &&
      (consulta === "" || n.linea.includes(consulta))
  );
}

/** Chips de género y mundo con conteo, más el buscador de línea. Controlado desde fuera. */
export function BarraFiltroNodos({
  nodos,
  filtro,
  onCambiar,
}: {
  nodos: readonly NodoPlano[];
  filtro: FiltroNodos;
  onCambiar: (f: FiltroNodos) => void;
}) {
  const generos = useMemo(() => {
    const m = new Map<string, { nombre: string; n: number }>();
    for (const n of nodos) m.set(n.generoId, { nombre: n.genero, n: (m.get(n.generoId)?.n ?? 0) + 1 });
    return [...m.entries()];
  }, [nodos]);
  const mundos = useMemo(() => {
    const m = new Map<string, { nombre: string; n: number }>();
    for (const n of nodos) {
      if (filtro.generoId !== TODOS && n.generoId !== filtro.generoId) continue;
      m.set(n.mundoId, { nombre: n.mundo, n: (m.get(n.mundoId)?.n ?? 0) + 1 });
    }
    return [...m.entries()];
  }, [nodos, filtro.generoId]);

  const chipsGenero: ChipItem<string>[] = [
    { id: TODOS, label: "Todos los géneros" },
    ...generos.map(([id, g]): ChipItem<string> => ({ id, label: g.nombre, conteo: g.n })),
  ];
  const chipsMundo: ChipItem<string>[] = [
    { id: TODOS, label: "Todos los mundos" },
    ...mundos.map(([id, g]): ChipItem<string> => ({ id, label: g.nombre, conteo: g.n })),
  ];
  // Si el mundo filtrado ya no existe con el género elegido, se lee como "todos" sin efectos.
  const mundoVigente = filtro.mundoId === TODOS || mundos.some(([id]) => id === filtro.mundoId) ? filtro.mundoId : TODOS;

  return (
    <div className="space-y-2">
      <Chips items={chipsGenero} activo={filtro.generoId} onCambiar={(id) => onCambiar({ ...filtro, generoId: id, mundoId: TODOS })} etiqueta="Filtrar por género" />
      <Chips items={chipsMundo} activo={mundoVigente} onCambiar={(id) => onCambiar({ ...filtro, mundoId: id })} etiqueta="Filtrar por mundo" />
      <Input
        type="search"
        placeholder="Buscar línea…"
        value={filtro.texto}
        onChange={(e) => onCambiar({ ...filtro, texto: e.target.value })}
        className="h-8 max-w-xs"
        aria-label="Buscar línea"
      />
    </div>
  );
}

/**
 * Elegir nodos género-mundo-línea para asignarles marcas: filtros, atajos
 * "todos los nodos de la línea X" y "todos los de GÉNERO × MUNDO", y una
 * tabla con casilla por nodo (los que ya son relevantes para todas las marcas
 * objetivo salen atenuados). La selección es del padre; los filtros, de acá.
 */
export function SelectorNodos({
  nodos,
  yaRelevante,
  seleccion,
  onSeleccion,
}: {
  /** Nodos vigentes entre los que se elige. */
  nodos: NodoPlano[];
  /** `true` si el nodo ya es relevante para todas las marcas objetivo. */
  yaRelevante: (nodoId: string) => boolean;
  seleccion: Set<string>;
  onSeleccion: (s: Set<string>) => void;
}) {
  const [filtro, setFiltro] = useState<FiltroNodos>(FILTRO_NODOS_VACIO);
  const filtrados = useMemo(() => filtrarNodos(nodos, filtro), [nodos, filtro]);
  const visibles = filtrados.slice(0, MAX_FILAS);
  const elegiblesFiltrados = filtrados.filter((n) => !yaRelevante(n.id));
  const seleccionadosFiltrados = elegiblesFiltrados.filter((n) => seleccion.has(n.id)).length;

  // Atajos por línea: hasta tres líneas distintas que coinciden con el texto.
  const lineasCoinciden = useMemo(() => {
    if (normalizarNombre(filtro.texto).length < 2) return [];
    const porLinea = new Map<string, { nombre: string; ids: string[] }>();
    for (const n of nodos) {
      if (!normalizarNombre(n.linea).includes(normalizarNombre(filtro.texto))) continue;
      const e = porLinea.get(n.lineaId) ?? { nombre: n.linea, ids: [] };
      e.ids.push(n.id);
      porLinea.set(n.lineaId, e);
    }
    return [...porLinea.values()].slice(0, 3);
  }, [nodos, filtro.texto]);

  const generoElegido = nodos.find((n) => n.generoId === filtro.generoId);
  const mundoElegido = nodos.find((n) => n.mundoId === filtro.mundoId);
  const idsGeneroMundo =
    filtro.generoId !== TODOS && filtro.mundoId !== TODOS ? nodos.filter((n) => n.generoId === filtro.generoId && n.mundoId === filtro.mundoId).map((n) => n.id) : [];

  function agregar(ids: string[]) {
    const s = new Set(seleccion);
    for (const id of ids) if (!yaRelevante(id)) s.add(id);
    onSeleccion(s);
  }

  const columnas: Columna<NodoPlano>[] = [
    {
      clave: "sel",
      titulo: "",
      render: (n) => (
        <Checkbox
          checked={seleccion.has(n.id)}
          disabled={yaRelevante(n.id)}
          onChange={(v) => {
            const s = new Set(seleccion);
            if (v) s.add(n.id);
            else s.delete(n.id);
            onSeleccion(s);
          }}
          label={`Elegir ${n.genero} ${n.mundo} ${n.linea}`}
        />
      ),
    },
    { clave: "genero", titulo: "Género", render: (n) => n.genero },
    { clave: "mundo", titulo: "Mundo", render: (n) => n.mundo },
    { clave: "linea", titulo: "Línea", render: (n) => <span className="font-medium">{n.linea}</span> },
    {
      clave: "nivel",
      titulo: "Nivel",
      render: (n) => (n.nivel === "GMLE" ? <Badge tono="marca">GMLE</Badge> : <span className="text-tinta-suave">GML</span>),
    },
    {
      clave: "estado",
      titulo: "",
      render: (n) => (yaRelevante(n.id) ? <Badge tono="neutro">Ya relevante</Badge> : null),
    },
  ];

  return (
    <div className="space-y-3">
      <BarraFiltroNodos nodos={nodos} filtro={filtro} onCambiar={setFiltro} />

      <div className="flex flex-wrap items-center gap-2">
        {lineasCoinciden.map((l) => (
          <Button key={l.nombre} variante="secundario" tamano="sm" onClick={() => agregar(l.ids)}>
            Todos los nodos de la línea {l.nombre} ({l.ids.length})
          </Button>
        ))}
        {idsGeneroMundo.length > 0 && (
          <Button variante="secundario" tamano="sm" onClick={() => agregar(idsGeneroMundo)}>
            Todos los de {generoElegido?.genero} × {mundoElegido?.mundo} ({idsGeneroMundo.length})
          </Button>
        )}
        <Button
          variante="fantasma"
          tamano="sm"
          disabled={elegiblesFiltrados.length === 0 || seleccionadosFiltrados === elegiblesFiltrados.length}
          onClick={() => agregar(elegiblesFiltrados.map((n) => n.id))}
        >
          Elegir los {formatearNumero(elegiblesFiltrados.length)} filtrados
        </Button>
        <Button variante="fantasma" tamano="sm" disabled={seleccion.size === 0} onClick={() => onSeleccion(new Set())}>
          Limpiar ({formatearNumero(seleccion.size)})
        </Button>
      </div>

      <DataTable columnas={columnas} filas={visibles} claveFila={(n) => n.id} vacio="Ningún GML coincide con el filtro." claseFila={(n) => (yaRelevante(n.id) ? "opacity-60" : undefined)} />
      {filtrados.length > visibles.length && (
        <p className="text-xs text-tinta-suave">
          Mostrando {visibles.length} de {formatearNumero(filtrados.length)}: afina los filtros o usa los atajos de arriba.
        </p>
      )}
    </div>
  );
}
