/**
 * Contrato JSON de las compras de M8 (docs/modulos/08-flujo-y-compras.md, §0.4, §0.5, §0.11–§0.13 y sección 7; `0.13.0`). ARCHIVO
 * AUTOCONTENIDO: lo importa también la pantalla, así que no importa de `@supabase/*` ni de módulos de servidor. Congelado al
 * terminar T0: si falta un campo, se pide a `backend`.
 *
 * Convenciones: meses como `aaaa-mm` (`llegada_periodo`, `periodo`, `recibida_periodo`); fechas como `aaaa-mm-dd`; instantes ISO;
 * unidades enteras; costos en la moneda de la compra. `GET /api/flujo` entrega unidades; el costo de las compras sí es visible
 * para todos los roles.
 *
 * Respuestas de las rutas de `0.13.0` (todas dentro de `{ data }`):
 *   GET    /api/compras                                  → CompraApi[]   (con líneas y entregas para el Excel; `historial` va `[]`)
 *   GET    /api/compras/[id]                             → CompraApi     (con `historial`)
 *   GET    /api/compras/[id]/historial                   → EventoCompraApi[]
 *   GET    /api/compras/proveedores                      → ProveedorApi[]
 *   POST   /api/compras/[id]/recibir                     → CompraApi
 *   DELETE /api/compras/[id]/recepciones/[recepcionId]   → CompraApi
 *   POST   /api/compras/[id]/cancelar                    → CompraApi
 *   POST   /api/compras/importar                         → ReporteImportacionComprasApi
 * Errores: `{ error, codigo }` con `CodigoErrorCompra`, su estado en `ESTADO_HTTP_ERROR_COMPRA` y su texto en
 * `MENSAJE_ERROR_COMPRA`.
 */
import type { MotivoResolverGml } from "@/lib/arbol/tipos";
import type {
  AccionEvento,
  DestinoCompra,
  EstadoCompra,
  Mes,
  Moneda,
  MotivoFuncionCompra,
  OrigenCompra,
  OrigenEntrega,
  OrigenRecepcion,
  TallasCompra,
  TipoLinea,
} from "./tipos";

export type { AccionEvento, DestinoCompra, EstadoCompra, Mes, Moneda, OrigenCompra, OrigenEntrega, OrigenRecepcion, TallasCompra, TipoLinea };

// ─── Códigos de error ───

/** `0.13.0`. Los de `0.13.1` (`unidades_menores_que_recibidas`, `sin_reparto_con_recepciones`, `saldo_cerrado`, …) se fijan entonces. */
export type CodigoErrorCompra =
  | "compra_no_encontrada"
  | "compra_cambio"
  | "no_pertenece"
  | "no_editable"
  | "excede_pendiente"
  | "recepcion_antes_de_compra"
  | "recibida"
  | "carga_inicial_requerida"
  | "clave_existente"
  | "proveedor_inactivo";

/** Los que una función de escritura devuelve como `motivo` coinciden con el código de la API. */
export const ESTADO_HTTP_ERROR_COMPRA: Record<CodigoErrorCompra, number> = {
  compra_no_encontrada: 404,
  compra_cambio: 409,
  no_pertenece: 404,
  no_editable: 409,
  excede_pendiente: 409,
  recepcion_antes_de_compra: 409,
  recibida: 409,
  carga_inicial_requerida: 400,
  clave_existente: 409,
  proveedor_inactivo: 409,
};

export const MENSAJE_ERROR_COMPRA: Record<CodigoErrorCompra, string> = {
  compra_no_encontrada: "No encontramos esa compra.",
  compra_cambio: "Otra persona cambió esta compra mientras la mirabas: recarga la pantalla.",
  no_pertenece: "Esa línea, entrega o recepción no pertenece a esta compra.",
  no_editable: "La compra está cancelada y ya no se puede modificar.",
  excede_pendiente: "Las unidades superan lo que falta recibir de la línea.",
  recepcion_antes_de_compra: "El ingreso no puede ser de un mes anterior a la fecha de la compra.",
  recibida: "Ya llegó todo: no hay saldo que cancelar.",
  carga_inicial_requerida: "Por ahora solo se pueden importar compras ya hechas: marca la casilla «Carga inicial de compras ya hechas».",
  clave_existente: "Otra importación creó alguna de estas líneas mientras revisabas: vuelve a previsualizar.",
  proveedor_inactivo: "Ese proveedor está desactivado: elige otro.",
};

