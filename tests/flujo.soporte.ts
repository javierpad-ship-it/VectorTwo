import type { ResolverMarcas } from "@/lib/flujo/ingresos";
import { claveDeFila, sumarMes, type FilaCerradaFlujo } from "@/lib/flujo/filas";
import type { EntradaCalculoFlujo, NodoFlujo, ParametrosCalculo, RegistrosCompras } from "@/lib/flujo/modelo";
import type { StockFila, StockMarca, StockMes } from "@/lib/flujo/stock";
import type { ReglaFlujoApi } from "@/lib/flujo/tipos-api";
import { AGR_M8, K_PRIMA, LIN_M8, MARCA_M8, NODO_M8, type RegistrosCompra } from "./compras.fixture";
import { EQ, GEN, LIN, MUN } from "./intercompany.fixture";

/**
 * Soporte de las pruebas de la lógica del flujo de M8 (T2a): arma la entrada de `calcularFlujo` con el árbol, las marcas y las
 * cifras de la ficha 08 (todo inventado). No toca `flujo.fixture.ts` ni `compras.fixture.ts`: solo los lee.
 */

export const PARAMETROS: ParametrosCalculo = {
  imi_min: 4,
  imi_max: 8,
  meses_tarjeta: 6,
  extender_horizonte: true,
  umbral_conciliacion_u: 10,
  umbral_conciliacion_pct: 20,
};

export const HORIZONTE = { desde: "2026-10", hasta: "2027-12" };

/** Nodos género · mundo · línea de los fixtures de M13 y M8. */
export const NODOS: ReadonlyMap<string, NodoFlujo> = new Map([
  [NODO_M8.urbano, { genero_id: GEN.hombre, mundo_id: MUN.urbano, linea_id: LIN.denim }],
  [NODO_M8.camisa, { genero_id: GEN.hombre, mundo_id: MUN.formal, linea_id: LIN.camisa }],
  [NODO_M8.polo, { genero_id: GEN.hombre, mundo_id: MUN.casual, linea_id: LIN.polo }],
  [NODO_M8.sandalia, { genero_id: GEN.mujer, mundo_id: MUN.casual, linea_id: LIN_M8.sandalia }],
]);

const AGRUPACION_DE: Record<string, string> = {
  [MARCA_M8.alfa]: AGR_M8.reconocido,
  [MARCA_M8.beta]: AGR_M8.premium,
  [MARCA_M8.gamma]: AGR_M8.reconocido,
  [MARCA_M8.delta]: AGR_M8.valor,
  [MARCA_M8.jh]: AGR_M8.reconocido,
  [MARCA_M8.donatelli]: AGR_M8.reconocido,
};

export const RESOLVER: ResolverMarcas = {
  unidadDeMarca: (id) => (id === MARCA_M8.john ? MARCA_M8.jh : id),
  agrupacionDeMarca: (id) => AGRUPACION_DE[id] ?? null,
};

export { AGR_M8, EQ, K_PRIMA, MARCA_M8, NODO_M8 };

// ─── Stock ───

type ParteStock = Partial<{ cd: number; tiendas: number; inactivas: number; venta: number; ventaInactivas: number }>;

export function stockMarca(p: ParteStock): StockMarca {
  const cd = p.cd ?? 0;
  const tiendas = p.tiendas ?? 0;
  const inactivas = p.inactivas ?? 0;
  const flujo = cd + tiendas;
  return {
    cd: flujo < 0 ? 0 : cd,
    tiendas: flujo < 0 ? 0 : tiendas,
    inactivas,
    unidades: p.venta ?? 0,
    unidades_inactivas: p.ventaInactivas ?? 0,
    cadena: Math.max(0, flujo + inactivas),
    negativo: flujo < 0 || flujo + inactivas < 0,
  };
}

export type SemillaStock = {
  gml: string;
  eq?: string | null;
  agr: string;
  /** Por unidad de marca; si no se da, una sola marca ALFA con todo. */
  marcas?: Record<string, ParteStock>;
} & ParteStock;

export function filaStock(p: SemillaStock): StockFila {
  const clave = claveDeFila({ gml_id: p.gml, equivalencia_id: p.eq ?? null, agrupacion_marca_id: p.agr });
  const por_marca = new Map<string, StockMarca>();
  for (const [marca, parte] of Object.entries(p.marcas ?? {})) por_marca.set(marca, stockMarca(parte));
  return {
    clave,
    gml_id: p.gml,
    equivalencia_id: p.eq ?? null,
    agrupacion_marca_id: p.agr,
    ...stockMarca(p),
    por_marca,
  };
}

export function stockMes(periodo: string, filas: readonly SemillaStock[], extra: Partial<Pick<StockMes, "excluido" | "sin_clave" | "publicada">> = {}): StockMes {
  const m = new Map<string, StockFila>();
  for (const f of filas) {
    const fila = filaStock(f);
    m.set(fila.clave, fila);
  }
  return { periodo, carga_id: `carga-${periodo}`, publicada: extra.publicada ?? true, filas: m, excluido: extra.excluido ?? { stock: 0, unidades: 0 }, sin_clave: extra.sin_clave ?? { stock: 0, unidades: 0 } };
}

/** Un mapa `mes → StockMes` para la entrada de `calcularFlujo`. */
export const mapaDeStock = (...meses: StockMes[]): Map<string, StockMes> => new Map(meses.map((m) => [m.periodo, m]));

