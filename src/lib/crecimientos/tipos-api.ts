import type { DiagnosticoFactorApi, EstadoFactorY, EstadoProyeccion, SobreBase, TemporadaFactor } from "@/lib/proyeccion/tipos-api";
import { GENEROS_MATRIZ, SOBRE_BASE } from "@/lib/proyeccion/tipos-api";

/**
 * Contratos de 06d (docs/modulos/06d-curva-y-crecimiento-por-genero-mundo.md, §3): crecimiento del año siguiente por género × mundo
 * (GM), global y versionado. Autocontenido: lo usan igual el servidor y la pantalla. Sin imports de `@supabase/*`, de React ni de Next.
 * Todo en unidades. Desde `0.14.0` (ficha 06e) un % nuevo es «sobre `Y` corregido del Niño» de las mismas tiendas de `Y+1`
 * (`sobre_base = 'corregida'`); las versiones de antes son `bruta` (`Y+1 ÷ Y real − 1`) y se leen tal cual.
 */

export { SOBRE_BASE };
export type { SobreBase };

/** Géneros que se aprueban por GM: solo HOMBRE y MUJER (resueltos por nombre con `generosDeMatriz`). Los demás siguen al Resto. */
export const GENEROS_DETALLADOS: readonly string[] = GENEROS_MATRIZ;

export const MAX_NOTA_CRECIMIENTO = 300;
export const MAX_HUELLA_DATOS = 128;
/** Segmento de ruta (`/api/curvas/genero-mundo/resto`) y `clave` del Resto. Un GM es `<genero_id>.<mundo_id>`. */
export const CLAVE_RESTO = "resto";

export const ALCANCES_CRECIMIENTO = ["gm", "resto"] as const;
export type AlcanceCrecimiento = (typeof ALCANCES_CRECIMIENTO)[number];

export const ESTADOS_VERSION_CRECIMIENTO = ["vigente", "reemplazada", "retirada"] as const;
export type EstadoVersionCrecimiento = (typeof ESTADOS_VERSION_CRECIMIENTO)[number];

/**
 * De dónde sale la base del % aprobado (lectura: incluye la heredada `cierre_proyectado`, de versiones de `0.12.1`/`0.13.x`). `ninguna` =
 * el planner escribió el % sin apoyarse en una referencia.
 */
export const BASES_CRECIMIENTO = ["acumulado", "cierre_curva", "cierre_proyectado", "anio_completo", "aplicado_hoy", "ninguna"] as const;
export type BaseCrecimiento = (typeof BASES_CRECIMIENTO)[number];
/** Las bases que acepta el `POST` desde `0.14.0` (`cierre_proyectado` se retira: `400 base_retirada`). */
export const BASES_APROBABLES = ["acumulado", "cierre_curva", "anio_completo", "aplicado_hoy", "ninguna"] as const;
export type BaseAprobable = (typeof BASES_APROBABLES)[number];
/** Las referencias que se calculan (todas las bases menos `ninguna`). */
export type TipoReferencia = Exclude<BaseCrecimiento, "ninguna">;

/** Lectura: `sin_nino_mas_rebote` solo existe en versiones de `0.12.1`/`0.13.x`. */
export const VARIANTES_BASE = ["corregido", "bruto", "sin_nino_mas_rebote"] as const;
export type VarianteBase = (typeof VARIANTES_BASE)[number];
export const VARIANTES_APROBABLES = ["corregido", "bruto"] as const;
export type VarianteAprobable = (typeof VARIANTES_APROBABLES)[number];

/** Códigos de error (`codigo` de `{ error, codigo }`) de las rutas de 06d. */
export const CODIGOS_CRECIMIENTOS = [
  "sin_datos",
  "clave_invalida",
  "anio_no_permitido",
  "referencia_otro_anio",
  "genero_no_detallado",
  "mundo_inactivo",
  "datos_cambiados",
  "vigente_cambiada",
  "sin_cambio",
  "nota_requerida",
  "base_retirada",
  "anio_siguiente_atipico",
] as const;
export type CodigoCrecimientos = (typeof CODIGOS_CRECIMIENTOS)[number];

