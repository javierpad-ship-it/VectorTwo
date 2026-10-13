import type { Tables } from "@/lib/supabase/database.types";
import { MUESTRA_MAX } from "../importar";
import type {
  CambioNivel,
  FilaImportacionNivel,
  FilaOmitidaNivel,
  MotivoOmisionNivel,
  NivelPlanificacion,
  ReporteNivelBase,
} from "../tipos";
import { normalizarNombre } from "../normalizar";
import { nivelDeNodo } from "../armar-arbol";
import { leerNivel } from "./reglas";
import { resolverGml, type EstadoResolverGml } from "./resolver";

/**
 * Importador de niveles de planificación (02b, regla 3). Dos funciones puras:
 *
 *   planificarImportacionNivel(filas, estado) → plan + reporte, sin tocar nada.
 *   aplicarPlanNivel(estado, plan)            → nuevo estado en memoria, para
 *                                               probar idempotencia sin base.
 *
 * Aquí EL ARCHIVO MANDA (como el importador de estacionalidad al reasignar): un
 * nodo con nivel distinto se cambia y el reporte lo lista (`de → a`); los nodos
 * ausentes del archivo no se tocan; nunca crea árbol. Reimportar no cambia nada.
 */

export { MUESTRA_MAX };

export type NodoEstadoNivel = EstadoResolverGml["nodos"][number] &
  Partial<Pick<Tables<"genero_mundo_linea">, "nivel_planificacion">>;

export type EstadoImportacionNivel = Omit<EstadoResolverGml, "nodos"> & { nodos: NodoEstadoNivel[] };

/** Un nodo y el nivel que se le escribirá. */
export type CambioNivelPlan = { nodo_id: string; nivel: NivelPlanificacion };

export type PlanImportacionNivel = { reporte: ReporteNivelBase; cambios: CambioNivelPlan[] };

export function planificarImportacionNivel(
  filas: FilaImportacionNivel[],
  estado: EstadoImportacionNivel
): PlanImportacionNivel {
  const omitidas: FilaOmitidaNivel[] = [];
  const cambios: CambioNivel[] = [];
  const plan: CambioNivelPlan[] = [];
  const muestra: string[] = [];
  const nodoPorId = new Map(estado.nodos.map((n) => [n.id, n]));
  /** nodo → fila de su primera aparición y el nivel pedido. */
  const vistos = new Map<string, { fila: number; nivel: NivelPlanificacion }>();
  let sinCambio = 0;
  let procesadas = 0;

  filas.forEach((cruda, i) => {
    const fila = i + 1;
    const nivelTxt = normalizarNombre(cruda.nivel);
    const omitir = (
      motivo: MotivoOmisionNivel,
      textos: { generoTxt: string; mundoTxt: string; lineaTxt: string },
      extra: Pick<FilaOmitidaNivel, "detalle" | "fila_original"> = {}
    ) => {
      omitidas.push({
        fila,
        motivo,
        ...extra,
        genero: textos.generoTxt,
        mundo: textos.mundoTxt,
        linea: textos.lineaTxt,
        nivel: nivelTxt,
      });
    };

    const resuelto = resolverGml(cruda, estado);
    if (!resuelto.ok) return omitir(resuelto.motivo, resuelto, resuelto.detalle === undefined ? {} : { detalle: resuelto.detalle });

    if (!nivelTxt) return omitir("nivel_vacio", resuelto);
    const nivel = leerNivel(nivelTxt);
    if (nivel === null) return omitir("nivel_invalido", resuelto, { detalle: nivelTxt });

    const previo = vistos.get(resuelto.nodo.id);
    if (previo) {
      return omitir("duplicada_en_archivo", resuelto, {
        fila_original: previo.fila,
        ...(previo.nivel !== nivel ? { detalle: `nivel distinto: ${nivel}` } : {}),
      });
    }
    vistos.set(resuelto.nodo.id, { fila, nivel });
    procesadas += 1;

    const actual = nivelDeNodo(nodoPorId.get(resuelto.nodo.id) ?? {});
    if (actual === nivel) {
      sinCambio += 1;
      return;
    }
    const ruta = `${resuelto.genero.nombre} · ${resuelto.mundo.nombre} · ${resuelto.linea.nombre}`;
    cambios.push({ fila, ruta, de: actual, a: nivel });
    plan.push({ nodo_id: resuelto.nodo.id, nivel });
    if (muestra.length < MUESTRA_MAX) muestra.push(`${ruta}: ${actual} → ${nivel}`);
  });

  return {
    reporte: {
      totales: { recibidas: filas.length, procesadas, omitidas: omitidas.length },
      cambios,
      sin_cambio: sinCambio,
      omitidas,
      muestra: { cambios: muestra },
    },
    cambios: plan,
  };
}

/** Aplica el plan en memoria (no muta el estado recibido). */
export function aplicarPlanNivel(estado: EstadoImportacionNivel, plan: PlanImportacionNivel): EstadoImportacionNivel {
  const nuevo = new Map(plan.cambios.map((c) => [c.nodo_id, c.nivel]));
  return {
    ...estado,
    nodos: estado.nodos.map((n) => (nuevo.has(n.id) ? { ...n, nivel_planificacion: nuevo.get(n.id) } : n)),
  };
}
