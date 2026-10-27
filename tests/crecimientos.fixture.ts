import { estadoFalso, type Fila } from "./crecimientos.fake-db";

/**
 * Mundo sintético de 06d: hoy es 2026-10-27 (último mes cerrado: setiembre de 2026), venta publicada de 2023-01 a 2026-09, tiendas
 * `T01…`, géneros HOMBRE, MUJER y NIÑO, mundos URBANO, RI y DEPORTIVO (este último desactivado). Las cifras de HOMBRE · URBANO
 * reproducen el ejemplo de la ficha 06d §5.1 (acumulado 40 000 → 41 200; ρ = 63 100 ÷ 58 900 − 1; cierre proyectado 55 620).
 */

export const G_H = "11111111-1111-4111-8111-111111111111";
export const G_M = "22222222-2222-4222-8222-222222222222";
export const G_N = "33333333-3333-4333-8333-333333333333";
export const M_U = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const M_R = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const M_D = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
export const P1 = "d1111111-1111-4111-8111-111111111111";
export const P2 = "d2222222-2222-4222-8222-222222222222";
export const P3 = "d3333333-3333-4333-8333-333333333333";

export const HU = `${G_H}.${M_U}`;
export const HR = `${G_H}.${M_R}`;
export const MU = `${G_M}.${M_U}`;
export const NU = `${G_N}.${M_U}`;
export const HD = `${G_H}.${M_D}`;

/** Hoy en Lima (mediodía): fija el último mes cerrado en setiembre de 2026. */
export const HOY_ISO = "2026-10-27T17:00:00Z";

export const PUBLICADOS: string[] = [];
for (let a = 2023; a <= 2026; a++) for (let m = 1; m <= 12; m++) if (a < 2026 || m <= 9) PUBLICADOS.push(`${a}-${String(m).padStart(2, "0")}`);

const mes = (a: number, m: number) => `${a}-${String(m).padStart(2, "0")}`;

/** Unidades mensuales de HOMBRE · URBANO (invierno) de las tiendas T01, T02 y T03 juntas, por año (los doce o los nueve meses). */
export const TOTAL_HU: Record<number, number[]> = {
  2023: Array.from({ length: 12 }, () => 4000),
  2024: [...Array.from({ length: 11 }, () => 4286), 4283],
  2025: [5000, 5000, 5000, 5000, 5000, 4000, 4000, 4000, 3000, 4500, 4500, 5000],
  2026: [5000, 5000, 5000, 5000, 5000, 4000, 4000, 4000, 4200],
};
const PESOS_123 = [0.5, 0.3, 0.2];

/** Reparte un total entre tiendas por pesos, en enteros; el resto va a la primera. */
export function repartir(total: number, pesos: readonly number[]): number[] {
  const partes = pesos.map((p, i) => (i === 0 ? 0 : Math.floor(total * p)));
  partes[0] = total - partes.reduce((a, b) => a + b, 0);
  return partes;
}

type Serie = { g: string; m: string; temp: string; t: string; u: Record<string, number> };

function serieDe(g: string, m: string, temp: string, tiendas: string[], porAnio: Record<number, number[]>, pesos: readonly number[] = PESOS_123): Serie[] {
  return tiendas.map((t, i) => {
    const u: Record<string, number> = {};
    for (const [anio, totales] of Object.entries(porAnio)) {
      totales.forEach((total, idx) => {
        u[mes(Number(anio), idx + 1)] = repartir(total, pesos.slice(0, tiendas.length))[i] as number;
      });
    }
    return { g, m, temp, t, u };
  });
}

const plano = (v: number, meses = 12) => Array.from({ length: meses }, () => v);
const planoPorAnio = (v2023: number, v2024: number, v2025: number, v2026: number): Record<number, number[]> => ({
  2023: plano(v2023),
  2024: plano(v2024),
  2025: plano(v2025),
  2026: plano(v2026, 9),
});

/** Una tienda con venta desde `desde` hasta `hasta` (ambos `aaaa-mm`) de `unidades` por mes: el ruido que sale de las mismas tiendas. */
function ruido(g: string, m: string, temp: string, t: string, desde: string, hasta: string, unidades: number): Serie {
  const u: Record<string, number> = {};
  for (const p of PUBLICADOS) if (p >= desde && p <= hasta) u[p] = unidades;
  return { g, m, temp, t, u };
}