/** Una versión aprobada (una fila de `crecimientos_genero_mundo`). */
export type VersionCrecimientoApi = {
  id: string;
  version: number;
  estado: EstadoVersionCrecimiento;
  pct: number;
  nota: string | null;
  base: { tipo: BaseCrecimiento; anio: number | null; variante: VarianteBase; valor: number | null };
  /** `0.14.0`: sobre qué se interpreta `pct`. Una versión sin el dato (de antes de `0.14.0`) es `bruta`. */
  sobre_base?: SobreBase;
  /** `0.14.0`: lo mismo que `pct` expresado sobre 2026 real, con la base de la referencia o, sin ella, la base por curva sobre `M(Y+1)`. */
  equivalente_real?: number | null;
  por_nombre: string | null;
  /** ISO. */
  aprobada_at: string;
  proyeccion_referencia: { id: string; nombre: string } | null;
};

/** Por qué una cifra de referencia es `null`. `sin_curva` y `meses_faltantes` desde `0.14.0` (cierre por curva). */
export type MotivoNuloReferencia = "sin_referencia" | "metodo_anterior" | "sin_base" | "denominador_cero" | "sin_venta" | "sin_curva" | "meses_faltantes";

/**
 * Una referencia de «Cómo crece» (§5.1). `anio` es el año `Z` que mide: `Y` en acumulado, cierre proyectado y aplicado hoy; el año
 * completo en `anio_completo`. `periodo` es el texto del tramo comparado («ene–set 2026 frente a ene–set 2025»).
 */
export type ReferenciaApi = {
  tipo: TipoReferencia;
  anio: number;
  /** Variante con que se precarga el % al elegir esta base (`sin_nino_mas_rebote` en año Niño, `bruto` si no). */
  variante_defecto: VarianteBase;
  etiqueta: string;
  periodo: string;
  tiendas: number;
  anterior: number | null;
  actual: number | null;
  pct_bruto: number | null;
  pct_sin_nino: number | null;
  /**
   * Lo que significa para `Y+1`. Desde `0.14.0`, `corregido` es el % que se escribiría sobre 2026 corregido del Niño y `sin_nino_mas_rebote`
   * es siempre `null` (la variante desaparece). `corregido` es opcional para leer referencias armadas por `0.13.x`.
   */
  equivalente: { corregido?: number | null; bruto: number | null; sin_nino_mas_rebote: number | null };
  /** Menos de 3 tiendas o menos de 120 u. en el periodo anterior. Solo marca. */
  fragil: boolean;
  /** `|pct_bruto| > 50`. Solo marca. */
  extremo: boolean;
  tienda_mayor: { codigo: string; aporte_pct: number; pct_sin_ella: number | null } | null;
  /** Solo en acumulado: ene–`k` ÷ año completo de `Y−1`, sobre `C(Y)`. */
  cobertura_pct: number | null;
  motivo_nulo: MotivoNuloReferencia | null;
};

export type EstadoGM = "sin_aprobar" | "aprobado" | "obsoleto";
export type MotivoObsoleto = "base_movida" | "base_no_calculable" | "composicion" | "factor_cambiado" | "metodo_anterior";

/**
 * Una fila de la lista. El Resto va aparte (`ListaGeneroMundoApi.resto`) con `clave = "resto"`, `genero` y `mundo` en `null`,
 * `detallable = true` y `mundo_activo = true`.
 */
