"use client";

import { useMemo, useState } from "react";
import { api } from "@/lib/api-client";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { MiniCurva } from "@/components/curvas/mini-curva";
import { formatearDecimal, formatearNumero, plural } from "@/lib/formato";
import type { FilaDetalleApi, ProyeccionApi } from "@/lib/proyeccion/tipos-api";
import { BloqueDecision } from "./bloque-decision";
import type { DecisionFila } from "./celda-decision";
import { AlertaError, Avisos, Cargando, NUM } from "./comunes";
import { ColaLargaDetalle } from "./cola-larga";
import { GraficoMensualFila } from "./grafico-mensual-fila";
import { MesesDeRegistro } from "./tabla-filas";
import { rutaProyeccion, useAccion, useLectura } from "./use-proyeccion";
import {
  ETIQUETA_CLASE,
  nombreMes,
  seriesMensualesDeFila,
  tablaAnioMes,
  textoCurvaOrigen,
  textoPruebaAnterior,
  formatearPct,
  unidades,
} from "./vista";

/**
 * Detalle de una fila (`&fila=<id>`, ficha 07, paso 4): la serie mensual de cada año (cada año con su `M(Z)`), la tabla
 * año × mes con la clase del año y el stock de fin de mes con la señal de quiebre, las tiendas de cada bloque, la
 * curva usada y de dónde sale, la prueba con el año anterior (rotulada «dentro de muestra», junto a la EAT de M6) y
 * los dos bloques «Tu decisión» con toda la explicación delante.
 */
