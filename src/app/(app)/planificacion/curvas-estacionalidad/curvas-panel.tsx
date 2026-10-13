"use client";

import { useCallback, useState } from "react";
import { useColeccion } from "@/lib/use-coleccion";
import { Alert } from "@/components/ui/alert";
import { Tabs } from "@/components/ui/tabs";
import { CurvasTab, type FiltroEstado, type FiltroTemporada } from "./curvas-tab";
import { PeriodosTab } from "./periodos-tab";
import type { AgrupacionConTemporada } from "./tipos";

type Pestana = "curvas" | "periodos";

/**
 * Pantalla /planificacion/curvas-estacionalidad (M6, paso 1). Dos pestañas:
 * Periodos atípicos (el mantenimiento de El Niño, operativo desde ya) y Curvas
 * (por ahora, la temporada de cada agrupación; el cálculo llega en el paso 2).
 * Admin y planner tienen las mismas acciones; el comprador no entra (menú y página).
 */
export function CurvasPanel() {
  const [pestana, setPestana] = useState<Pestana>("periodos");
  const [filtroTemporada, setFiltroTemporada] = useState<FiltroTemporada>("todas");
  const [filtroEstado, setFiltroEstado] = useState<FiltroEstado>("todas");
  // Las dos pestañas leen las mismas agrupaciones (con su temporada y la sugerida): una sola carga.
  const agrupaciones = useColeccion<AgrupacionConTemporada>("/api/agrupaciones-estacionalidad?incluir_inactivos=1");
  const recargarAgrupaciones = agrupaciones.recargar;

  const irACurvasPendientes = useCallback(() => {
    setFiltroTemporada("todas");
    setFiltroEstado("distinta");
    setPestana("curvas");
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Curvas de estacionalidad</h1>
        <p className="mt-1 text-sm text-tinta-suave">
          La curva mensual de cada agrupación saldrá de la venta real cargada en M5. Antes hay que decir qué meses son atípicos (El Niño costero) y
          qué agrupaciones son de invierno, que son las que ese evento afecta.
        </p>
      </div>

      <Tabs<Pestana>
        items={[
          { id: "curvas", label: "Curvas" },
          { id: "periodos", label: "Periodos atípicos" },
        ]}
        activa={pestana}
        onCambiar={setPestana}
      />

      {agrupaciones.error && (
        <Alert onCerrar={() => agrupaciones.setError(null)}>No se pudieron cargar las agrupaciones: {agrupaciones.error}</Alert>
      )}

      {pestana === "curvas" && (
        <CurvasTab
          agrupaciones={agrupaciones.datos}
          cargando={agrupaciones.cargando}
          filtroTemporada={filtroTemporada}
          onFiltroTemporada={setFiltroTemporada}
          filtroEstado={filtroEstado}
          onFiltroEstado={setFiltroEstado}
          onCambio={recargarAgrupaciones}
        />
      )}
      {pestana === "periodos" && <PeriodosTab agrupaciones={agrupaciones.datos} onIrACurvas={irACurvasPendientes} />}
    </div>
  );
}