export type FilaGMApi = {
  /** `<genero_id>.<mundo_id>` o `resto`. */
  clave: string;
  genero: string | null;
  mundo: string | null;
  /** HOMBRE o MUJER (o el Resto): se puede aprobar. Los demás géneros «siguen al Resto». */
  detallable: boolean;
  mundo_activo: boolean;
  /** Unidades de `Y−1` de las mismas tiendas (u. 2025 en el ejemplo). */
  unidades_anterior: number | null;
  acumulado: ReferenciaApi;
  aplicado_hoy: ReferenciaApi;
  /** `Σ B` de las filas base de `Y+1` de la proyección de referencia. */
  base_siguiente: number | null;
  vigente: VersionCrecimientoApi | null;
  estado: EstadoGM;
  motivo_obsoleto: MotivoObsoleto | null;
  sigue: "propio" | "resto";
  /** `0.14.0` (06e §3.1): cierre del año en curso por curva, base corregida del Niño y si el GM tiene Niño material. */
  cierre?: CierreGMApi;
  /** `Σ B'` de la referencia (≥ 5); `null` sin ella. */
  base_corregida?: number | null;
  /** `Σ B' ÷ Σ B − 1` en %. */
  correccion_nino_pct?: number | null;
  hay_nino?: boolean;
  /** M8: filas base con `B` nulo y su venta de `Y`, de la proyección de referencia. */
  fuera_base?: { filas: number; unidades: number } | null;
};

export type ProyeccionReferenciaApi = {
  id: string;
  nombre: string;
  calculado_at: string | null;
  version_metodo: number | null;
};

export type ListaGeneroMundoApi = {
  anio_aplicacion: number;
  anios_permitidos: number[];
  anio_en_curso: number;
  /** `aaaa-mm`. */
  ultimo_mes_cerrado: string;
  proyeccion_referencia: ProyeccionReferenciaApi | null;
  /** Las proyecciones de `anio_aplicacion − 1` que se pueden elegir como referencia. */
  proyecciones_disponibles: (ProyeccionReferenciaApi & { estado: EstadoProyeccion })[];
  filas: FilaGMApi[];
  resto: FilaGMApi;
  /** Ponderado por `B`; un GM sin aprobar pondera con el Resto que seguiría. `null` sin proyección de referencia válida. */
  total: { pct_ponderado: number | null; base: number; sin_aprobar: number };
  /** Bloqueo optimista: se devuelve tal cual en el `POST`. */
  huella_datos: string;
  /** `0.14.0` (D7): `Y+1` tiene meses atípicos marcados: aprobar y cerrar se bloquean. `null` si no. */
  anio_siguiente_atipico?: { meses: string[] } | null;
};

/** Origen de un mes de una serie: venta real publicada o proyección de la referencia; `null` = sin dato. */
export type OrigenMesGM = "real" | "proyectado" | null;

/** Un año de la curva de venta de un GM. Los arreglos mensuales tienen 12 posiciones (enero a diciembre). */
export type SerieAnioGMApi = {
  anio: number;
  meses: (number | null)[];
  meses_sin_nino: (number | null)[];
  origen: OrigenMesGM[];
  /** Algún mes sin dato o proyectado: el total no es de un año completo real. */
  incompleto: boolean;
  total: number;
  total_sin_nino: number;
  /** Participación mensual en % del total del año. */
  forma: (number | null)[];
};

// ─── 0.14.0 · 06e: cierre del año en curso por curva ───

/** Cierre del GM por curva sobre `C(Y)` (las tiendas del %) y la base por curva sobre `M(Y+1)` (las tiendas de `Y+1`). `K`/`K'` = real/corregido. */
export type CierreGMApi = {
  k: number | null;
  tiendas: number;
  vendido: number;
  vendido_corregido: number;
  cierre: number | null;
  cierre_corregido: number | null;
  anterior: number | null;
  anterior_corregido: number | null;
  pct: number | null;
  pct_corregido: number | null;
  base_curva: { tiendas: number; tiendas_fuera_cy: string[]; real: number | null; corregida: number | null } | null;
  avance: number | null;
  avance_bajo: boolean;
  agrupaciones_avance_bajo: string[];
  /** % del vendido corregido cerrado con la curva compuesta del GM (agrupaciones sin curva). */
  sin_curva_pct: number | null;
  hay_nino: boolean;
  /** `K'_M ÷ K_M − 1` en %. */
  correccion_curva_pct: number | null;
  factor_parcial: boolean;
  sin_factor: boolean;
  motivo_nulo: MotivoNuloReferencia | null;
};

