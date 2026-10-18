/**
 * Tipos INTERNOS del método de M12 (el servidor y los tests). Las formas JSON y las constantes viven en `tipos-api.ts`
 * (autocontenido, lo usa la pantalla) y se re-exportan aquí para importar de un solo sitio.
 */
import type { ModalidadBarrer, Temporada, TemporadasConfig } from "./tipos-api";

export * from "./tipos-api";

/** `aaaa-mm`. */
export type Mes = string;

/** Una unidad de planificación `g`: `gml_id|equivalencia_id` (equivalencia vacía si el nodo es GML). */
export type ClaveG = string;

export const claveG = (gmlId: string, equivalenciaId: string | null): ClaveG => `${gmlId}|${equivalenciaId ?? ""}`;

export function partesDeClaveG(clave: ClaveG): { gml_id: string; equivalencia_id: string | null } {
  const i = clave.indexOf("|");
  const eq = clave.slice(i + 1);
  return { gml_id: clave.slice(0, i), equivalencia_id: eq === "" ? null : eq };
}

/** `"anual"` o la temporada: la llave de un vector de reparto. */
export type LlaveVector = Temporada | "anual";

// ─── Lo que devuelven las funciones SQL (`venta_marca_gml`) ───

export type HechoBarrer = { unidad_marca_id: string; gml_id: string; equivalencia_id: string | null; periodo: string; unidades: number };
export type TotalBarrer = { gml_id: string; equivalencia_id: string | null; periodo: string; unidades: number };
export type VentaMarcaGml = { hechos: HechoBarrer[]; totales: TotalBarrer[]; cargas: Record<string, string> };

// ─── Unidades `g` ───

/** Una `g` con lo que el análisis necesita: nombres, curva y factor del Niño por mes. Se arma en el servicio (lazy) o en los tests. */
export type UnidadG = {
  clave: ClaveG;
  gml_id: string;
  equivalencia_id: string | null;
  genero_id: string;
  mundo_id: string;
  linea_id: string;
  genero: string;
  mundo: string;
  linea: string;
  /** `GÉNERO · MUNDO · LÍNEA`, con ` › EQUIVALENCIA` si el nodo es GMLE. */
  ruta: string;
  nivel: "GML" | "GMLE";
  /** Curva de estacionalidad de la unidad (`curvaUnidad` de 02b), o `null` sin curva vigente. */
  curva: readonly number[] | null;
  curvaIncompleta: boolean;
  /** `φ_{anio,m}`: doce valores (enero primero); 1 fuera de los meses atípicos. */
  phi: (anio: number) => readonly number[];
  /** `true` si algún mes atípico del año no tiene factor (vale 1). */
  sinFactor: (anio: number) => boolean;
};

export type SerieG = {
  clave: ClaveG;
  gml_id: string;
  equivalencia_id: string | null;
  /** Unidades de la parte al barrer por mes. */
  u: Map<Mes, number>;
  /** Unidades de la parte específica (solo mixta). */
  e: Map<Mes, number>;
  /** Unidades totales de la `g` (todas las marcas). */
  U: Map<Mes, number>;
};

export type Alcance = { generos: ReadonlySet<string>; mundos: ReadonlySet<string>; lineas: ReadonlySet<string> };

export type DatosMarca = {
  id: string;
  nombre: string;
  modalidad: ModalidadBarrer;
  agrupacion_marca: string;
  agrupacion_marca_id: string;
  miembros: string[];
  /** Nodos con compras específicas vigentes (solo una mixta). */
  gml_especificos: { gml_id: string; ruta: string }[];
};

export type { Temporada, TemporadasConfig };
