import type {
  BandaNinoApi,
  CierreAgrupacionApi,
  CierreGMApi,
  DetalleGeneroMundoApi,
  DiagnosticoVeranoGMApi,
  FactorYApi,
  FilaGMApi,
  ListaGeneroMundoApi,
  ReaprobarApi,
  ReferenciaApi,
  SerieAnioGMApi,
  VersionCrecimientoApi,
} from "../src/lib/crecimientos/tipos-api";

/**
 * Datos sintéticos de la pantalla «Crecimiento por género × mundo» (06d y 06e). Nada de datos reales: el ejemplo es el A de la ficha 06e
 * (HOMBRE · URBANO, `Y = 2026`, `k = setiembre`, `C(2026)` = 9 tiendas, `M(2027)` = las 9 + T10; invierno 2026 Niño con factor relativo
 * 0,80 = 0,76 ÷ 0,95; 2025 = 54 000 u; cierre real 55 000 y corregido 58 750; base 2027 real 56 100 y corregida 59 925), el D (reaprobar) y el G
 * (cómo crece el verano atípicamente).
 */

export const GENERO_HOMBRE = "11111111-1111-4111-8111-111111111111";
export const GENERO_MUJER = "22222222-2222-4222-8222-222222222222";
export const GENERO_NINO = "33333333-3333-4333-8333-333333333333";
export const MUNDO_URBANO = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const MUNDO_RI = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const MUNDO_DEPORTIVO = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
export const PROYECCION_ID = "99999999-9999-4999-8999-999999999999";

export const CLAVE_HOMBRE_URBANO = `${GENERO_HOMBRE}.${MUNDO_URBANO}`;
export const CLAVE_MUJER_RI = `${GENERO_MUJER}.${MUNDO_RI}`;
export const CLAVE_HOMBRE_DEPORTIVO = `${GENERO_HOMBRE}.${MUNDO_DEPORTIVO}`;
export const CLAVE_NINO_URBANO = `${GENERO_NINO}.${MUNDO_URBANO}`;

/** Forma de invierno: más venta de mayo a agosto (suma 1 150). */
const FORMA_INVIERNO = [60, 60, 70, 90, 130, 150, 160, 140, 100, 70, 60, 60];
const SUMA_FORMA = FORMA_INVIERNO.reduce((a, b) => a + b, 0);

/** Reparte un total anual con la forma de invierno (redondeado a unidades). */
export function mesesDeTotal(total: number): number[] {
  return FORMA_INVIERNO.map((v) => Math.round((v / SUMA_FORMA) * total));
}

/** Un año de la curva: el total se reparte con la forma de invierno; `reales` meses reales y el resto con el cierre por curva (`proyectado`). */
export function serieAnio(anio: number, total: number, o: { reales?: number; totalSinNino?: number } = {}): SerieAnioGMApi {
  const reales = o.reales ?? 12;
  const meses = mesesDeTotal(total);
  const sinNino = mesesDeTotal(o.totalSinNino ?? total);
  const suma = meses.reduce((a, b) => a + b, 0);
  return {
    anio,
    meses,
    meses_sin_nino: sinNino,
    origen: meses.map((_, i) => (i < reales ? "real" : "proyectado")),
    incompleto: reales < 12,
    total: suma,
    total_sin_nino: sinNino.reduce((a, b) => a + b, 0),
    forma: meses.map((v) => Math.round((v / suma) * 1000) / 10),
  };
}

export function referencia(extra: Partial<ReferenciaApi> = {}): ReferenciaApi {
  return {
    tipo: "acumulado",
    anio: 2026,
    variante_defecto: "corregido",
    etiqueta: "Acumulado ene–set 2026",
    periodo: "ene–set 2026 frente a ene–set 2025",
    tiendas: 9,
    anterior: 40000,
    actual: 41200,
    pct_bruto: 3.0,
    pct_sin_nino: 10.5,
    equivalente: { corregido: 10.5, bruto: 3.0, sin_nino_mas_rebote: null },
    fragil: false,
    extremo: false,
    tienda_mayor: { codigo: "T07", aporte_pct: 38.5, pct_sin_ella: 1.2 },
    cobertura_pct: 74,
    motivo_nulo: null,
    ...extra,
  };
}