/** `motivo` de una función de escritura → código de la API (son el mismo texto; la comprobación de tipos impide olvidar uno). */
export const CODIGO_DE_MOTIVO: Record<MotivoFuncionCompra, CodigoErrorCompra> = {
  compra_cambio: "compra_cambio",
  no_pertenece: "no_pertenece",
  no_editable: "no_editable",
  excede_pendiente: "excede_pendiente",
  recepcion_antes_de_compra: "recepcion_antes_de_compra",
  recibida: "recibida",
  clave_existente: "clave_existente",
  proveedor_inactivo: "proveedor_inactivo",
};

// ─── Compra ───

export type RepartoLineaApi = { marca_id: string; marca: string; gml_id: string; equivalencia_id: string | null; ruta: string; unidades: number };

export type AvisoRecepcion = "recepcion_en_mes_cerrado" | "recibida_futura" | "recepcion_sin_respaldo" | "recepcion_sobre_saldo_cancelado";

export type AvisoLineaCompra =
  | "sin_reparto"
  | "reparto_cambio"
  | "exceso"
  | "entrega_vencida"
  | "entrega_pasada"
  | "miembro_resuelto"
  | "directo_con_regla"
  | "directo_sin_regla";

export type EntregaLineaApi = {
  id: string;
  periodo: Mes;
  unidades: number;
  /** Unidades recibidas que le tocan por FIFO. */
  asignadas: number;
  /** Unidades de saldo cerrado que le tocan (§0.11). */
  canceladas: number;
  pendiente: number;
  /** `periodo ≤ k'` con pendiente > 0: el flujo la sigue esperando en `k'+1` hasta confirmar su ingreso (§0.5). */
  vencida: boolean;
  /** Mes X y unidades que propone la conciliación para confirmar su ingreso (nulo si no hay). */
  sugerencia: { periodo: Mes; unidades: number } | null;
  temporada: "verano" | "invierno";
  origen: OrigenEntrega;
};

export type RecepcionLineaApi = {
  id: string;
  recibida_periodo: Mes;
  unidades: number;
  fecha_recepcion: string;
  origen: OrigenRecepcion;
  usuario_nombre: string | null;
  nota: string | null;
  avisos: AvisoRecepcion[];
};

export type RepartoGuardadoApi = {
  reparto_id: string | null;
  version: number | null;
  error_reparto_pp: number | null;
  /** `false` si M12 ya aprobó otra versión: la línea avisa `reparto_cambio` (se aplica desde `0.13.1`). */
  vigente: boolean;
  por_entrega: { entrega_id: string; temporada: string | null; filas: RepartoLineaApi[] }[];
  /** Suma de las entregas. */
  filas: RepartoLineaApi[];
};

export type LineaCompraApi = {
  id: string;
  compra_id: string;
  tipo: TipoLinea;
  gml_id: string | null;
  equivalencia_id: string | null;
  ruta: string | null;
  marca_id: string | null;
  marca: string | null;
  agrupacion_marca_id: string | null;
  agrupacion_marca: string | null;
  tallas: TallasCompra;
  unidades: number;
  unidades_recibidas: number;
  /** Saldo cerrado al cancelar con recepciones (§0.11); las `unidades` originales se conservan para el historial y el costo. */
  unidades_canceladas: number;
  costo_unitario: number | null;
  /** Primera entrega. */
  llegada_periodo: Mes;
  destino: DestinoCompra;
  tienda: { id: string; codigo: string } | null;
  alcance: { generos: string[]; mundos: string[]; lineas: string[] } | null;
  /** Solo `barrer_mezcla` (M9a). */
  mezcla: { marca_id: string; gml_id: string; equivalencia_id: string | null; pct: number }[] | null;
  entregas: EntregaLineaApi[];
  /** Nulo en una línea específica y en un lote `sin_reparto`. */
  reparto: RepartoGuardadoApi | null;
  recepciones: RecepcionLineaApi[];
  nota: string | null;
  avisos: AvisoLineaCompra[];
};

