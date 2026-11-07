/**
 * Lectura mínima de JPEG (08c, §3.3 paso 4 y 5, R2). Puro y sin dependencias: valida la estructura, lee las dimensiones del marcador SOF
 * y reescribe el archivo sin metadatos. No decodifica píxeles.
 */

const SOI = 0xd8;
const EOI = 0xd9;
const SOS = 0xda;
const TEM = 0x01;

/** SOF0 (base), SOF1 (extendido) y SOF2 (progresivo). */
const esSof = (m: number) => m === 0xc0 || m === 0xc1 || m === 0xc2;
/** Marcadores sin longitud: RSTn, SOI, EOI y TEM. */
const sinLongitud = (m: number) => (m >= 0xd0 && m <= 0xd9) || m === TEM;

export const tieneFirmaJpeg = (b: Uint8Array): boolean => b.length >= 4 && b[0] === 0xff && b[1] === SOI && b[2] === 0xff;
export const terminaEnEoi = (b: Uint8Array): boolean => b.length >= 2 && b[b.length - 2] === 0xff && b[b.length - 1] === EOI;

type Segmento = { marcador: number; inicio: number; fin: number };

/**
 * Los segmentos desde el SOI hasta el SOS (incluido el SOS como último: de ahí en adelante son los datos de la imagen hasta el EOI).
 * `null` si la estructura no es válida (longitud fuera del archivo, byte que no es marcador, sin SOS).
 */
function segmentosHastaSos(b: Uint8Array): Segmento[] | null {
  const segs: Segmento[] = [];
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) return null;
    while (i < b.length && b[i] === 0xff) i += 1;
    if (i >= b.length) return null;
    const marcador = b[i];
    const inicio = i - 1;
    i += 1;
    if (marcador === 0x00) return null;
    if (marcador === EOI) return null;
    if (sinLongitud(marcador)) {
      segs.push({ marcador, inicio, fin: i });
      continue;
    }
    if (i + 2 > b.length) return null;
    const largo = (b[i] << 8) | b[i + 1];
    if (largo < 2 || i + largo > b.length) return null;
    segs.push({ marcador, inicio, fin: i + largo });
    i += largo;
    if (marcador === SOS) return segs;
  }
  return null;
}

/** Ancho y alto del marcador SOF, o `null` si no hay (o miden 0). */
export function dimensionesJpeg(b: Uint8Array): { ancho: number; alto: number } | null {
  if (!tieneFirmaJpeg(b)) return null;
  const segs = segmentosHastaSos(b);
  if (!segs) return null;
  const sof = segs.find((s) => esSof(s.marcador));
  if (!sof) return null;
  // marcador(2) + longitud(2) + precisión(1) + alto(2) + ancho(2)
  const o = sof.inicio + 5;
  if (o + 4 > sof.fin) return null;
  const alto = (b[o] << 8) | b[o + 1];
  const ancho = (b[o + 2] << 8) | b[o + 3];
  return ancho > 0 && alto > 0 ? { ancho, alto } : null;
}

/** `true` para los segmentos de metadatos que se quitan: APP1 a APP15 (EXIF, GPS, XMP, perfiles) y COM. APP0 (JFIF) se conserva. */
const esMetadato = (m: number) => (m >= 0xe1 && m <= 0xef) || m === 0xfe;

/**
 * Reescribe el JPEG sin `APP1`–`APP15` ni `COM`; conserva `APP0` y todo lo demás. Un JPEG sin metadatos sale igual, byte a byte. Si la
 * estructura no es válida devuelve el original sin tocar (quien llama ya validó con `validarJpeg`).
 */
export function quitarMetadatos(b: Uint8Array): Uint8Array {
  const segs = segmentosHastaSos(b);
  if (!segs) return b;
  if (!segs.some((s) => esMetadato(s.marcador))) return b;
  const sos = segs[segs.length - 1];
  const partes: Uint8Array[] = [b.subarray(0, 2)];
  for (const s of segs) if (!esMetadato(s.marcador)) partes.push(b.subarray(s.inicio, s.fin));
  partes.push(b.subarray(sos.fin));
  const total = partes.reduce((n, p) => n + p.length, 0);
  const salida = new Uint8Array(total);
  let o = 0;
  for (const p of partes) {
    salida.set(p, o);
    o += p.length;
  }
  return salida;
}
