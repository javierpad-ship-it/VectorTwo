import type { Json, Tables, TablesInsert } from "@/lib/supabase/database.types";
import { curvaAcumulada, normalizarCurva } from "./anios";
import { difiereDeVigente, eatEntreCurvas } from "./obsolescencia";
import {
  MODELOS_CURVA,
  type AgrupacionResultado,
  type ComparadorApi,
  type CurvaAprobadaApi,
  type CurvaVigenteApi,
  type HuellasCurva,
  type ModeloCurva,
  type ResumenCorrida,
  type TemporadaResultado,
  type VigenteResumenApi,
} from "./tipos-api";

/**
 * Reglas de negocio de elegir, retirar y marcar la referencia (docs/modulos/06-curvas-estacionalidad.md,
 * reglas 26 a 28). Funciones puras: el handler las llama y no las reimplementa.
 */

export const MENSAJE_AGRUPACION_NO_ENCONTRADA = "Agrupación de estacionalidad no encontrada.";
export const MENSAJE_CORRIDA_NO_ENCONTRADA = "Corrida no encontrada.";

export type RechazoElegir = { status: 404 | 409; mensaje: string; codigo: string };

export function esModeloCurva(valor: unknown): valor is ModeloCurva {
  return typeof valor === "string" && (MODELOS_CURVA as readonly string[]).includes(valor);
}

/** `p01 … p12` de una fila de `curvas_estacionalidad`, en orden. */
export function curvaDeFila(fila: Pick<Tables<"curvas_estacionalidad">, "p01" | "p02" | "p03" | "p04" | "p05" | "p06" | "p07" | "p08" | "p09" | "p10" | "p11" | "p12">): number[] {
  return [fila.p01, fila.p02, fila.p03, fila.p04, fila.p05, fila.p06, fila.p07, fila.p08, fila.p09, fila.p10, fila.p11, fila.p12].map(Number);
}

/**
 * Regla 26. Por qué NO se puede elegir una candidata, o `null` si se puede:
 * agrupación inexistente → `404`; corrida inexistente → `404`; agrupación
 * inactiva → `409`; candidata no disponible (la agrupación no está en la corrida,
 * la candidata no tiene curva o, para `T`, su temporada no tiene curva en esa
 * corrida) → `409 candidata_no_disponible`; misma corrida y modelo que la
 * vigente → `409 sin_cambio`.
 */
export function motivoRechazoElegir(
  agrupacion: { id: string; activo: boolean } | null,
  corrida: { id: string; resultado: { agrupaciones: readonly AgrupacionResultado[]; temporadas: readonly TemporadaResultado[] } } | null,
  modelo: ModeloCurva,
  vigente: { corrida_id: string; modelo: string } | null = null
): RechazoElegir | null {
  if (!agrupacion) return { status: 404, mensaje: MENSAJE_AGRUPACION_NO_ENCONTRADA, codigo: "agrupacion_no_encontrada" };
  if (!corrida) return { status: 404, mensaje: MENSAJE_CORRIDA_NO_ENCONTRADA, codigo: "corrida_no_encontrada" };
  if (!agrupacion.activo) {
    return { status: 409, mensaje: "La agrupación está inactiva: actívala antes de aprobarle una curva.", codigo: "agrupacion_inactiva" };
  }
  const delResultado = corrida.resultado.agrupaciones.find((a) => a.agrupacion_id === agrupacion.id);
  const noDisponible: RechazoElegir = {
    status: 409,
    mensaje: "Esa candidata no está disponible para esta agrupación en la corrida elegida.",
    codigo: "candidata_no_disponible",
  };
  if (!delResultado) return noDisponible;
  if (modelo === "T") {
    const temporada = corrida.resultado.temporadas.find((t) => t.temporada === delResultado.temporada);
    if (!temporada?.curva_T) return noDisponible;
  } else {
    const candidata = delResultado.candidatas.find((c) => c.modelo === modelo);
    if (!candidata?.curva) return noDisponible;
  }
  if (vigente && vigente.corrida_id === corrida.id && vigente.modelo === modelo) {
    return { status: 409, mensaje: "Esa curva ya es la vigente de la agrupación.", codigo: "sin_cambio" };
  }
  return null;
}

