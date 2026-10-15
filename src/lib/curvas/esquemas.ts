import { z } from "zod";
import { resolverTemporadas } from "./atipicos";
import {
  ALCANCES_PERIODO,
  MODELOS_CURVA,
  PARAMETROS_POR_DEFECTO,
  TEMPORADAS_AGRUPACION,
  TRATAMIENTOS_ATIPICOS,
  type ParametrosCurvas,
  type TemporadaAgrupacion,
} from "./tipos-api";

/**
 * Esquemas zod de M6 (docs/modulos/06-curvas-estacionalidad.md y
 * 06b-curvas-trabajo-por-agrupacion.md, "Contratos de API"): periodos atípicos con
 * `temporadas`, temporada de la agrupación, `calcularAgrupacionSchema` y
 * `aprobarCurvaSchema`. No existe esquema de aprobación en bloque: cada curva se
 * aprueba una por una (regla 44).
 */

export const MAX_MOTIVO = 120;
export const MAX_DESCRIPCION_PERIODO = 500;
export const ANIO_MINIMO = 2000;
export const ANIO_MAXIMO = 2100;
/** Tope de años que devuelve `GET /api/periodos-atipicos/anios` en una sola lectura. */
export const MAX_ANIOS_CONSULTA = 50;

const noVacio = { message: "No hay nada que actualizar." };
const tieneAlgo = (v: object) => Object.keys(v).length > 0;

export const MENSAJE_RANGO_INVERTIDO = "El mes final no puede ser anterior al inicial.";

/** `"2023-03"`: año de cuatro cifras (2000 a 2100) y mes 01 a 12. El handler lo convierte a `date` con `periodoADb`. */
export const mes = z
  .string("El mes debe ser texto con el formato aaaa-mm (por ejemplo 2023-03).")
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "El mes debe tener el formato aaaa-mm (por ejemplo 2023-03).")
  .refine((v) => Number(v.slice(0, 4)) >= ANIO_MINIMO && Number(v.slice(0, 4)) <= ANIO_MAXIMO, {
    message: `El año debe estar entre ${ANIO_MINIMO} y ${ANIO_MAXIMO}.`,
  });

const motivo = z
  .string("El motivo debe ser texto.")
  .trim()
  .min(1, "El motivo es obligatorio.")
  .max(MAX_MOTIVO, `El motivo no puede superar ${MAX_MOTIVO} caracteres.`);

/** Recortada (no se pasa a mayúsculas); vacía, solo espacios o `null` → `null`. */
const descripcion = z
  .string("La descripción debe ser texto.")
  .trim()
  .max(MAX_DESCRIPCION_PERIODO, `La descripción no puede superar ${MAX_DESCRIPCION_PERIODO} caracteres.`)
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

const alcance = z.enum(ALCANCES_PERIODO, "El alcance debe ser invierno o todas.");

const temporadasPeriodo = z
  .array(z.enum(TEMPORADAS_AGRUPACION, "Cada temporada debe ser invierno, verano o todo_el_ano."), "temporadas debe ser una lista.")
  .min(1, "Elige al menos una temporada.")
  .max(3, "Hay solo tres temporadas.")
  .refine((v) => new Set(v).size === v.length, { message: "Las temporadas no pueden repetirse." });

export const MENSAJE_TEMPORADAS_CONTRADICTORIAS =
  "temporadas y alcance se contradicen: alcance es un dato heredado, usa solo temporadas.";

/**
 * Conjunto de temporadas y espejo `alcance` de un cuerpo (alta o edición): manda
 * `temporadas`; solo con `alcance` (cliente del paso 1) se traduce; con los dos
 * contradictorios, 400. Nadie fuera de `atipicos.ts` decide con `alcance`.
 */
const conTemporadas = <T extends { temporadas?: TemporadaAgrupacion[]; alcance?: (typeof ALCANCES_PERIODO)[number] }>(
  v: T,
  ctx: z.RefinementCtx
) => {
  if (resolverTemporadas(v)?.contradiccion) {
    ctx.addIssue({ code: "custom", message: MENSAJE_TEMPORADAS_CONTRADICTORIAS, path: ["alcance"] });
  }
};

