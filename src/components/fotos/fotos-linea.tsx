"use client";

import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DialogoConfirmar } from "@/components/ui/dialogo-confirmar";
import { useFotosLinea, type FotoMostrada } from "@/lib/fotos/use-fotos";
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
  puedeSubir,
  puedeQuitar: puedeQuitarFoto,
  fotosEnCancelada,
  onCambio,
}: {
  compraId: string;
  lineaId: string;
  fotos: readonly FotoMostrada[];
  /** «Línea 2» (para los lectores de pantalla y los textos). */
  etiqueta: string;
  compraCancelada?: boolean;
  esAdmin?: boolean;
  lineaInactiva?: boolean;
  /** Si la API ya dijo qué puede hacer quien mira (`puede` de Compras → Fotos), manda sobre lo que se deduce de la compra cancelada y del rol. */
  puedeSubir?: boolean;
  puedeQuitar?: boolean;
  /**
   * Cuántas fotos copiaría «Traer» ahora de la versión cancelada (`fotos_en_cancelada`). Con el dato, el botón solo sale si hay algo que
   * traer; sin él (detalle de la compra) sale siempre que quepa otra foto, como antes.
   */
  fotosEnCancelada?: number;
  /** Cuántas fotos tiene la línea cada vez que cambia (subir, quitar, traer). */
  onCambio?: (cantidad: number) => void;
}) {
  const f = useFotosLinea({ compraId, lineaId, fotosServidor, onCambio });
  const [visor, setVisor] = useState<number | null>(null);
  const [porQuitar, setPorQuitar] = useState<{ foto: FotoMostrada; numero: number } | null>(null);
  const [quitando, setQuitando] = useState(false);
  const [yaTrajo, setYaTrajo] = useState(false);
  const soloLectura = puedeSubir !== undefined ? !puedeSubir : compraCancelada || lineaInactiva;
  const puedeQuitar = puedeQuitarFoto ?? (!soloLectura || (compraCancelada && esAdmin));
  const hayParaTraer = fotosEnCancelada === undefined ? true : fotosEnCancelada > 0 && !yaTrajo;

  async function confirmarQuitar() {
    if (!porQuitar) return;
    // Se cierra el diálogo al terminar, salga bien o mal: el error (si lo hay) queda en la alerta de la tarjeta.
    setQuitando(true);
    await f.quitar(porQuitar.foto.id);
    setQuitando(false);
    setPorQuitar(null);
  }

  async function traer() {
    if (await f.traer()) setYaTrajo(true);
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
                  onClick={() => setPorQuitar({ foto, numero: i + 1 })}
                  disabled={f.ocupado}
                  aria-label={`Quitar foto ${i + 1}, ${etiqueta}`}
                  // Área táctil de 44 × 44 px (la ✕ se ve más chica: el círculo es el `span`); se mete hacia dentro de la miniatura para no salirse de la pantalla.
                  className="group absolute -right-3 -top-3 flex h-11 w-11 items-center justify-center rounded-full disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className="flex h-7 w-7 items-center justify-center rounded-full border border-borde bg-superficie text-sm font-bold text-alerta shadow-sm group-hover:bg-alerta-suave group-focus-visible:outline-2 group-focus-visible:outline-marca">✕</span>
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
          {f.cupo > 0 && hayParaTraer && (
            <Button
              variante="fantasma"
              tamano="sm"
              className="h-11! sm:h-8!"
              onClick={() => void traer()}
              disabled={f.ocupado}
              title="Si esta línea viene de corregir una compra importada, copia las fotos de la misma línea de la versión cancelada. Las de la cancelada no cambian."
            >
              {fotosEnCancelada !== undefined && fotosEnCancelada > 0 ? `Traer fotos de la versión cancelada (${fotosEnCancelada})` : "Traer fotos de la versión cancelada"}
            </Button>
          )}
        </div>
      )}

      {porQuitar && (
        <DialogoConfirmar
          titulo="Quitar foto"
          mensaje="¿Quitar esta foto? Quedará registrado que la quitaste."
          confirmar="Quitar"
          ocupado={quitando}
          onConfirmar={() => void confirmarQuitar()}
          onCancelar={() => setPorQuitar(null)}
        />
      )}

      {visor !== null && f.fotos.length > 0 && <VisorFoto fotos={f.fotos} indiceInicial={visor} onCerrar={() => setVisor(null)} />}
    </div>
  );
}
