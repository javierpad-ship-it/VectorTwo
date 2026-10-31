// Lógica de vista de Administración → «Motor de IA» (ficha 07e, §4.5). Pura, sin React: la prueba vitest con datos sintéticos.
// Valida y arma el cuerpo de la configuración (los mismos rangos que `configuracionSchema`; el servidor vuelve a validar), decide qué
// evaluaciones pueden respaldar una capacidad, y pone en texto el informe del backtest. Ningún id de modelo ni precio está aquí: los
// modelos salen de `IA_MODELO` (vía `servicio.modelos_permitidos`) y los precios los escribe el admin.

import { formatearDecimal } from "@/lib/formato";
import { MEJORA_MIN_DESDE_SEGUNDA, PLIEGUES_DEFECTO, mejoraMinima } from "@/lib/ia/evaluacion";
import { TEXTO_V1 } from "@/lib/ia/prompt/v1";
import {
  CAPACIDADES_IA,
  type CapacidadIa,
  type ConfiguracionIaApi,
  type CorridaApi,
  type EstimacionApi,
  type EvaluacionApi,
  type MetricasNaturalApi,
  type MetricasRepartoApi,
  type PliegueIa,
  type PreciosIa,
  type ReglaVeredictoIa,
  type ResultadosEvaluacionApi,
  type ServicioIaApi,
  type VeredictoCapacidadIa,
} from "@/lib/ia/tipos-api";

// ─── Contratos de §3.2 que `tipos-api.ts` no declara ───

export type RespuestaConfiguracionApi = { vigente: ConfiguracionIaApi | null; versiones: ConfiguracionIaApi[]; servicio: ServicioIaApi; prompts: string[] };
export type RespuestaUsoApi = { mes: string; costo_usd: number; tope_usd_mes: number | null; corridas: CorridaApi[]; por_dia: { dia: string; costo_usd: number; llamadas: number }[] };
export type PlanEvaluacionApi = { pliegue: string; gm_clave: string };
export type RespuestaIniciarEvaluacionApi = { evaluacion: EvaluacionApi; plan: PlanEvaluacionApi[]; estimacion: EstimacionApi };

/**
 * El texto fijo del prompt por versión (sin datos), para «Ver texto». Se importa el archivo de cada versión, no el registro
 * `prompt/index`, porque este calcula huellas con `node:crypto` y no debe entrar al navegador. Al sumar `v2`, se añade aquí.
 */
export const TEXTOS_PROMPT: Readonly<Record<string, string>> = { v1: TEXTO_V1 };

// ─── Números ───

