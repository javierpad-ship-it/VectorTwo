import { listarMeses } from "@/lib/ventas/periodo";
import { mesesAtipicos, type PeriodoParaClase } from "@/lib/curvas/atipicos";
import { armarEntradaCorrida, type AgrupacionParaCorrida, type DatosCorrida } from "@/lib/curvas/entrada";
import { calcularCorrida, type EntradaCorrida, type SalidaCorrida } from "@/lib/curvas/modelo";
import { PARAMETROS_POR_DEFECTO, type ParametrosCurvas, type TemporadaAgrupacion } from "@/lib/curvas/tipos-api";
import type { FilaAgregado, TiendaMaestro } from "@/lib/curvas/tipos";

/**
 * Fixtures sintéticos de M6 paso 2 (docs/modulos/06-curvas-estacionalidad.md,
 * "Casos de prueba sintéticos"). Nada real de Lukers: agrupaciones y tiendas
 * inventadas. Los ids son cadenas legibles (la lógica pura no exige UUID).
 */

export const ABRIGO_ID = "abrigo";
export const VERANO_ID = "verano";
export const PEQUENA_ID = "pequena";
export const CONSTANTE_ID = "constante";

/** 2024 de cada agrupación (la ficha). */
export const ABRIGO_2024 = [20, 20, 60, 120, 200, 240, 160, 80, 40, 20, 20, 20];
export const VERANO_2024 = [180, 140, 80, 40, 20, 20, 20, 40, 60, 100, 140, 160];

const por = (v: number[], k: number) => v.map((x) => x * k);

export const ABRIGO_2025 = por(ABRIGO_2024, 1.2).map((x, m) => (m === 11 ? 60 : Math.round(x * 100) / 100));
export const VERANO_2025 = por(VERANO_2024, 1.2);

export type VarianteFixture =
  | "base"
  | "forma_corrida"
  | "huecos"
  | "ruido"
  | "escasa"
  | "siete_huecos"
  | "apertura_dudosa"
  | "t4_desactivada";

export const T1 = "t1";
export const T2 = "t2";
export const T3 = "t3";
export const T4 = "t4";
export const CD = "cd";

export const PUBLICADOS = listarMeses("2023-01", "2026-09");

export function periodoFx(id: string, desde: string, hasta: string, temporadas: TemporadaAgrupacion[]): PeriodoParaClase {
  return { id, desde, hasta, motivo: `Periodo ${id}`, alcance: "invierno", temporadas, activo: true };
}

/** Los cuatro periodos confirmados por Javier. */
export const PERIODOS_NINO: PeriodoParaClase[] = [
  periodoFx("nino-2023-inv", "2023-01", "2023-12", ["invierno"]),
  periodoFx("nino-2023-ver", "2023-09", "2023-12", ["verano"]),
  periodoFx("nino-2026-inv", "2026-01", "2026-12", ["invierno"]),
  periodoFx("nino-2026-ver", "2026-09", "2026-12", ["verano"]),
];

export function tiendasFixture(variante: VarianteFixture = "base"): TiendaMaestro[] {
  const t = (id: string, tipo: string, apertura: string | null, extra: Partial<TiendaMaestro> = {}): TiendaMaestro => ({
    id,
    codigo: id.toUpperCase(),
    nombre: `Tienda ${id.toUpperCase()}`,
    tipo,
    activo: true,
    fecha_apertura: apertura,
    fecha_cierre: null,
    ...extra,
  });
  return [
    t(T1, "Tienda", "2020-03-01"),
    t(T2, "Tienda", "2024-07-01"),
    t(T3, "Tienda", "2025-11-20"),
    t(T4, "Tienda", variante === "apertura_dudosa" ? "2021-01-01" : "2023-06-01", variante === "t4_desactivada" ? { activo: false } : {}),
    t(CD, "Centro de Distribución", "2020-01-01"),
  ];
}

export type Anuales = Partial<Record<number, number[]>>;

function abrigo(variante: VarianteFixture): Anuales {
  const a2023 =
    variante === "forma_corrida"
      ? por(ABRIGO_2024.map((_, m) => ABRIGO_2024[(m + 1) % 12]), 0.65)
      : variante === "ruido"
        ? ABRIGO_2024.map((_, m) => ABRIGO_2024[m === 3 ? 5 : m === 5 ? 3 : m])
        : variante === "huecos"
          ? ABRIGO_2024.map((u, m) => (m >= 2 && m <= 4 ? u * 0.4 : u))
          : por(ABRIGO_2024, 0.65);
  return {
    2023: a2023,
    2024: ABRIGO_2024,
    2025: ABRIGO_2025,
    2026: por(ABRIGO_2025, 0.65).map((x, m) => (m <= 8 ? x : 0)),
  };
}

