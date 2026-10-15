import type { NextRequest } from "next/server";
import { requirePlanner } from "@/lib/auth/guard";
import { ok } from "@/lib/api/respuestas";
import { cerradaQuerySchema } from "@/lib/proyeccion/esquemas";
import { leerConsulta } from "@/lib/proyeccion/rutas";
import { leerProyeccionCerrada } from "@/lib/proyeccion/servicio";

/**
 * Contrato de M8 (`requirePlanner`, solo lectura): la proyección `cerrada` más reciente que cubra `?anio=`: primero la que
 * tiene `anio_en_curso = anio`; si no hay, la de `anio − 1` (su año siguiente es `anio`; `cubre = "siguiente"`). `404 sin_cerrada`
 * si ninguna. Trae, del año pedido, una fila por género · mundo · línea · equivalencia · agrupación de marca · bloque · tienda con
 * `meses[12]`, `origen_meses[12]` y `participaciones_historicas`. M8 nunca recalcula ni reparte.
 */
export async function GET(request: NextRequest) {
  const { response } = await requirePlanner();
  if (response) return response;

  const { datos, respuesta } = leerConsulta(request, cerradaQuerySchema);
  if (respuesta) return respuesta;
  const r = await leerProyeccionCerrada(datos.anio);
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}
