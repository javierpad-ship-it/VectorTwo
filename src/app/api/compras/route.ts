import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth/guard";
import { ok } from "@/lib/api/respuestas";
import { comprasQuerySchema } from "@/lib/compras/esquemas";
import { listarCompras } from "@/lib/compras/servicio";
import { contextoParaCompras } from "@/lib/flujo/servicio";
import { leerConsulta } from "@/lib/intercompany/rutas";

/**
 * `GET /api/compras` (`requireUser`: los tres roles; solo lectura): la lista con líneas y entregas (el `historial` va vacío; está en el
 * detalle). Filtros: `?estado&proveedor_id&origen&llegada_desde&llegada_hasta&genero_id&mundo_id&linea_id&marca_id&mio=1&por_confirmar=1&proximo_hito=vencido&q=`; `q` busca en código X, OC, proveedor y referencia.
 * «Mis líneas» (`mio`) es un filtro, nunca un permiso. No hay `POST` en `0.13.0`: las compras entran por la carga inicial.
 * Ficha 08b (aditivo): `?viaje_id=<uuid>|sin_viaje&embarque_id=<uuid>` filtran por viaje y por embarque (el viaje activo llega explícito: esta
 * ruta nunca lee la cookie, R22); 08b-1b: cada compra trae además `numero_oc`, `linea_de_tiempo` y `proximo_hito`; cada compra trae su `viaje` y, en cada entrega, `asignaciones` (embarque y paquete) y `sin_embarque`.
 */
export async function GET(request: NextRequest) {
  const { perfil, rol, response } = await requireUser();
  if (response) return response;

  const { datos, respuesta } = leerConsulta(request, comprasQuerySchema);
  if (respuesta) return respuesta;
  const d = supabaseAdmin();
  const r = await listarCompras(d, { id: perfil.id, nombre: perfil.nombre ?? perfil.email, rol }, datos, () => contextoParaCompras(d));
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}
