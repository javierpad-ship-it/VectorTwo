/**
 * Catálogos, límites y registros de lectura de los agrupadores de compras (viajes, embarques y paquetes; ficha 08b, secciones 0.3,
 * 2, 3 y 5). Lógica pura y sin I/O. CONGELADO al terminar T0 de 08b-1: si falta algo, se pide a `backend`.
 *
 * Los catálogos (`estado`, `tipo`, `accion`, `aviso`, `motivo`) los valida zod y no la base (PLAN §4: catálogos en zod sin `check`).
 * Los registros de lectura NO dependen de `Tables<>`: son lo mínimo que las funciones puras de T2 necesitan, con los meses ya como
 * `aaaa-mm` y las fechas como `aaaa-mm-dd`; `consultas.ts` (T3b) convierte lo que viene de la base.
 *
 * Este archivo NO toca `src/lib/compras/tipos.ts` (dueño: T2). Lo que la ficha manda sumar allí (§2.7) queda declarado aquí en
 * `ORIGEN_ENTREGA_EMBARQUE` y `ACCIONES_EVENTO_COMPRA_AGRUPADORES` para que T2 lo use al ampliar `ORIGENES_ENTREGA` y `ACCIONES_EVENTO`.
 */
import type { Rol } from "@/lib/auth/roles";
import type { Mes } from "@/lib/compras/tipos";

// ─── Catálogos (§2.3 a §2.5, §2.9, §3.1, R13) ───

export const TIPOS_AGRUPADOR = ["viaje", "embarque", "paquete"] as const;
export type TipoAgrupador = (typeof TIPOS_AGRUPADOR)[number];

/** `cerrado` es solo informativo (decisión 95); solo `cancelado` bloquea (`viaje_cancelado`). */
export const ESTADOS_VIAJE = ["abierto", "cerrado", "cancelado"] as const;
export type EstadoViaje = (typeof ESTADOS_VIAJE)[number];

/** `recibido` solo lo escribe 08b-2 (`recibir_embarque`). */
export const ESTADOS_EMBARQUE = ["planificado", "en_transito", "recibido", "cancelado"] as const;
export type EstadoEmbarque = (typeof ESTADOS_EMBARQUE)[number];

export const ESTADOS_PAQUETE = ["abierto", "cancelado"] as const;
export type EstadoPaquete = (typeof ESTADOS_PAQUETE)[number];

/** `local` ⇒ `viaje_id` nulo (lo comprueba la función: `409 local_con_viaje`). */
export const TIPOS_EMBARQUE = ["importacion", "local"] as const;
export type TipoEmbarque = (typeof TIPOS_EMBARQUE)[number];

/**
 * Los seis hitos de la línea de tiempo de una compra (ficha 08b-1b, §2.1, decisión 120): la orden de compra (de la compra) y los cinco
 * del embarque. El orden es el de la línea de tiempo.
 */
export const HITOS = ["orden_compra", "zarpe", "arribo", "ingreso_cd", "inicio_operativo", "ingreso_stock"] as const;
export type Hito = (typeof HITOS)[number];

/** Los cinco hitos logísticos, del embarque (sin la orden de compra). */
export const HITOS_LOGISTICOS = ["zarpe", "arribo", "ingreso_cd", "inicio_operativo", "ingreso_stock"] as const;
export type HitoLogistico = (typeof HITOS_LOGISTICOS)[number];

/**
 * Hitos que se pueden marcar «ya ocurrió» (`compra_embarques.hito_confirmado`, en este orden). El ingreso al stock se confirma al
 * recibir (08b-2). Catálogo en zod y en la base (`check`).
 */
export const HITOS_CONFIRMABLES = ["zarpe", "arribo", "ingreso_cd", "inicio_operativo"] as const;
export type HitoConfirmable = (typeof HITOS_CONFIRMABLES)[number];

/** Estados de un hito en la línea de tiempo (§2.2). En pantalla siempre en texto, nunca solo color. */
export const ESTADOS_HITO = ["real", "sin_registrar", "vencido", "por_confirmar", "previsto", "pendiente", "no_aplica"] as const;
export type EstadoHito = (typeof ESTADOS_HITO)[number];

