import type { NextRequest } from "next/server";
import { requirePlanner } from "@/lib/auth/guard";
import { leerCuerpo, ok } from "@/lib/api/respuestas";
import { revertirSchema } from "@/lib/aprobacion/esquemas";
import { MENSAJE_LOTE_NO_ENCONTRADO, revertirLote } from "@/lib/aprobacion/servicio";
import { leerSegmentos } from "@/lib/proyeccion/rutas";

type Params = { params: Promise<{ id: string; loteId: string }> };

/** Igual que un lote: lee, simula y escribe con una función SQL; margen por si la base va lenta. */
export const maxDuration = 60;

/**
 * Revierte un lote entero o las filas marcadas (`requirePlanner`, `POST`): vuelve a la propuesta SOLO lo que nadie cambió después. La reversión es otro lote
 * (`tipo = revertir`) y no se revierte. No exige huella de simulación. Con `simular` responde `200` sin escribir; si no, `201` (o `200` con `repetido`).
 * `404` lote no encontrado; `409`: `no_revertible`, `cerrada`, `archivada`, `calculo_en_curso`, `datos_cambiaron`, `simulacion_distinta` (solo si trae huella),
 * `lote_ajeno`, `conflicto_reintentar`, `sin_filas_aplicables` (ninguna fila se puede revertir: nadie las toca ya y no se guarda un lote vacío). Un reintento con el
 * mismo `lote_id` devuelve lo guardado antes de mirar si la proyección se cerró o se está calculando.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const { perfil, response } = await requirePlanner();
  if (response) return response;

  const s = await leerSegmentos(params, ["id", "loteId"], MENSAJE_LOTE_NO_ENCONTRADO);
  if (s.respuesta) return s.respuesta;
  const { datos, respuesta } = await leerCuerpo(request, revertirSchema);
  if (respuesta) return respuesta;
  const r = await revertirLote(s.valores.id, s.valores.loteId, datos, { id: perfil.id, nombre: perfil.nombre });
  if (r.respuesta) return r.respuesta;
  return ok(r.data, r.data.simulado || r.data.repetido ? 200 : 201);
}
