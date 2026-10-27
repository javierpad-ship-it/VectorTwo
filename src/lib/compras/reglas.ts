import type { EquivalenciaEstado, NodoEstado } from "@/lib/arbol/importar";
import type { AgrupacionMarcaEstado } from "@/lib/marcas/importar";
import type { ModalidadEfectiva } from "@/lib/marcas/tipos-api";
import { unidadDeMarca } from "@/lib/marcas/conjuntos/reglas";
import {
  ESTADO_HTTP_ERROR_COMPRA,
  CODIGO_DE_MOTIVO,
  MENSAJE_ERROR_COMPRA,
  type CodigoErrorCompra,
  type MotivoOmisionCompra,
} from "./tipos-api";
import {
  MAX_ENTREGAS,
  MAX_UNIDADES_LINEA,
  MOTIVOS_FUNCION_COMPRA,
  TIPOS_LINEA_DISPONIBLES,
  type DestinoCompra,
  type EstadoCompra,
  type Mes,
  type MotivoFuncionCompra,
  type OrigenRecepcion,
  type TipoLinea,
} from "./tipos";

/**
 * Reglas de negocio puras de las compras de M8 (ficha 08, secciones 0.11, 0.12 y 5; reglas 15, 16 y 17). Sin Supabase, sin reloj
 * (`ahora` y `hoy` entran como parámetros) y sin importar nada de `src/lib/flujo/`. Los handlers las llaman y no las reimplementan.
 *
 * Qué hay aquí:
 *  - ayudantes de meses (`aaaa-mm`) que comparten el resto de archivos de compras;
 *  - el resultado de las funciones SQL de escritura (`interpretarResultadoFuncion`, `errorDeMotivo`);
 *  - el modelo en memoria de una compra (`ModeloCompra`) con su recálculo y su foto, que reflejan `compra_recalcular_estado` y
 *    `compra_foto` de la migración `0025`: sirven para validar antes de llamar a la función y para probar secuencias de operaciones;
 *  - `transicion` (qué acciones admite un estado) y `motivoRechazoLinea` (regla 15).
 */

// ─── Meses y fechas ───

/** `aaaa-mm` de una fecha `aaaa-mm-dd` (o de un mes). */
export const mesDe = (fecha: string): Mes => fecha.slice(0, 7);

/** `aaaa-mm-01`: así se guardan los meses en la base. */
export const primerDiaDelMes = (mes: Mes): string => `${mes.slice(0, 7)}-01`;

export const esMesValido = (valor: string): boolean => /^\d{4}-(0[1-9]|1[0-2])$/.test(valor);

/** `aaaa-mm-dd` del último día del mes (la fecha de una recepción que se confirma «en el mes X»). */
export function ultimoDiaDelMes(mes: Mes): string {
  const [anio, numero] = mes.split("-").map(Number);
  const dia = new Date(Date.UTC(anio, numero, 0)).getUTCDate();
  return `${mes.slice(0, 7)}-${String(dia).padStart(2, "0")}`;
}

const MES_CORTO = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "set", "oct", "nov", "dic"] as const;

/** `2026-10` → `oct-2026` (como lo escribe la ficha: «sugerencia de conciliación oct-2026»). */
export function etiquetaMesCorta(mes: Mes): string {
  const [anio, numero] = mes.split("-").map(Number);
  return `${MES_CORTO[numero - 1] ?? "?"}-${anio}`;
}

// ─── Resultado de las funciones SQL de escritura ───

/** Motivos que devuelven las funciones de `0025` además de los de `MOTIVOS_FUNCION_COMPRA` (que fijó T0). */
export const MOTIVOS_FUNCION_EXTRA = [
  "no_encontrada",
  "no_confirmada",
  "sin_recepciones",
  "motivo_requerido",
  "sin_lineas",
  "entregas_no_cuadran",
  "proveedor_requerido",
  "proveedor_inexistente",
  "saldo_cerrado",
] as const;
export type MotivoFuncionExtra = (typeof MOTIVOS_FUNCION_EXTRA)[number];
export type MotivoRpcCompra = MotivoFuncionCompra | MotivoFuncionExtra;

