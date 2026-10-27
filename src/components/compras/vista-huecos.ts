import type { TarjetaHuecoApi } from "@/lib/flujo/tipos-api";
import type { Rol } from "@/lib/auth/roles";
import { nombreMes, unidades } from "./formato";

/**
 * Lógica de la pantalla Huecos (`/compras`, ficha 08 §4.2): parámetros de la URL, filtros y textos de la tarjeta. Pura. Los filtros de
 * alcance («Mis líneas»), estado y de género, mundo, línea y agrupación se aplican en el navegador sobre las tarjetas que ya llegaron
 * (`GET /api/flujo/huecos` trae todas, hasta 0,4 MB): así los chips responden al instante y el comprador abre en «Mis líneas» sin una
 * segunda lectura. Solo `meses` (los próximos N meses del saldo) viaja al servidor porque cambia las cifras.
 */

export type AlcanceHuecos = "mias" | "todas";
export type EstadoHuecos = "todos" | "falta" | "exceso" | "por_confirmar";

export const ORDEN_ESTADO: readonly EstadoHuecos[] = ["falta", "exceso", "por_confirmar", "todos"];
export const ETIQUETA_ESTADO: Record<EstadoHuecos, string> = { falta: "Falta", exceso: "Exceso", por_confirmar: "Por confirmar", todos: "Todos" };

/** Opciones del selector «próximos N meses» (más el valor de los parámetros, si es otro). */
export const OPCIONES_MESES = [3, 6, 9, 12] as const;

export type ParametrosHuecos = {
  /** `null` = el valor por defecto de cada rol. */
  alcance: AlcanceHuecos | null;
  estado: EstadoHuecos;
  /** `null` = `parametros.meses_tarjeta`. */
  meses: number | null;
  genero: string | null;
  mundo: string | null;
  linea: string | null;
  agrupacion: string | null;
};

export const PARAMETROS_HUECOS_VACIOS: ParametrosHuecos = { alcance: null, estado: "todos", meses: null, genero: null, mundo: null, linea: null, agrupacion: null };

const ALCANCES: readonly AlcanceHuecos[] = ["mias", "todas"];

export function leerParametrosHuecos(get: (clave: string) => string | null): ParametrosHuecos {
  const alcance = get("alcance");
  const estado = get("estado");
  const meses = Number(get("meses"));
  const texto = (k: string) => {
    const v = get(k);
    return v === null || v.trim() === "" ? null : v;
  };
  return {
    alcance: ALCANCES.includes(alcance as AlcanceHuecos) ? (alcance as AlcanceHuecos) : null,
    estado: ORDEN_ESTADO.includes(estado as EstadoHuecos) ? (estado as EstadoHuecos) : "todos",
    meses: Number.isInteger(meses) && meses >= 1 && meses <= 24 ? meses : null,
    genero: texto("genero"),
    mundo: texto("mundo"),
    linea: texto("linea"),
    agrupacion: texto("agrupacion"),
  };
}

export function consultaHuecos(p: ParametrosHuecos): string {
  const q = new URLSearchParams();
  if (p.alcance) q.set("alcance", p.alcance);
  if (p.estado !== "todos") q.set("estado", p.estado);
  if (p.meses !== null) q.set("meses", String(p.meses));
  if (p.genero) q.set("genero", p.genero);
  if (p.mundo) q.set("mundo", p.mundo);
  if (p.linea) q.set("linea", p.linea);
  if (p.agrupacion) q.set("agrupacion", p.agrupacion);
  return q.toString();
}

/** El alcance que rige: el de la URL; sin él, «Mis líneas» para un comprador con combinaciones y «Todas» para el resto (decisión 28). */
export function alcanceEfectivo(p: ParametrosHuecos, rol: Rol, combinaciones: number): AlcanceHuecos {
  if (p.alcance) return p.alcance;
  return rol === "comprador" && combinaciones > 0 ? "mias" : "todas";
}

export const claveTarjeta = (t: Pick<TarjetaHuecoApi, "gml_id" | "equivalencia_id" | "agrupacion_marca_id">): string => `${t.gml_id}|${t.equivalencia_id ?? ""}|${t.agrupacion_marca_id}`;

/** Enlace al flujo de la fila (abre su detalle). */
export function enlaceFila(t: Pick<TarjetaHuecoApi, "gml_id" | "equivalencia_id" | "agrupacion_marca_id">): string {
  const q = new URLSearchParams({ gml: t.gml_id, agr: t.agrupacion_marca_id });
  if (t.equivalencia_id) q.set("eq", t.equivalencia_id);
  return `/compras/flujo?${q.toString()}`;
}

// ─── Filtros ───

type FiltrosTarjeta = Pick<ParametrosHuecos, "genero" | "mundo" | "linea" | "agrupacion">;

const coincide = (valor: string | null, filtro: string | null) => filtro === null || valor === filtro;

