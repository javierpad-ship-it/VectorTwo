import type { AgrupacionCurvasApi, AnioAgrupacion, AvisoCurva, VigenteResumenApi } from "../src/lib/curvas/tipos-api";

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
