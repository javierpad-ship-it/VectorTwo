/**
 * Lógica pura de «Programar lo al barrer» y de «Mover a paquete» (ficha 08b-1b §2.5, §4.5; F10, F11). Sin React y sin reloj. La decisión
 * final siempre es del servidor (`POST /api/compras/embarques/[id]/paquete`); esto solo arma el cuerpo, adelanta si el movimiento cambia de
 * mes (para saber si pide vista previa, motivo y causa) y traduce cada código de error a una frase llana.
 */
import { MAX_NOMBRE_AGRUPADOR } from "@/lib/compras/agrupadores/tipos";
import type { MoverAPaquete } from "@/lib/compras/agrupadores/esquemas";
import {
  ETIQUETA_AVISO_AGRUPADOR,
  type AsignacionApi,
  type AvisoDetalleApi,
  type CausaFecha,
  type EmbarqueDetalleApi,
  type PaqueteApi,
  type PlanMovimientoApi,
} from "@/lib/compras/agrupadores/tipos-api";
import { etiquetaDiaMes, etiquetaMes } from "@/lib/compras/agrupadores/fechas";
import { unidades } from "../formato";
import { textoErrorAccion } from "./vista-errores";

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

// ─── Lo que está al barrer ───

/** Un lote al barrer activo (no histórico): lo que «Programar lo al barrer» puede repartir en tandas. */
export const esLoteAlBarrer = (a: Pick<AsignacionApi, "historica" | "linea">): boolean => !a.historica && (a.linea.tipo === "barrer_marca" || a.linea.tipo === "barrer_mezcla");

export const lotesAlBarrer = (e: Pick<EmbarqueDetalleApi, "asignaciones">): AsignacionApi[] => e.asignaciones.filter(esLoteAlBarrer);

/** El piso del ingreso propio de un paquete: el ingreso real del embarque si ya llegó, si no su Ingreso CD (§2.5). */
export const pisoDelEmbarque = (e: Pick<EmbarqueDetalleApi, "fecha_llegada_real" | "fecha_llegada_estimada">): string => e.fecha_llegada_real ?? e.fecha_llegada_estimada;

/** La fecha de ingreso al stock que hereda lo que no está en un paquete con ingreso propio; la propuesta de un paquete nuevo (nunca antes del piso). */
export function ingresoHeredado(e: Pick<EmbarqueDetalleApi, "fecha_llegada_real" | "fecha_llegada_estimada" | "fecha_ingreso_estimada">): string {
  const piso = pisoDelEmbarque(e);
  const h = e.fecha_llegada_real ?? e.fecha_ingreso_estimada ?? e.fecha_llegada_estimada;
  return h > piso ? h : piso;
}

/** `mesDeDestino` del lado de la pantalla: el mes del ingreso propio del paquete si lo tiene; si no, el del embarque. */
export const mesDeDestinoPantalla = (e: Pick<EmbarqueDetalleApi, "periodo_llegada">, p: Pick<PaqueteApi, "periodo_ingreso"> | null): string => p?.periodo_ingreso ?? e.periodo_llegada;

// ─── Unidades escritas ───

/** `null` = vacío (no mueve nada); un entero ≥ 0, o un texto de error. Acepta «1 000» y «1.000». */
export function leerUnidades(texto: string | undefined): number | null | { error: string } {
  const t = (texto ?? "").trim().replace(/[\s.]/g, "");
  if (t === "") return null;
  if (!/^\d+$/.test(t)) return { error: "Escribe un número entero de unidades." };
  const n = Number(t);
  return Number.isSafeInteger(n) ? n : { error: "Ese número es demasiado grande." };
}

export type ItemTanda = { id: string; unidades: number };

/** Los ítems de una tanda: lo escrito por asignación, descartando vacíos y ceros. `error` es el primer texto que no se entiende. */
export function itemsDeTanda(escritas: Readonly<Record<string, string>>, lotes: readonly Pick<AsignacionApi, "id">[]): { items: ItemTanda[]; error: string | null } {
  const items: ItemTanda[] = [];
  let error: string | null = null;
  for (const l of lotes) {
    const v = leerUnidades(escritas[l.id]);
    if (v === null) continue;
    if (typeof v === "object") {
      error ??= v.error;
      continue;
    }
    if (v > 0) items.push({ id: l.id, unidades: v });
  }
  return { items, error };
}

