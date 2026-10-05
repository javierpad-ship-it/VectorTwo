import type { Tables } from "@/lib/supabase/database.types";
import {
  EQUIVALENCIA_GENERICA,
  MAX_CODIGO,
  aCodigo,
  esEquivalenciaGenerica,
  esEquivalenciaIgualALinea,
  normalizarNombre,
} from "./normalizar";
import type { ConteosCrear, ConteosExistentes, FilaImportacion, FilaOmitida, ReporteBase } from "./tipos";

/**
 * Importador del árbol (docs/modulos/01-arbol-producto.md, "Importador" y
 * reglas 5–11, 19). Dos funciones puras:
 *
 *   planificarImportacion(filas, estado) → plan + reporte, sin tocar nada.
 *   aplicarPlan(estado, plan)            → nuevo estado en memoria, para
 *                                           probar idempotencia sin base.
 *
 * El handler ejecuta el plan contra Supabase en tandas con `on conflict do
 * nothing`; si falla a mitad, reimportar completa el resto sin duplicar.
 */

export const MUESTRA_MAX = 20;
export const TANDA = 500;

export type GeneroEstado = Pick<Tables<"generos">, "id" | "codigo" | "nombre" | "activo">;
export type MundoEstado = Pick<Tables<"mundos">, "id" | "codigo" | "nombre" | "activo">;
export type LineaEstado = Pick<Tables<"lineas">, "id" | "codigo" | "nombre" | "activo">;
export type NodoEstado = Pick<Tables<"genero_mundo_linea">, "id" | "genero_id" | "mundo_id" | "linea_id" | "activo">;
export type EquivalenciaEstado = Pick<
  Tables<"equivalencias">,
  "id" | "genero_mundo_linea_id" | "nombre" | "codigo" | "es_generica" | "activo"
>;

/** Catálogos y nodos actuales, leídos planos de la base (o fabricados en los tests). */
export type EstadoImportacion = {
  generos: GeneroEstado[];
  mundos: MundoEstado[];
  lineas: LineaEstado[];
  nodos: NodoEstado[];
  equivalencias: EquivalenciaEstado[];
};

export type LineaNueva = { nombre: string; codigo: string };
/** La línea se referencia por nombre porque su id puede no existir todavía. */
export type NodoNuevo = { genero_id: string; mundo_id: string; linea_nombre: string };
export type EquivalenciaNueva = NodoNuevo & { nombre: string; codigo: string; es_generica: boolean };

export type PlanImportacion = {
  reporte: ReporteBase;
  lineas: LineaNueva[];
  nodos: NodoNuevo[];
  equivalencias: EquivalenciaNueva[];
};

type Catalogo = { id: string; codigo: string; nombre: string; activo: boolean };

/**
 * Busca un valor del archivo en un catálogo por `aCodigo(valor) = codigo` o
 * por `nombre`, sin mirar `activo`. Sirve para distinguir "no existe" de
 * "existe pero está inactivo".
 */
export function buscarEnCatalogo<T extends Catalogo>(catalogo: T[], valor: string): T | undefined {
  const nombre = normalizarNombre(valor);
  const codigo = aCodigo(valor);
  if (!nombre) return undefined;
  return (
    catalogo.find((c) => c.codigo.toUpperCase() === codigo && codigo !== "") ??
    catalogo.find((c) => normalizarNombre(c.nombre) === nombre)
  );
}

/** Como `buscarEnCatalogo`, pero solo entre los activos: los inactivos no reciben filas del importador. */
export function resolverCatalogo<T extends Catalogo>(catalogo: T[], valor: string): T | undefined {
  return buscarEnCatalogo(
    catalogo.filter((c) => c.activo),
    valor
  );
}

/** Código único dentro de un conjunto: si choca, agrega `_2`, `_3`, … sin pasar de MAX_CODIGO. */
export function codigoUnico(base: string, usados: Set<string>, respaldo = "SIN_CODIGO"): string {
  const inicial = base || respaldo;
  if (!usados.has(inicial)) return inicial;
  for (let n = 2; ; n++) {
    const sufijo = `_${n}`;
    const candidato = inicial.slice(0, MAX_CODIGO - sufijo.length).replace(/_+$/g, "") + sufijo;
    if (!usados.has(candidato)) return candidato;
  }
}

