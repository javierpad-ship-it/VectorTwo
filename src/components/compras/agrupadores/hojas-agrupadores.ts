import type { Hoja } from "@/lib/proyeccion/excel";
import { hojaAgrupadores as hojaAgrupadoresDe, hojaAsignaciones, hojaEmbarques, hojaPaquetes, hojaViajes, NOMBRE_ARCHIVO_EMBARQUES, NOMBRE_ARCHIVO_VIAJES } from "@/lib/compras/agrupadores/excel";
import type { AsignableApi, EmbarqueDetalleApi, ViajeApi } from "@/lib/compras/agrupadores/tipos-api";

/**
 * Hojas de la exportación a Excel de Viajes y embarques (ficha 08b §3.11 y §4.1; regla «Excel = pantalla»). Las arma la lógica pura de T2
 * (`src/lib/compras/agrupadores/excel.ts`, que comparte las columnas con la plantilla del importador); aquí solo se re-exportan y se adapta
 * la hoja `AGRUPADORES` a lo que la pantalla ya tiene: los responsables van como correo (lo que pide el importador) a partir de los
 * asignables que leyó la pantalla. SheetJS se carga bajo demanda al descargar (`descargarLibro`).
 */

export { hojaAsignaciones, hojaEmbarques, hojaPaquetes, hojaViajes, NOMBRE_ARCHIVO_EMBARQUES, NOMBRE_ARCHIVO_VIAJES };

/**
 * Hoja `AGRUPADORES`: los viajes, después los embarques y después los paquetes no cancelados, con las columnas y los valores de la plantilla
 * del importador. Un responsable que ya no es asignable sale con su correo igual (la API lo rechazará al reimportar: hay que elegir otro).
 */
export function hojaAgrupadores(viajes: readonly ViajeApi[], detalles: readonly EmbarqueDetalleApi[], asignables: readonly AsignableApi[]): Hoja {
  const correos = new Map(asignables.map((a) => [a.perfil_id, a.email]));
  return hojaAgrupadoresDe({ viajes, embarques: detalles, correoDe: (perfilId) => correos.get(perfilId) ?? null });
}
