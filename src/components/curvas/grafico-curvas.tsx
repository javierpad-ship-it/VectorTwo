"use client";

import { useMemo, useState } from "react";
import { calcularGeometriaCurvas, lecturaMes, type EstiloTrazo } from "@/lib/curvas/grafico";
import type { AgrupacionResultado, TemporadaResultado } from "@/lib/curvas/tipos-api";
import { Chips, type ChipItem } from "@/components/ui/chips";
import { Select } from "@/components/ui/form";
import { COLOR_LIQUIDACION, aniosConAtipicos, bandaParaGrafico, construirSeries, puntosLiquidacion, type ModoGrafico, type SerieExtra } from "./series";

/** Trazos: discontinuo = año en curso; punteado (guion y punto) = año del Niño; continuo = el resto. */
function dasharray(trazo: EstiloTrazo | undefined, donde: "leyenda" | "linea"): string | undefined {
  if (trazo === "discontinuo") return donde === "linea" ? "7 5" : "5 3";
  if (trazo === "punteado") return donde === "linea" ? "10 3 2 3" : "6 2 1.5 2";
  return undefined;
}

/**
 * Gráfico principal del detalle: la participación mensual de TODOS los años
 * superpuestos (el año en curso discontinuo; los años del Niño con guion y punto;
 * imputados punteados; escasos y descartados tenues, los descartados en gris, todos
 * encendidos al abrir), la banda mín–máx entre años de ajuste, la curva `T` de la
 * temporada (se enciende a mano), la vigente en gris oscuro y la propuesta en
 * trazo grueso. SVG propio, sin librerías; la geometría sale de
 * `src/lib/curvas/grafico.ts`. Conmutador Participación / Unidades; los meses
 * atípicos de un año se sombrean con una banda vertical y los de liquidación llevan
 * un punto ámbar. La tabla año × mes del detalle es la alternativa accesible con
 * las cifras exactas.
 */
