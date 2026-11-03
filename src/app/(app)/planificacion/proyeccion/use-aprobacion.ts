"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api-client";
import type { AprobacionApi, FiltroLote, LoteApi, FilaLoteApi, ModoAprobacion, ResultadoLoteApi } from "@/lib/aprobacion/tipos-api";
import { aErrorAccion, esperarMs } from "./use-propuesta-ia";
import { rutaProyeccion, useLectura, type ErrorAccion } from "./use-proyeccion";
import {
  combinarResultados,
  cuerpoLote,
  planearTandas,
  urlAprobacionApi,
  urlLote,
  urlLotes,
  urlRevertirConfirmacion,
  urlRevertirLote,
  type ItemSeleccion,
  type ResultadoCombinado,
  type TandaPlan,
} from "./aprobacion-vista";

/**
 * Hooks y flujos de la pestaña «Aprobación» (ficha 07g, §1.2 y §4.4). Todo va por `/api` con `api` y `useLectura`; nunca Supabase. El navegador genera `lote_id` y
 * `confirmacion_id` (D10), SIMULA antes de confirmar, manda la `huella_simulacion` de cada tanda (D8) y envía las tandas una a una sin partir un GM (D17).
 * El estado solo se toca dentro de promesas (react-hooks/set-state-in-effect). Los flujos son funciones puras de `post` (`simularConfirmacion`, `aplicarTandas`, …)
 * para probarlos con una API de mentira.
 */

export const rutaAprobacionBase = (proyeccionId: string) => `${rutaProyeccion(proyeccionId)}/aprobacion`;

export function useAprobacion(proyeccionId: string, anio: number | null, modo: ModoAprobacion) {
  return useLectura<AprobacionApi>(anio === null ? null : urlAprobacionApi(proyeccionId, anio, modo));
}

export function useLotes(proyeccionId: string) {
  return useLectura<{ lotes: LoteApi[] }>(urlLotes(proyeccionId));
}

export type DetalleLoteApi = LoteApi & { filas: FilaLoteApi[] };

export function useDetalleLote(proyeccionId: string, loteId: string | null) {
  return useLectura<DetalleLoteApi>(loteId === null ? null : urlLote(proyeccionId, loteId));
}

export type Post = <T>(url: string, body: unknown) => Promise<T>;
const postApi: Post = (url, body) => api.post(url, body);
export const nuevoUuid = (): string => crypto.randomUUID();

/** `409 conflicto_reintentar`: se reenvía una vez, con el mismo `lote_id`, tras esta espera. */
export const ESPERA_REINTENTO_MS = 700;

// ─── Confirmar un lote ───

export type ArgsConfirmacion = {
  proyeccionId: string;
  anio: number;
  tipo: "aprobar" | "reaprobar";
  items: readonly ItemSeleccion[];
  filtro?: FiltroLote;
};

export type SimulacionLote = { tandas: TandaPlan[]; resultados: ResultadoLoteApi[]; soloMetodo: boolean; combinado: ResultadoCombinado };

export type ResultadoSimular = { ok: true; sim: SimulacionLote } | { ok: false; error: ErrorAccion };

/**
 * Simula cada tanda (`POST …/lotes` con `simular: true`) y junta los resultados. `soloMetodo` quita los ítems de IA («Aprobar solo las de método»): como el
 * cuerpo cambia, las tandas llevan `lote_id` nuevos. Se detiene en el primer error y lo devuelve tal cual.
 */
export async function simularConfirmacion(a: ArgsConfirmacion & { confirmacionId: string; soloMetodo: boolean; post?: Post; nuevoId?: () => string }): Promise<ResultadoSimular> {
  const post = a.post ?? postApi;
  const items = a.soloMetodo ? a.items.filter((i) => i.item.fuente === "metodo") : [...a.items];
  if (items.length === 0) return { ok: false, error: { mensaje: "No quedan filas de método para aprobar en esta selección.", codigo: null } };
  const { tandas } = planearTandas(items, a.nuevoId ?? nuevoUuid);
  const resultados: ResultadoLoteApi[] = [];
  for (const tanda of tandas) {
    try {
      const r = await post<ResultadoLoteApi>(
        urlLotes(a.proyeccionId),
        cuerpoLote({ tanda, confirmacionId: a.confirmacionId, tipo: a.tipo, anio: a.anio, simular: true, revisionConfirmada: false, filtro: a.filtro })
      );
      resultados.push(r);
    } catch (e) {
      return { ok: false, error: aErrorAccion(e) };
    }
  }
  return { ok: true, sim: { tandas, resultados, soloMetodo: a.soloMetodo, combinado: combinarResultados(resultados) } };
}

