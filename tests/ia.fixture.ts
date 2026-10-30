import type { DatosGM, FilaDatosIa } from "@/lib/ia/entrada";
import type { FilaMeta, OpcionesMeta } from "@/lib/ia/meta";
import type { TerminoPrivado } from "@/lib/ia/alias";
import { repartirEntero } from "@/lib/proyeccion/reparto";

/**
 * Fixture sintético de la propuesta con IA (ficha 07e, §5.6). Ninguna marca, tienda ni cifra reales: nombres inventados y cifras de los ejemplos.
 * Ejemplo A: HOMBRE · URBANO con `g = 8 %`, `sobre_base = corregida`, `umbral_cola_larga = 100`; invierno con `φ = 0,80`.
 */

export const ANIO = 2026;
export const K = 9;
export const OPCIONES_META: OpcionesMeta = { umbral_cola_larga: 100, incluir_cola_larga: false };

export const fm = (o: Partial<FilaMeta> & { fila_id: string; clave: string }): FilaMeta => ({
  propuesto: null,
  base: null,
  base_corregida: null,
  crecimiento_pct: null,
  decidido: null,
  vigente: null,
  revision_cola_larga: false,
  ...o,
});

/** Las cinco filas del ejemplo A. `P^GM = propuesto = round(B' × 1,08)`. */
export function filasMetaA(): FilaMeta[] {
  return [
    fm({ fila_id: "f1", clave: "k1", propuesto: 10800, base: 10000, base_corregida: 10000, vigente: 10800 }),
    fm({ fila_id: "f2", clave: "k2", propuesto: 6480, base: 6000, base_corregida: 6000, vigente: 6480 }),
    fm({ fila_id: "f3", clave: "k3", propuesto: 5400, base: 4000, base_corregida: 5000, vigente: 5400 }),
    fm({ fila_id: "f4", clave: "k4", propuesto: 3240, base: 3000, base_corregida: 3000, decidido: 3300, vigente: 3300 }),
    fm({ fila_id: "f5", clave: "k5", propuesto: 86, base: 80, base_corregida: 80, vigente: 86 }),
  ];
}

export const mesesPlanos = (total: number): number[] => repartirEntero(total, Array.from({ length: 12 }, () => 1)) ?? [];

export function filaDatos(o: Partial<FilaDatosIa> & { clave: string; linea: string }): FilaDatosIa {
  const { clave, linea, ...resto } = o;
  return {
    clave,
    linea_id: `lin-${linea}`,
    linea,
    equivalencia_id: null,
    equivalencia: null,
    agrupacion_marca_id: "am-1",
    agrupacion_marca: "RECONOCIDO",
    temporada: "todo_el_ano",
    estado: "libre",
    meses_por_anio: {
      [ANIO - 3]: mesesPlanos(8400),
      [ANIO - 2]: mesesPlanos(9000),
      [ANIO - 1]: mesesPlanos(9600),
      [ANIO]: mesesPlanos(9500),
    },
    comparable_pct: { "A-2": 7.1, "A-1": 6.6, A: 5.4 },
    y: { vendido: 7200, vigente: 9600, avance: 0.75, metodo: "avance", decidido: false },
    y1: { base: 10000, base_corregida: 10000, aporte_entrantes: 0, aporte_salientes: 0, fija_en: null },
    senales: { meses_quiebre_w12: 0, disponibilidad: 0.95, meses_desde_primera_venta: 40, meses_con_venta_24: 24, factores_mes_y: null, avisos: [] },
    ...resto,
  };
}

/** El GM del ejemplo A como datos de entrada: tres libres, una fija decidida y una de cola larga. */
export function datosA(extra: Partial<DatosGM> = {}): DatosGM {
  return {
    genero: "HOMBRE",
    mundo: "URBANO",
    es_resto: false,
    anio_en_curso: ANIO,
    ultimo_mes_cerrado: K,
    nino: [{ anio: ANIO, temporada: "invierno", meses: [6, 7, 8], factor: 0.8 }],
    umbral_cola_larga: 100,
    fuera_de_meta: { aperturas_y1: 1240, cierres_y1: 0 },
    comparable_gm: { "A-2": 7.4, "A-1": 6.1, A: 5.0 },
    comparable_por_linea: {},
    filas: [
      filaDatos({ clave: "k1", linea: "DENIM", agrupacion_marca: "RECONOCIDO", y1: { base: 10000, base_corregida: 10000, aporte_entrantes: 0, aporte_salientes: 0, fija_en: null } }),
      filaDatos({ clave: "k2", linea: "POLO", agrupacion_marca: "VALOR", y1: { base: 6000, base_corregida: 6000, aporte_entrantes: 0, aporte_salientes: 0, fija_en: null } }),
      filaDatos({
        clave: "k3",
        linea: "CASACA",
        temporada: "invierno",
        y1: { base: 4000, base_corregida: 5000, aporte_entrantes: 0, aporte_salientes: 0, fija_en: null },
        senales: { meses_quiebre_w12: 0, disponibilidad: 0.95, meses_desde_primera_venta: 40, meses_con_venta_24: 24, factores_mes_y: [1, 1, 1, 1, 1, 0.8, 0.8, 0.8, 1, 1, 1, 1], avisos: [] },
      }),
      filaDatos({ clave: "k4", linea: "BUZO", agrupacion_marca: "MID VALUE", estado: "fija", y1: { base: 3000, base_corregida: 3000, aporte_entrantes: 0, aporte_salientes: 0, fija_en: 3300 } }),
      filaDatos({ clave: "k5", linea: "GORRO", agrupacion_marca: "VALOR", estado: "cola_larga", y1: { base: 80, base_corregida: 80, aporte_entrantes: 0, aporte_salientes: 0, fija_en: 86 } }),
    ],
    ...extra,
  };
}

/** Ejemplo J: la marca «MARCAX» y una tienda de código «Z901» (nombres sintéticos). */
export const TERMINOS_J: TerminoPrivado[] = [
  { texto: "MARCAX", tipo: "marca", id: "00000000-0000-4000-8000-0000000000aa" },
  { texto: "Z901", tipo: "tienda", id: "00000000-0000-4000-8000-0000000000bb" },
];

/** `n` filas libres sintéticas repartidas en `lineas` líneas (para el modo jerárquico). */
export function datosGrandes(n: number, lineas: number): DatosGM {
  const filas: FilaDatosIa[] = [];
  for (let i = 0; i < n; i++) filas.push(filaDatos({ clave: `k${String(i).padStart(4, "0")}`, linea: `LINEA ${String.fromCharCode(65 + (i % lineas))}`, agrupacion_marca: `AM ${i}` }));
  return datosA({ filas });
}
