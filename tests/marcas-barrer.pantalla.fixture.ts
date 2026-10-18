import type { AnalisisMarcaApi, FilaRepartoApi, ListaBarrerApi, MarcaBarrerResumenApi, P2Api, RepartoApi, Temporada } from "../src/lib/marcas-barrer/tipos-api";

/**
 * Datos sintéticos de la pantalla de M12 (marcas ALFA, BETA, GAMMA, DELTA; GML HOMBRE · URBANO · DENIM, HOMBRE · CASUAL · POLO,
 * HOMBRE · FORMAL · CAMISA, MUJER · CASUAL · SANDALIA y pequeños de HOMBRE · CASUAL). Ningún dato real de Lukers.
 */

export const GEN_H = "g-hombre";
export const MUN_URBANO = "m-urbano";
export const MUN_CASUAL = "m-casual";
export const LIN_DENIM = "l-denim";
export const LIN_POLO = "l-polo";

const mensual = (valores: number[]): (number | null)[] => Array.from({ length: 12 }, (_, i) => valores[i] ?? null);

type Opciones = {
  clave: string;
  ruta: string;
  unidades: number;
  verano: [number, number | null];
  invierno: [number, number | null];
  vigente?: [number, number] | null;
  grupoResto?: string | null;
  pequena?: boolean;
  enAlcance?: boolean;
  especifico?: boolean;
  nivel?: "GML" | "GMLE";
  p1?: number | null;
  tendencia?: number | null;
};

export function filaApi(o: Opciones): FilaRepartoApi {
  const p2 = (t: Temporada, v: [number, number | null], vig: number | null): P2Api => ({ temporada: t, historico: v[0], cerrada: v[1], vigente: vig, ajustado_vigente: null });
  return {
    clave: `${o.clave}|`,
    gml_id: o.clave,
    equivalencia_id: null,
    genero_id: GEN_H,
    mundo_id: MUN_URBANO,
    linea_id: LIN_DENIM,
    ruta: o.ruta,
    nivel: o.nivel ?? "GML",
    unidades_ventana: o.unidades,
    pequena: o.pequena ?? false,
    grupo_resto: o.grupoResto ?? null,
    en_alcance: o.enAlcance ?? true,
    p1_ventana: o.p1 === undefined ? 0.08 : o.p1,
    p1_anual: [
      { anio: 2025, valor: 0.07, completo: true },
      { anio: 2026, valor: 0.09, completo: false },
    ],
    p1_mensual: [
      { anio: 2025, meses: mensual([0.06, 0.07, 0.08, 0.07, 0.06, 0.07, 0.08, 0.07, 0.06, 0.07, 0.08, 0.07]) },
      { anio: 2026, meses: mensual([0.08, 0.09, 0.1, 0.09, 0.08, 0.09, 0.1, 0.09, 0.08]) },
    ],
    unidades_anual: [
      { anio: 2025, unidades: Math.round(o.unidades * 0.6), completo: true },
      { anio: 2026, unidades: Math.round(o.unidades * 0.4), completo: false },
    ],
    tendencia: o.tendencia === undefined ? 0.06 : o.tendencia,
    p2: o.especifico || o.enAlcance === false ? [] : [p2("verano", o.verano, o.vigente ? o.vigente[0] : null), p2("invierno", o.invierno, o.vigente ? o.vigente[1] : null)],
    es_especifico: o.especifico ?? false,
  };
}

