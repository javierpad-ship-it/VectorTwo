"use client";

import { useId, useMemo, useState } from "react";
import { calcularGeometriaCurvas, lecturaMes, type SerieGrafico } from "@/lib/curvas/grafico";

/**
 * Gráfico de líneas mensuales (enero a diciembre) en SVG propio, sin librerías: una línea por serie, a la misma escala,
 * con la geometría de `src/lib/curvas/grafico.ts` (la misma de las curvas de M6). Lo usan el peso mensual de la marca en un
 * GML (una línea por año, bloque 2) y la estacionalidad propia frente a la del GML (bloque 3). Los colores de las series
 * llegan de quien lo usa (variables del tema o la paleta por año); trazos y leyenda no dependen solo del color: la
 * leyenda nombra cada serie y quien lo usa ofrece las cifras exactas en una tabla.
 */
export function GraficoLineas({ series, resumen }: { series: readonly SerieGrafico[]; resumen: string }) {
  const [mes, setMes] = useState<number | null>(null);
  const idLeyenda = useId();
  const geom = useMemo(() => calcularGeometriaCurvas({ series, modo: "participacion" }), [series]);
  const anchoMes = geom.area.ancho / 12;

  return (
    <figure className="space-y-2">
      <ul id={idLeyenda} className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-tinta" aria-label="Leyenda del gráfico">
        {series.map((s) => (
          <li key={s.clave} className="inline-flex items-center gap-1.5">
            <svg width="22" height="8" aria-hidden>
              <line x1="1" x2="21" y1="4" y2="4" stroke={s.color} strokeWidth={2.5} strokeDasharray={s.trazo === "discontinuo" ? "5 3" : s.trazo === "punteado" ? "2 2" : undefined} />
            </svg>
            {s.etiqueta}
          </li>
        ))}
      </ul>
      <div className="min-h-6 text-sm" aria-live="polite">
        {mes === null ? <p className="text-tinta-suave">Pasa el cursor sobre un mes para ver el valor de cada serie.</p> : <p className="text-tinta">{lecturaMes(mes, series, "participacion")}</p>}
      </div>
      <div className="overflow-x-auto" role="region" aria-label="Gráfico de líneas mensuales (desplazable)" tabIndex={0}>
        <svg viewBox={`0 0 ${geom.ancho} ${geom.alto}`} width="100%" style={{ minWidth: 480 }} className="block h-auto select-none" role="group" aria-label={resumen} onMouseLeave={() => setMes(null)}>
          {geom.ticksY.map((t) => (
            <g key={t.valor}>
              <line x1={geom.area.x} x2={geom.area.x + geom.area.ancho} y1={t.y} y2={t.y} className={t.valor === 0 ? "stroke-tinta-suave" : "stroke-borde"} strokeWidth={1} />
              <text x={geom.area.x - 8} y={t.y} textAnchor="end" dominantBaseline="middle" fontSize={11} className="fill-tinta-suave">
                {t.etiqueta}
              </text>
            </g>
          ))}
          {geom.ticksX.map((t) => (
            <text key={t.mes} x={t.x} y={geom.alto - geom.margen.inf + 18} textAnchor="middle" fontSize={11} className="fill-tinta-suave">
              {t.etiqueta}
            </text>
          ))}
          {geom.ticksX.map((t) => (
            <rect key={`h${t.mes}`} x={geom.area.x + (t.mes - 1) * anchoMes} y={geom.area.y} width={anchoMes} height={geom.area.alto} fill={mes === t.mes ? "var(--neutro-suave)" : "transparent"} fillOpacity={0.7} onMouseEnter={() => setMes(t.mes)} />
          ))}
          {geom.lineas.map((l) => (
            <g key={l.clave} role="img" aria-label={l.aria} pointerEvents="none">
              {l.tramos.map((d, i) => (
                <path key={i} d={d} fill="none" stroke={l.color} strokeWidth={l.grosor} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={l.trazo === "discontinuo" ? "7 5" : l.trazo === "punteado" ? "2 4" : undefined} />
              ))}
              {l.puntos.map((p) => (
                <circle key={p.mes} cx={p.x} cy={p.y} r={2.4} fill={l.color} />
              ))}
            </g>
          ))}
        </svg>
      </div>
    </figure>
  );
}
