import type { EstadoProyeccion, TemporadaFactor } from "@/lib/proyeccion/tipos-api";
import { GENEROS_MATRIZ } from "@/lib/proyeccion/tipos-api";

/**
 * Contratos de 06d (docs/modulos/06d-curva-y-crecimiento-por-genero-mundo.md, §3): crecimiento del año siguiente por género × mundo
 * (GM), global y versionado. Autocontenido: lo usan igual el servidor y la pantalla. Sin imports de `@supabase/*`, de React ni de Next.
 * Todo en unidades; los % son BRUTOS (`Y+1 ÷ Y − 1` de las mismas tiendas de `Y+1`, sin corregir por el Niño).
 */

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

/** De dónde sale la base del % aprobado. `ninguna` = el planner escribió el % sin apoyarse en una referencia. */
export const BASES_CRECIMIENTO = ["acumulado", "cierre_proyectado", "anio_completo", "aplicado_hoy", "ninguna"] as const;
export type BaseCrecimiento = (typeof BASES_CRECIMIENTO)[number];
/** Las referencias que se calculan (todas las bases menos `ninguna`). */
export type TipoReferencia = Exclude<BaseCrecimiento, "ninguna">;

export const VARIANTES_BASE = ["bruto", "sin_nino_mas_rebote"] as const;
export type VarianteBase = (typeof VARIANTES_BASE)[number];

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
  por_nombre: string | null;
  /** ISO. */
  aprobada_at: string;
  proyeccion_referencia: { id: string; nombre: string } | null;
};

/** Por qué una cifra de referencia es `null`. */
export type MotivoNuloReferencia = "sin_referencia" | "metodo_anterior" | "sin_base" | "denominador_cero" | "sin_venta";

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
  /** Lo que significa para `Y+1`; `sin_nino_mas_rebote` es `null` sin rebote (sin proyección de referencia válida). */
  equivalente: { bruto: number | null; sin_nino_mas_rebote: number | null };
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
export type MotivoObsoleto = "base_movida" | "base_no_calculable" | "composicion";

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
};

/** `data` del `201` del `POST /api/curvas/genero-mundo/[clave]`. */
export type RespuestaAprobarCrecimientoApi = {
  vigente: VersionCrecimientoApi;
  /** Las proyecciones en trabajo de `anio − 1` (toda versión nueva cambia su huella). */
  proyecciones_desactualizadas: { id: string; nombre: string }[];
};
