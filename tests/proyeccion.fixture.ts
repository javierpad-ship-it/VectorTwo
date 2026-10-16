import type { PeriodoParaClase } from "@/lib/curvas/atipicos";
import type { ConfigFlujo } from "@/lib/marcas/gml/flujo";
import { claveIncluye, clavesPertenencia, esMisma } from "@/lib/proyeccion/bloques";
import type { FilaPlana } from "@/lib/proyeccion/matriz";
import type {
  AgrupacionProy,
  CurvaVigenteProy,
  EntradaCalculo,
  FactorProy,
  FilaModelo,
  NodoProy,
  TiendaProy,
  VentaProyeccion,
} from "@/lib/proyeccion/tipos";

/**
 * Fixture sintético de M7 (docs/modulos/07-proyeccion-anual.md, sección 9). Nada real de Lukers: tiendas T1…T9 y un
 * CD, cuatro nodos y cifras inventadas. Las funciones devuelven copias nuevas para que cada caso modifique su estado
 * sin contaminar a los demás.
 */

export const Y = 2026;
export const K = 9;

// ─── Ids ───

const uuid = (n: string) => `00000000-0000-4000-8000-${n.padStart(12, "0")}`;
/** Los ids del árbol son uuid (como en la base): las rutas validan el formato. */
export const N = { denim: uuid("d001"), abrigo: uuid("d002"), sandalia: uuid("d003"), mixta: uuid("d004") } as const;
export const GEN = { hombre: uuid("a001"), mujer: uuid("a002") } as const;
export const MUN = { urbano: uuid("b001"), casual: uuid("b002") } as const;
export const LIN = { denim: uuid("c001"), abrigo: uuid("c002"), sandalia: uuid("c003"), mixta: uuid("c004") } as const;
export const EQ = {
  skinny: "e-skinny",
  recto: "e-recto",
  parka: "e-parka",
  sandalia: "e-sandalia",
  mixtaInv: "e-mixta-inv",
  mixtaVer: "e-mixta-ver",
} as const;
export const AG = { denim: "a-denim-ho", inv: "a-ho-invierno", ver: "a-mu-verano" } as const;
export const AM = { rec: "am-reconocido", pre: "am-premium", val: "am-valor" } as const;
export const MARCA = { alfa: "m-alfa", alfaJeans: "m-alfa-jeans", delta: "m-delta", beta: "m-beta" } as const;
export const TALLA = { central: "t-central", extrema: "t-extrema" } as const;

// ─── Curvas ───

export const CURVA_PLANA = Array.from({ length: 12 }, () => 1 / 12);
export const CURVA_INVIERNO = [0.02, 0.02, 0.06, 0.12, 0.2, 0.24, 0.16, 0.08, 0.04, 0.02, 0.02, 0.02];
export const CURVA_VERANO = [0.14, 0.12, 0.08, 0.04, 0.03, 0.02, 0.02, 0.03, 0.08, 0.12, 0.14, 0.18];

export const agrupaciones = (): AgrupacionProy[] => [
  { id: AG.denim, nombre: "DENIM HO", temporada: "todo_el_ano" },
  { id: AG.inv, nombre: "HO INVIERNO", temporada: "invierno" },
  { id: AG.ver, nombre: "MU VERANO", temporada: "verano" },
];

export const vigentes = (): CurvaVigenteProy[] => [
  { agrupacion_id: AG.denim, curva_id: "c-denim-v1", version: 1, curva: [...CURVA_PLANA], eat_por_pliegue: [{ anio: 2025, eat: 9.8 }] },
  { agrupacion_id: AG.inv, curva_id: "c-inv-v1", version: 1, curva: [...CURVA_INVIERNO] },
  { agrupacion_id: AG.ver, curva_id: "c-ver-v1", version: 1, curva: [...CURVA_VERANO] },
];

// ─── Árbol ───

