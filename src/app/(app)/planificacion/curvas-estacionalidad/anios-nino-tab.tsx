"use client";

import { Fragment, useMemo, useState } from "react";
import { descargarCsv } from "@/components/importador/csv";
import { MESES_CORTOS } from "@/lib/reportes/histograma";
import type { AniosAtipicosNinoApi, EfectoTemporadaAnio, TemporadaAgrupacion } from "@/lib/curvas/tipos-api";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chips, type ChipItem } from "@/components/ui/chips";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input } from "@/components/ui/form";
import { AniosAtipicosCard } from "./anios-atipicos-card";
import type { FormularioParametros } from "./parametros-form";
import { useAniosAtipicosPorTemporada } from "./use-anios-atipicos";
import { useRecurso } from "./use-recurso";
import {
  ETIQUETA_AVISO,
  ETIQUETA_CLASE,
  ETIQUETA_TRATAMIENTO,
  ETIQUETA_VEREDICTO,
  claseColorAnio,
  etiquetaTemporadaORed,
  filasCsvFactoresM7,
  filasForma,
  filasVolumen,
  filtrarFilasForma,
  formatearFechaHora,
  formatearPp,
  formatearRatio,
  lecturaVolumen,
  mesPico,
  rangoPrimerosMeses,
  textoCorrimiento,
  type FiltroTemporada,
  type FiltroVeredicto,
} from "./vista";

const CODIGOS_NINO = new Set(["pocos_anos_normales", "sin_referencia_volumen", "ano_atipico_completo"]);

/** La tarjeta «Años marcados como atípicos» por temporada (sin corrida solo hay periodos, no ratios). */
function AniosMarcados() {
  const anios = useAniosAtipicosPorTemporada();
  return <AniosAtipicosCard porTemporada={anios.filas} />;
}

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
                      {Math.round(f.unidades).toLocaleString("es-PE")} / {Math.round(f.unidades_referencia).toLocaleString("es-PE")}
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

const FILTROS_VEREDICTO: { id: FiltroVeredicto; label: string }[] = [
  { id: "todos", label: "Todos" },
  { id: "forma_estable", label: "Estable" },
  { id: "forma_cambia", label: "Cambia" },
  { id: "sin_comparacion", label: "Sin comparación" },
  { id: "parcial", label: "Año en curso" },
];

