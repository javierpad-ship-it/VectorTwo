import { createHash } from "node:crypto";
import { aCodigo, esEquivalenciaGenerica, esEquivalenciaIgualALinea, normalizarNombre } from "@/lib/arbol/normalizar";
import { buscarEnCatalogo, resolverCatalogo } from "@/lib/arbol/importar";
import type { GeneroEstado, LineaEstado, MundoEstado } from "@/lib/arbol/importar";
import { resolverGml } from "@/lib/arbol/nivel/resolver";
import { reglaIntercompany, type ReglaBase } from "@/lib/intercompany/reglas";
import type { AgrupacionMarcaEstado } from "@/lib/marcas/importar";
import { FECHA_INVALIDA, aIso, esDiaReal, leerFecha } from "@/lib/tiendas/fechas";
import type { FilaImportacionCompra, FilaMezclaImportacion } from "./esquemas";
import { resumenCambios } from "./eventos";
import { pendientesPorEntrega, esEntregaVencida } from "./pendientes";
import { buscarProveedor, claveProveedor, type ProveedorRegistro } from "./proveedores";
import {
  repartirLinea,
  type AlcanceLinea,
  type FilaRepartoGuardar,
  type NodoAlcance,
  type RepartoParaLinea,
} from "./reparto";
import {
  admiteLote,
  fundirEntregas,
  motivoRechazoLinea,
  primerDiaDelMes,
  resolverUnidadDeMarca,
  ultimoDiaDelMes,
  type EquivalenciaCompra,
  type MarcaCompra,
  type NodoCompra,
  type TiendaCompra,
} from "./reglas";
import {
  MAX_ENTREGAS,
  MAX_NOTA_LINEA,
  MAX_UNIDADES_LINEA,
  TALLAS_COMPRA,
  TIPOS_LINEA_DISPONIBLES,
  type ActorCompra,
  type DestinoCompra,
  type EstadoCompra,
  type Mes,
  type Moneda,
  type MotivoFuncionCompra,
  type TallasCompra,
  type TipoLinea,
} from "./tipos";
import type {
  AplicadaImportacionApi,
  AvisoImportacionCompra,
  AvisoLineaCompra,
  ClasificacionLineaImportada,
  CompraImportacionApi,
  FilaOmitidaCompra,
  LineaImportacionApi,
  MotivoOmisionCompra,
  NoAplicadaImportacionApi,
  ReporteImportacionComprasApi,
} from "./tipos-api";

/**
 * Importador de la carga inicial de compras (ficha 08, §0.13, 4.7 y regla 18). Funciones puras: leen las celdas (todo texto),
 * validan, normalizan, clasifican cada línea contra lo ya importado y arman los argumentos de `importar_compra` (una llamada por
 * compra). Nunca escriben ni leen la base: el servicio (T3b) les pasa el estado y aplica el plan con `.rpc(...)`.
 *
 *  - CLAVE NATURAL: `clave_importacion = upper(trim(PROVEEDOR)) | upper(trim(REFERENCIA)) | LINEA` (no depende del orden del
 *    archivo: insertar o corregir una fila no duplica nada). La compra son las filas con el mismo `(PROVEEDOR, REFERENCIA)`.
 *  - CLASIFICACIÓN contra las compras NO canceladas: `nueva`, `igual` (misma `huella_importacion`: no hace nada) o `cambiada` (otro
 *    contenido: en `0.13.0` se omite con `cambiada_requiere_edicion`; desde `0.13.1` se aplicará como edición).
 *  - Una línea de una compra cancelada no bloquea su clave: corregir un error es cancelar y reimportar.
 *  - `UNA_MARCA` sin reparto vigente → omisión `sin_reparto`. `VARIAS_MARCAS` → `tipo_no_disponible` (M9a; la hoja `MEZCLA` se
 *    acepta pero todavía no se lee).
 *  - El aviso `exceso` lo agrega el servicio con el flujo (este archivo no importa nada de `src/lib/flujo/`): `agregarAviso`.
 *  - Sin reloj: `k'` entra en `opciones.k_prima`. Sin fecha por defecto: `FECHA_COMPRA` es obligatoria (con `current_date`, el mismo
 *    archivo crearía compras nuevas otro día).
 */

// ─── Tipos del estado y del plan ───

/** Contenido normalizado de una línea importada: lo que define su `huella_importacion` y lo que se compara para decir qué cambió. */
export type ContenidoLinea = {
  tipo: TipoLinea;
  genero_mundo_linea_id: string | null;
  equivalencia_id: string | null;
  marca_id: string | null;
  agrupacion_marca_id: string | null;
  tallas: TallasCompra;
  unidades: number;
  costo_unitario: number | null;
  destino: DestinoCompra;
  tienda_id: string | null;
  alcance: { generos: string[]; mundos: string[]; lineas: string[] };
  /** Entregas fundidas por mes y ordenadas. */
  entregas: { periodo: Mes; unidades: number }[];
  recibidas: number;
  nota: string | null;
  moneda: Moneda;
  fecha_compra: string;
};

/** Una línea ya importada (de una compra no cancelada) con la clave natural que la identifica. */
export type LineaExistente = {
  clave: string;
  huella: string | null;
  compra_id: string;
  compra_numero: string;
  compra_estado: EstadoCompra;
  /** Si se pasa, `cambios` dice qué cambió campo a campo; si no, un texto genérico. */
  contenido?: ContenidoLinea | null;
};

export type CompraExistente = {
  id: string;
  numero: string;
  proveedor_id: string;
  referencia: string | null;
  estado: EstadoCompra;
  cancelada_at: string | null;
  /**
   * Fecha y moneda de la cabecera. Si vienen, una línea nueva con otra fecha u otra moneda se omite (`cabecera_inconsistente`): la
   * función de la base agrega la línea a la compra sin compararlas. Opcionales para quien no las conozca (no se compara).
   */
  fecha_compra?: string;
  moneda?: Moneda;
};

export type RepartoVigenteParaImportar = RepartoParaLinea & { marca_id: string };

/** Todo lo que el importador necesita saber del mundo: catálogos, proveedores, lo ya importado, repartos vigentes y reglas. */
export type EstadoImportacionCompras = {
  generos: GeneroEstado[];
  mundos: MundoEstado[];
  lineas: LineaEstado[];
  nodos: NodoCompra[];
  equivalencias: EquivalenciaCompra[];
  marcas: MarcaCompra[];
  agrupaciones: AgrupacionMarcaEstado[];
  tiendas: TiendaCompra[];
  proveedores: ProveedorRegistro[];
  /** Compras existentes; las canceladas se ignoran. */
  compras: CompraExistente[];
  /** Líneas con `clave_importacion`; las de compras canceladas se ignoran (liberan su clave). */
  lineas_existentes: LineaExistente[];
  /** Un reparto vigente por marca (la unidad de marca). */
  repartos: RepartoVigenteParaImportar[];
  /** Reglas intercompany (cualquier vigencia): para `directo_con_regla` / `directo_sin_regla`. */
  reglas: ReglaBase[];
};

