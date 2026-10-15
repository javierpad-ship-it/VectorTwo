import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlanner } from "@/lib/auth/guard";
import { ok } from "@/lib/api/respuestas";
import { traducirErrorDb } from "@/lib/api/errores-db";
import { hoyLima } from "@/lib/tiendas/estado";
import { ultimoMesCerrado } from "@/lib/ventas/periodo";
import { hastaPorDefecto, mesesFaltantes } from "@/lib/curvas/anios";
import {
  aPeriodoApi,
  contarEquivalenciasSinAgrupacion,
  contarVersiones,
  leerAgrupacionesConDatos,
  leerCargasPublicadas,
  leerCurvasVigentes,
  leerPeriodos,
  leerTiendas,
  leerVentaMensualTienda,
} from "@/lib/curvas/consultas";
import { armarEstadoCurvas, type EntradaEstado } from "@/lib/curvas/estado";
import { leerObsolescencia } from "@/lib/curvas/lectura";
import { aVigenteResumen } from "@/lib/curvas/reglas";
import { estadoGlobalActual } from "@/lib/curvas/trabajo";
import type { EstadoCurvasApi, VigenteResumenApi } from "@/lib/curvas/tipos-api";

/**
 * Lista de agrupaciones con su estado (`requirePlanner`; `EstadoCurvasApi` v2, 06b).
 * NUNCA calcula ni llama a `venta_estacionalidad_agrupacion`: el estado
 * (`sin_curva` / `al_dia` / `al_dia_distinta` / `obsoleta` / `inactiva_con_curva`), los
 * avisos de la vigente (`datos_posteriores`, `modelo_anterior`, `temporada_recompuesta`)
 * y los prerrequisitos salen de las fotos de las vigentes (sin `resultado`), el maestro
 * de tiendas, los periodos y la venta por tienda (`venta_mensual_tienda()`). Trae los
 * prerrequisitos globales (meses, periodos por temporada, tiendas sin apertura) y, por
 * fila, `bloqueada_por` (lo que se sabe sin calcular). Sin corrida, sin selector.
 */
export async function GET() {
  const { response } = await requirePlanner();
  if (response) return response;

  const db = supabaseAdmin();
  const [agrupaciones, vigentes, periodos, cargas, tiendas, venta, versiones, sinAgrupacion] = await Promise.all([
    leerAgrupacionesConDatos(db, { soloActivas: false }),
    leerCurvasVigentes(db),
    leerPeriodos(db, { soloActivos: true }),
    leerCargasPublicadas(db),
    leerTiendas(db),
    leerVentaMensualTienda(db),
    contarVersiones(db),
    contarEquivalenciasSinAgrupacion(db),
  ]);
  const fallo = agrupaciones.error ?? vigentes.error ?? periodos.error ?? cargas.error ?? tiendas.error ?? venta.error ?? versiones.error ?? sinAgrupacion.error;
  if (fallo) return traducirErrorDb(fallo, "estado de curvas");

  const periodosApi = periodos.data.map(aPeriodoApi);
  const hoy = hoyLima();
  const evaluadas = await leerObsolescencia(
    db,
    vigentes.data,
    estadoGlobalActual({
      tiendas: tiendas.data,
      venta: venta.data,
      cargas: cargas.data,
      periodos: periodosApi,
      agrupaciones: agrupaciones.data,
      activas: agrupaciones.data.filter((a) => a.activo),
      hoy,
    })
  );
  if (evaluadas.respuesta) return evaluadas.respuesta;

  const meses = Object.keys(cargas.data).sort();
  const ultimoPublicado = meses.length > 0 ? meses[meses.length - 1] : null;
  const entrada: EntradaEstado = {
    datos: {
      desde: meses[0] ?? null,
      hasta: ultimoPublicado,
      meses_publicados: meses.length,
      faltantes: ultimoPublicado ? mesesFaltantes(meses, ultimoPublicado) : [],
      ultimo_mes_cerrado: ultimoMesCerrado(hoy),
    },
    agrupaciones: agrupaciones.data,
    vigentes: new Map<string, VigenteResumenApi>(vigentes.data.map((v) => [v.agrupacion_estacionalidad_id, aVigenteResumen(v)])),
    evaluaciones: evaluadas.data,
    versiones: versiones.data,
    periodos: periodosApi,
    prerrequisitos: {
      meses_publicados: meses,
      hasta_periodo: hastaPorDefecto(meses, hoy),
      tiendas: tiendas.data,
      venta_tienda: venta.data,
    },
    equivalencias_sin_agrupacion: sinAgrupacion.data,
  };
  const cuerpo: EstadoCurvasApi = armarEstadoCurvas(entrada);
  return ok(cuerpo);
}
