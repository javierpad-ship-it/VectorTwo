"use client";

import { Fragment } from "react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { formatearNumero, plural } from "@/lib/formato";
import type { AvisoIa } from "@/lib/ia/tipos-api";
import type { AvisoFila } from "@/lib/proyeccion/tipos-api";
import type { FilaAprobacionApi, ModoAprobacion } from "@/lib/aprobacion/tipos-api";
import { NUM } from "./comunes";
import {
  ETIQUETA_FUENTE,
  desvioFueraDeRango,
  motivoNoSeleccionable,
  nombreLinea,
  textoDesvio,
  valorSugerido,
  type GrupoGm,
} from "./aprobacion-vista";
import { ESTADO_GM, avisoEsAlerta, signado, textoAvisoIa } from "./propuesta-ia-vista";
import { formatearPct, textoAviso, unidades } from "./vista";

const TH = "px-3 py-2 font-medium";
/** Los avisos del método que importan al aprobar en bloque; el resto se ve en el detalle de Por línea. */
const AVISOS_FILA_VISIBLES: readonly AvisoFila[] = ["propuesta_cambio", "curva_cambio", "sin_curva"];

function Avisos({ f }: { f: FilaAprobacionApi }) {
  const delMetodo = f.metodo.avisos.filter((a) => AVISOS_FILA_VISIBLES.includes(a));
  const delIa: AvisoIa[] = f.ia?.avisos ?? [];
  if (delMetodo.length === 0 && delIa.length === 0) return <span className="text-tinta-suave">—</span>;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {delMetodo.map((a) => (
        <span key={a} title={textoAviso(a)}>
          <Badge tono="alerta">{a.replace(/_/g, " ")}</Badge>
        </span>
      ))}
      {delIa.map((a) => (
        <span key={a} title={textoAvisoIa(a)}>
          <Badge tono={avisoEsAlerta(a) ? "alerta" : "neutro"}>{a.replace(/_/g, " ")}</Badge>
        </span>
      ))}
    </span>
  );
}

function Confianza({ f }: { f: FilaAprobacionApi }) {
  if (f.ia === null) return <span className="text-tinta-suave">—</span>;
  const c = f.ia.confianza;
  if (c === "alta" || c === "media") return <span>{c}</span>;
  return (
    <span className="font-medium text-alerta">
      {c === "baja" ? "baja" : "sin dato"}
      <span className="block text-xs font-normal">se decide en Por línea</span>
    </span>
  );
}

function SeApruebaCon({ f, motivo }: { f: FilaAprobacionApi; motivo: string | null }) {
  if (motivo !== null || f.badge === null) {
    return <span className="block max-w-64 text-xs text-tinta-suave">{motivo ?? "—"}</span>;
  }
  const valor = valorSugerido(f);
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Badge tono={f.badge === "ia" ? "marca" : f.badge === "metodo_gm_sin_ia" ? "alerta" : "neutro"}>{ETIQUETA_FUENTE[f.badge]}</Badge>
      <span className={NUM}>{unidades(valor)}</span>
    </span>
  );
}

export type TablaAprobacionProps = {
  grupos: readonly GrupoGm[];
  anioEnCurso: number;
  anio: number;
  modo: ModoAprobacion;
  /** Hay casillas: la proyección está en trabajo y no hay bloqueos. */
  editable: boolean;
  seleccion: ReadonlySet<string>;
  /** ¿El GM está abierto? */
  abierto: (clave: string) => boolean;
  onAlternarFila: (fila: FilaAprobacionApi, marcada: boolean) => void;
  onAlternarGrupo: (grupo: GrupoGm, marcada: boolean) => void;
  onAlternarAbierto: (clave: string) => void;
};

/**
 * La tabla agrupada por GM (§4.3, patrón de `tabla-filas.tsx`): la fila del GM es plegable y trae su casilla; dentro, un subtotal por línea. Las filas excluidas
 * (D4, D5) SE VEN con la casilla deshabilitada y el motivo escrito (no solo al pasar el cursor). Con el año siguiente se añaden las columnas de la IA.
 */
