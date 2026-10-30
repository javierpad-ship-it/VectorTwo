// Lógica de vista de la pestaña Factores del Niño (ficha 06e §4.2 y §5.2). Pura, sin React: la prueban vitest con datos sintéticos.
// El factor del Niño es RELATIVO desde 0.14.0: la temporada frente a la red de todo el año en los mismos meses y tiendas (`ρ_P ÷ κ_P`). El
// servidor calcula y guarda; aquí solo se arman los textos: los dos números (volumen y control), el calculado, los estados de un factor
// del año en curso (`ok`, `faltante`, `desfasado`, `sin_confirmar`) y el diagnóstico mes a mes con el que Javier escribe el factor de verano.
// El diagnóstico nunca escribe `ratio_aplicado`: no hay botón «usar este valor» (decisión 2 de Javier).

import { formatearDecimal } from "@/lib/formato";
import { MIN_MESES_FACTOR, type DiagnosticoFactorApi, type FactorApi, type MotivoDesfaseFactor } from "@/lib/proyeccion/tipos-api";
import { leerFactor, nombreMes } from "./vista";

/**
 * Lo que el servidor puede añadir sin cambiar el contrato: la fecha en que se escribió `ratio_aplicado` («confirmado el 29/10») y el año normal
 * de referencia del diagnóstico («frente a 2025»). Si no vienen, la pantalla dice «confirmado» y «el año normal de referencia».
 */
export type FactorVista = FactorApi & { aplicado_at?: string | null };
export type DiagnosticoVista = DiagnosticoFactorApi & { anio_ref?: number | null };

export const ETIQUETA_TEMPORADA_FACTOR: Record<FactorApi["temporada"], string> = { invierno: "Invierno", verano: "Verano" };

const MESES_LARGO = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "setiembre", "octubre", "noviembre", "diciembre"] as const;
const mayuscula = (t: string): string => t.charAt(0).toUpperCase() + t.slice(1);

/** Dos decimales en texto corrido; `—` si no hay valor. */
export const factor2 = (n: number | null | undefined): string => (n === null || n === undefined ? "—" : formatearDecimal(n, 2));
/** Tres decimales en las tablas de diagnóstico. */
export const factor3 = (n: number | null | undefined): string => (n === null || n === undefined ? "—" : formatearDecimal(n, 3));

/** `29/10` (día y mes en Lima) desde una fecha ISO; `null` si no se puede leer. */
export function formatearDiaMes(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("es-PE", { timeZone: "America/Lima", day: "2-digit", month: "2-digit" }).format(d);
}

// ─── Encabezado ───

/**
 * El año en curso `Y` de los factores: el de las filas que traen `estado` (solo las de `Y` lo traen) o, si ninguna, el anterior al año objetivo.
 * `null` si no se puede saber (todavía no hay años atípicos).
 */
export function anioEnCursoDeFactores(filas: readonly Pick<FactorApi, "anio" | "estado" | "objetivo">[]): number | null {
  const conEstado = filas.find((f) => f.estado !== undefined);
  if (conEstado) return conEstado.anio;
  const objetivo = filas.find((f) => f.objetivo);
  return objetivo ? objetivo.anio - 1 : null;
}

/**
 * El texto fijo de la pestaña (06e §4.2): «El factor de 2026 corrige la base de 2027 de cada temporada (método 5). Es relativo: la temporada
 * frente a la red en los mismos meses. Si una temporada no tuvo efecto, escribe 1.00.»
 */
export function textoIntroFactores(anioEnCurso: number | null): string {
  const y = anioEnCurso === null ? "el año en curso" : String(anioEnCurso);
  const s = anioEnCurso === null ? "el año siguiente" : String(anioEnCurso + 1);
  return `El factor de ${y} corrige la base de ${s} de cada temporada (método 5). Es relativo: la temporada frente a la red en los mismos meses. Si una temporada no tuvo efecto, escribe 1.00.`;
}

// ─── Una fila de factor ───