function verano(): Anuales {
  return {
    2023: VERANO_2024.map((u, m) => (m >= 8 ? u * 2 : u)),
    2024: VERANO_2024,
    2025: VERANO_2025,
    2026: VERANO_2025.map((x, m) => (m <= 8 ? x : 0)),
  };
}

const PEQUENA: Anuales = {
  2023: [8, 8, 8, 8, 8, 8, 8, 8, 8, 6, 6, 6],
  2024: [34, 34, 34, 34, 34, 34, 34, 34, 34, 20, 20, 20],
  2025: [10, 10, 10, 10, 10, 10, 10, 10, 10, 5, 5, 5],
  2026: [10, 10, 10, 10, 10, 10, 10, 10, 10, 0, 0, 0],
};

const CONSTANTE: Anuales = {
  2023: Array(12).fill(100),
  2024: Array(12).fill(100),
  2025: Array(12).fill(100),
  2026: Array(12).fill(100).map((x, m) => (m <= 8 ? x : 0)),
};

const mesDeIndice = (anio: number, m: number) => `${anio}-${String(m + 1).padStart(2, "0")}`;
const PRECIO = 100;

export function filasDe(
  agrupacion: string | null,
  tienda: string,
  anuales: Anuales,
  opciones: { desde?: string; costoDiciembre2025?: boolean } = {}
): FilaAgregado[] {
  const filas: FilaAgregado[] = [];
  for (const [anioTexto, meses] of Object.entries(anuales)) {
    const anio = Number(anioTexto);
    (meses ?? []).forEach((unidades, m) => {
      const periodo = mesDeIndice(anio, m);
      if (!PUBLICADOS.includes(periodo)) return;
      if (opciones.desde && periodo < opciones.desde) return;
      if (unidades === 0 && anio === 2026) return;
      const cv = opciones.costoDiciembre2025 && periodo === "2025-12" ? 0.7 : 0.5;
      filas.push({
        agrupacion_id: agrupacion,
        tienda_id: tienda,
        periodo,
        unidades,
        venta_soles: unidades * PRECIO,
        costo_vendido: unidades * PRECIO * cv,
      });
    });
  }
  return filas;
}

/** Venta constante de `unidades` al mes entre dos meses (incluidos), para T2, T3 y T4. */
function plana(agrupacion: string | null, tienda: string, desde: string, hasta: string, unidades: number | ((mes: number) => number)): FilaAgregado[] {
  return listarMeses(desde, hasta)
    .filter((p) => PUBLICADOS.includes(p))
    .map((periodo) => {
      const u = typeof unidades === "number" ? unidades : unidades(Number(periodo.slice(5, 7)) - 1);
      return { agrupacion_id: agrupacion, tienda_id: tienda, periodo, unidades: u, venta_soles: u * PRECIO, costo_vendido: u * PRECIO * 0.5 };
    });
}

export type SobrescribirFixture = {
  /** Reemplaza la venta de T1 en ABRIGO (por año). */
  abrigo?: Anuales;
  /** Reemplaza la venta de T1 en VERANO (por año). */
  verano?: Anuales;
  /** Quita todas las filas de esos meses (`aaaa-mm`). */
  sinFilasEn?: string[];
  /** Filas que se añaden tal cual. */
  extra?: FilaAgregado[];
  /** Quita las filas de esa agrupación. */
  sinAgrupacion?: string[];
};

