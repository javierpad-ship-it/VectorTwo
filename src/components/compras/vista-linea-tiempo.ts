import { diasEntre, etiquetaDiaMes, etiquetaFecha, etiquetaMes } from "@/lib/compras/agrupadores/fechas";
import { ETIQUETA_HITO, MARCADOR_HITO, type EstadoHito, type HitoApi, type ProximoHitoApi, type TramoLineaTiempoApi } from "@/lib/compras/agrupadores/tipos-api";
import type { ProximoHitoCompraApi } from "@/lib/compras/tipos-api";
import { unidades } from "./formato";

/**
 * Presentación de la línea de tiempo de una compra y de su próximo hito (ficha 08b-1b §4). Puro y sin React: el reloj entra como `hoy`
 * (`aaaa-mm-dd`, hora de Lima) y, sin él, se omite el «hace N días». El estado SIEMPRE se escribe en texto; el color del marcador y de la
 * insignia es un refuerzo, nunca la única señal.
 */

/** El estado en una o dos palabras, como lo nombra la ficha: «Real», «Previsto», «Vencido», «Por confirmar», «Pendiente». */
export const TEXTO_ESTADO_HITO: Record<EstadoHito, string> = {
  real: "Real ✓",
  sin_registrar: "Ocurrió, sin fecha",
  vencido: "Vencido",
  por_confirmar: "Por confirmar",
  previsto: "Previsto",
  pendiente: "Pendiente",
  no_aplica: "No aplica",
};

/** Qué significa cada estado, para el `title` de la insignia. */
export const AYUDA_ESTADO_HITO: Record<EstadoHito, string> = {
  real: "Real: ya ocurrió y tiene fecha registrada",
  sin_registrar: "Ya ocurrió, pero nadie registró la fecha",
  vencido: "Debía ocurrir y todavía no figura como ocurrido",
  por_confirmar: "La mercadería llegó, falta confirmar el ingreso al stock",
  previsto: "Tiene fecha estimada y todavía no llega",
  pendiente: "Todavía sin fecha",
  no_aplica: "No corresponde a este tramo",
};

export type TonoHito = "marca" | "exito" | "alerta" | "neutro";

export const TONO_ESTADO_HITO: Record<EstadoHito, TonoHito> = {
  real: "exito",
  sin_registrar: "neutro",
  vencido: "alerta",
  por_confirmar: "alerta",
  previsto: "marca",
  pendiente: "neutro",
  no_aplica: "neutro",
};

export const nombreHito = (h: Pick<HitoApi, "hito">): string => ETIQUETA_HITO[h.hito];
export const marcadorHito = (h: Pick<HitoApi, "hito">): string => MARCADOR_HITO[h.hito];

/** `02/11/2026`, con la hora en el inicio operativo (`02/11/2026 09:22`); `null` si el hito no tiene fecha. */
export function fechaDeHito(h: Pick<HitoApi, "fecha" | "hora">): string | null {
  if (h.fecha === null) return null;
  return `${etiquetaFecha(h.fecha)}${h.hora ? ` ${h.hora}` : ""}`;
}

const dias = (n: number) => `${n} día${n === 1 ? "" : "s"}`;

/** «+10 d · 2 cambios»: cuánto se atrasó la fecha y cuántas veces se reprogramó (solo causas que cuentan). `null` si no cambió. */
export function textoCambiosHito(h: Pick<HitoApi, "retraso_dias" | "reprogramaciones">): string | null {
  const partes: string[] = [];
  if (h.retraso_dias !== null && h.retraso_dias !== 0) partes.push(`${h.retraso_dias > 0 ? "+" : "−"}${Math.abs(h.retraso_dias)} d`);
  if (h.reprogramaciones > 0) partes.push(h.reprogramaciones === 1 ? "1 cambio" : `${h.reprogramaciones} cambios`);
  return partes.length === 0 ? null : partes.join(" · ");
}

