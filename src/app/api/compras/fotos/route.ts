import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth/guard";
import { ok } from "@/lib/api/respuestas";
import { leerConsulta } from "@/lib/intercompany/rutas";
import { fotosQuerySchema } from "@/lib/fotos/esquemas";
import { listarFotosModulo } from "@/lib/fotos/servicio-modulo";

/**
 * `GET /api/compras/fotos` (`requireUser`: los tres roles; solo lectura): Compras → Fotos. Filtros
 * `?viaje_id=<uuid>|sin_viaje|todos&proveedor_id&compra_id&origen&estado&solo_sin_foto=1&q&pagina&por_pagina` (hasta 100). Responde
 * `FotosModuloApi`: contadores «n de m», proveedores con sus líneas sin foto, la página de tarjetas y `fotos_en_cancelada`. Las compras
 * canceladas quedan fuera salvo con `estado=cancelada` (solo lectura). La ruta nunca lee la cookie del viaje activo (08b, R22): la
 * pantalla manda `viaje_id`. Ninguna respuesta trae `ruta`, `ruta_miniatura` ni `clave_origen`.
 */
export async function GET(request: NextRequest) {
  const { rol, response } = await requireUser();
  if (response) return response;

  const { datos, respuesta } = leerConsulta(request, fotosQuerySchema);
  if (respuesta) return respuesta;
  const r = await listarFotosModulo(supabaseAdmin(), rol, datos);
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}