export function DetalleFila({
  proyeccion,
  filaId,
  nombresAgrupacion,
  bloqueada,
  onCerrar,
  onCambio,
  onRecalcular,
}: {
  proyeccion: ProyeccionApi;
  filaId: string;
  nombresAgrupacion: ReadonlyMap<string, string>;
  bloqueada: boolean;
  onCerrar: () => void;
  onCambio: () => Promise<void> | void;
  onRecalcular: () => void;
}) {
  const y = proyeccion.anio_en_curso;
  const ruta = `${rutaProyeccion(proyeccion.id)}/filas/${filaId}`;
  const fila = useLectura<FilaDetalleApi>(ruta);
  const accion = useAccion();
  const [verStock, setVerStock] = useState(false);
  const d = fila.datos;

  const series = useMemo(() => (d ? seriesMensualesDeFila(d, y) : []), [d, y]);
  const tabla = useMemo(() => (d ? tablaAnioMes(d) : []), [d]);

  async function decidir(anio: number, cuerpo: DecisionFila): Promise<boolean> {
    const r = await accion.ejecutar(() => api.put(`${ruta}/anios/${anio}`, cuerpo));
    if (!r.ok) return false;
    await Promise.all([fila.recargar(), onCambio()]);
    return true;
  }

  async function aplicarCurva(registroId: string): Promise<boolean> {
    const r = await accion.ejecutar(() => api.post(`${rutaProyeccion(proyeccion.id)}/aplicar-curva`, { fila_anio_ids: [registroId] }));
    if (!r.ok) return false;
    await Promise.all([fila.recargar(), onCambio()]);
    return true;
  }

  const nombre = d ? `${d.genero} · ${d.mundo} · ${d.linea} · ${d.equivalencia ? `${d.equivalencia} · ` : ""}${d.agrupacion_marca}` : "Detalle de la fila";
  const pa = d?.historico?.prueba_anterior ?? null;
  const colaLarga = d?.anios.find((a) => a.anio === y)?.cola_larga ?? d?.historico?.cola_larga ?? null;
  const tendencia = d?.historico?.tendencia ?? null;

  return (
    <Card
      titulo={nombre}
      descripcion={
        d
          ? `${d.nivel === "GMLE" ? "Nodo abierto a equivalencias (GMLE)" : "Nodo GML"} · curva: ${textoCurvaOrigen(d.curva_origen, nombresAgrupacion)}${d.agrupacion_estacionalidad ? ` · agrupación dominante ${d.agrupacion_estacionalidad.nombre} (${d.agrupacion_estacionalidad.temporada})` : ""}`
          : undefined
      }
      acciones={
        <Button variante="fantasma" tamano="sm" onClick={onCerrar}>
          Cerrar detalle
        </Button>
      }
    >
      <div className="space-y-5">
        {fila.error && <AlertaError error={fila.error} onCerrar={() => fila.setError(null)} onRecargar={() => void fila.recargar()} />}
        {accion.error && <AlertaError error={accion.error} onCerrar={accion.limpiar} onRecalcular={onRecalcular} onRecargar={() => void Promise.all([fila.recargar(), onCambio()])} />}
        {!d && (fila.cargando ? <Cargando /> : null)}
        {d && (
          <>
            <Avisos avisos={d.avisos} detalle />

            <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
              <div>
                <h3 className="mb-2 text-sm font-semibold">Unidades por mes</h3>
                <GraficoMensualFila series={series} />
              </div>
              <div className="space-y-3">
                <h3 className="text-sm font-semibold">Curva usada</h3>
                {d.curva ? (
                  <div className="space-y-1">
                    <MiniCurva vigente={d.curva} ancho={220} alto={56} etiqueta="Curva mensual vigente de la fila" />
                    <p className="font-mono text-xs text-tinta-suave">{d.curva.map((c) => formatearDecimal(c * 100, 1)).join(" · ")} %</p>
                    <ul className="text-xs text-tinta-suave">
                      {d.curva_origen.map((o) => (
                        <li key={o.agrupacion_id}>
                          {nombresAgrupacion.get(o.agrupacion_id) ?? "Agrupación"} · versión {o.version} · peso {formatearDecimal(o.peso * 100, 0)} %
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <Alert tono="alerta">Sin curva vigente en M6 para esta fila.</Alert>
                )}
                {pa && (
                  <div className="space-y-1 rounded-md border border-borde bg-fondo px-3 py-2">
                    <p className="text-xs font-medium uppercase tracking-wide text-tinta-suave">Prueba con el año anterior</p>
                    <p className="text-sm">{textoPruebaAnterior(pa, proyeccion.hasta_periodo)}</p>
                  </div>
                )}
                {tendencia !== null && (
                  <p className="text-xs text-tinta-suave">
                    Tendencia del último año completo (mismas tiendas, normalizado): <span className="font-mono">{formatearPct(tendencia * 100)}</span>
                  </p>
                )}
              </div>
            </div>

            <div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">{verStock ? "Stock de fin de mes" : "Unidades por año y mes"} (cada año con las tiendas de su bloque)</h3>
                <Button variante="secundario" tamano="sm" onClick={() => setVerStock((v) => !v)}>
                  {verStock ? "Ver unidades" : "Ver stock de fin de mes"}
                </Button>
              </div>
              <div className="overflow-x-auto rounded-lg border border-borde">
                <table className="w-full text-xs">
                  <thead className="bg-neutro-suave text-left uppercase tracking-wide text-tinta-suave">
                    <tr>
                      <th className="px-2 py-1.5 font-medium">Año</th>
                      <th className="px-2 py-1.5 font-medium">Clase</th>
                      {Array.from({ length: 12 }, (_, i) => (
                        <th key={i} className="px-2 py-1.5 text-right font-medium">
                          {nombreMes(i + 1)}
                        </th>
                      ))}
                      <th className="px-2 py-1.5 text-right font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-borde">
                    {tabla.map((a) => (
                      <tr key={a.anio}>
                        <td className="px-2 py-1.5 font-medium">
                          {a.anio}
                          <details className="text-[11px] font-normal text-tinta-suave">
                            <summary className="cursor-pointer">{plural(a.tiendas.length, "tienda", "tiendas")}</summary>
                            <span className="font-mono">{a.tiendas.join(", ") || "—"}</span>
                          </details>
                        </td>
                        <td className="px-2 py-1.5">
                          <Badge tono={a.clase === "atipico" ? "alerta" : a.clase === "en_curso" ? "marca" : "neutro"}>{ETIQUETA_CLASE[a.clase]}</Badge>
                        </td>
                        {a.meses.map((m, i) => (
                          <td key={i} className={`px-2 py-1.5 ${NUM} ${m?.atipico ? "bg-alerta-suave" : ""}`} title={m ? `Cobertura ${m.cobertura === null ? "—" : formatearDecimal(m.cobertura, 2)}${m.quiebre ? " · quiebre de stock" : ""}${m.atipico ? " · mes atípico" : ""}` : undefined}>
                            {m ? formatearNumero(verStock ? m.stock : m.unidades) : "—"}
                            {m?.quiebre && (
                              <span className="ml-0.5 text-alerta" aria-label="quiebre de stock">
                                ●
                              </span>
                            )}
                          </td>
                        ))}
                        <td className={`px-2 py-1.5 ${NUM} font-semibold`}>{unidades(a.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-1 text-xs text-tinta-suave">● = quiebre de stock (cobertura menor que 0.25 con venta): señal, no cambia las cifras. Fondo rojizo = mes del Niño.</p>
            </div>

            {colaLarga && <ColaLargaDetalle cola={colaLarga} />}

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-3">
                <BloqueDecision
                  key={`${y}-${d.anios.find((a) => a.anio === y)?.decidido}-${d.anios.find((a) => a.anio === y)?.origen}-${d.anios.find((a) => a.anio === y)?.nota}`}
                  registro={d.anios.find((a) => a.anio === y)}
                  anio={y}
                  anioEnCurso={y}
                  bloqueada={bloqueada}
                  ocupado={accion.ocupado}
                  factoresMes={d.factores_mes?.[y]}
                  onDecidir={(c) => decidir(y, c)}
                  onAplicarCurva={aplicarCurva}
                />
                <MesesDeRegistro registro={d.anios.find((a) => a.anio === y)} titulo={`${y} · real en gris, proyectado en cursiva`} />
              </div>
              <div className="space-y-3">
                <BloqueDecision
                  key={`${y + 1}-${d.anios.find((a) => a.anio === y + 1)?.decidido}-${d.anios.find((a) => a.anio === y + 1)?.origen}-${d.anios.find((a) => a.anio === y + 1)?.nota}-${d.anios.find((a) => a.anio === y + 1)?.crecimiento_pct}`}
                  registro={d.anios.find((a) => a.anio === y + 1)}
                  anio={y + 1}
                  anioEnCurso={y}
                  bloqueada={bloqueada}
                  ocupado={accion.ocupado}
                  factoresMes={d.factores_mes?.[y + 1]}
                  onDecidir={(c) => decidir(y + 1, c)}
                  onAplicarCurva={aplicarCurva}
                />
                <MesesDeRegistro registro={d.anios.find((a) => a.anio === y + 1)} titulo={`${y + 1} · proyectado con la curva vigente`} />
              </div>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}
