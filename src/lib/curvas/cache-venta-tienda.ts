import type { VentaTiendaMes } from "./tipos";

/**
 * Caché en proceso de `venta_mensual_tienda()` (informe de rendimiento de venta/stock, §3.7): la función es la más llamada (140 veces en
 * un mes) y `GET /api/proyeccion` la pide dos veces en paralelo; cada llamada escanea 870 mil filas (0,5 s, hasta 5,9 s con un cálculo
 * en curso). Railway corre UNA instancia: la caché vive en el proceso y se pierde en cada deploy.
 *
 * Se cachea por HUELLA, no por tiempo: la función solo mira los hechos de las cargas `publicada` y los hechos de una
 * carga no cambian nunca, así que el resultado queda determinado por `{ "aaaa-mm": carga_id }` de los meses publicados (`huellaCargas`).
 * Publicar, retirar o republicar un mes cambia esa huella y la entrada vieja deja de servir. Nunca se devuelve lo guardado bajo otra huella:
 *   - cada lectura empieza por leer la huella actual (una lectura pequeña de `cargas_venta_stock`) y solo sirve la entrada de ESA huella;
 *   - tras cargar, la huella se lee otra vez: si cambió (una publicación en medio), el dato NO se guarda;
 *   - un fallo (o una huella ilegible) nunca se guarda: sin huella se lee directo de la base, como antes de la caché.
 * Las lecturas en curso de la misma huella se juntan en una sola llamada a la base (*single-flight*). Un TTL de seguridad (5 min) cubre
 * lo que la huella no ve. Memoria: ~500 filas (≈ 50 KB) por entrada y a lo sumo 2 entradas (la huella actual y la anterior), muy por
 * debajo del tope de ~50 MB del proceso (como `flujo/cache.ts`). Lo guardado se congela y cada lectura devuelve copias: quien lo recibe no
 * puede alterar lo que ve el siguiente. No importa nada de `@supabase/*`: `consultas.ts` inyecta las dos lecturas y es el único archivo que
 * nombra la función de la base.
 */

export const TTL_CACHE_VENTA_TIENDA_MS = 300_000;
export const MAX_ENTRADAS_CACHE_VENTA_TIENDA = 2;

type Lectura<T, E> = { data: T; error: E | null };
type Entrada = { filas: readonly Readonly<VentaTiendaMes>[]; expira: number };

const guardado = new Map<string, Entrada>();
const enCurso = new Map<string, Promise<Lectura<VentaTiendaMes[], unknown>>>();

/** Solo para pruebas y para forzar una lectura nueva. */
export function vaciarCacheVentaTienda(): void {
  guardado.clear();
  enCurso.clear();
}

export function tamanioCacheVentaTienda(): number {
  return guardado.size;
}

const copiar = (filas: readonly Readonly<VentaTiendaMes>[]): VentaTiendaMes[] => filas.map((f) => ({ ...f }));

function guardar(huella: string, filas: VentaTiendaMes[], expira: number): void {
  guardado.delete(huella);
  guardado.set(huella, { filas: Object.freeze(copiar(filas).map((f) => Object.freeze(f))), expira });
  while (guardado.size > MAX_ENTRADAS_CACHE_VENTA_TIENDA) {
    const masAntigua = guardado.keys().next().value;
    if (masAntigua === undefined) break;
    guardado.delete(masAntigua);
  }
}

/**
 * La venta mensual por tienda de la huella actual de cargas publicadas: de la memoria si está y no caducó; si no, `cargar()` (una
 * llamada a la función de la base) y la guarda. `huella()` devuelve la huella de las cargas publicadas de ESTE momento.
 */
export async function leerVentaTiendaConHuella<E>(
  huella: () => Promise<Lectura<string | null, E>>,
  cargar: () => Promise<Lectura<VentaTiendaMes[], E>>,
  opciones: { ahora?: () => number } = {}
): Promise<Lectura<VentaTiendaMes[], E> & { cacheada: boolean }> {
  const ahora = opciones.ahora ?? Date.now;
  const antes = await huella();
  if (antes.error || antes.data === null) return { ...(await cargar()), cacheada: false };
  const clave = antes.data;

  const hay = guardado.get(clave);
  if (hay && hay.expira > ahora()) {
    // Reinsertar la deja como la más reciente.
    guardado.delete(clave);
    guardado.set(clave, hay);
    return { data: copiar(hay.filas), error: null, cacheada: true };
  }
  if (hay) guardado.delete(clave);

  const pendiente = enCurso.get(clave) as Promise<Lectura<VentaTiendaMes[], E>> | undefined;
  if (pendiente) {
    const r = await pendiente;
    return { data: copiar(r.data), error: r.error, cacheada: false };
  }

  const lectura = (async (): Promise<Lectura<VentaTiendaMes[], E>> => {
    const leida = await cargar();
    if (leida.error) return leida;
    const despues = await huella();
    // Si las cargas cambiaron mientras se leía, no se sabe a qué huella pertenece el dato: se devuelve, pero no se guarda.
    if (!despues.error && despues.data === clave) guardar(clave, leida.data, ahora() + TTL_CACHE_VENTA_TIENDA_MS);
    return leida;
  })();
  enCurso.set(clave, lectura);
  try {
    const r = await lectura;
    return { data: copiar(r.data), error: r.error, cacheada: false };
  } finally {
    if (enCurso.get(clave) === lectura) enCurso.delete(clave);
  }
}
