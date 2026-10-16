import { listarMeses } from "@/lib/ventas/periodo";
import type { PeriodoParaClase } from "@/lib/curvas/atipicos";
import type { FilaVentaAgrupacion, FilaVentaTemporada } from "@/lib/curvas/agregado";
import { armarEntradaAgrupacion } from "@/lib/curvas/entrada";
import { calcularCorrida, type EntradaCorrida, type SalidaCorrida } from "@/lib/curvas/modelo";
import { PARAMETROS_POR_DEFECTO, type AgrupacionResultado, type ParametrosCurvas, type TemporadaResultado } from "@/lib/curvas/tipos-api";
import type { TiendaMaestro } from "@/lib/curvas/tipos";

/**
 * Fixtures sintéticos de `F` y `T` (docs/modulos/06c-curvas-composicion-y-curva-usuario.md, "Casos de
 * prueba sintéticos": `P3`, `P2` y una agrupación muy ruidosa). Nada real de Lukers: formas inventadas.
 * Se arman con la misma ruta que el servidor (`armarEntradaAgrupacion` → `calcularCorrida`), con UNA tienda en
 * la red todos los años y la serie de la temporada hecha solo con OTRAS agrupaciones (así la `T` del pliegue
 * es la `T` completa cuando la forma de la temporada es la misma todos los años).
 */

export const AGRUPACION_ID = "p3";
const TIENDA_ID = "t1";
export const PUBLICADOS = listarMeses("2023-01", "2026-09");

/** En % (ene…dic), suman 100. */
export const S = [4, 4, 6, 8, 12, 14, 14, 12, 10, 7, 5, 4];
export const S_2023 = [4, 4, 6, 8, 14, 12, 14, 12, 10, 7, 5, 4];
export const S_2025 = [4, 4, 6, 8, 10, 16, 14, 12, 10, 7, 5, 4];
/** `T` de la temporada: difiere de `S` en marzo y octubre. */
export const T_TEMPORADA = [4, 4, 8, 8, 12, 14, 14, 12, 10, 5, 5, 4];

export type FormasPorAnio = Partial<Record<number, readonly number[]>>;

/** `P3`: tres años de ajuste normales (difieren solo en mayo y junio) y 2026 en curso. */
export const P3: FormasPorAnio = { 2023: S_2023, 2024: S, 2025: S_2025, 2026: S };
/** `P2` = `P3` sin 2023. */
export const P2: FormasPorAnio = { 2024: S, 2025: S_2025, 2026: S };

export type OpcionesAvanzada = {
  /** Forma (%) de la agrupación por año; los años ausentes no tienen venta. */
  anios: FormasPorAnio;
  /**
   * Forma (%) de la serie de la temporada (OTRAS agrupaciones): la misma todos los años (arreglo), una por año
   * (los años ausentes quedan con venta plana y escasa, fuera del ajuste) o `null` (sin serie útil: venta plana y escasa).
   */
  temporada?: readonly number[] | FormasPorAnio | null;
  /** Unidades de la agrupación por año (por defecto 1 200: 12 × el porcentaje). */
  total?: number | ((anio: number) => number);
  periodos?: PeriodoParaClase[];
  parametros?: Partial<ParametrosCurvas>;
};

const tienda: TiendaMaestro = {
  id: TIENDA_ID,
  codigo: "T1",
  nombre: "Tienda T1",
  tipo: "Tienda",
  activo: true,
  fecha_apertura: "2020-01-01",
  fecha_cierre: null,
};

export function entradaAvanzada(o: OpcionesAvanzada): EntradaCorrida {
  const total = (anio: number) => (typeof o.total === "function" ? o.total(anio) : (o.total ?? 1200));
  const agrupacion: FilaVentaAgrupacion[] = [];
  const temporadas: FilaVentaTemporada[] = [];
  const temporada = o.temporada === undefined ? T_TEMPORADA : o.temporada;
  for (const periodo of PUBLICADOS) {
    const anio = Number(periodo.slice(0, 4));
    const m = Number(periodo.slice(5, 7)) - 1;
    const forma = o.anios[anio];
    if (forma) {
      const unidades = (forma[m] * total(anio)) / 100;
      agrupacion.push({ tienda_id: TIENDA_ID, periodo, unidades, venta_soles: unidades * 100, costo_vendido: unidades * 50 });
    }
    // La tienda vende todos los meses por la serie de OTRAS agrupaciones (la red comparable exige venta cada mes).
    // Sin forma para el año, venta plana de 5 al mes (60 al año: escaso, no entra en el ajuste de la temporada).
    const formaT = Array.isArray(temporada) ? (temporada as readonly number[]) : temporada ? (temporada as FormasPorAnio)[anio] : undefined;
    temporadas.push({ temporada: "invierno", tienda_id: TIENDA_ID, periodo, unidades: formaT ? (formaT[m] * 1200) / 100 : 5 });
  }
  const parametros = { ...PARAMETROS_POR_DEFECTO, ...(o.parametros ?? {}) };
  return armarEntradaAgrupacion(
    {
      hasta_periodo: "2026-09",
      meses_publicados: PUBLICADOS,
      venta: { agrupacion, temporadas },
      tiendas: [tienda],
      periodos: o.periodos ?? [],
      agrupacion: { id: AGRUPACION_ID, temporada: "invierno", composicion: { equivalencias: 1, huella: "huella-p3" }, temporada_sugerida: null, temporadas_mezcladas: false },
      activas_por_temporada: { invierno: 2 },
    },
    parametros
  );
}

export type CalculoAvanzada = { salida: SalidaCorrida; agrupacion: AgrupacionResultado; temporada: TemporadaResultado | null; parametros: ParametrosCurvas };

export function calcularAvanzada(o: OpcionesAvanzada): CalculoAvanzada {
  const parametros = { ...PARAMETROS_POR_DEFECTO, ...(o.parametros ?? {}) };
  const salida = calcularCorrida(entradaAvanzada(o), parametros);
  const agrupacion = salida.resultado.agrupaciones[0];
  return { salida, agrupacion, temporada: salida.resultado.temporadas.find((t) => t.temporada === "invierno") ?? null, parametros };
}

/** Una agrupación muy ruidosa: cuatro años con formas casi sin relación (pseudoaleatorias con semilla fija). */
export function formasRuidosas(semilla = 7): FormasPorAnio {
  let x = semilla;
  const siguiente = () => {
    x = (x * 1103515245 + 12345) % 2147483648;
    return x / 2147483648;
  };
  const forma = () => {
    const crudo = Array.from({ length: 12 }, () => 1 + siguiente() * 9);
    const suma = crudo.reduce((s, v) => s + v, 0);
    return crudo.map((v) => (v * 100) / suma);
  };
  return { 2023: forma(), 2024: forma(), 2025: forma(), 2026: S };
}

/** Las tres agrupaciones sintéticas del backtest de CI. */
export const AGRUPACIONES_SINTETICAS: { nombre: string; opciones: OpcionesAvanzada }[] = [
  { nombre: "P3", opciones: { anios: P3 } },
  { nombre: "P2", opciones: { anios: P2 } },
  { nombre: "ruidosa", opciones: { anios: formasRuidosas() } },
];
