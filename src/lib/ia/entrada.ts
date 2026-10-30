import { claveIncluye } from "@/lib/proyeccion/bloques";
import { claveFila } from "@/lib/proyeccion/tipos";
import { UMBRAL_DISPONIBILIDAD } from "@/lib/proyeccion/tipos-api";
import { controlFinal, crearAliasador, type Aliasador, type EntradaDiccionarioAlias, type HallazgoPrivacidad, type TerminoPrivado } from "./alias";
import { canonico, type ValorCanonico } from "./canonico";
import { senalesTiendas } from "./aportes";
import { huellaEntrada } from "./huellas";
import {
  ANIOS_REL,
  type AnioRel,
  type AnioRelComparable,
  type BloqueGMIa,
  type ContextoEntradaIa,
  type DiccionarioEntradaIa,
  type EntradaLineasIa,
  type FactorNinoEntradaIa,
  type FilaEntradaIa,
  type GMEntradaIa,
  type LineaEntradaIa,
  type MetaEntradaIa,
  type PasoPlanIa,
  type SufijoNaturalIa,
  type SufijoRepartoIa,
  type TemporadaIa,
} from "./tipos";
import { MAX_FILAS_LLAMADA_DEFECTO, VERSION_ENTRADA, type SenalIa } from "./tipos-api";

/**
 * Entrada al proveedor (ficha 07e, §3.5; R10 y R28). Puro. Se arma por LISTA BLANCA: cada campo se copia de una estructura tipada, sin
 * `...spread` de filas de la base. Cifras enteras, porcentajes con un decimal, ningún año real (todo relativo al año en curso `A`),
 * ids cortos (`f001`, `l01`) y alias para marcas, tiendas y términos privados. Al final, el control de salida recorre el JSON entero:
 * si algo prohibido sobrevive, el GM queda `bloqueado_privacidad` y no se envía.
 *
 * El bloque del lote es idéntico en la llamada natural y en la de reparto. No lleva meta, `g` ni propuesta del método (D9).
 */

// ─── Lo que recibe el armador ───

export type FilaDatosIa = {
  /** `proyeccion_filas.clave`: ordena las filas y la une con su cifra al volver. */
  clave: string;
  linea_id: string;
  linea: string;
  equivalencia_id: string | null;
  equivalencia: string | null;
  agrupacion_marca_id: string;
  agrupacion_marca: string;
  temporada: TemporadaIa;
  /** `cola_larga` no viaja (D4): va resumida en `gm.cola_larga`. */
  estado: "libre" | "fija" | "cola_larga";
  /** Unidades por mes (doce, enero primero) de `M(Z)` por AÑO REAL. El año en curso viene completo y aquí se recorta a `k`. */
  meses_por_anio: Readonly<Record<number, readonly number[]>>;
  comparable_pct: Partial<Record<AnioRelComparable, number | null>>;
  y: { vendido: number; vigente: number | null; avance: number | null; metodo: string; decidido: boolean };
  y1: { base: number | null; base_corregida: number | null; aporte_entrantes: number; aporte_salientes: number; fija_en: number | null };
  /** Crudo; la lista de señales sale de `senalesDeFila`. */
  senales: {
    meses_quiebre_w12: number;
    disponibilidad: number | null;
    meses_desde_primera_venta: number;
    meses_con_venta_24: number;
    /** `φ_{A,m}` de la fila, o `null` sin Niño. */
    factores_mes_y: readonly number[] | null;
    /** Avisos de la fila que son señales: `temporadas_mezcladas`, `avance_bajo`, `plan_anterior`, `revision_cola_larga`. */
    avisos: readonly string[];
  };
};

export type DatosGM = {
  genero: string;
  mundo: string;
  es_resto: boolean;
  /** `Y` real: solo sirve para pasar a años relativos; nunca sale. */
  anio_en_curso: number;
  ultimo_mes_cerrado: number;
  nino: { anio: number; temporada: "invierno" | "verano"; meses: readonly number[]; factor: number }[];
  umbral_cola_larga: number;
  fuera_de_meta: { aperturas_y1: number; cierres_y1: number };
  /** Variación comparable del GM entero por año relativo. */
  comparable_gm: Partial<Record<AnioRelComparable, number | null>>;
  /** Variación comparable por línea (`linea_id`), para la llamada `lineas`. */
  comparable_por_linea?: Readonly<Record<string, Partial<Record<AnioRelComparable, number | null>>>>;
  filas: readonly FilaDatosIa[];
};

