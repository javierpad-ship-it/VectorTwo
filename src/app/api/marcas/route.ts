import type { NextRequest } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlanner, requireUser } from "@/lib/auth/guard";
import { error, leerCuerpo, ok } from "@/lib/api/respuestas";
import { traducirErrorDb } from "@/lib/api/errores-db";
import { incluirInactivos } from "@/lib/api/catalogo";
import type { TablesInsert } from "@/lib/supabase/database.types";
import { leerTodo } from "@/lib/arbol/consultas";
import { crearMarcaSchema } from "@/lib/marcas/esquemas";
import { SELECT_MARCA_CON_AGRUPACION, aMarcaFila, type MarcaLeida } from "@/lib/marcas/consultas";
import { AGRUPACION_NO_ENCONTRADA, motivoRechazoAgrupacionDestino } from "@/lib/marcas/reglas";

const agrupacionIdSchema = z.uuid();

/**
 * Marcas por `nombre` con la agrupación embebida y `vigente` (`requireUser`).
 * `?agrupacion_id=` filtra por agrupación (`400` si no es UUID);
 * `?incluir_inactivos=1` incluye las desactivadas. Una marca activa de una
 * agrupación inactiva sí viaja, con `vigente: false`.
 */
export async function GET(request: NextRequest) {
  const { response } = await requireUser();
  if (response) return response;

  const crudo = request.nextUrl.searchParams.get("agrupacion_id");
  let agrupacionId: string | null = null;
  if (crudo !== null && crudo !== "") {
    const parseado = agrupacionIdSchema.safeParse(crudo);
    if (!parseado.success) return error("agrupacion_id no es un identificador válido.", 400);
    agrupacionId = parseado.data;
  }
  const soloActivas = !incluirInactivos(request);

  const db = supabaseAdmin();
  const { data, error: err } = await leerTodo<MarcaLeida>((desde, hasta) => {
    let consulta = db.from("marcas").select(SELECT_MARCA_CON_AGRUPACION);
    if (agrupacionId) consulta = consulta.eq("agrupacion_marca_id", agrupacionId);
    if (soloActivas) consulta = consulta.eq("activo", true);
    return consulta.order("nombre").order("id").range(desde, hasta);
  });
  if (err) return traducirErrorDb(err, "listar marcas");

  return ok(data.map(aMarcaFila));
}

/**
 * Crea una marca (`requirePlanner`), 201. Comprueba en orden: la agrupación
 * existe (`404`) → está activa (`409`) → escribe y traduce únicos (`409`
 * nombre o código repetido). La nota sin bandera la rechaza el esquema (`400`).
 */
export async function POST(request: NextRequest) {
  const { response } = await requirePlanner();
  if (response) return response;

  const { datos, respuesta } = await leerCuerpo(request, crearMarcaSchema);
  if (respuesta) return respuesta;

  const db = supabaseAdmin();
  const { data: agrupacion, error: errAgrupacion } = await db
    .from("agrupaciones_marca")
    .select("id, nombre, activo")
    .eq("id", datos.agrupacion_marca_id)
    .maybeSingle();
  if (errAgrupacion) return traducirErrorDb(errAgrupacion, "buscar agrupación de marca");
  const motivo = motivoRechazoAgrupacionDestino(agrupacion);
  if (motivo) return error(motivo, motivo === AGRUPACION_NO_ENCONTRADA ? 404 : 409);

  const nueva: TablesInsert<"marcas"> = {
    nombre: datos.nombre,
    codigo: datos.codigo,
    agrupacion_marca_id: datos.agrupacion_marca_id,
    tratamiento_especial: datos.tratamiento_especial,
    nota_tratamiento: datos.nota_tratamiento,
  };
  const { data, error: err } = await db.from("marcas").insert(nueva).select(SELECT_MARCA_CON_AGRUPACION).single();
  if (err) return traducirErrorDb(err, "crear marca");
  return ok(aMarcaFila(data), 201);
}
