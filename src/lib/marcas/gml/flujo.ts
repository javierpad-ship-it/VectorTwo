import type { NivelPlanificacion } from "@/lib/arbol/tipos";
import { modalidadEfectiva } from "../reglas";
import { unidadDeMarca } from "../conjuntos/reglas";
import { marcaVigenteGml } from "./reglas";
import { unidadesFlujoEspecial, type EstadoVistaGml } from "./vista";
import type { ClaveFlujo, HechoFlujo, ModalidadEfectiva } from "../tipos-api";

/**
 * `claveFlujo` (02b, regla 12): a qué fila del flujo va cada hecho de venta o
 * stock. Es el contrato que M7 y M8 comparten. Puro: sin I/O, sin imports de
 * `@supabase/*` ni de componentes (lo vigila un test estático).
 *
 * PRIMER PASO, SIEMPRE: la unidad de la marca del hecho (la cabeza del
 * conjunto si la marca es miembro de un conjunto efectivo, si no la marca
 * misma). La tabla se evalúa sobre la UNIDAD (su agrupación, su casilla, su
 * modalidad y sus GML relevantes), nunca sobre el miembro:
 *
 *   unidad no marcada                              → "otras de la agrupación"
 *   marcada y vigente, `barrido`                   → { tipo: "barrido" }
 *   marcada y vigente, `por_gml`, relevante aquí   → fila de la marca
 *   marcada y vigente, `por_gml`, no relevante aquí→ "otras" (pregunta 1)
 *   marcada y vigente, `mixta`, relevante aquí     → fila de la marca (M12)
 *   marcada y vigente, `mixta`, no relevante aquí  → { tipo: "barrido" } (M12: su resto va al barrer, no a "otras")
 *   marcada, no vigente (agrupación inactiva)      → "otras"
 *
 * La partición es completa y disjunta: cada hecho recibe una y solo una clave.
 */

type MarcaFlujo = {
  agrupacion_marca_id: string;
  marcada: boolean;
  vigente: boolean;
  modalidad: ModalidadEfectiva | null;
};

export type ConfigFlujo = {
  /** `marca_id → unidad_marca_id` de TODAS las marcas (la misma definición que la vista de unidades). */
  unidadDe: ReadonlyMap<string, string>;
  marcas: ReadonlyMap<string, MarcaFlujo>;
  nodoDeEquivalencia: ReadonlyMap<string, string>;
  nivelDeNodo: ReadonlyMap<string, NivelPlanificacion>;
  /** `"unidad|nodo"` de cada par relevante vigente. */
  relevantes: ReadonlySet<string>;
};

const claveRelevante = (unidadId: string, nodoId: string) => `${unidadId}|${nodoId}`;

/** Arma la configuración que `claveFlujo` consulta, a partir del estado de marcas y del árbol. */
export function construirConfigFlujo(
  estado: EstadoVistaGml,
  equivalencias: readonly { id: string; genero_mundo_linea_id: string }[]
): ConfigFlujo {
  const agrupaciones = new Map(estado.agrupaciones.map((a) => [a.id, a]));
  const unidadDe = new Map<string, string>();
  const marcas = new Map<string, MarcaFlujo>();
  for (const m of estado.marcas) {
    unidadDe.set(m.id, unidadDeMarca(m, estado.marcas).unidad_marca_id);
    marcas.set(m.id, {
      agrupacion_marca_id: m.agrupacion_marca_id,
      marcada: m.tratamiento_especial,
      vigente: marcaVigenteGml(m, agrupaciones.get(m.agrupacion_marca_id)),
      modalidad: modalidadEfectiva(m),
    });
  }
  const relevantes = new Set<string>();
  // Las filas `por_gml` de la vista incluyen los GML específicos de una mixta (su fila de GML nulo es `barrido`).
  for (const u of unidadesFlujoEspecial(estado).unidades) {
    if (u.modalidad === "por_gml" && u.genero_mundo_linea_id) {
      relevantes.add(claveRelevante(u.marca_id, u.genero_mundo_linea_id));
    }
  }
  return {
    unidadDe,
    marcas,
    nodoDeEquivalencia: new Map(equivalencias.map((e) => [e.id, e.genero_mundo_linea_id])),
    nivelDeNodo: new Map([...estado.nodos.values()].map((n) => [n.id, n.nivel_planificacion])),
    relevantes,
  };
}

/** Primer paso de `claveFlujo`: la unidad de la marca (ella misma si no está en un conjunto efectivo). */
export function unidadDeMarcaEnFlujo(marcaId: string, config: ConfigFlujo): string {
  const unidad = config.unidadDe.get(marcaId);
  if (unidad === undefined) throw new Error(`Marca desconocida en el flujo: ${marcaId}`);
  return unidad;
}

export function claveFlujo(hecho: HechoFlujo, config: ConfigFlujo): ClaveFlujo {
  const unidadId = unidadDeMarcaEnFlujo(hecho.marca_id, config);
  const unidad = config.marcas.get(unidadId);
  if (!unidad) throw new Error(`Marca desconocida en el flujo: ${unidadId}`);

  if (unidad.marcada && unidad.vigente && unidad.modalidad === "barrido") {
    return { tipo: "barrido", marca_id: unidadId };
  }

  const nodoId = config.nodoDeEquivalencia.get(hecho.equivalencia_id);
  if (nodoId === undefined) throw new Error(`Equivalencia desconocida en el flujo: ${hecho.equivalencia_id}`);
  const conGml = unidad.modalidad === "por_gml" || unidad.modalidad === "mixta";
  const relevante = unidad.marcada && unidad.vigente && conGml && config.relevantes.has(claveRelevante(unidadId, nodoId));
  // M12: la venta de una mixta fuera de sus GML específicos va al flujo al barrer, no a "otras".
  if (unidad.marcada && unidad.vigente && unidad.modalidad === "mixta" && !relevante) {
    return { tipo: "barrido", marca_id: unidadId };
  }
  const abierto = config.nivelDeNodo.get(nodoId) === "GMLE";

  return {
    tipo: "unidad",
    gml_id: nodoId,
    equivalencia_id: abierto ? hecho.equivalencia_id : null,
    agrupacion_marca_id: unidad.agrupacion_marca_id,
    marca_id: relevante ? unidadId : null,
  };
}

/** Texto estable de una clave, para agrupar (`Map`) o ordenar. */
export function textoClaveFlujo(clave: ClaveFlujo): string {
  if (clave.tipo === "barrido") return `barrido|${clave.marca_id}`;
  return `unidad|${clave.gml_id}|${clave.equivalencia_id ?? ""}|${clave.agrupacion_marca_id}|${clave.marca_id ?? ""}`;
}
