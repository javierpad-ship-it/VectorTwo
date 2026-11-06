import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { HitoApi, TramoLineaTiempoApi } from "@/lib/compras/agrupadores/tipos-api";
import { hrefEmbarque } from "./vista-agrupadores-compras";
import { AYUDA_ESTADO_HITO, claveTramo, detalleTramo, fechaDeHito, marcadorHito, nombreHito, notasDeHito, textoCambiosHito, TEXTO_ESTADO_HITO, TONO_ESTADO_HITO, tituloTramo } from "./vista-linea-tiempo";

/**
 * Línea de tiempo de una compra (ficha 08b-1b §4.1): un tramo por embarque y paquete al que viaja y un tramo «Sin embarque» por mes, cada
 * uno con sus seis hitos en vertical (también en escritorio, porque son pocos): Orden de compra, Zarpe, Arribo, Ingreso CD, Inicio
 * operativo e Ingreso al stock. Cada hito lleva el marcador de color (`aria-hidden`), su nombre, su fecha y el estado SIEMPRE en texto: el
 * color nunca es la única señal. Un hito vencido lleva además un borde. Sin hooks: sirve igual para renderizar en servidor. La fecha se
 * cambia en el embarque o el paquete (el título del tramo lleva allí), no aquí.
 */
export function LineaDeTiempoCompra({
  tramos,
  hoy,
  cancelada = false,
  onAsignarEmbarque,
}: {
  tramos: readonly TramoLineaTiempoApi[];
  hoy?: string;
  cancelada?: boolean;
  /** Con él, el tramo «Sin embarque» ofrece «Asignar a embarque…» (el panel abre el diálogo con las entregas de la compra sin embarque). */
  onAsignarEmbarque?: () => void;
}) {
  return (
    <section aria-labelledby="titulo-linea-de-tiempo" className="space-y-3 rounded-xl border border-borde bg-superficie p-4 shadow-sm">
      <div>
        <h3 id="titulo-linea-de-tiempo" className="text-sm font-semibold">
          Línea de tiempo
        </h3>
        <p className="text-xs text-tinta-suave">Desde la orden de compra hasta el ingreso al stock, por embarque. Las fechas se cambian en el embarque o en el paquete, no aquí.</p>
      </div>
      {cancelada && <p className="text-xs text-tinta-suave">La compra está cancelada: sus hitos pendientes ya no se esperan.</p>}
      {tramos.length === 0 ? (
        <p className="text-sm text-tinta-suave">Esta compra todavía no tiene entregas, así que no hay tramos que seguir.</p>
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {tramos.map((t, i) => (
            <li key={claveTramo(t, i)}>
              <Tramo tramo={t} hoy={hoy} onAsignarEmbarque={onAsignarEmbarque} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Tramo({ tramo: t, hoy, onAsignarEmbarque }: { tramo: TramoLineaTiempoApi; hoy?: string; onAsignarEmbarque?: () => void }) {
  const titulo = tituloTramo(t);
  const detalle = detalleTramo(t);
  return (
    <div className="h-full rounded-lg border border-borde p-3">
      <div className="mb-2 min-w-0">
        <h4 className="break-words text-sm font-medium">
          {t.embarque ? (
            <Link href={hrefEmbarque(t.embarque.id)} className="text-marca-oscura underline-offset-2 hover:underline" title="Abrir el embarque (ahí se cambian sus fechas)">
              {titulo}
            </Link>
          ) : (
            titulo
          )}
        </h4>
        {detalle && <p className="break-words text-xs text-tinta-suave">{detalle}</p>}
        {t.embarque === null && onAsignarEmbarque && (
          <div className="mt-1.5">
            <Button variante="secundario" tamano="sm" onClick={onAsignarEmbarque}>
              Asignar a embarque…
            </Button>
          </div>
        )}
      </div>
      <ol aria-label={`Hitos de ${titulo}`} className="space-y-1.5">
        {t.hitos.map((h) => (
          <li key={h.hito} className={`rounded-md px-2 py-1.5 ${h.estado === "vencido" ? "border border-alerta/40 bg-alerta-suave/40" : "bg-fondo"}`}>
            <Hito hito={h} hoy={hoy} embarqueId={t.embarque?.id ?? null} />
          </li>
        ))}
      </ol>
    </div>
  );
}

function Hito({ hito: h, hoy, embarqueId }: { hito: HitoApi; hoy?: string; embarqueId: string | null }) {
  const fecha = fechaDeHito(h);
  const notas = notasDeHito(h, hoy);
  const cambios = textoCambiosHito(h);
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
      <div className="min-w-0 basis-40 grow">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <span aria-hidden="true">{marcadorHito(h)}</span>
          <span className="min-w-0 break-words">{nombreHito(h)}</span>
        </p>
        {notas.map((n) => (
          <p key={n} className="break-words pl-6 text-[11px] leading-tight text-tinta-suave">
            {n}
          </p>
        ))}
        {cambios &&
          (embarqueId ? (
            <Link href={hrefEmbarque(embarqueId)} className="block pl-6 text-[11px] leading-tight text-marca-oscura underline-offset-2 hover:underline" title="Ver el historial del embarque">
              {cambios}
            </Link>
          ) : (
            <p className="pl-6 text-[11px] leading-tight text-tinta-suave">{cambios}</p>
          ))}
      </div>
      <div className="flex items-center gap-2 pl-6 sm:pl-0">
        <span className="whitespace-nowrap text-sm tabular-nums">{fecha ?? "—"}</span>
        <span title={AYUDA_ESTADO_HITO[h.estado]}>
          <Badge tono={TONO_ESTADO_HITO[h.estado]}>{TEXTO_ESTADO_HITO[h.estado]}</Badge>
        </span>
      </div>
    </div>
  );
}
