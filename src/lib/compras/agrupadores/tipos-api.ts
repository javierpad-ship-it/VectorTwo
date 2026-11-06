/**
 * Contrato JSON de los agrupadores de compras: viajes, embarques y paquetes (docs/modulos/08b-agrupadores-de-compras.md, §2, §3.2,
 * §3.3 y §3.11; entrega 08b-1, con lo de 08b-2 marcado). ARCHIVO AUTOCONTENIDO: lo importa también la pantalla, así que no importa
 * de `@supabase/*` ni de módulos de servidor. Congelado al terminar T0: si falta un campo, se pide a `backend`.
 *
 * Convenciones: meses como `aaaa-mm` (`periodo`, `periodo_llegada`); fechas como `aaaa-mm-dd`; instantes ISO; unidades enteras; costo
 * en la moneda de cada compra, sumado por moneda (`{ PEN, USD }`: nunca se mezclan monedas).
 *
 * Respuestas de las rutas (todas dentro de `{ data }`; guard y errores en §3.3 de la ficha):
 *   GET    /api/compras/viajes                              → RespuestaViajesApi
 *   POST   /api/compras/viajes                              → { viaje: ViajeApi }
 *   GET    /api/compras/viajes/[id]                         → ViajeDetalleApi
 *   PATCH  /api/compras/viajes/[id]                         → { viaje: ViajeApi }
 *   POST   /api/compras/viajes/[id]/estado                  → { viaje: ViajeApi }
 *   POST   /api/compras/viajes/[id]/compras                 → RespuestaAsignarViajeApi
 *   GET    /api/compras/embarques                           → { embarques: EmbarqueApi[] }
 *   POST   /api/compras/embarques                           → { embarque: EmbarqueApi }
 *   GET·PATCH /api/compras/embarques/[id]                   → { embarque: EmbarqueDetalleApi }
 *   POST   /api/compras/embarques/[id]/estado               → { embarque: EmbarqueDetalleApi }
 *   POST   /api/compras/embarques/[id]/paquetes · /api/compras/paquetes/[id] (POST·PATCH) → { embarque: EmbarqueDetalleApi }
 *   POST   /api/compras/paquetes/[id]/estado                → { embarque: EmbarqueDetalleApi }
 *   POST   /api/compras/paquetes/[id]/mover · /api/compras/embarques/[id]/{asignar,quitar,paquete,fecha,pasar-pendientes,recibir,
 *          revertir-recepcion}                              → RespuestaMovimientoApi, o PlanMovimientoApi con `?previsualizar=1`
 *   POST   /api/compras/embarques/[id]/fechas               → RespuestaMovimientoApi, o PlanFechasApi con `?previsualizar=1` (08b-1b §3.2)
 *   POST   /api/compras/paquetes/[id]/ingreso               → RespuestaMovimientoApi, o PlanFechasApi con `?previsualizar=1` (08b-1b §3.2)
 *   PUT    /api/compras/[id]/oc                             → RespuestaEditarOcApi (en `src/lib/compras/tipos-api.ts`; 08b-1b §3.2)
 *   GET    /api/compras/agrupadores/sin-asignar             → SinAgrupadorApi
 *   GET    /api/compras/agrupadores/opciones                → OpcionesAgrupadoresApi
 *   GET    /api/compras/agrupadores/historial               → { eventos: EventoAgrupadorApi[] }
 *   POST   /api/compras/agrupadores/importar                → ReporteImportacionAgrupadoresApi
 *   PUT    /api/compras/viaje-activo                        → { viaje_activo: ViajeActivoApi }
 * Errores: `{ error, codigo }` con `CodigoErrorAgrupador`, su estado en `ESTADO_HTTP_ERROR_AGRUPADOR` y su texto en
 * `MENSAJE_ERROR_AGRUPADOR`.
 */
import type { Rol } from "@/lib/auth/roles";
import type {
  AccionAgrupadorEvento,
  AvisoAgrupador,
  AvisoImportacionAgrupador,
  AvisoImportacionCompraAgrupador,
  CausaFecha,
  ClasificacionAgrupadorImportado,
  EstadoEmbarque,
  EstadoHito,
  Hito,
  HitoConfirmable,
  EstadoPaquete,
  EstadoViaje,
  MotivoFuncionAgrupador,
  MotivoOmisionAgrupador,
  MotivoOmisionCompraAgrupador,
  OperacionMovimiento,
  OrigenResponsable,
  RecepcionEmbarque,
  TipoAgrupador,
  TipoEmbarque,
} from "./tipos";
import { CAUSAS_FECHA, ESTADOS_HITO, HITOS } from "./tipos";
import type { EstadoCompra, Mes, Moneda, TallasCompra, TipoLinea } from "@/lib/compras/tipos";

export type {
  AccionAgrupadorEvento,
  AvisoAgrupador,
  AvisoImportacionAgrupador,
  AvisoImportacionCompraAgrupador,
  CausaFecha,
  ClasificacionAgrupadorImportado,
  EstadoEmbarque,
  EstadoHito,
  Hito,
  HitoConfirmable,
  EstadoPaquete,
  EstadoViaje,
  MotivoOmisionAgrupador,
  MotivoOmisionCompraAgrupador,
  OperacionMovimiento,
  OrigenResponsable,
  RecepcionEmbarque,
  TipoAgrupador,
  TipoEmbarque,
};

