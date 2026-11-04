import type { Mes } from "@/lib/compras/tipos";
import { MAX_CORRELATIVO_CODIGO, PATRON_CODIGO_AGRUPADOR, type TipoAgrupador } from "./tipos";

/**
 * Códigos `aamm##` de viajes, embarques y paquetes (ficha 08b, §2.2, R14 y decisión 93). Puro y sin reloj.
 *
 *  - Seis dígitos: año de dos cifras, mes y correlativo `01`–`99` (`261101`). Cada tipo tiene su propia numeración.
 *  - El mes sale de la fecha de referencia AL CREAR (viaje: `fecha_inicio`; embarque: `fecha_llegada_estimada`; paquete: la de su
 *    embarque). El código no cambia si después cambian las fechas y no se reutiliza.
 *  - Autonumeración (solo con `codigo` vacío): el mayor `##` de los códigos del tipo que cumplen `^<aamm>[0-9]{2}$` (escritos a mano
 *    o no) más uno; un hueco no se rellena; con `99` ya usado, `correlativo_agotado`. La función SQL hace lo mismo bajo candado
 *    consultivo; esto es el espejo para la propuesta de la pantalla, la vista previa del importador y las pruebas.
 *  - A mano: se pasa a mayúsculas, debe cumplir `^[A-Z0-9-]{1,30}$` y es único por tipo sin distinguir mayúsculas.
 */

/** Texto de un código como se compara y se guarda: sin espacios en los extremos y en mayúsculas. */
export const normalizarCodigo = (texto: string): string => texto.trim().toUpperCase();

/** `true` si el texto (ya normalizado o no) es un código admitido: `^[A-Z0-9-]{1,30}$`. */
export const esCodigoValido = (texto: string): boolean => PATRON_CODIGO_AGRUPADOR.test(normalizarCodigo(texto));

/** `true` si el código tiene el formato propuesto `aamm##` (un código a mano puede no tenerlo). */
export const esCodigoAamm = (texto: string): boolean => /^\d{2}(0[1-9]|1[0-2])\d{2}$/.test(normalizarCodigo(texto));

/**
 * `aamm` de una fecha `aaaa-mm-dd` o de un mes `aaaa-mm`: `2026-11-20` y `2026-11` dan `2611`. `null` si el texto no empieza por un mes
 * válido.
 */
export function aammDe(fechaOMes: string): string | null {
  const m = /^(\d{4})-(0[1-9]|1[0-2])(?:-\d{2})?$/.exec(fechaOMes.trim());
  return m ? `${m[1].slice(2)}${m[2]}` : null;
}

/** Correlativo (`0`–`99`) de un código `<aamm>##`; `null` si el código no tiene ese formato (así no ocupa ningún correlativo). */
export function correlativoDe(codigo: string, aamm: string): number | null {
  const c = normalizarCodigo(codigo);
  if (c.length !== 6 || !c.startsWith(aamm)) return null;
  const n = c.slice(4);
  return /^\d{2}$/.test(n) ? Number(n) : null;
}

export type ResultadoSiguienteCodigo = { ok: true; codigo: string; correlativo: number } | { ok: false; motivo: "correlativo_agotado" };

/**
 * Siguiente código automático del mes `aamm` dado los códigos `existentes` del MISMO tipo (todos, también los cancelados: un código no
 * se reutiliza). Es el máximo correlativo más uno, así que un hueco no se rellena; con `99` ya usado, `correlativo_agotado`.
 */
export function siguienteCodigo(aamm: string, existentes: readonly string[]): ResultadoSiguienteCodigo {
  let max = 0;
  for (const c of existentes) {
    const n = correlativoDe(c, aamm);
    if (n !== null && n > max) max = n;
  }
  if (max >= MAX_CORRELATIVO_CODIGO) return { ok: false, motivo: "correlativo_agotado" };
  const correlativo = max + 1;
  return { ok: true, codigo: `${aamm}${String(correlativo).padStart(2, "0")}`, correlativo };
}

export type MotivoCodigo = "codigo_invalido" | "codigo_duplicado" | "correlativo_agotado";
export type ResultadoCodigo = { ok: true; codigo: string; automatico: boolean } | { ok: false; motivo: MotivoCodigo };

/**
 * Decide el código de un agrupador nuevo. `codigo` vacío, nulo o solo espacios = autonumerar con el mes de `fechaReferencia`
 * (`aaaa-mm-dd` o `aaaa-mm`); si no, valida el escrito a mano (`codigo_invalido`) y que no exista ya en el tipo sin distinguir
 * mayúsculas (`codigo_duplicado`). `existentes` son los códigos del tipo.
 */
export function resolverCodigo(entrada: { codigo?: string | null; fechaReferencia: string; existentes: readonly string[] }): ResultadoCodigo {
  const escrito = normalizarCodigo(entrada.codigo ?? "");
  if (escrito === "") {
    const aamm = aammDe(entrada.fechaReferencia);
    if (aamm === null) return { ok: false, motivo: "codigo_invalido" };
    const s = siguienteCodigo(aamm, entrada.existentes);
    return s.ok ? { ok: true, codigo: s.codigo, automatico: true } : { ok: false, motivo: s.motivo };
  }
  if (!PATRON_CODIGO_AGRUPADOR.test(escrito)) return { ok: false, motivo: "codigo_invalido" };
  const ocupado = entrada.existentes.some((c) => normalizarCodigo(c) === escrito);
  return ocupado ? { ok: false, motivo: "codigo_duplicado" } : { ok: true, codigo: escrito, automatico: false };
}

/** Mes (`aaaa-mm`) con que se numera un agrupador al crearlo, según su tipo (§2.2). Para el paquete se pasa el mes de llegada de su embarque. */
export function mesDeReferenciaCodigo(
  tipo: TipoAgrupador,
  datos: { fecha_inicio?: string | null; fecha_llegada_estimada?: string | null; periodo_llegada_embarque?: Mes | null },
): Mes | null {
  const fuente = tipo === "viaje" ? datos.fecha_inicio : tipo === "embarque" ? datos.fecha_llegada_estimada : datos.periodo_llegada_embarque;
  if (!fuente) return null;
  const aamm = aammDe(fuente);
  return aamm === null ? null : fuente.slice(0, 7);
}

/**
 * Código propuesto en la pantalla al abrir «Nuevo»: el siguiente automático del mes de la fecha de referencia, o `null` si aún no hay
 * fecha o el mes está agotado (entonces el usuario lo escribe a mano). Al escribirlo a mano, la pantalla sugiere el siguiente.
 */
export function proponerCodigo(fechaReferencia: string | null | undefined, existentes: readonly string[]): string | null {
  if (!fechaReferencia) return null;
  const aamm = aammDe(fechaReferencia);
  if (aamm === null) return null;
  const s = siguienteCodigo(aamm, existentes);
  return s.ok ? s.codigo : null;
}
