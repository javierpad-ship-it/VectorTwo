"use client";

import { useMemo } from "react";
import type { AgrupacionResultado, FormaAnioCompleto, FormaAnioParcial } from "@/lib/curvas/tipos-api";
import { MESES_CORTOS } from "@/lib/reportes/histograma";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { MiniCurva } from "@/components/curvas/mini-curva";
import {
  ETIQUETA_TRATAMIENTO,
  ETIQUETA_VEREDICTO,
  formatearFactor,
  formatearPct,
  formatearPp,
  formatearRatio,
  mesPico,
  nombreMes,
  referenciaForma,
  textoCorrimiento,
  textoMesesImputados,
  textoVeredictoForma,
} from "./vista";

/** Barras de doce meses con el ratio mes a mes (1,0 = igual que el año de referencia). */
function BarrasRatio({ valores, etiqueta }: { valores: (number | null)[]; etiqueta: string }) {
  const maximo = Math.max(1.5, ...valores.map((v) => v ?? 0));
  return (
    <div role="img" aria-label={etiqueta} className="flex h-10 items-end gap-0.5">
      {valores.map((v, i) => (
        <div key={i} className="flex w-3 flex-col items-center justify-end" title={`${MESES_CORTOS[i]}: ${v === null ? "sin dato" : formatearRatio(v)}`}>
          <div className={`w-full rounded-t-sm ${v === null ? "bg-neutro-suave" : v >= 1 ? "bg-exito/70" : "bg-alerta/70"}`} style={{ height: `${v === null ? 4 : Math.max(2, (v / maximo) * 100)}%` }} />
        </div>
      ))}
    </div>
  );
}

function FormaCompleto({ f, ruido, umbralEfectivo, anio, referencia }: { f: FormaAnioCompleto; ruido: number | null; umbralEfectivo: number; anio: AgrupacionResultado["anios"][number] | undefined; referencia: number[] | null }) {
  const real = anio?.participacion_real ?? anio?.participacion ?? null;
  return (
    <div className="flex flex-wrap items-start gap-4 rounded-lg border border-borde p-3">
      <div className="space-y-1">
        <p className="text-sm font-semibold text-tinta">{f.anio}</p>
        {real && referencia ? (
          <>
            <MiniCurva vigente={referencia} propuesta={real} ancho={140} alto={44} etiqueta={`Participación de ${f.anio} (trazo discontinuo) frente a la referencia de los años normales (trazo sólido)`} />
            <p className="text-[11px] text-tinta-suave">discontinua: {f.anio} · sólida: referencia</p>
          </>
        ) : (
          <p className="text-xs text-tinta-suave">Sin referencia que dibujar.</p>
        )}
      </div>
      <div className="min-w-60 flex-1 space-y-1 text-sm">
        <p>
          <Badge tono={f.veredicto === "forma_cambia" ? "alerta" : f.veredicto === "forma_estable" ? "exito" : "neutro"}>{ETIQUETA_VEREDICTO[f.veredicto]}</Badge>{" "}
          <span className="text-tinta-suave">{textoVeredictoForma({ veredicto: f.veredicto, diferencia: f.diferencia_anio, ruido, umbralEfectivo })}.</span>
        </p>
        <ul className="space-y-0.5 text-xs text-tinta-suave">
          <li>
            Tres cifras: diferencia {formatearPp(f.diferencia_anio)} · ruido entre años normales {ruido === null ? "no medible" : formatearPp(ruido)} · umbral efectivo {formatearPp(umbralEfectivo)}.
          </li>
          <li>
            Pico en {mesPico(f.pico)} (referencia: {mesPico(f.pico_referencia)}): {textoCorrimiento(f.corrimiento_pico)}. Mes de mayor diferencia: {nombreMes(f.mes_mayor_diferencia)}.
          </li>
          {f.tratamiento_aplicado && <li>Tratamiento aplicado: {ETIQUETA_TRATAMIENTO[f.tratamiento_aplicado]}.</li>}
        </ul>
      </div>
    </div>
  );
}

function FormaParcial({ f }: { f: FormaAnioParcial }) {
  return (
    <div className="rounded-lg border border-dashed border-borde p-3 text-sm">
      <p className="font-semibold text-tinta">
        {f.anio} <span className="font-normal text-tinta-suave">(parcial, {f.meses_comparados} meses cargados; informativa, no cambia el tratamiento)</span>
      </p>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <div className="rounded-md bg-neutro-suave/60 p-2">
          <p className="text-xs font-medium text-tinta-suave">Red completa de {f.anio}</p>
          <p className="text-base font-semibold tabular-nums">{f.red_completa ? formatearPp(f.red_completa.diferencia_anio) : "—"}</p>
          {f.red_completa && <p className="text-xs text-tinta-suave">pico en {mesPico(f.red_completa.pico)}</p>}
        </div>
        <div className="rounded-md bg-neutro-suave/60 p-2">
          <p className="text-xs font-medium text-tinta-suave">Tiendas comunes con el año de referencia{f.tiendas_comunes ? ` (${f.tiendas_comunes.tiendas})` : ""}</p>
          <p className="text-base font-semibold tabular-nums">{f.tiendas_comunes ? formatearPp(f.tiendas_comunes.diferencia_anio) : "—"}</p>
          {f.tiendas_comunes && <p className="text-xs text-tinta-suave">pico en {mesPico(f.tiendas_comunes.pico)}</p>}
        </div>
      </div>
      <p className="mt-2 text-xs text-tinta-suave">
        La diferencia entre las dos separa el efecto de una tienda nueva del efecto del año: si la de la red completa es mayor, parte del cambio de forma viene de
        las tiendas que no estaban el año anterior.
      </p>
    </div>
  );
}

