import type {
  AlertaApi,
  AprobacionApi,
  BloqueosCierreApi,
  ClavePuente,
  ComparativoApi,
  CrecimientoGMApi,
  EstadoDireccionApi,
  FilaDesgloseApi,
  OpcionesTableroApi,
  ProyeccionTableroApi,
  PuenteApi,
  ResumenAprobacionApi,
  SerieMensualApi,
  TableroApi,
} from "../src/lib/direccion/tipos-api";

/**
 * Datos de prueba de la PANTALLA del tablero de dirección (frontend): el caso sintético de la ficha 14, §6.1, ya en la forma que entrega la API
 * (`TableroApi`, `OpcionesTableroApi`, `BloqueosCierreApi`, `AprobacionApi`, `EstadoDireccionApi`). «Para decidir» es la proyección entera (84 714 u);
 * «Explorar» es el recorte HOMBRE · URBANO (52 708 u). Cifras sintéticas: nada de datos reales. El fixture del servidor (`tests/direccion.fixture.ts`)
 * es de `backend`; este archivo no lo usa.
 */

export const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const ID = {
  proyeccion: id(1),
  seguimiento: id(2),
  enTrabajo: id(3),
  hombre: id(11),
  mujer: id(12),
  ninos: id(13),
  bebes: id(14),
  urbano: id(21),
  formal: id(22),
  l1: id(31),
  l2: id(32),
  l3: id(33),
  amA: id(41),
  amB: id(42),
  marcaX: id(51),
  marcaZ: id(52),
  t01: id(61),
  t02: id(62),
  t03: id(63),
  t04: id(64),
  t09: id(69),
  t10: id(70),
  t12: id(72),
  aprobacion: id(81),
} as const;

export const GM_HU = `${ID.hombre}|${ID.urbano}`;
export const GM_MU = `${ID.mujer}|${ID.urbano}`;

/** Reparte `total` en enteros en proporción a `pesos` (mayor resto): para armar meses que sumen el total del año. */
function repartir(total: number, pesos: readonly number[]): number[] {
  const suma = pesos.reduce((a, b) => a + b, 0);
  const exactos = pesos.map((p) => (total * p) / suma);
  const pisos = exactos.map(Math.floor);
  let falta = total - pisos.reduce((a, b) => a + b, 0);
  const orden = exactos.map((x, i) => ({ i, r: x - pisos[i] })).sort((a, b) => b.r - a.r || a.i - b.i);
  for (const o of orden) {
    if (falta <= 0) break;
    pisos[o.i] += 1;
    falta -= 1;
  }
  return pisos;
}

const suma = (v: readonly (number | null)[]): number => v.reduce<number>((a, b) => a + (b ?? 0), 0);

// ─── Serie mensual de HOMBRE · URBANO (§6.1) ───
export const M2025 = [3200, 2757, 3029, 3469, 4286, 4148, 4796, 3809, 3506, 3455, 3913, 6632];
export const M2024 = repartir(42000, M2025);
export const M2023 = repartir(40000, M2025);
/** Real de 2026 hasta oct (`k' = 10`). */
export const M2026_REAL: (number | null)[] = [3343, 2926, 3182, 3591, 4357, 4227, 4837, 3909, 3628, 4300, null, null];
/** Proyectado de 2026 desde oct (`k = 9`). */
export const M2026_PROY: (number | null)[] = [null, null, null, null, null, null, null, null, null, 3900, 4380, 7721];
export const M2026_CIERRE = [3343, 2926, 3182, 3591, 4357, 4227, 4837, 3909, 3628, 3900, 4380, 7721];
export const M2026_SIN_NINO = [3343, 2926, 3182, 3591, 4357, 4473, 5083, 4154, 3628, 3900, 4380, 7721];
export const M2027 = [3671, 3158, 3420, 3781, 4596, 4354, 4929, 3932, 3922, 4194, 4707, 8044];
export const M_APROBADA = [3671, 3158, 3420, 3781, 4596, 4354, 4929, 3932, 3922, 4194, 4707, 7836];

const pct = (a: number, b: number): number => (a / b - 1) * 100;

const serie = (clave: string, etiqueta: string, anio: number, tipo: SerieMensualApi["tipo"], meses: (number | null)[], nino = false, exactitud: SerieMensualApi["exactitud"] = "exacto"): SerieMensualApi => ({ clave, etiqueta, anio, tipo, nino, meses, total: suma(meses), exactitud });

export function seriesHU(): SerieMensualApi[] {
  return [
    serie("real-2023", "2023", 2023, "real", M2023, true),
    serie("real-2024", "2024", 2024, "real", M2024),
    serie("real-2025", "2025", 2025, "real", M2025),
    serie("real-2026", "2026 real", 2026, "real_parcial", M2026_REAL, true),
    serie("proyectado-2026", "2026 proyectado", 2026, "proyectado", M2026_PROY, true),
    serie("sin-nino-2026", "2026 sin Niño (derivado)", 2026, "sin_nino", M2026_SIN_NINO, true),
    serie("proyectado-2027", "2027 proyectado", 2027, "proyectado", M2027),
    serie("comparada", "Proyección 2026–2027 seguimiento set", 2027, "aprobada", M_APROBADA),
  ];
}

type FilaMensual = TableroApi["tabla_mensual"]["filas"][number];
const fila = (clave: string, etiqueta: string, tipo: FilaMensual["tipo"], meses: (number | null)[], total: number | null = suma(meses)): FilaMensual => ({ clave, etiqueta, meses, total, tipo, exactitud: "exacto" });

