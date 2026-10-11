import type { EstadoImportacion } from "@/lib/arbol/importar";
import type { AgrupacionMarcaEstado, MarcaEstado } from "@/lib/marcas/importar";
import { Acumulador } from "@/lib/ventas/acumulador";
import { interpretarFila } from "@/lib/ventas/interpretar";
import { construirInforme, type EntradaInforme } from "@/lib/ventas/informe";
import { crearResolutorCombinaciones, crearResolutorMarcas, crearResolutorTiendas, type TiendaResolvible } from "@/lib/ventas/resolver";
import type { FilaCruda } from "@/lib/ventas/tipos";
import type { HuellaStock, PeriodoPrevisualizado, PrevisualizarRespuesta } from "@/lib/ventas/tipos-api";

/**
 * Estado y filas SINTÉTICOS compartidos por los tests de M5 (nada real de
 * Lukers). Un árbol pequeño con todas las situaciones que las reglas 12–30
 * necesitan: género, mundo, línea, nodo y equivalencia inactivos; tiendas
 * activas, inactiva y centro de distribución; marcas activas e inactivas.
 */

export const ARBOL: EstadoImportacion = {
  generos: [
    { id: "g-h", codigo: "H", nombre: "HOMBRE", activo: true },
    { id: "g-m", codigo: "M", nombre: "MUJER", activo: true },
    { id: "g-x", codigo: "N", nombre: "NIÑOS", activo: false },
  ],
  mundos: [
    { id: "m-cas", codigo: "CASUAL", nombre: "CASUAL", activo: true },
    { id: "m-urb", codigo: "URBANO", nombre: "URBANO", activo: true },
    { id: "m-ri", codigo: "RI", nombre: "RI", activo: false },
  ],
  lineas: [
    { id: "l-den", codigo: "DENIM", nombre: "DENIM", activo: true },
    { id: "l-pol", codigo: "POLO", nombre: "POLO", activo: true },
    { id: "l-ber", codigo: "BERMUDA", nombre: "BERMUDA", activo: false },
  ],
  nodos: [
    { id: "n1", genero_id: "g-h", mundo_id: "m-cas", linea_id: "l-den", activo: true },
    { id: "n2", genero_id: "g-m", mundo_id: "m-cas", linea_id: "l-den", activo: true },
    { id: "n3", genero_id: "g-h", mundo_id: "m-urb", linea_id: "l-pol", activo: true },
    { id: "n4", genero_id: "g-h", mundo_id: "m-cas", linea_id: "l-pol", activo: false },
  ],
  equivalencias: [
    { id: "e1g", genero_mundo_linea_id: "n1", nombre: "SIN EQUIVALENCIA", codigo: "SIN_EQUIVALENCIA", es_generica: true, activo: true },
    { id: "e1l", genero_mundo_linea_id: "n1", nombre: "DENIM", codigo: "DENIM", es_generica: false, activo: true },
    { id: "e1s", genero_mundo_linea_id: "n1", nombre: "PANTALON VARIOS", codigo: "PANTALON_VARIOS", es_generica: false, activo: true },
    { id: "e2g", genero_mundo_linea_id: "n2", nombre: "SIN EQUIVALENCIA", codigo: "SIN_EQUIVALENCIA", es_generica: true, activo: true },
    { id: "e3g", genero_mundo_linea_id: "n3", nombre: "SIN EQUIVALENCIA", codigo: "SIN_EQUIVALENCIA", es_generica: true, activo: true },
    { id: "e3x", genero_mundo_linea_id: "n3", nombre: "POLO CLASICO", codigo: "POLO_CLASICO", es_generica: false, activo: false },
    { id: "e4g", genero_mundo_linea_id: "n4", nombre: "SIN EQUIVALENCIA", codigo: "SIN_EQUIVALENCIA", es_generica: true, activo: true },
  ],
};

