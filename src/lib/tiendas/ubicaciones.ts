import type { Tables } from "@/lib/supabase/database.types";
import { normalizarNombre } from "@/lib/arbol/normalizar";
import type { UbicacionIgnoradaApi } from "./tipos-api";

/**
 * Lógica pura de las ubicaciones ignoradas (M5c,
 * docs/modulos/05c-ubicaciones-conciliacion.md). Sin acceso a la base: los
 * handlers y los tests le pasan filas ya leídas.
 *
 * Regla de resolución: la tienda manda. El resolutor de M5 busca tienda por
 * nombre, tienda por código y solo después aquí; si existe una tienda (activa o
 * desactivada) con el mismo nombre normalizado, la fila queda "sin efecto".
 */

export type UbicacionIgnoradaFila = Pick<
  Tables<"ubicaciones_ignoradas">,
  "id" | "nombre" | "nota" | "activo" | "created_at" | "updated_at"
>;

/** Lo mínimo de una tienda para comparar nombres. */
export type TiendaNombrada = Pick<Tables<"tiendas">, "id" | "codigo" | "nombre" | "activo">;

/** Nombre normalizado → `{ id, nota }`. Lo consume `crearResolutorTiendas`. */
export type UbicacionesIgnoradasIndice = ReadonlyMap<string, { id: string; nota: string | null }>;

/**
 * Índice para el resolutor. Una fila con `activo = false` (solo desde el SQL
 * Editor) se lee como si no existiera. El nombre se normaliza otra vez por si
 * la fila se escribió a mano.
 */
export function indiceUbicacionesIgnoradas(
  filas: readonly Pick<UbicacionIgnoradaFila, "id" | "nombre" | "nota" | "activo">[]
): UbicacionesIgnoradasIndice {
  const indice = new Map<string, { id: string; nota: string | null }>();
  for (const f of filas) {
    if (!f.activo) continue;
    const nombre = normalizarNombre(f.nombre);
    if (nombre !== "") indice.set(nombre, { id: f.id, nota: f.nota });
  }
  return indice;
}

/** Tienda (activa o no) con el mismo nombre normalizado, o `null`. Solo por nombre, no por código. */
export function tiendaConNombre(nombre: string, tiendas: readonly TiendaNombrada[]): TiendaNombrada | null {
  const buscado = normalizarNombre(nombre);
  if (buscado === "") return null;
  return tiendas.find((t) => normalizarNombre(t.nombre) === buscado) ?? null;
}

/** Regla 3. La tienda con el mismo nombre normalizado, en la forma de `UbicacionIgnoradaApi.sin_efecto`, o `null`. */
export function sinEfecto(
  ubicacion: Pick<UbicacionIgnoradaFila, "nombre">,
  tiendas: readonly TiendaNombrada[]
): UbicacionIgnoradaApi["sin_efecto"] {
  const t = tiendaConNombre(ubicacion.nombre, tiendas);
  return t ? { tienda_id: t.id, codigo: t.codigo, activo: t.activo } : null;
}

/** Regla 3. Mensaje del `409 nombre_es_tienda` solo si hay una tienda con ese nombre; si no, `null`. */
export function rechazoCrearUbicacion(nombre: string, tiendas: readonly TiendaNombrada[]): string | null {
  const t = tiendaConNombre(nombre, tiendas);
  return t ? `Ya existe la tienda ${t.codigo} con ese nombre. Si no debe cargarse, desactívala en Tiendas.` : null;
}

/** Fila de la base → forma de red. `sin_efecto` se calcula contra las tiendas (`null` si no se pasan). */
export function aUbicacionIgnoradaApi(
  fila: UbicacionIgnoradaFila,
  tiendas: readonly TiendaNombrada[] = []
): UbicacionIgnoradaApi {
  return {
    id: fila.id,
    nombre: fila.nombre,
    nota: fila.nota,
    created_at: fila.created_at,
    updated_at: fila.updated_at,
    sin_efecto: sinEfecto(fila, tiendas),
  };
}

export const MENSAJE_UBICACION_NO_ENCONTRADA = "Ubicación no encontrada.";