export type OpcionesImportacion = {
  carga_inicial: boolean;
  /** Último mes publicado (`aaaa-mm`); `null` si no hay ninguno. */
  k_prima: Mes | null;
  /** Por defecto `TIPOS_LINEA_DISPONIBLES` (`especifica` y `barrer_marca`). */
  tipos_disponibles?: readonly TipoLinea[];
};

/** Una línea de `p_compra.lineas` de `importar_compra`. */
export type PayloadLineaImportar = {
  clave_importacion: string;
  huella_importacion: string;
  tipo: TipoLinea;
  genero_mundo_linea_id: string | null;
  equivalencia_id: string | null;
  marca_id: string | null;
  agrupacion_marca_id: string | null;
  tallas: TallasCompra;
  unidades: number;
  costo_unitario: number | null;
  destino: DestinoCompra;
  tienda_id: string | null;
  /** Solo las claves con ids (`{}` si no hay alcance). */
  alcance: { generos?: string[]; mundos?: string[]; lineas?: string[] };
  nota: string | null;
  avisos: AvisoLineaCompra[];
  entregas: { periodo: string; unidades: number; origen: "importada" }[];
  repartos: FilaRepartoGuardar[];
  recepciones: { recibida_periodo: string; unidades: number; fecha_recepcion: string; nota: string | null }[];
};

/** `p_compra` de `importar_compra`. */
export type PayloadImportarCompra = {
  proveedor_id?: string;
  proveedor_nombre?: string;
  proveedor_es_intercompany?: boolean;
  referencia: string;
  fecha_compra: string;
  moneda: Moneda;
  nota: string | null;
  origen: "carga_inicial" | "comprador";
  estado: "confirmada" | "borrador";
  lineas: PayloadLineaImportar[];
};

export type LineaPlanImportar = { fila: number; clave: string; linea: PayloadLineaImportar };

/** Una compra a aplicar: una llamada a `importar_compra`. Solo trae las líneas `nueva`. */
export type PlanCompraImportar = {
  clave: string;
  proveedor: string;
  referencia: string;
  fecha_compra: string;
  moneda: Moneda;
  proveedor_id: string | null;
  proveedor_es_nuevo: boolean;
  origen: PayloadImportarCompra["origen"];
  estado: PayloadImportarCompra["estado"];
  lineas: LineaPlanImportar[];
};

export type ResultadoPrevisualizacion = {
  reporte: ReporteImportacionComprasApi;
  /** Compras con líneas nuevas, en el orden de su primera aparición en el archivo. */
  compras: PlanCompraImportar[];
};

// ─── Clave natural y huella ───

const mayusculas = (t: string) => t.trim().toUpperCase();

/** `upper(trim(PROVEEDOR)) | upper(trim(REFERENCIA))`: la compra. */
export const claveCompraImportacion = (f: { proveedor: string; referencia: string }): string => `${mayusculas(f.proveedor)}|${mayusculas(f.referencia)}`;

/** `upper(trim(PROVEEDOR)) | upper(trim(REFERENCIA)) | LINEA`: la línea (§0.13). `linea_ordinal` es el entero ≥ 1 ya leído. */
export const claveImportacion = (f: { proveedor: string; referencia: string; linea_ordinal: number | string }): string =>
  `${claveCompraImportacion(f)}|${typeof f.linea_ordinal === "number" ? f.linea_ordinal : Number(f.linea_ordinal)}`;

const ordenAlfa = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function normalizarContenido(c: ContenidoLinea): ContenidoLinea {
  return {
    ...c,
    costo_unitario: c.costo_unitario === null ? null : Math.round(c.costo_unitario * 10_000) / 10_000,
    alcance: { generos: [...c.alcance.generos].sort(ordenAlfa), mundos: [...c.alcance.mundos].sort(ordenAlfa), lineas: [...c.alcance.lineas].sort(ordenAlfa) },
    entregas: fundirEntregas(c.entregas),
    nota: c.nota === null || c.nota.trim() === "" ? null : c.nota.trim(),
  };
}

/** Hash del contenido normalizado de la línea (32 caracteres hexadecimales): distingue `igual` de `cambiada`. */
export function huellaContenido(contenido: ContenidoLinea): string {
  const c = normalizarContenido(contenido);
  const texto = JSON.stringify([
    c.tipo,
    c.genero_mundo_linea_id,
    c.equivalencia_id,
    c.marca_id,
    c.agrupacion_marca_id,
    c.tallas,
    c.unidades,
    c.costo_unitario,
    c.destino,
    c.tienda_id,
    c.alcance.generos,
    c.alcance.mundos,
    c.alcance.lineas,
    c.entregas.map((e) => [e.periodo, e.unidades]),
    c.recibidas,
    c.nota,
    c.moneda,
    c.fecha_compra,
  ]);
  return createHash("sha256").update(texto).digest("hex").slice(0, 32);
}

/**
 * Clasifica una línea contra lo ya importado: `nueva` (la clave no existe), `igual` (existe con la misma huella: no hace nada) o
 * `cambiada` (existe con otra; una línea sin huella guardada también cuenta como cambiada: no se puede probar que sea igual).
 */
export function clasificarFila(
  clave: string,
  huella: string,
  existentes: ReadonlyMap<string, LineaExistente>,
): { clasificacion: ClasificacionLineaImportada; existente: LineaExistente | null } {
  const existente = existentes.get(clave) ?? null;
  if (!existente) return { clasificacion: "nueva", existente: null };
  return { clasificacion: existente.huella !== null && existente.huella === huella ? "igual" : "cambiada", existente };
}

// ─── Lectores de celdas ───

/** Entero ≥ 0 (acepta `500`, `500.0`, `500,00` y espacios; `1,000` NO: es ambiguo y se rechaza). */
function leerEntero(texto: string): number | null {
  const t = texto.trim().replace(/\s+/g, "");
  if (!/^\d+(?:[.,]0{1,2})?$/.test(t)) return null;
  const n = Number(t.replace(/[.,]0{1,2}$/, ""));
  return Number.isSafeInteger(n) ? n : null;
}

/** Decimal ≥ 0 con hasta cuatro decimales (`38`, `22.5`, `22,5`, `1,234.56`). */
function leerCosto(texto: string): number | null | "invalido" {
  const t = texto.trim().replace(/\s+/g, "");
  if (t === "") return null;
  let limpio = t;
  if (t.includes(".") && t.includes(",")) limpio = t.replace(/,/g, "");
  else if (/^\d+,\d{1,4}$/.test(t)) limpio = t.replace(",", ".");
  if (!/^\d+(?:\.\d{1,4})?$/.test(limpio)) return "invalido";
  const n = Number(limpio);
  return Number.isFinite(n) && n >= 0 && n < 100_000_000 ? Math.round(n * 10_000) / 10_000 : "invalido";
}

