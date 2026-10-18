import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlanner } from "@/lib/auth/guard";
import { ok } from "@/lib/api/respuestas";
import { listaQuerySchema } from "@/lib/marcas-barrer/esquemas";
import { leerConsulta } from "@/lib/marcas-barrer/rutas";
import { listarMarcasBarrer } from "@/lib/marcas-barrer/servicio";

/**
 * Lista de las marcas al barrer y mixtas (`requirePlanner`, solo lectura: M12). Una fila por unidad de marca con `?ventana=`
 * (12, 24 o 36 meses; 24 por defecto): unidades de la ventana, parte al barrer y específica, `g` con venta (y cuántas pequeñas),
 * error del último reparto aprobado, reparto vigente y su estado (`sin_reparto`, `al_dia`, `obsoleto` con sus motivos). Sale de la
 * función SQL resumen: no lee hechos por mes. El comprador no accede (`403`).
 */
export async function GET(request: NextRequest) {
  const { response } = await requirePlanner();
  if (response) return response;

  const { datos, respuesta } = leerConsulta(request, listaQuerySchema);
  if (respuesta) return respuesta;
  const r = await listarMarcasBarrer(supabaseAdmin(), datos.ventana as 12 | 24 | 36);
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}
