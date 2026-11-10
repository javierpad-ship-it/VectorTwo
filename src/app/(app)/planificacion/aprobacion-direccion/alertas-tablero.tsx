import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { AlertaApi } from "@/lib/direccion/tipos-api";
import { alertasDe, esEnlaceInterno, ROTULO_NIVEL, textoVerInformativas, type ItemBloqueo, type NivelVisual, type VistaBloqueos } from "./vista-tablero";

/** Icono Y palabra de nivel: nunca solo color (ficha 14, §4.5). */
export function RotuloNivel({ nivel }: { nivel: NivelVisual }) {
  const r = ROTULO_NIVEL[nivel];
  return (
    <Badge tono={r.tono}>
      <span aria-hidden className="font-bold">
        {r.icono}
      </span>
      {r.palabra}
    </Badge>
  );
}

function ItemAlerta({ nivel, titulo, detalle, detalles, enlace, codigo }: { nivel: NivelVisual; titulo: string; detalle?: string; detalles?: string[]; enlace?: string | null; codigo?: string }) {
  return (
    <li className="rounded-lg border border-borde px-3 py-2.5" data-codigo={codigo}>
      <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
        <RotuloNivel nivel={nivel} />
        <p className="min-w-0 flex-1 basis-48 text-sm font-medium text-tinta">{titulo}</p>
      </div>
      {detalle && <p className="mt-1 text-sm leading-relaxed text-tinta-suave">{detalle}</p>}
      {detalles && detalles.length > 0 && (
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-tinta-suave">
          {detalles.map((d, i) => (
            <li key={i}>{d}</li>
          ))}
        </ul>
      )}
      {esEnlaceInterno(enlace) && (
        <p className="mt-1 text-sm">
          <Link href={enlace} className="font-medium text-marca-oscura underline underline-offset-2">
            Ir a donde se resuelve
          </Link>
        </p>
      )}
    </li>
  );
}

const itemBloqueo = (nivel: NivelVisual) =>
  function Bloqueo(b: ItemBloqueo, i: number) {
    return <ItemAlerta key={`${b.codigo}-${i}`} nivel={nivel} titulo={b.mensaje} detalles={b.detalles} codigo={b.codigo} />;
  };

/** Lo que bloquearía el cierre (solo en trabajo), con el código y el mensaje del cierre tal cual; «desactualizada» va aparte, como aviso. */
export function BloqueosCierre({ bloqueos, onReintentar }: { bloqueos: VistaBloqueos; onReintentar?: () => void }) {
  if (bloqueos.estado === "no_aplica") return null;
  if (bloqueos.estado === "cargando") {
    return (
      <p className="text-sm text-tinta-suave" aria-live="polite">
        Comprobando qué bloquearía el cierre…
      </p>
    );
  }
  if (bloqueos.estado === "error") {
    return (
      <Alert tono="alerta">
        No se pudo comprobar qué bloquearía el cierre: {bloqueos.mensaje}
        {onReintentar && (
          <>
            {" "}
            <button type="button" onClick={onReintentar} className="font-medium underline underline-offset-2">
              Reintentar
            </button>
          </>
        )}
      </Alert>
    );
  }
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-tinta" aria-live="polite">
        {bloqueos.titulo}
      </p>
      {(bloqueos.duros.length > 0 || bloqueos.forzables.length > 0) && (
        <ul className="space-y-2">
          {bloqueos.duros.map(itemBloqueo("bloquea"))}
          {bloqueos.forzables.map(itemBloqueo("forzable"))}
        </ul>
      )}
    </div>
  );
}

/** Una lista de alertas: las importantes a la vista y las informativas plegadas («Ver 6 informativas»). */
export function ListaAlertas({ alertas, alcance, vacio }: { alertas: readonly AlertaApi[]; alcance: AlertaApi["alcance"]; vacio?: string }) {
  const { importantes, informativas } = alertasDe(alertas, alcance);
  if (importantes.length === 0 && informativas.length === 0) return vacio ? <p className="text-sm text-tinta-suave">{vacio}</p> : null;
  const item = (a: AlertaApi, i: number) => <ItemAlerta key={`${a.codigo}-${i}`} nivel={a.nivel === "importante" ? "importante" : "info"} titulo={a.titulo} detalle={a.detalle} enlace={a.enlace} codigo={a.codigo} />;
  return (
    <div className="space-y-2">
      {importantes.length > 0 && <ul className="space-y-2">{importantes.map(item)}</ul>}
      {importantes.length === 0 && vacio && <p className="text-sm text-tinta-suave">{vacio}</p>}
      {informativas.length > 0 && (
        <details className="rounded-lg border border-borde">
          <summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm font-medium text-marca-oscura">{textoVerInformativas(informativas.length)}</summary>
          <ul className="space-y-2 px-3 pb-3">{informativas.map(item)}</ul>
        </details>
      )}
    </div>
  );
}

/**
 * Alertas para aprobar (ficha 14, §4.5), de la proyección entera: primero lo que bloquearía el cierre y lo que se puede cerrar igual (solo en trabajo;
 * de `/bloqueos`, que llega aparte), después las importantes y, plegadas, las informativas. Las del recorte van en «Explorar», junto a las tarjetas.
 */
export function AlertasTablero({ alertas, bloqueos, onReintentarBloqueos }: { alertas: readonly AlertaApi[]; bloqueos: VistaBloqueos; onReintentarBloqueos?: () => void }) {
  return (
    <Card nivel={3} titulo="Alertas para aprobar" descripcion="De la proyección entera. Cada alerta lleva a la pestaña de Proyección donde se resuelve.">
      <div className="space-y-4">
        <BloqueosCierre bloqueos={bloqueos} onReintentar={onReintentarBloqueos} />
        <ListaAlertas alertas={alertas} alcance="proyeccion" vacio="Sin alertas importantes." />
      </div>
    </Card>
  );
}
