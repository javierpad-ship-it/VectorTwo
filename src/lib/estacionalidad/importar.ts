import type { Tables } from "@/lib/supabase/database.types";
import {
  EQUIVALENCIA_GENERICA,
  aCodigo,
  esEquivalenciaGenerica,
  esEquivalenciaIgualALinea,
  normalizarNombre,
} from "@/lib/arbol/normalizar";
import {
  buscarEnCatalogo,
  codigoUnico,
  resolverCatalogo,
  type EquivalenciaEstado,
  type EstadoImportacion,
  type GeneroEstado,
} from "@/lib/arbol/importar";
import { compararOrdenNombre, nodoVigente } from "@/lib/arbol/armar-arbol";
import { armarRuta } from "./aplanar";
import { generoPermitido } from "./reglas";
import type {
  AgrupacionAImportar,
  ConteosAsignar,
  FilaImportacionEstacionalidad,
  FilaOmitidaEstacionalidad,
  Reasignacion,
  ReporteImportacionEstacionalidadBase,
} from "./tipos";

/**
 * Importador de asignaciones de estacionalidad
 * (docs/modulos/03-agrupaciones-estacionalidad.md, "Importador de
 * asignaciones" y reglas 11–17). Dos funciones puras:
 *
 *   planificarImportacionEstacionalidad(filas, estado) → plan + reporte, sin tocar nada.
 *   aplicarPlanEstacionalidad(estado, plan)            → nuevo estado en memoria, para
 *                                                         probar idempotencia sin base.
 *
 * Crea las agrupaciones que no existan (son del planner, no catálogo raíz) y
 * asigna equivalencias; NUNCA crea líneas, nodos ni equivalencias, nunca
 * cambia `activo` de nada y nunca quita una agrupación. El archivo manda en
 * las reasignaciones y el reporte las muestra una por una.
 *
 * Géneros de la agrupación: una agrupación NUEVA se crea con los géneros
 * distintos de las filas procesadas que apuntan a ella. Una agrupación
 * EXISTENTE nunca amplía sus géneros: la fila cuyo género no incluye se omite
 * con `genero_no_incluido` y, si no tiene ninguno, con `agrupacion_sin_genero`.
 */

export { enTandas, TANDA } from "@/lib/arbol/importar";

export const REASIGNACIONES_MAX = 500;

export type AgrupacionEstado = Pick<Tables<"agrupaciones_estacionalidad">, "id" | "codigo" | "nombre" | "activo"> & {
  /** Géneros de la agrupación (`agrupacion_estacionalidad_genero`); vacío en las heredadas "sin género". */
  genero_ids: string[];
};
/** Género del estado; `orden` (si viene) ordena los nombres del reporte. */
export type GeneroEstadoEstacionalidad = GeneroEstado & { orden?: number };
export type EquivalenciaEstadoEstacionalidad = EquivalenciaEstado &
  Pick<Tables<"equivalencias">, "agrupacion_estacionalidad_id">;

/** El estado del árbol (activo e inactivo) más las agrupaciones; `cargarEstadoEstacionalidad` lo lee de la base. */
export type EstadoImportacionEstacionalidad = Omit<EstadoImportacion, "equivalencias" | "generos"> & {
  generos: GeneroEstadoEstacionalidad[];
  equivalencias: EquivalenciaEstadoEstacionalidad[];
  agrupaciones: AgrupacionEstado[];
};

/** Agrupación a crear con los ids de sus géneros (≥ 1 por construcción), en el orden del catálogo de géneros. */
export type AgrupacionNueva = { nombre: string; codigo: string; genero_ids: string[] };

/**
 * Una asignación a escribir. El destino se referencia por nombre normalizado
 * porque puede ser una agrupación nueva, sin id todavía; `agrupacion_id` viene
 * solo si ya existía. Nunca es nula (regla 13).
 */
export type AsignacionPlan = {
  equivalencia_id: string;
  agrupacion_nombre: string;
  agrupacion_id?: string;
  /** Para contar lo escrito por categoría al aplicar. */
  tipo: "nueva" | "reasignada";
};

export type PlanImportacionEstacionalidad = {
  reporte: ReporteImportacionEstacionalidadBase;
  agrupaciones_nuevas: AgrupacionNueva[];
  asignaciones: AsignacionPlan[];
};

