import type { NextResponse } from "next/server";
import { falla, listo, type Salida } from "@/lib/proyeccion/servicio-base";
import { MESES_CACHE_STOCK } from "./tipos";
import type { StockFlujoJson } from "./tipos";

/**
 * Cachés en memoria del flujo de M8 (ficha 08, §0.6, regla 24). Railway corre UNA instancia: la caché vive en el proceso y se pierde en
 * cada deploy (el frío tras un deploy es el peor caso). Todo se cachea por IDENTIDAD o por HUELLA, nunca por tiempo:
 *   - el stock de un mes, por `carga_id` (una carga publicada no cambia nunca; LRU de `MESES_CACHE_STOCK` meses);
 *   - cada lectura (cerrada, configuración, compras, reglas, repartos, parámetros), por la parte de `flujo_huella_base()` que la
 *     gobierna (`clavesCache`); solo se conserva la última: al cambiar la clave, se relee solo esa lectura;
 *   - el resultado completo, por `huellaCalculoFlujo` (las dos últimas).
 * Todas son *single-flight*: dos peticiones simultáneas con la misma clave comparten el trabajo. Un fallo NUNCA se guarda.
 * Memoria del proceso ≤ 50 MB: de ahí los topes de cada una.
 */

/**
 * Clon de una respuesta de error para cada quien espera el mismo trabajo (un `Response` solo se consume una vez). Una respuesta sin
 * `clone` (en las pruebas) se devuelve tal cual.
 */
function copiaDeRespuesta(r: NextResponse): NextResponse {
  return typeof r.clone === "function" ? (r.clone() as NextResponse) : r;
}

export class CacheLectura<V> {
  private readonly guardado = new Map<string, V>();
  private readonly vuelo = new Map<string, Promise<Salida<V>>>();

  constructor(readonly maximo: number) {}

  get tamano(): number {
    return this.guardado.size;
  }

  /** Lo guardado con esa clave (y la deja como la más reciente), o `undefined`. */
  leer(clave: string): V | undefined {
    const v = this.guardado.get(clave);
    if (v !== undefined) {
      this.guardado.delete(clave);
      this.guardado.set(clave, v);
    }
    return v;
  }

  guardar(clave: string, valor: V): void {
    this.guardado.delete(clave);
    this.guardado.set(clave, valor);
    while (this.guardado.size > this.maximo) {
      const masAntigua = this.guardado.keys().next().value;
      if (masAntigua === undefined) break;
      this.guardado.delete(masAntigua);
    }
  }

  /** Lo guardado, o lo que produzca `producir` (una sola vez aunque lleguen varias peticiones a la vez). Un fallo no se guarda. */
  obtener(clave: string, producir: () => Promise<Salida<V>>): Promise<Salida<V>> {
    const guardado = this.leer(clave);
    if (guardado !== undefined) return Promise.resolve(listo(guardado));
    let enVuelo = this.vuelo.get(clave);
    if (!enVuelo) {
      enVuelo = producir()
        .then((r) => {
          if (r.respuesta === null) this.guardar(clave, r.data);
          return r;
        })
        .finally(() => {
          this.vuelo.delete(clave);
        });
      this.vuelo.set(clave, enVuelo);
    }
    return enVuelo.then((r) => (r.respuesta === null ? r : falla(copiaDeRespuesta(r.respuesta))));
  }

  limpiar(): void {
    this.guardado.clear();
    this.vuelo.clear();
  }
}

/** Contadores de lecturas y cálculos reales (no de aciertos de caché): las pruebas de la regla 24 los comparan antes y después. */
export const contadores = {
  calculos: 0,
  cerrada: 0,
  configuracion: 0,
  compras: 0,
  reglas: 0,
  repartos: 0,
  parametros: 0,
  stock: 0,
  stock_filas: 0,
};

export type NombreContador = keyof typeof contadores;

export const contar = (nombre: NombreContador): void => {
  contadores[nombre] += 1;
};

/** Stock de un mes por `carga_id`: inmutable mientras la carga siga publicada (un mes reemplazado en M5 es otra carga). */
export const cacheStock = new CacheLectura<StockFlujoJson>(MESES_CACHE_STOCK);

/** Una caché de una sola entrada por lectura: la clave es la parte de la huella que la gobierna. */
export const cachesDeLectura = {
  cerrada: new CacheLectura<unknown>(1),
  configuracion: new CacheLectura<unknown>(1),
  compras: new CacheLectura<unknown>(1),
  reglas: new CacheLectura<unknown>(1),
  repartos: new CacheLectura<unknown>(1),
  parametros: new CacheLectura<unknown>(1),
  stock_filas: new CacheLectura<unknown>(1),
};

/** El resultado completo por `huellaCalculoFlujo` (las dos últimas: el cálculo es lo más pesado en memoria). */
export const cacheResultado = new CacheLectura<unknown>(2);

/** Una lectura cacheada y tipada: `obtener(nombre, clave, producir)`. */
export function lecturaCacheada<V>(nombre: keyof typeof cachesDeLectura, clave: string, producir: () => Promise<Salida<V>>): Promise<Salida<V>> {
  return (cachesDeLectura[nombre] as CacheLectura<V>).obtener(clave, producir);
}

/** Vacía todas las cachés y los contadores (las pruebas y nada más). */
export function reiniciarCaches(): void {
  cacheStock.limpiar();
  cacheResultado.limpiar();
  for (const c of Object.values(cachesDeLectura)) c.limpiar();
  for (const k of Object.keys(contadores) as NombreContador[]) contadores[k] = 0;
}
