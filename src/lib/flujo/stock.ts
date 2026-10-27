import type { Mes } from "@/lib/compras/tipos";
import { claveFlujo, type ConfigFlujo } from "@/lib/marcas/gml/flujo";
import { claveDeFila, mesDeFecha, type ClaveFila } from "./filas";
import type { StockFlujoJson } from "./tipos";

/**
 * Stock del flujo (ficha 08, regla 3 y §0.15). Pura: recibe lo que devuelve `stock_flujo(carga_id)` (un mes) y la configuración de
 * marcas de HOY (`ConfigFlujo`), y lo reparte entre las filas `(g, a)` con `claveFlujo`.
 *
 *  - El flujo futuro cuenta CD + tiendas ACTIVAS (`stock_cd + stock_tiendas`); las tiendas desactivadas se informan aparte
 *    (`stock_en_tiendas_inactivas`). La conciliación suma también las inactivas (cerrar una tienda y pasar su stock al CD no es un
 *    ingreso): `cadena = cd + tiendas + inactivas`.
 *  - La clave `barrido` se ubica en `(nodo de la equivalencia [× equivalencia si el nodo es GMLE], agrupación de la unidad de marca)`:
 *    BETA al barrer en DENIM cuenta en DENIM × PREMIUM (está físicamente ahí; no se descarta).
 *  - Lo que `claveFlujo` no puede ubicar (marca o equivalencia desconocida) NO rompe el cálculo: suma a `sin_clave`.
 *  - Un stock negativo (suma de tiendas) se trunca a 0 por fila (y por marca) con aviso `stock_negativo`.
 */

export type StockMarca = {
  /** CD y tiendas activas del flujo (si `cd + tiendas < 0`, ambos 0: el negativo se trunca por fila). */
  cd: number;
  tiendas: number;
  /** Tiendas desactivadas (solo para la conciliación). */
  inactivas: number;
  /** Venta del mes en unidades de las tiendas activas; las de las desactivadas van aparte. */
  unidades: number;
  unidades_inactivas: number;
  /** `max(0, cd + tiendas + inactivas)` sin truncar los componentes: el stock de cadena de la conciliación. */
  cadena: number;
  /** La suma de tiendas fue negativa y se truncó. */
  negativo: boolean;
};

export type StockFila = ClaveFila & StockMarca & {
  clave: string;
  /** Por unidad de marca (cabeza del conjunto): alimenta los subflujos y la conciliación por marca. */
  por_marca: Map<string, StockMarca>;
};

export type StockMes = {
  periodo: Mes;
  carga_id: string;
  /** `false`: la carga no está publicada; sin filas. */
  publicada: boolean;
  filas: Map<string, StockFila>;
  /** Tiendas desactivadas (informativo). */
  excluido: { stock: number; unidades: number };
  /** No se pudo ubicar en ninguna fila: stock de CD + tiendas activas y venta de las activas. */
  sin_clave: { stock: number; unidades: number };
};

type Acumulado = { cd: number; tiendas: number; inactivas: number; unidades: number; unidades_inactivas: number };

const vacio = (): Acumulado => ({ cd: 0, tiendas: 0, inactivas: 0, unidades: 0, unidades_inactivas: 0 });

function sumar(a: Acumulado, b: Acumulado): void {
  a.cd += b.cd;
  a.tiendas += b.tiendas;
  a.inactivas += b.inactivas;
  a.unidades += b.unidades;
  a.unidades_inactivas += b.unidades_inactivas;
}

/** Trunca el negativo de una fila o de una marca: si `cd + tiendas < 0` el flujo cuenta 0; la cadena nunca baja de 0. */
function cerrarMarca(a: Acumulado): StockMarca {
  const flujo = a.cd + a.tiendas;
  const negativo = flujo < 0 || flujo + a.inactivas < 0;
  return {
    cd: flujo < 0 ? 0 : a.cd,
    tiendas: flujo < 0 ? 0 : a.tiendas,
    inactivas: a.inactivas,
    unidades: a.unidades,
    unidades_inactivas: a.unidades_inactivas,
    cadena: Math.max(0, flujo + a.inactivas),
    negativo,
  };
}

/** El stock de la fila que cuenta en el flujo futuro (CD + tiendas activas, sin negativos). */
export const stockDelFlujo = (s: Pick<StockMarca, "cd" | "tiendas">): number => Math.max(0, s.cd + s.tiendas);

