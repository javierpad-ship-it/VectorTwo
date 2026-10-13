import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlanner } from "@/lib/auth/guard";
import { error, ok } from "@/lib/api/respuestas";
import { traducirErrorDb } from "@/lib/api/errores-db";
import { leerMarcasConAgrupacion } from "@/lib/marcas/consultas";
import { sugerenciasConjuntosQuerySchema } from "@/lib/marcas/conjuntos/esquemas";
import { sugerirConjuntos } from "@/lib/marcas/conjuntos/similitud";
import { parametrosNoVacios } from "@/lib/marcas/query";
import type { SugerenciasConjuntosRespuesta } from "@/lib/marcas/tipos-api";

/**
 * Marcas sueltas que PARECEN del mismo conjunto por nombre (`requirePlanner`,
 * 02b, regla 24): primera palabra común o similitud de nombres (`umbral` de 0,3 a
 * 0,9, por defecto 0,5). Solo ayuda: nunca crea ni cambia nada.
 */
export async function GET(request: NextRequest) {
  const { response } = await requirePlanner();
  if (response) return response;

  const consulta = sugerenciasConjuntosQuerySchema.safeParse(parametrosNoVacios(request.nextUrl.searchParams, ["umbral"]));
  if (!consulta.success) return error(consulta.error.issues[0]?.message ?? "umbral inválido.", 400);

  const marcas = await leerMarcasConAgrupacion(supabaseAdmin());
  if (marcas.error) return traducirErrorDb(marcas.error, "sugerir conjuntos");

  const grupos = sugerirConjuntos(
    marcas.data.map((m) => ({
      id: m.id,
      nombre: m.nombre,
      activo: m.activo,
      agrupacion_marca_id: m.agrupacion_marca_id,
      conjunto_marca_id: m.conjunto_marca_id,
      agrupacion_nombre: m.agrupacion_marca?.nombre ?? "",
    })),
    consulta.data.umbral
  );
  const cuerpo: SugerenciasConjuntosRespuesta = { grupos };
  return ok(cuerpo);
}
