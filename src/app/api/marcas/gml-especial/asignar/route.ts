import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlanner } from "@/lib/auth/guard";
import { error, leerCuerpo, ok } from "@/lib/api/respuestas";
import { describirErrorDb, registrarErrorDb, traducirErrorDb } from "@/lib/api/errores-db";
import { marcarPorGml } from "@/lib/marcas/consultas";
import { borrarAsignaciones, insertarAsignacionesSiNoExisten } from "@/lib/marcas/gml/consultas";
import { cargarEstadoGml } from "@/lib/marcas/gml/estado";
import { asignarGmlSchema } from "@/lib/marcas/gml/esquemas";
import { planificarAsignacionBloque } from "@/lib/marcas/gml/asignar";
import type { AsignarGmlRespuesta } from "@/lib/marcas/tipos-api";
import type { PostgrestError } from "@supabase/supabase-js";

/**
 * Asignación en bloque de marcas relevantes (`requirePlanner`, 02b). Dos formas
 * de cuerpo: producto cartesiano (estos GML a estas marcas) o lista de pares
 * (sugerencias y vista Por GML). El handler lee marcas, árbol y asignaciones una
 * sola vez, `planificarAsignacionBloque` decide y aquí solo se escribe: `upsert
 * … ignoreDuplicates` en tandas de 500, `delete … in (ids)` y `update marcas …
 * in (ids)` en tandas de 150. Marcas o nodos inexistentes y rechazos
 * (`marca_inactiva`, `marca_en_conjunto`, `nodo_no_vigente`) no abortan: vuelven
 * en `no_permitidas`. Sin transacción: repetir el bloque completa lo que faltó.
 * Invariante: `pares = asignadas + sin_cambio + quitadas + no_permitidas.length`.
 */
export async function POST(request: NextRequest) {
  const { response } = await requirePlanner();
  if (response) return response;

  const { datos, respuesta } = await leerCuerpo(request, asignarGmlSchema);
  if (respuesta) return respuesta;

  const db = supabaseAdmin();
  const cargado = await cargarEstadoGml(db);
  if (cargado.error) return traducirErrorDb(cargado.error, "asignar GML en bloque: leer estado");
  const { estado } = cargado;

  const plan = planificarAsignacionBloque(datos, {
    marcas: estado.marcas,
    nodos: estado.nodos,
    asignaciones: estado.asignaciones,
  });
  const reporte: AsignarGmlRespuesta = plan.reporte;

  const fallo = (err: PostgrestError, haciendo: string) => {
    const descrito = describirErrorDb(err.code, err.message, err.details);
    if (descrito.status >= 500) registrarErrorDb(err, `asignar GML en bloque: ${haciendo}`);
    return error(
      `La asignación se detuvo al ${haciendo}: ${descrito.mensaje} ` +
        `Se hizo parte del bloque (${reporte.asignadas} asignadas, ${reporte.quitadas} quitadas según el plan); ` +
        "repite el mismo bloque para completar el resto.",
      descrito.status >= 500 ? 500 : descrito.status
    );
  };

  if (plan.borrar_ids.length > 0) {
    const { borradas, error: err } = await borrarAsignaciones(db, plan.borrar_ids);
    if (err) return fallo(err, "quitar GML");
    reporte.sin_cambio += reporte.quitadas - borradas; // otro usuario ya los había quitado
    reporte.quitadas = borradas;
  }

  if (plan.insertar.length > 0) {
    const { insertadas, error: err } = await insertarAsignacionesSiNoExisten(
      db,
      plan.insertar.map((p) => ({ marca_id: p.marca_id, genero_mundo_linea_id: p.genero_mundo_linea_id, nota: p.nota }))
    );
    if (err) return fallo(err, "hacer relevantes los GML");
    reporte.sin_cambio += reporte.asignadas - insertadas; // otro usuario ya los había creado
    reporte.asignadas = insertadas;
  }

  if (plan.marcar_ids.length > 0) {
    const { error: err } = await marcarPorGml(db, plan.marcar_ids);
    if (err) return fallo(err, "marcar las marcas como Por GML");
  }

  return ok(reporte);
}
