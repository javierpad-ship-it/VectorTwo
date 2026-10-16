import type { Json, Tables, TablesInsert } from "@/lib/supabase/database.types";
import { formatearDecimal } from "@/lib/formato";
import { curvaAcumulada, hastaPorDefecto, normalizarCurva } from "./anios";
import { TOLERANCIA_IGUAL } from "./candidatas";
import { curvaDeUsuario, curvaManualDe, type EvaluacionCurvaUsuario } from "./curva-usuario";
import { redondearJson } from "./modelo";
import { difiereDeVigente, eatEntreCurvas } from "./obsolescencia";
import {
  MODELOS_CURVA,
  ORIGENES_CURVA,
  PARAMETROS_POR_DEFECTO,
  esModeloAprobable,
  origenCurvaDe,
  type AgrupacionResultado,
  type CodigoErrorCurvas,
  type ComparadorApi,
  type CurvaAprobadaApi,
  type CurvaManualApi,
  type CurvaVigenteApi,
  type HuellasCurva,
  type ModeloAprobable,
  type ModeloCurva,
  type OrigenCurva,
  type ParametrosCurvas,
  type PartidaCurvaUsuario,
  type PrerrequisitosApi,
  type TemporadaResultado,
  type VersionAgrupacionApi,
  type VigenteResumenApi,
} from "./tipos-api";

/**
 * Reglas de negocio de aprobar, retirar y mostrar curvas
 * (docs/modulos/06b-curvas-trabajo-por-agrupacion.md, reglas 26, 27, 41 a 43, 53 y 56).
 * Funciones puras: el handler las llama y no las reimplementa.
 */

export const MENSAJE_AGRUPACION_NO_ENCONTRADA = "Agrupación de estacionalidad no encontrada.";
export const MENSAJE_CORRIDA_NO_ENCONTRADA = "Corrida no encontrada.";

export type RechazoAprobar = { status: 404 | 409; mensaje: string; codigo: CodigoErrorCurvas | "agrupacion_no_encontrada" };

/** `A`…`F` y `T` (las candidatas que `calcular` devuelve); `U` no es una candidata. Para `U` también existe `esModeloAprobable` (en `tipos-api`). */
export function esModeloCurva(valor: unknown): valor is ModeloCurva {
  return typeof valor === "string" && (MODELOS_CURVA as readonly string[]).includes(valor);
}

export { esModeloAprobable };

/** El `origen_curva` de una fila de la base; ante un valor desconocido, el que corresponde al modelo. */
function origenCurvaDeFila(fila: Pick<Tables<"curvas_estacionalidad">, "origen_curva" | "modelo">): OrigenCurva {
  const guardado = (ORIGENES_CURVA as readonly string[]).includes(fila.origen_curva) ? (fila.origen_curva as OrigenCurva) : null;
  return guardado ?? origenCurvaDe(esModeloAprobable(fila.modelo) ? fila.modelo : "A");
}

/** `curva_manual` guardada → `CurvaManualApi`; `null` si no es un objeto con la forma esperada. */
export function curvaManualDeJson(json: Json | null | undefined): CurvaManualApi | null {
  const o = comoObjeto(json);
  if (!o) return null;
  const valores = o.valores_ingresados;
  if (!Array.isArray(valores) || valores.length !== 12 || !valores.every((v) => typeof v === "number")) return null;
  const numero = (v: unknown) => (typeof v === "number" ? v : null);
  const partida = comoObjeto(o.partida);
  const porAnio = Array.isArray(o.eat_en_muestra_por_anio) ? o.eat_en_muestra_por_anio : [];
  return {
    valores_ingresados: valores as number[],
    partida: (partida && typeof partida.tipo === "string" ? partida : { tipo: "en_blanco", referencia: null }) as unknown as PartidaCurvaUsuario,
    en_muestra: true,
    eat_en_muestra: numero(o.eat_en_muestra),
    error_max_en_muestra: numero(o.error_max_en_muestra),
    eat_en_muestra_por_anio: porAnio.flatMap((x) => {
      const f = comoObjeto(x);
      return f && typeof f.anio === "number" && typeof f.eat === "number" && typeof f.error_max === "number" ? [{ anio: f.anio, eat: f.eat, error_max: f.error_max }] : [];
    }),
    eat_parcial_en_muestra: numero(o.eat_parcial_en_muestra),
    igual_a: esModeloCurva(o.igual_a) ? o.igual_a : null,
  };
}

