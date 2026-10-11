/**
 * Vista de la API de M5 para el frontend (docs/modulos/05-venta-stock.md,
 * "Contratos de API"). Describe el JSON que viaja. Es autocontenido: no
 * importa nada de otros módulos (ni de ninguno que sea `"use client"`), así
 * que se puede usar desde el navegador y desde el servidor.
 *
 * Convenciones:
 *   - Todas las respuestas de éxito son `{ data }` y las de error `{ error }`
 *     (mensaje en castellano listo para pantalla). Algunos errores `409`
 *     añaden campos al lado de `error` (ver `ErrorConflictoCarga` y
 *     `ErrorNoConcilia`); `api-client.ts` solo expone el mensaje.
 *   - `periodo` viaja siempre como `aaaa-mm` (la base guarda el primer día
 *     del mes; la API lo convierte).
 *   - Dinero en soles con 2 decimales como máximo; unidades enteras.
 *   - Toda la API de M5, lecturas incluidas, exige rol admin o planner.
 */

// ─── Piezas comunes ───

/** Periodo `aaaa-mm`. */
export type Periodo = string;

export type EstadoCarga = "en_curso" | "publicada" | "reemplazada" | "retirada" | "abandonada" | "fallida";

/** Las cinco medidas más el número de filas (de un mes del archivo, de una carga publicada, etc.). */
export type MedidasCarga = {
  filas: number;
  unidades: number;
  venta_soles: number;
  costo_vendido: number;
  stock_unidades: number;
  stock_valorizado: number;
};

export type TipoTiendaApi = "Tienda" | "Centro de Distribución";

/** Una carga tal como la devuelve la API (sin `reporte`). Los totales son `null` hasta publicarla. */
export type CargaApi = {
  id: string;
  periodo: Periodo;
  estado: EstadoCarga;
  archivo_nombre: string | null;
  usuario_nombre: string | null;
  filas: number | null;
  unidades: number | null;
  venta_soles: number | null;
  costo_vendido: number | null;
  stock_unidades: number | null;
  stock_valorizado: number | null;
  publicada_at: string | null;
  created_at: string;
  updated_at: string;
  /** Presente (con el porcentaje de errores) si el mes se cargó forzado con errores >= 2 %. */
  incompleto: { porcentaje: number | null } | null;
};

/** Resumen de una carga publicada que se reemplaza o se compara. */
export type CargaPublicadaResumen = {
  id: string;
  publicada_at: string | null;
  usuario_nombre: string | null;
  filas: number;
  unidades: number;
  venta_soles: number;
  costo_vendido: number;
  stock_unidades: number;
  stock_valorizado: number;
};

/** Carga `en_curso` de un mes: quién y desde cuándo. `caducada` = sin tandas hace más de 30 minutos. */
export type CargaEnCursoResumen = {
  id: string;
  usuario_nombre: string | null;
  created_at: string;
  /** Último latido (cada tanda lo refresca). */
  updated_at: string;
  caducada: boolean;
};

// ─── POST /api/ventas/previsualizar ───

export type CombinacionPeticion = { genero: string; mundo: string; linea: string; equivalencia: string };

/** Solo valores distintos y ya normalizados (`normalizarNombre`), sin repetir. Límites: 500 · 20 000 · 5 000 · 120. */
export type PrevisualizarPeticion = {
  tiendas: string[];
  combinaciones: CombinacionPeticion[];
  /** Con `SIN MARCA` ya aplicado a vacío y `-`. */
  marcas: string[];
  periodos: Periodo[];
};

export type ResolucionTiendaApi =
  | {
      valor: string;
      resultado: "ok";
      id: string;
      codigo: string;
      tipo: TipoTiendaApi;
      fecha_apertura: string | null;
      fecha_cierre: string | null;
    }
  | { valor: string; resultado: "excluida"; nota: string }
  | { valor: string; resultado: "desconocida" }
  | { valor: string; resultado: "inactiva" };

export type ResultadoCombinacionError =
  | "genero_desconocido"
  | "mundo_desconocido"
  | "linea_desconocida"
  | "nodo_inexistente"
  | "equivalencia_inexistente";