/** Cierre por curva del ejemplo A: 54 000 → 55 000 (+1,85 %) real y 58 750 (+8,80 %) corregido. */
export function referenciaCierreCurva(extra: Partial<ReferenciaApi> = {}): ReferenciaApi {
  return referencia({
    tipo: "cierre_curva",
    etiqueta: "Cierre 2026 por curva",
    periodo: "año 2026 (real + cierre por curva) frente a 2025",
    anterior: 54000,
    actual: 55000,
    pct_bruto: 1.85,
    pct_sin_nino: 8.8,
    equivalente: { corregido: 8.8, bruto: 1.85, sin_nino_mas_rebote: null },
    tienda_mayor: null,
    cobertura_pct: null,
    ...extra,
  });
}

/** Las referencias del ejemplo A, en el orden de la API (no el de la pantalla). */
export function referenciasEjemplo(): ReferenciaApi[] {
  return [
    referencia(),
    referenciaCierreCurva(),
    referencia({
      tipo: "anio_completo",
      anio: 2024,
      etiqueta: "Año completo 2024",
      periodo: "2024 frente a 2023",
      tiendas: 8,
      anterior: 47000,
      actual: 49000,
      pct_bruto: 4.3,
      pct_sin_nino: 4.3,
      equivalente: { corregido: 4.3, bruto: 4.3, sin_nino_mas_rebote: null },
      tienda_mayor: null,
      cobertura_pct: null,
    }),
    referencia({
      tipo: "anio_completo",
      anio: 2025,
      etiqueta: "Año completo 2025",
      periodo: "2025 frente a 2024",
      tiendas: 8,
      anterior: 50000,
      actual: 52500,
      pct_bruto: 5.0,
      pct_sin_nino: 5.0,
      equivalente: { corregido: 5.0, bruto: 5.0, sin_nino_mas_rebote: null },
      tienda_mayor: null,
      cobertura_pct: null,
    }),
    referencia({
      tipo: "aplicado_hoy",
      etiqueta: "Aplicado hoy en la proyección",
      periodo: "crecimiento que usa la proyección de referencia",
      anterior: 56100,
      actual: 64719,
      pct_bruto: 15.36,
      pct_sin_nino: 8.0,
      equivalente: { corregido: 8.0, bruto: 15.36, sin_nino_mas_rebote: null },
      tienda_mayor: null,
      cobertura_pct: null,
    }),
  ];
}

/** Referencia que depende de la proyección, sin proyección de método 5: sin cifras. */
export function referenciaMetodoAnterior(tipo: "aplicado_hoy" = "aplicado_hoy"): ReferenciaApi {
  return referencia({
    tipo,
    etiqueta: "Aplicado hoy en la proyección",
    periodo: "proyección de referencia",
    tiendas: 0,
    anterior: null,
    actual: null,
    pct_bruto: null,
    pct_sin_nino: null,
    equivalente: { corregido: null, bruto: null, sin_nino_mas_rebote: null },
    tienda_mayor: null,
    cobertura_pct: null,
    motivo_nulo: "metodo_anterior",
  });
}

/** v2 aprobada con 0.14.0: 8 % sobre 2026 corregido (= 15,36 % sobre real), base «Cierre por curva · corregido». */
export function version(extra: Partial<VersionCrecimientoApi> = {}): VersionCrecimientoApi {
  return {
    id: "v-1",
    version: 2,
    estado: "vigente",
    pct: 8,
    nota: "prudente: el rebote del invierno no será completo",
    base: { tipo: "cierre_curva", anio: null, variante: "corregido", valor: 8.8 },
    sobre_base: "corregida",
    equivalente_real: 15.36,
    por_nombre: "Javier",
    aprobada_at: "2026-10-20T15:30:00.000Z",
    proyeccion_referencia: { id: PROYECCION_ID, nombre: "Proyección 2026" },
    ...extra,
  };
}

