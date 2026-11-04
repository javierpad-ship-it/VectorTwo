/**
 * Las lecturas pesadas encadenan `.abortSignal(AbortSignal.timeout(...))` al `rpc` (el constructor real de PostgREST lo admite); las bases falsas
 * devuelven promesas, así que se les añade ese método (ignora la señal y devuelve el mismo resultado).
 */
export type Abortable<T> = Promise<T> & { abortSignal: (senal?: AbortSignal) => Promise<T> };

export function abortable<T>(promesa: Promise<T>): Abortable<T> {
  return Object.assign(promesa, { abortSignal: () => promesa });
}
