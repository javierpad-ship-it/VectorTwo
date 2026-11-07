"use client";

import { useEffect, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { api } from "@/lib/api-client";
import type { FotoGrandeApi } from "@/lib/fotos/tipos-api";
import type { FotoMostrada } from "@/lib/fotos/use-fotos";

/**
 * Visor de una foto ampliada (08c, §4.3): pide la foto de 800 px a `GET /api/compras/fotos/[id]` (URL firmada de 1 h generada en el
 * servidor) y la muestra con su leyenda. Si la URL caducó mientras estaba abierto, la vuelve a pedir una sola vez. Con varias fotos en la
 * línea, [Anterior] y [Siguiente] cambian de una a otra.
 */
export function VisorFoto({ fotos, indiceInicial, onCerrar }: { fotos: readonly FotoMostrada[]; indiceInicial: number; onCerrar: () => void }) {
  const [indice, setIndice] = useState(Math.min(Math.max(0, indiceInicial), Math.max(0, fotos.length - 1)));
  const foto = fotos[indice];
  if (!foto) return null;
  return (
    <Modal
      titulo={`Foto ${indice + 1} de ${fotos.length}`}
      ancho="max-w-3xl"
      onCerrar={onCerrar}
      pie={
        <>
          {fotos.length > 1 && (
            <>
              <Button variante="secundario" onClick={() => setIndice((i) => (i - 1 + fotos.length) % fotos.length)}>
                Anterior
              </Button>
              <Button variante="secundario" onClick={() => setIndice((i) => (i + 1) % fotos.length)}>
                Siguiente
              </Button>
            </>
          )}
          <Button onClick={onCerrar}>Cerrar</Button>
        </>
      }
    >
      <ContenidoVisor key={foto.id} foto={foto} />
    </Modal>
  );
}

function ContenidoVisor({ foto }: { foto: FotoMostrada }) {
  const [grande, setGrande] = useState<FotoGrandeApi | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [yaReintento, setYaReintento] = useState(false);

  useEffect(() => {
    let vigente = true;
    api
      .get<FotoGrandeApi>(`/api/compras/fotos/${foto.id}`)
      .then((g) => {
        if (vigente) setGrande(g);
      })
      .catch((e: unknown) => {
        if (vigente) setError(e instanceof Error ? e.message : "No pudimos abrir la foto.");
      });
    return () => {
      vigente = false;
    };
  }, [foto.id]);

  function volverAPedir() {
    if (yaReintento) {
      setError("La foto no se pudo cargar. Cierra el visor y vuelve a abrirla.");
      return;
    }
    setYaReintento(true);
    api
      .get<FotoGrandeApi>(`/api/compras/fotos/${foto.id}`)
      .then(setGrande)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "No pudimos abrir la foto."));
  }

  return (
    <div className="space-y-3">
      {error && <Alert>{error}</Alert>}
      <div className="flex min-h-48 items-center justify-center rounded-lg bg-neutro-suave">
        {/* eslint-disable-next-line @next/next/no-img-element -- URL firmada de Storage y miniatura de la API: next/image no aporta nada */}
        <img
          src={grande?.url ?? foto.miniatura_url}
          alt={grande?.leyenda || "Foto de la línea de compra"}
          width={grande?.ancho ?? foto.ancho}
          height={grande?.alto ?? foto.alto}
          onError={grande ? volverAPedir : undefined}
          className={`max-h-[70vh] w-auto max-w-full object-contain ${grande ? "" : "opacity-60 blur-[1px]"}`}
        />
      </div>
      {!grande && !error && <p className="text-center text-sm text-tinta-suave">Cargando la foto…</p>}
      {grande?.leyenda && <p className="text-sm text-tinta-suave">{grande.leyenda}</p>}
    </div>
  );
}