export type ResultadoRpcCompra =
  | { ok: true; compra_id: string; revision: number; estado: EstadoCompra | null; datos: Record<string, unknown> }
  | { ok: false; motivo: MotivoRpcCompra | "desconocido" };

const esRegistro = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Lee el `jsonb` que devuelve una función de escritura (`{ ok: true, compra_id, revision, estado, … }` o `{ ok: false, motivo }`)
 * sin confiar en su forma: lo que no se entiende se vuelve `motivo = "desconocido"`. `datos` trae el resto de las claves (`numero`,
 * `lineas`, `recepcion_ids`, `unidades_canceladas`, …).
 */
export function interpretarResultadoFuncion(data: unknown): ResultadoRpcCompra {
  if (!esRegistro(data)) return { ok: false, motivo: "desconocido" };
  if (data.ok === true) {
    if (typeof data.compra_id !== "string" || typeof data.revision !== "number") return { ok: false, motivo: "desconocido" };
    const estado = typeof data.estado === "string" ? (data.estado as EstadoCompra) : null;
    const { ok: _ok, compra_id, revision, estado: _estado, ...datos } = data;
    void _ok;
    void _estado;
    return { ok: true, compra_id: compra_id as string, revision: revision as number, estado, datos };
  }
  const motivo = data.motivo;
  const conocidos: readonly string[] = [...MOTIVOS_FUNCION_COMPRA, ...MOTIVOS_FUNCION_EXTRA];
  return { ok: false, motivo: typeof motivo === "string" && conocidos.includes(motivo) ? (motivo as MotivoRpcCompra) : "desconocido" };
}

export type ErrorDeMotivo = { status: number; codigo: string; mensaje: string };

const ERRORES_EXTRA: Record<MotivoFuncionExtra, ErrorDeMotivo> = {
  no_encontrada: { status: 404, codigo: "compra_no_encontrada", mensaje: MENSAJE_ERROR_COMPRA.compra_no_encontrada },
  no_confirmada: { status: 409, codigo: "no_confirmada", mensaje: "La compra todavía es un borrador: confírmala antes de registrar ingresos." },
  sin_recepciones: { status: 400, codigo: "sin_recepciones", mensaje: "Indica al menos un ingreso." },
  motivo_requerido: { status: 400, codigo: "motivo_requerido", mensaje: "Escribe el motivo de la cancelación." },
  sin_lineas: { status: 409, codigo: "sin_lineas", mensaje: "La compra no tiene líneas." },
  entregas_no_cuadran: { status: 409, codigo: "entregas_no_cuadran", mensaje: "Las entregas no suman las unidades de la línea." },
  proveedor_requerido: { status: 400, codigo: "proveedor_requerido", mensaje: "Indica el proveedor de la compra." },
  proveedor_inexistente: { status: 404, codigo: "proveedor", mensaje: "No encontramos ese proveedor." },
  saldo_cerrado: { status: 409, codigo: "saldo_cerrado", mensaje: "Esa compra ya cerró su saldo: no admite líneas nuevas." },
};

/**
 * Traduce el `motivo` de una función de escritura al `404`/`409` de la API (misma palabra como `codigo`) con su mensaje en
 * castellano llano. Los motivos de `CodigoErrorCompra` usan `ESTADO_HTTP_ERROR_COMPRA` y `MENSAJE_ERROR_COMPRA` (T0); los extra de
 * la función SQL, la tabla de este archivo.
 */
export function errorDeMotivo(motivo: MotivoRpcCompra | "desconocido"): ErrorDeMotivo {
  if (motivo === "desconocido") {
    return { status: 500, codigo: "error_interno", mensaje: "No se pudo completar la operación. Inténtalo de nuevo." };
  }
  if ((MOTIVOS_FUNCION_EXTRA as readonly string[]).includes(motivo)) return ERRORES_EXTRA[motivo as MotivoFuncionExtra];
  const codigo: CodigoErrorCompra = CODIGO_DE_MOTIVO[motivo as MotivoFuncionCompra];
  return { status: ESTADO_HTTP_ERROR_COMPRA[codigo], codigo, mensaje: MENSAJE_ERROR_COMPRA[codigo] };
}

// ─── Modelo en memoria de una compra (espejo de `compra_recalcular_estado` y `compra_foto`) ───