/** `aaaa-mm` (o `aaaa-mm-dd`, que se lleva a su mes). */
function leerMes(texto: string): Mes | null {
  const m = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(texto.trim());
  if (!m) return null;
  const anio = Number(m[1]);
  const mes = Number(m[2]);
  if (anio < 2000 || anio > 2100 || mes < 1 || mes > 12) return null;
  return `${m[1]}-${m[2]}`;
}

const ORIGEN_EXCEL_MS = Date.UTC(1899, 11, 30);
const MS_POR_DIA = 86_400_000;

/** `aaaa-mm-dd` (o el número de serie de Excel, origen 1899-12-30); `null` si vacío; `"invalida"` si no es una fecha real. */
function leerFechaCompra(texto: string): string | null | "invalida" {
  const t = texto.trim();
  if (t === "") return null;
  if (/^\d{5}(?:\.0+)?$/.test(t)) {
    const d = new Date(ORIGEN_EXCEL_MS + Math.floor(Number(t)) * MS_POR_DIA);
    const anio = d.getUTCFullYear();
    if (anio < 2000 || anio > 2100) return "invalida";
    return aIso(anio, d.getUTCMonth() + 1, d.getUTCDate());
  }
  const f = leerFecha(t);
  if (f === FECHA_INVALIDA) return "invalida";
  if (f === null) return null;
  const [a, m, d] = f.split("-").map(Number);
  return a >= 2000 && a <= 2100 && esDiaReal(a, m, d) ? f : "invalida";
}

const sinAcentos = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "");

function leerTipo(texto: string): TipoLinea | "invalido" {
  const c = aCodigo(texto);
  if (c === "" || c === "ESPECIFICA") return "especifica";
  if (c === "UNA_MARCA" || c === "UNAMARCA") return "barrer_marca";
  if (c === "VARIAS_MARCAS" || c === "VARIASMARCAS") return "barrer_mezcla";
  return "invalido";
}

function leerTallas(texto: string): TallasCompra | "invalida" {
  const t = sinAcentos(texto.trim().toLowerCase());
  if (t === "") return "ambas";
  return (TALLAS_COMPRA as readonly string[]).includes(t) ? (t as TallasCompra) : "invalida";
}

function leerMoneda(texto: string): Moneda | "invalida" {
  const t = texto.trim().toUpperCase();
  if (t === "") return "PEN";
  return t === "PEN" || t === "USD" ? t : "invalida";
}

type EntregasLeidas = { ok: true; entregas: { periodo: Mes; unidades: number }[] } | { ok: false; detalle: string };

/** `2026-11:300;2026-12:200` → entregas (los meses repetidos se funden). */
function leerEntregas(texto: string): EntregasLeidas {
  const partes = texto
    .split(";")
    .map((p) => p.trim())
    .filter((p) => p !== "");
  if (partes.length === 0) return { ok: false, detalle: "Las entregas están vacías." };
  const salida: { periodo: Mes; unidades: number }[] = [];
  for (const p of partes) {
    const m = /^(\S+?)\s*:\s*(.+)$/.exec(p);
    if (!m) return { ok: false, detalle: `«${p}» no tiene la forma aaaa-mm:unidades.` };
    const mes = leerMes(m[1]);
    if (!mes) return { ok: false, detalle: `«${m[1]}» no es un mes válido (aaaa-mm).` };
    const u = leerEntero(m[2]);
    if (u === null || u <= 0) return { ok: false, detalle: `«${m[2].trim()}» no es una cantidad válida de unidades.` };
    salida.push({ periodo: mes, unidades: u });
  }
  const fundidas = fundirEntregas(salida);
  if (fundidas.length > MAX_ENTREGAS) return { ok: false, detalle: `Una línea admite hasta ${MAX_ENTREGAS} entregas.` };
  return { ok: true, entregas: fundidas };
}

// ─── Fila procesada ───

type DatosFila = {
  fila: number;
  compra_clave: string;
  clave: string;
  proveedor_txt: string;
  referencia_txt: string;
  ordinal: number;
  fecha_compra: string;
  moneda: Moneda;
  contenido: ContenidoLinea;
  huella: string;
  ruta: string | null;
  marca: string | null;
  agrupacion_marca: string | null;
  recepcion: { periodo: Mes; unidades: number; fecha: string } | null;
  repartos: FilaRepartoGuardar[];
  avisos: { aviso: AvisoImportacionCompra; detalle?: string }[];
  proveedor: ProveedorRegistro | null;
  nota: string | null;
};

type Omision = { motivo: MotivoOmisionCompra; detalle?: string };
type Resultado = { ok: true; datos: DatosFila } | { ok: false; omision: Omision };

const falla = (motivo: MotivoOmisionCompra, detalle?: string): Resultado => ({ ok: false, omision: detalle === undefined ? { motivo } : { motivo, detalle } });

const ETIQUETAS_CAMBIO: Record<string, string> = {
  tipo: "tipo",
  ruta: "GML",
  marca: "marca",
  agrupacion_marca: "agrupación",
  tallas: "tallas",
  unidades: "unidades",
  costo_unitario: "costo",
  destino: "destino",
  entregas: "entregas",
  recibidas: "recibidas",
  alcance: "alcance",
  nota: "nota",
  moneda: "moneda",
  fecha_compra: "fecha de compra",
};

/** Lista de cambios en castellano entre lo ya importado y lo que trae el archivo («unidades 500 → 600»). */
export function cambiosEntre(
  antes: ContenidoLinea,
  despues: ContenidoLinea,
  nombres: { nodo: (c: ContenidoLinea) => string; marca: (id: string | null) => string; agrupacion: (id: string | null) => string; tienda: (id: string | null) => string },
): string[] {
  const legible = (c0: ContenidoLinea) => {
    const c = normalizarContenido(c0);
    return {
      tipo: c.tipo,
      ruta: nombres.nodo(c),
      marca: nombres.marca(c.marca_id),
      agrupacion_marca: nombres.agrupacion(c.agrupacion_marca_id),
      tallas: c.tallas,
      unidades: c.unidades,
      costo_unitario: c.costo_unitario,
      destino: c.destino === "tienda" ? nombres.tienda(c.tienda_id) : c.destino,
      entregas: c.entregas.map((e) => `${e.periodo}:${e.unidades}`).join("; "),
      recibidas: c.recibidas,
      alcance: [...c.alcance.generos, ...c.alcance.mundos, ...c.alcance.lineas].join(", "),
      nota: c.nota,
      moneda: c.moneda,
      fecha_compra: c.fecha_compra,
    } satisfies Record<string, unknown>;
  };
  const a = legible(antes);
  const d = legible(despues);
  const cambios: string[] = [];
  for (const k of Object.keys(d) as (keyof typeof d)[]) {
    const resumen = resumenCambios({ [k]: a[k] }, { [k]: d[k] }, ETIQUETAS_CAMBIO);
    if (resumen !== "Sin cambios") cambios.push(resumen);
  }
  return cambios;
}

// ─── Previsualización ───

const TEXTOS = {
  marca_y_agrupacion: "Elige la marca o la agrupación, no las dos.",
  tipo_no_disponible: "Los lotes de varias marcas se activan con M9a.",
} as const;

