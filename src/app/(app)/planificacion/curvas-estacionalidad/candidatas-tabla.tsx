"use client";

import { Fragment, useId, useState } from "react";
import { formatearDecimal } from "@/lib/formato";
import type { EvaluacionCurvaUsuario } from "@/lib/curvas/curva-usuario";
import { MODELOS, type AgrupacionResultado, type CandidataApi, type ModeloAprobable, type ModeloCurva } from "@/lib/curvas/tipos-api";
import { Badge } from "@/components/ui/badge";
import { MESES_CORTOS } from "@/lib/reportes/histograma";
import { formatearPp, ETIQUETA_MOTIVO_RECOMENDACION, textoPropone, textoRuido } from "./vista";

const MESES = MESES_CORTOS.map((m) => m.slice(0, 3));

const MOTIVO_NO_DISPONIBLE: Record<string, string> = {
  sin_tiendas_validas: "ninguna tienda de la red tiene unidades suficientes en la agrupación",
  sin_anos_ajuste: "no hay años de ajuste suficientes",
  sin_anos_utilizables: "la temporada no tiene años utilizables",
  sin_backtesting_honesto: "sin backtesting honesto: con dos años de ajuste cada prueba tiene un solo año de entrenamiento, así que se muestra pero no compite",
};

/**
 * «Lo que propone el sistema»: la frase de recomendación y la tabla de candidatas `A`…`F`
 * (`F` es el modelo avanzado, con su explicación) y `T` con su EAT, el número de pruebas (desplegable por pliegue) y el ruido entre años
 * normales SIEMPRE junto al EAT, error máximo, EAT parcial, badges Recomendada / Igual a A /
 * No disponible, y un radio para dibujar la candidata en el gráfico y en la tabla. La
 * aprobación no está aquí: el bloque «Aprobada frente a propuesta» aprueba la seleccionada.
 * Junto al EAT (fuera de muestra) va el EAT en muestra, y al final, si es válida, la fila `U · Mi curva`
 * del usuario, medida en muestra (06c).
 */