const claveNodo = (generoId: string, mundoId: string, lineaId: string) => `${generoId}|${mundoId}|${lineaId}`;
const claveEquivalencia = (nodoId: string, nombre: string) => `${nodoId}|${nombre}`;

export function planificarImportacion(filas: FilaImportacion[], estado: EstadoImportacion): PlanImportacion {
  const crear: ConteosCrear = {
    lineas: 0,
    nodos: 0,
    equivalencias: 0,
    equivalencias_genericas: 0,
    equivalencias_igual_a_linea: 0,
  };
  const existentes: ConteosExistentes = { lineas: 0, nodos: 0, equivalencias: 0 };
  const existentesInactivos: ConteosExistentes = { lineas: 0, nodos: 0, equivalencias: 0 };
  const omitidas: FilaOmitida[] = [];
  const muestra = { lineas: [] as string[], nodos: [] as string[] };
  const plan = { lineas: [] as LineaNueva[], nodos: [] as NodoNuevo[], equivalencias: [] as EquivalenciaNueva[] };

  // Índices del estado actual.
  const lineasPorNombre = new Map(estado.lineas.map((l) => [normalizarNombre(l.nombre), l]));
  const nodosPorClave = new Map(estado.nodos.map((n) => [claveNodo(n.genero_id, n.mundo_id, n.linea_id), n]));
  const equivalenciasPorClave = new Map<string, EquivalenciaEstado>();
  const genericaPorNodo = new Map<string, EquivalenciaEstado>();
  const codigosEqPorNodo = new Map<string, Set<string>>();
  for (const e of estado.equivalencias) {
    equivalenciasPorClave.set(claveEquivalencia(e.genero_mundo_linea_id, normalizarNombre(e.nombre)), e);
    if (e.es_generica) genericaPorNodo.set(e.genero_mundo_linea_id, e);
    const codigos = codigosEqPorNodo.get(e.genero_mundo_linea_id) ?? new Set<string>();
    codigos.add(e.codigo.toUpperCase());
    codigosEqPorNodo.set(e.genero_mundo_linea_id, codigos);
  }
  const codigosLinea = new Set(estado.lineas.map((l) => l.codigo.toUpperCase()));

  // Lo visto dentro del archivo (para contar cada entidad una vez). Las filas
  // guardan el número de su primera aparición para informar los duplicados.
  const clavesFila = new Map<string, number>();
  const lineasVistas = new Set<string>();
  const nodosVistos = new Set<string>();
  const codigosEqNuevosPorNodo = new Map<string, Set<string>>();

  let procesadas = 0;

  filas.forEach((cruda, i) => {
    const fila = i + 1;
    const generoTxt = normalizarNombre(cruda.genero);
    const mundoTxt = normalizarNombre(cruda.mundo);
    const lineaTxt = normalizarNombre(cruda.linea);
    const equivalenciaTxt = normalizarNombre(cruda.equivalencia);

    /** Anota la omisión con la fila completa, para que se pueda corregir el archivo. */
    const omitir = (motivo: FilaOmitida["motivo"], extra: Pick<FilaOmitida, "detalle" | "fila_original"> = {}) => {
      omitidas.push({
        fila,
        motivo,
        ...extra,
        genero: generoTxt,
        mundo: mundoTxt,
        linea: lineaTxt,
        equivalencia: equivalenciaTxt,
      });
    };

    if (!lineaTxt) return omitir("linea_vacia");
    if (generoTxt === "TOTAL") return omitir("fila_total");

    // Género y mundo se resuelven solo entre los activos; si el valor existe
    // pero está inactivo, la fila se omite con su propio motivo.
    const genero = resolverCatalogo(estado.generos, generoTxt);
    if (!genero) {
      const motivo = buscarEnCatalogo(estado.generos, generoTxt) ? "genero_inactivo" : "genero_desconocido";
      return omitir(motivo, { detalle: generoTxt });
    }

    // No existen líneas sin mundo: una fila con mundo en blanco es un error del archivo.
    if (!mundoTxt) return omitir("mundo_vacio");
    const mundo = resolverCatalogo(estado.mundos, mundoTxt);
    if (!mundo) {
      const motivo = buscarEnCatalogo(estado.mundos, mundoTxt) ? "mundo_inactivo" : "mundo_desconocido";
      return omitir(motivo, { detalle: mundoTxt });
    }

    // Vacío o "SIN EQUIVALENCIA" → la genérica del nodo. "-" → equivalencia
    // real que se llama igual que la línea: se resuelve aquí, antes de la
    // clave de duplicados, para que "-" y el nombre literal de la línea en el
    // mismo nodo sean la misma equivalencia (la segunda queda como duplicada).
    const esGenerica = esEquivalenciaGenerica(equivalenciaTxt);
    const equivalenciaNombre = esGenerica
      ? EQUIVALENCIA_GENERICA.nombre
      : esEquivalenciaIgualALinea(equivalenciaTxt)
        ? lineaTxt
        : equivalenciaTxt;
    const igualALinea = !esGenerica && equivalenciaNombre === lineaTxt;

    const claveFila = `${genero.id}|${mundo.id}|${lineaTxt}|${equivalenciaNombre}`;
    const filaOriginal = clavesFila.get(claveFila);
    if (filaOriginal !== undefined) return omitir("duplicada_en_archivo", { fila_original: filaOriginal });
    clavesFila.set(claveFila, fila);
    procesadas += 1;

    // Línea (catálogo, por nombre).
    const lineaExistente = lineasPorNombre.get(lineaTxt);
    if (!lineasVistas.has(lineaTxt)) {
      lineasVistas.add(lineaTxt);
      if (lineaExistente) {
        if (lineaExistente.activo) existentes.lineas += 1;
        else existentesInactivos.lineas += 1;
      } else {
        const codigo = codigoUnico(aCodigo(lineaTxt), codigosLinea, "LINEA");
        codigosLinea.add(codigo);
        plan.lineas.push({ nombre: lineaTxt, codigo });
        crear.lineas += 1;
        if (muestra.lineas.length < MUESTRA_MAX) muestra.lineas.push(lineaTxt);
      }
    }

    // Nodo (tripleta).
    const nodoExistente = lineaExistente
      ? nodosPorClave.get(claveNodo(genero.id, mundo.id, lineaExistente.id))
      : undefined;
    const claveNodoArchivo = `${genero.id}|${mundo.id}|${lineaTxt}`;
    if (!nodosVistos.has(claveNodoArchivo)) {
      nodosVistos.add(claveNodoArchivo);
      if (nodoExistente) {
        if (nodoExistente.activo) existentes.nodos += 1;
        else existentesInactivos.nodos += 1;
      } else {
        plan.nodos.push({ genero_id: genero.id, mundo_id: mundo.id, linea_nombre: lineaTxt });
        crear.nodos += 1;
        if (muestra.nodos.length < MUESTRA_MAX) {
          muestra.nodos.push(`${genero.codigo} / ${mundo.codigo} / ${lineaTxt}`);
        }
      }
    }

    // Equivalencia (por nodo y nombre; la genérica por bandera).
    const equivalenciaExistente = nodoExistente
      ? esGenerica
        ? (genericaPorNodo.get(nodoExistente.id) ??
          equivalenciasPorClave.get(claveEquivalencia(nodoExistente.id, equivalenciaNombre)))
        : equivalenciasPorClave.get(claveEquivalencia(nodoExistente.id, equivalenciaNombre))
      : undefined;

    if (equivalenciaExistente) {
      if (equivalenciaExistente.activo) existentes.equivalencias += 1;
      else existentesInactivos.equivalencias += 1;
      return;
    }

    // Códigos ya tomados en el nodo: los de la base (si el nodo existe) más los
    // que este mismo archivo ya asignó. El código de la genérica queda
    // reservado para las reales (una equivalencia real "SIN-EQUIVALENCIA"
    // derivaría a SIN_EQUIVALENCIA y chocaría con la genérica del nodo); la
    // genérica también pasa por `codigoUnico` por si la base ya tenía una real
    // con ese código. Así nunca hay dos filas con el mismo código en un nodo.
    const usados = codigosEqNuevosPorNodo.get(claveNodoArchivo) ?? new Set<string>();
    if (nodoExistente) for (const c of codigosEqPorNodo.get(nodoExistente.id) ?? []) usados.add(c);
    const codigo = esGenerica
      ? codigoUnico(EQUIVALENCIA_GENERICA.codigo, usados)
      : codigoUnico(aCodigo(equivalenciaNombre), new Set([...usados, EQUIVALENCIA_GENERICA.codigo]), "EQUIVALENCIA");
    usados.add(codigo);
    codigosEqNuevosPorNodo.set(claveNodoArchivo, usados);

    plan.equivalencias.push({
      genero_id: genero.id,
      mundo_id: mundo.id,
      linea_nombre: lineaTxt,
      nombre: equivalenciaNombre,
      codigo,
      es_generica: esGenerica,
    });
    if (esGenerica) crear.equivalencias_genericas += 1;
    else {
      crear.equivalencias += 1;
      if (igualALinea) crear.equivalencias_igual_a_linea = (crear.equivalencias_igual_a_linea ?? 0) + 1;
    }
  });

  const reporte: ReporteBase = {
    totales: { recibidas: filas.length, procesadas, omitidas: omitidas.length },
    crear,
    existentes,
    existentes_inactivos: existentesInactivos,
    omitidas,
    muestra,
  };
  return { reporte, ...plan };
}