export type LineaModelo = { id: string; unidades: number; unidades_recibidas: number; unidades_canceladas: number; activo: boolean };

export type RecepcionModelo = {
  id: string;
  linea_id: string;
  recibida_periodo: Mes;
  unidades: number;
  fecha_recepcion: string;
  origen: OrigenRecepcion;
};

export type ModeloCompra = {
  estado: EstadoCompra;
  revision: number;
  /** No nulo con `estado = 'recibida'` ⇒ saldo cerrado (§0.11). */
  cancelada_at: string | null;
  fecha_compra: string;
  lineas: LineaModelo[];
  recepciones: RecepcionModelo[];
};

export const tieneSaldoCerrado = (m: Pick<ModeloCompra, "estado" | "cancelada_at">): boolean => m.estado === "recibida" && m.cancelada_at !== null;

/** Estado que deja `compra_recalcular_estado` (`borrador` y `cancelada` no cambian solos). */
export function estadoDeCompra(m: ModeloCompra): EstadoCompra {
  if (m.estado === "borrador" || m.estado === "cancelada") return m.estado;
  const activas = m.lineas.filter((l) => l.activo);
  const recibidas = activas.reduce((a, l) => a + l.unidades_recibidas, 0);
  if (m.cancelada_at !== null) return recibidas === 0 ? "cancelada" : "recibida";
  if (activas.length > 0 && activas.every((l) => l.unidades_recibidas >= l.unidades)) return "recibida";
  return "confirmada";
}

/**
 * Lo que recalcula la base dentro de la transacción de cada operación: `unidades_recibidas` de cada línea (suma de sus
 * recepciones), `unidades_canceladas` (con saldo cerrado, `unidades − recibidas`: una recepción tardía consume lo cancelado y
 * quitarla lo devuelve) y el `estado`. No sube `revision`. Devuelve un modelo nuevo.
 */
export function recalcularModelo(m: ModeloCompra): ModeloCompra {
  const cerrado = m.cancelada_at !== null;
  const lineas = m.lineas.map((l) => {
    const rec = m.recepciones.filter((r) => r.linea_id === l.id).reduce((a, r) => a + r.unidades, 0);
    return { ...l, unidades_recibidas: rec, unidades_canceladas: cerrado ? l.unidades - rec : l.unidades_canceladas };
  });
  const parcial: ModeloCompra = { ...m, lineas };
  return { ...parcial, estado: estadoDeCompra(parcial) };
}

/** Forma de `compra_eventos.antes` / `despues` (la misma que arma `compra_foto` en SQL: los meses van como `aaaa-mm-01`). */
export type FotoCompra = {
  estado: EstadoCompra;
  revision: number;
  saldo_cerrado: boolean;
  lineas: { id: string; unidades: number; unidades_recibidas: number; unidades_canceladas: number }[];
  recepciones: { id: string; linea_id: string; recibida_periodo: string; unidades: number; fecha_recepcion: string; origen: OrigenRecepcion }[];
};

export function fotoCompra(m: ModeloCompra): FotoCompra {
  const recepciones = m.recepciones
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (a.r.recibida_periodo < b.r.recibida_periodo ? -1 : a.r.recibida_periodo > b.r.recibida_periodo ? 1 : a.i - b.i))
    .map(({ r }) => ({
      id: r.id,
      linea_id: r.linea_id,
      recibida_periodo: primerDiaDelMes(r.recibida_periodo),
      unidades: r.unidades,
      fecha_recepcion: r.fecha_recepcion,
      origen: r.origen,
    }));
  return {
    estado: m.estado,
    revision: m.revision,
    saldo_cerrado: tieneSaldoCerrado(m),
    lineas: m.lineas.map((l) => ({ id: l.id, unidades: l.unidades, unidades_recibidas: l.unidades_recibidas, unidades_canceladas: l.unidades_canceladas })),
    recepciones,
  };
}

// ─── Transiciones (regla 16) ───

export type AccionCompra = "editar" | "confirmar" | "recibir" | "cancelar";

export type MotivoTransicion = "no_editable" | "ya_confirmada" | "sin_lineas" | "no_confirmada" | "recibida" | "excede_pendiente";

export type ResultadoTransicion = { ok: true; hacia: EstadoCompra } | { ok: false; motivo: MotivoTransicion };

