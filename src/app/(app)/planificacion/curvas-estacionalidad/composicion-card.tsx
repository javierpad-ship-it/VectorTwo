"use client";

import Link from "next/link";
import { Fragment, useMemo, useState } from "react";
import { descargarCsv } from "@/components/importador/csv";
import { MiniCurva } from "@/components/curvas/mini-curva";
import { COLORES_GML } from "@/components/curvas/series";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/form";
import { formatearDecimal, formatearNumero } from "@/lib/formato";
import { formatearUnidades } from "@/lib/reportes/histograma";
import type { ComposicionAgrupacionApi, GmlComposicionApi } from "@/lib/curvas/tipos-api";
import {
  buscarGml,
  filasCsvComposicion,
  motivoSeAparta,
  nombreGml,
  ordenarGml,
  pesoDeOtros,
  pesoUltimoAnio,
  resumenComposicion,
  textoEatVsResto,
  textoOtrasAgrupaciones,
  textoOtros,
  ultimoAnioAjuste,
} from "./composicion-vista";
import { formatearPct } from "./vista";

export const ENLACE_REASIGNAR = "/maestros/estacionalidad?pestana=asignacion";

type PropsFila = {
  g: GmlComposicionApi;
  c: ComposicionAgrupacionApi;
  anioUltimo: number | null;
  curvaAgrupacion: readonly number[] | null;
  abierta: boolean;
  onAlternar: () => void;
  marcado: boolean;
  colorMarca: string | null;
  onVer: (v: boolean) => void;
};

