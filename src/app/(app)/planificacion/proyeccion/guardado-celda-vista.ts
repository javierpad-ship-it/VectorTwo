import type { DecisionFila } from "./celda-decision";

/**
 * Estado de guardado de una celda editable de Por línea (decidido o crecimiento por fila). La pantalla devuelve el control en cuanto el
 * servidor responde y relee la línea en segundo plano; este estado es lo que dice, junto a la celda, si la cifra quedó guardada.
 *
 * - `guardando`: el `PUT` está en curso.
 * - `guardado`: el servidor respondió 200 (se ve unos segundos; la relectura sigue en segundo plano).
 * - `error`: el servidor rechazó la cifra; la celda vuelve a su valor anterior y el mensaje queda al lado.
 */
export type EstadoGuardadoCelda = { tipo: "guardando" } | { tipo: "guardado" } | { tipo: "error"; mensaje: string };

export type CampoCelda = "decidido" | "crecimiento";

/** Cuánto se ve «Guardado» junto a la celda. */
export const MS_GUARDADO_VISIBLE = 4_000;

/**
 * Límite de la lectura de una línea (`GET …/lineas`). Una lectura normal tarda unos segundos; pasado este plazo se deja de esperar y se
 * ofrece «Reintentar» en vez de dejar «Leyendo la línea…» para siempre.
 */
export const PLAZO_LECTURA_LINEA_MS = 30_000;

/** El crecimiento por fila se envía con `crecimiento_pct` y sin `decidido` ni `origen: "propuesta"`; todo lo demás es la cifra decidida. */
export function campoDeDecision(d: DecisionFila): CampoCelda {
  return d.crecimiento_pct !== undefined && d.decidido === undefined && d.origen === "manual" ? "crecimiento" : "decidido";
}

/** Clave de una celda: fila × año × campo (el crecimiento y el decidido de Y+1 son celdas distintas de la misma fila y año). */
export function claveCelda(filaId: string, anio: number, campo: CampoCelda): string {
  return `${filaId}|${anio}|${campo}`;
}

/** Un mapa nuevo con el estado de `clave` cambiado (`null` = quitarlo). Puro: no toca el de entrada. */
export function conEstadoCelda(m: ReadonlyMap<string, EstadoGuardadoCelda>, clave: string, estado: EstadoGuardadoCelda | null): ReadonlyMap<string, EstadoGuardadoCelda> {
  const n = new Map(m);
  if (estado === null) n.delete(clave);
  else n.set(clave, estado);
  return n;
}

/** Lo que se lee junto a la celda (y anuncia el lector de pantalla). */
export function textoEstadoCelda(e: EstadoGuardadoCelda): string {
  if (e.tipo === "guardando") return "Guardando…";
  if (e.tipo === "guardado") return "Guardado";
  return `No se guardó: ${e.mensaje}`;
}

/**
 * Control de carreras de los guardados: cada envío de una celda recibe un número; solo la respuesta del ÚLTIMO envío de esa celda puede
 * cambiar su estado (una respuesta vieja nunca pisa una nueva), y «Guardado» solo se borra si nadie volvió a enviar después.
 */
export class TurnosCelda {
  private ultimo = new Map<string, number>();
  private contador = 0;

  /** Registra un envío nuevo de `clave` y devuelve su número. */
  nuevo(clave: string): number {
    this.contador += 1;
    this.ultimo.set(clave, this.contador);
    return this.contador;
  }

  /** ¿`turno` sigue siendo el último envío de `clave`? */
  vigente(clave: string, turno: number): boolean {
    return this.ultimo.get(clave) === turno;
  }
}

/** Aviso cuando la lectura de la línea falla: si ya había datos, se guardó lo enviado pero lo que se ve puede no estar al día. */
export function textoFalloLectura(mensaje: string, hayDatos: boolean): string {
  const m = /[.!?…]$/.test(mensaje.trim()) ? mensaje.trim() : `${mensaje.trim()}.`;
  return hayDatos ? `No se pudo actualizar la línea: ${m} Lo que ves puede no estar al día; lo que ya escribiste se conserva.` : `No se pudo leer la línea: ${m}`;
}

/**
 * Los guardados de Por línea van al servidor de uno en uno y en el orden en que se pulsaron (cada uno mueve a las demás filas libres del GM:
 * dos a la vez se pisarían). La pantalla no se bloquea: se puede seguir escribiendo mientras la cola avanza. Un envío que falla no corta la cola.
 */
export class ColaEnvios {
  private cola: Promise<unknown> = Promise.resolve();

  encolar<T>(envio: () => Promise<T>): Promise<T> {
    const p = this.cola.then(envio, envio);
    this.cola = p.catch(() => undefined);
    return p;
  }
}

/**
 * Relectura en segundo plano tras guardar, agrupada: si ya hay una en curso, no se lanza otra en paralelo; se apunta UNA más (con la función
 * más reciente, que conoce la línea a la vista) para cuando termine. Así la última relectura siempre empieza después del último guardado y
 * ninguna respuesta vieja queda a la vista. `alFallar` recibe el error de una relectura (la pantalla avisa sin tocar lo escrito).
 */
export class RecargaAgrupada {
  private enCurso = false;
  private siguiente: { recargar: () => Promise<unknown>; alFallar: (e: unknown) => void } | null = null;

  pedir(recargar: () => Promise<unknown>, alFallar: (e: unknown) => void): void {
    if (this.enCurso) {
      this.siguiente = { recargar, alFallar };
      return;
    }
    this.enCurso = true;
    void Promise.resolve()
      .then(recargar)
      .catch((e: unknown) => alFallar(e))
      .finally(() => {
        this.enCurso = false;
        const s = this.siguiente;
        this.siguiente = null;
        if (s) this.pedir(s.recargar, s.alFallar);
      });
  }
}
