import { z } from "zod";
import { celdaTexto, MAX_CELDA_NOTA } from "@/lib/api/celdas";
import { fechaSchema as fechaIso, importarComprasSchema, filaImportacionCompraSchema } from "@/lib/compras/esquemas";
import { MAX_FILAS_IMPORTACION } from "@/lib/compras/tipos";
import { mesSchema as mesIso } from "@/lib/intercompany/esquemas";
import {
  ACCIONES_ESTADO,
  ESTADOS_EMBARQUE,
  ESTADOS_VIAJE,
  MAX_ARCHIVO_NOMBRE,
  MAX_ASIGNACIONES_RECIBIR,
  MAX_COMPRAS_ASIGNAR_VIAJE,
  MAX_DESTINO_VIAJE,
  MAX_FILAS_IMPORTAR_AGRUPADORES,
  MAX_ITEMS_MOVIMIENTO,
  MAX_MOTIVO_ESTADO,
  MAX_MOTIVO_MOVIMIENTO,
  MAX_NOMBRE_AGRUPADOR,
  MAX_NOTA_EMBARQUE,
  MAX_NOTA_PAQUETE,
  MAX_NOTA_RECEPCION_EMBARQUE,
  MAX_NOTA_VIAJE,
  MAX_PUERTO_EMBARQUE,
  MAX_REFERENCIA_LOGISTICA,
  TIPOS_EMBARQUE,
} from "./tipos";

/**
 * Esquemas zod de los agrupadores de compras (ficha 08b, §3.1 y §3.11; completados con los de lectura, que la ficha deja implícitos).
 * Los cuerpos son `strictObject`: una clave desconocida da `400` (así un cliente viejo o un error de tipeo no pasa en silencio). Los
 * mensajes van en castellano porque `leerCuerpo` los devuelve tal cual a la pantalla. Los catálogos y los rangos de negocio se
 * validan AQUÍ y no en la base (PLAN §4). CONGELADO al terminar T0 de 08b-1.
 *
 * Qué NO se valida aquí, porque depende de lo que hay en la base (lo comprueba la función y responde `409`, no `400`):
 * `local_con_viaje`, `salida_despues_de_llegada`, `fecha_por_movimiento`, `responsable_no_asignable`, `codigo_duplicado`,
 * `correlativo_agotado`, `motivo_requerido`.
 */

const MENSAJE_CLAVE_DESCONOCIDA = "Dato desconocido: la petición lleva un campo que no existe.";

const estricto = { error: (iss: { code: string; keys?: string[] }) => (iss.code === "unrecognized_keys" ? `${MENSAJE_CLAVE_DESCONOCIDA} (${(iss.keys ?? []).join(", ")})` : undefined) };

const uuid = (campo: string) => z.uuid(`${campo} debe ser un identificador válido.`);

/** Versión vigente del agrupador (o de su embarque): `409 agrupador_cambio` si ya no lo es. */
const revision = (campo = "La revisión") =>
  z.number(`${campo} debe ser un número.`).int(`${campo} debe ser un entero.`).min(0, `${campo} no puede ser negativa.`);

const MENSAJE_CODIGO = "El código solo admite letras, números y guiones (hasta 30 caracteres).";

/**
 * R14 / §2.2: código escrito a mano: se pasa a mayúsculas y cumple `^[A-Z0-9-]{1,30}$` (puede o no tener el formato `aamm##`).
 * **Vacío (`""` o solo espacios) equivale a «no mandó código»**: el servidor autonumera `aamm##` (el formulario puede enviar el campo
 * en blanco). La salida es `string | undefined`.
 */
export const codigoSchema = z
  .string(MENSAJE_CODIGO)
  .trim()
  .transform((s) => s.toUpperCase())
  .pipe(z.string().regex(/^([A-Z0-9-]{1,30})?$/, MENSAJE_CODIGO))
  .transform((s) => (s === "" ? undefined : s))
  .optional();

