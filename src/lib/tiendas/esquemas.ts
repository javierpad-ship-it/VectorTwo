import { z } from "zod";
import { activo, nombre } from "@/lib/arbol/esquemas";
import { MAX_CODIGO, MAX_NOMBRE, aCodigo, normalizarNombre } from "@/lib/arbol/normalizar";
import { motivoRechazoTienda } from "./reglas";
import { ESTADOS_TIENDA, TIPOS_TIENDA } from "./tipos";
import { celdaTexto } from "@/lib/api/celdas";

/**
 * Esquemas zod de M4 (docs/modulos/04-tiendas.md, "Contratos de API" y regla
 * 19). `nombre` y `activo` son los de M1; el código NO se deriva del nombre
 * (es el código real de la tienda) y las fechas viajan solo como
 * `aaaa-mm-dd` (el cliente ya convirtió; el importador es quien interpreta
 * `dd/mm/aaaa`).
 */

export { ESTADOS_TIENDA, TIPOS_TIENDA };

export const MENSAJE_CODIGO_OBLIGATORIO = "El código es obligatorio (letras o números).";
export const MENSAJE_FECHA = "La fecha debe venir como aaaa-mm-dd.";
export const MENSAJE_TIPO = "El tipo debe ser Tienda o Centro de Distribución.";
export const MENSAJE_ESTADO = "El estado debe ser Planificada, Activa o Cerrada.";

const noVacio = { message: "No hay nada que actualizar." };
const tieneAlgo = (v: object) => Object.keys(v).length > 0;

/** Código real de la tienda, obligatorio, a ASCII en mayúsculas; vacío tras normalizar (`---`) → error. */
export const codigoTienda = z
  .string({
    error: (issue) => (issue.input === undefined ? "El código es obligatorio." : "El código debe ser texto."),
  })
  .transform(aCodigo)
  .pipe(
    z
      .string()
      .min(1, MENSAJE_CODIGO_OBLIGATORIO)
      .max(MAX_CODIGO, `El código no puede superar ${MAX_CODIGO} caracteres.`)
  );

/** Zona o razón social: texto libre normalizado; vacío, `null` o ausente → `null`. */
export const textoOpcional = z
  .string("Debe ser texto.")
  .nullable()
  .optional()
  .transform((v) => {
    const n = normalizarNombre(v ?? "");
    return n === "" ? null : n;
  })
  .pipe(z.string().max(MAX_NOMBRE, `No puede superar ${MAX_NOMBRE} caracteres.`).nullable());

export const fechaIso = z.iso.date(MENSAJE_FECHA);
const fecha = fechaIso.nullable().optional();

const monto = z
  .number("La venta esperada debe ser un número.")
  .min(0, "La venta esperada no puede ser negativa.")
  .nullable()
  .optional();

const tipo = z.enum(TIPOS_TIENDA, MENSAJE_TIPO);

/** M7: id de la tienda de referencia; `null` la quita. El handler comprueba que sea una Tienda activa y distinta. */
const referencia = z.uuid("La tienda de referencia no es válida.").nullable().optional();
export const estadoTiendaSchema = z.enum(ESTADOS_TIENDA, MENSAJE_ESTADO);

/** Coherencia cruzada (regla 4) como issue de zod colgada del campo que la provoca. */
const coherente = (v: Parameters<typeof motivoRechazoTienda>[0], ctx: z.RefinementCtx) => {
  const m = motivoRechazoTienda(v);
  if (m) ctx.addIssue({ code: "custom", message: m.mensaje, path: m.path });
};

export const crearTiendaSchema = z
  .object({
    codigo: codigoTienda,
    nombre,
    tipo: tipo.default("Tienda"),
    zona: textoOpcional,
    razon_social: textoOpcional,
    fecha_apertura: fecha.transform((v) => v ?? null),
    fecha_cierre: fecha.transform((v) => v ?? null),
    venta_esperada_promedio: monto.transform((v) => v ?? null),
    tienda_referencia_id: referencia,
  })
  .superRefine(coherente);

/**
 * La coherencia cruzada en PATCH (cierre ≥ apertura, cierre exige apertura,
 * CD sin venta) la resuelve el handler con `motivoRechazoTienda({ ...actual,
 * ...cambio })`, porque depende de la fila actual que el esquema no conoce.
 */
