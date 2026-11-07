/**
 * Dimensiones de destino de una foto (08c, R1). Conserva la proporción, NUNCA agranda y redondea al entero (mínimo 1 px).
 *   4000×3000 → 800×600 · 3000×4000 → 600×800 · 600×400 → 600×400 · 801×1 → 800×1 · miniatura de 4000×3000 (320) → 320×240
 */
export function dimensionesDestino(ancho: number, alto: number, max: number): { ancho: number; alto: number } {
  if (!(ancho > 0) || !(alto > 0) || !(max > 0)) return { ancho: 0, alto: 0 };
  const mayor = Math.max(ancho, alto);
  if (mayor <= max) return { ancho: Math.round(ancho), alto: Math.round(alto) };
  const k = max / mayor;
  return { ancho: Math.max(1, Math.round(ancho * k)), alto: Math.max(1, Math.round(alto * k)) };
}
