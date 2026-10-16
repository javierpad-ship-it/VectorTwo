/**
 * Tipos INTERNOS del método de M7 (el servidor y los tests). Las formas JSON y las constantes viven en
 * `tipos-api.ts` (autocontenido, lo usa la pantalla) y se re-exportan aquí para importar de un solo sitio.
 */
import type { PeriodoParaClase } from "@/lib/curvas/atipicos";
import type { ConfigFlujo } from "@/lib/marcas/gml/flujo";
import type { AgrupacionProy, CurvaVigenteProy } from "./curva-fila";
import type { FactorProy } from "./nino";
import type { DetalleW12 } from "./participaciones";
import type { FilaDisponibilidad } from "./cola-larga";
import type { TiendaProy } from "./bloques";
import type {
  AnioFilaApi,
  AvisoFila,
  Bloque,
  BloquesApi,
  CurvaOrigen,
  HistoricoFila,
  Metodo,
  OrigenComposicion,
  OrigenDecision,
  Participaciones,
  ParametrosProyeccion,
  ResumenProyeccion,
  Subbloque,
} from "./tipos-api";

export * from "./tipos-api";
export type { TiendaProy } from "./bloques";
export type { DetalleW12 } from "./participaciones";
export type { FilaDisponibilidad } from "./cola-larga";
export type { AgrupacionProy, CurvaVigenteProy } from "./curva-fila";
export type { FactorProy } from "./nino";

// ─── Lo que devuelve `venta_proyeccion` (ficha 07, 6.2) ───

/** Una fila de `filas`: agrupada por la clave de pertenencia de las tiendas (cinco caracteres). */
export type FilaVenta = {
  gml_id: string;
  equivalencia_id: string | null;
  agrupacion_marca_id: string;
  clave: string;
  /** `aaaa-mm-01` (o `aaaa-mm`). */
  periodo: string;
  unidades: number;
  venta_soles: number;
  costo_vendido: number;
  stock_unidades: number;
};

/** Una fila de `por_tienda`: solo las tiendas pedidas en `p_tiendas_detalle`. */
export type FilaVentaTienda = {
  tienda_id: string;
  gml_id: string;
  equivalencia_id: string | null;
  agrupacion_marca_id: string;
  periodo: string;
  unidades: number;
  venta_soles: number;
  stock_unidades: number;
};

export type PesoEquivalencia = { gml_id: string; equivalencia_id: string | null; unidades: number };

export type VentaProyeccion = {
  filas: FilaVenta[];
  por_tienda: FilaVentaTienda[];
  equivalencias: PesoEquivalencia[];
  detalle_w12: DetalleW12[];
  /**
   * `0.10.1`: disponibilidad mensual (proxy) por fila y mes dentro de `[p_desde_w12, hasta]`, sobre las tiendas de `M(Y)`; trae además
   * el stock del CD (la única lectura del CD en M7). Una lectura anterior a la migración no la trae: llega vacía.
   */
  disponibilidad: FilaDisponibilidad[];
  /** `aaaa-mm → carga_id`. */
  cargas: Record<string, string>;
};

// ─── Unidades de planificación ───

export type EquivalenciaProy = { id: string; nombre: string; agrupacion_estacionalidad_id: string | null };

/** Un nodo GML (con sus equivalencias activas) tal como lo necesita el método. */
export type NodoProy = {
  gml_id: string;
  nivel: "GML" | "GMLE";
  genero_id: string;
  mundo_id: string;
  linea_id: string;
  genero: string;
  mundo: string;
  linea: string;
  equivalencias: EquivalenciaProy[];
};

// ─── Decisiones previas (lo que un recálculo conserva) ───

export type DecisionPrevia = {
  decidido: number | null;
  origen: OrigenDecision | null;
  nota: string | null;
  propuesta_al_decidir: number | null;
  crecimiento_pct: number | null;
  decidido_por_nombre: string | null;
  decidido_at: string | null;
  meses: number[] | null;
  curva_origen_usada: CurvaOrigen[];
};

export type DecisionTiendaPrevia = {
  decidido: number | null;
  origen: "propuesta" | "manual" | null;
  nota: string | null;
  propuesta_al_decidir: number | null;
  rampa: number[] | null;
  decidido_por_nombre: string | null;
  decidido_at: string | null;
};