// ─── Códigos de error ───

/**
 * Códigos de las funciones de escritura (`MotivoFuncionAgrupador`, que la API devuelve tal cual) más los que pone la API:
 * `plan_cambio` (la vista previa ya no vale, R19), `vuelve_a_previsualizar` (`clave_existente` del importador) y las respuestas de
 * lectura. Los `403` los da el guard y no llevan código.
 */
export type CodigoErrorAgrupador = Exclude<MotivoFuncionAgrupador, "clave_existente"> | "plan_cambio" | "vuelve_a_previsualizar";

export const ESTADO_HTTP_ERROR_AGRUPADOR: Record<CodigoErrorAgrupador, number> = {
  agrupador_cambio: 409,
  codigo_duplicado: 409,
  codigo_invalido: 409,
  correlativo_agotado: 409,
  no_encontrado: 404,
  no_editable: 409,
  responsable_no_asignable: 409,
  fecha_por_movimiento: 409,
  salida_despues_de_llegada: 409,
  local_con_viaje: 409,
  viaje_cancelado: 409,
  embarque_no_editable: 409,
  transicion_invalida: 409,
  tiene_asignaciones_activas: 409,
  tiene_compras: 409,
  tiene_recepciones: 409,
  motivo_requerido: 409,
  compra_cambio: 409,
  no_pertenece: 404,
  embarque_con_recepciones: 409,
  asignacion_con_recepciones: 409,
  excede_entrega: 409,
  compra_no_asignable: 409,
  saldo_cerrado: 409,
  max_entregas: 409,
  sin_pendientes: 409,
  paquete_de_otro_embarque: 409,
  reparto_sin_vector: 409,
  sin_cambios: 409,
  causa_requerida: 409,
  fecha_requerida: 409,
  fecha_futura: 409,
  puerto_en_local: 409,
  hora_sin_fecha: 409,
  hito_confirmado: 409,
  no_confirmada: 409,
  excede_pendiente: 409,
  recepcion_antes_de_compra: 409,
  sin_unidades: 409,
  llegada_futura: 409,
  recepcion_cambio: 409,
  plan_cambio: 409,
  vuelve_a_previsualizar: 409,
};

/** Textos para mostrar en pantalla, en castellano llano. */
export const MENSAJE_ERROR_AGRUPADOR: Record<CodigoErrorAgrupador, string> = {
  agrupador_cambio: "Otra persona cambió esto mientras lo mirabas: recarga la pantalla.",
  codigo_duplicado: "Ya existe uno con ese código.",
  codigo_invalido: "El código solo admite letras, números y guiones (hasta 30 caracteres).",
  correlativo_agotado: "Ya se usaron los 99 códigos de ese mes: escribe el código a mano.",
  no_encontrado: "No encontramos eso.",
  no_editable: "Está cancelado y ya no se puede modificar.",
  responsable_no_asignable: "Ese responsable no está disponible: elige un comprador o un administrador activo.",
  fecha_por_movimiento: "Las fechas del embarque se cambian con «Cambiar fechas», porque pueden mover las entregas.",
  salida_despues_de_llegada: "El zarpe no puede ser posterior al ingreso al CD.",
  local_con_viaje: "Un embarque local no lleva viaje.",
  viaje_cancelado: "El viaje está cancelado: no admite cambios.",
  embarque_no_editable: "El embarque está cancelado o recibido: solo se puede quitar mercadería de él.",
  transicion_invalida: "Ese cambio de estado no es posible desde el estado actual.",
  tiene_asignaciones_activas: "Todavía tiene mercadería asignada: quítala o pásala a otro embarque antes de cancelar.",
  tiene_compras: "Todavía tiene compras o embarques sin cancelar.",
  tiene_recepciones: "Ya tiene ingresos confirmados: quítalos primero.",
  motivo_requerido: "Escribe el motivo.",
  compra_cambio: "Otra persona cambió una de las compras mientras la mirabas: revisa la vista previa.",
  no_pertenece: "El embarque cambió mientras lo mirabas: esa asignación, paquete o entrega ya no corresponde. Se vuelve a leer; revisa y repite la acción.",
  embarque_con_recepciones: "Este embarque ya tiene ingresos confirmados: lo que falta se pasa a otro embarque.",
  asignacion_con_recepciones: "Esa mercadería ya tiene ingresos confirmados y no se puede mover.",
  excede_entrega: "Las unidades superan lo que queda sin asignar en la entrega.",
  compra_no_asignable: "Esa compra ya está recibida o cancelada: no se puede asignar.",
  saldo_cerrado: "Esa compra tiene el saldo cerrado: no se puede mover su cronograma.",
  max_entregas: "Esa línea llegaría a más de 24 entregas: el máximo es 24.",
  sin_pendientes: "No hay unidades pendientes que pasar.",
  paquete_de_otro_embarque: "Ese paquete es de otro embarque.",
  reparto_sin_vector: "El reparto de esa marca no tiene vector para la temporada del mes nuevo: pide a Planificación que lo complete.",
  sin_cambios: "No hay nada que cambiar: las fechas ya son esas.",
  causa_requerida: "Elige la causa de la reprogramación.",
  fecha_requerida: "Falta la fecha de un hito que ya figura como ocurrido, o el ingreso al CD.",
  fecha_futura: "Este hito ya figura como ocurrido: no puede tener una fecha futura. Para moverlo a una fecha futura, desmarca «¿Ya ocurrió?».",
  puerto_en_local: "Un embarque local no pasa por puerto: quita el arribo.",
  hora_sin_fecha: "Pon la fecha del inicio operativo antes que la hora.",
  hito_confirmado: "Este embarque ya tiene hitos marcados como ocurridos: no puede volver a planificado.",
  no_confirmada: "Una de las compras sigue en borrador: confírmala antes de recibirla.",
  excede_pendiente: "Las unidades superan lo que falta recibir.",
  recepcion_antes_de_compra: "El ingreso no puede ser de un mes anterior a la fecha de la compra.",
  sin_unidades: "Indica al menos una unidad que recibir.",
  llegada_futura: "La fecha de llegada no puede ser posterior a hoy.",
  recepcion_cambio: "Lo pendiente cambió desde que lo viste: revisa y vuelve a confirmar.",
  plan_cambio: "Cambió lo que ibas a mover: revisa la vista previa.",
  vuelve_a_previsualizar: "Alguien creó alguno de estos registros mientras revisabas: vuelve a previsualizar.",
};

