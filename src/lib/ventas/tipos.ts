import type { MedidasCarga } from "./tipos-api";

/**
 * Constantes y tipos de la lógica pura de M5 (docs/modulos/05-venta-stock.md).
 * Sin dependencias de React ni de la base: los usan por igual el navegador
 * (lectura, acumulador, informe) y el servidor (resolución, handlers).
 *
 * Los tipos de la API que viajan por la red están en `tipos-api.ts`.
 */

export type { MedidasCarga };
export { TANDA_IN } from "@/lib/arbol/importar";

// ─── Constantes (ficha, "Contratos de API") ───

/** Filas por petición del navegador al servidor (≈ 400 KB). */
export const TANDA_CLIENTE = 10_000;
/** Filas por `upsert` hacia PostgREST. Si en el piloto falla, bajar a 500. */
export const TANDA_INSERT_VENTAS = 2_000;
/** Marcas por `upsert` al crear marcas nuevas. */
export const TANDA_MARCAS = 500;
/** Una tanda es idempotente y se reintenta antes de descartar el mes. */
export const REINTENTOS_TANDA = 3;
/** Una carga `en_curso` sin tandas hace más de esto se considera caducada. */
export const CADUCIDAD_CARGA_MIN = 30;
/** Un mes cuyos errores pesan esto o más (filas, venta o stock valorizado) se bloquea. */
export const UMBRAL_BLOQUEO_ERRORES = 0.02;
/** Una exclusión informativa que pesa más de esto en venta o stock se resalta (no bloquea). */
export const UMBRAL_EXCLUSION_RESALTADA = 0.02;
/** Un aviso o nota que pesa más de esto en venta o stock se muestra abierto. */
export const UMBRAL_AVISO_ABIERTO = 0.01;
/** Primer mes del histórico (`aaaa-mm`). */
export const INICIO_HISTORICO = "2023-01";
/** Tope del `reporte` serializado que acompaña a una carga. */
export const MAX_REPORTE_BYTES = 200 * 1024;
/** Entradas por motivo que el cliente conserva en el `reporte` guardado. */
export const MAX_ENTRADAS_REPORTE = 500;
/** Tope de cada diccionario de una tanda. */
export const MAX_DICCIONARIO_TANDA = 10_000;
/** Un Excel de más filas que esto se rechaza ("usa CSV"). */
export const FILAS_EXCEL_MAX = 150_000;
/** Un `.xls` con exactamente esta cantidad de filas está posiblemente truncado. */
export const FILAS_XLS_TRUNCADO = 65_536;
/** Diferencia relativa por debajo de la cual soles coinciden con QlikView (0,1 %). */
export const TOLERANCIA_CONCILIACION = 0.001;
/** Cambio relativo contra el mes anterior que dispara `comparacion_mes_anterior` (25 %). */
export const UMBRAL_COMPARACION_MES = 0.25;
/** Cuántas marcas nuevas con una o dos filas se tratan como posible error de tipeo. */
export const FILAS_POSIBLE_TIPEO = 2;

/** Límites de la petición de `previsualizar` (y de los diccionarios del acumulador). */
export const LIMITES_PREVISUALIZAR = {
  tiendas: 500,
  combinaciones: 20_000,
  marcas: 5_000,
  periodos: 120,
} as const;

// ─── Marcas especiales ───

export const MARCA_SIN_MARCA = "SIN MARCA";
export const COMODINES_MARCA: readonly string[] = ["VARIOS", "OTROS", MARCA_SIN_MARCA];
export const AGRUPACION_COMODINES = "MID VALUE";

// ─── Campos del archivo ───

export const CAMPOS_VENTA = [
  "anio",
  "mes",
  "tienda",
  "genero",
  "mundo",
  "linea",
  "equivalencia",
  "marca",
  "talla",
  "unidades",
  "venta_soles",
  "costo_vendido",
  "stock_unidades",
  "stock_valorizado",
] as const;
export type CampoVenta = (typeof CAMPOS_VENTA)[number];

/** Fila del archivo ya proyectada a los campos (un campo sin columna viaja como `""`). */
export type FilaCruda = Record<CampoVenta, string>;