/** `p01 … p12` de una fila de `curvas_estacionalidad`, en orden. */
export function curvaDeFila(fila: Pick<Tables<"curvas_estacionalidad">, "p01" | "p02" | "p03" | "p04" | "p05" | "p06" | "p07" | "p08" | "p09" | "p10" | "p11" | "p12">): number[] {
  return [fila.p01, fila.p02, fila.p03, fila.p04, fila.p05, fila.p06, fila.p07, fila.p08, fila.p09, fila.p10, fila.p11, fila.p12].map(Number);
}

// ─── Parámetros guardados ───

function comoObjeto(json: unknown): Record<string, unknown> | null {
  return json !== null && typeof json === "object" && !Array.isArray(json) ? (json as Record<string, unknown>) : null;
}

/**
 * `parametros` guardados (jsonb de la foto) → `ParametrosCurvas`: lo que falte o no
 * sea del tipo esperado toma el valor por defecto (fotos de la 0.9.6 sin
 * `anios_excluidos`, `tiendas_excluidas` ni `sin_periodos_confirmado`).
 */
export function parametrosDeJson(json: unknown): ParametrosCurvas {
  const o = comoObjeto(json) ?? {};
  const salida: Record<string, unknown> = { ...PARAMETROS_POR_DEFECTO };
  for (const [clave, defecto] of Object.entries(PARAMETROS_POR_DEFECTO)) {
    const valor = o[clave];
    if (Array.isArray(defecto)) continue;
    if (typeof valor === typeof defecto) salida[clave] = valor;
  }
  const anios = o.anios_excluidos;
  salida.anios_excluidos = Array.isArray(anios) ? anios.filter((a): a is number => typeof a === "number") : [];
  const tiendas = o.tiendas_excluidas;
  salida.tiendas_excluidas = Array.isArray(tiendas) ? tiendas.filter((t): t is string => typeof t === "string") : [];
  return salida as ParametrosCurvas;
}

/**
 * Regla 53. Parámetros con los que se abre una agrupación: los de su última
 * aprobación, con UNA excepción: `hasta_periodo` nunca se hereda y arranca en el
 * último mes publicado y cerrado de hoy (`null` si no hay ninguno). Sin aprobación,
 * los valores por defecto.
 */
export function parametrosIniciales(
  foto: { parametros: Json } | null,
  mesesPublicados: Iterable<string>,
  hoy: string
): { parametros: ParametrosCurvas; hasta_periodo: string | null } {
  return {
    parametros: foto ? parametrosDeJson(foto.parametros) : { ...PARAMETROS_POR_DEFECTO, anios_excluidos: [], tiendas_excluidas: [] },
    hasta_periodo: hastaPorDefecto(mesesPublicados, hoy),
  };
}

/**
 * Por qué falta la nota (`null` si no se exige): la curva del usuario (SIEMPRE), apartarse de la recomendada,
 * excluir años o tiendas, o un tratamiento del Niño distinto de `auto`.
 */
export function notaRequeridaPor(
  modelo: ModeloAprobable,
  recomendada: ModeloCurva | null,
  parametros: Pick<ParametrosCurvas, "anios_excluidos" | "tiendas_excluidas" | "tratamiento_atipicos">
): string | null {
  if (modelo === "U") return "aprobaste tu propia curva (U)";
  if (recomendada !== null && modelo !== recomendada) return `elegiste ${modelo} y el sistema recomienda ${recomendada}`;
  if (parametros.anios_excluidos.length > 0) return `excluiste ${parametros.anios_excluidos.length === 1 ? "un año" : "años"} del ajuste (${[...parametros.anios_excluidos].sort((a, b) => a - b).join(", ")})`;
  if (parametros.tiendas_excluidas.length > 0) {
    const n = parametros.tiendas_excluidas.length;
    return `excluiste ${n} ${n === 1 ? "tienda" : "tiendas"} de la red`;
  }
  if (parametros.tratamiento_atipicos !== "auto") return `fijaste el tratamiento del Niño en «${parametros.tratamiento_atipicos}»`;
  return null;
}

