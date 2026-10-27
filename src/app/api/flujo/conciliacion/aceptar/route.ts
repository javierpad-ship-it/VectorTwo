import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlanner } from "@/lib/auth/guard";
import { leerCuerpo, ok } from "@/lib/api/respuestas";
import { pertenenciaDeEntrega, registrarSugerenciaAceptada } from "@/lib/compras/servicio";
import { aceptarSugerenciaSchema } from "@/lib/flujo/esquemas";
import { conciliacionDeFila, contextoParaCompras, respuestaDeErrorFlujo, validarSugerenciaVigente } from "@/lib/flujo/servicio";

/**
 * `POST /api/flujo/conciliacion/aceptar` (`requirePlanner` en M8; `requireUser` desde M9a): «Aceptar sugerencia» de un clic. Registra
 * la recepción que propone la conciliación (mes X, fecha = último día de X, `origen = 'sugerencia'`, a nombre de quien acepta) con la
 * función `registrar_recepciones`. NUNCA se ejecuta sola. Orden, todo ANTES de tomar el candado de la compra:
 *   (1) pertenencia: la línea existe y la entrega es de ella (la compra se deriva de la línea) → `404 no_pertenece`; una línea de lote
 *       → `409 tipo_no_disponible`;
 *   (2) la sugerencia se recalcula con los datos de hoy (caché por huella): sin sugerencia para esa entrega en ese periodo o con menos
 *       unidades → `409 sugerencia_vencida`; más de lo que le falta a la entrega → `409 excede_pendiente`;
 *   (3) `registrar_recepciones` con la `revision` → `409 compra_cambio` / `409 excede_pendiente`.
 * Responde `{ compra, conciliacion }`: la fila recalculada, para que la diferencia baje sin recargar todo.
 */
export async function POST(request: NextRequest) {
  const { perfil, rol, response } = await requirePlanner();
  if (response) return response;

  const { datos, respuesta } = await leerCuerpo(request, aceptarSugerenciaSchema);
  if (respuesta) return respuesta;
  const d = supabaseAdmin();
  const usuario = { id: perfil.id, nombre: perfil.nombre ?? perfil.email, rol };

  const pertenece = await pertenenciaDeEntrega(d, datos.linea_id, datos.entrega_id);
  if (pertenece.respuesta) return pertenece.respuesta;
  if (pertenece.data.tipo !== "especifica") return respuestaDeErrorFlujo("tipo_no_disponible");

  const vigente = await validarSugerenciaVigente(d, datos);
  if (vigente.respuesta) return vigente.respuesta;

  const compra = await registrarSugerenciaAceptada(
    d,
    usuario,
    { compra_id: pertenece.data.compra_id, linea_id: datos.linea_id, periodo: datos.periodo, unidades: datos.unidades, revision: datos.revision },
    () => contextoParaCompras(d)
  );
  if (compra.respuesta) return compra.respuesta;

  const conciliacion = await conciliacionDeFila(d, perfil.id, vigente.data.clave, datos.periodo);
  if (conciliacion.respuesta) return conciliacion.respuesta;
  return ok({ compra: compra.data, conciliacion: conciliacion.data });
}
