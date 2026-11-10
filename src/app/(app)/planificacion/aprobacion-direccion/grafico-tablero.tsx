"use client";

import { useMemo, useState, type KeyboardEvent } from "react";
import { Chips } from "@/components/ui/chips";
import { calcularGeometriaCurvas } from "@/lib/curvas/grafico";
import type { TableroApi } from "@/lib/direccion/tipos-api";
import { mesAnio } from "@/components/direccion/formato";
import { usePantallaAncha } from "./use-tablero-direccion";
import { acumularSeries, clavesPorDefecto, descripcionGrafico, ID_TABLA_MENSUAL, lecturaDelMes, seriesGrafico, type SerieDibujo } from "./vista-tablero";

type Modo = "mensual" | "acumulado";

function Muestra({ s }: { s: SerieDibujo }) {
  return (
    <svg width="28" height="10" aria-hidden className="shrink-0">
      <line x1="1" x2="27" y1="5" y2="5" stroke={s.color} strokeWidth={Math.min(s.grosor, 4)} strokeDasharray={s.dash} strokeLinecap="round" />
    </svg>
  );
}

/**
 * Gráfico mensual del tablero (ficha 14, §4.8): SVG propio sobre la geometría del gráfico de curvas de M6. Las series se distinguen por trazo y
 * grosor, no solo por color: años reales finos (los del Niño, con guion y punto y su rótulo), el año en curso real continuo y grueso, lo proyectado
 * discontinuo (el año siguiente, el más grueso), «sin Niño» punteado fino y la comparada punteada. Línea vertical en el mes de los datos (`k`).
 * Conmutador mensual / acumulado y encendido por serie (en pantallas angostas los años más viejos arrancan apagados). Accesible: la tabla mensual
 * es la alternativa exacta, las flechas recorren los meses y la lectura del mes se anuncia.
 */