// ─── Piezas comunes ───

export type PersonaFechaApi = { nombre: string | null; at: string };

/** Totales de costo por moneda. */
export type CostoPorMonedaApi = Record<Moneda, number>;

/** Un perfil como responsable. */
export type ResponsableApi = { perfil_id: string; nombre: string | null };

/**
 * Responsable efectivo (§2.8): `paquete ?? embarque ?? viaje`; nulo si ningún nivel lo tiene. `origen = 'propio'` es el del propio
 * nivel (para editar un embarque o un paquete: `origen === 'propio'` ⇒ su `responsable_id` es `perfil_id`; si no, es nulo).
 * Que no sea asignable (desactivado, o ya no es comprador ni admin) se avisa con `sin_responsable` en `avisos`.
 */
export type ResponsableEfectivoApi = { perfil_id: string; nombre: string | null; origen: OrigenResponsable };

/** Perfil asignable como responsable: comprador o admin activos (§2.8, R26). */
export type AsignableApi = { perfil_id: string; nombre: string | null; email: string; rol: Extract<Rol, "comprador" | "admin"> };

/** Aviso con texto («El viaje 261001 está cerrado: igual se registra»). */
export type AvisoDetalleApi = { aviso: AvisoAgrupador; detalle?: string };

/** El viaje de un embarque o de una compra, resumido. */
export type ViajeResumenApi = { id: string; codigo: string; nombre: string; estado: EstadoViaje };

export type ProveedorResumenApi = { id: string; nombre: string };

// ─── Viaje (§2.3) ───

export type ViajeApi = {
  id: string;
  codigo: string;
  nombre: string;
  destino: string | null;
  fecha_inicio: string;
  fecha_fin: string | null;
  estado: EstadoViaje;
  /** Versión para la concurrencia: toda edición la lleva y recibe `409 agrupador_cambio` si ya no es la vigente. */
  revision: number;
  nota: string | null;
  /** El del propio viaje (obligatorio al crear; nulo solo si se borró el perfil). */
  responsable: ResponsableApi | null;
  /** `false` si el responsable ya no es asignable (desactivado o cambió de rol): también sale `sin_responsable` en `avisos`. */
  responsable_valido: boolean;
  totales: {
    /** Compras no canceladas del viaje. */
    compras: number;
    unidades: number;
    costo: CostoPorMonedaApi;
    /** Embarques no cancelados del viaje. */
    embarques: number;
    /** Unidades de sus compras sin asignar a ningún embarque. */
    unidades_sin_embarque: number;
  };
  avisos: AvisoAgrupador[];
  creado_por: PersonaFechaApi;
  modificado_por: PersonaFechaApi | null;
};

/** `GET /api/compras/viajes`. `asignables` es la lista de responsables posibles (§2.8). */
export type RespuestaViajesApi = { viajes: ViajeApi[]; asignables: AsignableApi[] };

/** Compra resumida dentro de un viaje (para «agregar y quitar compras»). */
export type CompraDeViajeApi = {
  id: string;
  numero: string;
  revision: number;
  estado: EstadoCompra;
  proveedor: ProveedorResumenApi;
  fecha_compra: string;
  unidades: number;
  costo: CostoPorMonedaApi;
  /** Unidades de la compra sin embarque. */
  unidades_sin_embarque: number;
};

/** `GET /api/compras/viajes/[id]`. */
export type ViajeDetalleApi = { viaje: ViajeApi; compras: CompraDeViajeApi[]; embarques: EmbarqueApi[] };

