import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlanner } from "@/lib/auth/guard";
import { error, leerCuerpo, ok } from "@/lib/api/respuestas";
import { traducirErrorDb } from "@/lib/api/errores-db";
import { marcarPorGml } from "@/lib/marcas/consultas";
import { insertarAsignacion } from "@/lib/marcas/gml/consultas";
import { cargarEstadoGml } from "@/lib/marcas/gml/estado";
import { crearGmlEspecialSchema, estadoGmlQuerySchema } from "@/lib/marcas/gml/esquemas";
import { cambioMarca, motivoRechazoAsignacion } from "@/lib/marcas/gml/reglas";
import { armarVistaGml, describirAsignacion } from "@/lib/marcas/gml/vista";
import { parametrosNoVacios, pideInactivas } from "@/lib/marcas/query";
import type { CrearGmlEspecialRespuesta, EstadoGmlEspecial } from "@/lib/marcas/tipos-api";

/**
 * Estado de las marcas relevantes por GML (`requirePlanner`, 02b): marcas
 * marcadas (o con GML conservados) con sus asignaciones y su vigencia, la vista
 * inversa por nodo y el resumen. `?marca_id=` y `?nodo_id=` filtran (el resumen
 * sigue siendo el global); `?incluir_inactivas=1` suma las marcas desactivadas.
 * Una sola lectura de marcas, agrupaciones, asignaciones y árbol armada con
 * `armarVistaGml`.
 */
export async function GET(request: NextRequest) {
  const { response } = await requirePlanner();
  if (response) return response;

  const params = request.nextUrl.searchParams;
  const consulta = estadoGmlQuerySchema.safeParse(parametrosNoVacios(params, ["marca_id", "nodo_id"]));
  if (!consulta.success) return error("marca_id y nodo_id deben ser identificadores válidos.", 400);

  const cargado = await cargarEstadoGml(supabaseAdmin());
  if (cargado.error) return traducirErrorDb(cargado.error, "estado de marcas relevantes");

  const vista: EstadoGmlEspecial = armarVistaGml(cargado.estado, {
    incluirInactivas: pideInactivas(params),
    marcaId: consulta.data.marca_id,
    nodoId: consulta.data.nodo_id,
  });
  return ok(vista);
}

/**
 * Hace relevante a una marca en un GML (`requirePlanner`), 201. `404` marca o
 * nodo inexistente · `409` marca inactiva, marca miembro de un conjunto (cuenta
 * como su cabeza), nodo no vigente o par repetido. Una marca sin casilla, al
 * barrer o sin modalidad queda marcada `por_gml` (`update marcas`; la nota de
 * tratamiento no se toca) y el cambio vuelve en `cambio_marca`. Sin
 * transacción: si el `update` falla tras el `insert`, la asignación queda
 * ignorada y visible (`marca_sin_tratamiento` o `marca_en_barrido`) y repetir
 * desde Marcas lo arregla.
 */
export async function POST(request: NextRequest) {
  const { response } = await requirePlanner();
  if (response) return response;

  const { datos, respuesta } = await leerCuerpo(request, crearGmlEspecialSchema);
  if (respuesta) return respuesta;

  const db = supabaseAdmin();
  const cargado = await cargarEstadoGml(db);
  if (cargado.error) return traducirErrorDb(cargado.error, "hacer relevante una marca");
  const { estado } = cargado;

  const marca = estado.marcas.find((m) => m.id === datos.marca_id);
  const nodo = estado.nodos.get(datos.genero_mundo_linea_id);
  const rechazo = motivoRechazoAsignacion(marca, nodo, estado.marcas);
  if (rechazo || !marca) return error(rechazo?.mensaje ?? "Marca no encontrada.", rechazo?.status ?? 404);

  const repetida = estado.asignaciones.some(
    (a) => a.marca_id === marca.id && a.genero_mundo_linea_id === datos.genero_mundo_linea_id
  );
  if (repetida) return error("Esa marca ya es relevante en ese GML.", 409);

  const { data: fila, error: errInsertar } = await insertarAsignacion(db, {
    marca_id: marca.id,
    genero_mundo_linea_id: datos.genero_mundo_linea_id,
    nota: datos.nota,
  });
  if (errInsertar || !fila) {
    return errInsertar ? traducirErrorDb(errInsertar, "hacer relevante una marca") : error("No se pudo guardar el GML.", 500);
  }

  const cambio = cambioMarca(marca);
  let marcaFinal = marca;
  if (cambio) {
    const { error: errMarcar } = await marcarPorGml(db, [marca.id]);
    if (errMarcar) {
      const r = traducirErrorDb(errMarcar, "marcar la marca como Por GML");
      return r.status >= 500
        ? error(
            "El GML quedó asignado, pero no se pudo marcar la marca con tratamiento especial: el GML aparece ignorado hasta que la marques en Marcas.",
            500
          )
        : r;
    }
    marcaFinal = { ...marca, tratamiento_especial: true, modalidad_tratamiento: "por_gml" };
  }

  const asignacion = describirAsignacion(fila, marcaFinal, estado);
  if (!asignacion) return error("Nodo género-mundo-línea no encontrado.", 404);
  const cuerpo: CrearGmlEspecialRespuesta = { ...asignacion, marca_id: marca.id, cambio_marca: cambio };
  return ok(cuerpo, 201);
}
