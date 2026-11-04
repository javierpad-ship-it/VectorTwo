import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth/guard";
import { leerCuerpo, ok } from "@/lib/api/respuestas";
import { importarAgrupadoresSchema } from "@/lib/compras/agrupadores/esquemas";
import { importarAgrupadores, usuarioDe } from "@/lib/compras/agrupadores/servicio";

/**
 * `POST /api/compras/agrupadores/importar` (`requireUser`: los tres roles, decisión 97): previsualiza o aplica la hoja única de viajes,
 * embarques y paquetes (hasta 1 000 filas; cuerpo de hasta 6 MB, `400` si se pasa). SOLO CREA: nunca edita ni mueve; lo que ya existe
 * con el mismo contenido sale `igual`, con otro contenido `cambiada` (se omite). Aplicar es todo o nada (importar_agrupadores) y reimportar
 * el mismo archivo no duplica nada; si alguien creó una de las claves entre previsualizar y aplicar, `409 vuelve_a_previsualizar`.
 */
export async function POST(request: NextRequest) {
  const { perfil, rol, response } = await requireUser();
  if (response) return response;

  const { datos, respuesta } = await leerCuerpo(request, importarAgrupadoresSchema);
  if (respuesta) return respuesta;
  const r = await importarAgrupadores(supabaseAdmin(), usuarioDe(perfil, rol), datos);
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}
