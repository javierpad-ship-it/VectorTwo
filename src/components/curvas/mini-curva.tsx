import { maximoComun, trazoMiniCurva } from "@/lib/curvas/grafico";

/**
 * Mini curva de doce puntos en SVG: la vigente en sólido y la propuesta en
 * contorno (trazo discontinuo), a la misma escala para que se comparen a ojo.
 * Es decorativa: el texto accesible resume qué curvas dibuja.
 */
export function MiniCurva({
  vigente,
  propuesta,
  ancho = 96,
  alto = 30,
  etiqueta,
}: {
  vigente?: readonly number[] | null;
  propuesta?: readonly number[] | null;
  ancho?: number;
  alto?: number;
  /** Texto accesible; por defecto describe las curvas presentes. */
  etiqueta?: string;
}) {
  if (!vigente && !propuesta) return <span className="text-tinta-suave">—</span>;
  const maximo = maximoComun(vigente, propuesta);
  const texto = etiqueta ?? `Mini curva: ${[vigente ? "vigente (trazo sólido)" : null, propuesta ? "propuesta (trazo discontinuo)" : null].filter(Boolean).join(" y ")}`;
  return (
    <svg viewBox={`0 0 ${ancho} ${alto}`} width={ancho} height={alto} role="img" aria-label={texto} className="block shrink-0">
      <line x1={1} x2={ancho - 1} y1={alto - 1} y2={alto - 1} className="stroke-borde" strokeWidth={1} />
      {propuesta && (
        <path d={trazoMiniCurva(propuesta, ancho, alto, maximo)} fill="none" className="stroke-marca" strokeWidth={1.75} strokeDasharray="3 2" strokeLinejoin="round" />
      )}
      {vigente && <path d={trazoMiniCurva(vigente, ancho, alto, maximo)} fill="none" className="stroke-tinta" strokeWidth={1.75} strokeLinejoin="round" />}
    </svg>
  );
}
