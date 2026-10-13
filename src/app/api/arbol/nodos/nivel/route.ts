import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlanner } from "@/lib/auth/guard";
import { error, leerCuerpo, ok } from "@/lib/api/respuestas";
import { traducirErrorDb } from "@/lib/api/errores-db";
import { leerNodos } from "@/lib/arbol/consultas";
import { escribirNivel } from "@/lib/arbol/nivel/consultas";
import { nivelBloqueSchema } from "@/lib/arbol/nivel/esquemas";
import { planificarNivelBloque } from "@/lib/arbol/nivel/reglas";
import { nivelDeNodo } from "@/lib/arbol/armar-arbol";
import type { NivelBloqueRespuesta } from "@/lib/arbol/tipos";

/**
 * Cambia el nivel de planificación de varios nodos a la vez
 * (`requirePlanner`, 02b). Deduplica los ids; los que no existen vuelven en
 * `no_encontrados` sin abortar; los que ya tienen ese nivel cuentan como
 * `sin_cambio`. Los nodos no vigentes se cambian igual (es una propiedad del
 * nodo). Sin transacción: `update … in (ids)` en tandas de 150; repetir el
 * bloque completa lo que faltó.
 */
export async function POST(request: NextRequest) {
  const { response } = await requirePlanner();
  if (response) return response;

  const { datos, respuesta } = await leerCuerpo(request, nivelBloqueSchema);
  if (respuesta) return respuesta;

  const db = supabaseAdmin();
  const nodos = await leerNodos(db);
  if (nodos.error) return traducirErrorDb(nodos.error, "nivel en bloque: leer nodos");

  const plan = planificarNivelBloque(
    datos.nodo_ids,
    datos.nivel,
    nodos.data.map((n) => ({ id: n.id, nivel_planificacion: nivelDeNodo(n) }))
  );

  const { escritos, error: err } = await escribirNivel(db, plan.ids_a_cambiar, plan.nivel);
  if (err) {
    const respuestaError = traducirErrorDb(err, "nivel en bloque: escribir");
    if (respuestaError.status >= 500) {
      return error(
        `Se cambiaron ${escritos} de ${plan.cambiados} nodos y el resto falló. Repite el bloque para completar.`,
        500
      );
    }
    return respuestaError;
  }

  const cuerpo: NivelBloqueRespuesta = {
    nivel: plan.nivel,
    cambiados: plan.cambiados,
    sin_cambio: plan.sin_cambio,
    no_encontrados: plan.no_encontrados,
  };
  return ok(cuerpo);
}
