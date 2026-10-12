import type { NextRequest } from "next/server";
import type { PostgrestError } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlanner } from "@/lib/auth/guard";
import { error, leerCuerpo, ok } from "@/lib/api/respuestas";
import { describirErrorDb, registrarErrorDb, traducirErrorDb } from "@/lib/api/errores-db";
import { cargarEstadoArbol } from "@/lib/arbol/consultas";
import { enTandas } from "@/lib/arbol/importar";
import { importarMapeosSchema } from "@/lib/ventas/esquemas";
import { insertarMapeosSiNoExisten, leerMapeos, type MapeoInsert } from "@/lib/ventas/consultas";
import { nombreDeUsuario } from "@/lib/ventas/http";
import { columnasDeOrigen, planificarImportacionMapeos } from "@/lib/ventas/mapeos";
import type { ImportarMapeosRespuesta } from "@/lib/ventas/tipos-mapeo";

/**
 * Importador de mapeos (`requirePlanner`) con las cabeceras del CSV de
 * descarga. `previsualizar` devuelve cuántos se crearían y las filas omitidas
 * con su motivo, sin escribir. `aplicar` inserta solo los que se crean, en
 * tandas de 500 con `upsert … ignoreDuplicates` (idempotente: reimportar el
 * mismo archivo crea 0) y cuenta lo realmente insertado. Nunca actualiza un
 * mapeo existente (criterio de M2: `existente_distinto` se lista y se omite).
 * Sin transacción entre tandas: si una falla, `500` con lo creado hasta ahí y
 * reimportar completa el resto sin duplicar.
 */
export async function POST(request: NextRequest) {
  const { perfil, response } = await requirePlanner();
  if (response) return response;

  const { datos, respuesta } = await leerCuerpo(request, importarMapeosSchema);
  if (respuesta) return respuesta;

  const db = supabaseAdmin();
  const [arbol, existentes] = await Promise.all([cargarEstadoArbol(db), leerMapeos(db)]);
  if (arbol.error) return traducirErrorDb(arbol.error, "importar mapeos: árbol");
  if (existentes.error) return traducirErrorDb(existentes.error, "importar mapeos: leer existentes");

  const plan = planificarImportacionMapeos(datos.filas, arbol.estado, existentes.data);
  const base = { recibidas: plan.recibidas, crear: plan.crear.length, omitidas: plan.omitidas };

  if (datos.modo === "previsualizar") {
    const cuerpo: ImportarMapeosRespuesta = { ...base, creados: 0 };
    return ok(cuerpo);
  }

  const usuario = nombreDeUsuario(perfil);
  let creados = 0;
  const fallo = (err: PostgrestError) => {
    const descrito = describirErrorDb(err.code, err.message, err.details);
    if (descrito.status >= 500) registrarErrorDb(err, "importar mapeos");
    return error(
      `La importación se detuvo al crear mapeos: ${descrito.mensaje} Se crearon ${creados}; ` +
        "vuelve a importar el mismo archivo para completar el resto sin duplicar.",
      500
    );
  };

  for (const tanda of enTandas(plan.crear)) {
    const filas: MapeoInsert[] = tanda.map((m) => ({
      ...columnasDeOrigen(m.origen),
      equivalencia_id: m.equivalencia_id,
      motivo_origen: m.motivo_origen,
      nota: m.nota,
      perfil_id: perfil.id,
      usuario_nombre: usuario,
    }));
    const { data, error: err } = await insertarMapeosSiNoExisten(db, filas);
    if (err) return fallo(err);
    creados += data?.length ?? 0;
  }

  const cuerpo: ImportarMapeosRespuesta = { ...base, creados };
  return ok(cuerpo);
}
