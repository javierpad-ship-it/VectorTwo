import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlanner } from "@/lib/auth/guard";
import { ok } from "@/lib/api/respuestas";
import { analisisQuerySchema } from "@/lib/marcas-barrer/esquemas";
import { leerConsulta, leerMarcaId } from "@/lib/marcas-barrer/rutas";
import { analizarMarcaServicio } from "@/lib/marcas-barrer/servicio";
import { normalizarAlcance } from "@/lib/marcas-barrer/reparto";

type Params = { params: Promise<{ marcaId: string }> };

/**
 * Análisis de una marca al barrer o mixta (`requirePlanner`, solo lectura: M12; se calcula a demanda y no se guarda).
 * `?ventana=&modo=anual|por_temporada&normaliza_nino=1&genero=&mundo=&lineas=` (alcance: ids separados por comas). Devuelve el
 * reparto `p2` (histórico y según la cerrada de M7), el peso `p1`, el alcance, los GML pequeños agrupados, el error del reparto,
 * la estacionalidad, la parte al barrer, el reparto vigente con su estado y la `huella` que el `POST` de aprobar exige.
 * `404` si no existe; `409 modalidad_no_barrer`; `409 marca_en_conjunto`.
 */
export async function GET(request: NextRequest, { params }: Params) {
  const { response } = await requirePlanner();
  if (response) return response;

  const { marcaId, respuesta: respuestaId } = await leerMarcaId(params);
  if (respuestaId) return respuestaId;
  const { datos, respuesta } = leerConsulta(request, analisisQuerySchema);
  if (respuesta) return respuesta;

  const r = await analizarMarcaServicio(supabaseAdmin(), marcaId, {
    ventana: datos.ventana as 12 | 24 | 36,
    modo: datos.modo,
    alcance: normalizarAlcance({ generos: datos.genero, mundos: datos.mundo, lineas: datos.lineas }),
    normaliza_nino: datos.normaliza_nino,
  });
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}
