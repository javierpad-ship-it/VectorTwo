"use client";

import { useMemo } from "react";
import { descargarCsv } from "@/components/importador/csv";
import { MESES_CORTOS, formatearUnidades } from "@/lib/reportes/histograma";
import type { AnioAgrupacion } from "@/lib/curvas/tipos-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  celdaAnioMes,
  claseColorAnio,
  claseDiferencia,
  compararCurvas,
  descripcionClase,
  filasCsvAnioMes,
  formatearDiferenciaPp,
  formatearPctSolo,
  formatearPp,
  formatearRatio,
  resumenMensual,
} from "./vista";

const SIN_DATO = <span className="text-tinta-suave">—</span>;

/**
 * Tabla año × mes de la vista de trabajo (también es la alternativa accesible del gráfico): una
 * fila por año con la participación del mes (%) y, debajo, las unidades de la red comparable de ese
 * año; después, las filas «Propuesta», «Aprobada vN» y «Diferencia (pp)» (propuesta − aprobada), y
 * las tres filas del visor de Vector-One por mes: promedio de unidades, índice (1.00 = mes
 * promedio) y años considerados. Los meses imputados van en cursiva; los atípicos, con fondo; el
 * año en curso muestra «—» en los meses sin cargar; un punto ámbar marca la liquidación. Un año
 * sin curva (sin red comparable, sin volumen, meses sin cargar) se lista con «—» y el motivo.
 */