export type PersonaFechaApi = { nombre: string | null; at: string };

export type CompraApi = {
  id: string;
  numero: string;
  proveedor: { id: string; nombre: string; es_intercompany: boolean };
  origen: OrigenCompra;
  estado: EstadoCompra;
  /** `estado = 'recibida'` con `cancelada_por`: compra cancelada con recepciones (§0.11). */
  saldo_cerrado: boolean;
  fecha_compra: string;
  referencia: string | null;
  moneda: Moneda;
  nota: string | null;
  justificacion_exceso: string | null;
  excede_tope_al_confirmar: { periodo: Mes; imi: number; exceso: number }[];
  creada_por: PersonaFechaApi;
  modificada_por: PersonaFechaApi | null;
  confirmada_por: PersonaFechaApi | null;
  cancelada_por: (PersonaFechaApi & { motivo: string }) | null;
  lineas: LineaCompraApi[];
  totales: { unidades: number; costo: number | null; recibidas: number };
  llegadas: { desde: Mes; hasta: Mes; entregas: number } | null;
  /** Filtro «mis líneas»: nunca un permiso. */
  mia: boolean;
  /** Versión para la concurrencia: toda escritura la lleva y recibe `409 compra_cambio` si ya no es la vigente. */
  revision: number;
  puede: { editar: boolean; confirmar: boolean; recibir: boolean; cancelar: boolean; aplicar_reparto: boolean };
  /** Solo en el detalle; en la lista va `[]`. */
  historial: EventoCompraApi[];
  /** Avisos de sus líneas, sin repetir. */
  avisos: AvisoLineaCompra[];
};

export type EventoCompraApi = {
  id: string;
  linea_id: string | null;
  accion: AccionEvento;
  antes: unknown | null;
  despues: unknown | null;
  motivo: string | null;
  resumen: string | null;
  usuario_nombre: string | null;
  created_at: string;
};

// ─── Proveedores ───

export type ProveedorApi = {
  id: string;
  codigo: string | null;
  nombre: string;
  pais: string | null;
  ciudad: string | null;
  identificacion: string | null;
  es_intercompany: boolean;
  nota: string | null;
  activo: boolean;
  /** Compras no canceladas del proveedor. */
  compras: number;
  /** Desde M9a; en `0.13.0` siempre `[]`. */
  contactos: { id: string; nombre: string; cargo: string | null; telefono: string | null; correo: string | null }[];
};

// ─── Importador de carga inicial (§0.13, 4.7) ───

export type ModoImportacionCompras = "previsualizar" | "aplicar";
export type ClasificacionLineaImportada = "nueva" | "igual" | "cambiada";

export type MotivoOmisionCompra =
  | MotivoResolverGml
  | "marca_desconocida"
  | "marca_inactiva"
  | "marca_y_agrupacion"
  | "sin_marca_ni_agrupacion"
  | "agrupacion_desconocida"
  | "equivalencia_desconocida"
  | "equivalencia_requiere_gmle"
  | "equivalencia_de_otro_nodo"
  | "tipo_invalido"
  | "tipo_no_disponible"
  | "gml_requerido"
  | "modalidad_no_barrer"
  | "alcance_invalido"
  | "alcance_vacio"
  | "tallas_invalida"
  | "unidades_invalida"
  | "costo_invalido"
  | "moneda_invalida"
  | "llegada_invalida"
  | "entregas_invalidas"
  | "recibidas_invalida"
  | "destino_desconocido"
  | "proveedor_requerido"
  | "proveedor_inactivo"
  | "fecha_requerida"
  | "fecha_invalida"
  | "referencia_requerida"
  | "linea_requerida"
  | "linea_repetida"
  | "cabecera_inconsistente"
  | "cambiada_requiere_edicion"
  | "sin_reparto"
  | "mezcla_sin_filas"
  | "mezcla_no_suma_100";

/** Avisos que no bloquean (`sin_reparto` es omisión en `0.13.0` y aviso desde `0.13.1`). */
export type AvisoImportacionCompra = "sin_reparto" | "entrega_pasada" | "directo_con_regla" | "directo_sin_regla" | "exceso" | "miembro_resuelto";