export const crearPeriodoAtipicoSchema = z
  .object({
    desde: mes,
    hasta: mes,
    motivo,
    descripcion,
    temporadas: temporadasPeriodo.optional(),
    alcance: alcance.optional(),
  })
  .refine((v) => v.hasta >= v.desde, { message: MENSAJE_RANGO_INVERTIDO, path: ["hasta"] })
  .superRefine(conTemporadas)
  .transform((v) => {
    const { temporadas: _t, alcance: _a, ...resto } = v;
    void _t;
    void _a;
    // Sin `temporadas` ni `alcance`, por defecto invierno (como en el paso 1).
    const r = resolverTemporadas(v) ?? resolverTemporadas({ temporadas: ["invierno"] });
    return { ...resto, temporadas: r?.temporadas ?? (["invierno"] as TemporadaAgrupacion[]), alcance: r?.alcance ?? ("invierno" as const) };
  });

export const editarPeriodoAtipicoSchema = z
  .object({
    desde: mes,
    hasta: mes,
    motivo,
    descripcion,
    temporadas: temporadasPeriodo,
    alcance,
    activo: z.boolean("activo debe ser verdadero o falso."),
  })
  .partial()
  .refine(tieneAlgo, noVacio)
  // Si vienen los dos extremos se comprueba aquí; si viene uno solo, el handler lo compara con la fila actual (`rangoValido`).
  .refine((v) => v.desde === undefined || v.hasta === undefined || v.hasta >= v.desde, {
    message: MENSAJE_RANGO_INVERTIDO,
    path: ["hasta"],
  })
  .superRefine(conTemporadas)
  .transform((v) => {
    const { temporadas: _t, alcance: _a, ...resto } = v;
    void _t;
    void _a;
    // Con `temporadas` o `alcance` se escriben SIEMPRE los dos (conjunto y espejo).
    const r = resolverTemporadas(v);
    return {
      ...resto,
      temporadas: r?.temporadas as TemporadaAgrupacion[] | undefined,
      alcance: r?.alcance as (typeof ALCANCES_PERIODO)[number] | undefined,
    };
  });

/** Temporada de una agrupación (POST y PATCH de `/api/agrupaciones-estacionalidad`). */
export const temporadaAgrupacion = z.enum(
  TEMPORADAS_AGRUPACION,
  "La temporada debe ser invierno, verano o todo_el_ano."
);

export type CrearPeriodoAtipico = z.infer<typeof crearPeriodoAtipicoSchema>;
export type EditarPeriodoAtipico = z.infer<typeof editarPeriodoAtipicoSchema>;

// ─── GET /api/periodos-atipicos/anios ───

export type ConsultaAnios = {
  /** `null` si se evalúa por temporada. */
  agrupacion_id: string | null;
  temporada: TemporadaAgrupacion;
  desde?: number;
  hasta?: number;
  /** `?con_volumen=1`: calcula `ratio_volumen` y `volumen` a demanda (con una lectura de venta). */
  con_volumen: boolean;
};

export type RechazoConsultaAnios = { status: 400 | 404; mensaje: string };

export const AGRUPACION_NO_ENCONTRADA_ANIOS = "Agrupación de estacionalidad no encontrada.";

const uuid = z.uuid();

function leerAnio(texto: string | null, nombre: "desde" | "hasta"): { valor?: number; rechazo?: RechazoConsultaAnios } {
  if (texto === null || texto.trim() === "") return {};
  const limpio = texto.trim();
  const n = Number(limpio);
  if (!/^\d{4}$/.test(limpio) || n < ANIO_MINIMO || n > ANIO_MAXIMO) {
    return { rechazo: { status: 400, mensaje: `${nombre} debe ser un año de cuatro cifras entre ${ANIO_MINIMO} y ${ANIO_MAXIMO}.` } };
  }
  return { valor: n };
}

/**
 * Lee `?agrupacion_id=` o `?temporada=` (por defecto `temporada=invierno`) y
 * `?desde=&hasta=` (años). `400` si vienen los dos criterios, si la temporada no
 * es válida o si los años no lo son (o `hasta < desde`, o piden más de 50 años);
 * `404` si `agrupacion_id` no es un UUID (para el cliente da igual un id mal
 * formado que uno inexistente: ver `idDeRuta`).
 */
