import { mesDe } from "@/lib/compras/reglas";
import type { Mes } from "@/lib/compras/tipos";
import { diasEntre, etiquetaDiaMes, etiquetaFecha, etiquetaMes, rangoConfirmado, RANGO_HITO_CONFIRMABLE } from "./fechas";
import { mesDeDestino } from "./movimiento";
import type { AvisoDetalleApi, HitoApi, ProximoHitoApi, TramoLineaTiempoApi } from "./tipos-api";
import { HITOS, HITOS_LOGISTICOS, type AsignacionRegistro, type EmbarqueRegistro, type EstadoHito, type Hito, type HitoLogistico, type PaqueteRegistro } from "./tipos";

/**
 * Hitos y línea de tiempo de una compra (ficha 08b-1b, §2.1, §2.2 y §3.4; decisión 120). PURO: sin Supabase y sin reloj (`hoy` entra como
 * parámetro, `aaaa-mm-dd` en hora de Lima). La línea de tiempo de la compra NO tiene función SQL: se arma aquí con la compra, sus
 * asignaciones, los embarques y los paquetes que las rutas ya leen.
 *
 * Seis hitos por tramo: Orden de compra (de la compra, siempre `real`), Zarpe, Arribo, Ingreso CD, Inicio operativo (fecha y hora opcional) e
 * Ingreso al stock (con los marcadores de `MARCADOR_HITO`). Los cinco últimos viven en el embarque (el ingreso al stock, también en el paquete con ingreso propio).
 * Estado de cada uno (§2.2): `real`, `sin_registrar`, `vencido`, `por_confirmar` (solo el ingreso al stock), `previsto`, `pendiente`,
 * `no_aplica`. El estado se muestra SIEMPRE en texto además del color (`textoEstadoHito`).
 */

// ─── Estado de un hito ───

/** Lo que hace falta de un embarque para decir el estado de sus hitos. */
export type EmbarqueParaHitos = Pick<
  EmbarqueRegistro,
  | "tipo"
  | "estado"
  | "fecha_salida_estimada"
  | "fecha_puerto_estimada"
  | "fecha_llegada_estimada"
  | "fecha_inicio_operativo_estimada"
  | "hora_inicio_operativo"
  | "fecha_ingreso_estimada"
  | "fecha_llegada_real"
  | "hito_confirmado"
>;

/**
 * Fecha vigente de un hito logístico. El ingreso al stock es el real si ya llegó; si no, el fijado; si no, el Ingreso CD (nula = «el día
 * del Ingreso CD»).
 */
export function fechaDelHito(e: EmbarqueParaHitos, hito: HitoLogistico): string | null {
  switch (hito) {
    case "zarpe":
      return e.fecha_salida_estimada;
    case "arribo":
      return e.fecha_puerto_estimada;
    case "ingreso_cd":
      return e.fecha_llegada_estimada;
    case "inicio_operativo":
      return e.fecha_inicio_operativo_estimada;
    case "ingreso_stock":
      return e.fecha_llegada_real ?? e.fecha_ingreso_estimada ?? e.fecha_llegada_estimada;
  }
}

/**
 * Estado de un hito logístico de un embarque (§2.2):
 *  - `no_aplica`: el Arribo de un embarque `local`.
 *  - `real`: el hito está en o antes de `hito_confirmado` y tiene fecha; o el ingreso al stock con `fecha_llegada_real`. En un embarque
 *    `recibido` todo lo anterior al ingreso ocurrió.
 *  - `sin_registrar`: en o antes de `hito_confirmado` pero sin fecha («Ocurrió · sin fecha»).
 *  - `por_confirmar`: SOLO el ingreso al stock, con fecha anterior a hoy, sin `fecha_llegada_real` y con `hito_confirmado` en `ingreso_cd` o
 *    `inicio_operativo`: la mercadería ya está en el CD y hasta que exista «Recibir embarque» (08b-2) no hay cómo confirmarlo; no es atraso.
 *  - `vencido`: previsto con fecha anterior a hoy y no confirmado (salvo `por_confirmar`).
 *  - `previsto`: con fecha, no confirmado, fecha ≥ hoy. `pendiente`: sin fecha y no confirmado.
 */
