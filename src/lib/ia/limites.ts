/**
 * Límites, tiempos y utilidades de la propuesta con IA (ficha 07e, §3.8 y §3.9). Sin I/O. Ningún id de modelo ni precio vive aquí: son
 * constantes de comportamiento del servicio (tope de salida, tiempos, reintentos, concurrencia) y utilidades de tiempo de Lima.
 */

/** Tope de tokens de salida por llamada (§3.8): una constante del código, sin ningún id de modelo. */
export const MAX_TOKENS_SALIDA = 16_000;
/** Tiempo límite de una llamada al proveedor, en milisegundos (§3.8). */
export const TIMEOUT_LLAMADA_MS = 240_000;
/** Intentos por paso ante `5xx`, sobrecarga, red o tiempo agotado (§3.8). */
export const MAX_INTENTOS_PASO = 3;
/** Espera tras el 1.er, 2.º y 3.er fallo (si el proveedor no pide otra), en milisegundos. */
export const ESPERAS_REINTENTO_MS = [2000, 8000, 30_000] as const;
/** Espera por defecto de un 429 sin cabecera (ms). */
export const ESPERA_429_DEFECTO_MS = 5000;
/** Tope de cualquier espera pedida por el proveedor (ms): una cabecera descabellada no cuelga al navegador. */
export const ESPERA_MAXIMA_MS = 60_000;
/** GM seguidos fallidos por el proveedor (5xx, sobrecarga, tiempo) antes de detener la corrida (§3.8). */
export const CORTE_CIRCUITO_GM = 3;
/** Llamadas simultáneas al proveedor por proceso (§3.8). */
export const MAX_LLAMADAS_SIMULTANEAS = 3;
/** Estimación previa del bloque (ficha §3.9): ≈ 260 tokens por fila y 500 por lote. */
export const TOKENS_POR_FILA_BLOQUE = 260;
export const TOKENS_POR_LOTE_BLOQUE = 500;
/** Llamadas simultáneas al proveedor por corrida (seguridad I1): un solo GM en vuelo, así el desborde de un tope se acota a una llamada. */
export const MAX_LLAMADAS_POR_CORRIDA = 1;
/**
 * Tope de llamadas fallidas por GM (seguridad M5), sumadas entre todos sus reinicios («Reintentar este GM» vuelve a empezar): al llegar, el GM queda
 * `fallido` y no se reinicia más. No cuentan las `ok` (un GM grande hace muchas) ni los `429` (no se cobran; tienen su propio tope de esperas).
 */
export const MAX_FALLOS_POR_GM = 12;
/** Un GM de una corrida de propuesta se identifica con pliegue vacío. */
export const PLIEGUE_PROPUESTA = "";

// ─── Semáforo ───

export type Semaforo = { ejecutar<T>(tarea: () => Promise<T>): Promise<T>; readonly activas: number; readonly esperando: number };

/** Semáforo en memoria: a lo sumo `n` tareas a la vez; el resto espera su turno por orden de llegada. */
export function crearSemaforo(n: number): Semaforo {
  let activas = 0;
  const cola: (() => void)[] = [];
  const liberar = () => {
    activas -= 1;
    const siguiente = cola.shift();
    if (siguiente) siguiente();
  };
  return {
    async ejecutar<T>(tarea: () => Promise<T>): Promise<T> {
      if (activas >= n) await new Promise<void>((resolver) => cola.push(resolver));
      activas += 1;
      try {
        return await tarea();
      } finally {
        liberar();
      }
    },
    get activas() {
      return activas;
    },
    get esperando() {
      return cola.length;
    },
  };
}

/** El semáforo de proceso de las llamadas al proveedor. */
export const semaforoLlamadas: Semaforo = crearSemaforo(MAX_LLAMADAS_SIMULTANEAS);

export type LimitadorPorClave = { ejecutar<T>(clave: string, tarea: () => Promise<T>): Promise<T>; readonly claves: number };

