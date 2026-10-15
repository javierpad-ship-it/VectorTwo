"use client";

import { Fragment, useMemo, useState } from "react";
import { descargarCsv } from "@/components/importador/csv";
import { formatearNumero } from "@/lib/formato";
import { MESES_CORTOS } from "@/lib/reportes/histograma";
import type { AniosAtipicosNinoApi, EfectoTemporadaAnio } from "@/lib/curvas/tipos-api";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chips, type ChipItem } from "@/components/ui/chips";
import { BadgeTemporada } from "@/components/estacionalidad/temporada";
import { useRecurso } from "./use-recurso";
import {
  ETIQUETA_AVISO,
  etiquetaTemporadaORed,
  filasCsvFactoresM7,
  filasVolumen,
  formatearFechaHora,
  formatearRatio,
  lecturaVolumen,
  rangoPrimerosMeses,
  type FiltroTemporada,
} from "./vista";

const CODIGOS_NINO = new Set(["pocos_anos_normales", "sin_referencia_volumen", "ano_atipico_completo"]);

function Celda({ v, decimales = 2 }: { v: number | null; decimales?: number }) {
  return <span className="tabular-nums">{v === null ? <span className="text-tinta-suave">—</span> : formatearRatio(v, decimales)}</span>;
}

/** Texto de la comparación: «ene–set frente a ene–set de 2025». */
function textoComparacion(f: EfectoTemporadaAnio): string {
  if (f.anio_referencia === null) return "sin año de referencia";
  if (f.meses_comparados >= 12) return `año completo frente a ${f.anio_referencia}`;
  const r = rangoPrimerosMeses(f.meses_comparados);
  return `${r} frente a ${r} de ${f.anio_referencia}`;
}

