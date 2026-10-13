import { indexarNodos, type IndiceNodos } from "@/lib/arbol/nivel/indice";
import type { EstadoImportacionNivel } from "@/lib/arbol/nivel/importar";
import type { AgrupacionGml, AsignacionGmlEntrada, MarcaGml } from "@/lib/marcas/gml/reglas";
import type { EstadoVistaGml } from "@/lib/marcas/gml/vista";
import type { HechoFlujo } from "@/lib/marcas/tipos-api";

/**
 * Fixture sintético de 02b (docs/modulos/02b-marcas-tratamiento-gml.md, "Casos
 * de prueba sintéticos"). Nada real de Lukers: marcas ALFA, BETA, GAMMA…, nodos
 * N1 a N3 y cifras inventadas. Las funciones devuelven copias nuevas para que
 * cada caso pueda modificar su estado sin contaminar a los demás.
 */

export const AGR = { rec: "ag-rec", pre: "ag-pre", val: "ag-val", mid: "ag-mid" } as const;

export const AGRUPACIONES: AgrupacionGml[] = [
  { id: AGR.rec, nombre: "RECONOCIDO", activo: true, orden: 40 },
  { id: AGR.pre, nombre: "PREMIUM", activo: true, orden: 50 },
  { id: AGR.val, nombre: "VALOR", activo: true, orden: 30 },
  { id: AGR.mid, nombre: "MID VALUE", activo: true, orden: 20 },
];

type Datos = Partial<Omit<MarcaGml, "id" | "nombre" | "agrupacion_marca_id">>;
const marca = (id: string, nombre: string, agrupacion: string, d: Datos = {}): MarcaGml => ({
  id,
  nombre,
  codigo: nombre.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "_").toUpperCase(),
  agrupacion_marca_id: agrupacion,
  activo: true,
  tratamiento_especial: false,
  modalidad_tratamiento: null,
  nota_tratamiento: null,
  conjunto_marca_id: null,
  ...d,
});

/** Marcas del fixture, con los conjuntos (ALFA y BETA son cabezas). */
export function marcasFixture(): MarcaGml[] {
  return [
    marca("m-alfa", "ALFA", AGR.rec, { tratamiento_especial: true, modalidad_tratamiento: "por_gml", nota_tratamiento: "Licencia de denim" }),
    marca("m-beta", "BETA", AGR.pre, { tratamiento_especial: true, modalidad_tratamiento: "barrido" }),
    marca("m-gamma", "GAMMA", AGR.rec),
    marca("m-delta", "DELTA", AGR.rec, { tratamiento_especial: true, modalidad_tratamiento: "por_gml" }),
    marca("m-epsilon", "ÉPSILON", AGR.pre, { tratamiento_especial: true, modalidad_tratamiento: null }),
    marca("m-omega", "OMEGA", AGR.rec, { activo: false }),
    // Conjuntos.
    marca("m-alfa-jeans", "ALFA JEANS", AGR.val, { conjunto_marca_id: "m-alfa" }),
    // Tenía una asignación propia (a N3) de antes de entrar al conjunto: marcada por_gml pero ignorada (en_conjunto).
    marca("m-alfa-kids", "ALFA KIDS", AGR.rec, { tratamiento_especial: true, modalidad_tratamiento: "por_gml", conjunto_marca_id: "m-alfa" }),
    marca("m-beta-uno", "BETA UNO", AGR.pre, { conjunto_marca_id: "m-beta" }),
    marca("m-beta-dos", "BETA DOS", AGR.mid, { activo: false, conjunto_marca_id: "m-beta" }),
    // Solo para las sugerencias de conjuntos.
    marca("m-gamma-sport", "GAMMA SPORT", AGR.val),
    marca("m-delto", "DELTO", AGR.rec),
    // Genéricas que fija M5 en MID VALUE.
    marca("m-varios", "VARIOS", AGR.mid),
    marca("m-otros", "OTROS", AGR.mid),
    marca("m-sin-marca", "SIN MARCA", AGR.mid),
  ];
}

/** El mismo fixture sin ningún conjunto (BETA DOS activa: la sugerencia de conjuntos solo mira marcas activas). */
export function marcasSinConjuntos(): MarcaGml[] {
  return marcasFixture().map((m) => ({
    ...m,
    conjunto_marca_id: null,
    ...(m.id === "m-beta-dos" ? { activo: true } : {}),
    ...(m.id === "m-alfa-kids" ? { tratamiento_especial: false, modalidad_tratamiento: null } : {}),
  }));
}

export const NODOS = { n1: "n1", n2: "n2", n3: "n3" } as const;

