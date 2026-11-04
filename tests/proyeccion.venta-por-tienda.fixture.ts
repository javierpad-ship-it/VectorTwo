import { NextResponse } from "next/server";
import type { TiendaMaestro } from "@/lib/curvas/tipos";
import { bloquesDeAnio } from "@/lib/proyeccion/bloques";
import type { FilaCrecimiento } from "@/lib/proyeccion/crecimientos";
import type { Catalogo } from "@/lib/proyeccion/persistencia";
import { vigentesDeTiendasNuevas, type EntradaVentaPorTienda, type FilaTiendaNueva, type SerieVentaTienda, type TiendaMaestroVenta } from "@/lib/proyeccion/venta-por-tienda";
import { sembrar, estado as base } from "./proyeccion.fake-db";

/**
 * Caso sintético de 07f (ficha §8). `Y = 2026`, `k = 9`, MUJER · URBANO con datos publicados de 2023-01 a 2026-09. Tiendas: T01, T02 y T03 (mismas), T04 (cierra el
 * 2027-06-30: `sale`), T10 (abrió el 2025-11-15: `entra`), T11 (abrió el 2026-05-02: `abrio_en_curso`), T09 (cerró el 2024-08-31: `cerro`) y CD1 (con venta, que no
 * debe aparecer). Ningún dato real de Lukers.
 */

const id = (prefijo: string, n: number) => `${prefijo}-0000-4000-8000-${String(n).padStart(12, "0")}`;
const dos = (n: number) => String(n).padStart(2, "0");

export const Y = 2026;
export const K = 9;
export const P_ID = id("d0000001", 1);
export const GEN = { mujer: id("a0000001", 1), hombre: id("a0000001", 2), nino: id("a0000001", 3) } as const;
export const MUN = { urbano: id("b0000001", 1), casual: id("b0000001", 2) } as const;
/** `mu1` y `mu2` son dos nodos de MUJER · URBANO; `mc`, de MUJER · CASUAL; `hu`, de HOMBRE · URBANO; `nu`, de NIÑO · URBANO (el Resto). */
export const NODO = { mu1: id("c0000001", 1), mu2: id("c0000001", 2), mc: id("c0000001", 3), hu: id("c0000001", 4), nu: id("c0000001", 5) } as const;
export const AM = { rec: id("e0000001", 1), pre: id("e0000001", 2), val: id("e0000001", 3) } as const;
export const GM_MU = `${GEN.mujer}.${MUN.urbano}`;
export const GM_HU = `${GEN.hombre}.${MUN.urbano}`;
export const GM_MC = `${GEN.mujer}.${MUN.casual}`;
export const GM_NINO = `${GEN.nino}.${MUN.urbano}`;

export const T = {
  T01: id("00000001", 1),
  T02: id("00000001", 2),
  T03: id("00000001", 3),
  T04: id("00000001", 4),
  T09: id("00000001", 9),
  T10: id("00000001", 10),
  T11: id("00000001", 11),
  T12: id("00000001", 12),
  CD1: id("00000001", 99),
} as const;
export const CODIGO_DE = Object.fromEntries(Object.entries(T).map(([codigo, tid]) => [tid, codigo]));

const m4 = (codigo: keyof typeof T, apertura: string | null, cierre: string | null, extra: Partial<TiendaMaestro> = {}): TiendaMaestro => ({
  id: T[codigo],
  codigo,
  nombre: `Tienda ${codigo}`,
  tipo: "Tienda",
  activo: true,
  fecha_apertura: apertura,
  fecha_cierre: cierre,
  ...extra,
});

/** Las tiendas de M4 con que se calcularon los `bloques` (T12 no está: se crea después de calcular). */
export const TIENDAS_CALCULO: TiendaMaestro[] = [
  m4("T01", "2019-03-01", null),
  m4("T02", "2019-06-01", null),
  m4("T03", "2020-02-01", null),
  m4("T04", "2018-01-15", "2027-06-30"),
  m4("T09", "2019-01-01", "2024-08-31"),
  m4("T10", "2025-11-15", null),
  m4("T11", "2026-05-02", null),
  m4("CD1", "2015-01-01", null, { tipo: "Centro de Distribución" }),
];
/** Hoy en M4: lo anterior más T12 (abrió en 2024 y no estaba al calcular). */
export const TIENDAS_HOY: TiendaMaestro[] = [...TIENDAS_CALCULO, m4("T12", "2024-02-01", null)];