export type ResultadoCombinacionInactiva =
  | "genero_inactivo"
  | "mundo_inactivo"
  | "linea_inactiva"
  | "nodo_inactivo"
  | "equivalencia_inactiva";

/** Misma posición que en la petición. `detalle` dice qué pieza falta o está inactiva. */
export type ResolucionCombinacionApi =
  | { resultado: "ok"; equivalencia_id: string }
  | { resultado: ResultadoCombinacionError | ResultadoCombinacionInactiva; detalle?: string };

/**
 * Misma posición que en la petición. `parecida` (solo en `nueva`) es el nombre
 * de la marca existente más parecido (misma `aCodigo` o distancia de edición 1),
 * para el resalte de posible error de tipeo; `null` si no hay.
 */
export type ResolucionMarcaApi =
  | { resultado: "existe"; id: string; agrupacion_marca_id: string }
  | { resultado: "nueva"; comodin: boolean; parecida: string | null }
  | { resultado: "inactiva"; id: string };

export type AgrupacionMarcaApi = { id: string; codigo: string; nombre: string };

export type PeriodoPrevisualizado = {
  periodo: Periodo;
  publicada: CargaPublicadaResumen | null;
  en_curso: CargaEnCursoResumen | null;
};

export type HuellaStock = {
  periodo: Periodo;
  /** Filas con `stock_unidades <> 0` o `stock_valorizado <> 0`. */
  filas_con_stock: number;
  stock_unidades: number;
  stock_valorizado: number;
};

export type PrevisualizarRespuesta = {
  /** Fecha de hoy en Lima (`aaaa-mm-dd`) y su mes. */
  hoy: string;
  mes_actual: Periodo;
  tiendas: ResolucionTiendaApi[];
  combinaciones: ResolucionCombinacionApi[];
  marcas: ResolucionMarcaApi[];
  agrupaciones_talla: { CENTRALES: string; EXTREMAS: string };
  agrupaciones_marca: AgrupacionMarcaApi[];
  /** MID VALUE si existe y está activa; `null` si no. */
  agrupacion_defecto_id: string | null;
  periodos: PeriodoPrevisualizado[];
  /** Carga publicada del mes inmediatamente anterior al primer periodo pedido (comparación de sanidad). */
  anterior: { periodo: Periodo; filas: number; venta_soles: number; stock_valorizado: number } | null;
  /** Huellas de stock de todos los meses ya publicados. */
  huellas_stock: HuellaStock[];
};

// ─── POST /api/ventas/marcas-nuevas ───

/** Se llama solo tras confirmar el reporte previo y antes de abrir ninguna carga. */
export type MarcasNuevasPeticion = { nombres: string[]; agrupacion_marca_id: string };

export type MarcasNuevasRespuesta = {
  creadas: number;
  existentes: number;
  /** Nombre normalizado → id, de todas las marcas pedidas (nuevas y existentes). */
  ids: Record<string, string>;
  /** Comodines (VARIOS, OTROS, SIN MARCA) entre los nombres creados; van siempre a MID VALUE. */
  comodines_en_mid_value: string[];
};

// ─── POST /api/ventas/cargas (abre la carga de un mes) ───

export type AbrirCargaPeticion = {
  periodo: Periodo;
  archivo_nombre: string;
  /** Totales de TODO el mes del archivo. */
  archivo: MedidasCarga;
  /**
   * Informe del cliente (<= 200 KB serializado). Si el mes se carga forzado,
   * conviene incluir `porcentaje_errores` (número 0..100): la API lo guarda
   * como `reporte.incompleto.porcentaje`.
   */
  reporte: Record<string, unknown>;
  /** Confirma reemplazar un mes ya publicado. */
  reemplazar?: boolean;
  /** Confirma cargar un mes que no ha cerrado. */
  mes_abierto?: boolean;
  /** Confirma cargar un mes bloqueado por errores >= 2 %; queda marcado Incompleto. */
  forzar_incompleto?: boolean;
};

/** `201`. */
export type AbrirCargaRespuesta = { carga: CargaApi; reemplaza: CargaPublicadaResumen | null };

export type CodigoConflictoCarga = "mes_ya_cargado" | "mes_abierto" | "carga_en_curso";

