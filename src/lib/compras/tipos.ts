/**
 * Constantes y registros de lectura de las compras (M8, ficha 08, secciones 0, 6 y 7). Lógica pura y sin I/O: lo importan
 * `src/lib/compras/**` y, por la regla de independencia (ficha 08, §0.8), `src/lib/flujo/**` (que solo puede importar de compras
 * `pendientes.ts` y los `tipos*.ts`).
 *
 * Los catálogos (`origen`, `estado`, `moneda`, `tallas`, `destino`, `tipo`, `accion`) los valida zod y no la base (criterio I9:
 * ampliarlos no exige `DROP constraint`). Los registros de lectura NO dependen de `Tables<>`: son lo mínimo que las funciones puras
 * necesitan, con los meses ya como `aaaa-mm`; `consultas.ts` (T3b) convierte las fechas de la base.
 */

/** Mes de calendario como `aaaa-mm` (así viajan y así se comparan: el orden alfabético es el cronológico). */
export type Mes = string;

// ─── Catálogos ───

export const ORIGENES_COMPRA = ["comprador", "carga_inicial", "intercompany_cd"] as const;
export type OrigenCompra = (typeof ORIGENES_COMPRA)[number];

export const ESTADOS_COMPRA = ["borrador", "confirmada", "recibida", "cancelada"] as const;
export type EstadoCompra = (typeof ESTADOS_COMPRA)[number];
/** Solo las compras en estos estados cuentan en el flujo (un borrador y una cancelada sin recepciones aportan 0). */
export const ESTADOS_QUE_CUENTAN: readonly EstadoCompra[] = ["confirmada", "recibida"];

export const MONEDAS = ["PEN", "USD"] as const;
export type Moneda = (typeof MONEDAS)[number];

export const TALLAS_COMPRA = ["centrales", "extremas", "ambas"] as const;
export type TallasCompra = (typeof TALLAS_COMPRA)[number];

export const DESTINOS_COMPRA = ["cd", "tienda", "intercompany_directo"] as const;
export type DestinoCompra = (typeof DESTINOS_COMPRA)[number];

export const TIPOS_LINEA = ["especifica", "barrer_marca", "barrer_mezcla"] as const;
export type TipoLinea = (typeof TIPOS_LINEA)[number];
/** En `0.13.0` existen `especifica` y `barrer_marca`; `barrer_mezcla` entra con M9a. */
export const TIPOS_LINEA_DISPONIBLES: readonly TipoLinea[] = ["especifica", "barrer_marca"];

export const ORIGENES_ENTREGA = ["manual", "estacionalidad", "importada"] as const;
export type OrigenEntrega = (typeof ORIGENES_ENTREGA)[number];

export const ORIGENES_RECEPCION = ["manual", "sugerencia", "importada"] as const;
export type OrigenRecepcion = (typeof ORIGENES_RECEPCION)[number];

export const ACCIONES_EVENTO = [
  "crear",
  "editar_cabecera",
  "agregar_linea",
  "editar_linea",
  "quitar_linea",
  "confirmar",
  "recibir",
  "quitar_recepcion",
  "cancelar",
  "aplicar_reparto",
  "importar",
] as const;
export type AccionEvento = (typeof ACCIONES_EVENTO)[number];

// ─── Límites (los valida zod) ───

/** Entregas por línea (una por mes: dos años). */
export const MAX_ENTREGAS = 24;
/** Tolerancia de la suma de porcentajes de un lote de varias marcas (M9a): 100 ± 0,05. */
export const TOLERANCIA_MEZCLA = 0.05;
export const MAX_RECEPCIONES_POR_LLAMADA = 50;
export const MAX_FILAS_IMPORTACION = 10_000;
export const MAX_FILAS_MEZCLA = 20_000;
export const MAX_UNIDADES_LINEA = 10_000_000;
export const MAX_NOMBRE_PROVEEDOR = 120;
export const MAX_NOTA_PROVEEDOR = 300;
export const MAX_REFERENCIA = 80;
export const MAX_NOTA_COMPRA = 500;
export const MAX_NOTA_LINEA = 200;
export const MAX_NOTA_RECEPCION = 200;
export const MAX_MOTIVO_CANCELACION = 200;
export const MAX_JUSTIFICACION_EXCESO = 300;
export const MAX_MOTIVO_EVENTO = 300;
/** Cabecera del evento: lo que se muestra en el historial en una línea. */
export const MAX_RESUMEN_EVENTO = 300;

// ─── Quién escribe ───

/** `p_actor` de las funciones de escritura. `perfil_id` es nulo solo en procesos sin sesión (nunca en la API). */
export type ActorCompra = { perfil_id: string | null; nombre: string };

