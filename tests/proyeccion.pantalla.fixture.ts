import type {
  AnioFilaApi,
  BloquesApi,
  FilaApi,
  FilaDetalleApi,
  FilaMensualApi,
  FilaTiendaLineaApi,
  IndiceLineaApi,
  MarcasDeFilaApi,
  TiendaLineaApi,
  NodoMatrizApi,
  ProyeccionApi,
  RespuestaLineasApi,
  RespuestaMatrizApi,
  RespuestaMensualApi,
  RespuestaProyeccionApi,
  TiendaBloqueApi,
  TiendaProyeccionApi,
  FactorApi,
  ColaLargaApi,
} from "../src/lib/proyeccion/tipos-api";

/**
 * Datos sintéticos de la pantalla de M7 (docs/modulos/07-proyeccion-anual.md, sección 4: las cifras de la maqueta de
 * DENIM, que cuadran entre sí). Tiendas T01…T12, «Tienda nueva A» (T10) y «Tienda nueva B» (T12). Nada real de Lukers.
 */

export const Y = 2026;
export const K = 9;

const t = (n: number) => `T${String(n).padStart(2, "0")}`;

export function tienda(n: number, extra: Partial<TiendaBloqueApi> = {}): TiendaBloqueApi {
  return {
    tienda_id: `tienda-${n}`,
    codigo: t(n),
    nombre: n === 10 ? "Tienda nueva A" : n === 12 ? "Tienda nueva B" : `Tienda ${n}`,
    fecha_apertura: n === 10 ? "2025-11-20" : n === 12 ? "2027-03-15" : "2020-01-10",
    fecha_cierre: null,
    motivo: "estuvo abierta todo el año anterior",
    clave: "11111",
    ...extra,
  };
}

export function bloques(): BloquesApi {
  const mismas26 = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => tienda(n));
  const mismas27 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => tienda(n));
  return {
    2026: {
      mismas: mismas26,
      nuevas: [tienda(10, { subbloque: "nuevas_anterior", motivo: "abrió en 2025 después del 1 de enero", clave: "00001" })],
      cierres: [],
      fuera: [tienda(11, { motivo: "cerrada antes de 2026", fecha_cierre: "2025-12-31" })],
    },
    2027: {
      mismas: mismas27,
      nuevas: [tienda(12, { subbloque: "aperturas", motivo: "abre en 2027", clave: "00000" })],
      cierres: [],
      fuera: [],
    },
  };
}

export function proyeccion(extra: Partial<ProyeccionApi> = {}): ProyeccionApi {
  return {
    id: "proy-1",
    anio_en_curso: Y,
    anio_siguiente: Y + 1,
    nombre: "Proyección 2026–2027",
    estado: "en_trabajo",
    hasta_periodo: "2026-09-01",
    parametros: {
      crecimiento_pct_defecto: 0,
      umbral_avance: 0.3,
      umbral_cobertura: 0.25,
      umbral_cola_larga: 100,
      umbral_disponibilidad: 0.75,
      rampa_maduracion: [1, 1, 1],
      factores_usados: [],
      bloques: bloques(),
    },
    resumen: {
      filas: 1689,
      filas_por_anio: { 2026: 1689, 2027: 1689 },
      decididas: { 2026: 418, 2027: 402 },
      totales: {
        2026: { mismas: 97561, nuevas_anterior: 8940, aperturas: 0, cierres: 0, total: 106501 },
        2027: { mismas: 110759, nuevas_anterior: 0, aperturas: 914, cierres: 0, total: 111673 },
      },
      avisos: { cola_larga: 509, curva_cambio: 1 },
      huella_cargas: "h",
      curvas_usadas: [],
      desvio_prueba_anterior_pct: -1.9,
      perfiles_apertura: [{ tienda: "T05", ratios: [2.9, 1.8, 1.2, 1, 1, 1] }],
      filas_para_revision: 12,
      fuera_bloque: 0,
      version_metodo: 2,
      duracion_ms: 18000,
    },
    calculando: false,
    calculando_desde: null,
    calculado_at: "2026-10-15T15:00:00Z",
    cerrada_at: null,
    cerrada_por_nombre: null,
    nota: null,
    usuario_nombre: "Planner",
    created_at: "2026-10-15T14:00:00Z",
    updated_at: "2026-10-15T15:00:00Z",
    desactualizada: [],
    bloques: bloques(),
    ...extra,
  };
}