export function TablaAnioMes({
  id,
  anios,
  propuesta,
  vigente,
  umbralDominante,
  nombreArchivo,
  motivos,
}: {
  id: string;
  anios: readonly AnioAgrupacion[];
  /** Curva de la candidata seleccionada (fracciones). */
  propuesta: { etiqueta: string; curva: number[] } | null;
  /** La curva aprobada vigente (etiqueta `Aprobada v2 (A)`). */
  vigente: { etiqueta: string; curva: number[] } | null;
  umbralDominante: number;
  nombreArchivo: string;
  /** Por qué un año no se pudo dibujar (año → motivo). */
  motivos?: ReadonlyMap<number, string>;
}) {
  const ordenados = useMemo(() => [...anios].sort((a, b) => a.anio - b.anio), [anios]);
  const resumen = useMemo(() => resumenMensual(ordenados), [ordenados]);
  const comparacion = useMemo(() => (propuesta && vigente ? compararCurvas(vigente.curva, propuesta.curva, true) : null), [propuesta, vigente]);

  function descargar() {
    const { campos, datos } = filasCsvAnioMes(ordenados, propuesta?.curva ?? null, vigente?.curva ?? null);
    descargarCsv(campos, datos, nombreArchivo);
  }

  const celdaCurva = (curva: readonly number[] | undefined, mes: number, clase: string) => (
    <td key={mes} className={`px-2 py-1.5 text-right tabular-nums ${clase}`}>
      {curva ? formatearPctSolo(curva[mes]) : "—"}
    </td>
  );

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <Button variante="secundario" tamano="sm" onClick={descargar}>
          Descargar CSV
        </Button>
      </div>
      <div className="overflow-x-auto rounded-lg border border-borde" role="region" aria-label="Tabla año por mes (desplazable)" tabIndex={0}>
        <table id={id} className="w-full text-sm">
          <caption className="sr-only">
            Participación mensual de cada año (porcentaje del total del año) y unidades de la red comparable, con la curva propuesta, la aprobada, su diferencia en puntos
            porcentuales, el promedio de unidades, el índice de cada mes y los años considerados.
          </caption>
          <thead className="bg-neutro-suave text-xs text-tinta-suave">
            <tr>
              <th scope="col" className="sticky left-0 z-10 min-w-44 bg-neutro-suave px-3 py-2 text-left font-medium uppercase tracking-wide">
                Año / fila
              </th>
              {MESES_CORTOS.map((m) => (
                <th key={m} scope="col" className="min-w-14 px-2 py-2 text-right font-medium uppercase">
                  {m}
                </th>
              ))}
              <th scope="col" className="min-w-20 px-3 py-2 text-right font-medium">
                Total
              </th>
              <th scope="col" className="min-w-24 px-3 py-2 text-right font-medium">
                Tiendas
              </th>
            </tr>
          </thead>

          <tbody className="divide-y divide-borde">
            {ordenados.map((a) => {
              const motivo = motivos?.get(a.anio) ?? null;
              return (
                <tr key={a.anio} className="align-top hover:bg-fondo/60">
                  <th scope="row" className="sticky left-0 z-10 bg-superficie px-3 py-1.5 text-left font-normal">
                    <span className="block text-sm font-semibold text-tinta">{a.anio}</span>
                    <span className={`block text-xs ${claseColorAnio(a.clase, a.escaso)}`}>{descripcionClase(a)}</span>
                    {a.escaso && (
                      <span className="mt-0.5 block">
                        <Badge tono="neutro">Escaso</Badge>
                      </span>
                    )}
                    {a.liquidacion.length > 0 && (
                      <span className="block text-xs text-alerta">
                        liquidación: {a.liquidacion.length} {a.liquidacion.length === 1 ? "mes" : "meses"}
                      </span>
                    )}
                  </th>
                  {motivo ? (
                    <td colSpan={12} className="px-3 py-1.5 text-xs text-tinta-suave">
                      — {motivo}
                    </td>
                  ) : (
                    MESES_CORTOS.map((nombre, mes) => {
                      const c = celdaAnioMes(a, mes);
                      if (c.participacion === null && c.unidades === null)
                        return (
                          <td key={nombre} className="px-2 py-1.5 text-right text-tinta-suave" title="Mes sin cargar">
                            —
                          </td>
                        );
                      return (
                        <td
                          key={nombre}
                          className={`px-2 py-1.5 text-right tabular-nums ${c.atipico ? "bg-alerta-suave/60" : ""} ${a.escaso || a.tratamiento === "descartado" ? "text-tinta-suave" : ""}`}
                          title={[c.atipico ? "Mes atípico" : null, c.imputado ? "Mes imputado con la referencia" : null, c.liquidacion ? "Mes en liquidación" : null].filter(Boolean).join(" · ") || undefined}
                        >
                          <span className={`block ${c.imputado ? "italic" : ""}`}>
                            {formatearPctSolo(c.participacion)}
                            {c.liquidacion && <span aria-label="en liquidación" className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-[#f59e0b] align-middle" />}
                          </span>
                          <span className="block text-xs text-tinta-suave">{c.unidades === null ? "—" : formatearUnidades(c.unidades)}</span>
                        </td>
                      );
                    })
                  )}
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {motivo ? (
                      SIN_DATO
                    ) : (
                      <>
                        <span className="block font-semibold">{formatearUnidades(a.unidades)}</span>
                        <span className="block text-xs text-tinta-suave">{a.meses_cargados < 12 ? `${a.meses_cargados} meses` : "12 meses"}</span>
                      </>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right text-xs">
                    {motivo ? (
                      SIN_DATO
                    ) : (
                      <>
                        <span className="block tabular-nums text-tinta">
                          {a.tiendas_en_red} {a.tiendas_en_red === 1 ? "tienda" : "tiendas"}
                        </span>
                        {a.peso_tienda_mayor !== null && (
                          <span className="flex flex-wrap items-center justify-end gap-1 text-tinta-suave">
                            mayor {formatearPctSolo(a.peso_tienda_mayor, 0)} %
                            {a.peso_tienda_mayor > umbralDominante && <Badge tono="alerta">Dominante</Badge>}
                          </span>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>

          <tbody className="divide-y divide-borde border-t-2 border-borde">
            <tr>
              <th scope="row" className="sticky left-0 z-10 bg-superficie px-3 py-1.5 text-left font-semibold text-marca-oscura">
                {propuesta ? propuesta.etiqueta : "Propuesta"}
              </th>
              {MESES_CORTOS.map((_, mes) => celdaCurva(propuesta?.curva, mes, "font-medium text-marca-oscura"))}
              <td className="px-3 py-1.5 text-right tabular-nums text-tinta-suave">{propuesta ? "100.0 %" : "—"}</td>
              <td />
            </tr>
            <tr>
              <th scope="row" className="sticky left-0 z-10 bg-superficie px-3 py-1.5 text-left font-semibold text-tinta">
                {vigente ? vigente.etiqueta : "Aprobada"}
                {!vigente && <span className="block text-xs font-normal text-tinta-suave">sin curva aprobada</span>}
              </th>
              {MESES_CORTOS.map((_, mes) => celdaCurva(vigente?.curva, mes, ""))}
              <td className="px-3 py-1.5 text-right tabular-nums text-tinta-suave">{vigente ? "100.0 %" : "—"}</td>
              <td />
            </tr>
            <tr className="bg-neutro-suave/50">
              <th scope="row" className="sticky left-0 z-10 bg-neutro-suave px-3 py-1.5 text-left font-semibold">
                Diferencia (pp)
                <span className="block text-xs font-normal text-tinta-suave">propuesta − aprobada</span>
              </th>
              {MESES_CORTOS.map((_, mes) => {
                const dif = comparacion ? comparacion.diferencias[mes] : null;
                return (
                  <td key={mes} className={`px-2 py-1.5 text-right font-medium tabular-nums ${claseDiferencia(dif)}`}>
                    {dif === null ? "—" : formatearDiferenciaPp(dif)}
                  </td>
                );
              })}
              <td className="px-3 py-1.5 text-right text-xs tabular-nums text-tinta-suave" colSpan={2}>
                {comparacion ? `EAT ${formatearPp(comparacion.eat)}` : "—"}
              </td>
            </tr>
          </tbody>

          <tbody className="divide-y divide-borde border-t-2 border-borde text-xs">
            <tr>
              <th scope="row" className="sticky left-0 z-10 bg-superficie px-3 py-1.5 text-left font-medium">
                Promedio de unidades
              </th>
              {resumen.promedio.map((p, mes) => (
                <td key={mes} className="px-2 py-1.5 text-right tabular-nums">
                  {p === null ? "—" : formatearUnidades(p)}
                </td>
              ))}
              <td colSpan={2} />
            </tr>
            <tr>
              <th scope="row" className="sticky left-0 z-10 bg-superficie px-3 py-1.5 text-left font-medium">
                Índice del mes
                <span className="block font-normal text-tinta-suave">1.00 = mes promedio</span>
              </th>
              {resumen.indice.map((v, mes) => (
                <td key={mes} className={`px-2 py-1.5 text-right font-semibold tabular-nums ${v !== null && v >= 1 ? "text-marca-oscura" : "text-tinta-suave"}`}>
                  {v === null ? "—" : formatearRatio(v)}
                </td>
              ))}
              <td colSpan={2} />
            </tr>
            <tr>
              <th scope="row" className="sticky left-0 z-10 bg-superficie px-3 py-1.5 text-left font-medium">
                Años considerados
              </th>
              {resumen.considerados.map((n, mes) => (
                <td key={mes} className="px-2 py-1.5 text-right tabular-nums">
                  {n === 0 ? "—" : n}
                </td>
              ))}
              <td colSpan={2} />
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-xs text-tinta-suave">
        Arriba, la participación del mes en el total de su año (%); debajo, las unidades de la red comparable de ese año. En cursiva, meses imputados con la referencia; con fondo,
        meses atípicos; punto ámbar, mes en liquidación; «—», mes sin cargar. El año en curso se mide solo sobre los meses cargados. Promedio, índice y años considerados cuentan
        solo los años que entraron al ajuste; cada año se mide sobre su propia red comparable, así que las unidades de años distintos no son del mismo conjunto de tiendas.
      </p>
    </div>
  );
}