/** «9 de 12 del periodo»; sin los meses del periodo (calculado antes de 0.14.0), «9 meses» si se sabe. `null` si no hay nada que decir. */
export function textoMesesPeriodo(f: Pick<FactorApi, "meses_periodo" | "meses_periodo_con_dato" | "meses_comparados">): string | null {
  if (f.meses_periodo !== undefined && f.meses_periodo_con_dato !== undefined) return `${f.meses_periodo_con_dato} de ${f.meses_periodo} del periodo`;
  if (f.meses_comparados !== null && f.meses_comparados !== undefined) return `${f.meses_comparados} ${f.meses_comparados === 1 ? "mes" : "meses"}`;
  return null;
}

/**
 * El «calculado» de la fila: el valor relativo con dos decimales o, si el sistema no lo propone, por qué: «—: 1 mes del periodo, escríbelo tú»
 * (menos de `MIN_MESES_FACTOR` meses del periodo con dato), «—: sin datos del periodo todavía» o «sin calcular».
 */
export function textoCalculado(f: Pick<FactorApi, "ratio_calculado" | "calculado_at" | "meses_periodo_con_dato">): { valor: string; nota: string | null } {
  if (f.ratio_calculado !== null) return { valor: factor2(f.ratio_calculado), nota: null };
  if (f.calculado_at === null) return { valor: "—", nota: "sin calcular" };
  const n = f.meses_periodo_con_dato;
  if (n === undefined) return { valor: "—", nota: "sin valor calculado" };
  if (n === 0) return { valor: "—", nota: "sin datos del periodo todavía" };
  if (n < MIN_MESES_FACTOR) return { valor: "—", nota: `${n === 1 ? "1 mes" : `${n} meses`} del periodo, escríbelo tú` };
  return { valor: "—", nota: "sin valor calculado" };
}

/** «tu valor 0.72 · calculado hoy 0.70» cuando lo aplicado difiere del calculado (a dos decimales); `null` si coinciden o falta alguno. */
export function textoDiferencia(f: Pick<FactorApi, "ratio_aplicado" | "ratio_calculado">): string | null {
  if (f.ratio_aplicado === null || f.ratio_calculado === null) return null;
  if (factor2(f.ratio_aplicado) === factor2(f.ratio_calculado)) return null;
  return `tu valor ${factor2(f.ratio_aplicado)} · calculado hoy ${factor2(f.ratio_calculado)}`;
}

const MOTIVO_DESFASE: Record<MotivoDesfaseFactor, string> = {
  formula: "se calculó con la fórmula anterior",
  cargas: "se cargaron datos nuevos después de calcular",
  meses: "hay más meses publicados del periodo que cuando se calculó",
  composicion: "cambió la composición de las agrupaciones de la temporada",
};

/** «Desfasado: se cargaron datos nuevos después de calcular y hay más meses publicados del periodo que cuando se calculó. Pulsa «Sincronizar» y revisa el valor.» */
export function textoDesfase(motivos: readonly MotivoDesfaseFactor[] | undefined): string {
  const lista = (motivos ?? []).map((m) => MOTIVO_DESFASE[m]).filter(Boolean);
  if (lista.length === 0) return "Desfasado. Pulsa «Sincronizar» y revisa el valor.";
  const porque = lista.length === 1 ? lista[0] : `${lista.slice(0, -1).join(", ")} y ${lista[lista.length - 1]}`;
  return `Desfasado: ${porque}. Pulsa «Sincronizar» y revisa el valor.`;
}

export type InsigniaFactor = { clave: string; texto: string; tono: "neutro" | "alerta" | "marca" | "exito"; titulo?: string };

/**
 * Las insignias de la fila (06e §4.2): «Año objetivo», «parcial», «fórmula anterior», «desfasado: sincroniza», «por confirmar»,
 * «confirmado el 29/10» y «Sin factor». Solo los factores de `Y` traen `estado`; los demás años solo muestran las que no dependen de él.
 */