export function estadoHito(hito: HitoLogistico, e: EmbarqueParaHitos, hoy: string): EstadoHito {
  if (hito === "arribo" && e.tipo === "local") return "no_aplica";
  const recibido = e.estado === "recibido";
  if (hito === "ingreso_stock") {
    if (e.fecha_llegada_real) return "real";
    const efectiva = e.fecha_ingreso_estimada ?? e.fecha_llegada_estimada;
    if (efectiva >= hoy) return "previsto";
    return recibido || rangoConfirmado(e.hito_confirmado) >= RANGO_HITO_CONFIRMABLE.ingreso_cd ? "por_confirmar" : "vencido";
  }
  const rango = RANGO_HITO_CONFIRMABLE[hito];
  const fecha = fechaDelHito(e, hito);
  const confirmado = recibido ? RANGO_HITO_CONFIRMABLE.inicio_operativo : rangoConfirmado(e.hito_confirmado);
  if (rango <= confirmado) return fecha !== null ? "real" : "sin_registrar";
  if (fecha === null) return "pendiente";
  return fecha < hoy ? "vencido" : "previsto";
}

// ─── Los cinco hitos de un embarque ───

/**
 * Una fila de `agrupador_hitos_resumen` (§2.9): por embarque y hito, la fecha original (la primera no nula de los eventos), las
 * reprogramaciones (sin contar las causas `correccion` ni `programacion`) y la última causa. `ingreso_paquete` lleva su `paquete_id`.
 */
export type ResumenHito = {
  hito: HitoLogistico | "ingreso_paquete";
  paquete_id?: string | null;
  fecha_original: string | null;
  reprogramaciones: number;
  ultima_causa?: string | null;
};

const resumenDe = (resumen: readonly ResumenHito[] | undefined, hito: ResumenHito["hito"], paqueteId: string | null = null): ResumenHito | undefined =>
  resumen?.find((r) => r.hito === hito && (r.paquete_id ?? null) === paqueteId);

/** Retraso en días contra lo planeado al crear: positivo = se atrasó; nulo si no hay original o no cambió. */
export function retrasoDias(original: string | null, vigente: string | null): number | null {
  if (original === null || vigente === null || original === vigente) return null;
  return diasEntre(original, vigente);
}

function armarHito(hito: HitoLogistico, e: EmbarqueParaHitos, hoy: string, resumen: ResumenHito | undefined): HitoApi {
  const fecha = fechaDelHito(e, hito);
  const esArriboLocal = hito === "arribo" && e.tipo === "local";
  const base: HitoApi = {
    hito,
    fecha: esArriboLocal ? null : fecha,
    hora: hito === "inicio_operativo" && fecha !== null ? (e.hora_inicio_operativo?.slice(0, 5) ?? null) : null,
    estado: estadoHito(hito, e, hoy),
    fecha_original: resumen?.fecha_original ?? null,
    retraso_dias: retrasoDias(resumen?.fecha_original ?? null, esArriboLocal ? null : fecha),
    reprogramaciones: resumen?.reprogramaciones ?? 0,
    manda_el_mes: hito === "ingreso_stock",
  };
  if (hito === "ingreso_stock" && e.fecha_llegada_real === null && e.fecha_ingreso_estimada === null) base.igual_a_ingreso_cd = true;
  return base;
}

/** Los cinco hitos logísticos de un embarque, en orden (`EmbarqueApi.hitos`). */
export function hitosDeEmbarque(e: EmbarqueParaHitos, hoy: string, resumen?: readonly ResumenHito[]): HitoApi[] {
  return HITOS_LOGISTICOS.map((h) => armarHito(h, e, hoy, resumenDe(resumen, h)));
}