export type OpcionesArmado = {
  terminos: readonly TerminoPrivado[];
  /** Por defecto, `crearAliasador(terminos)`. */
  aliasador?: Aliasador;
  max_filas_llamada?: number;
};

// ─── Redondeos ───

const entero = (x: number): number => Math.round(x);
const decimal1 = (x: number | null | undefined): number | null => (x === null || x === undefined || !Number.isFinite(x) ? null : Math.round(x * 10) / 10);
const decimal2 = (x: number | null): number | null => (x === null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);
const porTexto = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const pad = (n: number, ancho: number): string => String(n).padStart(ancho, "0");

// ─── Señales del código (§3.5) ───

const ORDEN_SENALES: readonly SenalIa[] = [
  "dato_insuficiente",
  "linea_nueva",
  "quiebres",
  "nino",
  "temporadas_mezcladas",
  "avance_bajo",
  "plan_anterior",
  "revision_cola_larga",
  "tiendas_entrantes",
  "tiendas_salientes",
];
const SENALES_DE_AVISO: readonly SenalIa[] = ["temporadas_mezcladas", "avance_bajo", "plan_anterior", "revision_cola_larga"];

export function senalesDeFila(a: {
  meses_con_venta_24: number;
  meses_desde_primera_venta: number;
  meses_quiebre_w12: number;
  disponibilidad: number | null;
  factores_mes_y: readonly number[] | null;
  avisos: readonly string[];
  aportes: { entrantes: number; salientes: number };
  base: number | null;
}): SenalIa[] {
  const s = new Set<SenalIa>();
  if (a.meses_con_venta_24 < 12) s.add("dato_insuficiente");
  if (a.meses_desde_primera_venta <= 18) s.add("linea_nueva");
  if (a.meses_quiebre_w12 >= 3 || (a.disponibilidad !== null && a.disponibilidad < UMBRAL_DISPONIBILIDAD)) s.add("quiebres");
  if (a.factores_mes_y?.some((f) => f !== 1)) s.add("nino");
  for (const aviso of a.avisos) if ((SENALES_DE_AVISO as readonly string[]).includes(aviso)) s.add(aviso as SenalIa);
  for (const t of senalesTiendas(a.aportes, a.base)) s.add(t);
  return ORDEN_SENALES.filter((x) => s.has(x));
}

// ─── Lectura compacta de `venta_lineas_ia` y variación comparable (§2.10, §5.1) ───

export type VentaLineasIaApi = {
  dic: { filas: [string, string, string | null][]; claves: string[]; desde: string };
  f: number[];
  c: number[];
  p: number[];
  u: number[];
  cargas?: Record<string, string>;
};
export type RegistroVentaIa = { clave: string; anio: number; mes: number; unidades: number };

/** Desempaqueta el agregado compacto: `claveFila(null, gml, equivalencia, agrupación de marca) → registros`. */
export function desempaquetarVentaLineasIa(v: VentaLineasIaApi): Map<string, RegistroVentaIa[]> {
  const desdeAnio = Number(v.dic.desde.slice(0, 4));
  const desdeMes = Number(v.dic.desde.slice(5, 7));
  const salida = new Map<string, RegistroVentaIa[]>();
  for (let i = 0; i < v.u.length; i++) {
    const [gml, marca, equivalencia] = v.dic.filas[v.f[i]];
    const indice = desdeAnio * 12 + (desdeMes - 1) + v.p[i];
    const clave = claveFila(null, gml, equivalencia, marca);
    const lista = salida.get(clave) ?? [];
    lista.push({ clave: v.dic.claves[v.c[i]], anio: Math.floor(indice / 12), mes: (indice % 12) + 1, unidades: v.u[i] });
    salida.set(clave, lista);
  }
  return salida;
}

