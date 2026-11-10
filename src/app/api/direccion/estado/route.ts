import type { NextRequest } from "next/server";
import { requirePlanner } from "@/lib/auth/guard";
import { ok } from "@/lib/api/respuestas";
import { estadoQuerySchema } from "@/lib/direccion/esquemas";
import { leerConsultaDireccion } from "@/lib/direccion/rutas";
import { leerEstado } from "@/lib/direccion/servicio";

/**
 * Estado de dirección de una proyección (`?proyeccion_id=`) o de la cerrada que usa el flujo de Compras (`?para=compras`), para los avisos de
 * Proyección y de Flujo mensual (`requirePlanner`). Sin cerrada que use el flujo: `{ proyeccion: null, estado: "sin_aprobacion", … }`. `400`, `404`.
 */
export async function GET(request: NextRequest) {
  const { response } = await requirePlanner();
  if (response) return response;

  const { datos, respuesta } = leerConsultaDireccion(request, estadoQuerySchema);
  if (respuesta) return respuesta;
  const r = await leerEstado(datos);
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}