/** Σ de reprogramaciones de los cinco hitos y de los ingresos de paquete (`EmbarqueApi.reprogramaciones_total`). */
export const reprogramacionesTotal = (resumen: readonly ResumenHito[]): number => resumen.reduce((s, r) => s + r.reprogramaciones, 0);

// ─── Línea de tiempo de una compra ───

/** Lo que la línea de tiempo necesita de la compra: la fecha de la orden y las entregas de sus líneas ACTIVAS (para lo «sin embarque»). */
export type CompraParaLineaTiempo = { fecha_compra: string; entregas: readonly { id: string; periodo: Mes | string; unidades: number }[] };
export type AsignacionParaLineaTiempo = Pick<AsignacionRegistro, "entrega_id" | "embarque_id" | "paquete_id" | "unidades">;
export type EmbarqueParaLineaTiempo = EmbarqueParaHitos & Pick<EmbarqueRegistro, "id" | "codigo" | "nombre" | "periodo_llegada" | "origen">;
export type PaqueteParaLineaTiempo = Pick<PaqueteRegistro, "id" | "codigo" | "nombre" | "fecha_ingreso_estimada" | "periodo_ingreso">;

const hitoOrdenCompra = (fecha_compra: string): HitoApi => ({ hito: "orden_compra", fecha: fecha_compra.slice(0, 10), hora: null, estado: "real", fecha_original: null, retraso_dias: null, reprogramaciones: 0, manda_el_mes: false });

/** Los seis hitos de un tramo «Sin embarque»: la orden de compra `real` y todo lo demás `pendiente` (siempre, aunque su mes ya pasó). */
function hitosSinEmbarque(fecha_compra: string): HitoApi[] {
  return [
    hitoOrdenCompra(fecha_compra),
    ...HITOS_LOGISTICOS.map((h): HitoApi => ({ hito: h, fecha: null, hora: null, estado: "pendiente", fecha_original: null, retraso_dias: null, reprogramaciones: 0, manda_el_mes: h === "ingreso_stock" })),
  ];
}

/**
 * Línea de tiempo de una compra (§3.4): un tramo por (embarque, paquete) de sus asignaciones, con la suma de sus unidades, más un tramo
 * «Sin embarque» por cada mes con unidades que ninguna asignación cubre. Σ unidades de los tramos = Σ de las entregas de la compra. Orden:
 * por mes y luego por código de embarque (lo «sin embarque» al final de su mes). El mes de un tramo es `mesDeDestino(embarque, paquete)`.
 * Las asignaciones históricas forman tramos igual (con sus hitos `real` cuando el embarque fue recibido). Con ingreso propio de paquete, el
 * hito Ingreso al stock del tramo es el del paquete (con `del_paquete`). `resumenes` (por id de embarque) trae fecha original y
 * reprogramaciones de `agrupador_hitos_resumen`; sin él salen en 0.
 */