/**
 * Variación comparable de `Z` en % (sin redondear): `U(Z) ÷ U(Z−1) − 1` sumando solo las claves con `1` en `M(Z)` y `M(Z+1)`. Para el
 * año en curso, solo los meses `1…k`. `null` si el denominador es 0.
 */
export function comparablePct(registros: readonly RegistroVentaIa[], a: { anioEnCurso: number; k: number; anio: number }): number | null {
  const tope = a.anio === a.anioEnCurso ? a.k : 12;
  let actual = 0;
  let anterior = 0;
  for (const r of registros) {
    if (r.mes > tope) continue;
    if (r.anio !== a.anio && r.anio !== a.anio - 1) continue;
    if (!claveIncluye(r.clave, a.anioEnCurso, a.anio) || !claveIncluye(r.clave, a.anioEnCurso, a.anio + 1)) continue;
    if (r.anio === a.anio) actual += r.unidades;
    else anterior += r.unidades;
  }
  return anterior > 0 ? (actual / anterior - 1) * 100 : null;
}

/** `meses_con_venta_24` (meses con venta entre los últimos 24 hasta `k`) y `meses_desde_primera_venta`, sobre todas las tiendas. */
export function estadisticasVenta(registros: readonly RegistroVentaIa[], a: { anioEnCurso: number; k: number }): { meses_con_venta_24: number; meses_desde_primera_venta: number } {
  const ref = a.anioEnCurso * 12 + a.k;
  const porMes = new Map<number, number>();
  for (const r of registros) {
    const idx = r.anio * 12 + r.mes;
    if (idx > ref) continue;
    porMes.set(idx, (porMes.get(idx) ?? 0) + r.unidades);
  }
  let conVenta = 0;
  let primero: number | null = null;
  for (const [idx, u] of porMes) {
    if (!(u > 0)) continue;
    if (idx > ref - 24) conVenta += 1;
    if (primero === null || idx < primero) primero = idx;
  }
  return { meses_con_venta_24: conVenta, meses_desde_primera_venta: primero === null ? 0 : ref - primero };
}

// ─── Lista blanca de claves (control final) ───

const claves = (...grupos: string[][]): ReadonlySet<string> => new Set(grupos.flat());
const CLAVES_ANIO = ["A-3", "A-2", "A-1", "A"];
const CLAVES_CONTEXTO = ["contexto", "ultimo_mes_cerrado", "objetivo", "objetivo_normal", "nino", "anio", "temporada", "meses", "factor", "umbral_cola_larga"];
const CLAVES_GM = ["gm", "id", "genero", "mundo", "es_resto", "historia", "unidades", "comparable_pct", "fuera_de_meta", "aperturas_y1", "cierres_y1", "cola_larga", "filas", "unidades_y1"];
export const CLAVES_BLOQUE: ReadonlySet<string> = claves(
  ["version_entrada", "lote", "n", "de", "f", "l", "linea", "equivalencia", "agrupacion_marca", "estado", "y", "vendido", "vigente", "avance", "metodo", "decidido"],
  ["y1", "base", "base_corregida", "aporte_entrantes", "aporte_salientes", "fija_en", "pedir", "senales", "lista", "meses_quiebre_w12", "disponibilidad", "meses_desde_primera_venta", "meses_con_venta_24"],
  CLAVES_CONTEXTO,
  CLAVES_GM,
  CLAVES_ANIO
);
const CLAVES_META = ["meta", "pct", "sobre", "total", "fijas", "libre", "provisional", "del_lote"];
export const CLAVES_SUFIJO: ReadonlySet<string> = claves(["tarea", "naturales", "f", "natural_y1"], CLAVES_META);
export const CLAVES_LINEAS: ReadonlySet<string> = claves(
  ["version_entrada", "lineas", "l", "linea", "filas_libres", "historia", "comparable_pct", "base_corregida", "natural_y1", "fijas"],
  CLAVES_CONTEXTO,
  CLAVES_GM,
  CLAVES_META,
  CLAVES_ANIO
);

// ─── Resultados ───