/**
 * Qué admite cada estado (ficha 08, regla 16 y §5.10). Solo `cancelada` es inmutable.
 *  - `editar`: `borrador`, `confirmada` o `recibida` (cualquier campo; `0.13.1`).
 *  - `confirmar`: `borrador` con al menos una línea activa (`0.13.1`).
 *  - `recibir`: `confirmada`, o `recibida` con saldo cerrado (ingreso tardío hasta lo cancelado, §0.11). Una `recibida` normal ya
 *    tiene todo: cualquier ingreso excedería lo pendiente. Un borrador no recibe (`no_confirmada`).
 *  - `cancelar`: `borrador` o `confirmada`; una `recibida` responde `recibida` («Ya llegó todo: no hay saldo que cancelar»).
 * `hacia` es el estado que resulta en el caso común; el definitivo lo calcula la base al escribir (`estadoDeCompra`).
 * `cancelar` devuelve `cancelada` sin recepciones y `recibida` (saldo cerrado) con ellas.
 */
export function transicion(
  compra: { estado: EstadoCompra; cancelada_at: string | null },
  accion: AccionCompra,
  contexto: { lineas_activas?: number; unidades_recibidas?: number } = {},
): ResultadoTransicion {
  const { estado } = compra;
  if (estado === "cancelada") return { ok: false, motivo: "no_editable" };
  switch (accion) {
    case "editar":
      return { ok: true, hacia: estado };
    case "confirmar":
      if (estado !== "borrador") return { ok: false, motivo: "ya_confirmada" };
      if ((contexto.lineas_activas ?? 0) < 1) return { ok: false, motivo: "sin_lineas" };
      return { ok: true, hacia: "confirmada" };
    case "recibir":
      if (estado === "borrador") return { ok: false, motivo: "no_confirmada" };
      if (estado === "recibida" && compra.cancelada_at === null) return { ok: false, motivo: "excede_pendiente" };
      return { ok: true, hacia: estado };
    case "cancelar":
      if (estado === "recibida") return { ok: false, motivo: "recibida" };
      return { ok: true, hacia: (contexto.unidades_recibidas ?? 0) > 0 ? "recibida" : "cancelada" };
  }
}

// ─── Entregas ───

export type EntregaPropuesta = { periodo: Mes; unidades: number };

/** Dos entregas del mismo mes se funden en una (único `(linea, periodo)`); el resultado va ordenado por periodo. */
export function fundirEntregas<T extends { periodo: Mes; unidades: number }>(entregas: readonly T[]): { periodo: Mes; unidades: number }[] {
  const por = new Map<Mes, number>();
  for (const e of entregas) por.set(mesDe(e.periodo), (por.get(mesDe(e.periodo)) ?? 0) + e.unidades);
  return [...por.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([periodo, unidades]) => ({ periodo, unidades }));
}

// ─── Marcas: un miembro se resuelve a su cabeza ───

/** Lo que las compras necesitan de una marca (una fila de `marcas` lo cumple). */
export type MarcaCompra = {
  id: string;
  codigo: string | null;
  nombre: string;
  activo: boolean;
  agrupacion_marca_id: string;
  conjunto_marca_id: string | null;
  /** `modalidadEfectiva(marca)` de 02b (nunca la columna cruda): `null` si la marca no tiene tratamiento especial. */
  modalidad_efectiva: ModalidadEfectiva | null;
};

export type NodoCompra = NodoEstado & { nivel_planificacion: string };
export type EquivalenciaCompra = EquivalenciaEstado;
export type TiendaCompra = { id: string; codigo: string; nombre: string; tipo: string; activo: boolean };

/** La unidad de marca de una marca (su cabeza si es miembro de un conjunto efectivo) y si hubo que resolverla. */
export function resolverUnidadDeMarca(marca: MarcaCompra, marcas: readonly MarcaCompra[]): { unidad: MarcaCompra; miembro_resuelto: boolean } {
  const u = unidadDeMarca(marca, marcas);
  if (u.unidad_marca_id === marca.id) return { unidad: marca, miembro_resuelto: false };
  const cabeza = marcas.find((m) => m.id === u.unidad_marca_id);
  return cabeza ? { unidad: cabeza, miembro_resuelto: true } : { unidad: marca, miembro_resuelto: false };
}