export function lineaDeTiempo(
  compra: CompraParaLineaTiempo,
  asignaciones: readonly AsignacionParaLineaTiempo[],
  embarques: readonly EmbarqueParaLineaTiempo[],
  paquetes: readonly PaqueteParaLineaTiempo[],
  hoy: string,
  resumenes?: ReadonlyMap<string, readonly ResumenHito[]>,
): TramoLineaTiempoApi[] {
  const embarquePorId = new Map(embarques.map((e) => [e.id, e]));
  const paquetePorId = new Map(paquetes.map((p) => [p.id, p]));
  const entregaIds = new Set(compra.entregas.map((e) => e.id));

  // Unidades asignadas por (embarque, paquete) y por entrega.
  const porTramo = new Map<string, { embarque_id: string; paquete_id: string | null; unidades: number }>();
  const asignadoPorEntrega = new Map<string, number>();
  for (const a of asignaciones) {
    if (!entregaIds.has(a.entrega_id)) continue;
    const k = `${a.embarque_id}|${a.paquete_id ?? ""}`;
    const t = porTramo.get(k);
    if (t) t.unidades += a.unidades;
    else porTramo.set(k, { embarque_id: a.embarque_id, paquete_id: a.paquete_id, unidades: a.unidades });
    asignadoPorEntrega.set(a.entrega_id, (asignadoPorEntrega.get(a.entrega_id) ?? 0) + a.unidades);
  }

  const tramos: (TramoLineaTiempoApi & { _orden: string })[] = [];
  for (const t of porTramo.values()) {
    const e = embarquePorId.get(t.embarque_id);
    if (!e) continue; // un embarque que no se leyó: no se inventa un tramo
    const p = t.paquete_id === null ? undefined : paquetePorId.get(t.paquete_id);
    const resumen = resumenes?.get(e.id);
    const propio = p !== undefined && p.fecha_ingreso_estimada !== null;
    // Con ingreso propio del paquete, el ingreso al stock del tramo es el suyo.
    const eTramo: EmbarqueParaHitos = propio && p ? { ...e, fecha_ingreso_estimada: p.fecha_ingreso_estimada } : e;
    const hitos = hitosDeEmbarque(eTramo, hoy, resumen).map((h) => {
      if (h.hito !== "ingreso_stock" || !propio || !p) return h;
      const rp = resumenDe(resumen, "ingreso_paquete", p.id);
      const { igual_a_ingreso_cd: _ignorado, ...resto } = h;
      void _ignorado;
      return { ...resto, fecha_original: rp?.fecha_original ?? null, retraso_dias: retrasoDias(rp?.fecha_original ?? null, resto.fecha), reprogramaciones: rp?.reprogramaciones ?? 0, del_paquete: { codigo: p.codigo, nombre: p.nombre } };
    });
    const mes = mesDeDestino(e, p ?? null);
    tramos.push({
      embarque: { id: e.id, codigo: e.codigo, nombre: e.nombre, origen: e.origen },
      paquete: p ? { id: p.id, codigo: p.codigo, nombre: p.nombre } : null,
      unidades: t.unidades,
      mes,
      hitos: [hitoOrdenCompra(compra.fecha_compra), ...hitos],
      _orden: `${mes}|${e.codigo}|${p?.codigo ?? ""}`,
    });
  }

  // «Sin embarque»: lo que ninguna asignación cubre, por mes.
  const sinPorMes = new Map<string, number>();
  for (const en of compra.entregas) {
    const libre = en.unidades - (asignadoPorEntrega.get(en.id) ?? 0);
    if (libre > 0) sinPorMes.set(mesDe(en.periodo), (sinPorMes.get(mesDe(en.periodo)) ?? 0) + libre);
  }
  for (const [mes, unidades] of sinPorMes) {
    tramos.push({ embarque: null, paquete: null, unidades, mes, hitos: hitosSinEmbarque(compra.fecha_compra), _orden: `${mes}|￿|` });
  }

  return tramos
    .sort((a, b) => (a._orden < b._orden ? -1 : a._orden > b._orden ? 1 : 0))
    .map(({ _orden, ...tramo }) => {
      void _orden;
      return tramo;
    });
}

// ─── Próximo hito ───

const ESTADOS_PENDIENTES: readonly EstadoHito[] = ["vencido", "por_confirmar", "previsto", "pendiente"];
const ESTADOS_CON_FECHA: readonly EstadoHito[] = ["vencido", "por_confirmar", "previsto"];

/** Un tramo está completo si todos sus hitos ocurrieron (o no aplican). */
const tramoCompleto = (hitos: readonly HitoApi[]): boolean => !hitos.some((h) => ESTADOS_PENDIENTES.includes(h.estado));

type Candidato = { hito: HitoApi; embarque_codigo: string | null; tramo: number };

