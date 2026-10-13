import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlanner } from "@/lib/auth/guard";
import { error, leerCuerpo, ok } from "@/lib/api/respuestas";
import { describirErrorDb, registrarErrorDb, traducirErrorDb } from "@/lib/api/errores-db";
import { fijarConjunto, leerMarcas } from "@/lib/marcas/consultas";
import { planificarMiembrosBloque } from "@/lib/marcas/conjuntos/reglas";
import { miembrosSchema } from "@/lib/marcas/conjuntos/esquemas";

/**
 * Agrega o quita miembros de un conjunto en bloque (`requirePlanner`, 02b).
 * Cada marca pasa por `motivoRechazoConjunto` (regla 21); las rechazadas vuelven
 * en `no_permitidas` y no abortan el bloque. `asignar` sobre una marca que ya
 * está en OTRO conjunto la cambia de conjunto y lo informa en
 * `cambiadas_de_conjunto` (la pantalla lo confirma antes). `quitar` siempre se
 * permite. `404` si la cabeza no existe. `update marcas set conjunto_marca_id …
 * in (ids)` en tandas de 150, sin transacción: repetir el bloque completa lo
 * que faltó. Invariante: `|marca_ids| = asignadas + quitadas + sin_cambio +
 * no_permitidas.length`.
 */
export async function POST(request: NextRequest) {
  const { response } = await requirePlanner();
  if (response) return response;

  const { datos, respuesta } = await leerCuerpo(request, miembrosSchema);
  if (respuesta) return respuesta;

  const db = supabaseAdmin();
  const marcas = await leerMarcas(db);
  if (marcas.error) return traducirErrorDb(marcas.error, "conjuntos: leer marcas");
  if (!marcas.data.some((m) => m.id === datos.cabeza_marca_id)) return error("Marca cabeza no encontrada.", 404);

  const plan = planificarMiembrosBloque(datos.cabeza_marca_id, datos.accion, datos.marca_ids, marcas.data);

  if (plan.ids_a_escribir.length > 0) {
    const { escritas, error: err } = await fijarConjunto(
      db,
      plan.ids_a_escribir,
      datos.accion === "asignar" ? datos.cabeza_marca_id : null
    );
    if (err) {
      const descrito = describirErrorDb(err.code, err.message, err.details);
      if (descrito.status >= 500) registrarErrorDb(err, "conjuntos: miembros");
      return error(
        `El bloque se detuvo: ${descrito.mensaje} Se cambiaron ${escritas} de ${plan.ids_a_escribir.length} marcas; repite el bloque para completar.`,
        descrito.status >= 500 ? 500 : descrito.status
      );
    }
  }

  return ok(plan.reporte);
}