/** `[id | {id, unidades}]` del cuerpo: la asignación entera va como `id`; una parte, con sus unidades. */
export function asignacionesDelCuerpo(items: readonly ItemTanda[], asignaciones: readonly Pick<AsignacionApi, "id" | "unidades">[]): MoverAPaquete["asignaciones"] {
  return items.map((i) => (asignaciones.find((a) => a.id === i.id)?.unidades === i.unidades ? i.id : { id: i.id, unidades: i.unidades }));
}

/** ¿Este movimiento cambia de mes? Misma regla del servidor: alguna asignación cuya entrega no está en el mes de destino (y no está ya en ese paquete). */
export function cambiaDeMes(items: readonly ItemTanda[], asignaciones: readonly Pick<AsignacionApi, "id" | "periodo" | "paquete_id">[], mesDestino: string, paqueteDestinoId: string | null): boolean {
  return items.some((i) => {
    const a = asignaciones.find((x) => x.id === i.id);
    return a !== undefined && a.paquete_id !== paqueteDestinoId && a.periodo !== mesDestino;
  });
}

/** Cuerpo de `POST …/paquete`; `motivo` y `causa` solo si la persona los escribió o eligió; la huella la pone la vista previa. */
export function cuerpoMoverAPaquete(a: {
  revision: number;
  paqueteId: string | null;
  items: readonly ItemTanda[];
  asignaciones: readonly Pick<AsignacionApi, "id" | "unidades">[];
  motivo: string;
  causa: CausaFecha | null;
}): MoverAPaquete {
  const m = a.motivo.trim();
  return {
    revision: a.revision,
    paquete_id: a.paqueteId,
    asignaciones: asignacionesDelCuerpo(a.items, a.asignaciones),
    ...(m === "" ? {} : { motivo: m }),
    ...(a.causa === null ? {} : { causa: a.causa }),
  };
}

// ─── Tandas de «Programar lo al barrer» ───

/** Una tanda: un paquete (existente o por crear con su ingreso propio) y las unidades de cada lote que van en él. */
export type TandaForm = {
  clave: string;
  /** `"nuevo"` o el id de un paquete abierto del embarque. */
  destino: string;
  /** `null` = sin tocar: se propone «Al barrer» (una tanda) o «Al barrer · tanda N». */
  nombre: string | null;
  fecha: string;
  /** Asignación → unidades escritas. */
  unidades: Record<string, string>;
  /** Un paquete nuevo ya creado por un intento anterior: el reintento no lo vuelve a crear (ni a fijar su ingreso si ya está fijado). */
  creado: { paqueteId: string; ingresoFijado: boolean } | null;
  /** Ya se movió: queda de solo lectura. `unidades` guarda lo que se movió. */
  aplicada: boolean;
};

export const DESTINO_NUEVO = "nuevo";

/** El nombre propuesto: «Al barrer» si es la única tanda; «Al barrer · tanda N» si hay varias. */
export const nombreSugerido = (indice: number, total: number): string => (total <= 1 ? "Al barrer" : `Al barrer · tanda ${indice + 1}`);

export const nombreDeTanda = (t: TandaForm, indice: number, total: number): string => (t.nombre === null ? nombreSugerido(indice, total) : t.nombre).trim();

export const paqueteDeTanda = (t: TandaForm, paquetes: readonly PaqueteApi[]): PaqueteApi | null => {
  const id = t.destino === DESTINO_NUEVO ? (t.creado?.paqueteId ?? null) : t.destino;
  return id === null ? null : (paquetes.find((p) => p.id === id) ?? null);
};

/** Una tanda en llano: «Tanda 1 · Al barrer · tanda 1». */
export const etiquetaTanda = (t: TandaForm, indice: number, total: number, paquetes: readonly PaqueteApi[]): string => {
  const p = paqueteDeTanda(t, paquetes);
  return `Tanda ${indice + 1} · ${p ? p.nombre : nombreDeTanda(t, indice, total)}`;
};

export const tandaInicial = (clave: string, lotes: readonly AsignacionApi[], fecha: string, conTodo: boolean): TandaForm => ({
  clave,
  destino: DESTINO_NUEVO,
  nombre: null,
  fecha,
  unidades: conTodo ? Object.fromEntries(lotes.map((l) => [l.id, String(l.unidades)])) : {},
  creado: null,
  aplicada: false,
});

