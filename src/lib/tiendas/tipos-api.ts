/**
 * Vista de la API de M4 para el frontend (docs/modulos/04-tiendas.md,
 * "Contratos de API"). Describe el JSON que viaja, no las filas de la base;
 * el backend puede tipar sus respuestas con estos nombres o re-exportarlos
 * desde `tipos.ts`. A propósito no se importa nada de `./tipos`.
 */
import type { ModoImportacion } from "@/components/importador/tipos";

export type { ModoImportacion };

export type TipoTienda = "Tienda" | "Centro de Distribución";
export type EstadoTienda = "Planificada" | "Activa" | "Cerrada";

export const TIPOS_TIENDA_API: readonly TipoTienda[] = ["Tienda", "Centro de Distribución"];
export const ESTADOS_TIENDA_API: readonly EstadoTienda[] = ["Planificada", "Activa", "Cerrada"];

// ─── Tiendas (/api/tiendas) ───

/** Fila de `tiendas` en el listado, con el `estado` calculado por el servidor a la fecha `hoy`. */
export type TiendaFila = {
  id: string;
  codigo: string;
  nombre: string;
  tipo: TipoTienda;
  zona: string | null;
  razon_social: string | null;
  /** ISO `aaaa-mm-dd` o `null`. */
  fecha_apertura: string | null;
  /** ISO `aaaa-mm-dd` o `null`; último día con venta (inclusive). */
  fecha_cierre: string | null;
  /**
   * Venta MENSUAL promedio esperada de la tienda, ya en régimen y en soles SIN IGV (nunca incluye IGV; el sistema no convierte); solo en tipo
   * Tienda. M7 la multiplica por 12 y la reparte con la estacionalidad y la rampa en los meses en que la tienda esté abierta (`0.10.8`;
   * entre `0.10.1` y `0.10.7` se leía como los soles del año de apertura).
   */
  venta_esperada_promedio: number | null;
  /**
   * M7: tienda a cuya composición de venta debe parecerse esta si es nueva. Solo la reciben admin y planner (al
   * comprador la API se la oculta, como la venta esperada); ausente o `null` = sin referente.
   */
  tienda_referencia_id?: string | null;
  tienda_referencia?: { codigo: string; nombre: string } | null;
  activo: boolean;
  created_at: string;
  updated_at: string;
  estado: EstadoTienda;
};

export type CrearTiendaCuerpo = {
  codigo: string;
  nombre: string;
  tipo?: TipoTienda;
  zona?: string | null;
  razon_social?: string | null;
  fecha_apertura?: string | null;
  fecha_cierre?: string | null;
  venta_esperada_promedio?: number | null;
  /** M7: id de otra tienda de tipo Tienda, activa y distinta; `null` quita el referente. */
  tienda_referencia_id?: string | null;
};

export type EditarTiendaCuerpo = Partial<{
  codigo: string;
  nombre: string;
  tipo: TipoTienda;
  zona: string | null;
  razon_social: string | null;
  fecha_apertura: string | null;
  fecha_cierre: string | null;
  venta_esperada_promedio: number | null;
  tienda_referencia_id: string | null;
  activo: boolean;
}>;

// ─── Línea de tiempo (GET /api/tiendas/aperturas) ───

export type TipoEventoTienda = "apertura" | "cierre";

export type EventoTienda = {
  fecha: string;
  evento: TipoEventoTienda;
  /** `fecha < hoy`. */
  pasado: boolean;
  tienda_id: string;
  codigo: string;
  nombre: string;
  tipo: TipoTienda;
  zona: string | null;
  /** Estado de la tienda a la fecha `hoy` de la consulta. */
  estado: EstadoTienda;
  venta_esperada_promedio: number | null;
};

export type ResumenAperturas = {
  proximas_aperturas: number;
  proximos_cierres: number;
  /** Tiendas activas de tipo Tienda sin `fecha_apertura`. */
  sin_fecha_apertura: number;
};

export type AperturasRespuesta = {
  hoy: string;
  eventos: EventoTienda[];
  resumen: ResumenAperturas;
};

/** Grupo mensual de `agruparPorMes` (`src/lib/tiendas/aperturas.ts`). */
export type GrupoMesEventos = {
  /** `aaaa-mm`. */
  mes: string;
  /** "marzo de 2027". */
  etiqueta: string;
  eventos: EventoTienda[];
};

// ─── Importador (POST /api/tiendas/importar) ───

/** Una fila del archivo ya mapeada; todo texto tal cual, los campos no mapeados viajan como `""`. */
export type FilaImportacionTienda = {
  codigo: string;
  nombre: string;
  tipo: string;
  zona: string;
  razon_social: string;
  fecha_apertura: string;
  fecha_cierre: string;
  venta_esperada: string;
  /** Opcional: código de la tienda de referencia (columna `TIENDA_REFERENCIA`); `""` si no se mapeó. */
  tienda_referencia?: string;
};

export type ImportarTiendasCuerpo = {
  modo: ModoImportacion;
  filas: FilaImportacionTienda[];
};

export type MotivoOmisionTienda =
  | "codigo_vacio"
  | "nombre_vacio"
  | "fila_total"
  | "tipo_invalido"
  | "fecha_apertura_invalida"
  | "fecha_cierre_invalida"
  | "cierre_sin_apertura"
  | "cierre_antes_de_apertura"
  | "venta_invalida"
  | "venta_en_cd"
  | "referencia_invalida"
  | "nombre_repetido"
  | "duplicada_en_archivo";

