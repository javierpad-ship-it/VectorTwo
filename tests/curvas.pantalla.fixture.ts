import type { AgrupacionCurvasApi, AnioAgrupacion, AvisoCurva, PropuestaApi, VigenteResumenApi } from "../src/lib/curvas/tipos-api";

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
    recomendada: true,
    eat: 29.1,
    aprobada_at: "2026-10-14T15:42:00Z",
    usuario_nombre: "Planner",
    corrida_id: "c1",
    curva: [...PLANA],
    ...extra,
  };
}

export function propuesta(extra: Partial<PropuestaApi> = {}): PropuestaApi {
  return {
    corrida_id: "c1",
    recomendada: "A",
    motivo_recomendacion: "sin_evidencia",
    origen: "propia",
    eat: 29.1,
    curva: [...PLANA],
    estabilidad: 0.7,
    nivel_estabilidad: "media",
    difiere_de_vigente: false,
    eat_vs_vigente: null,
    veredicto_forma: null,
    anios: [],
    nino: { volumen: [], forma: null },
    avisos: [],
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
    con_venta: true,
    vigente: null,
    obsoleta: null,
    propuesta: null,
    ...extra,
  };
}

export const aviso = (codigo: AvisoCurva["codigo"], detalle = "detalle"): AvisoCurva => ({ codigo, detalle });
