import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlanner } from "@/lib/auth/guard";
import { error, idDeRuta, leerCuerpo, ok } from "@/lib/api/respuestas";
import { traducirErrorDb } from "@/lib/api/errores-db";
import { editarUbicacionIgnoradaSchema } from "@/lib/tiendas/esquemas";
import {
  buscarUbicacionIgnorada,
  editarUbicacionIgnorada,
  eliminarUbicacionIgnorada,
  leerTiendas,
} from "@/lib/tiendas/consultas";
import {
  MENSAJE_UBICACION_NO_ENCONTRADA,
  aUbicacionIgnoradaApi,
  rechazoCrearUbicacion,
} from "@/lib/tiendas/ubicaciones";
import type { ErrorNombreEsTienda } from "@/lib/tiendas/tipos-api";

type Params = { params: Promise<{ id: string }> };

/**
 * Edita nombre y/o nota (`requirePlanner`). `404` si no existe; si cambia el
 * nombre, los mismos `409` que al crear (`nombre_es_tienda` y nombre repetido).
 * `nota: ""` o `null` la borra; ausente, no se toca. Devuelve la fila con
 * `sin_efecto: null`.
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  const { response } = await requirePlanner();
  if (response) return response;

  const { id, respuesta: respuestaId } = await idDeRuta(params, MENSAJE_UBICACION_NO_ENCONTRADA);
  if (respuestaId) return respuestaId;
  const { datos, respuesta } = await leerCuerpo(request, editarUbicacionIgnoradaSchema);
  if (respuesta) return respuesta;

  const db = supabaseAdmin();
  const { data: actual, error: errActual } = await buscarUbicacionIgnorada(db, id);
  if (errActual) return traducirErrorDb(errActual, "buscar ubicación ignorada");
  if (!actual) return error(MENSAJE_UBICACION_NO_ENCONTRADA, 404);

  const cambio: { nombre?: string; nota?: string | null } = {};
  if (datos.nombre !== undefined) cambio.nombre = datos.nombre;
  if (datos.nota !== undefined) cambio.nota = datos.nota;

  if (datos.nombre !== undefined && datos.nombre !== actual.nombre) {
    const tiendas = await leerTiendas(db, { soloActivas: false });
    if (tiendas.error) return traducirErrorDb(tiendas.error, "editar ubicación ignorada: tiendas");
    const rechazo = rechazoCrearUbicacion(datos.nombre, tiendas.data);
    if (rechazo) {
      const cuerpo: ErrorNombreEsTienda = { error: rechazo, codigo: "nombre_es_tienda" };
      return NextResponse.json(cuerpo, { status: 409 });
    }
  }

  const { data, error: err } = await editarUbicacionIgnorada(db, id, cambio);
  if (err) return traducirErrorDb(err, "editar ubicación ignorada");
  return ok(aUbicacionIgnoradaApi(data));
}

/** Quita la ubicación de la lista (`requirePlanner`): borra la fila. `404` si no existe; nunca `409` (nada cuelga de ella). */
export async function DELETE(_request: NextRequest, { params }: Params) {
  const { response } = await requirePlanner();
  if (response) return response;

  const { id, respuesta } = await idDeRuta(params, MENSAJE_UBICACION_NO_ENCONTRADA);
  if (respuesta) return respuesta;

  const db = supabaseAdmin();
  const { data: actual, error: errActual } = await buscarUbicacionIgnorada(db, id);
  if (errActual) return traducirErrorDb(errActual, "buscar ubicación ignorada");
  if (!actual) return error(MENSAJE_UBICACION_NO_ENCONTRADA, 404);

  const { error: err } = await eliminarUbicacionIgnorada(db, id);
  if (err) return traducirErrorDb(err, "quitar ubicación ignorada");
  return ok({ id });
}