/** `true` si la unidad de la marca es al barrer o mixta: solo ellas admiten un lote (`409 modalidad_no_barrer`). */
export function admiteLote(unidad: Pick<MarcaCompra, "modalidad_efectiva">): boolean {
  return unidad.modalidad_efectiva === "barrido" || unidad.modalidad_efectiva === "mixta";
}

// ─── Regla 15: una línea válida ───

/** Los motivos de omisión del importador más los que solo aparecen al capturar a mano. */
export type MotivoRechazoLinea = MotivoOmisionCompra | "tienda_requerida";

export type RechazoLinea = { motivo: MotivoRechazoLinea; detalle?: string };

/** Una línea ya con ids resueltos (lo que el importador arma tras leer las celdas y lo que recibirá la captura de `0.13.1`). */
export type LineaParaValidar = {
  tipo: TipoLinea;
  genero_mundo_linea_id: string | null;
  equivalencia_id: string | null;
  marca_id: string | null;
  agrupacion_marca_id: string | null;
  unidades: number;
  destino: DestinoCompra;
  tienda_id: string | null;
  /** `aaaa-mm` o `aaaa-mm-dd` (un día que no sea el primero se rechaza: en la base los meses son el primer día). */
  entregas: readonly { periodo: string; unidades: number }[];
  /** Solo `barrer_mezcla` (M9a): cuántas filas de porcentajes trae. */
  mezcla_filas?: number;
};

export type CatalogosCompra = {
  nodos: readonly NodoCompra[];
  equivalencias: readonly EquivalenciaCompra[];
  marcas: readonly MarcaCompra[];
  agrupaciones: readonly AgrupacionMarcaEstado[];
  tiendas: readonly TiendaCompra[];
};

const esEntero = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n);

/**
 * Regla 15 (ficha 08, §8). `null` si la línea es válida; si no, el primer motivo con su detalle en castellano llano.
 *  - `especifica` ⇒ GML no nulo y exactamente una de marca o agrupación;
 *  - `barrer_marca` ⇒ sin GML, marca de modalidad `barrido` o `mixta` (`modalidad_no_barrer`), sin agrupación;
 *  - `barrer_mezcla` ⇒ sin GML, marca ni agrupación y al menos una fila de porcentajes (M9a);
 *  - la equivalencia solo existe en un nodo GMLE y debe ser de ese mismo nodo;
 *  - destino `tienda` exige una tienda activa de tipo Tienda (y solo él lleva `tienda_id`);
 *  - `unidades > 0`; entregas con periodo primer día de mes cuya suma es `unidades`.
 * `tiposDisponibles` es `TIPOS_LINEA_DISPONIBLES` en `0.13.0` (sin `barrer_mezcla`).
 */