/**
 * «Efecto del Niño» del detalle (solo si hay años atípicos): Volumen (ratio
 * frente al año normal más cercano sobre tiendas comunes, con el ratio mes a mes)
 * y Forma (por año, p(Y) frente a la referencia con las tres cifras; el año en
 * curso con las dos formas parciales). Calcula la referencia `r` como promedio de
 * los años normales.
 */
export function EfectoNinoDetalle({ resultado }: { resultado: AgrupacionResultado }) {
  const { volumen, forma } = resultado.efecto_atipico;
  const referencia = useMemo(() => referenciaForma(resultado.anios), [resultado.anios]);
  const imputados = resultado.anios.filter((a) => a.imputados.length > 0 && a.peso_imputado !== null);
  if (volumen.length === 0 && !forma && imputados.length === 0) return null;

  return (
    <Card
      titulo="Efecto del Niño"
      descripcion="Se mide en dos dimensiones separadas: cuánto cambia el volumen y cuánto cambia la forma del año. Nada se asume."
    >
      <div className="space-y-6">
        {volumen.length > 0 && (
          <section aria-label="Volumen" className="space-y-3">
            <h3 className="text-sm font-semibold text-tinta">Volumen</h3>
            <div className="space-y-3">
              {volumen.map((v) => (
                <div key={v.anio} className="flex flex-wrap items-start gap-x-6 gap-y-2 rounded-lg border border-borde p-3">
                  <div className="min-w-56 space-y-0.5 text-sm">
                    <p className="font-semibold text-tinta">
                      {v.anio} <span className="text-lg tabular-nums">{formatearFactor(v.ratio_volumen)}</span>
                    </p>
                    <p className="text-xs text-tinta-suave">
                      {v.ratio_volumen === null
                        ? "Sin año normal o sin tiendas comunes con qué comparar."
                        : `frente a ${v.anio_referencia ?? "el año de referencia"}, sobre ${v.tiendas_comunes} ${v.tiendas_comunes === 1 ? "tienda común" : "tiendas comunes"}, ${v.meses_comparados} ${v.meses_comparados === 1 ? "mes" : "meses"} comparados`}
                    </p>
                    {v.por_anio_normal.length > 1 && (
                      <p className="text-xs text-tinta-suave">
                        Sensibilidad: {v.por_anio_normal.map((p) => `frente a ${p.anio} ${formatearFactor(p.ratio)}`).join(" · ")}
                      </p>
                    )}
                  </div>
                  <div className="space-y-1">
                    <BarrasRatio valores={v.ratio_mensual} etiqueta={`Ratio mes a mes de ${v.anio} frente a ${v.anio_referencia ?? "la referencia"}`} />
                    <p className="text-[11px] text-tinta-suave">ratio mes a mes (verde sube, rojo baja)</p>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-xs text-tinta-suave">
              Diagnóstico por agrupación. El factor que recibe M7 es el de la temporada: ver la pestaña Años Niño.
            </p>
          </section>
        )}

        {forma && (
          <section aria-label="Forma" className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-tinta">Forma</h3>
              <Badge tono={forma.veredicto === "forma_cambia" ? "alerta" : forma.veredicto === "forma_estable" ? "exito" : "neutro"}>{ETIQUETA_VEREDICTO[forma.veredicto]}</Badge>
              <span className="text-xs text-tinta-suave">
                ruido entre años normales {forma.ruido_normal === null ? "no medible" : formatearPp(forma.ruido_normal)} · piso {formatearPp(forma.umbral)} · umbral efectivo {formatearPp(forma.umbral_efectivo)}
                {forma.diferencia_forma !== null && <> · efecto diluido en la curva {formatearPp(forma.diferencia_forma)}</>}
              </span>
            </div>
            <div className="space-y-3">
              {forma.por_anio.map((f) =>
                f.parcial ? (
                  <FormaParcial key={f.anio} f={f} />
                ) : (
                  <FormaCompleto key={f.anio} f={f} ruido={forma.ruido_normal} umbralEfectivo={forma.umbral_efectivo} anio={resultado.anios.find((a) => a.anio === f.anio)} referencia={referencia} />
                )
              )}
            </div>
          </section>
        )}

        {imputados.length > 0 && (
          <section aria-label="Meses imputados" className="space-y-1">
            <h3 className="text-sm font-semibold text-tinta">Peso de los meses imputados</h3>
            <ul className="text-sm text-tinta-suave">
              {imputados.map((a) => (
                <li key={a.anio}>
                  {a.anio}: {textoMesesImputados(a.imputados)} vienen de la referencia, no del año; pesan {formatearPct(a.peso_imputado)} de su curva.
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </Card>
  );
}
