import { bloquesDeAnio, clavesPertenencia } from "@/lib/proyeccion/bloques";
import type { TiendaMaestro } from "@/lib/curvas/tipos";
import type { MaestrosDireccion, NinoDeHoy } from "@/lib/direccion/contexto";
import { estadoDireccion, huellaFalsa, sembrar, sembrarAprobacion, base as baseFalsa, type Fila, type Hecho } from "./direccion.fake-db";

/**
 * Caso sintético del tablero de aprobación de dirección (ficha 14, §6.1). Todas las cifras son inventadas: ninguna es de Lukers.
 *
 * Este archivo solo trae las CIFRAS del caso (tiendas, venta por mes, proyección por fila) y ayudas puras para leerlas. La base falsa que las sirve
 * a través de los `rpc` está en `tests/direccion.fake-db.ts`.
 */

// ─── Identificadores (uuid sintéticos, en minúsculas) ───

const uuid = (grupo: string, n: number): string => `${grupo}-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const Y = 2026;
export const K = 9;
export const K_PRIMA = 10;

export const G_HOMBRE = uuid("a0000001", 1);
export const G_MUJER = uuid("a0000001", 2);
export const G_NINO = uuid("a0000001", 3);
export const M_URBANO = uuid("a0000002", 1);
export const M_FORMAL = uuid("a0000002", 2);

/** Nodos de planificación (líneas) del caso. */
export const L1_HU = uuid("a0000003", 1);
export const L2_HU = uuid("a0000003", 2);
export const L1_MU = uuid("a0000003", 3);
export const L2_MU = uuid("a0000003", 4);

export const AM_A = uuid("a0000004", 1);
export const AM_B = uuid("a0000004", 2);

/** Unidad de marca X (cabeza, en AM-A), una segunda marca de la misma unidad y otra unidad en AM-B. */
export const MARCA_X = uuid("a0000005", 1);
export const MARCA_X2 = uuid("a0000005", 2);
export const MARCA_Z = uuid("a0000005", 3);
/** Otra unidad de marca de AM-A (para que la unidad X no sea toda la agrupación). */
export const MARCA_W = uuid("a0000005", 4);

export const T01 = uuid("a0000006", 1);
export const T02 = uuid("a0000006", 2);
export const T03 = uuid("a0000006", 3);
export const T04 = uuid("a0000006", 4);
export const T09 = uuid("a0000006", 9);
export const T10 = uuid("a0000006", 10);
export const T12 = uuid("a0000006", 12);
export const CD1 = uuid("a0000006", 99);

export const P_MOSTRADA = uuid("a0000007", 1);
export const P_SEGUIMIENTO = uuid("a0000007", 2);
export const P_EN_TRABAJO = uuid("a0000007", 3);

export const PERFIL_ADMIN = uuid("a0000008", 1);
export const PERFIL_PLANNER = uuid("a0000008", 2);
export const PERFIL_COMPRADOR = uuid("a0000008", 3);

// ─── Tiendas ───

export type TiendaCaso = { id: string; codigo: string; nombre: string; tipo: "Tienda" | "CD"; fecha_apertura: string | null; fecha_cierre: string | null };

export const TIENDAS: TiendaCaso[] = [
  { id: T01, codigo: "T01", nombre: "Tienda uno", tipo: "Tienda", fecha_apertura: "2015-03-01", fecha_cierre: null },
  { id: T02, codigo: "T02", nombre: "Tienda dos", tipo: "Tienda", fecha_apertura: "2016-06-01", fecha_cierre: null },
  { id: T03, codigo: "T03", nombre: "Tienda tres", tipo: "Tienda", fecha_apertura: "2018-01-10", fecha_cierre: null },
  { id: T04, codigo: "T04", nombre: "Tienda cuatro", tipo: "Tienda", fecha_apertura: "2019-05-01", fecha_cierre: "2027-06-30" },
  { id: T09, codigo: "T09", nombre: "Tienda nueve", tipo: "Tienda", fecha_apertura: "2014-01-01", fecha_cierre: "2024-08-31" },
  { id: T10, codigo: "T10", nombre: "Tienda diez", tipo: "Tienda", fecha_apertura: "2025-11-15", fecha_cierre: null },
  { id: T12, codigo: "T12", nombre: "Tienda doce", tipo: "Tienda", fecha_apertura: "2027-04-01", fecha_cierre: null },
  { id: CD1, codigo: "CD1", nombre: "Centro de distribución", tipo: "CD", fecha_apertura: "2010-01-01", fecha_cierre: null },
];

export const tiendaDe = (id: string): TiendaCaso => {
  const t = TIENDAS.find((x) => x.id === id);
  if (!t) throw new Error(`Tienda desconocida en el caso: ${id}`);
  return t;
};

// ─── Ayudas de reparto (solo para armar el caso) ───

/** Reparte `total` según `perfil`, en enteros por mayor resto (empate: posición). */
export function repartir(total: number, perfil: readonly number[]): number[] {
  const suma = perfil.reduce((a, b) => a + b, 0);
  const exactos = perfil.map((p) => (total * p) / suma);
  const pisos = exactos.map((x) => Math.floor(x));
  let sobran = total - pisos.reduce((a, b) => a + b, 0);
  const orden = exactos.map((x, i) => ({ i, f: x - pisos[i] })).sort((a, b) => b.f - a.f || a.i - b.i);
  for (const o of orden) {
    if (sobran <= 0) break;
    pisos[o.i] += 1;
    sobran -= 1;
  }
  return pisos;
}

export const suma = (v: readonly number[]): number => v.reduce((a, b) => a + b, 0);

/** Perfil mensual de la red (diciembre fuerte). */
export const PERFIL_RED = [70, 60, 65, 70, 85, 80, 95, 75, 75, 80, 90, 155];

// ─── Venta de HOMBRE · URBANO (unidades por mes) ───

/** 2023 y 2024: solo se fija el total anual por tienda (§6.1); el mes a mes sigue el perfil de la red. T09 cerró el 2024-08-31. */
export const HU_ANUAL: Record<number, Record<string, number>> = {
  2023: { [T01]: 19000, [T02]: 12000, [T03]: 6000, [T04]: 2500, [T09]: 500 },
  2024: { [T01]: 20000, [T02]: 12500, [T03]: 6500, [T04]: 2700, [T09]: 300 },
};

export const HU_2025: Record<string, number[]> = {
  [T01]: [1607, 1378, 1493, 1607, 1952, 1837, 2182, 1722, 1722, 1600, 1800, 3100],
  [T02]: [996, 853, 924, 995, 1209, 1138, 1351, 1067, 1067, 1083, 1219, 2098],
  [T03]: [338, 304, 371, 608, 810, 877, 911, 742, 439, 600, 600, 900],
  [T04]: [259, 222, 241, 259, 315, 296, 352, 278, 278, 172, 194, 334],
  [T10]: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 100, 200],
};

/** 2026: enero a octubre (lo publicado; `k' = 10`). */
export const HU_2026: Record<string, number[]> = {
  [T01]: [1556, 1333, 1444, 1555, 1889, 1778, 2111, 1667, 1667, 1650],
  [T02]: [933, 800, 867, 933, 1133, 1067, 1267, 1000, 1000, 1000],
  [T03]: [313, 281, 344, 563, 750, 812, 844, 687, 406, 400],
  [T04]: [207, 178, 193, 207, 252, 237, 282, 222, 222, 240],
  [T10]: [334, 334, 334, 333, 333, 333, 333, 333, 333, 1010],
};

