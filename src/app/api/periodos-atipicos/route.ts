import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlanner } from "@/lib/auth/guard";
import { ok, leerCuerpo } from "@/lib/api/respuestas";
import { traducirErrorDb } from "@/lib/api/errores-db";
import { incluirInactivos } from "@/lib/api/catalogo";
import { contarMeses } from "@/lib/curvas/atipicos";
import { aPeriodoApi, contarAgrupacionesActivas, filaDePeriodoNuevo, insertarPeriodo, leerPeriodos } from "@/lib/curvas/consultas";
import { crearPeriodoAtipicoSchema } from "@/lib/curvas/esquemas";
import type { PeriodoAtipicoLista } from "@/lib/curvas/tipos-api";

/**
 * Periodos atípicos por `desde` (`requirePlanner`; `?incluir_inactivos=1`),
 * cada uno con `meses` (cuántos cubre), `temporadas` (el conjunto efectivo; M7 lee
 * este campo, `alcance` es un espejo heredado) y `agrupaciones_afectadas` (las
 * agrupaciones activas cuya temporada está en `temporadas`). `data` es un arreglo.
 */
export async function GET(request: NextRequest) {
  const { response } = await requirePlanner();
  if (response) return response;

  const db = supabaseAdmin();
  const [periodos, agrupaciones] = await Promise.all([
    leerPeriodos(db, { soloActivos: !incluirInactivos(request) }),
    contarAgrupacionesActivas(db),
  ]);
  if (periodos.error) return traducirErrorDb(periodos.error, "listar periodos_atipicos");
  if (agrupaciones.error) return traducirErrorDb(agrupaciones.error, "listar periodos_atipicos: contar agrupaciones");

  const lista: PeriodoAtipicoLista[] = periodos.data.map((fila) => {
    const periodo = aPeriodoApi(fila);
    return {
      ...periodo,
      meses: contarMeses(periodo.desde, periodo.hasta),
      agrupaciones_afectadas: periodo.temporadas.reduce((suma, t) => suma + agrupaciones.data[t], 0),
    };
  });
  return ok(lista);
}

/**
 * Crea un periodo (`requirePlanner`), `201` con la fila. `400` si `hasta` es
 * anterior a `desde`, un mes está mal formado (`2023-13`, `2023-3`), el motivo
 * está vacío o pasa de 120 caracteres, `temporadas` está vacía o repetida, o
 * `temporadas` y el `alcance` heredado se contradicen. Se escribe siempre
 * `temporadas` y su espejo `alcance`. Los periodos pueden solaparse (se toma la
 * unión) y abarcar meses futuros.
 */
export async function POST(request: NextRequest) {
  const { response } = await requirePlanner();
  if (response) return response;

  const { datos, respuesta } = await leerCuerpo(request, crearPeriodoAtipicoSchema);
  if (respuesta) return respuesta;

  const { data, error: err } = await insertarPeriodo(supabaseAdmin(), filaDePeriodoNuevo(datos));
  if (err) return traducirErrorDb(err, "crear periodo atípico");
  return ok(aPeriodoApi(data), 201);
}
