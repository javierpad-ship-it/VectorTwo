import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlanner } from "@/lib/auth/guard";
import { error, ok } from "@/lib/api/respuestas";
import { hoyLima } from "@/lib/tiendas/estado";
import { leerConsultaGeneroMundo } from "@/lib/crecimientos/esquemas";
import { armarLista, cargarContexto } from "@/lib/crecimientos/servicio";

/**
 * Lista del crecimiento por género × mundo (`requirePlanner`; el comprador recibe `403`). Query opcional: `?anio=2027` (año de
 * aplicación; por defecto el del último mes cerrado + 1) y `?proyeccion=<id>` (proyección de referencia; por defecto la de `anio − 1`
 * calculada con el método 5 o posterior). Solo lee. `ListaGeneroMundoApi`: una fila por género × mundo con venta (cierre por curva, base
 * corregida del Niño y `hay_nino`), la fila Resto, el total ponderado por `Σ B'`, `anio_siguiente_atipico` y `huella_datos` (el bloqueo
 * optimista del `POST`). Los errores de Postgres los traduce `traducirErrorDb` dentro de
 * `cargarContexto`.
 *
 *   400  query inválida · `anio_no_permitido` · `referencia_otro_anio`
 *   409  `sin_datos`: ningún mes publicado y cerrado
 */
export async function GET(request: NextRequest) {
  const { response } = await requirePlanner();
  if (response) return response;

  const { consulta, rechazo } = leerConsultaGeneroMundo(request.nextUrl.searchParams);
  if (rechazo) return error(rechazo.mensaje, rechazo.status);

  const contexto = await cargarContexto(supabaseAdmin(), consulta, hoyLima());
  if (contexto.respuesta) return contexto.respuesta;
  return ok(armarLista(contexto.data));
}