/** Venta mensual de HOMBRE · URBANO de una tienda (`mes` de 1 a 12); 0 si no vendió o el mes no está publicado. */
export function ventaHU(tiendaId: string, anio: number, mes: number): number {
  if (anio === 2025) return HU_2025[tiendaId]?.[mes - 1] ?? 0;
  if (anio === 2026) return HU_2026[tiendaId]?.[mes - 1] ?? 0;
  const anual = HU_ANUAL[anio]?.[tiendaId];
  if (anual === undefined) return 0;
  // T09 cerró en agosto de 2024: solo vende de enero a agosto ese año.
  const perfil = tiendaId === T09 && anio === 2024 ? PERFIL_RED.map((p, i) => (i < 8 ? p : 0)) : PERFIL_RED;
  return repartir(anual, perfil)[mes - 1] ?? 0;
}

/** ¿Hay carga publicada de ese mes? De enero de 2023 a octubre de 2026. */
export const publicadoCaso = (anio: number, mes: number): boolean => anio >= 2023 && (anio < 2026 || (anio === 2026 && mes <= K_PRIMA));

/** ¿La tienda estuvo abierta los doce meses de ese año? (con las fechas del caso). */
export function completaCaso(tiendaId: string, anio: number): boolean {
  const t = tiendaDe(tiendaId);
  if (!t.fecha_apertura || t.fecha_apertura > `${anio}-01-01`) return false;
  return t.fecha_cierre === null || t.fecha_cierre >= `${anio}-12-31`;
}

// ─── Proyección de HOMBRE · URBANO (§6.1) ───

/** Meses de las filas base de 2026 (T01–T04): vendido ene–set 31 000 + oct 3 600, nov 4 050, dic 7 251 = 45 901. */
export const HU_BASE_2026_MESES = [...[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => HU_2026[T01][i] + HU_2026[T02][i] + HU_2026[T03][i] + HU_2026[T04][i]), 3600, 4050, 7251];
export const HU_BASE_2026 = 45901;
/** Fila de tienda T10 de 2026 (nueva del año anterior; su fila base tiene `B`): real 3 000 + oct 300, nov 330, dic 470 = 4 100. */
export const HU_T10_2026_MESES = [334, 334, 334, 333, 333, 333, 333, 333, 333, 300, 330, 470];
export const HU_T10_2026 = 4100;

