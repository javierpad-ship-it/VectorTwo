import type { Tables } from "@/lib/supabase/database.types";
import { MUNDO_SIN_ASIGNAR, esTemporada, type Temporada } from "./normalizar";
import type {
  ArbolRespuesta,
  EquivalenciaArbol,
  GeneroArbol,
  LineaArbol,
  MundoArbol,
  ResumenArbol,
} from "./tipos";

/**
 * Arma la respuesta de `GET /api/arbol` a partir de las cinco tablas leídas
 * planas (docs/modulos/01-arbol-producto.md, reglas 12–15). Pura, sin I/O.
 */

export type GeneroEntrada = Pick<Tables<"generos">, "id" | "codigo" | "nombre" | "orden" | "activo">;
export type MundoEntrada = Pick<Tables<"mundos">, "id" | "codigo" | "nombre" | "orden" | "activo">;
export type LineaEntrada = Pick<Tables<"lineas">, "id" | "codigo" | "nombre" | "temporada" | "activo">;
export type NodoEntrada = Pick<Tables<"genero_mundo_linea">, "id" | "genero_id" | "mundo_id" | "linea_id" | "activo">;
export type EquivalenciaEntrada = Pick<
  Tables<"equivalencias">,
  "id" | "genero_mundo_linea_id" | "codigo" | "nombre" | "es_generica" | "activo"
>;

export type OpcionesArbol = { incluirInactivos: boolean };

const comparador = new Intl.Collator("es", { sensitivity: "base", numeric: true });

export function compararNombre(a: string, b: string): number {
  return comparador.compare(a, b);
}

/** Orden de catálogos fijos: `orden` ascendente y, a igualdad, `nombre`. */
export function compararOrdenNombre(a: { orden: number; nombre: string }, b: { orden: number; nombre: string }): number {
  return a.orden - b.orden || compararNombre(a.nombre, b.nombre);
}

/** Regla 13: la vigencia efectiva de un nodo es la conjunción de los cuatro `activo`. */
export function nodoVigente(
  nodo: Pick<NodoEntrada, "activo">,
  genero: Pick<GeneroEntrada, "activo">,
  mundo: Pick<MundoEntrada, "activo">,
  linea: Pick<LineaEntrada, "activo">
): boolean {
  return nodo.activo && genero.activo && mundo.activo && linea.activo;
}

/** Regla 14: reales por nombre, la genérica siempre al final. */
export function ordenarEquivalencias<T extends { nombre: string; es_generica: boolean }>(equivalencias: T[]): T[] {
  return [...equivalencias].sort((a, b) => {
    if (a.es_generica !== b.es_generica) return a.es_generica ? 1 : -1;
    return compararNombre(a.nombre, b.nombre);
  });
}

function temporadaDe(valor: string): Temporada {
  return esTemporada(valor) ? valor : "Todo el año";
}

export function armarArbol(
  generos: GeneroEntrada[],
  mundos: MundoEntrada[],
  lineas: LineaEntrada[],
  nodos: NodoEntrada[],
  equivalencias: EquivalenciaEntrada[],
  { incluirInactivos }: OpcionesArbol
): ArbolRespuesta {
  const visible = (fila: { activo: boolean }) => incluirInactivos || fila.activo;

  const generosOrdenados = generos.filter(visible).sort(compararOrdenNombre);
  const mundosOrdenados = mundos.filter(visible).sort(compararOrdenNombre);
  const lineasPorId = new Map(lineas.map((l) => [l.id, l]));

  const equivalenciasPorNodo = new Map<string, EquivalenciaArbol[]>();
  for (const e of equivalencias) {
    if (!visible(e)) continue;
    const lista = equivalenciasPorNodo.get(e.genero_mundo_linea_id) ?? [];
    lista.push({ id: e.id, codigo: e.codigo, nombre: e.nombre, es_generica: e.es_generica, activo: e.activo });
    equivalenciasPorNodo.set(e.genero_mundo_linea_id, lista);
  }

  const nodosPorGeneroMundo = new Map<string, NodoEntrada[]>();
  for (const n of nodos) {
    const clave = `${n.genero_id}|${n.mundo_id}`;
    const lista = nodosPorGeneroMundo.get(clave) ?? [];
    lista.push(n);
    nodosPorGeneroMundo.set(clave, lista);
  }

  const resumen: ResumenArbol = {
    generos: generosOrdenados.length,
    mundos: mundosOrdenados.length,
    lineas: 0,
    nodos: 0,
    equivalencias: 0,
    nodos_sin_asignar: 0,
  };
  const lineasDevueltas = new Set<string>();

  const salida: GeneroArbol[] = generosOrdenados.map((g) => {
    const mundosDelGenero: MundoArbol[] = mundosOrdenados.map((m) => {
      const esSinAsignar = m.codigo.toUpperCase() === MUNDO_SIN_ASIGNAR.codigo;
      const lineasDelMundo: LineaArbol[] = [];

      for (const n of nodosPorGeneroMundo.get(`${g.id}|${m.id}`) ?? []) {
        const linea = lineasPorId.get(n.linea_id);
        if (!linea) continue; // no puede pasar con la FK; se ignora por seguridad
        const vigente = nodoVigente(n, g, m, linea);
        if (!incluirInactivos && !vigente) continue;

        const eqs = ordenarEquivalencias(equivalenciasPorNodo.get(n.id) ?? []);
        lineasDelMundo.push({
          nodo_id: n.id,
          linea_id: linea.id,
          codigo: linea.codigo,
          nombre: linea.nombre,
          temporada: temporadaDe(linea.temporada),
          activo_linea: linea.activo,
          activo_nodo: n.activo,
          vigente,
          equivalencias: eqs,
        });

        resumen.nodos += 1;
        resumen.equivalencias += eqs.length;
        lineasDevueltas.add(linea.id);
        if (esSinAsignar) resumen.nodos_sin_asignar += 1;
      }

      lineasDelMundo.sort((a, b) => compararNombre(a.nombre, b.nombre));
      return { id: m.id, codigo: m.codigo, nombre: m.nombre, orden: m.orden, activo: m.activo, lineas: lineasDelMundo };
    });

    return { id: g.id, codigo: g.codigo, nombre: g.nombre, orden: g.orden, activo: g.activo, mundos: mundosDelGenero };
  });

  resumen.lineas = lineasDevueltas.size;
  return { generos: salida, resumen };
}
