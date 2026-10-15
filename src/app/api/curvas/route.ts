import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlanner } from "@/lib/auth/guard";
import { error, ok } from "@/lib/api/respuestas";
import { traducirErrorDb } from "@/lib/api/errores-db";
import { hoyLima } from "@/lib/tiendas/estado";
import { ultimoMesCerrado } from "@/lib/ventas/periodo";
import { mesesFaltantes } from "@/lib/curvas/anios";
import {
  aCorridaResumen,
  aPeriodoApi,
  leerAgrupacionesConDatos,
  leerCargasPublicadas,
  leerCorridasLista,
  leerCurvasVigentes,
  leerPeriodos,
} from "@/lib/curvas/consultas";
import { armarEstadoCurvas, type EntradaEstado } from "@/lib/curvas/estado";
import { leerCorridaId } from "@/lib/curvas/esquemas";
import { aCorridaVista, leerObsolescencia, resolverCorrida } from "@/lib/curvas/lectura";
import { aVigenteResumen } from "@/lib/curvas/reglas";
import type { EstadoCurvasApi, VigenteResumenApi } from "@/lib/curvas/tipos-api";

/**
 * Estado general de las curvas (`requirePlanner`; `?corrida_id=` opcional: por
 * defecto la de referencia y, sin referencia, la última). Agrupaciones con su
 * curva vigente, la propuesta de la corrida, la obsolescencia con motivo y el
 * resumen. NO lee la vista materializada: `unidades_sin_agrupacion` sale del
 * resumen de la corrida. `404` si `corrida_id` no existe.
 */
export async function GET(request: NextRequest) {
  const { response } = await requirePlanner();
  if (response) return response;

  const { corridaId, rechazo } = leerCorridaId(request.nextUrl.searchParams);
  if (rechazo) return error(rechazo.mensaje, rechazo.status);

  const db = supabaseAdmin();
  const [agrupaciones, vigentes, lista, periodos, cargas, corrida] = await Promise.all([
    leerAgrupacionesConDatos(db, { soloActivas: false }),
    leerCurvasVigentes(db),
    leerCorridasLista(db, 20),
    leerPeriodos(db, { soloActivos: true }),
    leerCargasPublicadas(db),
    resolverCorrida(db, corridaId, { ultimaSiNoHayReferencia: true }),
  ]);
  const fallo = agrupaciones.error ?? vigentes.error ?? lista.error ?? periodos.error ?? cargas.error;
  if (fallo) return traducirErrorDb(fallo, "estado de curvas");
  if (corrida.respuesta) return corrida.respuesta;

  const periodosApi = periodos.data.map(aPeriodoApi);
  const obsoletas = await leerObsolescencia(
    db,
    vigentes.data,
    agrupaciones.data,
    periodosApi
  );
  if (obsoletas.respuesta) return obsoletas.respuesta;

  const meses = Object.keys(cargas.data).sort();
  const ultimoPublicado = meses.length > 0 ? meses[meses.length - 1] : null;
  const entrada: EntradaEstado = {
    datos: {
      desde: meses[0] ?? null,
      hasta: ultimoPublicado,
      meses_publicados: meses.length,
      faltantes: ultimoPublicado ? mesesFaltantes(meses, ultimoPublicado) : [],
      ultimo_mes_cerrado: ultimoMesCerrado(hoyLima()),
    },
    corrida: corrida.data ? aCorridaVista(corrida.data) : null,
    corridas: lista.data.map((c) => {
      const r = aCorridaResumen(c);
      return {
        id: r.id,
        created_at: r.created_at,
        hasta_periodo: r.hasta_periodo,
        referencia: r.referencia,
        usuario_nombre: r.usuario_nombre,
        resumen: { propias: r.resumen.propias, prestadas: r.resumen.prestadas, sin_venta: r.resumen.sin_venta },
      };
    }),
    agrupaciones: agrupaciones.data,
    vigentes: new Map<string, VigenteResumenApi>(vigentes.data.map((v) => [v.agrupacion_estacionalidad_id, aVigenteResumen(v)])),
    obsoletas: obsoletas.data,
    periodos: periodosApi,
  };
  const cuerpo: EstadoCurvasApi = armarEstadoCurvas(entrada);
  return ok(cuerpo);
}