export function respuestaProyeccion(extra: Partial<RespuestaProyeccionApi> = {}): RespuestaProyeccionApi {
  return {
    datos: {
      desde: "2023-01-01",
      hasta: "2026-09-01",
      meses_publicados: ["2026-08", "2026-09"],
      meses_faltantes: [],
      ultimo_mes_cerrado: "2026-09-01",
      curvas_vigentes: 15,
      agrupaciones_sin_curva: [],
      curvas_obsoletas: 0,
      tendencia_ultimo_anio_pct: null,
    },
    prerrequisitos: { bloquea: [], avisa: [{ codigo: "tienda_sin_referente", mensaje: "T12 no tiene tienda de referencia: se usará la composición promedio de las mismas tiendas." }] },
    bloques_hoy: bloques(),
    proyecciones: [proyeccion()],
    factores: [],
    ...extra,
  };
}

export function registro(anio: number, extra: Partial<AnioFilaApi> = {}): AnioFilaApi {
  return {
    anio,
    bloque: "mismas",
    subbloque: null,
    vendido: anio === Y ? 12480 : 0,
    propuesto: 17504,
    metodo: anio === Y ? "avance" : "crecimiento",
    referencia_alternativa: null,
    referencia_tres_meses: null,
    explicacion: anio === Y ? "Vendido ene–set 12,480 (9 tiendas) ÷ avance 71.3 % (DENIM HO v2) = 17,503.5 → 17,504; resto oct–dic 5,024." : "Base 19,424 × 1.05 = 20,395.2 → 20,395.",
    crecimiento_pct: null,
    decidido: null,
    origen: null,
    propuesta_al_decidir: null,
    vigente: 17504,
    nota: null,
    decidido_por_nombre: null,
    decidido_at: null,
    meses: anio === Y ? [1190, 1110, 1250, 1350, 1450, 1540, 1600, 1580, 1410, 1540, 1610, 1874] : [1388, 1300, 1450, 1500, 1650, 1700, 1800, 1750, 1650, 1700, 1800, 2007],
    meses_propuestos: null,
    origen_meses: anio === Y ? [...Array<"real">(9).fill("real"), ...Array<"proyectado">(3).fill("proyectado")] : Array<"proyectado">(12).fill("proyectado"),
    avance: anio === Y ? 0.713 : null,
    avisos: [],
    id: `reg-${anio}`,
    ...extra,
  };
}

type Cifras = { nombre: string; id: string; hist: [number, number, number]; vendido: number; p26: number; d26?: number; p27: number; d27?: number; g?: number; avisos26?: AnioFilaApi["avisos"] };

