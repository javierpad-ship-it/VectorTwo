"use client";

import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import type { EstadoDireccionApi } from "@/lib/direccion/tipos-api";
import { useLectura } from "@/app/(app)/planificacion/proyeccion/use-proyeccion";
import { tonoAviso, urlEstadoDireccion, vistaAvisoDireccion, type ContextoAviso } from "./vista-aviso";

/**
 * El aviso ya resuelto (ficha 14, §4.11): con aprobación vigente, una línea en texto; cerrada sin aprobación vigente, `Alert` con quién cerró, cuándo,
 * «sin aprobación de dirección vigente» y la diferencia con lo último aprobado; rechazada, `Alert` con el rechazo y su motivo. Siempre con enlace al
 * tablero. No bloquea ni oculta nada de la pantalla que lo muestra.
 */
export function AvisoDireccionVista({ estado, contexto }: { estado: EstadoDireccionApi; contexto: ContextoAviso }) {
  const v = vistaAvisoDireccion(estado, contexto);
  if (v.tipo === "nada") return null;
  const enlace = (
    <Link href={v.enlace} className="font-medium underline underline-offset-2">
      Ver el tablero de dirección
    </Link>
  );
  if (v.tipo === "linea") {
    return (
      <p className="text-xs text-tinta-suave">
        {v.texto} · {enlace}
      </p>
    );
  }
  // §4.11: ámbar para «sin aprobación vigente» e «invalidada» (avisa, no es un error); rojo solo para «rechazó».
  return (
    <Alert tono={tonoAviso(v)}>
      {v.antes}
      <strong>{v.fuerte}</strong>
      {v.despues}. {enlace}
    </Alert>
  );
}

/**
 * Lee `GET /api/direccion/estado` y pinta el aviso. Solo se monta para admin y planner (la ruta va con `requirePlanner`; el comprador no ve datos de
 * aprobación). Mientras carga no ocupa lugar; si la lectura falla, lo dice sin tapar la pantalla.
 */
export function AvisoDireccion({ proyeccionId, paraCompras = false, contexto }: { proyeccionId?: string; paraCompras?: boolean; contexto: ContextoAviso }) {
  const url = paraCompras ? urlEstadoDireccion({ paraCompras: true }) : proyeccionId ? urlEstadoDireccion({ proyeccionId }) : null;
  const lectura = useLectura<EstadoDireccionApi>(url);
  if (lectura.error) {
    return (
      <Alert tono="info" onCerrar={() => lectura.setError(null)}>
        No se pudo comprobar la aprobación de dirección: {lectura.error}
      </Alert>
    );
  }
  if (!lectura.datos) return null;
  return <AvisoDireccionVista estado={lectura.datos} contexto={contexto} />;
}