export function GraficoCurvas({
  resultado,
  propuesta,
  vigente,
  temporada,
  extras,
  idTabla,
}: {
  resultado: Pick<AgrupacionResultado, "anios" | "banda">;
  /** La candidata que se está mirando (curva en fracciones). */
  propuesta: { etiqueta: string; curva: number[] } | null;
  vigente: { etiqueta: string; curva: number[] } | null;
  temporada: Pick<TemporadaResultado, "curva_T"> | null;
  /** 06c: Mi curva y los GML marcados «ver en el gráfico» (participación; encendidos al abrir). */
  extras?: readonly SerieExtra[];
  /** Id de la tabla año × mes que repite estas cifras. */
  idTabla: string;
}) {
  const [modo, setModo] = useState<ModoGrafico>("participacion");
  const [cambios, setCambios] = useState<Record<string, boolean>>({});
  const [mes, setMes] = useState<number | null>(null);
  const [sombreado, setSombreado] = useState<string | null>(null);

  const series = useMemo(() => construirSeries(resultado.anios, { modo, propuesta, vigente, temporada, extras }), [resultado.anios, modo, propuesta, vigente, temporada, extras]);
  const visible = (clave: string, porDefecto: boolean) => cambios[clave] ?? porDefecto;
  const activas = useMemo(() => series.filter((s) => cambios[s.clave] ?? s.porDefecto), [series, cambios]);

  const aniosAtipicos = useMemo(() => aniosConAtipicos(series), [series]);
  // Por defecto se sombrean los meses atípicos del año más reciente que los tenga; «ningún año» los apaga.
  const anioSombreado = sombreado ?? (aniosAtipicos.length > 0 ? String(aniosAtipicos[aniosAtipicos.length - 1]) : "ninguno");
  const mesesAtipicos = useMemo(() => (anioSombreado === "ninguno" ? [] : (series.find((s) => s.anio === Number(anioSombreado))?.mesesAtipicos ?? [])), [series, anioSombreado]);

  const bandaVisible = cambios.banda ?? true;
  const banda = modo === "participacion" && bandaVisible ? bandaParaGrafico(resultado.banda) : null;
  const geom = useMemo(
    () => calcularGeometriaCurvas({ series: activas, banda, mesesAtipicos, liquidacion: puntosLiquidacion(activas), modo }, { ancho: 720, alto: 340 }),
    [activas, banda, mesesAtipicos, modo]
  );

  const alternar = (clave: string, porDefecto: boolean) => setCambios((c) => ({ ...c, [clave]: !(c[clave] ?? porDefecto) }));
  const itemsModo: ChipItem<ModoGrafico>[] = [
    { id: "participacion", label: "Participación (%)" },
    { id: "unidades", label: "Unidades" },
  ];
  const resumen = `Curvas mensuales de ${activas.map((s) => s.etiqueta).join(", ") || "ninguna serie"}. ${
    modo === "participacion" ? "Participación del mes en el año" : "Unidades de la red comparable por mes"
  }. La tabla año por mes trae las cifras exactas.`;
  const anchoMes = geom.area.ancho / 12;
  const x0Mes = (m: number) => geom.area.x + (m - 1) * anchoMes;

  return (
    <figure className="space-y-3" aria-describedby={idTabla}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Chips<ModoGrafico> items={itemsModo} activo={modo} onCambiar={setModo} etiqueta="Unidad del gráfico" />
        {aniosAtipicos.length > 0 && (
          <label className="inline-flex items-center gap-2 text-xs text-tinta-suave">
            Sombrear meses atípicos de
            <Select value={anioSombreado} onChange={(e) => setSombreado(e.target.value)} className="h-8 w-28!" aria-label="Año cuyos meses atípicos se sombrean">
              <option value="ninguno">ningún año</option>
              {aniosAtipicos.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </Select>
          </label>
        )}
      </div>

      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm" aria-label="Series del gráfico (pulsa para encender o apagar)">
        {series.map((s) => {
          const on = visible(s.clave, s.porDefecto);
          return (
            <li key={s.clave}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => alternar(s.clave, s.porDefecto)}
                className={`inline-flex items-center gap-1.5 rounded px-1 py-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca ${on ? "text-tinta" : "text-tinta-suave line-through opacity-70"}`}
              >
                <svg width="22" height="8" aria-hidden>
                  <line x1="1" x2="21" y1="4" y2="4" stroke={s.color} strokeWidth={Math.min(s.grosor ?? 2, 3.5)} strokeDasharray={dasharray(s.trazo, "leyenda")} strokeOpacity={s.opacidad ?? 1} />
                </svg>
                {s.etiqueta}
              </button>
            </li>
          );
        })}
        {modo === "participacion" && resultado.banda && (
          <li>
            <button
              type="button"
              aria-pressed={bandaVisible}
              onClick={() => alternar("banda", true)}
              className={`inline-flex items-center gap-1.5 rounded px-1 py-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca ${bandaVisible ? "text-tinta" : "text-tinta-suave line-through opacity-70"}`}
            >
              <span aria-hidden className="inline-block h-2.5 w-5 rounded-sm bg-marca/20" />
              Banda mín–máx entre años de ajuste
            </button>
          </li>
        )}
        <li className="text-xs text-tinta-suave" aria-hidden>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: COLOR_LIQUIDACION }} />
            mes en liquidación
          </span>
        </li>
      </ul>

      <div className="min-h-9 text-sm" aria-live="polite">
        {mes === null ? <p className="text-tinta-suave">Pasa el cursor sobre un mes para ver el valor de cada serie.</p> : <p className="text-tinta">{lecturaMes(mes, activas, modo)}</p>}
      </div>

      <div className="overflow-x-auto" role="region" aria-label="Gráfico de curvas mensuales (desplazable)" tabIndex={0}>
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

          {geom.bandasAtipicas.map((b) => (
            <rect key={b.mes} x={b.x} y={geom.area.y} width={b.ancho} height={geom.area.alto} className="fill-alerta" fillOpacity={0.08} aria-hidden />
          ))}
          {geom.ticksX.map((t) => (
            <rect key={`h${t.mes}`} x={x0Mes(t.mes)} y={geom.area.y} width={anchoMes} height={geom.area.alto} fill={mes === t.mes ? "var(--neutro-suave)" : "transparent"} fillOpacity={0.7} onMouseEnter={() => setMes(t.mes)} />
          ))}
          {geom.banda && <path d={geom.banda} className="fill-marca" fillOpacity={0.14} stroke="none" aria-hidden />}

          {geom.lineas.map((l) => (
            <g key={l.clave} role="img" aria-label={l.aria} opacity={l.opacidad} pointerEvents="none">
              {l.tramos.map((d, i) => (
                <path key={i} d={d} fill="none" stroke={l.color} strokeWidth={l.grosor} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={dasharray(l.trazo, "linea")} />
              ))}
              {l.tramosImputados.map((d, i) => (
                <g key={`i${i}`}>
                  <path d={d} fill="none" stroke="var(--superficie)" strokeWidth={l.grosor + 2} />
                  <path d={d} fill="none" stroke={l.color} strokeWidth={l.grosor} strokeLinecap="round" strokeDasharray="1.5 4" />
                </g>
              ))}
              {l.puntos.map((p) => (
                <circle key={p.mes} cx={p.x} cy={p.y} r={l.grosor >= 3 ? 3.2 : 2.2} fill={l.color} />
              ))}
            </g>
          ))}

          {geom.puntosLiquidacion.map((p) => (
            <circle key={`${p.clave}-${p.mes}`} pointerEvents="all" cx={p.x} cy={p.y} r={4.5} fill={COLOR_LIQUIDACION} stroke="white" strokeWidth={1.25}>
              <title>Mes en liquidación</title>
            </circle>
          ))}
        </svg>
      </div>
      <figcaption className="text-xs text-tinta-suave">
        Cada línea es la participación de un mes en el total de su año, sobre las tiendas de la red comparable de ese año. El año en curso se dibuja discontinuo hasta el
        último mes cargado; los años del Niño, con guion y punto; los meses imputados, punteados; los años escasos y los descartados (en gris), tenues. La franja rojiza marca los meses atípicos del año elegido.
      </figcaption>
    </figure>
  );
}