export function fila(c: Cifras, extra: Partial<FilaApi> = {}): FilaApi {
  return {
    id: c.id,
    tienda_id: null,
    gml_id: "gml-denim",
    equivalencia_id: null,
    agrupacion_marca_id: `am-${c.nombre}`,
    nivel: "GML",
    genero: "HOMBRE",
    mundo: "URBANO",
    linea: "DENIM",
    equivalencia: null,
    agrupacion_marca: c.nombre,
    agrupacion_estacionalidad: { id: "ag-denim", nombre: "DENIM HO", temporada: "todo_el_ano" },
    historico_anual: [
      { anio: 2023, unidades: c.hist[0], clase: "atipico", completo: true, tiendas: 8 },
      { anio: 2024, unidades: c.hist[1], clase: "normal", completo: true, tiendas: 8 },
      { anio: 2025, unidades: c.hist[2], clase: "normal", completo: true, tiendas: 9 },
      { anio: 2026, unidades: c.vendido, clase: "en_curso", completo: false, tiendas: 9 },
    ],
    anios: [
      registro(Y, {
        id: `${c.id}-26`,
        vendido: c.vendido,
        propuesto: c.p26,
        decidido: c.d26 ?? null,
        origen: c.d26 === undefined ? null : c.d26 === c.p26 ? "propuesta" : "manual",
        propuesta_al_decidir: c.d26 === undefined ? null : c.p26,
        vigente: c.d26 ?? c.p26,
        avisos: c.avisos26 ?? [],
      }),
      registro(Y + 1, {
        id: `${c.id}-27`,
        vendido: 0,
        propuesto: c.p27,
        decidido: c.d27 ?? null,
        origen: c.d27 === undefined ? null : "propuesta",
        propuesta_al_decidir: c.d27 === undefined ? null : c.p27,
        vigente: c.d27 ?? c.p27,
        crecimiento_pct: c.g ?? null,
      }),
    ],
    avisos: [],
    activo: true,
    ...extra,
  };
}

/** Las cinco filas de DENIM de la maqueta (la línea suma 44,854 propuesto y 45,204 vigente en 2026; 52,724 en 2027). */
export function filasDenim(): FilaApi[] {
  return [
    fila({ nombre: "RECONOCIDO", id: "f1", hist: [14500, 15310, 16480], vendido: 12480, p26: 17504, d26: 17504, p27: 20395, g: 5 }),
    fila({ nombre: "MID VALUE", id: "f2", hist: [9800, 11200, 12100], vendido: 9040, p26: 12679, p27: 14762, g: 5 }),
    fila({ nombre: "VALOR", id: "f3", hist: [6400, 7900, 8600], vendido: 6310, p26: 8850, d26: 9200, p27: 10973, g: 8 }),
    fila({ nombre: "PREMIUM", id: "f4", hist: [2900, 3600, 4200], vendido: 3100, p26: 4348, p27: 4964, g: 5 }),
    fila({ nombre: "ULTRA LOW", id: "f5", hist: [500, 890, 920], vendido: 1050, p26: 1473, p27: 1630, g: 0 }),
  ];
}

export const INDICE: IndiceLineaApi[] = [
  { genero_id: "g-h", mundo_id: "m-u", linea_id: "l-denim", genero: "HOMBRE", mundo: "URBANO", linea: "DENIM", estado: "parcial" },
  { genero_id: "g-h", mundo_id: "m-u", linea_id: "l-polo", genero: "HOMBRE", mundo: "URBANO", linea: "POLO", estado: "curva_cambio" },
  { genero_id: "g-h", mundo_id: "m-u", linea_id: "l-casaca", genero: "HOMBRE", mundo: "URBANO", linea: "CASACA", estado: "sin_proyectar" },
  { genero_id: "g-h", mundo_id: "m-f", linea_id: "l-camisa", genero: "HOMBRE", mundo: "FORMAL", linea: "CAMISA", estado: "proyectada" },
  { genero_id: "g-m", mundo_id: "m-u", linea_id: "l-denim", genero: "MUJER", mundo: "URBANO", linea: "DENIM", estado: "sin_proyectar" },
];

/** Lo común de una entrada de `tiendas_linea` (07b): id de tienda, fecha, composición y total de la tienda. */
export function tiendaLinea(n: number): Pick<TiendaLineaApi, "tienda_id" | "fecha_apertura" | "origen_composicion" | "referente" | "total_tienda"> {
  return { tienda_id: `tienda-${n}`, fecha_apertura: null, origen_composicion: "red", referente: null, total_tienda: { propuesto: null, decidido: null } };
}

type CifraApertura ={ anio: number; propuesto: number | null; vigente: number; decidido?: number; origen?: "manual" | "escalada" | "propuesta"; vendido?: number };

