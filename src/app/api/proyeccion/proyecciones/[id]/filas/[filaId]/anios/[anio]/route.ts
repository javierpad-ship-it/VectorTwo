import type { NextRequest } from "next/server";
import { requirePlanner } from "@/lib/auth/guard";
import { leerCuerpo, ok } from "@/lib/api/respuestas";
import { decisionSchema } from "@/lib/proyeccion/esquemas";
import { leerSegmentos } from "@/lib/proyeccion/rutas";
import { decidirFila } from "@/lib/proyeccion/servicio-edicion";

type Params = { params: Promise<{ id: string; filaId: string; anio: string }> };

/**
 * Decide el total de un año de una fila (`requirePlanner`). `decidido: null` vuelve a la propuesta; `origen: "propuesta"` copia
 * la propuesta; `manual` escribe la cifra. En una fila base del año en curso recalcula en el acto la propuesta del año siguiente.
 * `409 cerrada` / `archivada` / `calculo_en_curso` / `menor_que_vendido` / `fila_inactiva` / `sin_propuesta`.
 *
 * `0.10.7` (07b), fila de tienda: aceptar la propuesta la fija (`manual`); con el total de la tienda ya decidido, ese total pasa a `D + Δ`
 * (solo se mueve lo modificado) y la respuesta trae `tienda: { anio, decidido, suma_filas }`. Sin total decidido solo se fija la fila.
 */
export async function PUT(request: NextRequest, { params }: Params) {
  const { perfil, response } = await requirePlanner();
  if (response) return response;

  const s = await leerSegmentos(params, ["id", "filaId"], "Fila no encontrada.", { anio: true });
  if (s.respuesta) return s.respuesta;
  const { datos, respuesta } = await leerCuerpo(request, decisionSchema);
  if (respuesta) return respuesta;
  const r = await decidirFila(s.valores.id, s.valores.filaId, s.anio, datos, { id: perfil.id, nombre: perfil.nombre });
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}