/** Mes (`aaaa-mm`) en el que quedarían las unidades de una tanda pendiente, con lo que se sabe antes de crear el paquete. */
export function mesDeTanda(t: TandaForm, e: Pick<EmbarqueDetalleApi, "periodo_llegada" | "paquetes">): string | null {
  const p = paqueteDeTanda(t, e.paquetes);
  if (p) return mesDeDestinoPantalla(e, p);
  if (t.destino === DESTINO_NUEVO) return FECHA.test(t.fecha) ? t.fecha.slice(0, 7) : null;
  return null;
}

/** Marca de «un paquete que todavía no existe»: ninguna asignación está ya en él, así que todo lo que se mueva ahí cambia de paquete. */
const PAQUETE_POR_CREAR = "(paquete por crear)";

/**
 * ¿Lo que mueve esta tanda cambia de mes? Con el paquete que ya existe, el mes de su ingreso propio (o el del embarque); con uno por crear, el
 * mes de la fecha elegida. Misma regla del servidor (`cambiaDeMes`), pero un paquete por crear nunca es el paquete en el que ya está algo.
 */
export function tandaCambiaDeMes(t: TandaForm, items: readonly ItemTanda[], e: Pick<EmbarqueDetalleApi, "periodo_llegada" | "paquetes" | "asignaciones">): boolean {
  const mes = mesDeTanda(t, e);
  if (mes === null) return false;
  const p = paqueteDeTanda(t, e.paquetes);
  return cambiaDeMes(items, e.asignaciones, mes, p?.id ?? (t.destino === DESTINO_NUEVO ? PAQUETE_POR_CREAR : null));
}

/** ¿La tanda (con paquete ya existente o por crear) pide motivo y causa? Un paquete por crear siempre (fijar su ingreso es reprogramar); uno existente, si cambia de mes. */
export function tandaPideMotivo(t: TandaForm, items: readonly ItemTanda[], e: Pick<EmbarqueDetalleApi, "periodo_llegada" | "paquetes" | "asignaciones">): boolean {
  if (t.aplicada) return false;
  if (t.destino === DESTINO_NUEVO && !(t.creado?.ingresoFijado ?? false)) return true;
  return tandaCambiaDeMes(t, items, e);
}

export type ValidacionTandas = {
  /** Un texto por problema, para el resumen; vacío = se puede previsualizar. */
  errores: string[];
  /** Errores por tanda (su clave), para pintarlos junto a ella. */
  porTanda: Record<string, string[]>;
  /** Ítems por tanda pendiente. */
  items: Record<string, ItemTanda[]>;
};

/**
 * Valida las tandas pendientes: cada una con paquete (nombre y fecha si es nuevo), unidades enteras, algo que mover, nadie repite paquete y
 * ningún lote reparte más de lo que tiene. `lotes` trae lo que cada lote tiene AHORA (después de las tandas ya aplicadas).
 */
