import { anioDe, redondear } from "@/lib/curvas/anios";
import { claseDeAnio, type PeriodoParaClase } from "@/lib/curvas/atipicos";
import { UMBRAL_CORRECCION_NINO, type EstadoProyeccion, type SobreBase } from "@/lib/proyeccion/tipos-api";
import { valorDeBase } from "./referencias";
import type { BaseCrecimiento, CodigoCrecimientos, EstadoGM, MotivoObsoleto, ReferenciaApi, VarianteBase } from "./tipos-api";

/**
 * Reglas de negocio de 06d (ficha §5.2 y §3, «Validaciones del servidor») y de 06e (R12 a R14 y R25). Funciones PURAS: los handlers
 * las llaman y no las reimplementan. Sin base, sin HTTP, sin reloj.
 */

/** R-N: la nota es obligatoria si el % se aleja más de esto (en puntos) del valor de la base elegida. */
export const TOLERANCIA_NOTA_PP = 0.5;
/** Obsoleto por base movida: la base elegida se movió al menos esto (en puntos) frente a `base_valor`. */
export const UMBRAL_OBSOLETO_PP = 1;

export type RechazoCrecimiento = { status: 400 | 409; codigo: CodigoCrecimientos | "base_invalida"; mensaje: string };

// ─── 06e D7 · 2027 no es Niño ───

/**
 * Los meses (`aaaa-mm`) de `anio` marcados como atípicos para alguna de las temporadas dadas (las que el GM tiene con venta), ordenados y sin
 * repetir. Vacío = el año siguiente es normal.
 */
export function mesesAtipicosDelAnio(anio: number, periodos: readonly PeriodoParaClase[], temporadas: readonly ("invierno" | "verano")[]): string[] {
  const meses = new Set<string>();
  for (const temporada of temporadas) for (const m of claseDeAnio(anio, { temporada }, periodos, []).meses_atipicos) meses.add(m);
  return [...meses].sort();
}

export const mensajeAnioSiguienteAtipico = (anio: number): string =>
  `${anio} está marcado como año del Niño en Curvas → Periodos atípicos. Por ahora el crecimiento de ${anio} no incluye el Niño: si no lo habrá, quita la marca; si lo habrá, hay que decidir cómo modelarlo antes de aprobar.`;

/** `409 anio_siguiente_atipico` (D7, R25): no se aprueba un crecimiento de un año con meses atípicos marcados. Primer rechazo del `POST`. */
export function motivoRechazoAnioSiguienteAtipico(anio: number, meses: readonly string[]): RechazoCrecimiento | null {
  if (meses.length === 0) return null;
  return { status: 409, codigo: "anio_siguiente_atipico", mensaje: mensajeAnioSiguienteAtipico(anio) };
}

const r2 = (n: number) => redondear(n, 2);
const coma = (n: number) => String(r2(n)).replace(".", ",");
const nota = (n: string | null | undefined): string | null => {
  const t = n?.trim();
  return t ? t : null;
};

// ─── Año permitido, referencia y base (M3) ───

/** `{año del último mes cerrado + 1}` ∪ `{anio_en_curso + 1 de cada proyección en trabajo}`, ascendente y sin repetidos. */
export function aniosPermitidos(ultimoMesCerrado: string, proyecciones: readonly { estado: string; anio_en_curso: number }[]): number[] {
  const anios = new Set<number>([anioDe(ultimoMesCerrado) + 1]);
  for (const p of proyecciones) if (p.estado === "en_trabajo") anios.add(p.anio_en_curso + 1);
  return [...anios].sort((a, b) => a - b);
}

export function motivoRechazoAnio(anio: number, permitidos: readonly number[]): RechazoCrecimiento | null {
  if (permitidos.includes(anio)) return null;
  const lista = permitidos.join(" y ");
  return { status: 400, codigo: "anio_no_permitido", mensaje: `Solo se puede aprobar el crecimiento de ${lista}: ${anio} no corresponde a ninguna proyección en trabajo ni al año siguiente al último mes cerrado.` };
}

/** La proyección de referencia debe existir y ser del año anterior al de aplicación. */
export function motivoRechazoReferencia(proyeccion: { anio_en_curso: number } | null | undefined, anio: number): RechazoCrecimiento | null {
  if (proyeccion && proyeccion.anio_en_curso === anio - 1) return null;
  return { status: 400, codigo: "referencia_otro_anio", mensaje: `La proyección de referencia debe ser la de ${anio - 1}.` };
}