function FilaGml({ g, c, anioUltimo, curvaAgrupacion, abierta, onAlternar, marcado, colorMarca, onVer }: PropsFila) {
  const otras = textoOtrasAgrupaciones(g, anioUltimo);
  const motivo = motivoSeAparta(g, c.min_unidades);
  const negativas = g.avisos.includes("unidades_negativas");
  return (
    <Fragment>
      <tr className={`align-top ${g.se_aparta ? "bg-alerta-suave/30" : ""}`}>
        <td className="px-3 py-2">
          <div className="flex items-start gap-2">
            <button
              type="button"
              aria-expanded={abierta}
              aria-label={`${abierta ? "Ocultar" : "Ver"} las equivalencias de ${nombreGml(g)}`}
              onClick={onAlternar}
              className="mt-0.5 text-tinta-suave hover:text-tinta"
            >
              <span aria-hidden className={`inline-block transition-transform ${abierta ? "rotate-90" : ""}`}>
                ▸
              </span>
            </button>
            <div className="min-w-48 space-y-1">
              <p className="font-medium text-tinta">{nombreGml(g)}</p>
              {!g.vigente && <Badge tono="neutro">Nodo inactivo en el árbol</Badge>}
              {g.se_aparta === true && (
                <p className="text-xs text-alerta">
                  <span aria-hidden>⚠ </span>
                  <strong>Se aparta</strong>: {motivo}.{" "}
                  <Link href={ENLACE_REASIGNAR} className="font-medium underline underline-offset-2">
                    Reasignar en M3
                  </Link>
                </p>
              )}
              {g.se_aparta !== true && motivo && <p className="text-xs text-tinta-suave">Se aparta: {motivo}.</p>}
              {otras && <p className="text-xs text-tinta-suave">{otras}</p>}
              {negativas && <p className="text-xs text-alerta">Unidades negativas (devoluciones): el peso se muestra con signo.</p>}
            </div>
          </div>
        </td>
        <td className="px-3 py-2 text-xs">{g.nivel}</td>
        <td className="px-3 py-2 text-right tabular-nums">{g.equivalencias.length}</td>
        {c.anios.map((a) => {
          const x = g.por_anio.find((y) => y.anio === a.anio);
          return (
            <td key={a.anio} className={`px-3 py-2 text-right tabular-nums ${a.en_ajuste ? "" : "text-tinta-suave"}`}>
              {x ? (
                <>
                  <span className="block">{formatearUnidades(x.unidades)}</span>
                  <span className={`block text-xs ${x.peso < 0 ? "text-alerta" : "text-tinta-suave"}`}>{formatearPct(x.peso)}</span>
                </>
              ) : (
                "—"
              )}
            </td>
          );
        })}
        <td className="px-3 py-2 text-right text-xs tabular-nums" title="EAT de su forma frente a la del resto de la agrupación, en cada año de ajuste">
          {textoEatVsResto(g)}
        </td>
        <td className="px-3 py-2">
          {g.curva ? (
            <MiniCurva vigente={curvaAgrupacion} propuesta={g.curva} etiqueta={`Curva de ${nombreGml(g)} (trazo discontinuo) frente a la de la agrupación (trazo sólido)`} />
          ) : (
            <span className="text-xs text-tinta-suave" title={`Menos de ${formatearNumero(c.min_unidades)} unidades en los años de ajuste`}>
              sin curva
            </span>
          )}
        </td>
        <td className="px-3 py-2">
          {g.curva ? (
            <label className="inline-flex items-center gap-1.5 text-xs">
              <input
                type="checkbox"
                checked={marcado}
                onChange={(e) => onVer(e.target.checked)}
                aria-label={`Ver ${nombreGml(g)} en el gráfico`}
                className="h-4 w-4 rounded border-borde accent-marca"
              />
              {colorMarca && <span aria-hidden className="inline-block h-2 w-4 rounded-sm" style={{ backgroundColor: colorMarca }} />}
              ver
            </label>
          ) : (
            <span className="text-xs text-tinta-suave">—</span>
          )}
        </td>
      </tr>
      {abierta && (
        <tr className="bg-fondo/60">
          <td colSpan={7 + c.anios.length} className="px-3 py-2">
            <table className="w-full text-xs">
              <caption className="sr-only">Equivalencias de {nombreGml(g)} con sus unidades y peso por año</caption>
              <thead className="text-left text-tinta-suave">
                <tr>
                  <th scope="col" className="px-2 py-1 font-medium">
                    Equivalencia
                  </th>
                  <th scope="col" className="px-2 py-1 font-medium">
                    Código
                  </th>
                  <th scope="col" className="px-2 py-1 font-medium">
                    Estado
                  </th>
                  {c.anios.map((a) => (
                    <th key={a.anio} scope="col" className="px-2 py-1 text-right font-medium">
                      {a.anio}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-borde">
                {g.equivalencias.map((e) => (
                  <tr key={e.id} className={e.activo ? "" : "text-tinta-suave"}>
                    <th scope="row" className="px-2 py-1 text-left font-normal">
                      {e.nombre}
                    </th>
                    <td className="px-2 py-1 font-mono">{e.codigo}</td>
                    <td className="px-2 py-1">
                      <span className="inline-flex flex-wrap gap-1">
                        {e.es_generica && <Badge tono="marca">Genérica</Badge>}
                        <Badge tono={e.activo ? "exito" : "neutro"}>{e.activo ? "Activa" : "Inactiva"}</Badge>
                      </span>
                    </td>
                    {c.anios.map((a) => {
                      const x = e.por_anio.find((y) => y.anio === a.anio);
                      return (
                        <td key={a.anio} className="px-2 py-1 text-right tabular-nums">
                          {x ? `${formatearUnidades(x.unidades)} · ${formatearPct(x.peso)}` : "—"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </Fragment>
  );
}

/**
 * Tarjeta «Composición de la agrupación» (06c, paso 3b): qué GML hay dentro, cuánto pesa cada uno por año sobre la
 * misma red comparable con la que se calcula la curva, su forma frente al RESTO de la agrupación («se aparta»), si
 * también venden en otras agrupaciones, la curva de cada GML frente a la de la agrupación y «ver en el gráfico».
 * Muestra solo los GML principales (hasta ~85 % de las unidades del último año de ajuste o los 12 primeros) y un
 * renglón «Otros N GML (x %)» desplegable sin curva; el buscador mira todos y el CSV los trae todos. Se pide a la
 * API al desplegarla (carga diferida).
 */
export function ComposicionCard({
  abierta,
  onAbrir,
  datos,
  cargando,
  actual,
  error,
  onReintentar,
  curvaAgrupacion,
  equivalenciasActivas,
  seleccionados,
  onVer,
  nombreArchivo,
}: {
  abierta: boolean;
  onAbrir: (abierta: boolean) => void;
  datos: ComposicionAgrupacionApi | null;
  cargando: boolean;
  /** La composición que se ve es la del cálculo que se ve (misma huella). */
  actual: boolean;
  error: string | null;
  onReintentar: () => void;
  /** La curva de la agrupación (la propuesta dibujada) para las minicurvas. */
  curvaAgrupacion: readonly number[] | null;
  equivalenciasActivas: number;
  /** Ids de los GML marcados «ver en el gráfico», en el orden en que se marcaron. */
  seleccionados: readonly string[];
  onVer: (gmlId: string, ver: boolean) => void;
  nombreArchivo: string;
}) {
  const [busqueda, setBusqueda] = useState("");
  const [filasAbiertas, setFilasAbiertas] = useState<ReadonlySet<string>>(new Set());
  const [otrosAbiertos, setOtrosAbiertos] = useState(false);
  const [multiples, setMultiples] = useState(false);

  const anioUltimo = datos ? ultimoAnioAjuste(datos) : null;
  const ordenados = useMemo(() => (datos ? ordenarGml(datos.gml, anioUltimo) : []), [datos, anioUltimo]);
  const principales = ordenados.filter((g) => g.principal);
  const encontrados = useMemo(() => (busqueda.trim() === "" ? null : buscarGml(ordenados, busqueda)), [ordenados, busqueda]);
  const apartan = datos ? datos.gml.filter((g) => g.se_aparta === true) : [];

  const alternarFila = (id: string) =>
    setFilasAbiertas((prev) => {
      const sig = new Set(prev);
      if (sig.has(id)) sig.delete(id);
      else sig.add(id);
      return sig;
    });

  function descargar() {
    if (!datos) return;
    const { campos, datos: filas } = filasCsvComposicion(datos);
    descargarCsv(campos, filas, nombreArchivo);
  }

  const fila = (g: GmlComposicionApi) => {
    const pos = seleccionados.indexOf(g.gml_id);
    return (
      <FilaGml
        key={g.gml_id}
        g={g}
        c={datos as ComposicionAgrupacionApi}
        anioUltimo={anioUltimo}
        curvaAgrupacion={curvaAgrupacion}
        abierta={filasAbiertas.has(g.gml_id)}
        onAlternar={() => alternarFila(g.gml_id)}
        marcado={pos >= 0}
        colorMarca={pos >= 0 ? COLORES_GML[pos % COLORES_GML.length] : null}
        onVer={(v) => onVer(g.gml_id, v)}
      />
    );
  };

  return (
    <Card
      titulo="Composición de la agrupación"
      descripcion={datos ? resumenComposicion(datos) : `${formatearNumero(equivalenciasActivas)} equivalencias activas · desplega para ver los GML que la forman`}
      acciones={
        <Button variante="fantasma" tamano="sm" aria-expanded={abierta} onClick={() => onAbrir(!abierta)}>
          {abierta ? "Plegar" : "Ver composición"}
        </Button>
      }
    >
      {!abierta ? (
        <p className="text-sm text-tinta-suave">
          Plegada. Muestra cuánto pesa cada GML (género · mundo · línea) en la agrupación, cómo se comporta frente al resto y si alguna de sus equivalencias debería ir en otra agrupación. Se lee de la
          base solo al desplegarla.
        </p>
      ) : (
        <div className="space-y-4">
          {error && (
            <Alert onCerrar={onReintentar}>
              {error}{" "}
              <button type="button" onClick={onReintentar} className="font-medium underline underline-offset-2">
                Reintentar
              </button>
            </Alert>
          )}
          {!datos ? (
            !error && (
              <p className="py-4 text-center text-sm text-tinta-suave" aria-live="polite">
                {cargando ? "Leyendo la composición de la agrupación…" : "Sin información."}
              </p>
            )
          ) : (
            <>
              {(cargando || !actual) && !error && (
                <p className="text-xs font-medium text-marca-oscura" aria-live="polite">
                  Actualizando la composición con los parámetros nuevos…
                </p>
              )}
              <div className="flex flex-wrap items-end justify-between gap-3">
                <label className="block w-full max-w-xs">
                  <span className="mb-1 block text-sm font-medium text-tinta">Buscar GML o equivalencia</span>
                  <Input type="search" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Nombre, código…" />
                </label>
                <div className="flex flex-wrap gap-2">
                  <Button variante="secundario" tamano="sm" aria-pressed={multiples} onClick={() => setMultiples((m) => !m)}>
                    Pequeños múltiplos
                  </Button>
                  <Button variante="secundario" tamano="sm" onClick={descargar}>
                    Descargar CSV (todos)
                  </Button>
                </div>
              </div>

              <p className="text-xs text-tinta-suave">
                Pesos sobre la red comparable de cada año · «se aparta» compara con el resto de la agrupación y se activa si su forma difiere más que el umbral
                (el mayor entre el piso {formatearDecimal(datos.umbral_forma, 1)} pp, el ruido de la agrupación {datos.ruido_normal === null ? "(no medible)" : `${formatearDecimal(datos.ruido_normal, 1)} pp`} y el ruido
                propio del GML) en todos sus años de ajuste · mínimo {formatearNumero(datos.min_unidades)} unidades por GML-año.
                {!datos.con_calculo && " El cálculo de la agrupación está bloqueado: se muestran unidades y pesos, pero «se aparta» no se evalúa."}
              </p>

              {multiples && (
                <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Pequeños múltiplos: la curva de cada GML principal frente a la de la agrupación">
                  {principales.map((g) => (
                    <li key={g.gml_id} className="space-y-1 rounded-lg border border-borde p-2">
                      <p className="text-xs font-medium text-tinta">{nombreGml(g)}</p>
                      {g.curva ? (
                        <MiniCurva vigente={curvaAgrupacion} propuesta={g.curva} ancho={180} alto={50} etiqueta={`Curva de ${nombreGml(g)} (discontinua) frente a la de la agrupación (sólida)`} />
                      ) : (
                        <p className="text-xs text-tinta-suave">sin curva (menos de {formatearNumero(datos.min_unidades)} u.)</p>
                      )}
                      <p className="text-xs text-tinta-suave">
                        {formatearPct(pesoUltimoAnio(g, anioUltimo))} de {anioUltimo ?? "—"}
                        {g.se_aparta === true && <span className="text-alerta"> · se aparta</span>}
                      </p>
                    </li>
                  ))}
                </ul>
              )}

              <div className="overflow-x-auto rounded-lg border border-borde" role="region" aria-label="Composición por GML (desplazable)" tabIndex={0}>
                <table className="w-full text-sm">
                  <caption className="sr-only">
                    GML de la agrupación con su nivel, equivalencias, unidades y peso por año, EAT frente al resto de la agrupación, curva y casilla para verlo en el gráfico.
                  </caption>
                  <thead className="bg-neutro-suave text-left text-xs text-tinta-suave">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-medium">
                        {encontrados ? `${encontrados.length} GML encontrados` : `GML (${principales.length} principales = ${formatearPct(datos.pct_principales)} de ${anioUltimo ?? "—"})`}
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        Nivel
                      </th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">
                        Equiv.
                      </th>
                      {datos.anios.map((a) => (
                        <th key={a.anio} scope="col" className="px-3 py-2 text-right font-medium">
                          {a.anio}
                          {a.clase === "en_curso" ? " parcial" : ""}
                          <span className="block font-normal">unid. · %</span>
                        </th>
                      ))}
                      <th scope="col" className="px-3 py-2 text-right font-medium" title="Años de ajuste, en orden">
                        EAT vs resto
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        Curva
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        Gráfico
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-borde">
                    {encontrados ? (
                      encontrados.length === 0 ? (
                        <tr>
                          <td colSpan={7 + datos.anios.length} className="px-3 py-4 text-center text-tinta-suave">
                            Ningún GML ni equivalencia coincide con la búsqueda.
                          </td>
                        </tr>
                      ) : (
                        encontrados.map(fila)
                      )
                    ) : (
                      <>
                        {principales.map(fila)}
                        {datos.otros > 0 && (
                          <>
                            <tr className="bg-neutro-suave/40">
                              <td colSpan={7 + datos.anios.length} className="px-3 py-2">
                                <button
                                  type="button"
                                  aria-expanded={otrosAbiertos}
                                  onClick={() => setOtrosAbiertos((o) => !o)}
                                  className="inline-flex items-center gap-2 text-sm font-medium text-tinta"
                                >
                                  <span aria-hidden className={`inline-block transition-transform ${otrosAbiertos ? "rotate-90" : ""}`}>
                                    ▸
                                  </span>
                                  Otros {formatearNumero(datos.otros)} GML ({formatearPct(pesoDeOtros(datos, anioUltimo))})
                                </button>
                                <span className="ml-2 text-xs text-tinta-suave">sin curva ni detalle: busca por nombre para abrir uno</span>
                                {otrosAbiertos && <p className="mt-2 text-xs text-tinta-suave">{textoOtros(datos, anioUltimo)}</p>}
                              </td>
                            </tr>
                          </>
                        )}
                      </>
                    )}
                  </tbody>
                  <tfoot className="border-t border-borde bg-neutro-suave/60 text-xs">
                    <tr>
                      <th scope="row" className="px-3 py-2 text-left font-semibold" colSpan={3}>
                        Total de la agrupación
                      </th>
                      {datos.anios.map((a) => (
                        <td key={a.anio} className="px-3 py-2 text-right tabular-nums">
                          {formatearUnidades(a.unidades)}
                        </td>
                      ))}
                      <td colSpan={3} />
                    </tr>
                  </tfoot>
                </table>
              </div>

              {datos.con_calculo && apartan.length > 0 && (
                <p className="rounded-md border border-alerta/30 bg-alerta-suave px-3 py-2 text-sm text-alerta" role="note">
                  <span aria-hidden>⚠ </span>
                  {apartan.length} {apartan.length === 1 ? "GML se aparta" : "GML se apartan"} del resto de la agrupación en todos sus años de ajuste válidos: revisa si sus equivalencias van en otra
                  agrupación.{" "}
                  <Link href={ENLACE_REASIGNAR} className="font-medium underline underline-offset-2">
                    Reasignar en M3
                  </Link>
                </p>
              )}
              {datos.equivalencias_inactivas_con_venta > 0 && (
                <p className="text-xs text-tinta-suave">
                  {datos.equivalencias_inactivas_con_venta} {datos.equivalencias_inactivas_con_venta === 1 ? "equivalencia inactiva tiene" : "equivalencias inactivas tienen"} venta en estos años y siguen contando en la agrupación.
                </p>
              )}
              {datos.equivalencias_sin_venta.length > 0 && (
                <p className="text-xs text-tinta-suave">
                  {datos.equivalencias_sin_venta.length} {datos.equivalencias_sin_venta.length === 1 ? "equivalencia activa no tiene" : "equivalencias activas no tienen"} venta en el periodo.
                </p>
              )}
              <p className="text-xs text-tinta-suave">
                Es un diagnóstico: no cambia la curva. Para mover una equivalencia a otra agrupación usa{" "}
                <Link href={ENLACE_REASIGNAR} className="font-medium underline underline-offset-2">
                  Reasignar en M3
                </Link>
                .
              </p>
            </>
          )}
        </div>
      )}
    </Card>
  );
}
