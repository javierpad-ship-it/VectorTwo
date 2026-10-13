import { z } from "zod";
import { ALCANCES_PERIODO, TEMPORADAS_AGRUPACION, type TemporadaAgrupacion } from "./tipos-api";

/**
 * Esquemas zod de M6, paso 1 (docs/modulos/06-curvas-estacionalidad.md,
 * "Contratos de API" y regla 29): periodos atípicos y temporada de la
 * agrupación. Los del cálculo (`calcularSchema`, `elegirCurvaSchema`,
 * `aprobarSchema`) llegan con el paso 2.
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

export const crearPeriodoAtipicoSchema = z
  .object({
    desde: mes,
    hasta: mes,
    motivo,
    descripcion,
    alcance: alcance.default("invierno"),
  })
  .refine((v) => v.hasta >= v.desde, { message: MENSAJE_RANGO_INVERTIDO, path: ["hasta"] });

export const editarPeriodoAtipicoSchema = z
  .object({ desde: mes, hasta: mes, motivo, descripcion, alcance, activo: z.boolean("activo debe ser verdadero o falso.") })
  .partial()
  .refine(tieneAlgo, noVacio)
  // Si vienen los dos extremos se comprueba aquí; si viene uno solo, el handler lo compara con la fila actual (`rangoValido`).
  .refine((v) => v.desde === undefined || v.hasta === undefined || v.hasta >= v.desde, {
    message: MENSAJE_RANGO_INVERTIDO,
    path: ["hasta"],
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

  return {
    consulta: {
      agrupacion_id: hayAgrupacion ? agrupacionId : null,
      temporada,
      ...(desde.valor !== undefined ? { desde: desde.valor } : {}),
      ...(hasta.valor !== undefined ? { hasta: hasta.valor } : {}),
    },
    rechazo: null,
  };
}
