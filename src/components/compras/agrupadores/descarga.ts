import { descargarLibro } from "@/app/(app)/planificacion/proyeccion/descarga-libro";
import { api } from "@/lib/api-client";
import type { AsignableApi, EmbarqueApi, EmbarqueDetalleApi, ViajeApi } from "@/lib/compras/agrupadores/tipos-api";
import { urlEmbarque } from "@/lib/compras/agrupadores/use-agrupadores";
import { hojaAgrupadores, hojaAsignaciones, hojaEmbarques, hojaPaquetes, hojaViajes, NOMBRE_ARCHIVO_AGRUPADORES } from "./hojas-agrupadores";

/**
 * Excel de Viajes y embarques (ficha 08b §3.11 y §4.1). Solo en el navegador: SheetJS se carga bajo demanda dentro de `descargarLibro`. Los
 * paquetes y las asignaciones salen del detalle de cada embarque (`GET /api/compras/embarques/[id]`), que se lee de a pocos a la vez.
 */

const EN_PARALELO = 4;

async function leerDetalles(embarques: readonly EmbarqueApi[]): Promise<EmbarqueDetalleApi[]> {
  const salida: EmbarqueDetalleApi[] = [];
  for (let i = 0; i < embarques.length; i += EN_PARALELO) {
    const lote = await Promise.all(embarques.slice(i, i + EN_PARALELO).map((e) => api.get<{ embarque: EmbarqueDetalleApi }>(urlEmbarque(e.id))));
    salida.push(...lote.map((r) => r.embarque));
  }
  return salida;
}

/** `EMBARQUES`, `PAQUETES`, `ASIGNACIONES` de los embarques de la lista, y `AGRUPADORES` con sus viajes, embarques y paquetes (reimportable). */
export async function descargarEmbarques(args: { embarques: readonly EmbarqueApi[]; viajes: readonly ViajeApi[]; asignables: readonly AsignableApi[] }): Promise<void> {
  const detalles = await leerDetalles(args.embarques);
  const codigosViaje = new Set(args.embarques.map((e) => e.viaje?.id).filter((x): x is string => !!x));
  const viajes = args.viajes.filter((v) => codigosViaje.has(v.id));
  await descargarLibro(
    {
      EMBARQUES: hojaEmbarques(args.embarques),
      PAQUETES: hojaPaquetes(detalles),
      ASIGNACIONES: hojaAsignaciones(detalles),
      AGRUPADORES: hojaAgrupadores(viajes, detalles, args.asignables),
    },
    NOMBRE_ARCHIVO_AGRUPADORES,
  );
}

/** `VIAJES` de la lista y `AGRUPADORES` con esos viajes (reimportable: lo existente sale «igual»). */
export async function descargarViajes(args: { viajes: readonly ViajeApi[]; asignables: readonly AsignableApi[] }): Promise<void> {
  await descargarLibro({ VIAJES: hojaViajes(args.viajes), AGRUPADORES: hojaAgrupadores(args.viajes, [], args.asignables) }, NOMBRE_ARCHIVO_AGRUPADORES);
}