export type ResultadoAplicar = { ok: true } | { ok: false; error: ErrorAccion; tanda: number };

/**
 * Envía las tandas que faltan, en orden, cada una con la huella de SU simulación. `hechas` (por índice de tanda) se va llenando con `alTanda`: un reintento
 * tras un corte retoma en la primera que falta y reusa el mismo `lote_id` (D10), así que lo ya aplicado no se aprueba dos veces. Un `409 conflicto_reintentar`
 * se reintenta una vez solo. Con `repetido` la tanda cuenta como hecha.
 */
export async function aplicarTandas(a: {
  proyeccionId: string;
  anio: number;
  tipo: "aprobar" | "reaprobar";
  confirmacionId: string;
  sim: SimulacionLote;
  filtro?: FiltroLote;
  nota: string;
  revision: boolean;
  hechas: Readonly<Record<number, ResultadoLoteApi>>;
  alTanda: (indice: number, r: ResultadoLoteApi) => void;
  alEmpezar?: (indice: number) => void;
  post?: Post;
  esperar?: (ms: number) => Promise<void>;
}): Promise<ResultadoAplicar> {
  const post = a.post ?? postApi;
  const esperar = a.esperar ?? esperarMs;
  for (let i = 0; i < a.sim.tandas.length; i++) {
    if (a.hechas[i]) continue;
    a.alEmpezar?.(i);
    const cuerpo = cuerpoLote({
      tanda: a.sim.tandas[i],
      confirmacionId: a.confirmacionId,
      tipo: a.tipo,
      anio: a.anio,
      simular: false,
      huellaSimulacion: a.sim.resultados[i].huella_simulacion,
      revisionConfirmada: a.revision,
      nota: a.nota,
      filtro: a.filtro,
    });
    let intento = 0;
    for (;;) {
      try {
        const r = await post<ResultadoLoteApi>(urlLotes(a.proyeccionId), cuerpo);
        a.alTanda(i, r);
        break;
      } catch (e) {
        const err = aErrorAccion(e);
        if (err.codigo === "conflicto_reintentar" && intento === 0) {
          intento += 1;
          await esperar(ESPERA_REINTENTO_MS);
          continue;
        }
        return { ok: false, error: err, tanda: i };
      }
    }
  }
  return { ok: true };
}

export type FaseConfirmacion = "simulando" | "listo" | "aplicando" | "terminada";

export type EstadoConfirmacion = {
  fase: FaseConfirmacion;
  sim: SimulacionLote | null;
  errorSim: ErrorAccion | null;
  errorAplicar: ErrorAccion | null;
  /** Resultado de cada tanda ya aplicada, por índice. */
  hechas: Record<number, ResultadoLoteApi>;
  tandaActual: number | null;
  /** La nota y la casilla con las que se empezó a aplicar: un reintento reenvía lo mismo (si no, el `lote_id` repetido daría `lote_ajeno`). */
  fijo: { nota: string; revision: boolean } | null;
};

const ESTADO_INICIAL: EstadoConfirmacion = { fase: "simulando", sim: null, errorSim: null, errorAplicar: null, hechas: {}, tandaActual: null, fijo: null };

/** Resultado final de lo aplicado hasta ahora (una o varias tandas). */
export function resultadoDeHechas(hechas: Readonly<Record<number, ResultadoLoteApi>>): ResultadoCombinado | null {
  const rs = Object.keys(hechas)
    .map(Number)
    .sort((x, y) => x - y)
    .map((i) => hechas[i]);
  return rs.length === 0 ? null : combinarResultados(rs);
}

/**
 * La confirmación (§4.4): al abrir simula sola; `resimular` repite la simulación (con o sin los ítems de IA); `aplicar` envía las tandas; `reintentar` retoma
 * la que falló. `confirmacionId` es de esta confirmación y se genera una sola vez en el navegador (`crypto.randomUUID()`).
 */
