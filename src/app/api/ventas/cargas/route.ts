import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlanner } from "@/lib/auth/guard";
import { leerCuerpo, ok } from "@/lib/api/respuestas";
import { CODIGO_UNICO, traducirErrorDb } from "@/lib/api/errores-db";
import { hoyLima } from "@/lib/tiendas/estado";
import type { Json } from "@/lib/supabase/database.types";
import { abrirCargaSchema } from "@/lib/ventas/esquemas";
import { mensajeCargaEnCurso, motivoRechazoAbrir } from "@/lib/ventas/cargas";
import {
  SELECT_CARGA,
  aCargaApi,
  aEnCurso,
  aResumenPublicada,
  leerCargasVigentes,
  leerPendientesLimpieza,
  leerTotalesPublicadas,
  limpiarPendientes,
  type CargaLeida,
} from "@/lib/ventas/consultas";
import { errorConCodigo, nombreDeUsuario } from "@/lib/ventas/http";
import { aCentimos } from "@/lib/ventas/numeros";
import { INICIO_HISTORICO, CADUCIDAD_CARGA_MIN } from "@/lib/ventas/tipos";
import { listarMeses, periodoADb, recortarPeriodo, ultimoMesCerrado } from "@/lib/ventas/periodo";
import type { AbrirCargaRespuesta, CargasRespuesta, MesCarga } from "@/lib/ventas/tipos-api";

/**
 * Cargas de venta y stock. Toda la API de M5, lecturas incluidas, exige
 * `requirePlanner`: venta y, sobre todo, costo son los datos más sensibles del
 * sistema.
 */

/**
 * Abre la carga de un mes (`requirePlanner`). Pasos: (1) abandona las `en_curso`
 * del periodo caducadas (más de 30 minutos sin tandas) o del mismo usuario;
 * (2) si hay una `publicada` y `reemplazar` es falso, `409 mes_ya_cargado`;
 * (3) si el mes no ha cerrado (Lima) y `mes_abierto` es falso, `409
 * mes_abierto`; (4) inserta la carga `en_curso`; si el único parcial dice que
 * ya hay una vigente de otra persona, `409 carga_en_curso`. Responde `201` con
 * `{ carga, reemplaza }`.
 */
export async function POST(request: NextRequest) {
  const { perfil, response } = await requirePlanner();
  if (response) return response;

  const { datos, respuesta } = await leerCuerpo(request, abrirCargaSchema);
  if (respuesta) return respuesta;

  const db = supabaseAdmin();
  const periodoDb = periodoADb(datos.periodo);

  // 1. Abandona las en_curso caducadas o propias de ese mes.
  const limite = new Date(Date.now() - CADUCIDAD_CARGA_MIN * 60_000).toISOString();
  const { error: errAbandonar } = await db
    .from("cargas_venta_stock")
    .update({ estado: "abandonada" })
    .eq("periodo", periodoDb)
    .eq("estado", "en_curso")
    .or(`updated_at.lt.${limite},perfil_id.eq.${perfil.id}`);
  if (errAbandonar) return traducirErrorDb(errAbandonar, "abrir carga: abandonar en curso");

  // 2 y 3. Reglas del mes.
  const { data: publicada, error: errPublicada } = await db
    .from("cargas_venta_stock")
    .select(SELECT_CARGA)
    .eq("periodo", periodoDb)
    .eq("estado", "publicada")
    .maybeSingle();
  if (errPublicada) return traducirErrorDb(errPublicada, "abrir carga: buscar publicada");

  const rechazo = motivoRechazoAbrir({
    hayPublicada: publicada !== null,
    reemplazar: datos.reemplazar,
    periodo: datos.periodo,
    mesAbierto: datos.mes_abierto,
    hoyLima: hoyLima(),
  });
  if (rechazo) return errorConCodigo(rechazo.mensaje, 409, rechazo.codigo);

  // 4. Inserta la carga. `incompleto` solo si se fuerza; el reporte lleva los totales del archivo.
  const reporteBase: Record<string, unknown> = { ...datos.reporte };
  delete reporteBase.incompleto;
  const porcentaje = typeof datos.reporte.porcentaje_errores === "number" ? datos.reporte.porcentaje_errores : null;
  const reporte = {
    ...reporteBase,
    archivo: datos.archivo,
    ...(datos.forzar_incompleto ? { incompleto: { porcentaje } } : {}),
  };

  const { data: nueva, error: errInsert } = await db
    .from("cargas_venta_stock")
    .insert({
      periodo: periodoDb,
      estado: "en_curso",
      archivo_nombre: datos.archivo_nombre,
      perfil_id: perfil.id,
      usuario_nombre: nombreDeUsuario(perfil),
      reporte: reporte as Json,
    })
    .select(SELECT_CARGA)
    .single();
  if (errInsert) {
    if (errInsert.code === CODIGO_UNICO) {
      const { data: vigente } = await db
        .from("cargas_venta_stock")
        .select("usuario_nombre, updated_at")
        .eq("periodo", periodoDb)
        .eq("estado", "en_curso")
        .maybeSingle();
      return errorConCodigo(
        vigente ? mensajeCargaEnCurso(vigente.usuario_nombre, vigente.updated_at) : "Ya hay una carga en curso de ese mes.",
        409,
        "carga_en_curso"
      );
    }
    return traducirErrorDb(errInsert, "abrir carga: insertar");
  }

  // Limpieza de pasada (fuera de la ruta crítica: si falla solo quedan filas huérfanas invisibles).
  void limpiarPendientes(db).catch((e: unknown) => console.error("[ventas] limpieza al abrir carga", e));

  const cuerpo: AbrirCargaRespuesta = {
    carga: aCargaApi(nueva as CargaLeida),
    reemplaza: publicada ? aResumenPublicada(publicada as CargaLeida) : null,
  };
  return ok(cuerpo, 201);
}