/**
 * Causas de una reprogramación (§2.6; `compra_agrupador_eventos.causa`, catálogo también en la base con `check`). `correccion` y
 * `programacion` no cuentan como atraso.
 */
export const CAUSAS_FECHA = ["pago", "produccion", "naviera", "aduana", "transporte", "cola_conteo", "programacion", "correccion", "otro"] as const;
export type CausaFecha = (typeof CAUSAS_FECHA)[number];

/** Causas que quedan en el historial pero no suman al contador de reprogramaciones ni al retraso (F-R9). */
export const CAUSAS_SIN_ATRASO: readonly CausaFecha[] = ["correccion", "programacion"];

/** `compra_agrupador_eventos.accion` (§2.9). `recibir`, `otra_llegada` y `revertir_recepcion` los escribe 08b-2. */
export const ACCIONES_AGRUPADOR_EVENTO = [
  "crear",
  "editar",
  "cambiar_estado",
  "asignar_viaje",
  "asignar",
  "quitar",
  "mover_a_paquete",
  "cambiar_fecha",
  "pasar_pendientes",
  "mover_paquete",
  "recibir",
  "otra_llegada",
  "revertir_recepcion",
] as const;
export type AccionAgrupadorEvento = (typeof ACCIONES_AGRUPADOR_EVENTO)[number];

/** Cuerpo de `POST …/estado` (`cambiarEstadoSchema`). */
export const ACCIONES_ESTADO = ["cerrar", "reabrir", "cancelar", "en_transito", "volver_a_planificado"] as const;
export type AccionEstado = (typeof ACCIONES_ESTADO)[number];

/** Qué acciones de estado admite cada tipo (R13; rutas de §3.3). El paquete solo admite `cancelar`. */
export const ACCIONES_ESTADO_POR_TIPO: Record<TipoAgrupador, readonly AccionEstado[]> = {
  viaje: ["cerrar", "reabrir", "cancelar"],
  embarque: ["en_transito", "volver_a_planificado", "cancelar"],
  paquete: ["cancelar"],
};

/** Acciones de estado que exigen `requirePlanner` (§0.3, §3): cerrar, reabrir y cancelar. El resto, `requireUser`. */
export const ACCIONES_ESTADO_SOLO_PLANNER: readonly AccionEstado[] = ["cerrar", "reabrir", "cancelar"];

/** Operaciones de un `PlanMovimientoApi`: una por acción de movimiento (§2.9, `aplicar_movimiento_agrupador`; las tres últimas, 08b-2). */
export const OPERACIONES_MOVIMIENTO = [
  "asignar",
  "quitar",
  "mover_a_paquete",
  "cambiar_fecha",
  "pasar_pendientes",
  "mover_paquete",
  "recibir",
  "otra_llegada",
  "revertir_recepcion",
] as const;
export type OperacionMovimiento = (typeof OPERACIONES_MOVIMIENTO)[number];

/** Cuánto de un embarque se ha recibido (`EmbarqueApi.recepcion`). */
export const ESTADOS_RECEPCION_EMBARQUE = ["sin_recibir", "parcial", "completa", "vacio"] as const;
export type RecepcionEmbarque = (typeof ESTADOS_RECEPCION_EMBARQUE)[number];

/** De dónde sale el responsable efectivo: `paquete ?? embarque ?? viaje` (§2.8). */
export const ORIGENES_RESPONSABLE = ["propio", "embarque", "viaje"] as const;
export type OrigenResponsable = (typeof ORIGENES_RESPONSABLE)[number];

/** Roles que pueden ser responsables: compradores y admin activos; el planner no (§2.8, decisión 85, R26). */
export const ROLES_RESPONSABLE_ASIGNABLE: readonly Rol[] = ["comprador", "admin"];

