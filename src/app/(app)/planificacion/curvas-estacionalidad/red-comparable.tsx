"use client";

import Link from "next/link";
import { Fragment, useState } from "react";
import { maximoComun, trazoMiniCurva } from "@/lib/curvas/grafico";
import { Badge } from "@/components/ui/badge";
import {
  formatearPct,
  formatearPp,
  pideCorregirApertura,
  textoMotivoRed,
  textoTotalRed,
  type RedVista,
  type TiendaAnioVista,
} from "./vista";

function PerfilTienda({ tienda, referencia, etiqueta }: { tienda: number[]; referencia: number[] | null; etiqueta: string }) {
  const ancho = 110;
  const alto = 36;
  const maximo = maximoComun(tienda, referencia);
  return (
    <svg viewBox={`0 0 ${ancho} ${alto}`} width={ancho} height={alto} role="img" aria-label={etiqueta} className="block">
      <line x1={1} x2={ancho - 1} y1={alto - 1} y2={alto - 1} className="stroke-borde" strokeWidth={1} />
      {referencia && <path d={trazoMiniCurva(referencia, ancho, alto, maximo)} fill="none" className="stroke-tinta-suave" strokeWidth={1.5} strokeDasharray="3 2" />}
      <path d={trazoMiniCurva(tienda, ancho, alto, maximo)} fill="none" className="stroke-marca" strokeWidth={1.75} strokeLinejoin="round" />
    </svg>
  );
}

function Celda({ t, dominante }: { t: TiendaAnioVista | undefined; dominante: boolean }) {
  if (!t) return <span className="text-tinta-suave">—</span>;
  const motivo = textoMotivoRed(t);
  if (!t.entra) {
    return (
      <div className="space-y-0.5">
        <Badge tono="neutro">Fuera</Badge>
        {motivo && <p className="max-w-52 text-xs text-tinta-suave">{motivo}</p>}
        {pideCorregirApertura(t) && (
          <Link href="/maestros/tiendas" className="text-xs font-medium text-marca-oscura underline underline-offset-2">
            Corregir en Tiendas
          </Link>
        )}
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tono="exito">Entra</Badge>
        <span className="font-mono text-xs tabular-nums">{formatearPct(t.peso)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {dominante && (
          <span title="Pesa más que el umbral de tienda dominante">
            <Badge tono="alerta">Dominante</Badge>
          </span>
        )}
        {t.distinta && (
          <span title="Su perfil mensual se aparta de la referencia más que el ruido entre años normales y pesa lo suficiente">
            <Badge tono="alerta">Distinta · {formatearPp(t.eatVsRed)}</Badge>
          </span>
        )}
      </div>
      {motivo && <p className="max-w-52 text-xs text-tinta-suave">{motivo}</p>}
    </div>
  );
}

/**
 * Tabla tiendas × años de la red comparable. Por celda: «Entra» con el peso
 * siempre visible, o «Fuera» con el motivo legible; badges Dominante y Distinta.
 * Al desplegar una tienda se ve su perfil mensual frente al de la referencia
 * (la red, o la agrupación en el detalle) por año. Sirve igual para la red de la
 * corrida, la vista previa y la red de una agrupación: cambia solo `red`.
 */
export function RedComparable({ red, referencia, pie }: { red: RedVista; /** «la red» o «la agrupación»: lo que se compara con el perfil de cada tienda. */ referencia: string; pie?: string }) {
  const [abiertas, setAbiertas] = useState<ReadonlySet<string>>(new Set());
  const alternar = (id: string) =>
    setAbiertas((prev) => {
      const sig = new Set(prev);
      if (sig.has(id)) sig.delete(id);
      else sig.add(id);
      return sig;
    });

  if (red.anios.length === 0 || red.tiendas.length === 0) return <p className="text-sm text-tinta-suave">Sin tiendas que mostrar.</p>;

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-lg border border-borde">
        <table className="w-full text-sm">
          <thead className="bg-neutro-suave text-left text-xs uppercase tracking-wide text-tinta-suave">
            <tr>
              <th className="px-3 py-2 font-medium">Tienda</th>
              {red.anios.map((a) => (
                <th key={a.anio} className="px-3 py-2 font-medium">
                  {a.anio}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-borde">
            {red.tiendas.map((t) => {
              const abierta = abiertas.has(t.id);
              const tienePerfil = red.anios.some((a) => a.tiendas.get(t.id)?.participacion);
              return (
                <Fragment key={t.id}>
                  <tr className="align-top hover:bg-fondo/60">
                    <td className="px-3 py-2">
                      <div className="flex items-start gap-2">
                        {tienePerfil ? (
                          <button
                            type="button"
                            aria-expanded={abierta}
                            aria-label={`${abierta ? "Ocultar" : "Ver"} el perfil mensual de ${t.nombre}`}
                            onClick={() => alternar(t.id)}
                            className="mt-0.5 text-tinta-suave hover:text-tinta"
                          >
                            <span aria-hidden className={`inline-block transition-transform ${abierta ? "rotate-90" : ""}`}>
                              ▸
                            </span>
                          </button>
                        ) : (
                          <span className="w-3" />
                        )}
                        <div>
                          <span className="font-medium">{t.nombre}</span>
                          <code className="block font-mono text-xs text-tinta-suave">{t.codigo}</code>
                        </div>
                      </div>
                    </td>
                    {red.anios.map((a) => (
                      <td key={a.anio} className="px-3 py-2">
                        <Celda t={a.tiendas.get(t.id)} dominante={a.dominante === t.id} />
                      </td>
                    ))}
                  </tr>
                  {abierta && (
                    <tr className="bg-fondo/60">
                      <td className="px-3 py-2 text-xs text-tinta-suave">
                        <span className="inline-flex items-center gap-1">
                          <span aria-hidden className="inline-block h-0.5 w-4 bg-marca" /> {t.nombre}
                        </span>
                        <br />
                        <span className="inline-flex items-center gap-1">
                          <span aria-hidden className="inline-block h-0 w-4 border-t-2 border-dashed border-tinta-suave" /> {referencia}
                        </span>
                      </td>
                      {red.anios.map((a) => {
                        const v = a.tiendas.get(t.id);
                        return (
                          <td key={a.anio} className="px-3 py-2">
                            {v?.participacion ? (
                              <PerfilTienda
                                tienda={v.participacion}
                                referencia={a.participacion}
                                etiqueta={`Perfil mensual de ${t.nombre} en ${a.anio} frente al de ${referencia}${v.eatVsRed !== null ? `; diferencia ${formatearPp(v.eatVsRed)}` : ""}`}
                              />
                            ) : (
                              <span className="text-xs text-tinta-suave">—</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
          <tfoot className="border-t border-borde bg-neutro-suave/60 text-xs">
            <tr>
              <th scope="row" className="px-3 py-2 text-left font-semibold text-tinta">
                Total
              </th>
              {red.anios.map((a) => (
                <td key={a.anio} className="px-3 py-2 text-tinta-suave">
                  {textoTotalRed(a)}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
      {pie && <p className="text-xs text-tinta-suave">{pie}</p>}
    </div>
  );
}
