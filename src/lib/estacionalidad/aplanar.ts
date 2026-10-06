import type { Tables } from "@/lib/supabase/database.types";
import {
  compararNombre,
  compararOrdenNombre,
  nodoVigente,
  ordenarEquivalencias,
  type EquivalenciaEntrada,
  type GeneroEntrada,
  type LineaEntrada,
  type MundoEntrada,
  type NodoEntrada,
} from "@/lib/arbol/armar-arbol";
import { esTemporada } from "@/lib/arbol/normalizar";
import { motivoFaltante } from "./reglas";
import type { EquivalenciaPlana, ReporteEstacionalidad, ResumenEstacionalidad } from "./tipos";

/**
 * Lista plana de equivalencias con su ruta y su agrupación de estacionalidad
 * (docs/modulos/03-agrupaciones-estacionalidad.md, "Lista plana y faltantes",
 * reglas 7–10). Una sola función pura alimenta `GET /api/estacionalidad/equivalencias`
 * y `GET /api/estacionalidad/faltantes`.
 */

export type AgrupacionPlanaEntrada = Pick<Tables<"agrupaciones_estacionalidad">, "id" | "codigo" | "nombre" | "orden" | "activo">;

/** Las cinco tablas del árbol, planas (el `EstadoArbol` de `cargarEstadoArbol` encaja aquí). */
export type EstadoAplanar = {
  generos: GeneroEntrada[];
  mundos: MundoEntrada[];
  lineas: LineaEntrada[];
  nodos: NodoEntrada[];
  equivalencias: EquivalenciaEntrada[];
};

export type OpcionesAplanar = {
  /** Sin él solo salen las equivalencias activas en nodos vigentes (regla 8). */
  incluirInactivos: boolean;
  /** Solo las filas con `faltante: true` (regla 7); el resumen cuenta lo devuelto. */
  soloFaltantes?: boolean;
};

export function armarRuta(genero: string, mundo: string, linea: string): string {
  return `${genero} / ${mundo} / ${linea}`;
}

export function aplanarEquivalencias(
  estado: EstadoAplanar,
  agrupaciones: AgrupacionPlanaEntrada[],
  { incluirInactivos, soloFaltantes = false }: OpcionesAplanar
): ReporteEstacionalidad {
  const generosOrdenados = [...estado.generos].sort(compararOrdenNombre);
  const mundosOrdenados = [...estado.mundos].sort(compararOrdenNombre);
  const lineasOrdenadas = [...estado.lineas].sort((a, b) => compararNombre(a.nombre, b.nombre));
  const agrupacionesOrdenadas = [...agrupaciones].sort(compararOrdenNombre);

  const lineasPorId = new Map(estado.lineas.map((l) => [l.id, l]));
  const agrupacionPorId = new Map(agrupaciones.map((a) => [a.id, a]));

  const equivalenciasPorNodo = new Map<string, EquivalenciaEntrada[]>();
  for (const e of estado.equivalencias) {
    const lista = equivalenciasPorNodo.get(e.genero_mundo_linea_id) ?? [];
    lista.push(e);
    equivalenciasPorNodo.set(e.genero_mundo_linea_id, lista);
  }

  const nodosPorGeneroMundo = new Map<string, NodoEntrada[]>();
  for (const n of estado.nodos) {
    const clave = `${n.genero_id}|${n.mundo_id}`;
    const lista = nodosPorGeneroMundo.get(clave) ?? [];
    lista.push(n);
    nodosPorGeneroMundo.set(clave, lista);
  }

  const filas: EquivalenciaPlana[] = [];
  const resumen: ResumenEstacionalidad = {
    equivalencias: 0,
    con_agrupacion: 0,
    faltantes: 0,
    faltantes_genericas: 0,
    faltantes_por_agrupacion_inactiva: 0,
  };

  for (const g of generosOrdenados) {
    for (const m of mundosOrdenados) {
      const nodos = (nodosPorGeneroMundo.get(`${g.id}|${m.id}`) ?? [])
        .map((n) => ({ nodo: n, linea: lineasPorId.get(n.linea_id) }))
        .filter((x): x is { nodo: NodoEntrada; linea: LineaEntrada } => Boolean(x.linea))
        .sort((a, b) => compararNombre(a.linea.nombre, b.linea.nombre));

      for (const { nodo, linea } of nodos) {
        const vigente = nodoVigente(nodo, g, m, linea);
        const ruta = armarRuta(g.nombre, m.nombre, linea.nombre);

        for (const e of ordenarEquivalencias(equivalenciasPorNodo.get(nodo.id) ?? [])) {
          if (!incluirInactivos && (!e.activo || !vigente)) continue;

          // Una agrupación que no esté en la lista (imposible con la FK) se trata como "sin agrupación".
          const agrupacion = e.agrupacion_estacionalidad_id
            ? agrupacionPorId.get(e.agrupacion_estacionalidad_id)
            : undefined;
          const motivo = motivoFaltante(e, vigente, agrupacion);
          if (soloFaltantes && motivo === null) continue;

          filas.push({
            id: e.id,
            codigo: e.codigo,
            nombre: e.nombre,
            es_generica: e.es_generica,
            activo: e.activo,
            nodo_id: nodo.id,
            genero_id: g.id,
            mundo_id: m.id,
            linea_id: linea.id,
            vigente,
            ruta,
            agrupacion: agrupacion
              ? { id: agrupacion.id, codigo: agrupacion.codigo, nombre: agrupacion.nombre, activo: agrupacion.activo }
              : null,
            faltante: motivo !== null,
            motivo_faltante: motivo,
          });

          resumen.equivalencias += 1;
          if (agrupacion) resumen.con_agrupacion += 1;
          if (motivo !== null) {
            resumen.faltantes += 1;
            if (e.es_generica) resumen.faltantes_genericas += 1;
            if (motivo === "agrupacion_inactiva") resumen.faltantes_por_agrupacion_inactiva += 1;
          }
        }
      }
    }
  }

  return {
    equivalencias: filas,
    generos: generosOrdenados.map((g) => ({ id: g.id, codigo: g.codigo, nombre: g.nombre, orden: g.orden, activo: g.activo })),
    mundos: mundosOrdenados.map((m) => ({ id: m.id, codigo: m.codigo, nombre: m.nombre, orden: m.orden, activo: m.activo })),
    lineas: lineasOrdenadas.map((l) => ({
      id: l.id,
      codigo: l.codigo,
      nombre: l.nombre,
      temporada: esTemporada(l.temporada) ? l.temporada : "Todo el año",
      activo: l.activo,
    })),
    agrupaciones: agrupacionesOrdenadas.map((a) => ({
      id: a.id,
      codigo: a.codigo,
      nombre: a.nombre,
      orden: a.orden,
      activo: a.activo,
    })),
    resumen,
  };
}