export const editarTiendaSchema = z
  .object({
    codigo: codigoTienda,
    nombre,
    tipo,
    zona: textoOpcional,
    razon_social: textoOpcional,
    fecha_apertura: fecha,
    fecha_cierre: fecha,
    venta_esperada_promedio: monto,
    tienda_referencia_id: referencia,
    activo,
  })
  .partial()
  .refine(tieneAlgo, noVacio);

// ─── Ubicaciones ignoradas (M5c) ───

/** Nombre tal como viene en la columna TIENDA del archivo, normalizado como `tiendas.nombre`. */
const nombreUbicacion = z
  .string("El nombre debe ser texto.")
  .transform(normalizarNombre)
  .pipe(z.string().min(1, "El nombre es obligatorio.").max(120, "El nombre no puede superar 120 caracteres."));

/** Nota libre: vacía, `null` o ausente → `null`; más de 200 caracteres → error. */
const notaUbicacion = z
  .string("La nota debe ser texto.")
  .nullable()
  .optional()
  .transform((v) => {
    const t = (v ?? "").trim();
    return t === "" ? null : t;
  })
  .pipe(z.string().max(200, "La nota no puede superar 200 caracteres.").nullable());

export const crearUbicacionIgnoradaSchema = z.object({ nombre: nombreUbicacion, nota: notaUbicacion });

/**
 * Edición parcial. Como `nota` pasa por un `transform` que vuelve `null` la
 * ausencia, el esquema la deja `undefined` cuando la clave no viene (no se
 * toca) y `null`/texto cuando viene (`""` la borra).
 */
export const editarUbicacionIgnoradaSchema = z
  .object({ nombre: nombreUbicacion.optional(), nota: z.unknown().optional() })
  .transform((d, ctx) => {
    if (d.nota === undefined) return { nombre: d.nombre, nota: undefined as string | null | undefined };
    const r = notaUbicacion.safeParse(d.nota);
    if (!r.success) {
      for (const i of r.error.issues) ctx.addIssue({ code: "custom", message: i.message, path: ["nota"] });
      return z.NEVER;
    }
    return { nombre: d.nombre, nota: r.data as string | null | undefined };
  })
  .refine((d) => d.nombre !== undefined || d.nota !== undefined, "No hay nada que cambiar.");

// ─── Filtros de lectura (query string) ───

/** `GET /api/tiendas`: cada filtro es opcional; `""` cuenta como ausente. */
export const filtrosTiendasSchema = z.object({
  tipo: tipo.optional(),
  estado: estadoTiendaSchema.optional(),
  zona: z.string().optional(),
  hoy: fechaIso.optional(),
});

/** `GET /api/tiendas/aperturas`. */
export const filtrosAperturasSchema = z.object({
  desde: fechaIso.optional(),
  hasta: fechaIso.optional(),
  hoy: fechaIso.optional(),
});

// ─── Importador ───

const celda = (campo: string) => celdaTexto(campo).default("");

export const filaImportacionTiendaSchema = z.object({
  codigo: celdaTexto("codigo"),
  nombre: celdaTexto("nombre"),
  tipo: celda("tipo"),
  zona: celda("zona"),
  razon_social: celda("razon_social"),
  fecha_apertura: celda("fecha_apertura"),
  fecha_cierre: celda("fecha_cierre"),
  venta_esperada: celda("venta_esperada"),
  tienda_referencia: celdaTexto("tienda_referencia").optional(),
});

export const importarTiendasSchema = z.object({
  modo: z.enum(["previsualizar", "aplicar"], "El modo debe ser previsualizar o aplicar."),
  filas: z
    .array(filaImportacionTiendaSchema)
    .min(1, "No hay filas que importar.")
    .max(10_000, "Se admiten hasta 10 000 filas por importación."),
});

export type CrearTienda = z.infer<typeof crearTiendaSchema>;
export type EditarTienda = z.infer<typeof editarTiendaSchema>;
export type FiltrosTiendas = z.infer<typeof filtrosTiendasSchema>;
export type FiltrosAperturas = z.infer<typeof filtrosAperturasSchema>;
export type ImportarTiendas = z.infer<typeof importarTiendasSchema>;
export type CrearUbicacionIgnorada = z.infer<typeof crearUbicacionIgnoradaSchema>;
export type EditarUbicacionIgnorada = z.infer<typeof editarUbicacionIgnoradaSchema>;
