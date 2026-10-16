import type { AgrupacionCurvasApi, AnioAgrupacion, AvisoCurva, ComposicionAgrupacionApi, GmlAnioComposicionApi, GmlComposicionApi, VigenteResumenApi } from "../src/lib/curvas/tipos-api";

/** Datos sintéticos para las pruebas de la pantalla de curvas (M6). Nada de datos reales. */

export const PLANA: number[] = Array(12).fill(1 / 12);

/** Curva con el mes `mes` (1-12) en `peso` y el resto repartido en partes iguales. */
export function curvaConPico(mes: number, peso: number): number[] {
  const resto = (1 - peso) / 11;
  return Array.from({ length: 12 }, (_, i) => (i === mes - 1 ? peso : resto));
}

export function anio(anio: number, extra: Partial<AnioAgrupacion> = {}): AnioAgrupacion {
  const meses = Array.from({ length: 12 }, () => 100);
  return {
    anio,
    clase: "normal",
    meses_atipicos: 0,
    atipicos: [],
    tratamiento: null,
    tratamiento_motivo: null,
    unidades: 1200,
    meses,
    escaso: false,
    en_ajuste: true,
    meses_cargados: 12,
    tiendas_en_red: 8,
    peso_tienda_mayor: 0.31,
    participacion: [...PLANA],
    participacion_real: [...PLANA],
    imputados: [],
    peso_imputado: null,
    participacion_parcial: null,
    liquidacion: [],
    por_tienda: [],
    ...extra,
  };
}

export function vigente(extra: Partial<VigenteResumenApi> = {}): VigenteResumenApi {
  return {
    id: "v1",
    version: 2,
    modelo: "A",
    origen: "propia",
    origen_curva: "sistema",
    curva_manual: null,
    recomendada: true,
    recomendada_entonces: "A",
    eat: 29.1,
    aprobada_at: "2026-10-14T15:42:00Z",
    usuario_nombre: "Planner",
    foto_id: "f1",
    hasta_periodo: "2026-08",
    hasta_fue_por_defecto: true,
    nota: null,
    curva: [...PLANA],
    parametros: null,
    huella_calculo: null,
    version_modelo: 1,
    anios_ajuste: [2024, 2025],
    ruido_normal: 33,
    ...extra,
  };
}

export function agrupacion(extra: Partial<AgrupacionCurvasApi> = {}): AgrupacionCurvasApi {
  return {
    id: "a1",
    nombre: "ABRIGO SINTÉTICO",
    codigo: "ABRIGO",
    activo: true,
    temporada: "invierno",
    temporada_sugerida: null,
    generos: ["HOMBRE"],
    equivalencias_activas: 10,
    periodos_aplicables: 2,
    vigente: null,
    obsoleta: null,
    avisos_vigente: [],
    estado: "sin_curva",
    bloqueada_por: [],
    versiones: 0,
    ...extra,
  };
}

export const aviso = (codigo: AvisoCurva["codigo"], detalle = "detalle"): AvisoCurva => ({ codigo, detalle });

// ─── 06c: composición sintética (SINT_INV: tres GML, cuatro equivalencias; más «otros») ───

const S = [4, 4, 6, 8, 12, 14, 14, 12, 10, 7, 5, 4].map((x) => x / 100);

function anioGml(anio: number, unidades: number, peso: number, extra: Partial<GmlAnioComposicionApi> = {}): GmlAnioComposicionApi {
  return { anio, clase: anio === 2026 ? "en_curso" : "normal", en_ajuste: anio !== 2026, valido: anio !== 2026 && unidades >= 120, unidades, peso, participacion: S, eat_vs_resto: 2.9, distinta: false, ...extra };
}

export function gml(id: string, linea: string, extra: Partial<GmlComposicionApi> = {}): GmlComposicionApi {
  return {
    gml_id: id,
    genero: "HOMBRE",
    mundo: "URBANO",
    linea,
    nivel: "GML",
    vigente: true,
    principal: true,
    equivalencias: [
      {
        id: `${id}-e1`,
        nombre: `EQUIVALENCIA ${linea} 1`,
        codigo: `${linea.slice(0, 3)}001`,
        es_generica: false,
        activo: true,
        por_anio: [
          { anio: 2024, unidades: 600, peso: 0.3 },
          { anio: 2025, unidades: 660, peso: 0.3 },
        ],
      },
    ],
    por_anio: [anioGml(2024, 600, 0.3), anioGml(2025, 660, 0.3), anioGml(2026, 420, 0.3)],
    curva: S,
    anios_curva: [2024, 2025],
    ruido_propio: 4,
    umbral: 4,
    se_aparta: false,
    otras_agrupaciones: [],
    avisos: [],
    ...extra,
  };
}

export function composicion(extra: Partial<ComposicionAgrupacionApi> = {}): ComposicionAgrupacionApi {
  const apartado = gml("g3", "ABRIGO", {
    genero: "HOMBRE",
    mundo: "FORMAL",
    nivel: "GML",
    se_aparta: true,
    umbral: 3.5,
    por_anio: [anioGml(2024, 300, 0.136, { eat_vs_resto: 56, distinta: true }), anioGml(2025, 330, 0.136, { eat_vs_resto: 60, distinta: true }), anioGml(2026, 210, 0.136)],
    otras_agrupaciones: [{ agrupacion_id: "otra", nombre: "OTRA AGRUPACIÓN SINTÉTICA", unidades: 400, pct_de_su_venta: 0.2326 }],
    avisos: ["se_aparta", "en_otras_agrupaciones"],
  });
  const chico = gml("g9", "GORRO", {
    principal: false,
    curva: null,
    anios_curva: [],
    se_aparta: false,
    por_anio: [anioGml(2024, 10, 0.005, { valido: false, eat_vs_resto: null }), anioGml(2025, 12, 0.005, { valido: false, eat_vs_resto: null }), anioGml(2026, 8, 0.005, { valido: false })],
    avisos: ["pocas_unidades"],
  });
  return {
    huella_calculo: "0123456789abcdef0123456789abcdef",
    hasta_periodo: "2026-09",
    con_calculo: true,
    ruido_normal: 3.8,
    umbral_forma: 3,
    min_unidades: 120,
    anios: [
      { anio: 2024, clase: "normal", en_ajuste: true, unidades: 2000 },
      { anio: 2025, clase: "normal", en_ajuste: true, unidades: 2200 },
      { anio: 2026, clase: "en_curso", en_ajuste: false, unidades: 1400 },
    ],
    gml: [gml("g1", "CASACA"), gml("g2", "CHOMPA", { equivalencias: [] }), apartado, chico],
    principales: 3,
    otros: 1,
    pct_principales: 0.995,
    equivalencias_activas: 4,
    equivalencias_inactivas_con_venta: 0,
    equivalencias_sin_venta: [],
    duracion_ms: 420,
    ...extra,
  };
}
