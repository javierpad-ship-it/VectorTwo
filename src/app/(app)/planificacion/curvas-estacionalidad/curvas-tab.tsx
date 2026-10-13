"use client";

import { useMemo, useState } from "react";
import { api } from "@/lib/api-client";
import { compararPorNombre } from "@/lib/estacionalidad/generos";
import { formatearNumero, mensajeError, plural } from "@/lib/formato";
import { normalizarNombre } from "@/lib/arbol/normalizar";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chips, type ChipItem } from "@/components/ui/chips";
import { DataTable, type Columna } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Select } from "@/components/ui/form";
import { BadgeAgrupacion, useMapaColores } from "@/components/estacionalidad/badge-agrupacion";
import {
  BadgeTemporada,
  ETIQUETA_TEMPORADA,
  OPCIONES_TEMPORADA,
  esTemporada,
  type TemporadaAgrupacion,
} from "@/components/estacionalidad/temporada";
import { contarAgrupaciones } from "./conteo";
import { temporadaDistinta, type AgrupacionConTemporada } from "./tipos";

export type FiltroTemporada = "todas" | TemporadaAgrupacion;
export type FiltroEstado = "todas" | "distinta";

/** Agrupaciones que siguen como «Toda temporada» aunque sus líneas sugieren Invierno (sin decisión del planner). */
export function pendientesDeInvierno(agrupaciones: readonly AgrupacionConTemporada[]): AgrupacionConTemporada[] {
  return agrupaciones.filter((a) => a.activo && a.temporada === "todo_el_ano" && a.temporada_sugerida === "invierno");
}

const distinta = temporadaDistinta;

/**
 * Pestaña Curvas del paso 1: la tabla de agrupaciones con su temporada
 * (editable en línea con el mismo `PATCH` de M3) y la que sugieren las líneas de
 * sus equivalencias. Todavía no hay corridas ni propuestas: el cálculo llega en
 * el paso 2 (0.9.1 · M6).
 */