export const TIENDAS: TiendaResolvible[] = [
  { id: "t-uno", codigo: "R101", nombre: "LUKERS UNO", tipo: "Tienda", fecha_apertura: "2020-01-01", fecha_cierre: null, activo: true },
  { id: "t-dos", codigo: "R102", nombre: "LUKERS DOS", tipo: "Tienda", fecha_apertura: "2024-06-15", fecha_cierre: null, activo: true },
  { id: "t-cd", codigo: "RD50", nombre: "CD LUKERS", tipo: "Centro de Distribución", fecha_apertura: null, fecha_cierre: null, activo: true },
  { id: "t-ofi", codigo: "R999", nombre: "OFICINA CENTRAL", tipo: "Tienda", fecha_apertura: null, fecha_cierre: null, activo: false },
];

export const AGRUPACIONES: AgrupacionMarcaEstado[] = [
  { id: "ag-ul", codigo: "ULTRA_LOW", nombre: "ULTRA LOW", activo: true },
  { id: "ag-mid", codigo: "MID_VALUE", nombre: "MID VALUE", activo: true },
  { id: "ag-pre", codigo: "PREMIUM", nombre: "PREMIUM", activo: true },
];

export const MARCAS: (MarcaEstado & { nombre: string })[] = [
  { id: "mk-alfa", codigo: "ALFA", nombre: "ALFA", agrupacion_marca_id: "ag-pre", tratamiento_especial: false, activo: true },
  { id: "mk-beta", codigo: "BETA", nombre: "BETA", agrupacion_marca_id: "ag-mid", tratamiento_especial: false, activo: true },
  { id: "mk-vieja", codigo: "VIEJA", nombre: "VIEJA", agrupacion_marca_id: "ag-mid", tratamiento_especial: false, activo: false },
  { id: "mk-varios", codigo: "VARIOS", nombre: "VARIOS", agrupacion_marca_id: "ag-mid", tratamiento_especial: false, activo: true },
];

/** Fila válida de septiembre de 2026 (HOMBRE / CASUAL / DENIM / JEAN... en la tienda uno). */
export function fila(extra: Partial<FilaCruda> = {}): FilaCruda {
  return {
    anio: "2026",
    mes: "Set",
    tienda: "LUKERS UNO",
    genero: "HOMBRE",
    mundo: "CASUAL",
    linea: "DENIM",
    equivalencia: "PANTALON VARIOS",
    marca: "ALFA",
    talla: "Central",
    unidades: "10",
    venta_soles: "1000",
    costo_vendido: "400",
    stock_unidades: "20",
    stock_valorizado: "800",
    ...extra,
  };
}

export function acumular(filas: Partial<FilaCruda>[]): Acumulador {
  const acum = new Acumulador();
  filas.forEach((f, i) => acum.agregar(interpretarFila(fila(f)), i + 1));
  return acum;
}

type Extras = {
  hoy?: string;
  periodos?: PeriodoPrevisualizado[];
  anterior?: PrevisualizarRespuesta["anterior"];
  huellas?: HuellaStock[];
  tiendas?: TiendaResolvible[];
  marcas?: { id: string; nombre: string; agrupacion_marca_id: string; activo: boolean }[];
};

/** Lo que devolvería `previsualizar`, calculado con los resolutores reales sobre el estado sintético. */
export function resoluciones(acum: Acumulador, extras: Extras = {}): EntradaInforme["resoluciones"] {
  const d = acum.diccionarios;
  const rt = crearResolutorTiendas(extras.tiendas ?? TIENDAS);
  const rc = crearResolutorCombinaciones(ARBOL);
  const rm = crearResolutorMarcas(extras.marcas ?? MARCAS);
  return {
    hoy: extras.hoy ?? "2026-10-11",
    tiendas: d.tiendas.map(rt),
    combinaciones: d.combinaciones.map((c) => rc({ genero: c.genero, mundo: c.mundo, linea: c.linea, equivalencia: c.equivalencia })),
    marcas: d.marcas.map(rm),
    periodos: extras.periodos ?? [],
    anterior: extras.anterior ?? null,
    huellas_stock: extras.huellas ?? [],
  };
}

export function informe(filas: Partial<FilaCruda>[], extras: Extras & Partial<Omit<EntradaInforme, "acumulador" | "resoluciones">> = {}) {
  const acumulador = acumular(filas);
  return {
    acumulador,
    ...construirInforme({
      acumulador,
      resoluciones: resoluciones(acumulador, extras),
      totalesQlik: extras.totalesQlik,
      posiblementeTruncado: extras.posiblementeTruncado,
    }),
  };
}
