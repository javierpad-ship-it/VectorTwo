import { Badge } from "@/components/ui/badge";
import {
  ETIQUETA_AVISO_AGRUPADOR,
  ETIQUETA_ESTADO_EMBARQUE,
  ETIQUETA_ESTADO_PAQUETE,
  ETIQUETA_ESTADO_VIAJE,
  ETIQUETA_RECEPCION_EMBARQUE,
  ETIQUETA_TIPO_EMBARQUE,
  type AvisoAgrupador,
  type EstadoEmbarque,
  type EstadoPaquete,
  type EstadoViaje,
  type RecepcionEmbarque,
  type ResponsableEfectivoApi,
  type TipoEmbarque,
} from "@/lib/compras/agrupadores/tipos-api";
import { textoResponsable, tonoAviso } from "./vista-agrupadores";

/** Piezas de presentación compartidas por las listas y los detalles de agrupadores (solo tokens del tema). */

const TONO_ESTADO_EMBARQUE: Record<EstadoEmbarque, "marca" | "exito" | "alerta" | "neutro"> = {
  planificado: "neutro",
  en_transito: "marca",
  recibido: "exito",
  cancelado: "alerta",
};

export function EstadoEmbarqueBadge({ estado }: { estado: EstadoEmbarque }) {
  return <Badge tono={TONO_ESTADO_EMBARQUE[estado]}>{ETIQUETA_ESTADO_EMBARQUE[estado]}</Badge>;
}

export function EstadoViajeBadge({ estado }: { estado: EstadoViaje }) {
  return <Badge tono={estado === "abierto" ? "exito" : estado === "cerrado" ? "neutro" : "alerta"}>{ETIQUETA_ESTADO_VIAJE[estado]}</Badge>;
}

export function EstadoPaqueteBadge({ estado }: { estado: EstadoPaquete }) {
  return <Badge tono={estado === "abierto" ? "neutro" : "alerta"}>{ETIQUETA_ESTADO_PAQUETE[estado]}</Badge>;
}

export function TipoEmbarqueBadge({ tipo }: { tipo: TipoEmbarque }) {
  return <Badge tono={tipo === "local" ? "marca" : "neutro"}>{ETIQUETA_TIPO_EMBARQUE[tipo]}</Badge>;
}

export function RecepcionBadge({ recepcion }: { recepcion: RecepcionEmbarque }) {
  if (recepcion === "sin_recibir" || recepcion === "vacio") return null;
  return <Badge tono={recepcion === "completa" ? "exito" : "marca"}>{ETIQUETA_RECEPCION_EMBARQUE[recepcion]}</Badge>;
}

/** Los avisos como badges con su explicación en `title`; `omitir` quita los que ya se muestran en otro sitio. */
export function AvisosBadges({ avisos, omitir = [] }: { avisos: readonly AvisoAgrupador[]; omitir?: readonly AvisoAgrupador[] }) {
  const visibles = avisos.filter((a) => !omitir.includes(a));
  if (visibles.length === 0) return <span className="text-tinta-suave">—</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {visibles.map((a) => (
        <span key={a} title={ETIQUETA_AVISO_AGRUPADOR[a]}>
          <Badge tono={tonoAviso(a)}>{a === "atrasado" ? "Atrasado" : ETIQUETA_AVISO_AGRUPADOR[a]}</Badge>
        </span>
      ))}
    </span>
  );
}

/**
 * El responsable efectivo: su nombre, con ⓘ si lo hereda del embarque o del viaje y ⚠ si falta (nadie asignado o ya no es asignable).
 * `faltante` lo decide el aviso `sin_responsable` que manda la API.
 */
export function ResponsableTexto({ responsable, faltante }: { responsable: ResponsableEfectivoApi | null; faltante: boolean }) {
  const r = textoResponsable(responsable);
  return (
    <span className="whitespace-nowrap">
      <span className={responsable === null ? "text-tinta-suave" : undefined}>{r.nombre}</span>
      {r.heredado && (
        <span title={r.heredado} aria-label={r.heredado} className="ml-1 text-tinta-suave">
          ⓘ
        </span>
      )}
      {faltante && (
        <span title="El responsable ya no está disponible o falta uno: elige un comprador o un administrador activo." aria-label="Responsable faltante" className="ml-1 text-alerta">
          ⚠
        </span>
      )}
    </span>
  );
}