export type EntradaArmada<T> = { entrada: T; contenido: string; huella: string; bytes: number };
export type ResultadoEntrada<T> = ({ ok: true } & EntradaArmada<T>) | { ok: false; motivo: "bloqueado_privacidad"; hallazgos: HallazgoPrivacidad[] };

function sellar<T extends ValorCanonico>(entrada: T, terminos: readonly TerminoPrivado[], permitidas: ReadonlySet<string>): ResultadoEntrada<T> {
  const control = controlFinal(entrada, terminos, permitidas);
  if (!control.ok) return { ok: false, motivo: "bloqueado_privacidad", hallazgos: control.hallazgos };
  const contenido = canonico(entrada);
  return { ok: true, entrada, contenido, huella: huellaEntrada(entrada), bytes: Buffer.byteLength(contenido, "utf8") };
}

// ─── Armado del bloque ───

export type LoteArmado = Omit<EntradaArmada<BloqueGMIa>, "entrada"> & {
  bloque: BloqueGMIa;
  /** `f` de las filas libres (las que se piden). */
  filas_libres: string[];
  /** Ids cortos y alias del lote (`ia_entradas.diccionario`). */
  diccionario: DiccionarioEntradaIa;
};

/** Base de una línea para la llamada `lineas` (sin la natural, que se conoce después). */
export type LineaBaseIa = Omit<LineaEntradaIa, "natural_y1"> & { filas_libres_f: string[] };

export type PlanEntradaGM = {
  modo: "directo" | "jerarquico";
  lotes: LoteArmado[];
  lineas: LineaBaseIa[];
  plan: PasoPlanIa[];
  contexto: ContextoEntradaIa;
  gm: GMEntradaIa;
  /** `linea_partida`: una línea con más filas que `max_filas_llamada` se partió por `clave`. */
  avisos: "linea_partida"[];
};

export type ResultadoArmado = ({ ok: true } & PlanEntradaGM) | { ok: false; motivo: "bloqueado_privacidad"; hallazgos: HallazgoPrivacidad[] };

/** Plan de un GM (§3.8): directo `n1, r1`; jerárquico `n1…nk, l, r1…rk`. */
export function planDeGM(modo: "directo" | "jerarquico", lotes: number): PasoPlanIa[] {
  if (lotes <= 0) return [];
  const n = Array.from({ length: lotes }, (_, i) => ({ id: `n${i + 1}`, tipo: "natural" as const, lote: i + 1 }));
  const r = Array.from({ length: lotes }, (_, i) => ({ id: `r${i + 1}`, tipo: "reparto" as const, lote: i + 1 }));
  return modo === "directo" ? [...n, ...r] : [...n, { id: "l", tipo: "lineas" as const, lote: 0 }, ...r];
}

function relativo(anio: number, anioEnCurso: number): AnioRel | null {
  const d = anio - anioEnCurso;
  return d >= -3 && d <= 0 ? (ANIOS_REL[d + 3] as AnioRel) : null;
}

function mesesRelativos(f: FilaDatosIa, anioEnCurso: number, k: number): Partial<Record<AnioRel, number[]>> {
  const salida: Partial<Record<AnioRel, number[]>> = {};
  for (const [a, meses] of Object.entries(f.meses_por_anio)) {
    const rel = relativo(Number(a), anioEnCurso);
    if (rel === null) continue;
    salida[rel] = meses.slice(0, rel === "A" ? k : 12).map((m) => Math.max(0, entero(m)));
  }
  return salida;
}

const sumar = (xs: readonly number[] | undefined): number => (xs ?? []).reduce((a, b) => a + b, 0);

function comparableEntrada(c: Partial<Record<AnioRelComparable, number | null>>): Partial<Record<AnioRelComparable, number | null>> {
  const salida: Partial<Record<AnioRelComparable, number | null>> = {};
  for (const k of ["A-2", "A-1", "A"] as const) if (k in c) salida[k] = decimal1(c[k]);
  return salida;
}

/**
 * Arma los bloques de un GM: uno en modo directo (libres + fijas de contexto ≤ `max_filas_llamada`) o uno por lote de líneas completas en
 * modo jerárquico. Las filas libres y fijas viajan; las de cola larga solo se resumen. Si el control de salida encuentra algo prohibido,
 * devuelve `bloqueado_privacidad` y no hay nada que enviar.
 */