export function filasFixture(variante: VarianteFixture = "base", sobrescribir: SobrescribirFixture = {}): FilaAgregado[] {
  const filas: FilaAgregado[] = [
    ...filasDe(ABRIGO_ID, T1, sobrescribir.abrigo ?? abrigo(variante), { costoDiciembre2025: true }),
    ...filasDe(VERANO_ID, T1, sobrescribir.verano ?? verano()),
    // T4 y T2 venden en unidades sin agrupación; T3 vende solo en ABRIGO, con un perfil muy distinto (enero concentra la venta).
    ...plana(null, T4, variante === "apertura_dudosa" ? "2023-07" : "2023-07", "2026-09", 5),
    ...plana(null, T2, "2024-07", "2026-09", 10),
    ...plana(ABRIGO_ID, T3, "2025-11", "2026-09", (m) => (m === 0 ? 270 : 30)),
  ];
  if (variante === "escasa") filas.push(...filasDe(PEQUENA_ID, T1, PEQUENA));
  filas.push(...filasDe(CONSTANTE_ID, T1, CONSTANTE));
  // T1 también vende algo sin agrupación (para unidades_sin_agrupacion).
  filas.push({ agrupacion_id: null, tienda_id: T1, periodo: "2024-03", unidades: 7, venta_soles: 700, costo_vendido: 350 });
  filas.push(...(sobrescribir.extra ?? []));
  return filas.filter(
    (f) =>
      !(sobrescribir.sinFilasEn ?? []).includes(f.periodo) && !(f.agrupacion_id !== null && (sobrescribir.sinAgrupacion ?? []).includes(f.agrupacion_id))
  );
}

export function periodosFixture(variante: VarianteFixture = "base"): PeriodoParaClase[] {
  if (variante === "huecos") {
    return [periodoFx("nino-2023-huecos", "2023-03", "2023-05", ["invierno"]), PERIODOS_NINO[1], PERIODOS_NINO[2], PERIODOS_NINO[3]];
  }
  if (variante === "siete_huecos") {
    return [periodoFx("nino-2023-siete", "2023-03", "2023-09", ["invierno"]), PERIODOS_NINO[1], PERIODOS_NINO[2], PERIODOS_NINO[3]];
  }
  return PERIODOS_NINO;
}

export function agrupacionesFixture(variante: VarianteFixture = "base"): AgrupacionParaCorrida[] {
  const a = (id: string, temporada: TemporadaAgrupacion): AgrupacionParaCorrida => ({
    id,
    temporada,
    composicion: { equivalencias: 10, huella: `huella-${id}` },
    temporada_sugerida: null,
    temporadas_mezcladas: false,
  });
  const lista = [a(ABRIGO_ID, "invierno"), a(VERANO_ID, "verano"), a(CONSTANTE_ID, "todo_el_ano")];
  if (variante === "escasa") lista.push(a(PEQUENA_ID, "todo_el_ano"));
  return lista;
}

export function datosFixture(
  variante: VarianteFixture = "base",
  hasta = "2026-09",
  sobrescribir: SobrescribirFixture & { periodos?: PeriodoParaClase[]; publicados?: string[]; agrupaciones?: AgrupacionParaCorrida[] } = {}
): DatosCorrida {
  return {
    hasta_periodo: hasta,
    meses_publicados: sobrescribir.publicados ?? PUBLICADOS,
    filas: filasFixture(variante, sobrescribir),
    tiendas: tiendasFixture(variante),
    periodos: sobrescribir.periodos ?? periodosFixture(variante),
    agrupaciones: sobrescribir.agrupaciones ?? agrupacionesFixture(variante),
  };
}

export function parametros(extra: Partial<ParametrosCurvas> = {}): ParametrosCurvas {
  return { ...PARAMETROS_POR_DEFECTO, ...extra };
}

export type OpcionesCorrida = Parameters<typeof datosFixture>[2] & { hasta?: string };

export function entradaFixture(variante: VarianteFixture = "base", extra: Partial<ParametrosCurvas> = {}, opciones: OpcionesCorrida = {}): EntradaCorrida {
  return armarEntradaCorrida(datosFixture(variante, opciones.hasta ?? "2026-09", opciones), parametros(extra));
}

export function corridaFixture(variante: VarianteFixture = "base", extra: Partial<ParametrosCurvas> = {}, opciones: OpcionesCorrida = {}): SalidaCorrida {
  return calcularCorrida(entradaFixture(variante, extra, opciones), parametros(extra));
}

export function agrupacionDe(salida: SalidaCorrida, id: string) {
  const a = salida.resultado.agrupaciones.find((x) => x.agrupacion_id === id);
  if (!a) throw new Error(`Sin agrupación ${id} en la corrida`);
  return a;
}

/** Unidades de un conjunto de meses publicados (para pruebas sobre series). */
export const suma = (v: readonly number[]) => v.reduce((s, x) => s + x, 0);
export { mesesAtipicos };
