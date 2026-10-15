import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlanner } from "@/lib/auth/guard";
import { error, idDeRuta, ok } from "@/lib/api/respuestas";
import { traducirErrorDb } from "@/lib/api/errores-db";
import { aCorridaResumen, aPeriodoApi, comoRed, comoResultado, leerAgrupacionesConDatos, leerCurvaVigente, leerPeriodos, leerTiendas } from "@/lib/curvas/consultas";
import { CORRIDA_NO_ENCONTRADA, esUuid, leerModeloConsulta } from "@/lib/curvas/esquemas";
import { curvaDeRecomendada } from "@/lib/curvas/estado";
import { leerObsolescencia, obsoletaDe, resolverCorrida } from "@/lib/curvas/lectura";
import { aVigenteResumen, armarComparador, MENSAJE_AGRUPACION_NO_ENCONTRADA } from "@/lib/curvas/reglas";
import type { ComparadorApi, DetalleAgrupacionApi, RedAnioApi, TiendaIdentidad } from "@/lib/curvas/tipos-api";

type Params = { params: Promise<{ id: string; agrupacionId: string }> };

/**
 * Detalle de una agrupación TAL COMO LO GUARDÓ LA CORRIDA (`requirePlanner`): su
 * resultado, la curva `T` de su temporada, la red de la corrida, la vigente
 * actual, su obsolescencia y el comparador vigente / propuesta (`?modelo=A..E|T`
 * elige la candidata; por defecto la recomendada). No lee la vista
 * materializada. `404` si la corrida o la agrupación no existen (o la agrupación
 * no estaba en esa corrida).
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
  const corrida = await resolverCorrida(db, id, { ultimaSiNoHayReferencia: false });
  if (corrida.respuesta) return corrida.respuesta;
  const fila = corrida.data;
  if (!fila) return error(CORRIDA_NO_ENCONTRADA, 404);

  const [agrupaciones, vigente, tiendas, periodos] = await Promise.all([
    leerAgrupacionesConDatos(db, { soloActivas: false }),
    leerCurvaVigente(db, agrupacionId),
    leerTiendas(db),
    leerPeriodos(db, { soloActivos: true }),
  ]);
  const fallo = agrupaciones.error ?? vigente.error ?? tiendas.error ?? periodos.error;
  if (fallo) return traducirErrorDb(fallo, "detalle de agrupación en la corrida");

  const agrupacion = agrupaciones.data.find((a) => a.id === agrupacionId);
  if (!agrupacion) return error(MENSAJE_AGRUPACION_NO_ENCONTRADA, 404);
  const resultado = comoResultado(fila.resultado);
  const delResultado = resultado.agrupaciones.find((a) => a.agrupacion_id === agrupacionId);
  if (!delResultado) return error("Esa agrupación no estaba en la corrida elegida.", 404);
  const temporada = resultado.temporadas.find((t) => t.temporada === delResultado.temporada) ?? null;

  const red = comoRed(fila.red_comparable);
  const usadas = new Set<string>();
  for (const r of red) for (const t of r.tiendas) usadas.add(t.tienda_id);
  for (const a of delResultado.anios) for (const t of a.por_tienda) usadas.add(t.tienda_id);
  const identidades: TiendaIdentidad[] = tiendas.data.filter((t) => usadas.has(t.id)).map((t) => ({ id: t.id, codigo: t.codigo, nombre: t.nombre }));
  const nombres = new Map(identidades.map((t) => [t.id, t]));
  const redApi: RedAnioApi[] = red.map((r) => ({
    ...r,
    tiendas: r.tiendas.map((t) => ({ ...t, codigo: nombres.get(t.tienda_id)?.codigo ?? t.tienda_id, nombre: nombres.get(t.tienda_id)?.nombre ?? t.tienda_id })),
  }));

  const vigenteApi = vigente.data ? aVigenteResumen(vigente.data) : null;
  let obsoleta = null;
  if (vigente.data) {
    const evaluadas = await leerObsolescencia(db, [vigente.data], agrupaciones.data, periodos.data.map(aPeriodoApi));
    if (evaluadas.respuesta) return evaluadas.respuesta;
    obsoleta = obsoletaDe(evaluadas.data, agrupacionId);
  }

  // Comparador: la candidata pedida (por defecto la recomendada) frente a la vigente.
  let comparador: ComparadorApi | null = null;
  const modelo = consulta.modelo ?? delResultado.recomendada;
  if (vigenteApi && modelo) {
    const candidata = modelo === "T" ? null : delResultado.candidatas.find((c) => c.modelo === modelo);
    const curva = modelo === "T" ? curvaDeRecomendada({ ...delResultado, recomendada: "T" }, temporada) : (candidata?.curva ?? null);
    if (curva) comparador = armarComparador(modelo, { curva, eat: candidata?.eat ?? null }, vigenteApi);
  }

  const cuerpo: DetalleAgrupacionApi = {
    corrida: aCorridaResumen(fila),
    agrupacion: {
      id: agrupacion.id,
      nombre: agrupacion.nombre,
      codigo: agrupacion.codigo,
      activo: agrupacion.activo,
      temporada: agrupacion.temporada,
      temporada_sugerida: agrupacion.temporada_sugerida,
      generos: agrupacion.generos,
      equivalencias_activas: agrupacion.equivalencias_activas,
    },
    resultado: delResultado,
    temporada_curva: temporada,
    red: redApi,
    tiendas: identidades,
    vigente: vigenteApi,
    obsoleta,
    comparador,
  };
  return ok(cuerpo);
}