export function tablaMensualHU(): FilaMensual[] {
  return [
    fila("real-2023", "2023", "real", M2023),
    fila("real-2024", "2024", "real", M2024),
    fila("real-2025", "2025", "real", M2025),
    fila("real-2026", "2026 real", "real_parcial", M2026_REAL),
    fila("proyectado-2026", "2026 proyectado", "proyectado", M2026_PROY),
    fila("cierre-2026", "2026 cierre", "proyectado", M2026_CIERRE),
    fila("sin-nino-2026", "2026 sin Niño", "sin_nino", M2026_SIN_NINO),
    fila("proyectado-2027", "2027", "proyectado", M2027),
    fila("comparada", "Proyección 2026–2027 seguimiento set (aprobada)", "aprobada", M_APROBADA),
    fila("var-sig-cierre", "2027 vs 2026 cierre (%)", "variacion", M2027.map((v, i) => pct(v, M2026_CIERRE[i])), pct(52708, 50001)),
    fila("var-sig-anterior", "2027 vs 2025 (%)", "variacion", M2027.map((v, i) => pct(v, M2025[i])), pct(52708, 47000)),
    fila("var-cierre-anterior", "2026 vs 2025 (%)", "variacion", M2026_CIERRE.map((v, i) => pct(v, M2025[i])), pct(50001, 47000)),
  ];
}

// ─── Puente ───
const ORDEN_PUENTE: readonly { clave: ClavePuente; etiqueta: string; subtotal: boolean; ayuda?: string }[] = [
  { clave: "cierre_en_curso", etiqueta: "2026 cierre, todas las tiendas", subtotal: true },
  { clave: "fuera_base", etiqueta: "− 2026 de tiendas que no forman la base de 2027", subtotal: false },
  { clave: "ajuste_base", etiqueta: "− 2026 de tiendas que cierran en 2027, filas sin base y diferencia", subtotal: false },
  { clave: "base", etiqueta: "Base 2027 (B): 2026 de las mismas tiendas de 2027", subtotal: true },
  { clave: "nino", etiqueta: "+ Corrección del Niño (B′ − B)", subtotal: false },
  { clave: "crecimiento", etiqueta: "+ Crecimiento declarado aplicado (propuesta − B′)", subtotal: false },
  { clave: "manual", etiqueta: "+ Cifras fijadas (a mano o sugeridas por IA)", subtotal: false, ayuda: "Lo que el planner o el admin fijaron por encima o por debajo de la propuesta, a mano o aceptando una cifra sugerida por la IA." },
  { clave: "otras", etiqueta: "+ Otras diferencias con la propuesta", subtotal: false, ayuda: "Filas aceptadas en bloque, por IA o tal cual cuya propuesta cambió después al recalcular, y filas escaladas por tienda." },
  { clave: "sin_base", etiqueta: "+ Filas de mismas tiendas sin base B (otro método)", subtotal: false },
  { clave: "mismas_siguiente", etiqueta: "Mismas tiendas 2027", subtotal: true },
  { clave: "nuevas_anterior", etiqueta: "+ Tiendas abiertas en 2026 (aún fuera de la base)", subtotal: false },
  { clave: "aperturas", etiqueta: "+ Aperturas de 2027", subtotal: false },
  { clave: "cierres", etiqueta: "+ Venta de 2027 de tiendas que cierran en 2027", subtotal: false },
  { clave: "total_siguiente", etiqueta: "2027", subtotal: true },
];

/** Arma un puente a partir del cierre y de los pasos (los que restan, en negativo). */
export function puente(cierre: number, pasos: Partial<Record<ClavePuente, number>>, conNino = true): PuenteApi {
  let acumulado = cierre;
  const lineas = ORDEN_PUENTE.map((l) => {
    const u = l.subtotal ? 0 : (pasos[l.clave] ?? 0);
    acumulado += u;
    return { clave: l.clave, etiqueta: l.etiqueta, u: l.subtotal ? acumulado : u, acumulado, subtotal: l.subtotal, ...(l.ayuda ? { ayuda: l.ayuda } : {}) };
  });
  const de = (c: ClavePuente) => lineas.find((l) => l.clave === c)!;
  const base = de("base").acumulado;
  return {
    lineas,
    pct: {
      base_sobre_real: cierre > 0 ? pct(base, cierre) : null,
      nino: conNino && base > 0 ? (de("nino").u / base) * 100 : null,
      crecimiento: base > 0 ? (de("crecimiento").u / (base + de("nino").u)) * 100 : null,
      manual: base > 0 ? (de("manual").u / (de("crecimiento").acumulado || 1)) * 100 : null,
      otras: base > 0 ? (de("otras").u / (de("manual").acumulado || 1)) * 100 : null,
      total_vs_cierre: cierre > 0 ? pct(de("total_siguiente").acumulado, cierre) : null,
    },
  };
}

export const puenteHU = (): PuenteApi => puente(50001, { ajuste_base: -2961, nino: 753, crecimiento: 2390, manual: 117, aperturas: 1408, cierres: 1000 });
export const puenteMU = (): PuenteApi => puente(28500, { crecimiento: 2280, manual: 1226 }, false);
export const puenteTotal = (): PuenteApi => puente(78501, { ajuste_base: -2961, nino: 753, crecimiento: 4670, manual: 1343, aperturas: 1408, cierres: 1000 });