/** Avisos que acompañan a agrupadores y movimientos (§3.2). No bloquean nada. */
export const AVISOS_AGRUPADOR = [
  "viaje_cerrado",
  "atrasado",
  "sin_responsable",
  "viaje_distinto",
  "cambia_temporada",
  "fecha_en_mes_cerrado",
  "llegada_antes_de_compra",
  "entregas_fusionadas",
  "desalineada",
  "asignaciones_historicas",
  "linea_recibida",
  "en_embarque_cancelado",
  "pendientes_tras_recibir",
  "borradores_excluidos",
  // 08b-1b (§3.5): fechas logísticas.
  "ingreso_paquete_ajustado",
  "orden_de_fechas",
  "hito_vencido",
  "pasa_a_en_transito",
] as const;
export type AvisoAgrupador = (typeof AVISOS_AGRUPADOR)[number];

/**
 * Motivos con los que una función de escritura rechaza sin escribir (§2.9). La API los traduce a `404` o `409` con el mismo código,
 * salvo `clave_existente` de `importar_agrupadores`, que la API responde como `409 vuelve_a_previsualizar`.
 */
export const MOTIVOS_FUNCION_AGRUPADOR = [
  "agrupador_cambio",
  "codigo_duplicado",
  "codigo_invalido",
  "correlativo_agotado",
  "no_encontrado",
  "no_editable",
  "responsable_no_asignable",
  "fecha_por_movimiento",
  "salida_despues_de_llegada",
  "local_con_viaje",
  "viaje_cancelado",
  "embarque_no_editable",
  "transicion_invalida",
  "tiene_asignaciones_activas",
  "tiene_compras",
  "tiene_recepciones",
  "motivo_requerido",
  "compra_cambio",
  "no_pertenece",
  "embarque_con_recepciones",
  "asignacion_con_recepciones",
  "excede_entrega",
  "compra_no_asignable",
  "saldo_cerrado",
  "max_entregas",
  "sin_pendientes",
  "paquete_de_otro_embarque",
  "reparto_sin_vector",
  "clave_existente",
  // 08b-1b (§3.2): fechas logísticas, hitos confirmados y causa de la reprogramación.
  "sin_cambios",
  "causa_requerida",
  "fecha_requerida",
  "fecha_futura",
  "puerto_en_local",
  "hora_sin_fecha",
  "hito_confirmado",
  // 08b-2 (`recibir_embarque`, `revertir_recepcion_embarque`)
  "no_confirmada",
  "excede_pendiente",
  "recepcion_antes_de_compra",
  "sin_unidades",
  "llegada_futura",
  "recepcion_cambio",
] as const;
export type MotivoFuncionAgrupador = (typeof MOTIVOS_FUNCION_AGRUPADOR)[number];

/** Resultado de las funciones de escritura de agrupadores: `{ ok, … }` o `{ ok: false, motivo }`. */
export type ResultadoFuncionAgrupador<T extends object = Record<string, never>> =
  | ({ ok: true } & T)
  | { ok: false; motivo: MotivoFuncionAgrupador };

// ─── Lo que 00B1 suma a catálogos de M8 (§2.7; los amplía T2 en `src/lib/compras/tipos.ts`) ───

/** Origen de las entregas que crea un movimiento de embarque: se suma a `ORIGENES_ENTREGA`. */
export const ORIGEN_ENTREGA_EMBARQUE = "embarque" as const;

/** Acciones de `compra_eventos` que suma esta ficha a `ACCIONES_EVENTO` (`recibir_embarque` es de 08b-2). */
export const ACCIONES_EVENTO_COMPRA_AGRUPADORES = ["asignar_viaje", "asignar_agrupador", "mover_entregas", "recibir_embarque"] as const;

// ─── Límites y formatos (los valida zod) ───