export const HU_B = 47040;
export const HU_B_CORR = 47793;
export const HU_PROPUESTA_2027 = 50183;
export const HU_BASE_2027 = 50300;
export const HU_BASE_2027_MESES = [3521, 3018, 3270, 3521, 4276, 4024, 4779, 3772, 3772, 4024, 4527, 7796];
/** Fila de tienda T04 de 2027 (cierre): enero a junio. */
export const HU_T04_2027_MESES = [150, 140, 150, 160, 200, 200, 0, 0, 0, 0, 0, 0];
/** Fila de tienda T12 de 2027 (apertura): abril a diciembre. */
export const HU_T12_2027_MESES = [0, 0, 0, 100, 120, 130, 150, 160, 150, 170, 180, 248];

// ─── Resultados esperados de la atribución (§6.1) ───

export const ESPERADO = {
  /** Atribución de 2026 (07f): `R = 47 040 − 4 100 = 42 940` repartido 15 000 : 9 000 : 5 000. */
  a2026: { [T01]: 22210, [T02]: 13326, [T03]: 7404, [T04]: 2961 } as Record<string, number>,
  /** Octubre a diciembre de 2026. */
  t03_oct_dic: [659, 673, 1072],
  t04_oct_dic: [226, 260, 475],
  a2027: { [T01]: 23749, [T02]: 14250, [T03]: 7917, [T10]: 4384 } as Record<string, number>,
  t03_2027: [374, 334, 402, 615, 804, 845, 904, 731, 473, 679, 693, 1063],
};

// ─────────────────────────────────────────────────────────────────────────────
// Siembra del caso en la base falsa (`tests/direccion.fake-db.ts`)
// ─────────────────────────────────────────────────────────────────────────────


export const PLANNER = "Planner P.";
export const ADMIN = "Admin A.";
const dos = (n: number) => String(n).padStart(2, "0");

/** Instantes en hora de Lima (UTC−5) de los días del caso. */
export const EL_05_NOV = "2026-11-05T15:00:00.000Z";
export const EL_06_NOV = "2026-11-06T15:00:00.000Z";
export const EL_07_NOV = "2026-11-07T15:00:00.000Z";
export const EL_03_NOV = "2026-11-03T15:00:00.000Z";

const comoMaestro = (t: TiendaCaso): TiendaMaestro => ({ id: t.id, codigo: t.codigo, nombre: t.nombre, tipo: t.tipo === "Tienda" ? "Tienda" : "Centro de Distribución", activo: true, fecha_apertura: t.fecha_apertura, fecha_cierre: t.fecha_cierre });

/** `parametros.bloques` como los guarda el cálculo de M7: cada tienda con su clave de pertenencia. */
export function bloquesCaso() {
  const maestro = TIENDAS.map(comoMaestro);
  const claves = clavesPertenencia(maestro, Y);
  return { [Y]: bloquesDeAnio(maestro, Y, claves), [Y + 1]: bloquesDeAnio(maestro, Y + 1, claves) };
}

// ─── Venta: HOMBRE · URBANO repartida entre sus cuatro pares línea × agrupación de marca, y MUJER · URBANO ───

/** Parte de la venta de HOMBRE · URBANO de cada par (suma 100). */
const PARES_HU: { gml: string; marcas: { id: string; parte: number }[]; parte: number }[] = [
  // L1 · AM-A: la unidad X (marcas X y X2) vende el 63 % y la unidad W el 37 % (lo mismo que dice `por_marca` de la fila).
  { gml: L1_HU, marcas: [{ id: MARCA_X, parte: 38 }, { id: MARCA_X2, parte: 25 }, { id: MARCA_W, parte: 37 }], parte: 50 },
  { gml: L1_HU, marcas: [{ id: MARCA_Z, parte: 100 }], parte: 24 }, // L1 · AM-B
  { gml: L2_HU, marcas: [{ id: MARCA_X, parte: 40 }, { id: MARCA_W, parte: 60 }], parte: 18 }, // L2 · AM-A
  { gml: L2_HU, marcas: [{ id: MARCA_Z, parte: 100 }], parte: 8 }, // L2 · AM-B
];

/** Precio por unidad (S/ sin IGV) de HOMBRE · URBANO: 47 en 2023, 48 en 2024, 50 de enero a octubre de 2025 y 52 desde noviembre de 2025. */
export const precioHU = (anio: number, mes: number): number => (anio === 2023 ? 47 : anio === 2024 ? 48 : anio === 2025 && mes <= 10 ? 50 : 52);

/** Venta mensual de MUJER · URBANO (toda la red; solo vende en T01, T02 y T03, 50 : 30 : 20). */
export const MU_ANUAL: Record<number, number[]> = {
  2023: repartir(24000, PERFIL_RED),
  2024: repartir(25500, PERFIL_RED),
  // 2025: 27 500 con enero a octubre en 21 000.
  2025: [...repartir(21000, PERFIL_RED.slice(0, 10)), ...repartir(6500, PERFIL_RED.slice(10))],
  // 2026: enero a setiembre 20 000 y octubre 2 300.
  2026: [...repartir(20000, PERFIL_RED.slice(0, 9)), 2300],
};
const TIENDAS_MU = [T01, T02, T03];
export const ventaMU = (tiendaId: string, anio: number, mes: number): number => {
  const i = TIENDAS_MU.indexOf(tiendaId);
  const total = MU_ANUAL[anio]?.[mes - 1];
  return i < 0 || total === undefined ? 0 : repartir(total, [50, 30, 20])[i];
};

