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
 *   PUT    /api/compras/[id]/oc                          → RespuestaEditarOcApi   (08b-1b: registrar, cambiar o quitar la OC)
 * Errores: `{ error, codigo }` con `CodigoErrorCompra`, su estado en `ESTADO_HTTP_ERROR_COMPRA` y su texto en
 * `MENSAJE_ERROR_COMPRA`.
 */
import type { MotivoResolverGml } from "@/lib/arbol/tipos";
import type { AgrupadorImportacionCompraApi, MotivoOmisionCompraAgrupador, ProximoHitoApi, TramoLineaTiempoApi, ViajeResumenApi } from "./agrupadores/tipos-api";
import type {
  AccionEvento,
  AvisoOc,
  DestinoCompra,
  EstadoCompra,
  Mes,
  Moneda,
  MotivoFuncionCompra,
  MotivoFuncionOc,
  OrigenCompra,
  OrigenEntrega,
  OrigenRecepcion,
  TallasCompra,
  TipoLinea,
} from "./tipos";

export type { AccionEvento, AvisoOc, DestinoCompra, MotivoFuncionOc, EstadoCompra, Mes, Moneda, OrigenCompra, OrigenEntrega, OrigenRecepcion, TallasCompra, TipoLinea };

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
  | "proveedor_inactivo"
  // Número de OC (08b-1b §2.11): `PUT /api/compras/[id]/oc`.
  | "no_encontrado"
  | "sin_cambios"
  | "oc_cambio"
  | "oc_repetida"
  | "oc_invalida";

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
  no_encontrado: 404,
  sin_cambios: 409,
  oc_cambio: 409,
  oc_repetida: 409,
  oc_invalida: 400,
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
  no_encontrado: "No encontramos esa compra.",
  sin_cambios: "La OC ya es esa: no hay nada que cambiar.",
  oc_cambio: "Otra persona cambió la OC mientras editabas: vuelve a abrirla.",
  oc_repetida: "Esa OC ya está en otra compra de este proveedor. Una OC es de una sola compra.",
  oc_invalida: "La OC admite letras, números, guiones, barras, puntos, guiones bajos y espacios (hasta 40 caracteres).",
};

/** `motivo` de `editar_oc_compra` → código de la API (el mismo texto; `no_editable` ya existe). */
export const CODIGO_DE_MOTIVO_OC: Record<MotivoFuncionOc, CodigoErrorCompra> = {
  no_encontrado: "no_encontrado",
  no_editable: "no_editable",
  sin_cambios: "sin_cambios",
  oc_cambio: "oc_cambio",
  oc_repetida: "oc_repetida",
  oc_invalida: "oc_invalida",
};

/** Texto de `oc_repetida` con los datos: «La OC 4500012345 ya está en C-000201 de este proveedor. Una OC es de una sola compra». */
export const mensajeOcRepetida = (numeroOc: string, compraNumero: string): string =>
  `La OC ${numeroOc} ya está en ${compraNumero} de este proveedor. Una OC es de una sola compra: revisa el número o cancela la otra compra.`;

/** Texto de `oc_de_otro_proveedor`: «La OC 4500012345 también está en C-000202 de Feria Sur: ¿es otra orden?». */
export const mensajeOcDeOtroProveedor = (numeroOc: string, compraNumero: string, proveedor: string): string =>
  `La OC ${numeroOc} también está en ${compraNumero} de ${proveedor}: ¿es otra orden?`;

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
  /**
   * Agrupadores (ficha 08b, §3.3): a qué embarques y paquetes viajan las unidades de esta entrega. Siempre presente en las respuestas de
   * la API; opcional en el tipo solo para no tocar los fixtures de M8.
   */
  asignaciones?: AsignacionEntregaApi[];
  /** Unidades de la entrega que ningún embarque cubre («120 u sin embarque»). */
  sin_embarque?: number;
};

/** Una asignación de la entrega a un embarque (y paquete): los chips `Embarque 261101 · P 261101 · 300 u`. */
export type AsignacionEntregaApi = {
  id: string;
  embarque: { id: string; codigo: string };
  paquete: { id: string; codigo: string } | null;
  unidades: number;
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
  /** El viaje de la compra (ficha 08b; nulo si no tiene). Siempre presente en las respuestas de la API; opcional en el tipo por los fixtures de M8. */
  viaje?: ViajeResumenApi | null;
  /** Número de la orden de compra real (08b-1b §2.11; el «código X» es `numero`). Nulo = «OC sin registrar». */
  numero_oc: string | null;
  /**
   * Línea de tiempo de la compra: un tramo por (embarque, paquete) y uno «Sin embarque» por mes con unidades sin embarque, siempre
   * Pendiente (§3.4). En el detalle trae también fecha original y reprogramaciones; en la lista (la que alimenta el Excel) van en 0.
   */
  linea_de_tiempo: TramoLineaTiempoApi[];
  /** El hito más urgente de la compra (§3.3); nulo si todos sus tramos están completos. */
  proximo_hito: ProximoHitoCompraApi | null;
};