/** Cuerpo de los `409` de abrir carga: `{ error, codigo }`. */
export type ErrorConflictoCarga = { error: string; codigo: CodigoConflictoCarga };

// ─── POST /api/ventas/cargas/[id]/filas (una tanda) ───

/**
 * Fila posicional (≈ 40 B): [tienda, equivalencia, marca] son índices en el
 * diccionario de la tanda; talla 0 = CENTRALES, 1 = EXTREMAS.
 */
export type FilaTanda = [
  tienda: number,
  equivalencia: number,
  marca: number,
  talla: 0 | 1,
  unidades: number,
  venta_soles: number,
  costo_vendido: number,
  stock_unidades: number,
  stock_valorizado: number,
];

export type TandaPeticion = {
  tanda: number;
  diccionario: { tiendas: string[]; equivalencias: string[]; marcas: string[] };
  filas: FilaTanda[];
};

export type TandaRespuesta = { tanda: number; recibidas: number };

// ─── POST /api/ventas/cargas/[id]/publicar ───

export type PublicarPeticion = { esperado: MedidasCarga };

export type PublicarRespuesta = {
  carga: CargaApi;
  /** Lo que la base midió al publicar. */
  medido: MedidasCarga;
  reemplaza: { id: string; filas: number } | null;
};

export type DiferenciaMedida = {
  medida: keyof MedidasCarga;
  esperado: number;
  medido: number;
  /** `medido - esperado`. */
  diferencia: number;
};

/** Cuerpo del `409` de publicar cuando no concilia (la carga queda `fallida`). */
export type ErrorNoConcilia = {
  error: string;
  codigo: "no_concilia";
  esperado: MedidasCarga;
  medido: MedidasCarga;
  diferencias: DiferenciaMedida[];
};

// ─── DELETE /api/ventas/cargas/[id] ───

/** `200`. `en_curso` pasa a `abandonada`; `publicada` pasa a `retirada`. */
export type DescartarCargaRespuesta = { id: string; estado: EstadoCarga };

// ─── POST /api/ventas/cargas/limpiar ───

export type LimpiarRespuesta = {
  cargas_limpiadas: number;
  filas_borradas: number;
  /** Cargas terminales que todavía tienen filas tras la pasada. */
  pendientes: number;
};

// ─── GET /api/ventas/cargas ───

export type EstadoMes = "cargado" | "sin_cargar" | "en_curso";

export type MesCarga = {
  periodo: Periodo;
  /** `en_curso` solo si el mes no tiene carga publicada; si la tiene y hay otra en curso, sigue `cargado`. */
  estado: EstadoMes;
  carga: CargaApi | null;
  /** Carga en curso de ese mes (quién y desde cuándo), con o sin publicada. */
  en_curso: CargaEnCursoResumen | null;
  /** Cargado con errores >= 2 % forzados. */
  incompleto: { porcentaje: number | null } | null;
  /** Solo con `?verificar=1` y mes cargado: totales medidos en SQL frente a los guardados. */
  verificacion: { coincide: boolean; medido: MedidasCarga } | null;
};

export type CargasRespuesta = {
  meta: {
    desde: Periodo;
    /** Último mes cerrado según la fecha de Lima. */
    hasta: Periodo;
    meses_esperados: number;
    /** Meses cargados dentro del rango desde..hasta. */
    meses_cargados: number;
    faltantes: Periodo[];
    /** Último mes con carga publicada (cualquiera), o `null`. */
    ultimo_cargado: Periodo | null;
    /** Suma de filas de las cargas publicadas. */
    filas_total: number;
  };
  /** De `desde` a `hasta` (incluidos los que faltan), más los meses fuera de rango que tengan carga. */
  meses: MesCarga[];
  limpieza_pendiente: number;
  /** `true` si se pidió `?verificar=1`. */
  verificado: boolean;
};

// ─── GET /api/ventas/cargas/[id] (detalle; añadido a la ficha) ───

export type DetalleCargaRespuesta = {
  carga: CargaApi;
  /** Informe guardado al cargar (exclusiones, avisos, conciliación). */
  reporte: Record<string, unknown>;
  /** Otras cargas del mismo mes (reemplazadas, retiradas, etc.), de la más nueva a la más vieja, sin reporte. */
  historial: CargaApi[];
};