const nombre = z
  .string("El nombre debe ser texto.")
  .trim()
  .min(1, "Escribe un nombre.")
  .max(MAX_NOMBRE_AGRUPADOR, `El nombre no puede superar ${MAX_NOMBRE_AGRUPADOR} caracteres.`);

/** Texto opcional: ausente = `undefined`; `null` y `""` = `null` (se borra el dato). */
const textoOpcional = (campo: string, max: number) =>
  z
    .string(`${campo} debe ser texto.`)
    .trim()
    .max(max, `${campo} no puede superar ${max} caracteres.`)
    .nullable()
    .optional()
    .transform((v) => (v === "" ? null : v));

const fechaOpcional = () => fechaIso.nullable().optional();

/** Motivo obligatorio de un movimiento (cambiar fecha, mover paquete, pasar pendientes): se guarda en el evento. */
const motivoObligatorio = z
  .string("Escribe el motivo.")
  .trim()
  .min(1, "Escribe el motivo.")
  .max(MAX_MOTIVO_MOVIMIENTO, `El motivo no puede superar ${MAX_MOTIVO_MOVIMIENTO} caracteres.`);

/** SHA-256 en hex del resumen del plan que el cliente vio en la vista previa (R19); sin ella no hay reintento. */
const huellaPlan = z.string("La huella del plan debe ser texto.").length(64, "La huella del plan no es válida.").optional();

// ─── Viajes (§2.3) ───

const viajeBase = z.strictObject(
  {
    revision: revision().optional(),
    codigo: codigoSchema,
    nombre,
    destino: textoOpcional("El destino", MAX_DESTINO_VIAJE),
    fecha_inicio: fechaIso,
    fecha_fin: fechaOpcional(),
    /** Obligatorio en el viaje (§2.8); asignables: comprador o admin activos (`409 responsable_no_asignable`). */
    responsable_id: uuid("El responsable"),
    nota: textoOpcional("La nota", MAX_NOTA_VIAJE),
  },
  estricto,
);

/** `POST /api/compras/viajes` y base del PATCH. `fecha_fin ≥ fecha_inicio` (el `check` de la base), con `400` aquí. */
const finDespuesDeInicio = (v: { fecha_inicio: string; fecha_fin?: string | null }) => v.fecha_fin == null || v.fecha_fin >= v.fecha_inicio;
const MENSAJE_FIN = "La fecha de fin no puede ser anterior a la de inicio.";

export const guardarViajeSchema = viajeBase.refine(finDespuesDeInicio, { message: MENSAJE_FIN, path: ["fecha_fin"] });
export type GuardarViaje = z.infer<typeof guardarViajeSchema>;

/** `PATCH /api/compras/viajes/[id]`: igual, pero la `revision` es obligatoria (sin ella la función CREARÍA un viaje). */
export const editarViajeSchema = viajeBase
  .refine(finDespuesDeInicio, { message: MENSAJE_FIN, path: ["fecha_fin"] })
  .refine((v) => v.revision !== undefined, { message: "Falta la revisión del viaje.", path: ["revision"] });
export type EditarViaje = z.infer<typeof editarViajeSchema>;

// ─── Embarques (§2.4) ───

const embarqueBase = z.strictObject(
  {
    revision: revision().optional(),
    codigo: codigoSchema,
    nombre,
    tipo: z.enum(TIPOS_EMBARQUE, "El tipo debe ser importacion o local."),
    /** Un embarque `local` no lleva viaje (`409 local_con_viaje`: lo comprueba la función). */
    viaje_id: uuid("El viaje").nullable(),
    /** Nulo = hereda del viaje (§2.8). */
    responsable_id: uuid("El responsable").nullable(),
    referencia_logistica: textoOpcional("La referencia logística", MAX_REFERENCIA_LOGISTICA),
    /** Puerto real de este envío (decisión 96); texto libre, con sugerencias en pantalla. */
    puerto_embarque: textoOpcional("El puerto", MAX_PUERTO_EMBARQUE),
    /** La editan planner y comprador y NO mueve entregas (R5). */
    fecha_salida_estimada: fechaOpcional(),
    /** Obligatoria al crear; al editar se rechaza con `409 fecha_por_movimiento` (cambia por `/fecha`, con motivo). */
    fecha_llegada_estimada: fechaIso.optional(),
    nota: textoOpcional("La nota", MAX_NOTA_EMBARQUE),
  },
  estricto,
);

