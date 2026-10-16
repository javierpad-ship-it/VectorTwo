"use client";

import { useId, useMemo } from "react";
import { plural } from "@/lib/formato";
import { geometriaBarras, type BarraAnual } from "./vista";

/**
 * «Unidades por año» de la Parte 1: una barra por año, cada una con la red de mismas tiendas de su año (el número de
 * tiendas va debajo). Años históricos = real; el año en curso = vendido + resto proyectado (sombreado); el siguiente =
 * proyección. La franja rojiza marca los años del Niño. SVG propio, sin librerías; la geometría sale de `vista.ts`. La
 * tabla de debajo repite las cifras exactas.
 */
export function GraficoBarras({ barras, anioEnCurso }: { barras: readonly BarraAnual[]; anioEnCurso: number }) {
  const idPatron = useId();
  const g = useMemo(() => geometriaBarras(barras), [barras]);
  const resumen = `Unidades por año: ${barras.map((b) => `${b.anio} ${b.total.toLocaleString("es-PE")}`).join(", ")}.`;

  return (
    <figure className="space-y-2">
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-tinta-suave" aria-label="Leyenda del gráfico">
        <li className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-3 w-3 rounded-sm bg-marca-oscura" /> Real
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-3 w-3 rounded-sm border border-marca-oscura bg-marca/30" /> Resto de {anioEnCurso} (propuesto o decidido)
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-3 w-3 rounded-sm bg-exito" /> Año siguiente (proyección)
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-3 w-3 rounded-sm bg-alerta" /> Tiendas nuevas (aperturas)
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-3 w-3 rounded-sm bg-alerta/15" /> Año del Niño
        </li>
      </ul>
      <div className="overflow-x-auto" role="region" aria-label="Gráfico de unidades por año (desplazable)" tabIndex={0}>
        <svg viewBox={`0 0 ${g.ancho} ${g.alto}`} width="100%" style={{ minWidth: 480 }} className="block h-auto select-none" role="group" aria-label={resumen}>
          <defs>
            <pattern id={idPatron} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="6" height="6" className="fill-marca" fillOpacity={0.25} />
              <line x1="0" y1="0" x2="0" y2="6" className="stroke-marca-oscura" strokeWidth={2} />
            </pattern>
          </defs>
          {g.ticksY.map((t) => (
            <g key={t.valor}>
              <line x1={g.area.x} x2={g.area.x + g.area.ancho} y1={t.y} y2={t.y} className={t.valor === 0 ? "stroke-tinta-suave" : "stroke-borde"} strokeWidth={1} />
              <text x={g.area.x - 8} y={t.y} textAnchor="end" dominantBaseline="middle" fontSize={11} className="fill-tinta-suave">
                {t.etiqueta}
              </text>
            </g>
          ))}
          {g.bandasNino.map((b) => (
            <g key={b.anio}>
              <rect x={b.x} y={g.area.y} width={b.ancho} height={g.area.alto} className="fill-alerta" fillOpacity={0.1} aria-hidden />
              <text x={b.x + b.ancho / 2} y={g.area.y + 10} textAnchor="middle" fontSize={10} className="fill-alerta">
                Niño
              </text>
            </g>
          ))}
          {g.barras.map((b) => (
            <g key={b.anio} role="img" aria-label={b.aria}>
              {b.segmentos.map((s) => (
                <rect
                  key={s.tipo}
                  x={s.x}
                  y={s.y}
                  width={s.ancho}
                  height={s.alto}
                  className={s.tipo === "real" ? "fill-marca-oscura" : s.tipo === "siguiente" ? "fill-exito" : s.tipo === "nuevas" ? "fill-alerta" : "stroke-marca-oscura"}
                  fill={s.tipo === "resto" ? `url(#${idPatron})` : undefined}
                  strokeWidth={s.tipo === "resto" ? 1 : 0}
                />
              ))}
              <text x={b.x + b.ancho / 2} y={Math.max(12, b.yTotal - 6)} textAnchor="middle" fontSize={11} fontWeight={600} className="fill-tinta">
                {b.etiquetaTotal}
              </text>
              <text x={b.x + b.ancho / 2} y={g.alto - 28} textAnchor="middle" fontSize={12} fontWeight={600} className="fill-tinta">
                {b.anio}
              </text>
              <text x={b.x + b.ancho / 2} y={g.alto - 12} textAnchor="middle" fontSize={10} className="fill-tinta-suave">
                {b.tiendas === null ? "—" : `M(${b.anio}) ${plural(b.tiendas, "tienda", "tiendas")}`}
              </text>
            </g>
          ))}
        </svg>
      </div>
    </figure>
  );
}
