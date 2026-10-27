import type { EstadoImportacionCompras, RepartoVigenteParaImportar } from "@/lib/compras/importar";
import type { ModeloCompra } from "@/lib/compras/reglas";
import type { RegistrosCompra } from "./compras.fixture";
import { AGR_M8, EQ, GEN, LIN_M8, MARCA_M8, MUN, NODO_M8, PROVEEDOR, TIENDA } from "./compras.fixture";
import { LIN } from "./intercompany.fixture";

/**
 * Estado sintético del importador de compras y modelos de compra para las pruebas de T2b (fichas 08, casos 4, 7, 8, 9, 11, 13 y 26).
 * Todo inventado: marcas ALFA, BETA, GAMMA, DELTA, JH y DONATELLI, nodos HOMBRE · URBANO · DENIM, HOMBRE · CASUAL · POLO,
 * MUJER · CASUAL · SANDALIA y HOMBRE · FORMAL · CAMISA (GMLE). Los ids vienen de `compras.fixture.ts`.
 */

const uuid = (grupo: string, n: number) => `${grupo}0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const EQ_M8 = { ...EQ, camisaGenerica: uuid("e", 90) };
export const TIENDA_M8 = { ...TIENDA, cerrada: uuid("7", 4) };

const SIN_CONJUNTO = { conjunto_marca_id: null } as const;

export const BETA_V2: RepartoVigenteParaImportar = {
  marca_id: MARCA_M8.beta,
  reparto_id: uuid("2", 2),
  version: 2,
  modo: "por_temporada",
  error_reparto_pp: 8,
  temporadas_usadas: { verano: { desde_mes: 10, hasta_mes: 3 }, invierno: { desde_mes: 4, hasta_mes: 9 } },
  filas: [
    { gml_id: NODO_M8.urbano, equivalencia_id: null, temporada: "verano", participacion: 0.59 },
    { gml_id: NODO_M8.polo, equivalencia_id: null, temporada: "verano", participacion: 0.293 },
    { gml_id: NODO_M8.sandalia, equivalencia_id: null, temporada: "verano", participacion: 0.117 },
    { gml_id: NODO_M8.urbano, equivalencia_id: null, temporada: "invierno", participacion: 0.5 },
    { gml_id: NODO_M8.polo, equivalencia_id: null, temporada: "invierno", participacion: 0.4 },
    { gml_id: NODO_M8.sandalia, equivalencia_id: null, temporada: "invierno", participacion: 0.1 },
  ],
};

/** GAMMA (mixta): su parte al barrer cae solo en DENIM (caso 7). */
export const GAMMA_V1: RepartoVigenteParaImportar = {
  marca_id: MARCA_M8.gamma,
  reparto_id: uuid("2", 3),
  version: 1,
  modo: "anual",
  error_reparto_pp: 5,
  temporadas_usadas: BETA_V2.temporadas_usadas,
  filas: [{ gml_id: NODO_M8.urbano, equivalencia_id: null, temporada: null, participacion: 1 }],
};

/** El estado del que parten las pruebas del importador: sin compras ni líneas importadas y solo «Proveedor Norte» existente. */
export function estadoImportacionBase(): EstadoImportacionCompras {
  return {
    generos: [
      { id: GEN.hombre, codigo: "H", nombre: "HOMBRE", activo: true },
      { id: GEN.mujer, codigo: "M", nombre: "MUJER", activo: true },
    ],
    mundos: [
      { id: MUN.urbano, codigo: "URBANO", nombre: "URBANO", activo: true },
      { id: MUN.casual, codigo: "CASUAL", nombre: "CASUAL", activo: true },
      { id: MUN.formal, codigo: "FORMAL", nombre: "FORMAL", activo: true },
    ],
    lineas: [
      { id: LIN.denim, codigo: "DENIM", nombre: "DENIM", activo: true },
      { id: LIN.polo, codigo: "POLO", nombre: "POLO", activo: true },
      { id: LIN_M8.sandalia, codigo: "SANDALIA", nombre: "SANDALIA", activo: true },
      { id: LIN.camisa, codigo: "CAMISA", nombre: "CAMISA", activo: true },
      { id: LIN.terno, codigo: "TERNO", nombre: "TERNO", activo: true },
      { id: LIN.vieja, codigo: "VIEJA", nombre: "VIEJA", activo: true },
    ],
    nodos: [
      { id: NODO_M8.urbano, genero_id: GEN.hombre, mundo_id: MUN.urbano, linea_id: LIN.denim, activo: true, nivel_planificacion: "GML" },
      { id: NODO_M8.polo, genero_id: GEN.hombre, mundo_id: MUN.casual, linea_id: LIN.polo, activo: true, nivel_planificacion: "GML" },
      { id: NODO_M8.sandalia, genero_id: GEN.mujer, mundo_id: MUN.casual, linea_id: LIN_M8.sandalia, activo: true, nivel_planificacion: "GML" },
      { id: NODO_M8.camisa, genero_id: GEN.hombre, mundo_id: MUN.formal, linea_id: LIN.camisa, activo: true, nivel_planificacion: "GMLE" },
      { id: NODO_M8.terno, genero_id: GEN.hombre, mundo_id: MUN.formal, linea_id: LIN.terno, activo: true, nivel_planificacion: "GML" },
      { id: NODO_M8.inactivo, genero_id: GEN.hombre, mundo_id: MUN.formal, linea_id: LIN.vieja, activo: false, nivel_planificacion: "GML" },
    ],
    equivalencias: [
      { id: EQ_M8.larga, genero_mundo_linea_id: NODO_M8.camisa, codigo: "MANGA_LARGA", nombre: "MANGA LARGA", es_generica: false, activo: true },
      { id: EQ_M8.corta, genero_mundo_linea_id: NODO_M8.camisa, codigo: "MANGA_CORTA", nombre: "MANGA CORTA", es_generica: false, activo: true },
      { id: EQ_M8.camisaGenerica, genero_mundo_linea_id: NODO_M8.camisa, codigo: "SIN_EQUIVALENCIA", nombre: "SIN EQUIVALENCIA", es_generica: true, activo: true },
      { id: EQ_M8.ternoX, genero_mundo_linea_id: NODO_M8.terno, codigo: "SACO", nombre: "SACO", es_generica: false, activo: true },
    ],
    marcas: [
      { id: MARCA_M8.alfa, codigo: "ALFA", nombre: "ALFA", activo: true, agrupacion_marca_id: AGR_M8.reconocido, modalidad_efectiva: null, ...SIN_CONJUNTO },
      { id: MARCA_M8.beta, codigo: "BETA", nombre: "BETA", activo: true, agrupacion_marca_id: AGR_M8.premium, modalidad_efectiva: "barrido", ...SIN_CONJUNTO },
      { id: MARCA_M8.gamma, codigo: "GAMMA", nombre: "GAMMA", activo: true, agrupacion_marca_id: AGR_M8.reconocido, modalidad_efectiva: "mixta", ...SIN_CONJUNTO },
      { id: MARCA_M8.delta, codigo: "DELTA", nombre: "DELTA", activo: true, agrupacion_marca_id: AGR_M8.valor, modalidad_efectiva: "barrido", ...SIN_CONJUNTO },
      { id: MARCA_M8.jh, codigo: "JH", nombre: "JOHN HOLDEN", activo: true, agrupacion_marca_id: AGR_M8.reconocido, modalidad_efectiva: "por_gml", ...SIN_CONJUNTO },
      { id: MARCA_M8.john, codigo: "JOHN", nombre: "JOHN", activo: true, agrupacion_marca_id: AGR_M8.reconocido, modalidad_efectiva: null, conjunto_marca_id: MARCA_M8.jh },
      { id: MARCA_M8.donatelli, codigo: "DONATELLI", nombre: "DONATELLI", activo: true, agrupacion_marca_id: AGR_M8.reconocido, modalidad_efectiva: "por_gml", ...SIN_CONJUNTO },
      { id: MARCA_M8.inactiva, codigo: "VIEJA", nombre: "MARCA VIEJA", activo: false, agrupacion_marca_id: AGR_M8.valor, modalidad_efectiva: null, ...SIN_CONJUNTO },
    ],
    agrupaciones: [
      { id: AGR_M8.reconocido, codigo: "RECONOCIDO", nombre: "RECONOCIDO", activo: true },
      { id: AGR_M8.premium, codigo: "PREMIUM", nombre: "PREMIUM", activo: true },
      { id: AGR_M8.valor, codigo: "VALOR", nombre: "VALOR", activo: true },
    ],
    tiendas: [
      { id: TIENDA_M8.t01, codigo: "T01", nombre: "Tienda 01", tipo: "Tienda", activo: true },
      { id: TIENDA_M8.t02, codigo: "T02", nombre: "Tienda 02", tipo: "Tienda", activo: true },
      { id: TIENDA_M8.cd, codigo: "CD01", nombre: "Centro de distribución", tipo: "Centro de Distribución", activo: true },
      { id: TIENDA_M8.cerrada, codigo: "T99", nombre: "Tienda cerrada", tipo: "Tienda", activo: false },
    ],
    proveedores: [{ id: PROVEEDOR.norte, nombre: "Proveedor Norte", codigo: "PN", activo: true, es_intercompany: false }],
    compras: [],
    lineas_existentes: [],
    repartos: [BETA_V2, GAMMA_V1],
    reglas: [{ id: uuid("1", 1), marca_id: MARCA_M8.jh, genero_mundo_linea_id: NODO_M8.camisa, equivalencia_id: null, vigente_desde: "2026-01" }],
  };
}

/** Un `ModeloCompra` a partir de los registros planos de `compras.fixture.ts` (la primera compra). */
export function modeloDeRegistros(reg: RegistrosCompra): ModeloCompra {
  const c = reg.compras[0];
  return {
    estado: c.estado,
    revision: c.revision,
    cancelada_at: c.cancelada_at,
    fecha_compra: c.fecha_compra,
    lineas: reg.lineas.map((l) => ({ id: l.id, unidades: l.unidades, unidades_recibidas: l.unidades_recibidas, unidades_canceladas: l.unidades_canceladas, activo: l.activo })),
    recepciones: reg.recepciones.map((r) => ({ id: r.id, linea_id: r.linea_id, recibida_periodo: r.recibida_periodo, unidades: r.unidades, fecha_recepcion: r.fecha_recepcion, origen: r.origen })),
  };
}

export const ACTOR = { perfil_id: uuid("6", 1), nombre: "Planner Uno" };