/** Una fila de apertura (07b): misma gml / equivalencia / agrupación de marca que la base `nombre`, con un registro `nuevas` por año. */
export function filaApertura(nombre: string, tiendaId: string, codigo: string, cifras: CifraApertura[], extra: Partial<FilaTiendaLineaApi> = {}): FilaTiendaLineaApi {
  const base = fila({ nombre, id: "x", hist: [0, 0, 0], vendido: 0, p26: 0, p27: 0 });
  return {
    ...base,
    id: `ft-${codigo}-${nombre}`.replace(/\s+/g, "-"),
    tienda_id: tiendaId,
    tienda_codigo: codigo,
    composicion_s: 0.2,
    historico_anual: [],
    anios: cifras.map((c) =>
      registro(c.anio, {
        id: `ft-${codigo}-${nombre}-${c.anio}`.replace(/\s+/g, "-"),
        bloque: "nuevas",
        subbloque: c.anio === Y ? "nuevas_anterior" : "aperturas",
        vendido: c.vendido ?? 0,
        propuesto: c.propuesto,
        decidido: c.decidido ?? null,
        origen: c.origen ?? null,
        propuesta_al_decidir: c.decidido === undefined ? null : c.propuesto,
        vigente: c.vigente,
        avance: null,
      })
    ),
    ...extra,
  };
}

/** Filas de apertura de DENIM: T10 (nueva del año anterior, 2026) y T12 (apertura 2027, sin fila de VALOR ni de ULTRA LOW: el referente no las vende). */
export function filasTiendaDenim(): FilaTiendaLineaApi[] {
  return [
    filaApertura("RECONOCIDO", "tienda-10", "T10", [{ anio: Y, propuesto: 2800, vigente: 2800, vendido: 2000 }]),
    filaApertura("MID VALUE", "tienda-10", "T10", [{ anio: Y, propuesto: 1500, vigente: 1500, vendido: 1000 }]),
    filaApertura("PREMIUM", "tienda-10", "T10", [{ anio: Y, propuesto: 497, vigente: 497, vendido: 420 }]),
    filaApertura("RECONOCIDO", "tienda-12", "T12", [{ anio: Y + 1, propuesto: 300, vigente: 300 }]),
    filaApertura("MID VALUE", "tienda-12", "T12", [{ anio: Y + 1, propuesto: 120, vigente: 120, decidido: 120, origen: "manual" }]),
    filaApertura("PREMIUM", "tienda-12", "T12", [{ anio: Y + 1, propuesto: 64, vigente: 64, origen: "escalada", decidido: 64 }]),
  ];
}

/** Composición por marca de las filas base de DENIM: PREMIUM con solo 2 marcas (sin «otras») y ULTRA LOW sin composición. */
export function marcasDenim(): MarcasDeFilaApi[] {
  const periodo = { desde: "2025-10-01", hasta: "2026-09-01", tiendas: 9 };
  const m = (nombre: string, top: [string, number][], otras: MarcasDeFilaApi["otras"]): MarcasDeFilaApi => ({
    fila_id: `fila-${nombre}`,
    equivalencia_id: null,
    agrupacion_marca_id: `am-${nombre}`,
    periodo,
    top: top.map(([marca, participacion]) => ({ marca_id: `mk-${marca}`, marca, participacion })),
    otras,
  });
  return [
    m("RECONOCIDO", [["MARCA A", 0.4], ["MARCA B", 0.25], ["MARCA C", 0.15]], { marcas: 6, participacion: 0.2 }),
    m("MID VALUE", [["MARCA D", 0.5], ["MARCA A", 0.3], ["MARCA E", 0.1]], { marcas: 2, participacion: 0.1 }),
    m("VALOR", [["MARCA F", 0.6], ["MARCA G", 0.3], ["MARCA H", 0.05]], { marcas: 1, participacion: 0.05 }),
    m("PREMIUM", [["MARCA I", 0.7], ["MARCA J", 0.3]], null),
  ];
}