function BloqueForma({ datos, temporada, onVer }: { datos: AniosAtipicosNinoApi; temporada: FiltroTemporada; onVer: (id: string) => void }) {
  const [veredicto, setVeredicto] = useState<FiltroVeredicto>("todos");
  const todas = useMemo(() => filasForma(datos.agrupaciones, datos.anios), [datos.agrupaciones, datos.anios]);
  const filas = useMemo(() => filtrarFilasForma(todas, temporada, veredicto), [todas, temporada, veredicto]);
  const conteos = datos.efecto?.forma ?? {};
  const itemsVeredicto: ChipItem<FiltroVeredicto>[] = FILTROS_VEREDICTO.map((f) => ({
    id: f.id,
    label: f.label,
    conteo: filtrarFilasForma(todas, temporada, f.id).length,
  }));

  return (
    <div className="space-y-3">
      <ul className="flex flex-wrap gap-x-6 gap-y-1 text-sm" aria-label="Conteo de formas por temporada">
        {(["invierno", "verano"] as TemporadaAgrupacion[]).map((t) => {
          const c = conteos[t];
          if (!c) return null;
          return (
            <li key={t} className="text-tinta-suave">
              <strong className="text-tinta">{etiquetaTemporadaORed(t)}:</strong> {c.forma_estable} estables · {c.forma_cambia} cambian · {c.sin_comparacion} sin comparación
              {c.ruido_normal.length > 0 && <> · ruido entre años normales {c.ruido_normal.map((r) => Math.round(r)).join(", ")} pp</>}
            </li>
          );
        })}
      </ul>
      <Chips<FiltroVeredicto> items={itemsVeredicto} activo={veredicto} onCambiar={setVeredicto} etiqueta="Filtrar por veredicto de forma" />
      {filas.length === 0 ? (
        <p className="text-sm text-tinta-suave">Ninguna fila coincide con los filtros.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-borde">
          <table className="w-full text-sm">
            <caption className="sr-only">Forma de cada año atípico por agrupación frente a la referencia de los años normales.</caption>
            <thead className="bg-neutro-suave text-left text-xs uppercase tracking-wide text-tinta-suave">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">Agrupación</th>
                <th scope="col" className="px-3 py-2 font-medium">Año</th>
                <th scope="col" className="px-3 py-2 font-medium">Clase</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Diferencia</th>
                <th scope="col" className="px-3 py-2 text-right font-medium" title="EAT entre los años normales">Ruido normal</th>
                <th scope="col" className="px-3 py-2 text-right font-medium" title="El mayor entre el piso y el ruido">Umbral efectivo</th>
                <th scope="col" className="px-3 py-2 font-medium">Pico</th>
                <th scope="col" className="px-3 py-2 font-medium">Veredicto</th>
                <th scope="col" className="px-3 py-2 font-medium">Tratamiento</th>
                <th scope="col" className="px-3 py-2 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-borde">
              {filas.map((f) => (
                <tr key={f.clave} className="hover:bg-fondo/60">
                  <td className="px-3 py-2">
                    <span className="font-medium">{f.agrupacion}</span>
                    <span className="block text-xs text-tinta-suave">{etiquetaTemporadaORed(f.temporada)}</span>
                  </td>
                  <td className="px-3 py-2">{f.anio}</td>
                  <td className={`px-3 py-2 text-xs ${f.clase ? claseColorAnio(f.clase) : ""}`}>{f.clase ? ETIQUETA_CLASE[f.clase] : "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {f.parcial ? (
                      <span className="text-xs" title="Forma parcial sobre los meses cargados: red completa frente a tiendas comunes con el año de referencia">
                        red {formatearPp(f.parcialRed)}
                        <span className="block text-tinta-suave">
                          comunes {formatearPp(f.parcialComunes)}
                          {f.parcialTiendas !== null && ` (${f.parcialTiendas})`}
                        </span>
                      </span>
                    ) : (
                      formatearPp(f.diferencia)
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatearPp(f.ruido)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatearPp(f.umbralEfectivo)}</td>
                  <td className="px-3 py-2 text-xs text-tinta-suave">
                    {f.pico !== null ? mesPico(f.pico) : "—"}
                    {f.corrimiento !== null && <span className="block">{textoCorrimiento(f.corrimiento)}</span>}
                  </td>
                  <td className="px-3 py-2">
                    {f.parcial ? (
                      <Badge tono="neutro">Parcial (informativa)</Badge>
                    ) : f.veredicto ? (
                      <Badge tono={f.veredicto === "forma_cambia" ? "alerta" : f.veredicto === "forma_estable" ? "exito" : "neutro"}>{ETIQUETA_VEREDICTO[f.veredicto]}</Badge>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs">{f.tratamiento ? ETIQUETA_TRATAMIENTO[f.tratamiento] : "—"}</td>
                  <td className="px-3 py-2 text-right">
                    <Button variante="secundario" tamano="sm" onClick={() => onVer(f.agrupacionId)}>
                      Ver
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-tinta-suave">
        «La forma cambia» solo si el año se aparta de la referencia más que lo que se apartan entre sí los años normales (con un piso). Con dos años normales que difieren mucho,
        casi cualquier año resulta estable respecto al ruido: léelo junto al ruido, no solo con el veredicto.
      </p>
    </div>
  );
}

/**
 * Pestaña Años Niño (versión reducida): lo que el Niño le hizo a cada temporada,
 * medido en volumen (tabla de ratios con control y relativo) y en forma (por
 * agrupación frente al ruido), y «Lo que recibirá M7» (factores por temporada y
 * crecimiento normal, con descarga). Lee `GET /api/curvas/anios-atipicos` de la corrida elegida.
 */
export function AniosNinoTab({
  corridaId,
  formulario,
  onFormulario,
  onVer,
}: {
  corridaId: string | null;
  formulario: FormularioParametros;
  onFormulario: (f: FormularioParametros) => void;
  onVer: (agrupacionId: string) => void;
}) {
  const url = corridaId ? `/api/curvas/anios-atipicos?corrida_id=${corridaId}` : "/api/curvas/anios-atipicos";
  const { datos, cargando, error, setError } = useRecurso<AniosAtipicosNinoApi>(url);
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
  const avisos = useMemo(() => {
    const lista: { origen: string; codigo: keyof typeof ETIQUETA_AVISO; detalle: string }[] = [];
    for (const a of datos?.efecto?.avisos ?? []) if (CODIGOS_NINO.has(a.codigo)) lista.push({ origen: "Temporadas", codigo: a.codigo, detalle: a.detalle });
    for (const g of datos?.agrupaciones ?? []) for (const a of g.avisos) if (CODIGOS_NINO.has(a.codigo)) lista.push({ origen: g.nombre, codigo: a.codigo, detalle: a.detalle });
    return lista;
  }, [datos]);

  function descargar() {
    if (!efecto) return;
    const { campos, datos: filasCsv } = filasCsvFactoresM7(efecto);
    descargarCsv(campos, filasCsv, "factores-nino-m7.csv");
  }

  return (
    <div className="space-y-6">
      {error && <Alert onCerrar={() => setError(null)}>No se pudo cargar la pestaña: {error}</Alert>}

      {!datos ? (
        !error && <p className="py-6 text-center text-sm text-tinta-suave">{cargando ? "Cargando…" : "Sin información."}</p>
      ) : datos.corrida === null || efecto === null ? (
        <>
          <EmptyState titulo="Calcula para ver el efecto del Niño" detalle="Sin corridas todavía: calcula en la pestaña Curvas. Mientras tanto, estos son los años que los periodos activos marcan como atípicos." />
          <AniosMarcados />
        </>
      ) : (
        <>
          <Card titulo="Corrida" descripcion="El efecto se calcula en cada corrida. Los factores que lee M7 salen de la corrida de referencia.">
            <div className="space-y-4">
              <p className="text-sm text-tinta">
                Corrida del {formatearFechaHora(datos.corrida.created_at)} · hasta {datos.corrida.hasta_periodo}
                {datos.corrida.referencia ? <> · <Badge tono="exito">Referencia</Badge></> : <> · <span className="text-tinta-suave">no es la de referencia</span></>}
              </p>
              <div className="grid gap-4 md:grid-cols-3">
                <Field label="Piso del umbral de forma (pp)" hint="El umbral efectivo es el mayor entre este piso y el ruido entre años normales.">
                  <Input inputMode="decimal" value={formulario.umbral_forma} onChange={(e) => onFormulario({ ...formulario, umbral_forma: e.target.value })} />
                </Field>
                <Field label="Margen sobre el ruido" hint="Una candidata desbanca al promedio solo si lo mejora en más de margen × ruido.">
                  <Input inputMode="decimal" value={formulario.margen_ruido} onChange={(e) => onFormulario({ ...formulario, margen_ruido: e.target.value })} />
                </Field>
                <div className="flex items-end pb-6 text-xs text-tinta-suave">Se guardan para la próxima corrida: calcula desde la pestaña Curvas para aplicarlos.</div>
              </div>
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
            descripcion="El factor de volumen por temporada y año (de la corrida de referencia) y el crecimiento entre años normales."
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
                En M7 el factor es calculado y editable: lo que edites vivirá en M7, no aquí.
                {veranoUnaAgrupacion && " El factor de verano sale hoy de una sola agrupación."}
              </p>
            </div>
          </Card>

          {avisos.length > 0 && (
            <Card titulo="Avisos del Niño">
              <ul className="space-y-1" aria-label="Avisos relativos al Niño">
                {avisos.map((a, i) => (
                  <li key={`${a.origen}-${a.codigo}-${i}`} className="flex flex-wrap items-baseline gap-2 text-sm">
                    <Badge tono="alerta">{ETIQUETA_AVISO[a.codigo]}</Badge>
                    <span className="text-xs text-tinta-suave">
                      {a.origen}: {a.detalle}
                    </span>
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
