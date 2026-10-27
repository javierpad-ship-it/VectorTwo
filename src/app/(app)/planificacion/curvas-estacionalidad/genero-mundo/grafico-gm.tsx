"use client";

import { useMemo, useState } from "react";
import { calcularGeometriaCurvas, lecturaMes, type EstiloTrazo } from "@/lib/curvas/grafico";
import type { DetalleGeneroMundoApi } from "@/lib/crecimientos/tipos-api";
import { Chips, type ChipItem } from "@/components/ui/chips";
import { MODOS_GM, bandasDelNino, seriesDelGrafico, type ModoGM } from "./vista";

function dasharray(trazo: EstiloTrazo | undefined, donde: "leyenda" | "linea"): string | undefined {
  if (trazo === "discontinuo") return donde === "linea" ? "7 5" : "5 3";
  if (trazo === "punteado") return donde === "linea" ? "10 3 2 3" : "6 2 1.5 2";
  return undefined;
}

const TEXTO_MODO: Record<ModoGM, string> = {
  unidades: "Unidades vendidas por mes de las mismas tiendas",
  forma: "Participación del mes en el total de su año",
  sin_nino: "Unidades por mes con el efecto del Niño quitado (cada mes dividido por el factor de su temporada)",
};

/**
 * Gráfico de la curva de venta de un género × mundo (06d, §4.1): una línea por año (el año en curso, real continuo y
 * proyectado discontinuo), las bandas del Niño por temporada con su factor (y «factor parcial» si cubre solo ene–`k`) y
 * los modos Unidades / Forma (%) / Sin Niño (en Forma se añade la forma típica). SVG propio: la geometría sale de
 * `src/lib/curvas/grafico.ts`. La tabla año × mes del detalle repite las cifras exactas.
 */
export function GraficoGM({
  detalle,
  modo,
  onModo,
  idTabla,
}: {
  detalle: Pick<DetalleGeneroMundoApi, "series" | "forma_tipica" | "bandas_nino">;
  modo: ModoGM;
  onModo: (m: ModoGM) => void;
  idTabla: string;
}) {
  const [apagados, setApagados] = useState<Record<string, boolean>>({});
  const [mes, setMes] = useState<number | null>(null);

  const series = useMemo(() => seriesDelGrafico(detalle, modo), [detalle, modo]);
  const activas = useMemo(() => series.filter((s) => !apagados[s.grupo]), [series, apagados]);
  const bandas = useMemo(() => bandasDelNino(detalle), [detalle]);
  const modoGrafico = modo === "forma" ? "participacion" : "unidades";
  const geom = useMemo(() => calcularGeometriaCurvas({ series: activas, modo: modoGrafico }, { ancho: 720, alto: 340 }), [activas, modoGrafico]);

  const items: ChipItem<ModoGM>[] = MODOS_GM.map((m) => ({ id: m.id, label: m.label }));
  const anchoMes = geom.area.ancho / 12;
  const x0Mes = (m: number) => geom.area.x + (m - 1) * anchoMes;
  const resumen = `Curva de venta mensual de ${activas.map((s) => s.etiqueta).join(", ") || "ninguna serie"}. ${TEXTO_MODO[modo]}. La tabla año por mes trae las cifras exactas.`;

  return (
    <figure className="space-y-3" aria-describedby={idTabla}>
      <Chips<ModoGM> items={items} activo={modo} onCambiar={onModo} etiqueta="Qué mostrar en el gráfico" />

      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm" aria-label="Series del gráfico (pulsa para encender o apagar)">
        {series.map((s) => {
          const on = !apagados[s.grupo];
          return (
            <li key={s.clave}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => setApagados((a) => ({ ...a, [s.grupo]: on }))}
                className={`inline-flex items-center gap-1.5 rounded px-1 py-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca ${on ? "text-tinta" : "text-tinta-suave line-through opacity-70"}`}
              >
                <svg width="22" height="8" aria-hidden>
                  <line x1="1" x2="21" y1="4" y2="4" stroke={s.color} strokeWidth={Math.min(s.grosor ?? 2, 3.5)} strokeDasharray={dasharray(s.trazo, "leyenda")} />
                </svg>
                {s.etiqueta}
              </button>
            </li>
          );
        })}
      </ul>

      <div className="min-h-9 text-sm" aria-live="polite">
        {mes === null ? <p className="text-tinta-suave">Pasa el cursor sobre un mes para ver el valor de cada serie.</p> : <p className="text-tinta">{lecturaMes(mes, activas, modoGrafico)}</p>}
      </div>

      <div className="overflow-x-auto" role="region" aria-label="Gráfico de la curva de venta (desplazable)" tabIndex={0}>
        <svg viewBox={`0 0 ${geom.ancho} ${geom.alto}`} width="100%" style={{ minWidth: geom.ancho }} className="block h-auto select-none" role="group" aria-label={resumen} onMouseLeave={() => setMes(null)}>
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

          {bandas.flatMap((b) =>
            b.meses.map((m) => (
              <rect key={`${b.anio}-${b.temporada}-${m}`} data-banda-nino x={x0Mes(m)} y={geom.area.y} width={anchoMes} height={geom.area.alto} className="fill-alerta" fillOpacity={b.parcial ? 0.06 : 0.1} aria-hidden>
                <title>{b.texto}</title>
              </rect>
            ))
          )}
          {geom.ticksX.map((t) => (
            <rect key={`h${t.mes}`} x={x0Mes(t.mes)} y={geom.area.y} width={anchoMes} height={geom.area.alto} fill={mes === t.mes ? "var(--neutro-suave)" : "transparent"} fillOpacity={0.7} onMouseEnter={() => setMes(t.mes)} />
          ))}

          {geom.lineas.map((l) => (
            <g key={l.clave} role="img" aria-label={l.aria} opacity={l.opacidad} pointerEvents="none">
              {l.tramos.map((d, i) => (
                <path key={i} d={d} fill="none" stroke={l.color} strokeWidth={l.grosor} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={dasharray(l.trazo, "linea")} />
              ))}
              {l.puntos.map((p) => (
                <circle key={p.mes} cx={p.x} cy={p.y} r={l.grosor >= 3 ? 3.2 : 2.2} fill={l.color} />
              ))}
            </g>
          ))}
        </svg>
      </div>

      {bandas.length > 0 && (
        <ul className="space-y-1 text-xs text-tinta-suave" aria-label="Bandas del Niño">
          {bandas.map((b) => (
            <li key={`${b.anio}-${b.temporada}`} className="flex items-center gap-2">
              <span aria-hidden className="inline-block h-2.5 w-5 rounded-sm bg-alerta/20" />
              <span className={b.parcial ? "text-alerta" : undefined}>{b.texto}</span>
            </li>
          ))}
        </ul>
      )}

      <figcaption className="text-xs text-tinta-suave">
        {TEXTO_MODO[modo]}. Cada línea es un año; el año en curso va continuo hasta el último mes real y discontinuo en los meses proyectados. Las franjas rojizas son los meses
        de temporada afectados por el Niño.{modo === "forma" ? " La línea punteada oscura es la forma típica: el promedio de los años completos normales." : ""}
      </figcaption>
    </figure>
  );
}
