import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlanner } from "@/lib/auth/guard";
import { leerCuerpo, ok } from "@/lib/api/respuestas";
import { traducirErrorDb } from "@/lib/api/errores-db";
import { cargarEstadoArbol } from "@/lib/arbol/consultas";
import { sugerirSchema } from "@/lib/ventas/esquemas";
import { crearSugeridor } from "@/lib/ventas/sugerir-mapeo";
import type { SugerirRespuesta } from "@/lib/ventas/tipos-mapeo";

/**
 * Sugiere destinos para 1 a 500 orígenes (`requirePlanner`). No escribe nada
 * ni aplica nada: devuelve, en la misma posición que la petición, hasta 3
 * sugerencias por origen con su puntuación (0,50 a 1,00) y la razón; `[]` si no
 * hay ninguna razonable. Determinista: el mismo origen y árbol dan lo mismo.
 */
export async function POST(request: NextRequest) {
  const { response } = await requirePlanner();
  if (response) return response;

  const { datos, respuesta } = await leerCuerpo(request, sugerirSchema);
  if (respuesta) return respuesta;

  const arbol = await cargarEstadoArbol(supabaseAdmin());
  if (arbol.error) return traducirErrorDb(arbol.error, "sugerir mapeos: árbol");

  const sugerir = crearSugeridor(arbol.estado);
  const cuerpo: SugerirRespuesta = { sugerencias: datos.combinaciones.map((c) => sugerir(c)) };
  return ok(cuerpo);
}
