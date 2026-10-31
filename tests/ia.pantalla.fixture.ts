import type {
  ConfiguracionIaApi,
  CorridaApi,
  EstimacionApi,
  EvaluacionApi,
  GMIaDetalleApi,
  GMIaResumenApi,
  IaFilaApi,
  MetaGMApi,
  MetricasNaturalApi,
  MetricasRepartoApi,
  PasoGMApi,
  ResultadosEvaluacionApi,
  ServicioIaApi,
} from "../src/lib/ia/tipos-api";
import type { EstadoIaProyeccionApi } from "../src/app/(app)/planificacion/proyeccion/propuesta-ia-vista";
import type { RespuestaConfiguracionApi, RespuestaUsoApi } from "../src/app/(app)/administracion/ia/ia-vista";

/**
 * Datos sintéticos de la pantalla de la propuesta con IA (docs/modulos/07e-propuesta-con-ia.md, §4.1 y §4.5). Las cifras son las del ejemplo A de la
 * ficha (HOMBRE · URBANO con +8 %: meta 26 006, fijas 3 386, libre 22 620, natural 22 000). Nada real: ningún nombre de marca, tienda ni empresa.
 */

export const Y = 2026;
export const CLAVE_HOMBRE_URBANO = "gen-hombre.mun-urbano";
export const CLAVE_MUJER_URBANO = "gen-mujer.mun-urbano";
export const CLAVE_MUJER_RESTO = "gen-mujer.mun-aire";
/** Un texto de la IA con intento de inyección: debe pintarse como texto. */
export const RAZON_HOSTIL = '<script>alert("x")</script> **negrita** [enlace](javascript:alert(1)) <img src=x onerror=alert(1)>';

export function servicio(extra: Partial<ServicioIaApi> = {}): ServicioIaApi {
  return {
    disponible: true,
    motivo: null,
    proveedor: "openai",
    modelos_permitidos: ["modelo-a", "modelo-b"],
    modelo: "modelo-a",
    version_prompt: "v1",
    capacidades: ["distribucion_y1"],
    gasto_mes_usd: 3.2,
    tope_usd_mes: 60,
    tope_usd_corrida: 10,
    gasto_dia_usuario_usd: 0.4,
    tope_usd_dia_usuario: 15,
    evaluacion: { id: "ev-1", fecha: "2026-11-02T15:00:00Z", veredicto: { distribucion_y1: "gana" } },
    ...extra,
  };
}

export function servicioApagado(motivo: NonNullable<ServicioIaApi["motivo"]>, extra: Partial<ServicioIaApi> = {}): ServicioIaApi {
  return servicio({ disponible: false, motivo, capacidades: [], ...extra });
}

export function meta(extra: Partial<MetaGMApi> = {}): MetaGMApi {
  return {
    pct: 8,
    sobre_base: "corregida",
    fuente: "gm",
    crecimiento_id: "crec-1",
    version: 2,
    meta_gm: 26006,
    fijas: 3386,
    fijas_detalle: { decididas: 3300, pct_propio: 0, cola_larga: 86 },
    meta_libre: 22620,
    filas_libres: 3,
    filas_fijas: 2,
    fuera_base: { filas: 0, unidades: 0 },
    ...extra,
  };
}

export function propuestaResumen(extra: Partial<NonNullable<GMIaResumenApi["propuesta"]>> = {}): NonNullable<GMIaResumenApi["propuesta"]> {
  return {
    id: "prop-1",
    created_at: "2026-10-30T15:15:00Z",
    usuario_nombre: "Ana Planner",
    proveedor: "openai",
    modelo: "modelo-a",
    version_prompt: "v1",
    razon_gm: "El GM crece parejo; la meta pide más a DENIM que a POLO.",
    costo_usd: 0.12,
    ...extra,
  };
}

