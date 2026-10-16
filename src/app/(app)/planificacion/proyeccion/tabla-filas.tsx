"use client";

import { Fragment, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatearNumero } from "@/lib/formato";
import type { AnioFilaApi, AvisoFila, FilaApi, RespuestaLineasApi } from "@/lib/proyeccion/tipos-api";
import { CeldaCrecimiento, CeldaDecision, type DecisionFila } from "./celda-decision";
import { Avisos, BotonEnlace, NUM } from "./comunes";
import {
  aniosHistoricos,
  avisosDeFila,
  formatearAvance,
  historicoDe,
  nombreMes,
  notaMoverTienda,
  registroDe,
  resumenColaLarga,
  sumaApertura,
  tituloSeccionApertura,
  textoTotalTienda,
  totalesDeLinea,
  totalLinea,
  unidades,
  type SeccionApertura,
} from "./vista";

const TH = "px-3 py-2 font-medium";

/** Los avisos que se ven en la tabla (el resto, en el detalle de la fila). */
const AVISOS_EN_TABLA: ReadonlySet<AvisoFila> = new Set<AvisoFila>(["curva_cambio", "propuesta_cambio", "sin_curva", "avance_bajo", "plan_anterior", "cola_larga", "revision_cola_larga", "cola_larga_con_quiebres"]);

