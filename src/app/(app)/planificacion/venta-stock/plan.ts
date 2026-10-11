import { estadoQlik } from "@/lib/ventas/informe";
import { leerNumero, redondear2, NUMERO_INVALIDO } from "@/lib/ventas/numeros";
import { MEDIDAS_DINERO, MEDIDAS_VENTA, TANDA_CLIENTE } from "@/lib/ventas/tipos";
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

const esDinero = (m: MedidaVenta) => (MEDIDAS_DINERO as readonly MedidaVenta[]).includes(m);

/**
 * Recalcula las columnas de QlikView de la conciliación de un mes con los
 * totales escritos (el informe se arma una sola vez; escribir un total no debe
 * recorrer 400 000 filas). Mismas reglas que `conciliarMes`: unidades y stock
 * exactos, soles con tolerancia relativa del 0,1 %.
 */
export function conciliarConQlik(filas: FilaConciliacion[], qlik: TotalesQlik | undefined): FilaConciliacion[] {
  return filas.map((f) => {
    const q = qlik?.[f.medida];
    const estado = estadoQlik(f.medida, q, f.archivo);
    if (q === undefined || estado === "sin_qlik") return { ...f, qlik: null, diferencia_qlik: null, diferencia_relativa: null, estado_qlik: "sin_qlik" };
    const dif = f.archivo - q;
    return {
      ...f,
      qlik: q,
      diferencia_qlik: esDinero(f.medida) ? redondear2(dif) : dif,
      diferencia_relativa: q !== 0 ? Math.abs(f.archivo - q) / Math.abs(q) : null,
      estado_qlik: estado,
    };
  });
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