export function gmResumen(extra: Partial<GMIaResumenApi> = {}): GMIaResumenApi {
  return {
    gm_clave: CLAVE_HOMBRE_URBANO,
    genero: "HOMBRE",
    mundo: "URBANO",
    es_resto: false,
    meta: meta(),
    estado: "al_dia",
    motivos: [],
    configuracion_cambiada: false,
    natural_libres: 22000,
    meta_libre: 22620,
    esfuerzo_pct: 2.8,
    filas_forzadas: 1,
    filas_que_ceden: 1,
    absorcion: { delta_meta_u: 0, desviacion_fijadas_u: 0, otros_u: 0, absorbido_u: 0, absorbido_pct: 0 },
    filas_y_sin_decidir: 2,
    propuesta: propuestaResumen(),
    ...extra,
  };
}

export function gmMujerUrbano(extra: Partial<GMIaResumenApi> = {}): GMIaResumenApi {
  return gmResumen({
    gm_clave: CLAVE_MUJER_URBANO,
    genero: "MUJER",
    mundo: "URBANO",
    meta: meta({ meta_gm: 41200, fijas: 2000, fijas_detalle: { decididas: 2000, pct_propio: 0, cola_larga: 0 }, meta_libre: 39200, filas_libres: 5, filas_fijas: 1 }),
    natural_libres: 31400,
    meta_libre: 39200,
    esfuerzo_pct: 24.8,
    estado: "meta_movida",
    absorcion: { delta_meta_u: 0, desviacion_fijadas_u: 1039, otros_u: 0, absorbido_u: -1039, absorbido_pct: -8.9 },
    ...extra,
  });
}

export function gmResto(extra: Partial<GMIaResumenApi> = {}): GMIaResumenApi {
  return gmResumen({
    gm_clave: CLAVE_MUJER_RESTO,
    genero: "MUJER",
    mundo: "AIRE LIBRE",
    es_resto: true,
    meta: meta({ pct: 5, fuente: "resto_provisional", meta_gm: 5100, fijas: 0, fijas_detalle: { decididas: 0, pct_propio: 0, cola_larga: 0 }, meta_libre: 5100, filas_libres: 2, filas_fijas: 0 }),
    natural_libres: 5400,
    meta_libre: 5100,
    esfuerzo_pct: -5.6,
    estado: "sin_propuesta",
    propuesta: null,
    absorcion: null,
    filas_forzadas: 0,
    filas_que_ceden: 0,
    ...extra,
  });
}

export function estimacion(extra: Partial<EstimacionApi> = {}): EstimacionApi {
  return { gms: 2, llamadas: 5, filas: 40, tokens_entrada: 120000, tokens_salida: 8000, costo_usd: 3.6, tope_usd: 10, reusables: 1, ...extra };
}

export function corrida(extra: Partial<CorridaApi> = {}): CorridaApi {
  return {
    id: "corr-1",
    estado: "en_curso",
    gm_total: 3,
    gm_hechos: 1,
    gm_reusados: 0,
    gm_fallidos: 0,
    costo_usd: 0.4,
    costo_estimado_usd: 3.6,
    proveedor: "openai",
    modelo: "modelo-a",
    version_prompt: "v1",
    usuario_nombre: "Ana Planner",
    iniciada_at: "2026-10-31T14:00:00Z",
    terminada_at: null,
    motivo_fin: null,
    ...extra,
  };
}

export function paso(extra: Partial<PasoGMApi> = {}): PasoGMApi {
  return { gm_clave: CLAVE_HOMBRE_URBANO, pliegue: null, estado: "en_proceso", pasos_hechos: 1, pasos_total: 2, siguiente: "continuar", esperar_ms: null, corrida: corrida(), ...extra };
}

export function estadoIa(extra: Partial<EstadoIaProyeccionApi> = {}): EstadoIaProyeccionApi {
  return {
    servicio: servicio(),
    prerrequisitos: { bloquea: [], avisa: [] },
    corrida_en_curso: null,
    gms: [gmResto(), gmMujerUrbano(), gmResumen()],
    estimacion_pendientes: estimacion(),
    ...extra,
  };
}

// ─── Detalle de un GM ───