export const bloquesFixture = () => ({ [Y]: bloquesDeAnio(TIENDAS_CALCULO, Y), [Y + 1]: bloquesDeAnio(TIENDAS_CALCULO, Y + 1) });

export const maestroVenta = (tiendas: readonly TiendaMaestro[] = TIENDAS_HOY): Map<string, TiendaMaestroVenta> =>
  new Map(tiendas.map((t) => [t.id, { id: t.id, codigo: t.codigo, nombre: t.nombre, tipo: t.tipo, fecha_apertura: t.fecha_apertura, fecha_cierre: t.fecha_cierre }]));

// ─── Venta publicada ───

type Segmento = { anio: number; desde: number; hasta: number; u: number; precio: number };

/** Reparte `u` unidades en los meses `desde..hasta` de un año (enteros; las que sobran, en los primeros meses) a un precio fijo por unidad. */
function segmento(t: string, s: Segmento): SerieVentaTienda[] {
  if (s.u === 0) return [];
  const n = s.hasta - s.desde + 1;
  const piso = Math.floor(s.u / n);
  const sobran = s.u - piso * n;
  return Array.from({ length: n }, (_, i) => {
    const u = piso + (i < sobran ? 1 : 0);
    return { t, p: `${s.anio}-${dos(s.desde + i)}`, u, s: u * s.precio };
  });
}
const seg = (t: string, anio: number, desde: number, hasta: number, u: number, precio = 50): SerieVentaTienda[] => segmento(t, { anio, desde, hasta, u, precio });

/** La venta de MUJER · URBANO de la ficha §8 (toda en el nodo `mu1`; `mu2` solo trae filas base). T01: S/ 380 000 en ene–set 2025 y S/ 480 000 en ene–set 2026. */
export function seriesMujerUrbano(): SerieVentaTienda[] {
  return [
    ...seg(T.T01, 2023, 1, 12, 6000, 70),
    ...seg(T.T01, 2024, 1, 12, 6300, 70),
    ...seg(T.T01, 2025, 1, 9, 5000, 76),
    ...seg(T.T01, 2025, 10, 12, 2000, 76),
    ...seg(T.T01, 2026, 1, 9, 6000, 80),
    ...seg(T.T02, 2023, 1, 12, 3000),
    ...seg(T.T02, 2024, 1, 12, 3200),
    ...seg(T.T02, 2025, 1, 9, 2500),
    ...seg(T.T02, 2025, 10, 12, 1000),
    ...seg(T.T02, 2026, 1, 9, 3000),
    ...seg(T.T03, 2023, 1, 12, 1200),
    ...seg(T.T03, 2024, 1, 12, 1100),
    ...seg(T.T03, 2025, 1, 9, 1000),
    ...seg(T.T03, 2025, 10, 12, 400),
    ...seg(T.T03, 2026, 1, 9, 1000),
    ...seg(T.T04, 2023, 1, 12, 1000),
    ...seg(T.T04, 2024, 1, 12, 1000),
    ...seg(T.T04, 2025, 1, 9, 800),
    ...seg(T.T04, 2025, 10, 12, 300),
    ...seg(T.T04, 2026, 1, 9, 800),
    ...seg(T.T09, 2023, 1, 12, 900),
    ...seg(T.T09, 2024, 1, 8, 500),
    ...seg(T.T10, 2025, 11, 12, 300),
    ...seg(T.T10, 2026, 1, 9, 1200),
    ...seg(T.T11, 2026, 5, 9, 400),
    // El CD vende, pero la función SQL no lo devuelve: la base falsa SÍ lo devuelve para probar la segunda red del backend.
    ...seg(T.CD1, 2026, 1, 9, 9000, 10),
  ];
}

/** HOMBRE · URBANO (nodo `hu`): T01 y T02 con 100 u al mes de enero a septiembre de 2026. */
export const seriesHombreUrbano = (): SerieVentaTienda[] => [...seg(T.T01, 2026, 1, 9, 900), ...seg(T.T02, 2026, 1, 9, 900)];
/** NIÑO · URBANO (nodo `nu`, el Resto): solo T01. */
export const seriesNinoUrbano = (): SerieVentaTienda[] => seg(T.T01, 2026, 1, 9, 450);

export const seriesPorNodo = (): Record<string, SerieVentaTienda[]> => ({
  [NODO.mu1]: seriesMujerUrbano(),
  [NODO.hu]: seriesHombreUrbano(),
  [NODO.nu]: seriesNinoUrbano(),
});