/** v1 de antes de 0.14.0 (ejemplo D): 15 % sobre 2026 real, base heredada; sin `sobre_base` como la mandaría una versión vieja. */
export function versionBruta(extra: Partial<VersionCrecimientoApi> = {}): VersionCrecimientoApi {
  return version({
    id: "v-bruta",
    version: 1,
    pct: 15,
    nota: null,
    base: { tipo: "acumulado", anio: null, variante: "sin_nino_mas_rebote", valor: 18.4 },
    sobre_base: "bruta",
    equivalente_real: undefined,
    ...extra,
  });
}

export function cierreEjemploA(extra: Partial<CierreGMApi> = {}): CierreGMApi {
  return {
    k: 9,
    tiendas: 9,
    vendido: 41200,
    vendido_corregido: 44200,
    cierre: 55000,
    cierre_corregido: 58750,
    anterior: 54000,
    anterior_corregido: 54000,
    pct: 1.85,
    pct_corregido: 8.8,
    base_curva: { tiendas: 10, tiendas_fuera_cy: ["T10"], real: 56100, corregida: 59925 },
    avance: 0.7523,
    avance_bajo: false,
    agrupaciones_avance_bajo: [],
    sin_curva_pct: null,
    hay_nino: true,
    correccion_curva_pct: 6.82,
    factor_parcial: true,
    sin_factor: false,
    motivo_nulo: null,
    ...extra,
  };
}

export function agrupacionesEjemploA(): CierreAgrupacionApi[] {
  return [
    {
      agrupacion_id: "agr-abrigos",
      nombre: "ABRIGOS HO",
      temporada: "invierno",
      curva: { id: "c-abrigos", version: 3 },
      avance: 0.8,
      avance_bajo: false,
      vendido: 12000,
      factor_meses: Array.from({ length: 12 }, () => 0.8),
      vendido_corregido: 15000,
      cierre: 15000,
      cierre_corregido: 18750,
      base_curva: 15300,
      base_curva_corregida: 19125,
      meses: mesesDeTotal(15000),
      meses_corregidos: mesesDeTotal(18750),
    },
    {
      agrupacion_id: "agr-polos",
      nombre: "POLOS HO",
      temporada: "todo_el_ano",
      curva: { id: "c-polos", version: 2 },
      avance: 0.73,
      avance_bajo: false,
      vendido: 29200,
      factor_meses: Array.from({ length: 12 }, () => 1),
      vendido_corregido: 29200,
      cierre: 40000,
      cierre_corregido: 40000,
      base_curva: 40800,
      base_curva_corregida: 40800,
      meses: mesesDeTotal(40000),
      meses_corregidos: mesesDeTotal(40000),
    },
  ];
}

/** Diagnóstico de invierno 2026: periodo ene–dic, 9 meses con dato; sin meses fuera del periodo con dato. */
export function factorInvierno(extra: Partial<FactorYApi> = {}): FactorYApi {
  return {
    anio: 2026,
    temporada: "invierno",
    efectivo: 0.8,
    origen: "aplicado",
    ratio_volumen: 0.76,
    ratio_control: 0.95,
    ratio_calculado: 0.8,
    ratio_aplicado: 0.8,
    meses_periodo: 12,
    meses_periodo_con_dato: 9,
    parcial: true,
    estado: "ok",
    diagnostico: {
      meses: Array.from({ length: 12 }, (_, i) => ({
        m: i + 1,
        en_periodo: i < 9,
        u: i < 9 ? 4000 : 0,
        u_ref: i < 9 ? 5263 : 0,
        ratio: i < 9 ? 0.76 : null,
        control: i < 9 ? 0.95 : null,
        relativo: i < 9 ? 0.8 : null,
      })),
      ratio_fuera: null,
      meses_periodo: 12,
      meses_periodo_con_dato: 9,
    },
    ...extra,
  };
}