export const nodos = (): NodoProy[] => [
  {
    gml_id: N.denim,
    nivel: "GML",
    genero_id: GEN.hombre,
    mundo_id: MUN.urbano,
    linea_id: LIN.denim,
    genero: "HOMBRE",
    mundo: "URBANO",
    linea: "DENIM",
    equivalencias: [
      { id: EQ.skinny, nombre: "SKINNY", agrupacion_estacionalidad_id: AG.denim },
      { id: EQ.recto, nombre: "RECTO", agrupacion_estacionalidad_id: AG.denim },
    ],
  },
  {
    gml_id: N.abrigo,
    nivel: "GMLE",
    genero_id: GEN.hombre,
    mundo_id: MUN.casual,
    linea_id: LIN.abrigo,
    genero: "HOMBRE",
    mundo: "CASUAL",
    linea: "ABRIGO",
    equivalencias: [{ id: EQ.parka, nombre: "PARKA", agrupacion_estacionalidad_id: AG.inv }],
  },
  {
    gml_id: N.sandalia,
    nivel: "GML",
    genero_id: GEN.mujer,
    mundo_id: MUN.casual,
    linea_id: LIN.sandalia,
    genero: "MUJER",
    mundo: "CASUAL",
    linea: "SANDALIA",
    equivalencias: [{ id: EQ.sandalia, nombre: "SANDALIA", agrupacion_estacionalidad_id: AG.ver }],
  },
  {
    gml_id: N.mixta,
    nivel: "GML",
    genero_id: GEN.mujer,
    mundo_id: MUN.casual,
    linea_id: LIN.mixta,
    genero: "MUJER",
    mundo: "CASUAL",
    linea: "MIXTA",
    equivalencias: [
      { id: EQ.mixtaInv, nombre: "MIXTA INV", agrupacion_estacionalidad_id: AG.inv },
      { id: EQ.mixtaVer, nombre: "MIXTA VER", agrupacion_estacionalidad_id: AG.ver },
    ],
  },
];

// ─── Tiendas ───

const tienda = (id: string, apertura: string | null, cierre: string | null = null, extra: Partial<TiendaProy> = {}): TiendaProy => ({
  id,
  codigo: id,
  nombre: `Tienda ${id}`,
  tipo: "Tienda",
  activo: true,
  fecha_apertura: apertura,
  fecha_cierre: cierre,
  zona: null,
  venta_esperada: null,
  referente_id: null,
  ...extra,
});

export const tiendas = (extra: Record<string, Partial<TiendaProy>> = {}): TiendaProy[] => {
  const base: TiendaProy[] = [
    tienda("T1", "2020-01-10", null, { zona: "Norte" }),
    tienda("T6", "2025-01-01"),
    tienda("T2", "2025-11-20", null, { nombre: "Tienda nueva A" }),
    tienda("T3", "2026-07-01"),
    tienda("T4", "2027-03-15", null, { zona: "Norte", venta_esperada: 850000, referente_id: "T1", nombre: "Tienda nueva B" }),
    tienda("T5", "2019-01-01", "2027-06-30"),
    tienda("T7", "2019-01-01", "2026-06-30"),
    tienda("T8", "2019-01-01", "2025-12-31"),
    tienda("T9", "2026-03-01"),
    { ...tienda("CD", null), tipo: "Centro de Distribución", nombre: "Centro de distribución" },
  ];
  return base.map((t) => ({ ...t, ...(extra[t.id] ?? {}) }));
};

// ─── Periodos del Niño y factores ───

export const periodos = (): PeriodoParaClase[] => [
  { id: "p-inv-2023", desde: "2023-01", hasta: "2023-12", motivo: "Niño 2023", alcance: "invierno", temporadas: ["invierno"], activo: true },
  { id: "p-ver-2023", desde: "2023-09", hasta: "2023-12", motivo: "Niño 2023", alcance: "invierno", temporadas: ["verano"], activo: true },
  { id: "p-inv-2026", desde: "2026-01", hasta: "2026-12", motivo: "Niño 2026", alcance: "invierno", temporadas: ["invierno"], activo: true },
  { id: "p-ver-2026", desde: "2026-09", hasta: "2026-12", motivo: "Niño 2026", alcance: "invierno", temporadas: ["verano"], activo: true },
];

