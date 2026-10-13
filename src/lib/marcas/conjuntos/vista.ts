import { compararNombre } from "@/lib/arbol/armar-arbol";
import { modalidadEfectiva } from "../reglas";
import {
  avisosConjunto,
  marcasPorId,
  miembrosPorCabeza,
  resumenConjuntos,
  type MarcaConjunto,
  type MiembroParaAvisos,
} from "./reglas";
import type { AvisoConjunto, ConjuntoFila, Modalidad, RespuestaConjuntos } from "../tipos-api";

/**
 * Armado de `GET /api/marcas/conjuntos` (02b, regla 22): una fila por cabeza con
 * al menos un miembro, por nombre. Pura: el handler aporta las marcas, los
 * conteos de GML y qué marcas tienen venta (`vende`, que sale de M5 por el
 * índice de marca).
 */

export type MarcaParaConjuntos = MarcaConjunto & {
  codigo: string;
  tratamiento_especial: boolean;
  modalidad_tratamiento: string | null;
};

export type AgrupacionParaConjuntos = { id: string; nombre: string };

export type ConteosGml = { asignados: number; vigentes: number };

export function armarVistaConjuntos(
  marcas: readonly MarcaParaConjuntos[],
  agrupaciones: readonly AgrupacionParaConjuntos[],
  gml: ReadonlyMap<string, ConteosGml>,
  vende: ReadonlySet<string>
): RespuestaConjuntos {
  const porId = marcasPorId(marcas);
  const agrupacionPorId = new Map(agrupaciones.map((a) => [a.id, a]));
  const miembros = miembrosPorCabeza(marcas);
  const agr = (id: string) => ({ id, nombre: agrupacionPorId.get(id)?.nombre ?? "" });

  const conjuntos: ConjuntoFila[] = [];
  for (const [cabezaId, lista] of miembros) {
    const cabeza = porId.get(cabezaId);
    if (!cabeza) continue;
    const paraAvisos: MiembroParaAvisos[] = lista.map((m) => ({ ...m, gml_asignados: gml.get(m.id)?.asignados ?? 0 }));
    const avisos = avisosConjunto(cabeza, paraAvisos);
    const modalidad: Modalidad | null = modalidadEfectiva(cabeza);
    conjuntos.push({
      cabeza: {
        id: cabeza.id,
        nombre: cabeza.nombre,
        codigo: cabeza.codigo,
        activo: cabeza.activo,
        agrupacion_marca: agr(cabeza.agrupacion_marca_id),
        tratamiento_especial: cabeza.tratamiento_especial,
        modalidad_efectiva: modalidad,
        gml_vigentes: gml.get(cabeza.id)?.vigentes ?? 0,
        vende: vende.has(cabeza.id),
      },
      miembros: [...lista]
        .sort((a, b) => compararNombre(a.nombre, b.nombre) || (a.id < b.id ? -1 : 1))
        .map((m) => ({
          id: m.id,
          nombre: m.nombre,
          activo: m.activo,
          agrupacion_marca: agr(m.agrupacion_marca_id),
          avisos: (avisos.por_miembro.get(m.id) ?? []) as AvisoConjunto[],
        })),
      efectivo: cabeza.activo,
      avisos: avisos.conjunto,
    });
  }
  conjuntos.sort((a, b) => compararNombre(a.cabeza.nombre, b.cabeza.nombre) || (a.cabeza.id < b.cabeza.id ? -1 : 1));
  return { conjuntos, resumen: resumenConjuntos(conjuntos) };
}
