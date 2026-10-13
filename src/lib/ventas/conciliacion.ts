import { aCentimos, redondear2 } from "./numeros";
import {
  BASE_CONCILIACION,
  BASE_CONCILIACION_ANTIGUA,
  MEDIDAS_DINERO,
  MEDIDAS_VENTA,
  TOLERANCIA_CONCILIACION,
  TOLERANCIA_UNIDADES,
  type BaseConciliacion,
  type EstadoConciliacionQlik,
  type FilaConciliacion,
  type MedidaVenta,
  type TotalesQlik,
} from "./tipos";

/**
 * Conciliación contra QlikView (M5c, docs/modulos/05c-ubicaciones-conciliacion.md,
 * sección B). Lógica pura que comparten el informe, la pantalla de carga y el
 * detalle de una carga guardada. Se compara siempre contra la base
 * **comparable** (`archivo - no_comparable`), no contra el archivo completo.
 *
 * Tolerancia: unidades y stock en unidades, `TOLERANCIA_UNIDADES` (tipos.ts; hoy
 * 0 = exactas); venta, costo y stock valorizado, diferencia relativa menor a
 * `TOLERANCIA_CONCILIACION` (0,1 %).
 */

const esDinero = (m: MedidaVenta) => (MEDIDAS_DINERO as readonly MedidaVenta[]).includes(m);

/**
 * Regla 21 (con la base de M5c). Unidades y stock en unidades coinciden con una
 * diferencia absoluta de hasta `toleranciaUnidades` (por defecto
 * `TOLERANCIA_UNIDADES`); venta, costo y stock valorizado, con diferencia
 * relativa menor a 0,1 % (`0,0999 %` coincide y `0,1 %` no), en céntimos
 * enteros y sin deriva de coma flotante. `qlik` es el total de QlikView y
 * `comparable`, el del archivo menos lo que QlikView no muestra.
 */
export function coincideConQlik(
  medida: MedidaVenta,
  qlik: number,
  comparable: number,
  toleranciaUnidades: number = TOLERANCIA_UNIDADES
): boolean {
  if (!esDinero(medida)) return Math.abs(comparable - qlik) <= toleranciaUnidades;
  const q = aCentimos(qlik);
  const a = aCentimos(comparable);
  const dif = Math.abs(a - q);
  if (q === 0) return dif === 0;
  // dif / |q| < 0,1 % sin dividir: exacto en céntimos enteros.
  return dif * (1 / TOLERANCIA_CONCILIACION) < Math.abs(q);
}

export function estadoQlik(
  medida: MedidaVenta,
  qlik: number | null | undefined,
  comparable: number
): EstadoConciliacionQlik {
  if (qlik === null || qlik === undefined || !Number.isFinite(qlik)) return "sin_qlik";
  return coincideConQlik(medida, qlik, comparable) ? "coincide" : "difiere";
}

/**
 * Recalcula las columnas de QlikView de la conciliación de un mes con los
 * totales escritos, sin recorrer el archivo: compara contra `f.comparable`.
 * Mismas reglas que `conciliarMes` (informe.ts).
 */
export function conciliarFilasConQlik(filas: readonly FilaConciliacion[], qlik: TotalesQlik | undefined): FilaConciliacion[] {
  return filas.map((f) => {
    const q = qlik?.[f.medida];
    const estado = estadoQlik(f.medida, q, f.comparable);
    if (q === undefined || estado === "sin_qlik") {
      return { ...f, qlik: null, diferencia_qlik: null, diferencia_relativa: null, estado_qlik: "sin_qlik" };
    }
    const dif = f.comparable - q;
    return {
      ...f,
      qlik: q,
      diferencia_qlik: esDinero(f.medida) ? redondear2(dif) : dif,
      diferencia_relativa: q !== 0 ? Math.abs(dif) / Math.abs(q) : null,
      estado_qlik: estado,
    };
  });
}

// ─── Reportes guardados (compatibilidad con 0.8.0) ───

/** Nota que se muestra junto a la conciliación de un reporte sin `base_conciliacion` (carga hecha con 0.8.0). */
export const NOTA_CONCILIACION_080 =
  "Esta carga concilió contra el archivo completo (versión 0.8.0); desde 0.8.2 se concilia contra el comparable.";

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const ESTADOS: readonly EstadoConciliacionQlik[] = ["coincide", "difiere", "sin_qlik"];

/**
 * Una fila de `reporte.conciliacion` tal como se guardó. Las de 0.8.0 no traen
 * `comparable` ni `no_comparable`: se completan con `comparable = archivo` y
 * `no_comparable = 0`, y `base` queda en `"archivo"`. `null` si la fila no es
 * legible (no tiene medida conocida ni `archivo` numérico).
 */