/** BETA al barrer, por temporada: cuatro GML con venta y dos pequeños que forman «Resto de HOMBRE · CASUAL». Verano e invierno suman 1. */
export function analisisBeta(extra: Partial<AnalisisMarcaApi> = {}): AnalisisMarcaApi {
  const filas: FilaRepartoApi[] = [
    filaApi({ clave: "gml-denim", ruta: "HOMBRE · URBANO · DENIM", unidades: 5120, verano: [0.41, 0.43], invierno: [0.35, 0.33], vigente: [0.41, 0.35] }),
    filaApi({ clave: "gml-polo", ruta: "HOMBRE · CASUAL · POLO", unidades: 3740, verano: [0.3, 0.27], invierno: [0.35, 0.37], vigente: [0.3, 0.35] }),
    filaApi({ clave: "gml-camisa", ruta: "HOMBRE · FORMAL · CAMISA › MANGA LARGA", unidades: 1500, nivel: "GMLE", verano: [0.17, 0.2], invierno: [0.2, 0.2], vigente: [0.17, 0.2] }),
    filaApi({ clave: "gml-peq1", ruta: "HOMBRE · CASUAL · CAMPERA", unidades: 30, pequena: true, grupoResto: `${GEN_H}|${MUN_CASUAL}`, verano: [0.07, 0.05], invierno: [0.06, 0.05], vigente: [0.07, 0.06], p1: null, tendencia: null }),
    filaApi({ clave: "gml-peq2", ruta: "HOMBRE · CASUAL · BUZO", unidades: 20, pequena: true, grupoResto: `${GEN_H}|${MUN_CASUAL}`, verano: [0.05, 0.05], invierno: [0.04, 0.05], vigente: [0.05, 0.04], p1: null, tendencia: null }),
    filaApi({ clave: "gml-sandalia", ruta: "MUJER · CASUAL · SANDALIA", unidades: 730, enAlcance: false, verano: [0, null], invierno: [0, null] }),
  ];
  return {
    marca: { id: "marca-beta", nombre: "BETA", modalidad: "barrido", agrupacion_marca: "PREMIUM", miembros: ["BETA UNO", "BETA DOS"], gml_especificos: [] },
    parametros: {
      ventana_meses: 24,
      modo: "por_temporada",
      modo_efectivo: "por_temporada",
      fuente_disponible: ["historico", "cerrada"],
      alcance: { generos: [], mundos: [], lineas: [] },
      normaliza_nino: true,
      hasta_periodo: "2026-09-01",
      desde_periodo: "2024-10-01",
      factores: [
        { anio: 2026, temporada: "invierno", ratio: 0.66 },
        { anio: 2026, temporada: "verano", ratio: 1.24 },
      ],
      temporadas: { verano: { desde_mes: 10, hasta_mes: 3 }, invierno: { desde_mes: 4, hasta_mes: 9 } },
      meses_por_temporada: [
        { temporada: "verano", meses: 12 },
        { temporada: "invierno", meses: 12 },
      ],
    },
    filas,
    restos: [
      {
        grupo_resto: `${GEN_H}|${MUN_CASUAL}`,
        etiqueta: "Resto de HOMBRE · CASUAL",
        miembros: ["gml-peq1|", "gml-peq2|"],
        unidades_ventana: 50,
        p2: [
          { temporada: "verano", historico: 0.12, cerrada: 0.1, vigente: 0.12, ajustado_vigente: null },
          { temporada: "invierno", historico: 0.1, cerrada: 0.1, vigente: 0.1, ajustado_vigente: null },
        ],
      },
    ],
    opciones_alcance: {
      generos: [{ id: GEN_H, nombre: "HOMBRE" }],
      mundos: [
        { id: MUN_URBANO, nombre: "URBANO" },
        { id: MUN_CASUAL, nombre: "CASUAL" },
      ],
      lineas: [{ id: LIN_DENIM, nombre: "DENIM" }],
    },
    fuera_de_alcance: [{ ruta: "MUJER · CASUAL · SANDALIA", unidades: 730 }],
    share_barrido: 1,
    unidades_barrer: 11120,
    unidades_especificas: 0,
    error_reparto: { pp: 8, veredicto: "estable", anios: [{ anio: 2025, pp: 8 }] },
    estacionalidad: {
      propia: [0.05, 0.05, 0.06, 0.08, 0.1, 0.12, 0.12, 0.1, 0.09, 0.09, 0.07, 0.07],
      gml: [0.06, 0.06, 0.07, 0.08, 0.09, 0.1, 0.11, 0.1, 0.09, 0.09, 0.08, 0.07],
      eat_pp: 4.8,
      veredicto: "similar",
      anios_completos: [2025],
    },
    tendencia_total: 0.04,
    vigente: { reparto_id: "rep-2", version: 2, modo: "por_temporada", fuente: "historico", ventana_meses: 24, aprobada_at: "2026-09-30T15:00:00Z", aprobada_por_nombre: "Planner Uno", nota: "sin ajuste", error_reparto_pp: 8, diferencia_pp: 1.2 },
    obsoleto: [],
    avisos: [],
    huella: "huella-1",
    ...extra,
  };
}