export const factores = (): FactorProy[] => [
  { anio: 2023, temporada: "invierno", ratio_calculado: 0.63, ratio_aplicado: null },
  { anio: 2023, temporada: "verano", ratio_calculado: 0.73, ratio_aplicado: null },
  { anio: 2026, temporada: "invierno", ratio_calculado: 0.66, ratio_aplicado: null },
  { anio: 2026, temporada: "verano", ratio_calculado: 1.24, ratio_aplicado: null },
];

// ─── Hechos de venta ───

export type Hecho = {
  tienda: string;
  nodo: keyof typeof N;
  /** Equivalencia real (en un nodo GML, la lectura la colapsa). */
  eq: string;
  agm: string;
  /** Marca de la unidad de marca (ya colapsada: ALFA JEANS cuenta como ALFA). */
  marca: string;
  talla?: string;
  /** `aaaa-mm`. */
  periodo: string;
  unidades: number;
  /** Soles; por defecto `unidades × precio`. */
  soles?: number;
  /** Stock de fin de mes; por defecto dos meses de cobertura. */
  stock?: number;
};

const dos = (n: number) => String(n).padStart(2, "0");

/** Meses `aaaa-mm` de `desde` a `hasta`, ambos incluidos. */
export function meses(desde: string, hasta: string): string[] {
  const salida: string[] = [];
  let [a, m] = desde.split("-").map(Number);
  for (;;) {
    const p = `${a}-${dos(m)}`;
    if (p > hasta) return salida;
    salida.push(p);
    if (m === 12) {
      a += 1;
      m = 1;
    } else m += 1;
  }
}

type Molde = Omit<Hecho, "periodo" | "unidades"> & { precio?: number };

/** Una serie mensual de un molde con una función `(anio, mes) → unidades`. */
export function serie(molde: Molde, desde: string, hasta: string, f: (anio: number, mes: number) => number): Hecho[] {
  return meses(desde, hasta).map((p) => {
    const [a, m] = p.split("-").map(Number);
    const unidades = f(a, m);
    const { precio, ...resto } = molde;
    return { ...resto, periodo: p, unidades, soles: unidades * (precio ?? 100), stock: unidades * 2 };
  });
}

/** Hechos sin venta con stock (la línea está en la tienda pero no se vendió): cuentan como disponibilidad. */
export function conStockSinVenta(molde: Molde, desde: string, hasta: string, stock = 10): Hecho[] {
  return meses(desde, hasta).map((p) => {
    const { precio: _precio, ...resto } = molde;
    void _precio;
    return { ...resto, periodo: p, unidades: 0, soles: 0, stock };
  });
}

export const INICIO_HECHOS = "2023-01";
const INICIO = INICIO_HECHOS;
const FIN = "2026-09";
const plano = (n: number) => () => n;

const denim = (tienda: string, agm: string = AM.rec, marca: string = MARCA.alfa): Molde => ({ tienda, nodo: "denim", eq: EQ.skinny, agm, marca, talla: TALLA.central });

/** Patrón mensual de ABRIGO (invierno) de 2026 hasta setiembre: V = 940, C_9 = 0,94. */
export const ABRIGO_2026 = [20, 20, 60, 120, 200, 240, 160, 80, 40];

/**
 * Escenario base: DENIM × RECONOCIDO plano (T1 100, T6 30, T5 20, T7 10, T8 10, T2 25, T3 40, T9 con su patrón),
 * DENIM × PREMIUM (T1 5), ABRIGO × RECONOCIDO (T1), SANDALIA × VALOR (T1) y MIXTA × RECONOCIDO (T1).
 */