/** Ejemplo G: verano set–dic 2026 con un solo mes del periodo (setiembre): sin calculado; Javier escribió 1,50. */
export function factorVerano(extra: Partial<FactorYApi> = {}): FactorYApi {
  return {
    anio: 2026,
    temporada: "verano",
    efectivo: 1.5,
    origen: "aplicado",
    ratio_volumen: 1.9,
    ratio_control: 0.95,
    ratio_calculado: null,
    ratio_aplicado: 1.5,
    meses_periodo: 4,
    meses_periodo_con_dato: 1,
    parcial: true,
    estado: "ok",
    diagnostico: {
      meses: Array.from({ length: 12 }, (_, i) => {
        const m = i + 1;
        if (m <= 8) return { m, en_periodo: false, u: 7500, u_ref: 6250, ratio: 1.2, control: 0.95, relativo: 1.263 };
        if (m === 9) return { m, en_periodo: true, u: 13300, u_ref: 7000, ratio: 1.9, control: 0.95, relativo: 2.0 };
        return { m, en_periodo: false, u: 0, u_ref: 0, ratio: null, control: null, relativo: null };
      }),
      ratio_fuera: 1.2,
      meses_periodo: 4,
      meses_periodo_con_dato: 1,
    },
    ...extra,
  };
}

export function diagnosticoVeranoGM(): NonNullable<DiagnosticoVeranoGMApi> {
  return {
    meses: Array.from({ length: 12 }, (_, i) => {
      const m = i + 1;
      if (m <= 8) return { m, en_periodo: false, u: 1800, u_ref: 1500, ratio: 1.2, control: 0.95 };
      if (m === 9) return { m, en_periodo: true, u: 3800, u_ref: 2000, ratio: 1.9, control: 0.95 };
      return { m, en_periodo: false, u: 0, u_ref: 0, ratio: null, control: null };
    }),
    ratio_fuera: 1.2,
    exceso_propio: 1.58,
    exceso_red: 2.0,
    meses_periodo_con_dato: 1,
  };
}

/** Ejemplo D: la v1 bruta se reaprueba con 7,66 % sobre corregido y el total del GM no se mueve. */
export function reaprobarEjemploD(extra: Partial<NonNullable<ReaprobarApi>> = {}): NonNullable<ReaprobarApi> {
  return { pct_equivalente: 7.66, total_antes: 64515, total_despues: 64515, filas_suben: 1, filas_bajan: 1, unidades_movidas: 2995, decididas_con_propuesta_cambio: 0, ...extra };
}

export function fila(extra: Partial<FilaGMApi> = {}): FilaGMApi {
  return {
    clave: CLAVE_HOMBRE_URBANO,
    genero: "HOMBRE",
    mundo: "URBANO",
    detallable: true,
    mundo_activo: true,
    unidades_anterior: 54000,
    acumulado: referencia(),
    aplicado_hoy: referencia({
      tipo: "aplicado_hoy",
      etiqueta: "Aplicado hoy",
      pct_bruto: 15.36,
      pct_sin_nino: 8.0,
      equivalente: { corregido: 8.0, bruto: 15.36, sin_nino_mas_rebote: null },
      cobertura_pct: null,
      tienda_mayor: null,
    }),
    base_siguiente: 56100,
    base_corregida: 59925,
    correccion_nino_pct: 6.82,
    hay_nino: true,
    cierre: cierreEjemploA(),
    fuera_base: null,
    vigente: version(),
    estado: "aprobado",
    motivo_obsoleto: null,
    sigue: "propio",
    ...extra,
  };
}

export function filaResto(extra: Partial<FilaGMApi> = {}): FilaGMApi {
  return fila({
    clave: "resto",
    genero: null,
    mundo: null,
    unidades_anterior: 12000,
    base_siguiente: 13100,
    base_corregida: 13100,
    correccion_nino_pct: 0,
    hay_nino: false,
    cierre: cierreEjemploA({ hay_nino: false, cierre: 12500, cierre_corregido: 12500, pct: 4.2, pct_corregido: 4.2, base_curva: { tiendas: 9, tiendas_fuera_cy: [], real: 13100, corregida: 13100 }, correccion_curva_pct: 0 }),
    vigente: version({ id: "v-resto", version: 1, pct: 5, equivalente_real: 5, base: { tipo: "cierre_curva", anio: null, variante: "corregido", valor: 4.2 } }),
    estado: "aprobado",
    ...extra,
  });
}

