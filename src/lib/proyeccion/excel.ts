import type { BloquesApi, FilaMensualApi, FiltroMatrizApi, NodoMatrizApi, RespuestaMensualApi } from "./tipos-api";

/**
 * Hojas de la exportación a Excel (ficha 07, regla 32). Puro: solo arma filas y cabeceras; SheetJS se carga bajo demanda
 * en el navegador (como en M11) y convierte con `XLSX.utils.aoa_to_sheet`. Nunca llama a una ruta nueva: parte de los
 * datos ya cargados por las rutas `requirePlanner`.
 */

export type Celda = string | number | null;
export type Hoja = Celda[][];

const dos = (n: number) => String(n).padStart(2, "0");

/** `aaaa-mm` de cada mes del año. */
export const cabecerasMeses = (anio: number): string[] => Array.from({ length: 12 }, (_, i) => `${anio}-${dos(i + 1)}`);

const NIVEL_TEXTO: Record<NodoMatrizApi["nivel"], string> = {
  compania: "COMPAÑÍA",
  genero: "GÉNERO",
  mundo: "MUNDO",
  linea: "LÍNEA",
  agrupacion_marca: "AGRUPACIÓN DE MARCA",
};

/** Hoja `BLOQUES`: las tiendas de cada bloque por año, con subbloque y motivo. */
export function hojaBloques(bloques: BloquesApi): Hoja {
  const filas: Hoja = [["AÑO", "BLOQUE", "SUBBLOQUE", "CÓDIGO", "TIENDA", "APERTURA", "CIERRE", "MOTIVO"]];
  for (const anio of Object.keys(bloques).map(Number).sort((a, b) => a - b)) {
    const b = bloques[anio];
    for (const bloque of ["mismas", "nuevas", "cierres", "fuera"] as const) {
      for (const t of b[bloque]) filas.push([anio, bloque, t.subbloque ?? null, t.codigo, t.nombre, t.fecha_apertura, t.fecha_cierre, t.motivo]);
    }
  }
  return filas;
}

const redondear1 = (x: number | null | undefined): number | null => (x === null || x === undefined ? null : Math.round(x * 10) / 10);

const textoFiltro = (v: string | null): Celda => (v === null || v === "" ? "—" : v);

/** Hoja `FILTROS`: los filtros activos y la fecha de datos. */
export function hojaFiltros(filtro: Partial<FiltroMatrizApi> & { bloque?: string; por_agrupacion?: boolean }, datosHasta: string, extra: Record<string, string | null> = {}): Hoja {
  const filas: Hoja = [["FILTRO", "VALOR"]];
  const campos: [string, string | null | undefined][] = [
    ["genero", filtro.genero_id],
    ["mundo", filtro.mundo_id],
    ["linea", filtro.linea_id],
    ["temporada", filtro.temporada],
    ["agrupacion_estacionalidad", filtro.agrupacion_estacionalidad_id],
    ["agrupacion_marca", filtro.agrupacion_marca_id],
    ["solo", filtro.solo],
    ["bloque", filtro.bloque],
  ];
  for (const [k, v] of campos) if (v !== undefined) filas.push([k, textoFiltro(v ?? null)]);
  for (const [k, v] of Object.entries(extra)) filas.push([k, textoFiltro(v)]);
  filas.push(["datos_hasta", datosHasta]);
  return filas;
}

/**
 * Hojas `MATRIZ`, `BLOQUES` y `FILTROS`. `MATRIZ` lleva exactamente los nodos visibles (compañía, géneros, mundos y
 * líneas del filtro) con las columnas de la ficha; las columnas de cierres van siempre (la pantalla las oculta si todo
 * es 0).
 */