export function hechosBase(): Hecho[] {
  const h: Hecho[] = [];
  h.push(...serie(denim("T1"), INICIO, FIN, plano(60)));
  h.push(...serie({ ...denim("T1"), eq: EQ.recto, marca: MARCA.delta, talla: TALLA.extrema }, INICIO, FIN, plano(40)));
  h.push(...serie(denim("T5"), INICIO, FIN, plano(20)));
  h.push(...serie(denim("T6"), "2025-01", FIN, plano(30)));
  h.push(...serie(denim("T7"), INICIO, "2026-06", plano(10)));
  h.push(...serie(denim("T8"), INICIO, "2025-12", plano(10)));
  h.push(...serie(denim("T2"), "2025-11", FIN, plano(25)));
  h.push(...serie(denim("T3"), "2026-07", FIN, plano(40)));
  const t9 = [100, 80, 70, 70, 70, 55, 55];
  h.push(...serie(denim("T9"), "2026-03", FIN, (_a, m) => t9[m - 3]));
  // CD: no entra en ninguna cifra.
  h.push(...serie(denim("CD"), INICIO, FIN, plano(500)));
  // DENIM × PREMIUM (cola larga): T1 5 u/mes → V = 45, P = 60.
  h.push(...serie({ ...denim("T1", AM.pre, MARCA.beta) }, INICIO, FIN, plano(5)));
  // Las otras dos tiendas de M(2026) también tienen esa línea con stock (sin vender): disponibilidad plena, cola larga normal.
  for (const t of ["T5", "T6"]) h.push(...conStockSinVenta(denim(t, AM.pre, MARCA.beta), t === "T6" ? "2025-01" : INICIO, FIN));

  // ABRIGO × RECONOCIDO (GMLE; invierno): 2023 con Niño (×0,63), 2024 y 2025 normales, 2026 con su patrón.
  const abrigo = (tienda: string): Molde => ({ tienda, nodo: "abrigo", eq: EQ.parka, agm: AM.rec, marca: MARCA.alfa, talla: TALLA.central, precio: 200 });
  h.push(
    ...serie(abrigo("T1"), INICIO, FIN, (a, m) => {
      const forma = [20, 20, 60, 120, 200, 240, 160, 80, 40, 20, 20, 20][m - 1];
      return a === 2023 ? Math.round(forma * 0.63) : forma;
    })
  );

  // SANDALIA × VALOR (verano): T1.
  const sandalia: Molde = { tienda: "T1", nodo: "sandalia", eq: EQ.sandalia, agm: AM.val, marca: MARCA.alfa, talla: TALLA.central, precio: 50 };
  const patron2026 = [140, 120, 80, 40, 30, 20, 20, 30, 124];
  h.push(
    ...serie(sandalia, INICIO, FIN, (a, m) => {
      const base = [140, 120, 80, 40, 30, 20, 20, 30, 80, 120, 140, 180][m - 1];
      if (a === 2026) return patron2026[m - 1];
      if (a === 2023 && m >= 9) return Math.round(base * 0.73);
      return base;
    })
  );

  // MIXTA × RECONOCIDO: dos equivalencias, 80 y 20 unidades por mes en la ventana.
  const mixta = (eq: string): Molde => ({ tienda: "T1", nodo: "mixta", eq, agm: AM.rec, marca: MARCA.alfa, talla: TALLA.central });
  h.push(...serie(mixta(EQ.mixtaInv), INICIO, FIN, plano(80)));
  h.push(...serie(mixta(EQ.mixtaVer), INICIO, FIN, plano(20)));
  return h;
}

// ─── Lectura de venta (lo que devuelve `venta_proyeccion`) ───

