import { normalizarNombre } from "../normalizar";
import {
  buscarEnCatalogo,
  resolverCatalogo,
  type GeneroEstado,
  type LineaEstado,
  type MundoEstado,
  type NodoEstado,
} from "../importar";
import type { MotivoResolverGml } from "../tipos";

/**
 * `resolverGml` (regla 4 de 02b): la UNICA función que traduce las columnas
 * `GENERO, MUNDO, LINEA` de un archivo a un nodo género-mundo-línea. La
 * comparten el importador de niveles de planificación y el de marcas relevantes
 * por GML, así que ante la misma fila devuelven siempre el mismo motivo.
 *
 * Resuelve género, mundo y línea por código o por nombre solo entre los
 * activos, distingue "inactivo" de "desconocido" y busca el nodo por la
 * tripleta. NUNCA crea árbol. Pura.
 */

export type EstadoResolverGml = {
  generos: GeneroEstado[];
  mundos: MundoEstado[];
  lineas: LineaEstado[];
  nodos: NodoEstado[];
};

export type FilaGml = { genero: string; mundo: string; linea: string };

type Textos = { generoTxt: string; mundoTxt: string; lineaTxt: string };

export type ResultadoResolverGml =
  | (Textos & { ok: true; genero: GeneroEstado; mundo: MundoEstado; linea: LineaEstado; nodo: NodoEstado })
  | (Textos & { ok: false; motivo: MotivoResolverGml; detalle?: string });

const cacheNodos = new WeakMap<NodoEstado[], Map<string, NodoEstado>>();

function nodosPorTripleta(nodos: NodoEstado[]): Map<string, NodoEstado> {
  let mapa = cacheNodos.get(nodos);
  if (!mapa) {
    mapa = new Map(nodos.map((n) => [`${n.genero_id}|${n.mundo_id}|${n.linea_id}`, n]));
    cacheNodos.set(nodos, mapa);
  }
  return mapa;
}

export function resolverGml(fila: FilaGml, estado: EstadoResolverGml): ResultadoResolverGml {
  const generoTxt = normalizarNombre(fila.genero);
  const mundoTxt = normalizarNombre(fila.mundo);
  const lineaTxt = normalizarNombre(fila.linea);
  const textos: Textos = { generoTxt, mundoTxt, lineaTxt };
  const fallo = (motivo: MotivoResolverGml, detalle?: string): ResultadoResolverGml => ({
    ok: false,
    motivo,
    ...(detalle === undefined ? {} : { detalle }),
    ...textos,
  });

  if (generoTxt === "TOTAL") return fallo("fila_total");

  if (!generoTxt) return fallo("genero_vacio");
  const genero = resolverCatalogo(estado.generos, generoTxt);
  if (!genero) {
    return fallo(buscarEnCatalogo(estado.generos, generoTxt) ? "genero_inactivo" : "genero_desconocido", generoTxt);
  }

  if (!mundoTxt) return fallo("mundo_vacio");
  const mundo = resolverCatalogo(estado.mundos, mundoTxt);
  if (!mundo) {
    return fallo(buscarEnCatalogo(estado.mundos, mundoTxt) ? "mundo_inactivo" : "mundo_desconocido", mundoTxt);
  }

  if (!lineaTxt) return fallo("linea_vacia");
  const linea = resolverCatalogo(estado.lineas, lineaTxt);
  if (!linea) {
    return fallo(buscarEnCatalogo(estado.lineas, lineaTxt) ? "linea_inactiva" : "linea_desconocida", lineaTxt);
  }

  const nodo = nodosPorTripleta(estado.nodos).get(`${genero.id}|${mundo.id}|${linea.id}`);
  if (!nodo) return fallo("gml_inexistente", `${lineaTxt} no está en ${genero.nombre} · ${mundo.nombre}`);
  if (!nodo.activo) return fallo("gml_inactivo", `${linea.nombre} está inactiva en ${genero.nombre} · ${mundo.nombre}`);

  return { ok: true, genero, mundo, linea, nodo, ...textos };
}
