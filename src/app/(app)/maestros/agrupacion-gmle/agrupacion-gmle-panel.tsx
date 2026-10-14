"use client";

import { useCallback, useDeferredValue, useMemo, useState } from "react";
import { useColeccion } from "@/lib/use-coleccion";
import type { AgrupacionEstacionalidadFila } from "@/lib/estacionalidad/tipos-api";
import { mapaColores } from "@/lib/estacionalidad/colores";
import { ANOMALIAS_GMLE } from "@/lib/reportes/tipos-api";
import { FILTROS_VACIOS, enriquecerEquivalencias, type FiltrosGmle } from "@/lib/reportes/filtros";
import { formatearNumero } from "@/lib/formato";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Tabs } from "@/components/ui/tabs";
import { AnomaliasTab } from "./anomalias-tab";
import { BarraFiltros } from "./barra-filtros";
import { DetalleTab } from "./detalle-tab";
import { ResumenTab } from "./resumen-tab";
import { useReporteGmle } from "./use-reporte-gmle";

type Pestana = "resumen" | "detalle" | "anomalias";

const EMPTY: AgrupacionEstacionalidadFila[] = [];

/**
 * Reporte de agrupación GMLE (M11): cómo quedó la clasificación de
 * estacionalidad cruzada con el nivel de planificación (GML/GMLE). Una sola
 * lectura (`GET /api/reportes/agrupacion-gmle`) y tres vistas con una barra de
 * filtros común que se aplica en memoria. Solo lectura: lo que se encuentra
 * se corrige en M3 o en el Árbol.
 */
export function AgrupacionGmlePanel() {
  const reporte = useReporteGmle();
  // Solo para que los colores coincidan con los de M3 (se asignan por `orden, nombre`, y el reporte no trae `orden`).
  const catalogo = useColeccion<AgrupacionEstacionalidadFila>("/api/agrupaciones-estacionalidad?incluir_inactivos=1");

  const [pestana, setPestana] = useState<Pestana>("resumen");
  const [filtros, setFiltros] = useState<FiltrosGmle>(FILTROS_VACIOS);
  // Las tablas leen una copia diferida: escribir en "Buscar" actualiza el campo al instante y las tablas se repintan después, sin una pasada por tecla.
  const filtrosDiferidos = useDeferredValue(filtros);
  const filtrando = filtrosDiferidos !== filtros;

  const datos = reporte.datos;
  const detalle = useMemo(() => (datos ? enriquecerEquivalencias(datos) : []), [datos]);
  const colores = useMemo(() => {
    const ordenes = new Map((catalogo.datos ?? EMPTY).map((a) => [a.id, a.orden]));
    return mapaColores((datos?.agrupaciones ?? []).map((a) => ({ id: a.id, nombre: a.nombre, orden: ordenes.get(a.id) ?? 0 })));
  }, [datos, catalogo.datos]);

  function cambiarFiltros(cambio: Partial<FiltrosGmle>) {
    setFiltros((f) => ({ ...f, ...cambio }));
  }

  const verEnDetalle = useCallback((clave: string) => {
    setFiltros((f) => ({ ...f, agrupacion: clave }));
    setPestana("detalle");
  }, []);

  const resumen = datos?.resumen;
  const totalAnomalias = resumen ? ANOMALIAS_GMLE.reduce((s, c) => s + resumen.anomalias[c], 0) : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Reporte agrupación GMLE</h1>
          <p className="mt-1 max-w-3xl text-sm text-tinta-suave">
            Cómo quedó la agrupación de estacionalidad de cada equivalencia y qué nivel de planificación tiene su nodo: en un nodo GML, M7 lee
            todas las equivalencias como una unidad; en un GMLE, cada una por separado. Solo lectura: lo que encuentres se corrige en
            Agrupaciones de estacionalidad o en el Árbol.
          </p>
        </div>
        <Button variante="secundario" onClick={() => void reporte.recargar()} disabled={reporte.cargando}>
          {reporte.cargando && datos ? "Recargando…" : "Recargar"}
        </Button>
      </div>

      {reporte.error && <Alert onCerrar={() => reporte.setError(null)}>No se pudo cargar el reporte: {reporte.error}</Alert>}
      {catalogo.error && (
        <Alert tono="info" onCerrar={() => catalogo.setError(null)}>
          Colores aproximados: no se pudo leer el orden de las agrupaciones.
        </Alert>
      )}

      <p className="text-sm text-tinta-suave">
        {resumen ? (
          <>
            {formatearNumero(resumen.agrupaciones)} agrupaciones · {formatearNumero(resumen.nodos)} nodos ({formatearNumero(resumen.nodos_gml)} GML ·{" "}
            {formatearNumero(resumen.nodos_gmle)} GMLE) · {formatearNumero(resumen.unidades)} unidades · {formatearNumero(resumen.equivalencias)}{" "}
            equivalencias ({formatearNumero(resumen.genericas)} genéricas) ·{" "}
            <strong className={totalAnomalias > 0 ? "text-alerta" : "text-exito"}>{formatearNumero(totalAnomalias)} anomalías</strong>
          </>
        ) : reporte.cargando ? (
          "Cargando el reporte…"
        ) : (
          "Sin datos."
        )}
      </p>

      {datos && (
        <>
          <BarraFiltros reporte={datos} filtros={filtros} onCambiar={cambiarFiltros} />

          <Tabs<Pestana>
            items={[
              { id: "resumen", label: "Resumen" },
              { id: "detalle", label: "Detalle" },
              { id: "anomalias", label: `Anomalías (${formatearNumero(totalAnomalias)})` },
            ]}
            activa={pestana}
            onCambiar={setPestana}
          />

          <div aria-busy={filtrando} className={filtrando ? "opacity-70 transition-opacity" : "transition-opacity"}>
            {pestana === "resumen" && (
              <ResumenTab reporte={datos} detalle={detalle} filtros={filtrosDiferidos} colores={colores} onVerEnDetalle={verEnDetalle} />
            )}
            {pestana === "detalle" && <DetalleTab detalle={detalle} filtros={filtrosDiferidos} colores={colores} />}
            {pestana === "anomalias" && <AnomaliasTab reporte={datos} detalle={detalle} filtros={filtrosDiferidos} colores={colores} />}
          </div>
        </>
      )}
    </div>
  );
}