/** `POST /api/compras/embarques`: sin `revision`, la fecha de llegada es obligatoria. */
export const guardarEmbarqueSchema = embarqueBase.refine((v) => v.revision !== undefined || v.fecha_llegada_estimada !== undefined, {
  message: "Indica la fecha de llegada estimada.",
  path: ["fecha_llegada_estimada"],
});
export type GuardarEmbarque = z.infer<typeof guardarEmbarqueSchema>;

/** `PATCH /api/compras/embarques/[id]`: la `revision` es obligatoria; la fecha de llegada, si viene, da `409 fecha_por_movimiento`. */
export const editarEmbarqueSchema = embarqueBase.refine((v) => v.revision !== undefined, { message: "Falta la revisión del embarque.", path: ["revision"] });
export type EditarEmbarque = z.infer<typeof editarEmbarqueSchema>;

// ─── Paquetes (§2.5) ───

/** `POST /api/compras/embarques/[id]/paquetes` y `PATCH /api/compras/paquetes/[id]`. La revisión es la del EMBARQUE (la cubre). */
export const guardarPaqueteSchema = z.strictObject(
  {
    revision_embarque: revision("La revisión del embarque"),
    codigo: codigoSchema,
    nombre,
    /** Nulo = hereda del embarque. */
    responsable_id: uuid("El responsable").nullable(),
    nota: textoOpcional("La nota", MAX_NOTA_PAQUETE),
  },
  estricto,
);
export type GuardarPaquete = z.infer<typeof guardarPaqueteSchema>;

// ─── Estados (R13) ───

/**
 * `POST …/estado` (viaje, embarque y paquete). La `revision` es la del agrupador (en un paquete, la de su embarque). Qué acciones
 * admite cada tipo, en `ACCIONES_ESTADO_POR_TIPO`; `409 motivo_requerido` lo decide la función.
 */
export const cambiarEstadoSchema = z.strictObject(
  {
    revision: revision(),
    accion: z.enum(ACCIONES_ESTADO, "La acción debe ser cerrar, reabrir, cancelar, en_transito o volver_a_planificado."),
    motivo: z
      .string("El motivo debe ser texto.")
      .trim()
      .max(MAX_MOTIVO_ESTADO, `El motivo no puede superar ${MAX_MOTIVO_ESTADO} caracteres.`)
      .optional(),
  },
  estricto,
);
export type CambiarEstado = z.infer<typeof cambiarEstadoSchema>;

// ─── Asignar compras a un viaje (§0.3, §3.3) ───

/** `POST /api/compras/viajes/[id]/compras`. `viaje_id` nulo quita el viaje de esas compras (la ruta exige que sea el del `[id]`). */
export const asignarViajeSchema = z.strictObject(
  {
    viaje_id: uuid("El viaje").nullable(),
    compras: z
      .array(z.strictObject({ id: uuid("La compra"), revision: revision("La revisión de la compra") }, estricto), "Indica las compras.")
      .min(1, "Indica al menos una compra.")
      .max(MAX_COMPRAS_ASIGNAR_VIAJE, `Se admiten hasta ${MAX_COMPRAS_ASIGNAR_VIAJE} compras por vez.`),
  },
  estricto,
);
export type AsignarViaje = z.infer<typeof asignarViajeSchema>;

// ─── Movimientos de entregas (§3.3 a §3.5; todos admiten `?previsualizar=1`) ───

const itemsMax = (campo: string) => `Se admiten hasta ${MAX_ITEMS_MOVIMIENTO} ${campo} por vez.`;