const EQ_NODO: Record<string, string> = {
  [EQ.skinny]: N.denim,
  [EQ.recto]: N.denim,
  [EQ.parka]: N.abrigo,
  [EQ.sandalia]: N.sandalia,
  [EQ.mixtaInv]: N.mixta,
  [EQ.mixtaVer]: N.mixta,
};
const NODO_GMLE = new Set<string>([N.abrigo]);

/**
 * Imita `venta_proyeccion`: excluye el CD, agrupa por clave de pertenencia, trae `por_tienda` solo de las tiendas
 * pedidas, los pesos de las equivalencias y el detalle de `W12` de las tiendas de `M(Y)`.
 */
export function construirVenta(
  hechos: readonly Hecho[],
  listaTiendas: readonly TiendaProy[],
  opciones: { anio?: number; detalle: readonly string[]; desdeW12?: string; hasta?: string }
): VentaProyeccion {
  const anio = opciones.anio ?? Y;
  const desdeW12 = opciones.desdeW12 ?? "2025-10";
  const claves = clavesPertenencia(listaTiendas, anio);
  const esTienda = new Set(listaTiendas.filter((t) => t.tipo === "Tienda").map((t) => t.id));
  const detalle = new Set(opciones.detalle);

  const filas = new Map<string, { [campo: string]: number | string | null }>();
  const porTienda = new Map<string, { [campo: string]: number | string | null }>();
  const pesos = new Map<string, number>();
  const detalleW12 = new Map<string, { [campo: string]: number | string | null }>();
  const disponibilidad = new Map<string, { [campo: string]: number | string | null }>();
  const tiendasConStock = new Map<string, Set<string>>();
  const mismasY = listaTiendas.filter((t) => esMisma(t, anio)).length;
  const cargas: Record<string, string> = {};

  const sumar = (mapa: Map<string, { [campo: string]: number | string | null }>, clave: string, base: { [campo: string]: number | string | null }, u: number, s: number, st = 0) => {
    const f = mapa.get(clave) ?? { ...base, unidades: 0, venta_soles: 0, costo_vendido: 0, stock_unidades: 0 };
    f.unidades = (f.unidades as number) + u;
    f.venta_soles = (f.venta_soles as number) + s;
    f.stock_unidades = (f.stock_unidades as number) + st;
    mapa.set(clave, f);
  };

  for (const h of hechos) {
    if (opciones.hasta && h.periodo > opciones.hasta) continue;
    cargas[h.periodo] = `carga-${h.periodo}`;
    const gml = N[h.nodo];
    const eqFila = NODO_GMLE.has(gml) ? h.eq : null;
    // Disponibilidad (0.10.1): solo desde `desdeW12`; stock de las tiendas de M(Y) y, aparte, el del CD.
    if (h.periodo >= desdeW12) {
      const claveD = [gml, eqFila, h.agm, h.periodo].join("|");
      const d = disponibilidad.get(claveD) ?? { gml_id: gml, equivalencia_id: eqFila, agrupacion_marca_id: h.agm, periodo: `${h.periodo}-01`, tiendas_total: mismasY, tiendas_con_stock: 0, unidades_con_stock: 0, stock_cd: 0 };
      const stock = h.stock ?? h.unidades * 2;
      if (!esTienda.has(h.tienda)) d.stock_cd = (d.stock_cd as number) + stock;
      else if (claveIncluye(claves[h.tienda] ?? "00000", anio, anio) && stock > 0) {
        const vistas = tiendasConStock.get(claveD) ?? new Set<string>();
        if (!vistas.has(h.tienda)) {
          vistas.add(h.tienda);
          d.tiendas_con_stock = (d.tiendas_con_stock as number) + 1;
        }
        tiendasConStock.set(claveD, vistas);
        d.unidades_con_stock = (d.unidades_con_stock as number) + h.unidades;
      }
      disponibilidad.set(claveD, d);
    }
    if (!esTienda.has(h.tienda)) continue;
    const clave = claves[h.tienda] ?? "00000";
    const periodo = `${h.periodo}-01`;
    const soles = h.soles ?? h.unidades * 100;
    sumar(filas, [gml, eqFila, h.agm, clave, periodo].join("|"), { gml_id: gml, equivalencia_id: eqFila, agrupacion_marca_id: h.agm, clave, periodo }, h.unidades, soles, h.stock ?? h.unidades * 2);
    if (detalle.has(h.tienda)) {
      sumar(porTienda, [h.tienda, gml, eqFila, h.agm, periodo].join("|"), { tienda_id: h.tienda, gml_id: gml, equivalencia_id: eqFila, agrupacion_marca_id: h.agm, periodo }, h.unidades, soles, h.stock ?? h.unidades * 2);
    }
    if (claveIncluye(clave, anio, anio) && h.periodo >= desdeW12) {
      pesos.set(`${gml}|${h.eq}`, (pesos.get(`${gml}|${h.eq}`) ?? 0) + h.unidades);
      sumar(
        detalleW12,
        [gml, eqFila, h.agm, h.marca, h.talla].join("|"),
        { gml_id: gml, equivalencia_id: eqFila, agrupacion_marca_id: h.agm, marca_id: h.marca, agrupacion_talla_id: h.talla ?? TALLA.central },
        h.unidades,
        soles
      );
    }
  }

  const limpiar = (f: { [campo: string]: number | string | null }, quitar: string[]) => {
    const copia = { ...f };
    for (const q of quitar) delete copia[q];
    return copia;
  };
  return {
    filas: [...filas.values()].map((f) => f as never),
    por_tienda: [...porTienda.values()].map((f) => limpiar(f, ["costo_vendido"]) as never),
    equivalencias: [...pesos].map(([k, unidades]) => {
      const [gml_id, equivalencia_id] = k.split("|");
      return { gml_id, equivalencia_id, unidades };
    }),
    detalle_w12: [...detalleW12.values()].map((f) => limpiar(f, ["venta_soles", "costo_vendido", "stock_unidades"]) as never),
    disponibilidad: [...disponibilidad.values()].map((f) => f as never),
    cargas,
  };
}

