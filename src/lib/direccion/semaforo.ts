import { PLAZO_LECTURA_MS } from "@/lib/api/plazos";

/**
 * Tope de lecturas pesadas simultáneas del tablero de dirección (informe de seguridad de M14, hallazgo medio: sin tope, unos pocos planners
 * recargando con filtros distintos pueden poner a la base a leer la venta de cuatro años muchas veces a la vez).
 *
 * Un semáforo EN PROCESO (Railway corre una sola instancia, como la caché de `cache.ts`): a lo sumo `maximo` lecturas a la vez; las demás esperan en
 * cola, por orden de llegada, hasta `plazoMs`. Si en ese plazo no hay cupo, `adquirir` devuelve `null` y quien llama responde `503 lectura_lenta`
 * con `Retry-After`. Cada permiso se libera una sola vez (llamar dos veces a `liberar` no hace nada) y al liberarse pasa directo al primero de la
 * cola. No importa nada de `@supabase/*`.
 */

/** Lecturas de `tablero_venta` a la vez (venta del recorte, venta sin filtros y tendencia; todas las peticiones del proceso). */
export const MAX_LECTURAS_VENTA = 2;

/**
 * Lo que una lectura espera en cola antes de rendirse. Con `PLAZO_LECTURA_MS` (7,5 s) de tope para la lectura misma, la petición más lenta tarda
 * 5 + 7,5 = 12,5 s; las lecturas medidas en `vector-two` tardan de 0,3 a 1,7 s (pie de la `0041`), así que en una cola normal se entra antes.
 */
export const PLAZO_COLA_VENTA_MS = 5_000;

/** Segundos de la cabecera `Retry-After` de la respuesta `503` cuando la cola no deja entrar. */
export const REINTENTAR_TRAS_S = Math.ceil(PLAZO_LECTURA_MS / 1000);

/** `503 lectura_lenta` de una LECTURA (`GET /api/direccion/tablero`): no hay nada que guardar, así que no lo menciona. */
export const MENSAJE_COLA_LLENA = "La consulta está tardando; vuelve a intentarlo en unos segundos.";
/** El mismo `503` en el `POST` de aprobaciones (lee la tendencia antes de registrar): ahí sí importa decir que no se registró nada. */
export const MENSAJE_COLA_LLENA_APROBAR = "Hay otras consultas pesadas del tablero en curso. No se guardó ningún cambio: vuelve a intentarlo en unos segundos.";

export type Liberar = () => void;

type Espera = { entrar: (liberar: Liberar | null) => void; temporizador: ReturnType<typeof setTimeout> };

export class Semaforo {
  private libres: number;
  private readonly cola: Espera[] = [];
  /** Sube con `reiniciar`: un permiso de antes ya no devuelve cupo. */
  private generacion = 0;

  constructor(readonly maximo: number) {
    this.libres = maximo;
  }

  /** Lecturas con permiso en este momento. */
  get enCurso(): number {
    return this.maximo - this.libres;
  }

  /** Lecturas esperando en cola. */
  get enCola(): number {
    return this.cola.length;
  }

  /** Un permiso (y la función que lo libera) o `null` si en `plazoMs` no hubo cupo. */
  adquirir(plazoMs: number): Promise<Liberar | null> {
    if (this.libres > 0) {
      this.libres -= 1;
      return Promise.resolve(this.permiso());
    }
    return new Promise((resolver) => {
      const espera: Espera = {
        entrar: resolver,
        temporizador: setTimeout(() => {
          const i = this.cola.indexOf(espera);
          if (i >= 0) this.cola.splice(i, 1);
          resolver(null);
        }, plazoMs),
      };
      this.cola.push(espera);
    });
  }

  /**
   * Corre `leer` con permiso y lo libera al terminar, también si `leer` falla o lanza. `{ cupo: false }` si la cola no dejó entrar a tiempo (y `leer`
   * no se llama).
   */
  async conPermiso<T>(plazoMs: number, leer: () => PromiseLike<T>): Promise<{ cupo: true; valor: T } | { cupo: false }> {
    const liberar = await this.adquirir(plazoMs);
    if (liberar === null) return { cupo: false };
    try {
      return { cupo: true, valor: await leer() };
    } finally {
      liberar();
    }
  }

  /** Solo para pruebas: suelta a los que esperan (como si vencieran) y deja todo el cupo libre. */
  reiniciar(): void {
    for (const e of this.cola.splice(0)) {
      clearTimeout(e.temporizador);
      e.entrar(null);
    }
    this.libres = this.maximo;
    this.generacion += 1;
  }

  private permiso(): Liberar {
    let suelto = false;
    const generacion = this.generacion;
    return () => {
      if (suelto || generacion !== this.generacion) return;
      suelto = true;
      const siguiente = this.cola.shift();
      if (siguiente) {
        clearTimeout(siguiente.temporizador);
        siguiente.entrar(this.permiso());
      } else {
        this.libres += 1;
      }
    };
  }
}
