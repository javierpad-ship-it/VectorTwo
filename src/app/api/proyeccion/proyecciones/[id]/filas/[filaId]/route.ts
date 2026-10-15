import type { NextRequest } from "next/server";
import { requirePlanner } from "@/lib/auth/guard";
import { ok } from "@/lib/api/respuestas";
import { leerSegmentos } from "@/lib/proyeccion/rutas";
import { leerFilaDetalle } from "@/lib/proyeccion/servicio-lectura";

type Params = { params: Promise<{ id: string; filaId: string }> };

/** Detalle de una fila: histórico por año y mes, curva y su origen, factor del Niño por mes, participaciones y sus años (`requirePlanner`). */
export async function GET(_request: NextRequest, { params }: Params) {
  const { response } = await requirePlanner();
  if (response) return response;

  const s = await leerSegmentos(params, ["id", "filaId"], "Fila no encontrada.");
  if (s.respuesta) return s.respuesta;
  const r = await leerFilaDetalle(s.valores.id, s.valores.filaId);
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}