/** `POST /api/compras/viajes/[id]/compras`: `compras` son las revisiones nuevas. Con el viaje cerrado, `avisos` trae `viaje_cerrado`. */
export type RespuestaAsignarViajeApi = { viaje: ViajeApi; compras: { id: string; revision: number }[]; avisos: AvisoDetalleApi[] };

// ─── Paquete (§2.5) ───

export type PaqueteApi = {
  id: string;
  embarque_id: string;
  codigo: string;
  nombre: string;
  estado: EstadoPaquete;
  nota: string | null;
  responsable_efectivo: ResponsableEfectivoApi | null;
  totales: {
    /** Asignaciones activas. */
    asignaciones: number;
    compras: number;
    lineas: number;
    unidades: number;
    /** «Estimado» en 08b-1 (FIFO de M8); exacto desde 08b-2. */
    recibidas: number;
    pendientes: number;
    historicas: number;
  };
  avisos: AvisoAgrupador[];
} & IngresoPaqueteApi;

// ─── Embarque (§2.4) ───

export type EmbarqueApi = {
  id: string;
  codigo: string;
  nombre: string;
  tipo: TipoEmbarque;
  /** Nulo en un embarque `local`. */
  viaje: ViajeResumenApi | null;
  referencia_logistica: string | null;
  /** Puerto real de este envío (decisión 96). */
  puerto_embarque: string | null;
  /** Puertos habituales de los proveedores del embarque, como sugerencia (08c; `[]` si aún no existe). */
  puertos_habituales: string[];
  /** Zarpe. */
  fecha_salida_estimada: string | null;
  /** Ingreso CD: la mercadería llega al CD (08b §2.4). Es la fecha obligatoria; no es la del ingreso al stock. */
  fecha_llegada_estimada: string;
  /** Solo la escriben las funciones de 08b-2. */
  fecha_llegada_real: string | null;
  /**
   * Mes de `coalesce(fecha_llegada_real, fecha_ingreso_estimada, fecha_llegada_estimada)`: el mes del ingreso al stock (desde 08b-1b). El
   * mes al que se alinean las asignaciones sin ingreso propio de paquete (con él, `mesDeDestino`).
   */
  periodo_llegada: Mes;
  estado: EstadoEmbarque;
  recepcion: RecepcionEmbarque;
  /** Versión para la concurrencia; cubre también a sus paquetes. */
  revision: number;
  nota: string | null;
  responsable_efectivo: ResponsableEfectivoApi | null;
  totales: {
    paquetes: number;
    compras: number;
    lineas: number;
    /** Unidades asignadas activas. */
    unidades: number;
    /** «Estimado» en 08b-1 (FIFO de M8); exacto desde 08b-2. */
    recibidas: number;
    pendientes: number;
    /** Unidades de asignaciones históricas (compra recibida o cancelada, línea inactiva o recibida al 100 %). */
    historicas: number;
    costo: CostoPorMonedaApi;
  };
  /** Proveedores de las compras del embarque (se derivan, no se guardan). */
  proveedores: ProveedorResumenApi[];
  avisos: AvisoAgrupador[];
  creado_por: PersonaFechaApi;
  modificado_por: PersonaFechaApi | null;
} & FechasLogisticasEmbarqueApi;

/** Una asignación: unidades de una entrega que viajan en un embarque (y paquete). */
export type AsignacionApi = {
  id: string;
  entrega_id: string;
  /** Mes de la entrega (alineado con `periodo_llegada` del embarque si no está `desalineada`). */
  periodo: Mes;
  paquete_id: string | null;
  unidades: number;
  recibidas: number;
  /** `true` en 08b-1 (sale del FIFO de M8; se rotula «estimado»). Con recepciones vinculadas (08b-2), `false`. */
  recibidas_estimadas: boolean;
  pendiente: number;
  /** Asignación histórica (§2.6): no se mueve ni cuenta como pendiente. */
  historica: boolean;
  compra: {
    id: string;
    numero: string;
    /** Número de OC de la compra (08b-1b; nulo = sin registrar). Opcional en el tipo hasta que T3a lo llene siempre. */
    numero_oc?: string | null;
    /** Revisión vigente de la compra: la piden asignar, quitar y pasar pendientes (`compra_revision`). */
    revision: number;
    estado: EstadoCompra;
    proveedor: ProveedorResumenApi;
    viaje_id: string | null;
    fecha_compra: string;
  };
  linea: {
    id: string;
    tipo: TipoLinea;
    /** Ruta género · mundo · línea. */
    gml: string | null;
    marca: string | null;
    agrupacion_marca: string | null;
    tallas: TallasCompra;
    costo_unitario: number | null;
    moneda: Moneda;
  };
};

export type EmbarqueDetalleApi = EmbarqueApi & { paquetes: PaqueteApi[]; asignaciones: AsignacionApi[] };

// ─── Fechas logísticas, línea de tiempo y número de OC (ficha 08b-1b, §2, §3.2 y §3.3) ───

/**
 * Un hito de la línea de tiempo (§3.3). `fecha` y `hora` son lo vigente (en el ingreso al stock sin fijar, la del Ingreso CD con
 * `igual_a_ingreso_cd`); `hora` solo existe en `inicio_operativo`. `fecha_original` es la primera fecha que tuvo (de los eventos) y
 * `retraso_dias` los días entre ella y la vigente (nulo si no hay o no cambió); `reprogramaciones` no cuenta las causas `correccion` ni
 * `programacion`. `manda_el_mes` marca el hito que decide el mes del flujo (el ingreso al stock).
 */