// ─── Cerrada ───

/** Doce valores de enero a diciembre de `anio` con `valores` desde `desde` (`aaaa-mm`) y ceros fuera. */
export function mesesDelAnio(anio: number, desde: string, valores: readonly number[]): number[] {
  const salida = new Array<number>(12).fill(0);
  valores.forEach((v, i) => {
    const mes = sumarMes(desde, i);
    if (Number(mes.slice(0, 4)) === anio) salida[Number(mes.slice(5, 7)) - 1] = v;
  });
  return salida;
}

export type ParticipacionesTest = NonNullable<FilaCerradaFlujo["participaciones_historicas"]>;

/**
 * Las filas de la cerrada (una por año) de una fila `(g, a)` con la demanda de `desde` en adelante. `partic` va en las filas base;
 * `total` por defecto es la suma de los meses del año.
 */
export function cerradaDeFila(p: {
  gml: string;
  eq?: string | null;
  agr: string;
  desde?: string;
  demanda: readonly number[];
  tienda?: string | null;
  partic?: ParticipacionesTest | null;
  sinMeses?: boolean;
  total?: number;
}): FilaCerradaFlujo[] {
  const desde = p.desde ?? "2026-10";
  const anios = [...new Set(p.demanda.map((_, i) => Number(sumarMes(desde, i).slice(0, 4))))];
  return anios.map((anio) => {
    const meses = mesesDelAnio(anio, desde, p.demanda);
    return {
      gml_id: p.gml,
      equivalencia_id: p.eq ?? null,
      agrupacion_marca_id: p.agr,
      tienda_id: p.tienda ?? null,
      anio,
      total: p.total ?? meses.reduce((a, x) => a + x, 0),
      meses: p.sinMeses ? null : meses,
      participaciones_historicas: p.tienda ? null : (p.partic ?? null),
    };
  });
}

export const participaciones = (porMarca: Record<string, number>, barrido: Record<string, number> = {}): ParticipacionesTest => ({
  por_clave_flujo: [
    ...Object.entries(porMarca).map(([marca_id, participacion]) => ({ clave_flujo: `marca:${marca_id}`, marca_id, participacion })),
    ...Object.entries(barrido).map(([marca_id, participacion]) => ({ clave_flujo: `barrido:${marca_id}`, marca_id, participacion })),
    { clave_flujo: "otras", marca_id: null, participacion: Math.max(0, 1 - Object.values(porMarca).reduce((a, x) => a + x, 0) - Object.values(barrido).reduce((a, x) => a + x, 0)) },
  ],
  por_marca: [...Object.entries(porMarca), ...Object.entries(barrido)].map(([marca_id, participacion]) => ({ marca_id, participacion })),
});

// ─── Compras ───

export const SIN_COMPRAS: RegistrosCompras = { compras: [], lineas: [], entregas: [], repartos: [], recepciones: [] };

export function unirCompras(...partes: RegistrosCompra[]): RegistrosCompras {
  return {
    compras: partes.flatMap((p) => p.compras),
    lineas: partes.flatMap((p) => p.lineas),
    entregas: partes.flatMap((p) => p.entregas),
    repartos: partes.flatMap((p) => p.repartos),
    recepciones: partes.flatMap((p) => p.recepciones),
  };
}

// ─── Entrada ───

/** DENIM × RECONOCIDO (caso 1): demanda 150 × 3, 160 × 11 y 183 desde oct-2026. */
export const DEMANDA_CASO1 = [150, 150, 150, ...Array.from({ length: 11 }, () => 160), 183];

export const claveDenim = claveDeFila({ gml_id: NODO_M8.urbano, equivalencia_id: null, agrupacion_marca_id: AGR_M8.reconocido });
export const claveCamisaLarga = claveDeFila({ gml_id: NODO_M8.camisa, equivalencia_id: EQ.larga, agrupacion_marca_id: AGR_M8.reconocido });

export const REGLA_JH: ReglaFlujoApi = {
  id: "10000000-0000-4000-8000-000000000001",
  marca_id: MARCA_M8.jh,
  marca: "JOHN HOLDEN",
  gml_id: NODO_M8.camisa,
  equivalencia_id: null,
  vigente_desde: "2026-01",
  hasta_derivado: null,
  imi_min: 4,
  imi_max: 8,
  pct_directo: 80,
};

/** Entrada de `calcularFlujo` con los valores del caso 1 por defecto; `op` sobrescribe lo que haga falta. */
export function entrada(op: Partial<EntradaCalculoFlujo> & { kPrima?: string } = {}): EntradaCalculoFlujo {
  const kPrima = op.kPrima ?? op.reloj?.k_prima ?? K_PRIMA;
  const { kPrima: _omitido, ...resto } = op;
  void _omitido;
  return {
    reloj: { k_prima: kPrima, k: "2026-09", hoy_lima: "2026-10" },
    horizonte: HORIZONTE,
    cubre: "en_curso",
    parametros: PARAMETROS,
    cerrada: { filas: [], version_metodo: 4, huella_flujo: "h", periodo_referencia: { desde: "2025-10", hasta: "2026-09" } },
    huella_flujo_hoy: "h",
    stock: new Map(),
    compras: SIN_COMPRAS,
    reglas: [],
    resolver: RESOLVER,
    nodos: NODOS,
    mis_combinaciones: [],
    ...resto,
  };
}

