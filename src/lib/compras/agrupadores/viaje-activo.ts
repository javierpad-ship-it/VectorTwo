import type { ViajeRegistro } from "./tipos";

/**
 * Viaje activo (ficha 08b, §3.8, R22, decisión 81): el papel de `campaigns` de COTV. Puro y sin reloj.
 *
 *  - Vive por NAVEGADOR en la cookie `v2_viaje_activo` (`path=/`, `sameSite=lax`, un año, sin `httpOnly`: no es secreta). La escribe
 *    solo `PUT /api/compras/viaje-activo`.
 *  - Las páginas de servidor de Compras y de Viajes y embarques la leen con `cookies()`, validan formato y existencia con
 *    `resolverViajeActivo` y pasan el valor inicial al cliente. Una cookie inválida o de un viaje cancelado se trata como ausente.
 *  - NUNCA la lee una ruta de la API (reciben `viaje_id` explícito) y no da ni quita permisos.
 *  - Por defecto: el último viaje `abierto` (por `fecha_inicio`) del que el usuario es responsable; si no tiene, «todos».
 *  - Filtra Compras, Viajes y embarques y Sin agrupador; NO filtra Huecos ni Flujo (decisión 2: el viaje es contexto, no presupuesto).
 */

export const COOKIE_VIAJE_ACTIVO = "v2_viaje_activo";
export const MAX_EDAD_COOKIE_VIAJE_ACTIVO = 60 * 60 * 24 * 365;

/** Opciones de `Set-Cookie` de la cookie del viaje activo (sin `httpOnly`; `secure` lo decide el entorno). */
export const OPCIONES_COOKIE_VIAJE_ACTIVO = { path: "/", sameSite: "lax", maxAge: MAX_EDAD_COOKIE_VIAJE_ACTIVO, httpOnly: false } as const;

export const VIAJE_ACTIVO_TODOS = "todos";
export const VIAJE_ACTIVO_SIN_VIAJE = "sin_viaje";

const FORMATO_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `true` si el texto es `todos`, `sin_viaje` o tiene forma de uuid (no mira que el viaje exista). */
export const esValorViajeActivo = (valor: unknown): valor is string =>
  typeof valor === "string" && (valor === VIAJE_ACTIVO_TODOS || valor === VIAJE_ACTIVO_SIN_VIAJE || FORMATO_UUID.test(valor));

/** Lo mínimo de un viaje para decidir el viaje activo. */
export type ViajeParaActivo = Pick<ViajeRegistro, "id" | "estado" | "fecha_inicio" | "responsable_id">;

const comparar = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Valor de la cookie ya validado contra los viajes existentes: `todos` y `sin_viaje` valen siempre; un uuid vale si es de un viaje
 * que existe y no está cancelado (uno cerrado vale: se eligió a propósito). Cualquier otra cosa → `null` (ausente).
 */
export function validarViajeActivo(valor: string | null | undefined, viajes: readonly ViajeParaActivo[]): string | null {
  if (!esValorViajeActivo(valor)) return null;
  if (valor === VIAJE_ACTIVO_TODOS || valor === VIAJE_ACTIVO_SIN_VIAJE) return valor;
  const id = valor.toLowerCase();
  const viaje = viajes.find((v) => v.id.toLowerCase() === id);
  return viaje && viaje.estado !== "cancelado" ? viaje.id : null;
}

/** Por defecto: el último viaje `abierto` (por `fecha_inicio`, y a igualdad por id) del que `perfilId` es responsable; si no, `todos`. */
export function viajeActivoPorDefecto(viajes: readonly ViajeParaActivo[], perfilId: string | null): string {
  if (perfilId === null) return VIAJE_ACTIVO_TODOS;
  const suyos = viajes.filter((v) => v.estado === "abierto" && v.responsable_id === perfilId).sort((a, b) => comparar(b.fecha_inicio, a.fecha_inicio) || comparar(b.id, a.id));
  return suyos[0]?.id ?? VIAJE_ACTIVO_TODOS;
}

/** Valor con que arranca la pantalla: la cookie si es válida; si no, el valor por defecto. Una cookie basura se ignora (R22). */
export function resolverViajeActivo(cookie: string | null | undefined, viajes: readonly ViajeParaActivo[], perfilId: string | null): string {
  return validarViajeActivo(cookie, viajes) ?? viajeActivoPorDefecto(viajes, perfilId);
}

/** Filtro de la lista según el viaje activo: `todos` no filtra; `sin_viaje` pide los locales; un uuid, ese viaje. */
export type FiltroViajeActivo = { viaje_id?: string };

/** `viaje_id` de los query strings (`?viaje_id=<uuid>|sin_viaje`); `todos` no manda nada. */
export function filtroDeViajeActivo(valor: string): FiltroViajeActivo {
  return valor === VIAJE_ACTIVO_TODOS ? {} : { viaje_id: valor };
}

// ─── Selectores: los cerrados van al final y marcados «(cerrado)» ───

export type ViajeParaSelector = { id: string; codigo: string; nombre: string; estado: ViajeRegistro["estado"]; fecha_inicio: string };

/** «Viaje 261001 · Feria Sur · oct-2026» → texto de una opción; los cerrados llevan « (cerrado)». */
export const etiquetaViajeSelector = (v: Pick<ViajeParaSelector, "codigo" | "nombre" | "estado">): string =>
  `${v.codigo} · ${v.nombre}${v.estado === "cerrado" ? " (cerrado)" : ""}`;

/**
 * Viajes para un selector: abiertos primero y cerrados al final (más reciente primero dentro de cada grupo); los cancelados no
 * se ofrecen. No modifica la lista recibida.
 */
export function ordenarViajesParaSelector<T extends ViajeParaSelector>(viajes: readonly T[]): T[] {
  const rango = (e: ViajeParaSelector["estado"]) => (e === "abierto" ? 0 : 1);
  return viajes
    .filter((v) => v.estado !== "cancelado")
    .sort((a, b) => rango(a.estado) - rango(b.estado) || comparar(b.fecha_inicio, a.fecha_inicio) || comparar(a.codigo, b.codigo));
}