/** `^[A-Z0-9-]{1,30}$` tras pasar a mayúsculas (§2.2). */
export const PATRON_CODIGO_AGRUPADOR = /^[A-Z0-9-]{1,30}$/;
/** Formato propuesto `aamm##` (año, mes y correlativo de dos dígitos); un código a mano puede no seguirlo. */
export const PATRON_CODIGO_AAMM = /^\d{2}(0[1-9]|1[0-2])\d{2}$/;
export const MAX_CODIGO_AGRUPADOR = 30;
export const MAX_NOMBRE_AGRUPADOR = 120;
export const MAX_DESTINO_VIAJE = 120;
export const MAX_NOTA_VIAJE = 500;
export const MAX_NOTA_EMBARQUE = 500;
export const MAX_NOTA_PAQUETE = 300;
export const MAX_REFERENCIA_LOGISTICA = 80;
export const MAX_PUERTO_EMBARQUE = 80;
/** Almacén o ciudad de origen del embarque («California», «Nueva York»; 08b-1b §2.1). */
export const MAX_ORIGEN_EMBARQUE = 80;
export const MAX_MOTIVO_ESTADO = 200;
export const MAX_MOTIVO_MOVIMIENTO = 300;
export const MAX_NOTA_RECEPCION_EMBARQUE = 200;
/** Compras por llamada de «Asignar a viaje». */
export const MAX_COMPRAS_ASIGNAR_VIAJE = 500;
/** Ítems por llamada de asignar, quitar, mover a paquete o pasar pendientes. */
export const MAX_ITEMS_MOVIMIENTO = 2000;
/** Tope propio de una llegada (08b-2). NO es `MAX_RECEPCIONES_POR_LLAMADA = 50` de M8 (§3.1). */
export const MAX_ASIGNACIONES_RECIBIR = 2000;
/** Filas del importador de agrupadores (§3.11). */
export const MAX_FILAS_IMPORTAR_AGRUPADORES = 1000;
export const MAX_ARCHIVO_NOMBRE = 200;
/** Correlativo máximo de un código `aamm##` (`99` ⇒ `correlativo_agotado`). */
export const MAX_CORRELATIVO_CODIGO = 99;

// ─── Importador de agrupadores (§3.11) y columnas del importador de compras (§3.9) ───

/** Valores de la columna `TIPO` de la hoja del importador, en mayúsculas (se comparan sin distinguir caja ni acentos). */
export const VALORES_TIPO_IMPORTADOR: Record<TipoAgrupador, string> = { viaje: "VIAJE", embarque: "EMBARQUE", paquete: "PAQUETE" };
/** Valores de `TIPO_EMBARQUE` en la hoja del importador. */
export const VALORES_TIPO_EMBARQUE_IMPORTADOR: Record<TipoEmbarque, string> = { importacion: "IMPORTACION", local: "LOCAL" };

/**
 * Encabezados de la hoja única de §3.11 (orden de la plantilla) y su clave en `filaAgrupadorSchema`. Desde 08b-1b (§3.6) la plantilla usa
 * los nombres de los hitos: `FECHA_ZARPE`, `FECHA_ARRIBO`, `FECHA_INGRESO_CD`, `INICIO_OPERATIVO` (fecha y hora opcional),
 * `FECHA_INGRESO_STOCK` y `ORIGEN`. Los nombres viejos `FECHA_SALIDA` y `FECHA_LLEGADA` se siguen leyendo como sinónimos
 * (`COLUMNAS_SINONIMAS_AGRUPADORES`).
 */
export const COLUMNAS_IMPORTAR_AGRUPADORES = [
  { clave: "tipo", encabezado: "TIPO" },
  { clave: "codigo", encabezado: "CODIGO" },
  { clave: "nombre", encabezado: "NOMBRE" },
  { clave: "viaje", encabezado: "VIAJE" },
  { clave: "embarque", encabezado: "EMBARQUE" },
  { clave: "tipo_embarque", encabezado: "TIPO_EMBARQUE" },
  { clave: "destino", encabezado: "DESTINO" },
  { clave: "fecha_inicio", encabezado: "FECHA_INICIO" },
  { clave: "fecha_fin", encabezado: "FECHA_FIN" },
  { clave: "fecha_zarpe", encabezado: "FECHA_ZARPE" },
  { clave: "fecha_arribo", encabezado: "FECHA_ARRIBO" },
  { clave: "fecha_ingreso_cd", encabezado: "FECHA_INGRESO_CD" },
  { clave: "inicio_operativo", encabezado: "INICIO_OPERATIVO" },
  { clave: "fecha_ingreso_stock", encabezado: "FECHA_INGRESO_STOCK" },
  { clave: "origen", encabezado: "ORIGEN" },
  { clave: "puerto", encabezado: "PUERTO" },
  { clave: "referencia_logistica", encabezado: "REFERENCIA_LOGISTICA" },
  { clave: "responsable", encabezado: "RESPONSABLE" },
  { clave: "nota", encabezado: "NOTA" },
] as const;