// ─── Proyecciones ───
export function proyeccion(extra: Partial<ProyeccionTableroApi> = {}): ProyeccionTableroApi {
  return {
    id: ID.proyeccion,
    nombre: "Proyección 2026–2027",
    estado: "cerrada",
    anio_en_curso: 2026,
    anio_siguiente: 2027,
    hasta_periodo: "2026-09",
    k: 9,
    version_metodo: 6,
    cerrada_at: "2026-11-07T20:00:00Z",
    cerrada_por_nombre: "Planner P.",
    usa_compras: true,
    ...extra,
  };
}

export const proyeccionSeguimiento = (): ProyeccionTableroApi => proyeccion({ id: ID.seguimiento, nombre: "Proyección 2026–2027 seguimiento set", estado: "archivada", cerrada_at: "2026-11-02T15:00:00Z", usa_compras: false });
export const proyeccionEnTrabajo = (): ProyeccionTableroApi => proyeccion({ id: ID.enTrabajo, nombre: "Proyección 2026–2027 seguimiento oct", estado: "en_trabajo", cerrada_at: null, cerrada_por_nombre: null, usa_compras: false });

// ─── Opciones ───
export function opciones(extra: Partial<OpcionesTableroApi> = {}): OpcionesTableroApi {
  const tienda = (tid: string, codigo: string, apertura: string | null = "2015-01-01", cierre: string | null = null) => ({ id: tid, codigo, nombre: `Tienda ${codigo}`, fecha_apertura: apertura, fecha_cierre: cierre, activa: cierre === null || cierre > "2026-11-10" });
  return {
    proyecciones: [
      { ...proyeccion(), estado_direccion: "sin_aprobacion" },
      { ...proyeccionEnTrabajo(), estado_direccion: "sin_aprobacion" },
      { ...proyeccionSeguimiento(), estado_direccion: "aprobada" },
    ],
    por_defecto: { proyeccion_id: ID.proyeccion, motivo: "usa_compras" },
    comparar_por_defecto: { proyeccion_id: ID.seguimiento, aprobacion_id: ID.aprobacion },
    generos: [
      { id: ID.hombre, nombre: "HOMBRE", es_resto: false },
      { id: ID.mujer, nombre: "MUJER", es_resto: false },
      { id: ID.ninos, nombre: "NIÑOS", es_resto: true },
      { id: ID.bebes, nombre: "BEBÉS", es_resto: true },
    ],
    mundos: [
      { id: ID.urbano, nombre: "URBANO" },
      { id: ID.formal, nombre: "FORMAL" },
    ],
    lineas: [
      { id: ID.l1, nombre: "L1 POLOS", genero_id: ID.hombre, mundo_id: ID.urbano },
      { id: ID.l2, nombre: "L2 CASACAS", genero_id: ID.hombre, mundo_id: ID.urbano },
      { id: ID.l3, nombre: "L3 BLUSAS", genero_id: ID.mujer, mundo_id: ID.urbano },
    ],
    temporadas: [
      { id: "invierno", nombre: "Invierno" },
      { id: "verano", nombre: "Verano" },
      { id: "todo_el_ano", nombre: "Todo el año" },
      { id: "sin_temporada", nombre: "Sin temporada" },
    ],
    agrupaciones_marca: [
      { id: ID.amA, nombre: "AM-A" },
      { id: ID.amB, nombre: "AM-B" },
    ],
    unidades_marca: [
      { id: ID.marcaX, nombre: "MARCA X", agrupacion_marca_id: ID.amA },
      { id: ID.marcaZ, nombre: "MARCA Z", agrupacion_marca_id: ID.amB },
    ],
    tiendas: [tienda(ID.t01, "T01"), tienda(ID.t02, "T02"), tienda(ID.t03, "T03"), tienda(ID.t04, "T04", "2015-01-01", "2027-06-30"), tienda(ID.t09, "T09", "2012-01-01", "2024-08-31"), tienda(ID.t10, "T10", "2025-11-15"), tienda(ID.t12, "T12", "2027-04-01")],
    ...extra,
  };
}

// ─── Comparativos, desglose, crecimientos, alertas ───
const M2027_MISMAS = ["T01", "T02", "T03", "T10"];
const M2026_MISMAS = ["T01", "T02", "T03", "T04"];

export function comparativosHU(): ComparativoApi[] {
  return [
    { clave: "sig_vs_cierre", etiqueta: "2027 vs 2026 cierre", nino: true, total: { pct: pct(52708, 50001), motivo: null }, mismas: { pct: pct(50300, 47040), tiendas: M2027_MISMAS, motivo: null } },
    { clave: "sig_vs_anterior", etiqueta: "2027 vs 2025 (último año normal)", nino: false, total: { pct: pct(52708, 47000), motivo: null }, mismas: { pct: pct(50300, 43800), tiendas: M2027_MISMAS, motivo: null } },
    { clave: "cierre_vs_anterior", etiqueta: "2026 cierre vs 2025", nino: true, total: { pct: pct(50001, 47000), motivo: null }, mismas: { pct: pct(45901, 46700), tiendas: M2026_MISMAS, motivo: null } },
    { clave: "cierre_vs_hace_dos", etiqueta: "2026 cierre vs 2024", nino: true, total: { pct: pct(50001, 42000), motivo: null }, mismas: { pct: null, tiendas: [], motivo: "sin_base" } },
    { clave: "ac_vs_ac", etiqueta: "2026 ene–set vs 2025 ene–set", nino: true, total: { pct: pct(34000, 33000), motivo: null }, mismas: { pct: pct(31000, 32722), tiendas: M2026_MISMAS, motivo: null } },
    { clave: "anterior_vs_hace_dos", etiqueta: "2025 vs 2024", nino: false, total: { pct: pct(47000, 42000), motivo: null }, mismas: { pct: null, tiendas: [], motivo: "incompleto" } },
  ];
}

