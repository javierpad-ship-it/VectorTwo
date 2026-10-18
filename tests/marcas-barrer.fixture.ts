import { indexarNodos } from "@/lib/arbol/nivel/indice";
import { construirConfigFlujo, type ConfigFlujo } from "@/lib/marcas/gml/flujo";
import type { AgrupacionGml, AsignacionGmlEntrada, MarcaGml } from "@/lib/marcas/gml/reglas";
import type { EstadoVistaGml } from "@/lib/marcas/gml/vista";
import { curvaFila } from "@/lib/proyeccion/curva-fila";
import { factoresMes } from "@/lib/proyeccion/nino";
import type { NodoProy } from "@/lib/proyeccion/tipos";
import { listarMeses } from "@/lib/ventas/periodo";
import type { FilaCerrada } from "@/lib/marcas-barrer/cerrada";
import type { EntradaAnalisis } from "@/lib/marcas-barrer/modelo";
import { TEMPORADAS_DEFECTO } from "@/lib/marcas-barrer/tipos-api";
import type { AlcanceApi, Ventana } from "@/lib/marcas-barrer/tipos-api";
import { claveG, type ClaveG, type DatosMarca, type HechoBarrer, type TotalBarrer, type UnidadG, type VentaMarcaGml } from "@/lib/marcas-barrer/tipos";
import { CURVA_INVIERNO, CURVA_PLANA, CURVA_VERANO, factores, periodos } from "./proyeccion.fixture";

/**
 * Fixture sintético de M12 (docs/modulos/12-analisis-marcas-barrer.md, sección 9). Nada real de Lukers: marcas ALFA, BETA, GAMMA y
 * DELTA, nodos HOMBRE · URBANO · DENIM, HOMBRE · CASUAL · POLO, MUJER · CASUAL · SANDALIA, HOMBRE · FORMAL · CAMISA (GMLE) y nueve GML
 * pequeños, y cifras inventadas. `k = 2026-09`, ventana de 24 meses (oct-2024 → set-2026). Las funciones devuelven copias nuevas.
 */

const uuid = (n: string) => `00000000-0000-4000-8000-${n.padStart(12, "0")}`;

export const K = "2026-09";
export const MESES_24 = listarMeses("2024-10", K);

export const GEN = { hombre: uuid("a001"), mujer: uuid("a002") } as const;
export const MUN = { urbano: uuid("b001"), casual: uuid("b002"), formal: uuid("b003") } as const;
export const LIN = { denim: uuid("c001"), polo: uuid("c002"), sandalia: uuid("c003"), camisa: uuid("c004") } as const;
export const NODO = {
  denim: uuid("d001"),
  polo: uuid("d002"),
  sandalia: uuid("d003"),
  camisa: uuid("d004"),
  /** Seis pequeños de HOMBRE · CASUAL y tres de HOMBRE · URBANO. */
  c: [1, 2, 3, 4, 5, 6].map((i) => uuid(`d1${String(i).padStart(2, "0")}`)),
  u: [1, 2, 3].map((i) => uuid(`d2${String(i).padStart(2, "0")}`)),
} as const;
/** La equivalencia de cada nodo GML y las dos del GMLE (CAMISA). */
export const EQ = {
  denim: uuid("e001"),
  polo: uuid("e002"),
  sandalia: uuid("e003"),
  camisaLarga: uuid("e004"),
  camisaCorta: uuid("e005"),
  c: [1, 2, 3, 4, 5, 6].map((i) => uuid(`e1${String(i).padStart(2, "0")}`)),
  u: [1, 2, 3].map((i) => uuid(`e2${String(i).padStart(2, "0")}`)),
} as const;
export const AG = { denim: "ag-denim", ver: "ag-verano", inv: "ag-invierno" } as const;
export const AM = { pre: uuid("f101"), rec: uuid("f102"), val: uuid("f103") } as const;
export const MARCA = { beta: uuid("f001"), betaUno: uuid("f002"), gamma: uuid("f003"), delta: uuid("f004"), alfa: uuid("f005") } as const;

/** Unidades `g` del fixture (clave) con su nombre. */
export const CLAVE = {
  denim: claveG(NODO.denim, null),
  polo: claveG(NODO.polo, null),
  sandalia: claveG(NODO.sandalia, null),
  camisaLarga: claveG(NODO.camisa, EQ.camisaLarga),
  camisaCorta: claveG(NODO.camisa, EQ.camisaCorta),
  c: NODO.c.map((n) => claveG(n, null)),
  u: NODO.u.map((n) => claveG(n, null)),
} as const;

