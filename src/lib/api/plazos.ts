import type { PostgrestError } from "@supabase/supabase-js";

/**
 * Plazos de las lecturas pesadas de la base (informe de rendimiento de venta/stock, §4).
 *
 * PostgREST corta toda sentencia a los 8 s (`statement_timeout` del rol `authenticator`, que hereda `service_role`). Una lectura que
 * se acerca a ese corte se cancela ANTES desde el cliente (`AbortSignal.timeout`) para que la pantalla reciba un mensaje claro
 * (`503 lectura_lenta`) en vez de colgarse o de caer en un 500 genérico. Cortar el fetch NO cancela la consulta en el servidor
 * (inferencia sobre PostgREST): se gana el mensaje, no los recursos.
 *
 * SOLO para lecturas. NUNCA en escrituras (`registrar_*`, `aplicar_lote_proyeccion`, `guardar_*`, `importar_*`,
 * `publicar_carga_venta_stock`): el resultado quedaría ambiguo (¿se guardó o no?).
 */

/** Plazo de una lectura pesada: por debajo de los 8 s del corte del servidor, para que el mensaje lo dé la aplicación. */
export const PLAZO_LECTURA_MS = 7_500;

/** Un `AbortSignal` nuevo con el plazo de lectura. Cada llamada necesita el suyo (el plazo corre desde que se crea). */
export function plazoLectura(): AbortSignal {
  return AbortSignal.timeout(PLAZO_LECTURA_MS);
}

/** SQLSTATE `query_canceled`: `statement_timeout` o cancelación. */
export const CODIGO_CONSULTA_CANCELADA = "57014";
/** Código estable de la respuesta `503` (`{ error, codigo }`) para que la pantalla distinga una lectura lenta de un fallo. */
export const CODIGO_LECTURA_LENTA = "lectura_lenta";
export const MENSAJE_LECTURA_LENTA = "La consulta tardó demasiado y se canceló. No se guardó ningún cambio; inténtalo de nuevo en un minuto.";

/** Mensajes específicos por lectura (informe §4). Se pasan a `conMensajeLecturaLenta`. */
export const MENSAJES_LECTURA_LENTA = {
  ventaProyeccion:
    "Leer la venta para el cálculo tardó demasiado y se canceló. No se guardó ningún cambio: vuelve a calcular en un minuto. Si se repite, avisa al administrador.",
  ventaTienda:
    "La venta por tienda de este conjunto tardó demasiado. Vuelve a intentarlo; si se repite, prueba con un género y mundo concreto.",
  ventaGeneroMundo: "La venta por género y mundo tardó demasiado en leerse. Vuelve a intentarlo en un minuto (la segunda vez suele salir de la caché).",
  ventaMensualTienda: "No se pudo leer la venta por tienda a tiempo. Recarga la página.",
  ventaAgrupacion: "La venta de la agrupación tardó demasiado. Recarga la página.",
  composicionAgrupacion: "La composición de la agrupación tardó demasiado. Recarga la página.",
  ventaLineasIa: "La venta para la propuesta con IA tardó demasiado. No se llamó a la IA ni se guardó nada: vuelve a intentarlo.",
  marcasBarrer: "El análisis de marcas tardó demasiado. Prueba con una ventana más corta o vuelve a intentarlo.",
  reporte: "El reporte tardó demasiado. Recarga la página.",
} as const;

/** Marca de `details` que lleva el mensaje específico hasta `describirErrorDb` (la pantalla nunca ve el prefijo). */
const PREFIJO_MENSAJE = "lectura_lenta: ";

/**
 * ¿La base cortó la consulta por tiempo (`57014`) o el cliente abortó el fetch (`AbortError` / `TimeoutError`, que supabase-js devuelve
 * con `code` vacío y el nombre del error al inicio del `message`)? Pura.
 */
export function esLecturaLenta(code: string | null | undefined, message: string | null | undefined): boolean {
  if (code === CODIGO_CONSULTA_CANCELADA) return true;
  return /^(AbortError|TimeoutError)\b/.test(message ?? "");
}

/**
 * Si el error es de lectura lenta, le pone el mensaje específico de esa lectura (en `details`; el mismo objeto). Cualquier otro error
 * (y `null`) pasa sin tocar. La traducción a `503` la hace `describirErrorDb`.
 */
export function conMensajeLecturaLenta<E extends PostgrestError | null>(error: E, mensaje: string): E {
  if (error && esLecturaLenta(error.code, error.message)) error.details = `${PREFIJO_MENSAJE}${mensaje}`;
  return error;
}

/** El mensaje específico que dejó `conMensajeLecturaLenta`, o el común. */
export function mensajeLecturaLenta(details: string | null | undefined): string {
  return details?.startsWith(PREFIJO_MENSAJE) ? details.slice(PREFIJO_MENSAJE.length) : MENSAJE_LECTURA_LENTA;
}