export const MEDIDAS_VENTA = ["unidades", "venta_soles", "costo_vendido", "stock_unidades", "stock_valorizado"] as const;
export type MedidaVenta = (typeof MEDIDAS_VENTA)[number];
export const MEDIDAS_DINERO: readonly MedidaVenta[] = ["venta_soles", "costo_vendido", "stock_valorizado"];

export const ETIQUETAS_MEDIDA: Record<MedidaVenta, string> = {
  unidades: "Unidades vendidas",
  venta_soles: "Venta (S/)",
  costo_vendido: "Costo vendido (S/)",
  stock_unidades: "Stock (unidades)",
  stock_valorizado: "Stock valorizado (S/)",
};

/**
 * Medidas internas de una fila o de un grupo de filas: las cantidades como
 * enteros y el dinero en CÉNTIMOS enteros, para que las sumas sean exactas y
 * no dependan del orden (regla 18).
 */
export type MedidasC = {
  unidades: number;
  venta: number;
  costo: number;
  stock_unidades: number;
  stock_valorizado: number;
};

export const MEDIDAS_C_CERO: Readonly<MedidasC> = Object.freeze({
  unidades: 0,
  venta: 0,
  costo: 0,
  stock_unidades: 0,
  stock_valorizado: 0,
});

// ─── Motivos de exclusión ───

/** Hay algo que corregir: la fila no se carga y pesa para el bloqueo del mes. */
export const MOTIVOS_ERROR = [
  "mes_invalido",
  "numero_invalido",
  "clasificacion_incompleta",
  "tienda_vacia",
  "tienda_desconocida",
  "talla_desconocida",
  "genero_desconocido",
  "mundo_desconocido",
  "linea_desconocida",
  "nodo_inexistente",
  "equivalencia_inexistente",
  /** Más valores distintos de los que admite la previsualización (no ocurre con datos reales). */
  "demasiados_valores",
] as const;

/** Decisión ya tomada en el maestro o en la regla: informativa, sin acción. */
export const MOTIVOS_DECISION = [
  "sin_clasificar",
  "tienda_inactiva",
  "tienda_excluida",
  "marca_inactiva",
  "genero_inactivo",
  "mundo_inactivo",
  "linea_inactiva",
  "nodo_inactivo",
  "equivalencia_inactiva",
  "fila_total",
  "fila_en_cero",
] as const;

export type MotivoError = (typeof MOTIVOS_ERROR)[number];
export type MotivoDecision = (typeof MOTIVOS_DECISION)[number];
export type MotivoExclusion = MotivoError | MotivoDecision;

export function esMotivoError(motivo: MotivoExclusion): motivo is MotivoError {
  return (MOTIVOS_ERROR as readonly string[]).includes(motivo);
}

export const ETIQUETAS_MOTIVO: Record<MotivoExclusion, string> = {
  mes_invalido: "Mes o año no reconocido",
  numero_invalido: "Número inválido",
  clasificacion_incompleta: "Género, mundo o línea incompletos",
  tienda_vacia: "Tienda en blanco",
  tienda_desconocida: "Tienda que no existe en el sistema",
  talla_desconocida: "Talla no reconocida",
  genero_desconocido: "Género que no existe",
  mundo_desconocido: "Mundo que no existe",
  linea_desconocida: "Línea que no existe",
  nodo_inexistente: "Combinación género-mundo-línea que no existe en el árbol",
  equivalencia_inexistente: "Equivalencia que no existe en esa línea",
  demasiados_valores: "Demasiados valores distintos en el archivo",
  sin_clasificar: "Sin género, mundo ni línea",
  tienda_inactiva: "Tienda desactivada",
  tienda_excluida: "Tienda que no debe cargarse",
  marca_inactiva: "Marca desactivada",
  genero_inactivo: "Género desactivado",
  mundo_inactivo: "Mundo desactivado",
  linea_inactiva: "Línea desactivada",
  nodo_inactivo: "Combinación del árbol desactivada",
  equivalencia_inactiva: "Equivalencia desactivada",
  fila_total: "Fila de totales",
  fila_en_cero: "Fila con todas las cifras en cero",
};