export function motivoRechazoLinea(
  linea: LineaParaValidar,
  catalogos: CatalogosCompra,
  tiposDisponibles: readonly TipoLinea[] = TIPOS_LINEA_DISPONIBLES,
): RechazoLinea | null {
  const rechazo = (motivo: MotivoRechazoLinea, detalle?: string): RechazoLinea => (detalle === undefined ? { motivo } : { motivo, detalle });

  if (!esEntero(linea.unidades) || linea.unidades <= 0 || linea.unidades > MAX_UNIDADES_LINEA) {
    return rechazo("unidades_invalida", "Las unidades deben ser un número entero mayor que cero.");
  }
  if (!tiposDisponibles.includes(linea.tipo)) {
    return rechazo("tipo_no_disponible", "Los lotes de varias marcas se activan con M9a.");
  }

  const nodo = linea.genero_mundo_linea_id ? catalogos.nodos.find((n) => n.id === linea.genero_mundo_linea_id) : undefined;

  if (linea.tipo === "especifica") {
    if (linea.genero_mundo_linea_id === null) return rechazo("gml_requerido", "Una línea específica necesita género, mundo y línea.");
    if (!nodo) return rechazo("gml_inexistente");
    if (!nodo.activo) return rechazo("gml_inactivo");
    if (linea.marca_id !== null && linea.agrupacion_marca_id !== null) return rechazo("marca_y_agrupacion", "Elige la marca o la agrupación, no las dos.");
    if (linea.marca_id === null && linea.agrupacion_marca_id === null) return rechazo("sin_marca_ni_agrupacion", "Indica la marca o la agrupación de marcas.");
  } else if (linea.tipo === "barrer_marca") {
    if (linea.genero_mundo_linea_id !== null) return rechazo("tipo_invalido", "Un lote de una marca no lleva género, mundo ni línea.");
    if (linea.marca_id === null) return rechazo("sin_marca_ni_agrupacion", "Un lote de una marca necesita la marca.");
    if (linea.agrupacion_marca_id !== null) return rechazo("marca_y_agrupacion", "Un lote de una marca no lleva agrupación.");
  } else {
    if (linea.genero_mundo_linea_id !== null || linea.marca_id !== null || linea.agrupacion_marca_id !== null) {
      return rechazo("tipo_invalido", "Un lote de varias marcas no lleva GML, marca ni agrupación: va todo en la tabla de porcentajes.");
    }
    if ((linea.mezcla_filas ?? 0) < 1) return rechazo("mezcla_sin_filas", "El lote de varias marcas necesita al menos una fila de porcentajes.");
  }

  if (linea.marca_id !== null) {
    const marca = catalogos.marcas.find((m) => m.id === linea.marca_id);
    if (!marca) return rechazo("marca_desconocida");
    if (!marca.activo) return rechazo("marca_inactiva", marca.nombre);
    if (linea.tipo === "barrer_marca") {
      const { unidad } = resolverUnidadDeMarca(marca, catalogos.marcas);
      if (!admiteLote(unidad)) {
        return rechazo("modalidad_no_barrer", `${unidad.nombre} no se compra al barrer: registra la compra con su género, mundo y línea.`);
      }
    }
  }
  if (linea.agrupacion_marca_id !== null && !catalogos.agrupaciones.some((a) => a.id === linea.agrupacion_marca_id)) {
    return rechazo("agrupacion_desconocida");
  }

  if (linea.equivalencia_id !== null) {
    if (linea.tipo !== "especifica" || nodo === undefined) {
      return rechazo("equivalencia_requiere_gmle", "Solo una línea específica puede llevar equivalencia.");
    }
    const eq = catalogos.equivalencias.find((e) => e.id === linea.equivalencia_id);
    if (!eq || !eq.activo) return rechazo("equivalencia_desconocida");
    if (nodo.nivel_planificacion !== "GMLE") return rechazo("equivalencia_requiere_gmle", "Ese nodo se planifica como GML: no lleva equivalencia.");
    if (eq.genero_mundo_linea_id !== nodo.id) return rechazo("equivalencia_de_otro_nodo", "La equivalencia es de otro nodo.");
  }

  if (linea.destino === "tienda") {
    if (linea.tienda_id === null) return rechazo("tienda_requerida", "Elige la tienda de destino.");
    const tienda = catalogos.tiendas.find((t) => t.id === linea.tienda_id);
    if (!tienda || !tienda.activo || tienda.tipo !== "Tienda") return rechazo("destino_desconocido", "La tienda de destino no existe, está desactivada o es un centro de distribución.");
  } else if (linea.tienda_id !== null) {
    return rechazo("destino_desconocido", "Solo el destino «tienda» lleva tienda.");
  }

  if (linea.entregas.length < 1) return rechazo("entregas_invalidas", "La línea necesita al menos una entrega.");
  if (linea.entregas.length > MAX_ENTREGAS) return rechazo("entregas_invalidas", `Una línea admite hasta ${MAX_ENTREGAS} entregas.`);
  let suma = 0;
  for (const e of linea.entregas) {
    if (!/^\d{4}-(0[1-9]|1[0-2])(-01)?$/.test(e.periodo)) {
      return rechazo("entregas_invalidas", `«${e.periodo}» no es un mes válido (aaaa-mm).`);
    }
    if (!esEntero(e.unidades) || e.unidades <= 0) return rechazo("entregas_invalidas", "Cada entrega debe tener unidades enteras mayores que cero.");
    suma += e.unidades;
  }
  if (suma !== linea.unidades) return rechazo("entregas_invalidas", `Las entregas suman ${suma} y la línea es de ${linea.unidades}.`);

  return null;
}