export type FilaOmitidaCompra = {
  /** Número de fila del archivo (1-based). */
  fila: number;
  motivo: MotivoOmisionCompra;
  detalle?: string;
  proveedor: string;
  referencia: string;
  linea_ordinal: string;
  /** Solo en `linea_repetida`: la primera aparición de la misma clave. */
  fila_original?: number;
};

export type LineaImportacionApi = {
  fila: number;
  /** `PROVEEDOR | REFERENCIA | LINEA` normalizada (§0.13). */
  clave: string;
  compra_clave: string;
  linea_ordinal: number;
  clasificacion: ClasificacionLineaImportada;
  tipo: TipoLinea;
  ruta: string | null;
  marca: string | null;
  agrupacion_marca: string | null;
  unidades: number;
  recibidas: number;
  entregas: { periodo: Mes; unidades: number }[];
  avisos: AvisoImportacionCompra[];
  /** Solo `cambiada`: qué cambió, en castellano («unidades 500 → 600»). */
  cambios: string[];
};

export type CompraImportacionApi = {
  clave: string;
  proveedor: string;
  referencia: string;
  fecha_compra: string;
  moneda: Moneda;
  lineas: number;
  lineas_nuevas: number;
  /** Si la compra ya existe (no cancelada) y el archivo solo agrega líneas. */
  existente: { compra_id: string; numero: string } | null;
};

export type AplicadaImportacionApi = { clave: string; compra_id: string; numero: string; lineas: number };
export type NoAplicadaImportacionApi = { clave: string; proveedor: string; referencia: string; motivo: MotivoFuncionCompra | "error"; mensaje: string };

export type ReporteImportacionComprasApi = {
  modo: ModoImportacionCompras;
  carga_inicial: boolean;
  /** Último mes publicado con el que se evaluó `entrega_pasada` y `RECIBIDAS`. */
  k_prima: Mes | null;
  totales: { recibidas: number; procesadas: number; omitidas: number; nuevas: number; iguales: number; cambiadas: number };
  compras_a_crear: CompraImportacionApi[];
  proveedores_a_crear: string[];
  lineas: LineaImportacionApi[];
  omitidas: FilaOmitidaCompra[];
  avisos: { fila: number; aviso: AvisoImportacionCompra; detalle?: string }[];
  /** Solo con `modo = "aplicar"`: una función por compra, todo o nada por compra (§0.13). */
  aplicadas: AplicadaImportacionApi[];
  no_aplicadas: NoAplicadaImportacionApi[];
};

// ─── Cuerpos de petición (tipos de pantalla; los esquemas están en `esquemas.ts`) ───

export type RecepcionCuerpo = { linea_id: string; recibida_periodo: Mes; unidades: number; fecha_recepcion: string; nota?: string };
export type RecibirCuerpo = { revision: number; recepciones: RecepcionCuerpo[] };
export type CancelarCuerpo = { motivo: string; revision: number };

// ─── Etiquetas de pantalla ───

export const ETIQUETA_ESTADO_COMPRA: Record<EstadoCompra, string> = {
  borrador: "Borrador",
  confirmada: "Confirmada",
  recibida: "Recibida",
  cancelada: "Cancelada",
};

export const ETIQUETA_ORIGEN_COMPRA: Record<OrigenCompra, string> = {
  comprador: "Comprador",
  carga_inicial: "Carga inicial",
  intercompany_cd: "CD intercompany",
};

export const ETIQUETA_TIPO_LINEA: Record<TipoLinea, string> = {
  especifica: "Específica",
  barrer_marca: "Lote de una marca",
  barrer_mezcla: "Lote de varias marcas",
};

export const ETIQUETA_ACCION_EVENTO: Record<AccionEvento, string> = {
  crear: "Creó la compra",
  editar_cabecera: "Editó la cabecera",
  agregar_linea: "Agregó una línea",
  editar_linea: "Editó una línea",
  quitar_linea: "Quitó una línea",
  confirmar: "Confirmó la compra",
  recibir: "Confirmó un ingreso",
  quitar_recepcion: "Quitó un ingreso",
  cancelar: "Canceló la compra",
  aplicar_reparto: "Aplicó el reparto vigente",
  importar: "Importó la línea",
};