export type HitoApi = {
  hito: Hito;
  fecha: string | null;
  hora: string | null;
  estado: EstadoHito;
  /** Solo `ingreso_stock` sin fijar: muestra la fecha del Ingreso CD con la nota «igual al Ingreso CD». */
  igual_a_ingreso_cd?: boolean;
  /** Solo `ingreso_stock` de un tramo en un paquete con ingreso propio: la nota «del paquete Al barrer». */
  del_paquete?: { codigo: string; nombre: string };
  fecha_original: string | null;
  retraso_dias: number | null;
  reprogramaciones: number;
  manda_el_mes: boolean;
};

/** El hito más urgente de un embarque o de una compra (lista de Embarques y de Compras). */
export type ProximoHitoApi = { hito: Hito; fecha: string | null; hora: string | null; estado: EstadoHito };

/**
 * Lo que 08b-1b suma a `EmbarqueApi` (§3.3). OPCIONAL en el tipo solo mientras T3a no lo llena; `servicio.ts` lo entrega siempre desde
 * T3a y entonces se vuelve obligatorio (como se hizo con `asignaciones` en `EntregaLineaApi`).
 */
export type FechasLogisticasEmbarqueApi = {
  /** Arribo a puerto; no aplica a un `local`. */
  fecha_puerto_estimada?: string | null;
  fecha_inicio_operativo_estimada?: string | null;
  /** `hh:mm`, hora de Lima. */
  hora_inicio_operativo?: string | null;
  /** Ingreso al stock fijado; nulo = el día del Ingreso CD. */
  fecha_ingreso_estimada?: string | null;
  /** Último hito que ya ocurrió. */
  hito_confirmado?: HitoConfirmable | null;
  /** Almacén o ciudad de origen («California»). */
  origen?: string | null;
  /** Los cinco hitos logísticos (zarpe, arribo, ingreso_cd, inicio_operativo, ingreso_stock), en ese orden. */
  hitos?: HitoApi[];
  /** Suma de las reprogramaciones de los cinco hitos y de los ingresos de paquete. */
  reprogramaciones_total?: number;
  proximo_hito?: ProximoHitoApi | null;
};

/** Lo que 08b-1b suma a `PaqueteApi` (§3.3), opcional por la misma razón que `FechasLogisticasEmbarqueApi`. */
export type IngresoPaqueteApi = {
  /** Ingreso al stock propio; nulo = hereda el del embarque. */
  fecha_ingreso?: string | null;
  periodo_ingreso?: Mes | null;
  ingreso_propio?: boolean;
  /** Lotes al barrer (`barrer_marca` y `barrer_mezcla`) con asignaciones activas en el paquete. */
  lotes_al_barrer?: number;
  /** Subido a la llegada del embarque por el piso de §2.5: la fecha que tenía antes. */
  ajustado_desde?: string | null;
};

/** Un tramo de la línea de tiempo de una compra: (embarque, paquete) con sus unidades, o «Sin embarque» (`embarque = null`). */
export type TramoLineaTiempoApi = {
  embarque: { id: string; codigo: string; nombre: string; origen: string | null } | null;
  paquete: { id: string; codigo: string; nombre: string } | null;
  unidades: number;
  /** Mes del tramo: `mesDeDestino` (en «Sin embarque», el mes de su entrega). */
  mes: Mes;
  /** Los seis hitos, con la orden de compra primero. */
  hitos: HitoApi[];
};

/** Un cambio de la vista previa de fechas (§3.3): qué hito (o el ingreso de qué paquete) pasa de qué a qué, y cuántos días. */
export type CambioFechaApi = {
  hito: Hito | "ingreso_paquete" | "hito_confirmado";
  paquete?: { id: string; codigo: string };
  antes: string | null;
  despues: string | null;
  /** Días entre las dos fechas (positivo = se atrasa); nulo si falta alguna. */
  dias: number | null;
};

/**
 * Vista previa de `POST …/fechas`, `POST …/ingreso` y `POST …/paquete`: el plan de movimiento más lo que cambia en las fechas. `meses`
 * lista el traslado de unidades entre meses; `reprograma` dice si pedirá motivo y causa (§2.10, paso 3). Con `reprograma = false` y sin
 * meses que cambien, se aplica sin vista previa (sin `huella_plan`).
 */
export type PlanFechasApi = PlanMovimientoApi & {
  cambios: CambioFechaApi[];
  meses: { de: Mes; a: Mes; unidades: number }[];
  reprograma: boolean;
};

/** Cuerpo de `POST /api/compras/embarques/[id]/fechas` tal como lo arma la pantalla (el esquema es `cambiarFechasSchema`). */
export type CambiarFechasCuerpo = {
  revision: number;
  fecha_zarpe?: string | null;
  fecha_arribo?: string | null;
  fecha_ingreso_cd?: string;
  inicio_operativo?: { fecha: string; hora: string | null } | null;
  fecha_ingreso_stock?: string | null;
  hito_confirmado?: HitoConfirmable | null;
  motivo?: string;
  causa?: CausaFecha;
  huella_plan?: string;
};

