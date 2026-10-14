"use client";

import { memo, useMemo, useState, type ReactNode } from "react";
import {
  COLUMNAS_AGRUPACIONES_VACIAS,
  COLUMNAS_DETALLE,
  COLUMNAS_LINEAS_PARTIDAS,
  COLUMNAS_NODOS_MIXTOS,
  type ColumnaGmle,
  type VistaDescarga,
} from "@/lib/reportes/descargas";
import {
  ANOMALIAS_DE_EQUIVALENCIA,
  armarNodosMixtos,
  filtrarAgrupacionesVacias,
  filtrarAnomaliasDeEquivalencia,
  filtrarLineasPartidas,
  filtrarNodosPorFilas,
  filtrarReporte,
  ordenarFilas,
  siguienteOrden,
  type FilaDetalleGmle,
  type FilaNodoMixtoGmle,
  type FiltrosGmle,
  type OrdenGmle,
} from "@/lib/reportes/filtros";
import { ETIQUETA_ANOMALIA_GMLE, type AgrupacionGmle, type AnomaliaGmle, type LineaPartidaGmle, type ReporteAgrupacionGmle } from "@/lib/reportes/tipos-api";
import type { MapaColores } from "@/lib/estacionalidad/colores";
import { formatearNumero } from "@/lib/formato";
import { BadgeTemporada } from "@/components/estacionalidad/temporada";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Chips, type ChipItem } from "@/components/ui/chips";
import { DataTable, type Columna } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { BotonesDescarga, EnlaceCorreccion, PieMostrarMas, RUTAS_CORRECCION, columnasDeTabla, useFilasLimitadas } from "./comunes";
import { claseFilaDetalle, columnasDetalle } from "./detalle-tab";

type FiltroCodigo = "todas" | AnomaliaGmle;

/** Un bloque de la pestaña: título con conteo, enlaces a donde se corrige, descarga y tabla ordenable. */
function Bloque<T>({
  titulo,
  descripcion,
  enlaces,
  vista,
  columnas,
  columnasPantalla,
  filas,
  claveFila,
  vacio,
  claseFila,
  extra,
}: {
  titulo: string;
  descripcion: string;
  enlaces: ReactNode;
  vista: VistaDescarga;
  /** Las de la descarga: también dan el criterio de orden. */
  columnas: readonly ColumnaGmle<T>[];
  columnasPantalla: Columna<T>[];
  filas: T[];
  claveFila: (f: T) => string;
  vacio: string;
  claseFila?: (f: T) => string | undefined;
  extra?: ReactNode;
}) {
  const [orden, setOrden] = useState<OrdenGmle | null>(null);
  const visibles = useMemo(() => ordenarFilas(filas, columnas.find((c) => c.clave === orden?.clave)?.valor, orden), [filas, columnas, orden]);
  // Solo se pintan las primeras filas; la descarga lleva todas las `visibles`.
  const pagina = useFilasLimitadas(visibles);
  return (
    <Card
      titulo={`${titulo} (${formatearNumero(filas.length)})`}
      descripcion={descripcion}
      acciones={<BotonesDescarga vista={vista} columnas={columnas} filas={visibles} />}
    >
      <div className="space-y-3">
        <div className="flex flex-wrap gap-x-4 gap-y-1">{enlaces}</div>
        {extra}
        <DataTable
          columnas={columnasPantalla}
          filas={pagina.mostradas}
          claveFila={claveFila}
          vacio={vacio}
          claseFila={claseFila}
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
    </Card>
  );
}

/**
 * Pestaña Anomalías: cuatro bloques (líneas partidas, nodos GML mixtos,
 * equivalencias con aviso propio y agrupaciones vacías), todos con la barra de
 * filtros y con enlaces a M3 y al Árbol, que es donde se corrige. Solo lectura.
 */