// ─── Regla 41: por qué NO se puede aprobar ───

export type EntradaRechazoAprobar = {
  /** `null` si la agrupación no existe. */
  agrupacion: { id: string; activo: boolean } | null;
  prerrequisitos: PrerrequisitosApi;
  /** Lo calculado para la agrupación (con los parámetros que mandó el planner). */
  resultado: AgrupacionResultado | null;
  temporada: Pick<TemporadaResultado, "curva_T"> | null;
  modelo: ModeloAprobable;
  huella_enviada: string;
  huella_actual: string;
  /** La vigente de hoy; `huella_calculo` es `null` en curvas de la 0.9.6. `curva` solo hace falta para el `sin_cambio` de una `U`. */
  vigente: { version: number; modelo: string; huella_calculo: string | null; curva?: readonly number[] } | null;
  /** 06c. Con `modelo = "U"`: los doce porcentajes que se quieren aprobar (para `sin_cambio`). */
  curva_usuario?: readonly number[] | null;
  version_vigente: number | null;
  parametros: Pick<ParametrosCurvas, "anios_excluidos" | "tiendas_excluidas" | "tratamiento_atipicos">;
  nota: string | undefined;
};

/**
 * Regla 41 (sustituye a `motivoRechazoElegir`). Por qué NO se puede aprobar, o
 * `null`. En este orden: agrupación inexistente `404`; inactiva `agrupacion_inactiva`;
 * algún prerrequisito que bloquea `prerrequisitos`; `origen = null` `sin_curva_posible`;
 * candidata sin curva (o `T` sin `curva_T`) `candidata_no_disponible`; huella enviada
 * distinta de la recalculada `datos_cambiados`; `version_vigente` distinta de la
 * vigente de hoy `vigente_cambiada`; misma candidata y misma huella que la vigente
 * `sin_cambio`; nota vacía en alguno de los tres casos `nota_requerida`. Todos `409`.
 *
 * 06c, con `modelo = "U"`: sin `sin_curva_posible` ni `candidata_no_disponible` (se aprueba aunque el sistema no
 * tenga candidata, pero `sin_venta` ya bloqueó en `prerrequisitos`); `sin_cambio` exige además los mismos doce
 * valores normalizados que la vigente `U`; la nota es SIEMPRE obligatoria.
 */