export function respuestaLineas(extra: Partial<RespuestaLineasApi> = {}): RespuestaLineasApi {
  return {
    filtro: { genero_id: "g-h", mundo_id: "m-u", linea_id: "l-denim", q: null },
    filas: filasDenim(),
    totales_por_anio: [
      { anio: 2026, vigente: 45204, propuesto: 44854, decididas: 2, filas: 5 },
      { anio: 2027, vigente: 52724, propuesto: 52724, decididas: 1, filas: 5 },
    ],
    historico_linea: [
      { anio: 2023, unidades: 34100, clase: "atipico", tiendas: 8 },
      { anio: 2024, unidades: 38900, clase: "normal", tiendas: 8 },
      { anio: 2025, unidades: 42300, clase: "normal", tiendas: 9 },
      { anio: 2026, unidades: 31980, clase: "en_curso", tiendas: 9 },
    ],
    tiendas_linea: [
      { ...tiendaLinea(10), anio: 2026, bloque: "nuevas", subbloque: "nuevas_anterior", tienda: "T10", vendido: 3420, vigente: 4797, decidida: false, fecha_apertura: "2025-11-20", total_tienda: { propuesto: 9100, decidido: null } },
      { ...tiendaLinea(12), anio: 2027, bloque: "nuevas", subbloque: "aperturas", tienda: "T12", vendido: 0, vigente: 484, decidida: false, fecha_apertura: "2027-03-15", origen_composicion: "referente", referente: "T03", total_tienda: { propuesto: 7840, decidido: 7840 } },
    ],
    filas_tienda: filasTiendaDenim(),
    marcas: marcasDenim(),
    prueba_anterior: { propuesto: 16210, real: 16480, desvio_pct: -1.6, eat_m6: 9.8, eat_m6_cobertura: 1 },
    avisos_linea: ["tienda_nueva_sin_decidir"],
    indice_lineas: INDICE,
    ...extra,
  };
}

export function detalleFila(): FilaDetalleApi {
  const base = filasDenim()[0];
  const meses = (valor: number, n = 12) => Array.from({ length: n }, (_, i) => ({ periodo: `2025-${String(i + 1).padStart(2, "0")}-01`, unidades: valor + i * 10, venta_soles: 1000, stock_fin: 300 + i, cobertura: i === 4 ? 0.1 : 1.2, quiebre: i === 4, atipico: false }));
  return {
    ...base,
    historico: {
      anios: [
        { anio: 2023, clase: "atipico", meses_atipicos: ["2023-01"], total: 14500, total_normalizado: 15000, tiendas: ["T01", "T02"], meses: meses(1000).map((m) => ({ ...m, periodo: m.periodo.replace("2025", "2023"), atipico: true })) },
        { anio: 2025, clase: "normal", meses_atipicos: [], total: 16480, total_normalizado: 16480, tiendas: ["T01", "T02", "T03"], meses: meses(1300) },
        { anio: 2026, clase: "en_curso", meses_atipicos: [], total: 12480, total_normalizado: 12480, tiendas: ["T01", "T02", "T03"], meses: meses(1300, 9).map((m) => ({ ...m, periodo: m.periodo.replace("2025", "2026") })) },
      ],
      tendencia: 0.05,
      prueba_anterior: { anio: 2025, propuesto: 16210, real: 16480, desvio_pct: -1.6, dentro_de_muestra: true, eat_m6: 9.8, eat_m6_cobertura: 1 },
      pesos_equivalencias: [],
      salientes: [],
    },
    curva: [0.07, 0.07, 0.08, 0.08, 0.09, 0.09, 0.09, 0.09, 0.08, 0.08, 0.09, 0.09],
    curva_origen: [{ agrupacion_id: "ag-denim", curva_id: "c1", version: 2, peso: 1 }],
    factores_mes: { 2026: Array(12).fill(1), 2027: Array(12).fill(1) },
    participaciones: null,
  };
}

