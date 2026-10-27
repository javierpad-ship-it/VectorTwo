import { anioDe, redondear } from "@/lib/curvas/anios";
import type { EstadoProyeccion } from "@/lib/proyeccion/tipos-api";
import { valorDeBase } from "./referencias";
import type { BaseCrecimiento, CodigoCrecimientos, EstadoGM, MotivoObsoleto, ReferenciaApi, VarianteBase } from "./tipos-api";

/**
 * Reglas de negocio de 06d (ficha §5.2 y §3, «Validaciones del servidor»). Funciones PURAS: los handlers las llaman y no las
 * reimplementan. Sin base, sin HTTP, sin reloj.
 */

/** R-N: la nota es obligatoria si el % se aleja más de esto (en puntos) del valor de la base elegida. */
export const TOLERANCIA_NOTA_PP = 0.5;
/** Obsoleto por base movida: la base elegida se movió al menos esto (en puntos) frente a `base_valor`. */
export const UMBRAL_OBSOLETO_PP = 1;

export type RechazoCrecimiento = { status: 400 | 409; codigo: CodigoCrecimientos | "base_invalida"; mensaje: string };

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
  /** Bruto-equivalente de la base elegida; `null` = sin base o no calculable. */
  base_valor: number | null;
  pct: number;
};

/** Por qué la nota es obligatoria, o `null` si no lo es: base `ninguna`, base no calculable o `|pct − base_valor| > 0,5` pp. */
export function motivoNotaObligatoria(e: EntradaNota): string | null {
  if (e.base_tipo === "ninguna") return "Sin una base elegida, explica en la nota de dónde sale el porcentaje.";
  if (e.base_valor === null) return "La base elegida no se pudo calcular: explica en la nota de dónde sale el porcentaje.";
  if (Math.abs(r2(e.pct - e.base_valor)) > TOLERANCIA_NOTA_PP) {
    return `Tu porcentaje difiere ${coma(Math.abs(e.pct - e.base_valor))} puntos de la base elegida (${coma(e.base_valor)} %): explica por qué en la nota.`;
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
};

export type AprobacionNueva = {
  pct: number;
  nota: string | null;
  base: { tipo: BaseCrecimiento; anio: number | null; variante: VarianteBase; valor: number | null };
};

const mismoValor = (a: number | null, b: number | null): boolean => (a === null || b === null ? a === b : r2(a) === r2(b));

/**
 * `sin_cambio` (M4): coinciden `pct`, nota, `base.tipo`, `base.anio`, `base.variante` y `base_valor` (a 2 decimales) con la vigente, y
 * la vigente no está obsoleta. Una vigente obsoleta o con `base_valor` distinto se puede refrescar con el mismo %.
 */
export function esSinCambio(nueva: AprobacionNueva, vigente: VersionParaComparar | null): boolean {
  if (!vigente || vigente.obsoleta) return false;
  return (
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
export function motivoRechazoAprobar(args: { vigente: VersionParaComparar | null; version_vigente: number | null; nueva: AprobacionNueva }): RechazoCrecimiento | null {
  const { vigente, nueva } = args;
  if ((vigente?.version ?? null) !== args.version_vigente) {
    return { status: 409, codigo: "vigente_cambiada", mensaje: "Otra persona aprobó un crecimiento para este género y mundo mientras tanto: vuelve a cargar." };
  }
  if (esSinCambio(nueva, vigente)) {
    return { status: 409, codigo: "sin_cambio", mensaje: `Es igual a la v${vigente?.version}: no se crea otra versión.` };
  }
  const motivo = motivoNotaObligatoria({ base_tipo: nueva.base.tipo, base_valor: nueva.base.valor, pct: nueva.pct });
  if (motivo !== null && nota(nueva.nota) === null) return { status: 409, codigo: "nota_requerida", mensaje: motivo };
  return null;
}

/** La versión que sigue: `max(version) + 1` de la clave (año, alcance, GM) contando todas las versiones. */
export function siguienteVersion(versiones: readonly { version: number }[]): number {
  return versiones.reduce((m, v) => Math.max(m, v.version), 0) + 1;
}

// ─── Obsolescencia (regla 5): solo informativa ───

export type VigenteParaObsolescencia = {
  base: { tipo: BaseCrecimiento; anio: number | null; variante: VarianteBase; valor: number | null };
  /** `referencia.gml_ids` de la foto. */
  gml_ids: readonly string[];
};

/**
 * Por qué una vigente está obsoleta, o `null`. Nunca cambia la vigente ni las proyecciones.
 *   - `composicion`: algún nodo de la foto ya no pertenece al GM (los que entran no cuentan);
 *   - `base_no_calculable`: la base elegida ya no se puede calcular;
 *   - `base_movida`: la base elegida se movió ≥ 1,0 pp frente a `base_valor`. No aplica a `aplicado_hoy`, que se refiere a sí misma.
 */
export function evaluarObsoleto(v: VigenteParaObsolescencia, referencias: readonly ReferenciaApi[], gmlActuales: ReadonlySet<string>): MotivoObsoleto | null {
  if (v.gml_ids.some((id) => !gmlActuales.has(id))) return "composicion";
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
 * La proyección de referencia por defecto (I1): solo método ≥ 4 y calculada; la en trabajo de `anio − 1` con el `calculado_at` más
 * reciente o, si no hay, la cerrada.
 */
export function referenciaPorDefecto(proyecciones: readonly CandidataReferencia[], anio: number, versionMetodoMin: number): CandidataReferencia | null {
  const validas = proyecciones.filter((p) => p.anio_en_curso === anio - 1 && p.calculado_at !== null && (p.version_metodo ?? 0) >= versionMetodoMin);
  const masReciente = (xs: CandidataReferencia[]) =>
    [...xs].sort((a, b) => ((b.calculado_at as string) < (a.calculado_at as string) ? -1 : (b.calculado_at as string) > (a.calculado_at as string) ? 1 : a.id < b.id ? -1 : 1))[0] ?? null;
  return masReciente(validas.filter((p) => p.estado === "en_trabajo")) ?? masReciente(validas.filter((p) => p.estado === "cerrada"));
}