/** `anio_completo` exige un año `Y−1` o `Y−2` con datos (la referencia existe y se pudo calcular). */
export function motivoRechazoBaseAnio(base: { tipo: BaseCrecimiento; anio: number | null }, y: number, referencias: readonly ReferenciaApi[]): RechazoCrecimiento | null {
  if (base.tipo !== "anio_completo") return null;
  const ref = referencias.find((r) => r.tipo === "anio_completo" && r.anio === base.anio);
  if (base.anio !== null && (base.anio === y - 1 || base.anio === y - 2) && ref && ref.motivo_nulo !== "sin_venta") return null;
  return { status: 400, codigo: "base_invalida", mensaje: `La base de año completo debe ser ${y - 1} o ${y - 2}, con venta en ese año y en el anterior.` };
}

// ─── Géneros y mundos (regla 4) ───

export type EntradaGeneroMundo = {
  /** `gm` o `resto`. */
  alcance: "gm" | "resto";
  /** Ids de los géneros detallables (HOMBRE y MUJER, resueltos por nombre). */
  detallables: ReadonlySet<string>;
  genero_id: string | null;
  mundo_activo: boolean;
  /** El GM tiene filas base en alguna proyección en trabajo de `anio − 1` (I3). */
  con_filas_base_en_trabajo: boolean;
};

/**
 * Solo HOMBRE y MUJER (más el Resto) se aprueban. Un mundo inactivo no se aprueba, salvo que el GM tenga filas base en una
 * proyección en trabajo de `anio − 1`: esa proyección no podría cerrarse sin él (I3).
 */
export function motivoRechazoGeneroMundo(e: EntradaGeneroMundo): RechazoCrecimiento | null {
  if (e.alcance === "resto") return null;
  if (e.genero_id === null || !e.detallables.has(e.genero_id)) {
    return { status: 400, codigo: "genero_no_detallado", mensaje: "Solo se aprueba el crecimiento de HOMBRE y MUJER por mundo; los demás géneros siguen al Resto." };
  }
  if (!e.mundo_activo && !e.con_filas_base_en_trabajo) {
    return { status: 400, codigo: "mundo_inactivo", mensaje: "Ese mundo está desactivado y ninguna proyección en trabajo tiene filas de este género y mundo: no se puede aprobar su crecimiento." };
  }
  return null;
}

// ─── R-N (regla 2) ───

export type EntradaNota = {
  base_tipo: BaseCrecimiento;
  /** El % de la base elegida en su variante; `null` = sin base o no calculable. */
  base_valor: number | null;
  pct: number;
  /** 06e (R12): la variante elegida. Con `bruto` en un GM con Niño material cuyo periodo toca un año Niño, la nota es obligatoria. */
  variante?: VarianteBase;
  /** El periodo de la referencia elegida toca un año Niño del GM. */
  periodo_toca_nino?: boolean;
  /** El GM (o el Resto) tiene Niño material (`hay_nino`, D8). */
  hay_nino?: boolean;
};

/**
 * Por qué la nota es obligatoria, o `null` si no lo es: base `ninguna`, base no calculable, `|pct − base_valor| > 0,5` pp o (06e R12)
 * la variante `bruto` sobre una referencia cuyo periodo toca un año Niño material para el GM.
 */
export function motivoNotaObligatoria(e: EntradaNota): string | null {
  if (e.base_tipo === "ninguna") return "Sin una base elegida, explica en la nota de dónde sale el porcentaje.";
  if (e.base_valor === null) return "La base elegida no se pudo calcular: explica en la nota de dónde sale el porcentaje.";
  if (Math.abs(r2(e.pct - e.base_valor)) > TOLERANCIA_NOTA_PP) {
    return `Tu porcentaje difiere ${coma(Math.abs(e.pct - e.base_valor))} puntos de la base elegida (${coma(e.base_valor)} %): explica por qué en la nota.`;
  }
  if (e.variante === "bruto" && e.hay_nino === true && e.periodo_toca_nino === true) {
    return "Elegiste la base real en un género y mundo que tuvo Niño: el porcentaje se escribe sobre 2026 corregido, así que explica en la nota por qué usas la cifra real.";
  }
  return null;
}

export const notaObligatoria = (e: EntradaNota): boolean => motivoNotaObligatoria(e) !== null;

// ─── Sin cambio (regla 3) y rechazos del POST ───