export function filaDesglose(fid: string, nombre: string, v: { a2023: number; a2024: number; a2025: number; acAnt: number; acCur: number; cierre: number; sig: number }, total: number, extra: Partial<FilaDesgloseApi> = {}): FilaDesgloseApi {
  return {
    id: fid,
    nombre,
    exactitud: "exacto",
    anios: [
      { anio: 2023, tipo: "real", total: v.a2023 },
      { anio: 2024, tipo: "real", total: v.a2024 },
      { anio: 2025, tipo: "real", total: v.a2025 },
      { anio: 2026, tipo: "cierre", total: v.cierre },
      { anio: 2027, tipo: "proyectado", total: v.sig },
    ],
    ac_anterior: v.acAnt,
    ac_en_curso: v.acCur,
    pct: { sig_vs_cierre: pct(v.sig, v.cierre), sig_vs_anterior: pct(v.sig, v.a2025), cierre_vs_anterior: pct(v.cierre, v.a2025), ac_vs_ac: pct(v.acCur, v.acAnt) },
    participacion_siguiente: v.sig / total,
    filtrable: true,
    ...extra,
  };
}

export function desgloseHU(): TableroApi["desglose"] {
  return {
    dimension: "linea",
    filas: [
      filaDesglose(ID.l2, "L2 CASACAS", { a2023: 10000, a2024: 10500, a2025: 11800, acAnt: 9155, acCur: 9600, cierre: 12501, sig: 13300 }, 52708),
      filaDesglose(ID.l1, "L1 POLOS", { a2023: 30000, a2024: 31500, a2025: 35200, acAnt: 27300, acCur: 28700, cierre: 37500, sig: 39408 }, 52708),
    ],
    total: filaDesglose("total", "Total", { a2023: 40000, a2024: 42000, a2025: 47000, acAnt: 36455, acCur: 38300, cierre: 50001, sig: 52708 }, 52708, { filtrable: false }),
  };
}

export function crecimientos(): CrecimientoGMApi[] {
  return [
    {
      gm_clave: GM_HU,
      nombre: "HOMBRE · URBANO",
      declarado_pct: 5,
      sobre_base: "corregida",
      version: 2,
      autor: "Planner P.",
      aprobada_at: "2026-11-06T15:00:00Z",
      nota: null,
      base_real: 47040,
      base_corregida: 47793,
      con_nino: true,
      siguiente_mismas: 50300,
      implicito_sobre_real_pct: pct(50300, 47040),
      implicito_sobre_corregida_pct: pct(50300, 47793),
      desvio_pp: pct(50300, 47793) - 5,
      tendencia_mismas_pct: pct(34290, 36455),
      tendencia_mismas_corregida_pct: pct(35020.5, 36455),
      tendencia_afectada_nino: false,
      semaforo: "contra_tendencia",
      anomalias: ["sin_nota"],
    },
    {
      gm_clave: GM_MU,
      nombre: "MUJER · URBANO",
      declarado_pct: 8,
      sobre_base: "bruta",
      version: 4,
      autor: "Planner P.",
      aprobada_at: "2026-11-06T16:00:00Z",
      nota: "Ajuste por campaña",
      base_real: 28500,
      base_corregida: 28500,
      con_nino: false,
      siguiente_mismas: 32006,
      implicito_sobre_real_pct: pct(32006, 28500),
      implicito_sobre_corregida_pct: pct(32006, 28500),
      desvio_pp: pct(32006, 28500) - 8,
      tendencia_mismas_pct: pct(22300, 21000),
      tendencia_mismas_corregida_pct: pct(22300, 21000),
      tendencia_afectada_nino: false,
      semaforo: "revisar",
      anomalias: ["reemplazada_mismo_dia"],
    },
    {
      gm_clave: "resto",
      nombre: "Resto",
      declarado_pct: null,
      sobre_base: null,
      version: null,
      autor: null,
      aprobada_at: null,
      nota: null,
      base_real: null,
      base_corregida: null,
      con_nino: false,
      siguiente_mismas: null,
      implicito_sobre_real_pct: null,
      implicito_sobre_corregida_pct: null,
      desvio_pp: null,
      tendencia_mismas_pct: null,
      tendencia_mismas_corregida_pct: null,
      tendencia_afectada_nino: false,
      semaforo: "sin_dato",
      anomalias: [],
    },
    {
      gm_clave: "total",
      nombre: "Total",
      declarado_pct: null,
      sobre_base: null,
      version: null,
      autor: null,
      aprobada_at: null,
      nota: null,
      base_real: 75540,
      base_corregida: 76293,
      con_nino: true,
      siguiente_mismas: 82306,
      implicito_sobre_real_pct: pct(82306, 75540),
      implicito_sobre_corregida_pct: pct(82306, 76293),
      desvio_pp: null,
      tendencia_mismas_pct: null,
      tendencia_mismas_corregida_pct: null,
      tendencia_afectada_nino: false,
      semaforo: "sin_dato",
      anomalias: [],
    },
  ];
}