export function lista(extra: Partial<ListaGeneroMundoApi> = {}): ListaGeneroMundoApi {
  return {
    anio_aplicacion: 2027,
    anios_permitidos: [2027],
    anio_en_curso: 2026,
    ultimo_mes_cerrado: "2026-09",
    proyeccion_referencia: { id: PROYECCION_ID, nombre: "Proyección 2026", calculado_at: "2026-10-26T14:00:00.000Z", version_metodo: 5 },
    proyecciones_disponibles: [
      { id: PROYECCION_ID, nombre: "Proyección 2026", calculado_at: "2026-10-26T14:00:00.000Z", version_metodo: 5, estado: "en_trabajo" },
      { id: "88888888-8888-4888-8888-888888888888", nombre: "Proyección 2026 (vieja)", calculado_at: "2026-05-01T10:00:00.000Z", version_metodo: 4, estado: "en_trabajo" },
    ],
    filas: [
      fila({
        clave: CLAVE_MUJER_RI,
        genero: "MUJER",
        mundo: "RI",
        vigente: null,
        estado: "sin_aprobar",
        acumulado: referencia({ pct_bruto: 151, extremo: true, pct_sin_nino: 140 }),
        hay_nino: false,
        correccion_nino_pct: 0.1,
        base_siguiente: 20000,
        base_corregida: 20020,
        cierre: cierreEjemploA({ hay_nino: false, avance_bajo: true, agrupaciones_avance_bajo: ["CASACAS MU"], sin_curva_pct: 4, factor_parcial: false, correccion_curva_pct: 0.1 }),
      }),
      fila(),
      fila({
        clave: CLAVE_HOMBRE_DEPORTIVO,
        genero: "HOMBRE",
        mundo: "DEPORTIVO",
        mundo_activo: false,
        vigente: versionBruta({ id: "v-2", pct: 40 }),
        estado: "obsoleto",
        motivo_obsoleto: "metodo_anterior",
        acumulado: referencia({ pct_bruto: 381, extremo: true, fragil: true }),
        base_siguiente: 5000,
        base_corregida: 5400,
        fuera_base: { filas: 3, unidades: 412 },
      }),
      fila({ clave: CLAVE_NINO_URBANO, genero: "NIÑO", mundo: "URBANO", detallable: false, vigente: null, estado: "sin_aprobar", sigue: "resto", unidades_anterior: 3000, base_siguiente: 3300, base_corregida: 3300, hay_nino: false, correccion_nino_pct: 0 }),
    ],
    resto: filaResto(),
    total: { pct_ponderado: 8.07, base: 97500, sin_aprobar: 3 },
    huella_datos: "huella-lista",
    anio_siguiente_atipico: null,
    ...extra,
  };
}

export const BANDA_INVIERNO_2026: BandaNinoApi = { anio: 2026, temporada: "invierno", meses: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], factor: 0.8, parcial: true };
export const BANDA_VERANO_2026: BandaNinoApi = { anio: 2026, temporada: "verano", meses: [9, 10, 11, 12], factor: 1.5, parcial: true };
export const BANDA_VERANO_2023: BandaNinoApi = { anio: 2023, temporada: "verano", meses: [12, 1, 2, 3], factor: 1.31, parcial: false };