type GrupoCompra = {
  clave: string;
  proveedor_txt: string;
  referencia_txt: string;
  fecha_compra: string;
  moneda: Moneda;
  proveedor: ProveedorRegistro | null;
  existente: CompraExistente | null;
  validas: number;
  nuevas: LineaPlanImportar[];
};

/**
 * Lee y valida el archivo de compras y devuelve el reporte de previsualización más el plan por compra (una `importar_compra` por
 * compra, solo con sus líneas `nueva`). `mezcla` (hoja `MEZCLA`, M9a) se acepta pero no se usa todavía. Determinista: el orden de las
 * compras y de las líneas es el del archivo.
 */
export function previsualizarImportacionCompras(
  filas: readonly FilaImportacionCompra[],
  _mezcla: readonly FilaMezclaImportacion[],
  estado: EstadoImportacionCompras,
  opciones: OpcionesImportacion,
): ResultadoPrevisualizacion {
  void _mezcla;
  const tiposDisponibles = opciones.tipos_disponibles ?? TIPOS_LINEA_DISPONIBLES;

  const omitidas: FilaOmitidaCompra[] = [];
  const lineasApi: LineaImportacionApi[] = [];
  const avisosPlanos: { fila: number; aviso: AvisoImportacionCompra; detalle?: string }[] = [];
  const grupos = new Map<string, GrupoCompra>();
  const vistos = new Map<string, number>();
  const cabeceras = new Map<string, { fila: number; fecha: string; moneda: Moneda }>();
  let nuevas = 0;
  let iguales = 0;
  let cambiadas = 0;

  const existentes = new Map(estado.lineas_existentes.filter((l) => l.compra_estado !== "cancelada").map((l) => [l.clave, l]));
  const comprasVivas = estado.compras.filter((c) => c.estado !== "cancelada");
  const nodosPorId = new Map(estado.nodos.map((n) => [n.id, n]));
  const nodosAlcance = new Map<string, NodoAlcance>(estado.nodos.map((n) => [n.id, { genero_id: n.genero_id, mundo_id: n.mundo_id, linea_id: n.linea_id }]));
  const nombreAgrupacion = (id: string | null) => (id ? (estado.agrupaciones.find((a) => a.id === id)?.nombre ?? null) : null);
  const nombreMarca = (id: string | null) => (id ? (estado.marcas.find((m) => m.id === id)?.nombre ?? null) : null);
  const codigoTienda = (id: string | null) => (id ? (estado.tiendas.find((t) => t.id === id)?.codigo ?? "—") : "—");

  const rutaDe = (nodoId: string | null, equivalenciaId: string | null): string | null => {
    if (nodoId === null) return null;
    const n = nodosPorId.get(nodoId);
    if (!n) return null;
    const g = estado.generos.find((x) => x.id === n.genero_id)?.nombre ?? "?";
    const m = estado.mundos.find((x) => x.id === n.mundo_id)?.nombre ?? "?";
    const l = estado.lineas.find((x) => x.id === n.linea_id)?.nombre ?? "?";
    const eq = equivalenciaId ? estado.equivalencias.find((e) => e.id === equivalenciaId) : undefined;
    return `${g} · ${m} · ${l}${eq && !eq.es_generica ? ` › ${eq.nombre}` : ""}`;
  };

  const nombresCambio = {
    nodo: (c: ContenidoLinea) => rutaDe(c.genero_mundo_linea_id, c.equivalencia_id) ?? "—",
    marca: (id: string | null) => nombreMarca(id) ?? "—",
    agrupacion: (id: string | null) => nombreAgrupacion(id) ?? "—",
    tienda: codigoTienda,
  };

  filas.forEach((cruda, i) => {
    const fila = i + 1;
    const base = {
      proveedor: cruda.proveedor.trim(),
      referencia: cruda.referencia.trim(),
      linea_ordinal: cruda.linea_ordinal.trim(),
    };
    const omitir = (o: Omision, extra: Pick<FilaOmitidaCompra, "fila_original"> = {}) => {
      omitidas.push({ fila, motivo: o.motivo, ...(o.detalle === undefined ? {} : { detalle: o.detalle }), ...base, ...extra });
    };

    const r = procesarFila(cruda, fila, estado, opciones, tiposDisponibles, {
      nodosAlcance,
      rutaDe,
      nombreAgrupacion,
      nombreMarca,
    });
    if (!r.ok) return omitir(r.omision);
    const d = r.datos;

    // Proveedor desactivado.
    if (d.proveedor && !d.proveedor.activo) return omitir({ motivo: "proveedor_inactivo", detalle: d.proveedor.nombre });

    // La misma clave dos veces: manda la primera fila válida.
    const previa = vistos.get(d.clave);
    if (previa !== undefined) {
      return omitir({ motivo: "linea_repetida", detalle: `La clave ${d.clave} ya está en la fila ${previa}.` }, { fila_original: previa });
    }

    // Filas de una misma compra con otra FECHA_COMPRA o MONEDA: manda la primera fila válida de la compra.
    const cab = cabeceras.get(d.compra_clave);
    if (cab && (cab.fecha !== d.fecha_compra || cab.moneda !== d.moneda)) {
      const que = cab.fecha !== d.fecha_compra ? `FECHA_COMPRA ${d.fecha_compra} ≠ ${cab.fecha}` : `MONEDA ${d.moneda} ≠ ${cab.moneda}`;
      return omitir({ motivo: "cabecera_inconsistente", detalle: `${que} de la fila ${cab.fila}: una compra tiene una sola fecha y una sola moneda.` });
    }

    vistos.set(d.clave, fila);
    if (!cab) cabeceras.set(d.compra_clave, { fila, fecha: d.fecha_compra, moneda: d.moneda });

    const { clasificacion, existente } = clasificarFila(d.clave, d.huella, existentes);

    // Compra existente (sin cancelar) de ese proveedor y referencia.
    const compraExistente =
      d.proveedor === null
        ? null
        : (comprasVivas.find((c) => c.proveedor_id === d.proveedor?.id && c.referencia !== null && mayusculas(c.referencia) === mayusculas(d.referencia_txt)) ?? null);

    if (clasificacion === "nueva" && compraExistente && compraExistente.cancelada_at !== null) {
      vistos.delete(d.clave);
      return omitir({ motivo: "cabecera_inconsistente", detalle: `La compra ${compraExistente.numero} ya cerró su saldo: no admite líneas nuevas.` });
    }

    // Una línea nueva que se agrega a una compra existente hereda su cabecera: otra fecha u otra moneda es otra compra.
    if (clasificacion === "nueva" && compraExistente) {
      const fechaExistente = compraExistente.fecha_compra?.slice(0, 10);
      const difiereFecha = fechaExistente !== undefined && fechaExistente !== d.fecha_compra;
      const difiereMoneda = compraExistente.moneda !== undefined && compraExistente.moneda !== d.moneda;
      if (difiereFecha || difiereMoneda) {
        vistos.delete(d.clave);
        if (!cab) cabeceras.delete(d.compra_clave);
        const que = difiereFecha ? `FECHA_COMPRA ${d.fecha_compra} ≠ ${fechaExistente}` : `MONEDA ${d.moneda} ≠ ${compraExistente.moneda}`;
        return omitir({ motivo: "cabecera_inconsistente", detalle: `${que} de la compra ${compraExistente.numero}, que ya existe: una compra tiene una sola fecha y una sola moneda.` });
      }
    }

    let grupo = grupos.get(d.compra_clave);
    if (!grupo) {
      grupo = {
        clave: d.compra_clave,
        proveedor_txt: d.proveedor?.nombre ?? d.proveedor_txt,
        referencia_txt: d.referencia_txt,
        fecha_compra: d.fecha_compra,
        moneda: d.moneda,
        proveedor: d.proveedor,
        existente: compraExistente,
        validas: 0,
        nuevas: [],
      };
      grupos.set(d.compra_clave, grupo);
    }
    grupo.validas += 1;

    let cambios: string[] = [];
    if (clasificacion === "igual") iguales += 1;
    else if (clasificacion === "cambiada") {
      cambiadas += 1;
      cambios = existente?.contenido ? cambiosEntre(existente.contenido, d.contenido, nombresCambio) : [];
      omitir({
        motivo: "cambiada_requiere_edicion",
        detalle:
          cambios.length > 0
            ? `La línea ya existe en ${existente?.compra_numero ?? "otra compra"} con otro contenido (${cambios.join("; ")}). Edítala desde la compra.`
            : `La línea ya existe en ${existente?.compra_numero ?? "otra compra"} con otro contenido. Edítala desde la compra.`,
      });
    } else {
      nuevas += 1;
      grupo.nuevas.push({ fila, clave: d.clave, linea: payloadLinea(d) });
    }

    // Los avisos solo importan en lo que se va a crear.
    const avisosLinea = clasificacion === "nueva" ? d.avisos : [];
    for (const a of avisosLinea) avisosPlanos.push({ fila, aviso: a.aviso, ...(a.detalle === undefined ? {} : { detalle: a.detalle }) });
    lineasApi.push({
      fila,
      clave: d.clave,
      compra_clave: d.compra_clave,
      linea_ordinal: d.ordinal,
      clasificacion,
      tipo: d.contenido.tipo,
      ruta: d.ruta,
      marca: d.marca,
      agrupacion_marca: d.agrupacion_marca,
      unidades: d.contenido.unidades,
      recibidas: d.contenido.recibidas,
      entregas: d.contenido.entregas,
      avisos: avisosLinea.map((a) => a.aviso),
      cambios,
    });
  });

  const compras: PlanCompraImportar[] = [];
  const comprasApi: CompraImportacionApi[] = [];
  const proveedoresACrear: string[] = [];
  const yaNuevos = new Set<string>();
  for (const g of grupos.values()) {
    if (g.nuevas.length === 0) continue;
    const esNuevo = g.proveedor === null;
    if (esNuevo && !yaNuevos.has(claveProveedor(g.proveedor_txt))) {
      yaNuevos.add(claveProveedor(g.proveedor_txt));
      proveedoresACrear.push(g.proveedor_txt);
    }
    compras.push({
      clave: g.clave,
      proveedor: g.proveedor_txt,
      referencia: g.referencia_txt,
      fecha_compra: g.fecha_compra,
      moneda: g.moneda,
      proveedor_id: g.proveedor?.id ?? null,
      proveedor_es_nuevo: esNuevo,
      origen: opciones.carga_inicial ? "carga_inicial" : "comprador",
      estado: opciones.carga_inicial ? "confirmada" : "borrador",
      lineas: g.nuevas,
    });
    comprasApi.push({
      clave: g.clave,
      proveedor: g.proveedor_txt,
      referencia: g.referencia_txt,
      fecha_compra: g.fecha_compra,
      moneda: g.moneda,
      lineas: g.validas,
      lineas_nuevas: g.nuevas.length,
      existente: g.existente ? { compra_id: g.existente.id, numero: g.existente.numero } : null,
    });
  }

  return {
    compras,
    reporte: {
      modo: "previsualizar",
      carga_inicial: opciones.carga_inicial,
      k_prima: opciones.k_prima,
      totales: { recibidas: filas.length, procesadas: nuevas + iguales + cambiadas, omitidas: omitidas.length, nuevas, iguales, cambiadas },
      compras_a_crear: comprasApi,
      proveedores_a_crear: proveedoresACrear,
      lineas: lineasApi,
      omitidas,
      avisos: avisosPlanos,
      aplicadas: [],
      no_aplicadas: [],
    },
  };
}

