"use client";

import { memo, useMemo, useState } from "react";
import { COLUMNAS_RESUMEN } from "@/lib/reportes/descargas";
import {
  armarResumenAgrupaciones,
  filtrarEstructura,
  filtrarFilasResumen,
  ordenarResumen,
  siguienteOrden,
  type FilaDetalleGmle,
  type FiltrosGmle,
  type FilaResumenGmle,
  type OrdenGmle,
} from "@/lib/reportes/filtros";
import type { ReporteAgrupacionGmle } from "@/lib/reportes/tipos-api";
import type { MapaColores } from "@/lib/estacionalidad/colores";
import { formatearNumero } from "@/lib/formato";
import { BadgeTemporada } from "@/components/estacionalidad/temporada";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { Punto } from "@/components/ui/punto";
import { AgrupacionDetalle } from "./agrupacion-detalle";
import { HistogramaUnidades } from "./histograma-unidades";
import { AnomaliaBadges, BotonesDescarga, EnlaceCorreccion, RUTAS_CORRECCION, columnasDeTabla } from "./comunes";

const NUMERICA = "text-right tabular-nums";

/**
 * Pestaña Resumen: una fila por agrupación (y "Sin agrupación" al pie) con lo
 * que tiene en nodos GML, mixtos y unidades GMLE. Los conteos respetan los
 * filtros de género, mundo, nivel, texto y genéricas; al pulsar el nombre se
 * abre debajo el detalle de la agrupación. Arriba va el histograma de
 * unidades vendidas por mes y año, que sigue todos los filtros de la barra.
 */
export const ResumenTab = memo(function ResumenTab({
  reporte,
  detalle,
  filtros,
  colores,
  onVerEnDetalle,
}: {
  reporte: ReporteAgrupacionGmle;
  detalle: FilaDetalleGmle[];
  filtros: FiltrosGmle;
  colores: MapaColores;
  onVerEnDetalle: (clave: string) => void;
}) {
  const [orden, setOrden] = useState<OrdenGmle | null>(null);
  const [abierta, setAbierta] = useState<string | null>(null);

  const filasEstructura = useMemo(() => filtrarEstructura(detalle, filtros), [detalle, filtros]);
  const todas = useMemo(() => armarResumenAgrupaciones(reporte, filasEstructura), [reporte, filasEstructura]);
  const visibles = useMemo(() => {
    const valor = COLUMNAS_RESUMEN.find((c) => c.clave === orden?.clave)?.valor;
    return ordenarResumen(filtrarFilasResumen(todas, filtros, filasEstructura), valor, orden);
  }, [todas, filtros, filasEstructura, orden]);
  const nombres = useMemo(() => new Map(reporte.agrupaciones.map((a) => [a.id, a.nombre])), [reporte.agrupaciones]);

  const seleccionada = abierta ? (todas.find((f) => f.clave === abierta) ?? null) : null;

  const columnas = columnasDeTabla<FilaResumenGmle>(
    COLUMNAS_RESUMEN,
    {
      agrupacion: (f) =>
        f.id === null ? (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setAbierta(abierta === f.clave ? null : f.clave)}
              aria-expanded={abierta === f.clave}
              className="inline-flex items-center gap-2 font-medium text-alerta hover:underline"
            >
              <Punto tono="alerta" />
              {f.nombre}
            </button>
            <EnlaceCorreccion href={RUTAS_CORRECCION.faltantes}>Ir a Faltantes</EnlaceCorreccion>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAbierta(abierta === f.clave ? null : f.clave)}
            aria-expanded={abierta === f.clave}
            title="Ver el detalle de la agrupación"
            className="inline-flex items-center gap-2 text-left font-medium text-tinta hover:text-marca-oscura hover:underline"
          >
            <Punto color={colores.get(f.clave)?.pleno} />
            {f.nombre}
            {!f.activo && <Badge tono="alerta">Inactiva</Badge>}
          </button>
        ),
      temporada: (f) => (f.id === null ? <span className="text-tinta-suave">—</span> : <BadgeTemporada temporada={f.temporada} />),
      generos: (f) =>
        f.id === null ? (
          <span className="text-tinta-suave">—</span>
        ) : f.generos.length === 0 ? (
          <Badge tono="alerta">Sin género</Badge>
        ) : (
          <span className="flex flex-wrap gap-1">
            {f.generos.map((g) => (
              <Badge key={g}>{g}</Badge>
            ))}
          </span>
        ),
      nodos_gml: (f) => formatearNumero(f.nodos_gml),
      gml_mixtos: (f) => (f.nodos_gml_mixtos > 0 ? <strong className="font-semibold text-alerta">{formatearNumero(f.nodos_gml_mixtos)}</strong> : "0"),
      unidades_gmle: (f) => formatearNumero(f.unidades_gmle),
      equivalencias: (f) => formatearNumero(f.equivalencias),
      genericas: (f) => formatearNumero(f.genericas),
      lineas: (f) => formatearNumero(f.lineas),
      anomalias: (f) => <AnomaliaBadges codigos={f.anomalias} />,
    },
    { nodos_gml: NUMERICA, gml_mixtos: NUMERICA, unidades_gmle: NUMERICA, equivalencias: NUMERICA, genericas: NUMERICA, lineas: NUMERICA }
  );

  return (
    <div className="space-y-4">
      <HistogramaUnidades detalle={detalle} filtros={filtros} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-tinta-suave">
          {formatearNumero(visibles.length)} de {formatearNumero(todas.length)} filas · Pulsa el nombre de una agrupación para ver sus nodos.
        </p>
        <BotonesDescarga vista="resumen" columnas={COLUMNAS_RESUMEN} filas={visibles} />
      </div>

      <DataTable
        columnas={columnas}
        filas={visibles}
        claveFila={(f) => f.clave}
        vacio="Ninguna agrupación con estos filtros."
        ordenActual={orden ?? undefined}
        onOrdenar={(clave) => setOrden((o) => siguienteOrden(o, clave))}
        claseFila={(f) =>
          f.clave === abierta ? "bg-marca-suave/60" : f.id === null && f.equivalencias > 0 ? "bg-alerta-suave/40 hover:bg-alerta-suave/60" : "hover:bg-fondo/60"
        }
      />

      {seleccionada && (
        <AgrupacionDetalle
          // Una agrupación distinta arranca con los nodos cerrados.
          key={seleccionada.clave}
          fila={seleccionada}
          nodos={reporte.nodos}
          filasEstructura={filasEstructura}
          detalle={detalle}
          nombresAgrupacion={nombres}
          colores={colores}
          onVerEnDetalle={onVerEnDetalle}
          onCerrar={() => setAbierta(null)}
        />
      )}
    </div>
  );
});
