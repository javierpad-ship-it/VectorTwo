import { conciliarFilasConQlik } from "@/lib/ventas/conciliacion";
import { leerNumero, NUMERO_INVALIDO } from "@/lib/ventas/numeros";
import { MEDIDAS_VENTA, TANDA_CLIENTE } from "@/lib/ventas/tipos";
import type { FilaConciliacion, InformeCarga, InformeMes, MedidaVenta, TotalesQlik } from "@/lib/ventas/tipos";

/**
 * Funciones puras de la pantalla de carga (sin React): qué meses se cargan,
 * conciliación contra los totales de QlikView que escribe el usuario y
 * estimaciones de avance.
 */

export type OpcionesPlan = {
  /** Omite los meses "idénticos a lo ya cargado" (reanudar tras un corte). */
  saltarIdenticos: boolean;
  /** Carga también los meses bloqueados por errores >= 2 % (quedan Incompleto). */
  forzarBloqueados: boolean;
};

export type MotivoSalto = "sin_filas" | "identico" | "bloqueado";

export type PlanCarga = {
  cargar: InformeMes[];
  saltados: { mes: InformeMes; motivo: MotivoSalto }[];
};

export const ETIQUETA_SALTO: Record<MotivoSalto, string> = {
  sin_filas: "Sin filas que cargar",
  identico: "Idéntico a lo ya cargado",
  bloqueado: "Bloqueado por errores",
};

/** Qué meses del informe se cargan con las opciones elegidas y cuáles se saltan (y por qué). */
export function planificarCarga(informe: InformeCarga, opciones: OpcionesPlan): PlanCarga {
  const cargar: InformeMes[] = [];
  const saltados: PlanCarga["saltados"] = [];
  for (const mes of informe.meses) {
    if (mes.cargado.filas === 0) saltados.push({ mes, motivo: "sin_filas" });
    else if (opciones.saltarIdenticos && mes.estado === "identico") saltados.push({ mes, motivo: "identico" });
    else if (mes.bloqueado && !opciones.forzarBloqueados) saltados.push({ mes, motivo: "bloqueado" });
    else cargar.push(mes);
  }
  return { cargar, saltados };
}

/** Número de tandas de un mes (las que `tandasDeMes` armará). */
export function tandasDeUnMes(mes: Pick<InformeMes, "cargado">): number {
  return Math.max(1, Math.ceil(mes.cargado.filas / TANDA_CLIENTE));
}

// ─── Totales de QlikView ───

export type TextosQlik = Record<string, Partial<Record<MedidaVenta, string>>>;

/** Texto escrito por el usuario → número (acepta `7,913` y `1,234,567.50`); vacío o inválido → `undefined`. */
export function leerTotalQlik(texto: string | undefined): number | undefined {
  if (texto === undefined || texto.trim() === "") return undefined;
  const n = leerNumero(texto.trim());
  return n === NUMERO_INVALIDO ? undefined : n;
}

export function textoQlikInvalido(texto: string | undefined): boolean {
  return texto !== undefined && texto.trim() !== "" && leerTotalQlik(texto) === undefined;
}

/** Totales válidos de un mes. */
export function totalesQlikDe(textos: Partial<Record<MedidaVenta, string>> | undefined): TotalesQlik | undefined {
  if (!textos) return undefined;
  const t: TotalesQlik = {};
  for (const m of MEDIDAS_VENTA) {
    const n = leerTotalQlik(textos[m]);
    if (n !== undefined) t[m] = n;
  }
  return Object.keys(t).length > 0 ? t : undefined;
}

export function totalesQlikPorMes(textos: TextosQlik): Record<string, TotalesQlik> {
  const salida: Record<string, TotalesQlik> = {};
  for (const [periodo, t] of Object.entries(textos)) {
    const v = totalesQlikDe(t);
    if (v) salida[periodo] = v;
  }
  return salida;
}

/**
 * Recalcula las columnas de QlikView de la conciliación de un mes con los
 * totales escritos (el informe se arma una sola vez; escribir un total no debe
 * recorrer 400 000 filas). M5c: compara contra `f.comparable` (archivo menos lo
 * que QlikView no muestra), no contra `f.archivo`. La regla vive en
 * `src/lib/ventas/conciliacion.ts`.
 */
export function conciliarConQlik(filas: FilaConciliacion[], qlik: TotalesQlik | undefined): FilaConciliacion[] {
  return conciliarFilasConQlik(filas, qlik);
}

/** El informe con la conciliación de cada mes recalculada con los totales de QlikView escritos. */
export function informeConQlik(informe: InformeCarga, totales: Record<string, TotalesQlik>): InformeCarga {
  return { ...informe, meses: informe.meses.map((m) => ({ ...m, conciliacion: conciliarConQlik(m.conciliacion, totales[m.periodo]) })) };
}

/** Texto "mm:ss" estimado restante a partir del ritmo observado; `null` si todavía no hay ritmo. */
export function segundosRestantes(transcurridoSeg: number, hechas: number, totales: number): number | null {
  if (hechas <= 0 || totales <= hechas) return hechas >= totales ? 0 : null;
  return (transcurridoSeg / hechas) * (totales - hechas);
}
