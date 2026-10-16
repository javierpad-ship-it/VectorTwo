import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlanner } from "@/lib/auth/guard";
import { error, idDeRuta, leerCuerpo, ok } from "@/lib/api/respuestas";
import { traducirErrorDb } from "@/lib/api/errores-db";
import { huellaCargas } from "@/lib/curvas/huellas";
import { armarComposicion, armarRedPorAnio, contextoComposicion, MENSAJE_COMPOSICION_INVALIDA } from "@/lib/curvas/composicion";
import { huellaRedPorAnio, leerComposicionCacheada } from "@/lib/curvas/cache-composicion";
import { leerComposicionDeAgrupacion, leerMaestroComposicion } from "@/lib/curvas/consultas";
import { calcularAgrupacionSchema, parametrosDeCuerpo } from "@/lib/curvas/esquemas";
import { errorConCodigo, leerContextoTrabajo } from "@/lib/curvas/lectura";
import { extrasDeCurva, MENSAJE_AGRUPACION_NO_ENCONTRADA } from "@/lib/curvas/reglas";
import { piezasDeSalida, prepararTrabajo } from "@/lib/curvas/trabajo";
import { PARAMETROS_POR_DEFECTO, type ComposicionAgrupacionApi, type ParametrosCurvas } from "@/lib/curvas/tipos-api";

type Params = { params: Promise<{ id: string }> };

/**
 * COMPOSICIÓN de una agrupación (`requirePlanner`): qué GML y qué equivalencias la forman, cuánto pesa cada
 * uno, cómo se comporta cada GML frente al RESTO de la agrupación y cuáles se apartan. Es una LECTURA con
 * cuerpo: NUNCA escribe. Contrato para el frontend (docs/modulos/06c…):
 *
 *   cuerpo  el mismo de `calcular` (`CalcularAgrupacionCuerpo`: parámetros, `hasta_periodo`,
 *           `partir_de_vigente`; claves desconocidas → 400). La red comparable y el tope de meses salen del
 *           mismo cálculo que `calcular` (nunca del cliente), así que `huella_calculo` es la misma.
 *   200     `ComposicionAgrupacionApi` siempre que haya meses publicados y cerrados: con un prerrequisito que
 *           bloquea el cálculo (periodos del Niño faltantes…) devuelve igual unidades y pesos, con
 *           `con_calculo: false`, `se_aparta: null` y el aviso `sin_calculo` en cada GML.
 *   404     agrupación inexistente (o id no UUID) · 400 zod · 409 `hasta_periodo_sin_cargar` (el
 *           `hasta_periodo` pedido no está publicado) · 409 `sin_datos` (ningún mes publicado y cerrado) ·
 *           409 `datos_cambiados` (se publicó una carga mientras se leía) · 500 lectura incompleta.
 *
 * Carga diferida: la pantalla la pide al abrir la tarjeta, no entra en `calcular`. Caché y semáforo PROPIOS
 * (`cache-composicion.ts`: 10 entradas, 120 s, 2 lecturas simultáneas).
 */
export async function POST(request: NextRequest, { params }: Params) {
  const { response } = await requirePlanner();
  if (response) return response;

  const { id, respuesta: respuestaId } = await idDeRuta(params, MENSAJE_AGRUPACION_NO_ENCONTRADA);
  if (respuestaId) return respuestaId;
  const { datos, respuesta } = await leerCuerpo(request, calcularAgrupacionSchema);
  if (respuesta) return respuesta;

  const inicio = Date.now();
  const db = supabaseAdmin();
  const contexto = await leerContextoTrabajo(db, id);
  if (contexto.respuesta) return contexto.respuesta;
  if (!contexto.data) return error(MENSAJE_AGRUPACION_NO_ENCONTRADA, 404);
  const { insumos, vigente } = contexto.data;

  // Mismos parámetros que `calcular`: los del cuerpo o, con `partir_de_vigente`, los de la última aprobación.
  let parametros: ParametrosCurvas = parametrosDeCuerpo(datos);
  if (datos.partir_de_vigente) {
    const guardados = vigente ? extrasDeCurva(vigente.anios_utilizados).parametros : null;
    parametros = guardados ?? { ...PARAMETROS_POR_DEFECTO, anios_excluidos: [], tiendas_excluidas: [] };
  }

  const preparado = prepararTrabajo(insumos, parametros, datos.hasta_periodo);
  if (preparado.rechazo) return errorConCodigo(preparado.rechazo.mensaje, preparado.rechazo.status, preparado.rechazo.codigo);
  const trabajo = preparado.trabajo;
  if (!trabajo.entrada || trabajo.hasta_periodo === null) {
    return errorConCodigo("Todavía no hay ningún mes publicado y cerrado en Venta y stock: no hay con qué armar la composición.", 409, "sin_datos");
  }
  const hasta = trabajo.hasta_periodo;

  // La red de cada año es la del cálculo: así los pesos de los GML suman exactamente la serie de la agrupación.
  const pRed = armarRedPorAnio(trabajo.entrada.redes);
  const lectura = await leerComposicionCacheada(
    {
      id,
      cargas_huella: huellaCargas(insumos.venta.cargas),
      composicion: insumos.agrupacion.huella,
      red_huella: huellaRedPorAnio(pRed),
      hasta,
    },
    () => leerComposicionDeAgrupacion(db, id, pRed, hasta)
  );
  if (lectura.error) return traducirErrorDb(lectura.error, "composición: leer la venta");
  if (!lectura.data) return error(MENSAJE_COMPOSICION_INVALIDA, 500);
  if (huellaCargas(lectura.data.cargas) !== huellaCargas(insumos.venta.cargas)) {
    return errorConCodigo("Se publicó o republicó un mes mientras se leía la composición: vuelve a cargar.", 409, "datos_cambiados");
  }

  const maestro = await leerMaestroComposicion(db, id);
  if (maestro.error) return traducirErrorDb(maestro.error, "composición: leer el maestro");

  const piezas = piezasDeSalida(trabajo.salida, id);
  const ctx = contextoComposicion({
    entrada: trabajo.entrada,
    resultado: piezas?.resultado ?? null,
    agrupacion_id: id,
    parametros: trabajo.parametros,
    huella_calculo: trabajo.huella_calculo,
  });
  const cuerpo: ComposicionAgrupacionApi = { ...armarComposicion(lectura.data, maestro.data, ctx), duracion_ms: Date.now() - inicio };
  return ok(cuerpo);
}
