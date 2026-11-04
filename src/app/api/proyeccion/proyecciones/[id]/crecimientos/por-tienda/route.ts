import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth/guard";
import { idDeRuta, ok } from "@/lib/api/respuestas";
import { porTiendaQuerySchema } from "@/lib/proyeccion/esquemas";
import { leerConsulta } from "@/lib/proyeccion/rutas";
import { leerVentaPorTienda } from "@/lib/proyeccion/servicio-venta-por-tienda";

type Params = { params: Promise<{ id: string }> };

const NO_ENCONTRADA = "Proyección no encontrada.";

/**
 * «Ver por tienda» de Crecimientos (07f), SOLO LECTURA (`requireUser`: los tres roles ven Crecimientos y el comprador ve venta y stock, decisión 99): la venta por tienda y año
 * (unidades y soles netos de IGV, sin CD) de un género × mundo (`?gm=<genero_id>.<mundo_id>`) o del Resto (`?gm=resto`), con las tiendas de la base de `Y+1` aparte de las que
 * quedan fuera, el cierre vigente de `Y` por tienda (informativo) y un subtotal de la base que cuadra exacto con `Σ B`. `400` si `gm` falta o está mal formado o si el género
 * no es de la matriz (`genero_no_detallado`); `404` si la proyección no existe o `gm_no_encontrado`; `409` `sin_calcular` o `calculo_en_curso`.
 */
export async function GET(request: NextRequest, { params }: Params) {
  const { response } = await requireUser();
  if (response) return response;

  const q = leerConsulta(request, porTiendaQuerySchema);
  if (q.respuesta) return q.respuesta;
  const { id, respuesta } = await idDeRuta(params, NO_ENCONTRADA);
  if (respuesta) return respuesta;
  const r = await leerVentaPorTienda(id, q.datos.gm);
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}
