"use client";

import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useFotosLinea } from "@/lib/fotos/use-fotos";
import type { FotoLineaApi } from "@/lib/fotos/tipos-api";
import { SelectorFotos } from "./selector-fotos";
import { VisorFoto } from "./visor-foto";

/**
 * Las fotos de una línea de compra (08c, §4.3 y §11.P1): miniaturas (tocar abre el visor), una ✕ para quitar (con confirmación), los
 * botones [Cámara] y [Galería] y «Traer fotos de la versión cancelada». Lo usa el detalle de la compra y, cuando exista, el formulario de
 * línea de `0.13.1` y la pantalla Compras → Fotos. Los tres roles suben y quitan. En una compra cancelada la tarjeta es de solo lectura y
 * solo el admin puede quitar una foto equivocada (R6). Las subidas fallidas se quedan a la vista con su mensaje y [Reintentar].
 */
export function FotosLinea({
  compraId,
  lineaId,
  fotos: fotosServidor,
  etiqueta,
  compraCancelada = false,
  esAdmin = false,
  lineaInactiva = false,
}: {
  compraId: string;
  lineaId: string;
  fotos: readonly FotoLineaApi[];
  /** «Línea 2» (para los lectores de pantalla y los textos). */
  etiqueta: string;
  compraCancelada?: boolean;
  esAdmin?: boolean;
  lineaInactiva?: boolean;
}) {
  const f = useFotosLinea({ compraId, lineaId, fotosServidor });
  const [visor, setVisor] = useState<number | null>(null);
  const soloLectura = compraCancelada || lineaInactiva;
  const puedeQuitar = !soloLectura || (compraCancelada && esAdmin);

  async function pedirQuitar(foto: FotoLineaApi) {
    if (!confirm("¿Quitar esta foto? Quedará registrado que la quitaste.")) return;
    await f.quitar(foto.id);
  }

  return (
    <div className="space-y-2" aria-label={`Fotos de ${etiqueta}`} role="group">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h5 className="text-xs font-semibold uppercase tracking-wide text-tinta-suave">Fotos</h5>
        {soloLectura && <span className="text-xs text-tinta-suave">{compraCancelada ? "Compra cancelada: solo lectura" : "Línea inactiva: solo lectura"}</span>}
      </div>

      {f.error && <Alert onCerrar={f.limpiarError}>{f.error}</Alert>}
      {f.aviso && (
        <Alert tono="info" onCerrar={f.limpiarAviso}>
          {f.aviso}
        </Alert>
      )}

      {(f.fotos.length > 0 || f.subidas.length > 0) && (
        <ul className="flex flex-wrap gap-3">
          {f.fotos.map((foto, i) => (
            <li key={foto.id} className="relative">
              <button
                type="button"
                onClick={() => setVisor(i)}
                aria-label={`Ver foto ${i + 1} de ${f.fotos.length}, ${etiqueta}`}
                className="block h-24 w-24 overflow-hidden rounded-lg border border-borde bg-neutro-suave focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- miniatura privada servida por la API, cacheable en el navegador */}
                <img src={foto.miniatura_url} alt={`Foto ${i + 1} de ${etiqueta}`} width={foto.ancho} height={foto.alto} loading="lazy" className="h-full w-full object-contain" />
              </button>
              {puedeQuitar && (
                <button
                  type="button"
                  onClick={() => void pedirQuitar(foto)}
                  disabled={f.ocupado}
                  aria-label={`Quitar foto ${i + 1}, ${etiqueta}`}
                  className="absolute -right-2 -top-2 flex h-8 w-8 items-center justify-center rounded-full border border-borde bg-superficie text-sm font-bold text-alerta shadow-sm hover:bg-alerta-suave disabled:cursor-not-allowed disabled:opacity-50"
                >
                  ✕
                </button>
              )}
            </li>
          ))}
          {f.subidas.map((s) => (
            <li key={s.clave} className="flex h-24 w-36 flex-col justify-between rounded-lg border border-dashed border-borde bg-neutro-suave p-2 text-xs" aria-live="polite">
              <span className="truncate font-medium text-tinta" title={s.nombre}>
                {s.nombre}
              </span>
              {s.estado === "error" ? (
                <>
                  <span className="line-clamp-2 text-alerta" title={s.mensaje ?? undefined}>
                    {s.mensaje}
                  </span>
                  <span className="flex gap-1">
                    <Button tamano="sm" variante="secundario" className="h-7! px-2!" onClick={() => f.reintentar(s.clave)}>
                      Reintentar
                    </Button>
                    <Button tamano="sm" variante="fantasma" className="h-7! px-2!" onClick={() => f.descartar(s.clave)}>
                      Descartar
                    </Button>
                  </span>
                </>
              ) : (
                <span className="text-tinta-suave">{s.estado === "preparando" ? "Reduciendo la foto…" : "Subiendo…"}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {f.fotos.length === 0 && f.subidas.length === 0 && <p className="text-sm text-tinta-suave">Esta línea todavía no tiene fotos.</p>}

      {!soloLectura && (
        <div className="space-y-2">
          <SelectorFotos activas={f.fotos.length} cupo={f.cupo} etiqueta={etiqueta} onElegir={f.agregar} />
          {f.cupo > 0 && (
            <Button
              variante="fantasma"
              tamano="sm"
              onClick={() => void f.traer()}
              disabled={f.ocupado}
              title="Si esta línea viene de corregir una compra importada, copia las fotos de la misma línea de la versión cancelada. Las de la cancelada no cambian."
            >
              Traer fotos de la versión cancelada
            </Button>
          )}
        </div>
      )}

      {visor !== null && f.fotos.length > 0 && <VisorFoto fotos={f.fotos} indiceInicial={visor} onCerrar={() => setVisor(null)} />}
    </div>
  );
}
