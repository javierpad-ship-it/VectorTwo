import { listarMeses } from "@/lib/ventas/periodo";
import type { FilaVentaAgrupacion, FilaVentaTemporada, VentaEstacionalidad } from "@/lib/curvas/agregado";
import { armarRedPorAnio, contextoComposicion, type ContextoComposicion, type FilaEquivalenciaAnio, type FilaNodo, type FilaOtras, type LecturaComposicion, type MaestroComposicion } from "@/lib/curvas/composicion";
import { armarEntradaAgrupacion } from "@/lib/curvas/entrada";
import { calcularCorrida, type EntradaCorrida, type SalidaCorrida } from "@/lib/curvas/modelo";
import { PARAMETROS_POR_DEFECTO, type AgrupacionResultado, type ParametrosCurvas, type TemporadaResultado } from "@/lib/curvas/tipos-api";
import type { TiendaMaestro } from "@/lib/curvas/tipos";

/**
 * `SINT_INV` y `SINT_INV_G3` (docs/modulos/06c…, casos 32 a 35 y 41): tres GML y cuatro equivalencias activas
 * de una agrupación de invierno, dos tiendas en la red todos los años, 2024 y 2025 normales y completos
 * (sin periodos) y 2026 en curso. Nada real de Lukers: los nombres y las cifras son inventados.
 *
 * Formas en % (ene…dic): `S` (G1 y G2 en 2024), `S1` = S′ (G1 y G2 en 2025) y `D` (G3 los dos años).
 */

export const S = [4, 4, 6, 8, 12, 14, 14, 12, 10, 7, 5, 4];
export const S1 = [4, 4, 6, 8, 10, 16, 14, 12, 10, 7, 5, 4];
export const D = [10, 12, 14, 14, 12, 8, 6, 5, 5, 5, 5, 4];

export const GML = { G1: "gml-1", G2: "gml-2", G3: "gml-3" } as const;
export const EQ = { E1: "eq-1", E2: "eq-2", E3: "eq-3", E4: "eq-4" } as const;
export const T1 = "t1";
export const T2 = "t2";
export const OTRA_AGRUPACION = "otra-agrupacion";
export const PUBLICADOS = listarMeses("2024-01", "2026-09");

export type OpcionesSintInv = {
  /** Unidades de G3 en 2024 y 2025 (por defecto 100 y 110; `SINT_INV_G3` usa 300 y 330). */
  g3?: [number, number];
  /** Venta de G1 en OTRA agrupación (equivalencia `E5`) en 2025. */
  otras2025?: number;
  parametros?: Partial<ParametrosCurvas>;
  /** Id de la agrupación (por defecto uno legible). */
  agrupacionId?: string;
  /** Tiendas de la agrupación excluidas de la red (el cálculo las saca; `p_red` cambia). */
};

const tiendas: TiendaMaestro[] = [T1, T2].map((id) => ({
  id,
  codigo: id.toUpperCase(),
  nombre: `Tienda ${id.toUpperCase()}`,
  tipo: "Tienda",
  activo: true,
  fecha_apertura: "2020-01-01",
  fecha_cierre: null,
}));
export const TIENDAS = tiendas;

export const SINT_INV_G3: Pick<OpcionesSintInv, "g3"> = { g3: [300, 330] };

/** Unidades anuales de cada GML y la forma con la que se reparten en el año. */
function planGml(o: OpcionesSintInv) {
  const [g3a, g3b] = o.g3 ?? [100, 110];
  return {
    [GML.G1]: { 2024: { total: 1200, forma: S }, 2025: { total: 1320, forma: S1 }, 2026: { total: 1320, forma: S1 } },
    [GML.G2]: { 2024: { total: 700, forma: S }, 2025: { total: 770, forma: S1 }, 2026: { total: 770, forma: S1 } },
    [GML.G3]: { 2024: { total: g3a, forma: D }, 2025: { total: g3b, forma: D }, 2026: { total: g3b, forma: D } },
  } as Record<string, Record<number, { total: number; forma: number[] }>>;
}

const mesDe = (anio: number, m: number) => `${anio}-${String(m + 1).padStart(2, "0")}`;

export type SintInv = {
  parametros: ParametrosCurvas;
  entrada: EntradaCorrida;
  salida: SalidaCorrida;
  resultado: AgrupacionResultado;
  temporada: TemporadaResultado | null;
  lectura: LecturaComposicion;
  maestro: MaestroComposicion;
  ctx: ContextoComposicion;
  /** Lo que devolvería `venta_estacionalidad_agrupacion`. */
  venta: VentaEstacionalidad;
  /** La lectura de composición para otra red (`p_red`): la de la prueba de la ruta. */
  lecturaPara: (pRed: Record<string, string[]>, hasta: string) => LecturaComposicion;
};

/** Unidades de un GML en un mes, repartidas 50 / 50 entre las dos tiendas. */
const unidadesMes = (plan: ReturnType<typeof planGml>, gml: string, anio: number, m: number) => (plan[gml][anio].total * plan[gml][anio].forma[m]) / 100;

