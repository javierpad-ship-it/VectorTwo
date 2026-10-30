import type { z } from "zod";
import { BANDERAS_IA, salidaLineasIa, salidaNaturalIa, salidaRepartoIa } from "./esquemas";
import type { BloqueGMIa, EntradaLineasIa, FilaEntradaIa } from "./tipos";
import {
  FACTOR_CIFRA_EXCESIVA,
  MAX_FALTANTES_PCT,
  MAX_RAZON,
  MAX_RAZON_GM,
  MAX_RAZON_NATURAL,
  TOLERANCIA_SUMA_INVALIDA_PCT,
  TOLERANCIA_SUMA_PCT,
  type AvisoIa,
  type BanderaIa,
  type ConfianzaIa,
} from "./tipos-api";

/**
 * Validación y normalización de la salida del proveedor (ficha 07e, §5.2; R9). Pura: recibe lo enviado y la salida, y devuelve las filas
 * validadas, los avisos y `invalida` (el motivo, sin datos, que alimenta el único reintento). Nunca reescribe una cifra: la descarta
 * (peso `P^GM` al leer) o la deja. Que la suma cuadre lo pone `asignarMeta`.
 */

export type InvalidezIa = { codigo: "zod" | "faltan_filas" | "no_cuadra"; resumen: string };

export type OpcionesValidar = {
  /** Pone el nombre real donde la razón cite un alias (`Aliasador.restituir`). */
  restituir?: (texto: string) => string;
};

const CATALOGO: ReadonlySet<string> = new Set(BANDERAS_IA);
const SIN_EXPLICACION = "sin explicación";

// ─── Lectura del texto ───

/** Lee el JSON de la respuesta del modelo (acepta un bloque de código). */
export function leerJsonSalida(texto: string): { ok: true; valor: unknown } | { ok: false } {
  let t = texto.trim();
  const m = /^```(?:json)?\s*([\s\S]*?)\s*```$/iu.exec(t);
  if (m) t = m[1];
  try {
    return { ok: true, valor: JSON.parse(t) as unknown };
  } catch {
    return { ok: false };
  }
}

/** Resumen de un error de zod sin ningún dato: cuántos problemas y dónde (solo nombres de campo y posiciones). */
export function resumirErrorZod(error: z.ZodError): string {
  const n = error.issues.length;
  const ruta = error.issues[0]?.path.join(".") ?? "";
  return `la respuesta no cumple el esquema (${n} ${n === 1 ? "problema" : "problemas"}${ruta ? `, el primero en «${ruta}»` : ""})`;
}

// ─── Saneamiento de razones y banderas ───

/** Restituye alias, quita caracteres de control y de formato, colapsa espacios y recorta. */
export function sanearRazon(texto: string, max: number, restituir?: (t: string) => string): { texto: string; recortada: boolean } {
  const real = restituir ? restituir(texto) : texto;
  const limpio = real
    .replace(/[\p{Cf}]/gu, "")
    .replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (limpio === "") return { texto: SIN_EXPLICACION, recortada: false };
  const letras = Array.from(limpio);
  if (letras.length <= max) return { texto: limpio, recortada: false };
  return { texto: letras.slice(0, max).join("").trimEnd(), recortada: true };
}

function filtrarBanderas(entradas: readonly string[]): { banderas: BanderaIa[]; descartada: boolean } {
  const vistas = new Set<BanderaIa>();
  let descartada = false;
  for (const b of entradas) {
    if (CATALOGO.has(b)) vistas.add(b as BanderaIa);
    else descartada = true;
  }
  return { banderas: [...vistas], descartada };
}

// ─── Límites de las cifras ───

const sumaAnio = (f: FilaEntradaIa, a: "A-2" | "A-1" | "A"): number => (f.meses[a] ?? []).reduce((x, y) => x + y, 0);