export function validarTandas(tandas: readonly TandaForm[], lotes: readonly AsignacionApi[], e: Pick<EmbarqueDetalleApi, "paquetes" | "fecha_llegada_real" | "fecha_llegada_estimada">): ValidacionTandas {
  const errores: string[] = [];
  const porTanda: Record<string, string[]> = {};
  const items: Record<string, ItemTanda[]> = {};
  const piso = pisoDelEmbarque(e);
  const total = tandas.length;
  const mal = (t: TandaForm, i: number, texto: string) => {
    (porTanda[t.clave] ??= []).push(texto);
    errores.push(`Tanda ${i + 1}: ${texto}`);
  };
  const nombresNuevos = new Set<string>();
  const destinosUsados = new Set<string>();
  const sumaPorLote = new Map<string, number>();
  let pendientes = 0;
  tandas.forEach((t, i) => {
    if (t.aplicada) return;
    pendientes += 1;
    const r = itemsDeTanda(t.unidades, lotes);
    items[t.clave] = r.items;
    if (r.error) mal(t, i, r.error);
    else if (r.items.length === 0) mal(t, i, "escribe las unidades de al menos un lote.");
    for (const it of r.items) sumaPorLote.set(it.id, (sumaPorLote.get(it.id) ?? 0) + it.unidades);
    if (t.destino === DESTINO_NUEVO && t.creado === null) {
      const nombre = nombreDeTanda(t, i, total);
      const repetido = nombresNuevos.has(nombre.toLowerCase()) || e.paquetes.some((p) => p.estado === "abierto" && p.nombre.trim().toLowerCase() === nombre.toLowerCase());
      if (nombre === "") mal(t, i, "ponle un nombre al paquete.");
      else if (nombre.length > MAX_NOMBRE_AGRUPADOR) mal(t, i, `el nombre no puede superar ${MAX_NOMBRE_AGRUPADOR} caracteres.`);
      else if (repetido) mal(t, i, `ya hay un paquete llamado «${nombre}»: usa otro nombre o elige ese paquete.`);
      nombresNuevos.add(nombre.toLowerCase());
      if (!FECHA.test(t.fecha)) mal(t, i, "elige la fecha de ingreso al stock del paquete.");
      else if (t.fecha < piso) mal(t, i, `el ingreso no puede ser antes de la llegada del embarque (${etiquetaDiaMes(piso)}).`);
    } else {
      const id = t.destino === DESTINO_NUEVO ? (t.creado?.paqueteId ?? "") : t.destino;
      if (id === "") mal(t, i, "elige el paquete.");
      else if (destinosUsados.has(id)) mal(t, i, "otra tanda ya va a ese paquete: junta sus unidades en una sola.");
      destinosUsados.add(id);
    }
  });
  if (pendientes === 0) errores.push("No queda ninguna tanda por aplicar.");
  for (const [id, suma] of sumaPorLote) {
    const l = lotes.find((x) => x.id === id);
    if (l && suma > l.unidades) errores.push(`${l.compra.numero}: repartes ${unidades(suma)} u y el lote tiene ${unidades(l.unidades)} u.`);
  }
  return { errores, porTanda, items };
}

/** «Asignado 1 000 de 1 000 u»: lo aplicado y lo escrito en las tandas, contra lo que había al abrir (por lote y en total). */
export function resumenAsignado(totales: ReadonlyMap<string, number>, tandas: readonly TandaForm[]): { asignado: number; total: number; porLote: Map<string, { asignado: number; total: number }> } {
  const porLote = new Map<string, { asignado: number; total: number }>();
  let asignado = 0;
  let total = 0;
  for (const [id, t] of totales) {
    let a = 0;
    for (const tanda of tandas) {
      const v = leerUnidades(tanda.unidades[id]);
      if (typeof v === "number") a += v;
    }
    porLote.set(id, { asignado: a, total: t });
    asignado += a;
    total += t;
  }
  return { asignado, total, porLote };
}

/** Las unidades que escribió una tanda (sumando lo legible). */
export const unidadesEscritas = (t: Pick<TandaForm, "unidades">): number =>
  Object.values(t.unidades).reduce<number>((a, v) => {
    const n = leerUnidades(v);
    return a + (typeof n === "number" ? n : 0);
  }, 0);

export const textoAsignado = (asignado: number, total: number): string => `Asignado ${unidades(asignado)} de ${unidades(total)} u`;

// ─── Vista previa: lo que se mueve, en llano ───

/** Los meses que se mueven según el plan: «mar-27 → abr-27: 600 u», sumando las unidades de cada par. */
export function mesesDelPlan(plan: Pick<PlanMovimientoApi, "movimientos">): { de: string; a: string; unidades: number }[] {
  const acc = new Map<string, { de: string; a: string; unidades: number }>();
  for (const m of plan.movimientos) {
    if (m.de.periodo === m.a.periodo) continue;
    const k = `${m.de.periodo}|${m.a.periodo}`;
    const x = acc.get(k) ?? { de: m.de.periodo, a: m.a.periodo, unidades: 0 };
    x.unidades += m.unidades;
    acc.set(k, x);
  }
  return [...acc.values()].sort((x, y) => (x.de + x.a < y.de + y.a ? -1 : 1));
}

export const textoMesesDelPlan = (meses: readonly { de: string; a: string; unidades: number }[]): string[] => meses.map((m) => `${etiquetaMes(m.de)} → ${etiquetaMes(m.a)}: ${unidades(m.unidades)} u`);