/** Detalle de HOMBRE · URBANO como en el ejemplo A de la ficha 06e: 2023 a 2025 reales, 2026 real hasta setiembre y cierre por curva después. */
export function detalle(extra: Partial<DetalleGeneroMundoApi> = {}): DetalleGeneroMundoApi {
  const base = fila();
  return {
    ...base,
    tiendas: { n: 9, ids: ["T01", "T02", "T03", "T04", "T05", "T06", "T07", "T08", "T09"], fuera: [{ tienda_id: "T10", motivo: "abrió en 2025: no tiene todo 2025" }] },
    series: [serieAnio(2023, 46000), serieAnio(2024, 49000), serieAnio(2025, 54000), serieAnio(2026, 55000, { reales: 9, totalSinNino: 58750 })],
    forma_tipica: FORMA_INVIERNO.map((v) => Math.round((v / SUMA_FORMA) * 1000) / 10),
    bandas_nino: [BANDA_INVIERNO_2026, BANDA_VERANO_2023],
    factores_parciales: true,
    referencias: referenciasEjemplo(),
    rebote_nino_pct: null,
    versiones: [version({ id: "v-old", version: 1, estado: "reemplazada", pct: 12, nota: null, base: { tipo: "ninguna", anio: null, variante: "corregido", valor: null }, sobre_base: "bruta", equivalente_real: undefined }), version()],
    avisos: [],
    huella_datos: "huella-detalle",
    cierre_por_agrupacion: agrupacionesEjemploA(),
    serie_corregida: { ...serieAnio(2026, 58750, { reales: 9 }), anio: 2026 },
    serie_base_curva: { real: mesesDeTotal(56100), corregida: mesesDeTotal(59925) },
    factores_y: [factorInvierno()],
    diagnostico_verano_gm: null,
    cierre_proyeccion: { nombre: "Plan 2026", base: 56120, base_corregida: 59940 },
    reaprobar: null,
    ...extra,
  };
}

/** El mismo detalle sin crecimiento aprobado. */
export function detalleSinAprobar(extra: Partial<DetalleGeneroMundoApi> = {}): DetalleGeneroMundoApi {
  return detalle({ vigente: null, estado: "sin_aprobar", versiones: [], ...extra });
}

/** Ejemplo D: la vigente es la v1 `bruta` y el GM tiene Niño material: hay que reaprobar. */
export function detalleParaReaprobar(extra: Partial<DetalleGeneroMundoApi> = {}): DetalleGeneroMundoApi {
  return detalle({
    vigente: versionBruta(),
    estado: "obsoleto",
    motivo_obsoleto: "metodo_anterior",
    versiones: [versionBruta()],
    reaprobar: reaprobarEjemploD(),
    ...extra,
  });
}

/** Ejemplo G: un GM con verano atípico (set–dic) y un solo mes del periodo con dato. */
export function detalleConVerano(extra: Partial<DetalleGeneroMundoApi> = {}): DetalleGeneroMundoApi {
  return detalle({
    bandas_nino: [BANDA_INVIERNO_2026, BANDA_VERANO_2026],
    factores_y: [factorInvierno(), factorVerano()],
    diagnostico_verano_gm: diagnosticoVeranoGM(),
    ...extra,
  });
}

/** Un GM sin Niño material (ejemplo E): sin serie corregida, corrección +0,1 % «no material». */
export function detalleSinNino(extra: Partial<DetalleGeneroMundoApi> = {}): DetalleGeneroMundoApi {
  return detalle({
    clave: CLAVE_MUJER_RI,
    genero: "MUJER",
    mundo: "RI",
    hay_nino: false,
    correccion_nino_pct: 0.1,
    cierre: cierreEjemploA({ hay_nino: false, correccion_curva_pct: 0.1, cierre_corregido: 55055, pct_corregido: 1.95, base_curva: { tiendas: 10, tiendas_fuera_cy: ["T10"], real: 56100, corregida: 56156 } }),
    serie_corregida: null,
    serie_base_curva: { real: mesesDeTotal(56100), corregida: mesesDeTotal(56156) },
    bandas_nino: [BANDA_VERANO_2023],
    factores_parciales: false,
    factores_y: [],
    base_siguiente: 56100,
    base_corregida: 56156,
    vigente: versionBruta({ pct: 10 }),
    versiones: [versionBruta({ pct: 10 })],
    estado: "aprobado",
    ...extra,
  });
}