function BloqueVolumen({ filas }: { filas: EfectoTemporadaAnio[] }) {
  const [abiertas, setAbiertas] = useState<ReadonlySet<string>>(new Set());
  const alternar = (k: string) =>
    setAbiertas((prev) => {
      const sig = new Set(prev);
      if (sig.has(k)) sig.delete(k);
      else sig.add(k);
      return sig;
    });
  const lecturas = filas.filter((f) => f.temporada !== "red" && f.ratio_control !== null);

  if (filas.length === 0) return <p className="text-sm text-tinta-suave">No hay filas de volumen para este filtro.</p>;
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border border-borde">
        <table className="w-full text-sm">
          <caption className="sr-only">Ratios de volumen por temporada y año con su control, ratio relativo y crecimiento normal.</caption>
          <thead className="bg-neutro-suave text-left text-xs uppercase tracking-wide text-tinta-suave">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">Temporada</th>
              <th scope="col" className="px-3 py-2 font-medium">Año</th>
              <th scope="col" className="px-3 py-2 text-right font-medium" title="Unidades del año frente al año normal más cercano, sobre las tiendas comunes">Ratio de volumen</th>
              <th scope="col" className="px-3 py-2 text-right font-medium" title="El mismo ratio para las agrupaciones de toda temporada del mismo año y las mismas tiendas">Control (toda temporada)</th>
              <th scope="col" className="px-3 py-2 text-right font-medium" title="Ratio de volumen ÷ control">Ratio relativo</th>
              <th scope="col" className="px-3 py-2 text-right font-medium" title="Ratio entre los dos años normales más recientes de la temporada">Crecimiento normal</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Unidades / referencia</th>
              <th scope="col" className="px-3 py-2 font-medium">Base de comparación</th>
              <th scope="col" className="px-3 py-2 font-medium" />
            </tr>
          </thead>
          <tbody className="divide-y divide-borde">
            {filas.map((f) => {
              const k = `${f.temporada}-${f.anio}`;
              const abierta = abiertas.has(k);
              return (
                <Fragment key={k}>
                  <tr className="hover:bg-fondo/60">
                    <td className="px-3 py-2 font-medium">{etiquetaTemporadaORed(f.temporada)}</td>
                    <td className="px-3 py-2">{f.anio}</td>
                    <td className="px-3 py-2 text-right font-semibold"><Celda v={f.ratio_volumen} /></td>
                    <td className="px-3 py-2 text-right"><Celda v={f.ratio_control} decimales={3} /></td>
                    <td className="px-3 py-2 text-right font-semibold"><Celda v={f.ratio_relativo} /></td>
                    <td className="px-3 py-2 text-right"><Celda v={f.crecimiento_normal} /></td>
                    <td className="px-3 py-2 text-right text-xs tabular-nums text-tinta-suave">
                      {formatearNumero(Math.round(f.unidades))} / {formatearNumero(Math.round(f.unidades_referencia))}
                    </td>
                    <td className="px-3 py-2 text-xs text-tinta-suave">
                      {textoComparacion(f)}
                      <span className="block">
                        {f.tiendas_comunes} {f.tiendas_comunes === 1 ? "tienda común" : "tiendas comunes"} · {f.agrupaciones} {f.agrupaciones === 1 ? "agrupación" : "agrupaciones"}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        aria-expanded={abierta}
                        onClick={() => alternar(k)}
                        className="text-xs font-medium text-marca-oscura underline underline-offset-2"
                      >
                        {abierta ? "Ocultar meses" : "Ver mes a mes"}
                      </button>
                    </td>
                  </tr>
                  {abierta && (
                    <tr className="bg-fondo/60">
                      <td colSpan={9} className="px-3 py-2">
                        <p className="mb-1 text-xs font-medium text-tinta">Ratio mes a mes ({etiquetaTemporadaORed(f.temporada)} {f.anio} frente a {f.anio_referencia ?? "la referencia"})</p>
                        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs tabular-nums">
                          {f.ratio_mensual.map((r, i) => (
                            <li key={i} className={r === null ? "text-tinta-suave" : r >= 1 ? "text-exito" : "text-alerta"}>
                              {MESES_CORTOS[i]} {r === null ? "—" : formatearRatio(r)}
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
      {lecturas.length > 0 && (
        <div className="space-y-1 rounded-md bg-neutro-suave/60 p-3 text-sm text-tinta">
          <p className="text-xs font-semibold uppercase tracking-wide text-tinta-suave">Lectura</p>
          <ul className="list-disc space-y-1 pl-5">
            {lecturas.map((f) => (
              <li key={`${f.temporada}-${f.anio}`}>{lecturaVolumen(f)}</li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-xs text-tinta-suave">
        Es una tabla de ratios con sus controles, no un veredicto: el ratio relativo separa lo que le pasó a la temporada de lo que le pasó a toda la red, y el crecimiento
        normal muestra cuánto crece una temporada entre años sin Niño. Todo se mide sobre tiendas comunes; las cifras en crudo de todas las tiendas no se usan.
      </p>
    </div>
  );
}

/**
 * «Forma» no se mide aquí: la forma de cada año atípico frente al ruido entre años normales sale del cálculo de
 * cada agrupación, así que este bloque lista las agrupaciones de la temporada y «Ver» abre su vista de trabajo.
 */
function BloqueForma({ datos, temporada, onVer }: { datos: AniosAtipicosNinoApi; temporada: FiltroTemporada; onVer: (id: string) => void }) {
  const lista = datos.agrupaciones.filter((a) => temporada === "todas" || a.temporada === temporada).sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  return (
    <div className="space-y-3">
      <p className="text-sm text-tinta-suave">
        La forma (si el año atípico cambió cuándo se vende, medida contra el ruido entre años normales) se calcula agrupación por agrupación: ábrela para ver sus tres cifras (diferencia,
        ruido entre años normales y umbral) y el veredicto de cada año del Niño.
      </p>
      {lista.length === 0 ? (
        <p className="text-sm text-tinta-suave">No hay agrupaciones activas en este filtro.</p>
      ) : (
        <ul className="grid gap-2 md:grid-cols-2" aria-label="Agrupaciones para revisar la forma">
          {lista.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 rounded-lg border border-borde px-3 py-2 text-sm">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{a.nombre}</span>
                <BadgeTemporada temporada={a.temporada} />
              </span>
              <Button variante="secundario" tamano="sm" onClick={() => onVer(a.id)}>
                Ver
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Pestaña Años Niño (vista de apoyo, a demanda): lo que el Niño le hizo a cada temporada, medido en volumen (tabla
 * de ratios con control y relativo), y «Lo que recibirá M7» (factores por temporada y crecimiento normal, con
 * descarga). Se calcula al entrar (`GET /api/curvas/anios-atipicos`, sin corrida ni nada guardado) con los
 * parámetros por defecto, no con los de cada curva aprobada; «Volver a calcular» lo repite con los datos de hoy.
 */
export function AniosNinoTab({ onVer }: { onVer: (agrupacionId: string) => void }) {
  const { datos, cargando, error, setError, recargar } = useRecurso<AniosAtipicosNinoApi>("/api/curvas/anios-atipicos");
  const [temporada, setTemporada] = useState<FiltroTemporada>("todas");

  const efecto = datos?.efecto ?? null;
  const filas = useMemo(() => (efecto ? filasVolumen(efecto, temporada) : []), [efecto, temporada]);
  const itemsTemporada: ChipItem<FiltroTemporada>[] = [
    { id: "todas", label: "Todas" },
    { id: "invierno", label: "Invierno" },
    { id: "verano", label: "Verano" },
    { id: "todo_el_ano", label: "Toda temporada" },
  ];
  const veranoUnaAgrupacion = efecto?.por_temporada.some((f) => f.temporada === "verano" && f.agrupaciones === 1) ?? false;
  const avisos = useMemo(() => (datos?.efecto.avisos ?? []).filter((a) => CODIGOS_NINO.has(a.codigo)), [datos]);

  function descargar() {
    if (!efecto) return;
    const { campos, datos: filasCsv } = filasCsvFactoresM7(efecto);
    descargarCsv(campos, filasCsv, "factores-nino-m7.csv");
  }

  return (
    <div className="space-y-6">
      {error && <Alert onCerrar={() => setError(null)}>No se pudo calcular el efecto del Niño: {error}</Alert>}

      {!datos || !efecto ? (
        !error && (
          <p className="py-6 text-center text-sm text-tinta-suave" aria-live="polite">
            {cargando ? "Calculando el efecto del Niño por temporada…" : "Sin información."}
          </p>
        )
      ) : (
        <>
          <Card
            titulo="Efecto del Niño por temporada"
            descripcion="Una vista de apoyo: se calcula a demanda con los datos de hoy y no se guarda."
            acciones={
              <Button variante="secundario" tamano="sm" onClick={() => void recargar()} disabled={cargando}>
                {cargando ? "Calculando…" : "Volver a calcular"}
              </Button>
            }
          >
            <div className="space-y-4">
              <p className="text-sm text-tinta">
                Calculado ahora ({formatearFechaHora(datos.calculado_at)}) con los datos hasta {datos.datos.hasta_periodo ?? "—"} · con los parámetros por defecto (no con los de cada curva
                aprobada).
              </p>
              <Chips<FiltroTemporada> items={itemsTemporada} activo={temporada} onCambiar={setTemporada} etiqueta="Filtrar por temporada" />
            </div>
          </Card>

          <Card titulo="Volumen" descripcion="Cuánto vendió cada temporada en el año atípico frente al año normal más cercano, sobre las mismas tiendas.">
            <BloqueVolumen filas={filas} />
          </Card>

          <Card titulo="Forma" descripcion="Si el año atípico cambió la forma de la curva (cuándo se vende), medido contra el ruido entre años normales.">
            <BloqueForma datos={datos} temporada={temporada} onVer={onVer} />
          </Card>

          <Card
            titulo="Lo que recibirá M7"
            descripcion="El factor de volumen por temporada y año, calculado a demanda, y el crecimiento entre años normales."
            acciones={
              <Button variante="secundario" tamano="sm" onClick={descargar}>
                Descargar CSV
              </Button>
            }
          >
            <div className="space-y-4">
              <div className="overflow-x-auto rounded-lg border border-borde">
                <table className="w-full text-sm">
                  <caption className="sr-only">Factor de volumen por temporada y año.</caption>
                  <thead className="bg-neutro-suave text-left text-xs uppercase tracking-wide text-tinta-suave">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-medium">Temporada</th>
                      <th scope="col" className="px-3 py-2 font-medium">Año</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">Factor de volumen</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">Ratio relativo</th>
                      <th scope="col" className="px-3 py-2 font-medium">Agrupaciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-borde">
                    {efecto.por_temporada.map((f) => (
                      <tr key={`${f.temporada}-${f.anio}`}>
                        <td className="px-3 py-2 font-medium">{etiquetaTemporadaORed(f.temporada)}</td>
                        <td className="px-3 py-2">{f.anio}</td>
                        <td className="px-3 py-2 text-right font-semibold"><Celda v={f.ratio_volumen} /></td>
                        <td className="px-3 py-2 text-right"><Celda v={f.ratio_relativo} /></td>
                        <td className="px-3 py-2 text-xs text-tinta-suave">
                          {f.agrupaciones} {f.agrupaciones === 1 ? "agrupación" : "agrupaciones"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="overflow-x-auto rounded-lg border border-borde">
                <table className="w-full text-sm">
                  <caption className="sr-only">Crecimiento entre años normales por temporada.</caption>
                  <thead className="bg-neutro-suave text-left text-xs uppercase tracking-wide text-tinta-suave">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-medium">Temporada</th>
                      <th scope="col" className="px-3 py-2 font-medium">Año</th>
                      <th scope="col" className="px-3 py-2 font-medium">Frente a</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">Crecimiento normal</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">Tiendas comunes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-borde">
                    {efecto.crecimiento_normal.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-3 py-4 text-center text-tinta-suave">Sin dos años normales para medir el crecimiento.</td>
                      </tr>
                    ) : (
                      efecto.crecimiento_normal.map((c) => (
                        <tr key={`${c.temporada}-${c.anio}`}>
                          <td className="px-3 py-2 font-medium">{etiquetaTemporadaORed(c.temporada)}</td>
                          <td className="px-3 py-2">{c.anio}</td>
                          <td className="px-3 py-2">{c.anio_referencia}</td>
                          <td className="px-3 py-2 text-right font-semibold"><Celda v={c.ratio} /></td>
                          <td className="px-3 py-2 text-right tabular-nums">{c.tiendas_comunes}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-tinta-suave">
                Calculado a demanda con los parámetros por defecto: M7 guarda el valor que use y puede editarlo; lo que edite vivirá en M7, no aquí.
                {veranoUnaAgrupacion && " El factor de verano sale hoy de una sola agrupación."}
              </p>
            </div>
          </Card>

          {avisos.length > 0 && (
            <Card titulo="Avisos del Niño">
              <ul className="space-y-1" aria-label="Avisos relativos al Niño">
                {avisos.map((a, i) => (
                  <li key={`${a.codigo}-${i}`} className="flex flex-wrap items-baseline gap-2 text-sm">
                    <Badge tono="alerta">{ETIQUETA_AVISO[a.codigo]}</Badge>
                    <span className="text-xs text-tinta-suave">{a.detalle}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
