import { aplanarEquivalencias, type AgrupacionPlanaEntrada, type EstadoAplanar } from "@/lib/estacionalidad/aplanar";
import type { ReporteEstacionalidad } from "@/lib/estacionalidad/tipos";
import type { NodoNivelEntrada } from "@/lib/reportes/agrupacion-gmle";

/**
 * Fixture SINTÉTICA de M11 (nunca datos de Lukers): géneros HOMBRE/MUJER,
 * mundos URBANO/FORMAL, líneas PANTALON/POLO/CASACA, nodos GML y GMLE y las
 * agrupaciones A, B, C, S (activa sin género), D (activa y vacía), I (inactiva
 * con una equivalencia) y MUERTA (inactiva y vacía).
 *
 * Cifras que las pruebas dan por sabidas (universo vigente):
 *   nodos vigentes 10 (GML 9 · GMLE 1) · mixtos 2 (n3, n6) · unidades 11
 *   equivalencias 20 (7 genéricas) · A 8 · B 7 · C 1 · S 1 · I 1 · sin agrupación activa 2
 *   anomalías: sin_agrupacion 3 · genero_no_incluido 1 · generica_discrepante 1
 *              nodo_gml_mixto 2 · linea_partida 4 · agrupacion_vacia 1
 */

const GENERICA = { nombre: "SIN EQUIVALENCIA", codigo: "SIN_EQUIVALENCIA", es_generica: true } as const;

type EqFx = EstadoAplanar["equivalencias"][number];
const eq = (
  id: string,
  nodo: string,
  nombre: string,
  agrupacion: string | null,
  extra: { activo?: boolean; generica?: boolean } = {}
): EqFx => ({
  id,
  genero_mundo_linea_id: nodo,
  codigo: extra.generica ? GENERICA.codigo : nombre.replace(/ /g, "_"),
  nombre: extra.generica ? GENERICA.nombre : nombre,
  es_generica: extra.generica ?? false,
  activo: extra.activo ?? true,
  agrupacion_estacionalidad_id: agrupacion,
});

export type EstadoGmleFx = EstadoAplanar & {
  agrupaciones: Array<AgrupacionPlanaEntrada & { temporada: string }>;
  /** `nivel_planificacion` de los nodos (los nodos de `EstadoAplanar` no lo exigen). */
  niveles: Record<string, "GML" | "GMLE">;
};

