import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlanner } from "@/lib/auth/guard";
import { leerCuerpo, ok } from "@/lib/api/respuestas";
import { aprobarRepartoSchema } from "@/lib/marcas-barrer/esquemas";
import { leerMarcaId } from "@/lib/marcas-barrer/rutas";
import { aprobarReparto, leerRepartos } from "@/lib/marcas-barrer/servicio";

type Params = { params: Promise<{ marcaId: string }> };

/**
 * Todas las versiones del reparto de una marca (`requirePlanner`, solo lectura: M12), la más reciente primero y con sus filas
 * (una por `g` y temporada). `404` si la marca no existe. Se muestran también las de una marca que ya no es al barrer.
 */
export async function GET(_request: NextRequest, { params }: Params) {
  const { response } = await requirePlanner();
  if (response) return response;

  const { marcaId, respuesta } = await leerMarcaId(params);
  if (respuesta) return respuesta;
  const r = await leerRepartos(supabaseAdmin(), marcaId);
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}

/**
 * Aprueba un reparto (`requirePlanner`, escribe: M12), `201`. Una versión nueva por aprobación, a nombre de quien la aprueba y con
 * su fecha; la anterior deja de ser la vigente. NUNCA se aprueba solo: ninguna recomendación reemplaza la decisión del planner.
 * Recalcula el análisis con los parámetros del cuerpo y exige su `huella`. `409` con `codigo`: `huella_cambiada`,
 * `suma_invalida`, `nota_requerida`, `sin_cerrada` (fuente `cerrada` sin cerrada), `fila_desconocida`, `modalidad_no_barrer`,
 * `marca_en_conjunto`, `sin_datos`. Las filas de resto llegan expandidas por `g`.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const { perfil, response } = await requirePlanner();
  if (response) return response;

  const { marcaId, respuesta: respuestaId } = await leerMarcaId(params);
  if (respuestaId) return respuestaId;
  const { datos, respuesta } = await leerCuerpo(request, aprobarRepartoSchema);
  if (respuesta) return respuesta;

  const r = await aprobarReparto(supabaseAdmin(), marcaId, datos, { id: perfil.id, nombre: perfil.nombre });
  if (r.respuesta) return r.respuesta;
  return ok(r.data, 201);
}
