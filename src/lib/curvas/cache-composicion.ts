import { createHash } from "node:crypto";
import { huellaCargas } from "./huellas";
import type { LecturaComposicion } from "./composicion";

/**
 * Caché de lectura de la composición (docs/modulos/06c-curvas-composicion-y-curva-usuario.md, "Rutas"):
 * la salida de `venta_composicion_agrupacion(id, p_red, p_hasta)` ya validada se guarda en la memoria del
 * proceso con clave `id | cargas_huella | composicion | md5(p_red) | hasta`, caduca a los 120 s y conserva a
 * lo sumo 10 entradas (la menos usada sale primero). Tiene su propio mapa, su propio tope y su propio semáforo
 * (a lo sumo 2 lecturas simultáneas): NO comparte nada con `cache-venta.ts`, así que abrir la composición no
 * desaloja las lecturas de venta de las agrupaciones que se están calculando.
 *
 * Nunca devuelve un estado distinto del que la clave describe: si la función devuelve cargas distintas de
 * las de la clave (una publicación en medio) la entrada se guarda bajo la clave REAL. Las lecturas en curso
 * de la misma clave se juntan en una sola llamada a la base y lo guardado se congela en profundidad. No
 * importa nada de `@supabase/*`: la lectura la inyecta el que llama (`consultas.ts` nombra la función).
 */

export const TTL_CACHE_COMPOSICION_MS = 120_000;
export const MAX_ENTRADAS_CACHE_COMPOSICION = 10;
export const MAX_LECTURAS_COMPOSICION = 2;

export type ClaveComposicion = {
  id: string;
  /** md5 de `{ "aaaa-mm": carga_id }` de TODOS los meses publicados (`huellaCargas`). */
  cargas_huella: string;
  /** `composicion.huella` de la agrupación. */
  composicion: string;
  /** `huellaRedPorAnio(p_red)`. */
  red_huella: string;
  /** `aaaa-mm`. */
  hasta: string;
};

export function claveComposicion(c: ClaveComposicion): string {
  return [c.id, c.cargas_huella, c.composicion || "-", "composicion", c.red_huella, c.hasta].join(" | ");
}

/** md5 de `p_red` en forma canónica (años y tiendas ordenados): la misma red da la misma huella. */
export function huellaRedPorAnio(red: Readonly<Record<string, readonly string[]>>): string {
  const lineas = Object.keys(red)
    .sort()
    .map((anio) => `${anio}=${[...red[anio]].sort().join(",")}`);
  return createHash("md5").update(lineas.join("\n")).digest("hex");
}

function congelarEnProfundidad<T>(valor: T): T {
  if (valor !== null && typeof valor === "object" && !Object.isFrozen(valor)) {
    Object.freeze(valor);
    for (const hijo of Object.values(valor as Record<string, unknown>)) congelarEnProfundidad(hijo);
  }
  return valor;
}

type Entrada = { lectura: LecturaComposicion; expira: number };
const cache = new Map<string, Entrada>();
const enCurso = new Map<string, Promise<LecturaComposicionCacheable<unknown>>>();
let activas = 0;
const esperando: (() => void)[] = [];

/** Solo para pruebas y para forzar una lectura nueva. */
export function vaciarCacheComposicion(): void {
  cache.clear();
  enCurso.clear();
}

export function tamanioCacheComposicion(): number {
  return cache.size;
}

export type LecturaComposicionCacheable<E> = { data: LecturaComposicion | null; error: E | null };

async function conCupo<T>(trabajo: () => Promise<T>): Promise<T> {
  if (activas >= MAX_LECTURAS_COMPOSICION) await new Promise<void>((resolver) => esperando.push(resolver));
  activas += 1;
  try {
    return await trabajo();
  } finally {
    activas -= 1;
    esperando.shift()?.();
  }
}

/**
 * La composición de la clave si está y no caducó; si no, `cargar()` (una llamada a la función de la base) y la
 * guarda. `cacheada` dice si salió de la memoria. Con error o respuesta inválida no se guarda nada. Si ya hay una
 * lectura de esa clave en curso, se espera a esa en vez de lanzar otra.
 */
export async function leerComposicionCacheada<E>(
  clave: ClaveComposicion,
  cargar: () => Promise<LecturaComposicionCacheable<E>>,
  opciones: { ahora?: () => number; ttl_ms?: number } = {}
): Promise<LecturaComposicionCacheable<E> & { cacheada: boolean }> {
  const ahora = opciones.ahora ?? Date.now;
  const k = claveComposicion(clave);
  const guardada = cache.get(k);
  if (guardada && guardada.expira > ahora()) {
    // Reinsertar la deja como la más reciente (LRU).
    cache.delete(k);
    cache.set(k, guardada);
    return { data: guardada.lectura, error: null, cacheada: true };
  }
  if (guardada) cache.delete(k);

  const pendiente = enCurso.get(k) as Promise<LecturaComposicionCacheable<E>> | undefined;
  if (pendiente) return { ...(await pendiente), cacheada: false };

  const lectura = conCupo(async () => {
    const leida = await cargar();
    if (leida.error || !leida.data) return leida;
    const datos = congelarEnProfundidad(leida.data);
    const real = claveComposicion({ ...clave, cargas_huella: huellaCargas(datos.cargas) });
    cache.delete(real);
    cache.set(real, { lectura: datos, expira: ahora() + (opciones.ttl_ms ?? TTL_CACHE_COMPOSICION_MS) });
    while (cache.size > MAX_ENTRADAS_CACHE_COMPOSICION) {
      const masAntigua = cache.keys().next().value;
      if (masAntigua === undefined) break;
      cache.delete(masAntigua);
    }
    return { data: datos, error: leida.error };
  });
  enCurso.set(k, lectura);
  try {
    return { ...(await lectura), cacheada: false };
  } finally {
    if (enCurso.get(k) === lectura) enCurso.delete(k);
  }
}
