"use client";

import { useMemo, useState } from "react";
import type { AgrupacionEstacionalidadFila, EquivalenciaPlana, EquivalenciasEstacionalidadRespuesta } from "@/lib/estacionalidad/tipos-api";
import { formatearNumero } from "@/lib/formato";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Chips, type ChipItem } from "@/components/ui/chips";
import { Field, Select } from "@/components/ui/form";
import { Switch } from "@/components/ui/switch";
import { EmptyState } from "@/components/ui/empty-state";
import { CATALOGOS_VACIOS, FiltrosArbol, ordenarAgrupaciones, useFiltroArbol } from "./comunes";
import { TablaSeleccion } from "./tabla-seleccion";
import { useAsignar } from "./use-asignar";

export type VistaAsignacion = "arbol" | "agrupacion";

type FiltroEstado = "todas" | "sin" | "con";

/**
 * Pestaña Asignación: dos vistas (Por árbol · Por agrupación) sobre la lista
 * plana, con selección múltiple y asignación en bloque.
 */
export function AsignacionTab({
  lista,
  cargando,
  agrupaciones,
  puedeEditar,
  vista,
  onVista,
  agrupacionId,
  onAgrupacionId,
  mostrarInactivas,
  onMostrarInactivas,
  onCambio,
}: {
  lista: EquivalenciasEstacionalidadRespuesta | null;
  cargando: boolean;
  agrupaciones: AgrupacionEstacionalidadFila[];
  puedeEditar: boolean;
  vista: VistaAsignacion;
  onVista: (v: VistaAsignacion) => void;
  /** Agrupación elegida en la vista Por agrupación (controlada desde el panel para el enlace de la pestaña Agrupaciones). */
  agrupacionId: string;
  onAgrupacionId: (id: string) => void;
  mostrarInactivas: boolean;
  onMostrarInactivas: (v: boolean) => void;
  onCambio: () => Promise<void>;
}) {
  const asignacion = useAsignar(onCambio);
  const todas = lista?.equivalencias ?? EMPTY;
  const catalogos = lista ?? CATALOGOS_VACIOS;

  return (
    <div className="space-y-4">
      {asignacion.error && <Alert onCerrar={() => asignacion.setError(null)}>{asignacion.error}</Alert>}
      {asignacion.aviso && (
        <Alert tono="exito" onCerrar={() => asignacion.setAviso(null)}>
          {asignacion.aviso}
        </Alert>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Chips<VistaAsignacion>
          items={[
            { id: "arbol", label: "Por árbol" },
            { id: "agrupacion", label: "Por agrupación" },
          ]}
          activo={vista}
          onCambiar={onVista}
          etiqueta="Vista"
        />
        <Switch checked={mostrarInactivas} onChange={onMostrarInactivas} label="Mostrar inactivas" />
      </div>

      {vista === "arbol" ? (
        <VistaPorArbol
          todas={todas}
          catalogos={catalogos}
          cargando={cargando}
          agrupaciones={agrupaciones}
          puedeEditar={puedeEditar}
          ocupado={asignacion.ocupado}
          onAsignar={asignacion.asignar}
        />
      ) : (
        <VistaPorAgrupacion
          todas={todas}
          catalogos={catalogos}
          cargando={cargando}
          agrupaciones={agrupaciones}
          puedeEditar={puedeEditar}
          agrupacionId={agrupacionId}
          onAgrupacionId={onAgrupacionId}
          onIrAlArbol={() => onVista("arbol")}
          ocupado={asignacion.ocupado}
          onAsignar={asignacion.asignar}
        />
      )}
    </div>
  );
}

const EMPTY: EquivalenciaPlana[] = [];

type PropsVista = {
  todas: EquivalenciaPlana[];
  catalogos: Pick<EquivalenciasEstacionalidadRespuesta, "generos" | "mundos" | "lineas">;
  cargando: boolean;
  agrupaciones: AgrupacionEstacionalidadFila[];
  puedeEditar: boolean;
  ocupado: boolean;
  onAsignar: ReturnType<typeof useAsignar>["asignar"];
};

function VistaPorArbol({ todas, catalogos, cargando, agrupaciones, puedeEditar, ocupado, onAsignar }: PropsVista) {
  const { filtro, setFiltro, lineasDisponibles, filas } = useFiltroArbol(todas, catalogos.lineas);
  const [estado, setEstado] = useState<FiltroEstado>("todas");

  const conteos = useMemo(() => {
    let con = 0;
    for (const e of filas) if (!e.faltante) con++;
    return { todas: filas.length, con, sin: filas.length - con };
  }, [filas]);

  const visibles = useMemo(
    () => (estado === "todas" ? filas : filas.filter((e) => (estado === "con" ? !e.faltante : e.faltante))),
    [filas, estado]
  );

  const chips: ChipItem<FiltroEstado>[] = [
    { id: "todas", label: "Todas", conteo: conteos.todas },
    { id: "sin", label: "Faltantes", conteo: conteos.sin },
    { id: "con", label: "Con agrupación activa", conteo: conteos.con },
  ];

  return (
    <Card titulo={`Equivalencias (${formatearNumero(visibles.length)})`}>
      <div className="space-y-4">
        <FiltrosArbol catalogos={catalogos} lineasDisponibles={lineasDisponibles} filtro={filtro} onCambiar={setFiltro} />
        <Chips items={chips} activo={estado} onCambiar={setEstado} etiqueta="Filtrar por estado de asignación" />
        <TablaSeleccion
          filas={visibles}
          catalogos={catalogos}
          cargando={cargando}
          vacio={todas.length === 0 ? "No hay equivalencias activas en el árbol." : "Ninguna equivalencia coincide con el filtro."}
          puedeEditar={puedeEditar}
          agrupaciones={agrupaciones}
          verbo="Asignar a"
          ocupado={ocupado}
          onAsignar={onAsignar}
        />
        {puedeEditar && (
          <p className="text-xs text-tinta-suave">
            Filtra (p. ej. género + línea), selecciona las filtradas y asígnalas a una agrupación. Las inactivas y las ocultas por un padre
            inactivo también aceptan agrupación: así ya tienen curva si se reactivan.
          </p>
        )}
      </div>
    </Card>
  );
}

function VistaPorAgrupacion({
  todas,
  catalogos,
  cargando,
  agrupaciones,
  puedeEditar,
  agrupacionId,
  onAgrupacionId,
  onIrAlArbol,
  ocupado,
  onAsignar,
}: PropsVista & { agrupacionId: string; onAgrupacionId: (id: string) => void; onIrAlArbol: () => void }) {
  const ordenadas = useMemo(() => ordenarAgrupaciones(agrupaciones), [agrupaciones]);
  const elegida = ordenadas.find((a) => a.id === agrupacionId) ?? null;
  const deLaAgrupacion = useMemo(() => (elegida ? todas.filter((e) => e.agrupacion?.id === elegida.id) : EMPTY), [todas, elegida]);
  const { filtro, setFiltro, lineasDisponibles, filas } = useFiltroArbol(deLaAgrupacion, catalogos.lineas);

  return (
    <Card titulo={elegida ? `${elegida.nombre} (${formatearNumero(filas.length)})` : "Por agrupación"}>
      <div className="space-y-4">
        <Field label="Agrupación" className="max-w-md">
          <Select value={agrupacionId} onChange={(e) => onAgrupacionId(e.target.value)} className="h-9">
            <option value="">Elige una agrupación…</option>
            {ordenadas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.nombre} ({formatearNumero(a.equivalencias)}){a.activo ? "" : " · inactiva"}
              </option>
            ))}
          </Select>
        </Field>

        {!elegida ? (
          <EmptyState
            titulo={ordenadas.length === 0 ? "Todavía no hay agrupaciones" : "Elige una agrupación"}
            detalle={ordenadas.length === 0 ? "Créalas en la pestaña Agrupaciones." : "Verás sus equivalencias y podrás moverlas o quitarles la agrupación."}
          />
        ) : deLaAgrupacion.length === 0 && !cargando ? (
          <EmptyState
            titulo="Esta agrupación no tiene equivalencias"
            detalle={
              elegida.equivalencias > 0
                ? "Sus equivalencias están inactivas u ocultas: activa «Mostrar inactivas» para verlas."
                : "Asígnale algunas desde la vista Por árbol."
            }
          >
            {puedeEditar && elegida.equivalencias === 0 && (
              <Button variante="secundario" tamano="sm" onClick={onIrAlArbol}>
                Ir a Por árbol
              </Button>
            )}
          </EmptyState>
        ) : (
          <>
            {!elegida.activo && (
              <Alert tono="info">
                Esta agrupación está desactivada: sus equivalencias cuentan como faltantes. Reactívala en Agrupaciones o muévelas a otra.
              </Alert>
            )}
            <FiltrosArbol catalogos={catalogos} lineasDisponibles={lineasDisponibles} filtro={filtro} onCambiar={setFiltro} />
            <TablaSeleccion
              filas={filas}
              catalogos={catalogos}
              cargando={cargando}
              vacio="Ninguna equivalencia coincide con el filtro."
              puedeEditar={puedeEditar}
              agrupaciones={agrupaciones}
              verbo="Mover a"
              ocupado={ocupado}
              onAsignar={onAsignar}
            />
          </>
        )}
      </div>
    </Card>
  );
}
