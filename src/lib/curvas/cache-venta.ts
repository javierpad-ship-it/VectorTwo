import { huellaCargas } from "./huellas";
import type { VentaEstacionalidad } from "./agregado";

/**
 * Caché de lectura de venta (docs/modulos/06b-curvas-trabajo-por-agrupacion.md,
 * "Caché de lectura"): la salida de `venta_estacionalidad_agrupacion(id)` ya leída y
 * validada se guarda en la memoria del proceso (Railway es un proceso persistente)
 * con clave `id | cargas_huella | composicion | huella_temporada`, caduca a los
 * 120 s y conserva a lo sumo 20 entradas (la menos usada sale primero). Mover un
 * parámetro de una agrupación no vuelve a leer la venta: el modelo corre en
 * milisegundos sobre la misma lectura.
 *
 * Nunca devuelve un estado distinto del que la clave describe: las tres huellas salen
 * de lecturas pequeñas que el handler hace siempre, y si la función devuelve cargas
 * distintas de las de la clave (una publicación en medio) la entrada se guarda bajo
 * la clave REAL. Las lecturas en curso de la misma clave se juntan (una sola llamada a
 * la base) y a lo sumo `MAX_LECTURAS_SIMULTANEAS` corren a la vez; lo guardado se congela
 * en profundidad (quien lo lee no puede alterar lo que ve el siguiente). No importa nada de `@supabase/*`: la lectura la inyecta el que llama
 * (`consultas.ts` es el único que nombra la función de la base).
 */

export const TTL_CACHE_VENTA_MS = 120_000;
/** TTL de las lecturas de Años Niño y `/anios`: dependen de la composición de TODAS las agrupaciones, que la clave no cubre. */
export const TTL_CACHE_VENTA_NINO_MS = 15_000;
export const MAX_ENTRADAS_CACHE_VENTA = 20;
export const MAX_LECTURAS_SIMULTANEAS = 3;

export type ClaveVenta = {
  /** `null` = sin agrupación (Años Niño). */
  id: string | null;
  /** md5 de `{ "aaaa-mm": carga_id }` de TODOS los meses publicados (`huellaCargas`). */
  cargas_huella: string;
  /** `composicion.huella` de la agrupación (`""` si no hay agrupación). */
  composicion: string;
  huella_temporada: string;
};

export function claveVenta(c: ClaveVenta): string {
  return [c.id ?? "-", c.cargas_huella, c.composicion || "-", c.huella_temporada || "-"].join(" | ");
}

/** Congela un valor y todo lo que cuelga de él (objetos y arreglos). */
function congelarEnProfundidad<T>(valor: T): T {
  if (valor !== null && typeof valor === "object" && !Object.isFrozen(valor)) {
    Object.freeze(valor);
    for (const hijo of Object.values(valor as Record<string, unknown>)) congelarEnProfundidad(hijo);
  }
  return valor;
}

type Entrada = { venta: VentaEstacionalidad; expira: number };
const cache = new Map<string, Entrada>();
const enCurso = new Map<string, Promise<LecturaVenta<unknown>>>();
let activas = 0;
const esperando: (() => void)[] = [];

/** Solo para pruebas y para forzar una lectura nueva. */
export function vaciarCacheVenta(): void {
  cache.clear();
  enCurso.clear();
}

export function tamanioCacheVenta(): number {
  return cache.size;
}

export type LecturaVenta<E> = { data: VentaEstacionalidad | null; error: E | null };

async function conCupo<T>(trabajo: () => Promise<T>): Promise<T> {
  if (activas >= MAX_LECTURAS_SIMULTANEAS) await new Promise<void>((resolver) => esperando.push(resolver));
  activas += 1;
  try {
    return await trabajo();
  } finally {
    activas -= 1;
    esperando.shift()?.();
  }
}

/**
 * La venta de la clave si está y no caducó; si no, `cargar()` (una llamada a la
 * función de la base) y la guarda. `cacheada` dice si salió de la memoria. Con
 * error o respuesta inválida no se guarda nada. Si ya hay una lectura de esa clave en
 * curso, se espera a esa en vez de lanzar otra. `ttl_ms` cambia cuánto vive lo que se guarda.
 */
export async function leerVentaAgrupacionCacheada<E>(
  clave: ClaveVenta,
  cargar: () => Promise<LecturaVenta<E>>,
  opciones: { ahora?: () => number; ttl_ms?: number } = {}
): Promise<LecturaVenta<E> & { cacheada: boolean }> {
  const ahora = opciones.ahora ?? Date.now;
  const k = claveVenta(clave);
  const guardada = cache.get(k);
  if (guardada && guardada.expira > ahora()) {
    // Reinsertar la deja como la más reciente (LRU).
    cache.delete(k);
    cache.set(k, guardada);
    return { data: guardada.venta, error: null, cacheada: true };
  }
  if (guardada) cache.delete(k);

  const pendiente = enCurso.get(k) as Promise<LecturaVenta<E>> | undefined;
  if (pendiente) return { ...(await pendiente), cacheada: false };

  const lectura = conCupo(async () => {
    const leida = await cargar();
    if (leida.error || !leida.data) return leida;
    const venta = congelarEnProfundidad(leida.data);
    const real = claveVenta({ ...clave, cargas_huella: huellaCargas(venta.cargas) });
    cache.delete(real);
    cache.set(real, { venta, expira: ahora() + (opciones.ttl_ms ?? TTL_CACHE_VENTA_MS) });
    while (cache.size > MAX_ENTRADAS_CACHE_VENTA) {
      const mas_antigua = cache.keys().next().value;
      if (mas_antigua === undefined) break;
      cache.delete(mas_antigua);
    }
    return { data: venta, error: leida.error };
  });
  enCurso.set(k, lectura);
  try {
    return { ...(await lectura), cacheada: false };
  } finally {
    if (enCurso.get(k) === lectura) enCurso.delete(k);
  }
}
