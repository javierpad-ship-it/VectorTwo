"use client";

import { formatearPuntos } from "@/lib/formato";
import type { SerieGrafico } from "@/lib/curvas/grafico";
import { MESES_CORTOS } from "@/lib/reportes/histograma";
import type { AnalisisMarcaApi } from "@/lib/marcas-barrer/tipos-api";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { GraficoLineas } from "./grafico-lineas";
import { formatearFraccion, formatearTendencia, TEXTO_VEREDICTO_ESTACIONALIDAD } from "./vista";

const TONO = { similar: "exito", dudosa: "neutro", distinta: "alerta" } as const;

/**
 * Bloque 3 · Estacionalidad propia de la marca frente a la del GML (informativo). La propia sale de los años completos de la
 * marca; la del GML es el promedio de las curvas vigentes de los GML donde vende, ponderado por el reparto. El EAT (error
 * absoluto total, en puntos) dice cuánto se parecen: no cambia el reparto, ayuda a juzgarlo.
 */
export function BloqueEstacionalidad({ analisis }: { analisis: AnalisisMarcaApi }) {
  const e = analisis.estacionalidad;
  const series: SerieGrafico[] = [];
  if (e.propia) series.push({ clave: "propia", etiqueta: `Propia de ${analisis.marca.nombre}`, valores: e.propia, color: "var(--tinta)", grosor: 2.5, trazo: "continuo" });
  if (e.gml) series.push({ clave: "gml", etiqueta: "Del GML para esta marca", valores: e.gml, color: "var(--marca-oscura)", grosor: 2.5, trazo: "discontinuo" });

  return (
    <Card
      titulo="3. Estacionalidad propia frente a la del GML"
      descripcion="Informativo: cómo se reparten las ventas de la marca en los doce meses y cuánto se parece a la curva de los GML donde vende."
      acciones={
        e.eat_pp !== null && e.veredicto ? (
          <Badge tono={TONO[e.veredicto]}>
            EAT {formatearPuntos(e.eat_pp, 1)} pp · {TEXTO_VEREDICTO_ESTACIONALIDAD[e.veredicto]}
          </Badge>
        ) : undefined
      }
    >
      {series.length === 0 ? (
        <EmptyState
          titulo="No hay estacionalidad que comparar"
          detalle={analisis.avisos.includes("sin_anio_completo") ? "La marca no tiene un año completo con venta." : "Falta la curva vigente de las agrupaciones donde vende."}
        />
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-tinta-suave">
            {e.anios_completos.length > 0 ? `Años completos usados: ${e.anios_completos.join(", ")}.` : "Sin años completos."}{" "}
            {analisis.tendencia_total !== null && <>Tendencia total de la marca: <span className="font-medium text-tinta">{formatearTendencia(analisis.tendencia_total)}</span>.</>}
            {!e.gml && " No se pudo armar la curva del GML (falta la curva vigente de alguna agrupación)."}
            {!e.propia && " No se pudo calcular la propia (sin un año completo)."}
          </p>
          <GraficoLineas series={series} resumen={`Estacionalidad mensual: ${series.map((s) => s.etiqueta).join(" frente a ")}.`} />
          <details className="text-sm">
            <summary className="cursor-pointer text-tinta-suave hover:text-tinta">Ver las cifras exactas</summary>
            <div className="mt-2 overflow-x-auto rounded-lg border border-borde">
              <table className="w-full text-sm">
                <thead className="bg-neutro-suave text-left text-xs uppercase tracking-wide text-tinta-suave">
                  <tr>
                    <th className="px-3 py-2 font-medium">Curva</th>
                    {MESES_CORTOS.map((m) => (
                      <th key={m} className="px-3 py-2 text-right font-medium">
                        {m}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-borde">
                  {series.map((s) => (
                    <tr key={s.clave}>
                      <th scope="row" className="whitespace-nowrap px-3 py-2 text-left font-medium">
                        {s.etiqueta}
                      </th>
                      {s.valores.map((v, i) => (
                        <td key={i} className="px-3 py-2 text-right tabular-nums">
                          {formatearFraccion(v)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      )}
    </Card>
  );
}