const alerta = (codigo: AlertaApi["codigo"], nivel: AlertaApi["nivel"], alcance: AlertaApi["alcance"], titulo: string, detalle: string, enlace: string | null = null): AlertaApi => ({ codigo, nivel, alcance, titulo, detalle, cifras: {}, enlace });

export function alertas(): AlertaApi[] {
  const m7 = `/planificacion/proyeccion?proyeccion=${ID.proyeccion}`;
  return [
    alerta("contra_tendencia", "importante", "proyeccion", "HOMBRE · URBANO va contra la tendencia", "HOMBRE · URBANO declara +5.0 % y sus mismas tiendas van -3.9 % en ene–oct, corregido del Niño (-5.9 % en bruto).", `${m7}&pestana=crecimientos`),
    alerta("desvio_crecimiento", "importante", "proyeccion", "MUJER · URBANO: implícito distinto del declarado", "MUJER · URBANO: declarado +8.0 %, implícito +12.3 % (+4.3 pp: fijado a mano +1,226 u).", `${m7}&pestana=crecimientos`),
    alerta("factor_provisional", "importante", "proyeccion", "Factor del Niño provisional", "Invierno 2026 provisional (1 mes del periodo, escrito a mano 0.70): expone 13,300 u de 2027 (15.7 %) en filas de invierno.", `${m7}&pestana=factores`),
    alerta("tienda_nueva_relevante", "importante", "proyeccion", "T10 entra a mismas tiendas", "T10 entra a mismas tiendas en 2027 y es el 5.4 % de la base: abrió en nov 2025 y su 2026 es real ene–set más proyectado oct–dic.", `${m7}&pestana=tiendas`),
    alerta("apertura_sin_historia", "importante", "proyeccion", "T12 sin venta propia", "T12 (abr 2027) se proyecta por venta esperada y su referente: no tiene venta propia.", `${m7}&pestana=tiendas`),
    alerta("anomalia_crecimiento", "info", "proyeccion", "Versiones de crecimiento", "MUJER · URBANO v4 reemplazó a v3 el mismo día (06 nov, Planner P.); HOMBRE · URBANO sin nota."),
    alerta("origen_decisiones", "info", "proyeccion", "Cómo se decidió 2027", "2027: 49 % aceptado en bloque, 15 % tal cual la propuesta, 36 % a mano; 6 de los 8 registros de 2027 decididos el 07 nov por Planner P."),
    alerta("datos_mas_nuevos", "info", "proyeccion", "Hay venta más nueva", "Hay oct 2026 publicado: el gráfico muestra su real junto al proyectado."),
    alerta("base_corregida_nino", "info", "proyeccion", "Base corregida del Niño", "HOMBRE · URBANO: base 2027 corregida del Niño +1.6 % (47,040 → 47,793)."),
    alerta("distinta_de_aprobada", "info", "proyeccion", "Distinta de lo aprobado", "Frente a lo aprobado el 03 nov: 2027 +1,214 u (+1.5 %)."),
    alerta("apertura_sin_historia", "importante", "recorte", "T12 sin venta propia (en este recorte)", "T12 (abr 2027) aporta 1,408 u a HOMBRE · URBANO por venta esperada."),
  ];
}

export function diferencia(): NonNullable<TableroApi["decidir"]["diferencia"]> {
  return {
    aprobacion_id: ID.aprobacion,
    proyeccion_id: ID.seguimiento,
    proyeccion_nombre: "Proyección 2026–2027 seguimiento set",
    misma_proyeccion: false,
    fecha: "2026-11-03T15:00:00Z",
    usuario_nombre: "Admin A.",
    resultado: "aprobada",
    identica: false,
    en_curso: { aprobado: 78300, actual: 78501, u: 201, pct: pct(78501, 78300) },
    siguiente: { aprobado: 83500, actual: 84714, u: 1214, pct: pct(84714, 83500) },
    por_gm: [
      { gm_clave: GM_HU, nombre: "HOMBRE · URBANO", aprobado: 52500, actual: 52708, u: 208, pct: pct(52708, 52500) },
      { gm_clave: GM_MU, nombre: "MUJER · URBANO", aprobado: 31000, actual: 32006, u: 1006, pct: pct(32006, 31000) },
    ],
  };
}

export const HUELLA = "0123456789abcdef0123456789abcdef";

export const LINEAS_DECIDIR = [
  "2027: 84,714 u, +7.9 % sobre el cierre 2026 y +13.7 % sobre 2025, el último año normal (2026 fue año del Niño).",
  "El aumento de 6,213 u sale de: crecimiento declarado +4,670, cifras fijadas +1,343, aperturas +1,408, venta de 2027 de tiendas que cierran +1,000, corrección del Niño +753, menos 2,961 de tiendas que salen de la base.",
  "5 alertas importantes; la primera: HOMBRE · URBANO declara +5.0 % con sus mismas tiendas a -3.9 % en lo que va del año, corregido del Niño (-5.9 % en bruto).",
  "Frente a lo aprobado el 03 nov (Proyección 2026–2027 seguimiento set): 2027 +1,214 u (+1.5 %); el mayor cambio, MUJER · URBANO +1,006 u.",
  "Cerrada por Planner P. el 07 nov 2026; sin aprobación de dirección vigente.",
];