// ─── Árbol ───

type NodoDef = { id: string; genero: keyof typeof GEN; mundo: keyof typeof MUN; linea: string; lineaId: string; nivel: "GML" | "GMLE"; eqs: { id: string; nombre: string; ag: string }[] };

const NODOS_DEF: NodoDef[] = [
  { id: NODO.denim, genero: "hombre", mundo: "urbano", linea: "DENIM", lineaId: LIN.denim, nivel: "GML", eqs: [{ id: EQ.denim, nombre: "DENIM", ag: AG.denim }] },
  { id: NODO.polo, genero: "hombre", mundo: "casual", linea: "POLO", lineaId: LIN.polo, nivel: "GML", eqs: [{ id: EQ.polo, nombre: "POLO", ag: AG.ver }] },
  { id: NODO.sandalia, genero: "mujer", mundo: "casual", linea: "SANDALIA", lineaId: LIN.sandalia, nivel: "GML", eqs: [{ id: EQ.sandalia, nombre: "SANDALIA", ag: AG.ver }] },
  {
    id: NODO.camisa,
    genero: "hombre",
    mundo: "formal",
    linea: "CAMISA",
    lineaId: LIN.camisa,
    nivel: "GMLE",
    eqs: [
      { id: EQ.camisaLarga, nombre: "MANGA LARGA", ag: AG.inv },
      { id: EQ.camisaCorta, nombre: "MANGA CORTA", ag: AG.inv },
    ],
  },
  ...NODO.c.map((id, i): NodoDef => ({ id, genero: "hombre", mundo: "casual", linea: `PEQ-C${i + 1}`, lineaId: uuid(`c1${String(i + 1).padStart(2, "0")}`), nivel: "GML", eqs: [{ id: EQ.c[i], nombre: `PEQ-C${i + 1}`, ag: AG.denim }] })),
  ...NODO.u.map((id, i): NodoDef => ({ id, genero: "hombre", mundo: "urbano", linea: `PEQ-U${i + 1}`, lineaId: uuid(`c2${String(i + 1).padStart(2, "0")}`), nivel: "GML", eqs: [{ id: EQ.u[i], nombre: `PEQ-U${i + 1}`, ag: AG.denim }] })),
];

const NOMBRE_GEN = { hombre: "HOMBRE", mujer: "MUJER" } as const;
const NOMBRE_MUN = { urbano: "URBANO", casual: "CASUAL", formal: "FORMAL" } as const;

export function nodosProy(): NodoProy[] {
  return NODOS_DEF.map((n) => ({
    gml_id: n.id,
    nivel: n.nivel,
    genero_id: GEN[n.genero],
    mundo_id: MUN[n.mundo],
    linea_id: n.lineaId,
    genero: NOMBRE_GEN[n.genero],
    mundo: NOMBRE_MUN[n.mundo],
    linea: n.linea,
    equivalencias: n.eqs.map((e) => ({ id: e.id, nombre: e.nombre, agrupacion_estacionalidad_id: e.ag })),
  }));
}

export const equivalenciasDb = () => NODOS_DEF.flatMap((n) => n.eqs.map((e) => ({ id: e.id, genero_mundo_linea_id: n.id, nombre: e.nombre })));
export const equivalenciasB = equivalenciasDb;

export const AGRUPACIONES_PROY = () => [
  { id: AG.denim, nombre: "DENIM HO", temporada: "todo_el_ano" as const },
  { id: AG.ver, nombre: "MU VERANO", temporada: "verano" as const },
  { id: AG.inv, nombre: "HO INVIERNO", temporada: "invierno" as const },
];
export const VIGENTES_PROY = () => [
  { agrupacion_id: AG.denim, curva_id: "c-denim", version: 1, curva: [...CURVA_PLANA] },
  { agrupacion_id: AG.ver, curva_id: "c-ver", version: 1, curva: [...CURVA_VERANO] },
  { agrupacion_id: AG.inv, curva_id: "c-inv", version: 1, curva: [...CURVA_INVIERNO] },
];

// ─── Marcas y configuración de 02b ───

const marca = (id: string, nombre: string, agrupacion: string, d: Partial<MarcaGml> = {}): MarcaGml => ({
  id,
  nombre,
  codigo: nombre.replace(/[^A-Z0-9]/g, "_"),
  agrupacion_marca_id: agrupacion,
  activo: true,
  tratamiento_especial: false,
  modalidad_tratamiento: null,
  resto_al_barrer: false,
  nota_tratamiento: null,
  conjunto_marca_id: null,
  ...d,
});

