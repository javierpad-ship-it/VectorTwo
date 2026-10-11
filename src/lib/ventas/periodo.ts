import { esDiaReal } from "@/lib/tiendas/fechas";
import { normalizarNombre } from "@/lib/arbol/normalizar";

/**
 * Lectura de periodos (docs/modulos/05-venta-stock.md, reglas 1–4). Funciones
 * puras. Nunca se usa `new Date(texto)`: depende del motor y de la zona
 * horaria. Dentro de `src/lib/ventas` el periodo corto es `aaaa-mm`; la base
 * guarda el primer día del mes (`aaaa-mm-01`).
 */

export const PERIODO_INVALIDO = "invalido";

const sinAcentos = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "");

const MESES: ReadonlyMap<string, number> = new Map(Object.entries({
  ene: 1,
  enero: 1,
  feb: 2,
  febrero: 2,
  mar: 3,
  marzo: 3,
  abr: 4,
  abril: 4,
  may: 5,
  mayo: 5,
  jun: 6,
  junio: 6,
  jul: 7,
  julio: 7,
  ago: 8,
  agosto: 8,
  set: 9,
  sep: 9,
  sept: 9,
  setiembre: 9,
  septiembre: 9,
  oct: 10,
  octubre: 10,
  nov: 11,
  noviembre: 11,
  dic: 12,
  diciembre: 12,
}));

const dos = (n: number) => String(n).padStart(2, "0");

/** `aaaa-mm` a partir de sus partes. */
export function aPeriodo(anio: number, mes: number): string {
  return `${String(anio).padStart(4, "0")}-${dos(mes)}`;
}

/** `2026-09-01` → `2026-09`; `2026-09` se devuelve igual. */
export function recortarPeriodo(valor: string): string {
  return valor.slice(0, 7);
}

/** `2026-09` → `2026-09-01` (la forma que guarda la base). */
export function periodoADb(periodo: string): string {
  return `${recortarPeriodo(periodo)}-01`;
}

export function esPeriodoValido(valor: unknown): valor is string {
  return typeof valor === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(valor);
}

function leerAnio(valor: string | number | null | undefined): number | null {
  if (valor === null || valor === undefined) return null;
  const texto = String(valor).trim();
  if (!/^\d{4}$/.test(texto)) return null;
  const n = Number(texto);
  return n >= 2000 && n <= 2100 ? n : null;
}

/** Mes como abreviatura o nombre en español (sin caja ni acentos) o número 1 a 12. */
function leerMes(valor: string | number | null | undefined): number | null {
  if (valor === null || valor === undefined) return null;
  const texto = sinAcentos(normalizarNombre(String(valor))).toLowerCase();
  if (texto === "") return null;
  if (/^\d{1,2}$/.test(texto)) {
    const n = Number(texto);
    return n >= 1 && n <= 12 ? n : null;
  }
  return MESES.get(texto) ?? null;
}

export type PeriodoLeido = {
  /** `aaaa-mm-01`. */
  periodo: string;
  /** El texto traía un día distinto de 1 (se ignora, pero se cuenta en una nota). */
  dia_distinto_de_1: boolean;
};

/**
 * Como `leerPeriodo`, pero informa si el día venía distinto de 1.
 *
 * Con `anio`: año de cuatro cifras (2000 a 2100) y mes como abreviatura,
 * nombre o número. Sin `anio` (`null` o vacío): `aaaa-mm`, `aaaa/mm`,
 * `mm/aaaa`, ISO `aaaa-mm-dd` o `dd/mm/aaaa` (día primero, como en M4).
 */
export function leerPeriodoDetallado(
  anio: string | number | null | undefined,
  mes: string | number | null | undefined
): PeriodoLeido | typeof PERIODO_INVALIDO {
  const sinAnio = anio === null || anio === undefined || String(anio).trim() === "";

  if (!sinAnio) {
    const a = leerAnio(anio);
    const m = leerMes(mes);
    if (a === null || m === null) return PERIODO_INVALIDO;
    return { periodo: `${aPeriodo(a, m)}-01`, dia_distinto_de_1: false };
  }

  if (mes === null || mes === undefined) return PERIODO_INVALIDO;
  const texto = String(mes).trim();

  // aaaa-mm, aaaa/mm
  let m = /^(\d{4})[/-](\d{1,2})$/.exec(texto);
  if (m) return desdePartes(Number(m[1]), Number(m[2]), 1);

  // aaaa-mm-dd (ISO, ya convertida por el lector desde fechas de Excel), aaaa/mm/dd
  m = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:[T ].*)?$/.exec(texto);
  if (m) return desdePartes(Number(m[1]), Number(m[2]), Number(m[3]));

  // dd/mm/aaaa (día primero)
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(texto);
  if (m) return desdePartes(Number(m[3]), Number(m[2]), Number(m[1]));

  // mm/aaaa
  m = /^(\d{1,2})[/-](\d{4})$/.exec(texto);
  if (m) return desdePartes(Number(m[2]), Number(m[1]), 1);

  return PERIODO_INVALIDO;
}

function desdePartes(anio: number, mes: number, dia: number): PeriodoLeido | typeof PERIODO_INVALIDO {
  if (anio < 2000 || anio > 2100 || mes < 1 || mes > 12) return PERIODO_INVALIDO;
  if (!esDiaReal(anio, mes, dia)) return PERIODO_INVALIDO;
  return { periodo: `${aPeriodo(anio, mes)}-01`, dia_distinto_de_1: dia !== 1 };
}

/**
 * Regla 1 a 3. Devuelve el primer día del mes (`aaaa-mm-01`) o `"invalido"`.
 *
 *   leerPeriodo("2026", "Set")        → "2026-09-01"
 *   leerPeriodo(null, "15/09/2026")   → "2026-09-01"
 *   leerPeriodo("2026", "13")         → "invalido"
 */
export function leerPeriodo(
  anio: string | number | null | undefined,
  mes: string | number | null | undefined
): string {
  const r = leerPeriodoDetallado(anio, mes);
  return r === PERIODO_INVALIDO ? PERIODO_INVALIDO : r.periodo;
}

/** Regla 4. `hoyLima` es `aaaa-mm-dd`; el mes en curso no está cerrado. */
export function esMesCerrado(periodo: string, hoyLima: string): boolean {
  return recortarPeriodo(periodo) < recortarPeriodo(hoyLima);
}

/** Mes de `hoyLima` (`aaaa-mm`). */
export function mesDeHoy(hoyLima: string): string {
  return recortarPeriodo(hoyLima);
}

/** Último mes cerrado: el anterior al de `hoyLima`. */
export function ultimoMesCerrado(hoyLima: string): string {
  return mesAnterior(mesDeHoy(hoyLima));
}

export function mesAnterior(periodo: string): string {
  const [a, m] = recortarPeriodo(periodo).split("-").map(Number);
  return m === 1 ? aPeriodo(a - 1, 12) : aPeriodo(a, m - 1);
}

export function mesSiguiente(periodo: string): string {
  const [a, m] = recortarPeriodo(periodo).split("-").map(Number);
  return m === 12 ? aPeriodo(a + 1, 1) : aPeriodo(a, m + 1);
}

/** Meses de `desde` a `hasta`, ambos incluidos, como `aaaa-mm`. Vacío si `hasta < desde`. */
export function listarMeses(desde: string, hasta: string): string[] {
  const salida: string[] = [];
  for (let p = recortarPeriodo(desde); p <= recortarPeriodo(hasta); p = mesSiguiente(p)) salida.push(p);
  return salida;
}