/** Cuerpo de `POST /api/compras/paquetes/[id]/ingreso`. `fecha_ingreso_stock = null` = el paquete hereda el del embarque. */
export type IngresoPaqueteCuerpo = { revision_embarque: number; fecha_ingreso_stock: string | null; motivo?: string; causa?: CausaFecha; huella_plan?: string };

// ─── Movimientos (vista previa y resultado; §3, §3.4, §3.5) ───

/** Dónde está una unidad: mes de su entrega, embarque y paquete (nulos = «sin embarque» / «sin paquete»). */
export type UbicacionMovimientoApi = {
  periodo: Mes;
  embarque: { id: string; codigo: string } | null;
  paquete: { id: string; codigo: string } | null;
};

export type MovimientoApi = {
  compra_numero: string;
  /** Texto corto de la línea («DENIM · ALFA»). */
  linea: string;
  de: UbicacionMovimientoApi;
  a: UbicacionMovimientoApi;
  unidades: number;
};

/**
 * Lo que `?previsualizar=1` devuelve de cualquier movimiento, sin escribir. `huella_plan` (hash del resumen: compras, líneas,
 * de → a y unidades) es lo que el cliente reenvía al escribir para que la API pueda reintentar una vez (R19).
 */
export type PlanMovimientoApi = {
  operacion: OperacionMovimiento;
  huella_plan: string;
  compras_afectadas: number;
  lineas: number;
  unidades_movidas: number;
  movimientos: MovimientoApi[];
  avisos: AvisoDetalleApi[];
};

/**
 * Lo que devuelve escribir un movimiento. `compras` son las revisiones nuevas de las compras TOCADAS (las que cambiaron sus entregas,
 * repartos o asignaciones; 0034): puede ser una lista vacía y NO trae una entrada por cada compra del plan. Las que no salen conservan su
 * revisión: quien necesite una revisión vigente de otra compra debe releerla, no suponerla.
 */
export type RespuestaMovimientoApi = {
  embarque: EmbarqueDetalleApi;
  /** Otros embarques que el movimiento tocó (origen y destino, p. ej. al mover un paquete o pasar pendientes). */
  embarques_tocados: { id: string; codigo: string; revision: number }[];
  compras: { id: string; revision: number }[];
  avisos: AvisoDetalleApi[];
};

// ─── Sin agrupador, opciones e historial (§3.3, §4.4) ───

/** Una entrega con unidades sin embarque (compras en borrador o confirmadas). */
export type EntregaSinEmbarqueApi = {
  entrega_id: string;
  periodo: Mes;
  unidades: number;
  /** `unidades` menos lo ya asignado a embarques. */
  sin_asignar: number;
  compra: AsignacionApi["compra"];
  linea: AsignacionApi["linea"];
};

export type CompraSinViajeApi = CompraDeViajeApi & { origen: string };

export type SinAgrupadorApi = { entregas: EntregaSinEmbarqueApi[]; compras_sin_viaje: CompraSinViajeApi[] };

export type OpcionViajeApi = { id: string; codigo: string; nombre: string; estado: EstadoViaje; fecha_inicio: string };
export type OpcionEmbarqueApi = {
  id: string;
  codigo: string;
  nombre: string;
  tipo: TipoEmbarque;
  estado: EstadoEmbarque;
  periodo_llegada: Mes;
  viaje_id: string | null;
  revision: number;
  /** Origen del embarque, para el selector («Embarque 261201 · California»; 08b-1b §4.6). */
  origen?: string | null;
};
export type OpcionPaqueteApi = { id: string; embarque_id: string; codigo: string; nombre: string; estado: EstadoPaquete };

/** `GET /api/compras/agrupadores/opciones`: para los selectores (los viajes cerrados van al final, marcados «(cerrado)»: lo hace la pantalla). */
export type OpcionesAgrupadoresApi = {
  viajes: OpcionViajeApi[];
  embarques: OpcionEmbarqueApi[];
  paquetes: OpcionPaqueteApi[];
  asignables: AsignableApi[];
  /** Puertos ya usados en embarques, para la sugerencia del campo Puerto. */
  puertos: string[];
  /** Orígenes ya usados en embarques, para la sugerencia del campo Origen (08b-1b). */
  origenes?: string[];
};

export type EventoAgrupadorApi = {
  id: string;
  viaje_id: string | null;
  embarque_id: string | null;
  paquete_id: string | null;
  accion: AccionAgrupadorEvento;
  antes: unknown | null;
  despues: unknown | null;
  motivo: string | null;
  /** Causa de una reprogramación (08b-1b); nula en los eventos que no reprograman. */
  causa?: CausaFecha | null;
  resumen: string | null;
  /** `[{ compra_id, revision_nueva }]`. */
  compras: { compra_id: string; revision_nueva: number }[];
  usuario_nombre: string | null;
  created_at: string;
};

// ─── Viaje activo (§3.8) ───

/** Un `uuid` de viaje, `todos` o `sin_viaje`. Vive en la cookie `v2_viaje_activo`; nunca da ni quita permisos. */
export type ViajeActivoApi = string;

