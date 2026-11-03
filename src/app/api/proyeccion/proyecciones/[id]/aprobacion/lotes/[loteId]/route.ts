import type { NextRequest } from "next/server";
import { requirePlanner } from "@/lib/auth/guard";
import { ok } from "@/lib/api/respuestas";
import { MENSAJE_LOTE_NO_ENCONTRADO, leerLote } from "@/lib/aprobacion/servicio";
import { leerSegmentos } from "@/lib/proyeccion/rutas";

type Params = { params: Promise<{ id: string; loteId: string }> };

/** Un lote con sus filas (`requirePlanner`, `GET`). `404` si no es de esta proyección. */
export async function GET(_request: NextRequest, { params }: Params) {
  const { response } = await requirePlanner();
  if (response) return response;

  const s = await leerSegmentos(params, ["id", "loteId"], MENSAJE_LOTE_NO_ENCONTRADO);
  if (s.respuesta) return s.respuesta;
  const r = await leerLote(s.valores.id, s.valores.loteId);
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}
