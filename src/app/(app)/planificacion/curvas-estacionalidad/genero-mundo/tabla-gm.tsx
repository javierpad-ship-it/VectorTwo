"use client";

import { useMemo } from "react";
import { descargarCsv } from "@/components/importador/csv";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MESES_CORTOS } from "@/lib/reportes/histograma";
import { formatearDecimal } from "@/lib/formato";
import type { DetalleGeneroMundoApi } from "@/lib/crecimientos/tipos-api";
import { filasCsvSeries, filasTablaAnioMes, formatearPctSigno, formatearUds, type ModoGM } from "./vista";

const TITULO_MODO: Record<ModoGM, string> = {
  unidades: "Unidades por mes",
  forma: "Forma: participación del mes en el total del año (%)",
  sin_nino: "Unidades por mes sin el efecto del Niño",
};

/**
 * Tabla año × mes de la curva de un género × mundo (también es la alternativa accesible del gráfico): la misma medida
 * que el gráfico (Unidades, Forma o Sin Niño), el total de cada año, su variación frente al año anterior y la descarga
 * del CSV (unidades, sin Niño y forma de todos los años). Los meses proyectados van en cursiva.
 */
export function TablaGM({
  id,
  detalle,
  modo,
  nombreArchivo,
}: {
  id: string;
  detalle: Pick<DetalleGeneroMundoApi, "series" | "forma_tipica">;
  modo: ModoGM;
  nombreArchivo: string;
}) {
  const filas = useMemo(() => filasTablaAnioMes(detalle, modo), [detalle, modo]);
  const celda = (v: number | null) => (v === null ? "—" : modo === "forma" ? formatearDecimal(v, 1) : formatearUds(v));

  function descargar() {
    const { campos, datos } = filasCsvSeries(detalle);
    descargarCsv(campos, datos, nombreArchivo);
  }

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <Button variante="secundario" tamano="sm" onClick={descargar}>
          Descargar CSV
        </Button>
      </div>
      <div className="overflow-x-auto rounded-lg border border-borde" role="region" aria-label="Tabla año por mes (desplazable)" tabIndex={0}>
        <table id={id} className="w-full text-sm">
          <caption className="sr-only">{TITULO_MODO[modo]}, con el total de cada año y su variación frente al año anterior.</caption>
          <thead className="bg-neutro-suave text-xs text-tinta-suave">
            <tr>
              <th scope="col" className="sticky left-0 z-10 min-w-28 bg-neutro-suave px-3 py-2 text-left font-medium uppercase tracking-wide">
                Año
              </th>
              {MESES_CORTOS.map((m) => (
                <th key={m} scope="col" className="min-w-14 px-2 py-2 text-right font-medium uppercase">
                  {m}
                </th>
              ))}
              <th scope="col" className="min-w-24 px-3 py-2 text-right font-medium">
                Total
              </th>
              <th scope="col" className="min-w-24 px-3 py-2 text-right font-medium">
                Var. año anterior
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-borde tabular-nums">
            {filas.map((f) => (
              <tr key={f.anio} className="hover:bg-fondo/60">
                <th scope="row" className="sticky left-0 z-10 bg-superficie px-3 py-1.5 text-left font-semibold text-tinta">
                  {f.anio}
                  {f.incompleto && (
                    <span className="mt-0.5 block">
                      <Badge tono="neutro">con meses proyectados</Badge>
                    </span>
                  )}
                </th>
                {f.valores.map((v, i) => (
                  <td
                    key={i}
                    className={`px-2 py-1.5 text-right ${f.origen[i] === "proyectado" ? "italic text-tinta-suave" : ""}`}
                    title={v === null ? "Sin dato" : f.origen[i] === "proyectado" ? "Mes proyectado (no es venta real)" : undefined}
                  >
                    {celda(v)}
                  </td>
                ))}
                <td className="px-3 py-1.5 text-right font-semibold">{modo === "forma" ? "100 %" : formatearUds(f.total)}</td>
                <td className="px-3 py-1.5 text-right" title={f.incompleto && f.variacion !== null ? "El total incluye meses proyectados" : undefined}>
                  {f.variacion === null ? "—" : `${formatearPctSigno(f.variacion)}${f.incompleto ? "*" : ""}`}
                </td>
              </tr>
            ))}
            {modo === "forma" && detalle.forma_tipica && detalle.forma_tipica.length === 12 && (
              <tr className="bg-neutro-suave/50">
                <th scope="row" className="sticky left-0 z-10 bg-neutro-suave px-3 py-1.5 text-left font-semibold text-marca-oscura">
                  Forma típica
                </th>
                {detalle.forma_tipica.map((v, i) => (
                  <td key={i} className="px-2 py-1.5 text-right font-medium text-marca-oscura">
                    {formatearDecimal(v, 1)}
                  </td>
                ))}
                <td className="px-3 py-1.5 text-right text-tinta-suave">100 %</td>
                <td />
              </tr>
            )}
            {filas.length === 0 && (
              <tr>
                <td colSpan={15} className="px-3 py-6 text-center text-tinta-suave">
                  Este género × mundo no tiene venta comparable en los años publicados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-tinta-suave">
        {TITULO_MODO[modo]}. En cursiva, los meses proyectados con la proyección de referencia; «—», mes sin dato. El total de un año con meses proyectados no es venta real
        completa (*). La forma típica es el promedio de la forma de los años completos normales.
      </p>
    </div>
  );
}
