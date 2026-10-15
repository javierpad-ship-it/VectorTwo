import type { NextRequest } from "next/server";
import { requirePlanner } from "@/lib/auth/guard";
import { ok } from "@/lib/api/respuestas";
import { filasTiendaQuerySchema } from "@/lib/proyeccion/esquemas";
import { leerConsulta, leerSegmentos } from "@/lib/proyeccion/rutas";
import { leerFilasDeTienda } from "@/lib/proyeccion/servicio-lectura";

type Params = { params: Promise<{ id: string; tiendaId: string }> };

/**
 * Las filas (género · mundo · línea · marca) de UNA tienda nueva o cierre en un año (`requirePlanner`, solo lectura).
 * `?anio=` es obligatorio. `GET …/tiendas` ya no las trae (pesaban ~10 MB): el frontend las pide al abrir la tarjeta.
 */
export async function GET(request: NextRequest, { params }: Params) {
  const { response } = await requirePlanner();
  if (response) return response;

  const s = await leerSegmentos(params, ["id", "tiendaId"], "Tienda no encontrada.", { libres: ["tiendaId"] });
  if (s.respuesta) return s.respuesta;
  const { datos, respuesta } = leerConsulta(request, filasTiendaQuerySchema);
  if (respuesta) return respuesta;
  const r = await leerFilasDeTienda(s.valores.id, s.valores.tiendaId, datos.anio);
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}
