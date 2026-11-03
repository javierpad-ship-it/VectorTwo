"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, Input } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { formatearNumero, plural } from "@/lib/formato";
import { MAX_NOTA_LOTE, type EfectoGMApi, type FilaAprobacionApi, type FiltroLote, type GMAprobacionApi, type ModoAprobacion, type ResultadoFilaLoteApi } from "@/lib/aprobacion/tipos-api";
import { NUM } from "./comunes";
import {
  avisosDeConfirmacion,
  desvioFueraDeRango,
  desvioPctDe,
  exigeRevision,
  itemDeFila,
  nombreGm,
  nombreLinea,
  rechazosPorCodigo,
  textoDesvio,
  textoRechazo,
  textoResultadoAprobar,
  textoSimulacionReversion,
  textoTanda,
  traducirErrorAprobacion,
  type AccionAprobacion,
  type ItemSeleccion,
  type ResultadoCombinado,
} from "./aprobacion-vista";
import { signado } from "./propuesta-ia-vista";
import { resultadoDeHechas, useConfirmacionLote, type EstadoConfirmacion } from "./use-aprobacion";
import type { ErrorAccion } from "./use-proyeccion";
import { formatearPct, unidades } from "./vista";

/** Lo que necesita un resumen para poner nombre a un GM o a una fila por su id. */
export type Nombres = { gm: ReadonlyMap<string, string>; fila: ReadonlyMap<string, string> };

export function nombresDe(gms: readonly GMAprobacionApi[], filas: readonly FilaAprobacionApi[]): Nombres {
  return {
    gm: new Map(gms.map((g) => [g.gm_clave, nombreGm(g)] as const)),
    fila: new Map(filas.map((f) => [f.fila_id, `${nombreGm(f)} · ${nombreLinea(f)}`] as const)),
  };
}

const TH = "px-3 py-2 font-medium";

// ─── Piezas del resumen (también las usa el historial al revertir) ───

