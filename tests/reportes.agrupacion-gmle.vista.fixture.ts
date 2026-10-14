/**
 * Reporte M11 sintético (nada de datos de Lukers) armado a mano para probar
 * los filtros, el orden, el Resumen y la descarga del frontend. Géneros
 * HOMBRE/MUJER, mundos URBANO/FORMAL, líneas PANTALON/POLO/CASACA; cinco
 * agrupaciones (INVIERNO, VERANO, POLOS, una vacía y una inactiva) y cinco
 * nodos GML y GMLE. Las cifras de `agrupaciones[]` y `resumen` son las que la
 * API devolvería para estas filas (se comprueban en la prueba del Resumen).
 */
import type {
  AgrupacionGmle,
  AnomaliaGmle,
  EquivalenciaGmle,
  LineaPartidaGmle,
  NodoGmle,
  ReporteAgrupacionGmle,
} from "@/lib/reportes/tipos-api";

export const AGR_INVIERNO = "agr-invierno";
export const AGR_VERANO = "agr-verano";
export const AGR_POLOS = "agr-polos";
export const AGR_VACIA = "agr-vacia";
export const AGR_VIEJA = "agr-vieja";

const NOMBRE: Record<string, string> = {
  [AGR_INVIERNO]: "PANTALONES INVIERNO",
  [AGR_VERANO]: "PANTALONES VERANO",
  [AGR_POLOS]: "POLOS",
  [AGR_VACIA]: "VACIA",
  [AGR_VIEJA]: "VIEJA",
};

const TEMPORADA: Record<string, EquivalenciaGmle["temporada"]> = {
  [AGR_INVIERNO]: "invierno",
  [AGR_VERANO]: "verano",
  [AGR_POLOS]: "todo_el_ano",
  [AGR_VACIA]: "todo_el_ano",
  [AGR_VIEJA]: "todo_el_ano",
};

type Nodo = { id: string; genero: string; mundo: string; linea: string; nivel: "GML" | "GMLE" };
const N1: Nodo = { id: "n1", genero: "HOMBRE", mundo: "URBANO", linea: "PANTALON", nivel: "GML" };
const N2: Nodo = { id: "n2", genero: "HOMBRE", mundo: "FORMAL", linea: "PANTALON", nivel: "GML" };
const N3: Nodo = { id: "n3", genero: "MUJER", mundo: "URBANO", linea: "POLO", nivel: "GMLE" };
const N4: Nodo = { id: "n4", genero: "MUJER", mundo: "URBANO", linea: "CASACA", nivel: "GML" };
const N5: Nodo = { id: "n5", genero: "MUJER", mundo: "FORMAL", linea: "CASACA", nivel: "GML" };

function eq(
  id: string,
  nodo: Nodo,
  nombre: string,
  agrupacionId: string | null,
  anomalias: AnomaliaGmle[],
  extra: Partial<EquivalenciaGmle> = {}
): EquivalenciaGmle {
  const vigente = extra.vigente ?? true;
  const activo = extra.activo ?? true;
  return {
    id,
    nodo_id: nodo.id,
    agrupacion_id: agrupacionId,
    agrupacion: agrupacionId ? NOMBRE[agrupacionId] : "",
    temporada: agrupacionId ? TEMPORADA[agrupacionId] : null,
    genero: nodo.genero,
    mundo: nodo.mundo,
    linea: nodo.linea,
    nivel: nodo.nivel,
    unidad: !vigente || !activo ? "ninguna" : nodo.nivel === "GML" ? "nodo" : "equivalencia",
    equivalencia: nombre,
    codigo: nombre.replace(/ /g, "_"),
    es_generica: nombre === "SIN EQUIVALENCIA",
    activo,
    vigente,
    agrupacion_activa: agrupacionId !== null && agrupacionId !== AGR_VIEJA,
    anomalias,
    ...extra,
  };
}

const MIXTO_LINEA: AnomaliaGmle[] = ["nodo_gml_mixto", "linea_partida"];

