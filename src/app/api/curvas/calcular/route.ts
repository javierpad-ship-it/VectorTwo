import type { NextRequest } from "next/server";
import type { Json } from "@/lib/supabase/database.types";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlanner } from "@/lib/auth/guard";
import { error, leerCuerpo, ok } from "@/lib/api/respuestas";
import { MENSAJE_CALCULO_EN_CURSO, CODIGO_BLOQUEO, traducirErrorDb } from "@/lib/api/errores-db";
import { nombreDeUsuario } from "@/lib/ventas/http";
import { errorConCodigo } from "@/lib/curvas/lectura";
import { hoyLima } from "@/lib/tiendas/estado";
import { mesesFaltantes, hastaPorDefecto } from "@/lib/curvas/anios";
import { aPeriodoApi, aCorridaResumen, insertarCorrida, leerAgrupacionesConDatos, leerCargasPublicadas, leerMarcasDeCorridas, leerPeriodos, leerTiendas, marcarReferencia, quitarReferencia, refrescarYLeerAgregado } from "@/lib/curvas/consultas";
import { armarEntradaCorrida, unidadesSinAgrupacion } from "@/lib/curvas/entrada";
import { calcularSchema, parametrosDeCuerpo } from "@/lib/curvas/esquemas";
import { huellaRed } from "@/lib/curvas/huellas";
import { MENSAJE_AGREGADO_INVALIDO } from "@/lib/curvas/agregado";
import { calcularCorrida, redondearJson } from "@/lib/curvas/modelo";
import type { CalcularRespuesta, ResumenCorrida } from "@/lib/curvas/tipos-api";

/** Refrescar el agregado cuesta de 2 a 5 s: margen para que la plataforma no corte el cálculo. */
export const maxDuration = 60;

/**
 * Calcula una corrida (`requirePlanner`): refresca y lee el agregado en una sola
 * llamada atómica, decide la red comparable, calcula las candidatas con
 * backtesting y guarda `resultado`, `resumen`, `red_comparable` y
 * `efecto_atipico`. Responde `201 { corrida }`. Si no hay ninguna corrida de
 * referencia (o `marcar_referencia`), la nueva lo es.
 *
 * Errores: `400` zod · `409 sin_datos` (ningún mes publicado) ·
 * `409 hasta_periodo_sin_cargar` · `409 calculo_en_curso` (otro cálculo está
 * refrescando el agregado) · `500` agregado incompleto.
 */