export type VersionParaComparar = {
  version: number;
  pct: number;
  nota: string | null;
  base: { tipo: BaseCrecimiento; anio: number | null; variante: VarianteBase; valor: number | null };
  /** La vigente está obsoleta (regla 5): se puede refrescar con el mismo %. */
  obsoleta: boolean;
  /** 06e (R13): sobre qué se interpreta su %. Sin dato, `bruta` (versión de antes de `0.14.0`). */
  sobre_base?: SobreBase;
};

export type AprobacionNueva = {
  pct: number;
  nota: string | null;
  base: { tipo: BaseCrecimiento; anio: number | null; variante: VarianteBase; valor: number | null };
  /** 06e: toda aprobación nueva es `corregida`; sin dato se lee así. */
  sobre_base?: SobreBase;
};

const mismoValor = (a: number | null, b: number | null): boolean => (a === null || b === null ? a === b : r2(a) === r2(b));

/**
 * `sin_cambio` (M4, R13): coinciden `pct`, nota, `base.tipo`, `base.anio`, `base.variante`, `base_valor` (a 2 decimales) y `sobre_base` con
 * la vigente, y la vigente no está obsoleta. Una vigente obsoleta, con `base_valor` distinto o `bruta` se puede refrescar con el mismo %.
 */
export function esSinCambio(nueva: AprobacionNueva, vigente: VersionParaComparar | null): boolean {
  if (!vigente || vigente.obsoleta) return false;
  return (
    (nueva.sobre_base ?? "corregida") === (vigente.sobre_base ?? "bruta") &&
    mismoValor(nueva.pct, vigente.pct) &&
    nota(nueva.nota) === nota(vigente.nota) &&
    nueva.base.tipo === vigente.base.tipo &&
    nueva.base.anio === vigente.base.anio &&
    nueva.base.variante === vigente.base.variante &&
    mismoValor(nueva.base.valor, vigente.base.valor)
  );
}

/**
 * Orden de M6 después de `datos_cambiados` y de los `400` de género y mundo: `vigente_cambiada` · `sin_cambio` · `nota_requerida`.
 * `version_vigente` es la versión que vio el planner (`null` = «no había vigente»).
 */
export function motivoRechazoAprobar(args: {
  vigente: VersionParaComparar | null;
  version_vigente: number | null;
  nueva: AprobacionNueva;
  /** 06e (R12): lo que hace falta para la nota por variante `bruto`: si el periodo de la base toca un año Niño y si el GM tiene Niño material. */
  nota?: { periodo_toca_nino: boolean; hay_nino: boolean };
}): RechazoCrecimiento | null {
  const { vigente, nueva } = args;
  if ((vigente?.version ?? null) !== args.version_vigente) {
    return { status: 409, codigo: "vigente_cambiada", mensaje: "Otra persona aprobó un crecimiento para este género y mundo mientras tanto: vuelve a cargar." };
  }
  if (esSinCambio(nueva, vigente)) {
    return { status: 409, codigo: "sin_cambio", mensaje: `Es igual a la v${vigente?.version}: no se crea otra versión.` };
  }
  const motivo = motivoNotaObligatoria({ base_tipo: nueva.base.tipo, base_valor: nueva.base.valor, pct: nueva.pct, variante: nueva.base.variante, ...(args.nota ?? {}) });
  if (motivo !== null && nota(nueva.nota) === null) return { status: 409, codigo: "nota_requerida", mensaje: motivo };
  return null;
}

/** La versión que sigue: `max(version) + 1` de la clave (año, alcance, GM) contando todas las versiones. */
export function siguienteVersion(versiones: readonly { version: number }[]): number {
  return versiones.reduce((m, v) => Math.max(m, v.version), 0) + 1;
}

// ─── Obsolescencia (regla 5 y R14): solo informativa ───

export type VigenteParaObsolescencia = {
  base: { tipo: BaseCrecimiento; anio: number | null; variante: VarianteBase; valor: number | null };
  /** `referencia.gml_ids` de la foto. */
  gml_ids: readonly string[];
  /** 06e: sobre qué se interpreta su %. Sin dato, `bruta`. */
  sobre_base?: SobreBase;
};

/** Lo de hoy que decide R14: si el GM tiene Niño material y qué pasó con los factores de `Y` de la foto. */
export type ContextoObsolescencia = {
  hay_nino?: boolean;
  /**
   * Los factores de `Y` de la foto contra el efectivo de hoy: `cambiaron` si alguno es distinto y `variacion` es `|K'_M(φ hoy) ÷ K'_M(φ foto) − 1|`
   * como fracción (`null` si no se pudo calcular).
   */
  factores?: { cambiaron: boolean; variacion: number | null };
};