export function marcasB(): MarcaGml[] {
  return [
    marca(MARCA.beta, "BETA", AM.pre, { tratamiento_especial: true, modalidad_tratamiento: "barrido" }),
    marca(MARCA.betaUno, "BETA UNO", AM.pre, { conjunto_marca_id: MARCA.beta }),
    marca(MARCA.gamma, "GAMMA", AM.rec, { tratamiento_especial: true, modalidad_tratamiento: "por_gml", resto_al_barrer: true }),
    marca(MARCA.delta, "DELTA", AM.val, { tratamiento_especial: true, modalidad_tratamiento: "barrido" }),
    marca(MARCA.alfa, "ALFA", AM.rec, { tratamiento_especial: true, modalidad_tratamiento: "por_gml" }),
  ];
}

export function asignacionesB(): AsignacionGmlEntrada[] {
  const a = (id: string, marca_id: string, nodo: string): AsignacionGmlEntrada => ({ id, marca_id, genero_mundo_linea_id: nodo, nota: null, activo: true, created_at: "2026-10-12T00:00:00Z" });
  return [a("a-gamma-camisa", MARCA.gamma, NODO.camisa), a("a-alfa-denim", MARCA.alfa, NODO.denim)];
}

export function estadoB(cambio: Partial<EstadoVistaGml> = {}): EstadoVistaGml {
  const generos = [
    { id: GEN.hombre, nombre: "HOMBRE", activo: true },
    { id: GEN.mujer, nombre: "MUJER", activo: true },
  ];
  const mundos = [
    { id: MUN.urbano, nombre: "URBANO", activo: true },
    { id: MUN.casual, nombre: "CASUAL", activo: true },
    { id: MUN.formal, nombre: "FORMAL", activo: true },
  ];
  const lineas = NODOS_DEF.map((n) => ({ id: n.lineaId, nombre: n.linea, activo: true }));
  const nodos = NODOS_DEF.map((n) => ({
    id: n.id,
    genero_id: GEN[n.genero],
    mundo_id: MUN[n.mundo],
    linea_id: n.lineaId,
    activo: true,
    nivel_planificacion: n.nivel,
  }));
  const agrupaciones: AgrupacionGml[] = [
    { id: AM.pre, nombre: "PREMIUM", activo: true, orden: 50 },
    { id: AM.rec, nombre: "RECONOCIDO", activo: true, orden: 40 },
    { id: AM.val, nombre: "VALOR", activo: true, orden: 30 },
  ];
  return {
    marcas: marcasB(),
    agrupaciones,
    asignaciones: asignacionesB(),
    nodos: indexarNodos({
      generos: generos as never,
      mundos: mundos as never,
      lineas: lineas as never,
      nodos: nodos as never,
    }),
    ...cambio,
  };
}

export const configB = (estado: EstadoVistaGml = estadoB()): ConfigFlujo => construirConfigFlujo(estado, equivalenciasDb());

// ─── Unidades `g` con su curva y su factor del Niño (con las mismas funciones de M7) ───

export function unidadesB(opciones: { sinNino?: boolean } = {}): (clave: ClaveG) => UnidadG | null {
  const nodos = new Map(nodosProy().map((n) => [n.gml_id, n]));
  const vigentes = new Map(VIGENTES_PROY().map((v) => [v.agrupacion_id, v]));
  const agrupaciones = new Map(AGRUPACIONES_PROY().map((a) => [a.id, a]));
  const memo = new Map<ClaveG, UnidadG | null>();
  return (clave) => {
    const previo = memo.get(clave);
    if (previo !== undefined) return previo;
    const i = clave.indexOf("|");
    const gml = clave.slice(0, i);
    const eq = clave.slice(i + 1) === "" ? null : clave.slice(i + 1);
    const nodo = nodos.get(gml);
    if (!nodo) {
      memo.set(clave, null);
      return null;
    }
    const cf = curvaFila({ nivel: nodo.nivel, equivalencia_id: eq }, nodo.equivalencias.map((e) => ({ id: e.id, agrupacion_estacionalidad_id: e.agrupacion_estacionalidad_id })), vigentes, agrupaciones, new Map());
    const porAnio = new Map<number, ReturnType<typeof factoresMes>>();
    const phi = (anio: number) => {
      let r = porAnio.get(anio);
      if (!r) {
        r = factoresMes(cf.componentes, periodos(), opciones.sinNino ? [] : factores(), anio);
        porAnio.set(anio, r);
      }
      return r;
    };
    const nombreEq = nodo.equivalencias.find((e) => e.id === eq)?.nombre;
    const g: UnidadG = {
      clave,
      gml_id: gml,
      equivalencia_id: eq,
      genero_id: nodo.genero_id,
      mundo_id: nodo.mundo_id,
      linea_id: nodo.linea_id,
      genero: nodo.genero,
      mundo: nodo.mundo,
      linea: nodo.linea,
      ruta: `${nodo.genero} · ${nodo.mundo} · ${nodo.linea}${nombreEq ? ` › ${nombreEq}` : ""}`,
      nivel: nodo.nivel,
      curva: cf.curva,
      curvaIncompleta: false,
      phi: (a) => phi(a).factores,
      sinFactor: (a) => phi(a).avisos.includes("sin_factor"),
    };
    memo.set(clave, g);
    return g;
  };
}

