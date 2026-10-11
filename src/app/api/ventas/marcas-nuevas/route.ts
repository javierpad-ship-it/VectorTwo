import type { NextRequest } from "next/server";
import type { PostgrestError } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlanner } from "@/lib/auth/guard";
import { error, leerCuerpo, ok } from "@/lib/api/respuestas";
import { CODIGO_UNICO, traducirErrorDb } from "@/lib/api/errores-db";
import { normalizarNombre } from "@/lib/arbol/normalizar";
import { enTandas } from "@/lib/arbol/importar";
import { cargarEstadoMarcas, leerMarcas } from "@/lib/marcas/consultas";
import type { TablesInsert } from "@/lib/supabase/database.types";
import { marcasNuevasSchema } from "@/lib/ventas/esquemas";
import { planificarAltaMarcas } from "@/lib/ventas/resolver";
import { TANDA_MARCAS } from "@/lib/ventas/tipos";
import type { MarcasNuevasRespuesta } from "@/lib/ventas/tipos-api";

/**
 * Alta de marcas desconocidas (`requirePlanner`). Se llama una vez por
 * archivo, SOLO después de que el usuario confirme el reporte previo y antes
 * de abrir ninguna carga. Crea cada marca que no exista con
 * `tratamiento_especial = false`, la agrupación elegida y un código único;
 * VARIOS, OTROS y SIN MARCA van siempre a MID VALUE. `upsert … onConflict:
 * "nombre", ignoreDuplicates` en tandas de 500: seguro ante una carrera con
 * otro usuario e idempotente. Devuelve los ids leyendo `marcas` completa (sin
 * ningún `.in` de nombres).
 */
export async function POST(request: NextRequest) {
  const { response } = await requirePlanner();
  if (response) return response;

  const { datos, respuesta } = await leerCuerpo(request, marcasNuevasSchema);
  if (respuesta) return respuesta;

  const db = supabaseAdmin();

  let creadas = 0;
  const comodines: string[] = [];
  let codigoRepetido: PostgrestError | null = null;

  // Un `23505` de código (carrera con otro alta) se resuelve releyendo y reintentando una vez.
  for (let intento = 0; intento < 2; intento++) {
    const { estado, error: errEstado } = await cargarEstadoMarcas(db);
    if (errEstado) return traducirErrorDb(errEstado, "marcas nuevas: leer estado");

    const plan = planificarAltaMarcas(datos.nombres, estado.marcas, estado.agrupaciones, datos.agrupacion_marca_id);
    if (plan.error) return error(plan.error.mensaje, plan.error.status);

    codigoRepetido = null;
    for (const tanda of enTandas(plan.crear, TANDA_MARCAS)) {
      const filas: TablesInsert<"marcas">[] = tanda.map((m) => ({
        nombre: m.nombre,
        codigo: m.codigo,
        agrupacion_marca_id: m.agrupacion_marca_id,
        tratamiento_especial: false,
      }));
      const { data, error: err } = await db
        .from("marcas")
        .upsert(filas, { onConflict: "nombre", ignoreDuplicates: true })
        .select("id, nombre");
      if (err) {
        if (err.code === CODIGO_UNICO) {
          codigoRepetido = err;
          break;
        }
        return traducirErrorDb(err, "marcas nuevas: crear");
      }
      creadas += data?.length ?? 0;
    }
    comodines.push(...plan.comodines.filter((c) => !comodines.includes(c)));
    if (!codigoRepetido) break;
  }

  if (codigoRepetido) {
    return error("No se pudieron crear todas las marcas porque otro usuario estaba creando las mismas. Vuelve a intentarlo.", 409);
  }

  const { data: todas, error: errLeer } = await leerMarcas(db);
  if (errLeer) return traducirErrorDb(errLeer, "marcas nuevas: leer ids");
  const pedidos = new Set(datos.nombres.map(normalizarNombre).filter((n) => n !== ""));
  const ids: Record<string, string> = {};
  for (const m of todas) {
    const n = normalizarNombre(m.nombre);
    if (pedidos.has(n)) ids[n] = m.id;
  }

  const cuerpo: MarcasNuevasRespuesta = {
    creadas,
    existentes: Math.max(0, pedidos.size - creadas),
    ids,
    comodines_en_mid_value: comodines,
  };
  return ok(cuerpo);
}