/** `md5(resumen.cargas)` ya calculado por quien llama: lo que va en `cargas_huella`. */
export type EntradaFilaCurva = {
  agrupacion: AgrupacionResultado;
  temporada: TemporadaResultado | null;
  modelo: ModeloCurva;
  corrida_id: string;
  resumen: Pick<ResumenCorrida, "red_huella">;
  cargas_huella: string;
  /** Última versión existente de la agrupación (0 si no hay). */
  version_anterior: number;
  perfil: { id: string | null; nombre: string | null };
  nota?: string | null;
};

/** Redondeo a dos decimales de las columnas `numeric(6,2)`. */
const a2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Regla 27. Fila de `curvas_estacionalidad` para la candidata elegida: copia la
 * curva (la `T` de la temporada), `recomendada = (modelo === recomendada)`,
 * `origen = prestada` si es `T`, `medida = 'unidades'`, `eat` y `error_max`
 * (nulos para `T`), `anios_utilizados` con los años y las tres huellas, y
 * `version = anterior + 1`. Devuelve `null` si la curva no existe.
 */
export function filaCurva(e: EntradaFilaCurva): TablesInsert<"curvas_estacionalidad"> | null {
  let curva: number[] | null;
  let eat: number | null = null;
  let errorMax: number | null = null;
  if (e.modelo === "T") {
    curva = e.temporada?.curva_T ?? null;
  } else {
    const candidata = e.agrupacion.candidatas.find((c) => c.modelo === e.modelo);
    curva = candidata?.curva ?? null;
    eat = candidata?.eat ?? null;
    errorMax = candidata?.error_max ?? null;
  }
  if (!curva || curva.length !== 12) return null;
  const c = normalizarCurva(curva);

  const aniosUtilizados: Json = {
    anios: e.agrupacion.anios.map((a) => ({ anio: a.anio, clase: a.clase, tratamiento: a.tratamiento, en_ajuste: a.en_ajuste })),
    composicion: { equivalencias: e.agrupacion.composicion.equivalencias, huella: e.agrupacion.composicion.huella },
    red_huella: e.resumen.red_huella,
    cargas_huella: e.cargas_huella,
    temporada: e.agrupacion.temporada,
  };

  return {
    agrupacion_estacionalidad_id: e.agrupacion.agrupacion_id,
    version: e.version_anterior + 1,
    estado: "vigente",
    corrida_id: e.corrida_id,
    modelo: e.modelo,
    origen: e.modelo === "T" ? "prestada" : "propia",
    recomendada: e.modelo === e.agrupacion.recomendada,
    eat: eat === null ? null : a2(eat),
    error_max: errorMax === null ? null : a2(errorMax),
    anios_utilizados: aniosUtilizados,
    p01: c[0],
    p02: c[1],
    p03: c[2],
    p04: c[3],
    p05: c[4],
    p06: c[5],
    p07: c[6],
    p08: c[7],
    p09: c[8],
    p10: c[9],
    p11: c[10],
    p12: c[11],
    medida: "unidades",
    perfil_id: e.perfil.id,
    usuario_nombre: e.perfil.nombre,
    nota: e.nota && e.nota.trim() !== "" ? e.nota.trim() : null,
  };
}

// ─── Regla 28: corrida de referencia ───

type CorridaParaReferencia = { id: string; created_at: string; referencia: boolean };

/** La corrida de referencia: la marcada y, sin ninguna, la última por `created_at` (desempate por `id`). */
export function corridaDeReferencia<T extends CorridaParaReferencia>(corridas: readonly T[]): T | null {
  const marcada = corridas.find((c) => c.referencia);
  if (marcada) return marcada;
  let ultima: T | null = null;
  for (const c of corridas) {
    if (ultima === null || c.created_at > ultima.created_at || (c.created_at === ultima.created_at && c.id > ultima.id)) ultima = c;
  }
  return ultima;
}

/**
 * Regla 28. Marcar una corrida como referencia quita la anterior (a lo sumo una
 * con `referencia`). `existe` es falso si el id no está en la lista.
 */
export function planificarReferencia(
  corridas: readonly CorridaParaReferencia[],
  id: string
): { existe: boolean; quitar: string[]; marcar: string } {
  return {
    existe: corridas.some((c) => c.id === id),
    quitar: corridas.filter((c) => c.referencia && c.id !== id).map((c) => c.id),
    marcar: id,
  };
}

// ─── Mapeo de filas a la API ───

