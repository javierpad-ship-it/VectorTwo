import type { NextRequest } from "next/server";
import { requirePlanner } from "@/lib/auth/guard";
import { esAdmin } from "@/lib/auth/roles";
import { ok } from "@/lib/api/respuestas";
import { tableroQuerySchema } from "@/lib/direccion/esquemas";
import { leerConsultaDireccion } from "@/lib/direccion/rutas";
import { leerTablero } from "@/lib/direccion/servicio";

/**
 * El tablero de aprobación de dirección (`requirePlanner`). Solo lectura. `400` filtros mal formados, `marca_fuera_de_agrupacion` o
 * `comparar_igual`; `404 proyeccion_no_encontrada` (también la comparada); `409 sin_calcular`, `calculo_en_curso` o `sin_proyeccion`.
 * `puede_aprobar` solo es verdadero para el admin (el `POST` de aprobaciones lo exige de todos modos).
 */
export async function GET(request: NextRequest) {
  const { rol, response } = await requirePlanner();
  if (response) return response;

  const { datos, respuesta } = leerConsultaDireccion(request, tableroQuerySchema);
  if (respuesta) return respuesta;
  const r = await leerTablero(datos, esAdmin(rol));
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}
