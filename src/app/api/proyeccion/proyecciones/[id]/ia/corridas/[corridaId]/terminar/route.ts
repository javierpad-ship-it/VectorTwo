import type { NextRequest } from "next/server";
import { requirePlanner } from "@/lib/auth/guard";
import { leerCuerpo, ok } from "@/lib/api/respuestas";
import { terminarCorridaSchema } from "@/lib/ia/esquemas";
import { terminarCorrida } from "@/lib/ia/servicio";
import { leerSegmentos } from "@/lib/proyeccion/rutas";

type Params = { params: Promise<{ id: string; corridaId: string }> };

/** Termina una corrida (`requirePlanner`): `completa`, `parcial` o, con `cancelar`, `cancelada`. Idempotente. `404` si no es de la proyección. */
export async function POST(request: NextRequest, { params }: Params) {
  const { response } = await requirePlanner();
  if (response) return response;

  const s = await leerSegmentos(params, ["id", "corridaId"], "Corrida no encontrada.");
  if (s.respuesta) return s.respuesta;
  const { datos, respuesta } = await leerCuerpo(request, terminarCorridaSchema);
  if (respuesta) return respuesta;
  const r = await terminarCorrida(s.valores.id, s.valores.corridaId, datos);
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}