/** Un número escrito por una persona: acepta coma o punto decimal y nada más (sin miles, sin notación científica). `null` si no es válido. */
export function leerNumero(texto: string): number | null {
  const t = texto.trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const entero = (texto: string): number | null => {
  const n = leerNumero(texto);
  return n !== null && Number.isInteger(n) ? n : null;
};

// ─── Configuración ───

export type FormConfiguracion = {
  modelo: string;
  version_prompt: string;
  capacidades: CapacidadIa[];
  evaluacion_id: string;
  tope_usd_corrida: string;
  tope_usd_mes: string;
  tope_usd_dia_usuario: string;
  max_filas_llamada: string;
  incluir_cola_larga: boolean;
  presupuesto_razonamiento: string;
  precio_entrada: string;
  precio_entrada_cache: string;
  precio_salida: string;
  terminos_extra: string;
  nota: string;
};

export const DEFECTOS_CONFIGURACION = { tope_usd_corrida: "10", tope_usd_mes: "60", tope_usd_dia_usuario: "15", max_filas_llamada: "60", presupuesto_razonamiento: "0" } as const;

const texto = (n: number): string => String(n);

/** El formulario parte de la versión vigente; sin ella, de los valores por defecto de la ficha (modelo: el primero de `IA_MODELO`; precios vacíos). */
export function formDesdeVigente(vigente: ConfiguracionIaApi | null, modelosPermitidos: readonly string[], prompts: readonly string[]): FormConfiguracion {
  if (vigente) {
    return {
      modelo: vigente.modelo,
      version_prompt: vigente.version_prompt,
      capacidades: [...vigente.capacidades],
      evaluacion_id: vigente.evaluacion_id ?? "",
      tope_usd_corrida: texto(vigente.tope_usd_corrida),
      tope_usd_mes: texto(vigente.tope_usd_mes),
      tope_usd_dia_usuario: texto(vigente.tope_usd_dia_usuario),
      max_filas_llamada: texto(vigente.max_filas_llamada),
      incluir_cola_larga: vigente.incluir_cola_larga,
      presupuesto_razonamiento: texto(vigente.presupuesto_razonamiento),
      precio_entrada: texto(vigente.precios.entrada),
      precio_entrada_cache: texto(vigente.precios.entrada_cache),
      precio_salida: texto(vigente.precios.salida),
      terminos_extra: vigente.terminos_extra.join("\n"),
      nota: "",
    };
  }
  return {
    modelo: modelosPermitidos[0] ?? "",
    version_prompt: prompts[prompts.length - 1] ?? prompts[0] ?? "",
    capacidades: [],
    evaluacion_id: "",
    ...DEFECTOS_CONFIGURACION,
    incluir_cola_larga: false,
    precio_entrada: "",
    precio_entrada_cache: "",
    precio_salida: "",
    terminos_extra: "",
    nota: "",
  };
}

/** Una línea por término; sin vacíos ni repetidos (sin distinguir mayúsculas). */
export function leerTerminos(textoLibre: string): string[] {
  const vistos = new Set<string>();
  const salida: string[] = [];
  for (const l of textoLibre.split(/\r?\n/)) {
    const t = l.trim();
    if (t === "" || vistos.has(t.toLowerCase())) continue;
    vistos.add(t.toLowerCase());
    salida.push(t);
  }
  return salida;
}

export type CuerpoConfiguracion = {
  modelo: string;
  version_prompt: string;
  capacidades: CapacidadIa[];
  evaluacion_id: string | null;
  tope_usd_corrida: number;
  tope_usd_mes: number;
  tope_usd_dia_usuario: number;
  max_filas_llamada: number;
  incluir_cola_larga: boolean;
  presupuesto_razonamiento: number;
  precios: PreciosIa;
  terminos_extra: string[];
  nota?: string;
  version_vigente: number | null;
};

export type ContextoConfiguracion = { modelosPermitidos: readonly string[]; prompts: readonly string[]; versionVigente: number | null };

/** Valida el formulario con los rangos de `configuracionSchema` y arma el cuerpo del `POST`. Devuelve todos los errores juntos. */
export function validarConfiguracion(f: FormConfiguracion, ctx: ContextoConfiguracion): { ok: true; cuerpo: CuerpoConfiguracion } | { ok: false; errores: string[] } {
  const errores: string[] = [];
  if (!f.modelo || !ctx.modelosPermitidos.includes(f.modelo)) errores.push("Elige un modelo de la lista permitida por el servidor.");
  if (!ctx.prompts.includes(f.version_prompt)) errores.push("Elige una versión de prompt que exista.");

  const rango = (etiqueta: string, v: string, max: number, enteros = false): number => {
    const n = enteros ? entero(v) : leerNumero(v);
    if (n === null || n <= 0 || n > max) errores.push(`${etiqueta}: un ${enteros ? "entero" : "número"} mayor que 0 y hasta ${formatearDecimal(max, 0)}.`);
    return n ?? 0;
  };
  const topeCorrida = rango("Tope por corrida (US$)", f.tope_usd_corrida, 500);
  const topeMes = rango("Tope del mes (US$)", f.tope_usd_mes, 5000);
  const topeDia = rango("Tope por usuario y día (US$)", f.tope_usd_dia_usuario, 500);

  const filas = entero(f.max_filas_llamada);
  if (filas === null || filas < 10 || filas > 150) errores.push("Filas por llamada: un entero entre 10 y 150.");
  const razonamiento = entero(f.presupuesto_razonamiento);
  if (razonamiento === null || razonamiento < 0 || razonamiento > 32000) errores.push("Razonamiento: un entero entre 0 y 32 000 (0 = sin razonamiento).");

  const entrada = leerNumero(f.precio_entrada);
  const cache = leerNumero(f.precio_entrada_cache);
  const salida = leerNumero(f.precio_salida);
  if (entrada === null || entrada <= 0 || entrada > 1000) errores.push("Precio de entrada: un número mayor que 0 y hasta 1 000 (USD por millón de tokens).");
  if (cache === null || cache < 0 || (entrada !== null && cache > entrada)) errores.push("Precio de entrada en caché: un número desde 0 y no mayor que el de entrada (si el proveedor no tiene caché, igual al de entrada).");
  if (salida === null || salida <= 0 || salida > 1000) errores.push("Precio de salida: un número mayor que 0 y hasta 1 000 (USD por millón de tokens).");

  const terminos = leerTerminos(f.terminos_extra);
  if (terminos.length > 50) errores.push("Términos que nunca salen: hasta 50.");
  const cortos = terminos.filter((t) => t.length < 2 || t.length > 60);
  if (cortos.length > 0) errores.push("Cada término que nunca sale debe tener entre 2 y 60 caracteres.");

  const nota = f.nota.trim();
  if (nota.length > 300) errores.push("La nota admite hasta 300 caracteres.");
  if (f.capacidades.length > 0 && f.evaluacion_id === "") errores.push("Una capacidad solo se enciende con una evaluación ganadora del mismo modelo y prompt.");
  if (f.capacidades.some((c) => !(CAPACIDADES_IA as readonly string[]).includes(c))) errores.push("Capacidad desconocida.");

  if (errores.length > 0) return { ok: false, errores };
  return {
    ok: true,
    cuerpo: {
      modelo: f.modelo,
      version_prompt: f.version_prompt,
      capacidades: [...new Set(f.capacidades)],
      evaluacion_id: f.evaluacion_id === "" ? null : f.evaluacion_id,
      tope_usd_corrida: topeCorrida,
      tope_usd_mes: topeMes,
      tope_usd_dia_usuario: topeDia,
      max_filas_llamada: filas ?? 0,
      incluir_cola_larga: f.incluir_cola_larga,
      presupuesto_razonamiento: razonamiento ?? 0,
      precios: { entrada: entrada ?? 0, entrada_cache: cache ?? 0, salida: salida ?? 0 },
      terminos_extra: terminos,
      ...(nota === "" ? {} : { nota }),
      version_vigente: ctx.versionVigente,
    },
  };
}

/** ¿La evaluación es de este proveedor, modelo y prompt? El backtest vale solo para esa terna (D11). */
export const evaluacionEsDeLaTerna = (e: Pick<EvaluacionApi, "proveedor" | "modelo" | "version_prompt">, t: { proveedor: string | null; modelo: string; version_prompt: string }): boolean =>
  e.proveedor === t.proveedor && e.modelo === t.modelo && e.version_prompt === t.version_prompt;

/** Evaluaciones que pueden respaldar una capacidad: completas, ganadoras y de la misma terna. Las más recientes primero. */
export function evaluacionesElegibles(evaluaciones: readonly EvaluacionApi[], t: { proveedor: string | null; modelo: string; version_prompt: string }, capacidad: CapacidadIa = "distribucion_y1"): EvaluacionApi[] {
  return evaluaciones
    .filter((e) => e.estado === "completa" && e.veredicto?.[capacidad] === "gana" && evaluacionEsDeLaTerna(e, t))
    .sort((a, b) => b.iniciada_at.localeCompare(a.iniciada_at));
}

/** La capacidad se habilita solo si la evaluación elegida es elegible. */
export const capacidadHabilitable = (elegibles: readonly EvaluacionApi[], evaluacionId: string): boolean => evaluacionId !== "" && elegibles.some((e) => e.id === evaluacionId);

export const ETIQUETA_CAPACIDAD: Record<CapacidadIa, string> = { distribucion_y1: "Distribución de la meta del año siguiente (distribucion_y1)" };

/** «clave presente en el servidor: sí / no» (nunca el valor). */
export function textoClavePresente(s: ServicioIaApi): string {
  switch (s.motivo) {
    case "sin_clave":
      return "no";
    case "clave_invalida":
      return "sí, pero el proveedor la rechazó";
    case "desactivada_entorno":
      return "sin comprobar (la IA está desactivada por el entorno)";
    default:
      return "sí";
  }
}

// ─── Evaluaciones ───

export const ETIQUETA_VEREDICTO: Record<VeredictoCapacidadIa, string> = { gana: "gana", no_gana: "no gana", sin_dato: "sin datos" };
export const TONO_VEREDICTO: Record<VeredictoCapacidadIa, "exito" | "alerta" | "neutro"> = { gana: "exito", no_gana: "alerta", sin_dato: "neutro" };

const TEXTO_REGLA: Record<ReglaVeredictoIa, string> = {
  sin_dato: "hubo menos de 50 filas libres en el pliegue D25: no alcanza para decidir",
  mejora: "no mejoró lo exigido sobre el mejor rival en el reparto de D25",
  bootstrap: "el intervalo del bootstrap incluye cero: la mejora podría ser azar",
  mayoria_gm: "no ganó en la mitad de los GM con 5 filas libres o más",
  genero: "empeoró más de un 10 % frente al mejor rival en HOMBRE, MUJER o el Resto",
  natural: "el natural de la IA no superó al de los dos rivales en D25",
  contraste_d24: "en D24 (base corregida del Niño) pasó de 1,10 veces el error del método",
  cobertura: "la cobertura de respuestas válidas quedó por debajo de 98 %",
  estabilidad: "la estabilidad entre D25 y E25 quedó peor que 5 %",
};

export const textoReglaQueFallo = (r: ReglaVeredictoIa | null): string => (r === null ? "ninguna" : (TEXTO_REGLA[r] ?? r));

export const ETIQUETA_ESTADO_EVALUACION: Record<EvaluacionApi["estado"], string> = { en_curso: "en curso", completa: "completa", fallida: "fallida", cancelada: "cancelada" };

/** Fracción (0,0567) como `5.7 %`; `—` si no hay. */
export const wapeTexto = (w: number | null | undefined): string => (w === null || w === undefined || !Number.isFinite(w) ? "—" : `${formatearDecimal(w * 100, 1)} %`);

/** Mejora relativa con signo: `+12.4 %` (la IA tiene menos error que el rival); negativa si empeora. */
export function mejoraTexto(m: number | null | undefined): string {
  if (m === null || m === undefined || !Number.isFinite(m)) return "—";
  const p = Math.round(m * 1000) / 10;
  return `${p > 0 ? "+" : p < 0 ? "-" : ""}${formatearDecimal(Math.abs(p), 1)} %`;
}

export const ETIQUETA_RIVAL = { metodo: "método actual", tendencia: "regla de tendencia" } as const;

export type FilaInforme = {
  clave: string;
  pliegue: string;
  filas: number;
  wape_metodo: string;
  wape_tendencia: string;
  wape_ia: string;
  rival: string;
  mejora: string;
  ic90: string;
};

const filaDe = (clave: string, pliegue: string, m: MetricasRepartoApi | MetricasNaturalApi, ic: string): FilaInforme => ({
  clave,
  pliegue,
  filas: m.filas,
  wape_metodo: wapeTexto(m.wape_metodo),
  wape_tendencia: wapeTexto(m.wape_tendencia),
  wape_ia: wapeTexto(m.wape_ia),
  rival: m.rival === null ? "—" : ETIQUETA_RIVAL[m.rival],
  mejora: "mejora" in m ? mejoraTexto(m.mejora) : mejoraTexto(m.wape_rival !== null && m.wape_rival > 0 && m.wape_ia !== null ? 1 - m.wape_ia / m.wape_rival : null),
  ic90: ic,
});

/** IC 90 % del bootstrap de la diferencia de WAPE (rival − IA): `[p5; p95]` en puntos. */
export function textoIc90(b: { p5: number | null; p95: number | null } | null | undefined): string {
  if (!b || b.p5 === null || b.p95 === null) return "—";
  return `[${formatearDecimal(b.p5 * 100, 1)}; ${formatearDecimal(b.p95 * 100, 1)}] pp`;
}

/** Las tablas del informe: reparto (D25 con su bootstrap y D24) y natural. */
export function tablasInforme(r: ResultadosEvaluacionApi): { reparto: FilaInforme[]; natural: FilaInforme[] } {
  const reparto: FilaInforme[] = [];
  const natural: FilaInforme[] = [];
  if (r.d25) {
    reparto.push(filaDe("r-d25", "D25", r.d25.reparto, textoIc90(r.d25.bootstrap)));
    natural.push(filaDe("n-d25", "D25", r.d25.natural, "—"));
  }
  if (r.d24) {
    reparto.push(filaDe("r-d24", "D24", r.d24.reparto, "—"));
    natural.push(filaDe("n-d24", "D24", r.d24.natural, "—"));
  }
  return { reparto, natural };
}

/** «mejora mínima exigida 10 % (desde la segunda versión de prompt)». */
export function textoMejoraMinima(versionPrompt: string, evaluadasEnOrden: readonly string[]): string {
  const m = mejoraMinima(versionPrompt, evaluadasEnOrden);
  const pct = formatearDecimal(m * 100, 0);
  return m >= MEJORA_MIN_DESDE_SEGUNDA ? `mejora mínima exigida ${pct} % (desde la segunda versión de prompt)` : `mejora mínima exigida ${pct} % (primera versión de prompt evaluada)`;
}

/** Versiones de prompt evaluadas, en el orden de su primera evaluación. */
export function versionesEvaluadasEnOrden(evaluaciones: readonly Pick<EvaluacionApi, "version_prompt" | "iniciada_at">[]): string[] {
  const orden = [...evaluaciones].sort((a, b) => a.iniciada_at.localeCompare(b.iniciada_at));
  return [...new Set(orden.map((e) => e.version_prompt))];
}

/** «intento n.º 4 · mejora mínima exigida 10 % (desde la segunda versión de prompt)». */
export function textoIntentoNuevo(evaluaciones: readonly EvaluacionApi[], versionPrompt: string): string {
  const intento = evaluaciones.reduce((m, e) => Math.max(m, e.intento), 0) + 1;
  return `intento n.º ${intento} · ${textoMejoraMinima(versionPrompt, versionesEvaluadasEnOrden(evaluaciones))}`;
}

export const PLIEGUES_OFRECIDOS: readonly PliegueIa[] = ["D25", "E25", "D24", "N26"];
export const PLIEGUES_POR_DEFECTO: readonly PliegueIa[] = PLIEGUES_DEFECTO;

export const NOTA_PLIEGUE: Record<PliegueIa, string> = {
  D25: "reparto y natural de un año completo con la meta real (el que decide)",
  E25: "repite D25 con la misma entrada: mide la estabilidad",
  D24: "año del Niño con la base corregida: el caso de la meta que se reparte",
  N26: "informativo, opcional",
};

/** `45 min` / `1 h 05 min`; `—` si no terminó. */
export function duracionTexto(inicio: string, fin: string | null): string {
  if (!fin) return "—";
  const ms = new Date(fin).getTime() - new Date(inicio).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")} min`;
}

/** Pliegues del plan, en orden y sin repetir (para «preparando D25…»). */
export function pliegesDelPlan(plan: readonly PlanEvaluacionApi[]): string[] {
  return [...new Set(plan.map((p) => p.pliegue))];
}

// ─── Uso ───

/** «2026-11» → «noviembre de 2026». */
export function nombreMes(mes: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(mes);
  if (!m) return mes;
  const nombre = new Intl.DateTimeFormat("es-PE", { timeZone: "UTC", month: "long" }).format(new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1)));
  return `${nombre.toLowerCase()} de ${m[1]}`;
}

