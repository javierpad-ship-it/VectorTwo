import type { UsoTokensIa } from "./tipos-api";

/**
 * Registro de la actividad de la IA (ficha 07e, R26). ÚNICO archivo de `src/lib/ia/` que escribe en la consola, y solo acepta la forma
 * de `RegistroLlamadaIa`: ids, tokens, costo, duración y códigos. Ni lo enviado ni lo recibido llegan nunca aquí: aunque quien llame pase
 * un objeto con más campos, solo se copian los permitidos (lista cerrada) y los valores de texto se acotan.
 */

export type RegistroLlamadaIa = {
  corrida_id: string;
  llamada_id: string | null;
  gm_clave: string;
  paso: string;
  estado: string;
  tokens: UsoTokensIa;
  costo: number;
  duracion_ms: number;
  error_codigo: string | null;
};

const texto = (v: unknown, max: number): string | null => (typeof v === "string" ? v.slice(0, max) : null);
const numero = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** El registro saneado: solo los campos permitidos, con textos acotados. Pura (la prueba comprueba que no deja pasar nada más). */
export function sanearRegistro(r: RegistroLlamadaIa): RegistroLlamadaIa {
  return {
    corrida_id: texto(r.corrida_id, 40) ?? "",
    llamada_id: texto(r.llamada_id, 40),
    gm_clave: texto(r.gm_clave, 80) ?? "",
    paso: texto(r.paso, 10) ?? "",
    estado: texto(r.estado, 30) ?? "",
    tokens: { entrada: numero(r.tokens?.entrada), entrada_cache: numero(r.tokens?.entrada_cache), salida: numero(r.tokens?.salida) },
    costo: numero(r.costo),
    duracion_ms: numero(r.duracion_ms),
    error_codigo: texto(r.error_codigo, 60),
  };
}

/** Deja constancia de una llamada al proveedor (una línea JSON). Nunca falla. */
export function registrarLlamada(r: RegistroLlamadaIa): void {
  try {
    console.info("[ia]", JSON.stringify(sanearRegistro(r)));
  } catch {
    // el registro nunca debe romper la petición
  }
}
