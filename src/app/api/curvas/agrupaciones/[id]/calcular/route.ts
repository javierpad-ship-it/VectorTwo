import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlanner } from "@/lib/auth/guard";
import { error, idDeRuta, leerCuerpo, ok } from "@/lib/api/respuestas";
import { calcularAgrupacionSchema, leerModeloConsulta, parametrosDeCuerpo } from "@/lib/curvas/esquemas";
import { errorConCodigo, leerContextoTrabajo, leerObsolescencia } from "@/lib/curvas/lectura";
import { aVigenteResumen, extrasDeCurva, MENSAJE_AGRUPACION_NO_ENCONTRADA } from "@/lib/curvas/reglas";
import { aObsoleta } from "@/lib/curvas/estado";
import { VERSION_MODELO } from "@/lib/curvas/modelo";
import { ventaPorTiendaDeTemporadas } from "@/lib/curvas/entrada";
import {
  agrupacionTrabajoApi,
  calculoDeTrabajo,
  comparadorContra,
  datosDeTrabajo,
  estadoGlobalActual,
  piezasDeSalida,
  prepararTrabajo,
} from "@/lib/curvas/trabajo";
import { PARAMETROS_POR_DEFECTO, type ParametrosCurvas, type TrabajoAgrupacionApi } from "@/lib/curvas/tipos-api";

type Params = { params: Promise<{ id: string }> };

/**
 * CALCULA a demanda UNA agrupación (`requirePlanner`). Es una LECTURA con cuerpo:
 * NUNCA escribe (ni foto ni curva). Contrato para el frontend (docs/modulos/06b…):
 *
 *   cuerpo  `CalcularAgrupacionCuerpo` (todo opcional; claves desconocidas → 400).
 *           `hasta_periodo` (`aaaa-mm`) por defecto es el último mes publicado y cerrado y
 *           NUNCA se hereda de la vigente; `partir_de_vigente: true` usa los parámetros de la
 *           última aprobación (y los demás parámetros del cuerpo se ignoran).
 *   query   `?modelo=A..F|T` elige la candidata del `comparador` (por defecto la recomendada).
 *   200     `TrabajoAgrupacionApi`: `prerrequisitos` (con `bloquea` no vacío, `calculo: null`
 *           y nada que aprobar), `huella_calculo` (la que `PUT` devuelve), `calculo`,
 *           `vigente` / `obsoleta` / `avisos_vigente` / `comparador` y `versiones`. Desde la 06c
 *           `calculo.resultado.candidatas` trae `F` (con `explicacion_f` y `detalle_f`) y `T` con EAT
 *           (`eat`, `pruebas`, `eat_parcial`, `igual_a`), y cada candidata con curva su `eat_en_muestra`;
 *           el cuerpo acepta `recencia_f` (0.5 a 1, defecto 0.75).
 *   404     agrupación inexistente (o id no UUID) · 400 zod · 409 `hasta_periodo_sin_cargar`
 *           (el `hasta_periodo` pedido no está publicado) · 500 venta incompleta.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const { response } = await requirePlanner();
  if (response) return response;

  const { id, respuesta: respuestaId } = await idDeRuta(params, MENSAJE_AGRUPACION_NO_ENCONTRADA);
  if (respuestaId) return respuestaId;
  const { datos, respuesta } = await leerCuerpo(request, calcularAgrupacionSchema);
  if (respuesta) return respuesta;
  const consulta = leerModeloConsulta(request.nextUrl.searchParams);
  if (consulta.invalido) return error("El modelo debe ser A, B, C, D, E, F o T.", 400);

  const inicio = Date.now();
  const db = supabaseAdmin();
  const contexto = await leerContextoTrabajo(db, id);
  if (contexto.respuesta) return contexto.respuesta;
  if (!contexto.data) return error(MENSAJE_AGRUPACION_NO_ENCONTRADA, 404);
  const { insumos, vigente } = contexto.data;

  // Parámetros: los del cuerpo o, con `partir_de_vigente`, los de la última aprobación (nunca su `hasta_periodo`).
  let parametros: ParametrosCurvas = parametrosDeCuerpo(datos);
  if (datos.partir_de_vigente) {
    const guardados = vigente ? extrasDeCurva(vigente.anios_utilizados).parametros : null;
    parametros = guardados ?? { ...PARAMETROS_POR_DEFECTO, anios_excluidos: [], tiendas_excluidas: [] };
  }

  const preparado = prepararTrabajo(insumos, parametros, datos.hasta_periodo);
  if (preparado.rechazo) return errorConCodigo(preparado.rechazo.mensaje, preparado.rechazo.status, preparado.rechazo.codigo);
  const trabajo = preparado.trabajo;

  const vigenteApi = vigente ? aVigenteResumen(vigente) : null;
  let obsoleta = null;
  let avisos: TrabajoAgrupacionApi["avisos_vigente"] = [];
  if (vigente) {
    const evaluada = await leerObsolescencia(
      db,
      [vigente],
      estadoGlobalActual({
        tiendas: insumos.tiendas,
        venta: ventaPorTiendaDeTemporadas(insumos.venta.temporadas),
        cargas: insumos.venta.cargas,
        periodos: insumos.periodos,
        agrupaciones: [insumos.agrupacion],
        activas: insumos.de_temporada,
        activas_de_temporada: insumos.agrupacion.temporada,
        hoy: insumos.hoy,
      })
    );
    if (evaluada.respuesta) return evaluada.respuesta;
    const e = evaluada.data.get(id);
    obsoleta = aObsoleta(e?.motivos);
    avisos = e?.avisos ?? [];
  }

  const calculo = calculoDeTrabajo(trabajo, id, insumos.tiendas, Date.now() - inicio);
  const piezas = piezasDeSalida(trabajo.salida, id);
  const cuerpo: TrabajoAgrupacionApi = {
    agrupacion: agrupacionTrabajoApi(insumos.agrupacion),
    datos: datosDeTrabajo(trabajo, insumos.venta),
    parametros: trabajo.parametros,
    prerrequisitos: trabajo.prerrequisitos,
    huella_calculo: trabajo.huella_calculo,
    huella_temporada: trabajo.huella_temporada,
    version_modelo: VERSION_MODELO,
    calculo,
    vigente: vigenteApi,
    obsoleta,
    avisos_vigente: avisos,
    comparador: piezas ? comparadorContra(piezas.resultado, piezas.temporada, vigenteApi, consulta.modelo) : null,
    versiones: insumos.versiones,
  };
  return ok(cuerpo);
}
