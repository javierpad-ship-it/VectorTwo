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
  descripcionClase,
  filasCsvAnioMes,
  formatearDiferenciaPp,
  formatearPctSolo,
} from "./vista";

/**
 * Tabla año × mes del detalle (también es la alternativa accesible del gráfico):
 * participación con un decimal y, debajo, las unidades de la red comparable de
 * ese año. Los meses imputados van en cursiva; los atípicos, con fondo; el año en
 * curso muestra «—» en los meses sin cargar; un punto ámbar marca la liquidación.
 * La cabecera de cada año lleva clase, tratamiento, tiendas en la red y el peso de la mayor.
 */
export function TablaAnioMes({
  id,
  anios,
  propuesta,
  vigente,
  umbralDominante,
  nombreArchivo,
}: {
  id: string;
  anios: readonly AnioAgrupacion[];
  /** Curva de la candidata seleccionada (fracciones). */
  propuesta: { etiqueta: string; curva: number[] } | null;
  vigente: { etiqueta: string; curva: number[] } | null;
  umbralDominante: number;
  nombreArchivo: string;
}) {
  const ordenados = useMemo(() => [...anios].sort((a, b) => a.anio - b.anio), [anios]);

  function descargar() {
    const { campos, datos } = filasCsvAnioMes(ordenados, propuesta?.curva ?? null, vigente?.curva ?? null);
    descargarCsv(campos, datos, nombreArchivo);
  }

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <Button variante="secundario" tamano="sm" onClick={descargar}>
          Descargar CSV
        </Button>
      </div>
      <div className="overflow-x-auto rounded-lg border border-borde">
        <table id={id} className="w-full text-sm">
          <caption className="sr-only">
            Participación mensual de cada año (porcentaje del total del año) y unidades de la red comparable, con la curva propuesta y la vigente.
          </caption>
          <thead className="bg-neutro-suave text-left text-xs text-tinta-suave">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium uppercase tracking-wide">
                Mes
              </th>
              {ordenados.map((a) => (
                <th key={a.anio} scope="col" className="min-w-32 px-3 py-2 align-top font-medium">
                  <span className="block text-sm font-semibold text-tinta">{a.anio}</span>
                  <span className={`block font-normal ${claseColorAnio(a.clase, a.escaso)}`}>{descripcionClase(a)}</span>
                  <span className="block font-normal">
                    {a.tiendas_en_red} {a.tiendas_en_red === 1 ? "tienda" : "tiendas"} · {formatearUnidades(a.unidades)} u.
                  </span>
                  {a.peso_tienda_mayor !== null && (
                    <span className="mt-0.5 flex flex-wrap items-center gap-1 font-normal">
                      mayor {formatearPctSolo(a.peso_tienda_mayor, 0)} %
                      {a.peso_tienda_mayor > umbralDominante && <Badge tono="alerta">Dominante</Badge>}
                    </span>
                  )}
                  {a.escaso && <span className="mt-0.5 block"><Badge tono="neutro">Escaso</Badge></span>}
                  {a.liquidacion.length > 0 && (
                    <span className="mt-0.5 block font-normal text-alerta">liquidación: {a.liquidacion.length} {a.liquidacion.length === 1 ? "mes" : "meses"}</span>
                  )}
                </th>
              ))}
              <th scope="col" className="min-w-24 px-3 py-2 align-top font-semibold text-marca-oscura">
                Propuesta
                {propuesta && <span className="block text-xs font-normal">{propuesta.etiqueta}</span>}
              </th>
              <th scope="col" className="min-w-24 px-3 py-2 align-top font-semibold text-tinta">
                Vigente
                {vigente && <span className="block text-xs font-normal">{vigente.etiqueta}</span>}
              </th>
              <th scope="col" className="min-w-20 px-3 py-2 align-top font-medium">
                Diferencia (pp)
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-borde">
            {MESES_CORTOS.map((nombre, mes) => {
              const dif = propuesta && vigente ? (propuesta.curva[mes] - vigente.curva[mes]) * 100 : null;
              return (
                <tr key={nombre} className="hover:bg-fondo/60">
                  <th scope="row" className="whitespace-nowrap px-3 py-1.5 text-left font-medium">
                    {nombre}
                  </th>
                  {ordenados.map((a) => {
                    const c = celdaAnioMes(a, mes);
                    if (c.participacion === null && c.unidades === null)
                      return (
                        <td key={a.anio} className="px-3 py-1.5 text-right text-tinta-suave" title="Mes sin cargar">
                          —
                        </td>
                      );
                    return (
                      <td
                        key={a.anio}
                        className={`px-3 py-1.5 text-right tabular-nums ${c.atipico ? "bg-alerta-suave/60" : ""} ${a.escaso ? "text-tinta-suave" : ""}`}
                        title={[c.atipico ? "Mes atípico" : null, c.imputado ? "Mes imputado con la referencia" : null, c.liquidacion ? "Mes en liquidación" : null].filter(Boolean).join(" · ") || undefined}
                      >
                        <span className={`block ${c.imputado ? "italic" : ""}`}>
                          {formatearPctSolo(c.participacion)}
                          {c.liquidacion && <span aria-label="en liquidación" className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-[#f59e0b] align-middle" />}
                        </span>
                        <span className="block text-xs text-tinta-suave">{c.unidades === null ? "—" : formatearUnidades(c.unidades)}</span>
                      </td>
                    );
                  })}
                  <td className="px-3 py-1.5 text-right font-medium tabular-nums text-marca-oscura">{propuesta ? formatearPctSolo(propuesta.curva[mes]) : "—"}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{vigente ? formatearPctSolo(vigente.curva[mes]) : "—"}</td>
                  <td className={`px-3 py-1.5 text-right tabular-nums ${claseDiferencia(dif)}`}>{dif === null ? "—" : formatearDiferenciaPp(dif)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="border-t border-borde bg-neutro-suave/60">
            <tr>
              <th scope="row" className="px-3 py-1.5 text-left font-semibold">
                Total
              </th>
              {ordenados.map((a) => (
                <td key={a.anio} className="px-3 py-1.5 text-right tabular-nums">
                  <span className="block font-semibold">{formatearUnidades(a.unidades)}</span>
                  <span className="block text-xs text-tinta-suave">{a.meses_cargados < 12 ? `${a.meses_cargados} meses` : "12 meses"}</span>
                </td>
              ))}
              <td className="px-3 py-1.5 text-right tabular-nums text-tinta-suave">{propuesta ? "100.0" : "—"}</td>
              <td className="px-3 py-1.5 text-right tabular-nums text-tinta-suave">{vigente ? "100.0" : "—"}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="text-xs text-tinta-suave">
        Arriba, la participación del mes en el total de su año (%); debajo, las unidades de la red comparable de ese año. En cursiva, meses imputados con la referencia; con
        fondo, meses atípicos; punto ámbar, mes en liquidación; «—», mes sin cargar. El año en curso se mide solo sobre los meses cargados.
      </p>
    </div>
  );
}