// ─── Avisos y notas ───

export const AVISOS_CODIGOS = [
  "stock_negativo",
  "claves_repetidas_se_suman",
  "talla_revisar_a_centrales",
  "marcas_nuevas",
  "venta_en_cd",
  "fuera_de_vigencia",
  "unidades_con_decimales",
  "mes_abierto",
  "comparacion_mes_anterior",
  "archivo_posiblemente_truncado",
  "stock_en_cero",
  "stock_identico_a_otro_mes",
] as const;

export const NOTAS_CODIGOS = [
  "unidades_negativas",
  "unidades_sin_venta",
  "venta_sin_unidades",
  "costo_mayor_que_venta",
  "costo_sin_venta",
  "cifras_enteras",
  /** Fechas con día distinto de 1 en el archivo: el día se ignora. */
  "fechas_con_dia",
] as const;

export type CodigoAviso = (typeof AVISOS_CODIGOS)[number];
export type CodigoNota = (typeof NOTAS_CODIGOS)[number];
export type CodigoAvisoONota = CodigoAviso | CodigoNota;
export type SeveridadAviso = "aviso" | "nota";

export function severidadDe(codigo: CodigoAvisoONota): SeveridadAviso {
  return (NOTAS_CODIGOS as readonly string[]).includes(codigo) ? "nota" : "aviso";
}

export const ETIQUETAS_AVISO: Record<CodigoAvisoONota, string> = {
  stock_negativo: "Stock negativo",
  claves_repetidas_se_suman: "Claves repetidas tras normalizar: se suman",
  talla_revisar_a_centrales: "Talla «Revisar» cargada como CENTRALES",
  marcas_nuevas: "Marcas nuevas",
  venta_en_cd: "Venta o costo en el centro de distribución",
  fuera_de_vigencia: "Venta fuera de la vigencia de la tienda",
  unidades_con_decimales: "Unidades con decimales (se redondean)",
  mes_abierto: "Mes que todavía no cerró",
  comparacion_mes_anterior: "Cambio de más del 25 % frente al mes anterior",
  archivo_posiblemente_truncado: "Archivo posiblemente truncado",
  stock_en_cero: "Stock en cero en todas las filas de un mes pasado",
  stock_identico_a_otro_mes: "Stock idéntico al de otro mes",
  unidades_negativas: "Unidades negativas (devoluciones)",
  unidades_sin_venta: "Unidades sin venta",
  venta_sin_unidades: "Venta sin unidades",
  costo_mayor_que_venta: "Costo mayor que la venta",
  costo_sin_venta: "Costo sin venta",
  cifras_enteras: "Cifras monetarias en soles enteros",
  fechas_con_dia: "Fechas con día distinto de 1 (se ignora el día)",
};

// ─── Conteo de lectura y filas interpretadas ───

/** Qué se ve de cada fila al leerla: contadores para los diagnósticos globales. */
export type LecturaFila = {
  /** Celdas de las cinco medidas que tienen forma numérica (válida o coma decimal). */
  celdas_numericas: number;
  /** Celdas con forma de coma decimal (`12,5`, `1.234,56`). */
  celdas_coma: number;
  /** Máscara de bits (índice en `CAMPOS_VENTA`) de los campos obligatorios en blanco. */
  vacios: number;
};

export type Combinacion = {
  genero: string;
  mundo: string;
  linea: string;
  /** Normalizada: vacío → `SIN EQUIVALENCIA`, `-` → nombre de la línea. */
  equivalencia: string;
  /** Como vino (normalizada, sin sustituir): `""`, `"-"` o el nombre. Para el CSV en formato árbol. */
  equivalencia_original: string;
};

/** Categoría de talla en el acumulador (antes de fusionar): 0 CENTRALES, 1 EXTREMAS, 2 `Revisar`, 3 `-`, 4 vacío. */
export type CategoriaTalla = 0 | 1 | 2 | 3 | 4;

export type ExtrasFila = {
  decimales_unidades: boolean;
  centavos: boolean;
  dia_distinto_de_1: boolean;
};

