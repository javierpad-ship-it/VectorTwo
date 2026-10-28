import type { HuecosApi, Senal, TarjetaHuecoApi } from "@/lib/flujo/tipos-api";
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

// ─── Capa de vista: tarjetas con el catálogo resuelto ───

/**
 * Una tarjeta de Huecos lista para la pantalla: los índices de `catalogo` ya resueltos a ids y nombres, y los campos opcionales del
 * contrato compacto (ausente = `0` / `null`) ya con su valor. Toda función de vista (filtros, conteos, opciones, textos) trabaja sobre
 * este tipo: el catálogo se resuelve UNA vez, en `aplanarTarjetas`.
 */
export type TarjetaVista = {
  clave: string;
  gml_id: string;
  equivalencia_id: string | null;
  agrupacion_marca_id: string;
  genero: string;
  mundo: string;
  linea: string;
  equivalencia: string | null;
  agrupacion_marca: string;
  responsable: { perfil_id: string; nombre: string } | null;
  mia: boolean;
  stock_cd: number;
  stock_total: number;
  senal: Senal;
  saldo_n_meses: number;
  imi_k: number | null;
  en_camino: number;
  primer_mes_falta: string | null;
  exceso_desde: string | null;
  por_confirmar: number;
  posible_doble_conteo: number;
  saldo_primer_mes: number;
  exceso_primer_mes: number;
  en_camino_primer_mes: { periodo: string; unidades: number } | null;
  falta_desde: string | null;
  subflujos: NonNullable<TarjetaHuecoApi["subflujos_resumen"]>;
};

const claveDe = (gml: string, eq: string | null, agr: string): string => `${gml}|${eq ?? ""}|${agr}`;

/** Resuelve el catálogo de la respuesta una sola vez y devuelve las tarjetas en el mismo orden (saldo descendente). */
export function aplanarTarjetas(h: Pick<HuecosApi, "catalogo" | "tarjetas">): TarjetaVista[] {
  const c = h.catalogo;
  return h.tarjetas.map((t) => {
    const nodo = c.nodos[t.nodo];
    const agr = c.agrupaciones[t.agrupacion];
    const r = t.resumen;
    const d = t.detalle;
    return {
      clave: claveDe(nodo.gml_id, nodo.equivalencia_id ?? null, agr.id),
      gml_id: nodo.gml_id,
      equivalencia_id: nodo.equivalencia_id ?? null,
      agrupacion_marca_id: agr.id,
      genero: c.generos[nodo.genero],
      mundo: c.mundos[nodo.mundo],
      linea: c.lineas[nodo.linea],
      equivalencia: nodo.equivalencia ?? null,
      agrupacion_marca: agr.nombre,
      responsable: c.responsables[`${nodo.genero}|${nodo.mundo}`] ?? null,
      mia: t.mia ?? false,
      stock_cd: t.stock_k.cd,
      stock_total: t.stock_k.total,
      senal: r.senal,
      saldo_n_meses: r.saldo_n_meses,
      imi_k: r.imi_k ?? null,
      en_camino: r.en_camino ?? 0,
      primer_mes_falta: r.primer_mes_falta ?? null,
      exceso_desde: r.exceso_desde ?? null,
      por_confirmar: r.por_confirmar ?? 0,
      posible_doble_conteo: r.posible_doble_conteo ?? 0,
      saldo_primer_mes: d.saldo_primer_mes ?? 0,
      exceso_primer_mes: d.exceso_primer_mes ?? 0,
      en_camino_primer_mes: d.en_camino_primer_mes ?? null,
      falta_desde: d.falta_desde ?? null,
      subflujos: t.subflujos_resumen ?? [],
    };
  });
}

/** Enlace al flujo de la fila (abre su detalle). */
export function enlaceFila(t: Pick<TarjetaVista, "gml_id" | "equivalencia_id" | "agrupacion_marca_id">): string {
  const q = new URLSearchParams({ gml: t.gml_id, agr: t.agrupacion_marca_id });
  if (t.equivalencia_id) q.set("eq", t.equivalencia_id);
  return `/compras/flujo?${q.toString()}`;
}

// ─── Filtros ───

type FiltrosTarjeta = Pick<ParametrosHuecos, "genero" | "mundo" | "linea" | "agrupacion">;

const coincide = (valor: string | null, filtro: string | null) => filtro === null || valor === filtro;

/** Género, mundo, línea y agrupación (por nombre). La línea de una unidad GMLE se compara por el nombre de la línea del nodo. */
export function filtrarPorArbol(ts: readonly TarjetaVista[], f: FiltrosTarjeta): TarjetaVista[] {
  return ts.filter((t) => coincide(t.genero, f.genero) && coincide(t.mundo, f.mundo) && coincide(t.linea, f.linea) && coincide(t.agrupacion_marca, f.agrupacion));
}

export function cumpleEstado(t: TarjetaVista, estado: EstadoHuecos): boolean {
  switch (estado) {
    case "falta":
      // «Falta» incluye el quiebre: en los dos casos hay que comprar.
      return t.senal === "falta" || t.senal === "quiebre";
    case "exceso":
      return t.senal === "exceso";
    case "por_confirmar":
      return t.por_confirmar > 0;
    default:
      return true;
  }
}

export function filtrarTarjetas(ts: readonly TarjetaVista[], p: ParametrosHuecos, alcance: AlcanceHuecos): TarjetaVista[] {
  return filtrarPorArbol(ts, p).filter((t) => (alcance === "todas" || t.mia) && cumpleEstado(t, p.estado));
}

/** Cuántas tarjetas hay por estado, con el alcance y el árbol ya aplicados (para los conteos de los chips). */
export function contarPorEstado(ts: readonly TarjetaVista[], p: ParametrosHuecos, alcance: AlcanceHuecos): Record<EstadoHuecos, number> {
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
export function opcionesHuecos(ts: readonly TarjetaVista[], p: Pick<ParametrosHuecos, "genero" | "mundo">) {
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
export function fraseTarjeta(t: TarjetaVista, meses: number): string {
  switch (t.senal) {
    case "sin_curva":
      return "Venta anual proyectada sin repartir por mes: no se calcula el IMI.";
    case "sin_demanda":
      return "Sin venta proyectada en el horizonte.";
    case "exceso":
      return t.exceso_desde ? `exceso desde ${nombreMes(t.exceso_desde)}: ${unidades(t.exceso_primer_mes)} u` : "El stock supera el tope.";
    case "falta":
    case "quiebre": {
      const mes = t.primer_mes_falta;
      const cabeza = t.senal === "quiebre" ? "quiebre: el stock se agota" : "falta";
      if (!mes) return `${cabeza} en los próximos ${meses} meses`;
      const desde = t.falta_desde && t.falta_desde !== mes ? ` y desde ${nombreMes(t.falta_desde)}` : "";
      return `${cabeza} en ${nombreMes(mes)} (${unidades(t.saldo_primer_mes)})${desde}`;
    }
    default:
      return `Sin faltas en los próximos ${meses} meses.`;
  }
}

/** `500 u` y el primer mes en que llega (`nov`); `0 u` sin detalle si no hay nada en camino. */
export function textoEnCamino(t: TarjetaVista): { cifra: string; detalle: string | null } {
  if (t.en_camino <= 0) return { cifra: "0 u", detalle: null };
  const mes = t.en_camino_primer_mes;
  return { cifra: `${unidades(t.en_camino)} u`, detalle: mes ? nombreMes(mes.periodo) : null };
}