export function hojasMatriz(args: {
  nodos: readonly NodoMatrizApi[];
  bloques: BloquesApi;
  anio: number;
  filtro: Partial<FiltroMatrizApi>;
  datosHasta: string;
  /** `ids → nombre` de los filtros (para que `FILTROS` diga "HOMBRE" y no un id). */
  nombresFiltro?: Record<string, string | null>;
}): { MATRIZ: Hoja; BLOQUES: Hoja; FILTROS: Hoja } {
  const y = args.anio;
  const cabecera: Celda[] = [
    "NIVEL",
    "NOMBRE",
    `VENTA A LA FECHA ${y}`,
    `MISMAS TIENDAS ${y}`,
    `NUEVAS AÑO ANTERIOR ${y}`,
    `APERTURAS ${y}`,
    `CIERRES ${y}`,
    `TOTAL ${y}`,
    `MISMAS TIENDAS ${y + 1}`,
    `NUEVAS AÑO ANTERIOR ${y + 1}`,
    `APERTURAS ${y + 1}`,
    `CIERRES ${y + 1}`,
    `TOTAL ${y + 1}`,
    "VARIACIÓN %",
    // 0.14.0 (06e): el % que se aprueba se aplica sobre `Y` corregido del Niño (`Σ vigente ÷ Σ B' − 1`); «real» compara con lo vendido (`Σ vigente ÷ Σ B − 1`).
    // La variación (arriba) incluye además tiendas nuevas, aperturas y cierres.
    `CREC. SOBRE ${y} CORREGIDO %`,
    `CREC. SOBRE ${y} REAL %`,
    "ESTADO",
  ];
  const filas: Hoja = [cabecera];
  for (const n of args.nodos) {
    filas.push([
      NIVEL_TEXTO[n.nivel],
      n.nombre,
      n.en_curso.venta_a_la_fecha,
      n.en_curso.mismas,
      n.en_curso.nuevas_anterior,
      n.en_curso.aperturas,
      n.en_curso.cierres,
      n.en_curso.total,
      n.siguiente.mismas,
      n.siguiente.nuevas_anterior,
      n.siguiente.aperturas,
      n.siguiente.cierres,
      n.siguiente.total,
      n.variacion_pct === null ? null : Math.round(n.variacion_pct * 10) / 10,
      redondear1(n.siguiente.crec_corregida_pct),
      redondear1(n.siguiente.crec_mismas_pct),
      n.estado,
    ]);
  }
  const nombres = args.nombresFiltro ?? {};
  const f = args.filtro;
  const filtro = {
    ...f,
    genero_id: f.genero_id ? (nombres[f.genero_id] ?? f.genero_id) : f.genero_id,
    mundo_id: f.mundo_id ? (nombres[f.mundo_id] ?? f.mundo_id) : f.mundo_id,
    linea_id: f.linea_id ? (nombres[f.linea_id] ?? f.linea_id) : f.linea_id,
    agrupacion_marca_id: f.agrupacion_marca_id ? (nombres[f.agrupacion_marca_id] ?? f.agrupacion_marca_id) : f.agrupacion_marca_id,
  };
  return { MATRIZ: filas, BLOQUES: hojaBloques(args.bloques), FILTROS: hojaFiltros(filtro, args.datosHasta) };
}

/**
 * Hojas `MENSUAL`, `BLOQUES` y `FILTROS`: una fila por género · mundo · línea · agrupación de marca · bloque, con
 * `aaaa-mm` de los dos años, `TOTAL_aaaa`, `ORIGEN_aaaa` (`real:9/proy:3`) del año en curso y `AVISOS`. Una celda sin
 * curva va vacía (`null`), no 0, y deja `sin_curva` en `AVISOS`.
 */
export function hojasMensual(args: {
  filas: readonly FilaMensualApi[];
  bloques: BloquesApi;
  anio: number;
  filtro: RespuestaMensualApi["filtro"];
  datosHasta: string;
  nombresFiltro?: Record<string, string | null>;
}): { MENSUAL: Hoja; BLOQUES: Hoja; FILTROS: Hoja } {
  const y = args.anio;
  const cabecera: Celda[] = [
    "GÉNERO",
    "MUNDO",
    "LÍNEA",
    "AGRUPACIÓN DE MARCA",
    "BLOQUE",
    ...cabecerasMeses(y),
    ...cabecerasMeses(y + 1),
    `TOTAL_${y}`,
    `TOTAL_${y + 1}`,
    `ORIGEN_${y}`,
    "AVISOS",
  ];
  const filas: Hoja = [cabecera];
  for (const f of args.filas) {
    const a1 = f.anios.find((a) => a.anio === y);
    const a2 = f.anios.find((a) => a.anio === y + 1);
    const reales = a1 ? a1.origen_meses.filter((o) => o === "real").length : 0;
    const avisos: string[] = [];
    if ((a1?.sin_curva ?? 0) > 0 || (a2?.sin_curva ?? 0) > 0) avisos.push("sin_curva");
    filas.push([
      f.genero,
      f.mundo,
      f.linea,
      f.agrupacion_marca,
      f.bloque,
      ...(a1 ? a1.meses : Array<Celda>(12).fill(null)),
      ...(a2 ? a2.meses : Array<Celda>(12).fill(null)),
      a1 ? a1.total : null,
      a2 ? a2.total : null,
      a1 && a1.meses.some((m) => m !== null) ? `real:${reales}/proy:${12 - reales}` : null,
      avisos.join(", "),
    ]);
  }
  const nombres = args.nombresFiltro ?? {};
  const f = args.filtro;
  const filtro = {
    ...f,
    genero_id: f.genero_id ? (nombres[f.genero_id] ?? f.genero_id) : f.genero_id,
    mundo_id: f.mundo_id ? (nombres[f.mundo_id] ?? f.mundo_id) : f.mundo_id,
    linea_id: f.linea_id ? (nombres[f.linea_id] ?? f.linea_id) : f.linea_id,
    agrupacion_marca_id: f.agrupacion_marca_id ? (nombres[f.agrupacion_marca_id] ?? f.agrupacion_marca_id) : f.agrupacion_marca_id,
  };
  return { MENSUAL: filas, BLOQUES: hojaBloques(args.bloques), FILTROS: hojaFiltros(filtro, args.datosHasta, { por_agrupacion: f.por_agrupacion ? "sí" : "no" }) };
}
