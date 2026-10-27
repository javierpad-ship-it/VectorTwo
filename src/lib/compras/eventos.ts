import { formatearNumero } from "@/lib/formato";
import { ACCIONES_EVENTO, MAX_MOTIVO_EVENTO, MAX_RESUMEN_EVENTO, type AccionEvento, type ActorCompra } from "./tipos";
import type { EventoCompraApi, PersonaFechaApi } from "./tipos-api";

/**
 * Auditoría de las compras (ficha 08, §5.11, regla 17b y decisión 28). `compra_eventos` es insert-only: en `0.13.0` lo escriben las
 * funciones SQL de `0025` dentro de la misma transacción que la operación (con `compra_foto` como `antes` y `despues`). Aquí vive la
 * parte pura: armar el evento con su forma estable (`evento`), ordenar el historial, resumir qué cambió (`resumenCambios`) y sacar de
 * los eventos quién creó, modificó y canceló (`creadaPor`, `modificadaPor`, `canceladaPor`).
 */

/** Una fila de `compra_eventos` lista para insertar (la función SQL la inserta; `0.13.1` la reutiliza). */
export type EventoNuevo = {
  compra_id: string;
  linea_id: string | null;
  accion: AccionEvento;
  antes: unknown | null;
  despues: unknown | null;
  motivo: string | null;
  resumen: string | null;
  perfil_id: string | null;
  usuario_nombre: string;
  created_at: string;
};

export type EntradaEvento = {
  compra_id: string;
  linea_id?: string | null;
  accion: AccionEvento;
  antes?: unknown | null;
  despues?: unknown | null;
  motivo?: string | null;
  resumen?: string | null;
  actor: ActorCompra;
  /** Instante ISO de la operación (entra como parámetro: nada de reloj aquí). */
  ahora: string;
};

const sinTexto = (v: string | null | undefined): string | null => {
  const t = (v ?? "").trim();
  return t === "" ? null : t;
};

/** Recorta con puntos suspensivos si pasa de `max`. */
export function recortar(texto: string, max: number): string {
  return texto.length <= max ? texto : `${texto.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/**
 * Arma el evento de una mutación. Lanza `RangeError` si la acción no existe o el motivo pasa de 300 caracteres (son errores de
 * quien llama: el motivo lo validan antes los esquemas). El `resumen` se recorta a 300 sin fallar. `antes` y `despues` son el objeto
 * afectado serializado: nulos si no existen (una creación no tiene `antes`).
 */
export function evento(e: EntradaEvento): EventoNuevo {
  if (!(ACCIONES_EVENTO as readonly string[]).includes(e.accion)) throw new RangeError(`Acción de evento desconocida: ${e.accion}`);
  const motivo = sinTexto(e.motivo);
  if (motivo !== null && motivo.length > MAX_MOTIVO_EVENTO) throw new RangeError(`El motivo no puede superar ${MAX_MOTIVO_EVENTO} caracteres.`);
  const resumen = sinTexto(e.resumen);
  return {
    compra_id: e.compra_id,
    linea_id: e.linea_id ?? null,
    accion: e.accion,
    antes: e.antes ?? null,
    despues: e.despues ?? null,
    motivo,
    resumen: resumen === null ? null : recortar(resumen, MAX_RESUMEN_EVENTO),
    perfil_id: e.actor.perfil_id,
    usuario_nombre: e.actor.nombre,
    created_at: e.ahora,
  };
}

/** El historial de una compra de más antiguo a más reciente (a igual instante, se respeta el orden de llegada). No muta la entrada. */
export function historial(eventos: readonly EventoCompraApi[]): EventoCompraApi[] {
  return eventos
    .map((e, i) => ({ e, i }))
    .sort((a, b) => (a.e.created_at < b.e.created_at ? -1 : a.e.created_at > b.e.created_at ? 1 : a.i - b.i))
    .map(({ e }) => e);
}

const ACCIONES_CREACION: readonly AccionEvento[] = ["crear", "importar"];

const persona = (e: EventoCompraApi): PersonaFechaApi => ({ nombre: e.usuario_nombre, at: e.created_at });

/** Quién creó la compra y cuándo: el primer evento (`crear` o `importar`); `null` si el historial está vacío. */
export function creadaPor(eventos: readonly EventoCompraApi[]): PersonaFechaApi | null {
  const orden = historial(eventos);
  return orden.length === 0 ? null : persona(orden[0]);
}

/**
 * Quién la modificó por última vez: el último evento, salvo que el único sea el de creación (entonces nadie la modificó: `null`).
 */
export function modificadaPor(eventos: readonly EventoCompraApi[]): PersonaFechaApi | null {
  const orden = historial(eventos);
  if (orden.length === 0) return null;
  if (orden.length === 1 && ACCIONES_CREACION.includes(orden[0].accion)) return null;
  return persona(orden[orden.length - 1]);
}

/** Quién canceló (o cerró el saldo) y con qué motivo: el último evento `cancelar`; `null` si no hubo. */
export function canceladaPor(eventos: readonly EventoCompraApi[]): (PersonaFechaApi & { motivo: string }) | null {
  const cancelaciones = historial(eventos).filter((e) => e.accion === "cancelar");
  const ultima = cancelaciones[cancelaciones.length - 1];
  return ultima ? { ...persona(ultima), motivo: ultima.motivo ?? "" } : null;
}

// ─── Resumen de cambios ───

const orden = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(orden);
  if (v !== null && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, x]) => [k, orden(x)]),
    );
  }
  return v;
};

/** Igualdad estructural (las claves de un objeto no tienen orden). */
export function sonIguales(a: unknown, b: unknown): boolean {
  return JSON.stringify(orden(a ?? null)) === JSON.stringify(orden(b ?? null));
}

function formatear(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "number") return Number.isInteger(v) ? formatearNumero(v) : String(v);
  if (typeof v === "boolean") return v ? "sí" : "no";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.length === 0 ? "—" : v.map(formatear).join(", ");
  return JSON.stringify(orden(v));
}

/**
 * Resumen de una línea de lo que cambió entre dos objetos planos (`antes` y `despues`): «unidades 500 → 600; destino cd → tienda».
 * Compara clave por clave (las anidadas, por igualdad estructural), en el orden de `despues` y luego las que solo estaban en
 * `antes`. `etiquetas` traduce una clave a su nombre en pantalla. Sin diferencias: «Sin cambios». Máximo 300 caracteres.
 */
export function resumenCambios(
  antes: Readonly<Record<string, unknown>> | null | undefined,
  despues: Readonly<Record<string, unknown>> | null | undefined,
  etiquetas: Readonly<Record<string, string>> = {},
): string {
  const a = antes ?? {};
  const d = despues ?? {};
  const claves = [...Object.keys(d), ...Object.keys(a).filter((k) => !(k in d))];
  const partes: string[] = [];
  for (const k of claves) {
    if (sonIguales(a[k], d[k])) continue;
    partes.push(`${etiquetas[k] ?? k} ${formatear(a[k])} → ${formatear(d[k])}`);
  }
  if (partes.length === 0) return "Sin cambios";
  return recortar(partes.join("; "), MAX_RESUMEN_EVENTO);
}
