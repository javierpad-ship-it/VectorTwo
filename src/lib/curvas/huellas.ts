import { createHash } from "node:crypto";
import { recortarPeriodo } from "@/lib/ventas/periodo";
import { periodoAplica, type PeriodoParaClase } from "./atipicos";
import { VERSION_MODELO } from "./modelo";
import type { ParametrosCurvas, TemporadaAgrupacion } from "./tipos-api";
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

// ─── 06b: huella de temporada y huella del cálculo ───

type AgrupacionParaHuella = { id: string; temporada: TemporadaAgrupacion; huella: string; activo?: boolean };

/**
 * Las agrupaciones que alimentan la curva `T` y el control del Niño de una
 * temporada: las ACTIVAS de esa temporada y las de `todo_el_ano` (el control).
 */
export function agrupacionesDeTemporada<T extends AgrupacionParaHuella>(temporada: TemporadaAgrupacion, agrupaciones: readonly T[]): T[] {
  return agrupaciones.filter((a) => a.activo !== false && (a.temporada === temporada || a.temporada === "todo_el_ano"));
}

/**
 * Huella de temporada (regla 34b): md5 de los tríos ordenados `(id, temporada,
 * huella de composición)`. Cubre lo que la huella de cálculo no cubría: `T` y el
 * control salen de las OTRAS agrupaciones, así que una composición movida o una
 * temporada cambiada en cualquiera de ellas cambia la entrada. Quien llama pasa las
 * de `agrupacionesDeTemporada`.
 */
export function huellaTemporada(agrupaciones: readonly AgrupacionParaHuella[]): string {
  const lineas = agrupaciones
    .map((a) => [a.id, a.temporada, a.huella].join("|"))
    .sort();
  return md5(lineas.join("\n"));
}

/** Parámetros en forma canónica (claves ordenadas; las listas ordenadas): no depende del orden en que llegaron. */
export function parametrosCanonicos(p: ParametrosCurvas): string {
  const claves = Object.keys(p).sort() as (keyof ParametrosCurvas)[];
  const salida: Record<string, unknown> = {};
  for (const k of claves) {
    const v = p[k];
    salida[k] = k === "anios_excluidos" ? [...(v as number[])].sort((a, b) => a - b) : k === "tiendas_excluidas" ? [...(v as string[])].sort() : v;
  }
  return JSON.stringify(salida);
}

export type PartesHuellaCalculo = {
  /** Por defecto `VERSION_MODELO`. */
  version_modelo?: number;
  cargas_huella: string;
  red_huella: string;
  composicion_huella: string;
  temporada: TemporadaAgrupacion;
  huella_temporada: string;
  /** `aaaa-mm` efectivo. */
  hasta_periodo: string;
  /** Periodos ACTIVOS (se filtran los que aplican a `temporada`). */
  periodos: readonly PeriodoParaClase[];
  parametros: ParametrosCurvas;
};

/**
 * Huella del cálculo (06b): md5 de `VERSION_MODELO | cargas_huella | red_huella |
 * composición | temporada | huella_temporada | hasta_periodo | periodos aplicables
 * (id, desde, hasta ordenados) | parámetros canónicos`. Dos cálculos con la misma
 * huella dan el mismo resultado (regla 19): sirve para rechazar una aprobación
 * cuya entrada ya no es la que vio el planner (`409 datos_cambiados`).
 */
export function huellaCalculo(partes: PartesHuellaCalculo): string {
  const periodos = partes.periodos
    .filter((p) => periodoAplica(p, partes.temporada))
    .map((p) => `${p.id}:${recortarPeriodo(p.desde)}:${recortarPeriodo(p.hasta)}`)
    .sort();
  return md5(
    [
      partes.version_modelo ?? VERSION_MODELO,
      partes.cargas_huella,
      partes.red_huella,
      partes.composicion_huella,
      partes.temporada,
      partes.huella_temporada,
      recortarPeriodo(partes.hasta_periodo),
      periodos.join(","),
      parametrosCanonicos(partes.parametros),
    ].join("|")
  );
}