export function seriesFixture(): Serie[] {
  return [
    ...serieDe(G_H, M_U, "invierno", ["t1", "t2", "t3"], TOTAL_HU),
    ruido(G_H, M_U, "invierno", "t5", "2025-06", "2026-09", 300),
    ruido(G_H, M_U, "invierno", "t6", "2023-01", "2026-06", 200),
    ...serieDe(G_H, M_R, "todo_el_ano", ["t1", "t2", "t3"], planoPorAnio(900, 950, 1000, 2200)),
    ...serieDe(G_M, M_U, "verano", ["t1", "t2", "t3", "t7"], planoPorAnio(2000, 2100, 2200, 2300), [0.4, 0.3, 0.2, 0.1]),
    ...serieDe(G_N, M_U, "todo_el_ano", ["t1", "t2", "t3"], planoPorAnio(500, 500, 500, 520)),
    ...serieDe(G_N, M_R, "todo_el_ano", ["t1", "t2", "t3"], planoPorAnio(300, 300, 300, 310)),
    ...serieDe(G_H, M_D, "todo_el_ano", ["t1", "t2", "t3"], planoPorAnio(100, 100, 100, 100)),
  ];
}

/** `venta_genero_mundo` como la devuelve la base. */
export function ventaGMJson(series: Serie[] = seriesFixture()) {
  return { series, cargas: Object.fromEntries(PUBLICADOS.map((p) => [p, `carga-${p}`])) };
}

const dia1 = (m: string) => `${m}-01`;
const T0 = "2026-10-01T10:00:00Z";

const tienda = (id: string, codigo: string, extra: Fila = {}): Fila => ({
  id,
  codigo,
  nombre: `Tienda ${codigo}`,
  tipo: "Tienda",
  activo: true,
  fecha_apertura: "2020-01-01",
  fecha_cierre: null,
  razon_social: null,
  zona: null,
  venta_esperada_promedio: null,
  ...extra,
});

/** Meses de `Y` de la fila base de HOMBRE · URBANO en la proyección: `Σ = 55 620`, con 16 000 en los meses del Niño (junio a agosto). */
export const MESES_Y_HU = [4400, 4400, 4400, 4400, 4400, 5333, 5333, 5334, 4000, 4500, 4500, 4620];

function filaBase(id: string, proyeccionId: string, gml: string, temporada: string, y: { vigente: number; meses: number[] }, s: { b: number; bn: number }): { fila: Fila; anios: Fila[] } {
  const fila: Fila = {
    id,
    proyeccion_id: proyeccionId,
    clave: `|${gml}|e|m`,
    tienda_id: null,
    gml_id: gml,
    equivalencia_id: null,
    agrupacion_marca_id: "am",
    nivel_proyectado: "GML",
    agrupacion_estacionalidad_id: null,
    temporada,
    avisos: [],
    activo: true,
  };
  const base = { fila_id: id, bloque: "mismas", subbloque: null, decidido: null, activo: true, vendido: 0, metodo: "curva", origen: null, propuesta_al_decidir: null, avisos: [], origen_meses: null };
  const anios: Fila[] = [
    { ...base, id: `${id}-y`, anio: 2026, propuesto: y.vigente, meses: y.meses, base_siguiente: null, base_normalizada: null, crecimiento_pct: null },
    { ...base, id: `${id}-s`, anio: 2027, propuesto: Math.round(s.b * 1.05), meses: null, base_siguiente: s.b, base_normalizada: s.bn, crecimiento_pct: null },
  ];
  return { fila, anios };
}

const proyeccion = (id: string, anio: number, estado: string, extra: Fila = {}): Fila => ({
  id,
  anio_en_curso: anio,
  estado,
  nombre: `Proyección ${anio} ${id.slice(0, 2)}`,
  hasta_periodo: `${anio}-09-01`,
  calculado_at: "2026-10-20T10:00:00Z",
  calculando_desde: null,
  cerrada_at: null,
  created_at: T0,
  updated_at: T0,
  activo: true,
  parametros: {
    crecimiento_pct_defecto: 5,
    bloques: { [String(anio)]: { mismas: ["t1", "t2", "t3"].map((t) => ({ tienda_id: t })), nuevas: [], cierres: [], fuera: [] } },
  },
  resumen: {
    version_metodo: 4,
    gm_gml: { n1: `${G_H}|${M_U}`, n3: `${G_H}|${M_R}`, n4: `${G_M}|${M_U}`, n5: `${G_N}|${M_U}` },
  },
  ...extra,
});

