import { Badge } from "@/components/ui/badge";
import type { TableroApi } from "@/lib/direccion/tipos-api";
import { ListaAlertas } from "./alertas-tablero";
import { notasAtribucion, puenteEnLinea, tarjetas, textoRecorte, type Tarjeta } from "./vista-tablero";

function TarjetaCifra({ t }: { t: Tarjeta }) {
  return (
    <section className="min-w-0 rounded-xl border border-borde bg-superficie px-3 py-3 shadow-sm sm:px-4" aria-label={t.titulo}>
      <div className="flex flex-wrap items-center gap-1.5">
        <h3 className="text-xs font-medium uppercase tracking-wide text-tinta-suave">{t.titulo}</h3>
        {t.nino && <Badge tono="marca">Niño</Badge>}
        {t.estimado && <Badge tono="alerta">estimado</Badge>}
      </div>
      <p className="mt-1 break-words font-mono text-lg font-semibold tabular-nums text-tinta sm:text-xl">{t.valor}</p>
      <ul className="mt-1.5 space-y-0.5 text-xs leading-snug text-tinta-suave">
        {t.lineas.map((l, i) => (
          <li key={i} className={l.fuerte ? "font-semibold text-tinta" : undefined}>
            {l.texto}
          </li>
        ))}
      </ul>
      {t.avisos.map((a, i) => (
        <p key={i} className="mt-1.5 rounded border border-alerta/25 bg-alerta-suave/50 px-2 py-1 text-xs leading-snug text-tinta">
          {a}
        </p>
      ))}
    </section>
  );
}

/**
 * Cifras del recorte (ficha 14, §4.7): el recorte en texto, cuatro tarjetas (dos por fila en móvil), el puente del recorte en una línea (con tiendas
 * elegidas no hay: el puente no se recorta por tienda), la participación usada en lo estimado y las alertas de alcance «recorte».
 */
export function Kpis({ tablero }: { tablero: TableroApi }) {
  const recorte = textoRecorte(tablero.filtros);
  const notas = notasAtribucion(tablero);
  return (
    <div className="space-y-3">
      <div className="space-y-0.5 text-sm text-tinta" aria-live="polite">
        {recorte.map((l, i) => (
          <p key={i} className={i === 0 ? "font-medium" : "text-tinta-suave"}>
            {l}
          </p>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tarjetas(tablero).map((t) => (
          <TarjetaCifra key={t.clave} t={t} />
        ))}
      </div>
      {tablero.puente.recorte && (
        <p className="rounded-lg border border-borde bg-superficie px-3 py-2 text-sm leading-relaxed text-tinta">
          <span className="font-medium">Puente del recorte:</span> <span className="font-mono text-[13px] tabular-nums">{puenteEnLinea(tablero.puente.recorte)}</span>
        </p>
      )}
      {notas.length > 0 && (
        <div className="rounded-lg border border-alerta/30 bg-alerta-suave px-3 py-2 text-sm text-tinta">
          <p className="font-medium">
            <Badge tono="alerta">estimado</Badge> Cómo se estimó lo de cada tienda
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[13px] leading-relaxed">
            {notas.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </div>
      )}
      <ListaAlertas alertas={tablero.alertas} alcance="recorte" />
    </div>
  );
}