/**
 * Aplica el plan en memoria con la misma semántica que `on conflict do
 * nothing`: lo que ya exista no se vuelve a crear ni se modifica. Devuelve un
 * estado nuevo; no muta el recibido. Los ids generados son deterministas.
 */
export function aplicarPlan(estado: EstadoImportacion, plan: PlanImportacion): EstadoImportacion {
  const lineas = [...estado.lineas];
  const lineasPorNombre = new Map(lineas.map((l) => [normalizarNombre(l.nombre), l]));
  plan.lineas.forEach((l, i) => {
    if (lineasPorNombre.has(l.nombre)) return;
    const nueva: LineaEstado = { id: `plan-linea-${i + 1}`, nombre: l.nombre, codigo: l.codigo, activo: true };
    lineas.push(nueva);
    lineasPorNombre.set(l.nombre, nueva);
  });

  const nodos = [...estado.nodos];
  const nodosPorClave = new Map(nodos.map((n) => [claveNodo(n.genero_id, n.mundo_id, n.linea_id), n]));
  plan.nodos.forEach((n, i) => {
    const linea = lineasPorNombre.get(n.linea_nombre);
    if (!linea) return;
    const clave = claveNodo(n.genero_id, n.mundo_id, linea.id);
    if (nodosPorClave.has(clave)) return;
    const nuevo: NodoEstado = {
      id: `plan-nodo-${i + 1}`,
      genero_id: n.genero_id,
      mundo_id: n.mundo_id,
      linea_id: linea.id,
      activo: true,
    };
    nodos.push(nuevo);
    nodosPorClave.set(clave, nuevo);
  });

  const equivalencias = [...estado.equivalencias];
  const equivalenciasPorClave = new Set(
    equivalencias.map((e) => claveEquivalencia(e.genero_mundo_linea_id, normalizarNombre(e.nombre)))
  );
  const genericas = new Set(equivalencias.filter((e) => e.es_generica).map((e) => e.genero_mundo_linea_id));
  plan.equivalencias.forEach((e, i) => {
    const linea = lineasPorNombre.get(e.linea_nombre);
    const nodo = linea && nodosPorClave.get(claveNodo(e.genero_id, e.mundo_id, linea.id));
    if (!nodo) return;
    const clave = claveEquivalencia(nodo.id, e.nombre);
    if (equivalenciasPorClave.has(clave) || (e.es_generica && genericas.has(nodo.id))) return;
    equivalencias.push({
      id: `plan-equivalencia-${i + 1}`,
      genero_mundo_linea_id: nodo.id,
      nombre: e.nombre,
      codigo: e.codigo,
      es_generica: e.es_generica,
      activo: true,
    });
    equivalenciasPorClave.add(clave);
    if (e.es_generica) genericas.add(nodo.id);
  });

  return { generos: estado.generos, mundos: estado.mundos, lineas, nodos, equivalencias };
}

/** Parte un arreglo en tandas de `tamano` (500 por defecto) para los upserts. */
export function enTandas<T>(items: T[], tamano = TANDA): T[][] {
  const tandas: T[][] = [];
  for (let i = 0; i < items.length; i += tamano) tandas.push(items.slice(i, i + tamano));
  return tandas;
}
