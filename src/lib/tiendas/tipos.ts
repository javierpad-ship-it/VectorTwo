/**
 * Formas JSON de la API de M4 (docs/modulos/04-tiendas.md, "Contratos de
 * API"). Describen el JSON que viaja, no las filas de la base; el frontend
 * tiene los mismos nombres en `tipos-api.ts` (estructuralmente idénticos). A
 * propósito no se importa nada de `@/components`: el backend no depende de la
 * pantalla.
 */
import type { ModoImportacion } from "@/lib/arbol/tipos";

export type { ModoImportacion };

// ─── Valores cerrados ───

export const TIPOS_TIENDA = ["Tienda", "Centro de Distribución"] as const;
export type TipoTienda = (typeof TIPOS_TIENDA)[number];

/** Estado derivado de las fechas y de hoy; nunca se guarda (decisión 1 de la ficha). */
export const ESTADOS_TIENDA = ["Planificada", "Activa", "Cerrada"] as const;
export type EstadoTienda = (typeof ESTADOS_TIENDA)[number];

// ─── Tiendas (/api/tiendas) ───

/** Fila de `tiendas` tal como viaja, con el `estado` calculado a la fecha `hoy` de la petición. */
export type TiendaFila = {
  id: string;
  /** Código real de la tienda (`R401`, `RD50`): ASCII en mayúsculas, único. */
  codigo: string;
  nombre: string;
  tipo: TipoTienda;
  zona: string | null;
  razon_social: string | null;
  /** Primer día con venta, `aaaa-mm-dd`. */
  fecha_apertura: string | null;
  /** Último día con venta (inclusive), `aaaa-mm-dd`. */
  fecha_cierre: string | null;
  /** Soles por mes; solo en tipo Tienda. */
  venta_esperada_promedio: number | null;
  activo: boolean;
  created_at: string;
  updated_at: string;
  estado: EstadoTienda;
};

// ─── Línea de tiempo (GET /api/tiendas/aperturas) ───

export type TipoEventoTienda = "apertura" | "cierre";

export type EventoTienda = {
  fecha: string;
  evento: TipoEventoTienda;
  /** `fecha < hoy`: una apertura o un cierre con fecha hoy todavía no pasó. */
  pasado: boolean;
  tienda_id: string;
  codigo: string;
  nombre: string;
  tipo: TipoTienda;
  zona: string | null;
  /** Estado de la tienda a la fecha `hoy`, no a la fecha del evento. */
  estado: EstadoTienda;
  venta_esperada_promedio: number | null;
};

export type ResumenAperturas = {
  proximas_aperturas: number;
  proximos_cierres: number;
  /** Tiendas activas de tipo Tienda sin `fecha_apertura`: M7 no sabría proyectarlas. */
  sin_fecha_apertura: number;
};

export type ReporteAperturas = {
  hoy: string;
  eventos: EventoTienda[];
  resumen: ResumenAperturas;
};

/** Grupo mensual de `agruparPorMes`: `mes` como `aaaa-mm`, `etiqueta` como "marzo de 2027". */
export type GrupoMesEventos = {
  mes: string;
  etiqueta: string;
  eventos: EventoTienda[];
};

// ─── Importador (POST /api/tiendas/importar) ───

/** Una fila del archivo ya mapeada; todo texto: el servidor interpreta tipo, fechas y monto. Columnas sin mapear llegan como `""`. */
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

/** Fila omitida: código y nombre normalizados, el resto tal como vino, para corregir el archivo literalmente. */
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

export type ConteosCrearTiendas = {
  tiendas: number;
  centros_distribucion: number;
  /** Tiendas nuevas (no CD) sin apertura: quedarán Planificadas. */
  sin_fecha_apertura: number;
};

export type ConteosExistentesTiendas = { tiendas: number };

/** Reporte sin `modo` ni `hoy`: lo produce `planificarImportacionTiendas`; el handler los agrega. */
export type ReporteImportacionTiendasBase = {
  totales: { recibidas: number; procesadas: number; omitidas: number };
  crear: ConteosCrearTiendas;
  existentes: ConteosExistentesTiendas;
  existentes_inactivos: ConteosExistentesTiendas;
  diferencias: DiferenciaImportacionTienda[];
  omitidas: FilaOmitidaTienda[];
  /** Primeras 20 como `"R401 · LUKERS IQUITOS LORES · Activa"`. */
  muestra: { tiendas: string[] };
};

export type ReporteImportacionTiendas = ReporteImportacionTiendasBase & { modo: ModoImportacion; hoy: string };