export function useConfirmacionLote(a: ArgsConfirmacion) {
  const { proyeccionId, anio, tipo, items, filtro } = a;
  const [confirmacionId] = useState(nuevoUuid);
  const [estado, setEstado] = useState<EstadoConfirmacion>(ESTADO_INICIAL);
  const montado = useRef(true);
  const secuencia = useRef(0);

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  const correrSimulacion = useCallback(
    async (soloMetodo: boolean) => {
      const numero = ++secuencia.current;
      const r = await simularConfirmacion({ proyeccionId, anio, tipo, items, filtro, confirmacionId, soloMetodo });
      if (!montado.current || numero !== secuencia.current) return;
      setEstado((e) => (r.ok ? { ...e, fase: "listo", sim: r.sim, errorSim: null, errorAplicar: null } : { ...e, fase: "listo", sim: null, errorSim: r.error }));
    },
    [proyeccionId, anio, tipo, items, filtro, confirmacionId]
  );

  // Simulación inicial: el estado ya parte en «simulando», así que aquí solo se pide (setState dentro de la promesa).
  useEffect(() => {
    void correrSimulacion(false);
  }, [correrSimulacion]);

  const resimular = useCallback(
    (soloMetodo: boolean) => {
      setEstado({ ...ESTADO_INICIAL });
      void correrSimulacion(soloMetodo);
    },
    [correrSimulacion]
  );

  const enviar = useCallback(
    async (sim: SimulacionLote, fijo: { nota: string; revision: boolean }, previas: Record<number, ResultadoLoteApi>) => {
      setEstado((e) => ({ ...e, fase: "aplicando", errorAplicar: null, fijo }));
      const hechas: Record<number, ResultadoLoteApi> = { ...previas };
      const r = await aplicarTandas({
        proyeccionId,
        anio,
        tipo,
        confirmacionId,
        sim,
        filtro,
        nota: fijo.nota,
        revision: fijo.revision,
        hechas,
        alEmpezar: (i) => {
          if (montado.current) setEstado((e) => ({ ...e, tandaActual: i }));
        },
        alTanda: (i, res) => {
          hechas[i] = res;
          if (montado.current) setEstado((e) => ({ ...e, hechas: { ...hechas } }));
        },
      });
      if (!montado.current) return;
      setEstado((e) => (r.ok ? { ...e, fase: "terminada", tandaActual: null, hechas: { ...hechas } } : { ...e, fase: "listo", tandaActual: r.tanda, errorAplicar: r.error, hechas: { ...hechas } }));
    },
    [proyeccionId, anio, tipo, confirmacionId, filtro]
  );

  const aplicar = useCallback(
    (nota: string, revision: boolean) => {
      if (estado.sim) void enviar(estado.sim, { nota, revision }, estado.hechas);
    },
    [enviar, estado.sim, estado.hechas]
  );

  const reintentar = useCallback(() => {
    if (estado.sim && estado.fijo) void enviar(estado.sim, estado.fijo, estado.hechas);
  }, [enviar, estado.sim, estado.fijo, estado.hechas]);

  return { estado, confirmacionId, resimular, aplicar, reintentar };
}

// ─── Revertir (lote o confirmación) ───

export type DestinoReversion =
  | { tipo: "lote"; loteId: string; /** `fila_id` marcados; sin ellos se revierte el lote entero. */ filas?: string[]; etiqueta: string }
  | { tipo: "confirmacion"; confirmacionId: string; /** Lotes (tandas) de la confirmación que se revierten: uno por cada uno va un `lote_id` de reversión. */ nLotes: number; etiqueta: string };

export type SimulacionReversion = { resultados: ResultadoLoteApi[]; combinado: ResultadoCombinado };

/** Los ids de los lotes de reversión que genera el navegador (D10): uno para un lote, uno por tanda para una confirmación. */
export function idsDeReversion(destino: DestinoReversion, nuevoId: () => string = nuevoUuid): string[] {
  return destino.tipo === "lote" ? [nuevoId()] : Array.from({ length: destino.nLotes }, () => nuevoId());
}

function cuerpoReversion(destino: DestinoReversion, ids: readonly string[], nota: string, simular: boolean, huella?: string) {
  const n = nota.trim();
  if (destino.tipo === "lote") {
    const c: Record<string, unknown> = { lote_id: ids[0], simular };
    if (destino.filas && destino.filas.length > 0) c.filas = destino.filas;
    if (n) c.nota = n;
    if (huella !== undefined) c.huella_simulacion = huella;
    return c;
  }
  const c: Record<string, unknown> = { lote_ids: [...ids], simular };
  if (n) c.nota = n;
  return c;
}