export function insigniasFactor(f: FactorVista): InsigniaFactor[] {
  const out: InsigniaFactor[] = [];
  if (f.objetivo) out.push({ clave: "objetivo", texto: "Año objetivo", tono: "marca", titulo: "El año siguiente de la proyección: si Curvas lo marca atípico, su curva se repondera con el factor" });
  if (f.parcial) out.push({ clave: "parcial", texto: "parcial", tono: "alerta", titulo: "El periodo del Niño todavía no está completo: el factor se calcula con los meses publicados" });
  if (f.calculado_at !== null && f.formula === null) {
    out.push({ clave: "formula", texto: "fórmula anterior", tono: "alerta", titulo: "Se calculó con la fórmula anterior (volumen de todos los meses publicados). Sincroniza para calcular el factor relativo." });
  }
  if (f.estado === "desfasado") out.push({ clave: "desfasado", texto: "desfasado: sincroniza", tono: "alerta", titulo: textoDesfase(f.motivos_desfase) });
  if (f.estado === "sin_confirmar") out.push({ clave: "sin_confirmar", texto: "por confirmar", tono: "alerta", titulo: "Es parcial y nadie lo confirmó con los datos de hoy: escribe el valor (el mismo lo confirma)" });
  if (f.estado === "ok" && f.parcial && f.ratio_aplicado !== null) {
    const dia = formatearDiaMes(f.aplicado_at);
    out.push({ clave: "confirmado", texto: dia ? `confirmado el ${dia}` : "confirmado", tono: "exito", titulo: "Escribiste el valor con los datos de hoy" });
  }
  if (f.ratio_efectivo === null) out.push({ clave: "sin_factor", texto: "Sin factor", tono: "alerta", titulo: "Sin factor, la base del año siguiente de esa temporada no se corrige y no se puede cerrar" });
  return out;
}

/** ¿La fila pide confirmar el valor escribiéndolo? (parcial y sin confirmar con los datos de hoy). */
export const pideConfirmar = (f: Pick<FactorApi, "estado">): boolean => f.estado === "sin_confirmar";

/** «efectivo 0.70 · escrito por ti», «… · calculado» o «sin factor». */
export function textoEfectivo(f: Pick<FactorApi, "ratio_efectivo" | "origen">): string {
  if (f.ratio_efectivo === null) return "sin factor";
  return `${factor2(f.ratio_efectivo)} · ${f.origen === "manual" ? "escrito por ti" : "calculado"}`;
}

/**
 * Lo que se escribe en «Aplicado»: vacío = usar el calculado (`null`); si no, un número válido (`leerFactor`). Con `exigir`, vacío no vale:
 * confirmar un factor es ESCRIBIR su valor (decisión 2 de Javier, §5.2), no pulsar «usar el calculado».
 */
export function leerAplicado(texto: string, exigir: boolean): ReturnType<typeof leerFactor> {
  const l = leerFactor(texto);
  if (l.ok && exigir && l.valor === null) return { ok: false, motivo: "Escribe el valor para confirmarlo." };
  return l;
}

// ─── Diagnóstico «Cómo crece … atípicamente» ───

export type FilaDiagnostico = { m: number; mes: string; enPeriodo: boolean; uRef: string; u: string; ratio: string; control: string; relativo: string };

const entero = (n: number): string => n.toLocaleString("es-PE");

/** Los doce meses de la tabla de diagnóstico, con tres decimales en los ratios; los del periodo van marcados. */
export function filasDiagnostico(d: DiagnosticoFactorApi): FilaDiagnostico[] {
  return [...d.meses]
    .sort((a, b) => a.m - b.m)
    .map((x) => ({ m: x.m, mes: nombreMes(x.m), enPeriodo: x.en_periodo, uRef: entero(Math.round(x.u_ref)), u: entero(Math.round(x.u)), ratio: factor3(x.ratio), control: factor3(x.control), relativo: factor3(x.relativo) }));
}