type Catalogo = { id: string; codigo: string; nombre: string; activo: boolean };

/**
 * Busca una agrupación por nombre normalizado y, si no, por código
 * (`aCodigo(valor)`), sin mirar `activo`. Primero el nombre, a diferencia de
 * `buscarEnCatalogo`: dos nombres distintos pueden derivar al mismo código
 * (regla 14 les da `_2`), y para que reimportar sea idempotente el nombre
 * literal tiene que ganar sobre la coincidencia de código.
 */
export function buscarAgrupacion<T extends Catalogo>(agrupaciones: T[], valor: string): T | undefined {
  const nombre = normalizarNombre(valor);
  if (!nombre) return undefined;
  const codigo = aCodigo(valor);
  return (
    agrupaciones.find((a) => normalizarNombre(a.nombre) === nombre) ??
    (codigo ? agrupaciones.find((a) => a.codigo.toUpperCase() === codigo) : undefined)
  );
}

const claveNodo = (generoId: string, mundoId: string, lineaId: string) => `${generoId}|${mundoId}|${lineaId}`;
const claveEquivalencia = (nodoId: string, nombre: string) => `${nodoId}|${nombre}`;

export function planificarImportacionEstacionalidad(
  filas: FilaImportacionEstacionalidad[],
  estado: EstadoImportacionEstacionalidad
): PlanImportacionEstacionalidad {
  const asignar: ConteosAsignar = { nuevas: 0, reasignadas: 0, sin_cambio: 0 };
  const omitidas: FilaOmitidaEstacionalidad[] = [];
  const reasignaciones: Reasignacion[] = [];
  const asignaciones: AsignacionPlan[] = [];

  // Índices del estado actual.
  const lineasPorNombre = new Map(estado.lineas.map((l) => [normalizarNombre(l.nombre), l]));
  const nodosPorClave = new Map(estado.nodos.map((n) => [claveNodo(n.genero_id, n.mundo_id, n.linea_id), n]));
  const equivalenciasPorClave = new Map<string, EquivalenciaEstadoEstacionalidad>();
  const genericaPorNodo = new Map<string, EquivalenciaEstadoEstacionalidad>();
  for (const e of estado.equivalencias) {
    equivalenciasPorClave.set(claveEquivalencia(e.genero_mundo_linea_id, normalizarNombre(e.nombre)), e);
    if (e.es_generica) genericaPorNodo.set(e.genero_mundo_linea_id, e);
  }
  const agrupacionPorId = new Map(estado.agrupaciones.map((a) => [a.id, a]));
  const codigosAgrupacion = new Set(estado.agrupaciones.map((a) => a.codigo.toUpperCase()));

  // Lo visto dentro del archivo.
  const nuevasPorNombre = new Map<string, { nombre: string; codigo: string; equivalencias: number; generos: Set<string> }>();
  const vistas = new Map<string, { fila: number; agrupacion: string }>();

  let procesadas = 0;

  filas.forEach((cruda, i) => {
    const fila = i + 1;
    const generoTxt = normalizarNombre(cruda.genero);
    const mundoTxt = normalizarNombre(cruda.mundo);
    const lineaTxt = normalizarNombre(cruda.linea);
    const equivalenciaTxt = normalizarNombre(cruda.equivalencia);
    const agrupacionTxt = normalizarNombre(cruda.agrupacion);

    /** Anota la omisión con la fila completa, para que se pueda corregir el archivo. */
    const omitir = (
      motivo: FilaOmitidaEstacionalidad["motivo"],
      extra: Pick<FilaOmitidaEstacionalidad, "detalle" | "fila_original"> = {}
    ) => {
      omitidas.push({
        fila,
        motivo,
        ...extra,
        genero: generoTxt,
        mundo: mundoTxt,
        linea: lineaTxt,
        equivalencia: equivalenciaTxt,
        agrupacion: agrupacionTxt,
      });
    };

    // 1. Vacíos y fila de totales.
    if (!lineaTxt) return omitir("linea_vacia");
    if (generoTxt === "TOTAL") return omitir("fila_total");
    if (!agrupacionTxt) return omitir("agrupacion_vacia");

    // 2. Género y mundo, igual que el importador del árbol.
    const genero = resolverCatalogo(estado.generos, generoTxt);
    if (!genero) {
      const motivo = buscarEnCatalogo(estado.generos, generoTxt) ? "genero_inactivo" : "genero_desconocido";
      return omitir(motivo, { detalle: generoTxt });
    }
    if (!mundoTxt) return omitir("mundo_vacio");
    const mundo = resolverCatalogo(estado.mundos, mundoTxt);
    if (!mundo) {
      const motivo = buscarEnCatalogo(estado.mundos, mundoTxt) ? "mundo_inactivo" : "mundo_desconocido";
      return omitir(motivo, { detalle: mundoTxt });
    }

    // 3. Línea por nombre y nodo por tripleta; este importador no crea ninguno de los dos.
    const linea = lineasPorNombre.get(lineaTxt);
    if (!linea) return omitir("linea_desconocida", { detalle: lineaTxt });
    const nodo = nodosPorClave.get(claveNodo(genero.id, mundo.id, linea.id));
    const ruta = armarRuta(genero.nombre, mundo.nombre, linea.nombre);
    if (!nodo) return omitir("nodo_desconocido", { detalle: ruta });
    if (!nodoVigente(nodo, genero, mundo, linea)) return omitir("nodo_inactivo", { detalle: ruta });

    // 4. Equivalencia con la misma regla que el árbol: vacío → genérica, "-" → la que se llama como la línea.
    const esGenerica = esEquivalenciaGenerica(equivalenciaTxt);
    const equivalenciaNombre = esGenerica
      ? EQUIVALENCIA_GENERICA.nombre
      : esEquivalenciaIgualALinea(equivalenciaTxt)
        ? normalizarNombre(linea.nombre)
        : equivalenciaTxt;
    const equivalencia = esGenerica
      ? (genericaPorNodo.get(nodo.id) ?? equivalenciasPorClave.get(claveEquivalencia(nodo.id, equivalenciaNombre)))
      : equivalenciasPorClave.get(claveEquivalencia(nodo.id, equivalenciaNombre));
    if (!equivalencia) return omitir("equivalencia_desconocida", { detalle: equivalenciaNombre });
    if (!equivalencia.activo) return omitir("equivalencia_inactiva", { detalle: equivalenciaNombre });

    // 5. Agrupación: existente (activa o no) o nueva del archivo. Dentro del
    // archivo las nuevas se reconocen solo por nombre normalizado: dos
    // nombres distintos que derivan al mismo código son dos agrupaciones (la
    // segunda recibe `_2`, regla 14).
    const existente = buscarAgrupacion(estado.agrupaciones, agrupacionTxt);
    if (existente && !existente.activo) return omitir("agrupacion_inactiva", { detalle: existente.nombre });
    // Género de la agrupación existente: nunca se amplía desde el importador.
    if (existente && existente.genero_ids.length === 0) return omitir("agrupacion_sin_genero", { detalle: existente.nombre });
    if (existente && !generoPermitido(existente, genero.id)) return omitir("genero_no_incluido", { detalle: genero.nombre });
    const destinoNombre = existente ? normalizarNombre(existente.nombre) : agrupacionTxt;

    // 6. Duplicados dentro del archivo: gana la primera aparición. Va antes de
    // registrar la agrupación nueva para no crear una que ninguna fila
    // procesada use (p. ej. la de una fila contradictoria).
    const vista = vistas.get(equivalencia.id);
    if (vista) {
      if (vista.agrupacion === destinoNombre) return omitir("duplicada_en_archivo", { fila_original: vista.fila });
      return omitir("contradictoria_en_archivo", { fila_original: vista.fila, detalle: vista.agrupacion });
    }
    vistas.set(equivalencia.id, { fila, agrupacion: destinoNombre });
    procesadas += 1;

    const destinoId = existente?.id;
    if (!existente) {
      let nueva = nuevasPorNombre.get(agrupacionTxt);
      if (!nueva) {
        const codigo = codigoUnico(aCodigo(agrupacionTxt), codigosAgrupacion, "AGRUPACION");
        codigosAgrupacion.add(codigo);
        nueva = { nombre: agrupacionTxt, codigo, equivalencias: 0, generos: new Set() };
        nuevasPorNombre.set(agrupacionTxt, nueva);
      }
      nueva.equivalencias += 1;
      // Solo las filas procesadas aportan género: las duplicadas y contradictorias ya salieron arriba.
      nueva.generos.add(genero.id);
    }

    // 7. Comparar con la asignación actual. Nunca se quita una agrupación.
    const actualId = equivalencia.agrupacion_estacionalidad_id;
    if (actualId === null) {
      asignar.nuevas += 1;
      asignaciones.push({
        equivalencia_id: equivalencia.id,
        agrupacion_nombre: destinoNombre,
        agrupacion_id: destinoId,
        tipo: "nueva",
      });
      return;
    }
    if (destinoId !== undefined && actualId === destinoId) {
      asignar.sin_cambio += 1;
      return;
    }
    asignar.reasignadas += 1;
    const de = agrupacionPorId.get(actualId)?.nombre ?? actualId;
    if (reasignaciones.length < REASIGNACIONES_MAX) {
      reasignaciones.push({ ruta, equivalencia: equivalencia.nombre, de, a: destinoNombre });
    }
    asignaciones.push({
      equivalencia_id: equivalencia.id,
      agrupacion_nombre: destinoNombre,
      agrupacion_id: destinoId,
      tipo: "reasignada",
    });
  });

  // Géneros de cada agrupación nueva, ya completos, en el orden del catálogo de géneros (`orden, nombre`).
  const generosOrdenados = [...estado.generos].sort((a, b) =>
    compararOrdenNombre({ orden: a.orden ?? 0, nombre: a.nombre }, { orden: b.orden ?? 0, nombre: b.nombre })
  );
  const generosDe = (ids: Set<string>) => generosOrdenados.filter((g) => ids.has(g.id));
  const nuevas = [...nuevasPorNombre.values()];
  const agrupacionesNuevas: AgrupacionNueva[] = nuevas.map((n) => ({
    nombre: n.nombre,
    codigo: n.codigo,
    genero_ids: generosDe(n.generos).map((g) => g.id),
  }));
  const muestra: AgrupacionAImportar[] = nuevas.map((n) => ({
    nombre: n.nombre,
    codigo: n.codigo,
    equivalencias: n.equivalencias,
    generos: generosDe(n.generos).map((g) => g.nombre),
  }));

  const reporte: ReporteImportacionEstacionalidadBase = {
    totales: { recibidas: filas.length, procesadas, omitidas: omitidas.length },
    crear: { agrupaciones: agrupacionesNuevas.length },
    asignar,
    omitidas,
    reasignaciones,
    muestra: { agrupaciones: muestra },
  };
  return { reporte, agrupaciones_nuevas: agrupacionesNuevas, asignaciones };
}

