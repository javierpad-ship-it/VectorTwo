import { huellaCargas } from "@/lib/curvas/huellas";
import type { MarcasArbol } from "./huellas";
import type { VentaGeneroMundo } from "./series";

/**
 * Caché de lectura de `venta_genero_mundo` (ficha 06d §2.4, patrón de `cache-venta.ts`): la salida ya leída y validada se guarda en la
 * memoria del proceso (Railway es un proceso persistente), caduca a los 120 s, conserva a lo sumo 2 entradas (la menos usada sale
 * primero) y deja correr UNA lectura a la vez. Las lecturas en curso de la misma clave se juntan en una sola llamada a la base. Lo
 * guardado se congela en profundidad: quien lo lee no puede alterar lo que ve el siguiente.
 *
 * Clave (M1): `v2|p_desde | huella de cargas | max(updated_at) de genero_mundo_linea | de equivalencias | de agrupaciones_estacionalidad`. El prefijo
 * `v2|` (06e M4, `0.14.0`) separa lo guardado con la forma anterior de la función (sin la agrupación `a`).
 * Sin las tres marcas de tiempo, mover un nodo de mundo o cambiar la agrupación de una equivalencia serviría la lectura vieja
 * durante 120 s. Si la función devuelve cargas distintas de las de la clave (una publicación en medio) la entrada se guarda bajo la
 * clave REAL. No importa nada de `@supabase/*`: la lectura la inyecta quien llama (`consultas.ts` es el único que nombra la función).
 */

export const TTL_CACHE_GM_MS = 120_000;
export const MAX_ENTRADAS_CACHE_GM = 2;
export const MAX_LECTURAS_SIMULTANEAS_GM = 1;

export type ClaveCacheGM = {
  /** `p_desde` (`aaaa-mm-dd`). */
  desde: string;
  /** `huellaCargas` de los meses publicados. */
  cargas_huella: string;
  marcas: MarcasArbol;
};

/** Prefijo de versión de la clave: sube cuando cambia la forma de lo guardado. `v2`: las series traen la agrupación `a` (0029). */
export const PREFIJO_CACHE_GM = "v2|";

export function claveCacheGM(c: ClaveCacheGM): string {
  return PREFIJO_CACHE_GM + [c.desde, c.cargas_huella, c.marcas.nodos || "-", c.marcas.equivalencias || "-", c.marcas.agrupaciones || "-"].join(" | ");
}

function congelarEnProfundidad<T>(valor: T): T {
  if (valor !== null && typeof valor === "object" && !Object.isFrozen(valor)) {
    Object.freeze(valor);
    for (const hijo of Object.values(valor as Record<string, unknown>)) congelarEnProfundidad(hijo);
  }
  return valor;
}

type Entrada = { venta: VentaGeneroMundo; expira: number };
const cache = new Map<string, Entrada>();
const enCurso = new Map<string, Promise<LecturaGM<unknown>>>();
let activas = 0;
const esperando: (() => void)[] = [];

/** Solo para pruebas y para forzar una lectura nueva. */
export function vaciarCacheGM(): void {
  cache.clear();
  enCurso.clear();
}

export function tamanioCacheGM(): number {
  return cache.size;
}

export type LecturaGM<E> = { data: VentaGeneroMundo | null; error: E | null };

async function conCupo<T>(trabajo: () => Promise<T>): Promise<T> {
  if (activas >= MAX_LECTURAS_SIMULTANEAS_GM) await new Promise<void>((resolver) => esperando.push(resolver));
  activas += 1;
  try {
    return await trabajo();
  } finally {
    activas -= 1;
    esperando.shift()?.();
  }
}

/**
 * La venta de la clave si está y no caducó; si no, `cargar()` (una llamada a la función de la base) y la guarda. `cacheada` dice si
 * salió de la memoria. Con error o respuesta inválida no se guarda nada.
 */
export async function leerVentaGMCacheada<E>(
  clave: ClaveCacheGM,
  cargar: () => Promise<LecturaGM<E>>,
  opciones: { ahora?: () => number } = {}
): Promise<LecturaGM<E> & { cacheada: boolean }> {
  const ahora = opciones.ahora ?? Date.now;
  const k = claveCacheGM(clave);
  const guardada = cache.get(k);
  if (guardada && guardada.expira > ahora()) {
    cache.delete(k);
    cache.set(k, guardada);
    return { data: guardada.venta, error: null, cacheada: true };
  }
  if (guardada) cache.delete(k);

  const pendiente = enCurso.get(k) as Promise<LecturaGM<E>> | undefined;
  if (pendiente) return { ...(await pendiente), cacheada: false };

  const lectura = conCupo(async () => {
    const leida = await cargar();
    if (leida.error || !leida.data) return leida;
    const venta = congelarEnProfundidad(leida.data);
    const real = claveCacheGM({ ...clave, cargas_huella: huellaCargas(venta.cargas) });
    cache.delete(real);
    cache.set(real, { venta, expira: ahora() + TTL_CACHE_GM_MS });
    while (cache.size > MAX_ENTRADAS_CACHE_GM) {
      const masAntigua = cache.keys().next().value;
      if (masAntigua === undefined) break;
      cache.delete(masAntigua);
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