// ─── Importador de agrupadores (§3.11) ───

export type ModoImportacionAgrupadores = "previsualizar" | "aplicar";

export type ResumenClasificacionApi = { nuevas: number; iguales: number; cambiadas: number; omitidas: number };

export type FilaImportacionAgrupadorApi = {
  /** Número de fila del archivo (1-based). */
  fila: number;
  /** Nulo si la fila no trae un tipo válido (`tipo_invalido`). */
  tipo: TipoAgrupador | null;
  /** Clave normalizada: `tipo|código` o la natural (`tipo|NOMBRE|fecha`, `paquete|EMBARQUE|NOMBRE`). */
  clave: string;
  clasificacion: ClasificacionAgrupadorImportado;
  /** Nulo en `previsualizar` para las nuevas sin código: «se numera al aplicar». */
  codigo_final: string | null;
  /** Solo en `omitida`. */
  motivo?: MotivoOmisionAgrupador;
  /** En `cambiada` y en algunas omisiones: qué difiere («fecha_llegada 2026-11-20 → 2026-11-25»). */
  detalle?: string;
  avisos: AvisoImportacionAgrupador[];
};

export type ReporteImportacionAgrupadoresApi = {
  modo: ModoImportacionAgrupadores;
  resumen: ResumenClasificacionApi & { por_tipo: Record<TipoAgrupador, ResumenClasificacionApi> };
  filas: FilaImportacionAgrupadorApi[];
  /** Solo con `modo = "aplicar"`: los códigos asignados. */
  creados?: { tipo: TipoAgrupador; id: string; codigo: string }[];
};

// ─── Importador de compras: columnas VIAJE, EMBARQUE y PAQUETE (§3.9) ───

/** Lo que el reporte del importador de compras suma por las columnas nuevas (T3b lo cuelga de `ReporteImportacionComprasApi`). */
export type AgrupadorImportacionCompraApi = {
  fila: number;
  viaje: { id: string; codigo: string } | null;
  embarque: { id: string; codigo: string } | null;
  paquete: { id: string; codigo: string } | null;
  /** Qué se hizo: asignó viaje, asignó embarque, no tocó (`igual` ya asignada a otro: `agrupador_distinto`) o se omitió. */
  resultado: "asignado" | "sin_cambio" | "omitido";
  motivo?: MotivoOmisionCompraAgrupador;
  avisos: AvisoImportacionCompraAgrupador[];
  /**
   * Solo con `modo = "aplicar"`: la compra se importó pero la asignación falló (un corte entre las tres transacciones, §3.9 punto 4, o
   * una carrera con otra persona). La compra queda sin ese agrupador; reimportar el archivo lo completa. Aditivo de T3b.
   */
  no_asignado?: { motivo: string; mensaje: string };
};

// ─── Cuerpos de petición (tipos de pantalla; los esquemas están en `esquemas.ts`) ───

export type GuardarViajeCuerpo = {
  revision?: number;
  codigo?: string;
  nombre: string;
  destino?: string | null;
  fecha_inicio: string;
  fecha_fin?: string | null;
  responsable_id: string;
  nota?: string | null;
};

export type GuardarEmbarqueCuerpo = {
  revision?: number;
  codigo?: string;
  nombre: string;
  tipo: TipoEmbarque;
  viaje_id: string | null;
  responsable_id: string | null;
  referencia_logistica?: string | null;
  puerto_embarque?: string | null;
  /** Zarpe. Al crear; al editar no se manda (va por `/fechas`). */
  fecha_salida_estimada?: string | null;
  /** Ingreso CD. Obligatoria al crear; al editar, no se manda (va por `/fechas`). */
  fecha_llegada_estimada?: string;
  /** Arribo, inicio operativo (fecha y hora) e ingreso al stock: solo al crear (08b-1b §3.1). */
  fecha_puerto_estimada?: string | null;
  fecha_inicio_operativo_estimada?: string | null;
  hora_inicio_operativo?: string | null;
  fecha_ingreso_estimada?: string | null;
  /** Almacén o ciudad de origen; sí se edita con PATCH. */
  origen?: string | null;
  nota?: string | null;
};

export type GuardarPaqueteCuerpo = { revision_embarque: number; codigo?: string; nombre: string; responsable_id: string | null; nota?: string | null };

// ─── Etiquetas de pantalla ───

export const ETIQUETA_TIPO_AGRUPADOR: Record<TipoAgrupador, string> = { viaje: "Viaje", embarque: "Embarque", paquete: "Paquete" };

export const ETIQUETA_ESTADO_VIAJE: Record<EstadoViaje, string> = { abierto: "Abierto", cerrado: "Cerrado", cancelado: "Cancelado" };

export const ETIQUETA_ESTADO_EMBARQUE: Record<EstadoEmbarque, string> = {
  planificado: "Planificado",
  en_transito: "En tránsito",
  recibido: "Recibido",
  cancelado: "Cancelado",
};

export const ETIQUETA_ESTADO_PAQUETE: Record<EstadoPaquete, string> = { abierto: "Abierto", cancelado: "Cancelado" };