/** `ProximoHitoApi` más el embarque del tramo y cuántos tramos más tiene la compra («+1 tramo»). */
export type ProximoHitoCompraApi = ProximoHitoApi & { embarque_codigo: string | null; tramos_mas: number };

/** Cuerpo de `PUT /api/compras/[id]/oc` (el esquema es `editarOcSchema`). `antes` es la OC que vio el formulario; `numero_oc = null` la quita. */
export type EditarOcCuerpo = { antes: string | null; numero_oc: string | null; motivo?: string };

export type AvisoOcApi = { aviso: AvisoOc; detalle: string };

/** `PUT /api/compras/[id]/oc`. La revisión de la compra NO sube (§2.11). */
export type RespuestaEditarOcApi = { compra: { id: string; numero: string; numero_oc: string | null }; avisos: AvisoOcApi[] };

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
  | "proveedor_largo"
  | "proveedor_inactivo"
  | "fecha_requerida"
  | "fecha_invalida"
  | "referencia_requerida"
  | "referencia_larga"
  | "linea_requerida"
  | "linea_repetida"
  | "cabecera_inconsistente"
  | "cambiada_requiere_edicion"
  | "compra_no_borrador"
  | "sin_reparto"
  | "mezcla_sin_filas"
  | "mezcla_no_suma_100"
  // Columnas VIAJE, EMBARQUE y PAQUETE (ficha 08b, §3.9): el importador no crea agrupadores.
  | MotivoOmisionCompraAgrupador;

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
export type NoAplicadaImportacionApi = { clave: string; proveedor: string; referencia: string; motivo: MotivoFuncionCompra | "saldo_cerrado" | "compra_no_borrador" | "error"; mensaje: string };

/** Qué pasó con la OC de una compra del archivo (columna `OC`, 08b-1b §3.7). */
export type AccionOcImportacion = "registrada" | "cambiada" | "sin_cambio" | "omitida";
/** Por qué la OC de una compra no se aplicó; las líneas de la compra siguen su regla. */
export type MotivoOcImportacion =
  | "oc_repetida"
  | "oc_distinta_en_compra"
  | "oc_no_editable"
  | "oc_invalida"
  /** Solo al aplicar: la OC de la compra cambió entre la previsualización y `editar_oc_compra` (otra persona la tocó). */
  | "oc_cambio"
  /** Solo al aplicar: la OC no se llegó a escribir (la compra no se aplicó, no se encontró o la base falló); reimportar la completa. */
  | "oc_no_aplicada";

/** Una entrada por compra del archivo que trae `OC` (o ya la tenía y el archivo la cambia). */
export type OcImportacionApi = {
  compra_clave: string;
  proveedor: string;
  referencia: string;
  /** La compra existente; nulo si se creará con este archivo (su número se conoce al aplicar). */
  compra: { id: string; numero: string } | null;
  /** La OC que trae el archivo, sin espacios al borde; nulo si no trae. */
  numero_oc: string | null;
  /** La guardada hoy en la compra (`antes` de `editar_oc_compra`). */
  antes: string | null;
  accion: AccionOcImportacion;
  motivo?: MotivoOcImportacion;
  detalle?: string;
  avisos: AvisoOcApi[];
};

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
  /**
   * Qué hicieron las columnas `VIAJE`, `EMBARQUE` y `PAQUETE` (ficha 08b, §3.9): una entrada por cada fila que las traía. Siempre presente
   * (vacío si el archivo no las usa); opcional en el tipo por los fixtures de M8.
   */
  agrupadores?: AgrupadorImportacionCompraApi[];
  /** Qué hizo la columna `OC` por compra (08b-1b §3.7). Vacío si el archivo no la usa; opcional en el tipo por los fixtures de M8. */
  oc?: OcImportacionApi[];
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
  asignar_viaje: "Asignó el viaje de la compra",
  asignar_agrupador: "Asignó entregas a un embarque",
  mover_entregas: "Movió entregas de embarque o de fecha",
  recibir_embarque: "Confirmó el ingreso con un embarque",
  editar_oc: "Cambió el número de OC",
};
