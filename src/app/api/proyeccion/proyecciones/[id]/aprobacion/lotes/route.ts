import type { NextRequest } from "next/server";
import { requirePlanner } from "@/lib/auth/guard";
import { idDeRuta, leerCuerpo, ok } from "@/lib/api/respuestas";
import { loteSchema } from "@/lib/aprobacion/esquemas";
import { aplicarLote, listarLotes } from "@/lib/aprobacion/servicio";

type Params = { params: Promise<{ id: string }> };

/**
 * Aprueba o reaprueba un lote de filas (`requirePlanner`, `POST`). Con `simular` responde `200` con el resultado exacto SIN escribir y su `huella_simulacion`; si no,
 * `201` (o `200` con `repetido`, si el `lote_id` ya se aplicó con el mismo cuerpo). Los rechazos por fila van en `filas[]`.
 * `409`: `cerrada`, `archivada`, `calculo_en_curso`, `version_metodo`, `proyeccion_desactualizada`, los del Niño, `crecimientos_sin_aprobar`, `anio_no_admitido`,
 * `ia_no_disponible`, `capacidad_apagada`, `corrida_en_curso`, `datos_cambiaron`, `simulacion_distinta`, `revision_requerida`, `lote_ajeno`, `conflicto_reintentar`.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const { perfil, response } = await requirePlanner();
  if (response) return response;

  const { id, respuesta: respuestaId } = await idDeRuta(params, "Proyección no encontrada.");
  if (respuestaId) return respuestaId;
  const { datos, respuesta } = await leerCuerpo(request, loteSchema);
  if (respuesta) return respuesta;
  const r = await aplicarLote(id, datos, { id: perfil.id, nombre: perfil.nombre });
  if (r.respuesta) return r.respuesta;
  return ok(r.data, r.data.simulado || r.data.repetido ? 200 : 201);
}

/** Los lotes de esta proyección, del más reciente al más antiguo, con sus conteos derivados (`requirePlanner`, `GET`). */
export async function GET(_request: NextRequest, { params }: Params) {
  const { response } = await requirePlanner();
  if (response) return response;

  const { id, respuesta: respuestaId } = await idDeRuta(params, "Proyección no encontrada.");
  if (respuestaId) return respuestaId;
  const r = await listarLotes(id);
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}