export function hechosCaso(): Hecho[] {
  const hechos: Hecho[] = [];
  for (let anio = 2023; anio <= 2026; anio++) {
    for (let mes = 1; mes <= 12; mes++) {
      if (!publicadoCaso(anio, mes)) continue;
      const periodo = `${anio}-${dos(mes)}`;
      for (const t of TIENDAS.filter((x) => x.tipo === "Tienda")) {
        const u = ventaHU(t.id, anio, mes);
        if (u !== 0) {
          const porPar = repartir(u, PARES_HU.map((x) => x.parte));
          PARES_HU.forEach((par, i) => {
            const porMarca = repartir(porPar[i], par.marcas.map((m) => m.parte));
            par.marcas.forEach((m, j) => {
              if (porMarca[j] !== 0) hechos.push({ tienda_id: t.id, periodo, gml_id: par.gml, equivalencia_id: null, marca_id: m.id, u: porMarca[j], s: porMarca[j] * precioHU(anio, mes) });
            });
          });
        }
        const mu = ventaMU(t.id, anio, mes);
        if (mu !== 0) {
          const [a, b] = repartir(mu, [60, 40]);
          hechos.push({ tienda_id: t.id, periodo, gml_id: L1_MU, equivalencia_id: null, marca_id: MARCA_X, u: a, s: a * 40 });
          hechos.push({ tienda_id: t.id, periodo, gml_id: L2_MU, equivalencia_id: null, marca_id: MARCA_Z, u: b, s: b * 40 });
        }
      }
    }
  }
  // El CD vende 900 u en 2025 (no debe aparecer en ninguna cifra de venta) y tiene stock (solo cuenta en la cobertura).
  hechos.push({ tienda_id: CD1, periodo: "2025-06", gml_id: L1_HU, equivalencia_id: null, marca_id: MARCA_X, u: 900, s: 45000 });
  // Stock de octubre de 2026 de HOMBRE · URBANO (en un hecho sin venta por ubicación).
  const stock: Record<string, number> = { [T01]: 8000, [T02]: 5000, [T03]: 2500, [T04]: 1000, [T10]: 1500, [CD1]: 12000 };
  for (const [tienda, u] of Object.entries(stock)) hechos.push({ tienda_id: tienda, periodo: "2026-10", gml_id: L1_HU, equivalencia_id: null, marca_id: MARCA_X, u: 0, s: 0, stock: u });
  return hechos;
}

// ─── Proyección ───

type FilaBaseCaso = {
  gml: string;
  am: string;
  temporada: string;
  factor: boolean;
  porMarca: { marca_id: string; participacion: number }[] | null;
  /** 2026: meses (12) y total. */
  meses2026: number[];
  /** 2027. */
  B: number;
  Bc: number;
  propuesto: number;
  vigente: number;
  origen: "propuesta" | "manual";
  lote: boolean;
  por: string;
  at: string;
};

const FACTOR_INVIERNO = [1, 1, 1, 1, 1, 0.7, 0.7, 0.7, 1, 1, 1, 1];
/** L2 · AM-A y L2 · AM-B (invierno) suman 1 720 u en junio a agosto de 2026 (1 200 y 520). */
const L2A_2026 = [520, 450, 480, 560, 700, 400, 450, 350, 560, 640, 730, 2260];
const L2B_2026 = [240, 210, 220, 260, 330, 170, 190, 160, 260, 300, 340, 1221];
const L1B_2026 = repartir(11000, HU_BASE_2026_MESES);
const L1A_2026 = HU_BASE_2026_MESES.map((x, i) => x - L2A_2026[i] - L2B_2026[i] - L1B_2026[i]);

const L1A_2027 = repartir(25000, HU_BASE_2027_MESES);
const L1B_2027 = repartir(12000, HU_BASE_2027_MESES);
const L2A_2027 = repartir(9000, HU_BASE_2027_MESES);
const L2B_2027 = HU_BASE_2027_MESES.map((x, i) => x - L1A_2027[i] - L1B_2027[i] - L2A_2027[i]);
const MESES_2027: Record<string, number[]> = {};