const urlReversion = (proyeccionId: string, d: DestinoReversion) => (d.tipo === "lote" ? urlRevertirLote(proyeccionId, d.loteId) : urlRevertirConfirmacion(proyeccionId, d.confirmacionId));

/** Simula la reversión (no escribe). Una confirmación responde una lista (un lote de reversión por tanda). */
export async function simularReversion(a: { proyeccionId: string; destino: DestinoReversion; ids: readonly string[]; post?: Post }): Promise<{ ok: true; sim: SimulacionReversion } | { ok: false; error: ErrorAccion }> {
  const post = a.post ?? postApi;
  try {
    const r = await post<ResultadoLoteApi | ResultadoLoteApi[]>(urlReversion(a.proyeccionId, a.destino), cuerpoReversion(a.destino, a.ids, "", true));
    const resultados = Array.isArray(r) ? r : [r];
    return { ok: true, sim: { resultados, combinado: combinarResultados(resultados) } };
  } catch (e) {
    return { ok: false, error: aErrorAccion(e) };
  }
}

/** Aplica la reversión con los mismos ids; un `409 conflicto_reintentar` se reintenta una vez. Revertir un lote lleva la huella de su simulación; una confirmación no. */
export async function aplicarReversion(a: {
  proyeccionId: string;
  destino: DestinoReversion;
  ids: readonly string[];
  nota: string;
  sim: SimulacionReversion;
  post?: Post;
  esperar?: (ms: number) => Promise<void>;
}): Promise<{ ok: true; resultados: ResultadoLoteApi[] } | { ok: false; error: ErrorAccion }> {
  const post = a.post ?? postApi;
  const esperar = a.esperar ?? esperarMs;
  const huella = a.destino.tipo === "lote" ? a.sim.resultados[0]?.huella_simulacion : undefined;
  const cuerpo = cuerpoReversion(a.destino, a.ids, a.nota, false, huella);
  for (let intento = 0; ; intento++) {
    try {
      const r = await post<ResultadoLoteApi | ResultadoLoteApi[]>(urlReversion(a.proyeccionId, a.destino), cuerpo);
      return { ok: true, resultados: Array.isArray(r) ? r : [r] };
    } catch (e) {
      const err = aErrorAccion(e);
      if (err.codigo === "conflicto_reintentar" && intento === 0) {
        await esperar(ESPERA_REINTENTO_MS);
        continue;
      }
      return { ok: false, error: err };
    }
  }
}

export type EstadoReversion = {
  fase: "simulando" | "listo" | "aplicando" | "terminada";
  sim: SimulacionReversion | null;
  final: ResultadoCombinado | null;
  error: ErrorAccion | null;
};

const REVERSION_INICIAL: EstadoReversion = { fase: "simulando", sim: null, final: null, error: null };

export function useReversion(proyeccionId: string, destino: DestinoReversion) {
  const [ids] = useState(() => idsDeReversion(destino));
  const [estado, setEstado] = useState<EstadoReversion>(REVERSION_INICIAL);
  const montado = useRef(true);
  const secuencia = useRef(0);

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  const correr = useCallback(async () => {
    const numero = ++secuencia.current;
    const r = await simularReversion({ proyeccionId, destino, ids });
    if (!montado.current || numero !== secuencia.current) return;
    setEstado(r.ok ? { fase: "listo", sim: r.sim, final: null, error: null } : { fase: "listo", sim: null, final: null, error: r.error });
  }, [proyeccionId, destino, ids]);

  useEffect(() => {
    void correr();
  }, [correr]);

  const resimular = useCallback(() => {
    setEstado(REVERSION_INICIAL);
    void correr();
  }, [correr]);

  const aplicar = useCallback(
    async (nota: string) => {
      const sim = estado.sim;
      if (!sim) return;
      setEstado((e) => ({ ...e, fase: "aplicando", error: null }));
      const r = await aplicarReversion({ proyeccionId, destino, ids, nota, sim });
      if (!montado.current) return;
      setEstado((e) => (r.ok ? { ...e, fase: "terminada", final: combinarResultados(r.resultados) } : { ...e, fase: "listo", error: r.error }));
    },
    [proyeccionId, destino, ids, estado.sim]
  );

  return { estado, resimular, aplicar };
}