/** `ConfigFlujo` sintética: ALFA es marca relevante por GML en DENIM; ALFA JEANS es miembro de su conjunto. */
export function configFlujo(): ConfigFlujo {
  return {
    unidadDe: new Map([
      [MARCA.alfa, MARCA.alfa],
      [MARCA.alfaJeans, MARCA.alfa],
      [MARCA.delta, MARCA.delta],
      [MARCA.beta, MARCA.beta],
    ]),
    marcas: new Map([
      [MARCA.alfa, { agrupacion_marca_id: AM.rec, marcada: true, vigente: true, modalidad: "por_gml" as const }],
      [MARCA.delta, { agrupacion_marca_id: AM.rec, marcada: false, vigente: true, modalidad: null }],
      [MARCA.beta, { agrupacion_marca_id: AM.pre, marcada: false, vigente: true, modalidad: null }],
    ]),
    nodoDeEquivalencia: new Map(Object.entries(EQ_NODO)),
    nivelDeNodo: new Map([
      [N.denim, "GML" as const],
      [N.abrigo, "GMLE" as const],
      [N.sandalia, "GML" as const],
      [N.mixta, "GML" as const],
    ]),
    relevantes: new Set([`${MARCA.alfa}|${N.denim}`]),
  };
}

/** La entrada completa del cálculo con el escenario base; cada caso cambia lo que necesite. */
export function entrada(cambios: Partial<EntradaCalculo> & { hechos?: Hecho[]; detalle?: string[]; tiendasExtra?: Record<string, Partial<TiendaProy>> } = {}): EntradaCalculo {
  const lista = tiendas(cambios.tiendasExtra);
  const hechos = cambios.hechos ?? hechosBase();
  const k = cambios.k ?? K;
  const hastaMes = `${Y}-${dos(k)}`;
  const detalle = cambios.detalle ?? ["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T9"];
  return {
    anio: Y,
    k,
    hoy: "2026-10-15",
    parametros: { crecimiento_pct_defecto: 5, umbral_avance: 0.3, umbral_cobertura: 0.25, umbral_cola_larga: 100, umbral_disponibilidad: 0.75, rampa_maduracion: [1, 1, 1] },
    tiendas: lista,
    nodos: nodos(),
    agrupaciones: agrupaciones(),
    vigentes: vigentes(),
    periodos: periodos(),
    factores: factores(),
    venta: construirVenta(hechos, lista, { detalle, hasta: hastaMes }),
    planAnterior: null,
    configFlujo: configFlujo(),
    ...cambios,
  };
}