/** El tablero del caso §6.1: «Para decidir» de la proyección entera y «Explorar» con el recorte HOMBRE · URBANO. */
export function tablero(extra: Partial<TableroApi> = {}): TableroApi {
  return {
    proyeccion: proyeccion(),
    comparada: { ...proyeccionSeguimiento(), motivo: "aprobada", huella_igual_a_aprobada: true },
    datos: {
      k_prima: 10,
      ultimo_publicado: "2026-10",
      meses_faltantes: [],
      anios_nino: [2023, 2026],
      tiendas: [
        { tienda_id: ID.t01, situacion: "mismas" },
        { tienda_id: ID.t02, situacion: "mismas" },
        { tienda_id: ID.t03, situacion: "mismas" },
        { tienda_id: ID.t10, situacion: "mismas" },
        { tienda_id: ID.t12, situacion: "aperturas" },
        { tienda_id: ID.t04, situacion: "cierres" },
        { tienda_id: ID.t09, situacion: "fuera" },
      ],
      fuera_universo: [{ anio: 2023, u: 3100 }],
    },
    filtros: { texto: "HOMBRE · URBANO", exactitud: "exacto", conjunto_tiendas: null },
    decidir: {
      lineas: LINEAS_DECIDIR,
      estado: "sin_aprobacion",
      vigente: null,
      ultima: null,
      diferencia: diferencia(),
      precision: { desvio_prueba_anterior_pct: -3.2, rotulo: "dentro de muestra" },
      objetivo_pct: 6,
      puede_aprobar: true,
      alertas_importantes: 5,
    },
    puente: {
      recorte: puenteHU(),
      por_gm: [
        { ...puenteHU(), gm_clave: GM_HU, nombre: "HOMBRE · URBANO" },
        { ...puenteMU(), gm_clave: GM_MU, nombre: "MUJER · URBANO" },
        { ...puente(0, {}, false), gm_clave: "resto", nombre: "Resto" },
        { ...puenteTotal(), gm_clave: "total", nombre: "Total" },
      ],
    },
    alertas: alertas(),
    kpis: { siguiente: 52708, cierre: 50001, real_ac: 34000, proyectado_resto: 16001, anterior: 47000, hace_dos: 42000, hace_tres: 40000, comparativos: comparativosHU(), exactitud: "exacto" },
    series: seriesHU(),
    tabla_mensual: { filas: tablaMensualHU() },
    desglose: desgloseHU(),
    crecimientos: crecimientos(),
    decisiones: [
      {
        anio: 2027,
        por_origen: [
          { clave: "lote", etiqueta: "En bloque", n: 2, u: 29300, pct_u: 55.6 },
          { clave: "ia", etiqueta: "IA", n: 0, u: 0, pct_u: 0 },
          { clave: "propuesta", etiqueta: "Aceptada tal cual", n: 2, u: 13000, pct_u: 24.7 },
          { clave: "manual", etiqueta: "A mano", n: 2, u: 10408, pct_u: 19.7 },
          { clave: "escalada", etiqueta: "Escalada por tienda", n: 0, u: 0, pct_u: 0 },
          { clave: "sin_decidir", etiqueta: "Sin decidir", n: 0, u: 0, pct_u: 0 },
        ],
        autores: [
          { nombre: "Planner P.", n: 5, u: 51300, desde: "2026-11-07", hasta: "2026-11-07" },
          { nombre: "Admin A.", n: 1, u: 1408, desde: "2026-11-06", hasta: "2026-11-06" },
        ],
        dia_pico: { fecha: "2026-11-07", n: 5 },
      },
    ],
    apoyo: {
      soles: {
        anios: [
          { anio: 2023, s: 1880000, tipo: "real" },
          { anio: 2024, s: 2016000, tipo: "real" },
          { anio: 2025, s: 2350000, tipo: "real" },
          { anio: 2026, s: 1991600, tipo: "real_parcial" },
          { anio: 2026, s: 2600052, tipo: "estimado" },
          { anio: 2027, s: 2740816, tipo: "estimado" },
        ],
        precio_medio: 52,
        ventana: { desde: "2025-11", hasta: "2026-10" },
        u_sin_precio: 0,
      },
      cobertura: { periodo: "2026-10", stock_tiendas: 18000, stock_cd: 12000, imi_proyectado: 30000 / (52058 / 12), imi_real: 30000 / (48845 / 12), exactitud: "exacto" },
    },
    mayores: [
      { fila: "HOMBRE · URBANO · L1 POLOS · AM-A", vigente: 25000, participacion: 25000 / 50300, crecimiento_pct: 6.4 },
      { fila: "HOMBRE · URBANO · L1 POLOS · AM-B", vigente: 12000, participacion: 12000 / 50300, crecimiento_pct: 5 },
      { fila: "HOMBRE · URBANO · L2 CASACAS · AM-A", vigente: 9000, participacion: 9000 / 50300, crecimiento_pct: 9.1 },
      { fila: "HOMBRE · URBANO · L2 CASACAS · AM-B", vigente: 4300, participacion: 4300 / 50300, crecimiento_pct: null },
    ],
    atribucion: null,
    huella: HUELLA,
    ...extra,
  };
}

/** La nota del servidor bajo la tabla mensual cuando «Sin atribuir a tienda» trae negativos (T3; texto de §3.4 C). */
export const NOTA_SIN_ATRIBUIR = "−12 u en oct 2027: lo atribuido a las tiendas ese mes supera lo proyectado para el bloque; nunca se resta de una tienda.";