/** Un semáforo de `n` por clave (p. ej. por corrida). Se crea al primer uso y se descarta cuando nadie lo usa ni lo espera. */
export function crearLimitadorPorClave(n: number): LimitadorPorClave {
  const mapa = new Map<string, { semaforo: Semaforo; usos: number }>();
  return {
    async ejecutar<T>(clave: string, tarea: () => Promise<T>): Promise<T> {
      let e = mapa.get(clave);
      if (!e) {
        e = { semaforo: crearSemaforo(n), usos: 0 };
        mapa.set(clave, e);
      }
      const entrada = e;
      entrada.usos += 1;
      try {
        return await entrada.semaforo.ejecutar(tarea);
      } finally {
        entrada.usos -= 1;
        if (entrada.usos === 0 && mapa.get(clave) === entrada) mapa.delete(clave);
      }
    },
    get claves() {
      return mapa.size;
    },
  };
}

/** Las llamadas de una corrida al proveedor: a lo sumo `MAX_LLAMADAS_POR_CORRIDA` a la vez por corrida (se toma antes que el semáforo de proceso). */
export const limitadorPorCorrida: LimitadorPorClave = crearLimitadorPorClave(MAX_LLAMADAS_POR_CORRIDA);

/** ¿Cuántas llamadas de un GM cuentan para el tope de reintentos? Las que no fueron `ok` ni `429`. */
export const contarFallos = (llamadas: readonly { estado: string }[]): number => llamadas.filter((l) => l.estado !== "ok" && l.estado !== "limite_proveedor").length;

// ─── Esperas ───

/** Cuánto esperar (ms) tras el fallo número `intento` (1, 2, 3…) de un paso: lo que pide el proveedor, acotado, o la escala de §3.8. */
export function esperaTrasFallo(intento: number, esperarMs: number | null): number {
  if (esperarMs !== null && Number.isFinite(esperarMs) && esperarMs >= 0) return Math.min(Math.round(esperarMs), ESPERA_MAXIMA_MS);
  const i = Math.min(Math.max(intento, 1), ESPERAS_REINTENTO_MS.length) - 1;
  return ESPERAS_REINTENTO_MS[i];
}

/** Cuánto esperar (ms) tras un 429: lo que pide el proveedor (acotado) o la espera por defecto. */
export function esperaTras429(esperarMs: number | null): number {
  if (esperarMs !== null && Number.isFinite(esperarMs) && esperarMs >= 0) return Math.min(Math.round(esperarMs), ESPERA_MAXIMA_MS);
  return ESPERA_429_DEFECTO_MS;
}

// ─── Tiempo de Lima (UTC−5, sin horario de verano) ───

const DESFASE_LIMA_MS = 5 * 3_600_000;

const dos = (n: number) => String(n).padStart(2, "0");

/** `aaaa-mm` en Lima de un instante. */
export function mesLima(instante: Date): string {
  const d = new Date(instante.getTime() - DESFASE_LIMA_MS);
  return `${d.getUTCFullYear()}-${dos(d.getUTCMonth() + 1)}`;
}

/** `aaaa-mm-dd` en Lima de un instante. */
export function diaLima(instante: Date): string {
  const d = new Date(instante.getTime() - DESFASE_LIMA_MS);
  return `${d.getUTCFullYear()}-${dos(d.getUTCMonth() + 1)}-${dos(d.getUTCDate())}`;
}

/** Rango UTC `[desde, hasta)` (ISO) de un mes de Lima `aaaa-mm`. */
export function rangoMesLima(mes: string): { desde: string; hasta: string } {
  const [a, m] = mes.split("-").map(Number);
  const inicio = Date.UTC(a, m - 1, 1) + DESFASE_LIMA_MS;
  const fin = Date.UTC(a, m, 1) + DESFASE_LIMA_MS;
  return { desde: new Date(inicio).toISOString(), hasta: new Date(fin).toISOString() };
}

/** Rango UTC `[desde, hasta)` (ISO) de un día de Lima `aaaa-mm-dd`. */
export function rangoDiaLima(dia: string): { desde: string; hasta: string } {
  const [a, m, d] = dia.split("-").map(Number);
  const inicio = Date.UTC(a, m - 1, d) + DESFASE_LIMA_MS;
  return { desde: new Date(inicio).toISOString(), hasta: new Date(inicio + 86_400_000).toISOString() };
}

/** Día de Lima (`aaaa-mm-dd`) de un instante ISO. */
export const diaLimaDeIso = (iso: string): string => diaLima(new Date(iso));

/** Los meses de Lima `aaaa-mm` con formato válido. */
export const esMesLima = (v: string): boolean => /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