export function tiendaProyeccion(extra: Partial<TiendaProyeccionApi> = {}): TiendaProyeccionApi {
  return {
    tienda_id: "tienda-12",
    codigo: "T12",
    nombre: "Tienda nueva B",
    bloque: "nuevas",
    subbloque: "aperturas",
    anio: 2027,
    fecha_usada: "2027-03-15",
    venta_esperada: 85000,
    referente: { id: "tienda-3", codigo: "T03", nombre: "Tienda 3" },
    origen_composicion: "referente",
    unidades_maduras: 9850,
    rampa: [1, 1, 1],
    vendido: 0,
    propuesto: 7840,
    metodo: "apertura",
    referencia_alternativa: 8120,
    referencia_tres_meses: null,
    decidido: null,
    origen: null,
    propuesta_al_decidir: null,
    vigente: 7840,
    explicacion: "Composición de T03 (oct-2025 a set-2026), 412 filas. Año maduro completo: 9,850 u. Abre el 15 de marzo: 7,840 u en 2027.",
    nota: null,
    pasa_a_mismas: false,
    suma_filas: 7840,
    filas_fijadas: 0,
    filas: [
      fila({ nombre: "RECONOCIDO", id: "tf1", hist: [0, 0, 0], vendido: 0, p26: 0, p27: 5681 }, { tienda_id: "tienda-12" }),
    ].map((f) => ({ ...f, anios: f.anios.map((a) => ({ ...a, anio: 2027, bloque: "nuevas" as const, subbloque: "aperturas" as const, vigente: 5681, propuesto: 5681 })) })),
    avisos: ["sin_referente", "apertura_tardia"],
    ...extra,
  };
}

export function nodo(nivel: NodoMatrizApi["nivel"], nombre: string, ids: NodoMatrizApi["ids"], extra: Partial<NodoMatrizApi> = {}): NodoMatrizApi {
  return {
    nivel,
    nombre,
    ids,
    en_curso: { venta_a_la_fecha: 35400, mismas: 45204, nuevas_anterior: 4797, aperturas: 0, cierres: 0, total: 50001, decididas: 2, filas: 5 },
    siguiente: { mismas: 52724, nuevas_anterior: 0, aperturas: 484, cierres: 0, total: 53208, decididas: 1, filas: 5 },
    variacion_pct: 6.4,
    estado: "parcial",
    avisos: [],
    ...extra,
  };
}

export function respuestaMatriz(extra: Partial<RespuestaMatrizApi> = {}): RespuestaMatrizApi {
  return {
    filtro: { genero_id: null, mundo_id: null, linea_id: null, temporada: null, agrupacion_estacionalidad_id: null, agrupacion_marca_id: null, solo: null, por: "arbol" },
    nodos: [
      nodo("compania", "Compañía", {}),
      nodo("genero", "HOMBRE", { genero_id: "g-h" }),
      nodo("mundo", "URBANO", { genero_id: "g-h", mundo_id: "m-u" }),
      nodo("linea", "DENIM", { genero_id: "g-h", mundo_id: "m-u", linea_id: "l-denim" }),
      nodo("linea", "POLO", { genero_id: "g-h", mundo_id: "m-u", linea_id: "l-polo" }, { estado: "curva_cambio", variacion_pct: 2.7 }),
    ],
    bloques: bloques(),
    resumen: { lineas: 2, lineas_total: 41, porcentaje_total: 6.4, desvio_prueba_anterior_pct: -1.9, filas_para_revision: 12 },
    ...extra,
  };
}