export function crearReporteSintetico(): ReporteAgrupacionGmle {
  const equivalencias: EquivalenciaGmle[] = [
    eq("e1", N1, "JOGGER", AGR_INVIERNO, MIXTO_LINEA),
    eq("e2", N1, "CHINO", AGR_INVIERNO, MIXTO_LINEA),
    eq("e3", N1, "CARGO", AGR_VERANO, MIXTO_LINEA),
    eq("e4", N1, "SIN EQUIVALENCIA", AGR_VERANO, ["generica_discrepante", "nodo_gml_mixto", "linea_partida"]),
    eq("e5", N2, "VESTIR", AGR_VERANO, ["linea_partida"]),
    eq("e6", N2, "SIN EQUIVALENCIA", AGR_VERANO, ["linea_partida"]),
    eq("e7", N3, "BASICO", AGR_POLOS, []),
    eq("e8", N3, "ESTAMPADO", AGR_INVIERNO, []),
    eq("e9", N3, "SIN EQUIVALENCIA", null, ["sin_agrupacion"]),
    eq("e10", N4, "CASACA", null, ["sin_agrupacion"]),
    eq("e11", N4, "PARKA", AGR_VIEJA, [], { activo: false }),
    eq("e12", N5, "CAPA", AGR_INVIERNO, [], { vigente: false }),
  ];

  const nodo = (n: Nodo, parcial: Partial<NodoGmle>): NodoGmle => ({
    id: n.id,
    genero_id: `g-${n.genero}`,
    mundo_id: `m-${n.mundo}`,
    linea_id: `l-${n.linea}`,
    ruta: `${n.genero} / ${n.mundo} / ${n.linea}`,
    nivel: n.nivel,
    vigente: true,
    unidades: 1,
    agrupacion_nodo: null,
    agrupacion_id: null,
    mayoritaria_id: null,
    reparto: [],
    anomalias: [],
    ...parcial,
  });

  const nodos: NodoGmle[] = [
    nodo(N1, {
      agrupacion_nodo: "mixta",
      mayoritaria_id: AGR_INVIERNO,
      reparto: [
        { agrupacion_id: AGR_INVIERNO, equivalencias: 2 },
        { agrupacion_id: AGR_VERANO, equivalencias: 2 },
      ],
      anomalias: ["nodo_gml_mixto"],
    }),
    nodo(N2, {
      agrupacion_nodo: "unica",
      agrupacion_id: AGR_VERANO,
      mayoritaria_id: AGR_VERANO,
      reparto: [{ agrupacion_id: AGR_VERANO, equivalencias: 2 }],
    }),
    nodo(N3, {
      unidades: 3,
      reparto: [
        { agrupacion_id: AGR_POLOS, equivalencias: 1 },
        { agrupacion_id: AGR_INVIERNO, equivalencias: 1 },
        { agrupacion_id: null, equivalencias: 1 },
      ],
    }),
    nodo(N4, { agrupacion_nodo: "sin", reparto: [{ agrupacion_id: null, equivalencias: 1 }] }),
    nodo(N5, { vigente: false, unidades: 0, agrupacion_nodo: "sin" }),
  ];

  const generos = (...nombres: string[]) => nombres.map((n) => ({ id: `g-${n}`, nombre: n }));
  const agrupacion = (id: string, generosDe: string[], parcial: Partial<AgrupacionGmle>): AgrupacionGmle => ({
    id,
    codigo: id.replace("agr-", "").toUpperCase(),
    nombre: NOMBRE[id],
    temporada: TEMPORADA[id] ?? "todo_el_ano",
    activo: true,
    generos: generos(...generosDe),
    nodos_gml: 0,
    nodos_gml_mixtos: 0,
    unidades_gmle: 0,
    equivalencias: 0,
    genericas: 0,
    lineas: 0,
    anomalias: [],
    ...parcial,
  });

  const agrupaciones: AgrupacionGmle[] = [
    agrupacion(AGR_INVIERNO, ["HOMBRE", "MUJER"], { nodos_gml_mixtos: 1, unidades_gmle: 1, equivalencias: 3, lineas: 2 }),
    agrupacion(AGR_VERANO, ["HOMBRE"], { nodos_gml: 1, nodos_gml_mixtos: 1, equivalencias: 4, genericas: 2, lineas: 1 }),
    agrupacion(AGR_POLOS, ["MUJER"], { unidades_gmle: 1, equivalencias: 1, lineas: 1 }),
    agrupacion(AGR_VACIA, ["HOMBRE"], { anomalias: ["agrupacion_vacia"] }),
    agrupacion(AGR_VIEJA, ["MUJER"], { activo: false }),
  ];

  const lineas_partidas: LineaPartidaGmle[] = [
    {
      genero_id: "g-HOMBRE",
      linea_id: "l-PANTALON",
      genero: "HOMBRE",
      linea: "PANTALON",
      agrupaciones: [
        { id: AGR_INVIERNO, nombre: NOMBRE[AGR_INVIERNO], equivalencias: 2, mundos: ["URBANO"] },
        { id: AGR_VERANO, nombre: NOMBRE[AGR_VERANO], equivalencias: 4, mundos: ["URBANO", "FORMAL"] },
      ],
    },
  ];

  return {
    resumen: {
      agrupaciones: 5,
      agrupaciones_activas: 4,
      nodos: 4,
      nodos_gml: 3,
      nodos_gmle: 1,
      nodos_gml_mixtos: 1,
      unidades: 6,
      equivalencias: 10,
      genericas: 3,
      anomalias: {
        sin_agrupacion: 2,
        genero_no_incluido: 0,
        generica_discrepante: 1,
        nodo_gml_mixto: 1,
        linea_partida: 1,
        agrupacion_vacia: 1,
      },
    },
    agrupaciones,
    nodos,
    equivalencias,
    lineas_partidas,
    catalogos: {
      generos: [
        { id: "g-HOMBRE", nombre: "HOMBRE", orden: 10, activo: true },
        { id: "g-MUJER", nombre: "MUJER", orden: 20, activo: true },
      ],
      mundos: [
        { id: "m-URBANO", nombre: "URBANO", orden: 10, activo: true },
        { id: "m-FORMAL", nombre: "FORMAL", orden: 20, activo: true },
      ],
    },
  };
}