type Ayudas = {
  nodosAlcance: Map<string, NodoAlcance>;
  rutaDe: (nodoId: string | null, equivalenciaId: string | null) => string | null;
  nombreAgrupacion: (id: string | null) => string | null;
  nombreMarca: (id: string | null) => string | null;
};

function procesarFila(
  cruda: FilaImportacionCompra,
  fila: number,
  estado: EstadoImportacionCompras,
  opciones: OpcionesImportacion,
  tiposDisponibles: readonly TipoLinea[],
  ayudas: Ayudas,
): Resultado {
  const proveedorTxt = cruda.proveedor.trim();
  const referenciaTxt = cruda.referencia.trim();

  // (1) Fila de totales o vacía.
  if ([cruda.proveedor, cruda.genero, cruda.marca].some((v) => normalizarNombre(v) === "TOTAL")) return falla("fila_total");
  if (proveedorTxt === "") return falla("proveedor_requerido", "Indica el proveedor.");

  // (2) Cabecera: fecha, referencia y número de línea (la clave natural no existe sin ellos).
  const fecha = leerFechaCompra(cruda.fecha_compra);
  if (fecha === null) return falla("fecha_requerida", "La fecha de compra es obligatoria (aaaa-mm-dd).");
  if (fecha === "invalida") return falla("fecha_invalida", `«${cruda.fecha_compra.trim()}» no es una fecha válida (aaaa-mm-dd).`);
  if (referenciaTxt === "") return falla("referencia_requerida", "La referencia es obligatoria: agrupa las líneas de una compra.");
  const ordinal = leerEntero(cruda.linea_ordinal);
  if (ordinal === null || ordinal < 1) {
    return falla("linea_requerida", cruda.linea_ordinal.trim() === "" ? "El número de línea es obligatorio." : `«${cruda.linea_ordinal.trim()}» no es un número de línea válido (entero desde 1).`);
  }
  const moneda = leerMoneda(cruda.moneda);
  if (moneda === "invalida") return falla("moneda_invalida", `«${cruda.moneda.trim()}» no es una moneda válida (PEN o USD).`);

  // (3) Tipo.
  const tipo = leerTipo(cruda.tipo);
  if (tipo === "invalido") return falla("tipo_invalido", `«${cruda.tipo.trim()}» no es un tipo válido (ESPECIFICA, UNA_MARCA o VARIAS_MARCAS).`);
  if (!tiposDisponibles.includes(tipo) || tipo === "barrer_mezcla") return falla("tipo_no_disponible", TEXTOS.tipo_no_disponible);

  // (4) Marca o agrupación.
  const marcaTxt = normalizarNombre(cruda.marca);
  const agrupTxt = normalizarNombre(cruda.agrupacion_marca);
  if (marcaTxt !== "" && agrupTxt !== "") return falla("marca_y_agrupacion", TEXTOS.marca_y_agrupacion);

  let unidadMarca: MarcaCompra | null = null;
  let miembroResuelto = false;
  let agrupacionId: string | null = null;

  if (tipo === "barrer_marca") {
    if (marcaTxt === "") return falla("sin_marca_ni_agrupacion", "Un lote de una marca necesita la columna MARCA.");
    if (agrupTxt !== "") return falla("marca_y_agrupacion", "Un lote de una marca no lleva agrupación.");
    if ([cruda.genero, cruda.mundo, cruda.linea, cruda.equivalencia].some((v) => v.trim() !== "")) {
      return falla("tipo_invalido", "Un lote de una marca no lleva género, mundo, línea ni equivalencia: usa ALCANCE o el tipo ESPECIFICA.");
    }
  } else {
    if (marcaTxt === "" && agrupTxt === "") return falla("sin_marca_ni_agrupacion", "Indica la marca o la agrupación de marcas.");
  }

  if (marcaTxt !== "") {
    const codigo = aCodigo(cruda.marca);
    const marca =
      estado.marcas.find((m) => normalizarNombre(m.nombre) === marcaTxt) ?? (codigo ? estado.marcas.find((m) => m.codigo !== null && m.codigo.toUpperCase() === codigo) : undefined);
    if (!marca) return falla("marca_desconocida", marcaTxt);
    if (!marca.activo) return falla("marca_inactiva", marca.nombre);
    const u = resolverUnidadDeMarca(marca, estado.marcas);
    unidadMarca = u.unidad;
    miembroResuelto = u.miembro_resuelto;
  } else if (agrupTxt !== "") {
    const a = buscarEnCatalogo(estado.agrupaciones, agrupTxt);
    if (!a) return falla("agrupacion_desconocida", agrupTxt);
    if (!a.activo) return falla("agrupacion_desconocida", `${a.nombre} está desactivada.`);
    agrupacionId = a.id;
  }

  // (5) GML y equivalencia (específica) o alcance (lote).
  let nodoId: string | null = null;
  let equivalenciaId: string | null = null;
  let alcance: AlcanceLinea = null;

  if (tipo === "especifica") {
    if ([cruda.genero, cruda.mundo, cruda.linea].every((v) => v.trim() === "")) return falla("gml_requerido", "Indica el género, el mundo y la línea.");
    const resuelto = resolverGml(cruda, estado);
    if (!resuelto.ok) return falla(resuelto.motivo, resuelto.detalle);
    nodoId = resuelto.nodo.id;
    const nodo = estado.nodos.find((n) => n.id === nodoId);
    const esGmle = nodo?.nivel_planificacion === "GMLE";
    const eqEscrita = cruda.equivalencia;

    if (esEquivalenciaGenerica(eqEscrita)) {
      if (esGmle) {
        const generica = estado.equivalencias.find((e) => e.genero_mundo_linea_id === nodoId && e.es_generica && e.activo);
        if (!generica) return falla("equivalencia_desconocida", `${resuelto.linea.nombre} se planifica por equivalencia: indica cuál.`);
        equivalenciaId = generica.id;
      }
    } else {
      const nombreEq = esEquivalenciaIgualALinea(eqEscrita) ? resuelto.linea.nombre : eqEscrita;
      const delNodo = estado.equivalencias.filter((e) => e.genero_mundo_linea_id === nodoId);
      const hallada = buscarEnCatalogo(delNodo, nombreEq);
      if (!esGmle) return falla("equivalencia_requiere_gmle", `${resuelto.linea.nombre} se planifica como GML: no lleva equivalencia.`);
      if (hallada) {
        if (!hallada.activo) return falla("equivalencia_desconocida", `${hallada.nombre} está desactivada.`);
        equivalenciaId = hallada.id;
      } else if (buscarEnCatalogo(estado.equivalencias, nombreEq)) {
        return falla("equivalencia_de_otro_nodo", `«${normalizarNombre(nombreEq)}» es de otro nodo.`);
      } else {
        return falla("equivalencia_desconocida", normalizarNombre(nombreEq));
      }
    }
    if (cruda.alcance.trim() !== "") return falla("alcance_invalido", "El alcance solo se usa en los lotes de una marca.");
  } else {
    const leido = leerAlcance(cruda.alcance, estado);
    if (leido.ok === false) return falla("alcance_invalido", leido.detalle);
    alcance = leido.alcance;
  }

  // (6) Tallas, unidades y costo.
  const tallas = leerTallas(cruda.tallas);
  if (tallas === "invalida") return falla("tallas_invalida", `«${cruda.tallas.trim()}» no es válido (centrales, extremas o ambas).`);
  const unidades = leerEntero(cruda.unidades);
  if (unidades === null || unidades < 1 || unidades > MAX_UNIDADES_LINEA) {
    return falla("unidades_invalida", cruda.unidades.trim() === "" ? "Indica las unidades." : `«${cruda.unidades.trim()}» no es una cantidad válida (entero mayor que cero).`);
  }
  const costo = leerCosto(cruda.costo_unitario);
  if (costo === "invalido") return falla("costo_invalido", `«${cruda.costo_unitario.trim()}» no es un costo válido.`);

  // (7) Entregas: ENTREGAS manda sobre LLEGADA.
  let entregas: { periodo: Mes; unidades: number }[];
  if (cruda.entregas.trim() !== "") {
    const e = leerEntregas(cruda.entregas);
    if (!e.ok) return falla("entregas_invalidas", e.detalle);
    entregas = e.entregas;
  } else {
    if (cruda.llegada.trim() === "") return falla("llegada_invalida", "Indica LLEGADA (aaaa-mm) o ENTREGAS (aaaa-mm:unidades;…).");
    const mes = leerMes(cruda.llegada);
    if (!mes) return falla("llegada_invalida", `«${cruda.llegada.trim()}» no es un mes válido (aaaa-mm).`);
    entregas = [{ periodo: mes, unidades }];
  }
  const sumaEntregas = entregas.reduce((a, e) => a + e.unidades, 0);
  if (sumaEntregas !== unidades) return falla("entregas_invalidas", `Las entregas suman ${sumaEntregas} y la línea es de ${unidades}.`);

  // (8) Recibidas.
  let recibidas = 0;
  if (cruda.recibidas.trim() !== "") {
    const r = leerEntero(cruda.recibidas);
    if (r === null) return falla("recibidas_invalida", `«${cruda.recibidas.trim()}» no es una cantidad válida.`);
    if (r > unidades) return falla("recibidas_invalida", `Se declararon ${r} recibidas y la línea es de ${unidades}.`);
    if (r > 0 && !opciones.carga_inicial) return falla("recibidas_invalida", "RECIBIDAS solo se usa en la carga inicial de compras ya hechas.");
    recibidas = r;
  }

  // (9) Destino.
  const destino = leerDestino(cruda.destino, estado);
  if (destino.ok === false) return falla("destino_desconocido", destino.detalle);

  // (10) Reparto de un lote (UNA_MARCA).
  let repartos: FilaRepartoGuardar[] = [];
  if (tipo === "barrer_marca" && unidadMarca) {
    if (!admiteLote(unidadMarca)) {
      return falla("modalidad_no_barrer", `${unidadMarca.nombre} no se compra al barrer: registra la compra con su género, mundo y línea.`);
    }
    const vigente = estado.repartos.find((r) => r.marca_id === unidadMarca?.id) ?? null;
    const resultado = repartirLinea({ marca_id: unidadMarca.id, alcance }, entregas, vigente, ayudas.nodosAlcance);
    if (resultado.ok === false) return falla(resultado.motivo, resultado.detalle);
    repartos = resultado.por_entrega.flatMap((p) => p.filas);
  }

  // (11) Reglas de línea (regla 15): coherencia entre campos y catálogos.
  const marcaId = unidadMarca?.id ?? null;
  const rechazo = motivoRechazoLinea(
    {
      tipo,
      genero_mundo_linea_id: nodoId,
      equivalencia_id: equivalenciaId,
      marca_id: marcaId,
      agrupacion_marca_id: agrupacionId,
      unidades,
      destino: destino.destino,
      tienda_id: destino.tienda_id,
      entregas,
    },
    estado,
    tiposDisponibles,
  );
  if (rechazo) return falla(rechazo.motivo === "tienda_requerida" ? "destino_desconocido" : rechazo.motivo, rechazo.detalle);

  // (12) Avisos.
  const avisos: { aviso: AvisoImportacionCompra; detalle?: string }[] = [];
  if (miembroResuelto && unidadMarca) avisos.push({ aviso: "miembro_resuelto", detalle: `${normalizarNombre(cruda.marca)} cuenta como ${unidadMarca.nombre}.` });

  const kPrima = opciones.k_prima;
  let recepcion: DatosFila["recepcion"] = null;
  if (recibidas > 0) {
    const pasadas = kPrima ? entregas.filter((e) => e.periodo <= kPrima) : [];
    const mes = pasadas.length > 0 ? pasadas[pasadas.length - 1].periodo : (kPrima ?? entregas[entregas.length - 1].periodo);
    recepcion = { periodo: mes, unidades: recibidas, fecha: ultimoDiaDelMes(mes) };
  }
  if (kPrima) {
    const pend = pendientesPorEntrega(
      { unidades, unidades_canceladas: 0 },
      entregas.map((e) => ({ id: e.periodo, periodo: e.periodo, unidades: e.unidades })),
      recepcion ? [{ id: "recibidas", recibida_periodo: recepcion.periodo, unidades: recepcion.unidades }] : [],
    );
    const vencidas = pend.entregas.filter((e) => esEntregaVencida(e, kPrima));
    if (vencidas.length > 0) {
      avisos.push({
        aviso: "entrega_pasada",
        detalle: vencidas.map((e) => `${e.periodo}: faltan ${e.pendiente} u`).join("; ") + `. Quedará vencida hasta confirmar su ingreso.`,
      });
    }
  }
  if (destino.destino === "intercompany_directo" && marcaId) {
    const mes = entregas[0].periodo;
    const gmls = tipo === "barrer_marca" ? [...new Set(repartos.map((r) => r.genero_mundo_linea_id))] : nodoId ? [nodoId] : [];
    const equivalencias = tipo === "barrer_marca" ? null : equivalenciaId;
    const conRegla = gmls.some((g) => reglaIntercompany(estado.reglas, marcaId, g, equivalencias, mes) !== null);
    avisos.push({ aviso: conRegla ? "directo_con_regla" : "directo_sin_regla" });
  }

  // (13) Contenido, clave y huella.
  const alcanceIds = {
    generos: [...(alcance?.generos ?? [])],
    mundos: [...(alcance?.mundos ?? [])],
    lineas: [...(alcance?.lineas ?? [])],
  };
  const nota = cruda.nota.trim() === "" ? null : cruda.nota.trim().slice(0, MAX_NOTA_LINEA);
  const contenido: ContenidoLinea = normalizarContenido({
    tipo,
    genero_mundo_linea_id: nodoId,
    equivalencia_id: equivalenciaId,
    marca_id: marcaId,
    agrupacion_marca_id: agrupacionId,
    tallas,
    unidades,
    costo_unitario: costo,
    destino: destino.destino,
    tienda_id: destino.tienda_id,
    alcance: alcanceIds,
    entregas,
    recibidas,
    nota,
    moneda,
    fecha_compra: fecha,
  });

  const proveedor = buscarProveedor(proveedorTxt, estado.proveedores);
  const agrupacionVisible = agrupacionId ?? unidadMarca?.agrupacion_marca_id ?? null;

  return {
    ok: true,
    datos: {
      fila,
      compra_clave: claveCompraImportacion({ proveedor: proveedorTxt, referencia: referenciaTxt }),
      clave: claveImportacion({ proveedor: proveedorTxt, referencia: referenciaTxt, linea_ordinal: ordinal }),
      proveedor_txt: proveedorTxt,
      referencia_txt: referenciaTxt,
      ordinal,
      fecha_compra: fecha,
      moneda,
      contenido,
      huella: huellaContenido(contenido),
      ruta: tipo === "especifica" ? ayudas.rutaDe(nodoId, equivalenciaId) : null,
      marca: unidadMarca?.nombre ?? null,
      agrupacion_marca: ayudas.nombreAgrupacion(agrupacionVisible),
      recepcion,
      repartos,
      avisos,
      proveedor,
      nota,
    },
  };
}

