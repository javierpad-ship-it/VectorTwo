import type { NextRequest } from "next/server";
import { requirePlanner } from "@/lib/auth/guard";
import { error, idDeRuta, ok } from "@/lib/api/respuestas";
import { porTiendaQuerySchema } from "@/lib/proyeccion/esquemas";
import { leerConsulta } from "@/lib/proyeccion/rutas";
import { leerConjuntosPorTienda, leerVentaPorTienda } from "@/lib/proyeccion/servicio-venta-por-tienda";

type Params = { params: Promise<{ id: string }> };

const NO_ENCONTRADA = "Proyección no encontrada.";

/**
 * «Ver por tienda» de Crecimientos (07f), SOLO LECTURA (`requirePlanner`: el comprador no ve Planificación y recibe `403`; sin sesión, `401`): la venta por tienda y año
 * (unidades y soles netos de IGV, sin CD) de un género × mundo (`?gm=<genero_id>.<mundo_id>`) o del Resto (`?gm=resto`), con las tiendas de la base de `Y+1` aparte de las que
 * quedan fuera, el cierre vigente de `Y` por tienda (informativo) y un subtotal de la base que cuadra exacto con `Σ B`. `400` si `gm` falta o está mal formado o si el género
 * no es de la matriz (`genero_no_detallado`); `404` si la proyección no existe o `gm_no_encontrado`; `409` `sin_calcular` o `calculo_en_curso`.
 * Sin `gm` (corrección 2026-11-05) devuelve la lista de conjuntos válidos (`{ conjuntos: [{ clave, nombre, es_resto }] }`) para el selector, sin depender de las filas de la proyección:
 * funciona aunque sea de método anterior o no se haya calculado. Un `gm` presente pero vacío sigue siendo `400`.
 */
export async function GET(request: NextRequest, { params }: Params) {
  const { response } = await requirePlanner();
  if (response) return response;

  const q = leerConsulta(request, porTiendaQuerySchema);
  if (q.respuesta) return q.respuesta;
  const { id, respuesta } = await idDeRuta(params, NO_ENCONTRADA);
  if (respuesta) return respuesta;
  if (q.datos.gm === undefined) {
    if (request.nextUrl.searchParams.has("gm")) return error("gm debe ser «genero_id.mundo_id» o «resto».", 400);
    const lista = await leerConjuntosPorTienda(id);
    if (lista.respuesta) return lista.respuesta;
    return ok(lista.data);
  }
  const r = await leerVentaPorTienda(id, q.datos.gm);
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}