export function motivoRechazoAprobar(e: EntradaRechazoAprobar): RechazoAprobar | null {
  if (!e.agrupacion) return { status: 404, mensaje: MENSAJE_AGRUPACION_NO_ENCONTRADA, codigo: "agrupacion_no_encontrada" };
  if (!e.agrupacion.activo) {
    return { status: 409, mensaje: "La agrupación está inactiva: actívala antes de aprobarle una curva.", codigo: "agrupacion_inactiva" };
  }
  if (e.prerrequisitos.bloquea.length > 0) {
    return {
      status: 409,
      mensaje: `Antes de aprobar falta resolver: ${e.prerrequisitos.bloquea.map((p) => p.detalle).join(" ")}`,
      codigo: "prerrequisitos",
    };
  }
  // La curva del usuario se aprueba aunque el sistema no tenga ninguna candidata calculable (nunca con cero
  // venta: `sin_venta` bloquea arriba): no le aplican `sin_curva_posible` ni `candidata_no_disponible`.
  if (e.modelo !== "U") {
    if (!e.resultado || e.resultado.origen === null) {
      return {
        status: 409,
        mensaje: "Esta agrupación no tiene curva posible: ni años de ajuste propios ni una curva de su temporada de la que prestar.",
        codigo: "sin_curva_posible",
      };
    }
    const noDisponible: RechazoAprobar = {
      status: 409,
      mensaje: "Esa candidata no está disponible para esta agrupación con estos parámetros.",
      codigo: "candidata_no_disponible",
    };
    if (e.modelo === "T") {
      if (!e.temporada?.curva_T) return noDisponible;
    } else if (!e.resultado.candidatas.find((c) => c.modelo === e.modelo)?.curva) {
      return noDisponible;
    }
  }
  if (e.huella_enviada !== e.huella_actual) {
    return {
      status: 409,
      mensaje: "Los datos cambiaron desde que abriste la agrupación: vuelve a cargar.",
      codigo: "datos_cambiados",
    };
  }
  if ((e.vigente?.version ?? null) !== e.version_vigente) {
    return {
      status: 409,
      mensaje: "Otra persona aprobó o retiró una curva de esta agrupación: vuelve a cargar.",
      codigo: "vigente_cambiada",
    };
  }
  if (e.vigente && e.vigente.modelo === e.modelo && e.vigente.huella_calculo === e.huella_actual) {
    // Una `U` es lo que escribió el planner: igual a la vigente solo si los doce valores normalizados también coinciden.
    const mismaCurva =
      e.modelo !== "U" ||
      (e.curva_usuario != null && e.vigente.curva !== undefined && sonMismaCurva(curvaDeUsuario(e.curva_usuario), e.vigente.curva));
    if (mismaCurva) {
      return { status: 409, mensaje: "Esa curva ya es la vigente de la agrupación y los datos no cambiaron.", codigo: "sin_cambio" };
    }
  }
  const porQue = notaRequeridaPor(e.modelo, e.resultado?.recomendada ?? null, e.parametros);
  if (porQue !== null && (e.nota ?? "").trim() === "") {
    return { status: 409, mensaje: `Escribe una nota que explique el motivo: ${porQue}.`, codigo: "nota_requerida" };
  }
  return null;
}

/** `max |Δ| < TOLERANCIA_IGUAL` entre dos curvas de doce meses. */
function sonMismaCurva(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  let max = 0;
  for (let m = 0; m < a.length; m++) max = Math.max(max, Math.abs(a[m] - b[m]));
  return max < TOLERANCIA_IGUAL;
}

// ─── Regla 27/42: fila de la curva aprobada ───

/** Lo que se guarda de la foto en la curva (y en `corridas_estacionalidad.resumen`). */
export type DatosFotoCurva = {
  huella_calculo: string;
  huella_temporada: string;
  version_modelo: number;
  /** `aaaa-mm`. */
  hasta_periodo: string;
  hasta_fue_por_defecto: boolean;
  parametros: ParametrosCurvas;
};

/** `md5(resumen.cargas)` ya calculado por quien llama: lo que va en `cargas_huella`. */
export type EntradaFilaCurva = {
  agrupacion: AgrupacionResultado;
  temporada: TemporadaResultado | null;
  modelo: ModeloAprobable;
  /** 06c. Obligatoria con `modelo = "U"`: lo escrito, de dónde partió y lo medido en muestra (`evaluarCurvaUsuario`). */
  curva_usuario?: EvaluacionCurvaUsuario;
  corrida_id: string;
  red_huella: string;
  cargas_huella: string;
  /** Última versión existente de la agrupación (0 si no hay). */
  version_anterior: number;
  perfil: { id: string | null; nombre: string | null };
  nota?: string | null;
  foto: DatosFotoCurva;
};

/** Redondeo a dos decimales de las columnas `numeric(6,2)`. */
const a2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Regla 27 y 42. Fila de `curvas_estacionalidad` para la candidata elegida: copia la
 * curva (la `T` de la temporada), `recomendada = (modelo === recomendada)`,
 * `origen = prestada` si es `T`, `medida = 'unidades'`, `eat` y `error_max` (fuera de muestra, del
 * backtesting de la candidata; nulos si no los tiene), `anios_utilizados` con los años,
 * las tres huellas y lo que necesitan la lista y el comparador (`huella_calculo`, `huella_temporada`,
 * `version_modelo`, `hasta_periodo`, `hasta_fue_por_defecto`, `recomendada_entonces`,
 * `anios_ajuste`, parámetros) y `version = anterior + 1`. Devuelve `null` si la curva no existe.
 *
 * 06c: `origen_curva = origenCurvaDe(modelo)` (`U` → usuario, `F` → avanzada, el resto sistema; los mismos
 * checks de la base) y `curva_manual` solo con `U`. Con `U`: `modelo U`, `origen propia`, `recomendada false`,
 * `eat = null` y `error_max = null` (la medida en muestra va solo en `curva_manual`), `p01..p12` la curva
 * normalizada (`normalizarCurva(valores ÷ 100)`).
 */