export function leerConsultaAnios(
  params: Pick<URLSearchParams, "get">
): { consulta: ConsultaAnios; rechazo: null } | { consulta: null; rechazo: RechazoConsultaAnios } {
  const rechazar = (status: 400 | 404, mensaje: string) => ({ consulta: null, rechazo: { status, mensaje } }) as const;

  const agrupacionId = params.get("agrupacion_id");
  const temporadaTexto = params.get("temporada");
  const hayAgrupacion = agrupacionId !== null && agrupacionId !== "";
  const hayTemporada = temporadaTexto !== null && temporadaTexto !== "";

  if (hayAgrupacion && hayTemporada) return rechazar(400, "Indica agrupacion_id o temporada, no las dos.");

  let temporada: TemporadaAgrupacion = "invierno";
  if (hayTemporada) {
    const t = temporadaAgrupacion.safeParse(temporadaTexto);
    if (!t.success) return rechazar(400, "La temporada debe ser invierno, verano o todo_el_ano.");
    temporada = t.data;
  }
  if (hayAgrupacion && !uuid.safeParse(agrupacionId).success) return rechazar(404, AGRUPACION_NO_ENCONTRADA_ANIOS);

  const desde = leerAnio(params.get("desde"), "desde");
  if (desde.rechazo) return { consulta: null, rechazo: desde.rechazo };
  const hasta = leerAnio(params.get("hasta"), "hasta");
  if (hasta.rechazo) return { consulta: null, rechazo: hasta.rechazo };
  if (desde.valor !== undefined && hasta.valor !== undefined) {
    if (hasta.valor < desde.valor) return rechazar(400, "El año final no puede ser anterior al inicial.");
    if (hasta.valor - desde.valor + 1 > MAX_ANIOS_CONSULTA) {
      return rechazar(400, `Se pueden consultar hasta ${MAX_ANIOS_CONSULTA} años a la vez.`);
    }
  }

  const conVolumen = params.get("con_volumen");
  if (conVolumen !== null && conVolumen !== "" && !["1", "0", "true", "false"].includes(conVolumen.trim())) {
    return rechazar(400, "con_volumen debe ser 1 o 0.");
  }

  return {
    consulta: {
      agrupacion_id: hayAgrupacion ? agrupacionId : null,
      con_volumen: conVolumen !== null && ["1", "true"].includes(conVolumen.trim()),
      temporada,
      ...(desde.valor !== undefined ? { desde: desde.valor } : {}),
      ...(hasta.valor !== undefined ? { hasta: hasta.valor } : {}),
    },
    rechazo: null,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Paso 2
// ═══════════════════════════════════════════════════════════════════════════

const uuidValido = z.uuid("El identificador no es válido.");

/**
 * Los parámetros del cálculo de una agrupación (con sus defectos de la ficha 06 y los
 * tres de la 06b). NO se aceptan `medida`, `referencia_volumen` ni
 * `umbral_sustitucion` (recortados) y por eso nunca llegan a los parámetros guardados.
 */
const camposParametros = {
  solo_tiendas_completas: z.boolean("solo_tiendas_completas debe ser verdadero o falso.").default(PARAMETROS_POR_DEFECTO.solo_tiendas_completas),
  exigir_venta_todo_el_ano: z.boolean("exigir_venta_todo_el_ano debe ser verdadero o falso.").default(PARAMETROS_POR_DEFECTO.exigir_venta_todo_el_ano),
  meses_tienda_nueva: z
    .number("Los meses de tienda nueva deben ser un número.")
    .int("Los meses de tienda nueva deben ser un número entero.")
    .min(0, "Los meses de tienda nueva van de 0 a 36.")
    .max(36, "Los meses de tienda nueva van de 0 a 36.")
    .default(PARAMETROS_POR_DEFECTO.meses_tienda_nueva),
  umbral_tienda_dominante: z
    .number("El umbral de tienda dominante debe ser un número.")
    .min(0.1, "El umbral de tienda dominante va de 0.1 a 0.9.")
    .max(0.9, "El umbral de tienda dominante va de 0.1 a 0.9.")
    .default(PARAMETROS_POR_DEFECTO.umbral_tienda_dominante),
  tratamiento_atipicos: z
    .enum(TRATAMIENTOS_ATIPICOS, "El tratamiento debe ser auto, incluir, imputar o descartar.")
    .default(PARAMETROS_POR_DEFECTO.tratamiento_atipicos),
  umbral_forma: z
    .number("El piso del umbral de forma debe ser un número.")
    .min(0.5, "El piso del umbral de forma va de 0.5 a 50 puntos.")
    .max(50, "El piso del umbral de forma va de 0.5 a 50 puntos.")
    .default(PARAMETROS_POR_DEFECTO.umbral_forma),
  max_meses_hueco: z
    .number("El máximo de meses con hueco debe ser un número.")
    .int("El máximo de meses con hueco debe ser un número entero.")
    .min(1, "El máximo de meses con hueco va de 1 a 6.")
    .max(6, "El máximo de meses con hueco va de 1 a 6.")
    .default(PARAMETROS_POR_DEFECTO.max_meses_hueco),
  min_unidades_ano: z
    .number("El mínimo de unidades por año debe ser un número.")
    .int("El mínimo de unidades por año debe ser un número entero.")
    .min(0, "El mínimo de unidades por año no puede ser negativo.")
    .max(10_000_000, "El mínimo de unidades por año no puede pasar de 10 000 000.")
    .default(PARAMETROS_POR_DEFECTO.min_unidades_ano),
  umbral_cambio_volumen: z
    .number("El umbral de cambio de volumen debe ser un número.")
    .min(1.5, "El umbral de cambio de volumen va de 1.5 a 10.")
    .max(10, "El umbral de cambio de volumen va de 1.5 a 10.")
    .default(PARAMETROS_POR_DEFECTO.umbral_cambio_volumen),
  margen_ruido: z
    .number("El margen sobre el ruido debe ser un número.")
    .min(0, "El margen sobre el ruido va de 0 a 1.")
    .max(1, "El margen sobre el ruido va de 0 a 1.")
    .default(PARAMETROS_POR_DEFECTO.margen_ruido),
  peso_minimo_diagnostico: z
    .number("El peso mínimo del diagnóstico debe ser un número.")
    .min(0, "El peso mínimo del diagnóstico va de 0 a 0.5.")
    .max(0.5, "El peso mínimo del diagnóstico va de 0 a 0.5.")
    .default(PARAMETROS_POR_DEFECTO.peso_minimo_diagnostico),
  umbral_liquidacion: z
    .number("El umbral de liquidación debe ser un número.")
    .min(0.05, "El umbral de liquidación va de 0.05 a 0.5.")
    .max(0.5, "El umbral de liquidación va de 0.05 a 0.5.")
    .default(PARAMETROS_POR_DEFECTO.umbral_liquidacion),
  anios_excluidos: z
    .array(z.number("Cada año excluido debe ser un número.").int("Cada año excluido debe ser un número entero.").min(ANIO_MINIMO, `Los años van de ${ANIO_MINIMO} a ${ANIO_MAXIMO}.`).max(ANIO_MAXIMO, `Los años van de ${ANIO_MINIMO} a ${ANIO_MAXIMO}.`), "anios_excluidos debe ser una lista de años.")
    .max(20, "Se pueden excluir hasta 20 años.")
    .default([]),
  tiendas_excluidas: z
    .array(z.uuid("Cada tienda excluida debe ser un identificador válido."), "tiendas_excluidas debe ser una lista de tiendas.")
    .max(100, "Se pueden excluir hasta 100 tiendas.")
    .default([]),
  sin_periodos_confirmado: z.boolean("sin_periodos_confirmado debe ser verdadero o falso.").default(false),
};

/**
 * `POST /api/curvas/agrupaciones/[id]/calcular` (lectura con cuerpo: nunca escribe).
 * Todo es opcional (valen los valores por defecto). Es ESTRICTO: una clave que no
 * existe (por ejemplo la `marcar_referencia` de la 0.9.6) se rechaza con `400`.
 * `partir_de_vigente` usa los parámetros de la última aprobación (nunca su `hasta_periodo`).
 */
export const calcularAgrupacionSchema = z
  .object({
    hasta_periodo: mes.optional(),
    ...camposParametros,
    partir_de_vigente: z.boolean("partir_de_vigente debe ser verdadero o falso.").default(false),
  })
  .strict();

export type CalcularCuerpoValidado = z.infer<typeof calcularAgrupacionSchema>;

/** Caracteres de control (`Cc`) y de dirección de texto (bidi): no tienen sitio en una nota de una línea y sirven para disfrazar texto. */
const CARACTERES_PROHIBIDOS_NOTA = /[\p{Cc}\u202A-\u202E\u2066-\u2069]/u;

/**
 * `PUT /api/curvas/agrupaciones/[id]`. `parametros` son los que vio el planner, con
 * `hasta_periodo` OBLIGATORIO (el que devolvió `calcular` en `datos.hasta_periodo`);
 * `huella_calculo` la que devolvió `calcular`; `version_vigente` la versión vigente que
 * vio (`null` si no había). Es ESTRICTO (raíz y `parametros`): una clave desconocida es `400`. Rechaza `F`, `G`, `H` y cualquier modelo fuera de `A`…`E`, `T`.
 */
export const aprobarCurvaSchema = z.object({
  modelo: z.enum(MODELOS_CURVA, "El modelo debe ser A, B, C, D, E o T."),
  parametros: z.object({ hasta_periodo: mes, ...camposParametros }).strict(),
  huella_calculo: z.string("La huella del cálculo debe ser texto.").regex(/^[0-9a-f]{32}$/, "La huella del cálculo no es válida: vuelve a cargar la agrupación."),
  version_vigente: z
    .number("version_vigente debe ser un número (o null si no había curva vigente).")
    .int("version_vigente debe ser un número entero.")
    .min(1, "version_vigente debe ser 1 o más (o null si no había curva vigente).")
    .nullable(),
  nota: z
    .string("La nota debe ser texto.")
    .trim()
    .max(300, "La nota no puede superar 300 caracteres.")
    .refine((v) => !CARACTERES_PROHIBIDOS_NOTA.test(v), "La nota no puede llevar saltos de línea ni caracteres de control o de dirección de texto.")
    .optional(),
}).strict();

export type AprobarCurvaCuerpoValidado = z.infer<typeof aprobarCurvaSchema>;

/** Los parámetros del modelo (sin `hasta_periodo` ni `partir_de_vigente`): lo que se guarda en `corridas.parametros`; las listas sin repetidos y ordenadas. */
export function parametrosDeCuerpo(cuerpo: Omit<CalcularCuerpoValidado, "hasta_periodo" | "partir_de_vigente"> & { hasta_periodo?: string; partir_de_vigente?: boolean }): ParametrosCurvas {
  return {
    solo_tiendas_completas: cuerpo.solo_tiendas_completas,
    exigir_venta_todo_el_ano: cuerpo.exigir_venta_todo_el_ano,
    meses_tienda_nueva: cuerpo.meses_tienda_nueva,
    umbral_tienda_dominante: cuerpo.umbral_tienda_dominante,
    tratamiento_atipicos: cuerpo.tratamiento_atipicos,
    umbral_forma: cuerpo.umbral_forma,
    max_meses_hueco: cuerpo.max_meses_hueco,
    min_unidades_ano: cuerpo.min_unidades_ano,
    umbral_cambio_volumen: cuerpo.umbral_cambio_volumen,
    margen_ruido: cuerpo.margen_ruido,
    peso_minimo_diagnostico: cuerpo.peso_minimo_diagnostico,
    umbral_liquidacion: cuerpo.umbral_liquidacion,
    anios_excluidos: [...new Set(cuerpo.anios_excluidos)].sort((a, b) => a - b),
    tiendas_excluidas: [...new Set(cuerpo.tiendas_excluidas)].sort(),
    sin_periodos_confirmado: cuerpo.sin_periodos_confirmado,
  };
}

/** ¿Es un UUID? (segmentos de ruta que `idDeRuta` no cubre, como `[agrupacionId]`). */
export function esUuid(valor: string): boolean {
  return uuidValido.safeParse(valor).success;
}

/** `?modelo=` del detalle: ausente → `null`; `A`…`E`/`T` → el modelo; otro valor → `null` con `invalido`. */
export function leerModeloConsulta(params: Pick<URLSearchParams, "get">): { modelo: (typeof MODELOS_CURVA)[number] | null; invalido: boolean } {
  const crudo = params.get("modelo");
  if (crudo === null || crudo.trim() === "") return { modelo: null, invalido: false };
  const r = z.enum(MODELOS_CURVA).safeParse(crudo.trim());
  return r.success ? { modelo: r.data, invalido: false } : { modelo: null, invalido: true };
}

// ─── Lectura de query strings ───

export type RechazoConsulta = { status: 400 | 404; mensaje: string };

export const CORRIDA_NO_ENCONTRADA = "Corrida no encontrada.";

const booleano = (nombre: string) =>
  z
    .enum(["true", "false", "1", "0"], `${nombre} debe ser true o false.`)
    .transform((v) => v === "true" || v === "1");

const numeroDeQuery = (nombre: string, min: number, max: number, entero: boolean) => {
  const base = z.coerce.number(`${nombre} debe ser un número.`);
  return (entero ? base.int(`${nombre} debe ser un número entero.`) : base).min(min, `${nombre} va de ${min} a ${max}.`).max(max, `${nombre} va de ${min} a ${max}.`);
};

const esquemaConsultaRed = z.object({
  hasta_periodo: mes.optional(),
  solo_tiendas_completas: booleano("solo_tiendas_completas").optional(),
  exigir_venta_todo_el_ano: booleano("exigir_venta_todo_el_ano").optional(),
  meses_tienda_nueva: numeroDeQuery("meses_tienda_nueva", 0, 36, true).optional(),
  umbral_tienda_dominante: numeroDeQuery("umbral_tienda_dominante", 0.1, 0.9, false).optional(),
  umbral_forma: numeroDeQuery("umbral_forma", 0.5, 50, false).optional(),
  peso_minimo_diagnostico: numeroDeQuery("peso_minimo_diagnostico", 0, 0.5, false).optional(),
});

export type ParametrosRedConsulta = Pick<
  ParametrosCurvas,
  | "solo_tiendas_completas"
  | "exigir_venta_todo_el_ano"
  | "meses_tienda_nueva"
  | "umbral_tienda_dominante"
  | "umbral_forma"
  | "peso_minimo_diagnostico"
>;

/**
 * `GET /api/curvas/red-comparable`: lee de la query los parámetros de red de
 * `calcularSchema` (los que faltan toman su valor por defecto) y `hasta_periodo`.
 * `400` con el primer problema en castellano.
 */
export function leerConsultaRed(
  params: Pick<URLSearchParams, "get">
):
  | { consulta: { parametros: ParametrosRedConsulta; hasta_periodo: string | null }; rechazo: null }
  | { consulta: null; rechazo: RechazoConsulta } {
  const crudo: Record<string, string> = {};
  for (const clave of Object.keys(esquemaConsultaRed.shape)) {
    const v = params.get(clave);
    if (v !== null && v.trim() !== "") crudo[clave] = v.trim();
  }
  const r = esquemaConsultaRed.safeParse(crudo);
  if (!r.success) {
    const primero = r.error.issues[0];
    const campo = primero?.path.length ? `${primero.path.join(".")}: ` : "";
    return { consulta: null, rechazo: { status: 400, mensaje: `${campo}${primero?.message ?? "Parámetros inválidos."}` } };
  }
  const d = PARAMETROS_POR_DEFECTO;
  return {
    consulta: {
      hasta_periodo: r.data.hasta_periodo ?? null,
      parametros: {
        solo_tiendas_completas: r.data.solo_tiendas_completas ?? d.solo_tiendas_completas,
        exigir_venta_todo_el_ano: r.data.exigir_venta_todo_el_ano ?? d.exigir_venta_todo_el_ano,
        meses_tienda_nueva: r.data.meses_tienda_nueva ?? d.meses_tienda_nueva,
        umbral_tienda_dominante: r.data.umbral_tienda_dominante ?? d.umbral_tienda_dominante,
        umbral_forma: r.data.umbral_forma ?? d.umbral_forma,
        peso_minimo_diagnostico: r.data.peso_minimo_diagnostico ?? d.peso_minimo_diagnostico,
      },
    },
    rechazo: null,
  };
}

export type CalcularCuerpoEntrada = z.input<typeof calcularAgrupacionSchema>;
