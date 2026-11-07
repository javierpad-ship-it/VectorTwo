/**
 * Rutas de los objetos de una foto en Storage (08c, §2.4). Se arman SOLO con ids, nunca con nombres de proveedor o de marca; el `check`
 * de `compra_linea_fotos` fija el mismo formato. No salen nunca por la API (R8).
 */
export type RutasFoto = { ruta: string; ruta_miniatura: string };

export function rutasDeFoto(compraId: string, lineaId: string, fotoId: string): RutasFoto {
  const base = `compras/${compraId}/${lineaId}/${fotoId}`;
  return { ruta: `${base}.jpg`, ruta_miniatura: `${base}_min.jpg` };
}

/** La URL interna de la miniatura (mismo origen, sin caducidad): lo único de la foto pequeña que viaja en la API. */
export const urlMiniatura = (fotoId: string): string => `/api/compras/fotos/${fotoId}/miniatura`;