/** DENIM × VALOR: T1 vende `u` por mes; T6 tiene stock sin vender; T5 no tiene la línea en el período (M(2026) = T1, T6, T5). */
export const lineaDenimValor = (u: number, opciones: { stockT1?: number; conT6?: boolean } = {}): Hecho[] => [
  ...serie({ tienda: "T1", nodo: "denim", eq: EQ.skinny, agm: AM.val, marca: MARCA.beta, talla: TALLA.central }, INICIO, "2026-09", () => u).map((h) => (opciones.stockT1 === undefined ? h : { ...h, stock: opciones.stockT1 })),
  ...(opciones.conT6 === false ? [] : conStockSinVenta({ tienda: "T6", nodo: "denim", eq: EQ.skinny, agm: AM.val, marca: MARCA.beta, talla: TALLA.central }, "2025-01", "2026-09")),
];

/** Clave de la fila base DENIM × RECONOCIDO, etc. */
export const clave = (nodo: keyof typeof N, agm: string, eq: string | null = null) => `|${N[nodo]}|${eq ?? ""}|${agm}`;
export const claveTienda = (t: string, nodo: keyof typeof N, agm: string, eq: string | null = null) => `${t}|${N[nodo]}|${eq ?? ""}|${agm}`;

// ─── Del modelo a lo que leen matriz, mensual y contrato de M8 ───

const NOMBRE_AM: Record<string, string> = { [AM.rec]: "RECONOCIDO", [AM.pre]: "PREMIUM", [AM.val]: "VALOR" };

/** Aplana las filas del modelo como las leería la API (sin `historico`). */
export function aPlanas(filas: readonly FilaModelo[], extra: { nodos?: NodoProy[] } = {}): FilaPlana[] {
  const porNodo = new Map((extra.nodos ?? nodos()).map((n) => [n.gml_id, n]));
  const nombresAg = new Map(agrupaciones().map((a) => [a.id, a]));
  return filas.map((f, i) => {
    const n = porNodo.get(f.gml_id) as NodoProy;
    const ag = f.agrupacion_estacionalidad_id ? nombresAg.get(f.agrupacion_estacionalidad_id) : undefined;
    return {
      id: `fila-${i}`,
      tienda_id: f.tienda_id,
      gml_id: f.gml_id,
      equivalencia_id: f.equivalencia_id,
      agrupacion_marca_id: f.agrupacion_marca_id,
      nivel: f.nivel,
      genero: n.genero,
      mundo: n.mundo,
      linea: n.linea,
      genero_id: n.genero_id,
      mundo_id: n.mundo_id,
      linea_id: n.linea_id,
      equivalencia: f.equivalencia_id ? (n.equivalencias.find((e) => e.id === f.equivalencia_id)?.nombre ?? null) : null,
      agrupacion_marca: NOMBRE_AM[f.agrupacion_marca_id],
      agrupacion_estacionalidad: ag ? { id: ag.id, nombre: ag.nombre, temporada: ag.temporada } : null,
      avisos: f.avisos,
      activo: f.activo,
      participaciones: f.participaciones,
      anios: f.registros.map((r) => ({ ...r })),
    };
  });
}