export function filaCurva(e: EntradaFilaCurva): TablesInsert<"curvas_estacionalidad"> | null {
  let curva: number[] | null;
  let eat: number | null = null;
  let errorMax: number | null = null;
  if (e.modelo === "U") {
    if (!e.curva_usuario) return null;
    curva = e.curva_usuario.curva;
  } else if (e.modelo === "T") {
    curva = e.temporada?.curva_T ?? null;
    const candidata = e.agrupacion.candidatas.find((c) => c.modelo === "T");
    eat = candidata?.eat ?? null;
    errorMax = candidata?.error_max ?? null;
  } else {
    const candidata = e.agrupacion.candidatas.find((c) => c.modelo === e.modelo);
    curva = candidata?.curva ?? null;
    eat = candidata?.eat ?? null;
    errorMax = candidata?.error_max ?? null;
  }
  if (!curva || curva.length !== 12) return null;
  const c = normalizarCurva(curva);
  const p = e.foto.parametros;

  const aniosUtilizados: Json = {
    anios: e.agrupacion.anios.map((a) => ({ anio: a.anio, clase: a.clase, tratamiento: a.tratamiento, en_ajuste: a.en_ajuste })),
    anios_ajuste: e.agrupacion.anios.filter((a) => a.en_ajuste).map((a) => a.anio),
    composicion: { equivalencias: e.agrupacion.composicion.equivalencias, huella: e.agrupacion.composicion.huella },
    red_huella: e.red_huella,
    cargas_huella: e.cargas_huella,
    temporada: e.agrupacion.temporada,
    huella_calculo: e.foto.huella_calculo,
    huella_temporada: e.foto.huella_temporada,
    version_modelo: e.foto.version_modelo,
    ruido_normal: e.agrupacion.ruido_normal,
    hasta_periodo: e.foto.hasta_periodo,
    hasta_fue_por_defecto: e.foto.hasta_fue_por_defecto,
    recomendada_entonces: e.agrupacion.recomendada,
    anios_excluidos: [...p.anios_excluidos].sort((a, b) => a - b),
    tiendas_excluidas: [...p.tiendas_excluidas].sort(),
    sin_periodos_confirmado: p.sin_periodos_confirmado,
    parametros: p as unknown as Json,
  };

  return {
    agrupacion_estacionalidad_id: e.agrupacion.agrupacion_id,
    version: e.version_anterior + 1,
    estado: "vigente",
    corrida_id: e.corrida_id,
    modelo: e.modelo,
    origen: e.modelo === "T" ? "prestada" : "propia",
    origen_curva: origenCurvaDe(e.modelo),
    curva_manual: e.modelo === "U" && e.curva_usuario ? (redondearJson(curvaManualDe(e.curva_usuario)) as unknown as Json) : null,
    recomendada: e.modelo !== "U" && e.modelo === e.agrupacion.recomendada,
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

// ─── Mapeo de filas a la API ───

type ExtrasCurva = {
  recomendada_entonces: ModeloCurva | null;
  hasta_periodo: string | null;
  hasta_fue_por_defecto: boolean | null;
  version_modelo: number | null;
  ruido_normal: number | null;
  anios_ajuste: number[] | null;
  parametros: ParametrosCurvas | null;
  huella_calculo: string | null;
};

/** Lo que `filaCurva` guardó en `anios_utilizados` (todo `null` en curvas de la 0.9.6). */
export function extrasDeCurva(aniosUtilizados: Json): ExtrasCurva {
  const o = comoObjeto(aniosUtilizados) ?? {};
  const texto = (v: unknown) => (typeof v === "string" ? v : null);
  const ajuste = o.anios_ajuste;
  return {
    recomendada_entonces: esModeloCurva(o.recomendada_entonces) ? o.recomendada_entonces : null,
    hasta_periodo: texto(o.hasta_periodo),
    hasta_fue_por_defecto: typeof o.hasta_fue_por_defecto === "boolean" ? o.hasta_fue_por_defecto : null,
    version_modelo: typeof o.version_modelo === "number" ? o.version_modelo : null,
    ruido_normal: typeof o.ruido_normal === "number" ? o.ruido_normal : null,
    anios_ajuste: Array.isArray(ajuste) ? ajuste.filter((a): a is number => typeof a === "number") : null,
    parametros: comoObjeto(o.parametros) ? parametrosDeJson(o.parametros) : null,
    huella_calculo: texto(o.huella_calculo),
  };
}

export function aVigenteResumen(fila: Tables<"curvas_estacionalidad">): VigenteResumenApi {
  const x = extrasDeCurva(fila.anios_utilizados);
  return {
    id: fila.id,
    version: fila.version,
    modelo: esModeloAprobable(fila.modelo) ? fila.modelo : "A",
    origen: fila.origen === "prestada" ? "prestada" : "propia",
    origen_curva: origenCurvaDeFila(fila),
    curva_manual: fila.modelo === "U" ? curvaManualDeJson(fila.curva_manual) : null,
    recomendada: fila.recomendada,
    recomendada_entonces: x.recomendada_entonces,
    eat: fila.eat === null ? null : Number(fila.eat),
    aprobada_at: fila.aprobada_at,
    usuario_nombre: fila.usuario_nombre,
    foto_id: fila.corrida_id,
    hasta_periodo: x.hasta_periodo,
    hasta_fue_por_defecto: x.hasta_fue_por_defecto,
    nota: fila.nota,
    curva: curvaDeFila(fila),
    parametros: x.parametros,
    huella_calculo: x.huella_calculo,
    version_modelo: x.version_modelo,
    anios_ajuste: x.anios_ajuste,
    ruido_normal: x.ruido_normal,
  };
}

export function aCurvaAprobada(fila: Tables<"curvas_estacionalidad">): CurvaAprobadaApi {
  return {
    id: fila.id,
    agrupacion_id: fila.agrupacion_estacionalidad_id,
    version: fila.version,
    estado: fila.estado === "reemplazada" ? "reemplazada" : fila.estado === "retirada" ? "retirada" : "vigente",
    corrida_id: fila.corrida_id,
    modelo: esModeloAprobable(fila.modelo) ? fila.modelo : "A",
    origen: fila.origen === "prestada" ? "prestada" : "propia",
    origen_curva: origenCurvaDeFila(fila),
    curva_manual: fila.modelo === "U" ? curvaManualDeJson(fila.curva_manual) : null,
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
  const o = comoObjeto(aniosUtilizados) ?? {};
  const composicion = o.composicion;
  const c = comoObjeto(composicion);
  const huellaComposicion = c && typeof c.huella === "string" ? c.huella : typeof composicion === "string" ? composicion : "";
  const texto = (v: unknown) => (typeof v === "string" ? v : "");
  return {
    composicion: huellaComposicion,
    red_huella: texto(o.red_huella),
    cargas_huella: texto(o.cargas_huella),
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
    modelo: esModeloAprobable(fila.modelo) ? fila.modelo : "A",
    origen: fila.origen === "prestada" ? "prestada" : "propia",
    origen_curva: origenCurvaDeFila(fila),
    medida: "unidades",
    curva,
    acumulada: curvaAcumulada(curva),
    huellas: huellasDeCurva(fila.anios_utilizados),
    corrida_id: fila.corrida_id,
    aprobada_at: fila.aprobada_at,
  };
}

// ─── Regla 43: versiones de una agrupación ───

const ETIQUETA_PARAMETRO: Partial<Record<keyof ParametrosCurvas, string>> = {
  solo_tiendas_completas: "solo tiendas completas",
  exigir_venta_todo_el_ano: "exigir venta todo el año",
  meses_tienda_nueva: "meses de tienda nueva",
  umbral_tienda_dominante: "umbral de tienda dominante",
  umbral_forma: "piso de forma",
  max_meses_hueco: "máximo de huecos",
  min_unidades_ano: "mínimo de unidades por año",
  umbral_cambio_volumen: "cambio de volumen extremo",
  margen_ruido: "margen sobre el ruido",
  peso_minimo_diagnostico: "peso mínimo del diagnóstico",
  umbral_liquidacion: "umbral de liquidación",
  recencia_f: "recencia F",
};

/** Los parámetros distintos del valor por defecto, en castellano ("años excluidos: 2023"); vacío si todo es por defecto. */
export function resumenParametros(p: ParametrosCurvas): string[] {
  const salida: string[] = [];
  if (p.anios_excluidos.length > 0) salida.push(`años excluidos: ${[...p.anios_excluidos].sort((a, b) => a - b).join(", ")}`);
  if (p.tiendas_excluidas.length > 0) salida.push(`${p.tiendas_excluidas.length} ${p.tiendas_excluidas.length === 1 ? "tienda excluida" : "tiendas excluidas"}`);
  if (p.tratamiento_atipicos !== PARAMETROS_POR_DEFECTO.tratamiento_atipicos) salida.push(`tratamiento del Niño: ${p.tratamiento_atipicos}`);
  if (p.sin_periodos_confirmado) salida.push("confirmó que la temporada no tiene años atípicos");
  for (const [clave, etiqueta] of Object.entries(ETIQUETA_PARAMETRO) as [keyof ParametrosCurvas, string][]) {
    const valor = p[clave];
    if (valor !== PARAMETROS_POR_DEFECTO[clave]) {
      salida.push(`${etiqueta}: ${typeof valor === "number" ? formatearDecimal(valor, Number.isInteger(valor) ? 0 : 2) : valor ? "sí" : "no"}`);
    }
  }
  return salida;
}

export function versionesDeAgrupacion(filas: readonly Tables<"curvas_estacionalidad">[]): VersionAgrupacionApi[] {
  return [...filas]
    .sort((a, b) => b.version - a.version)
    .map((f) => {
      const x = extrasDeCurva(f.anios_utilizados);
      return {
        id: f.id,
        version: f.version,
        estado: f.estado === "reemplazada" ? "reemplazada" : f.estado === "retirada" ? "retirada" : "vigente",
        modelo: esModeloAprobable(f.modelo) ? f.modelo : "A",
        origen: f.origen === "prestada" ? "prestada" : "propia",
        origen_curva: origenCurvaDeFila(f),
        curva_manual: f.modelo === "U" ? curvaManualDeJson(f.curva_manual) : null,
        recomendada: f.recomendada,
        recomendada_entonces: x.recomendada_entonces,
        eat: f.eat === null ? null : Number(f.eat),
        ruido_normal: x.ruido_normal,
        curva: curvaDeFila(f),
        nota: f.nota,
        aprobada_at: f.aprobada_at,
        usuario_nombre: f.usuario_nombre,
        foto_id: f.corrida_id,
        parametros_resumen: x.parametros ? resumenParametros(x.parametros) : [],
      } satisfies VersionAgrupacionApi;
    });
}

// ─── Comparador ───

/** Regla 56. ¿El conjunto de años de ajuste coincide? `null` si la vigente no guardó el suyo (curvas de la 0.9.6). */
export function mismosAniosDeAjuste(propuesta: readonly number[], vigente: readonly number[] | null): boolean | null {
  if (vigente === null) return null;
  const a = [...propuesta].sort((x, y) => x - y).join(",");
  const b = [...vigente].sort((x, y) => x - y).join(",");
  return a === b;
}

/** Comparador vigente / propuesta: EAT entre ambas, diferencia mes a mes en puntos y el mes que más cambia. */
export function armarComparador(
  modelo: ModeloAprobable,
  propuesta: { curva: readonly number[]; eat: number | null },
  vigente: { modelo: string; curva: readonly number[]; eat: number | null },
  comparable: boolean | null = null
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
    comparable_con_vigente: comparable,
  };
}
