import type {
  BandaNinoApi,
  DetalleGeneroMundoApi,
  FilaGMApi,
  ListaGeneroMundoApi,
  ReferenciaApi,
  SerieAnioGMApi,
  VersionCrecimientoApi,
} from "../src/lib/crecimientos/tipos-api";

/**
 * Datos sintéticos de la pantalla «Crecimiento por género × mundo» (06d). Nada de datos reales: el ejemplo es el de la ficha
 * (HOMBRE · URBANO, `Y = 2026`, `k = setiembre`, invierno de 2026 Niño con factor 0,80).
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

/** Forma de invierno: más venta de mayo a agosto. */
const FORMA_INVIERNO = [60, 60, 70, 90, 130, 150, 160, 140, 100, 70, 60, 60];

export function serieAnio(anio: number, escala: number, o: { factor?: number; reales?: number; incompleto?: boolean } = {}): SerieAnioGMApi {
  const reales = o.reales ?? 12;
  const factor = o.factor ?? 1;
  const meses = FORMA_INVIERNO.map((v, i) => Math.round(v * escala * (i >= 4 && i <= 8 ? factor : 1)));
  const sinNino = FORMA_INVIERNO.map((v) => Math.round(v * escala));
  const total = meses.reduce((a, b) => a + b, 0);
  const totalSin = sinNino.reduce((a, b) => a + b, 0);
  return {
    anio,
    meses,
    meses_sin_nino: sinNino,
    origen: meses.map((_, i) => (i < reales ? "real" : "proyectado")),
    incompleto: o.incompleto ?? reales < 12,
    total,
    total_sin_nino: totalSin,
    forma: meses.map((v) => Math.round((v / total) * 1000) / 10),
  };
}

export function referencia(extra: Partial<ReferenciaApi> = {}): ReferenciaApi {
  return {
    tipo: "acumulado",
    anio: 2026,
    variante_defecto: "sin_nino_mas_rebote",
    etiqueta: "Acumulado ene–set 2026",
    periodo: "ene–set 2026 frente a ene–set 2025",
    tiendas: 9,
    anterior: 40000,
    actual: 41200,
    pct_bruto: 3.0,
    pct_sin_nino: 10.5,
    equivalente: { bruto: 3.0, sin_nino_mas_rebote: 18.4 },
    fragil: false,
    extremo: false,
    tienda_mayor: { codigo: "T07", aporte_pct: 38.5, pct_sin_ella: 1.2 },
    cobertura_pct: 74,
    motivo_nulo: null,
    ...extra,
  };
}

/** Las cuatro referencias del ejemplo de la ficha. */
export function referenciasEjemplo(): ReferenciaApi[] {
  return [
    referencia(),
    referencia({
      tipo: "cierre_proyectado",
      etiqueta: "Cierre proyectado 2026",
      periodo: "año 2026 (real + proyectado) frente a 2025",
      anterior: 54000,
      actual: 55620,
      pct_bruto: 3.0,
      pct_sin_nino: 10.4,
      equivalente: { bruto: 3.0, sin_nino_mas_rebote: 18.3 },
      tienda_mayor: null,
      cobertura_pct: null,
    }),
    referencia({
      tipo: "anio_completo",
      anio: 2025,
      variante_defecto: "bruto",
      etiqueta: "Año completo 2025",
      periodo: "2025 frente a 2024",
      tiendas: 8,
      anterior: 50000,
      actual: 52500,
      pct_bruto: 5.0,
      pct_sin_nino: 5.0,
      equivalente: { bruto: 5.0, sin_nino_mas_rebote: 12.5 },
      tienda_mayor: null,
      cobertura_pct: null,
    }),
    referencia({
      tipo: "aplicado_hoy",
      variante_defecto: "bruto",
      etiqueta: "Aplicado hoy en la proyección",
      periodo: "crecimiento que usa la proyección de referencia",
      anterior: 58900,
      actual: 61845,
      pct_bruto: 5.0,
      pct_sin_nino: -2.0,
      equivalente: { bruto: 5.0, sin_nino_mas_rebote: 5.0 },
      tienda_mayor: null,
      cobertura_pct: null,
    }),
  ];
}

/** Referencia de proyección de un método anterior: sin cifras que dependan de la proyección. */
export function referenciaMetodoAnterior(tipo: "cierre_proyectado" | "aplicado_hoy"): ReferenciaApi {
  return referencia({
    tipo,
    etiqueta: tipo === "aplicado_hoy" ? "Aplicado hoy en la proyección" : "Cierre proyectado 2026",
    periodo: "proyección de referencia",
    tiendas: 0,
    anterior: null,
    actual: null,
    pct_bruto: null,
    pct_sin_nino: null,
    equivalente: { bruto: null, sin_nino_mas_rebote: null },
    tienda_mayor: null,
    cobertura_pct: null,
    motivo_nulo: "metodo_anterior",
  });
}

