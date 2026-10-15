import type { NextRequest } from "next/server";
import { requirePlanner } from "@/lib/auth/guard";
import { idDeRuta, ok } from "@/lib/api/respuestas";
import { calcularServicio } from "@/lib/proyeccion/servicio";

type Params = { params: Promise<{ id: string }> };

/**
 * Recalcula la proyección (`requirePlanner`, `POST`: escribe). Pone `calculando_desde`, lee la venta por tandas de nodos
 * (a lo sumo tres a la vez; si las `cargas` difieren entre tandas, `409 datos_cambiaron` y no escribe nada), calcula y guarda
 * filas, registros y tiendas por `upsert` SIN tocar `decidido`, `origen`, `nota` ni `propuesta_al_decidir`. Libera el candado
 * también si falla. `409 cerrada` / `409 prerrequisitos` / `409 calculo_en_curso`.
 */
export async function POST(_request: NextRequest, { params }: Params) {
  const { response } = await requirePlanner();
  if (response) return response;

  const { id, respuesta } = await idDeRuta(params, "Proyección no encontrada.");
  if (respuesta) return respuesta;
  const r = await calcularServicio(id);
  if (r.respuesta) return r.respuesta;
  return ok(r.data, 201);
}