type DestinoLeido = { ok: true; destino: DestinoCompra; tienda_id: string | null } | { ok: false; detalle: string };

function leerDestino(texto: string, estado: EstadoImportacionCompras): DestinoLeido {
  const t = normalizarNombre(texto);
  if (t === "" || t === "CD") return { ok: true, destino: "cd", tienda_id: null };
  if (t === "DIRECTO" || t === "INTERCOMPANY DIRECTO" || t === "INTERCOMPANY_DIRECTO") return { ok: true, destino: "intercompany_directo", tienda_id: null };
  const codigo = aCodigo(texto);
  const tienda = estado.tiendas.find((x) => x.codigo.toUpperCase() === t || x.codigo.toUpperCase() === codigo);
  if (!tienda) return { ok: false, detalle: `«${t}» no es CD, DIRECTO ni el código de una tienda.` };
  if (!tienda.activo) return { ok: false, detalle: `La tienda ${tienda.codigo} está desactivada.` };
  if (tienda.tipo !== "Tienda") return { ok: false, detalle: `${tienda.codigo} es un centro de distribución: usa CD.` };
  return { ok: true, destino: "tienda", tienda_id: tienda.id };
}

type AlcanceLeido =
  | { ok: true; alcance: { generos: string[]; mundos: string[]; lineas: string[] } }
  | { ok: false; detalle: string };