/** `POST /api/compras/embarques/[id]/asignar` (R1, R3, R4, R6). `paquete_id` nulo = sin paquete. `revision` es la del embarque. */
export const asignarEntregasSchema = z.strictObject(
  {
    revision: revision("La revisión del embarque"),
    paquete_id: uuid("El paquete").nullable(),
    huella_plan: huellaPlan,
    items: z
      .array(
        z.strictObject(
          {
            entrega_id: uuid("La entrega"),
            unidades: z.number("Las unidades deben ser un número.").int("Las unidades deben ser un número entero.").positive("Las unidades deben ser mayores que cero."),
            compra_revision: revision("La revisión de la compra"),
          },
          estricto,
        ),
        "Indica qué entregas asignar.",
      )
      .min(1, "Indica al menos una entrega.")
      .max(MAX_ITEMS_MOVIMIENTO, itemsMax("entregas")),
  },
  estricto,
);
export type AsignarEntregas = z.infer<typeof asignarEntregasSchema>;

/** `POST /api/compras/embarques/[id]/quitar`: las unidades quedan sin embarque en el mismo mes (R12; también en cancelado o recibido). */
export const quitarAsignacionesSchema = z.strictObject(
  {
    revision: revision("La revisión del embarque"),
    huella_plan: huellaPlan,
    asignaciones: z
      .array(z.strictObject({ id: uuid("La asignación"), compra_revision: revision("La revisión de la compra") }, estricto), "Indica qué quitar.")
      .min(1, "Indica al menos una asignación.")
      .max(MAX_ITEMS_MOVIMIENTO, itemsMax("asignaciones")),
  },
  estricto,
);
export type QuitarAsignaciones = z.infer<typeof quitarAsignacionesSchema>;

/** `POST /api/compras/embarques/[id]/paquete`: mismo embarque (no mueve meses). `paquete_id` nulo = sacarlas del paquete. */
export const moverAPaqueteSchema = z.strictObject(
  {
    revision: revision("La revisión del embarque"),
    paquete_id: uuid("El paquete").nullable(),
    asignaciones: z.array(uuid("La asignación"), "Indica qué mover.").min(1, "Indica al menos una asignación.").max(MAX_ITEMS_MOVIMIENTO, itemsMax("asignaciones")),
  },
  estricto,
);
export type MoverAPaquete = z.infer<typeof moverAPaqueteSchema>;

/** `POST /api/compras/embarques/[id]/fecha` (R5, decisión 83). El motivo es obligatorio; mismo mes = solo cambia el embarque. */
export const cambiarFechaSchema = z.strictObject(
  {
    revision: revision("La revisión del embarque"),
    fecha_llegada_estimada: fechaIso,
    motivo: motivoObligatorio,
    huella_plan: huellaPlan,
  },
  estricto,
);
export type CambiarFecha = z.infer<typeof cambiarFechaSchema>;

/** `POST /api/compras/paquetes/[id]/mover` (§3.5): `revision` es la del embarque de origen; `revision_destino`, la del destino. */
export const moverPaqueteSchema = z.strictObject(
  {
    revision: revision("La revisión del embarque de origen"),
    embarque_destino_id: uuid("El embarque de destino"),
    revision_destino: revision("La revisión del embarque de destino"),
    motivo: motivoObligatorio,
    huella_plan: huellaPlan,
  },
  estricto,
);
export type MoverPaquete = z.infer<typeof moverPaqueteSchema>;

/** `POST /api/compras/embarques/[id]/pasar-pendientes` (§3.5). Sin `asignaciones`, pasa lo pendiente de todo el embarque. */
export const pasarPendientesSchema = z.strictObject(
  {
    revision: revision("La revisión del embarque de origen"),
    embarque_destino_id: uuid("El embarque de destino"),
    revision_destino: revision("La revisión del embarque de destino"),
    paquete_destino_id: uuid("El paquete de destino").nullable(),
    asignaciones: z.array(uuid("La asignación")).max(MAX_ITEMS_MOVIMIENTO, itemsMax("asignaciones")).optional(),
    motivo: motivoObligatorio,
    huella_plan: huellaPlan,
  },
  estricto,
);
export type PasarPendientes = z.infer<typeof pasarPendientesSchema>;