/**
 * Sinónimos que se siguen aceptando (archivos y plantillas viejos): `FECHA_SALIDA` = `FECHA_ZARPE` y `FECHA_LLEGADA` =
 * `FECHA_INGRESO_CD` (lo que ya significaba). Son claves propias de la fila para detectar `fechas_en_conflicto` si una fila trae las dos
 * con valores distintos.
 */
export const COLUMNAS_SINONIMAS_AGRUPADORES = [
  { clave: "fecha_salida", encabezado: "FECHA_SALIDA", de: "fecha_zarpe" },
  { clave: "fecha_llegada", encabezado: "FECHA_LLEGADA", de: "fecha_ingreso_cd" },
] as const;
export type ClaveColumnaAgrupador =
  | (typeof COLUMNAS_IMPORTAR_AGRUPADORES)[number]["clave"]
  | (typeof COLUMNAS_SINONIMAS_AGRUPADORES)[number]["clave"];

/** Columnas nuevas del importador de compras (§3.9): código de un viaje, un embarque y un paquete existentes. */
export const COLUMNAS_COMPRAS_AGRUPADOR = [
  { clave: "viaje", encabezado: "VIAJE" },
  { clave: "embarque", encabezado: "EMBARQUE" },
  { clave: "paquete", encabezado: "PAQUETE" },
] as const;
export type ClaveColumnaCompraAgrupador = (typeof COLUMNAS_COMPRAS_AGRUPADOR)[number]["clave"];

/** Clasificación de cada fila de un importador de agrupadores (la `omitida` lleva `motivo`). */
export const CLASIFICACIONES_AGRUPADOR_IMPORTADO = ["nueva", "igual", "cambiada", "omitida"] as const;
export type ClasificacionAgrupadorImportado = (typeof CLASIFICACIONES_AGRUPADOR_IMPORTADO)[number];

/** Motivos de omisión del importador de agrupadores (§3.11, lista literal). */
export const MOTIVOS_OMISION_AGRUPADOR = [
  "tipo_invalido",
  "nombre_requerido",
  "nombre_largo",
  "codigo_invalido",
  "codigo_repetido_en_archivo",
  "fila_repetida",
  "fecha_requerida",
  "fecha_invalida",
  "fin_antes_de_inicio",
  "salida_despues_de_llegada",
  "local_con_viaje",
  "viaje_desconocido",
  "viaje_cancelado",
  "embarque_desconocido",
  "embarque_requerido",
  "embarque_no_editable",
  "responsable_requerido",
  "responsable_desconocido",
  "responsable_no_asignable",
  "referencia_sin_codigo",
  "referencia_omitida",
  "cambiada_requiere_edicion",
  "correlativo_agotado",
  "campo_largo",
  // 08b-1b (§3.6)
  "hora_invalida",
  "fechas_en_conflicto",
] as const;
export type MotivoOmisionAgrupador = (typeof MOTIVOS_OMISION_AGRUPADOR)[number];

/** Avisos del importador de agrupadores (§3.11). `puerto_distinto_del_habitual` solo si existe la 08c. */
export const AVISOS_IMPORTACION_AGRUPADOR = ["viaje_cerrado", "sin_responsable", "puerto_distinto_del_habitual", "arribo_ignorado_en_local"] as const;
export type AvisoImportacionAgrupador = (typeof AVISOS_IMPORTACION_AGRUPADOR)[number];

/** Omisiones nuevas del importador de compras por las columnas `VIAJE`, `EMBARQUE` y `PAQUETE` (§3.9, punto 3). */
export const MOTIVOS_OMISION_COMPRA_AGRUPADOR = [
  "viaje_desconocido",
  "embarque_desconocido",
  "paquete_desconocido",
  "viaje_cancelado",
  "llegada_distinta_del_embarque",
  "entregas_con_embarque",
  "paquete_sin_embarque",
  "embarque_no_editable",
] as const;
export type MotivoOmisionCompraAgrupador = (typeof MOTIVOS_OMISION_COMPRA_AGRUPADOR)[number];