/** `10 × max(B^s, máximo anual de los últimos tres años, 1)`. */
export function limiteCifra(fila: FilaEntradaIa, sobre: "corregida" | "bruta"): number {
  const baseS = (sobre === "corregida" ? fila.y1.base_corregida : fila.y1.base) ?? 0;
  const maxAnual = Math.max(sumaAnio(fila, "A-2"), sumaAnio(fila, "A-1"), sumaAnio(fila, "A"));
  return FACTOR_CIFRA_EXCESIVA * Math.max(baseS, maxAnual, 1);
}

const pedidas = (b: BloqueGMIa): FilaEntradaIa[] => b.filas.filter((f) => f.y1.pedir);

/** Fracción `Σ ÷ total − 1`; con total 0, 0 si la suma es 0 y infinito si no. */
function desvio(suma: number, total: number): number {
  if (total > 0) return suma / total - 1;
  return suma === 0 ? 0 : Number.POSITIVE_INFINITY;
}

function juzgarSuma(d: number): { aviso: AvisoIa | null; invalida: InvalidezIa | null } {
  // Se redondea para que un 3,000…03 % por coma flotante no pase por encima de la tolerancia.
  const pct = Math.round(Math.abs(d) * 100 * 1e9) / 1e9;
  if (pct <= TOLERANCIA_SUMA_PCT) return { aviso: null, invalida: null };
  if (pct <= TOLERANCIA_SUMA_INVALIDA_PCT) return { aviso: "ia_no_cuadro", invalida: null };
  const dif = Number.isFinite(pct) ? `la suma difiere ${Math.round(pct)} %` : "la suma no corresponde a la meta";
  return { aviso: null, invalida: { codigo: "no_cuadra", resumen: dif } };
}

function faltanDemasiado(faltan: number, total: number): InvalidezIa | null {
  if (total === 0 || faltan === 0) return null;
  return faltan * 100 > MAX_FALTANTES_PCT * total ? { codigo: "faltan_filas", resumen: `faltan ${faltan} ${faltan === 1 ? "fila" : "filas"}` } : null;
}

// ─── Natural ───

export type FilaNaturalValida = { f: string; natural_y1: number | null; razon_natural: string; banderas: BanderaIa[]; confianza: ConfianzaIa; avisos: AvisoIa[] };
export type ResultadoNatural = {
  invalida: InvalidezIa | null;
  filas: FilaNaturalValida[];
  /** `f` pedidos que el modelo no devolvió (≤ 5 %): sin cifra, peso `P^GM` al leer. */
  faltantes: string[];
  avisos_gm: AvisoIa[];
};

export function validarNatural(salida: unknown, entrada: { bloque: BloqueGMIa; sobre: "corregida" | "bruta" }, opciones: OpcionesValidar = {}): ResultadoNatural {
  const vacio: ResultadoNatural = { invalida: null, filas: [], faltantes: [], avisos_gm: [] };
  const lectura = salidaNaturalIa.safeParse(salida);
  if (!lectura.success) return { ...vacio, invalida: { codigo: "zod", resumen: resumirErrorZod(lectura.error) } };

  const pedir = pedidas(entrada.bloque);
  const porF = new Map(pedir.map((x) => [x.f, x]));
  const vistas = new Map<string, FilaNaturalValida>();
  const avisos_gm = new Set<AvisoIa>();
  for (const r of lectura.data.filas) {
    const fila = porF.get(r.f);
    if (!fila) {
      avisos_gm.add("fila_extra");
      continue;
    }
    const previa = vistas.get(r.f);
    if (previa) {
      if (!previa.avisos.includes("fila_duplicada")) previa.avisos.push("fila_duplicada");
      continue;
    }
    const avisos: AvisoIa[] = [];
    let natural: number | null = r.natural_y1;
    if (natural > limiteCifra(fila, entrada.sobre)) {
      natural = null;
      avisos.push("ia_cifra_excesiva");
    }
    const razon = sanearRazon(r.razon_natural, MAX_RAZON_NATURAL, opciones.restituir);
    if (razon.recortada) avisos.push("razon_recortada");
    const b = filtrarBanderas(r.banderas);
    if (b.descartada) avisos.push("bandera_desconocida");
    vistas.set(r.f, { f: r.f, natural_y1: natural, razon_natural: razon.texto, banderas: b.banderas, confianza: r.confianza, avisos });
  }
  const faltantes = pedir.filter((x) => !vistas.has(x.f)).map((x) => x.f);
  const invalida = faltanDemasiado(faltantes.length, pedir.length);
  return { invalida, filas: pedir.filter((x) => vistas.has(x.f)).map((x) => vistas.get(x.f) as FilaNaturalValida), faltantes, avisos_gm: [...avisos_gm] };
}