/** §4.4, por GM: total antes y después, crecimiento implícito antes y después y desvío frente a la meta (ámbar si pasa de ±1 %). */
export function TablaEfectoGm({ efecto, nombres }: { efecto: readonly EfectoGMApi[]; nombres: Nombres }) {
  if (efecto.length === 0) return null;
  const orden = [...efecto].sort((a, b) => (nombres.gm.get(a.gm_clave) ?? a.gm_clave).localeCompare(nombres.gm.get(b.gm_clave) ?? b.gm_clave, "es"));
  return (
    <div className="overflow-x-auto rounded-lg border border-borde">
      <table className="w-full text-sm">
        <caption className="sr-only">Efecto por género × mundo</caption>
        <thead className="bg-neutro-suave text-left text-xs uppercase tracking-wide text-tinta-suave">
          <tr>
            <th scope="col" className={TH}>GM</th>
            <th scope="col" className={`${TH} text-right`}>Total antes → después</th>
            <th scope="col" className={`${TH} text-right`}>Crecimiento implícito</th>
            <th scope="col" className={`${TH} text-right`}>Desvío frente a la meta</th>
            <th scope="col" className={`${TH} text-right`}>Libres</th>
          </tr>
        </thead>
        <tbody>
          {orden.map((e) => {
            const pctDespues = desvioPctDe(e.desvio_despues_u, e.meta_despues);
            const pctAntes = desvioPctDe(e.desvio_antes_u, e.meta_antes);
            const fuera = desvioFueraDeRango(pctDespues);
            return (
              <tr key={e.gm_clave} className="border-t border-borde">
                <th scope="row" className="px-3 py-2 text-left font-medium text-tinta">{nombres.gm.get(e.gm_clave) ?? e.gm_clave}</th>
                <td className={`px-3 py-2 ${NUM}`}>
                  {unidades(e.total_antes)} → {unidades(e.total_despues)}
                </td>
                <td className={`px-3 py-2 ${NUM}`}>
                  {formatearPct(e.crecimiento_implicito_antes_pct)} → {formatearPct(e.crecimiento_implicito_despues_pct)}
                </td>
                <td className={`px-3 py-2 ${NUM} ${fuera ? "font-medium text-alerta" : ""}`}>
                  {textoDesvio(e.desvio_antes_u, pctAntes)} → {textoDesvio(e.desvio_despues_u, pctDespues)}
                  {fuera && <span className="ml-1 text-xs">(fuera de ±1 %)</span>}
                </td>
                <td className={`px-3 py-2 ${NUM}`}>
                  {e.libres_antes} → {e.libres_despues}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ListaFilas({ titulo, filas, nombres, columna }: { titulo: string; filas: readonly ResultadoFilaLoteApi[]; nombres: Nombres; columna: (f: ResultadoFilaLoteApi) => ReactNode }) {
  if (filas.length === 0) return null;
  return (
    <div className="min-w-0">
      <h4 className="mb-1 text-sm font-medium text-tinta">{titulo}</h4>
      <ul className="divide-y divide-borde rounded-lg border border-borde text-sm">
        {filas.map((f) => (
          <li key={`${f.fila_id}-${f.anio}`} className="flex items-baseline justify-between gap-3 px-3 py-1.5">
            <span className="min-w-0 break-words">{nombres.fila.get(f.fila_id) ?? `${nombres.gm.get(f.gm_clave) ?? f.gm_clave} · fila ${f.fila_id.slice(0, 8)}`}</span>
            <span className={`shrink-0 ${NUM}`}>{columna(f)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Las filas que no se aprobarían (o no se revirtieron), con su motivo. */
export function ListaRechazos({ filas, nombres, titulo }: { filas: readonly ResultadoFilaLoteApi[]; nombres: Nombres; titulo: string }) {
  const rechazadas = filas.filter((f) => f.resultado === "rechazada");
  if (rechazadas.length === 0) return null;
  const grupos = rechazosPorCodigo(rechazadas);
  return (
    <details className="rounded-lg border border-borde" open={rechazadas.length <= 5}>
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-tinta">
        {titulo}: {plural(rechazadas.length, "fila", "filas")}
        <span className="ml-2 font-normal text-tinta-suave">{grupos.map((g) => `${g.filas} · ${textoRechazo(g.codigo)}`).join(" · ")}</span>
      </summary>
      <ul className="max-h-60 divide-y divide-borde overflow-y-auto border-t border-borde text-sm">
        {rechazadas.map((f) => (
          <li key={`${f.fila_id}-${f.anio}`} className="px-3 py-1.5">
            <span className="block break-words text-tinta">{nombres.fila.get(f.fila_id) ?? `${nombres.gm.get(f.gm_clave) ?? f.gm_clave} · fila ${f.fila_id.slice(0, 8)}`}</span>
            <span className="block text-xs text-tinta-suave">
              {textoRechazo(f.codigo)}
              {f.valor_actual !== null && ` Hoy: ${unidades(f.valor_actual)}.`}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * El resumen de un resultado (simulado o aplicado): totales, efecto por GM, las 10 filas con más unidades y las 10 con mayor |brecha|, y las que no entran.
 * Con `reversion` no hay «mayores» (vuelven a la propuesta) y los textos hablan de revertir.
 */
export function ResumenResultado({ r, nombres, reversion = false }: { r: ResultadoCombinado; nombres: Nombres; reversion?: boolean }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-tinta" aria-live="polite">
        {reversion ? (
          textoSimulacionReversion(r.totales)
        ) : (
          <>
            <span className="font-medium">{plural(r.totales.aplicadas, "fila se aprueba", "filas se aprueban")}</span> · {formatearNumero(r.totales.unidades)} u
            {r.totales.por_fuente.ia.filas > 0 && ` · IA ${formatearNumero(r.totales.por_fuente.ia.filas)} (${formatearNumero(r.totales.por_fuente.ia.unidades)} u)`}
            {r.totales.por_fuente.metodo.filas > 0 && ` · Método ${formatearNumero(r.totales.por_fuente.metodo.filas)} (${formatearNumero(r.totales.por_fuente.metodo.unidades)} u)`}
            {r.tandas > 1 && ` · en ${r.tandas} tandas`}
          </>
        )}
      </p>
      <TablaEfectoGm efecto={r.efecto_gm} nombres={nombres} />
      {!reversion && (
        <div className="grid gap-3 lg:grid-cols-2">
          <ListaFilas titulo="Las 10 filas con más unidades" filas={r.mayores_unidades} nombres={nombres} columna={(f) => `${unidades(f.valor)} u`} />
          <ListaFilas titulo="Las 10 filas con mayor brecha frente a la IA natural" filas={r.mayores_brechas} nombres={nombres} columna={(f) => `${unidades(f.valor)} u · ${signado(f.brecha_u)}`} />
        </div>
      )}
      <ListaRechazos filas={r.filas} nombres={nombres} titulo={reversion ? "No se tocan" : "No se aprobarían"} />
    </div>
  );
}

/** Un error de la API con las acciones que le corresponden (`accion` viene de `traducirErrorAprobacion`). */
export function ErrorConAcciones({
  error,
  acciones,
}: {
  error: ErrorAccion;
  acciones: Partial<Record<Exclude<AccionAprobacion, null>, { etiqueta: string; onClick: () => void }>>;
}) {
  const t = traducirErrorAprobacion(error);
  const a = t.accion ? acciones[t.accion] : undefined;
  return (
    <Alert tono="alerta">
      <span className="block">{t.mensaje}</span>
      {t.detalleServidor && <span className="mt-1 block text-xs">Detalle: {t.detalleServidor}</span>}
      {a && (
        <span className="mt-2 block">
          <Button variante="secundario" tamano="sm" onClick={a.onClick}>
            {a.etiqueta}
          </Button>
        </span>
      )}
    </Alert>
  );
}

// ─── Confirmación de un lote (vista) ───

export type VistaConfirmacionProps = {
  tipo: "aprobar" | "reaprobar";
  anio: number;
  anioEnCurso: number;
  estado: EstadoConfirmacion;
  /** Filas que el planner seleccionó (para los avisos y los nombres). */
  filasSeleccion: readonly FilaAprobacionApi[];
  gms: readonly GMAprobacionApi[];
  nombres: Nombres;
  nota: string;
  onNota: (v: string) => void;
  revision: boolean;
  onRevision: (v: boolean) => void;
  onSoloMetodo: () => void;
  onResimular: () => void;
  onAplicar: () => void;
  onReintentar: () => void;
  onCerrar: () => void;
  onDeshacer: () => void;
  onIrACrecimientos: () => void;
  onIrAFactores: () => void;
  onRecalcular: () => void;
};

/** El cuerpo y el pie del modal de confirmación, sin hooks: lo prueba el render con un estado sintético. */
export function VistaConfirmacion(p: VistaConfirmacionProps) {
  const { estado } = p;
  const reaprobar = p.tipo === "reaprobar";
  const verbo = reaprobar ? "Reaprobar" : "Aprobar";
  const nPedidas = p.filasSeleccion.length;
  const hechasCount = Object.keys(estado.hechas).length;
  const total = estado.sim?.tandas.length ?? 0;
  const final = resultadoDeHechas(estado.hechas);
  const bloqueado = estado.fijo !== null; // ya se empezó a aplicar: la nota y la casilla no cambian (el reintento reenvía lo mismo)
  const exige = estado.sim ? exigeRevision(nPedidas, estado.sim.combinado) : false;
  const aplicadas = estado.sim?.combinado.totales.aplicadas ?? 0;
  const puedeAplicar = estado.fase === "listo" && estado.sim !== null && aplicadas > 0 && (!exige || p.revision);
  const avisos = estado.sim
    ? avisosDeConfirmacion({ filas: p.filasSeleccion, gms: p.gms, anioEnCurso: p.anioEnCurso, crecimientosAReaprobar: estado.sim.combinado.crecimientos_a_reaprobar })
    : [];

  const accionesSim: Parameters<typeof ErrorConAcciones>[0]["acciones"] = {
    solo_metodo: { etiqueta: "Aprobar solo las de método", onClick: p.onSoloMetodo },
    recalcular: { etiqueta: "Recalcular la proyección", onClick: p.onRecalcular },
    recargar: { etiqueta: "Actualizar pantalla", onClick: p.onCerrar },
    crecimientos: { etiqueta: "Ir a Crecimientos", onClick: p.onIrACrecimientos },
    factores: { etiqueta: "Ir a Factores del Niño", onClick: p.onIrAFactores },
    simular_de_nuevo: { etiqueta: "Simular de nuevo", onClick: p.onResimular },
    reintentar: { etiqueta: "Simular de nuevo", onClick: p.onResimular },
  };
  // Con tandas ya aplicadas, simular de nuevo no sirve (cambiaría lo ya escrito): se actualiza la pantalla y se vuelve a elegir.
  const accionesAplicar: Parameters<typeof ErrorConAcciones>[0]["acciones"] = {
    reintentar: { etiqueta: "Reintentar", onClick: p.onReintentar },
    recalcular: { etiqueta: "Recalcular la proyección", onClick: p.onRecalcular },
    recargar: { etiqueta: "Actualizar pantalla", onClick: p.onCerrar },
    crecimientos: { etiqueta: "Ir a Crecimientos", onClick: p.onIrACrecimientos },
    factores: { etiqueta: "Ir a Factores del Niño", onClick: p.onIrAFactores },
    simular_de_nuevo: hechasCount > 0 ? { etiqueta: "Actualizar pantalla y volver a elegir", onClick: p.onCerrar } : { etiqueta: "Simular de nuevo", onClick: p.onResimular },
  };

  let cuerpo: ReactNode;
  let pie: ReactNode;

  if (estado.fase === "terminada" && final) {
    const todas = final.totales.rechazadas === 0;
    cuerpo = (
      <div className="space-y-4">
        <Alert tono={final.totales.aplicadas > 0 ? "exito" : "info"}>
          <span className="block font-medium">{textoResultadoAprobar(final.totales, p.tipo)}</span>
          {!todas && <span className="block">Las no aprobadas se listan abajo con su motivo: se deciden en Por línea.</span>}
        </Alert>
        {final.crecimientos_a_reaprobar.length > 0 && (
          <Alert tono="alerta">
            {final.crecimientos_a_reaprobar.length === 1 ? "1 GM quedó" : `${final.crecimientos_a_reaprobar.length} GM quedaron`} con crecimientos que reaprobar:{" "}
            {final.crecimientos_a_reaprobar.map((c) => nombreGm(c)).join(", ")}. Hasta reaprobarlos no se puede aprobar {p.anioEnCurso + 1} ni cerrar.
          </Alert>
        )}
        <ListaRechazos filas={final.filas} nombres={p.nombres} titulo="No aprobadas" />
        {final.pendientes_cierre && (
          <p className="text-sm text-tinta-suave">
            Para cerrar faltan: {p.anioEnCurso} · {plural(final.pendientes_cierre.filas_y, "fila", "filas")} · {p.anioEnCurso + 1} · {plural(final.pendientes_cierre.filas_y1, "fila", "filas")}.
          </p>
        )}
      </div>
    );
    pie = (
      <>
        <Button variante="peligro" onClick={p.onDeshacer} disabled={final.totales.aplicadas === 0}>
          Deshacer esta aprobación
        </Button>
        {final.crecimientos_a_reaprobar.length > 0 && (
          <Button variante="secundario" onClick={p.onIrACrecimientos}>
            Reaprobar crecimientos
          </Button>
        )}
        <Button onClick={p.onCerrar}>Listo</Button>
      </>
    );
  } else if (estado.fase === "simulando") {
    cuerpo = (
      <p className="py-8 text-center text-sm text-tinta-suave" role="status">
        Simulando el lote: calculando lo que se aprobaría, sin escribir nada…
      </p>
    );
    pie = (
      <Button variante="secundario" onClick={p.onCerrar}>
        Cancelar
      </Button>
    );
  } else if (estado.fase === "aplicando") {
    cuerpo = (
      <div className="space-y-3 py-6 text-center" role="status" aria-live="polite">
        <p className="text-sm font-medium text-tinta">
          {reaprobar ? "Reaprobando" : "Aprobando"}… {estado.tandaActual !== null && total > 1 ? textoTanda(estado.tandaActual + 1, total) : ""}
        </p>
        <p className="text-xs text-tinta-suave">No cierres esta ventana: cada tanda se escribe completa o no se escribe.</p>
      </div>
    );
    pie = <Button disabled>Escribiendo…</Button>;
  } else if (estado.errorSim || !estado.sim) {
    cuerpo = estado.errorSim ? <ErrorConAcciones error={estado.errorSim} acciones={accionesSim} /> : <Alert>No se pudo simular el lote.</Alert>;
    pie = (
      <Button variante="secundario" onClick={p.onCerrar}>
        Cerrar
      </Button>
    );
  } else {
    // Listo para confirmar (o con un error al aplicar una tanda).
    const sim = estado.sim;
    cuerpo = (
      <div className="space-y-4">
        {sim.soloMetodo && <Alert tono="info">Se aprobarán solo las filas de método; las de IA quedan sin aprobar.</Alert>}
        {hechasCount > 0 && (
          <Alert tono="info">
            Se {reaprobar ? "reaprobaron" : "aprobaron"} {hechasCount} de {total} tandas ({textoResultadoAprobar(final?.totales ?? { aplicadas: 0, rechazadas: 0 }, p.tipo)}). Lo ya escrito se queda.
          </Alert>
        )}
        {estado.errorAplicar && <ErrorConAcciones error={estado.errorAplicar} acciones={accionesAplicar} />}
        {estado.errorAplicar && hechasCount > 0 && (
          <p className="text-sm">
            <button type="button" onClick={p.onDeshacer} className="font-medium underline underline-offset-2">
              Deshacer lo aplicado
            </button>
          </p>
        )}
        {avisos.length > 0 && (
          <ul className="space-y-1.5">
            {avisos.map((a) => (
              <li key={a}>
                <Alert tono="alerta">{a}</Alert>
              </li>
            ))}
          </ul>
        )}
        <ResumenResultado r={sim.combinado} nombres={p.nombres} />
        <div className="space-y-3 rounded-lg border border-borde p-3">
          {exige && (
            <label className="flex items-start gap-2 text-sm">
              <Checkbox checked={p.revision} disabled={bloqueado} onChange={p.onRevision} label="Revisé el resumen por GM" className="mt-0.5" />
              <span>
                <span className="font-medium text-tinta">Revisé el resumen por GM</span>
                <span className="block text-xs text-tinta-suave">
                  Obligatorio porque el lote tiene más de 100 filas o algún GM queda fuera de ±1 % de su meta. Se guarda con el lote.
                </span>
              </span>
            </label>
          )}
          <Field label="Nota (opcional)" hint="Queda en el historial del lote.">
            <Input value={p.nota} maxLength={MAX_NOTA_LOTE} disabled={bloqueado} onChange={(e) => p.onNota(e.target.value)} />
          </Field>
        </div>
      </div>
    );
    pie = (
      <>
        <Button variante="secundario" onClick={p.onCerrar}>
          {hechasCount > 0 ? "Cerrar" : "Cancelar"}
        </Button>
        {estado.errorAplicar ? (
          <Button onClick={p.onReintentar}>Reintentar</Button>
        ) : (
          <Button onClick={p.onAplicar} disabled={!puedeAplicar} title={exige && !p.revision ? "Marca «Revisé el resumen por GM» para continuar" : undefined}>
            {verbo} {plural(aplicadas, "fila", "filas")}
          </Button>
        )}
      </>
    );
  }

  return (
    <Modal
      titulo={`${verbo} ${plural(nPedidas, "fila", "filas")} de ${p.anio}`}
      descripcion={reaprobar ? "Actualiza lo aprobado en bloque cuya propuesta cambió. No toca nada decidido a mano." : "Revisa el resumen por GM antes de confirmar. Nada se escribe hasta que confirmes, y se puede deshacer."}
      onCerrar={p.onCerrar}
      cerrable={estado.fase !== "aplicando"}
      ancho="max-w-5xl"
      pie={pie}
    >
      {cuerpo}
    </Modal>
  );
}

// ─── Confirmación (contenedor con el flujo) ───

export function ConfirmarLoteModal({
  proyeccionId,
  anio,
  anioEnCurso,
  modo,
  seleccion,
  gms,
  nombres,
  filtro,
  onCerrar,
  onDeshacer,
  onIrACrecimientos,
  onIrAFactores,
  onRecalcular,
}: {
  proyeccionId: string;
  anio: number;
  anioEnCurso: number;
  modo: ModoAprobacion;
  seleccion: readonly FilaAprobacionApi[];
  gms: readonly GMAprobacionApi[];
  nombres: Nombres;
  filtro: FiltroLote;
  /** `huboCambios`: se escribió al menos una tanda (la pantalla relee la lista y el historial). */
  onCerrar: (huboCambios: boolean) => void;
  /** «Deshacer esta aprobación»: revierte la confirmación (todas sus tandas aplicadas). */
  onDeshacer: (confirmacionId: string, lotesAplicados: number) => void;
  onIrACrecimientos: () => void;
  onIrAFactores: () => void;
  onRecalcular: () => void;
}) {
  // Las filas que se mandan se fijan al abrir: lo que se simula es lo que se aprueba, aunque la lista se relea por detrás.
  const [items] = useState<ItemSeleccion[]>(() => seleccion.map((f) => itemDeFila(f, modo)).filter((i): i is ItemSeleccion => i !== null));
  const filasSeleccion = useMemo(() => {
    const ids = new Set(items.map((i) => i.fila_id));
    return seleccion.filter((f) => ids.has(f.fila_id));
  }, [seleccion, items]);
  const { estado, confirmacionId, resimular, aplicar, reintentar } = useConfirmacionLote({ proyeccionId, anio, tipo: modo, items, filtro });
  const [nota, setNota] = useState("");
  const [revision, setRevision] = useState(false);
  const huboCambios = Object.keys(estado.hechas).length > 0;
  const cerrar = () => onCerrar(huboCambios);

  return (
    <VistaConfirmacion
      tipo={modo}
      anio={anio}
      anioEnCurso={anioEnCurso}
      estado={estado}
      filasSeleccion={filasSeleccion}
      gms={gms}
      nombres={nombres}
      nota={nota}
      onNota={setNota}
      revision={revision}
      onRevision={setRevision}
      onSoloMetodo={() => resimular(true)}
      onResimular={() => resimular(estado.sim?.soloMetodo ?? false)}
      onAplicar={() => aplicar(nota, revision)}
      onReintentar={reintentar}
      onCerrar={cerrar}
      onDeshacer={() => onDeshacer(confirmacionId, Object.values(estado.hechas).filter((r) => r.lote !== null).length)}
      onIrACrecimientos={onIrACrecimientos}
      onIrAFactores={onIrAFactores}
      onRecalcular={onRecalcular}
    />
  );
}