/** El mismo recorte con la tienda T03 elegida: cifras estimadas (atribución), sin puente del recorte y con la participación usada. */
export function tableroConTienda(): TableroApi {
  const base = tablero();
  const parte2025 = [338, 304, 371, 608, 810, 877, 911, 742, 439, 600, 600, 900].map((t03, i) => t03 / ([1607, 1378, 1493, 1607, 1952, 1837, 2182, 1722, 1722, 1600, 1800, 3100][i] + [996, 853, 924, 995, 1209, 1138, 1351, 1067, 1067, 1083, 1219, 2098][i] + t03));
  const m2027 = [374, 334, 402, 615, 804, 845, 904, 731, 473, 679, 693, 1063];
  return {
    ...base,
    filtros: { texto: "HOMBRE · URBANO · tiendas: T03 · cifras de T03 estimadas", exactitud: "estimado", conjunto_tiendas: { etiqueta: "Mismas tiendas de 2027 (1)", codigos: ["T03"] } },
    puente: { ...base.puente, recorte: null },
    kpis: { ...base.kpis, siguiente: 7917, cierre: 7404, real_ac: 5000, proyectado_resto: 2404, anterior: 7500, hace_dos: 6500, hace_tres: 6000, exactitud: "estimado" },
    series: [serie("real-2025", "2025", 2025, "real", [338, 304, 371, 608, 810, 877, 911, 742, 439, 600, 600, 900]), serie("proyectado-2027", "2027 proyectado", 2027, "proyectado", m2027, false, "estimado")],
    tabla_mensual: {
      filas: [
        { ...fila("proyectado-2027", "2027", "proyectado", m2027), exactitud: "estimado" },
        fila("sin-atribuir-2027", "Sin atribuir 2027", "proyectado", [0, 0, 0, 0, 0, 0, 0, 0, 0, -12, 0, 0], -12),
      ],
      nota: NOTA_SIN_ATRIBUIR,
    },
    atribucion: { tiendas: [{ tienda_id: ID.t03, codigo: "T03", participacion_anual: 7404 / 47040, participacion_mes: parte2025 }], sin_atribuir: { en_curso: 0, siguiente: -12 }, mensual: true },
    apoyo: { ...base.apoyo, cobertura: { periodo: "2026-10", stock_tiendas: 2500, stock_cd: null, imi_proyectado: 2500 / (7906 / 12), imi_real: null, exactitud: "estimado" } },
  };
}

/** La 5.ª línea del servidor en trabajo (`tablero.ts`): la pantalla le suma lo que bloquearía el cierre, sin añadir una 6.ª. */
export const LINEA_EN_TRABAJO = "En trabajo: las cifras pueden cambiar; sin aprobación de dirección vigente.";

/** Una proyección en trabajo (lo que bloquearía el cierre aplica). */
export function tableroEnTrabajo(): TableroApi {
  const base = tablero();
  return { ...base, proyeccion: proyeccionEnTrabajo(), decidir: { ...base.decidir, lineas: [...LINEAS_DECIDIR.slice(0, 4), LINEA_EN_TRABAJO] } };
}

export function tableroArchivada(): TableroApi {
  const base = tablero();
  return { ...base, proyeccion: proyeccionSeguimiento(), comparada: null, decidir: { ...base.decidir, puede_aprobar: false } };
}

// ─── Lo que bloquearía el cierre ───
export function bloqueos(): Extract<BloqueosCierreApi, { aplica: true }> {
  return {
    aplica: true,
    puede_cerrar: false,
    puede_forzar: false,
    bloqueos: [
      { codigo: "crecimientos_cambiados", mensaje: "Los crecimientos aprobados cambiaron después de calcular: recalcúlala antes de cerrar.", forzable: false },
      { codigo: "filas_sin_decidir", mensaje: "Hay filas sin decidir: decide las que superan el umbral antes de cerrar.", detalle: { total_filas_sin_decidir: 37, total_filas_para_revision: 12 }, forzable: false },
      { codigo: "desactualizada", mensaje: "La proyección está desactualizada: recalcúlala o ciérrala igual con «Cerrar de todos modos».", detalle: { motivos: [{ codigo: "cargas_nuevas", mensaje: "Se publicó 2026-10 en M5." }] }, forzable: true },
    ],
    filas: [
      { anio: 2026, n: 0, u: 0, por_motivo: { umbral: 0, revision_cola_larga: 0 } },
      { anio: 2027, n: 37, u: 41200, por_motivo: { umbral: 25, revision_cola_larga: 12 } },
    ],
  };
}

export function bloqueosSoloDesactualizada(): Extract<BloqueosCierreApi, { aplica: true }> {
  const b = bloqueos();
  return { ...b, puede_forzar: true, bloqueos: b.bloqueos.filter((x) => x.forzable), filas: [] };
}

export const bloqueosNinguno = (): Extract<BloqueosCierreApi, { aplica: true }> => ({ aplica: true, puede_cerrar: true, puede_forzar: true, bloqueos: [], filas: [] });

