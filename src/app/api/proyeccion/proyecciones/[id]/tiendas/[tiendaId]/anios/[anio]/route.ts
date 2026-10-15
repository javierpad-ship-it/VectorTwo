import type { NextRequest } from "next/server";
import { requirePlanner } from "@/lib/auth/guard";
import { leerCuerpo, ok } from "@/lib/api/respuestas";
import { decisionTiendaSchema } from "@/lib/proyeccion/esquemas";
import { leerSegmentos } from "@/lib/proyeccion/rutas";
import { decidirTienda } from "@/lib/proyeccion/servicio-edicion";

type Params = { params: Promise<{ id: string; tiendaId: string; anio: string }> };

/**
 * Decide el total de una tienda nueva o cierre en un año, o cambia su rampa (`requirePlanner`). Reescala sus filas no fijadas
 * (`origen = escalada`); si la tienda de `Y` pasa a mismas tiendas de `Y+1`, recalcula en el acto la propuesta de `Y+1` de las
 * filas base de sus GML-AM sin releer venta (`filas_base_recalculadas`). `409 cerrada` / `calculo_en_curso`.
 */
export async function PUT(request: NextRequest, { params }: Params) {
  const { perfil, response } = await requirePlanner();
  if (response) return response;

  const s = await leerSegmentos(params, ["id", "tiendaId"], "Tienda no encontrada.", { anio: true, libres: ["tiendaId"] });
  if (s.respuesta) return s.respuesta;
  const { datos, respuesta } = await leerCuerpo(request, decisionTiendaSchema);
  if (respuesta) return respuesta;
  const r = await decidirTienda(s.valores.id, s.valores.tiendaId, s.anio, datos, { id: perfil.id, nombre: perfil.nombre });
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}