/** La venta del mes de la fila en la conciliación: activas e inactivas. */
export const ventaDeCadena = (s: Pick<StockMarca, "unidades" | "unidades_inactivas">): number => s.unidades + s.unidades_inactivas;

/** Dónde cae un hecho de stock: fila `(g, a)` o `null` si `claveFlujo` no lo ubica. */
export function filaDeHecho(marcaId: string, equivalenciaId: string, config: ConfigFlujo): ClaveFila | null {
  try {
    const clave = claveFlujo({ marca_id: marcaId, equivalencia_id: equivalenciaId }, config);
    if (clave.tipo === "unidad") {
      return { gml_id: clave.gml_id, equivalencia_id: clave.equivalencia_id, agrupacion_marca_id: clave.agrupacion_marca_id };
    }
    // `barrido`: la clave no trae GML. Va al nodo de la equivalencia y a la agrupación de la unidad de marca.
    const nodo = config.nodoDeEquivalencia.get(equivalenciaId);
    const unidadId = config.unidadDe.get(marcaId);
    const unidad = unidadId === undefined ? undefined : config.marcas.get(unidadId);
    if (nodo === undefined || !unidad) return null;
    return { gml_id: nodo, equivalencia_id: config.nivelDeNodo.get(nodo) === "GMLE" ? equivalenciaId : null, agrupacion_marca_id: unidad.agrupacion_marca_id };
  } catch {
    return null;
  }
}

/**
 * Regla 3: reparte las filas de `stock_flujo` de UN mes entre las filas `(g, a)` del flujo. Las filas con la misma `(equivalencia,
 * marca)` ya vienen agregadas; varias `(equivalencia, marca)` pueden caer en la misma fila y suman.
 */
export function stockPorFila(json: StockFlujoJson, config: ConfigFlujo): StockMes {
  const periodo = mesDeFecha(json.periodo);
  const salida: StockMes = { periodo, carga_id: json.carga_id, publicada: json.publicada, filas: new Map(), excluido: { stock: 0, unidades: 0 }, sin_clave: { stock: 0, unidades: 0 } };
  if (!json.publicada) return salida;
  salida.excluido = { stock: json.excluido?.stock ?? 0, unidades: json.excluido?.unidades ?? 0 };

  const acumulados = new Map<string, { clave: ClaveFila; total: Acumulado; marcas: Map<string, Acumulado> }>();
  for (const f of json.filas) {
    const [iEq, iMarca, cd, tiendas, unidades, inactivas, unidadesInactivas] = f;
    const equivalenciaId = json.equivalencias[iEq];
    const marcaId = json.marcas[iMarca];
    const parte: Acumulado = { cd, tiendas, unidades, inactivas, unidades_inactivas: unidadesInactivas };
    const fila = equivalenciaId === undefined || marcaId === undefined ? null : filaDeHecho(marcaId, equivalenciaId, config);
    if (!fila) {
      salida.sin_clave.stock += cd + tiendas;
      salida.sin_clave.unidades += unidades;
      continue;
    }
    const clave = claveDeFila(fila);
    let acc = acumulados.get(clave);
    if (!acc) {
      acc = { clave: fila, total: vacio(), marcas: new Map() };
      acumulados.set(clave, acc);
    }
    sumar(acc.total, parte);
    const delaMarca = acc.marcas.get(marcaId) ?? vacio();
    sumar(delaMarca, parte);
    acc.marcas.set(marcaId, delaMarca);
  }

  for (const [clave, acc] of acumulados) {
    const por_marca = new Map<string, StockMarca>();
    for (const [marcaId, a] of acc.marcas) por_marca.set(marcaId, cerrarMarca(a));
    salida.filas.set(clave, { ...acc.clave, clave, ...cerrarMarca(acc.total), por_marca });
  }
  return salida;
}

/** Stock y venta de una fila en un mes; ceros si el mes está publicado y la fila no tiene filas, `null` si el mes no está publicado. */
export function lecturaDeFila(mes: StockMes | undefined, clave: string): { fila: StockFila | null } | null {
  if (!mes || !mes.publicada) return null;
  return { fila: mes.filas.get(clave) ?? null };
}
