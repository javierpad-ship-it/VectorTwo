import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlanner } from "@/lib/auth/guard";
import { ok } from "@/lib/api/respuestas";
import { vigentesQuerySchema } from "@/lib/marcas-barrer/esquemas";
import { leerConsulta } from "@/lib/marcas-barrer/rutas";
import { leerRepartosVigentes } from "@/lib/marcas-barrer/servicio";

/**
 * Contrato de M8 y M9 (`requirePlanner`, solo lectura): los repartos vigentes de las marcas (`?marca_ids=a,b,c`; sin ellas, todos)
 * con su versión, modo, alcance, error y una fila por `g` y temporada; las marcas que no tienen reparto aprobado van en
 * `sin_reparto`. M8 lo incluye en su propia respuesta porque el comprador no puede llamar aquí. No recalcula nada.
 */
export async function GET(request: NextRequest) {
  const { response } = await requirePlanner();
  if (response) return response;

  const { datos, respuesta } = leerConsulta(request, vigentesQuerySchema);
  if (respuesta) return respuesta;
  const r = await leerRepartosVigentes(supabaseAdmin(), datos.marca_ids.length > 0 ? datos.marca_ids : null);
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}