export const AnomaliasTab = memo(function AnomaliasTab({
  reporte,
  detalle,
  filtros,
  colores,
}: {
  reporte: ReporteAgrupacionGmle;
  detalle: FilaDetalleGmle[];
  filtros: FiltrosGmle;
  colores: MapaColores;
}) {
  const [codigo, setCodigo] = useState<FiltroCodigo>("todas");

  // Los bloques 1 y 2 siguen a las equivalencias filtradas (una línea o un nodo se muestran si alguna de sus filas pasa).
  const filtradas = useMemo(() => filtrarReporte(detalle, filtros), [detalle, filtros]);
  const lineas = useMemo(() => filtrarLineasPartidas(reporte.lineas_partidas, filtradas), [reporte.lineas_partidas, filtradas]);
  const mixtos = useMemo(
    () => armarNodosMixtos(filtrarNodosPorFilas(reporte.nodos, filtradas), reporte.agrupaciones),
    [reporte.nodos, reporte.agrupaciones, filtradas]
  );
  const equivalencias = useMemo(() => filtrarAnomaliasDeEquivalencia(detalle, filtros, codigo), [detalle, filtros, codigo]);
  const conteos = useMemo(() => {
    const r = { todas: filtrarAnomaliasDeEquivalencia(detalle, filtros).length } as Record<FiltroCodigo, number>;
    for (const c of ANOMALIAS_DE_EQUIVALENCIA) r[c] = filtrarAnomaliasDeEquivalencia(detalle, filtros, c).length;
    return r;
  }, [detalle, filtros]);
  const vacias = useMemo(() => filtrarAgrupacionesVacias(reporte.agrupaciones, filtros), [reporte.agrupaciones, filtros]);

  const columnasEquivalencias = useMemo(() => columnasDetalle(colores), [colores]);

  const total = lineas.length + mixtos.length + conteos.todas + vacias.length;
  if (total === 0) {
    return <EmptyState titulo="Sin anomalías con estos filtros." detalle="Ninguna línea partida, nodo mixto, equivalencia con aviso ni agrupación vacía." />;
  }

  const chipsCodigo: ChipItem<FiltroCodigo>[] = [
    { id: "todas", label: "Todas", conteo: conteos.todas },
    ...ANOMALIAS_DE_EQUIVALENCIA.map((c) => ({ id: c, label: ETIQUETA_ANOMALIA_GMLE[c], conteo: conteos[c] })),
  ];

  return (
    <div className="space-y-6">
      <Bloque<LineaPartidaGmle>
        titulo="Líneas partidas"
        descripcion="Género · línea con equivalencias en dos o más agrupaciones (todos sus mundos). Puede ser deliberado: el detalle muestra los mundos para juzgarlo."
        enlaces={<EnlaceCorreccion href={RUTAS_CORRECCION.asignacion}>Corregir en Asignación (M3)</EnlaceCorreccion>}
        vista="anomalias-lineas-partidas"
        columnas={COLUMNAS_LINEAS_PARTIDAS}
        columnasPantalla={columnasDeTabla(
          COLUMNAS_LINEAS_PARTIDAS,
          {
            agrupaciones: (f) => formatearNumero(f.agrupaciones.length),
            detalle: (f) => (
              <ul className="space-y-0.5">
                {f.agrupaciones.map((a) => (
                  <li key={a.id}>
                    <strong className="font-medium">{a.nombre}</strong>{" "}
                    <span className="text-tinta-suave">
                      ({a.equivalencias}: {a.mundos.join(", ")})
                    </span>
                  </li>
                ))}
              </ul>
            ),
          },
          { agrupaciones: "text-right tabular-nums" }
        )}
        filas={lineas}
        claveFila={(f) => `${f.genero_id}:${f.linea_id}`}
        vacio="Sin líneas partidas con estos filtros."
      />

      <Bloque<FilaNodoMixtoGmle>
        titulo="Nodos GML mixtos"
        descripcion="Nodos de nivel GML con equivalencias en dos o más agrupaciones: M7 los lee como una unidad con curva mezclada. Corrige la asignación o pásalos a GMLE."
        enlaces={
          <>
            <EnlaceCorreccion href={RUTAS_CORRECCION.asignacion}>Corregir en Asignación (M3)</EnlaceCorreccion>
            <EnlaceCorreccion href={RUTAS_CORRECCION.arbol}>Cambiar el nivel en el Árbol</EnlaceCorreccion>
          </>
        }
        vista="anomalias-nodos-mixtos"
        columnas={COLUMNAS_NODOS_MIXTOS}
        columnasPantalla={columnasDeTabla(
          COLUMNAS_NODOS_MIXTOS,
          {
            ruta: (f) => <span className="font-medium">{f.nodo.ruta}</span>,
            mayoritaria: (f) => f.mayoritaria || <span className="text-tinta-suave">Empate</span>,
          },
          { equivalencias: "text-right tabular-nums" }
        )}
        filas={mixtos}
        claveFila={(f) => f.nodo.id}
        vacio="Sin nodos mixtos con estos filtros."
      />

      <Bloque<FilaDetalleGmle>
        titulo="Equivalencias con aviso"
        descripcion="Sin agrupación (o con agrupación inactiva), género que su agrupación no incluye y genéricas con agrupación distinta de la mayoría de las reales de su nodo."
        enlaces={
          <>
            <EnlaceCorreccion href={RUTAS_CORRECCION.faltantes}>Ir a Faltantes (M3)</EnlaceCorreccion>
            <EnlaceCorreccion href={RUTAS_CORRECCION.asignacion}>Corregir en Asignación (M3)</EnlaceCorreccion>
          </>
        }
        vista="anomalias-equivalencias"
        columnas={COLUMNAS_DETALLE}
        columnasPantalla={columnasEquivalencias}
        filas={equivalencias}
        claveFila={(f) => f.id}
        vacio="Sin equivalencias con aviso con estos filtros."
        claseFila={claseFilaDetalle}
        extra={<Chips<FiltroCodigo> items={chipsCodigo} activo={codigo} onCambiar={setCodigo} etiqueta="Filtrar por aviso de equivalencia" />}
      />

      <Bloque<AgrupacionGmle>
        titulo="Agrupaciones vacías"
        descripcion="Agrupaciones activas sin ninguna equivalencia vigente: si ya no se usan, desactívalas; si faltan equivalencias, asígnalas."
        enlaces={<EnlaceCorreccion href={RUTAS_CORRECCION.agrupaciones}>Ir a Agrupaciones (M3)</EnlaceCorreccion>}
        vista="anomalias-agrupaciones-vacias"
        columnas={COLUMNAS_AGRUPACIONES_VACIAS}
        columnasPantalla={columnasDeTabla(COLUMNAS_AGRUPACIONES_VACIAS, {
          temporada: (f) => <BadgeTemporada temporada={f.temporada} />,
          generos: (f) =>
            f.generos.length === 0 ? (
              <Badge tono="alerta">Sin género</Badge>
            ) : (
              <span className="flex flex-wrap gap-1">
                {f.generos.map((g) => (
                  <Badge key={g.id}>{g.nombre}</Badge>
                ))}
              </span>
            ),
        })}
        filas={vacias}
        claveFila={(f) => f.id}
        vacio="Sin agrupaciones vacías con estos filtros."
      />
    </div>
  );
});