// ─── 08b-2: recibir ───

/**
 * `POST /api/compras/embarques/[id]/recibir` (§3.6, R8, R9). Nunca reintenta: el cliente manda `items` explícitos o
 * `total_confirmado` (lo que vio en el `confirm`); si lo pendiente ya no suma eso, `409 recepcion_cambio`.
 */
export const recibirEmbarqueSchema = z
  .strictObject(
    {
      revision: revision("La revisión del embarque"),
      /** `otra_llegada`: no toca `fecha_llegada_real` ni mueve entregas (B3, R9). */
      modo: z.enum(["llegada", "otra_llegada"], "El modo debe ser llegada u otra_llegada."),
      /** ≤ hoy en Lima (`409 llegada_futura`: lo decide la función con la fecha de la base). */
      fecha_llegada_real: fechaIso,
      /** Mes X del ingreso; por defecto, el de la fecha. */
      periodo: mesIso.optional(),
      items: z
        .array(
          z.strictObject(
            {
              asignacion_id: uuid("La asignación"),
              unidades: z.number("Las unidades deben ser un número.").int("Las unidades deben ser un número entero.").min(0, "Las unidades no pueden ser negativas."),
            },
            estricto,
          ),
        )
        .max(MAX_ASIGNACIONES_RECIBIR, `Se admiten hasta ${MAX_ASIGNACIONES_RECIBIR} asignaciones por llegada.`)
        .optional(),
      /** Obligatorio si no hay `items`. */
      total_confirmado: z.number("El total debe ser un número.").int("El total debe ser un número entero.").positive("El total debe ser mayor que cero.").optional(),
      nota: textoOpcional("La nota", MAX_NOTA_RECEPCION_EMBARQUE),
    },
    estricto,
  )
  .refine((v) => (v.items ? v.items.some((i) => i.unidades > 0) : v.total_confirmado !== undefined), {
    message: "Indica al menos una unidad que recibir.",
    path: ["items"],
  });
export type RecibirEmbarque = z.infer<typeof recibirEmbarqueSchema>;

/** `POST /api/compras/embarques/[id]/revertir-recepcion` (08b-2, R10). Solo planner o admin. */
export const revertirRecepcionSchema = z.strictObject({ revision: revision("La revisión del embarque"), huella_plan: huellaPlan }, estricto);
export type RevertirRecepcion = z.infer<typeof revertirRecepcionSchema>;

// ─── Viaje activo (§3.8, R22) ───

/** `PUT /api/compras/viaje-activo`: un viaje existente no cancelado (`404 no_encontrado` si no), `todos` o `sin_viaje`. */
export const viajeActivoSchema = z.strictObject(
  {
    viaje_id: z.union([uuid("El viaje"), z.literal("todos"), z.literal("sin_viaje")], "Elige un viaje, «todos» o «sin_viaje»."),
  },
  estricto,
);
export type ViajeActivoCuerpo = z.infer<typeof viajeActivoSchema>;

// ─── Importador de agrupadores (§3.11, R25) ───

/** Celda de la hoja: texto, ausente o vacío = no vino. Los topes por campo (`nombre_largo`, `campo_largo`) son omisiones de la fila. */
const celda = (campo: string, max?: number) => celdaTexto(campo, max).optional();

/**
 * Una fila de la hoja única de §3.11 tal como la lee el navegador: todo texto. Columnas → claves: `TIPO`, `CODIGO`, `NOMBRE`,
 * `VIAJE`, `EMBARQUE`, `TIPO_EMBARQUE` → `tipo_embarque`, `DESTINO`, `FECHA_INICIO`, `FECHA_FIN`, `FECHA_SALIDA`, `FECHA_LLEGADA`,
 * `PUERTO`, `REFERENCIA_LOGISTICA`, `RESPONSABLE`, `NOTA`; `fila` es el número de fila del archivo (1-based). La validación fina
 * (tipo, longitudes, fechas, referencias) es del importador y omite la fila con su motivo en vez de dar `400`.
 */