// ─── Venta (lo que devuelve `venta_marca_gml`) ───

export type HechoSpec = { unidad: string; nodo: string; eq?: string | null; mes: string; u: number };
export type OtrosSpec = { nodo: string; eq?: string | null; mes: string; u: number };

/** Arma `{ hechos, totales, cargas }` como la función SQL: los totales son los de TODAS las marcas en las `g` donde alguna unidad vende. */
export function ventaDe(hechos: HechoSpec[], otros: OtrosSpec[] = []): VentaMarcaGml {
  const periodo = (m: string) => `${m}-01`;
  const hs: HechoBarrer[] = hechos.map((h) => ({ unidad_marca_id: h.unidad, gml_id: h.nodo, equivalencia_id: h.eq ?? null, periodo: periodo(h.mes), unidades: h.u }));
  const totales = new Map<string, TotalBarrer>();
  const sumar = (nodo: string, eq: string | null, mes: string, u: number) => {
    const k = `${nodo}|${eq ?? ""}|${mes}`;
    const t = totales.get(k) ?? { gml_id: nodo, equivalencia_id: eq, periodo: periodo(mes), unidades: 0 };
    t.unidades += u;
    totales.set(k, t);
  };
  for (const h of hechos) sumar(h.nodo, h.eq ?? null, h.mes, h.u);
  const conHechos = new Set(hechos.map((h) => `${h.nodo}|${h.eq ?? ""}`));
  for (const o of otros) if (conHechos.has(`${o.nodo}|${o.eq ?? ""}`)) sumar(o.nodo, o.eq ?? null, o.mes, o.u);
  const cargas: Record<string, string> = {};
  for (const m of MESES_24) cargas[m] = `carga-${m}`;
  return { hechos: hs, totales: [...totales.values()], cargas };
}

/** Totales de otras marcas en los GML grandes (para que `p1` no sea 100 %). */
export const OTROS: OtrosSpec[] = MESES_24.flatMap((mes) => [
  { nodo: NODO.denim, mes, u: 900 },
  { nodo: NODO.polo, mes, u: 350 },
  { nodo: NODO.sandalia, mes, u: 480 },
]);

/** Total de unidades de los pequeños: 290 (seis de CASUAL y tres de URBANO, todas entre 10 y 40 u). */
export const PEQUENOS_C = [40, 40, 35, 30, 25, 20];
export const PEQUENOS_U = [40, 35, 25];

/**
 * BETA, 24 meses: 100 u/mes en DENIM, 50 en POLO, 20 en SANDALIA (BETA UNO ya suma en la cabeza) y los nueve pequeños (290 u) en
 * febrero y julio de 2025. El CD no aparece: la función SQL lo deja fuera.
 */
export function hechosBeta(): HechoSpec[] {
  const unidad = MARCA.beta;
  const h: HechoSpec[] = MESES_24.flatMap((mes) => [
    { unidad, nodo: NODO.denim, eq: null, mes, u: 100 },
    { unidad, nodo: NODO.polo, eq: null, mes, u: 50 },
    { unidad, nodo: NODO.sandalia, eq: null, mes, u: 20 },
  ]);
  PEQUENOS_C.forEach((u, i) => h.push({ unidad, nodo: NODO.c[i], eq: null, mes: "2025-02", u }));
  PEQUENOS_U.forEach((u, i) => h.push({ unidad, nodo: NODO.u[i], eq: null, mes: "2025-07", u }));
  return h;
}

/** Solo los tres GML grandes, sin pequeños: la mezcla es idéntica en todos los meses. */
export const hechosBetaConstante = (): HechoSpec[] => hechosBeta().filter((h) => [NODO.denim, NODO.polo, NODO.sandalia].includes(h.nodo));