/**
 * Por qué una vigente está obsoleta, o `null`. Nunca cambia la vigente ni las proyecciones. En este orden (R14):
 *   - `metodo_anterior`: la vigente es `bruta` (de antes de `0.14.0`) y el GM tiene Niño material: hay que reaprobarla sobre corregido;
 *   - `composicion`: algún nodo de la foto ya no pertenece al GM (los que entran no cuentan);
 *   - `factor_cambiado`: algún factor de `Y` de la foto ≠ el de hoy **y** `K'_M` se mueve ≥ 0,5 % (M3);
 *   - `base_no_calculable`: la base elegida ya no se puede calcular;
 *   - `base_movida`: la base elegida se movió ≥ 1,0 pp frente a `base_valor`. No aplica a `aplicado_hoy`, que se refiere a sí misma.
 * Una versión `bruta` con base heredada (de `0.12.1`/`0.13.x`) sin Niño material solo puede estar obsoleta por `composicion`: su base se calculó con
 * la 06d y ya no existe. Las demás se comparan como siempre; `factor_cambiado` solo aplica a las `corregida` (su foto trae los factores).
 */
export function evaluarObsoleto(v: VigenteParaObsolescencia, referencias: readonly ReferenciaApi[], gmlActuales: ReadonlySet<string>, contexto: ContextoObsolescencia = {}): MotivoObsoleto | null {
  const bruta = (v.sobre_base ?? "bruta") === "bruta";
  if (bruta && contexto.hay_nino === true) return "metodo_anterior";
  if (v.gml_ids.some((id) => !gmlActuales.has(id))) return "composicion";
  // Una versión `bruta` con base heredada (`cierre_proyectado`, `sin_nino_mas_rebote`) ya no se puede comparar: se lee con su base original.
  if (bruta && (v.base.tipo === "cierre_proyectado" || v.base.variante === "sin_nino_mas_rebote")) return null;
  const f = contexto.factores;
  if (!bruta && f?.cambiaron === true && (f.variacion === null || f.variacion >= UMBRAL_CORRECCION_NINO - 1e-12)) return "factor_cambiado";
  if (v.base.tipo === "ninguna") return null;
  const ref = referencias.find((r) => r.tipo === v.base.tipo && (v.base.tipo !== "anio_completo" || r.anio === v.base.anio));
  const ahora = valorDeBase(ref, v.base.variante);
  if (ahora === null) return "base_no_calculable";
  if (v.base.tipo !== "aplicado_hoy" && v.base.valor !== null && Math.abs(ahora - v.base.valor) >= UMBRAL_OBSOLETO_PP - 1e-9) return "base_movida";
  return null;
}

export function estadoDeGM(tieneVigente: boolean, motivoObsoleto: MotivoObsoleto | null): EstadoGM {
  if (!tieneVigente) return "sin_aprobar";
  return motivoObsoleto === null ? "aprobado" : "obsoleto";
}

// ─── Proyección de referencia ───

/** Estados de proyección que se ofrecen como referencia (una archivada no). */
export const ESTADOS_REFERENCIA: readonly EstadoProyeccion[] = ["en_trabajo", "cerrada"];

type CandidataReferencia = { id: string; estado: string; anio_en_curso: number; calculado_at: string | null; version_metodo: number | null };

/**
 * La proyección de referencia por defecto (I1): solo método ≥ `versionMetodoMin` (5 desde 06e) y calculada; la en trabajo de `anio − 1` con el `calculado_at` más
 * reciente o, si no hay, la cerrada.
 */
export function referenciaPorDefecto(proyecciones: readonly CandidataReferencia[], anio: number, versionMetodoMin: number): CandidataReferencia | null {
  const validas = proyecciones.filter((p) => p.anio_en_curso === anio - 1 && p.calculado_at !== null && (p.version_metodo ?? 0) >= versionMetodoMin);
  const masReciente = (xs: CandidataReferencia[]) =>
    [...xs].sort((a, b) => ((b.calculado_at as string) < (a.calculado_at as string) ? -1 : (b.calculado_at as string) > (a.calculado_at as string) ? 1 : a.id < b.id ? -1 : 1))[0] ?? null;
  return masReciente(validas.filter((p) => p.estado === "en_trabajo")) ?? masReciente(validas.filter((p) => p.estado === "cerrada"));
}