export const ETIQUETA_TIPO_EMBARQUE: Record<TipoEmbarque, string> = { importacion: "Importación", local: "Local" };

export const ETIQUETA_RECEPCION_EMBARQUE: Record<RecepcionEmbarque, string> = {
  sin_recibir: "Sin recibir",
  parcial: "Recibido parcial",
  completa: "Recibido completo",
  vacio: "Sin mercadería",
};

export const ETIQUETA_ACCION_AGRUPADOR_EVENTO: Record<AccionAgrupadorEvento, string> = {
  crear: "Creó",
  editar: "Editó",
  cambiar_estado: "Cambió el estado",
  asignar_viaje: "Asignó compras al viaje",
  asignar: "Asignó mercadería",
  quitar: "Quitó mercadería",
  mover_a_paquete: "Movió mercadería de paquete",
  cambiar_fecha: "Cambió las fechas",
  pasar_pendientes: "Pasó pendientes a otro embarque",
  mover_paquete: "Movió el paquete a otro embarque",
  recibir: "Recibió el embarque",
  otra_llegada: "Registró otra llegada",
  revertir_recepcion: "Volvió el embarque a en tránsito",
};

export const ETIQUETA_AVISO_AGRUPADOR: Record<AvisoAgrupador, string> = {
  viaje_cerrado: "El viaje está cerrado: igual se registra.",
  atrasado: "Atrasado",
  sin_responsable: "Sin responsable disponible",
  viaje_distinto: "El viaje de la compra es otro",
  cambia_temporada: "Un lote cambia de temporada",
  fecha_en_mes_cerrado: "La fecha cae en un mes ya cerrado",
  llegada_antes_de_compra: "El ingreso al stock es anterior a la orden de compra: el ingreso se rechazará",
  entregas_fusionadas: "Se fundieron entregas del mismo mes",
  desalineada: "La entrega no está en el mes de ingreso al stock de su embarque o paquete",
  asignaciones_historicas: "Hay mercadería histórica que no se mueve",
  linea_recibida: "La línea ya está recibida al 100 %",
  en_embarque_cancelado: "Mercadería activa en un embarque cancelado",
  pendientes_tras_recibir: "Quedan pendientes tras recibir",
  borradores_excluidos: "Se excluyeron compras en borrador",
  ingreso_paquete_ajustado: "Un paquete se subió a la llegada del embarque",
  orden_de_fechas: "Hay fechas fuera de orden",
  hito_vencido: "Un hito debía ocurrir y todavía no figura como ocurrido",
  pasa_a_en_transito: "El embarque pasa a En tránsito",
};

/** Nombre de cada hito en pantalla (los de Javier; §4). */
export const ETIQUETA_HITO: Record<Hito, string> = {
  orden_compra: "Orden de compra",
  zarpe: "Zarpe",
  arribo: "Arribo",
  ingreso_cd: "Ingreso CD",
  inicio_operativo: "Inicio operativo",
  ingreso_stock: "Ingreso al stock",
};

/**
 * Marcador de cada hito (los del reporte de Javier: blanco, azul, rojo, negro, cohete y verde). Se dibuja como punto o ícono de color
 * `aria-hidden` y SIEMPRE junto al nombre del hito y al estado en texto: el color nunca es la única señal. Escapes Unicode, no emojis
 * literales en el código.
 */
export const MARCADOR_HITO: Record<Hito, string> = {
  orden_compra: "\u26AA",
  zarpe: "\u{1F535}",
  arribo: "\u{1F534}",
  ingreso_cd: "\u26AB",
  inicio_operativo: "\u{1F680}",
  ingreso_stock: "\u{1F7E2}",
};

/** Texto del estado de un hito, sin fecha («Ocurrió ✓»); el texto con fecha lo arma `textoEstadoHito` en `hitos.ts`. */
export const ETIQUETA_ESTADO_HITO: Record<EstadoHito, string> = {
  real: "Ocurrió ✓",
  sin_registrar: "Ocurrió · sin fecha",
  vencido: "Vencido",
  por_confirmar: "Llegó, falta confirmar el ingreso",
  previsto: "Previsto",
  pendiente: "Pendiente",
  no_aplica: "No aplica",
};

/** Causa de una reprogramación en pantalla (§2.6). */
export const ETIQUETA_CAUSA_FECHA: Record<CausaFecha, string> = {
  pago: "Demora en el pago al proveedor",
  produccion: "El proveedor no terminó a tiempo",
  naviera: "Naviera, zarpe o transbordo",
  aduana: "Aduana",
  transporte: "Transporte local (puerto → CD)",
  cola_conteo: "Cola o capacidad en el CD (conteo, proceso)",
  programacion: "Programación del ingreso",
  correccion: "Corrección de un dato mal puesto",
  otro: "Otra (el motivo lo explica)",
};

/** Los catálogos como listas para selectores y validaciones de pantalla. */
export const LISTA_CAUSAS_FECHA: readonly CausaFecha[] = CAUSAS_FECHA;
export const LISTA_ESTADOS_HITO: readonly EstadoHito[] = ESTADOS_HITO;
export const LISTA_HITOS: readonly Hito[] = HITOS;
