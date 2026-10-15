import type { NextRequest } from "next/server";
import { requirePlanner } from "@/lib/auth/guard";
import { leerCuerpo, ok } from "@/lib/api/respuestas";
import { factoresPutSchema } from "@/lib/proyeccion/esquemas";
import { guardarFactores, leerFactores } from "@/lib/proyeccion/servicio";

/** Factores del Niño por año atípico y temporada (`requirePlanner`): el calculado por M6, el aplicado (editable) y el efectivo. */
export async function GET() {
  const { response } = await requirePlanner();
  if (response) return response;

  const r = await leerFactores();
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}

/**
 * Edita el factor aplicado de uno o varios (año, temporada) (`requirePlanner`). `ratio_aplicado: null` vuelve al calculado.
 * Las proyecciones en trabajo quedan desactualizadas (`factores_cambiados`) hasta recalcular.
 */
export async function PUT(request: NextRequest) {
  const { perfil, response } = await requirePlanner();
  if (response) return response;

  const { datos, respuesta } = await leerCuerpo(request, factoresPutSchema);
  if (respuesta) return respuesta;
  const r = await guardarFactores(datos, { id: perfil.id, nombre: perfil.nombre });
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}
