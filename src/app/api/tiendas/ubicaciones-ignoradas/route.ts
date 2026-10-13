import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlanner } from "@/lib/auth/guard";
import { leerCuerpo, ok } from "@/lib/api/respuestas";
import { traducirErrorDb } from "@/lib/api/errores-db";
import { crearUbicacionIgnoradaSchema } from "@/lib/tiendas/esquemas";
import { crearUbicacionIgnorada, leerTiendas, leerUbicacionesIgnoradas } from "@/lib/tiendas/consultas";
import { aUbicacionIgnoradaApi, rechazoCrearUbicacion } from "@/lib/tiendas/ubicaciones";
import type { ErrorNombreEsTienda, UbicacionIgnoradaApi } from "@/lib/tiendas/tipos-api";

/**
 * Ubicaciones ignoradas (M5c): nombres de la columna TIENDA del archivo de
 * venta que no son tiendas. Todo `requirePlanner`, lecturas incluidas.
 *
 * GET: por `nombre`, solo `activo = true`; `sin_efecto` se calcula en memoria
 * contra todas las tiendas (activas o no): la tienda manda.
 */
export async function GET() {
  const { response } = await requirePlanner();
  if (response) return response;

  const db = supabaseAdmin();
  const [ubicaciones, tiendas] = await Promise.all([leerUbicacionesIgnoradas(db), leerTiendas(db, { soloActivas: false })]);
  if (ubicaciones.error) return traducirErrorDb(ubicaciones.error, "listar ubicaciones ignoradas");
  if (tiendas.error) return traducirErrorDb(tiendas.error, "listar ubicaciones ignoradas: tiendas");

  const filas: UbicacionIgnoradaApi[] = ubicaciones.data.map((u) => aUbicacionIgnoradaApi(u, tiendas.data));
  return ok(filas);
}

/**
 * POST: crea una ubicación ignorada (`201`, `sin_efecto: null`). `409
 * { error, codigo: "nombre_es_tienda" }` si existe una tienda (activa o no) con
 * ese nombre; `409` si el nombre ya está en la lista (único).
 */
export async function POST(request: NextRequest) {
  const { response } = await requirePlanner();
  if (response) return response;

  const { datos, respuesta } = await leerCuerpo(request, crearUbicacionIgnoradaSchema);
  if (respuesta) return respuesta;

  const db = supabaseAdmin();
  const tiendas = await leerTiendas(db, { soloActivas: false });
  if (tiendas.error) return traducirErrorDb(tiendas.error, "crear ubicación ignorada: tiendas");
  const rechazo = rechazoCrearUbicacion(datos.nombre, tiendas.data);
  if (rechazo) {
    const cuerpo: ErrorNombreEsTienda = { error: rechazo, codigo: "nombre_es_tienda" };
    return NextResponse.json(cuerpo, { status: 409 });
  }

  const { data, error: err } = await crearUbicacionIgnorada(db, { nombre: datos.nombre, nota: datos.nota });
  if (err) return traducirErrorDb(err, "crear ubicación ignorada");
  return ok(aUbicacionIgnoradaApi(data), 201);
}
