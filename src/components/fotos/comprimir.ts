import { dimensionesDestino } from "@/lib/fotos/dimensiones";
import { LADO_MAX_FOTO, LADO_MAX_MINIATURA, MAX_BYTES_FOTO, MAX_BYTES_MINIATURA } from "@/lib/fotos/constantes";
import {
  CALIDADES_FOTO,
  CALIDADES_MINIATURA,
  codificarHastaCaber,
  MENSAJE_FORMATO_NO_COMPATIBLE,
  MENSAJE_NO_SE_PUDO_REDUCIR,
  motivoArchivoRechazado,
  pasosDeReduccion,
  type Dimensiones,
} from "@/lib/fotos/cliente";

/**
 * Reduce la foto en el navegador antes de subirla (08c, §4.3): lado largo de 800 px (nunca agranda), JPEG ≤ 400 KB y una miniatura de
 * 320 px ≤ 60 KB. `createImageBitmap(..., { imageOrientation: "from-image" })` aplica la orientación EXIF de forma explícita (M2) y el
 * `canvas` no conserva metadatos: sale sin EXIF ni GPS (el servidor los vuelve a quitar). Solo corre en el navegador.
 */

export class ErrorFoto extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ErrorFoto";
  }
}

export type FotoPreparada = { foto: Blob; miniatura: Blob; ancho: number; alto: number };

function lienzo(ancho: number, alto: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = ancho;
  canvas.height = alto;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new ErrorFoto(MENSAJE_NO_SE_PUDO_REDUCIR);
  // El JPEG no tiene transparencia: un PNG con fondo transparente saldría negro sin esto.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, ancho, alto);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  return { canvas, ctx };
}

/** Dibuja `fuente` al tamaño `destino`, en pasos de a lo sumo ×2 para que la reducción grande salga nítida. */
function reducir(fuente: CanvasImageSource, origen: Dimensiones, destino: Dimensiones): HTMLCanvasElement {
  let actual: CanvasImageSource = fuente;
  let canvasFinal: HTMLCanvasElement | null = null;
  const pasos = pasosDeReduccion(origen, destino);
  // Un origen del tamaño exacto del destino igual se dibuja una vez (para quitar metadatos y pasar a JPEG).
  for (const paso of pasos.length > 0 ? pasos : [destino]) {
    const { canvas, ctx } = lienzo(paso.ancho, paso.alto);
    ctx.drawImage(actual, 0, 0, paso.ancho, paso.alto);
    actual = canvas;
    canvasFinal = canvas;
  }
  if (!canvasFinal) throw new ErrorFoto(MENSAJE_NO_SE_PUDO_REDUCIR);
  return canvasFinal;
}

const aJpeg = (canvas: HTMLCanvasElement, calidad: number): Promise<Blob | null> => new Promise((resolver) => canvas.toBlob((b) => resolver(b), "image/jpeg", calidad));

/**
 * Abre el archivo con la orientación EXIF aplicada. Algunos navegadores (Safari antiguo) rechazan la opción `imageOrientation` aunque la imagen
 * sea un JPEG normal: se reintenta SIN opciones (esos navegadores ya aplican la orientación al decodificar) antes de rendirse. Solo si también
 * falla se dice «Formato no compatible» (HEIC en Chrome de escritorio, un archivo dañado o algo que no es imagen).
 */
export async function abrirImagen(archivo: Blob, abrir: typeof createImageBitmap = createImageBitmap): Promise<ImageBitmap> {
  try {
    return await abrir(archivo, { imageOrientation: "from-image" });
  } catch {
    try {
      return await abrir(archivo);
    } catch {
      throw new ErrorFoto(MENSAJE_FORMATO_NO_COMPATIBLE);
    }
  }
}

export async function prepararFoto(archivo: File): Promise<FotoPreparada> {
  const rechazo = motivoArchivoRechazado(archivo);
  if (rechazo) throw new ErrorFoto(rechazo);

  const bitmap = await abrirImagen(archivo);

  try {
    const origen = { ancho: bitmap.width, alto: bitmap.height };
    const destinoFoto = dimensionesDestino(origen.ancho, origen.alto, LADO_MAX_FOTO);
    const destinoMini = dimensionesDestino(origen.ancho, origen.alto, LADO_MAX_MINIATURA);
    if (destinoFoto.ancho === 0 || destinoMini.ancho === 0) throw new ErrorFoto(MENSAJE_FORMATO_NO_COMPATIBLE);

    const canvasFoto = reducir(bitmap, origen, destinoFoto);
    const foto = await codificarHastaCaber((q) => aJpeg(canvasFoto, q), CALIDADES_FOTO, MAX_BYTES_FOTO);
    // La miniatura sale de la foto ya reducida (más barato y más nítido que desde el original de 12 megapíxeles).
    const canvasMini = reducir(canvasFoto, destinoFoto, destinoMini);
    const miniatura = await codificarHastaCaber((q) => aJpeg(canvasMini, q), CALIDADES_MINIATURA, MAX_BYTES_MINIATURA);
    if (!foto || !miniatura) throw new ErrorFoto(MENSAJE_NO_SE_PUDO_REDUCIR);
    return { foto, miniatura, ancho: destinoFoto.ancho, alto: destinoFoto.alto };
  } finally {
    bitmap.close();
  }
}
