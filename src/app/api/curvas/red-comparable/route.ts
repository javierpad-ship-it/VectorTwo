import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlanner } from "@/lib/auth/guard";
import { error, ok } from "@/lib/api/respuestas";
import { traducirErrorDb } from "@/lib/api/errores-db";
import { errorConCodigo } from "@/lib/curvas/lectura";
import { hoyLima } from "@/lib/tiendas/estado";
import { aniosDeCorrida, clasificarAnio, hastaPorDefecto, mesesFaltantes } from "@/lib/curvas/anios";
import { mesesAtipicos } from "@/lib/curvas/atipicos";
import { aPeriodoApi, leerCargasPublicadas, leerPeriodos, leerTiendas, leerVentaMensualTienda } from "@/lib/curvas/consultas";
import { leerConsultaRed } from "@/lib/curvas/esquemas";
import { redComparable } from "@/lib/curvas/red";
import { MAX_MESES_HUECO, type RedAnioApi, type RedComparableVistaPrevia } from "@/lib/curvas/tipos-api";

/**
 * Vista previa de la red comparable (`requirePlanner`): lee el
 * maestro de tiendas y la venta por tienda y mes, y aplica los parámetros de red
 * que lleguen en la query (los de red de los parámetros de la agrupación:
 * `solo_tiendas_completas`, `exigir_venta_todo_el_ano`, `meses_tienda_nueva`,
 * `umbral_tienda_dominante`, `umbral_forma`, `peso_minimo_diagnostico`, más
 * `hasta_periodo`). Cada año trae, por tienda, su peso, perfil, `eat_vs_red` y si
 * es distinta. `400` parámetros inválidos · `409` sin meses publicados.
 */
export async function GET(request: NextRequest) {
  const { response } = await requirePlanner();
  if (response) return response;

  const { consulta, rechazo } = leerConsultaRed(request.nextUrl.searchParams);
  if (rechazo) return error(rechazo.mensaje, rechazo.status);

  const db = supabaseAdmin();
  const [tiendas, venta, cargas, periodos] = await Promise.all([
    leerTiendas(db),
    leerVentaMensualTienda(db),
    leerCargasPublicadas(db),
    leerPeriodos(db, { soloActivos: true }),
  ]);
  const fallo = tiendas.error ?? venta.error ?? cargas.error ?? periodos.error;
  if (fallo) return traducirErrorDb(fallo, "red comparable: leer datos");

  const publicados = Object.keys(cargas.data).sort();
  if (publicados.length === 0) return errorConCodigo("No hay meses publicados: carga la venta en Venta y stock.", 409, "sin_datos");
  const hasta = consulta.hasta_periodo ?? hastaPorDefecto(publicados, hoyLima()) ?? publicados[publicados.length - 1];
  if (!(hasta in cargas.data)) return errorConCodigo(`El mes ${hasta} no está publicado en Venta y stock.`, 409, "hasta_periodo_sin_cargar");

  const usados = publicados.filter((m) => m <= hasta);
  const anios = aniosDeCorrida(usados, hasta);
  const atipicosRed = mesesAtipicos(periodos.data.map(aPeriodoApi), { temporada: "todo_el_ano" });
  const aniosNormales = anios.filter((a) => clasificarAnio(a, usados, atipicosRed, MAX_MESES_HUECO, hasta).clase === "normal");
  const redes = redComparable(tiendas.data, venta.data, anios, hasta, consulta.parametros, { aniosNormales, mesesPublicados: usados });

  const nombres = new Map(tiendas.data.map((t) => [t.id, t]));
  const anioApi: RedAnioApi[] = redes.map((r) => ({
    ...r,
    tiendas: r.tiendas.map((t) => ({ ...t, codigo: nombres.get(t.tienda_id)?.codigo ?? t.tienda_id, nombre: nombres.get(t.tienda_id)?.nombre ?? t.tienda_id })),
  }));
  const cuerpo: RedComparableVistaPrevia = {
    anios: anioApi,
    hasta_periodo: hasta,
    meses_publicados: { desde: usados[0], hasta: usados[usados.length - 1], total: usados.length, faltantes: mesesFaltantes(usados, hasta) },
  };
  return ok(cuerpo);
}
