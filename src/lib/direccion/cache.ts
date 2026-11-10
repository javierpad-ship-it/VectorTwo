/**
 * Caché en proceso del tablero de dirección (ficha 14, §2.4; patrón de `src/lib/curvas/cache-venta-tienda.ts`). Railway corre UNA instancia: la
 * caché vive en el proceso y se pierde en cada despliegue.
 *
 * Se cachea por CLAVE DE CONTENIDO, no por tiempo: quien llama arma la clave con la huella de lo que determina el resultado (cargas publicadas y
 * maestros para la venta; huella de cifras para la proyección) más los filtros en forma canónica. Reglas:
 *   - solo se guarda un resultado sin error;
 *   - `vigente()` (opcional) se consulta DESPUÉS de cargar: si la huella cambió en medio, el dato se devuelve pero no se guarda;
 *   - las lecturas en curso de la misma clave se juntan en una sola llamada (*single-flight*);
 *   - un TTL de seguridad (5 min) cubre lo que la clave no ve; a lo sumo 24 entradas por caché (se descarta la menos usada recientemente).
 * Lo guardado se congela en profundidad: quien lo recibe no puede alterar lo que ve el siguiente. No importa nada de `@supabase/*`.
 */

export const TTL_CACHE_DIRECCION_MS = 300_000;
export const MAX_ENTRADAS_CACHE_DIRECCION = 24;

type Lectura<T, E> = { data: T | null; error: E | null };

function congelar<T>(valor: T): T {
  if (valor !== null && typeof valor === "object" && !Object.isFrozen(valor)) {
    Object.freeze(valor);
    for (const hijo of Object.values(valor as Record<string, unknown>)) congelar(hijo);
  }
  return valor;
}

export class CacheDireccion<T> {
  private readonly guardado = new Map<string, { valor: T; expira: number }>();
  private readonly enCurso = new Map<string, Promise<Lectura<T, unknown>>>();

  constructor(
    private readonly ttlMs = TTL_CACHE_DIRECCION_MS,
    private readonly maximo = MAX_ENTRADAS_CACHE_DIRECCION
  ) {}

  /** Solo para pruebas y para forzar lecturas nuevas. */
  vaciar(): void {
    this.guardado.clear();
    this.enCurso.clear();
  }

  get tamanio(): number {
    return this.guardado.size;
  }

  /**
   * El valor de `clave`: de la memoria si está y no caducó; si no, `cargar()` y lo guarda (si no hubo error y `vigente()` no dice lo contrario).
   * `cacheada` dice si salió de la memoria.
   */
  async obtener<E>(
    clave: string,
    cargar: () => PromiseLike<Lectura<T, E>>,
    opciones: { vigente?: (valor: T) => boolean | PromiseLike<boolean>; ahora?: () => number } = {}
  ): Promise<Lectura<T, E> & { cacheada: boolean }> {
    const ahora = opciones.ahora ?? Date.now;
    const hay = this.guardado.get(clave);
    if (hay && hay.expira > ahora()) {
      // Reinsertar la deja como la más reciente.
      this.guardado.delete(clave);
      this.guardado.set(clave, hay);
      return { data: hay.valor, error: null, cacheada: true };
    }
    if (hay) this.guardado.delete(clave);

    const pendiente = this.enCurso.get(clave) as Promise<Lectura<T, E>> | undefined;
    if (pendiente) return { ...(await pendiente), cacheada: false };

    const lectura = (async (): Promise<Lectura<T, E>> => {
      const leida = await cargar();
      if (leida.error || leida.data === null) return leida;
      const valor = congelar(leida.data);
      const sirve = opciones.vigente ? await opciones.vigente(valor) : true;
      if (sirve) this.guardar(clave, valor, ahora() + this.ttlMs);
      return { data: valor, error: null };
    })();
    this.enCurso.set(clave, lectura);
    try {
      return { ...(await lectura), cacheada: false };
    } finally {
      if (this.enCurso.get(clave) === lectura) this.enCurso.delete(clave);
    }
  }

  private guardar(clave: string, valor: T, expira: number): void {
    this.guardado.delete(clave);
    this.guardado.set(clave, { valor, expira });
    while (this.guardado.size > this.maximo) {
      const masAntigua = this.guardado.keys().next().value;
      if (masAntigua === undefined) break;
      this.guardado.delete(masAntigua);
    }
  }
}

/**
 * Texto canónico de unos filtros para usarlo de clave: claves ordenadas, listas ordenadas y sin repetidos, lo ausente fuera. Una lista VACÍA no es
 * lo mismo que una ausente (para las funciones SQL, vacía = nada coincide y ausente = sin filtro): se escribe como `clave=[]`.
 */
export function claveCanonica(filtros: Readonly<Record<string, unknown>>): string {
  const partes: string[] = [];
  for (const k of Object.keys(filtros).sort()) {
    const v = filtros[k];
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) partes.push(`${k}=[${[...new Set(v.map(String))].sort().join(",")}]`);
    else partes.push(`${k}=${String(v)}`);
  }
  return partes.join("&");
}
