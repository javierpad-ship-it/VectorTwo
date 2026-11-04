"use client";

import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Columna } from "@/components/ui/data-table";
import { Tarjeta } from "@/components/importador/reporte";
import type { AgrupadorImportacionCompraApi } from "@/lib/compras/agrupadores/tipos-api";
import { plural } from "@/lib/formato";
import { hrefEmbarque, hrefViaje, ETIQUETA_AVISO_IMPORTACION_COMPRA_AGRUPADOR, ETIQUETA_RESULTADO_AGRUPADOR, textoAgrupadoresFila, totalesAgrupadores } from "./vista-agrupadores-compras";
import { ETIQUETA_MOTIVO_OMISION_COMPRA } from "./vista-importar";

/**
 * Lo que hicieron las columnas VIAJE, EMBARQUE y PAQUETE del archivo de compras (ficha 08b §3.9): una fila por cada fila del archivo que las
 * traía, con el viaje y el embarque que se asignan, el resultado (se asigna, sin cambio, omitida), los avisos y, al aplicar, las asignaciones
 * que no se pudieron completar (la compra se importó y queda sin ese agrupador: reimportar el mismo archivo lo completa). Las filas
 * omitidas por una columna de agrupador salen además en la tabla de omitidas del reporte, con su motivo.
 */
export function ReporteAgrupadoresCompras({ filas, aplicado }: { filas: readonly AgrupadorImportacionCompraApi[]; aplicado: boolean }) {
  if (filas.length === 0) return null;
  const t = totalesAgrupadores(filas);

  const columnas: Columna<AgrupadorImportacionCompraApi>[] = [
    { clave: "fila", titulo: "Fila", render: (f) => <span className="font-mono text-xs">{f.fila}</span> },
    {
      clave: "donde",
      titulo: "Viaje · embarque · paquete",
      render: (f) => (
        <span className="flex flex-wrap items-center gap-x-1.5 text-xs">
          {f.viaje && (
            <Link href={hrefViaje(f.viaje.id)} className="text-marca-oscura underline-offset-2 hover:underline">
              Viaje {f.viaje.codigo}
            </Link>
          )}
          {f.embarque && (
            <Link href={hrefEmbarque(f.embarque.id)} className="text-marca-oscura underline-offset-2 hover:underline">
              Embarque {f.embarque.codigo}
            </Link>
          )}
          {f.paquete && <span>P {f.paquete.codigo}</span>}
          {!f.viaje && !f.embarque && !f.paquete && <span className="text-tinta-suave">{textoAgrupadoresFila(f)}</span>}
        </span>
      ),
    },
    {
      clave: "resultado",
      titulo: "Resultado",
      render: (f) => {
        const r = ETIQUETA_RESULTADO_AGRUPADOR[f.resultado];
        return (
          <span className="flex flex-col gap-0.5">
            <span>
              <Badge tono={r.tono}>{aplicado ? r.aplicado : r.previsto}</Badge>
            </span>
            {f.motivo && <span className="text-[11px] text-alerta">{ETIQUETA_MOTIVO_OMISION_COMPRA[f.motivo]}</span>}
            {f.no_asignado && <span className="text-[11px] text-alerta">No se pudo asignar: {f.no_asignado.mensaje}</span>}
          </span>
        );
      },
    },
    {
      clave: "avisos",
      titulo: "Avisos",
      render: (f) =>
        f.avisos.length === 0 ? (
          <span className="text-tinta-suave">—</span>
        ) : (
          <span className="flex flex-col gap-0.5 text-[11px] text-alerta">
            {f.avisos.map((a) => (
              <span key={a}>⚠ {ETIQUETA_AVISO_IMPORTACION_COMPRA_AGRUPADOR[a]}</span>
            ))}
          </span>
        ),
    },
  ];

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">Viaje, embarque y paquete ({filas.length})</h3>
      {aplicado && t.no_asignado > 0 && (
        <Alert tono="alerta">
          {plural(t.no_asignado, "compra se importó", "compras se importaron")} pero no se pudo asignar su viaje o embarque. Reimporta el mismo archivo: se completa lo que falta sin duplicar nada.
        </Alert>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <Tarjeta titulo={aplicado ? "Asignadas" : "Se asignarán"} tono="exito" filas={[["Filas", t.asignado]]} />
        <Tarjeta titulo="Sin cambio" tono="neutro" filas={[["Filas", t.sin_cambio]]} />
        <Tarjeta titulo="Omitidas por su agrupador" tono={t.omitido > 0 ? "alerta" : "neutro"} filas={[["Filas", t.omitido]]} />
      </div>
      <DataTable columnas={columnas} filas={[...filas]} claveFila={(f) => String(f.fila)} />
    </div>
  );
}
