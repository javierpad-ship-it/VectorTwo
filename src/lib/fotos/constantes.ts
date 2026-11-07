/** Constantes de las fotos de las líneas de compra (08c, §2.4, §2.5 y §3.3). Sin dependencias: las usan el servidor y las pantallas. */

export const BUCKET_FOTOS = "compras-fotos";

/** Fotos activas por línea (la base lo comprueba bajo candado). */
export const MAX_FOTOS_POR_LINEA = 3;

/** Lado largo de la foto y de la miniatura, en píxeles. */
export const LADO_MAX_FOTO = 800;
export const LADO_MAX_MINIATURA = 320;

/** Peso máximo de cada JPEG: 400 KB la foto y 60 KB la miniatura (los `check` de la tabla). */
export const MAX_BYTES_FOTO = 409_600;
export const MAX_BYTES_MINIATURA = 61_440;

/** Tope de la petición completa (foto + miniatura + sobre multipart). Más de esto no se lee (413). */
export const MAX_BYTES_SUBIDA = 512 * 1024;

/** Vida de la URL firmada de la foto grande. */
export const TTL_URL_FOTO_SEGUNDOS = 3_600;

/** Objetos huérfanos con más de estas horas se pueden borrar (una subida en curso queda fuera). */
export const HORAS_HUERFANAS = 24;
/** Nombres por llamada de limpieza (`fotos_huerfanas` y `.remove()`). */
export const TANDA_LIMPIEZA = 1_000;

