"use client";

import { useMemo, useState } from "react";
import type { AgrupacionEstacionalidadFila, EquivalenciaPlana, EquivalenciasEstacionalidadRespuesta } from "@/lib/estacionalidad/tipos-api";
import { agrupacionesParaFiltro, incluyeGenero, tieneGeneros, ordenarPorNombre } from "@/lib/estacionalidad/generos";
import { formatearNumero } from "@/lib/formato";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Chips, type ChipItem } from "@/components/ui/chips";
import { Field, Select } from "@/components/ui/form";
import { Switch } from "@/components/ui/switch";
import { EmptyState } from "@/components/ui/empty-state";
import { CATALOGOS_VACIOS, FiltrosArbol, useFiltroArbol } from "./comunes";
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
  onIrAAgrupaciones,
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
  /** Lleva a la pestaña Agrupaciones (añadir géneros a una agrupación). */
  onIrAAgrupaciones: () => void;
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

      {asignacion.advertencia && <Alert onCerrar={() => asignacion.setAdvertencia(null)}>{asignacion.advertencia}</Alert>}

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
          onIrAAgrupaciones={onIrAAgrupaciones}
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
          onIrAAgrupaciones={onIrAAgrupaciones}
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
  onIrAAgrupaciones: () => void;
};

function VistaPorArbol({ todas, catalogos, cargando, agrupaciones, puedeEditar, ocupado, onAsignar, onIrAAgrupaciones }: PropsVista) {
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
          generoId={filtro.generoId}
          verbo="Asignar a"
          ocupado={ocupado}
          onAsignar={onAsignar}
          onIrAAgrupaciones={onIrAAgrupaciones}
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
  onIrAAgrupaciones,
}: PropsVista & { agrupacionId: string; onAgrupacionId: (id: string) => void; onIrAlArbol: () => void }) {
  const elegida = agrupaciones.find((a) => a.id === agrupacionId) ?? null;
  const deLaAgrupacion = useMemo(() => (elegida ? todas.filter((e) => e.agrupacion?.id === elegida.id) : EMPTY), [todas, elegida]);
  const { filtro, setFiltro, lineasDisponibles, filas } = useFiltroArbol(deLaAgrupacion, catalogos.lineas);

  // Opciones, por nombre. Con un género filtrado, solo las activas que lo
  // incluyen (más la elegida, marcada, para que no desaparezca sin avisar).
  // Con "Todos", las activas con género y, para poder consultarlas, las
  // inactivas o sin género que tengan equivalencias.
  const opciones = useMemo(() => {
    const generoFiltro = filtro.generoId;
    const base =
      generoFiltro === ""
        ? agrupaciones.filter((a) => (a.activo && tieneGeneros(a)) || a.equivalencias > 0 || a.id === agrupacionId)
        : agrupacionesParaFiltro(agrupaciones, generoFiltro).concat(
            agrupaciones.filter((a) => a.id === agrupacionId && !(a.activo && incluyeGenero(a, generoFiltro)))
          );
    return ordenarPorNombre(base);
  }, [agrupaciones, agrupacionId, filtro.generoId]);
  const nombreGeneroFiltro = catalogos.generos.find((g) => g.id === filtro.generoId)?.nombre;
  const etiquetaOpcion = (a: AgrupacionEstacionalidadFila) => {
    const notas: string[] = [];
    if (!a.activo) notas.push("inactiva");
    if (!tieneGeneros(a)) notas.push("sin género");
    else if (filtro.generoId !== "" && !incluyeGenero(a, filtro.generoId)) notas.push(`no incluye ${nombreGeneroFiltro ?? "este género"}`);
    return `${a.nombre} (${formatearNumero(a.equivalencias)})${notas.length > 0 ? ` · ${notas.join(", ")}` : ""}`;
  };

  return (
    <Card titulo={elegida ? `${elegida.nombre} (${formatearNumero(filas.length)})` : "Por agrupación"}>
      <div className="space-y-4">
        <Field label="Agrupación" className="max-w-md">
          <Select value={agrupacionId} onChange={(e) => onAgrupacionId(e.target.value)} className="h-9">
            <option value="">Elige una agrupación…</option>
            {opciones.map((a) => (
              <option key={a.id} value={a.id}>
                {etiquetaOpcion(a)}
              </option>
            ))}
          </Select>
        </Field>

        {elegida && <FiltrosArbol catalogos={catalogos} lineasDisponibles={lineasDisponibles} filtro={filtro} onCambiar={setFiltro} />}

        {!elegida ? (
          <EmptyState
            titulo={agrupaciones.length === 0 ? "Todavía no hay agrupaciones" : "Elige una agrupación"}
            detalle={agrupaciones.length === 0 ? "Créalas en la pestaña Agrupaciones." : "Verás sus equivalencias y podrás moverlas o quitarles la agrupación."}
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
            <TablaSeleccion
              filas={filas}
              catalogos={catalogos}
              cargando={cargando}
              vacio="Ninguna equivalencia coincide con el filtro."
              puedeEditar={puedeEditar}
              agrupaciones={agrupaciones}
              generoId={filtro.generoId}
              verbo="Mover a"
              ocupado={ocupado}
              onAsignar={onAsignar}
              onIrAAgrupaciones={onIrAAgrupaciones}
            />
          </>
        )}
      </div>
    </Card>
  );
}