export const FILAS_HU: FilaBaseCaso[] = [
  { gml: L1_HU, am: AM_A, temporada: "todo_el_ano", factor: false, porMarca: [{ marca_id: MARCA_X, participacion: 0.63 }, { marca_id: MARCA_W, participacion: 0.37 }], meses2026: L1A_2026, B: 23500, Bc: 23500, propuesto: 25000, vigente: 25000, origen: "propuesta", lote: true, por: PLANNER, at: EL_07_NOV },
  { gml: L1_HU, am: AM_B, temporada: "todo_el_ano", factor: false, porMarca: [{ marca_id: MARCA_Z, participacion: 1 }], meses2026: L1B_2026, B: 11300, Bc: 11300, propuesto: 12000, vigente: 12000, origen: "propuesta", lote: false, por: PLANNER, at: EL_07_NOV },
  { gml: L2_HU, am: AM_A, temporada: "invierno", factor: true, porMarca: [{ marca_id: MARCA_X, participacion: 0.4 }, { marca_id: MARCA_W, participacion: 0.6 }], meses2026: L2A_2026, B: 8240, Bc: 8760, propuesto: 8883, vigente: 9000, origen: "manual", lote: false, por: PLANNER, at: EL_07_NOV },
  { gml: L2_HU, am: AM_B, temporada: "invierno", factor: true, porMarca: [{ marca_id: MARCA_Z, participacion: 1 }], meses2026: L2B_2026, B: 4000, Bc: 4233, propuesto: 4300, vigente: 4300, origen: "propuesta", lote: true, por: PLANNER, at: EL_07_NOV },
];
MESES_2027[`${L1_HU}|${AM_A}`] = L1A_2027;
MESES_2027[`${L1_HU}|${AM_B}`] = L1B_2027;
MESES_2027[`${L2_HU}|${AM_A}`] = L2A_2027;
MESES_2027[`${L2_HU}|${AM_B}`] = L2B_2027;

/** MUJER · URBANO: 2026 cierre 28 500 (vendido 20 000 + proyectado 8 500); `B = B' = 28 500`; propuesta 30 780; vigente 32 006. */
const MU_2026 = [...MU_ANUAL[2026].slice(0, 9), ...repartir(8500, PERFIL_RED.slice(9))];
const MU1_2026 = repartir(17400, MU_2026);
const MU2_2026 = MU_2026.map((x, i) => x - MU1_2026[i]);
export const FILAS_MU: FilaBaseCaso[] = [
  { gml: L1_MU, am: AM_A, temporada: "todo_el_ano", factor: false, porMarca: [{ marca_id: MARCA_X, participacion: 1 }], meses2026: MU1_2026, B: 17400, Bc: 17400, propuesto: 18780, vigente: 20006, origen: "manual", lote: false, por: ADMIN, at: EL_05_NOV },
  { gml: L2_MU, am: AM_B, temporada: "todo_el_ano", factor: false, porMarca: null, meses2026: MU2_2026, B: 11100, Bc: 11100, propuesto: 12000, vigente: 12000, origen: "propuesta", lote: true, por: PLANNER, at: EL_07_NOV },
];
MESES_2027[`${L1_MU}|${AM_A}`] = repartir(20006, PERFIL_RED);
MESES_2027[`${L2_MU}|${AM_B}`] = repartir(12000, PERFIL_RED);

const LOTE = "b0000001-0000-4000-8000-000000000001";
export const V_HU = "c0000001-0000-4000-8000-000000000002";
export const V_MU3 = "c0000001-0000-4000-8000-000000000003";
export const V_MU4 = "c0000001-0000-4000-8000-000000000004";

type OpcionesProyeccion = { id: string; nombre: string; estado: "en_trabajo" | "cerrada" | "archivada"; hasta?: string; ajuste?: (f: FilaBaseCaso) => FilaBaseCaso; sinTiendas?: boolean; creada?: string; resumen?: Fila | null; parametros?: Fila };

/**
 * Siembra una proyección con las filas del caso (HOMBRE · URBANO y MUJER · URBANO, sus filas de tienda, sus crecimientos y sus tiendas). `ajuste`
 * cambia una fila base (para armar una proyección distinta); dos proyecciones sembradas sin ajuste tienen las mismas cifras (misma huella).
 */