export const filaAgrupadorSchema = z.strictObject(
  {
    fila: z.number("El número de fila debe ser un número.").int("El número de fila debe ser un entero.").min(1, "El número de fila empieza en 1."),
    tipo: celdaTexto("tipo"),
    codigo: celda("codigo"),
    nombre: celda("nombre"),
    viaje: celda("viaje"),
    embarque: celda("embarque"),
    tipo_embarque: celda("tipo_embarque"),
    destino: celda("destino"),
    fecha_inicio: celda("fecha_inicio"),
    fecha_fin: celda("fecha_fin"),
    fecha_salida: celda("fecha_salida"),
    fecha_llegada: celda("fecha_llegada"),
    puerto: celda("puerto"),
    referencia_logistica: celda("referencia_logistica"),
    responsable: celda("responsable"),
    nota: celda("nota", MAX_CELDA_NOTA),
  },
  estricto,
);
export type FilaAgrupador = z.infer<typeof filaAgrupadorSchema>;

/** `POST /api/compras/agrupadores/importar`: hasta 1 000 filas; `aplicar` es todo o nada (`409 vuelve_a_previsualizar`). */
export const importarAgrupadoresSchema = z.strictObject(
  {
    modo: z.enum(["previsualizar", "aplicar"], "El modo debe ser previsualizar o aplicar."),
    archivo_nombre: z.string("El nombre del archivo debe ser texto.").trim().max(MAX_ARCHIVO_NOMBRE, `El nombre del archivo no puede superar ${MAX_ARCHIVO_NOMBRE} caracteres.`),
    filas: z
      .array(filaAgrupadorSchema, "No hay filas que importar.")
      .min(1, "No hay filas que importar.")
      .max(MAX_FILAS_IMPORTAR_AGRUPADORES, `Se admiten hasta ${MAX_FILAS_IMPORTAR_AGRUPADORES} filas por importación.`),
  },
  estricto,
);
export type ImportarAgrupadores = z.infer<typeof importarAgrupadoresSchema>;

// ─── Columnas VIAJE, EMBARQUE y PAQUETE del importador de compras (§3.9, R21) ───

/**
 * Las tres columnas nuevas de la hoja de compras: código de un viaje, un embarque y un paquete EXISTENTES (el importador no crea
 * agrupadores). Texto de celda, `""` si no venía. NO entran en la huella de la línea (§3.9, punto 1). `src/lib/compras/esquemas.ts`
 * no se modifica: la ruta de importar compras debe usar `importarComprasConAgrupadoresSchema` (T3b).
 */
export const columnasAgrupadorCompraShape = {
  viaje: celdaTexto("viaje").default(""),
  embarque: celdaTexto("embarque").default(""),
  paquete: celdaTexto("paquete").default(""),
};

/** `filaImportacionCompraSchema` de M8 más `viaje`, `embarque` y `paquete`. */
export const filaImportacionCompraConAgrupadoresSchema = filaImportacionCompraSchema.extend(columnasAgrupadorCompraShape);
export type FilaImportacionCompraConAgrupadores = z.infer<typeof filaImportacionCompraConAgrupadoresSchema>;

/** `importarComprasSchema` de M8 con las filas que traen las tres columnas nuevas (el resto, igual). */
export const importarComprasConAgrupadoresSchema = importarComprasSchema.extend({
  filas: z
    .array(filaImportacionCompraConAgrupadoresSchema)
    .min(1, "No hay filas que importar.")
    .max(MAX_FILAS_IMPORTACION, "Se admiten hasta 10 000 filas por importación."),
});
export type ImportarComprasConAgrupadores = z.infer<typeof importarComprasConAgrupadoresSchema>;

// ─── Lectura (query string; el lector de cada módulo descarta los valores vacíos) ───