/**
 * Aplica el plan en memoria con la misma semántica que el handler: las
 * agrupaciones nuevas se insertan con `on conflict do nothing` (si ya existe
 * una con ese nombre, se reutiliza y no se tocan sus géneros) y cada asignación
 * escribe la agrupación destino en su equivalencia. Devuelve un estado nuevo; no muta el recibido.
 * Los ids generados son deterministas.
 */
export function aplicarPlanEstacionalidad(
  estado: EstadoImportacionEstacionalidad,
  plan: PlanImportacionEstacionalidad
): EstadoImportacionEstacionalidad {
  const agrupaciones = [...estado.agrupaciones];
  const porNombre = new Map(agrupaciones.map((a) => [normalizarNombre(a.nombre), a]));
  plan.agrupaciones_nuevas.forEach((a, i) => {
    if (porNombre.has(a.nombre)) return;
    const nueva: AgrupacionEstado = {
      id: `plan-agrupacion-${i + 1}`,
      nombre: a.nombre,
      codigo: a.codigo,
      activo: true,
      genero_ids: [...a.genero_ids],
    };
    agrupaciones.push(nueva);
    porNombre.set(a.nombre, nueva);
  });

  const destinoPorEquivalencia = new Map<string, string>();
  for (const asignacion of plan.asignaciones) {
    const agrupacion = porNombre.get(asignacion.agrupacion_nombre);
    if (agrupacion) destinoPorEquivalencia.set(asignacion.equivalencia_id, agrupacion.id);
  }
  const equivalencias = estado.equivalencias.map((e) => {
    const destino = destinoPorEquivalencia.get(e.id);
    return destino === undefined ? e : { ...e, agrupacion_estacionalidad_id: destino };
  });

  return { ...estado, agrupaciones, equivalencias };
}
