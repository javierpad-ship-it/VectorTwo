/**
 * Tipos y constantes de M6 del lado del servidor (docs/modulos/06-curvas-estacionalidad.md,
 * "Contratos de API" → Constantes y "El modelo" → Entrada del modelo).
 *
 * Las formas JSON y las constantes viven en `tipos-api.ts` (autocontenido, lo
 * usa el frontend); se re-exportan aquí para que el servidor importe de un solo
 * sitio. Aquí van los tipos INTERNOS del modelo (filas del agregado, series).
 */
import {
  ALCANCES_PERIODO,
  TEMPORADAS_AGRUPACION,
  type AlcancePeriodo,
  type TemporadaAgrupacion,
} from "./tipos-api";

export * from "./tipos-api";

export function esTemporadaAgrupacion(valor: unknown): valor is TemporadaAgrupacion {
  return typeof valor === "string" && (TEMPORADAS_AGRUPACION as readonly string[]).includes(valor);
}

export function esAlcancePeriodo(valor: unknown): valor is AlcancePeriodo {
  return typeof valor === "string" && (ALCANCES_PERIODO as readonly string[]).includes(valor);
}

/** Temporada de una fila de la base (`text` con `check`): un valor desconocido se trata como el neutro. */
export function temporadaDeFila(valor: unknown): TemporadaAgrupacion {
  return esTemporadaAgrupacion(valor) ? valor : "todo_el_ano";
}

// ─── Tipos internos del modelo ───

/** Una fila del agregado: agrupación × tienda × mes (agrupación nula = unidades sin agrupación). */
export type FilaAgregado = {
  agrupacion_id: string | null;
  tienda_id: string;
  /** `aaaa-mm`. */
  periodo: string;
  unidades: number;
  venta_soles: number;
  costo_vendido: number;
};

/** Lo que el modelo necesita de una tienda de M4. */
export type TiendaMaestro = {
  id: string;
  codigo: string;
  nombre: string;
  /** `Tienda` o `Centro de Distribución`. */
  tipo: string;
  activo: boolean;
  /** `aaaa-mm-dd` o `null`. */
  fecha_apertura: string | null;
  fecha_cierre: string | null;
};

/** Venta total de una tienda en un mes (todas las agrupaciones). */
export type VentaTiendaMes = { tienda_id: string; periodo: string; unidades: number };

/** Doce meses de un año calendario. `publicados[m]` dice si el mes está publicado en M5 (sin publicar vale 0). */
export type SerieAnual = {
  anio: number;
  meses: number[];
  publicados: boolean[];
  /** Los doce meses están publicados. */
  completo: boolean;
};

export type CampoMedida = "unidades" | "venta_soles" | "costo_vendido";

/** Huellas con las que se calculó (o se calcula) una curva, para detectar obsolescencia. */
export type HuellasEstado = {
  composicion: string;
  red_huella: string;
  cargas_huella: string;
};