export function filaMensual(extra: Partial<FilaMensualApi> = {}): FilaMensualApi {
  const real = Array<"real">(9).fill("real");
  const proy = Array<"proyectado">(3).fill("proyectado");
  return {
    ids: { genero_id: "g-h", mundo_id: "m-u", linea_id: "l-denim" },
    genero: "HOMBRE",
    mundo: "URBANO",
    linea: "DENIM",
    agrupacion_marca: null,
    bloque: "todas",
    anios: [
      { anio: 2026, total: 50001, meses: [3100, 2900, 3200, 3450, 3700, 3950, 4100, 4000, 3580, 4053, 4238, 4933].map((n) => n), origen_meses: [...real, ...proy], sin_curva: 0 },
      { anio: 2027, total: 53208, meses: Array(12).fill(4434), origen_meses: Array<"proyectado">(12).fill("proyectado"), sin_curva: 0 },
    ],
    ...extra,
  };
}

export function respuestaMensual(extra: Partial<RespuestaMensualApi> = {}): RespuestaMensualApi {
  const f = filaMensual();
  return {
    filtro: { genero_id: null, mundo_id: null, linea_id: null, temporada: null, agrupacion_estacionalidad_id: null, agrupacion_marca_id: null, solo: null, por: "arbol", bloque: "todas", por_agrupacion: false },
    filas: [f, filaMensual({ linea: "POLO", ids: { genero_id: "g-h", mundo_id: "m-u", linea_id: "l-polo" }, anios: [{ anio: 2026, total: 43000, meses: Array<null>(12).fill(null), origen_meses: Array<"proyectado">(12).fill("proyectado"), sin_curva: 1 }] })],
    totales: [
      { anio: 2026, total: 93001, meses: f.anios[0].meses, origen_meses: f.anios[0].origen_meses },
      { anio: 2027, total: 53208, meses: f.anios[1].meses, origen_meses: f.anios[1].origen_meses },
    ],
    bloques: bloques(),
    ...extra,
  };
}

export function factores(): FactorApi[] {
  return [
    { anio: 2023, temporada: "invierno", ratio_calculado: 0.63, ratio_aplicado: null, ratio_efectivo: 0.63, origen: "calculado", parcial: false, tiendas_comunes: 7, meses_comparados: 12, calculado_at: "2026-10-14T15:00:00Z", nota: null, objetivo: false },
    { anio: 2026, temporada: "invierno", ratio_calculado: 0.66, ratio_aplicado: 0.7, ratio_efectivo: 0.7, origen: "manual", parcial: true, tiendas_comunes: 9, meses_comparados: 9, calculado_at: "2026-10-14T15:00:00Z", nota: "ajustado por Javier", objetivo: false },
    { anio: 2026, temporada: "verano", ratio_calculado: 1.24, ratio_aplicado: null, ratio_efectivo: 1.24, origen: "calculado", parcial: true, tiendas_comunes: 9, meses_comparados: 1, calculado_at: "2026-10-14T15:00:00Z", nota: null, objetivo: false },
    { anio: 2027, temporada: "invierno", ratio_calculado: null, ratio_aplicado: null, ratio_efectivo: null, origen: null, parcial: false, tiendas_comunes: null, meses_comparados: null, calculado_at: null, nota: null, objetivo: true },
  ];
}

export function colaLarga(extra: Partial<ColaLargaApi> = {}): ColaLargaApi {
  return { demanda_corregida: 180.5, disponibilidad: 0.62, tienda_meses_con_stock: 67, tienda_meses: 108, meses_cd_con_stock: 10, veredicto: "revision", ritmo: 1.4, meses_tiendas_sin_stock: 1, ...extra };
}

/** Una fila de cola larga «para revisión»: la propuesta es la demanda corregida (180) y el avance normal (60) queda al lado. */
export function filaRevision(): FilaApi {
  const f = fila({ nombre: "VALOR", id: "fr", hist: [40, 50, 55], vendido: 45, p26: 180, p27: 190 });
  f.anios[0] = { ...f.anios[0], propuesto: 180, vigente: 180, metodo: "avance", referencia_alternativa: 60, avisos: ["revision_cola_larga"], cola_larga: colaLarga() };
  f.anios[1] = { ...f.anios[1], avisos: ["revision_cola_larga"] };
  return f;
}