export function leerFilaConciliacionGuardada(
  crudo: unknown
): { fila: FilaConciliacion; base: BaseConciliacion } | null {
  if (!esObjeto(crudo)) return null;
  const medida = (MEDIDAS_VENTA as readonly unknown[]).includes(crudo.medida) ? (crudo.medida as MedidaVenta) : null;
  const archivo = num(crudo.archivo);
  if (medida === null || archivo === null) return null;
  const comparable = num(crudo.comparable);
  const estado = ESTADOS.find((e) => e === crudo.estado_qlik) ?? "sin_qlik";
  return {
    base: comparable === null ? BASE_CONCILIACION_ANTIGUA : BASE_CONCILIACION,
    fila: {
      medida,
      qlik: num(crudo.qlik),
      archivo,
      no_comparable: num(crudo.no_comparable) ?? 0,
      comparable: comparable ?? archivo,
      excluido: num(crudo.excluido) ?? 0,
      cargado: num(crudo.cargado) ?? 0,
      descuadre: num(crudo.descuadre) ?? 0,
      diferencia_qlik: num(crudo.diferencia_qlik),
      diferencia_relativa: num(crudo.diferencia_relativa),
      estado_qlik: estado,
    },
  };
}

/**
 * La conciliación de un reporte guardado, lista para mostrar. `base` es
 * `"comparable"` solo si el reporte la declara (`base_conciliacion`); si falta
 * (0.8.0), `"archivo"` y la pantalla muestra `NOTA_CONCILIACION_080`.
 */
export function leerConciliacionGuardada(reporte: unknown): { filas: FilaConciliacion[]; base: BaseConciliacion } {
  const r = esObjeto(reporte) ? reporte : {};
  const filas = (Array.isArray(r.conciliacion) ? r.conciliacion : [])
    .map(leerFilaConciliacionGuardada)
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .map((x) => x.fila);
  return { filas, base: r.base_conciliacion === BASE_CONCILIACION ? BASE_CONCILIACION : BASE_CONCILIACION_ANTIGUA };
}

// ─── Textos de estado ───

export type NivelEstadoQlik = "exacto" | "tolerancia" | "difiere" | "sin_qlik";

const NBSP = " ";

/** `12345` → `12 345` (espacio duro). */
function agrupar(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
}

/**
 * Porcentaje (de una fracción) con coma decimal: 1,2 · 0,12 · 0,0018. TRUNCA hacia abajo en vez de
 * redondear, para que una diferencia de 0,099996 % no se lea "0,1" dentro de un "Coincide" (la regla
 * es "< 0,1 %") ni una de 0,9996 % como "1". Una diferencia positiva por debajo de la última cifra
 * mostrada sale "<0,0001".
 */
export function formatearPorcentaje(fraccion: number): string {
  const p = Math.abs(fraccion) * 100;
  const dec = p >= 1 ? 1 : p >= 0.1 ? 2 : 4;
  const k = 10 ** dec;
  const truncado = Math.floor(p * k + 1e-9) / k; // el épsilon absorbe 0,0999 × 100 = 0,09989999…
  if (truncado === 0) return p > 0 ? "<0,0001" : "0";
  return truncado.toFixed(dec).replace(/\.?0+$/, "").replace(".", ",");
}

function cifra(medida: MedidaVenta, abs: number): string {
  if (esDinero(medida)) {
    return abs >= 1 ? `S/${NBSP}${agrupar(abs)}` : `S/${NBSP}${abs.toFixed(2).replace(".", ",")}`;
  }
  return `${agrupar(abs)}${NBSP}${abs === 1 ? "unidad" : "unidades"}`;
}

/**
 * Texto de la celda "Comparable frente a QlikView" y su nivel (para el color).
 *   - `Coincide (exacto)` con diferencia 0.
 *   - `Coincide dentro de la tolerancia: S/ 143 (0,004 %)` con diferencia distinta de 0.
 *   - `Difiere: 1 unidad (0,0018 %)` / `Difiere: S/ 12 345 (1,2 %)` (ámbar).
 *   - `Sin total de QlikView` si no se escribió (no es un error).
 */
export function textoEstadoQlik(f: Pick<FilaConciliacion, "medida" | "estado_qlik" | "diferencia_qlik" | "diferencia_relativa">): {
  nivel: NivelEstadoQlik;
  texto: string;
} {
  if (f.estado_qlik === "sin_qlik" || f.diferencia_qlik === null) return { nivel: "sin_qlik", texto: "Sin total de QlikView" };
  const abs = Math.abs(f.diferencia_qlik);
  const pct = f.diferencia_relativa !== null ? ` (${formatearPorcentaje(f.diferencia_relativa)}${NBSP}%)` : "";
  if (f.estado_qlik === "coincide") {
    return abs === 0
      ? { nivel: "exacto", texto: "Coincide (exacto)" }
      : { nivel: "tolerancia", texto: `Coincide dentro de la tolerancia: ${cifra(f.medida, abs)}${pct}` };
  }
  return { nivel: "difiere", texto: `Difiere: ${cifra(f.medida, abs)}${pct}` };
}