export function CurvasTab({
  agrupaciones,
  cargando,
  filtroTemporada,
  onFiltroTemporada,
  filtroEstado,
  onFiltroEstado,
  onCambio,
}: {
  agrupaciones: AgrupacionConTemporada[];
  cargando: boolean;
  filtroTemporada: FiltroTemporada;
  onFiltroTemporada: (f: FiltroTemporada) => void;
  filtroEstado: FiltroEstado;
  onFiltroEstado: (f: FiltroEstado) => void;
  /** Se llama tras cada escritura exitosa, para recargar las agrupaciones. */
  onCambio: () => Promise<void> | void;
}) {
  const [genero, setGenero] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [guardandoId, setGuardandoId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const colores = useMapaColores(agrupaciones);

  const conteo = useMemo(() => contarAgrupaciones(agrupaciones), [agrupaciones]);
  const pendientes = useMemo(() => pendientesDeInvierno(agrupaciones), [agrupaciones]);

  const generos = useMemo(() => {
    const porId = new Map<string, string>();
    for (const a of agrupaciones) for (const g of a.generos) porId.set(g.id, g.nombre);
    return [...porId.entries()].map(([id, nombre]) => ({ id, nombre })).sort(compararPorNombre);
  }, [agrupaciones]);

  // Alfabético; las inactivas al final.
  const filas = useMemo(() => {
    const q = normalizarNombre(busqueda);
    return agrupaciones
      // Los chips cuentan solo activas: con un filtro de chip puesto, las inactivas no se listan (así el conteo coincide con las filas).
      .filter((a) => (filtroTemporada === "todas" && filtroEstado === "todas") || a.activo)
      .filter((a) => filtroTemporada === "todas" || a.temporada === filtroTemporada)
      .filter((a) => filtroEstado === "todas" || distinta(a))
      .filter((a) => genero === "" || a.generos.some((g) => g.id === genero))
      .filter((a) => q === "" || a.nombre.includes(q))
      .sort((a, b) => Number(!a.activo) - Number(!b.activo) || compararPorNombre(a, b));
  }, [agrupaciones, filtroTemporada, filtroEstado, genero, busqueda]);

  async function cambiarTemporada(a: AgrupacionConTemporada, temporada: TemporadaAgrupacion) {
    if (temporada === a.temporada) return;
    setGuardandoId(a.id);
    setError(null);
    setAviso(null);
    try {
      await api.patch(`/api/agrupaciones-estacionalidad/${a.id}`, { temporada });
      await onCambio();
      setAviso(`${a.nombre}: temporada ${ETIQUETA_TEMPORADA[temporada].toLowerCase()}.`);
    } catch (e) {
      setError(mensajeError(e));
    } finally {
      setGuardandoId(null);
    }
  }

  const itemsTemporada: ChipItem<FiltroTemporada>[] = [
    { id: "todas", label: "Todas", conteo: conteo.activas },
    { id: "invierno", label: "Invierno", conteo: conteo.invierno },
    { id: "verano", label: "Verano", conteo: conteo.verano },
    { id: "todo_el_ano", label: "Toda temporada", conteo: conteo.todo_el_ano },
  ];
  const itemsEstado: ChipItem<FiltroEstado>[] = [
    { id: "todas", label: "Todas", conteo: conteo.activas },
    { id: "distinta", label: "Temporada distinta de la sugerida", conteo: conteo.distinta },
  ];

  const columnas: Columna<AgrupacionConTemporada>[] = [
    {
      clave: "agrupacion",
      titulo: "Agrupación",
      render: (a) => (
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <BadgeAgrupacion agrupacion={a} colores={colores} />
            {!a.activo && <Badge tono="neutro">Inactiva</Badge>}
          </div>
          {a.generos.length > 0 && (
            <ul className="flex flex-wrap gap-1" aria-label={`Géneros de ${a.nombre}`}>
              {a.generos.map((g) => (
                <li key={g.id}>
                  <Badge>{g.nombre}</Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
      ),
    },
    {
      clave: "temporada",
      titulo: "Temporada",
      className: "w-48",
      render: (a) => (
        <Select
          aria-label={`Temporada de ${a.nombre}`}
          value={a.temporada}
          disabled={guardandoId !== null}
          onChange={(e) => {
            const v = e.target.value;
            if (esTemporada(v)) void cambiarTemporada(a, v);
          }}
          className="h-8"
        >
          {OPCIONES_TEMPORADA.map((o) => (
            <option key={o.valor} value={o.valor}>
              {o.etiqueta}
            </option>
          ))}
        </Select>
      ),
    },
    {
      clave: "sugerida",
      titulo: "Sugerida por sus líneas",
      render: (a) => (
        <div className="flex flex-wrap items-center gap-2">
          <BadgeTemporada temporada={a.temporada_sugerida} />
          {distinta(a) && (
            <>
              <span className="text-xs text-alerta">Distinta de la fijada</span>
              <Button
                variante="secundario"
                tamano="sm"
                className="h-6! px-2! text-xs"
                disabled={guardandoId !== null}
                onClick={() => void cambiarTemporada(a, a.temporada_sugerida)}
                title={`Cambiar la temporada de ${a.nombre} a ${ETIQUETA_TEMPORADA[a.temporada_sugerida]}`}
              >
                Aplicar
              </Button>
            </>
          )}
        </div>
      ),
    },
    {
      clave: "equivalencias",
      titulo: "Equivalencias activas",
      className: "text-right",
      render: (a) => <span className="font-mono text-xs text-tinta-suave">{formatearNumero(a.equivalencias_activas)}</span>,
    },
  ];

  return (
    <div className="space-y-6">
      <Alert tono="info">
        El cálculo de curvas llega en el paso 2 (0.9.1 · M6). Por ahora marca la temporada de cada agrupación: es la que decide a cuáles afecta un
        periodo atípico de alcance «invierno».
      </Alert>

      {error && <Alert onCerrar={() => setError(null)}>{error}</Alert>}
      {aviso && (
        <Alert tono="exito" onCerrar={() => setAviso(null)}>
          {aviso}
        </Alert>
      )}

      <Card titulo="Calcular curvas" descripcion="Disponible en el siguiente paso.">
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled title="Disponible en el siguiente paso (0.9.1 · M6)">
            Calcular
          </Button>
          <span className="text-sm text-tinta-suave">
            Sin corridas todavía: aquí aparecerán las propuestas del modelo, la curva vigente de cada agrupación y su detalle.
          </span>
        </div>
      </Card>

      {pendientes.length > 0 && (
        <Alert>
          {plural(pendientes.length, "agrupación sigue", "agrupaciones siguen")} como «Toda temporada» aunque sus líneas sugieren Invierno (
          {pendientes
            .slice(0, 4)
            .map((a) => a.nombre)
            .join(", ")}
          {pendientes.length > 4 ? "…" : ""}): decide su temporada para que El Niño las alcance.{" "}
          <button
            type="button"
            onClick={() => {
              onFiltroTemporada("todas");
              onFiltroEstado("distinta");
            }}
            className="font-medium underline underline-offset-2"
          >
            Ver las que difieren de la sugerida
          </button>
        </Alert>
      )}

      <Card
        titulo="Temporada de las agrupaciones"
        descripcion={
          cargando && agrupaciones.length === 0
            ? "Cargando agrupaciones…"
            : `${formatearNumero(conteo.activas)} agrupaciones activas · ${formatearNumero(conteo.invierno)} de invierno · ${formatearNumero(conteo.verano)} de verano · ${formatearNumero(conteo.todo_el_ano)} de toda temporada · ${formatearNumero(conteo.distinta)} con temporada distinta de la sugerida${conteo.inactivas > 0 ? ` · ${plural(conteo.inactivas, "inactiva", "inactivas")} aparte, al final y atenuadas` : ""}`
        }
      >
        {!cargando && agrupaciones.length === 0 ? (
          <EmptyState titulo="Todavía no hay agrupaciones" detalle="Créalas en Maestros → Agrupaciones de estacionalidad; aquí podrás marcar su temporada." />
        ) : (
          <div className="space-y-4">
            <div className="grid items-end gap-3 md:grid-cols-3">
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-tinta">Buscar</span>
                <Input
                  type="search"
                  value={busqueda}
                  onChange={(e) => setBusqueda(e.target.value.toUpperCase())}
                  placeholder="Nombre de la agrupación"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-tinta">Género</span>
                <Select value={genero} onChange={(e) => setGenero(e.target.value)}>
                  <option value="">Todos</option>
                  {generos.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.nombre}
                    </option>
                  ))}
                </Select>
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <Chips<FiltroTemporada> items={itemsTemporada} activo={filtroTemporada} onCambiar={onFiltroTemporada} etiqueta="Filtrar por temporada" />
              <Chips<FiltroEstado> items={itemsEstado} activo={filtroEstado} onCambiar={onFiltroEstado} etiqueta="Filtrar por coincidencia con la sugerida" />
            </div>
            <DataTable
              columnas={columnas}
              filas={filas}
              claveFila={(a) => a.id}
              cargando={cargando && agrupaciones.length === 0}
              vacio="Ninguna agrupación coincide con los filtros."
              claseFila={(a) => (a.activo ? undefined : "bg-neutro-suave/60 text-tinta-suave")}
            />
            <p className="text-xs text-tinta-suave">
              La temporada se guarda al elegirla. La sugerida sale de la temporada mayoritaria de las líneas de sus equivalencias activas (M1); la
              agrupación no la hereda: la decide el planner. Cambiarla no recalcula nada.
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}
