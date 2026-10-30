import {
  UMBRAL_BASE_MOVIDA_PCT,
  UMBRAL_LIBRES_NUEVAS_PCT,
  UMBRAL_META_MOVIDA_PCT,
  type AvisoIa,
  type EstadoPropuestaGM,
  type MotivoDesactualizadaIa,
} from "./tipos-api";

/**
 * Estado de la propuesta de un GM (ficha 07e, §5.3; R13). Puro: se calcula al leer, nunca se guarda.
 */

export type EntradaEstadoGM = {
  /** El último intento del GM terminó sin propuesta porque el control de salida bloqueó el envío. */
  ultimo_intento_bloqueado: boolean;
  /** El último intento del GM falló. */
  ultimo_intento_fallido: boolean;
  /** Hay una propuesta válida (anterior o actual) del GM. */
  hay_propuesta: boolean;
  filas_libres: number;
  /** `huella_historia` de hoy y la guardada con la propuesta. */
  huella_historia_hoy: string;
  huella_historia_guardada: string | null;
  /** `Σ P^GM` de las libres sin cifra IA (libres nuevas o sin peso) y `Meta_libre` de hoy. */
  libres_sin_cifra_p_gm: number;
  meta_libre: number | null;
  version_metodo_hoy: number;
  version_metodo_propuesta: number | null;
  capacidad_encendida: boolean;
  /** `absorbido_pct` del GM (en %), o `null` sin referencia. */
  absorbido_pct: number | null;
};

export type ResultadoEstadoGM = { estado: EstadoPropuestaGM; motivos: MotivoDesactualizadaIa[] };

/** `filas_libres_nuevas`: las libres sin cifra pesan más del 5 % de `Meta_libre`. */
export function libresNuevasSuperanUmbral(sumaPGm: number, metaLibre: number | null): boolean {
  if (!(sumaPGm > 0)) return false;
  if (metaLibre === null) return false;
  if (metaLibre <= 0) return true;
  return sumaPGm * 100 > UMBRAL_LIBRES_NUEVAS_PCT * metaLibre;
}

/**
 * En este orden: `bloqueado_privacidad`, `fallida` (ambas solo si no hay propuesta válida anterior), `sin_filas_libres`, `sin_propuesta`,
 * `desactualizada` (con sus motivos), `meta_movida` y `al_dia`.
 */
export function estadoPropuestaGM(e: EntradaEstadoGM): ResultadoEstadoGM {
  if (!e.hay_propuesta && e.ultimo_intento_bloqueado) return { estado: "bloqueado_privacidad", motivos: [] };
  if (!e.hay_propuesta && e.ultimo_intento_fallido) return { estado: "fallida", motivos: [] };
  if (e.filas_libres === 0) return { estado: "sin_filas_libres", motivos: [] };
  if (!e.hay_propuesta) return { estado: "sin_propuesta", motivos: [] };
  const motivos: MotivoDesactualizadaIa[] = [];
  if (e.huella_historia_guardada === null || e.huella_historia_hoy !== e.huella_historia_guardada) motivos.push("historia_cambiada");
  if (libresNuevasSuperanUmbral(e.libres_sin_cifra_p_gm, e.meta_libre)) motivos.push("filas_libres_nuevas");
  if (e.version_metodo_propuesta === null || e.version_metodo_hoy !== e.version_metodo_propuesta) motivos.push("version_metodo");
  if (!e.capacidad_encendida) motivos.push("capacidad_apagada");
  if (motivos.length > 0) return { estado: "desactualizada", motivos };
  if (e.absorbido_pct !== null && Math.round(e.absorbido_pct * 1e6) / 1e6 > UMBRAL_META_MOVIDA_PCT) return { estado: "meta_movida", motivos: [] };
  return { estado: "al_dia", motivos: [] };
}

/** Informativo: el modelo o el prompt de la propuesta difieren de la configuración vigente. */
export function configuracionCambiada(propuesta: { modelo: string; version_prompt: string }, vigente: { modelo: string; version_prompt: string } | null): boolean {
  return vigente !== null && (propuesta.modelo !== vigente.modelo || propuesta.version_prompt !== vigente.version_prompt);
}

/** Por fila, informativo: `|B'_hoy ÷ B'_al_generar − 1| > 2 %`. */
export function baseMovida(baseCorregidaHoy: number | null, baseCorregidaAlGenerar: number | null): AvisoIa | null {
  if (baseCorregidaHoy === null || baseCorregidaAlGenerar === null || !(baseCorregidaAlGenerar > 0)) return null;
  return Math.abs(baseCorregidaHoy - baseCorregidaAlGenerar) * 100 > UMBRAL_BASE_MOVIDA_PCT * baseCorregidaAlGenerar ? "base_movida" : null;
}
