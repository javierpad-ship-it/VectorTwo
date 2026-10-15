"use client";

import { useMemo, useState } from "react";
import { calcularGeometriaCurvas, lecturaMes, type EstiloTrazo, type SerieGrafico } from "@/lib/curvas/grafico";

function dasharray(trazo: EstiloTrazo | undefined): string | undefined {
  if (trazo === "discontinuo") return "7 5";
  if (trazo === "punteado") return "10 3 2 3";
  return undefined;
}

/**
 * Serie mensual de UNA fila en unidades (ficha 07, paso 4): un trazo por año histórico (cada año con su `M(Z)`), el
 * año en curso (real + proyectado) y el siguiente, discontinuos. Reutiliza la geometría del gráfico de curvas de M6
 * (`calcularGeometriaCurvas`, modo unidades). La tabla año × mes de al lado trae las cifras exactas.
 */
export function GraficoMensualFila({ series }: { series: readonly SerieGrafico[] }) {
  const [mes, setMes] = useState<number | null>(null);
  const geom = useMemo(() => calcularGeometriaCurvas({ series, modo: "unidades" }, { ancho: 720, alto: 280 }), [series]);
  const anchoMes = geom.area.ancho / 12;
  if (series.length === 0) return <p className="text-sm text-tinta-suave">Sin serie mensual que dibujar.</p>;
  return (
    <figure className="space-y-2">
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-tinta" aria-label="Series del gráfico">
        {series.map((s) => (
          <li key={s.clave} className="inline-flex items-center gap-1.5">
            <svg width="22" height="8" aria-hidden>
              <line x1="1" x2="21" y1="4" y2="4" stroke={s.color} strokeWidth={Math.min(s.grosor ?? 2, 3.5)} strokeDasharray={dasharray(s.trazo)} />
            </svg>
            {s.etiqueta}
          </li>
        ))}
      </ul>
      <p className="min-h-5 text-xs text-tinta-suave" aria-live="polite">
        {mes === null ? "Pasa el cursor sobre un mes para ver el valor de cada serie." : lecturaMes(mes, series, "unidades")}
      </p>
      <div className="overflow-x-auto" role="region" aria-label="Serie mensual en unidades (desplazable)" tabIndex={0}>
        <svg viewBox={`0 0 ${geom.ancho} ${geom.alto}`} width="100%" style={{ minWidth: 520 }} className="block h-auto select-none" role="group" aria-label={`Unidades por mes de ${series.map((s) => s.etiqueta).join(", ")}`} onMouseLeave={() => setMes(null)}>
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
            <g key={l.clave} role="img" aria-label={l.aria} opacity={l.opacidad} pointerEvents="none">
              {l.tramos.map((d, i) => (
                <path key={i} d={d} fill="none" stroke={l.color} strokeWidth={l.grosor} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={dasharray(l.trazo)} />
              ))}
              {l.puntos.map((p) => (
                <circle key={p.mes} cx={p.x} cy={p.y} r={2.2} fill={l.color} />
              ))}
            </g>
          ))}
        </svg>
      </div>
    </figure>
  );
}
