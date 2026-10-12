"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { formatearNumero, mensajeError } from "@/lib/formato";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, type Columna } from "@/components/ui/data-table";
import type { Aviso, FilaConciliacion, ResumenExclusion } from "@/lib/ventas/tipos";
import type { CargaApi, DetalleCargaRespuesta, EstadoCarga } from "@/lib/ventas/tipos-api";
import { ConciliacionGuardada, ListaAvisos, TablaResumenExclusiones } from "./detalle-mes";
import { formatearEntero, formatearFechaHora, formatearSoles, nombrePeriodo } from "./comunes";

const ETIQUETA_ESTADO: Record<EstadoCarga, string> = {
  en_curso: "En curso",
  publicada: "Publicada",
  reemplazada: "Reemplazada",
  retirada: "Retirada",
  abandonada: "Abandonada",
  fallida: "Fallida (no conciliaba)",
};

const lista = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/**
 * Detalle de la carga publicada de un mes (`GET /api/ventas/cargas/[id]`): el
 * reporte que se guardó al cargar (conciliación, exclusiones y avisos de
 * aquella carga) y el historial de cargas anteriores del mes.
 */
export function DetalleCarga({ id, periodo, onCerrar }: { id: string; periodo: string; onCerrar: () => void }) {
  const [detalle, setDetalle] = useState<DetalleCargaRespuesta | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vigente = true;
    api
      .get<DetalleCargaRespuesta>(`/api/ventas/cargas/${id}`)
      .then((d) => {
        if (vigente) setDetalle(d);
      })
      .catch((e: unknown) => {
        if (vigente) setError(mensajeError(e));
      });
    return () => {
      vigente = false;
    };
  }, [id]);

  const reporte = detalle?.reporte ?? {};
  const conciliacion = lista<FilaConciliacion>(reporte.conciliacion);
  const resumen = lista<ResumenExclusion>(reporte.resumen_exclusiones);
  const avisos = lista<Aviso>(reporte.avisos);
  const marcas = lista<{ nombre: string }>(reporte.marcas_nuevas);
  const reasignadas = (reporte.reasignadas ?? null) as { filas?: number; venta_soles?: number; stock_valorizado?: number } | null;
  const filasReasignadas = typeof reasignadas?.filas === "number" ? reasignadas.filas : 0;

  const columnasHistorial: Columna<CargaApi>[] = [
    { clave: "estado", titulo: "Estado", render: (h) => <Badge tono={h.estado === "fallida" ? "alerta" : "neutro"}>{ETIQUETA_ESTADO[h.estado] ?? h.estado}</Badge> },
    { clave: "fecha", titulo: "Fecha", render: (h) => <span className="whitespace-nowrap text-xs">{formatearFechaHora(h.publicada_at ?? h.created_at)}</span> },
    { clave: "archivo", titulo: "Archivo", render: (h) => <span className="text-xs">{h.archivo_nombre ?? "—"}</span> },
    { clave: "quien", titulo: "Quién", render: (h) => <span className="text-xs">{h.usuario_nombre ?? "—"}</span> },
    { clave: "filas", titulo: "Filas", className: "text-right font-mono", render: (h) => formatearEntero(h.filas) },
    { clave: "venta", titulo: "Venta", className: "text-right font-mono", render: (h) => formatearSoles(h.venta_soles) },
  ];

  return (
    <div className="space-y-5 rounded-xl border border-borde bg-superficie p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold">Detalle de {nombrePeriodo(periodo)}</h3>
        <Button variante="secundario" tamano="sm" onClick={onCerrar}>
          Cerrar detalle
        </Button>
      </div>

      {error && <Alert>No se pudo leer el detalle: {error}</Alert>}
      {!detalle && !error && <p className="text-sm text-tinta-suave">Cargando el detalle…</p>}

      {detalle && (
        <>
          <p className="text-sm text-tinta-suave">
            Archivo <strong className="text-tinta">{detalle.carga.archivo_nombre ?? "—"}</strong> cargado por {detalle.carga.usuario_nombre ?? "—"} el{" "}
            {formatearFechaHora(detalle.carga.publicada_at)} · {formatearNumero(detalle.carga.filas ?? 0)} filas.
            {detalle.carga.incompleto && " Se cargó forzado con errores de 2 % o más: queda marcado como Incompleto hasta que se recargue."}
          </p>

          {conciliacion.length > 0 ? (
            <div className="space-y-2">
              <h4 className="text-sm font-semibold">Conciliación al cargar</h4>
              <ConciliacionGuardada filas={conciliacion} />
            </div>
          ) : (
            <p className="text-sm text-tinta-suave">Esta carga no guardó el detalle de la conciliación.</p>
          )}

          {filasReasignadas > 0 && (
            <Alert tono="info">
              <strong>{formatearNumero(filasReasignadas)} filas reasignadas por mapeo</strong> (venta {formatearSoles(reasignadas?.venta_soles)}, stock a costo {formatearSoles(reasignadas?.stock_valorizado)}): iban a errores
              y se cargaron al destino de un mapeo. El detalle origen → destino está en los avisos de abajo. Si cambias o eliminas el mapeo, este mes no cambia hasta que lo recargues.
            </Alert>
          )}

          {resumen.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-semibold">Exclusiones</h4>
              <TablaResumenExclusiones resumen={resumen} />
            </div>
          )}

          {avisos.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-semibold">Avisos y notas de aquella carga</h4>
              <ListaAvisos avisos={avisos} />
            </div>
          )}

          {marcas.length > 0 && <p className="text-sm text-tinta-suave">Esa carga creó {formatearNumero(marcas.length)} marcas nuevas.</p>}

          <div className="space-y-2">
            <h4 className="text-sm font-semibold">Otras cargas de este mes</h4>
            <DataTable columnas={columnasHistorial} filas={detalle.historial} claveFila={(h) => h.id} vacio="No hay otras cargas de este mes." />
          </div>
        </>
      )}
    </div>
  );
}
