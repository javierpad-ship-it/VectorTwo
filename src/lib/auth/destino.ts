/**
 * Destino al que vuelve el login tras ingresar (`?next=`). Solo se acepta una
 * ruta interna: empieza con una sola `/` (no `//host`, que el navegador toma
 * como otro sitio, ni `/\host`, que normaliza a `//host`) y no lleva
 * caracteres de control (un tabulador o salto de línea se eliminan al
 * interpretar la URL y convertirían `/<TAB>/host` en `//host`). Cualquier otra
 * cosa cae en `/`.
 */
const RUTA_INTERNA = /^\/(?!\/|\\)/;
const CARACTERES_DE_CONTROL = /[\u0000-\u001f\u007f]/;

export function destinoSeguro(destino: string | null | undefined): string {
  if (!destino || !RUTA_INTERNA.test(destino) || CARACTERES_DE_CONTROL.test(destino)) return "/";
  return destino;
}