// ─── Aprobaciones ───
export function resumenAprobacion(): ResumenAprobacionApi {
  return {
    huella: HUELLA,
    huella_version: 1,
    hasta_periodo: "2026-09",
    version_metodo: 6,
    totales: [
      { anio: 2026, total: 78501, por_bloque: { mismas: 74401, nuevas_anterior: 4100, aperturas: 0, cierres: 0 } },
      { anio: 2027, total: 84714, por_bloque: { mismas: 82306, nuevas_anterior: 0, aperturas: 1408, cierres: 1000 } },
    ],
    puente: puenteTotal(),
    por_gm: [
      { gm_clave: GM_HU, nombre: "HOMBRE · URBANO", en_curso: 50001, siguiente: 52708, declarado_pct: 5, implicito_pct: pct(50300, 47793) },
      { gm_clave: GM_MU, nombre: "MUJER · URBANO", en_curso: 28500, siguiente: 32006, declarado_pct: 8, implicito_pct: pct(32006, 28500) },
    ],
    alertas: [{ codigo: "contra_tendencia", nivel: "importante", cantidad: 1 }],
  };
}

export function aprobacion(extra: Partial<AprobacionApi> = {}): AprobacionApi {
  return {
    id: id(90),
    proyeccion_id: ID.proyeccion,
    estado_proyeccion: "cerrada",
    resultado: "aprobada",
    motivo: null,
    comentario: null,
    usuario_nombre: "Admin A.",
    rol: "admin",
    created_at: "2026-11-08T15:30:00Z",
    huella: HUELLA,
    invalidada: false,
    invalidada_por: null,
    resumen: resumenAprobacion(),
    ...extra,
  };
}

/** Historial de tres decisiones: la más reciente vigente y dos anteriores invalidadas (una por cifras, otra por la versión de la huella). */
export function historial(): AprobacionApi[] {
  return [
    aprobacion(),
    aprobacion({ id: id(91), resultado: "con_observaciones", motivo: "crecimiento_alto", comentario: "Revisar el crecimiento de MUJER · URBANO antes de comprar.", estado_proyeccion: "en_trabajo", created_at: "2026-11-05T14:00:00Z", invalidada: true, invalidada_por: "cifras" }),
    aprobacion({ id: id(92), resultado: "rechazada", motivo: "nino", comentario: "El factor de invierno sigue provisional.", estado_proyeccion: "en_trabajo", created_at: "2026-11-01T13:00:00Z", invalidada: true, invalidada_por: "version_huella" }),
  ];
}

// ─── Estado para los avisos de Proyección y de Flujo mensual ───
export function estadoDireccion(extra: Partial<EstadoDireccionApi> = {}): EstadoDireccionApi {
  return { proyeccion: proyeccion(), estado: "sin_aprobacion", vigente: null, ultima: null, diferencia: diferencia(), ...extra };
}

/** La advertencia (T3) de los comparativos que mezclan venta real de la marca con cifras estimadas por participación. */
export const ADVERTENCIA_MARCA = "Compara lo estimado por participación de la marca con su venta real.";

/**
 * El recorte con la unidad de marca MARCA X (T3): lo de enero a `k` es lo vendido guardado por la participación de la marca (`real_ac_exactitud =
 * "estimado"`), los comparativos que mezclan real y estimado traen `advertencia`, y la tabla mensual tiene filas reales exactas y proyectadas estimadas.
 */
export function tableroConMarca(): TableroApi {
  const base = tablero();
  const conAviso = new Set<ComparativoApi["clave"]>(["sig_vs_anterior", "cierre_vs_anterior", "cierre_vs_hace_dos"]);
  return {
    ...base,
    filtros: { texto: "HOMBRE · URBANO · marca: MARCA X · lo proyectado por marca es estimado", exactitud: "estimado", conjunto_tiendas: null },
    kpis: {
      ...base.kpis,
      siguiente: 9000,
      cierre: 8500,
      real_ac: 6000,
      real_ac_exactitud: "estimado",
      real_ac_k_prima: 6650,
      proyectado_resto: 2500,
      exactitud: "estimado",
      comparativos: base.kpis.comparativos.map((c) => ({ ...c, advertencia: conAviso.has(c.clave) ? ADVERTENCIA_MARCA : null })),
    },
    tabla_mensual: {
      filas: [
        fila("real_2025", "2025", "real", M2025),
        { ...fila("cierre_2026", "2026 cierre", "proyectado", M2026_CIERRE), exactitud: "estimado" },
        { ...fila("proyectado_2027", "2027", "proyectado", M2027), exactitud: "estimado" },
      ],
    },
  };
}

/** Desglose por marca con la fila «Sin participación por marca» (T3, `sin_marca`): con ella el total cuadra con las tarjetas. */
export function desgloseMarca(): TableroApi["desglose"] {
  const v = (sig: number, cierre: number) => ({ a2023: 0, a2024: 0, a2025: 0, acAnt: 0, acCur: 0, cierre, sig });
  return {
    dimension: "marca",
    filas: [
      filaDesglose("sin_marca", "Sin participación por marca", v(700, 650), 52708, { filtrable: false, exactitud: "estimado" }),
      filaDesglose(ID.marcaX, "MARCA X", v(30000, 28000), 52708, { exactitud: "estimado" }),
      filaDesglose(ID.marcaZ, "MARCA Z", v(22008, 21351), 52708, { exactitud: "estimado" }),
    ],
    total: filaDesglose("total", "Total", { a2023: 40000, a2024: 42000, a2025: 47000, acAnt: 36455, acCur: 38300, cierre: 50001, sig: 52708 }, 52708, { filtrable: false, exactitud: "estimado" }),
  };
}
