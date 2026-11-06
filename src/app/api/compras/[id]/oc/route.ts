import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth/guard";
import { idDeRuta, leerCuerpo, ok } from "@/lib/api/respuestas";
import { editarOcSchema } from "@/lib/compras/esquemas";
import { editarOcCompra } from "@/lib/compras/servicio";

/**
 * `PUT /api/compras/[id]/oc` (`requireUser`: los tres roles; decisión 121, 08b-1b §2.11): registra, cambia o quita (`numero_oc = null`) el
 * número de la orden de compra de UNA compra no cancelada, con la función `editar_oc_compra`. Es un dato de identificación que no mueve el
 * flujo: no sube `compras.revision`. Cuerpo `{ antes, numero_oc, motivo? }` (`antes` = la OC que vio el formulario). Respuesta
 * `{ compra: { id, numero, numero_oc }, avisos }` (aviso `oc_de_otro_proveedor`). Errores: 400 `oc_invalida`, 404 `no_encontrado`,
 * 409 `motivo_requerido` (`antes` tenía valor y la OC cambia o se quita sin `motivo`), 409 `oc_repetida` (la OC ya es de otra compra viva del proveedor), `oc_cambio` (otra persona la cambió), `no_editable` (compra
 * cancelada) y `sin_cambios` (la OC ya es esa: un reintento).
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { perfil, rol, response } = await requireUser();
  if (response) return response;

  const t = await idDeRuta(params, "No encontramos esa compra.");
  if (t.respuesta) return t.respuesta;
  const { datos, respuesta } = await leerCuerpo(request, editarOcSchema);
  if (respuesta) return respuesta;
  const r = await editarOcCompra(supabaseAdmin(), { id: perfil.id, nombre: perfil.nombre ?? perfil.email, rol }, t.id, datos);
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}
