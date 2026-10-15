"use client";

import { Fragment, useState } from "react";
import { MODELOS, type AgrupacionResultado, type CandidataApi, type ModeloCurva } from "@/lib/curvas/tipos-api";
import { Badge } from "@/components/ui/badge";
import { formatearPp, ETIQUETA_MOTIVO_RECOMENDACION } from "./vista";

const MOTIVO_NO_DISPONIBLE: Record<string, string> = {
  sin_tiendas_validas: "ninguna tienda de la red tiene unidades suficientes en la agrupación",
  sin_anos_ajuste: "no hay años de ajuste suficientes",
  sin_anos_utilizables: "la temporada no tiene años utilizables",
};

/**
 * Tabla de candidatas `A`…`E` y `T`: nombre y descripción, EAT con su número de
 * pliegues (desplegable por pliegue), error máximo, EAT parcial, badges
 * Recomendada / Igual a A / No disponible, y un radio para dibujar la candidata
 * en el gráfico. La aprobación no está aquí: la barra de abajo aprueba la
 * seleccionada.
 */
export function CandidatasTabla({
  resultado,
  seleccionada,
  onSeleccionar,
}: {
  resultado: AgrupacionResultado;
  seleccionada: ModeloCurva | null;
  onSeleccionar: (m: ModeloCurva) => void;
}) {
  const [abiertas, setAbiertas] = useState<ReadonlySet<ModeloCurva>>(new Set());
  const alternar = (m: ModeloCurva) =>
    setAbiertas((prev) => {
      const sig = new Set(prev);
      if (sig.has(m)) sig.delete(m);
      else sig.add(m);
      return sig;
    });

  const filas = MODELOS.map((d) => ({ d, c: resultado.candidatas.find((x) => x.modelo === d.codigo) as CandidataApi | undefined }));

  return (
    <div className="space-y-3">
      {resultado.comparacion && (
        <p className="rounded-md border border-marca/30 bg-marca-suave px-3 py-2 text-sm text-marca-oscura">{resultado.comparacion.frase}</p>
      )}
      {resultado.origen === "prestada" && (
        <p className="rounded-md border border-alerta/30 bg-alerta-suave px-3 py-2 text-sm text-alerta">
          Sin años suficientes para una curva propia: la agrupación usa la curva de su temporada (T).
        </p>
      )}
      <div className="overflow-x-auto rounded-lg border border-borde">
        <table className="w-full text-sm">
          <caption className="sr-only">Candidatas de curva con su error (EAT), error máximo y estado.</caption>
          <thead className="bg-neutro-suave text-left text-xs uppercase tracking-wide text-tinta-suave">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                Ver
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Candidata
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium" title="Error absoluto total entre la candidata y la participación real de un año que quedó fuera (promedio de los pliegues)">
                EAT
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Error máx. mensual
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium" title="Error frente a los meses cargados del año en curso (no entra en la recomendación)">
                EAT parcial
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Estado
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-borde">
            {filas.map(({ d, c }) => {
              const disponible = c !== undefined && c.curva !== null;
              const esSel = seleccionada === d.codigo;
              const recomendada = resultado.recomendada === d.codigo;
              const abierta = abiertas.has(d.codigo);
              return (
                <Fragment key={d.codigo}>
                  <tr className={esSel ? "bg-marca-suave/50" : "hover:bg-fondo/60"}>
                    <td className="px-3 py-2">
                      <input
                        type="radio"
                        name="candidata"
                        value={d.codigo}
                        checked={esSel}
                        disabled={!disponible}
                        onChange={() => onSeleccionar(d.codigo)}
                        aria-label={`Dibujar y elegir la candidata ${d.codigo}: ${d.nombre}`}
                        className="h-4 w-4 accent-marca disabled:cursor-not-allowed"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <p className="font-medium text-tinta">
                        {d.codigo} · {d.nombre}
                      </p>
                      <p className="max-w-md text-xs text-tinta-suave">{d.descripcion}</p>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {c && c.eat !== null ? (
                        <div>
                          <span className="font-medium">{formatearPp(c.eat)}</span>
                          <span className="block text-xs text-tinta-suave">
                            {c.pliegues} {c.pliegues === 1 ? "prueba" : "pruebas"}
                          </span>
                          {c.eat_por_pliegue.length > 0 && (
                            <button
                              type="button"
                              aria-expanded={abierta}
                              onClick={() => alternar(d.codigo)}
                              className="text-xs font-medium text-marca-oscura underline underline-offset-2"
                            >
                              {abierta ? "Ocultar pliegues" : "Ver por pliegue"}
                            </button>
                          )}
                        </div>
                      ) : (
                        <span className="text-tinta-suave">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{c && c.error_max !== null ? formatearPp(c.error_max) : <span className="text-tinta-suave">—</span>}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{c && c.eat_parcial !== null ? formatearPp(c.eat_parcial) : <span className="text-tinta-suave">—</span>}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {recomendada && (
                          <span title={resultado.motivo_recomendacion ? ETIQUETA_MOTIVO_RECOMENDACION[resultado.motivo_recomendacion] : undefined}>
                            <Badge tono="exito">Recomendada{resultado.motivo_recomendacion ? ` · ${ETIQUETA_MOTIVO_RECOMENDACION[resultado.motivo_recomendacion]}` : ""}</Badge>
                          </span>
                        )}
                        {c?.igual_a && <Badge tono="neutro">Igual a {c.igual_a}</Badge>}
                        {c?.prestada && <Badge tono="marca">Prestada (temporada)</Badge>}
                        {!disponible && (
                          <span className="text-xs text-tinta-suave">
                            No disponible{c?.motivo ? `: ${MOTIVO_NO_DISPONIBLE[c.motivo] ?? c.motivo}` : ""}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                  {abierta && c && (
                    <tr className="bg-fondo/60">
                      <td />
                      <td colSpan={5} className="px-3 py-2 text-xs text-tinta-suave">
                        <p className="mb-1 font-medium text-tinta">EAT por pliegue (se deja un año fuera y se compara con lo que ocurrió en él)</p>
                        <ul className="flex flex-wrap gap-x-6 gap-y-1">
                          {c.eat_por_pliegue.map((p) => (
                            <li key={p.anio}>
                              Sin {p.anio}: <strong className="text-tinta">{formatearPp(p.eat)}</strong> (error máx. mensual {formatearPp(p.error_max)})
                            </li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {resultado.margen !== null && (
        <p className="text-xs text-tinta-suave">
          Para apartarse del promedio simple (A), otra candidata debe mejorarlo en más de {formatearPp(resultado.margen)} (el margen sale del ruido entre años normales y del parámetro «margen sobre el ruido» de la corrida).
        </p>
      )}
    </div>
  );
}