// ─── Registros de lectura (lo mínimo que usan las funciones puras; los arma `consultas.ts`) ───

export type CompraRegistro = {
  id: string;
  numero: string;
  proveedor_id: string;
  proveedor_nombre: string;
  origen: OrigenCompra;
  estado: EstadoCompra;
  fecha_compra: string;
  moneda: Moneda;
  /** `cancelada_at` no nulo con `estado = 'recibida'` ⇒ saldo cerrado (§0.11). */
  cancelada_at: string | null;
  revision: number;
};

export type LineaRegistro = {
  id: string;
  compra_id: string;
  tipo: TipoLinea;
  genero_mundo_linea_id: string | null;
  equivalencia_id: string | null;
  marca_id: string | null;
  agrupacion_marca_id: string | null;
  tallas: TallasCompra;
  unidades: number;
  unidades_recibidas: number;
  unidades_canceladas: number;
  costo_unitario: number | null;
  destino: DestinoCompra;
  tienda_id: string | null;
  alcance: { generos?: string[]; mundos?: string[]; lineas?: string[] };
  activo: boolean;
};

export type EntregaRegistro = { id: string; linea_id: string; periodo: Mes; unidades: number; origen: OrigenEntrega };

/** Reparto GUARDADO de un lote, por entrega (el flujo lo escala con `repartirEntero`, no lo recalcula). */
export type RepartoRegistro = {
  linea_id: string;
  entrega_id: string;
  marca_id: string;
  genero_mundo_linea_id: string;
  equivalencia_id: string | null;
  unidades: number;
  /** Nulo en un lote de varias marcas (porcentajes del comprador). */
  reparto_id: string | null;
  reparto_version: number | null;
  temporada: string | null;
  error_reparto_pp: number | null;
};

export type RecepcionRegistro = {
  id: string;
  linea_id: string;
  recibida_periodo: Mes;
  unidades: number;
  fecha_recepcion: string;
  origen: OrigenRecepcion;
};

// ─── Pendientes por entrega (compras/pendientes.ts) ───

export type LineaParaPendientes = { unidades: number; unidades_canceladas: number };
export type EntregaParaPendientes = { id: string; periodo: Mes; unidades: number };
export type RecepcionParaPendientes = { id: string; recibida_periodo: Mes; unidades: number; fecha_recepcion?: string };

export type EntregaConPendiente = {
  id: string;
  periodo: Mes;
  unidades: number;
  /** Unidades recibidas que le tocan por FIFO (de la entrega más antigua a la más reciente). */
  asignadas: number;
  /** Unidades de saldo cerrado que le tocan (de la última entrega hacia atrás, §0.11). */
  canceladas: number;
  /** `max(0, unidades − asignadas − canceladas)`: lo que el flujo espera de esta entrega. */
  pendiente: number;
};

/** Cuántas unidades de UNA recepción caen en UNA entrega: un lote usa el vector de la entrega a la que se asigna (§0.15). */
export type AsignacionRecepcion = { recepcion_id: string; entrega_id: string; unidades: number };

export type ResultadoPendientes = {
  /** Ordenadas por periodo (y, a igualdad, por id). */
  entregas: EntregaConPendiente[];
  asignaciones: AsignacionRecepcion[];
  /** `Σ` de las unidades de las recepciones. */
  recibidas: number;
  canceladas: number;
  /** `Σ pendiente`. Con datos coherentes es `unidades − recibidas − canceladas`. */
  pendiente: number;
  /** Unidades de recepciones o de saldo cerrado que no cupieron en las entregas (datos incoherentes; 0 si todo cuadra). */
  sin_asignar: number;
};

// ─── Funciones de escritura (rpc de `0025`, §6.11) ───

/** Motivos con los que una función de escritura rechaza sin escribir; la API los traduce a `404` o `409` con el mismo código. */
export const MOTIVOS_FUNCION_COMPRA = [
  "compra_cambio",
  "no_pertenece",
  "no_editable",
  "excede_pendiente",
  "recepcion_antes_de_compra",
  "recibida",
  "clave_existente",
  "proveedor_inactivo",
] as const;
export type MotivoFuncionCompra = (typeof MOTIVOS_FUNCION_COMPRA)[number];

export type ResultadoFuncionCompra =
  | { ok: true; compra_id: string; revision: number }
  | { ok: false; motivo: MotivoFuncionCompra };

/** Elemento de `p_recepciones` de `registrar_recepciones` (fechas ya como `aaaa-mm-dd`). */
export type RecepcionNueva = {
  linea_id: string;
  recibida_periodo: string;
  unidades: number;
  fecha_recepcion: string;
  nota: string | null;
  origen: Extract<OrigenRecepcion, "manual" | "sugerencia">;
};