/** `HOMBRE;URBANO,CASUAL;DENIM`: géneros; mundos; líneas (cada lista separada por comas, por nombre o código). Vacío = todo. */
function leerAlcance(texto: string, estado: EstadoImportacionCompras): AlcanceLeido {
  const vacio = { generos: [], mundos: [], lineas: [] };
  if (texto.trim() === "") return { ok: true, alcance: vacio };
  const segmentos = texto.split(";");
  if (segmentos.length > 3) return { ok: false, detalle: "El alcance tiene la forma GENEROS;MUNDOS;LINEAS (hasta tres partes)." };
  const catalogos = [
    { nombre: "género", cat: estado.generos },
    { nombre: "mundo", cat: estado.mundos },
    { nombre: "línea", cat: estado.lineas },
  ];
  const listas: string[][] = [[], [], []];
  for (let i = 0; i < segmentos.length; i++) {
    const valores = segmentos[i]
      .split(",")
      .map((v) => v.trim())
      .filter((v) => v !== "");
    for (const v of valores) {
      const { nombre, cat } = catalogos[i];
      const hallado = resolverCatalogo(cat, v);
      if (!hallado) {
        return { ok: false, detalle: buscarEnCatalogo(cat, v) ? `El ${nombre} «${normalizarNombre(v)}» está desactivado.` : `«${normalizarNombre(v)}» no es un ${nombre} conocido.` };
      }
      if (!listas[i].includes(hallado.id)) listas[i].push(hallado.id);
    }
  }
  return { ok: true, alcance: { generos: listas[0], mundos: listas[1], lineas: listas[2] } };
}