export function aVigenteResumen(fila: Tables<"curvas_estacionalidad">): VigenteResumenApi {
  return {
    id: fila.id,
    version: fila.version,
    modelo: esModeloCurva(fila.modelo) ? fila.modelo : "A",
    origen: fila.origen === "prestada" ? "prestada" : "propia",
    recomendada: fila.recomendada,
    eat: fila.eat === null ? null : Number(fila.eat),
    aprobada_at: fila.aprobada_at,
    usuario_nombre: fila.usuario_nombre,
    corrida_id: fila.corrida_id,
    curva: curvaDeFila(fila),
  };
}

export function aCurvaAprobada(fila: Tables<"curvas_estacionalidad">): CurvaAprobadaApi {
  return {
    id: fila.id,
    agrupacion_id: fila.agrupacion_estacionalidad_id,
    version: fila.version,
    estado: fila.estado === "reemplazada" ? "reemplazada" : fila.estado === "retirada" ? "retirada" : "vigente",
    corrida_id: fila.corrida_id,
    modelo: esModeloCurva(fila.modelo) ? fila.modelo : "A",
    origen: fila.origen === "prestada" ? "prestada" : "propia",
    recomendada: fila.recomendada,
    eat: fila.eat === null ? null : Number(fila.eat),
    error_max: fila.error_max === null ? null : Number(fila.error_max),
    medida: "unidades",
    curva: curvaDeFila(fila),
    nota: fila.nota,
    aprobada_at: fila.aprobada_at,
    usuario_nombre: fila.usuario_nombre,
  };
}

/** Las huellas guardadas en `anios_utilizados` (cadenas vacías si faltan). */
export function huellasDeCurva(aniosUtilizados: Json): HuellasCurva {
  const o = aniosUtilizados && typeof aniosUtilizados === "object" && !Array.isArray(aniosUtilizados) ? aniosUtilizados : {};
  const composicion = (o as Record<string, Json | undefined>).composicion;
  const huellaComposicion =
    composicion && typeof composicion === "object" && !Array.isArray(composicion) && typeof composicion.huella === "string"
      ? composicion.huella
      : typeof composicion === "string"
        ? composicion
        : "";
  const texto = (v: Json | undefined) => (typeof v === "string" ? v : "");
  return {
    composicion: huellaComposicion,
    red_huella: texto((o as Record<string, Json | undefined>).red_huella),
    cargas_huella: texto((o as Record<string, Json | undefined>).cargas_huella),
  };
}

export function aCurvaVigente(
  fila: Tables<"curvas_estacionalidad">,
  agrupacion: { codigo: string; nombre: string }
): CurvaVigenteApi {
  const curva = curvaDeFila(fila);
  return {
    agrupacion_id: fila.agrupacion_estacionalidad_id,
    codigo: agrupacion.codigo,
    nombre: agrupacion.nombre,
    curva_id: fila.id,
    version: fila.version,
    modelo: esModeloCurva(fila.modelo) ? fila.modelo : "A",
    origen: fila.origen === "prestada" ? "prestada" : "propia",
    medida: "unidades",
    curva,
    acumulada: curvaAcumulada(curva),
    huellas: huellasDeCurva(fila.anios_utilizados),
    corrida_id: fila.corrida_id,
    aprobada_at: fila.aprobada_at,
  };
}

/** Comparador vigente / propuesta: EAT entre ambas, diferencia mes a mes en puntos y el mes que más cambia. */
export function armarComparador(
  modelo: ModeloCurva,
  propuesta: { curva: readonly number[]; eat: number | null },
  vigente: { modelo: string; curva: readonly number[]; eat: number | null }
): ComparadorApi {
  const diferencia = propuesta.curva.map((p, m) => (p - (vigente.curva[m] ?? 0)) * 100);
  let mayor = 0;
  for (let m = 1; m < diferencia.length; m++) if (Math.abs(diferencia[m]) > Math.abs(diferencia[mayor])) mayor = m;
  return {
    modelo,
    propuesta: [...propuesta.curva],
    vigente: [...vigente.curva],
    eat_vs_vigente: eatEntreCurvas(propuesta.curva, vigente.curva),
    diferencia_por_mes: diferencia,
    mes_mayor_cambio: mayor + 1,
    difiere: difiereDeVigente({ modelo, curva: propuesta.curva, eat: propuesta.eat }, vigente),
  };
}