/** Meses publicados de 2023-01 a 2026-09 (`aaaa-mm → carga_id`). */
export function cargasFixture(sin: readonly string[] = []): Record<string, string> {
  const salida: Record<string, string> = {};
  let n = 1;
  for (let anio = 2023; anio <= 2026; anio++) {
    for (let mes = 1; mes <= 12; mes++) {
      const p = `${anio}-${dos(mes)}`;
      if (p > "2026-09") continue;
      if (!sin.includes(p)) salida[p] = id("f0000001", n);
      n += 1;
    }
  }
  return salida;
}

/** La respuesta de `venta_tienda_nodos` en la base falsa: suma las series de los nodos pedidos por (tienda, periodo) y corta el rango como lo hace SQL. */
export function ventaTiendaFalsa(args: { p_gml_ids: string[]; p_desde: string; p_hasta: string }, opciones: { sinCargas?: readonly string[]; extra?: readonly SerieVentaTienda[]; porNodo?: Record<string, SerieVentaTienda[]> } = {}) {
  const desde = args.p_desde.slice(0, 7);
  const hasta = args.p_hasta.slice(0, 7);
  const suma = new Map<string, SerieVentaTienda>();
  const todas = [...args.p_gml_ids.flatMap((n) => (opciones.porNodo ?? seriesPorNodo())[n] ?? []), ...(opciones.extra ?? [])];
  for (const s of todas) {
    if (s.p < desde || s.p > hasta) continue;
    const clave = `${s.t}|${s.p}`;
    const x = suma.get(clave) ?? { t: s.t, p: s.p, u: 0, s: 0 };
    x.u += s.u;
    x.s += s.s;
    suma.set(clave, x);
  }
  const series = [...suma.values()].sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : a.p < b.p ? -1 : a.p > b.p ? 1 : 0));
  const cargas = Object.fromEntries(Object.entries(cargasFixture(opciones.sinCargas)).filter(([p]) => p >= desde && p <= hasta));
  return { series, cargas };
}

// ─── Filas base y de tienda ───

type FilaBaseFx = { clave: string; nodo: string; b: number | null; bc: number | null };
/** Filas base de `Y+1` (2027). MUJER · URBANO: A (B = 10 000, B' = 10 800), B (5 600) y C (sin curva: B nulo); `Σ B = 15 600`, `Σ B' = 16 400`. */
export const FILAS_BASE: FilaBaseFx[] = [
  { clave: `|${NODO.mu1}||${AM.rec}`, nodo: NODO.mu1, b: 10000, bc: 10800 },
  { clave: `|${NODO.mu2}||${AM.pre}`, nodo: NODO.mu2, b: 5600, bc: 5600 },
  { clave: `|${NODO.mu1}||${AM.val}`, nodo: NODO.mu1, b: null, bc: null },
  { clave: `|${NODO.hu}||${AM.rec}`, nodo: NODO.hu, b: 2000, bc: 2000 },
  { clave: `|${NODO.nu}||${AM.rec}`, nodo: NODO.nu, b: 500, bc: 500 },
  { clave: `|${NODO.mc}||${AM.rec}`, nodo: NODO.mc, b: 300, bc: 300 },
];

type FilaTiendaFx = { tienda: string; nodo: string; am: string; decidido: number | null; propuesto: number | null };
/**
 * Filas de tienda de `Y` en `nuevas`. T10 (entra) en MUJER · URBANO: 1 000 (propuesto) y 600 (decidido sobre un propuesto de 500) suman 1 600 sobre filas base con `B`;
 * 50 sobre una fila base con `B` nulo y 999 sobre una GML-AM sin fila base no suman a `Σ B`; 77 en HOMBRE · URBANO no es de este conjunto. T11 (abrió en 2026): 700.
 */
export const FILAS_TIENDA: FilaTiendaFx[] = [
  { tienda: T.T10, nodo: NODO.mu1, am: AM.rec, decidido: null, propuesto: 1000 },
  { tienda: T.T10, nodo: NODO.mu2, am: AM.pre, decidido: 600, propuesto: 500 },
  { tienda: T.T10, nodo: NODO.mu1, am: AM.val, decidido: null, propuesto: 50 },
  { tienda: T.T10, nodo: NODO.mu1, am: AM.pre, decidido: null, propuesto: 999 },
  { tienda: T.T10, nodo: NODO.hu, am: AM.rec, decidido: null, propuesto: 77 },
  { tienda: T.T11, nodo: NODO.mu1, am: AM.rec, decidido: 700, propuesto: 500 },
];