/** Género, mundo, línea y agrupación (por nombre). La línea de una unidad GMLE se compara por el nombre de la línea del nodo. */
export function filtrarPorArbol(ts: readonly TarjetaHuecoApi[], f: FiltrosTarjeta): TarjetaHuecoApi[] {
  return ts.filter((t) => coincide(t.genero, f.genero) && coincide(t.mundo, f.mundo) && coincide(t.linea, f.linea) && coincide(t.agrupacion_marca, f.agrupacion));
}

export function cumpleEstado(t: TarjetaHuecoApi, estado: EstadoHuecos): boolean {
  switch (estado) {
    case "falta":
      // «Falta» incluye el quiebre: en los dos casos hay que comprar.
      return t.resumen.senal === "falta" || t.resumen.senal === "quiebre";
    case "exceso":
      return t.resumen.senal === "exceso";
    case "por_confirmar":
      return t.resumen.por_confirmar > 0;
    default:
      return true;
  }
}

export function filtrarTarjetas(ts: readonly TarjetaHuecoApi[], p: ParametrosHuecos, alcance: AlcanceHuecos): TarjetaHuecoApi[] {
  return filtrarPorArbol(ts, p).filter((t) => (alcance === "todas" || t.mia) && cumpleEstado(t, p.estado));
}

/** Cuántas tarjetas hay por estado, con el alcance y el árbol ya aplicados (para los conteos de los chips). */
export function contarPorEstado(ts: readonly TarjetaHuecoApi[], p: ParametrosHuecos, alcance: AlcanceHuecos): Record<EstadoHuecos, number> {
  const base = filtrarPorArbol(ts, p).filter((t) => alcance === "todas" || t.mia);
  return {
    todos: base.length,
    falta: base.filter((t) => cumpleEstado(t, "falta")).length,
    exceso: base.filter((t) => cumpleEstado(t, "exceso")).length,
    por_confirmar: base.filter((t) => cumpleEstado(t, "por_confirmar")).length,
  };
}

const ordenar = (valores: Iterable<string>) => [...new Set(valores)].sort((a, b) => a.localeCompare(b, "es"));

/** Opciones en cascada: los mundos de los géneros elegidos, las líneas de ese género y mundo; las agrupaciones, todas las vistas. */
export function opcionesHuecos(ts: readonly TarjetaHuecoApi[], p: Pick<ParametrosHuecos, "genero" | "mundo">) {
  const porGenero = ts.filter((t) => coincide(t.genero, p.genero));
  const porMundo = porGenero.filter((t) => coincide(t.mundo, p.mundo));
  return {
    generos: ordenar(ts.map((t) => t.genero)),
    mundos: ordenar(porGenero.map((t) => t.mundo)),
    lineas: ordenar(porMundo.map((t) => t.linea)),
    agrupaciones: ordenar(ts.map((t) => t.agrupacion_marca)),
  };
}

// ─── Textos de la tarjeta ───

/** Rótulo del saldo: `Saldo oct–mar` (de `k'+1` al mes `N`). `periodos` = `[k', k'+1 … H]`. */
export function rotuloSaldo(periodos: readonly string[], meses: number): string {
  const primero = periodos[1];
  const ultimo = periodos[Math.min(meses, periodos.length - 1)];
  if (!primero || !ultimo) return "Saldo por comprar";
  return primero === ultimo ? `Saldo ${nombreMes(primero)}` : `Saldo ${nombreMes(primero)}–${nombreMes(ultimo)}`;
}

/** La frase de pie de tarjeta: lo que falta, lo que sobra o por qué no hay cifras. */
export function fraseTarjeta(t: TarjetaHuecoApi, meses: number): string {
  const { resumen, detalle } = t;
  switch (resumen.senal) {
    case "sin_curva":
      return "Venta anual proyectada sin repartir por mes: no se calcula el IMI.";
    case "sin_demanda":
      return "Sin venta proyectada en el horizonte.";
    case "exceso":
      return resumen.exceso_desde ? `exceso desde ${nombreMes(resumen.exceso_desde)}: ${unidades(detalle.exceso_primer_mes)} u` : "El stock supera el tope.";
    case "falta":
    case "quiebre": {
      const mes = resumen.primer_mes_falta;
      const cabeza = resumen.senal === "quiebre" ? "quiebre: el stock se agota" : "falta";
      if (!mes) return `${cabeza} en los próximos ${meses} meses`;
      const desde = detalle.falta_desde && detalle.falta_desde !== mes ? ` y desde ${nombreMes(detalle.falta_desde)}` : "";
      return `${cabeza} en ${nombreMes(mes)} (${unidades(detalle.saldo_primer_mes)})${desde}`;
    }
    default:
      return `Sin faltas en los próximos ${meses} meses.`;
  }
}

/** `500 u` y el primer mes en que llega (`nov`); `0 u` sin detalle si no hay nada en camino. */
export function textoEnCamino(t: TarjetaHuecoApi): { cifra: string; detalle: string | null } {
  if (t.resumen.en_camino <= 0) return { cifra: "0 u", detalle: null };
  const mes = t.detalle.en_camino_primer_mes;
  return { cifra: `${unidades(t.resumen.en_camino)} u`, detalle: mes ? nombreMes(mes.periodo) : null };
}