export function iaFila(extra: Partial<IaFilaApi> = {}): IaFilaApi {
  return {
    fila_id: "fila-1",
    propuesta_fila_id: "pf-1",
    estado_meta: "libre",
    estado_gm: "al_dia",
    motivos: [],
    natural_y1: 10300,
    razon_natural: "Crece con la tendencia de los dos últimos años.",
    meta_y1: 10961,
    meta_y1_al_generar: 10961,
    absorbido_u: 0,
    absorbido_pct: 0,
    brecha_u: 661,
    brecha_pct: 6.4,
    contra_metodo_u: 161,
    pct_sobre_corregida: 9.6,
    pct_sobre_real: 9.6,
    razon: "La línea sostiene volumen y la meta le pide un poco más.",
    banderas: ["meta_exigente"],
    senales: ["tiendas_entrantes"],
    confianza: "media",
    avisos: [],
    aceptable: { y1: true, motivo: null },
    ...extra,
  };
}

type FilaDetalle = GMIaDetalleApi["filas"][number];

export function filaDetalle(extra: Partial<FilaDetalle> = {}): FilaDetalle {
  return {
    ...iaFila(),
    linea: "DENIM",
    equivalencia: null,
    agrupacion_marca: "MARCA_A",
    base: 10000,
    base_corregida: 10000,
    aporte_entrantes: 2200,
    aporte_salientes: 0,
    metodo_y1: 10800,
    vigente_y1: 10800,
    decidida_y1: false,
    vigente_y: 9600,
    decidida_y: false,
    ...extra,
  };
}

export function filasDetalle(): FilaDetalle[] {
  return [
    filaDetalle({ fila_id: "fila-polo", propuesta_fila_id: "pf-polo", linea: "POLO", contra_metodo_u: -80, meta_y1: 6400, natural_y1: 6900, brecha_u: -500, brecha_pct: -7.2, metodo_y1: 6480, vigente_y1: 6480, banderas: [], senales: [], aporte_entrantes: null }),
    filaDetalle({ fila_id: "fila-denim", contra_metodo_u: 900, meta_y1: 11700, natural_y1: 9000, brecha_u: 2700, brecha_pct: 30, absorbido_u: -309, absorbido_pct: -2.6, avisos: ["absorcion_alta"] }),
    filaDetalle({ fila_id: "fila-camisa", propuesta_fila_id: "pf-camisa", linea: "CAMISA", contra_metodo_u: -1300, meta_y1: 4100, natural_y1: 5200, brecha_u: -1100, brecha_pct: -21.2, metodo_y1: 5400, vigente_y1: 5400, razon: RAZON_HOSTIL, razon_natural: RAZON_HOSTIL, avisos: ["brecha_extrema"] }),
    filaDetalle({
      fila_id: "fila-fija",
      propuesta_fila_id: "pf-fija",
      linea: "POLO",
      agrupacion_marca: "MARCA_B",
      estado_meta: "fija_decidida",
      meta_y1: null,
      natural_y1: null,
      razon: null,
      razon_natural: null,
      brecha_u: null,
      brecha_pct: null,
      contra_metodo_u: 60,
      absorbido_u: null,
      absorbido_pct: null,
      metodo_y1: 3240,
      vigente_y1: 3300,
      decidida_y1: true,
      confianza: null,
      banderas: [],
      senales: [],
      aporte_entrantes: null,
    }),
  ];
}

export function gmDetalle(extra: Partial<GMIaDetalleApi> = {}): GMIaDetalleApi {
  return {
    ...gmResumen({ absorcion: { delta_meta_u: 0, desviacion_fijadas_u: 1039, otros_u: 0, absorbido_u: -1039, absorbido_pct: -8.9 }, estado: "meta_movida" }),
    filas: filasDetalle(),
    contexto: { aperturas_y1: 1240, cierres_y1: 0, cola_larga: { filas: 12, unidades: 300 }, vista_previa_curvas: 25870 },
    anteriores: [{ id: "prop-0", created_at: "2026-10-29T15:00:00Z", proveedor: "openai", modelo: "modelo-a", version_prompt: "v1" }],
    ...extra,
  };
}

// ─── Administración ───