const claveTienda = (f: FilaTiendaFx) => `${f.tienda}|${f.nodo}||${f.am}`;

export const nombresNodos: Record<string, { genero_id: string; mundo_id: string; genero: string; mundo: string; linea: string }> = {
  [NODO.mu1]: { genero_id: GEN.mujer, mundo_id: MUN.urbano, genero: "MUJER", mundo: "URBANO", linea: "DENIM" },
  [NODO.mu2]: { genero_id: GEN.mujer, mundo_id: MUN.urbano, genero: "MUJER", mundo: "URBANO", linea: "ABRIGO" },
  [NODO.mc]: { genero_id: GEN.mujer, mundo_id: MUN.casual, genero: "MUJER", mundo: "CASUAL", linea: "POLO" },
  [NODO.hu]: { genero_id: GEN.hombre, mundo_id: MUN.urbano, genero: "HOMBRE", mundo: "URBANO", linea: "DENIM" },
  [NODO.nu]: { genero_id: GEN.nino, mundo_id: MUN.urbano, genero: "NIÑO", mundo: "URBANO", linea: "DENIM" },
};

export function catalogoFalso(): Catalogo {
  return {
    nodos: new Map(Object.entries(nombresNodos).map(([nodo, n]) => [nodo, { ...n, linea_id: `l-${n.linea}`, equivalencias: new Map<string, string>() }])),
    agrupacionesMarca: new Map(),
    agrupacionesEstacionalidad: new Map(),
  };
}

/** Las filas base del conjunto de un nodo (como las arma el servicio) para las pruebas puras. */
export function filasBaseDe(nodos: readonly string[]): FilaCrecimiento[] {
  return FILAS_BASE.filter((f) => nodos.includes(f.nodo)).map((f, i) => {
    const n = nombresNodos[f.nodo];
    return { fila_id: `fila-${i}`, genero_id: n.genero_id, mundo_id: n.mundo_id, crecimiento_pct: null, decidido: null, propuesto: null, base_siguiente: f.b, base_normalizada: f.bc, sobre_base: "corregida" as const };
  });
}

/** Entrada pura de MUJER · URBANO (lo mismo que arma el servicio con la base falsa). */
export function entradaMujerUrbano(extra: Partial<EntradaVentaPorTienda> = {}): EntradaVentaPorTienda {
  const nodos = [NODO.mu1, NODO.mu2];
  const conB = new Set(FILAS_BASE.filter((f) => nodos.includes(f.nodo) && f.b !== null).map((f) => f.clave));
  const nuevas: FilaTiendaNueva[] = FILAS_TIENDA.filter((f) => nodos.includes(f.nodo)).map((f) => ({ tienda_id: f.tienda, clave: claveTienda(f), vigente: f.decidido ?? f.propuesto ?? 0 }));
  const v = ventaTiendaFalsa({ p_gml_ids: nodos, p_desde: "2023-01-01", p_hasta: "2026-09-01" });
  return {
    conjunto: { clave: GM_MU, nombre: "MUJER · URBANO", es_resto: false },
    anio: Y,
    hastaPeriodo: "2026-09",
    k: K,
    versionMetodo: 5,
    series: v.series,
    cargas: v.cargas,
    bloquesY: bloquesFixture()[Y],
    bloquesSig: bloquesFixture()[Y + 1],
    maestro: maestroVenta(),
    filasBase: filasBaseDe(nodos),
    vigentes: vigentesDeTiendasNuevas(nuevas, conB),
    fueraBase: { filas: 1, unidades: 150 },
    ...extra,
  };
}

// ─── Base falsa (rutas) ───

export const estadoRol = { rol: "admin" as "admin" | "planner" | "comprador" | "sin_sesion" };
const PERFIL = { id: "99999999-9999-4999-8999-999999999999", email: "javier@example.com", nombre: "Javier", activo: true };

/** Guards falsos: `requireUser` deja pasar a los tres roles; `requirePlanner` rechaza al comprador con 403. Sin sesión, 401 en los dos. */
export function guardFalso() {
  const sinSesion = () => ({ user: null, perfil: null, rol: null, response: NextResponse.json({ error: "No autenticado." }, { status: 401 }) });
  return {
    requireUser: async () => (estadoRol.rol === "sin_sesion" ? sinSesion() : { user: {}, perfil: { ...PERFIL, rol: estadoRol.rol }, rol: estadoRol.rol, response: null }),
    requirePlanner: async () => {
      if (estadoRol.rol === "sin_sesion") return sinSesion();
      if (estadoRol.rol === "comprador") return { user: null, perfil: null, rol: null, response: NextResponse.json({ error: "Tu rol es de solo lectura." }, { status: 403 }) };
      return { user: {}, perfil: { ...PERFIL, rol: estadoRol.rol }, rol: estadoRol.rol, response: null };
    },
  };
}

