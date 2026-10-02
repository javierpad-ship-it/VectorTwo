import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlanner } from "@/lib/auth/guard";
import { error, leerCuerpo, ok } from "@/lib/api/respuestas";
import { traducirErrorDb } from "@/lib/api/errores-db";
import { crearNodoSchema } from "@/lib/arbol/esquemas";

/**
 * Crea un nodo género-mundo-línea (`requirePlanner`), 201.
 * `404` si alguno de los tres no existe · `409` si la tripleta ya existe
 * (el mensaje dice si está inactiva, para reactivarla en vez de duplicar).
 */
export async function POST(request: NextRequest) {
  const { response } = await requirePlanner();
  if (response) return response;

  const { datos, respuesta } = await leerCuerpo(request, crearNodoSchema);
  if (respuesta) return respuesta;

  const db = supabaseAdmin();
  const [genero, mundo, linea, existente] = await Promise.all([
    db.from("generos").select("id, nombre").eq("id", datos.genero_id).maybeSingle(),
    db.from("mundos").select("id, nombre").eq("id", datos.mundo_id).maybeSingle(),
    db.from("lineas").select("id, nombre").eq("id", datos.linea_id).maybeSingle(),
    db
      .from("genero_mundo_linea")
      .select("id, activo")
      .eq("genero_id", datos.genero_id)
      .eq("mundo_id", datos.mundo_id)
      .eq("linea_id", datos.linea_id)
      .maybeSingle(),
  ]);

  const fallo = genero.error ?? mundo.error ?? linea.error ?? existente.error;
  if (fallo) return traducirErrorDb(fallo);
  if (!genero.data) return error("Género no encontrado.", 404);
  if (!mundo.data) return error("Mundo no encontrado.", 404);
  if (!linea.data) return error("Línea no encontrada.", 404);

  if (existente.data) {
    const donde = `${genero.data.nombre} / ${mundo.data.nombre}`;
    return error(
      existente.data.activo
        ? `La línea ${linea.data.nombre} ya existe en ${donde}.`
        : `La línea ${linea.data.nombre} ya existe en ${donde} pero está inactiva. Reactívala en lugar de crearla de nuevo.`,
      409
    );
  }

  const { data, error: err } = await db
    .from("genero_mundo_linea")
    .insert({ genero_id: datos.genero_id, mundo_id: datos.mundo_id, linea_id: datos.linea_id })
    .select("*")
    .single();
  if (err) return traducirErrorDb(err);
  return ok(data, 201);
}
