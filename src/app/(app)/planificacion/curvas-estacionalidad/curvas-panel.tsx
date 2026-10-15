"use client";

import { useCallback, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useColeccion } from "@/lib/use-coleccion";
import type { EstadoCurvasApi } from "@/lib/curvas/tipos-api";
import { Alert } from "@/components/ui/alert";
import { Tabs } from "@/components/ui/tabs";
import { useMapaColores } from "@/components/estacionalidad/badge-agrupacion";
import { AniosNinoTab } from "./anios-nino-tab";
import { CurvasTab } from "./curvas-tab";
import { DetalleAgrupacion } from "./detalle-agrupacion";
import { PeriodosTab } from "./periodos-tab";
import type { AgrupacionConTemporada } from "./tipos";
import { useRecurso } from "./use-recurso";
import { esIdAgrupacion, esModeloCurva, type FiltroEstado, type FiltroTemporada, type ResultadoComparar } from "./vista";

type Pestana = "curvas" | "anios" | "periodos";

/**
 * Pantalla /planificacion/curvas-estacionalidad (M6b). Tres pestañas: Agrupaciones (la lista con su estado y,
 * al «Trabajar» una, su vista de trabajo: curva aprobada, años y propuesta, parámetros y aprobación), Años Niño
 * (vista de apoyo a demanda) y Periodos atípicos (el mantenimiento de los rangos de meses distorsionados).
 *
 * La agrupación abierta vive en la URL (`?agrupacion=<id>`, y `&modelo=` para la candidata dibujada): recargar o
 * compartir el enlace reabre la misma vista; «← Agrupaciones» quita el parámetro. Se maneja con la API de
 * historial del navegador, que Next integra con `useSearchParams`. Admin y planner tienen las mismas
 * acciones; el comprador no entra (menú y página).
 */
export function CurvasPanel() {
  const parametros = useSearchParams();
  const pathname = usePathname();
  const idUrl = parametros.get("agrupacion");
  const agrupacionId = esIdAgrupacion(idUrl) ? idUrl : null;
  const modeloUrl = parametros.get("modelo");
  const modeloInicial = esModeloCurva(modeloUrl) ? modeloUrl : null;

  const [pestanaElegida, setPestana] = useState<Pestana>("curvas");
  const [filtroTemporada, setFiltroTemporada] = useState<FiltroTemporada>("todas");
  const [filtroEstado, setFiltroEstado] = useState<FiltroEstado>("todas");
  const [comparaciones, setComparaciones] = useState<Record<string, ResultadoComparar>>({});
  const pestana: Pestana = agrupacionId ? "curvas" : pestanaElegida;

  // Las pestañas Agrupaciones y Periodos leen las mismas agrupaciones (colores de M3 y temporada): una sola carga.
  const agrupaciones = useColeccion<AgrupacionConTemporada>("/api/agrupaciones-estacionalidad?incluir_inactivos=1");
  const estado = useRecurso<EstadoCurvasApi>("/api/curvas");
  const colores = useMapaColores(agrupaciones.datos);
  const recargarAgrupaciones = agrupaciones.recargar;
  const recargarEstado = estado.recargar;

  const recargarTodo = useCallback(async () => {
    await Promise.all([recargarAgrupaciones(), recargarEstado()]);
  }, [recargarAgrupaciones, recargarEstado]);

  /** Cambia la URL sin recargar la página (`pushState` para abrir o cerrar la agrupación; `replaceState` para la candidata). */
  const irA = useCallback(
    (agrupacion: string | null, modo: "push" | "replace" = "push", modelo: string | null = null) => {
      const q = new URLSearchParams();
      if (agrupacion) q.set("agrupacion", agrupacion);
      if (agrupacion && modelo) q.set("modelo", modelo);
      const url = q.size > 0 ? `${pathname}?${q.toString()}` : pathname;
      if (modo === "push") window.history.pushState(null, "", url);
      else window.history.replaceState(null, "", url);
    },
    [pathname]
  );

  function trabajar(id: string) {
    setPestana("curvas");
    irA(id);
  }

  function volverALaLista() {
    irA(null);
    void recargarTodo();
  }

  function cambiarPestana(siguiente: Pestana) {
    if (agrupacionId) irA(null);
    // Al volver a la lista se relee el estado: lo que se hizo en otra pestaña (periodos) cambia los bloqueos.
    if (siguiente === "curvas" && pestana !== "curvas") void recargarEstado();
    setPestana(siguiente);
  }

  function irAPeriodos() {
    cambiarPestana("periodos");
  }

  function irARevisarTodaTemporada() {
    setFiltroTemporada("todo_el_ano");
    setFiltroEstado("todas");
    cambiarPestana("curvas");
  }

  function comparacion(id: string, r: ResultadoComparar | null) {
    setComparaciones((prev) => {
      const sig = { ...prev };
      if (r) sig[id] = r;
      else delete sig[id];
      return sig;
    });
  }

  const nombreInicial = agrupacionId ? (estado.datos?.agrupaciones.find((a) => a.id === agrupacionId)?.nombre ?? null) : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Curvas de estacionalidad</h1>
        <p className="mt-1 text-sm text-tinta-suave">
          La curva mensual de cada agrupación sale de la venta real cargada en M5, sobre las mismas tiendas dentro de cada año. Trabaja las agrupaciones una por una: el modelo
          propone y compara, y tú apruebas una curva por agrupación después de revisar su detalle. Las curvas son un artefacto vivo: se marcan obsoletas cuando cambian la red de
          tiendas, la composición o los datos.
        </p>
      </div>

      <Tabs<Pestana>
        items={[
          { id: "curvas", label: "Agrupaciones" },
          { id: "anios", label: "Años Niño" },
          { id: "periodos", label: "Periodos atípicos" },
        ]}
        activa={pestana}
        onCambiar={cambiarPestana}
      />

      {agrupaciones.error && <Alert onCerrar={() => agrupaciones.setError(null)}>No se pudieron cargar las agrupaciones: {agrupaciones.error}</Alert>}
      {estado.error && <Alert onCerrar={() => estado.setError(null)}>No se pudo leer el estado de las curvas: {estado.error}</Alert>}

      {pestana === "curvas" &&
        (agrupacionId ? (
          <DetalleAgrupacion
            key={agrupacionId}
            agrupacionId={agrupacionId}
            nombreInicial={nombreInicial}
            colores={colores}
            modeloInicial={modeloInicial}
            onModelo={(m) => irA(agrupacionId, "replace", m)}
            onVolver={volverALaLista}
            onIrAPeriodos={irAPeriodos}
            onCambio={recargarTodo}
          />
        ) : (
          <CurvasTab
            estado={estado.datos}
            cargando={estado.cargando}
            agrupacionesM3={agrupaciones.datos}
            filtroTemporada={filtroTemporada}
            onFiltroTemporada={setFiltroTemporada}
            filtroEstado={filtroEstado}
            onFiltroEstado={setFiltroEstado}
            comparaciones={comparaciones}
            onComparacion={comparacion}
            onTrabajar={trabajar}
            onIrAPeriodos={irAPeriodos}
            onCambio={recargarTodo}
          />
        ))}
      {pestana === "anios" && <AniosNinoTab onVer={trabajar} />}
      {pestana === "periodos" && <PeriodosTab agrupaciones={agrupaciones.datos} onIrACurvas={irARevisarTodaTemporada} />}
    </div>
  );
}
