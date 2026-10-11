"use client";

/** Barra de avance accesible (role="progressbar"), con el mismo estilo del kit. */
export function BarraProgreso({ fraccion, etiqueta }: { fraccion: number; etiqueta: string }) {
  const pct = Math.max(0, Math.min(100, Math.round(fraccion * 100)));
  return (
    <div
      role="progressbar"
      aria-label={etiqueta}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      className="h-2.5 w-full overflow-hidden rounded-full bg-neutro-suave"
    >
      <div className="h-full rounded-full bg-marca transition-[width] duration-200" style={{ width: `${pct}%` }} />
    </div>
  );
}