/** Estado nuevo en cada llamada: las pruebas pueden mutarlo sin afectar a otras. */
export function estadoGmleFx(): EstadoGmleFx {
  return {
    generos: [
      { id: "g-m", codigo: "M", nombre: "MUJER", orden: 20, activo: true },
      { id: "g-h", codigo: "H", nombre: "HOMBRE", orden: 10, activo: true },
    ],
    mundos: [
      { id: "m-fo", codigo: "FORMAL", nombre: "FORMAL", orden: 20, activo: true },
      { id: "m-ur", codigo: "URBANO", nombre: "URBANO", orden: 10, activo: true },
    ],
    lineas: [
      { id: "l-pol", codigo: "POLO", nombre: "POLO", temporada: "Verano", activo: true },
      { id: "l-pan", codigo: "PANTALON", nombre: "PANTALON", temporada: "Todo el año", activo: true },
      { id: "l-cas", codigo: "CASACA", nombre: "CASACA", temporada: "Invierno", activo: true },
    ],
    nodos: [
      { id: "n1", genero_id: "g-h", mundo_id: "m-ur", linea_id: "l-pan", activo: true }, // GML única A
      { id: "n2", genero_id: "g-h", mundo_id: "m-fo", linea_id: "l-pan", activo: true }, // GML única B (línea partida con n1)
      { id: "n3", genero_id: "g-h", mundo_id: "m-ur", linea_id: "l-pol", activo: true }, // GML mixto A 2 · B 2, genérica B discrepante
      { id: "n4", genero_id: "g-h", mundo_id: "m-ur", linea_id: "l-cas", activo: true }, // GMLE A · B · C
      { id: "n5", genero_id: "g-m", mundo_id: "m-ur", linea_id: "l-pan", activo: true }, // GML: real sin agrupación, genérica A
      { id: "n6", genero_id: "g-m", mundo_id: "m-ur", linea_id: "l-pol", activo: true }, // GML mixto con empate A/B, genérica sin agrupación
      { id: "n7", genero_id: "g-m", mundo_id: "m-ur", linea_id: "l-cas", activo: true }, // GML solo genérica B
      { id: "n8", genero_id: "g-m", mundo_id: "m-fo", linea_id: "l-pol", activo: true }, // GML con agrupación sin género
      { id: "n9", genero_id: "g-m", mundo_id: "m-fo", linea_id: "l-cas", activo: true }, // GML con agrupación inactiva
      { id: "n10", genero_id: "g-h", mundo_id: "m-fo", linea_id: "l-pol", activo: false }, // nodo inactivo
      { id: "n11", genero_id: "g-m", mundo_id: "m-fo", linea_id: "l-pan", activo: true }, // sin ninguna equivalencia
    ],
    niveles: { n4: "GMLE" },
    equivalencias: [
      eq("e01", "n1", "JOGGER", "a-a"),
      eq("e02", "n1", "CARGO", "a-a"),
      eq("e03", "n1", "", "a-a", { generica: true }),
      eq("e04", "n2", "CHINO", "a-b"),
      eq("e05", "n2", "", "a-b", { generica: true }),
      eq("e06", "n3", "BASICO", "a-a"),
      eq("e07", "n3", "PIQUE", "a-a"),
      eq("e08", "n3", "DEPORTIVO", "a-b"),
      eq("e09", "n3", "", "a-b", { generica: true }),
      eq("e10", "n4", "PUFFER", "a-a"),
      eq("e11", "n4", "PARKA", "a-b"),
      eq("e12", "n4", "", "a-c", { generica: true }),
      eq("e13", "n5", "SKINNY", null),
      eq("e14", "n5", "", "a-a", { generica: true }),
      eq("e15", "n6", "RAYADO", "a-a"),
      eq("e16", "n6", "LISO", "a-b"),
      eq("e17", "n6", "", null, { generica: true }),
      eq("e18", "n7", "", "a-b", { generica: true }),
      eq("e19", "n8", "ZETA", "a-s"),
      eq("e20", "n9", "WALLY", "a-i"),
      eq("e21", "n9", "VIEJA", "a-a", { activo: false }), // inactiva: no cuenta
      eq("e22", "n10", "FANTASMA", "a-a"), // nodo no vigente: no cuenta
    ],
    agrupaciones: [
      { id: "a-a", codigo: "A", nombre: "A", orden: 10, activo: true, genero_ids: ["g-h", "g-m"], temporada: "invierno" },
      { id: "a-b", codigo: "B", nombre: "B", orden: 20, activo: true, genero_ids: ["g-h", "g-m"], temporada: "verano" },
      { id: "a-c", codigo: "C", nombre: "C", orden: 30, activo: true, genero_ids: ["g-h"], temporada: "todo_el_ano" },
      { id: "a-s", codigo: "S", nombre: "S", orden: 40, activo: true, genero_ids: [], temporada: "todo_el_ano" },
      { id: "a-d", codigo: "D", nombre: "D", orden: 50, activo: true, genero_ids: ["g-h"], temporada: "todo_el_ano" },
      { id: "a-i", codigo: "I", nombre: "I", orden: 60, activo: false, genero_ids: ["g-m"], temporada: "todo_el_ano" },
      { id: "a-x", codigo: "MUERTA", nombre: "MUERTA", orden: 70, activo: false, genero_ids: ["g-h"], temporada: "todo_el_ano" },
    ],
  };
}

/** El reporte de M3 con inactivos (la entrada de `armarReporteAgrupacionGmle`) y los nodos con su nivel. */
export function entradaGmleFx(estado: EstadoGmleFx = estadoGmleFx()): {
  reporteM3: ReporteEstacionalidad;
  nodos: NodoNivelEntrada[];
} {
  const reporteM3 = aplanarEquivalencias(estado, estado.agrupaciones, { incluirInactivos: true });
  const nodos: NodoNivelEntrada[] = estado.nodos.map((n) => ({
    ...n,
    nivel_planificacion: estado.niveles[n.id] ?? "GML",
  }));
  return { reporteM3, nodos };
}