/** BETA cambia: 2024-25 DENIM 70 u y POLO 30 u por mes; 2026 al revés (DENIM 30 y POLO 70). */
export function hechosBetaCambia(): HechoSpec[] {
  return MESES_24.flatMap((mes): HechoSpec[] => {
    const nuevo = mes >= "2026-01";
    return [
      { unidad: MARCA.beta, nodo: NODO.denim, eq: null, mes, u: nuevo ? 30 : 70 },
      { unidad: MARCA.beta, nodo: NODO.polo, eq: null, mes, u: nuevo ? 70 : 30 },
    ];
  });
}

/** GAMMA (mixta, relevante en CAMISA): 40 u/mes en CAMISA › MANGA LARGA (específica) y 60 en DENIM (al barrer). */
export function hechosGamma(): HechoSpec[] {
  return MESES_24.flatMap((mes): HechoSpec[] => [
    { unidad: MARCA.gamma, nodo: NODO.camisa, eq: EQ.camisaLarga, mes, u: 40 },
    { unidad: MARCA.gamma, nodo: NODO.denim, eq: null, mes, u: 60 },
  ]);
}

// ─── Cerrada de M7 ───

/**
 * Filas de la cerrada de los años 2026 y 2027: DENIM × PREMIUM (demanda de 1 000/mes) y POLO × PREMIUM (400/mes), con participación
 * `barrido` de BETA de 0,12 y 0,30 en la fila base; una fila de tienda nueva suma demanda a DENIM.
 */
export function cerradaB(): FilaCerrada[] {
  const meses = (v: number) => Array.from({ length: 12 }, () => v);
  const base = (nodo: string, v: number, part: number, anio: number): FilaCerrada => ({
    gml_id: nodo,
    equivalencia_id: null,
    agrupacion_marca_id: AM.pre,
    tienda_id: null,
    anio,
    meses: meses(v),
    participaciones_historicas: { por_clave_flujo: [{ clave_flujo: `barrido:${MARCA.beta}`, participacion: part }, { clave_flujo: "otras", participacion: 1 - part }] },
  });
  const filas: FilaCerrada[] = [];
  for (const anio of [2026, 2027]) {
    filas.push(base(NODO.denim, 1000, 0.12, anio), base(NODO.polo, 400, 0.3, anio));
    filas.push({ gml_id: NODO.denim, equivalencia_id: null, agrupacion_marca_id: AM.pre, tienda_id: "T9", anio, meses: meses(0), participaciones_historicas: null });
  }
  return filas;
}

// ─── Entrada de `analizarMarca` ───

export const ALCANCE_VACIO: AlcanceApi = { generos: [], mundos: [], lineas: [] };

export const datosBeta = (): DatosMarca => ({
  id: MARCA.beta,
  nombre: "BETA",
  modalidad: "barrido",
  agrupacion_marca: "PREMIUM",
  agrupacion_marca_id: AM.pre,
  miembros: ["BETA UNO"],
  gml_especificos: [],
});

export const datosGamma = (): DatosMarca => ({
  id: MARCA.gamma,
  nombre: "GAMMA",
  modalidad: "mixta",
  agrupacion_marca: "RECONOCIDO",
  agrupacion_marca_id: AM.rec,
  miembros: [],
  gml_especificos: [{ gml_id: NODO.camisa, ruta: "HOMBRE · FORMAL · CAMISA" }],
});

export function entradaBeta(cambio: Partial<EntradaAnalisis> = {}, hechos: HechoSpec[] = hechosBeta()): EntradaAnalisis {
  return {
    marca: datosBeta(),
    hasta: K,
    ventana: 24 as Ventana,
    modo: "por_temporada",
    alcance: { ...ALCANCE_VACIO },
    normaliza_nino: true,
    temporadas: TEMPORADAS_DEFECTO,
    config: configB(),
    venta: ventaDe(hechos, OTROS),
    unidades: unidadesB(),
    factores: factores().map((f) => ({ anio: f.anio, temporada: f.temporada, ratio: f.ratio_aplicado ?? f.ratio_calculado })),
    cerrada: cerradaB(),
    ...cambio,
  };
}

export function entradaGamma(cambio: Partial<EntradaAnalisis> = {}): EntradaAnalisis {
  return entradaBeta({ marca: datosGamma(), venta: ventaDe(hechosGamma(), OTROS), cerrada: null, ...cambio });
}