export function sembrarProyeccion(o: OpcionesProyeccion): void {
  const hasta = o.hasta ?? "2026-09-01";
  const k = Number(hasta.slice(5, 7));
  sembrar("proyecciones", [
    {
      id: o.id,
      anio_en_curso: Y,
      nombre: o.nombre,
      estado: o.estado,
      hasta_periodo: hasta,
      parametros: { crecimiento_pct_defecto: 20, umbral_cola_larga: 100, bloques: bloquesCaso(), crecimiento_objetivo_pct: 6, crecimiento_resto_usado: { pct: 4, sobre_base: "corregida", crecimiento_id: null, version: null, por_nombre: null, at: null }, ...(o.parametros ?? {}) },
      resumen: o.resumen === undefined ? { version_metodo: 5, desvio_prueba_anterior_pct: -3.2, gm_con_nino: [`${G_HOMBRE}|${M_URBANO}`], temporadas_filas: ["invierno"] } : o.resumen,
      calculado_at: "2026-11-04T15:00:00.000Z",
      cerrada_at: o.estado === "en_trabajo" ? null : EL_07_NOV,
      cerrada_por_nombre: o.estado === "en_trabajo" ? null : PLANNER,
      usuario_nombre: PLANNER,
      created_at: o.creada ?? "2026-11-01T15:00:00.000Z",
    },
  ]);
  const filaBase = (f0: FilaBaseCaso) => {
    const f = o.ajuste ? o.ajuste(f0) : f0;
    const [fila] = sembrar("proyeccion_filas", [
      {
        proyeccion_id: o.id,
        tienda_id: null,
        gml_id: f.gml,
        equivalencia_id: null,
        agrupacion_marca_id: f.am,
        clave: `|${f.gml}||${f.am}`,
        nivel_proyectado: "GML",
        temporada: f.temporada,
        factores_mes: f.factor ? { [Y]: FACTOR_INVIERNO } : {},
        participaciones: { periodo_referencia: null, por_clave_flujo: [], por_marca: f.porMarca, por_talla: [] },
      },
    ]);
    const total2026 = suma(f.meses2026);
    sembrar("proyeccion_fila_anios", [
      { fila_id: fila.id, anio: Y, bloque: "mismas", vendido: suma(f.meses2026.slice(0, k)), propuesto: total2026, decidido: total2026, origen: "propuesta", propuesta_al_decidir: total2026, decidido_por_nombre: PLANNER, decidido_at: EL_07_NOV, meses: f.meses2026 },
      {
        fila_id: fila.id,
        anio: Y + 1,
        bloque: "mismas",
        vendido: 0,
        propuesto: f.propuesto,
        decidido: f.vigente,
        origen: f.origen,
        propuesta_al_decidir: f.propuesto,
        decidido_por_nombre: f.por,
        decidido_at: f.at,
        decision_lote_id: f.lote ? LOTE : null,
        base_siguiente: f.B,
        base_normalizada: f.Bc,
        // La curva no cambia con la decisión: si `ajuste` cambió el vigente, los meses se escalan.
        meses: f.vigente === f0.vigente ? MESES_2027[`${f.gml}|${f.am}`] : repartir(f.vigente, MESES_2027[`${f.gml}|${f.am}`]),
      },
    ]);
  };
  for (const f of [...FILAS_HU, ...FILAS_MU]) filaBase(f);

  if (!o.sinTiendas) {
    const filaTienda = (tienda: string, gml: string, am: string, anio: number, bloque: string, subbloque: string | null, meses: number[], origen: "propuesta" | "manual", por: string, at: string) => {
      const [fila] = sembrar("proyeccion_filas", [{ proyeccion_id: o.id, tienda_id: tienda, gml_id: gml, equivalencia_id: null, agrupacion_marca_id: am, clave: `${tienda}|${gml}||${am}`, nivel_proyectado: "GML", temporada: "todo_el_ano", factores_mes: {} }]);
      const total = suma(meses);
      sembrar("proyeccion_fila_anios", [{ fila_id: fila.id, anio, bloque, subbloque, vendido: anio === Y ? suma(meses.slice(0, k)) : 0, propuesto: total, decidido: total, origen, propuesta_al_decidir: total, decidido_por_nombre: por, decidido_at: at, meses }]);
    };
    // T10: nueva del año anterior en 2026 (su fila base, L1 · AM-A, tiene `B`): entra a la base de 2027.
    filaTienda(T10, L1_HU, AM_A, Y, "nuevas", "nuevas_anterior", HU_T10_2026_MESES, "propuesta", PLANNER, EL_07_NOV);
    // T04: cierra el 2027-06-30 (aceptada tal cual).
    filaTienda(T04, L1_HU, AM_B, Y + 1, "cierres", null, HU_T04_2027_MESES, "propuesta", PLANNER, EL_07_NOV);
    // T12: apertura de abril de 2027 (a mano por el admin el 06 nov).
    filaTienda(T12, L1_HU, AM_A, Y + 1, "nuevas", "aperturas", HU_T12_2027_MESES, "manual", ADMIN, EL_06_NOV);
    sembrar("proyeccion_tiendas", [
      { proyeccion_id: o.id, tienda_id: T10, anio: Y, bloque: "nuevas", subbloque: "nuevas_anterior", propuesto: HU_T10_2026, decidido: HU_T10_2026, origen: "propuesta", venta_esperada_usada: null },
      { proyeccion_id: o.id, tienda_id: T04, anio: Y + 1, bloque: "cierres", subbloque: null, propuesto: 1000, decidido: 1000, origen: "propuesta", venta_esperada_usada: null },
      { proyeccion_id: o.id, tienda_id: T12, anio: Y + 1, bloque: "nuevas", subbloque: "aperturas", propuesto: 1408, decidido: 1408, origen: "manual", venta_esperada_usada: 60000, fecha_usada: "2027-04-01" },
    ]);
  }
  sembrar("proyeccion_crecimientos", [
    { proyeccion_id: o.id, genero_id: G_HOMBRE, mundo_id: M_URBANO, pct: 5, sobre_base: "corregida", crecimiento_id: V_HU, version: 2 },
    { proyeccion_id: o.id, genero_id: G_MUJER, mundo_id: M_URBANO, pct: 8, sobre_base: "corregida", crecimiento_id: V_MU4, version: 4 },
  ]);
}

