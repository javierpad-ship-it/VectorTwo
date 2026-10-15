import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlanner } from "@/lib/auth/guard";
import { error, idDeRuta, ok } from "@/lib/api/respuestas";
import { traducirErrorDb } from "@/lib/api/errores-db";
import { aFotoResumen, comoRed, comoResultado, leerAgrupacionConDatos, leerCorridaPorId, leerCurvaDeFoto, leerTiendas } from "@/lib/curvas/consultas";
import { CORRIDA_NO_ENCONTRADA, esUuid, leerModeloConsulta } from "@/lib/curvas/esquemas";
import { aVigenteResumen, MENSAJE_AGRUPACION_NO_ENCONTRADA } from "@/lib/curvas/reglas";
import { agrupacionTrabajoApi, comparadorContra, redConIdentidad } from "@/lib/curvas/trabajo";
import type { DetalleFotoApi } from "@/lib/curvas/tipos-api";

type Params = { params: Promise<{ id: string; agrupacionId: string }> };

/**
 * "Ver foto" (`requirePlanner`): el detalle CONGELADO de la foto de una aprobación,
 * tal como la vio el planner (`DetalleFotoApi`). `?modelo=A..E|T` elige la candidata
 * dibujada (por defecto la recomendada de entonces). Lee la foto con `leerCorridaPorId`
 * (no hay corrida "actual"), compara con LA CURVA aprobada con esa foto (no con la
 * vigente de hoy) y no evalúa obsolescencia: es historia. `404` si la foto o la
 * agrupación no existen, o si la foto no es de esa agrupación (las fotos de la
 * 0.9.6, de una corrida global, valen para las agrupaciones que contienen).
 */
export async function GET(request: NextRequest, { params }: Params) {
  const { response } = await requirePlanner();
  if (response) return response;

  const { id, respuesta } = await idDeRuta(params, CORRIDA_NO_ENCONTRADA);
  if (respuesta) return respuesta;
  const { agrupacionId } = await params;
  if (!esUuid(agrupacionId)) return error(MENSAJE_AGRUPACION_NO_ENCONTRADA, 404);
  const consulta = leerModeloConsulta(request.nextUrl.searchParams);
  if (consulta.invalido) return error("El modelo debe ser A, B, C, D, E o T.", 400);

  const db = supabaseAdmin();
  const foto = await leerCorridaPorId(db, id);
  if (foto.error) return traducirErrorDb(foto.error, "ver foto: leer la foto");
  const fila = foto.data;
  if (!fila) return error(CORRIDA_NO_ENCONTRADA, 404);
  if (fila.agrupacion_estacionalidad_id !== null && fila.agrupacion_estacionalidad_id !== agrupacionId) {
    return error("Esa foto no es de esta agrupación.", 404);
  }

  const resultado = comoResultado(fila.resultado);
  const delResultado = resultado.agrupaciones.find((a) => a.agrupacion_id === agrupacionId);
  if (!delResultado) return error("Esa agrupación no estaba en la foto elegida.", 404);

  const [agrupacion, tiendas, curva] = await Promise.all([leerAgrupacionConDatos(db, agrupacionId), leerTiendas(db), leerCurvaDeFoto(db, id, agrupacionId)]);
  const fallo = agrupacion.error ?? tiendas.error ?? curva.error;
  if (fallo) return traducirErrorDb(fallo, "ver foto: leer datos");
  if (!agrupacion.data) return error(MENSAJE_AGRUPACION_NO_ENCONTRADA, 404);

  const temporada = resultado.temporadas.find((t) => t.temporada === delResultado.temporada) ?? null;
  const { red, tiendas: identidades } = redConIdentidad(comoRed(fila.red_comparable), delResultado, tiendas.data);
  const curvaDeLaFoto = curva.data ? aVigenteResumen(curva.data) : null;

  const cuerpo: DetalleFotoApi = {
    foto: aFotoResumen(fila),
    agrupacion: agrupacionTrabajoApi({ ...agrupacion.data, huella: agrupacion.data.huella, temporadas_mezcladas: agrupacion.data.temporadas_mezcladas }),
    resultado: delResultado,
    temporada_curva: temporada,
    red,
    tiendas: identidades,
    curva_de_la_foto: curvaDeLaFoto,
    comparador: comparadorContra(delResultado, temporada, curvaDeLaFoto, consulta.modelo),
  };
  return ok(cuerpo);
}
