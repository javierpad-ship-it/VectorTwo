/**
 * JPEG sintéticos de las pruebas de fotos (08c): se arman byte a byte, sin ninguna foto real. No son imágenes decodificables: solo tienen la
 * estructura que mira el servidor (SOI, segmentos con longitud, SOF con ancho y alto, SOS, datos y EOI).
 */

const u16 = (n: number): number[] => [(n >> 8) & 0xff, n & 0xff];

const segmento = (marcador: number, carga: number[]): number[] => [0xff, marcador, ...u16(carga.length + 2), ...carga];

const ascii = (t: string): number[] => [...t].map((c) => c.charCodeAt(0));

export type OpcionesJpeg = {
  ancho: number;
  alto: number;
  /** Añade APP1 (EXIF con GPS), APP2 (perfil) y COM. */
  metadatos?: boolean;
  /** Bytes de datos de imagen (para fijar el peso total). */
  relleno?: number;
  /** `sof2` = progresivo. */
  progresivo?: boolean;
  /** Sin el EOI final. */
  sinEoi?: boolean;
};

export const SEGMENTOS_META = {
  exif: segmento(0xe1, [...ascii("Exif"), 0, 0, ...ascii("GPS-lat:-12.04;lon:-77.03")]),
  perfil: segmento(0xe2, [...ascii("ICC_PROFILE"), 0, 1, 1, 9, 9, 9]),
  comentario: segmento(0xfe, ascii("hecho a mano para la prueba")),
};

export function jpegSintetico(o: OpcionesJpeg): Uint8Array {
  const jfif = segmento(0xe0, [...ascii("JFIF"), 0, 1, 1, 0, ...u16(1), ...u16(1), 0, 0]);
  const dqt = segmento(0xdb, [0, ...Array.from({ length: 64 }, () => 8)]);
  const sof = segmento(o.progresivo ? 0xc2 : 0xc0, [8, ...u16(o.alto), ...u16(o.ancho), 1, 1, 0x11, 0]);
  const sos = segmento(0xda, [1, 1, 0, 0, 63, 0]);
  // Los datos no pueden contener 0xFF sin byte de relleno: se usa un patrón sin 0xFF.
  const datos = Array.from({ length: o.relleno ?? 32 }, (_, i) => (i * 7 + 3) % 250);
  const meta = o.metadatos ? [...SEGMENTOS_META.exif, ...SEGMENTOS_META.perfil, ...SEGMENTOS_META.comentario] : [];
  const bytes = [0xff, 0xd8, ...jfif, ...meta, ...dqt, ...sof, ...sos, ...datos, ...(o.sinEoi ? [] : [0xff, 0xd9])];
  return Uint8Array.from(bytes);
}

/** Un JPEG de exactamente `total` bytes (la estructura mínima pesa unos 170). */
export function jpegDePeso(total: number, ancho: number, alto: number): Uint8Array {
  const base = jpegSintetico({ ancho, alto, relleno: 0 });
  const relleno = total - base.length;
  if (relleno < 0) throw new Error(`el JPEG mínimo pesa ${base.length} bytes`);
  return jpegSintetico({ ancho, alto, relleno });
}

/** Un PNG mínimo (solo la firma y un bloque): para probar `formato_invalido`. */
export const PNG_FALSO = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

/** ¿Hay algún marcador APP1 a APP15 o COM en los segmentos previos al SOS? */
export function marcadoresDeMetadatos(b: Uint8Array): number[] {
  const hallados: number[] = [];
  let i = 2;
  while (i + 3 < b.length) {
    if (b[i] !== 0xff) break;
    const m = b[i + 1];
    if (m === 0xda) break;
    if ((m >= 0xe1 && m <= 0xef) || m === 0xfe) hallados.push(m);
    i += 2 + ((b[i + 2] << 8) | b[i + 3]);
  }
  return hallados;
}

/** Arma el cuerpo `multipart/form-data` de una subida (y su `content-type`). */
export function cuerpoMultipart(partes: { foto?: Uint8Array | null; miniatura?: Uint8Array | null }): { cuerpo: FormData } {
  const f = new FormData();
  if (partes.foto) f.set("foto", new Blob([partes.foto as BlobPart], { type: "image/jpeg" }), "foto.jpg");
  if (partes.miniatura) f.set("miniatura", new Blob([partes.miniatura as BlobPart], { type: "image/jpeg" }), "min.jpg");
  return { cuerpo: f };
}