function elegirProximo(candidatos: Candidato[]): Candidato | null {
  const conFecha = candidatos.filter((c) => ESTADOS_CON_FECHA.includes(c.hito.estado) && c.hito.fecha !== null);
  const menor = (lista: Candidato[]) =>
    lista.slice().sort((a, b) => ((a.hito.fecha as string) < (b.hito.fecha as string) ? -1 : (a.hito.fecha as string) > (b.hito.fecha as string) ? 1 : HITOS.indexOf(a.hito.hito) - HITOS.indexOf(b.hito.hito) || a.tramo - b.tramo))[0] ?? null;
  const vencido = menor(conFecha.filter((c) => c.hito.estado === "vencido"));
  if (vencido) return vencido;
  const siguiente = menor(conFecha);
  if (siguiente) return siguiente;
  // Sin ninguna fecha (p. ej. solo «Sin embarque»): el primer hito pendiente del primer tramo incompleto; en «Sin embarque», el ingreso al stock.
  const pendiente = candidatos.find((c) => c.hito.estado === "pendiente");
  if (!pendiente) return null;
  return pendiente.embarque_codigo === null ? (candidatos.find((c) => c.tramo === pendiente.tramo && c.hito.hito === "ingreso_stock") ?? pendiente) : pendiente;
}

const textoProximo = (h: HitoApi): ProximoHitoApi => ({ hito: h.hito, fecha: h.fecha, hora: h.hora, estado: h.estado });

/**
 * Próximo hito de una compra (§3.4): entre los tramos que no están completos, el primer hito que no es `real` ni `sin_registrar` con la
 * fecha más temprana (un `por_confirmar` cuenta, con su texto); si alguno está `vencido`, gana el vencido más antiguo. `tramos_mas` dice
 * cuántos otros tramos siguen incompletos («+1 tramo»). Sin tramos pendientes, `null`.
 */
export function proximoHito(tramos: readonly TramoLineaTiempoApi[]): (ProximoHitoApi & { embarque_codigo: string | null; tramos_mas: number }) | null {
  const abiertos = tramos.map((t, i) => ({ t, i })).filter(({ t }) => !tramoCompleto(t.hitos));
  if (abiertos.length === 0) return null;
  const candidatos: Candidato[] = abiertos.flatMap(({ t, i }) => t.hitos.map((hito) => ({ hito, embarque_codigo: t.embarque?.codigo ?? null, tramo: i })));
  const c = elegirProximo(candidatos);
  if (c === null) return null;
  return { ...textoProximo(c.hito), embarque_codigo: c.embarque_codigo, tramos_mas: abiertos.length - 1 };
}

/** Próximo hito de un embarque, sobre sus cinco hitos (`EmbarqueApi.proximo_hito`). */
export function proximoHitoEmbarque(hitos: readonly HitoApi[]): ProximoHitoApi | null {
  if (tramoCompleto(hitos)) return null;
  const c = elegirProximo(hitos.map((hito) => ({ hito, embarque_codigo: null, tramo: 0 })));
  return c === null ? null : textoProximo(c.hito);
}

/** Algún hito `vencido` (el filtro «Con hitos vencidos» y «Atrasados»): un ingreso `por_confirmar` NO cuenta. */
export const tieneHitoVencido = (hitos: readonly Pick<HitoApi, "estado">[]): boolean => hitos.some((h) => h.estado === "vencido");
/** Lo mismo sobre los tramos de una compra. */
export const tramosConHitoVencido = (tramos: readonly Pick<TramoLineaTiempoApi, "hitos">[]): boolean => tramos.some((t) => tieneHitoVencido(t.hitos));

// ─── Textos ───

const dias = (n: number) => `${n} día${n === 1 ? "" : "s"}`;

/**
 * El texto de un hito, con su estado, para pantalla y Excel (siempre texto además del color): «02/11/2026 · Ocurrió ✓», «Ocurrió · sin
 * fecha», «18/11/2026 · Debía ocurrir hace 4 días», «08/11/2026 · Llegó, falta confirmar el ingreso», «18/11/2026 · Previsto», «Pendiente»,
 * «No aplica». El inicio operativo lleva su hora si la tiene; el ingreso al stock sin fijar, «(igual al Ingreso CD)».
 */
