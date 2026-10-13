import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlanner } from "@/lib/auth/guard";
import { error, ok } from "@/lib/api/respuestas";
import { traducirErrorDb } from "@/lib/api/errores-db";
import { leerCargasVigentes } from "@/lib/ventas/consultas";
import { periodoADb, recortarPeriodo } from "@/lib/ventas/periodo";
import { esMarcaGenerica } from "@/lib/marcas/conjuntos/reglas";
import { sugerirMarcasRelevantes } from "@/lib/marcas/gml/consultas";
import { cargarEstadoGml } from "@/lib/marcas/gml/estado";
import { sugerenciasQuerySchema } from "@/lib/marcas/gml/esquemas";
import { armarSugerencias, resolverRango } from "@/lib/marcas/gml/sugerencias";
import { parametrosNoVacios } from "@/lib/marcas/query";
import type { RespuestaSugerencias } from "@/lib/marcas/tipos-api";

/**
 * Sugerencias de marcas relevantes (`requirePlanner`, 02b): AYUDA, nunca se
 * aplica sola. `?desde=aaaa-mm&hasta=aaaa-mm&top=4&min_participacion=0.05&medida=venta_soles`.
 * Por defecto `hasta` = el último mes publicado y `desde` once meses antes. La
 * función SQL agrega la venta publicada por GML, UNIDAD de marca (ALFA suma sus
 * miembros) y agrupación de la unidad, excluyendo VARIOS, OTROS y SIN MARCA; aquí
 * se cruza con la configuración actual
 * (`nueva`, `ya_relevante`, `marca_al_barrer`, `marca_inactiva`,
 * `nodo_no_vigente`); el orden por medida, el top y la participación mínima se
 * aplican en SQL (`sugerir_marcas_relevantes_v2`). `409` si no hay meses publicados en el rango; `400` zod.
 * El tope, la medida y la participación mínima se aplican dentro de SQL (0,3 a 0,6 s con ~400 mil filas en local).
 */
export async function GET(request: NextRequest) {
  const { response } = await requirePlanner();
  if (response) return response;

  const consulta = sugerenciasQuerySchema.safeParse(
    parametrosNoVacios(request.nextUrl.searchParams, ["desde", "hasta", "top", "min_participacion", "medida"])
  );
  if (!consulta.success) {
    const primero = consulta.error.issues[0];
    const campo = primero?.path.length ? `${primero.path.join(".")}: ` : "";
    return error(`${campo}${primero?.message ?? "Parámetros inválidos."}`, 400);
  }
  const { desde, hasta, top, min_participacion, medida } = consulta.data;

  const db = supabaseAdmin();
  const cargas = await leerCargasVigentes(db);
  if (cargas.error) return traducirErrorDb(cargas.error, "sugerencias: leer cargas");
  const publicados = cargas.data.filter((c) => c.estado === "publicada").map((c) => recortarPeriodo(c.periodo));
  const rango = resolverRango(publicados, desde, hasta);
  if (!rango) {
    return error(
      "No hay meses publicados en ese rango. Publica la venta en Venta y stock antes de pedir sugerencias.",
      409
    );
  }

  const cargado = await cargarEstadoGml(db);
  if (cargado.error) return traducirErrorDb(cargado.error, "sugerencias: leer estado");
  const { estado } = cargado;

  // El orden por medida, el top y la participación mínima se aplican en SQL (función v2).
  const sql = await sugerirMarcasRelevantes(db, {
    desde: periodoADb(rango.desde),
    hasta: periodoADb(rango.hasta),
    top,
    excluir: estado.marcas.filter((m) => esMarcaGenerica(m.nombre)).map((m) => m.id),
    medida,
    minParticipacion: min_participacion,
  });
  if (sql.error) return traducirErrorDb(sql.error, "sugerencias: función de venta");

  const { sugerencias, resumen } = armarSugerencias(sql.data, estado);
  const cuerpo: RespuestaSugerencias = { rango, sugerencias, resumen };
  return ok(cuerpo);
}