/** Los doce meses de un registro: real en gris y redonda, proyectado en cursiva (solo para ver). */
export function MesesDeRegistro({ registro, titulo }: { registro: AnioFilaApi | undefined; titulo: string }) {
  if (!registro) return null;
  return (
    <div className="min-w-0">
      <p className="mb-1 text-xs font-medium text-tinta-suave">{titulo}</p>
      {registro.meses === null ? (
        <p className="text-xs text-tinta-suave">Sin reparto mensual (sin curva vigente).</p>
      ) : (
        <div className="flex flex-wrap gap-1">
          {registro.meses.map((m, i) => {
            const real = registro.origen_meses?.[i] === "real";
            return (
              <span
                key={i}
                title={`${nombreMes(i + 1)}: ${real ? "real" : "proyectado"}`}
                className={`inline-flex min-w-14 flex-col items-end rounded px-1.5 py-0.5 font-mono text-xs tabular-nums ${real ? "bg-neutro-suave text-tinta-suave" : "border border-borde bg-superficie italic text-tinta"}`}
              >
                <span className="text-[10px] not-italic text-tinta-suave">{nombreMes(i + 1)}</span>
                {formatearNumero(m)}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Tabla de las filas de la línea (GML × agrupación de marca), ficha 07, paso 3: histórico por año con la red de cada
 * año, vendido, avance, propuesta y decisión de los dos años, y el crecimiento que alimenta la propuesta del año
 * siguiente. Cada celda «decidido» se edita en línea. Al pie, los totales de la línea (mismas tiendas). «Ver meses»
 * despliega los doce meses de cada año.
 *
 * `0.10.7`: después de las filas base va una sección por tienda nueva y año (aperturas y nuevas del año anterior) con una fila por
 * agrupación de marca, editable con el mismo campo + ✓. Mover una fila cambia solo esa fila: el total de la tienda pasa a `D + Δ`. El
 * pie suma «Tiendas nuevas» y «Total línea».
 */
export function TablaFilas({
  filas,
  lineas,
  secciones,
  anioEnCurso,
  crecimientoDefecto,
  bloqueada,
  ocupado,
  filaSeleccionada,
  onSeleccionar,
  onDecidir,
  onVerTienda,
  onCsv,
}: {
  filas: readonly FilaApi[];
  lineas: Pick<RespuestaLineasApi, "filas" | "historico_linea" | "totales_por_anio" | "filas_tienda">;
  secciones: readonly SeccionApertura[];
  anioEnCurso: number;
  crecimientoDefecto: number;
  bloqueada: boolean;
  ocupado: boolean;
  filaSeleccionada: string | null;
  onSeleccionar: (id: string) => void;
  onDecidir: (fila: FilaApi, anio: number, d: DecisionFila) => Promise<boolean>;
  onVerTienda?: (tiendaId: string) => void;
  onCsv: () => void;
}) {
  const y = anioEnCurso;
  const historicos = aniosHistoricos(y);
  const [abiertas, setAbiertas] = useState<ReadonlySet<string>>(new Set());
  const base = filas.filter((f) => f.tienda_id === null && f.activo);
  const tY = totalesDeLinea(lineas, y);
  const tS = totalesDeLinea(lineas, y + 1);
  const hayApertura = secciones.length > 0;
  const todasAbiertas = base.length > 0 && base.every((f) => abiertas.has(f.id));

  const alternar = (id: string) =>
    setAbiertas((prev) => {
      const sig = new Set(prev);
      if (sig.has(id)) sig.delete(id);
      else sig.add(id);
      return sig;
    });

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button variante="secundario" tamano="sm" onClick={() => setAbiertas(todasAbiertas ? new Set() : new Set(base.map((f) => f.id)))}>
          {todasAbiertas ? "Ocultar meses" : "Ver meses ▸"}
        </Button>
        <Button variante="secundario" tamano="sm" onClick={onCsv} disabled={base.length === 0}>
          CSV
        </Button>
      </div>
      <div className="overflow-x-auto rounded-lg border border-borde">
        <table className="w-full text-sm">
          <thead className="bg-neutro-suave text-left text-xs uppercase tracking-wide text-tinta-suave">
            <tr>
              <th className={TH}>Agrup. marca</th>
              {historicos.map((h) => (
                <th key={h} className={`${TH} text-right`}>
                  {h}
                </th>
              ))}
              <th className={`${TH} text-right`}>{y} vendido</th>
              <th className={`${TH} text-right`}>Avance</th>
              <th className={`${TH} text-right`}>{y} propuesto</th>
              <th className={`${TH} text-right`}>{y} decidido</th>
              <th className={`${TH} text-right`}>Crec.</th>
              <th className={`${TH} text-right`}>{y + 1} propuesto</th>
              <th className={`${TH} text-right`}>{y + 1} decidido</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-borde">
            {base.length === 0 && (
              <tr>
                <td colSpan={11} className="px-3 py-6 text-center text-tinta-suave">
                  La línea no tiene filas con venta en los últimos 24 meses.
                </td>
              </tr>
            )}
            {base.map((f) => {
              const rY = registroDe(f, y);
              const rS = registroDe(f, y + 1);
              const avisos = avisosDeFila(f).filter((a) => AVISOS_EN_TABLA.has(a));
              const nombre = f.equivalencia ? `${f.equivalencia} · ${f.agrupacion_marca}` : f.agrupacion_marca;
              const seleccionada = filaSeleccionada === f.id;
              return (
                <Fragment key={f.id}>
                  <tr className={seleccionada ? "bg-marca-suave/60" : "hover:bg-fondo/60"}>
                    <td className="px-3 py-2 align-middle">
                      <div className="flex flex-wrap items-center gap-2">
                        <button type="button" onClick={() => onSeleccionar(f.id)} aria-pressed={seleccionada} title="Abrir el detalle de la fila" className="text-left font-medium text-marca-oscura underline-offset-2 hover:underline">
                          {nombre}
                        </button>
                        <Avisos avisos={avisos} />
                        {resumenColaLarga(rY?.cola_larga) && (
                          <span className="basis-full text-xs text-alerta" title="Validación de disponibilidad de la cola larga">
                            {resumenColaLarga(rY?.cola_larga)}
                          </span>
                        )}
                        <button type="button" onClick={() => alternar(f.id)} aria-expanded={abiertas.has(f.id)} className="text-xs text-tinta-suave hover:text-tinta">
                          {abiertas.has(f.id) ? "▾ meses" : "▸ meses"}
                        </button>
                      </div>
                    </td>
                    {historicos.map((h) => (
                      <td key={h} className={`px-3 py-2 ${NUM}`}>
                        {unidades(historicoDe(f, h))}
                      </td>
                    ))}
                    <td className={`px-3 py-2 ${NUM}`}>{unidades(rY?.vendido)}</td>
                    <td className={`px-3 py-2 ${NUM}`} title={rY?.metodo === "plan_anterior" ? "Con poco avance se propone el total de la proyección cerrada anterior" : undefined}>
                      {formatearAvance(rY?.avance)}
                    </td>
                    <td className={`px-3 py-2 ${NUM}`}>{unidades(rY?.propuesto)}</td>
                    <td className="px-3 py-2">
                      <CeldaDecision
                        key={`${f.id}-${y}-${rY?.decidido}-${rY?.origen}`}
                        registro={rY}
                        anio={y}
                        anioEnCurso={y}
                        bloqueada={bloqueada}
                        ocupado={ocupado}
                        etiqueta={`${nombre}, decidido ${y}`}
                        onDecidir={(d) => onDecidir(f, y, d)}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <CeldaCrecimiento
                        key={`${f.id}-g-${rS?.crecimiento_pct}`}
                        registro={rS}
                        porDefecto={crecimientoDefecto}
                        bloqueada={bloqueada}
                        ocupado={ocupado}
                        etiqueta={`${nombre}, crecimiento ${y + 1}`}
                        onDecidir={(d) => onDecidir(f, y + 1, d)}
                      />
                    </td>
                    <td className={`px-3 py-2 ${NUM}`}>{unidades(rS?.propuesto)}</td>
                    <td className="px-3 py-2">
                      <CeldaDecision
                        key={`${f.id}-${y + 1}-${rS?.decidido}-${rS?.origen}`}
                        registro={rS}
                        anio={y + 1}
                        anioEnCurso={y}
                        bloqueada={bloqueada}
                        ocupado={ocupado}
                        etiqueta={`${nombre}, decidido ${y + 1}`}
                        onDecidir={(d) => onDecidir(f, y + 1, d)}
                      />
                    </td>
                  </tr>
                  {abiertas.has(f.id) && (
                    <tr className="bg-fondo/60">
                      <td colSpan={11} className="px-3 py-3">
                        <div className="grid gap-3 lg:grid-cols-2">
                          <MesesDeRegistro registro={rY} titulo={`${y} · real hasta el último mes cerrado, proyectado en cursiva`} />
                          <MesesDeRegistro registro={rS} titulo={`${y + 1} · proyectado con la curva vigente`} />
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {secciones.map((s) => (
              <Fragment key={s.clave}>
                <tr className="bg-neutro-suave/60">
                  <th colSpan={11} scope="colgroup" className="px-3 py-2 text-left text-xs font-normal">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="font-semibold text-tinta">{tituloSeccionApertura(s)}</span>
                      <span className="text-tinta-suave">{textoTotalTienda(s.total_tienda)}</span>
                      <span className="text-tinta-suave">en esta línea: {unidades(s.vigente_en_linea)}</span>
                      {onVerTienda && <BotonEnlace onClick={() => onVerTienda(s.tienda_id)}>Ver la tienda</BotonEnlace>}
                    </div>
                  </th>
                </tr>
                {s.filas.map((x) => {
                  const r = x.registro;
                  const fila = x.fila;
                  if (!fila || !r) {
                    return (
                      <tr key={`${s.clave}-${x.clave}`}>
                        <td className="px-3 py-2 pl-6 text-tinta-suave">{x.nombre}</td>
                        <td colSpan={10} className="px-3 py-2 text-xs italic text-tinta-suave">
                          Sin fila de apertura: el referente no vende esta agrupación.
                        </td>
                      </tr>
                    );
                  }
                  const esY = s.anio === y;
                  const vigente = r.vigente ?? r.decidido ?? r.propuesto;
                  const celda = (
                    <CeldaDecision
                      key={`${fila.id}-${s.anio}-${r.decidido}-${r.origen}-${r.vigente}`}
                      registro={r}
                      anio={s.anio}
                      anioEnCurso={y}
                      bloqueada={bloqueada}
                      ocupado={ocupado}
                      filaDeTienda
                      etiqueta={`${x.nombre}, ${s.codigo} decidido ${s.anio}`}
                      notaCambio={(nueva) => notaMoverTienda({ vigenteFila: vigente, nueva, total: s.total_tienda })}
                      onDecidir={(d) => onDecidir(fila, s.anio, d)}
                    />
                  );
                  const sinDato = (n: number) => (
                    <td colSpan={n} className="px-3 py-2 text-center text-tinta-suave">
                      —
                    </td>
                  );
                  return (
                    <tr key={`${s.clave}-${x.clave}`} className="hover:bg-fondo/60">
                      <td className="px-3 py-2 pl-6 align-middle">
                        <span className="font-medium">{x.nombre}</span>
                        <span className="ml-2 text-xs text-tinta-suave">
                          {s.codigo} · {s.anio}
                        </span>
                        {r.origen === "escalada" && <span className="ml-2 text-xs text-tinta-suave">escalada</span>}
                        <Avisos avisos={r.avisos.filter((a) => AVISOS_EN_TABLA.has(a))} />
                      </td>
                      {esY ? (
                        <>
                          {sinDato(3)}
                          <td className={`px-3 py-2 ${NUM}`}>{unidades(r.vendido)}</td>
                          {sinDato(1)}
                          <td className={`px-3 py-2 ${NUM}`}>{unidades(r.propuesto)}</td>
                          <td className="px-3 py-2">{celda}</td>
                          {sinDato(3)}
                        </>
                      ) : (
                        <>
                          {sinDato(8)}
                          <td className={`px-3 py-2 ${NUM}`}>{unidades(r.propuesto)}</td>
                          <td className="px-3 py-2">{celda}</td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </Fragment>
            ))}
          </tbody>
          {(base.length > 0 || hayApertura) && (
            <tfoot className="border-t-2 border-borde bg-neutro-suave/60 font-medium">
              {base.length > 0 && (
                <tr>
                  <td className="px-3 py-2">Línea (mismas tiendas)</td>
                  {historicos.map((h) => (
                    <td key={h} className={`px-3 py-2 ${NUM}`}>
                      {unidades(lineas.historico_linea.find((x) => x.anio === h)?.unidades)}
                    </td>
                  ))}
                  <td className={`px-3 py-2 ${NUM}`}>{unidades(tY.vendido)}</td>
                  <td className="px-3 py-2" />
                  <td className={`px-3 py-2 ${NUM}`}>{unidades(tY.propuesto)}</td>
                  <td className={`px-3 py-2 ${NUM}`}>
                    {unidades(tY.vigente)}
                    <span className="ml-1 font-sans text-xs font-normal text-tinta-suave">
                      vigente · {tY.decididas} de {tY.filas}
                    </span>
                  </td>
                  <td className="px-3 py-2" />
                  <td className={`px-3 py-2 ${NUM}`}>{unidades(tS.propuesto)}</td>
                  <td className={`px-3 py-2 ${NUM}`}>
                    {unidades(tS.vigente)}
                    <span className="ml-1 font-sans text-xs font-normal text-tinta-suave">
                      vigente · {tS.decididas} de {tS.filas}
                    </span>
                  </td>
                </tr>
              )}
              {hayApertura && (
                <>
                  <tr>
                    <td className="px-3 py-2">Tiendas nuevas</td>
                    <td colSpan={6} />
                    <td className={`px-3 py-2 ${NUM}`}>{unidades(sumaApertura(lineas, y))}</td>
                    <td colSpan={2} />
                    <td className={`px-3 py-2 ${NUM}`}>{unidades(sumaApertura(lineas, y + 1))}</td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2">Total línea</td>
                    <td colSpan={6} />
                    <td className={`px-3 py-2 ${NUM}`}>{unidades(totalLinea(lineas, y))}</td>
                    <td colSpan={2} />
                    <td className={`px-3 py-2 ${NUM}`}>{unidades(totalLinea(lineas, y + 1))}</td>
                  </tr>
                </>
              )}
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