export function sintInv(o: OpcionesSintInv = {}): SintInv {
  const plan = planGml(o);
  const agrupacionId = o.agrupacionId ?? "agr-sint-inv";
  const parametros = { ...PARAMETROS_POR_DEFECTO, ...(o.parametros ?? {}) };

  const agrupacion: FilaVentaAgrupacion[] = [];
  const temporadas: FilaVentaTemporada[] = [];
  for (const periodo of PUBLICADOS) {
    const anio = Number(periodo.slice(0, 4));
    const m = Number(periodo.slice(5, 7)) - 1;
    const total = Object.keys(plan).reduce((s, g) => s + unidadesMes(plan, g, anio, m), 0);
    for (const t of [T1, T2]) {
      agrupacion.push({ tienda_id: t, periodo, unidades: total / 2, venta_soles: (total / 2) * 100, costo_vendido: (total / 2) * 50 });
      temporadas.push({ temporada: "invierno", tienda_id: t, periodo, unidades: total / 2 });
    }
  }
  const venta: VentaEstacionalidad = {
    agrupacion,
    temporadas,
    meses_publicados: PUBLICADOS,
    cargas: Object.fromEntries(PUBLICADOS.map((m) => [m, `carga-${m}`])),
  };
  const entrada = armarEntradaAgrupacion(
    {
      hasta_periodo: "2026-09",
      meses_publicados: PUBLICADOS,
      venta,
      tiendas,
      periodos: [],
      agrupacion: { id: agrupacionId, temporada: "invierno", composicion: { equivalencias: 4, huella: "huella-sint-inv" }, temporada_sugerida: null, temporadas_mezcladas: false },
      activas_por_temporada: { invierno: 1 },
    },
    parametros
  );
  const salida = calcularCorrida(entrada, parametros);
  const resultado = salida.resultado.agrupaciones[0];
  const temporada = salida.resultado.temporadas.find((t) => t.temporada === "invierno") ?? null;

  // Eq por GML: G1 se reparte 50 / 50 entre E1 y E2; G2 → E3; G3 → E4 (genérica).
  const eqDe: Record<string, { id: string; parte: number }[]> = {
    [GML.G1]: [{ id: EQ.E1, parte: 0.5 }, { id: EQ.E2, parte: 0.5 }],
    [GML.G2]: [{ id: EQ.E3, parte: 1 }],
    [GML.G3]: [{ id: EQ.E4, parte: 1 }],
  };
  const otras: FilaOtras[] = o.otras2025 === undefined ? [] : [{ gml_id: GML.G1, agrupacion_id: OTRA_AGRUPACION, anio: 2025, unidades: o.otras2025 }];

  const lecturaPara = (pRed: Record<string, string[]>, hasta: string): LecturaComposicion => {
    const nodos: FilaNodo[] = [];
    const equivalencias: FilaEquivalenciaAnio[] = [];
    for (const g of Object.keys(plan)) {
      for (const [anioTexto, ids] of Object.entries(pRed)) {
        const anio = Number(anioTexto);
        const fraccion = ids.filter((t) => t === T1 || t === T2).length / 2;
        if (fraccion === 0) continue;
        let anual = 0;
        for (let m = 0; m < 12; m++) {
          const periodo = mesDe(anio, m);
          if (!PUBLICADOS.includes(periodo) || periodo > hasta) continue;
          const u = unidadesMes(plan, g, anio, m) * fraccion;
          nodos.push({ gml_id: g, periodo, unidades: u });
          anual += u;
        }
        for (const e of eqDe[g]) equivalencias.push({ equivalencia_id: e.id, gml_id: g, anio, unidades: anual * e.parte });
      }
    }
    return { nodos, equivalencias, otras, cargas: venta.cargas };
  };
  const pRed = armarRedPorAnio(entrada.redes);
  const lectura = lecturaPara(pRed, "2026-09");

  const maestro: MaestroComposicion = {
    gml: [
      { id: GML.G1, genero: "HOMBRE", mundo: "URBANO", linea: "CASACA", nivel: "GML", vigente: true },
      { id: GML.G2, genero: "HOMBRE", mundo: "URBANO", linea: "CHOMPA", nivel: "GML", vigente: true },
      { id: GML.G3, genero: "HOMBRE", mundo: "FORMAL", linea: "ABRIGO", nivel: "GML", vigente: true },
    ],
    equivalencias: [
      { id: EQ.E1, gml_id: GML.G1, nombre: "CASACA CLÁSICA", codigo: "E1", es_generica: false, activo: true },
      { id: EQ.E2, gml_id: GML.G1, nombre: "CASACA SLIM", codigo: "E2", es_generica: false, activo: true },
      { id: EQ.E3, gml_id: GML.G2, nombre: "CHOMPA LISA", codigo: "E3", es_generica: false, activo: true },
      { id: EQ.E4, gml_id: GML.G3, nombre: "SIN EQUIVALENCIA", codigo: "E4", es_generica: true, activo: true },
    ],
    agrupaciones: [{ id: OTRA_AGRUPACION, nombre: "OTRA AGRUPACIÓN" }],
  };
  const ctx = contextoComposicion({ entrada, resultado, agrupacion_id: agrupacionId, parametros, huella_calculo: "huella-calculo-sint" });
  return { parametros, entrada, salida, resultado, temporada, lectura, maestro, ctx, venta, lecturaPara };
}