export function version(extra: Partial<VersionCrecimientoApi> = {}): VersionCrecimientoApi {
  return {
    id: "v-1",
    version: 2,
    estado: "vigente",
    pct: 15,
    nota: "prudente: el rebote del invierno no será completo",
    base: { tipo: "acumulado", anio: null, variante: "sin_nino_mas_rebote", valor: 18.4 },
    por_nombre: "Javier",
    aprobada_at: "2026-10-20T15:30:00.000Z",
    proyeccion_referencia: { id: PROYECCION_ID, nombre: "Proyección 2026" },
    ...extra,
  };
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
    aplicado_hoy: referencia({ tipo: "aplicado_hoy", variante_defecto: "bruto", etiqueta: "Aplicado hoy", pct_bruto: 5, pct_sin_nino: -2, equivalente: { bruto: 5, sin_nino_mas_rebote: 5 }, cobertura_pct: null, tienda_mayor: null }),
    base_siguiente: 58900,
    vigente: version(),
    estado: "aprobado",
    motivo_obsoleto: null,
    sigue: "propio",
    ...extra,
  };
}

export function filaResto(extra: Partial<FilaGMApi> = {}): FilaGMApi {
  return fila({ clave: "resto", genero: null, mundo: null, unidades_anterior: 12000, base_siguiente: 13100, vigente: null, estado: "sin_aprobar", ...extra });
}

export function lista(extra: Partial<ListaGeneroMundoApi> = {}): ListaGeneroMundoApi {
  return {
    anio_aplicacion: 2027,
    anios_permitidos: [2027],
    anio_en_curso: 2026,
    ultimo_mes_cerrado: "2026-09",
    proyeccion_referencia: { id: PROYECCION_ID, nombre: "Proyección 2026", calculado_at: "2026-10-26T14:00:00.000Z", version_metodo: 4 },
    proyecciones_disponibles: [
      { id: PROYECCION_ID, nombre: "Proyección 2026", calculado_at: "2026-10-26T14:00:00.000Z", version_metodo: 4, estado: "en_trabajo" },
      { id: "88888888-8888-4888-8888-888888888888", nombre: "Proyección 2026 (vieja)", calculado_at: "2026-05-01T10:00:00.000Z", version_metodo: 3, estado: "en_trabajo" },
    ],
    filas: [
      fila({ clave: CLAVE_MUJER_RI, genero: "MUJER", mundo: "RI", vigente: null, estado: "sin_aprobar", acumulado: referencia({ pct_bruto: 151, extremo: true, pct_sin_nino: 140 }) }),
      fila(),
      fila({
        clave: CLAVE_HOMBRE_DEPORTIVO,
        genero: "HOMBRE",
        mundo: "DEPORTIVO",
        mundo_activo: false,
        vigente: version({ id: "v-2", version: 1, pct: 40 }),
        estado: "obsoleto",
        motivo_obsoleto: "base_movida",
        acumulado: referencia({ pct_bruto: 381, extremo: true, fragil: true }),
      }),
      fila({ clave: CLAVE_NINO_URBANO, genero: "NIÑO", mundo: "URBANO", detallable: false, vigente: null, estado: "sin_aprobar", sigue: "resto", unidades_anterior: 3000, base_siguiente: 3300 }),
    ],
    resto: filaResto(),
    total: { pct_ponderado: 12.3, base: 75300, sin_aprobar: 3 },
    huella_datos: "huella-lista",
    ...extra,
  };
}

export const BANDA_INVIERNO_2026: BandaNinoApi = { anio: 2026, temporada: "invierno", meses: [5, 6, 7, 8, 9], factor: 0.8, parcial: true };
export const BANDA_VERANO_2023: BandaNinoApi = { anio: 2023, temporada: "verano", meses: [12, 1, 2, 3], factor: 1.31, parcial: false };

/** Detalle de HOMBRE · URBANO como en la ficha: 2023 a 2026, 2026 real hasta setiembre y proyectado después. */
export function detalle(extra: Partial<DetalleGeneroMundoApi> = {}): DetalleGeneroMundoApi {
  const base = fila();
  return {
    ...base,
    tiendas: { n: 9, ids: ["T01", "T02", "T03", "T04", "T05", "T06", "T07", "T08", "T09"], fuera: [{ tienda_id: "T10", motivo: "abrió en 2025: no tiene todo 2025" }] },
    series: [serieAnio(2023, 80), serieAnio(2024, 90), serieAnio(2025, 100), serieAnio(2026, 103, { reales: 9, factor: 0.8, incompleto: true })],
    forma_tipica: FORMA_INVIERNO.map((v) => Math.round((v / 1150) * 1000) / 10),
    bandas_nino: [BANDA_INVIERNO_2026, BANDA_VERANO_2023],
    factores_parciales: true,
    referencias: referenciasEjemplo(),
    rebote_nino_pct: 7.1,
    versiones: [version({ id: "v-old", version: 1, estado: "reemplazada", pct: 12, nota: null, base: { tipo: "ninguna", anio: null, variante: "bruto", valor: null } }), version()],
    avisos: [],
    huella_datos: "huella-detalle",
    ...extra,
  };
}

/** El mismo detalle sin crecimiento aprobado. */
export function detalleSinAprobar(extra: Partial<DetalleGeneroMundoApi> = {}): DetalleGeneroMundoApi {
  return detalle({ vigente: null, estado: "sin_aprobar", versiones: [], ...extra });
}