export function armarBloquesGM(datos: DatosGM, opciones: OpcionesArmado): ResultadoArmado {
  const aliasador = opciones.aliasador ?? crearAliasador(opciones.terminos);
  const max = opciones.max_filas_llamada ?? MAX_FILAS_LLAMADA_DEFECTO;
  const Y = datos.anio_en_curso;
  const k = datos.ultimo_mes_cerrado;
  const usadosGM: Record<string, EntradaDiccionarioAlias> = {};
  const alias = (t: string) => aliasador.aplicar(t, usadosGM);

  const viajan = datos.filas.filter((f) => f.estado !== "cola_larga").sort((a, b) => porTexto(a.clave, b.clave));
  const colaLarga = datos.filas.filter((f) => f.estado === "cola_larga");

  // Ids cortos: estables en todo el GM (una fila conserva su `f` en todos los lotes).
  const idFila = new Map(viajan.map((f, i) => [f.clave, `f${pad(i + 1, 3)}`]));
  const lineasOrden = [...new Map(datos.filas.map((f) => [f.linea_id, f.linea])).entries()].sort((a, b) => porTexto(a[1].toUpperCase(), b[1].toUpperCase()) || porTexto(a[0], b[0]));
  const idLinea = new Map(lineasOrden.map(([id], i) => [id, `l${pad(i + 1, 2)}`]));
  const equivalenciasOrden = [...new Set(viajan.map((f) => f.equivalencia_id).filter((e): e is string => e !== null))].sort();
  const idEquivalencia = new Map(equivalenciasOrden.map((id, i) => [id, `e${pad(i + 1, 2)}`]));

  const nino: FactorNinoEntradaIa[] = [];
  for (const n of datos.nino) {
    const rel = relativo(n.anio, Y);
    if (rel !== null) nino.push({ anio: rel, temporada: n.temporada, meses: [...n.meses].sort((a, b) => a - b), factor: Math.round(n.factor * 10000) / 10000 });
  }
  nino.sort((a, b) => porTexto(a.anio, b.anio) || porTexto(a.temporada, b.temporada));
  const contexto: ContextoEntradaIa = { ultimo_mes_cerrado: k, objetivo: "A+1", objetivo_normal: true, nino, umbral_cola_larga: datos.umbral_cola_larga };

  const totales = new Map<AnioRel, number>();
  for (const f of datos.filas) {
    for (const [rel, meses] of Object.entries(mesesRelativos(f, Y, k))) totales.set(rel as AnioRel, (totales.get(rel as AnioRel) ?? 0) + sumar(meses));
  }
  const gm: GMEntradaIa = {
    id: "g1",
    genero: alias(datos.genero),
    mundo: alias(datos.mundo),
    es_resto: datos.es_resto,
    historia: ANIOS_REL.filter((a) => totales.has(a)).map((a) => ({
      anio: a,
      unidades: entero(totales.get(a) ?? 0),
      comparable_pct: a === "A-3" ? null : decimal1(datos.comparable_gm[a] ?? null),
    })),
    fuera_de_meta: { aperturas_y1: entero(datos.fuera_de_meta.aperturas_y1), cierres_y1: entero(datos.fuera_de_meta.cierres_y1) },
    cola_larga: { filas: colaLarga.length, unidades_y1: entero(colaLarga.reduce((a, f) => a + (f.y1.fija_en ?? 0), 0)) },
  };

  const aFilaEntrada = (f: FilaDatosIa): FilaEntradaIa => ({
    f: idFila.get(f.clave) ?? "",
    l: idLinea.get(f.linea_id) ?? "",
    linea: alias(f.linea),
    equivalencia: f.equivalencia === null ? null : alias(f.equivalencia),
    agrupacion_marca: alias(f.agrupacion_marca),
    temporada: f.temporada,
    estado: f.estado === "libre" ? "libre" : "fija",
    meses: mesesRelativos(f, Y, k),
    comparable_pct: comparableEntrada(f.comparable_pct),
    y: {
      vendido: entero(f.y.vendido),
      vigente: f.y.vigente === null ? null : entero(f.y.vigente),
      avance: decimal2(f.y.avance),
      metodo: f.y.metodo === "avance" ? "avance" : f.y.metodo === "plan_anterior" ? "plan_anterior" : "otro",
      decidido: f.y.decidido,
    },
    y1: {
      base: f.y1.base === null ? null : entero(f.y1.base),
      base_corregida: f.y1.base_corregida === null ? null : entero(f.y1.base_corregida),
      aporte_entrantes: entero(f.y1.aporte_entrantes),
      aporte_salientes: entero(f.y1.aporte_salientes),
      fija_en: f.estado === "libre" || f.y1.fija_en === null ? null : entero(f.y1.fija_en),
      pedir: f.estado === "libre",
    },
    senales: {
      lista: senalesDeFila({ ...f.senales, aportes: { entrantes: f.y1.aporte_entrantes, salientes: f.y1.aporte_salientes }, base: f.y1.base }),
      meses_quiebre_w12: f.senales.meses_quiebre_w12,
      disponibilidad: decimal2(f.senales.disponibilidad),
      meses_desde_primera_venta: f.senales.meses_desde_primera_venta,
      meses_con_venta_24: f.senales.meses_con_venta_24,
    },
  });

  // Lotes: un solo lote en modo directo; en jerárquico, líneas completas de ≤ `max` filas (una línea mayor se parte por `clave`).
  const modo: "directo" | "jerarquico" = viajan.length <= max ? "directo" : "jerarquico";
  const avisos: "linea_partida"[] = [];
  let lotesFilas: FilaDatosIa[][];
  if (modo === "directo") lotesFilas = viajan.length > 0 ? [viajan] : [];
  else {
    const unidades: FilaDatosIa[][] = [];
    for (const [lineaId] of lineasOrden) {
      const filas = viajan.filter((f) => f.linea_id === lineaId);
      if (filas.length === 0) continue;
      if (filas.length <= max) unidades.push(filas);
      else {
        avisos.push("linea_partida");
        for (let i = 0; i < filas.length; i += max) unidades.push(filas.slice(i, i + max));
      }
    }
    lotesFilas = [];
    let actual: FilaDatosIa[] = [];
    for (const u of unidades) {
      if (actual.length > 0 && actual.length + u.length > max) {
        lotesFilas.push(actual);
        actual = [];
      }
      actual = actual.concat(u);
    }
    if (actual.length > 0) lotesFilas.push(actual);
  }
  lotesFilas = lotesFilas.filter((l) => l.some((f) => f.estado === "libre"));

  const lotes: LoteArmado[] = [];
  for (let i = 0; i < lotesFilas.length; i++) {
    const filas = lotesFilas[i];
    const usados: Record<string, EntradaDiccionarioAlias> = {};
    const bloque: BloqueGMIa = {
      version_entrada: VERSION_ENTRADA,
      contexto,
      gm: { ...gm, genero: aliasador.aplicar(datos.genero, usados), mundo: aliasador.aplicar(datos.mundo, usados) },
      lote: { n: i + 1, de: lotesFilas.length },
      filas: filas.map((f) => {
        const e = aFilaEntrada(f);
        for (const t of [f.linea, f.equivalencia, f.agrupacion_marca]) if (t !== null) aliasador.aplicar(t, usados);
        return e;
      }),
    };
    const sello = sellar(bloque, opciones.terminos, CLAVES_BLOQUE);
    if (!sello.ok) return sello;
    lotes.push({
      bloque,
      contenido: sello.contenido,
      huella: sello.huella,
      bytes: sello.bytes,
      filas_libres: bloque.filas.filter((f) => f.estado === "libre").map((f) => f.f),
      diccionario: {
        f: Object.fromEntries(filas.map((f) => [idFila.get(f.clave) ?? "", f.clave])),
        l: Object.fromEntries([...new Set(filas.map((f) => f.linea_id))].map((l) => [idLinea.get(l) ?? "", l])),
        e: Object.fromEntries([...new Set(filas.map((f) => f.equivalencia_id).filter((e): e is string => e !== null))].map((e) => [idEquivalencia.get(e) ?? "", e])),
        alias: usados,
      },
    });
  }

  // Base de las líneas (solo las que tienen libres): para la llamada `lineas` del modo jerárquico.
  const lineas: LineaBaseIa[] = [];
  for (const [lineaId, nombre] of lineasOrden) {
    const deLinea = datos.filas.filter((f) => f.linea_id === lineaId);
    const libres = deLinea.filter((f) => f.estado === "libre");
    if (libres.length === 0) continue;
    const historia: Partial<Record<AnioRel, number>> = {};
    for (const f of deLinea) for (const [rel, meses] of Object.entries(mesesRelativos(f, Y, k))) historia[rel as AnioRel] = (historia[rel as AnioRel] ?? 0) + sumar(meses);
    for (const rel of Object.keys(historia) as AnioRel[]) historia[rel] = entero(historia[rel] ?? 0);
    lineas.push({
      l: idLinea.get(lineaId) ?? "",
      linea: alias(nombre),
      filas_libres: libres.length,
      filas_libres_f: libres.map((f) => idFila.get(f.clave) ?? ""),
      historia,
      comparable_pct: comparableEntrada(datos.comparable_por_linea?.[lineaId] ?? {}),
      base_corregida: entero(libres.reduce((a, f) => a + (f.y1.base_corregida ?? 0), 0)),
      fijas: entero(deLinea.filter((f) => f.estado !== "libre").reduce((a, f) => a + (f.y1.fija_en ?? 0), 0)),
    });
  }

  return { ok: true, modo, lotes, lineas, plan: planDeGM(modo, lotes.length), contexto, gm, avisos };
}

