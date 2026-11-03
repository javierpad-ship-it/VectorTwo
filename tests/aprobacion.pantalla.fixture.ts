import type {
  AprobacionApi,
  EfectoGMApi,
  FilaAprobacionApi,
  FilaLoteApi,
  GMAprobacionApi,
  LoteApi,
  ResultadoFilaLoteApi,
  ResultadoLoteApi,
} from "../src/lib/aprobacion/tipos-api";

/**
 * Datos sintéticos de la pestaña «Aprobación» (ficha 07g, §4). Géneros, mundos, líneas y cifras inventados (las del ejemplo A de 07e): ningún dato real
 * de Lukers. Los ids de GM siguen la forma `<genero_id>.<mundo_id>` que usa la pantalla.
 */

export const Y = 2026;
export const Y1 = 2027;
export const PROYECCION_ID = "00000000-0000-4000-8000-0000000000aa";
export const uuid = (n: string | number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const GM_HU = "gen-hombre.mun-urbano";
export const GM_NI = "gen-nina.mun-casual";

export function gm(o: Partial<GMAprobacionApi> = {}): GMAprobacionApi {
  return {
    gm_clave: GM_HU,
    genero: "HOMBRE",
    mundo: "URBANO",
    es_resto: false,
    meta: 26006,
    fuente_meta: "gm",
    base_total: 24080,
    vigente_total: 26066,
    crecimiento_implicito_pct: 8.2,
    desvio_u: 60,
    desvio_pct: 0.23,
    libres: 3,
    pendientes: 3,
    estado_ia: "al_dia",
    propuesta_gm_id: uuid("c001"),
    ...o,
  };
}

export function fila(n: number, o: Partial<FilaAprobacionApi> = {}): FilaAprobacionApi {
  return {
    fila_id: uuid(`f${n}`),
    anio: Y1,
    gm_clave: GM_HU,
    genero: "HOMBRE",
    mundo: "URBANO",
    es_resto: false,
    linea: "POLO",
    linea_id: "lin-polo",
    equivalencia: null,
    agrupacion_marca: "MARCA PROPIA",
    agrupacion_marca_id: "mar-propia",
    motivo_cierre: "umbral",
    vendido: 9800,
    base: 10000,
    base_corregida: 10000,
    metodo: { valor: 10800, pct_propio: null, avisos: [] },
    ia: {
      propuesta_fila_id: uuid(`e${n}`),
      valor: 10961,
      natural: 11000,
      brecha_u: -39,
      brecha_pct: -0.4,
      contra_metodo_u: 161,
      absorbido_pct: 1.2,
      confianza: "alta",
      avisos: [],
      razon: "Línea estable.",
      aceptable: true,
      motivo: null,
    },
    decidido: null,
    fuente_sugerida: "ia",
    badge: "ia",
    excluida: null,
    motivo_exclusion: null,
    avisos_fuertes: false,
    ...o,
  };
}

/** Una fila de 2027 en un GM sin IA: método, con su propio badge. */
export function filaSinIa(n: number, o: Partial<FilaAprobacionApi> = {}): FilaAprobacionApi {
  return fila(n, {
    gm_clave: GM_NI,
    genero: "NIÑA",
    mundo: "CASUAL",
    linea: "VESTIDO",
    linea_id: "lin-vestido",
    ia: null,
    metodo: { valor: 841, pct_propio: null, avisos: [] },
    fuente_sugerida: "metodo",
    badge: "metodo_gm_sin_ia",
    ...o,
  });
}

/** Una fila de 2026: el método, sin IA. */
export function fila2026(n: number, o: Partial<FilaAprobacionApi> = {}): FilaAprobacionApi {
  return fila(n, { anio: Y, ia: null, metodo: { valor: 10000, pct_propio: null, avisos: [] }, fuente_sugerida: "metodo", badge: "metodo", ...o });
}

export const filaConfianzaBaja = (n: number): FilaAprobacionApi =>
  fila(n, {
    ia: { ...(fila(n).ia as NonNullable<FilaAprobacionApi["ia"]>), confianza: "baja" },
    fuente_sugerida: null,
    badge: null,
    excluida: "confianza_baja",
    motivo_exclusion: "Confianza baja o sin dato: se decide en Por línea.",
  });

export const filaSinCifraIa = (n: number): FilaAprobacionApi =>
  fila(n, {
    ia: { ...(fila(n).ia as NonNullable<FilaAprobacionApi["ia"]>), valor: null, natural: null, brecha_u: null, brecha_pct: null, confianza: null },
    fuente_sugerida: null,
    badge: null,
    excluida: "sin_cifra_ia",
    motivo_exclusion: "Libre sin cifra de la IA: decídela en Por línea o regenera el GM.",
  });

export function datos(o: Partial<AprobacionApi> = {}): AprobacionApi {
  return {
    anio: Y1,
    anio_en_curso: Y,
    modo: "aprobar",
    calculado_at: "2026-11-03T10:00:00.000Z",
    editable: true,
    bloqueos: [],
    ia: { disponible: true, motivo: null, corrida_en_curso: false, gms_con_propuesta: 1 },
    filas: [fila(1), fila(2, { ia: { ...(fila(2).ia as NonNullable<FilaAprobacionApi["ia"]>), valor: 6677, natural: 6700, confianza: "media" }, metodo: { valor: 6480, pct_propio: null, avisos: [] } }), filaConfianzaBaja(3), filaSinIa(9)],
    gms: [gm(), gm({ gm_clave: GM_NI, genero: "NIÑA", mundo: "CASUAL", meta: null, fuente_meta: null, base_total: null, vigente_total: 841, crecimiento_implicito_pct: null, desvio_u: null, desvio_pct: null, libres: 1, pendientes: 1, estado_ia: null, propuesta_gm_id: null })],
    pendientes_cierre: { filas_y: 679, filas_y1: 686, para_revision: 290, tiendas: 3 },
    reaprobables: { y: 0, y1: 0 },
    umbral_cola_larga: 100,
    ...o,
  };
}

// ─── Resultados de lote ───

export function resultadoFila(n: number, o: Partial<ResultadoFilaLoteApi> = {}): ResultadoFilaLoteApi {
  return { fila_id: uuid(`f${n}`), anio: Y1, gm_clave: GM_HU, fuente: "ia", resultado: "aplicada", codigo: null, valor: 10961, valor_actual: null, brecha_u: -39, ...o };
}

export function efecto(o: Partial<EfectoGMApi> = {}): EfectoGMApi {
  return {
    gm_clave: GM_HU,
    total_antes: 26066,
    total_despues: 26006,
    crecimiento_implicito_antes_pct: 8.2,
    crecimiento_implicito_despues_pct: 8.0,
    meta_antes: 26006,
    meta_despues: 26006,
    desvio_antes_u: 60,
    desvio_despues_u: 0,
    libres_antes: 3,
    libres_despues: 0,
    ...o,
  };
}

export function resultado(filas: ResultadoFilaLoteApi[], o: Partial<ResultadoLoteApi> = {}): ResultadoLoteApi {
  const aplicadas = filas.filter((f) => f.resultado === "aplicada");
  const porFuente = (k: "ia" | "metodo") => {
    const fs = aplicadas.filter((f) => f.fuente === k);
    return { filas: fs.length, unidades: fs.reduce((s, f) => s + (f.valor ?? 0), 0) };
  };
  return {
    lote: null,
    simulado: true,
    repetido: false,
    huella_simulacion: "a".repeat(64),
    filas,
    totales: { pedidas: filas.length, aplicadas: aplicadas.length, rechazadas: filas.length - aplicadas.length, unidades: aplicadas.reduce((s, f) => s + (f.valor ?? 0), 0), por_fuente: { ia: porFuente("ia"), metodo: porFuente("metodo") } },
    efecto_gm: [efecto()],
    mayores_unidades: [],
    mayores_brechas: [],
    crecimientos_a_reaprobar: [],
    revision_requerida: false,
    pendientes_cierre: { filas_y: 679, filas_y1: 683, para_revision: 290, tiendas: 3 },
    ...o,
  };
}

export function lote(n: number, o: Partial<LoteApi> = {}): LoteApi {
  return {
    id: uuid(`1${n}`),
    confirmacion_id: uuid(`2${n}`),
    proyeccion_id: PROYECCION_ID,
    tipo: "aprobar",
    revierte_lote_id: null,
    anio: Y1,
    created_at: "2026-11-03T15:00:00.000Z",
    usuario_nombre: "Ana Planner",
    perfil_id: uuid("p1"),
    filtro: {},
    nota: null,
    revision_confirmada: false,
    resumen: { pedidas: 3, aplicadas: 2, rechazadas: { ya_decidida: 1 }, por_fuente: { ia: { filas: 2, unidades: 17638 } } },
    efecto_gm_previsto: [],
    propuestas_gm: [uuid("c001")],
    filas_revertidas: 0,
    estado: "vigente",
    ...o,
  };
}

export function filaLote(n: number, o: Partial<FilaLoteApi> = {}): FilaLoteApi {
  return { id: uuid(`b${n}`), fila_id: uuid(`f${n}`), fila_clave: `POLO · MARCA PROPIA ${n}`, gm_clave: GM_HU, anio: Y1, fuente: "ia", resultado: "aplicada", valor: 10961, valor_esperado: 10961, valor_actual: null, decidido_anterior: null, propuesta_fila_id: uuid(`e${n}`), ...o };
}