/** Lo que cambia entre casos: lo que devuelve la función SQL falsa. Se reinicia con `sembrarVentaPorTienda`. */
export const ajustes: { sinCargas: string[]; extra: SerieVentaTienda[]; porNodo: Record<string, SerieVentaTienda[]> | undefined } = { sinCargas: [], extra: [], porNodo: undefined };

export type OpcionesSiembra = { parametros?: Record<string, unknown>; resumen?: Record<string, unknown> | null; estadoProyeccion?: string; calculandoDesde?: string | null; tiendas?: readonly TiendaMaestro[] };

/** Siembra la proyección 2026 ya calculada (método 5), sus filas, las tiendas, los géneros y los mundos en la base falsa de M7 y engancha la función SQL falsa. */
export function sembrarVentaPorTienda(o: OpcionesSiembra = {}) {
  ajustes.sinCargas = [];
  ajustes.extra = [];
  ajustes.porNodo = undefined;
  base.ventaTienda = (args) => ventaTiendaFalsa(args, { sinCargas: ajustes.sinCargas, extra: ajustes.extra, porNodo: ajustes.porNodo });
  base.tablas.generos = [
    { id: GEN.hombre, nombre: "HOMBRE", orden: 1, activo: true },
    { id: GEN.mujer, nombre: "MUJER", orden: 2, activo: true },
    { id: GEN.nino, nombre: "NIÑO", orden: 3, activo: true },
  ];
  base.tablas.mundos = [
    { id: MUN.urbano, nombre: "URBANO", orden: 1, activo: true },
    { id: MUN.casual, nombre: "CASUAL", orden: 2, activo: true },
  ];
  sembrar(
    "tiendas",
    (o.tiendas ?? TIENDAS_HOY).map((t) => ({ id: t.id, codigo: t.codigo, nombre: t.nombre, tipo: t.tipo, activo: t.activo, fecha_apertura: t.fecha_apertura, fecha_cierre: t.fecha_cierre }))
  );
  sembrar("proyecciones", [
    {
      id: P_ID,
      anio_en_curso: Y,
      nombre: "Proyección 2026–2027",
      estado: o.estadoProyeccion ?? "en_trabajo",
      hasta_periodo: "2026-09-01",
      parametros: o.parametros ?? { bloques: bloquesFixture() },
      resumen: o.resumen === undefined ? { version_metodo: 5, gm_fuera_base: { [`${GEN.mujer}|${MUN.urbano}`]: { filas: 1, unidades: 150 } } } : o.resumen,
      calculando_desde: o.calculandoDesde ?? null,
    },
  ]);
  const filas = sembrar(
    "proyeccion_filas",
    [
      ...FILAS_BASE.map((f) => ({ proyeccion_id: P_ID, tienda_id: null, gml_id: f.nodo, equivalencia_id: null, agrupacion_marca_id: f.clave.split("|")[3], clave: f.clave, nivel_proyectado: "GML" })),
      ...FILAS_TIENDA.map((f) => ({ proyeccion_id: P_ID, tienda_id: f.tienda, gml_id: f.nodo, equivalencia_id: null, agrupacion_marca_id: f.am, clave: claveTienda(f), nivel_proyectado: "GML" })),
    ]
  );
  const idDe = (clave: string) => filas.find((f) => f.clave === clave)?.id as string;
  sembrar("proyeccion_fila_anios", [
    ...FILAS_BASE.map((f) => ({ fila_id: idDe(f.clave), anio: Y + 1, bloque: "mismas", base_siguiente: f.b, base_normalizada: f.bc, propuesto: f.b === null ? null : f.b + 100, decidido: null, origen: null })),
    ...FILAS_TIENDA.map((f) => ({
      fila_id: idDe(claveTienda(f)),
      anio: Y,
      bloque: "nuevas",
      subbloque: "aperturas",
      propuesto: f.propuesto,
      decidido: f.decidido,
      origen: f.decidido === null ? null : "manual",
    })),
  ]);
}

/** Todas las respuestas de la función SQL falsa anotan sus argumentos aquí. */
export const llamadasVenta = () => base.llamadasVentaTienda;
