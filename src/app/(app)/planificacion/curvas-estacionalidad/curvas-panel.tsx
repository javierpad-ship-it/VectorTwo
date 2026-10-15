"use client";

import { useCallback, useState } from "react";
import { useColeccion } from "@/lib/use-coleccion";
import type { CalcularRespuesta, EstadoCurvasApi } from "@/lib/curvas/tipos-api";
import { Alert } from "@/components/ui/alert";
import { Tabs } from "@/components/ui/tabs";
import { AniosNinoTab } from "./anios-nino-tab";
import { CurvasTab } from "./curvas-tab";
import { DetalleAgrupacion } from "./detalle-agrupacion";
import { FORMULARIO_POR_DEFECTO, formularioDesdeParametros, type FormularioParametros } from "./parametros-form";
import { PeriodosTab } from "./periodos-tab";
import type { AgrupacionConTemporada } from "./tipos";
import { useRecurso } from "./use-recurso";
import type { FiltroEstado, FiltroTemporada } from "./vista";

type Pestana = "curvas" | "anios" | "periodos";

/**
 * Pantalla /planificacion/curvas-estacionalidad (M6, paso 2). Tres pestañas:
 * Curvas (corridas, propuestas, curva vigente de cada agrupación y su detalle,
 * donde se aprueba una por una), Años Niño (el efecto de El Niño en volumen y
 * forma, y lo que recibirá M7) y Periodos atípicos (el mantenimiento de los
 * rangos de meses distorsionados). Admin y planner tienen las mismas acciones; el
 * comprador no entra (menú y página).
 */
export function CurvasPanel() {
  const [pestana, setPestana] = useState<Pestana>("curvas");
  const [filtroTemporada, setFiltroTemporada] = useState<FiltroTemporada>("todas");
  const [filtroEstado, setFiltroEstado] = useState<FiltroEstado>("todas");
  const [corridaSel, setCorridaSel] = useState<string | null>(null);
  const [detalleId, setDetalleId] = useState<string | null>(null);
  const [formulario, setFormulario] = useState<FormularioParametros>(FORMULARIO_POR_DEFECTO);
  const [claveCalculo, setClaveCalculo] = useState(0);
  const [abrirParametros, setAbrirParametros] = useState(false);

  // Las pestañas Curvas y Periodos leen las mismas agrupaciones (colores de M3 y edición de la temporada): una sola carga.
  const agrupaciones = useColeccion<AgrupacionConTemporada>("/api/agrupaciones-estacionalidad?incluir_inactivos=1");
  const estado = useRecurso<EstadoCurvasApi>(corridaSel ? `/api/curvas?corrida_id=${corridaSel}` : "/api/curvas");
  const recargarAgrupaciones = agrupaciones.recargar;
  const recargarEstado = estado.recargar;

  const recargarTodo = useCallback(async () => {
    await Promise.all([recargarAgrupaciones(), recargarEstado()]);
  }, [recargarAgrupaciones, recargarEstado]);

  const corridaId = estado.datos?.corrida?.id ?? null;

  function irARevisarTodaTemporada() {
    setFiltroTemporada("todo_el_ano");
    setFiltroEstado("todas");
    setDetalleId(null);
    setPestana("curvas");
  }

  function verDetalle(id: string) {
    setDetalleId(id);
    setPestana("curvas");
  }

  /** Recalcular: abre la tarjeta Calcular con los parámetros de la corrida que se está viendo. */
  function recalcular() {
    const c = estado.datos?.corrida;
    setFormulario(c ? formularioDesdeParametros(c.parametros) : FORMULARIO_POR_DEFECTO);
    setClaveCalculo((k) => k + 1);
    setAbrirParametros(true);
    setDetalleId(null);
    setPestana("curvas");
    requestAnimationFrame(() => document.getElementById("calcular-curvas")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  async function calculada(r: CalcularRespuesta) {
    setCorridaSel(r.corrida.id);
    await recargarAgrupaciones();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Curvas de estacionalidad</h1>
        <p className="mt-1 text-sm text-tinta-suave">
          La curva mensual de cada agrupación sale de la venta real cargada en M5, sobre las mismas tiendas dentro de cada año. El modelo propone y compara; tú apruebas una
          curva por agrupación después de revisar su detalle. Las curvas son un artefacto vivo: se recalculan cuando cambian la red de tiendas, la composición o los datos.
        </p>
      </div>

      <Tabs<Pestana>
        items={[
          { id: "curvas", label: "Curvas" },
          { id: "anios", label: "Años Niño" },
          { id: "periodos", label: "Periodos atípicos" },
        ]}
        activa={pestana}
        onCambiar={setPestana}
      />

      {agrupaciones.error && (
        <Alert onCerrar={() => agrupaciones.setError(null)}>No se pudieron cargar las agrupaciones: {agrupaciones.error}</Alert>
      )}
      {estado.error && <Alert onCerrar={() => estado.setError(null)}>No se pudo leer el estado de las curvas: {estado.error}</Alert>}

      {pestana === "curvas" &&
        (detalleId && corridaId ? (
          <DetalleAgrupacion
            key={`${corridaId}-${detalleId}`}
            corridaId={corridaId}
            agrupacionId={detalleId}
            onVolver={() => setDetalleId(null)}
            onCambio={recargarTodo}
          />
        ) : (
          <CurvasTab
            estado={estado.datos}
            cargando={estado.cargando}
            agrupacionesM3={agrupaciones.datos}
            formulario={formulario}
            onFormulario={setFormulario}
            claveCalculo={claveCalculo}
            abrirParametros={abrirParametros}
            filtroTemporada={filtroTemporada}
            onFiltroTemporada={setFiltroTemporada}
            filtroEstado={filtroEstado}
            onFiltroEstado={setFiltroEstado}
            onVer={verDetalle}
            onRecalcular={recalcular}
            onCalculada={calculada}
            onSeleccionarCorrida={(id) => {
              setCorridaSel(id);
              setDetalleId(null);
            }}
            onCambio={recargarTodo}
          />
        ))}
      {pestana === "anios" && <AniosNinoTab key={corridaId ?? "sin-corrida"} corridaId={corridaId} formulario={formulario} onFormulario={setFormulario} onVer={verDetalle} />}
      {pestana === "periodos" && <PeriodosTab agrupaciones={agrupaciones.datos} onIrACurvas={irARevisarTodaTemporada} />}
    </div>
  );
}