/** Maestros del caso (lo que `leerMaestros` devolvería): se inyectan en las pruebas en lugar de leer M2, M3 y M4. */
export function maestrosCaso(): MaestrosDireccion {
  const generos = [
    { id: G_HOMBRE, nombre: "HOMBRE", es_resto: false },
    { id: G_MUJER, nombre: "MUJER", es_resto: false },
    { id: G_NINO, nombre: "NIÑO", es_resto: true },
  ];
  const mundos = [
    { id: M_URBANO, nombre: "URBANO" },
    { id: M_FORMAL, nombre: "FORMAL" },
  ];
  const nodos = [
    { id: L1_HU, genero_id: G_HOMBRE, mundo_id: M_URBANO, nombre: "DENIM", activo: true },
    { id: L2_HU, genero_id: G_HOMBRE, mundo_id: M_URBANO, nombre: "ABRIGO", activo: true },
    { id: L1_MU, genero_id: G_MUJER, mundo_id: M_URBANO, nombre: "DENIM", activo: true },
    { id: L2_MU, genero_id: G_MUJER, mundo_id: M_URBANO, nombre: "POLO", activo: true },
  ];
  const agrupacionesMarca = [
    { id: AM_A, nombre: "AM-A" },
    { id: AM_B, nombre: "AM-B" },
  ];
  const unidadesMarca = [
    { id: MARCA_X, nombre: "Marca X", agrupacion_marca_id: AM_A, activa: true },
    { id: MARCA_W, nombre: "Marca W", agrupacion_marca_id: AM_A, activa: true },
    { id: MARCA_Z, nombre: "Marca Z", agrupacion_marca_id: AM_B, activa: true },
  ];
  const tiendas = TIENDAS.filter((t) => t.tipo === "Tienda").map((t) => ({ id: t.id, codigo: t.codigo, nombre: t.nombre, fecha_apertura: t.fecha_apertura, fecha_cierre: t.fecha_cierre, activa: true }));
  const nombreGenero = new Map(generos.map((g) => [g.id, g.nombre]));
  const nombreMundo = new Map(mundos.map((m) => [m.id, m.nombre]));
  return {
    generos,
    mundos,
    nodos,
    agrupacionesMarca,
    unidadesMarca,
    tiendas,
    huella: "maestros-de-prueba",
    tablero: {
      tiendas: new Map(tiendas.map((t) => [t.id, t])),
      generosMatriz: new Set([G_HOMBRE, G_MUJER]),
      nombres: {
        genero: nombreGenero,
        mundo: nombreMundo,
        linea: new Map(nodos.map((n) => [n.id, `${nombreGenero.get(n.genero_id)} · ${nombreMundo.get(n.mundo_id)} · ${n.nombre}`])),
        agrupacionMarca: new Map(agrupacionesMarca.map((a) => [a.id, a.nombre])),
        marca: new Map(unidadesMarca.map((u) => [u.id, u.nombre])),
      },
    },
  };
}

/** Lo que `leerNinoDeHoy` devolvería: 2023 y 2026 son años del Niño; el factor de invierno de 2026 es provisional (parcial, escrito a mano 0,70). */
export const ninoCaso: { valor: NinoDeHoy } = { valor: { factoresProvisionales: [{ anio: Y, temporada: "invierno", estado: "sin_confirmar", efectivo: 0.7, parcial: true }], aniosNino: [2023, 2026] } };
export const reiniciarNino = (): void => {
  ninoCaso.valor = { factoresProvisionales: [{ anio: Y, temporada: "invierno", estado: "sin_confirmar", efectivo: 0.7, parcial: true }], aniosNino: [2023, 2026] };
};

/**
 * Siembra el caso completo de §6.1: la proyección mostrada (cerrada el 07 nov por Planner P.), la de seguimiento de setiembre (archivada, con la
 * aprobación del 03 nov), las versiones de crecimiento, las cargas publicadas (enero de 2023 a octubre de 2026) y la venta.
 */
