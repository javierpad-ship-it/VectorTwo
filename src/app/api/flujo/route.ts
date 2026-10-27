import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth/guard";
import { ok } from "@/lib/api/respuestas";
import { flujoQuerySchema } from "@/lib/flujo/esquemas";
import { leerFlujo } from "@/lib/flujo/servicio";
import { leerConsulta } from "@/lib/intercompany/rutas";

/**
 * `GET /api/flujo` (`requireUser`: los tres roles; solo lectura). El flujo de inventarios con el IMI mes a mes: lista en columnas
 * (`serie`), nombres una sola vez (`catalogo`), totales que siguen al filtro, repartos y reglas vigentes y «mis combinaciones». Entrega
 * UNIDADES, nunca `venta_soles` ni costo vendido de M5. Filtros en el servidor: `?genero_id&mundo_id&linea_id&agrupacion_marca_id&solo&mio=1&meses=`.
 * Caché en memoria por huella (`flujo_huella_base()`); `404 sin_cerrada` si no hay proyección cerrada; `404 sin_mes` si no hay meses publicados.
 */
export async function GET(request: NextRequest) {
  const { perfil, response } = await requireUser();
  if (response) return response;

  const { datos, respuesta } = leerConsulta(request, flujoQuerySchema);
  if (respuesta) return respuesta;
  const r = await leerFlujo(supabaseAdmin(), perfil.id, datos);
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}