// ─── Plan → argumentos de la función SQL ───

function payloadLinea(d: DatosFila): PayloadLineaImportar {
  const c = d.contenido;
  const alcance: PayloadLineaImportar["alcance"] = {};
  if (c.alcance.generos.length > 0) alcance.generos = c.alcance.generos;
  if (c.alcance.mundos.length > 0) alcance.mundos = c.alcance.mundos;
  if (c.alcance.lineas.length > 0) alcance.lineas = c.alcance.lineas;
  return {
    clave_importacion: d.clave,
    huella_importacion: d.huella,
    tipo: c.tipo,
    genero_mundo_linea_id: c.genero_mundo_linea_id,
    equivalencia_id: c.equivalencia_id,
    marca_id: c.marca_id,
    agrupacion_marca_id: c.agrupacion_marca_id,
    tallas: c.tallas,
    unidades: c.unidades,
    costo_unitario: c.costo_unitario,
    destino: c.destino,
    tienda_id: c.tienda_id,
    alcance,
    nota: c.nota,
    avisos: d.avisos.map((a) => a.aviso),
    entregas: c.entregas.map((e) => ({ periodo: primerDiaDelMes(e.periodo), unidades: e.unidades, origen: "importada" as const })),
    repartos: d.repartos.map((r) => ({ ...r, entrega_periodo: primerDiaDelMes(r.entrega_periodo) })),
    recepciones: d.recepcion
      ? [{ recibida_periodo: primerDiaDelMes(d.recepcion.periodo), unidades: d.recepcion.unidades, fecha_recepcion: d.recepcion.fecha, nota: null }]
      : [],
  };
}

/** `p_compra` de `importar_compra` para una compra del plan. */
export function payloadImportarCompra(plan: PlanCompraImportar): PayloadImportarCompra {
  return {
    ...(plan.proveedor_id ? { proveedor_id: plan.proveedor_id } : { proveedor_nombre: plan.proveedor, proveedor_es_intercompany: false }),
    referencia: plan.referencia,
    fecha_compra: plan.fecha_compra,
    moneda: plan.moneda,
    nota: null,
    origen: plan.origen,
    estado: plan.estado,
    lineas: plan.lineas.map((l) => l.linea),
  };
}

/** `rpc("importar_compra", args)`. */
export function argsImportarCompra(plan: PlanCompraImportar, actor: ActorCompra): { p_compra: PayloadImportarCompra; p_actor: ActorCompra } {
  return { p_compra: payloadImportarCompra(plan), p_actor: actor };
}

/** Agrega un aviso a una línea del reporte y del plan (lo usa el servicio para `exceso`, que se calcula con el flujo). */
export function agregarAviso(
  resultado: ResultadoPrevisualizacion,
  fila: number,
  aviso: AvisoImportacionCompra,
  detalle?: string,
): ResultadoPrevisualizacion {
  const compras = resultado.compras.map((c) => ({
    ...c,
    lineas: c.lineas.map((l) => (l.fila === fila && !l.linea.avisos.includes(aviso) ? { ...l, linea: { ...l.linea, avisos: [...l.linea.avisos, aviso] } } : l)),
  }));
  const lineas = resultado.reporte.lineas.map((l) => (l.fila === fila && !l.avisos.includes(aviso) ? { ...l, avisos: [...l.avisos, aviso] } : l));
  return {
    compras,
    reporte: { ...resultado.reporte, lineas, avisos: [...resultado.reporte.avisos, { fila, aviso, ...(detalle === undefined ? {} : { detalle }) }] },
  };
}

// ─── Resultado de aplicar ───

export type ResultadoAplicacionCompra =
  | { clave: string; ok: true; compra_id: string; numero: string }
  | { clave: string; ok: false; motivo: MotivoFuncionCompra | "error"; mensaje: string };

/**
 * Pasa el reporte a `modo = "aplicar"` con lo que respondió cada `importar_compra`: `aplicadas` (con el número de compra y las
 * líneas enviadas) y `no_aplicadas` (con el motivo). Una compra sin resultado se cuenta como no aplicada (`error`).
 */
export function reporteAplicado(
  resultado: ResultadoPrevisualizacion,
  respuestas: readonly ResultadoAplicacionCompra[],
): ReporteImportacionComprasApi {
  const aplicadas: AplicadaImportacionApi[] = [];
  const noAplicadas: NoAplicadaImportacionApi[] = [];
  for (const c of resultado.compras) {
    const r = respuestas.find((x) => x.clave === c.clave);
    if (r?.ok) aplicadas.push({ clave: c.clave, compra_id: r.compra_id, numero: r.numero, lineas: c.lineas.length });
    else {
      noAplicadas.push({
        clave: c.clave,
        proveedor: c.proveedor,
        referencia: c.referencia,
        motivo: r && !r.ok ? r.motivo : "error",
        mensaje: r && !r.ok ? r.mensaje : "La compra no se aplicó.",
      });
    }
  }
  return { ...resultado.reporte, modo: "aplicar", aplicadas, no_aplicadas: noAplicadas };
}
