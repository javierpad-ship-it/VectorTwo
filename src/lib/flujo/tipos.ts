/**
 * Constantes del flujo de M8 (docs/modulos/08-flujo-y-compras.md, §0.6 y sección 7) y la forma de lo que devuelven las funciones de
 * lectura de la base. Puro y sin I/O. `VERSION_METODO_MIN_M8` NO se define aquí: se importa de `src/lib/proyeccion/tipos-api.ts`.
 * `temporadaDe` y `motivoTemporadasInvalidas` se importan de `src/lib/marcas-barrer/temporadas.ts` (no se redefinen).
 */
import type { Mes } from "@/lib/compras/tipos";

export { TEMPORADAS_DEFECTO } from "@/lib/marcas-barrer/tipos-api";

// ─── Método ───

/** Rango IMI por defecto (decisión 26): `flujo_parametros.imi_min` / `imi_max` lo editan. */
export const IMI_MIN = 4;
export const IMI_MAX = 8;
/** Los doce meses siguientes de la demanda que promedia el VPM; más allá del horizonte se repiten los últimos doce (`extendido`). */
export const MESES_VPM = 12;
export const MESES_TARJETA = 6;
export const MESES_EXTENSION = 12;
/** Meses cerrados que concilia la pestaña Conciliación (`k'−11 … k'`). */
export const MESES_CONCILIACION = 12;
/** Techo del horizonte: de `k'+1` hasta diciembre del año siguiente, con `k'` = diciembre. */
export const MAX_MESES_HORIZONTE = 24;
export const UMBRAL_CONCILIACION_U = 10;
export const UMBRAL_CONCILIACION_PCT = 20;
/** Se suma a `huellaCalculoFlujo`: súbela si cambia la aritmética del flujo. */
export const VERSION_METODO_FLUJO = 3;

// ─── Caché y tamaño (§0.6) ───

export const MESES_CACHE_STOCK = 26;
export const PARALELO_STOCK = 3;
/** Respuesta de `GET /api/flujo` sin comprimir: ≤ 1,5 MB con el horizonte típico (15 meses) y ≤ 2,5 MB con el máximo (24). */
export const TAMANO_FLUJO_TIPICO = 1.5 * 1024 * 1024;
export const TAMANO_FLUJO_MAXIMO = 2.5 * 1024 * 1024;
export const TAMANO_HUECOS_MAXIMO = 0.4 * 1024 * 1024;
export const TAMANO_FILA_MAXIMO = 60 * 1024;

// ─── Límites de los parámetros (los valida zod, no la base: criterio I9) ───

export const IMI_LIMITE_MIN = 0.5;
export const IMI_LIMITE_MAX = 24;
export const MESES_TARJETA_MIN = 1;
export const MESES_TARJETA_MAX = 24;
export const UMBRAL_CONCILIACION_U_MAX = 1000;
export const UMBRAL_CONCILIACION_PCT_MAX = 100;

// ─── Lo que devuelven las funciones de lectura de `0025` (§6.9 y §6.10) ───

/**
 * `stock_flujo(p_carga_id)`: un mes por llamada, por `(equivalencia, unidad de marca)`, sin talla. `filas[i]` =
 * `[i_equivalencia, i_marca, stock_cd, stock_tiendas, unidades, stock_inactivas, unidades_inactivas]` (índices en `equivalencias` y
 * `marcas`). Con una carga no publicada, `publicada = false` y `filas` vacío. `periodo` llega como la fecha de la base.
 */
export type StockFlujoJson = {
  carga_id: string;
  periodo: string;
  publicada: boolean;
  equivalencias: string[];
  marcas: string[];
  filas: [number, number, number, number, number, number, number][];
  excluido: { stock: number; unidades: number };
};

type ConteoMaximo = [number, string | null];

/** `flujo_huella_base()`: una sola llamada barata que dice si algo de lo que usa el flujo cambió. */
export type HuellaBaseJson = {
  cargas: { periodo: string; carga_id: string; publicada_at: string }[];
  cerradas: { id: string; anio_en_curso: number; updated_at: string }[];
  compras: { eventos: number; ultimo: string | null; revision: number; actualizada: string | null };
  parametros: string | null;
  repartos: { vigentes: number; ultima: string | null };
  reglas: { n: number; ultima: string | null };
  config: {
    marcas: ConteoMaximo;
    marca_gml_especial: ConteoMaximo;
    agrupaciones_marca: ConteoMaximo;
    genero_mundo_linea: ConteoMaximo;
    equivalencias: ConteoMaximo;
    tiendas: ConteoMaximo;
    responsables_genero_mundo: ConteoMaximo;
  };
};

/** Cronología de un cálculo: lo que entra como parámetro (`k'`, `k`, `hoy`) porque la lógica no lee el reloj. */
export type RelojFlujo = { k_prima: Mes; k: Mes; hoy_lima: Mes };
