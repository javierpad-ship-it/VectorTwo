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
  /** Soles por mes; solo en tipo Tienda. */
  venta_esperada_promedio: number | null;
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
  | "venta_esperada_promedio";

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
};

/** Etiqueta corta del tipo para badges y chips. */
export const ETIQUETA_CORTA_TIPO: Record<TipoTienda, string> = {
  Tienda: "Tienda",
  "Centro de Distribución": "CD",
};