export const planCambiaDeMes = (plan: Pick<PlanMovimientoApi, "movimientos">): boolean => plan.movimientos.some((m) => m.de.periodo !== m.a.periodo);

const avisosDe = (plan: Pick<PlanMovimientoApi, "avisos">, aviso: AvisoDetalleApi["aviso"]): AvisoDetalleApi[] => plan.avisos.filter((a) => a.aviso === aviso);

/**
 * Lo que la vista previa dice además de la frase del plan, en llano: el mes que se mueve, los lotes que cambian de temporada (se reparten de
 * nuevo con la temporada del mes), las entregas que se funden y los paquetes subidos a la llegada. Cada frase es una línea.
 */
export function frasesDelPlan(plan: Pick<PlanMovimientoApi, "movimientos" | "avisos">): { meses: string[]; temporada: string[]; fusion: string[]; ajuste: string[]; sinCambioDeMes: boolean } {
  const meses = mesesDelPlan(plan);
  const temporada = avisosDe(plan, "cambia_temporada");
  const texto = (a: AvisoDetalleApi) => (a.detalle && a.detalle.trim() !== "" ? a.detalle : ETIQUETA_AVISO_AGRUPADOR[a.aviso]);
  return {
    meses: textoMesesDelPlan(meses),
    // El detalle de cada lote («Lote · MARCA: verano → invierno») sale en la lista de avisos de la vista previa; aquí va qué significa.
    temporada: temporada.length === 0 ? [] : [`${temporada.length === 1 ? "1 lote cambia" : `${temporada.length} lotes cambian`} de temporada: se vuelve a repartir con la temporada del mes nuevo.`],
    fusion: avisosDe(plan, "entregas_fusionadas").map((a) => `Se funden entregas del mismo mes: ${texto(a)}`),
    ajuste: avisosDe(plan, "ingreso_paquete_ajustado").map(texto),
    sinCambioDeMes: meses.length === 0,
  };
}

// ─── Errores en español llano ───

/** El texto de cada código de `POST …/paquete` (y de crear el paquete o fijar su ingreso). El resto cae en el mensaje del servidor. */
const TEXTO_ERROR_BARRER: Record<string, string> = {
  paquete_de_otro_embarque: "Ese paquete es de otro embarque: elige uno de este embarque.",
  embarque_no_editable: "El embarque está cancelado o recibido: ya no se puede programar mercadería en él.",
  agrupador_cambio: "Otra persona cambió este embarque mientras lo mirabas. Ya lo volvimos a leer: revisa lo que se muestra y repite la acción.",
  no_editable: "Ese paquete está cancelado: elige otro o crea uno nuevo.",
  asignacion_con_recepciones: "Parte de esa mercadería ya tiene ingresos confirmados y no se puede mover a otro mes.",
  excede_entrega: "Las unidades superan lo que tiene ese lote. Ya lo volvimos a leer: corrige las cantidades.",
  compra_cambio: "Otra persona cambió una de las compras mientras mirabas. Ya la volvimos a leer: vuelve a ver la vista previa.",
  plan_cambio: "Lo que ibas a mover cambió desde la vista previa. Vuelve a ver la vista previa antes de aplicar.",
  motivo_requerido: "Escribe el motivo: mover a otro mes lo pide.",
  causa_requerida: "Elige la causa: mover a otro mes la pide.",
  reparto_sin_vector: "Ese lote no tiene reparto para la temporada del mes nuevo, así que no se movió nada. Pide a Planificación que complete el reparto de la marca.",
  no_pertenece: "Esa mercadería o ese paquete ya no es de este embarque. Ya lo volvimos a leer: revisa y repite la acción.",
};

/** Texto de un error de la API en estas pantallas; con `prefijo` (p. ej. «Tanda 2») lo antepone. */
export function textoErrorBarrer(e: { mensaje: string; codigo: string | null }, prefijo?: string): string {
  const t = e.codigo !== null && e.codigo in TEXTO_ERROR_BARRER ? TEXTO_ERROR_BARRER[e.codigo] : textoErrorAccion(e);
  return prefijo ? `${prefijo}: ${t}` : t;
}

export const CODIGOS_ERROR_BARRER: readonly string[] = Object.keys(TEXTO_ERROR_BARRER);