/** Notas bajo la fecha de un hito: cuánto vencido, de quién es la fecha y cuál era la original. Cada nota es una frase corta. */
export function notasDeHito(h: HitoApi, hoy?: string): string[] {
  const notas: string[] = [];
  if (h.estado === "vencido" && h.fecha !== null && hoy !== undefined) notas.push(`Debía ocurrir hace ${dias(Math.max(1, diasEntre(h.fecha, hoy)))}`);
  if (h.estado === "por_confirmar") notas.push("Llegó, falta confirmar el ingreso");
  if (h.igual_a_ingreso_cd) notas.push("Igual al Ingreso CD");
  if (h.del_paquete) notas.push(`Del paquete ${h.del_paquete.codigo}${h.del_paquete.nombre ? ` · ${h.del_paquete.nombre}` : ""}`);
  if (h.fecha_original !== null && h.fecha !== null && h.fecha_original.slice(0, 10) !== h.fecha.slice(0, 10)) notas.push(`Era ${etiquetaFecha(h.fecha_original)}`);
  return notas;
}

/** La frase completa de un hito (para `aria-label` y pruebas): «Zarpe: 02/11/2026, Real». */
export function frasePorHito(h: HitoApi): string {
  const f = fechaDeHito(h);
  return `${nombreHito(h)}: ${f === null ? "" : `${f}, `}${TEXTO_ESTADO_HITO[h.estado]}`;
}

/** Título de un tramo: «Embarque 261101 · California · 300 u»; o «Sin embarque · dic-26 · 200 u». */
export function tituloTramo(t: TramoLineaTiempoApi): string {
  const u = `${unidades(t.unidades)} u`;
  if (t.embarque === null) return `Sin embarque · ${etiquetaMes(t.mes)} · ${u}`;
  const nombre = t.embarque.nombre && t.embarque.nombre !== t.embarque.codigo ? ` · ${t.embarque.nombre}` : "";
  return `Embarque ${t.embarque.codigo}${nombre} · ${u}`;
}

/** Subtítulo de un tramo: su paquete y el origen del embarque; vacío si no hay ninguno de los dos. */
export function detalleTramo(t: TramoLineaTiempoApi): string {
  const partes: string[] = [];
  if (t.paquete) partes.push(`Paquete ${t.paquete.codigo}${t.paquete.nombre ? ` · ${t.paquete.nombre}` : ""}`);
  if (t.embarque?.origen) partes.push(`Origen: ${t.embarque.origen}`);
  return partes.join(" · ");
}

export const claveTramo = (t: TramoLineaTiempoApi, i: number): string => `${t.embarque?.id ?? "sin"}|${t.paquete?.id ?? "-"}|${t.mes}|${i}`;

export type TextoProximoHito = {
  marcador: string;
  hito: string;
  /** `18-nov` (la lista es angosta); `fechaCompleta` es `18/11/2026` para el `title`. */
  fecha: string | null;
  fechaCompleta: string | null;
  /** «Previsto», «Vencido (hace 4 días)»… siempre en texto. */
  estado: string;
  tono: TonoHito;
  /** «+1 tramo» si la compra tiene más tramos abiertos. */
  mas: string | null;
  embarque: string | null;
};

/** El próximo hito para la lista: «🔴 Arribo · 18-nov · Previsto», con «+1 tramo»; `null` si no queda ningún hito pendiente. */
export function textoProximoHito(p: ProximoHitoApi | ProximoHitoCompraApi | null, hoy?: string): TextoProximoHito | null {
  if (p === null) return null;
  const mas = "tramos_mas" in p && p.tramos_mas > 0 ? `+${p.tramos_mas} tramo${p.tramos_mas === 1 ? "" : "s"}` : null;
  const atraso = p.estado === "vencido" && p.fecha !== null && hoy !== undefined ? ` (hace ${dias(Math.max(1, diasEntre(p.fecha, hoy)))})` : "";
  return {
    marcador: MARCADOR_HITO[p.hito],
    hito: ETIQUETA_HITO[p.hito],
    fecha: p.fecha === null ? null : `${etiquetaDiaMes(p.fecha)}${p.hora ? ` ${p.hora}` : ""}`,
    fechaCompleta: fechaDeHito(p),
    estado: `${TEXTO_ESTADO_HITO[p.estado]}${atraso}`,
    tono: TONO_ESTADO_HITO[p.estado],
    mas,
    embarque: "embarque_codigo" in p ? p.embarque_codigo : null,
  };
}

/** La línea de tiempo existe y tiene algún tramo (una compra cancelada o sin entregas puede no traerla). */
export const hayLineaDeTiempo = (tramos: readonly TramoLineaTiempoApi[] | undefined): tramos is TramoLineaTiempoApi[] => tramos !== undefined && tramos.length > 0;