export async function POST(request: NextRequest) {
  const { perfil, response } = await requirePlanner();
  if (response) return response;

  const { datos, respuesta } = await leerCuerpo(request, calcularSchema);
  if (respuesta) return respuesta;
  const inicio = Date.now();
  const parametros = parametrosDeCuerpo(datos);

  const db = supabaseAdmin();
  const [agrupaciones, tiendas, periodos, cargas] = await Promise.all([
    leerAgrupacionesConDatos(db, { soloActivas: true }),
    leerTiendas(db),
    leerPeriodos(db, { soloActivos: true }),
    leerCargasPublicadas(db),
  ]);
  const fallo = agrupaciones.error ?? tiendas.error ?? periodos.error ?? cargas.error;
  if (fallo) return traducirErrorDb(fallo, "calcular curvas: leer datos");

  const publicados = Object.keys(cargas.data).sort();
  if (publicados.length === 0) return errorConCodigo("No hay meses publicados: carga la venta en Venta y stock antes de calcular.", 409, "sin_datos");
  const hasta = datos.hasta_periodo ?? hastaPorDefecto(publicados, hoyLima());
  if (hasta === null) return errorConCodigo("Ningún mes publicado está cerrado todavía: indica hasta qué mes calcular.", 409, "sin_datos");
  if (!(hasta in cargas.data)) {
    return errorConCodigo(`El mes ${hasta} no está publicado en Venta y stock.`, 409, "hasta_periodo_sin_cargar");
  }
  if (agrupaciones.data.length === 0) return errorConCodigo("No hay agrupaciones de estacionalidad activas.", 409, "sin_datos");

  // Una sola llamada: lock de aviso + refresco + lectura del agregado.
  const agregado = await refrescarYLeerAgregado(db);
  if (agregado.error) {
    if (agregado.error.code === CODIGO_BLOQUEO || /calculo_en_curso/.test(agregado.error.message)) {
      return errorConCodigo(MENSAJE_CALCULO_EN_CURSO, 409, "calculo_en_curso");
    }
    return traducirErrorDb(agregado.error, "calcular curvas: refrescar el agregado");
  }
  if (!agregado.data) return error(MENSAJE_AGREGADO_INVALIDO, 500);

  const mesesUsados = publicados.filter((m) => m <= hasta);
  const entrada = armarEntradaCorrida(
    {
      hasta_periodo: hasta,
      meses_publicados: mesesUsados,
      filas: agregado.data.filas,
      tiendas: tiendas.data,
      periodos: periodos.data.map(aPeriodoApi),
      agrupaciones: agrupaciones.data.map((a) => ({
        id: a.id,
        temporada: a.temporada,
        composicion: { equivalencias: a.equivalencias_activas, huella: a.huella },
        temporada_sugerida: a.temporada_sugerida,
        temporadas_mezcladas: a.temporadas_mezcladas,
      })),
    },
    parametros
  );
  const salida = calcularCorrida(entrada, parametros);

  const resumen: ResumenCorrida = {
    ...salida.resumen,
    agregado: {
      filas_mv: agregado.data.refresco.filas,
      refrescada_at: agregado.data.refresco.refrescada_at,
      duracion_ms: agregado.data.refresco.duracion_ms,
    },
    meses_publicados: { desde: mesesUsados[0], hasta: mesesUsados[mesesUsados.length - 1], faltantes: mesesFaltantes(mesesUsados, hasta) },
    unidades_sin_agrupacion: unidadesSinAgrupacion(agregado.data.filas, hasta),
    red_huella: huellaRed(tiendas.data),
    cargas: Object.fromEntries(mesesUsados.map((m) => [m, cargas.data[m]])),
    duracion_ms: Date.now() - inicio,
  };

  // Referencia: la primera corrida lo es siempre; después, solo si se pide.
  const marcas = await leerMarcasDeCorridas(db);
  if (marcas.error) return traducirErrorDb(marcas.error, "calcular curvas: leer corridas");
  const anterior = marcas.data.find((c) => c.referencia)?.id ?? null;
  const seraReferencia = datos.marcar_referencia || anterior === null;
  if (seraReferencia) {
    const { error: errQuitar } = await quitarReferencia(db);
    if (errQuitar) return traducirErrorDb(errQuitar, "calcular curvas: quitar la referencia anterior");
  }

  const { data: fila, error: errInsert } = await insertarCorrida(db, {
    hasta_periodo: `${hasta}-01`,
    parametros: parametros as unknown as Json,
    resultado: salida.resultado as unknown as Json,
    resumen: redondearJson(resumen) as unknown as Json,
    red_comparable: redondearJson(entrada.redes) as unknown as Json,
    efecto_atipico: salida.efecto_atipico as unknown as Json,
    referencia: seraReferencia,
    perfil_id: perfil.id,
    usuario_nombre: nombreDeUsuario(perfil),
  });
  if (errInsert) {
    // Sin transacción: si no se pudo guardar, se intenta devolver la marca a la corrida de referencia anterior.
    if (seraReferencia && anterior !== null) await marcarReferencia(db, anterior);
    return traducirErrorDb(errInsert, "calcular curvas: guardar la corrida");
  }

  const cuerpo: CalcularRespuesta = { corrida: aCorridaResumen(fila) };
  return ok(cuerpo, 201);
}
