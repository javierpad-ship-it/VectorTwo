import { createHash } from "node:crypto";
import type { TiendaMaestro } from "./tipos";

/**
 * Huellas de obsolescencia (docs/modulos/06-curvas-estacionalidad.md, "Curvas
 * vivas" y regla 22). Cada curva guarda con qué composición, red y cargas se
 * calculó; `GET /api/curvas` compara con el estado actual. md5 hexadecimal:
 * sirve para detectar cambios, no es criptografía.
 */

const md5 = (texto: string) => createHash("md5").update(texto).digest("hex");

/** md5 de los ids de las equivalencias activas de la agrupación, ordenados (no depende del orden de entrada). */
export function huellaComposicion(idsEquivalencias: Iterable<string>): string {
  return md5([...idsEquivalencias].sort().join("\n"));
}

/**
 * md5 del maestro de tiendas: id, tipo, activo, `fecha_apertura` y `fecha_cierre`,
 * ordenado por id. Cambia si cambia una fecha de apertura, un cierre, `activo` o
 * `tipo`; el nombre y el código no cuentan.
 */
export function huellaRed(tiendas: readonly Pick<TiendaMaestro, "id" | "tipo" | "activo" | "fecha_apertura" | "fecha_cierre">[]): string {
  const lineas = [...tiendas]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((t) => [t.id, t.tipo, t.activo ? "1" : "0", t.fecha_apertura?.slice(0, 10) ?? "", t.fecha_cierre?.slice(0, 10) ?? ""].join("|"));
  return md5(lineas.join("\n"));
}

/** md5 de `{ "aaaa-mm": carga_id }`: cambia si cambia un `carga_id` o entra o sale un mes. */
export function huellaCargas(cargas: Readonly<Record<string, string>>): string {
  const lineas = Object.keys(cargas)
    .sort()
    .map((mes) => `${mes}=${cargas[mes]}`);
  return md5(lineas.join("\n"));
}
