"use client";

import { useMemo } from "react";
import type { FilaApi, MarcasDeFilaApi } from "@/lib/proyeccion/tipos-api";
import { NUM } from "./comunes";
import { barrasMarcas, tablaRepartoApertura, textoPeriodoMarcas, textoReparto, TEXTO_SIN_DATOS_MARCA, unidades, type SeccionApertura } from "./vista";

/** Color de cada segmento (marca 1, 2, 3 y «Otras»): tokens del tema, también en modo oscuro. Literales para que Tailwind los vea. */
const RELLENO = ["fill-marca-oscura", "fill-marca", "fill-exito", "fill-tinta-suave/40"] as const;
const MUESTRA = ["bg-marca-oscura", "bg-marca", "bg-exito", "bg-tinta-suave/40"] as const;

/**
 * «Marcas de más peso por agrupación» (ficha 07b): una barra horizontal al 100 % por agrupación de marca de la línea (y por equivalencia
 * en un nodo GMLE) con las 3 marcas que más venden y «Otras (N)», cada una con su % real (la suma es 100 %). Debajo, el reparto de cada
 * fila de apertura entre esas marcas, calculado en pantalla (solo dato: no se guarda ni se decide por marca). SVG propio, sin librerías;
 * la geometría y los textos salen de `vista.ts`. Cada barra es una imagen con texto alterno y la leyenda repite nombre y % en texto.
 */
export function GraficoMarcas({ base, marcas, secciones, anios }: { base: readonly FilaApi[]; marcas: readonly MarcasDeFilaApi[]; secciones: readonly SeccionApertura[]; anios: readonly number[] }) {
  const barras = useMemo(() => barrasMarcas(base, marcas), [base, marcas]);
  const reparto = useMemo(() => tablaRepartoApertura(secciones, marcas), [secciones, marcas]);
  const periodo = textoPeriodoMarcas(marcas);

  if (barras.length === 0) return <p className="text-sm text-tinta-suave">La línea no tiene filas con venta para mostrar sus marcas.</p>;

  return (
    <figure className="space-y-5">
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-tinta-suave" aria-label="Leyenda del gráfico">
        {["Marca 1", "Marca 2", "Marca 3", "Otras marcas"].map((rotulo, i) => (
          <li key={rotulo} className="inline-flex items-center gap-1.5">
            <span aria-hidden className={`inline-block h-3 w-3 rounded-sm ${MUESTRA[i]}`} /> {rotulo}
          </li>
        ))}
      </ul>

      <div className="space-y-3">
        {barras.map((b) => (
          <div key={b.clave}>
            <p className="mb-1 text-sm font-medium">{b.etiqueta}</p>
            {b.sinDatos ? (
              <p className="text-xs text-tinta-suave">{TEXTO_SIN_DATOS_MARCA}</p>
            ) : (
              <>
                <svg viewBox="0 0 100 10" preserveAspectRatio="none" width="100%" className="block h-6 select-none rounded-sm" role="img" aria-label={b.aria}>
                  {b.segmentos.map((s) => (
                    <rect key={s.clave} x={s.x} y={0} width={s.ancho} height={10} className={`${RELLENO[s.indice]} stroke-superficie`} strokeWidth={1} vectorEffect="non-scaling-stroke" />
                  ))}
                </svg>
                <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
                  {b.segmentos.map((s) => (
                    <li key={s.clave} className="inline-flex items-center gap-1.5">
                      <span aria-hidden className={`inline-block h-2.5 w-2.5 rounded-sm ${MUESTRA[s.indice]}`} />
                      <span>{s.nombre}</span>
                      <span className="font-mono tabular-nums text-tinta-suave">{s.pct}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        ))}
      </div>

      {periodo && <figcaption className="text-xs text-tinta-suave">{periodo}</figcaption>}

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Reparto de la apertura por marca</h3>
        <p className="text-xs text-tinta-suave">Las unidades de cada fila de apertura repartidas con la composición de la agrupación (enteros que suman la cifra de la fila). Es un dato para ver, no se guarda.</p>
        {anios.map((anio) => {
          const filas = reparto.filter((r) => r.anio === anio);
          if (filas.length === 0) {
            return (
              <p key={anio} className="text-sm text-tinta-suave">
                Sin tiendas nuevas en {anio}.
              </p>
            );
          }
          return (
            <div key={anio} className="overflow-x-auto rounded-lg border border-borde">
              <table className="w-full text-xs">
                <caption className="sr-only">Reparto por marca de las filas de apertura de {anio}</caption>
                <thead className="bg-neutro-suave text-left uppercase tracking-wide text-tinta-suave">
                  <tr>
                    <th className="px-2 py-1 font-medium">Tienda · año</th>
                    <th className="px-2 py-1 font-medium">Agrupación</th>
                    <th className="px-2 py-1 text-right font-medium">Unidades</th>
                    <th className="px-2 py-1 font-medium">Reparto por marca</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-borde">
                  {filas.map((r) => (
                    <tr key={r.clave}>
                      <td className="px-2 py-1 whitespace-nowrap">{r.seccion}</td>
                      <td className="px-2 py-1">{r.agrupacion}</td>
                      <td className={`px-2 py-1 ${NUM}`}>{unidades(r.vigente)}</td>
                      <td className="px-2 py-1">
                        {r.estado === "ok" && r.partes ? textoReparto(r.partes) : r.estado === "sin_fila" ? <span className="text-tinta-suave">Sin fila de apertura</span> : <span className="text-tinta-suave">Sin datos de marca</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    </figure>
  );
}