export function sembrarCaso(): void {
  estadoDireccion.hechos = hechosCaso();
  estadoDireccion.nodos = new Map([
    [L1_HU, { genero_id: G_HOMBRE, mundo_id: M_URBANO }],
    [L2_HU, { genero_id: G_HOMBRE, mundo_id: M_URBANO }],
    [L1_MU, { genero_id: G_MUJER, mundo_id: M_URBANO }],
    [L2_MU, { genero_id: G_MUJER, mundo_id: M_URBANO }],
  ]);
  estadoDireccion.unidadDe = new Map([
    [MARCA_X, MARCA_X],
    [MARCA_X2, MARCA_X],
    [MARCA_W, MARCA_W],
    [MARCA_Z, MARCA_Z],
  ]);
  estadoDireccion.amDeUnidad = new Map([
    [MARCA_X, AM_A],
    [MARCA_W, AM_A],
    [MARCA_Z, AM_B],
  ]);
  estadoDireccion.tiendas = TIENDAS.map((t) => ({ id: t.id, tipo: t.tipo === "Tienda" ? "Tienda" : "Centro de Distribución" }));

  let n = 1;
  const cargas: Fila[] = [];
  for (let anio = 2023; anio <= 2026; anio++) for (let mes = 1; mes <= 12; mes++) if (publicadoCaso(anio, mes)) cargas.push({ id: `f0000001-0000-4000-8000-${String(n++).padStart(12, "0")}`, periodo: `${anio}-${dos(mes)}-01`, estado: "publicada", publicada_at: "2026-11-02T15:00:00.000Z" });
  sembrar("cargas_venta_stock", cargas);

  sembrar("crecimientos_genero_mundo", [
    { id: V_HU, anio_aplicacion: Y + 1, alcance: "gm", genero_id: G_HOMBRE, mundo_id: M_URBANO, version: 2, estado: "vigente", pct: 5, sobre_base: "corregida", nota: null, base_tipo: "proyeccion", base_valor: 47040, usuario_nombre: PLANNER, aprobada_at: "2026-11-04T15:00:00.000Z" },
    { id: V_MU3, anio_aplicacion: Y + 1, alcance: "gm", genero_id: G_MUJER, mundo_id: M_URBANO, version: 3, estado: "reemplazada", pct: 6, sobre_base: "corregida", nota: "primera versión", base_tipo: "proyeccion", base_valor: 28500, usuario_nombre: PLANNER, aprobada_at: "2026-11-06T14:00:00.000Z" },
    { id: V_MU4, anio_aplicacion: Y + 1, alcance: "gm", genero_id: G_MUJER, mundo_id: M_URBANO, version: 4, estado: "vigente", pct: 8, sobre_base: "corregida", nota: "revisada con comercial", base_tipo: "proyeccion", base_valor: 28500, usuario_nombre: PLANNER, aprobada_at: EL_06_NOV },
  ]);

  // La de seguimiento de setiembre: archivada, con datos hasta agosto y cifras algo menores; es la última aprobada (03 nov, Admin A.).
  sembrarProyeccion({
    id: P_SEGUIMIENTO,
    nombre: "Proyección 2026–2027 seguimiento set",
    estado: "archivada",
    hasta: "2026-08-01",
    creada: "2026-10-01T15:00:00.000Z",
    ajuste: (f) => (f.gml === L1_HU && f.am === AM_A ? { ...f, vigente: 24792, origen: "manual", lote: false } : f.gml === L1_MU ? { ...f, vigente: 19000 } : f),
  });
  sembrarAprobacion({
    id: "ad000000-0000-4000-8000-000000000900",
    proyeccion_id: P_SEGUIMIENTO,
    anio_en_curso: Y,
    estado_proyeccion: "cerrada",
    huella: huellaFalsa(P_SEGUIMIENTO),
    resultado: "aprobada",
    usuario_nombre: ADMIN,
    created_at: EL_03_NOV,
    resumen: {
      huella: huellaFalsa(P_SEGUIMIENTO),
      huella_version: 1,
      hasta_periodo: "2026-08",
      version_metodo: 5,
      totales: [
        { anio: Y, total: 78300, por_bloque: { mismas: 74200, nuevas_anterior: 4100, aperturas: 0, cierres: 0 } },
        { anio: Y + 1, total: 83500, por_bloque: { mismas: 81092, nuevas_anterior: 0, aperturas: 1408, cierres: 1000 } },
      ],
      puente: { lineas: [], pct: { base_sobre_real: null, nino: null, crecimiento: null, manual: null, otras: null, total_vs_cierre: null } },
      por_gm: [
        { gm_clave: `${G_HOMBRE}|${M_URBANO}`, nombre: "HOMBRE · URBANO", en_curso: 49900, siguiente: 52500, declarado_pct: 5, implicito_pct: 5.1 },
        { gm_clave: `${G_MUJER}|${M_URBANO}`, nombre: "MUJER · URBANO", en_curso: 28400, siguiente: 31000, declarado_pct: 8, implicito_pct: 8.8 },
      ],
      alertas: [],
    },
  });

  // La mostrada: cerrada el 07 nov por Planner P.; es la que usa Compras.
  sembrarProyeccion({ id: P_MOSTRADA, nombre: "Proyección 2026–2027", estado: "cerrada", creada: "2026-11-01T15:00:00.000Z" });
}

/** Cambia el vigente de un registro base de una proyección sembrada (como una decisión fila a fila de M7). */
export function decidirFila(proyeccionId: string, gml: string, am: string, anio: number, decidido: number): void {
  const fila = (baseFalsa.tablas.proyeccion_filas ?? []).find((f) => f.proyeccion_id === proyeccionId && f.clave === `|${gml}||${am}`);
  const registro = (baseFalsa.tablas.proyeccion_fila_anios ?? []).find((a) => a.fila_id === fila?.id && a.anio === anio);
  if (!registro) throw new Error("No existe ese registro en el caso.");
  registro.decidido = decidido;
  registro.origen = "manual";
}