export function resumenMarca(extra: Partial<MarcaBarrerResumenApi> & { id: string; nombre: string }): MarcaBarrerResumenApi {
  return {
    modalidad: "barrido",
    agrupacion_marca: { id: "ag-premium", nombre: "PREMIUM" },
    miembros: [],
    unidades_ventana: 1000,
    unidades_barrer: 1000,
    unidades_especificas: 0,
    share_barrido: 1,
    gml_con_venta: 5,
    gml_pequenos: 1,
    gml_especificos: 0,
    genero_ids: [GEN_H],
    mundo_ids: [MUN_URBANO],
    linea_ids: [LIN_DENIM],
    error_reparto: { pp: null, veredicto: null },
    vigente: null,
    estado: "sin_reparto",
    obsoleto: [],
    diferencia_pp: null,
    avisos: [],
    ...extra,
  };
}

export const vigenteResumen = { reparto_id: "r", version: 2, modo: "por_temporada" as const, fuente: "historico" as const, ventana_meses: 24, aprobada_at: "2026-09-30T15:00:00Z", aprobada_por_nombre: "Planner Uno", error_reparto_pp: 8 };

export function listaEjemplo(): ListaBarrerApi {
  const marcas: MarcaBarrerResumenApi[] = [
    resumenMarca({ id: "marca-beta", nombre: "BETA", miembros: ["BETA UNO", "BETA DOS"], unidades_ventana: 12480, unidades_barrer: 12480, gml_con_venta: 14, gml_pequenos: 6, error_reparto: { pp: 8, veredicto: "estable" }, vigente: vigenteResumen, estado: "al_dia", diferencia_pp: 1.2 }),
    resumenMarca({
      id: "marca-gamma",
      nombre: "GAMMA",
      modalidad: "mixta",
      agrupacion_marca: { id: "ag-reconocido", nombre: "RECONOCIDO" },
      unidades_ventana: 8310,
      unidades_barrer: 5069,
      unidades_especificas: 3241,
      share_barrido: 0.61,
      gml_con_venta: 9,
      gml_pequenos: 4,
      gml_especificos: 2,
      error_reparto: { pp: 31, veredicto: "inestable" },
      vigente: { ...vigenteResumen, version: 1, error_reparto_pp: 31 },
      estado: "obsoleto",
      obsoleto: ["config_cambiada"],
    }),
    resumenMarca({ id: "marca-delta", nombre: "DELTA", agrupacion_marca: { id: "ag-valor", nombre: "VALOR" }, unidades_ventana: 1020, unidades_barrer: 1020, gml_con_venta: 6, gml_pequenos: 5, genero_ids: [], mundo_ids: [], linea_ids: [] }),
  ];
  return {
    datos: { hasta_periodo: "2026-09-01", desde_periodo: "2024-10-01", ventana: 24, cargas: 24 },
    marcas,
    resumen: { marcas: 3, sin_reparto: 1, obsoletas: 1, mixtas: 1, inestables: 1, unidades_barrer: 18569 },
  };
}

export function repartoEjemplo(version: number, vigente: boolean): RepartoApi {
  return {
    id: `rep-${version}`,
    marca_id: "marca-beta",
    version,
    vigente,
    ventana_meses: 24,
    modo: "por_temporada",
    fuente: "historico",
    alcance: { generos: [GEN_H], mundos: [], lineas: [] },
    hasta_periodo: "2026-09-01",
    normaliza_nino: true,
    huella_cargas: "c",
    huella_config: "k",
    factores_usados: [],
    temporadas_usadas: { verano: { desde_mes: 10, hasta_mes: 3 }, invierno: { desde_mes: 4, hasta_mes: 9 } },
    share_barrido: 1,
    eat_pp: 4.8,
    error_reparto_pp: 8,
    nota: version === 2 ? "sin ajuste" : null,
    aprobada_por_id: null,
    aprobada_por_nombre: "Planner Uno",
    aprobada_at: version === 2 ? "2026-09-30T15:00:00Z" : "2026-07-02T15:00:00Z",
    filas: [
      { gml_id: "gml-denim", equivalencia_id: null, ruta: "HOMBRE · URBANO · DENIM", temporada: "verano", grupo_resto: null, unidades_ventana: 5120, participacion_calculada: 0.41, participacion_ajustada: null, participacion_vigente: 0.41 },
      { gml_id: "gml-peq1", equivalencia_id: null, ruta: "HOMBRE · CASUAL · CAMPERA", temporada: "verano", grupo_resto: `${GEN_H}|${MUN_CASUAL}`, unidades_ventana: 30, participacion_calculada: 0.07, participacion_ajustada: 0.08, participacion_vigente: 0.08 },
    ],
  };
}