const bandera = (campo: string) =>
  z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v === "") return false;
      if (v === "1" || v === "true") return true;
      if (v === "0" || v === "false") return false;
      ctx.addIssue({ code: "custom", message: `${campo} debe ser 1 o 0.` });
      return false;
    });

const textoBusqueda = z.string().trim().max(100, "La búsqueda no puede superar 100 caracteres.").optional();
/** Un viaje concreto o los que no tienen viaje (los locales). Nunca lee la cookie del viaje activo (R22). */
const viajeOSinViaje = z.union([uuid("El viaje"), z.literal("sin_viaje")], "El viaje debe ser un identificador o «sin_viaje».").optional();

/** `?previsualizar=1` de todo movimiento: devuelve el `PlanMovimientoApi` sin escribir. */
export const previsualizarQuerySchema = z.object({ previsualizar: bandera("previsualizar") });

/** `GET /api/compras/viajes?estado&responsable_id&mio=1&q`. */
export const viajesQuerySchema = z.object({
  estado: z.enum(ESTADOS_VIAJE, "El estado debe ser abierto, cerrado o cancelado.").optional(),
  responsable_id: uuid("El responsable").optional(),
  mio: bandera("mio"),
  q: textoBusqueda,
});
export type ViajesQuery = z.infer<typeof viajesQuerySchema>;

/** `GET /api/compras/embarques?estado&tipo&viaje_id|sin_viaje&desde&hasta&responsable_id&mio=1&atrasados=1&q`. `desde` y `hasta` son meses de llegada. */
export const embarquesQuerySchema = z
  .object({
    estado: z.enum(ESTADOS_EMBARQUE, "El estado debe ser planificado, en_transito, recibido o cancelado.").optional(),
    tipo: z.enum(TIPOS_EMBARQUE, "El tipo debe ser importacion o local.").optional(),
    viaje_id: viajeOSinViaje,
    desde: mesIso.optional(),
    hasta: mesIso.optional(),
    responsable_id: uuid("El responsable").optional(),
    mio: bandera("mio"),
    atrasados: bandera("atrasados"),
    q: textoBusqueda,
  })
  .refine((v) => v.desde === undefined || v.hasta === undefined || v.desde <= v.hasta, {
    message: "«desde» no puede ser posterior a «hasta».",
    path: ["hasta"],
  });
export type EmbarquesQuery = z.infer<typeof embarquesQuerySchema>;

/** `GET /api/compras/agrupadores/sin-asignar?viaje_id|sin_viaje&proveedor_id&desde&hasta&q` (respeta el viaje activo que manda la pantalla). */
export const sinAsignarQuerySchema = z
  .object({
    viaje_id: viajeOSinViaje,
    proveedor_id: uuid("El proveedor").optional(),
    desde: mesIso.optional(),
    hasta: mesIso.optional(),
    q: textoBusqueda,
  })
  .refine((v) => v.desde === undefined || v.hasta === undefined || v.desde <= v.hasta, {
    message: "«desde» no puede ser posterior a «hasta».",
    path: ["hasta"],
  });
export type SinAsignarQuery = z.infer<typeof sinAsignarQuerySchema>;

/** `GET /api/compras/agrupadores/historial?viaje_id|embarque_id|paquete_id`: exactamente uno. */
export const historialQuerySchema = z
  .object({
    viaje_id: uuid("El viaje").optional(),
    embarque_id: uuid("El embarque").optional(),
    paquete_id: uuid("El paquete").optional(),
  })
  .refine((v) => [v.viaje_id, v.embarque_id, v.paquete_id].filter((x) => x !== undefined).length === 1, {
    message: "Indica un solo viaje, embarque o paquete.",
  });
export type HistorialQuery = z.infer<typeof historialQuerySchema>;

/** Filtros nuevos de `GET /api/compras` (cambio aditivo de M8, §3.3): `?viaje_id=…|sin_viaje&embarque_id=…`. T3b los suma a `comprasQuerySchema`. */
export const comprasAgrupadorQueryShape = {
  viaje_id: viajeOSinViaje,
  embarque_id: uuid("El embarque").optional(),
};
