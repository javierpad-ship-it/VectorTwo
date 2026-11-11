import type { DiferenciaAprobadaApi, EstadoDireccionApi } from "@/lib/direccion/tipos-api";
import { enlaceTablero, etiquetaMotivo, fechaCorta, hayAprobacionVigente, porcentaje, textoEstadoDireccion, unidadesConSigno } from "./formato";

/**
 * Avisos de la aprobación de dirección en Proyección y en Flujo mensual (ficha 14, §4.11). Puro. No bloquean nada: dicen quién cerró la proyección,
 * cuándo, el estado de dirección y, si no hay aprobación vigente, cuánto difiere de lo último aprobado (para que el aviso no se vuelva ruido).
 * Solo los ven admin y planner (el comprador no ve datos de aprobación, decisión 113).
 */

export type ContextoAviso = "proyeccion" | "flujo";

export type VistaAviso =
  | { tipo: "nada" }
  /** Una línea en texto (con aprobación vigente, o una proyección que no está cerrada). */
  | { tipo: "linea"; texto: string; enlace: string }
  /** `Alert`: cerrada sin aprobación vigente (ámbar) o rechazada. `fuerte` va en negrita. */
  | { tipo: "alerta"; rechazada: boolean; antes: string; fuerte: string; despues: string; enlace: string };

/** «difiere de lo aprobado el 03 nov 2026 en +1,214 u en 2027 (+1.5 %)», «idéntica a lo aprobado el …» o «no hay aprobaciones anteriores». */
export function textoDiferenciaAprobada(d: DiferenciaAprobadaApi | null, anioSiguiente: number): string {
  if (d === null) return "no hay aprobaciones anteriores";
  if (d.identica) return `idéntica a lo aprobado el ${fechaCorta(d.fecha)}${d.misma_proyeccion ? "" : ` en ${d.proyeccion_nombre}`}`;
  return `difiere de lo aprobado el ${fechaCorta(d.fecha)}${d.misma_proyeccion ? "" : ` (${d.proyeccion_nombre})`} en ${unidadesConSigno(d.siguiente.u)} u en ${anioSiguiente}${d.siguiente.pct !== null ? ` (${porcentaje(d.siguiente.pct)})` : ""}`;
}

const minuscula = (t: string): string => t.charAt(0).toLowerCase() + t.slice(1);

/** Qué mostrar en cada pantalla según el estado de dirección de la proyección. */
export function vistaAvisoDireccion(e: EstadoDireccionApi, contexto: ContextoAviso): VistaAviso {
  const p = e.proyeccion;
  if (p === null) return { tipo: "nada" };
  const enlace = enlaceTablero(p.id);
  const estado = minuscula(textoEstadoDireccion(e.estado, e.vigente ?? e.ultima));
  const usa = contexto === "flujo" ? `El flujo usa ${p.nombre}` : null;

  if (hayAprobacionVigente(e.estado)) return { tipo: "linea", texto: usa ? `${usa} · dirección: ${estado}` : `Dirección: ${estado}`, enlace };
  // Los avisos de §4.11 son para la CERRADA; en trabajo (o archivada), una línea con el estado.
  if (p.estado !== "cerrada") return { tipo: "linea", texto: `Dirección: ${estado}`, enlace };

  const diferencia = textoDiferenciaAprobada(e.diferencia, p.anio_siguiente);
  if (e.estado === "rechazada" && e.ultima) {
    return {
      tipo: "alerta",
      rechazada: true,
      antes: usa ? `${usa}. Dirección ` : "Dirección ",
      fuerte: "rechazó",
      despues: ` esta proyección el ${fechaCorta(e.ultima.created_at)}${e.ultima.motivo ? ` (${minuscula(etiquetaMotivo(e.ultima.motivo))})` : ""} · ${diferencia}`,
      enlace,
    };
  }
  const cerrada = `errada${p.cerrada_por_nombre ? ` por ${p.cerrada_por_nombre}` : ""}${p.cerrada_at ? ` el ${fechaCorta(p.cerrada_at)}` : ""}`;
  return {
    tipo: "alerta",
    rechazada: false,
    antes: usa ? `${usa}, c${cerrada} · ` : `C${cerrada} · `,
    fuerte: e.estado === "invalidada" ? `${estado}` : "sin aprobación de dirección vigente",
    despues: ` · ${diferencia}`,
    enlace,
  };
}

/** Tono del `Alert` (§4.11): rojo (`alerta`) si dirección rechazó; ámbar (`aviso`) si no hay aprobación vigente o quedó invalidada. */
export function tonoAviso(v: Extract<VistaAviso, { tipo: "alerta" }>): "alerta" | "aviso" {
  return v.rechazada ? "alerta" : "aviso";
}

/** La ruta de `GET /api/direccion/estado`: de una proyección, o de la cerrada que usa el flujo de Compras. */
export function urlEstadoDireccion(args: { proyeccionId: string } | { paraCompras: true }): string {
  return "paraCompras" in args ? "/api/direccion/estado?para=compras" : `/api/direccion/estado?proyeccion_id=${encodeURIComponent(args.proyeccionId)}`;
}