export function CandidatasTabla({
  resultado,
  seleccionada,
  onSeleccionar,
  avisoNoComparable = null,
  usuario = null,
}: {
  resultado: AgrupacionResultado;
  seleccionada: ModeloAprobable | null;
  onSeleccionar: (m: ModeloAprobable) => void;
  /** 06c: la curva del usuario ya medida (solo si es válida); añade la fila `U` al final. */
  usuario?: EvaluacionCurvaUsuario | null;
  /** «EAT no comparable con el cálculo anterior (…)» cuando los años de ajuste no son los de la vigente. */
  avisoNoComparable?: string | null;
}) {
  const grupo = useId();
  const ruido = resultado.ruido_normal;
  const [abiertas, setAbiertas] = useState<ReadonlySet<ModeloCurva>>(new Set());
  const [detalleF, setDetalleF] = useState(false);
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
      <p className="rounded-md border border-marca/30 bg-marca-suave px-3 py-2 text-sm text-marca-oscura">{textoPropone(resultado)}</p>
      {avisoNoComparable && (
        <p role="note" className="rounded-md border border-alerta/30 bg-alerta-suave px-3 py-2 text-sm text-alerta">
          {avisoNoComparable}
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
                        name={grupo}
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
                          <span className="block text-xs text-tinta-suave">fuera de muestra</span>
                          <span className="block text-xs text-tinta-suave">
                            {c.pruebas} {c.pruebas === 1 ? "prueba" : "pruebas"} · {ruido === null ? "ruido no medible" : `ruido ${formatearPp(ruido)}`}
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
                      {c && c.eat_en_muestra !== null && c.eat_en_muestra !== undefined && (
                        <span className="block text-xs text-tinta-suave" title="La curva completa contra sus propios años: es lo que se puede comparar con la medida de la curva del usuario">
                          {formatearPp(c.eat_en_muestra)} en muestra
                        </span>
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
                        {disponible && c?.eat === null && c?.motivo && <span className="text-xs text-tinta-suave">No compite: {MOTIVO_NO_DISPONIBLE[c.motivo] ?? c.motivo}</span>}
                        {d.codigo === "F" && <Badge tono="neutro">Modelo avanzado</Badge>}
                      </div>
                    </td>
                  </tr>
                  {d.codigo === "F" && c?.explicacion_f && (
                    <tr className="bg-fondo/60">
                      <td />
                      <td colSpan={5} className="space-y-2 px-3 py-2 text-xs text-tinta-suave">
                        <p className="text-sm text-tinta">{c.explicacion_f.frase}</p>
                        <p>
                          Con tres o cuatro años de datos ningún algoritmo avanzado garantiza ganar: F no es «la mejor» salvo que gane la prueba (backtesting) por más del margen; el planner decide.
                        </p>
                        <button
                          type="button"
                          aria-expanded={detalleF}
                          onClick={() => setDetalleF((x) => !x)}
                          className="font-medium text-marca-oscura underline underline-offset-2"
                        >
                          {detalleF ? "Ocultar cómo se armó F" : "Cómo se armó F"}
                        </button>
                        {detalleF && c.detalle_f && <DetalleDeF c={c} />}
                      </td>
                    </tr>
                  )}
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
            {usuario && (
              <tr className={seleccionada === "U" ? "bg-marca-suave/50" : "hover:bg-fondo/60"}>
                <td className="px-3 py-2">
                  <input
                    type="radio"
                    name={grupo}
                    value="U"
                    checked={seleccionada === "U"}
                    onChange={() => onSeleccionar("U")}
                    aria-label="Elegir mi curva (curva del usuario) para aprobarla"
                    className="h-4 w-4 accent-marca"
                  />
                </td>
                <td className="px-3 py-2">
                  <p className="font-medium text-tinta">U · Mi curva</p>
                  <p className="max-w-md text-xs text-tinta-suave">Las doce participaciones que escribiste; se mide en muestra y nunca se recomienda.</p>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {usuario.eat_en_muestra === null ? (
                    <span className="text-tinta-suave">—</span>
                  ) : (
                    <div>
                      <span className="font-medium">{formatearPp(usuario.eat_en_muestra)}</span>
                      <span className="block text-xs font-medium text-alerta">EN MUESTRA</span>
                      <span className="block text-xs text-tinta-suave">{ruido === null ? "ruido no medible" : `ruido ${formatearPp(ruido)}`}</span>
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {usuario.error_max_en_muestra === null ? <span className="text-tinta-suave">—</span> : <>{formatearPp(usuario.error_max_en_muestra)}<span className="block text-xs text-tinta-suave">en muestra</span></>}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {usuario.eat_parcial_en_muestra === null ? <span className="text-tinta-suave">—</span> : <>{formatearPp(usuario.eat_parcial_en_muestra)}<span className="block text-xs text-tinta-suave">en muestra</span></>}
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tono="marca">Curva del usuario</Badge>
                    {usuario.igual_a && <Badge tono="neutro">Igual a {usuario.igual_a}</Badge>}
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-tinta-suave">{textoRuido(resultado)}</p>
      <p className="text-xs text-tinta-suave">
        «Fuera de muestra» es el backtesting (se deja un año fuera y se mide contra él); «en muestra» es la curva completa contra los años con que se armó, y es lo único que se puede comparar con
        una curva escrita a mano.
      </p>
      {resultado.margen !== null && (
        <p className="text-xs text-tinta-suave">
          Para apartarse del promedio simple (A), otra candidata debe mejorarlo en más de {formatearPp(resultado.margen)} (el margen es {formatearDecimal(resultado.comparacion?.margen_ruido ?? 0.25, 2)} × el ruido entre años normales, con un mínimo).
        </p>
      )}
    </div>
  );
}

/** «Cómo se armó F»: pesos por año, `ρ`, `δ`, `λ`, la curva base y la contraída hacia `T`, y lo que hizo en cada prueba (solo con los años de entrenamiento). */
function DetalleDeF({ c }: { c: CandidataApi }) {
  const d = c.detalle_f;
  if (!d) return null;
  const pct = (v: number) => formatearDecimal(v * 100, 1);
  return (
    <div className="space-y-2 rounded-md border border-borde bg-superficie p-3">
      <ul className="flex flex-wrap gap-x-5 gap-y-1">
        {d.pesos_anios.map((p) => (
          <li key={p.anio}>
            {p.anio}: <strong className="text-tinta">{formatearDecimal(p.peso * 100, 0)} %</strong>
          </li>
        ))}
      </ul>
      <p>
        ρ (ruido entre años normales) <strong className="text-tinta">{formatearDecimal(d.rho, 1)} pp</strong> · δ (distancia a la temporada){" "}
        <strong className="text-tinta">{d.delta === null ? "—" : `${formatearDecimal(d.delta, 1)} pp`}</strong> · λ (contracción hacia T){" "}
        <strong className="text-tinta">{formatearDecimal(d.lambda * 100, 0)} %</strong>
      </p>
      <div className="overflow-x-auto">
        <table className="w-full">
          <caption className="sr-only">Curva base de F y curva contraída hacia la temporada, en porcentaje.</caption>
          <thead>
            <tr>
              <th scope="col" className="px-1 py-1 text-left font-medium" />
              {MESES.map((m) => (
                <th key={m} scope="col" className="px-1 py-1 text-right font-medium">
                  {m}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="tabular-nums">
            <tr>
              <th scope="row" className="px-1 py-1 text-left font-medium">
                Base (por recencia)
              </th>
              {d.base.map((v, i) => (
                <td key={i} className="px-1 py-1 text-right">
                  {pct(v)}
                </td>
              ))}
            </tr>
            {d.t_usada && (
              <tr>
                <th scope="row" className="px-1 py-1 text-left font-medium">
                  Temporada (T)
                </th>
                {d.t_usada.map((v, i) => (
                  <td key={i} className="px-1 py-1 text-right">
                    {pct(v)}
                  </td>
                ))}
              </tr>
            )}
            <tr>
              <th scope="row" className="px-1 py-1 text-left font-medium text-tinta">
                F (contraída)
              </th>
              {d.contraida.map((v, i) => (
                <td key={i} className="px-1 py-1 text-right font-medium text-tinta">
                  {pct(v)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      {d.por_pliegue.length > 0 && (
        <div>
          <p className="font-medium text-tinta">Por pliegue (en cada prueba, ρ y λ salen solo de los años de entrenamiento)</p>
          <ul className="flex flex-wrap gap-x-6 gap-y-1">
            {d.por_pliegue.map((p) => (
              <li key={p.anio_prueba}>
                Sin {p.anio_prueba}: ρ {formatearDecimal(p.rho, 1)} · λ {formatearDecimal(p.lambda * 100, 0)} % · EAT <strong className="text-tinta">{formatearPp(p.eat)}</strong>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
