import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth/guard";
import { leerCuerpo, ok } from "@/lib/api/respuestas";
import { limpiarFotosSchema } from "@/lib/fotos/esquemas";
import { contarHuerfanas, limpiarHuerfanas } from "@/lib/fotos/servicio";

/**
 * `GET /api/compras/fotos/limpiar` (`requireAdmin`): cuántos objetos huérfanos borraría la limpieza (con más de 24 h): `sin_fila` (sin
 * ninguna fila) y `quitadas` (de fotos quitadas que siguen en Storage). No borra nada.
 */
export async function GET() {
  const { response } = await requireAdmin();
  if (response) return response;

  const r = await contarHuerfanas(supabaseAdmin());
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}

/** `POST /api/compras/fotos/limpiar` (`requireAdmin`; cuerpo `{ confirmar: true }`): borra esos objetos con `.remove()`, sin tocar filas. `{ borrados, fallidos }`; `502` si el almacén no responde. */
export async function POST(request: NextRequest) {
  const { response } = await requireAdmin();
  if (response) return response;

  const { respuesta } = await leerCuerpo(request, limpiarFotosSchema);
  if (respuesta) return respuesta;
  const r = await limpiarHuerfanas(supabaseAdmin());
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}