/** Siembra la base falsa y el reloj; los `vi.mock` van en cada archivo de prueba. */
export function sembrar() {
  estadoFalso.rol = "planner";
  estadoFalso.siguienteId = 100;
  estadoFalso.llamadasVentaGM = [];
  estadoFalso.escrituras = [];
  estadoFalso.fallarInsert = {};
  estadoFalso.alEscribir = null;
  estadoFalso.ventaGM = { respuesta: ventaGMJson(), error: null };

  const filas = [
    filaBase("f1", P1, "n1", "invierno", { vigente: 55620, meses: MESES_Y_HU }, { b: 58900, bn: 63100 }),
    filaBase("f3", P1, "n3", "todo_el_ano", { vigente: 20000, meses: plano(20000 / 12) }, { b: 20000, bn: 20000 }),
    filaBase("f4", P1, "n4", "verano", { vigente: 30000, meses: plano(2500) }, { b: 30000, bn: 30000 }),
    filaBase("f5", P1, "n5", "todo_el_ano", { vigente: 6000, meses: plano(500) }, { b: 6000, bn: 6000 }),
  ];

  estadoFalso.tablas = {
    generos: [
      { id: G_H, nombre: "HOMBRE", orden: 1, activo: true },
      { id: G_M, nombre: "MUJER", orden: 2, activo: true },
      { id: G_N, nombre: "NIÑO", orden: 3, activo: true },
    ],
    mundos: [
      { id: M_U, nombre: "URBANO", orden: 1, activo: true },
      { id: M_R, nombre: "RI", orden: 2, activo: true },
      { id: M_D, nombre: "DEPORTIVO", orden: 3, activo: false },
    ],
    genero_mundo_linea: [
      { id: "n1", genero_id: G_H, mundo_id: M_U, linea_id: "l1", nivel_planificacion: "GML", activo: true, updated_at: T0 },
      { id: "n2", genero_id: G_H, mundo_id: M_U, linea_id: "l2", nivel_planificacion: "GML", activo: true, updated_at: T0 },
      { id: "n3", genero_id: G_H, mundo_id: M_R, linea_id: "l1", nivel_planificacion: "GML", activo: true, updated_at: T0 },
      { id: "n4", genero_id: G_M, mundo_id: M_U, linea_id: "l1", nivel_planificacion: "GML", activo: true, updated_at: T0 },
      { id: "n5", genero_id: G_N, mundo_id: M_U, linea_id: "l1", nivel_planificacion: "GML", activo: true, updated_at: T0 },
      { id: "n6", genero_id: G_N, mundo_id: M_R, linea_id: "l1", nivel_planificacion: "GML", activo: true, updated_at: T0 },
      { id: "n7", genero_id: G_H, mundo_id: M_D, linea_id: "l1", nivel_planificacion: "GML", activo: true, updated_at: T0 },
    ],
    equivalencias: [{ id: "e1", updated_at: T0 }],
    agrupaciones_estacionalidad: [{ id: "a1", updated_at: T0 }],
    tiendas: [
      tienda("t1", "T01"),
      tienda("t2", "T02"),
      tienda("t3", "T03"),
      tienda("t5", "T05", { fecha_apertura: "2025-06-01" }),
      tienda("t6", "T06", { fecha_cierre: "2026-06-30" }),
      tienda("t7", "T07", { fecha_cierre: "2026-12-31" }),
      tienda("cd", "CD1", { tipo: "Centro de Distribución" }),
    ],
    cargas_venta_stock: PUBLICADOS.map((m) => ({ id: `carga-${m}`, periodo: dia1(m), estado: "publicada" })),
    periodos_atipicos: [
      { id: "00000000-0000-4000-8000-0000000000a1", desde: "2026-06-01", hasta: "2026-08-01", motivo: "Niño costero", descripcion: null, alcance: "invierno", temporadas: ["invierno"], activo: true, created_at: T0, updated_at: T0 },
      { id: "00000000-0000-4000-8000-0000000000a2", desde: "2023-06-01", hasta: "2023-08-01", motivo: "Niño 2023", descripcion: null, alcance: "invierno", temporadas: ["invierno"], activo: true, created_at: T0, updated_at: T0 },
    ],
    factores_volumen_atipico: [
      { id: "fa1", anio: 2026, temporada: "invierno", ratio_calculado: 0.8, ratio_aplicado: null, parcial: true, activo: true },
      { id: "fa2", anio: 2023, temporada: "invierno", ratio_calculado: 0.9, ratio_aplicado: null, parcial: false, activo: true },
    ],
    proyecciones: [
      proyeccion(P1, 2026, "en_trabajo"),
      proyeccion(P2, 2025, "cerrada"),
      proyeccion(P3, 2026, "en_trabajo", { calculado_at: "2026-09-01T10:00:00Z", resumen: { version_metodo: 3 } }),
    ],
    proyeccion_filas: filas.map((f) => f.fila),
    proyeccion_fila_anios: filas.flatMap((f) => f.anios),
    proyeccion_crecimientos: [{ id: "c1", proyeccion_id: P1, genero_id: G_H, mundo_id: M_U, pct: 12, crecimiento_id: null, version: null }],
    crecimientos_genero_mundo: [],
  };
}

/** Fecha del sistema falsa del mediodía de Lima del 27 de octubre de 2026. */
export const AHORA = new Date(HOY_ISO);

/** Un cuerpo de `POST` válido para el GM; `huella_datos` sale del `GET` previo. */
export function cuerpoAprobar(huella: string, extra: Record<string, unknown> = {}) {
  return {
    anio: 2027,
    pct: 18.4,
    nota: null,
    base: { tipo: "acumulado", anio: null, variante: "sin_nino_mas_rebote" },
    proyeccion_referencia_id: P1,
    huella_datos: huella,
    version_vigente: null,
    ...extra,
  };
}