/** Fila omitida: código y nombre normalizados, el resto tal como vino, para corregir el archivo. */
export type FilaOmitidaTienda = FilaImportacionTienda & {
  fila: number;
  motivo: MotivoOmisionTienda;
  detalle?: string;
  /** Solo en `duplicada_en_archivo`: la primera aparición del mismo código. */
  fila_original?: number;
};

export type CampoDiferenciaTienda =
  | "nombre"
  | "tipo"
  | "zona"
  | "razon_social"
  | "fecha_apertura"
  | "fecha_cierre"
  | "venta_esperada_promedio"
  | "tienda_referencia";

/** Tienda existente cuyo archivo trae otro valor en algún campo; informativo, el importador no la modifica. */
export type DiferenciaImportacionTienda = {
  fila: number;
  codigo: string;
  campo: CampoDiferenciaTienda;
  /** Legibles: fechas `dd/mm/aaaa`, montos con dos decimales, nulos como `—`. */
  en_base: string;
  en_archivo: string;
};

export type ReporteImportacionTiendas = {
  modo: ModoImportacion;
  hoy: string;
  totales: { recibidas: number; procesadas: number; omitidas: number };
  crear: {
    tiendas: number;
    centros_distribucion: number;
    /** Tiendas (no CD) nuevas sin apertura: quedarán Planificadas. */
    sin_fecha_apertura: number;
  };
  existentes: { tiendas: number };
  existentes_inactivos: { tiendas: number };
  diferencias: DiferenciaImportacionTienda[];
  omitidas: FilaOmitidaTienda[];
  /** Primeras 20 como `"R401 · LUKERS IQUITOS LORES · Activa"`. */
  muestra: { tiendas: string[] };
};

// ─── Etiquetas de pantalla ───

export const ETIQUETA_MOTIVO_OMISION_TIENDA: Record<MotivoOmisionTienda, string> = {
  codigo_vacio: "Código vacío",
  nombre_vacio: "Nombre vacío",
  fila_total: "Fila de totales",
  tipo_invalido: "Tipo no reconocido",
  fecha_apertura_invalida: "Fecha de apertura inválida",
  fecha_cierre_invalida: "Fecha de cierre inválida",
  cierre_sin_apertura: "Cierre sin apertura",
  cierre_antes_de_apertura: "Cierre anterior a la apertura",
  venta_invalida: "Venta esperada inválida",
  venta_en_cd: "Venta esperada en un CD",
  referencia_invalida: "Tienda de referencia inválida",
  nombre_repetido: "Nombre ya usado por otro código",
  duplicada_en_archivo: "Duplicada en el archivo",
};

export const ETIQUETA_CAMPO_DIFERENCIA_TIENDA: Record<CampoDiferenciaTienda, string> = {
  nombre: "Nombre",
  tipo: "Tipo",
  zona: "Zona",
  razon_social: "Razón social",
  fecha_apertura: "Fecha de apertura",
  fecha_cierre: "Fecha de cierre",
  venta_esperada_promedio: "Venta esperada",
  tienda_referencia: "Tienda de referencia",
};

/** Etiqueta corta del tipo para badges y chips. */
export const ETIQUETA_CORTA_TIPO: Record<TipoTienda, string> = {
  Tienda: "Tienda",
  "Centro de Distribución": "CD",
};

// ─── Ubicaciones ignoradas (/api/tiendas/ubicaciones-ignoradas) · M5c ───
//
// Nombres de la columna TIENDA del archivo de venta que NO son tiendas
// (central, oficinas, almacenes de muestras). Sus filas se excluyen por
// decisión (motivo `ubicacion_ignorada`), sin contar como error y sin crear
// tiendas. Toda la API exige `requirePlanner`, lecturas incluidas.
// docs/modulos/05c-ubicaciones-conciliacion.md, "Contratos de API".

export type UbicacionIgnoradaApi = {
  id: string;
  /** Normalizado por el servidor (NFC, trim, espacios colapsados, mayúsculas en español). */
  nombre: string;
  nota: string | null;
  created_at: string;
  updated_at: string;
  /** Tienda (activa o no) con el mismo nombre normalizado: la fila no tiene efecto. Se calcula al listar; `null` al crear/editar. */
  sin_efecto: { tienda_id: string; codigo: string; activo: boolean } | null;
};

/** `POST /api/tiendas/ubicaciones-ignoradas`. */
export type CrearUbicacionIgnoradaPeticion = { nombre: string; nota?: string | null };

/** `PATCH /api/tiendas/ubicaciones-ignoradas/[id]`. Al menos un campo; `nota: ""` o `null` la borra. */
export type EditarUbicacionIgnoradaPeticion = { nombre?: string; nota?: string | null };

/** `GET`: ordenadas por `nombre`. */
export type ListarUbicacionesIgnoradasRespuesta = UbicacionIgnoradaApi[];

/** `POST` → `201`; `PATCH` → `200`. */
export type UbicacionIgnoradaRespuesta = UbicacionIgnoradaApi;

/** `DELETE` → `200`. Nunca `409`: nada cuelga de la fila. */
export type EliminarUbicacionIgnoradaRespuesta = { id: string };

/**
 * Cuerpo del `409` al crear o renombrar con el nombre de una tienda existente:
 * `{ error, codigo }`. `error` ya viene listo para pantalla ("Ya existe la
 * tienda R101 con ese nombre. Si no debe cargarse, desactívala en Tiendas.").
 * El `409` de nombre repetido (único) trae solo `{ error }`, sin `codigo`.
 */
export type ErrorNombreEsTienda = { error: string; codigo: "nombre_es_tienda" };