/** Avisos nuevos del importador de compras (§3.9, puntos 2 y 3). Ninguno bloquea la fila. */
export const AVISOS_IMPORTACION_COMPRA_AGRUPADOR = ["viaje_cerrado", "agrupador_distinto", "viaje_distinto"] as const;
export type AvisoImportacionCompraAgrupador = (typeof AVISOS_IMPORTACION_COMPRA_AGRUPADOR)[number];

// ─── Quién escribe ───

/** `p_actor` de las funciones de agrupadores (igual que `ActorCompra`). `perfil_id` nulo solo en procesos sin sesión. */
export type ActorAgrupador = { perfil_id: string | null; nombre: string };

// ─── Registros de lectura (lo mínimo que usan las funciones puras de T2; los arma `consultas.ts`) ───

export type ViajeRegistro = {
  id: string;
  codigo: string;
  nombre: string;
  destino: string | null;
  fecha_inicio: string;
  fecha_fin: string | null;
  responsable_id: string | null;
  estado: EstadoViaje;
  nota: string | null;
  revision: number;
};

export type EmbarqueRegistro = {
  id: string;
  codigo: string;
  nombre: string;
  tipo: TipoEmbarque;
  viaje_id: string | null;
  responsable_id: string | null;
  referencia_logistica: string | null;
  puerto_embarque: string | null;
  /** Zarpe. */
  fecha_salida_estimada: string | null;
  /** Arribo a puerto (08b-1b); no aplica a un embarque `local`. */
  fecha_puerto_estimada: string | null;
  /** Ingreso CD: la mercadería llega al CD. Obligatoria; conserva el significado de «llegada al CD» de 08b. */
  fecha_llegada_estimada: string;
  /** Inicio operativo, fecha y hora opcional (hora de Lima, `hh:mm`). La hora exige la fecha. */
  fecha_inicio_operativo_estimada: string | null;
  hora_inicio_operativo: string | null;
  /** Ingreso al stock fijado por una persona (nulo = el día del Ingreso CD). Manda el mes del flujo (§2.4). */
  fecha_ingreso_estimada: string | null;
  fecha_llegada_real: string | null;
  /**
   * Mes de `coalesce(fecha_llegada_real, fecha_ingreso_estimada, fecha_llegada_estimada)`: la columna generada `periodo_llegada` desde la
   * 0038 (ya no es el mes de la llegada al CD sino el del ingreso al stock). Para el mes de una ASIGNACIÓN usa `mesDeDestino`.
   */
  periodo_llegada: Mes;
  /** Último hito que ya ocurrió (`zarpe`, `arribo`, `ingreso_cd` o `inicio_operativo`); nulo = ninguno. */
  hito_confirmado: HitoConfirmable | null;
  /** Almacén o ciudad de origen («California»). */
  origen: string | null;
  estado: EstadoEmbarque;
  nota: string | null;
  revision: number;
};

export type PaqueteRegistro = {
  id: string;
  embarque_id: string;
  codigo: string;
  nombre: string;
  responsable_id: string | null;
  estado: EstadoPaquete;
  nota: string | null;
  /** Ingreso al stock propio del paquete (08b-1b §2.5). Nulo = hereda el del embarque. Nunca anterior a la llegada del embarque (I9). */
  fecha_ingreso_estimada: string | null;
  /** Primer día del mes de `fecha_ingreso_estimada` (columna generada); nulo si ella es nula. */
  periodo_ingreso: Mes | null;
};

/** `compra_entrega_asignaciones`: reparte las unidades de una entrega entre embarques y paquetes (§2.6). */
export type AsignacionRegistro = {
  id: string;
  entrega_id: string;
  embarque_id: string;
  paquete_id: string | null;
  unidades: number;
};

/** Un perfil, para decidir si es asignable como responsable (§2.8). */
export type PerfilRegistro = { id: string; nombre: string; rol: Rol; activo: boolean };