/** `[9]` → «setiembre»; `[9,10,11,12]` → «setiembre a diciembre»; `[1,2,3,4,5,6,7,8,9]` → «enero a setiembre»; salteados, «enero y marzo». */
export function listaDeMeses(ms: readonly number[]): string {
  const orden = [...new Set(ms)].sort((a, b) => a - b);
  if (orden.length === 0) return "";
  const nombre = (m: number) => MESES_LARGO[m - 1] ?? "?";
  const seguidos = orden.every((m, i) => i === 0 || m === orden[i - 1] + 1);
  if (orden.length === 1) return nombre(orden[0]);
  if (seguidos) return `${nombre(orden[0])} a ${nombre(orden[orden.length - 1])}`;
  return `${orden.slice(0, -1).map(nombre).join(", ")} y ${nombre(orden[orden.length - 1])}`;
}

/** `ene–ago` (abreviado) de los meses fuera del periodo; vacío si no hay. */
function rangoCorto(ms: readonly number[]): string {
  const orden = [...new Set(ms)].sort((a, b) => a - b);
  if (orden.length === 0) return "";
  const seguidos = orden.every((m, i) => i === 0 || m === orden[i - 1] + 1);
  if (seguidos) return orden.length === 1 ? nombreMes(orden[0]) : `${nombreMes(orden[0])}–${nombreMes(orden[orden.length - 1])}`;
  return orden.map(nombreMes).join(", ");
}

/**
 * Las líneas de resumen del diagnóstico (06e §4.2 y §5.2). Con meses del periodo: «Setiembre: ×1.90 frente a 2025; su tendencia ene–ago ×1.20; la
 * red ×0.95 → crece ×1.58 sobre su tendencia y ×2.00 sobre la red.» (en invierno no hay tendencia propia: «… → ×0.70 frente a la red (el factor
 * relativo)»). Con menos de `MIN_MESES_FACTOR` meses del periodo con dato añade el aviso de dato frágil; sin ninguno, «Sin datos del periodo todavía».
 */
export function textoResumenDiagnostico(f: Pick<FactorApi, "temporada" | "ratio_volumen" | "ratio_control">, d: DiagnosticoVista): string[] {
  const enPeriodo = d.meses.filter((m) => m.en_periodo).map((m) => m.m);
  if (enPeriodo.length === 0) return ["Sin datos del periodo todavía."];
  const frente = d.anio_ref ? `frente a ${d.anio_ref}` : "frente al año normal de referencia";
  const rho = f.ratio_volumen ?? null;
  const kappa = f.ratio_control ?? null;
  const fuera = d.meses.filter((m) => !m.en_periodo && m.ratio !== null).map((m) => m.m);
  const partes = [`${mayuscula(listaDeMeses(enPeriodo))}: ×${factor2(rho)} ${frente}`];
  if (d.ratio_fuera !== null && fuera.length > 0) partes.push(`su tendencia ${rangoCorto(fuera)} ×${factor2(d.ratio_fuera)}`);
  if (kappa !== null) partes.push(`la red ×${factor2(kappa)}`);
  const sobreTendencia = rho !== null && d.ratio_fuera ? rho / d.ratio_fuera : null;
  const sobreRed = rho !== null && kappa ? rho / kappa : null;
  let linea = partes.join("; ");
  if (sobreTendencia !== null && sobreRed !== null) linea += ` → crece ×${factor2(sobreTendencia)} sobre su tendencia y ×${factor2(sobreRed)} sobre la red`;
  else if (sobreRed !== null) linea += ` → ×${factor2(sobreRed)} frente a la red (el factor relativo)`;
  else if (sobreTendencia !== null) linea += ` → crece ×${factor2(sobreTendencia)} sobre su tendencia`;
  const out = [`${linea}.`];
  const n = d.meses_periodo_con_dato;
  if (n < MIN_MESES_FACTOR) {
    out.push(`${n === 1 ? "1 solo mes" : `${n} meses`} del periodo${n === 1 && f.temporada === "verano" ? ", y es el de inicio de temporada" : ""}: dato frágil. El sistema no propone factor: escríbelo tú.`);
  }
  return out;
}