export function TablaAprobacion(p: TablaAprobacionProps) {
  const conIa = p.anio === p.anioEnCurso + 1;
  const reaprobar = p.modo === "reaprobar";
  const columnas = 6 + (conIa ? 6 : 0) + (reaprobar ? 1 : 0) + 1;

  return (
    <div className="overflow-x-auto rounded-lg border border-borde">
      <table className="w-full text-sm">
        <caption className="sr-only">Filas {reaprobar ? "aprobadas en bloque que cambiaron de propuesta" : "que bloquean el cierre"} de {p.anio}, agrupadas por género × mundo</caption>
        <thead className="bg-neutro-suave text-left text-xs uppercase tracking-wide text-tinta-suave">
          <tr>
            <th scope="col" className={`${TH} w-10`}>
              <span className="sr-only">Seleccionar</span>
            </th>
            <th scope="col" className={TH}>Línea · agrupación</th>
            <th scope="col" className={`${TH} text-right`}>Vendido {p.anioEnCurso}</th>
            <th scope="col" className={`${TH} text-right`}>Base {p.anioEnCurso + 1}</th>
            <th scope="col" className={`${TH} text-right`}>Método</th>
            {conIa && (
              <>
                <th scope="col" className={`${TH} text-right`}>IA con meta</th>
                <th scope="col" className={`${TH} text-right`}>Natural IA</th>
                <th scope="col" className={`${TH} text-right`}>Brecha</th>
                <th scope="col" className={`${TH} text-right`}>vs método</th>
                <th scope="col" className={`${TH} text-right`}>Absorbido</th>
                <th scope="col" className={TH}>Confianza</th>
              </>
            )}
            <th scope="col" className={TH}>Avisos</th>
            {reaprobar && <th scope="col" className={`${TH} text-right`}>Aprobada → hoy</th>}
            <th scope="col" className={TH}>Se aprueba con</th>
          </tr>
        </thead>
        <tbody>
          {p.grupos.map((g) => {
            const seleccionables = g.filas.filter((f) => motivoNoSeleccionable(f, p.modo) === null);
            const marcadas = seleccionables.filter((f) => p.seleccion.has(f.fila_id)).length;
            const abierto = p.abierto(g.gm_clave);
            const fuera = desvioFueraDeRango(g.gm?.desvio_pct);
            const estado = g.gm?.estado_ia ?? null;
            return (
              <Fragment key={g.gm_clave}>
                <tr className="border-t border-borde bg-neutro-suave/60">
                  <td className="px-3 py-2">
                    <Checkbox
                      checked={seleccionables.length > 0 && marcadas === seleccionables.length}
                      indeterminado={marcadas > 0 && marcadas < seleccionables.length}
                      disabled={!p.editable || seleccionables.length === 0}
                      onChange={(v) => p.onAlternarGrupo(g, v)}
                      label={`Seleccionar las filas aprobables de ${g.nombre}`}
                    />
                  </td>
                  <td colSpan={columnas - 1} className="px-3 py-2">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <button
                        type="button"
                        onClick={() => p.onAlternarAbierto(g.gm_clave)}
                        aria-expanded={abierto}
                        className="inline-flex items-center gap-1.5 font-semibold text-tinta hover:text-marca-oscura"
                      >
                        <span aria-hidden>{abierto ? "▾" : "▸"}</span>
                        {g.nombre}
                      </button>
                      <span className="text-xs text-tinta-suave">{plural(g.filas.length, "fila", "filas")}</span>
                      {estado !== null && (
                        <Badge tono={ESTADO_GM[estado]?.tono === "exito" ? "exito" : ESTADO_GM[estado]?.tono === "alerta" ? "alerta" : "neutro"}>IA {ESTADO_GM[estado]?.texto ?? estado}</Badge>
                      )}
                      {g.gm?.fuente_meta === "resto_provisional" && <Badge tono="alerta">meta provisional</Badge>}
                      {g.gm && g.gm.meta !== null && (
                        <span className="text-xs text-tinta-suave">
                          Meta {unidades(g.gm.meta)} · vigente {unidades(g.gm.vigente_total)} · crecimiento {formatearPct(g.gm.crecimiento_implicito_pct)} ·{" "}
                          <span className={fuera ? "font-medium text-alerta" : ""}>desvío {textoDesvio(g.gm.desvio_u, g.gm.desvio_pct)}</span>
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
                {abierto &&
                  g.lineas.map((l) => {
                    const aprobables = l.filas.filter((f) => motivoNoSeleccionable(f, p.modo) === null);
                    const suma = aprobables.reduce((s, f) => s + (valorSugerido(f) ?? 0), 0);
                    return (
                      <Fragment key={l.linea}>
                        <tr className="border-t border-borde bg-superficie">
                          <th scope="rowgroup" colSpan={columnas} className="px-3 py-1 text-left text-xs font-medium text-tinta-suave">
                            {l.linea} · {plural(l.filas.length, "fila", "filas")} · {formatearNumero(suma)} u por aprobar
                          </th>
                        </tr>
                        {l.filas.map((f) => {
                          const motivo = motivoNoSeleccionable(f, p.modo);
                          const marcada = p.seleccion.has(f.fila_id);
                          return (
                            <tr key={f.fila_id} className={`border-t border-borde ${marcada ? "bg-marca-suave/40" : ""} ${motivo !== null ? "text-tinta-suave" : ""}`}>
                              <td className="px-3 py-2">
                                <Checkbox
                                  checked={marcada}
                                  disabled={!p.editable || motivo !== null}
                                  onChange={(v) => p.onAlternarFila(f, v)}
                                  label={motivo !== null ? `${nombreLinea(f)}: ${motivo}` : `Seleccionar ${nombreLinea(f)}`}
                                />
                              </td>
                              <td className="px-3 py-2">
                                <span className="block min-w-40 max-w-72 break-words text-tinta">{nombreLinea(f)}</span>
                                <span className="mt-0.5 inline-flex flex-wrap gap-1">
                                  {f.motivo_cierre === "revision_cola_larga" && <Badge tono="alerta">para revisión</Badge>}
                                  {f.avisos_fuertes && <Badge tono="alerta">aviso fuerte</Badge>}
                                </span>
                              </td>
                              <td className={`px-3 py-2 ${NUM}`}>{unidades(f.vendido)}</td>
                              <td className={`px-3 py-2 ${NUM}`}>{unidades(f.base_corregida ?? f.base)}</td>
                              <td className={`px-3 py-2 ${NUM}`}>
                                {unidades(f.metodo.valor)}
                                {f.metodo.pct_propio !== null && <span className="block text-xs text-tinta-suave">{formatearPct(f.metodo.pct_propio)} propio</span>}
                              </td>
                              {conIa && (
                                <>
                                  <td className={`px-3 py-2 ${NUM}`}>{f.ia ? unidades(f.ia.valor) : "—"}</td>
                                  <td className={`px-3 py-2 ${NUM}`}>{f.ia ? unidades(f.ia.natural) : "—"}</td>
                                  <td className={`px-3 py-2 ${NUM}`}>{f.ia && f.ia.brecha_u !== null ? `${signado(f.ia.brecha_u)} (${formatearPct(f.ia.brecha_pct)})` : "—"}</td>
                                  <td className={`px-3 py-2 ${NUM}`}>{f.ia ? signado(f.ia.contra_metodo_u) : "—"}</td>
                                  <td className={`px-3 py-2 ${NUM}`}>{f.ia && f.ia.absorbido_pct !== null ? formatearPct(f.ia.absorbido_pct) : "—"}</td>
                                  <td className="px-3 py-2">
                                    <Confianza f={f} />
                                  </td>
                                </>
                              )}
                              <td className="px-3 py-2">
                                <Avisos f={f} />
                              </td>
                              {reaprobar && (
                                <td className={`px-3 py-2 ${NUM}`}>
                                  {unidades(f.decidido)} → {unidades(valorSugerido(f))}
                                </td>
                              )}
                              <td className="px-3 py-2">
                                <SeApruebaCon f={f} motivo={motivo} />
                              </td>
                            </tr>
                          );
                        })}
                      </Fragment>
                    );
                  })}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