/** `aaaa-mm-dd` → `dd/mm`. */
export function diaCorto(dia: string): string {
  const m = /^\d{4}-(\d{2})-(\d{2})/.exec(dia);
  return m ? `${m[2]}/${m[1]}` : dia;
}

// ─── Nueva evaluación ───

export type FormEvaluacion = {
  modelo: string;
  version_prompt: string;
  pliegues: PliegueIa[];
  precio_entrada: string;
  precio_entrada_cache: string;
  precio_salida: string;
  tope_usd: string;
};

export const TOPE_EVALUACION_DEFECTO = "50";

/** Parte de la configuración vigente (modelo, prompt y precios) si la hay; los pliegues, los de la ficha. */
export function formEvaluacionInicial(vigente: ConfiguracionIaApi | null, modelosPermitidos: readonly string[], prompts: readonly string[]): FormEvaluacion {
  const base = formDesdeVigente(vigente, modelosPermitidos, prompts);
  return {
    modelo: base.modelo,
    version_prompt: base.version_prompt,
    pliegues: [...PLIEGUES_POR_DEFECTO],
    precio_entrada: base.precio_entrada,
    precio_entrada_cache: base.precio_entrada_cache,
    precio_salida: base.precio_salida,
    tope_usd: TOPE_EVALUACION_DEFECTO,
  };
}