export type PreviasCalculo = {
  /** Clave `${claveFila}#${anio}`. */
  filas: ReadonlyMap<string, DecisionPrevia>;
  /** Clave `${tienda_id}#${anio}`. */
  tiendas: ReadonlyMap<string, DecisionTiendaPrevia>;
};

export const SIN_PREVIAS: PreviasCalculo = { filas: new Map(), tiendas: new Map() };

// ─── Entrada y salida del cálculo ───

export type PlanAnterior = {
  /** Nombre de la proyección cerrada que cubrió el año en curso. */
  nombre: string;
  /** Total vigente de `Y` de cada fila base de esa cerrada, por `claveFila` base. */
  totales: ReadonlyMap<string, number>;
};

export type EntradaCalculo = {
  /** `Y`. */
  anio: number;
  /** Índice (1 a 12) del último mes cerrado. */
  k: number;
  hoy: string;
  parametros: Pick<
    ParametrosProyeccion,
    "crecimiento_pct_defecto" | "umbral_avance" | "umbral_cobertura" | "umbral_cola_larga" | "umbral_disponibilidad" | "rampa_maduracion"
  >;
  tiendas: TiendaProy[];
  nodos: NodoProy[];
  agrupaciones: AgrupacionProy[];
  vigentes: CurvaVigenteProy[];
  periodos: PeriodoParaClase[];
  factores: FactorProy[];
  venta: VentaProyeccion;
  planAnterior: PlanAnterior | null;
  /** Para `participaciones` (claveFlujo); sin ella las participaciones quedan en `null`. */
  configFlujo: ConfigFlujo | null;
  previas?: PreviasCalculo;
};

export type RegistroModelo = AnioFilaApi & {
  curva_origen_usada: CurvaOrigen[];
  curva_origen_propuesta: CurvaOrigen[] | null;
};

export type ComposicionFilaTienda = { origen: OrigenComposicion; s: number; p: number; unidades_maduras: number };

export type FilaModelo = {
  /** `claveFila(tienda_id, gml_id, equivalencia_id, agrupacion_marca_id)`. */
  clave: string;
  tienda_id: string | null;
  gml_id: string;
  equivalencia_id: string | null;
  agrupacion_marca_id: string;
  nivel: "GML" | "GMLE";
  agrupacion_estacionalidad_id: string | null;
  temporada: string | null;
  curva: number[] | null;
  curva_origen: CurvaOrigen[];
  factores_mes: Record<number, number[]> | null;
  historico: HistoricoFila | null;
  participaciones: Participaciones | null;
  composicion: ComposicionFilaTienda | null;
  avisos: AvisoFila[];
  activo: boolean;
  registros: RegistroModelo[];
};

export type TiendaModelo = {
  tienda_id: string;
  anio: number;
  bloque: "nuevas" | "cierres";
  subbloque: Subbloque | null;
  fecha_usada: string;
  venta_esperada_usada: number | null;
  referente_id_usado: string | null;
  origen_composicion: OrigenComposicion;
  rampa: number[];
  unidades_maduras: number | null;
  vendido: number;
  propuesto: number | null;
  metodo: Metodo;
  decidido: number | null;
  origen: "propuesta" | "manual" | null;
  propuesta_al_decidir: number | null;
  nota: string | null;
  decidido_por_nombre: string | null;
  decidido_at: string | null;
  explicacion: string;
  referencia_alternativa: number | null;
  referencia_tres_meses: number | null;
  avisos: AvisoFila[];
};

export type SalidaCalculo = {
  bloques: BloquesApi;
  /** `tienda_id → clave de pertenencia` (la que recibe `venta_proyeccion` en `p_grupos`). */
  claves: Record<string, string>;
  filas: FilaModelo[];
  tiendas: TiendaModelo[];
  resumen: ResumenProyeccion;
};

/** `${tienda|""}|${gml}|${equivalencia|""}|${agrupacion_marca}` (la `clave` de `proyeccion_filas`). */
export function claveFila(tiendaId: string | null, gmlId: string, equivalenciaId: string | null, agrupacionMarcaId: string): string {
  return `${tiendaId ?? ""}|${gmlId}|${equivalenciaId ?? ""}|${agrupacionMarcaId}`;
}

/** Clave de la fila base de una fila de tienda (misma GML-AM, sin tienda). */
export function claveBaseDe(clave: string): string {
  return clave.slice(clave.indexOf("|"));
}

export const vigenteDe = (decidido: number | null, propuesto: number | null): number | null => decidido ?? propuesto;

export type { Bloque };