export type CierreAgrupacionApi = {
  agrupacion_id: string | null;
  nombre: string;
  temporada: string;
  /** `null` = sin curva vigente: se cerró con la compuesta. */
  curva: { id: string; version: number } | null;
  avance: number | null;
  avance_bajo: boolean;
  vendido: number;
  factor_meses: number[];
  vendido_corregido: number;
  cierre: number | null;
  cierre_corregido: number | null;
  base_curva: number | null;
  base_curva_corregida: number | null;
  /** Doce posiciones, `C(Y)`; los meses `≤ k` son reales. */
  meses: (number | null)[];
  meses_corregidos: (number | null)[];
};

/** Un factor de `Y` que toca al GM (lectura de `factores_volumen_atipico`). */
export type FactorYApi = {
  anio: number;
  temporada: TemporadaFactor;
  efectivo: number | null;
  origen: "aplicado" | "calculado" | null;
  ratio_volumen: number | null;
  ratio_control: number | null;
  ratio_calculado: number | null;
  ratio_aplicado: number | null;
  meses_periodo: number;
  meses_periodo_con_dato: number;
  parcial: boolean;
  estado: EstadoFactorY;
  diagnostico: DiagnosticoFactorApi | null;
};

/** «Cómo crece el verano atípicamente» solo con las agrupaciones de verano del GM, sobre `C(Y)` (informativo). */
export type DiagnosticoVeranoGMApi = {
  meses: { m: number; en_periodo: boolean; u: number; u_ref: number; ratio: number | null; control: number | null }[];
  ratio_fuera: number | null;
  exceso_propio: number | null;
  exceso_red: number | null;
  meses_periodo_con_dato: number;
} | null;

/** Impacto de reaprobar una versión `bruta` en un GM con Niño material (I3); `null` si no aplica. */
export type ReaprobarApi = {
  /** Dos decimales. */
  pct_equivalente: number;
  total_antes: number;
  total_despues: number;
  filas_suben: number;
  filas_bajan: number;
  unidades_movidas: number;
  decididas_con_propuesta_cambio: number;
} | null;

export type BandaNinoApi = {
  anio: number;
  temporada: TemporadaFactor;
  /** Números de mes (1 a 12) de la banda. */
  meses: number[];
  factor: number | null;
  /** El factor del año en curso cubre solo ene–`k` («factor parcial»). */
  parcial: boolean;
};

export type AvisoGMApi = { codigo: string; mensaje: string; detalle?: string[] };

export type DetalleGeneroMundoApi = FilaGMApi & {
  tiendas: { n: number; ids: string[]; fuera: { tienda_id: string; motivo: string }[] };
  series: SerieAnioGMApi[];
  /** Promedio de las participaciones de los años completos normales; `null` si no hay ninguno. */
  forma_tipica: number[] | null;
  bandas_nino: BandaNinoApi[];
  factores_parciales: boolean;
  referencias: ReferenciaApi[];
  rebote_nino_pct: number | null;
  versiones: VersionCrecimientoApi[];
  avisos: AvisoGMApi[];
  huella_datos: string;
  /** `0.14.0` (06e §3.1). */
  cierre_por_agrupacion?: CierreAgrupacionApi[];
  /** Solo si `hay_nino`. */
  serie_corregida?: SerieAnioGMApi | null;
  /** Base 2027 por curva sobre `M(Y+1)`, para la vista previa. */
  serie_base_curva?: { real: number[]; corregida: number[] } | null;
  factores_y?: FactorYApi[];
  diagnostico_verano_gm?: DiagnosticoVeranoGMApi;
  /** Informativo: la cifra de la proyección de referencia de método 5. */
  cierre_proyeccion?: { nombre: string; base: number; base_corregida: number } | null;
  reaprobar?: ReaprobarApi;
};

/** `data` del `201` del `POST /api/curvas/genero-mundo/[clave]`. */
export type RespuestaAprobarCrecimientoApi = {
  vigente: VersionCrecimientoApi;
  /** Las proyecciones en trabajo de `anio − 1` (toda versión nueva cambia su huella). */
  proyecciones_desactualizadas: { id: string; nombre: string }[];
};