export function arbolFixture(): EstadoImportacionNivel {
  return {
    generos: [
      { id: "g-h", codigo: "HOMBRE", nombre: "HOMBRE", activo: true },
      { id: "g-m", codigo: "MUJER", nombre: "MUJER", activo: true },
    ],
    mundos: [
      { id: "mu-urb", codigo: "URBANO", nombre: "URBANO", activo: true },
      { id: "mu-for", codigo: "FORMAL", nombre: "FORMAL", activo: true },
    ],
    lineas: [
      { id: "l-denim", codigo: "DENIM", nombre: "DENIM", activo: true },
      { id: "l-terno", codigo: "TERNO", nombre: "TERNO", activo: true },
      // Existe en el catálogo pero HOMBRE · URBANO · CORBATA no existe como nodo.
      { id: "l-corbata", codigo: "CORBATA", nombre: "CORBATA", activo: true },
    ],
    nodos: [
      { id: "n1", genero_id: "g-h", mundo_id: "mu-urb", linea_id: "l-denim", activo: true, nivel_planificacion: "GML" },
      { id: "n2", genero_id: "g-m", mundo_id: "mu-urb", linea_id: "l-denim", activo: true, nivel_planificacion: "GMLE" },
      { id: "n3", genero_id: "g-h", mundo_id: "mu-for", linea_id: "l-terno", activo: true, nivel_planificacion: "GML" },
    ],
  };
}

export function indiceFixture(arbol: EstadoImportacionNivel = arbolFixture()): IndiceNodos {
  return indexarNodos(arbol);
}

/** Equivalencias del fixture y la agrupación de estacionalidad de cada una (S1 y S2). */
export const EQUIVALENCIAS = [
  { id: "e1a", genero_mundo_linea_id: "n1", agrupacion_estacionalidad_id: "s1" },
  { id: "e1b", genero_mundo_linea_id: "n1", agrupacion_estacionalidad_id: "s2" },
  { id: "e2a", genero_mundo_linea_id: "n2", agrupacion_estacionalidad_id: "s1" },
  { id: "e2b", genero_mundo_linea_id: "n2", agrupacion_estacionalidad_id: "s1" },
  { id: "e3", genero_mundo_linea_id: "n3", agrupacion_estacionalidad_id: "s1" },
] as const;

export function asignacionesFixture(): AsignacionGmlEntrada[] {
  const a = (id: string, marca_id: string, nodo: string, nota: string | null = null): AsignacionGmlEntrada => ({
    id,
    marca_id,
    genero_mundo_linea_id: nodo,
    nota,
    activo: true,
    created_at: "2026-10-12T00:00:00Z",
  });
  return [
    a("a1", "m-alfa", "n1"),
    a("a2", "m-alfa", "n2"),
    a("a3", "m-alfa", "n3", "Dejó de trabajarse"),
    a("a4", "m-alfa-kids", "n3"),
  ];
}

export function estadoFixture(cambios: Partial<EstadoVistaGml> = {}): EstadoVistaGml {
  return {
    marcas: marcasFixture(),
    agrupaciones: AGRUPACIONES.map((g) => ({ ...g })),
    asignaciones: asignacionesFixture(),
    nodos: indiceFixture(),
    ...cambios,
  };
}

/** Hechos de un mes (unidades): los de las marcas sueltas y cabezas (1 230) y los de los miembros (250 más). */
export const HECHOS_SUELTOS: (HechoFlujo & { unidades: number })[] = [
  { marca_id: "m-alfa", equivalencia_id: "e1a", unidades: 400 },
  { marca_id: "m-alfa", equivalencia_id: "e1b", unidades: 100 },
  { marca_id: "m-gamma", equivalencia_id: "e1a", unidades: 300 },
  { marca_id: "m-beta", equivalencia_id: "e1a", unidades: 200 },
  { marca_id: "m-alfa", equivalencia_id: "e3", unidades: 40 },
  { marca_id: "m-gamma", equivalencia_id: "e3", unidades: 60 },
  { marca_id: "m-beta", equivalencia_id: "e3", unidades: 10 },
  { marca_id: "m-alfa", equivalencia_id: "e2a", unidades: 100 },
  { marca_id: "m-alfa", equivalencia_id: "e2b", unidades: 20 },
];

export const HECHOS_MIEMBROS: (HechoFlujo & { unidades: number })[] = [
  { marca_id: "m-alfa-jeans", equivalencia_id: "e1a", unidades: 150 },
  { marca_id: "m-alfa-kids", equivalencia_id: "e3", unidades: 30 },
  { marca_id: "m-beta-uno", equivalencia_id: "e1a", unidades: 50 },
  { marca_id: "m-beta-dos", equivalencia_id: "e3", unidades: 20 },
];

export const HECHOS_TODOS = [...HECHOS_SUELTOS, ...HECHOS_MIEMBROS];
