import Link from "next/link";
import type { ReglaIntercompanyApi } from "@/lib/intercompany/tipos-api";
import { Badge } from "@/components/ui/badge";
import { esDeEquivalencia, estadoAplicable, formatearImi, formatearPct, periodoCorto } from "./vista";

/** Piezas de presentación compartidas por las pestañas Reglas e Historial. */

export const RUTA_MARCAS = "/maestros/marcas";
export const RUTA_PROYECCION = "/planificacion/proyeccion";

/** Atajo a las marcas relevantes por GML (02b) con la marca abierta. */
export const enlaceMarca = (marcaId: string) => `${RUTA_MARCAS}?pestana=gml&marca=${marcaId}`;

export function CeldaImi({ valor, defecto }: { valor: number; defecto?: boolean }) {
  return (
    <span className="inline-flex flex-col items-end leading-tight">
      <span className="font-mono tabular-nums">{formatearImi(valor)}</span>
      {defecto && <span className="text-[11px] text-tinta-suave">por defecto</span>}
    </span>
  );
}

export function CeldaPctDirecto({ regla }: { regla: Pick<ReglaIntercompanyApi, "pct_directo" | "pct_cd"> }) {
  return (
    <span className="inline-flex flex-col items-end leading-tight">
      <span className="font-mono tabular-nums">{formatearPct(regla.pct_directo)}</span>
      <span className="text-[11px] text-tinta-suave">del CD {formatearPct(regla.pct_cd)}</span>
    </span>
  );
}

export function CeldaRuta({ regla }: { regla: Pick<ReglaIntercompanyApi, "ruta" | "equivalencia_id" | "nivel" | "fuera_de_ambito"> }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <span>{regla.ruta}</span>
      {esDeEquivalencia(regla) && (
        <span title="Regla de la equivalencia: manda sobre la del GML entero">
          <Badge tono="marca">GMLE: manda</Badge>
        </span>
      )}
      {regla.fuera_de_ambito && (
        <span title="Fuera de hombre formal, casual y RI: informativo, la regla se guarda igual">
          <Badge>Fuera de ámbito</Badge>
        </span>
      )}
    </span>
  );
}

export function CeldaAplicable({ regla }: { regla: Pick<ReglaIntercompanyApi, "aplicable" | "motivo_no_aplicable" | "marca_id"> }) {
  const e = estadoAplicable(regla);
  return (
    <span className="flex flex-col items-start gap-1">
      <span title={e.detalle ?? undefined}>
        <Badge tono={e.tono}>{e.texto}</Badge>
      </span>
      {e.atajo && (
        <span className="flex flex-col gap-0.5 text-xs">
          <Link href={enlaceMarca(regla.marca_id)} className="text-marca-oscura underline underline-offset-2 hover:text-marca">
            Marcarla relevante en el GML
          </Link>
          <Link href={RUTA_PROYECCION} className="text-marca-oscura underline underline-offset-2 hover:text-marca">
            Cerrar una proyección 0.10.1
          </Link>
        </span>
      )}
    </span>
  );
}

/** `ene-2026` o `ene-2026 → may-2026` (abierta: `ene-2026 → hoy`). */
export function textoVigencia(r: Pick<ReglaIntercompanyApi, "vigente_desde" | "hasta_derivado">): string {
  return `${periodoCorto(r.vigente_desde)} → ${r.hasta_derivado ? periodoCorto(r.hasta_derivado) : "abierta"}`;
}
