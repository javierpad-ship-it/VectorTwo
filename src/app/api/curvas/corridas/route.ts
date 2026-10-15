import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlanner } from "@/lib/auth/guard";
import { ok } from "@/lib/api/respuestas";
import { traducirErrorDb } from "@/lib/api/errores-db";
import { aCorridaResumen, leerCorridasLista } from "@/lib/curvas/consultas";
import type { CorridaListaApi } from "@/lib/curvas/tipos-api";

/** Las últimas 50 corridas SIN `resultado` (`requirePlanner`), de la más reciente a la más antigua. */
export async function GET() {
  const { response } = await requirePlanner();
  if (response) return response;

  const { data, error: err } = await leerCorridasLista(supabaseAdmin(), 50);
  if (err) return traducirErrorDb(err, "listar corridas de curvas");
  const lista: CorridaListaApi[] = data.map(aCorridaResumen);
  return ok(lista);
}