/** Motivos que se deciden mirando solo la fila (sin el estado de la base). */
export type MotivoLocal =
  | "fila_total"
  | "mes_invalido"
  | "numero_invalido"
  | "fila_en_cero"
  | "sin_clasificar"
  | "clasificacion_incompleta"
  | "tienda_vacia";

export type FilaInterpretada = LecturaFila &
  (
    | { tipo: "excluida"; motivo: MotivoLocal; periodo: string | null; valor: string; medidas: MedidasC }
    | {
        tipo: "talla_desconocida";
        periodo: string;
        tienda: string;
        talla: string;
        medidas: MedidasC;
        extras: ExtrasFila;
      }
    | {
        tipo: "cargable";
        periodo: string;
        tienda: string;
        combinacion: Combinacion;
        marca: string;
        talla: CategoriaTalla;
        medidas: MedidasC;
        extras: ExtrasFila;
      }
  );

// ─── Informe del reporte previo ───

export type Diagnostico = {
  codigo:
    | "coma_decimal"
    | "columna_vacia"
    | "archivo_posiblemente_truncado"
    | "filas_sin_mes"
    | "demasiados_valores"
    | "sin_filas";
  mensaje: string;
  /** Un diagnóstico bloqueante impide cargar el archivo entero. */
  bloqueante: boolean;
};

/** Medidas en soles (dinero con 2 decimales) más filas. */
export type MedidasInforme = MedidasCarga;

/** Una exclusión agrupada por valor (o combinación): lo que el usuario debe mirar para corregir. */
export type Exclusion = MedidasInforme & {
  motivo: MotivoExclusion;
  tipo: "error" | "decision";
  /** Valor (tienda, marca, combinación, talla…) o descripción; `""` si el motivo no tiene valor. */
  valor: string;
  /** Solo en motivos de combinación: las piezas tal como vinieron (equivalencia sin sustituir). */
  combinacion?: { genero: string; mundo: string; linea: string; equivalencia: string };
  /** Primera fila del archivo (1 = primera fila de datos) donde aparece. */
  primera_fila: number;
};

export type ResumenExclusion = MedidasInforme & {
  motivo: MotivoExclusion;
  tipo: "error" | "decision";
  /** Cuántos valores distintos. */
  grupos: number;
  pct_filas: number;
  pct_venta: number;
  pct_stock: number;
  /** Informativa que pesa más del 2 % de la venta o del stock. */
  resaltada: boolean;
};

export type DetalleAviso = {
  valor: string;
  filas: number;
  venta_soles: number;
  costo_vendido: number;
  stock_unidades: number;
  stock_valorizado: number;
};

export type Aviso = {
  codigo: CodigoAvisoONota;
  severidad: SeveridadAviso;
  mensaje: string;
  filas: number;
  pct_filas: number;
  venta_soles: number;
  costo_vendido: number;
  stock_unidades: number;
  stock_valorizado: number;
  pct_venta: number;
  pct_stock: number;
  /** Se muestra plegado salvo que pese más del 1 % de la venta o del stock (o sea de alerta). */
  plegado: boolean;
  /** Se muestra en rojo (red de seguridad del stock, archivo truncado). */
  rojo: boolean;
  detalle: DetalleAviso[];
};

export type EstadoConciliacionQlik = "coincide" | "difiere" | "sin_qlik";

export type FilaConciliacion = {
  medida: MedidaVenta;
  /** Total que escribió el usuario (opcional). */
  qlik: number | null;
  archivo: number;
  excluido: number;
  cargado: number;
  /** `archivo - excluido - cargado`: debe ser 0 (identidad exacta, en céntimos). */
  descuadre: number;
  /** `archivo - qlik`, o `null` sin total de QlikView. */
  diferencia_qlik: number | null;
  /** `|archivo - qlik| / |qlik|`, o `null`. */
  diferencia_relativa: number | null;
  estado_qlik: EstadoConciliacionQlik;
};

export type EstadoMesInforme = "nuevo" | "reemplaza" | "identico";

export type HuellaMes = { filas_con_stock: number; stock_unidades: number; stock_valorizado: number };