export function textoEstadoHito(h: HitoApi, hoy: string): string {
  const fecha = h.fecha === null ? null : `${etiquetaFecha(h.fecha)}${h.hora ? ` ${h.hora}` : ""}`;
  switch (h.estado) {
    case "no_aplica":
      return "No aplica";
    case "pendiente":
      return "Pendiente";
    case "sin_registrar":
      return "Ocurrió · sin fecha";
    case "real":
      return fecha === null ? "Ocurrió ✓" : `${fecha} · Ocurrió ✓`;
    case "previsto":
      return `${fecha ?? "—"} · Previsto${h.igual_a_ingreso_cd ? " (igual al Ingreso CD)" : ""}`;
    case "por_confirmar":
      return `${fecha ?? "—"} · Llegó, falta confirmar el ingreso`;
    case "vencido": {
      const atraso = h.fecha === null ? 0 : Math.max(1, diasEntre(h.fecha, hoy));
      return `${fecha ?? "—"} · Debía ocurrir hace ${dias(atraso)}`;
    }
  }
}

/** Mes de un tramo «Sin embarque» o de un ingreso en pantalla: «dic-26, sin embarque». */
export const textoMesTramo = (t: Pick<TramoLineaTiempoApi, "embarque" | "mes">): string => `${etiquetaMes(t.mes)}${t.embarque === null ? ", sin embarque" : ""}`;

/** Estado de un hito en texto de Excel (§3.8): «Pendiente», «Previsto», «Ocurrió», «Vencido», «Por confirmar», «Ocurrió sin fecha», «No aplica». */
export const TEXTO_ESTADO_HITO_EXCEL: Record<EstadoHito, string> = {
  real: "Ocurrió",
  sin_registrar: "Ocurrió sin fecha",
  vencido: "Vencido",
  por_confirmar: "Por confirmar",
  previsto: "Previsto",
  pendiente: "Pendiente",
  no_aplica: "No aplica",
};

// ─── Avisos de la lista (§3.5) ───

const FRASE_VENCIDO: Record<Exclude<Hito, "orden_compra" | "ingreso_stock">, [string, string]> = {
  zarpe: ["zarpar", "zarpó"],
  arribo: ["arribar a puerto", "arribó"],
  ingreso_cd: ["ingresar al CD", "ingresó"],
  inicio_operativo: ["iniciar la operación", "empezó"],
};

/**
 * Avisos de los hitos de un embarque en la lista: `hito_vencido` por cada hito `vencido` salvo el ingreso al stock, y `atrasado` si el que
 * está `vencido` es el ingreso al stock (no sale si está `por_confirmar`). «Debía arribar a puerto el 08-nov (hace 4 días): ¿ya arribó?».
 */
export function avisosDeHitos(hitos: readonly HitoApi[], hoy: string): AvisoDetalleApi[] {
  const salida: AvisoDetalleApi[] = [];
  for (const h of hitos) {
    if (h.estado !== "vencido" || h.fecha === null) continue;
    if (h.hito === "ingreso_stock") {
      salida.push({ aviso: "atrasado", detalle: `El ingreso al stock debía ocurrir el ${etiquetaDiaMes(h.fecha)} (hace ${dias(Math.max(1, diasEntre(h.fecha, hoy)))}).` });
      continue;
    }
    if (h.hito === "orden_compra") continue;
    const [verbo, pregunta] = FRASE_VENCIDO[h.hito];
    salida.push({ aviso: "hito_vencido", detalle: `Debía ${verbo} el ${etiquetaDiaMes(h.fecha)} (hace ${dias(Math.max(1, diasEntre(h.fecha, hoy)))}): ¿ya ${pregunta}?` });
  }
  return salida;
}