// ─── Reparto ───

export type FilaRepartoValida = { f: string; meta_y1: number | null; razon: string; banderas: BanderaIa[]; avisos: AvisoIa[] };
export type ResultadoReparto = {
  invalida: InvalidezIa | null;
  filas: FilaRepartoValida[];
  faltantes: string[];
  razon_gm: string;
  banderas_gm: BanderaIa[];
  /** `Σ meta_y1 ÷ del_lote − 1` (fracción); `null` si la respuesta no se pudo leer. */
  desvio_suma_modelo: number | null;
  avisos_gm: AvisoIa[];
};

export function validarReparto(
  salida: unknown,
  entrada: { bloque: BloqueGMIa; sobre: "corregida" | "bruta"; del_lote: number },
  opciones: OpcionesValidar = {}
): ResultadoReparto {
  const vacio: ResultadoReparto = { invalida: null, filas: [], faltantes: [], razon_gm: SIN_EXPLICACION, banderas_gm: [], desvio_suma_modelo: null, avisos_gm: [] };
  const lectura = salidaRepartoIa.safeParse(salida);
  if (!lectura.success) return { ...vacio, invalida: { codigo: "zod", resumen: resumirErrorZod(lectura.error) } };

  const pedir = pedidas(entrada.bloque);
  const porF = new Map(pedir.map((x) => [x.f, x]));
  const vistas = new Map<string, FilaRepartoValida>();
  const avisos_gm = new Set<AvisoIa>();
  for (const r of lectura.data.filas) {
    const fila = porF.get(r.f);
    if (!fila) {
      avisos_gm.add("fila_extra");
      continue;
    }
    const previa = vistas.get(r.f);
    if (previa) {
      if (!previa.avisos.includes("fila_duplicada")) previa.avisos.push("fila_duplicada");
      continue;
    }
    const avisos: AvisoIa[] = [];
    let cifra: number | null = r.meta_y1;
    if (cifra > limiteCifra(fila, entrada.sobre)) {
      cifra = null;
      avisos.push("ia_cifra_excesiva");
    }
    const razon = sanearRazon(r.razon, MAX_RAZON, opciones.restituir);
    if (razon.recortada) avisos.push("razon_recortada");
    const b = filtrarBanderas(r.banderas);
    if (b.descartada) avisos.push("bandera_desconocida");
    vistas.set(r.f, { f: r.f, meta_y1: cifra, razon: razon.texto, banderas: b.banderas, avisos });
  }
  const faltantes = pedir.filter((x) => !vistas.has(x.f)).map((x) => x.f);
  const gm = sanearRazon(lectura.data.razon_gm, MAX_RAZON_GM, opciones.restituir);
  const bgm = filtrarBanderas(lectura.data.banderas_gm);
  if (gm.recortada) avisos_gm.add("razon_recortada");
  if (bgm.descartada) avisos_gm.add("bandera_desconocida");

  const filas = pedir.filter((x) => vistas.has(x.f)).map((x) => vistas.get(x.f) as FilaRepartoValida);
  const d = desvio(filas.reduce((a, r) => a + (r.meta_y1 ?? 0), 0), entrada.del_lote);
  const base = { filas, faltantes, razon_gm: gm.texto, banderas_gm: bgm.banderas, desvio_suma_modelo: Number.isFinite(d) ? d : null };
  const faltan = faltanDemasiado(faltantes.length, pedir.length);
  if (faltan) return { ...base, invalida: faltan, avisos_gm: [...avisos_gm] };
  const suma = juzgarSuma(d);
  if (suma.aviso) avisos_gm.add(suma.aviso);
  return { ...base, invalida: suma.invalida, avisos_gm: [...avisos_gm] };
}