/** Nombre de la ficha (§3.5) para `armarBloquesGM`: el armado devuelve un bloque por lote. */
export const armarBloqueGM = armarBloquesGM;

// ─── Sufijos y entrada de líneas ───

export function armarSufijoNatural(): SufijoNaturalIa {
  return { tarea: "natural" };
}

/** Sufijo de la llamada de reparto: la meta y lo que devolvió la llamada natural de ese lote (orden por `f`). */
export function armarSufijoReparto(args: { meta: MetaEntradaIa; naturales: readonly { f: string; natural_y1: number | null }[] }): SufijoRepartoIa {
  const m = args.meta;
  return {
    tarea: "reparto",
    meta: { pct: Math.round(m.pct * 100) / 100, sobre: m.sobre, total: entero(m.total), fijas: entero(m.fijas), libre: entero(m.libre), provisional: m.provisional, del_lote: entero(m.del_lote) },
    naturales: [...args.naturales].sort((a, b) => porTexto(a.f, b.f)).map((n) => ({ f: n.f, natural_y1: n.natural_y1 === null ? null : entero(n.natural_y1) })),
  };
}

/** Entrada de la llamada `lineas` (modo jerárquico): una por GM, después de todas las naturales. */
export function armarEntradaLineas(
  args: { contexto: ContextoEntradaIa; gm: GMEntradaIa; meta: Omit<MetaEntradaIa, "del_lote">; lineas: readonly LineaBaseIa[]; naturales: ReadonlyMap<string, number | null> },
  terminos: readonly TerminoPrivado[]
): ResultadoEntrada<EntradaLineasIa> {
  const m = args.meta;
  const entrada: EntradaLineasIa = {
    version_entrada: VERSION_ENTRADA,
    contexto: args.contexto,
    gm: args.gm,
    meta: { pct: Math.round(m.pct * 100) / 100, sobre: m.sobre, total: entero(m.total), fijas: entero(m.fijas), libre: entero(m.libre), provisional: m.provisional },
    lineas: args.lineas.map((l) => ({
      l: l.l,
      linea: l.linea,
      filas_libres: l.filas_libres,
      historia: l.historia,
      comparable_pct: l.comparable_pct,
      base_corregida: l.base_corregida,
      natural_y1: entero(l.filas_libres_f.reduce((a, f) => a + (args.naturales.get(f) ?? 0), 0)),
      fijas: l.fijas,
    })),
  };
  return sellar(entrada, terminos, CLAVES_LINEAS);
}
