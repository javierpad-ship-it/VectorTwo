import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { cargarEstadoNivel } from "@/lib/arbol/nivel/consultas";
import type { EstadoImportacionNivel } from "@/lib/arbol/nivel/importar";
import { indexarNodos } from "@/lib/arbol/nivel/indice";
import { leerAgrupacionesMarca, leerMarcasConAgrupacion, type MarcaLeida } from "../consultas";
import { armarFilasMarcas } from "../filas";
import type { MarcaFila } from "../tipos-api";
import { leerAsignaciones } from "./consultas";
import { contarAsignaciones, type EstadoVistaGml } from "./vista";

/**
 * Carga el estado completo que comparten los handlers de 02b (marcas con su
 * agrupación, agrupaciones, asignaciones por GML y el índice de nodos con su
 * vigencia y su nivel) y lo entrega ya en la forma de `EstadoVistaGml`.
 * Solo servidor: las lecturas son completas (un puñado de cientos de marcas,
 * ~556 nodos, pocos miles de asignaciones) y paginadas con `leerTodo`.
 */

type Db = SupabaseClient<Database>;

export type EstadoGmlCargado = {
  estado: EstadoVistaGml;
  marcas: MarcaLeida[];
  /** Géneros, mundos, líneas y nodos planos, tal como los pide `resolverGml`. */
  arbol: EstadoImportacionNivel;
};

export async function cargarEstadoGml(
  db: Db
): Promise<({ error: null } & EstadoGmlCargado) | ({ error: PostgrestError } & Partial<EstadoGmlCargado>)> {
  const [marcas, agrupaciones, asignaciones, nivel] = await Promise.all([
    leerMarcasConAgrupacion(db),
    leerAgrupacionesMarca(db),
    leerAsignaciones(db),
    cargarEstadoNivel(db),
  ]);
  const fallo = marcas.error ?? agrupaciones.error ?? asignaciones.error ?? nivel.error;
  if (fallo || !nivel.estado) return { error: fallo as PostgrestError };

  return {
    error: null,
    marcas: marcas.data,
    arbol: nivel.estado,
    estado: {
      marcas: marcas.data,
      agrupaciones: agrupaciones.data,
      asignaciones: asignaciones.data,
      nodos: indexarNodos({
        generos: nivel.estado.generos,
        mundos: nivel.estado.mundos,
        lineas: nivel.estado.lineas,
        nodos: nivel.estado.nodos,
      }),
    },
  };
}

/** Las filas de `/api/marcas` que se piden (todas si `ids` es `undefined`), con la unidad, los conjuntos y los conteos de GML. */
export function filasDeMarcas(cargado: EstadoGmlCargado, ids?: ReadonlySet<string>): MarcaFila[] {
  const conteos = contarAsignaciones(cargado.estado);
  const elegidas = ids ? cargado.marcas.filter((m) => ids.has(m.id)) : cargado.marcas;
  return armarFilasMarcas(elegidas, cargado.marcas, conteos);
}