export type CuerpoEvaluacion = { modelo: string; version_prompt: string; pliegues: PliegueIa[]; precios: PreciosIa; tope_usd: number };

/** Mismos rangos que `evaluacionSchema` (el servidor vuelve a validar). `costo_confirmado_usd` lo pone quien llama. */
export function validarEvaluacion(f: FormEvaluacion, ctx: { modelosPermitidos: readonly string[]; prompts: readonly string[] }): { ok: true; cuerpo: CuerpoEvaluacion } | { ok: false; errores: string[] } {
  const errores: string[] = [];
  if (!f.modelo || !ctx.modelosPermitidos.includes(f.modelo)) errores.push("Elige un modelo de la lista permitida por el servidor.");
  if (!ctx.prompts.includes(f.version_prompt)) errores.push("Elige una versión de prompt que exista.");
  if (f.pliegues.length === 0) errores.push("Elige al menos un pliegue.");
  const entrada = leerNumero(f.precio_entrada);
  const cache = leerNumero(f.precio_entrada_cache);
  const salida = leerNumero(f.precio_salida);
  if (entrada === null || entrada <= 0 || entrada > 1000) errores.push("Precio de entrada: un número mayor que 0 y hasta 1 000 (USD por millón de tokens).");
  if (cache === null || cache < 0 || (entrada !== null && cache > entrada)) errores.push("Precio de entrada en caché: un número desde 0 y no mayor que el de entrada.");
  if (salida === null || salida <= 0 || salida > 1000) errores.push("Precio de salida: un número mayor que 0 y hasta 1 000 (USD por millón de tokens).");
  const tope = leerNumero(f.tope_usd);
  if (tope === null || tope <= 0 || tope > 500) errores.push("Tope de la evaluación (US$): un número mayor que 0 y hasta 500.");
  if (errores.length > 0) return { ok: false, errores };
  return {
    ok: true,
    cuerpo: { modelo: f.modelo, version_prompt: f.version_prompt, pliegues: PLIEGUES_OFRECIDOS.filter((p) => f.pliegues.includes(p)), precios: { entrada: entrada ?? 0, entrada_cache: cache ?? 0, salida: salida ?? 0 }, tope_usd: tope ?? 0 },
  };
}
