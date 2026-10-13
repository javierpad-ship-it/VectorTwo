import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlanner } from "@/lib/auth/guard";
import { ok } from "@/lib/api/respuestas";
import { traducirErrorDb } from "@/lib/api/errores-db";
import { existenHechosDeMarca } from "@/lib/ventas/consultas";
import { miembrosPorCabeza } from "@/lib/marcas/conjuntos/reglas";
import { armarVistaConjuntos } from "@/lib/marcas/conjuntos/vista";
import { cargarEstadoGml } from "@/lib/marcas/gml/estado";
import { contarAsignaciones } from "@/lib/marcas/gml/vista";

/**
 * Conjuntos de marcas (`requirePlanner`, 02b: es configuración del flujo, como
 * las marcas relevantes; las lecturas también son de planner). Una fila por
 * cabeza con al menos un miembro, por nombre, con los miembros, sus avisos
 * (`agrupacion_distinta`, `cabeza_inactiva`, `config_propia_ignorada`, `cadena`)
 * y el `resumen`. Los conjuntos con cabeza inactiva y los miembros desactivados
 * siempre se devuelven (la membresía de una marca desactivada sigue valiendo),
 * así que `?incluir_inactivas=1` se acepta pero no cambia nada. `vende` = la
 * cabeza tiene hechos en M5 (existencia por el índice de marca, `limit 1`).
 */
export async function GET() {
  const { response } = await requirePlanner();
  if (response) return response;

  const db = supabaseAdmin();
  const cargado = await cargarEstadoGml(db);
  if (cargado.error) return traducirErrorDb(cargado.error, "listar conjuntos");

  const cabezas = [...miembrosPorCabeza(cargado.marcas).keys()];
  const existencias = await Promise.all(cabezas.map((id) => existenHechosDeMarca(db, id)));
  const fallo = existencias.find((c) => c.error)?.error;
  if (fallo) return traducirErrorDb(fallo, "listar conjuntos: ver si venden");
  const vende = new Set(cabezas.filter((_, i) => existencias[i].existe));

  const agrupaciones = cargado.estado.agrupaciones.map((a) => ({ id: a.id, nombre: a.nombre }));
  return ok(armarVistaConjuntos(cargado.marcas, agrupaciones, contarAsignaciones(cargado.estado), vende));
}
