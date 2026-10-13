import { compararNombre } from "@/lib/arbol/armar-arbol";
import { compararNodos } from "@/lib/arbol/nivel/indice";
import { aPeriodo, esPeriodoValido } from "@/lib/ventas/periodo";
import { modalidadEfectiva } from "../reglas";
import { marcasPorId, unidadDeMarca } from "../conjuntos/reglas";
import type { EstadoVistaGml } from "./vista";
import type { EstadoSugerencia, RespuestaSugerencias, SugerenciaGml } from "../tipos-api";

/**
 * Sugerencias de marcas relevantes (02b, "Sugerencias"). La agregación de la
 * venta, el orden por medida, el top y la participación mínima los hace la
 * función SQL v2 (ninguna lectura del histórico trae filas a Node); aquí solo se
 * interpreta su resultado frente a la configuración actual. SOLO AYUDA: nada se
 * aplica solo.
 */

export const MESES_POR_DEFECTO = 12;

/** Una fila de la función SQL: ya agregada por GML, agrupación y UNIDAD de marca. */
export type FilaSugerenciaSql = {
  genero_mundo_linea_id: string;
  agrupacion_marca_id: string;
  marca_id: string;
  unidades: number;
  venta_soles: number;
  participacion: number;
  rango: number;
};

/** `aaaa-mm` restando `n` meses. */
export function mesesAntes(periodo: string, n: number): string {
  const [a, m] = periodo.split("-").map(Number);
  const indice = a * 12 + (m - 1) - n;
  return aPeriodo(Math.floor(indice / 12), (indice % 12) + 1);
}

export type RangoSugerencias = RespuestaSugerencias["rango"];

/**
 * Rango de meses de la consulta. Por defecto `hasta` = el último mes publicado
 * y `desde` = once meses antes (doce meses). `null` si ningún mes publicado cae
 * dentro (la API responde `409`). `publicados` = periodos `aaaa-mm` de las cargas
 * publicadas.
 */
export function resolverRango(
  publicados: readonly string[],
  desde?: string,
  hasta?: string
): RangoSugerencias | null {
  const validos = publicados.filter(esPeriodoValido);
  if (validos.length === 0) return null;
  const ultimo = [...validos].sort().at(-1) as string;
  const h = hasta ?? ultimo;
  const d = desde ?? mesesAntes(h, MESES_POR_DEFECTO - 1);
  const dentro = new Set(validos.filter((p) => p >= d && p <= h));
  if (dentro.size === 0) return null;
  return { desde: d, hasta: h, meses_publicados: dentro.size };
}

/**
 * Interpreta lo que devolvió la función SQL v2, que ya trae el orden por
 * `medida`, el `rango`, la participación sobre el total completo de la
 * agrupación y los filtros `rango <= top` y `participacion >= mínima`: aquí no
 * se reordena ni se filtra, solo se cruza cada fila con la configuración actual
 * (`nueva`, `ya_relevante`, `marca_al_barrer`, `marca_inactiva`,
 * `nodo_no_vigente`) y se ordena para pantalla.
 */
export function armarSugerencias(
  filas: readonly FilaSugerenciaSql[],
  estado: EstadoVistaGml
): Pick<RespuestaSugerencias, "sugerencias" | "resumen"> {

  const marcas = marcasPorId(estado.marcas);
  const agrupaciones = new Map(estado.agrupaciones.map((a) => [a.id, a]));
  const pares = new Set(
    estado.asignaciones.filter((a) => a.activo).map((a) => `${a.marca_id}|${a.genero_mundo_linea_id}`)
  );
  const miembros = new Map<string, number>();
  for (const m of estado.marcas) {
    const u = unidadDeMarca(m, estado.marcas).unidad_marca_id;
    if (u !== m.id) miembros.set(u, (miembros.get(u) ?? 0) + 1);
  }

  const sugerencias: SugerenciaGml[] = [];
  for (const f of filas) {
    const nodo = estado.nodos.get(f.genero_mundo_linea_id);
    const marca = marcas.get(f.marca_id);
    if (!nodo || !marca) continue;
    let estadoFila: EstadoSugerencia;
    if (!marca.activo) estadoFila = "marca_inactiva";
    else if (!nodo.vigente) estadoFila = "nodo_no_vigente";
    else if (modalidadEfectiva(marca) === "barrido") estadoFila = "marca_al_barrer";
    else if (pares.has(`${f.marca_id}|${f.genero_mundo_linea_id}`)) estadoFila = "ya_relevante";
    else estadoFila = "nueva";

    sugerencias.push({
      genero_mundo_linea_id: nodo.id,
      genero: nodo.genero,
      mundo: nodo.mundo,
      linea: nodo.linea,
      nivel_planificacion: nodo.nivel_planificacion,
      agrupacion_marca_id: f.agrupacion_marca_id,
      agrupacion: agrupaciones.get(f.agrupacion_marca_id)?.nombre ?? "",
      marca_id: marca.id,
      marca: marca.nombre,
      miembros: miembros.get(marca.id) ?? 0,
      rango: f.rango,
      unidades: f.unidades,
      venta_soles: f.venta_soles,
      participacion: f.participacion,
      estado: estadoFila,
    });
  }

  sugerencias.sort((a, b) => {
    const na = estado.nodos.get(a.genero_mundo_linea_id);
    const nb = estado.nodos.get(b.genero_mundo_linea_id);
    const porNodo = na && nb ? compararNodos(na, nb) : 0;
    const aa = agrupaciones.get(a.agrupacion_marca_id);
    const ab = agrupaciones.get(b.agrupacion_marca_id);
    return (
      porNodo ||
      (aa?.orden ?? 0) - (ab?.orden ?? 0) ||
      compararNombre(a.agrupacion, b.agrupacion) ||
      a.rango - b.rango
    );
  });

  return {
    sugerencias,
    resumen: {
      nodos: new Set(sugerencias.map((s) => s.genero_mundo_linea_id)).size,
      pares: sugerencias.length,
      nuevas: sugerencias.filter((s) => s.estado === "nueva").length,
      ya_relevantes: sugerencias.filter((s) => s.estado === "ya_relevante").length,
      al_barrer: sugerencias.filter((s) => s.estado === "marca_al_barrer").length,
    },
  };
}
