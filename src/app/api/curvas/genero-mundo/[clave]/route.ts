import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlanner } from "@/lib/auth/guard";
import { error, errorConCodigo, leerCuerpo, ok } from "@/lib/api/respuestas";
import { hoyLima } from "@/lib/tiendas/estado";
import { aprobarCrecimientoSchema, aprobarCrecimientoSchemaEstricto, esBaseRetirada, leerClaveGeneroMundo, leerConsultaGeneroMundo, MENSAJE_BASE_RETIRADA } from "@/lib/crecimientos/esquemas";
import { aprobarCrecimiento, armarDetalle, cargarContexto } from "@/lib/crecimientos/servicio";

type Params = { params: Promise<{ clave: string }> };

const MENSAJE_CLAVE = "La clave no es válida: usa «resto» o «<género>.<mundo>».";

/**
 * Detalle de un género × mundo o del Resto (`requirePlanner`): curva de venta por año de las mismas tiendas (con el cierre por curva de
 * `Y`), bandas del Niño, cierre por agrupación, factores de `Y`, referencias de «Cómo crece», versiones y `huella_datos`. `clave` = `resto`
 * o `<genero_id>.<mundo_id>`. Solo lee.
 *
 *   400  `clave_invalida` · query inválida · `anio_no_permitido` · `referencia_otro_anio`
 *   404  no hay venta, filas base ni versión aprobada de ese género y mundo
 *   409  `sin_datos`
 */
export async function GET(request: NextRequest, { params }: Params) {
  const { response } = await requirePlanner();
  if (response) return response;

  const { clave: texto } = await params;
  const clave = leerClaveGeneroMundo(texto);
  if (!clave) return errorConCodigo(MENSAJE_CLAVE, 400, "clave_invalida");
  const { consulta, rechazo } = leerConsultaGeneroMundo(request.nextUrl.searchParams);
  if (rechazo) return error(rechazo.mensaje, rechazo.status);

  const contexto = await cargarContexto(supabaseAdmin(), consulta, hoyLima());
  if (contexto.respuesta) return contexto.respuesta;
  const detalle = armarDetalle(contexto.data, clave);
  if (!detalle) return error("No hay venta, filas base ni crecimiento aprobado para ese género y mundo.", 404);
  return ok(detalle);
}

/**
 * APRUEBA el crecimiento del año siguiente de un género × mundo o del Resto (`requirePlanner`), «sobre 2026 corregido del Niño»
 * (`sobre_base = 'corregida'`, explícito). Cuerpo `aprobarCrecimientoSchema` (estricto): `anio`, `pct`, `nota`, `base`,
 * `proyeccion_referencia_id`, `huella_datos` (la del `GET`) y `version_vigente` (la que vio el planner o `null`). Una base heredada
 * (`cierre_proyectado`, `sin_nino_mas_rebote`) responde `400 base_retirada` sin escribir; el resto se vuelve a validar con
 * `aprobarCrecimientoSchemaEstricto`. El servidor recalcula el detalle y crea la versión `max(version) + 1`; la anterior pasa a
 * `reemplazada`. NO escribe en ninguna proyección: las desactualizadas se devuelven para avisar. Los errores de Postgres los traduce
 * `traducirErrorDb` dentro de `cargarContexto` y `aprobarCrecimiento`.
 *
 *   201  `{ vigente, proyecciones_desactualizadas }`
 *   400  zod · `clave_invalida` · `base_retirada` · `anio_no_permitido` · `referencia_otro_anio` · `genero_no_detallado` · `mundo_inactivo`
 *   404  sin venta ni versión de ese género y mundo
 *   409  `anio_siguiente_atipico` · `datos_cambiados` · `vigente_cambiada` · `sin_cambio` · `nota_requerida`
 */
export async function POST(request: NextRequest, { params }: Params) {
  const { perfil, response } = await requirePlanner();
  if (response) return response;

  const { clave } = await params;
  if (!leerClaveGeneroMundo(clave)) return errorConCodigo(MENSAJE_CLAVE, 400, "clave_invalida");
  // El esquema de transición deja pasar las bases heredadas para poder responder `base_retirada` con su código; enseguida, el estricto.
  const { datos: leido, respuesta } = await leerCuerpo(request, aprobarCrecimientoSchema);
  if (respuesta) return respuesta;
  if (esBaseRetirada(leido.base)) return errorConCodigo(MENSAJE_BASE_RETIRADA, 400, "base_retirada");
  const estricto = aprobarCrecimientoSchemaEstricto.safeParse(leido);
  if (!estricto.success) return error(estricto.error.issues[0]?.message ?? "El cuerpo no es válido.", 400);

  return aprobarCrecimiento(supabaseAdmin(), { clave, datos: estricto.data, hoy: hoyLima(), perfil: { id: perfil.id, nombre: perfil.nombre, email: perfil.email } });
}