export type TotalesQlik = Partial<Record<MedidaVenta, number>>;

export type InformeMes = {
  periodo: string;
  estado: EstadoMesInforme;
  /** `true` si el mes todavía no cerró. */
  abierto: boolean;
  publicada: { id: string; publicada_at: string | null; filas: number } | null;
  en_curso: { id: string; usuario_nombre: string | null; updated_at: string; caducada: boolean } | null;
  /** Todo lo que trae el archivo para el mes. */
  archivo: MedidasInforme;
  /** Lo que se excluye (suma de todas las exclusiones). */
  excluido: MedidasInforme;
  /** Lo que se cargará (claves únicas tras fusionar). */
  cargado: MedidasInforme;
  /** Filas que se sumaron a otra de la misma clave. */
  fusionadas: number;
  /** `archivo = cargado + excluido` en las cinco medidas y `archivo.filas = cargadas + fusionadas + excluidas`. */
  identidad_ok: boolean;
  conciliacion: FilaConciliacion[];
  resumen_exclusiones: ResumenExclusion[];
  /** Agrupadas por valor, de la que más pesa a la que menos (completas; se recortan al guardar el reporte). */
  exclusiones: Exclusion[];
  avisos: Aviso[];
  /** Peso de los errores en filas, venta y stock valorizado, en %. */
  errores: { pct_filas: number; pct_venta: number; pct_stock: number; maximo: number };
  /** Errores >= 2 % en filas, venta o stock valorizado. */
  bloqueado: boolean;
  huella_stock: HuellaMes;
};

export type MarcaNuevaInforme = {
  nombre: string;
  comodin: boolean;
  filas: number;
  venta_soles: number;
  stock_unidades: number;
  stock_valorizado: number;
  /** Una o dos filas en todo el archivo (no comodín): posible error de tipeo. */
  posible_tipeo: boolean;
  /** Marca existente más parecida, si hay. */
  parecida: string | null;
};

export type InformeCarga = {
  hoy: string;
  /** Filas de datos del archivo (todas, también las sin mes). */
  filas_archivo: number;
  diagnosticos: Diagnostico[];
  /** `true` si algún diagnóstico bloquea el archivo entero. */
  bloqueado_global: boolean;
  meses: InformeMes[];
  /** Filas cuyo mes no se pudo leer: no pertenecen a ningún mes. */
  sin_mes: { filas: number; exclusiones: Exclusion[] };
  marcas_nuevas: MarcaNuevaInforme[];
};

// ─── Lo que se cargará (resultado de `construirInforme`) ───

/** Filas de un mes ya fusionadas por clave real, en arreglos tipados (sin un objeto por fila). */
export type MesConsolidado = {
  periodo: string;
  filas: number;
  /** Índice en `Consolidado.tiendas`. */
  tienda: Uint16Array;
  /** Índice en `Consolidado.equivalencias`. */
  equivalencia: Uint16Array;
  /** Índice en `Consolidado.marcas`. */
  marca: Uint16Array;
  /** 0 CENTRALES, 1 EXTREMAS. */
  talla: Uint8Array;
  unidades: Float64Array;
  /** Céntimos. */
  venta: Float64Array;
  /** Céntimos. */
  costo: Float64Array;
  stock_unidades: Float64Array;
  /** Céntimos. */
  stock_valorizado: Float64Array;
};

export type Consolidado = {
  /** Ids de tienda. */
  tiendas: string[];
  /** Ids de equivalencia. */
  equivalencias: string[];
  /** Id de la marca existente, o `nueva:NOMBRE` si todavía hay que crearla. */
  marcas: string[];
  meses: Map<string, MesConsolidado>;
};

/** Una fila lista para enviar (ids ya resueltos, dinero en soles). */
export type FilaCargable = {
  tienda_id: string;
  equivalencia_id: string;
  marca_id: string;
  /** 0 CENTRALES, 1 EXTREMAS. */
  talla: 0 | 1;
  unidades: number;
  venta_soles: number;
  costo_vendido: number;
  stock_unidades: number;
  stock_valorizado: number;
};