export function configuracion(extra: Partial<ConfiguracionIaApi> = {}): ConfiguracionIaApi {
  return {
    id: "cfg-2",
    version: 2,
    estado: "vigente",
    proveedor: "openai",
    modelo: "modelo-a",
    version_prompt: "v1",
    capacidades: ["distribucion_y1"],
    evaluacion_id: "ev-1",
    tope_usd_corrida: 10,
    tope_usd_mes: 60,
    tope_usd_dia_usuario: 15,
    max_filas_llamada: 60,
    incluir_cola_larga: false,
    presupuesto_razonamiento: 0,
    precios: { entrada: 1.5, entrada_cache: 0.75, salida: 6 },
    terminos_extra: ["EMPRESA X"],
    nota: "Primera versión con la evaluación ganadora.",
    usuario_nombre: "Admin Uno",
    aprobada_at: "2026-11-03T14:00:00Z",
    ...extra,
  };
}

export function respuestaConfiguracion(extra: Partial<RespuestaConfiguracionApi> = {}): RespuestaConfiguracionApi {
  const vigente = configuracion();
  return { vigente, versiones: [vigente, configuracion({ id: "cfg-1", version: 1, estado: "reemplazada", capacidades: [], evaluacion_id: null, nota: null })], servicio: servicio(), prompts: ["v1"], ...extra };
}

const repartoD25: MetricasRepartoApi = {
  filas: 640,
  gms: 29,
  wape_metodo: 0.131,
  wape_tendencia: 0.124,
  wape_ia: 0.109,
  rival: "tendencia",
  wape_rival: 0.124,
  mejora: 0.121,
  eat_metodo_pp: 6.5,
  eat_ia_pp: 5.4,
};
const naturalD25: MetricasNaturalApi = { filas: 640, wape_metodo: 0.18, wape_tendencia: 0.16, wape_ia: 0.14, rival: "tendencia", wape_rival: 0.16 };

export function resultados(extra: Partial<ResultadosEvaluacionApi> = {}): ResultadosEvaluacionApi {
  return {
    d25: {
      reparto: repartoD25,
      natural: naturalD25,
      por_genero: { HOMBRE: { ...repartoD25, filas: 240 }, MUJER: { ...repartoD25, filas: 330 }, RESTO: { ...repartoD25, filas: 70 } },
      gms_ganados: 21,
      gms_evaluados: 29,
      bootstrap: { remuestreos: 1000, semilla: 20261030, p5: 0.004, p95: 0.031, media: 0.017 },
    },
    d24: { reparto: { ...repartoD25, filas: 410, wape_tendencia: null, rival: "metodo", wape_rival: 0.131, mejora: 0.168 }, natural: { ...naturalD25, filas: 410, wape_tendencia: null, rival: "metodo", wape_rival: 0.18 } },
    estabilidad: 0.021,
    cobertura: 0.995,
    ...extra,
  };
}

export function evaluacion(extra: Partial<EvaluacionApi> = {}): EvaluacionApi {
  return {
    id: "ev-1",
    intento: 1,
    proveedor: "openai",
    modelo: "modelo-a",
    version_prompt: "v1",
    estado: "completa",
    parametros: {},
    resultados: resultados(),
    veredicto: { distribucion_y1: "gana", regla_que_fallo: null },
    tope_usd: 50,
    costo_usd: 14.2,
    usuario_nombre: "Admin Uno",
    iniciada_at: "2026-11-02T13:00:00Z",
    terminada_at: "2026-11-02T13:47:00Z",
    ...extra,
  };
}

export function evaluacionNoGana(extra: Partial<EvaluacionApi> = {}): EvaluacionApi {
  return evaluacion({ id: "ev-2", intento: 2, modelo: "modelo-b", veredicto: { distribucion_y1: "no_gana", regla_que_fallo: "bootstrap" }, iniciada_at: "2026-11-03T13:00:00Z", ...extra });
}

export function uso(extra: Partial<RespuestaUsoApi> = {}): RespuestaUsoApi {
  return {
    mes: "2026-11",
    costo_usd: 17.8,
    tope_usd_mes: 60,
    corridas: [corrida({ id: "corr-9", estado: "completa", gm_total: 3, gm_hechos: 2, gm_reusados: 1, costo_usd: 3.12 })],
    por_dia: [
      { dia: "2026-11-02", costo_usd: 14.2, llamadas: 410 },
      { dia: "2026-11-03", costo_usd: 3.6, llamadas: 96 },
    ],
    ...extra,
  };
}
