import type { NextRequest } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlanner, requireUser } from "@/lib/auth/guard";
import { puedeEditarMaestros } from "@/lib/auth/roles";
import { error, leerCuerpo, ok } from "@/lib/api/respuestas";
import { traducirErrorDb } from "@/lib/api/errores-db";
import { incluirInactivos } from "@/lib/api/catalogo";
import type { TablesInsert } from "@/lib/supabase/database.types";
import { crearMarcaSchema } from "@/lib/marcas/esquemas";
import { SELECT_MARCA_CON_AGRUPACION } from "@/lib/marcas/consultas";
import { cargarEstadoGml, filasDeMarcas } from "@/lib/marcas/gml/estado";
import { sinConfiguracionDePlanificacion } from "@/lib/marcas/filas";
import { AGRUPACION_NO_ENCONTRADA, motivoRechazoAgrupacionDestino } from "@/lib/marcas/reglas";

const agrupacionIdSchema = z.uuid();

/**
 * Marcas por `nombre` con la agrupación embebida y `vigente` (`requireUser`).
 * `?agrupacion_id=` filtra por agrupación (`400` si no es UUID);
 * `?incluir_inactivos=1` incluye las desactivadas. Una marca activa de una
 * agrupación inactiva sí viaja, con `vigente: false`. Desde 02b cada fila suma
 * la modalidad (`modalidad_efectiva`), los conteos de GML (`gml_asignados`,
 * `gml_vigentes`) y lo del conjunto (`conjunto`, `unidad_marca_id`, `miembros`,
 * `avisos_conjunto`); el conjunto y la unidad se calculan sobre TODAS las
 * marcas aunque el filtro devuelva solo algunas. Quien no puede editar maestros
 * (comprador) recibe esos campos con valores neutros (0, null, []).
 */
export async function GET(request: NextRequest) {
  const { response, rol } = await requireUser();
  if (response) return response;

  const crudo = request.nextUrl.searchParams.get("agrupacion_id");
  let agrupacionId: string | null = null;
  if (crudo !== null && crudo !== "") {
    const parseado = agrupacionIdSchema.safeParse(crudo);
    if (!parseado.success) return error("agrupacion_id no es un identificador válido.", 400);
    agrupacionId = parseado.data;
  }
  const soloActivas = !incluirInactivos(request);

  const cargado = await cargarEstadoGml(supabaseAdmin());
  if (cargado.error) return traducirErrorDb(cargado.error, "listar marcas");

  const elegidas = new Set(
    cargado.marcas
      .filter((m) => (!agrupacionId || m.agrupacion_marca_id === agrupacionId) && (!soloActivas || m.activo))
      .map((m) => m.id)
  );
  const filas = filasDeMarcas(cargado, elegidas);
  // La modalidad, los GML y los conjuntos son configuración de planificación: el comprador no los ve.
  return ok(puedeEditarMaestros(rol) ? filas : filas.map(sinConfiguracionDePlanificacion));
}

/**
 * Crea una marca (`requirePlanner`), 201. Comprueba en orden: la agrupación
 * existe (`404`) → está activa (`409`) → escribe y traduce únicos (`409`
 * nombre o código repetido). La nota o la modalidad sin bandera las rechaza el
 * esquema (`400`); con bandera y sin modalidad se guarda `barrido` (02b).
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
    modalidad_tratamiento: datos.modalidad_tratamiento,
  };
  const { data, error: err } = await db.from("marcas").insert(nueva).select(SELECT_MARCA_CON_AGRUPACION).single();
  if (err) return traducirErrorDb(err, "crear marca");

  const cargado = await cargarEstadoGml(db);
  if (cargado.error) return traducirErrorDb(cargado.error, "crear marca: leer estado");
  const [fila] = filasDeMarcas(cargado, new Set([data.id]));
  return ok(fila, 201);
}
