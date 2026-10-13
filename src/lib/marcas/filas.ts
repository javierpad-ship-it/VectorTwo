import type { Tables } from "@/lib/supabase/database.types";
import { compararNombre } from "@/lib/arbol/armar-arbol";
import { marcaVigente, modalidadEfectiva } from "./reglas";
import {
  avisosConjunto,
  marcasPorId,
  miembrosPorCabeza,
  unidadDeMarca,
  type AvisosDeConjunto,
  type MiembroParaAvisos,
} from "./conjuntos/reglas";
import type { AgrupacionMarcaEmbebida, AvisoConjunto, MarcaFila, Modalidad } from "./tipos-api";

/**
 * Arma las filas de `/api/marcas` con lo de 02b (modalidad, asignaciones por
 * GML y conjuntos). Pura: recibe las marcas ya leídas con su agrupación
 * embebida y los conteos de asignaciones (`contarAsignaciones`).
 */

/** Fila de `marcas` con la agrupación embebida, tal como la devuelve el `select` de la API. */
export type MarcaLeida = Tables<"marcas"> & { agrupacion_marca: AgrupacionMarcaEmbebida | null };

export type ConteoAsignaciones = { asignados: number; vigentes: number };

const modalidadDe = (v: string | null): Modalidad | null => (v === "por_gml" || v === "barrido" ? v : null);

/**
 * `todas` debe traer TODAS las marcas (activas e inactivas): la unidad, los
 * miembros y los avisos de conjunto se calculan sobre el conjunto completo,
 * aunque la respuesta solo devuelva algunas (`filas`).
 */
export function armarFilasMarcas(
  filas: readonly MarcaLeida[],
  todas: readonly MarcaLeida[],
  conteos: ReadonlyMap<string, ConteoAsignaciones>
): MarcaFila[] {
  const porId = marcasPorId(todas);
  const miembros = miembrosPorCabeza(todas);

  // Avisos por conjunto, una vez por cabeza.
  const avisosPorCabeza = new Map<string, AvisosDeConjunto>();
  for (const [cabezaId, lista] of miembros) {
    const cabeza = porId.get(cabezaId);
    if (!cabeza) continue;
    const paraAvisos: MiembroParaAvisos[] = lista.map((m) => ({
      ...m,
      gml_asignados: conteos.get(m.id)?.asignados ?? 0,
    }));
    avisosPorCabeza.set(cabezaId, avisosConjunto(cabeza, paraAvisos));
  }

  return filas.map((m) => {
    const agrupacion = m.agrupacion_marca ?? { id: m.agrupacion_marca_id, codigo: "", nombre: "", orden: 0, activo: false };
    const unidad = unidadDeMarca(m, todas);
    const cabeza = m.conjunto_marca_id ? porId.get(m.conjunto_marca_id) : undefined;
    const conteo = conteos.get(m.id) ?? { asignados: 0, vigentes: 0 };

    const avisos = new Set<AvisoConjunto>();
    if (m.conjunto_marca_id) for (const a of avisosPorCabeza.get(m.conjunto_marca_id)?.por_miembro.get(m.id) ?? []) avisos.add(a);
    for (const a of avisosPorCabeza.get(m.id)?.conjunto ?? []) avisos.add(a);

    return {
      id: m.id,
      codigo: m.codigo,
      nombre: m.nombre,
      agrupacion_marca_id: m.agrupacion_marca_id,
      tratamiento_especial: m.tratamiento_especial,
      nota_tratamiento: m.nota_tratamiento,
      activo: m.activo,
      created_at: m.created_at,
      updated_at: m.updated_at,
      agrupacion_marca: agrupacion,
      vigente: marcaVigente(m, agrupacion),
      modalidad_tratamiento: modalidadDe(m.modalidad_tratamiento),
      modalidad_efectiva: modalidadEfectiva(m),
      gml_asignados: conteo.asignados,
      gml_vigentes: conteo.vigentes,
      conjunto_marca_id: m.conjunto_marca_id,
      conjunto: cabeza ? { id: cabeza.id, nombre: cabeza.nombre, activo: cabeza.activo } : null,
      unidad_marca_id: unidad.unidad_marca_id,
      miembros: miembros.get(m.id)?.length ?? 0,
      avisos_conjunto: [...avisos].sort((a, b) => compararNombre(a, b)),
    };
  });
}

/**
 * Lo de 02b es configuración de planificación: el comprador (que no edita
 * maestros) no lo ve (pregunta 9 de la ficha). Se devuelve con valores neutros
 * para no romper el contrato de `MarcaFila`: modalidad, conjunto y GML quedan
 * como si la marca no los tuviera, y la unidad es ella misma.
 */
export function sinConfiguracionDePlanificacion(fila: MarcaFila): MarcaFila {
  return {
    ...fila,
    modalidad_tratamiento: null,
    modalidad_efectiva: null,
    gml_asignados: 0,
    gml_vigentes: 0,
    conjunto_marca_id: null,
    conjunto: null,
    unidad_marca_id: fila.id,
    miembros: 0,
    avisos_conjunto: [],
  };
}
