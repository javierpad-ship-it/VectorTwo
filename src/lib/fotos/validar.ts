import { dimensionesJpeg, quitarMetadatos, terminaEnEoi, tieneFirmaJpeg } from "./jpeg";
import { LADO_MAX_FOTO, LADO_MAX_MINIATURA, MAX_BYTES_FOTO, MAX_BYTES_MINIATURA, MAX_BYTES_SUBIDA } from "./constantes";
import type { CodigoErrorFoto } from "./tipos-api";

/**
 * Validación de la subida de una foto (08c, §3.1 y §3.3, R2 y R3). Sin Supabase: lo prueban las pruebas unitarias con JPEG sintéticos.
 * `leerSubida` lee la petición COMPLETA con tope (nunca `request.formData()` directo: `src/proxy.ts` excluye `/api` y no hay otro límite).
 */

export type MotivoFoto = Extract<CodigoErrorFoto, "formato_invalido" | "dimensiones_invalidas" | "foto_grande">;

export type JpegValidado = { ok: true; ancho: number; alto: number; bytes: number } | { ok: false; motivo: MotivoFoto };

/**
 * Una parte válida: JPEG (firma `FF D8 FF` y `FF D9` al final), ancho y alto del SOF dentro de `maxLado` y peso dentro de `maxBytes`.
 * El peso se mira primero (es lo más barato): 400 KB + 1 → `foto_grande`.
 */
export function validarJpeg(bytes: Uint8Array, opciones: { maxLado: number; maxBytes: number }): JpegValidado {
  if (bytes.length > opciones.maxBytes) return { ok: false, motivo: "foto_grande" };
  if (!tieneFirmaJpeg(bytes) || !terminaEnEoi(bytes)) return { ok: false, motivo: "formato_invalido" };
  const d = dimensionesJpeg(bytes);
  if (!d) return { ok: false, motivo: "formato_invalido" };
  if (d.ancho > opciones.maxLado || d.alto > opciones.maxLado) return { ok: false, motivo: "dimensiones_invalidas" };
  return { ok: true, ancho: d.ancho, alto: d.alto, bytes: bytes.length };
}

export const validarFoto = (bytes: Uint8Array) => validarJpeg(bytes, { maxLado: LADO_MAX_FOTO, maxBytes: MAX_BYTES_FOTO });
export const validarMiniatura = (bytes: Uint8Array) => validarJpeg(bytes, { maxLado: LADO_MAX_MINIATURA, maxBytes: MAX_BYTES_MINIATURA });

export type FotoSubida = {
  foto: Uint8Array;
  miniatura: Uint8Array;
  ancho: number;
  alto: number;
  bytes_foto: number;
  bytes_miniatura: number;
};

export type ResultadoSubida = { ok: true; subida: FotoSubida } | { ok: false; codigo: CodigoErrorFoto };

/** Datos de la petición para decidir el `Origin` (las cabeceras que pone el proxy de Railway y la URL). */
export type CabecerasOrigen = { origin: string | null; host: string | null; forwardedHost: string | null; urlHost: string };

/** Sin `Origin` (clientes que no son navegador) pasa; con `Origin`, su host debe ser el del propio sitio. */
export function origenPermitido(c: CabecerasOrigen): boolean {
  if (c.origin === null || c.origin === "") return true;
  let host: string;
  try {
    host = new URL(c.origin).host;
  } catch {
    return false;
  }
  const propios = [c.forwardedHost?.split(",")[0]?.trim(), c.host, c.urlHost].filter((h): h is string => !!h);
  return propios.includes(host);
}

/** Lee el cuerpo hasta `tope` bytes; si llegan más, corta y devuelve `null`. */
export async function leerCuerpoConTope(cuerpo: ReadableStream<Uint8Array> | null, tope: number): Promise<Uint8Array | null> {
  if (!cuerpo) return new Uint8Array(0);
  const lector = cuerpo.getReader();
  const trozos: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    total += value.length;
    if (total > tope) {
      await lector.cancel().catch(() => undefined);
      return null;
    }
    trozos.push(value);
  }
  const salida = new Uint8Array(total);
  let o = 0;
  for (const t of trozos) {
    salida.set(t, o);
    o += t.length;
  }
  return salida;
}

const esArchivo = (v: unknown): v is Blob => typeof v === "object" && v !== null && typeof (v as Blob).arrayBuffer === "function";

/**
 * Secuencia de la subida hasta tener dos JPEG válidos y sin metadatos (pasos 2 a 5 de §3.3):
 *  1. `Origin` ajeno → `origen_invalido` (403).
 *  2. Sin `content-length` → `longitud_requerida` (411); si declara más de 512 KB → `foto_grande` (413) sin leer nada.
 *  3. Lee el cuerpo con tope de 512 KB (un cuerpo que declara 100 KB y manda 600 KB se corta → 413) y recién entonces lo parsea.
 *  4. Valida cada parte y les quita EXIF, GPS, XMP, perfiles y comentarios.
 */
export async function leerSubida(request: Request): Promise<ResultadoSubida> {
  const h = request.headers;
  if (!origenPermitido({ origin: h.get("origin"), host: h.get("host"), forwardedHost: h.get("x-forwarded-host"), urlHost: new URL(request.url).host })) {
    return { ok: false, codigo: "origen_invalido" };
  }
  const declarado = h.get("content-length");
  if (declarado === null || declarado.trim() === "") return { ok: false, codigo: "longitud_requerida" };
  const largo = Number(declarado);
  if (!Number.isFinite(largo) || largo < 0) return { ok: false, codigo: "longitud_requerida" };
  if (largo > MAX_BYTES_SUBIDA) return { ok: false, codigo: "foto_grande" };

  const tipo = h.get("content-type") ?? "";
  if (!/^multipart\/form-data\s*;/i.test(tipo)) return { ok: false, codigo: "foto_requerida" };

  const crudo = await leerCuerpoConTope(request.body, MAX_BYTES_SUBIDA);
  if (crudo === null) return { ok: false, codigo: "foto_grande" };

  let partes: FormData;
  try {
    partes = await new Response(crudo as BodyInit, { headers: { "content-type": tipo } }).formData();
  } catch {
    return { ok: false, codigo: "foto_requerida" };
  }
  const parteFoto = partes.get("foto");
  const parteMiniatura = partes.get("miniatura");
  if (!esArchivo(parteFoto) || !esArchivo(parteMiniatura)) return { ok: false, codigo: "foto_requerida" };

  const foto = new Uint8Array(await parteFoto.arrayBuffer());
  const miniatura = new Uint8Array(await parteMiniatura.arrayBuffer());
  if (foto.length === 0 || miniatura.length === 0) return { ok: false, codigo: "foto_requerida" };

  const vf = validarFoto(foto);
  if (!vf.ok) return { ok: false, codigo: vf.motivo };
  const vm = validarMiniatura(miniatura);
  if (!vm.ok) return { ok: false, codigo: vm.motivo };

  const fotoLimpia = quitarMetadatos(foto);
  const miniaturaLimpia = quitarMetadatos(miniatura);
  return {
    ok: true,
    subida: { foto: fotoLimpia, miniatura: miniaturaLimpia, ancho: vf.ancho, alto: vf.alto, bytes_foto: fotoLimpia.length, bytes_miniatura: miniaturaLimpia.length },
  };
}