export function GraficoTablero({ tablero }: { tablero: TableroApi }) {
  const ancha = usePantallaAncha();
  const todas = useMemo(() => seriesGrafico(tablero), [tablero]);
  const [elegidas, setElegidas] = useState<string[] | null>(null);
  const [modo, setModo] = useState<Modo>("mensual");
  const [mes, setMes] = useState<number | null>(null);

  const encendidas = useMemo(() => new Set(elegidas ?? clavesPorDefecto(todas, ancha)), [elegidas, todas, ancha]);
  const visibles = useMemo(() => (modo === "acumulado" ? acumularSeries(todas) : todas).filter((s) => encendidas.has(s.clave)), [modo, todas, encendidas]);
  const geom = useMemo(
    () => calcularGeometriaCurvas({ series: visibles.map((s) => ({ clave: s.clave, etiqueta: s.etiqueta, valores: s.valores, color: s.color, grosor: s.grosor })), modo: "unidades" }, ancha ? { ancho: 720, alto: 300 } : { ancho: 380, alto: 260 }),
    [visibles, ancha]
  );
  const anchoMes = geom.area.ancho / 12;
  const k = tablero.proyeccion.k;
  const xDatos = geom.area.x + Math.min(12, Math.max(0, k)) * anchoMes;
  const hayEstimado = todas.some((s) => s.estimado);
  const sinNino = todas.find((s) => s.tipo === "sin_nino");

  const alternar = (clave: string) => {
    const actual = [...encendidas];
    setElegidas(encendidas.has(clave) ? actual.filter((c) => c !== clave) : [...actual, clave]);
  };

  const teclado = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowRight") setMes((m) => (m === null ? 1 : Math.min(12, m + 1)));
    else if (e.key === "ArrowLeft") setMes((m) => (m === null ? 12 : Math.max(1, m - 1)));
    else if (e.key === "Home") setMes(1);
    else if (e.key === "End") setMes(12);
    else if (e.key === "Escape") setMes(null);
    else return;
    e.preventDefault();
  };

  if (todas.length === 0) return <p className="text-sm text-tinta-suave">Sin serie mensual que dibujar.</p>;

  return (
    <figure className="space-y-3" aria-describedby={ID_TABLA_MENSUAL}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Chips<Modo>
          etiqueta="Ver el gráfico por mes o acumulado"
          activo={modo}
          onCambiar={setModo}
          items={[
            { id: "mensual", label: "Mensual" },
            { id: "acumulado", label: "Acumulado" },
          ]}
        />
        <p className="text-xs text-tinta-suave">Unidades · línea vertical: datos hasta {mesAnio(tablero.proyeccion.hasta_periodo)}</p>
      </div>

      <div
        role="group"
        tabIndex={0}
        aria-label="Gráfico mensual en unidades. Con el foco aquí, las flechas izquierda y derecha recorren los meses."
        onKeyDown={teclado}
        className="rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca"
      >
        <svg viewBox={`0 0 ${geom.ancho} ${geom.alto}`} width="100%" className="block h-auto select-none" role="img" aria-label={descripcionGrafico(tablero)} onMouseLeave={() => setMes(null)}>
          {geom.ticksY.map((t) => (
            <g key={t.valor}>
              <line x1={geom.area.x} x2={geom.area.x + geom.area.ancho} y1={t.y} y2={t.y} className={t.valor === 0 ? "stroke-tinta-suave" : "stroke-borde"} strokeWidth={1} />
              <text x={geom.area.x - 8} y={t.y} textAnchor="end" dominantBaseline="middle" fontSize={11} className="fill-tinta-suave">
                {t.etiqueta}
              </text>
            </g>
          ))}
          {geom.ticksX.map((t) => (
            <text key={t.mes} x={t.x} y={geom.alto - geom.margen.inf + 18} textAnchor="middle" fontSize={11} className={mes === t.mes ? "fill-tinta font-semibold" : "fill-tinta-suave"}>
              {t.etiqueta}
            </text>
          ))}
          {geom.ticksX.map((t) => (
            <rect
              key={`m${t.mes}`}
              x={geom.area.x + (t.mes - 1) * anchoMes}
              y={geom.area.y}
              width={anchoMes}
              height={geom.area.alto}
              fill={mes === t.mes ? "var(--neutro-suave)" : "transparent"}
              fillOpacity={0.8}
              onMouseEnter={() => setMes(t.mes)}
              onClick={() => setMes(t.mes)}
            />
          ))}
          {k >= 1 && k < 12 && <line x1={xDatos} x2={xDatos} y1={geom.area.y} y2={geom.area.y + geom.area.alto} className="stroke-tinta-suave" strokeWidth={1} strokeDasharray="2 3" pointerEvents="none" />}
          {geom.lineas.map((l, i) => {
            const s = visibles[i];
            return (
              <g key={l.clave} pointerEvents="none">
                {l.tramos.map((d, j) => (
                  <path key={j} d={d} fill="none" stroke={l.color} strokeWidth={l.grosor} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={s?.dash} />
                ))}
                {l.puntos
                  .filter((p) => p.mes === mes || l.puntos.length === 1)
                  .map((p) => (
                    <circle key={p.mes} cx={p.x} cy={p.y} r={Math.max(3, l.grosor)} fill={l.color} />
                  ))}
              </g>
            );
          })}
        </svg>
      </div>

      <p className="min-h-5 text-xs text-tinta" aria-live="polite">
        {mes === null ? "Toca o pasa el cursor sobre un mes (o usa las flechas) para leer el valor de cada serie." : lecturaDelMes(mes, visibles, modo === "acumulado")}
      </p>

      <ul className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs text-tinta sm:flex sm:flex-wrap sm:gap-x-4" aria-label="Series del gráfico: toca una para encenderla o apagarla">
        {todas.map((s) => {
          const encendida = encendidas.has(s.clave);
          return (
            <li key={s.clave} className="min-w-0">
              <button
                type="button"
                role="checkbox"
                aria-checked={encendida}
                title={s.ayuda}
                onClick={() => alternar(s.clave)}
                className={`inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-md px-1.5 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca ${encendida ? "" : "text-tinta-suave line-through opacity-60"}`}
              >
                <Muestra s={s} />
                <span className="min-w-0 break-words">{s.etiqueta}</span>
              </button>
            </li>
          );
        })}
      </ul>

      <figcaption className="space-y-1 text-xs leading-relaxed text-tinta-suave">
        <p className="text-sm text-tinta">{descripcionGrafico(tablero)}</p>
        {sinNino?.ayuda && (
          <p>
            «{sinNino.etiqueta}»: {sinNino.ayuda}
          </p>
        )}
        {hayEstimado && <p>Las series marcadas «(estimado)» salen de la atribución por tienda o de la participación por marca: no son cifras guardadas en la proyección.</p>}
        <p>Las cifras exactas, mes a mes, están en la tabla mensual de abajo.</p>
      </figcaption>
    </figure>
  );
}