// ─── Líneas (modo jerárquico) ───

export type LineaValida = { l: string; meta_y1: number | null; razon: string; avisos: AvisoIa[] };
export type ResultadoLineas = {
  invalida: InvalidezIa | null;
  lineas: LineaValida[];
  /** Líneas sin respuesta: su sub-meta se reparte con `P^GM`. */
  faltantes: string[];
  razon_gm: string;
  banderas_gm: BanderaIa[];
  desvio_suma_modelo: number | null;
  avisos_gm: AvisoIa[];
};

export function validarLineas(salida: unknown, entrada: { lineas: EntradaLineasIa["lineas"]; meta_libre: number }, opciones: OpcionesValidar = {}): ResultadoLineas {
  const vacio: ResultadoLineas = { invalida: null, lineas: [], faltantes: [], razon_gm: SIN_EXPLICACION, banderas_gm: [], desvio_suma_modelo: null, avisos_gm: [] };
  const lectura = salidaLineasIa.safeParse(salida);
  if (!lectura.success) return { ...vacio, invalida: { codigo: "zod", resumen: resumirErrorZod(lectura.error) } };

  const porL = new Map(entrada.lineas.map((x) => [x.l, x]));
  const vistas = new Map<string, LineaValida>();
  const avisos_gm = new Set<AvisoIa>();
  for (const r of lectura.data.lineas) {
    const linea = porL.get(r.l);
    if (!linea) {
      avisos_gm.add("fila_extra");
      continue;
    }
    const previa = vistas.get(r.l);
    if (previa) {
      if (!previa.avisos.includes("fila_duplicada")) previa.avisos.push("fila_duplicada");
      continue;
    }
    const avisos: AvisoIa[] = [];
    let cifra: number | null = r.meta_y1;
    const maxAnual = Math.max(0, ...(["A-2", "A-1", "A"] as const).map((a) => linea.historia[a] ?? 0));
    if (cifra > FACTOR_CIFRA_EXCESIVA * Math.max(linea.base_corregida, maxAnual, 1)) {
      cifra = null;
      avisos.push("ia_cifra_excesiva");
    }
    const razon = sanearRazon(r.razon, MAX_RAZON, opciones.restituir);
    if (razon.recortada) avisos.push("razon_recortada");
    vistas.set(r.l, { l: r.l, meta_y1: cifra, razon: razon.texto, avisos });
  }
  const faltantes = entrada.lineas.filter((x) => !vistas.has(x.l)).map((x) => x.l);
  const gm = sanearRazon(lectura.data.razon_gm, MAX_RAZON_GM, opciones.restituir);
  const bgm = filtrarBanderas(lectura.data.banderas_gm);
  if (gm.recortada) avisos_gm.add("razon_recortada");
  if (bgm.descartada) avisos_gm.add("bandera_desconocida");
  if (faltantes.length > 0) avisos_gm.add("sin_propuesta_ia");

  const lineas = entrada.lineas.filter((x) => vistas.has(x.l)).map((x) => vistas.get(x.l) as LineaValida);
  const d = desvio(lineas.reduce((a, r) => a + (r.meta_y1 ?? 0), 0), entrada.meta_libre);
  const suma = juzgarSuma(d);
  if (suma.aviso) avisos_gm.add(suma.aviso);
  return { invalida: suma.invalida, lineas, faltantes, razon_gm: gm.texto, banderas_gm: bgm.banderas, desvio_suma_modelo: Number.isFinite(d) ? d : null, avisos_gm: [...avisos_gm] };
}

