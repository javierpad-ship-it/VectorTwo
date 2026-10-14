"use client";

import { memo, useMemo, useState } from "react";
import { COLUMNAS_DETALLE, ETIQUETA_AGRUPACION_NODO } from "@/lib/reportes/descargas";
import {
  filtrarReporte,
  ordenarFilas,
  siguienteOrden,
  tieneAnomaliaAlta,
  type FilaDetalleGmle,
  type FiltrosGmle,
  type OrdenGmle,
} from "@/lib/reportes/filtros";
import type { MapaColores } from "@/lib/estacionalidad/colores";
import { formatearNumero } from "@/lib/formato";
import { BadgeAgrupacion } from "@/components/estacionalidad/badge-agrupacion";
import { BadgeTemporada } from "@/components/estacionalidad/temporada";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { AnomaliaBadges, BotonesDescarga, PieMostrarMas, columnasDeTabla, useFilasLimitadas } from "./comunes";

/** Clase de una fila del Detalle: las inactivas atenuadas y las de anomalía alta resaltadas. */
export function claseFilaDetalle(f: FilaDetalleGmle): string {
  if (!f.activo || !f.vigente) return "opacity-55 hover:bg-fondo/60";
  if (tieneAnomaliaAlta(f)) return "bg-alerta-suave/50 hover:bg-alerta-suave/80";
  return "hover:bg-fondo/60";
}

const SiNo = ({ v }: { v: boolean }) => <span className={v ? "" : "text-tinta-suave"}>{v ? "Sí" : "No"}</span>;

/**
 * Columnas del Detalle: las de la descarga (`COLUMNAS_DETALLE`, misma clave y
 * orden) con badge de agrupación, de genérica y de anomalías en pantalla.
 * Compartidas con el bloque "Equivalencias" de la pestaña Anomalías.
 */
export function columnasDetalle(colores: MapaColores) {
  return columnasDeTabla<FilaDetalleGmle>(
    COLUMNAS_DETALLE,
    {
      agrupacion: (f) => (
        <BadgeAgrupacion agrupacion={f.agrupacion_id ? { id: f.agrupacion_id, nombre: f.agrupacion, activo: f.agrupacion_activa } : null} colores={colores} />
      ),
      temporada: (f) => <BadgeTemporada temporada={f.temporada} />,
      nivel: (f) => <Badge tono={f.nivel === "GMLE" ? "marca" : "neutro"}>{f.nivel}</Badge>,
      equivalencia: (f) => (
        <span className="flex items-center gap-2">
          {f.equivalencia}
          {f.es_generica && <Badge tono="neutro">Genérica</Badge>}
        </span>
      ),
      generica: (f) => <SiNo v={f.es_generica} />,
      activa: (f) => <SiNo v={f.activo} />,
      nodo_vigente: (f) => <SiNo v={f.vigente} />,
      agrupacion_nodo: (f) =>
        f.agrupacion_nodo === null ? (
          <span className="text-tinta-suave">—</span>
        ) : f.agrupacion_nodo === "mixta" ? (
          <Badge tono="alerta">{ETIQUETA_AGRUPACION_NODO.mixta}</Badge>
        ) : (
          ETIQUETA_AGRUPACION_NODO[f.agrupacion_nodo]
        ),
      anomalias: (f) => <AnomaliaBadges codigos={f.anomalias} />,
    },
    { equivalencia: "whitespace-nowrap", codigo: "font-mono text-xs" }
  );
}

/**
 * Pestaña Detalle: una fila por equivalencia, ordenable por cualquier columna
 * (orden inicial: el del contrato). La descarga lleva las mismas columnas, lo
 * filtrado y el orden visible.
 */
export const DetalleTab = memo(function DetalleTab({ detalle, filtros, colores }: { detalle: FilaDetalleGmle[]; filtros: FiltrosGmle; colores: MapaColores }) {
  const [orden, setOrden] = useState<OrdenGmle | null>(null);

  const filtradas = useMemo(() => filtrarReporte(detalle, filtros), [detalle, filtros]);
  const visibles = useMemo(
    () => ordenarFilas(filtradas, COLUMNAS_DETALLE.find((c) => c.clave === orden?.clave)?.valor, orden),
    [filtradas, orden]
  );
  const columnas = useMemo(() => columnasDetalle(colores), [colores]);
  // En pantalla solo las primeras filas (miles de filas son decenas de miles de nodos del DOM); la descarga lleva todas las `visibles`.
  const pagina = useFilasLimitadas(visibles);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-tinta-suave">
          {formatearNumero(visibles.length)} de {formatearNumero(detalle.length)} filas
          {!filtros.incluirInactivos && " (solo vigentes)"}
          {pagina.hayMas && ` · en pantalla, las primeras ${formatearNumero(pagina.mostradas.length)}`} · Las filas con anomalía de prioridad alta van resaltadas; las inactivas, atenuadas.
        </p>
        <BotonesDescarga vista="detalle" columnas={COLUMNAS_DETALLE} filas={visibles} />
      </div>
      <DataTable
        columnas={columnas}
        filas={pagina.mostradas}
        claveFila={(f) => f.id}
        vacio="Ninguna equivalencia con estos filtros."
        claseFila={claseFilaDetalle}
        ordenActual={orden ?? undefined}
        onOrdenar={(clave) => setOrden((o) => siguienteOrden(o, clave))}
      />
      <PieMostrarMas
        mostradas={pagina.mostradas.length}
        total={pagina.total}
        siguiente={pagina.siguiente}
        hayMas={pagina.hayMas}
        onMostrarMas={pagina.mostrarMas}
      />
    </div>
  );
});
