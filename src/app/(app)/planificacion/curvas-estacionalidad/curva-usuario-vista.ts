import { normalizarA100, motivoCurvaUsuarioInvalida } from "@/lib/curvas/curva-usuario";
import type { AgrupacionResultado, CandidataApi, ModeloCurva, PartidaCurvaUsuario, VigenteResumenApi } from "@/lib/curvas/tipos-api";
import { formatearDecimal, formatearPp } from "@/lib/formato";
import type { EvaluacionCurvaUsuario } from "@/lib/curvas/curva-usuario";
import { modeloConNombre } from "./vista";

/**
 * Lógica pura del editor «Mi curva» (06c): leer lo que se escribe en las doce celdas, la suma en vivo, el
 * borrador que sobrevive a recargar (`sessionStorage`), las opciones de «Partir de» y los textos de la medida
 * EN MUESTRA. Sin React: las prueba vitest.
 */

export type BorradorCurva = { textos: string[]; partida: PartidaCurvaUsuario };

export const PARTIDA_EN_BLANCO: PartidaCurvaUsuario = { tipo: "en_blanco", referencia: null };
export const textosEnBlanco = (): string[] => Array<string>(12).fill("");

/** Un número escrito en una celda (punto o coma decimal, con o sin `%`); `null` si está vacía o no es un número. */
export function leerCelda(texto: string): number | null {
  const t = texto.replace("%", "").trim().replace(",", ".");
  if (t === "" || !/^\d+(\.\d+)?$|^\.\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Los porcentajes como texto de celda (hasta cuatro decimales, sin ceros de más). */
export function textosDeValores(valores: readonly number[]): string[] {
  return valores.map((v) => String(Math.round(v * 1e4) / 1e4));
}

/** Las doce celdas como números; `null` donde falta algo o no se entiende. */
export function leerCeldas(textos: readonly string[]): (number | null)[] {
  return Array.from({ length: 12 }, (_, i) => leerCelda(textos[i] ?? ""));
}

/** Los doce valores si TODAS las celdas son números y la curva es válida (de 0 a 100, suma 100 ± 0.05); si no, `null`. */
export function valoresValidos(textos: readonly string[]): number[] | null {
  const v = leerCeldas(textos);
  if (v.some((x) => x === null)) return null;
  const nums = v as number[];
  return motivoCurvaUsuarioInvalida(nums) === null ? nums : null;
}

export type SumaEnVivo = { suma: number; texto: string; ok: boolean; completa: boolean };

/** «Suma 98.0 % · faltan 2.0» / «Suma 103.0 % · sobran 3.0» / «Suma 100.0 % ✓» (las celdas vacías cuentan 0). */
export function sumaEnVivo(textos: readonly string[]): SumaEnVivo {
  const v = leerCeldas(textos);
  const completa = v.every((x) => x !== null);
  const suma = v.reduce<number>((s, x) => s + (x ?? 0), 0);
  const ok = valoresValidos(textos) !== null;
  const dif = Math.round((100 - suma) * 100) / 100;
  const base = `Suma ${formatearDecimal(suma, 1)} %`;
  if (ok) return { suma, texto: `${base} ✓`, ok, completa };
  const resto = dif > 0 ? ` · faltan ${formatearDecimal(dif, 1)}` : ` · sobran ${formatearDecimal(-dif, 1)}`;
  return { suma, texto: `${base}${Math.abs(dif) < 0.005 ? "" : resto}${completa ? "" : " · hay celdas vacías o que no son números"}`, ok, completa };
}

/** Normalizar a 100 %: reparto proporcional (celdas vacías = 0); `null` si alguna celda no es un número o la suma es 0. */
export function normalizarTextos(textos: readonly string[]): string[] | null {
  const v = textos.map((t) => (t.trim() === "" ? 0 : leerCelda(t)));
  if (v.some((x) => x === null)) return null;
  const nums = v as number[];
  if (!(nums.reduce((s, x) => s + x, 0) > 0)) return null;
  return textosDeValores(normalizarA100(nums));
}

// ─── Borrador (sobrevive a recargar la página) ───

export const claveBorrador = (agrupacionId: string) => `curva-usuario:${agrupacionId}`;

export function serializarBorrador(b: BorradorCurva): string {
  return JSON.stringify(b);
}

const TIPOS_PARTIDA = new Set(["candidata", "anio", "vigente", "pegado", "en_blanco"]);

/** Lee un borrador guardado; `null` si no hay o está dañado (nunca lanza). */
export function leerBorradorGuardado(texto: string | null): BorradorCurva | null {
  if (!texto) return null;
  try {
    const j = JSON.parse(texto) as { textos?: unknown; partida?: { tipo?: unknown; referencia?: unknown } };
    if (!Array.isArray(j.textos) || j.textos.length !== 12 || !j.textos.every((t) => typeof t === "string" && t.length <= 20)) return null;
    const tipo = j.partida?.tipo;
    if (typeof tipo !== "string" || !TIPOS_PARTIDA.has(tipo)) return null;
    const ref = j.partida?.referencia;
    if (ref !== null && typeof ref !== "string") return null;
    if (!j.textos.some((t) => t.trim() !== "")) return null;
    return { textos: j.textos as string[], partida: { tipo, referencia: ref } as PartidaCurvaUsuario };
  } catch {
    return null;
  }
}

// ─── «Partir de» ───

export type OpcionPartida = { id: string; etiqueta: string; partida: PartidaCurvaUsuario };

/** Los puntos de partida disponibles: candidatas con curva (`A`…`F`, `T`), años con curva, la vigente. */
export function opcionesPartida(
  resultado: Pick<AgrupacionResultado, "candidatas" | "anios">,
  vigente: Pick<VigenteResumenApi, "version" | "curva"> | null
): OpcionPartida[] {
  const salida: OpcionPartida[] = [];
  for (const c of resultado.candidatas) {
    if (c.curva) salida.push({ id: `c-${c.modelo}`, etiqueta: modeloConNombre(c.modelo), partida: { tipo: "candidata", referencia: c.modelo } });
  }
  for (const a of [...resultado.anios].sort((x, y) => x.anio - y.anio)) {
    if (a.participacion_real ?? a.participacion) salida.push({ id: `a-${a.anio}`, etiqueta: `Año ${a.anio}${a.clase === "en_curso" ? " (parcial)" : ""}`, partida: { tipo: "anio", referencia: String(a.anio) } });
  }
  if (vigente) salida.push({ id: "v", etiqueta: `Vigente v${vigente.version}`, partida: { tipo: "vigente", referencia: `v${vigente.version}` } });
  return salida;
}

// ─── Lo medido, en palabras ───

/** «A: 3.8 fuera de muestra · 1.9 en muestra» (las candidatas se miden fuera de muestra; la curva del usuario, en muestra). */
export function textoEatCandidata(c: Pick<CandidataApi, "modelo" | "eat" | "eat_en_muestra">): string | null {
  const partes: string[] = [];
  if (c.eat !== null) partes.push(`${formatearDecimal(c.eat, 1)} fuera de muestra`);
  if (c.eat_en_muestra !== null && c.eat_en_muestra !== undefined) partes.push(`${formatearDecimal(c.eat_en_muestra, 1)} en muestra`);
  return partes.length === 0 ? null : `${c.modelo}: ${partes.join(" · ")}`;
}

/** Las líneas de la medida EN MUESTRA de la curva del usuario, incluido el año en curso y el ruido. */
export function lineasMedidaEnMuestra(e: Pick<EvaluacionCurvaUsuario, "eat_en_muestra" | "error_max_en_muestra" | "eat_en_muestra_por_anio" | "eat_parcial_en_muestra" | "ruido_normal" | "igual_a">): string[] {
  if (e.eat_en_muestra === null) return ["Sin años de ajuste con los que medir: la curva no tiene EAT en muestra."];
  const porAnio = e.eat_en_muestra_por_anio.map((x) => `${x.anio} ${formatearPp(x.eat)} (máx. ${formatearDecimal(x.error_max, 1)})`).join(" · ");
  const partes = [`${porAnio} · promedio ${formatearDecimal(e.eat_en_muestra, 1)}`];
  if (e.eat_parcial_en_muestra !== null) partes.push(`año en curso (parcial) ${formatearDecimal(e.eat_parcial_en_muestra, 1)} (en muestra)`);
  partes.push(e.ruido_normal === null ? "ruido entre años normales no medible" : `ruido entre años normales ${formatearDecimal(e.ruido_normal, 1)}`);
  const lineas = [`Error contra los años, EN MUESTRA (la curva se mide con los mismos años que tienes delante): ${partes.join(" · ")}.`];
  if (e.igual_a) lineas.push(`Tu curva coincide con la candidata ${e.igual_a}.`);
  return lineas;
}

/** El motivo por el que una candidata de referencia no sirve para comparar. */
export function candidataDeReferencia(resultado: Pick<AgrupacionResultado, "candidatas">, modelo: ModeloCurva | null): CandidataApi | null {
  return resultado.candidatas.find((c) => c.modelo === modelo) ?? null;
}

// ─── sessionStorage (el borrador de «Mi curva» sobrevive a recargar la pestaña) ───

function almacen(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** El borrador guardado de esta agrupación, o `null`. Nunca lanza. */
export function leerBorrador(agrupacionId: string): BorradorCurva | null {
  try {
    return leerBorradorGuardado(almacen()?.getItem(claveBorrador(agrupacionId)) ?? null);
  } catch {
    return null;
  }
}

/** Guarda el borrador (sin celdas escritas, lo borra). Nunca lanza: si el navegador no deja guardar, el borrador solo vive en pantalla. */
export function guardarBorrador(agrupacionId: string, b: BorradorCurva): void {
  try {
    const a = almacen();
    if (!a) return;
    if (b.textos.every((t) => t.trim() === "")) a.removeItem(claveBorrador(agrupacionId));
    else a.setItem(claveBorrador(agrupacionId), serializarBorrador(b));
  } catch {
    // sin almacenamiento: no pasa nada
  }
}

export function borrarBorrador(agrupacionId: string): void {
  try {
    almacen()?.removeItem(claveBorrador(agrupacionId));
  } catch {
    // sin almacenamiento
  }
}
