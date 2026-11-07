"use client";

import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { contadorFotos } from "@/lib/fotos/cliente";

/**
 * Los dos botones grandes (≥ 44 px) de la tarjeta de fotos (08c, §4.3): [Cámara] abre la cámara trasera del teléfono
 * (`capture="environment"`) y [Galería] deja elegir varias fotos. Con el tope de 3 desaparecen y se lee «3/3». No sube nada: entrega los
 * archivos elegidos a `onElegir`.
 */
export function SelectorFotos({
  activas,
  cupo,
  deshabilitado = false,
  etiqueta,
  onElegir,
}: {
  activas: number;
  cupo: number;
  deshabilitado?: boolean;
  /** Para el lector de pantalla: «línea 2». */
  etiqueta: string;
  onElegir: (archivos: File[]) => void;
}) {
  const camara = useRef<HTMLInputElement>(null);
  const galeria = useRef<HTMLInputElement>(null);

  function alElegir(e: React.ChangeEvent<HTMLInputElement>) {
    const archivos = Array.from(e.target.files ?? []);
    // Se vacía para poder volver a elegir el mismo archivo (p. ej. tras un error).
    e.target.value = "";
    if (archivos.length > 0) onElegir(archivos);
  }

  if (cupo <= 0 && !deshabilitado) {
    return (
      // Un `aria-label` en un <p> sin rol lo ignoran los lectores de pantalla: el texto para ellos va en un `sr-only`.
      <p className="text-sm font-medium text-tinta-suave">
        <span aria-hidden="true">{contadorFotos(activas)}</span>
        <span className="sr-only">{`${etiqueta}: ${contadorFotos(activas)} fotos, ya no caben más`}</span>
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button className="h-11! min-w-28 px-5!" onClick={() => camara.current?.click()} disabled={deshabilitado} aria-label={`Tomar foto con la cámara, ${etiqueta}`}>
        Cámara
      </Button>
      <Button variante="secundario" className="h-11! min-w-28 px-5!" onClick={() => galeria.current?.click()} disabled={deshabilitado} aria-label={`Elegir fotos de la galería, ${etiqueta}`}>
        Galería
      </Button>
      <span className="text-sm text-tinta-suave" aria-hidden>
        {contadorFotos(activas)}
      </span>
      <input ref={camara} type="file" accept="image/*" capture="environment" onChange={alElegir} className="sr-only" tabIndex={-1} aria-hidden />
      <input ref={galeria} type="file" accept="image/*" multiple onChange={alElegir} className="sr-only" tabIndex={-1} aria-hidden />
    </div>
  );
}