/**
 * Meses de INICIO_HISTORICO al último mes cerrado (Lima), incluidos los que
 * faltan, más los meses fuera de rango que tengan carga (de más nuevo a más
 * viejo). Los totales salen de `cargas_venta_stock`, no de agregar hechos.
 * `?verificar=1` recalcula los totales en SQL (`totales_cargas_publicadas`) y
 * marca los meses cuyos totales guardados difieran de los medidos.
 */
export async function GET(request: NextRequest) {
  const { response } = await requirePlanner();
  if (response) return response;

  const verificar = request.nextUrl.searchParams.get("verificar") === "1";
  const db = supabaseAdmin();
  const hoy = hoyLima();
  const desde = INICIO_HISTORICO;
  const hasta = ultimoMesCerrado(hoy);

  const [cargas, pendientes, totales] = await Promise.all([
    leerCargasVigentes(db),
    leerPendientesLimpieza(db),
    verificar ? leerTotalesPublicadas(db) : Promise.resolve({ data: [], error: null }),
  ]);
  if (cargas.error) return traducirErrorDb(cargas.error, "listar cargas");
  if (pendientes.error) return traducirErrorDb(pendientes.error, "listar cargas: limpieza pendiente");
  if (totales.error) return traducirErrorDb(totales.error, "listar cargas: verificar totales");

  const medidos = new Map(totales.data.map((t) => [t.carga_id, t]));
  const ahora = new Date();

  const publicadas = new Map<string, CargaLeida>();
  const enCurso = new Map<string, CargaLeida>();
  for (const c of cargas.data) {
    const p = recortarPeriodo(c.periodo);
    if (c.estado === "publicada") publicadas.set(p, c);
    else if (c.estado === "en_curso") enCurso.set(p, c);
  }

  const esperados = listarMeses(desde, hasta);
  const periodos = [...new Set([...esperados, ...publicadas.keys(), ...enCurso.keys()])].sort().reverse();

  const meses: MesCarga[] = periodos.map((periodo) => {
    const pub = publicadas.get(periodo);
    const cur = enCurso.get(periodo);
    const carga = pub ? aCargaApi(pub) : null;
    let verificacion: MesCarga["verificacion"] = null;
    if (verificar && pub) {
      const m = medidos.get(pub.id);
      if (m) {
        const medido = {
          filas: m.filas,
          unidades: m.unidades,
          venta_soles: m.venta_soles,
          costo_vendido: m.costo_vendido,
          stock_unidades: m.stock_unidades,
          stock_valorizado: m.stock_valorizado,
        };
        verificacion = {
          coincide:
            medido.filas === (pub.filas ?? 0) &&
            medido.unidades === (pub.unidades ?? 0) &&
            medido.stock_unidades === (pub.stock_unidades ?? 0) &&
            aCentimos(medido.venta_soles) === aCentimos(pub.venta_soles ?? 0) &&
            aCentimos(medido.costo_vendido) === aCentimos(pub.costo_vendido ?? 0) &&
            aCentimos(medido.stock_valorizado) === aCentimos(pub.stock_valorizado ?? 0),
          medido,
        };
      }
    }
    return {
      periodo,
      estado: pub ? "cargado" : cur ? "en_curso" : "sin_cargar",
      carga,
      en_curso: cur ? aEnCurso(cur, ahora) : null,
      incompleto: carga ? carga.incompleto : null,
      verificacion,
    };
  });

  const cargadosEnRango = esperados.filter((p) => publicadas.has(p));
  const publicadasOrdenadas = [...publicadas.keys()].sort();
  const cuerpo: CargasRespuesta = {
    meta: {
      desde,
      hasta,
      meses_esperados: esperados.length,
      meses_cargados: cargadosEnRango.length,
      faltantes: esperados.filter((p) => !publicadas.has(p)),
      ultimo_cargado: publicadasOrdenadas.length > 0 ? publicadasOrdenadas[publicadasOrdenadas.length - 1] : null,
      filas_total: [...publicadas.values()].reduce((s, c) => s + (c.filas ?? 0), 0),
    },
    meses,
    limpieza_pendiente: pendientes.data.length,
    verificado: verificar,
  };
  return ok(cuerpo);
}
