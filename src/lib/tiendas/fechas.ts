import { normalizarNombre } from "@/lib/arbol/normalizar";
import type { TipoTienda } from "./tipos";

/**
 * Lectores de celdas del importador (docs/modulos/04-tiendas.md, reglas
 * 7–9) y formateadores legibles para el reporte de diferencias. Funciones
 * puras; `leerFecha` nunca pasa por `new Date(texto)`, cuyo parseo depende
 * del motor y de la zona horaria.
 */

export const FECHA_INVALIDA = "invalida";
export const MONTO_INVALIDO = "invalido";

const DIAS_MES = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function esBisiesto(anio: number): boolean {
  return (anio % 4 === 0 && anio % 100 !== 0) || anio % 400 === 0;
}

/** `true` si el día existe en el calendario (31/02 no). */
export function esDiaReal(anio: number, mes: number, dia: number): boolean {
  if (mes < 1 || mes > 12 || dia < 1) return false;
  const tope = mes === 2 && esBisiesto(anio) ? 29 : DIAS_MES[mes - 1];
  return dia <= tope;
}

const dos = (n: number) => String(n).padStart(2, "0");

/** `aaaa-mm-dd` a partir de sus partes numéricas (sin `Date`). */
export function aIso(anio: number, mes: number, dia: number): string {
  return `${String(anio).padStart(4, "0")}-${dos(mes)}-${dos(dia)}`;
}

// Día primero: dd/mm/aaaa, dd-mm-aaaa, dd.mm.aaaa, dd/mm/aa.
const DIA_PRIMERO = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/;
// Año primero: aaaa-mm-dd, aaaa/mm/dd.
const ANIO_PRIMERO = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/;

/**
 * Regla 7. Vacío → `null`; formatos con día primero (locale de Perú:
 * `03/05/2026` es 3 de mayo) o ISO; año de dos cifras → `20aa`. Devuelve
 * ISO `aaaa-mm-dd` o `"invalida"` si no es un día real del calendario.
 */
export function leerFecha(valor: unknown): string | null | typeof FECHA_INVALIDA {
  if (typeof valor !== "string") return valor == null ? null : FECHA_INVALIDA;
  const texto = valor.trim();
  if (texto === "") return null;

  let anio: number;
  let mes: number;
  let dia: number;
  const d = DIA_PRIMERO.exec(texto);
  if (d) {
    dia = Number(d[1]);
    mes = Number(d[2]);
    anio = d[3].length === 2 ? 2000 + Number(d[3]) : Number(d[3]);
  } else {
    const a = ANIO_PRIMERO.exec(texto);
    if (!a) return FECHA_INVALIDA;
    anio = Number(a[1]);
    mes = Number(a[2]);
    dia = Number(a[3]);
  }
  if (!esDiaReal(anio, mes, dia)) return FECHA_INVALIDA;
  return aIso(anio, mes, dia);
}

// Entero con o sin separadores de miles (coma seguida de exactamente tres dígitos), decimales con punto.
const MONTO = /^-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/;

/**
 * Regla 8. Vacío → `null`; se quita `S/`, `S/.` y espacios; la coma es
 * separador de miles y el punto el decimal (`S/ 12,500.00` → `12500`).
 * Redondea a dos decimales. Negativo o cualquier otro texto → `"invalido"`.
 */
export function leerMonto(valor: unknown): number | null | typeof MONTO_INVALIDO {
  if (typeof valor !== "string") {
    if (valor == null) return null;
    if (typeof valor === "number") return Number.isFinite(valor) && valor >= 0 ? redondear2(valor) : MONTO_INVALIDO;
    return MONTO_INVALIDO;
  }
  const crudo = valor.trim();
  if (crudo === "") return null;
  // Un "S/" sin cifra no es un monto vacío sino uno mal escrito.
  const texto = crudo.replace(/^s\s*\/\s*\.?/i, "").replace(/\s+/g, "");
  if (!MONTO.test(texto)) return MONTO_INVALIDO;
  const n = Number(texto.replace(/,/g, ""));
  if (!Number.isFinite(n) || n < 0) return MONTO_INVALIDO;
  return redondear2(n);
}

export function redondear2(n: number): number {
  const r = Math.round(n * 100) / 100;
  return r === 0 ? 0 : r; // evita -0
}

const sinAcentos = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "");

const TIENDA = new Set(["", "TIENDA", "T"]);
const CD = new Set(["CD", "CENTRO DE DISTRIBUCION", "ALMACEN", "DISTRIBUCION", "CENTRO DISTRIBUCION"]);

/**
 * Regla 9. `""`, `TIENDA`, `T` → Tienda; `CD`, `CENTRO DE DISTRIBUCIÓN`,
 * `ALMACÉN`, `DISTRIBUCIÓN` → Centro de Distribución (sin distinguir caja ni
 * acentos); otra cosa → `null`. No se infiere del código.
 */
export function leerTipo(valor: unknown): TipoTienda | null {
  const v = sinAcentos(normalizarNombre(valor));
  if (TIENDA.has(v)) return "Tienda";
  if (CD.has(v)) return "Centro de Distribución";
  return null;
}

// ─── Legibles (reporte de diferencias) ───

export const VACIO_LEGIBLE = "—";

/** `2019-03-15` → `15/03/2019`; nulo → `—`. Una cadena que no sea ISO se devuelve tal cual. */
export function fechaLegible(iso: string | null | undefined): string {
  if (!iso) return VACIO_LEGIBLE;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

/** `85000` → `85000.00`; nulo → `—`. Sin separadores de miles: es para comparar, no para lucir. */
export function montoLegible(monto: number | null | undefined): string {
  if (monto === null || monto === undefined) return VACIO_LEGIBLE;
  return redondear2(monto).toFixed(2);
}

export function textoLegible(texto: string | null | undefined): string {
  return texto ? texto : VACIO_LEGIBLE;
}
