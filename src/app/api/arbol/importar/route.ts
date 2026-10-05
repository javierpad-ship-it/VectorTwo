import type { NextRequest } from "next/server";
import type { PostgrestError } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlanner } from "@/lib/auth/guard";
import { error, leerCuerpo, ok } from "@/lib/api/respuestas";
import { describirErrorDb, registrarErrorDb, traducirErrorDb } from "@/lib/api/errores-db";
import type { TablesInsert } from "@/lib/supabase/database.types";
import { importarSchema } from "@/lib/arbol/esquemas";
import { cargarEstadoArbol, leerLineas, leerNodos } from "@/lib/arbol/consultas";
import { normalizarNombre } from "@/lib/arbol/normalizar";
import { enTandas, planificarImportacion } from "@/lib/arbol/importar";
import type { ConteosCrear, ReporteImportacion } from "@/lib/arbol/tipos";

/**
 * Importador del árbol (`requirePlanner`). `previsualizar` devuelve el plan
 * sin escribir; `aplicar` inserta líneas → nodos → equivalencias en tandas de
 * 500 con `on conflict do nothing` (upsert + ignoreDuplicates). No hay
 * transacción: si una tanda falla, la respuesta es `500` con lo que alcanzó a
 * crear y reimportar completa el resto sin duplicar.
 */
export async function POST(request: NextRequest) {
  const { response } = await requirePlanner();
  if (response) return response;

  const { datos, respuesta } = await leerCuerpo(request, importarSchema);
  if (respuesta) return respuesta;

  const db = supabaseAdmin();
  const { estado, error: errEstado } = await cargarEstadoArbol(db);
  if (errEstado) return traducirErrorDb(errEstado);

  const plan = planificarImportacion(datos.filas, estado);

  if (datos.modo === "previsualizar") {
    const reporte: ReporteImportacion = { modo: "previsualizar", ...plan.reporte };
    return ok(reporte);
  }

  const creados: ConteosCrear = {
    lineas: 0,
    nodos: 0,
    equivalencias: 0,
    equivalencias_genericas: 0,
    equivalencias_igual_a_linea: 0,
  };

  const falloEn = (etapa: string, err: PostgrestError | string) => {
    let detalle: string;
    if (typeof err === "string") detalle = err;
    else {
      const descrito = describirErrorDb(err.code, err.message, err.details);
      if (descrito.status >= 500) registrarErrorDb(err, `importar: ${etapa}`);
      detalle = descrito.mensaje;
    }
    const eq = creados.equivalencias + creados.equivalencias_genericas;
    return error(
      `La importación se detuvo al crear ${etapa}: ${detalle} Se crearon ${creados.lineas} líneas, ` +
        `${creados.nodos} nodos y ${eq} equivalencias; vuelve a importar el mismo archivo para completar el resto sin duplicar.`,
      500
    );
  };

  // 1. Líneas (catálogo). El único está sobre `nombre`.
  for (const tanda of enTandas(plan.lineas)) {
    const filas: TablesInsert<"lineas">[] = tanda.map((l) => ({ nombre: l.nombre, codigo: l.codigo }));
    const { data, error: err } = await db
      .from("lineas")
      .upsert(filas, { onConflict: "nombre", ignoreDuplicates: true })
      .select("id");
    if (err) return falloEn("líneas", err);
    creados.lineas += data?.length ?? 0;
  }

  const { data: lineas, error: errLineas } = await leerLineas(db);
  if (errLineas) return falloEn("nodos", errLineas);
  const lineaId = new Map(lineas.map((l) => [normalizarNombre(l.nombre), l.id]));

  // 2. Nodos (tripleta única).
  const nodosInsert: TablesInsert<"genero_mundo_linea">[] = [];
  for (const n of plan.nodos) {
    const id = lineaId.get(n.linea_nombre);
    if (!id) return falloEn("nodos", `no se encontró la línea ${n.linea_nombre} después de crearla.`);
    nodosInsert.push({ genero_id: n.genero_id, mundo_id: n.mundo_id, linea_id: id });
  }
  for (const tanda of enTandas(nodosInsert)) {
    const { data, error: err } = await db
      .from("genero_mundo_linea")
      .upsert(tanda, { onConflict: "genero_id,mundo_id,linea_id", ignoreDuplicates: true })
      .select("id");
    if (err) return falloEn("nodos", err);
    creados.nodos += data?.length ?? 0;
  }

  const { data: nodos, error: errNodos } = await leerNodos(db);
  if (errNodos) return falloEn("equivalencias", errNodos);
  const nodoId = new Map(nodos.map((n) => [`${n.genero_id}|${n.mundo_id}|${n.linea_id}`, n.id]));

  // 3. Equivalencias (único por nodo + nombre; la genérica tiene nombre fijo, así que cae ahí también).
  // `igualALinea` guarda las reales que se llaman como su línea (filas con `-` o
  // con el nombre literal) para el conteo informativo `equivalencias_igual_a_linea`.
  const equivalenciasInsert: TablesInsert<"equivalencias">[] = [];
  const igualALinea = new Set<string>();
  for (const e of plan.equivalencias) {
    const linea = lineaId.get(e.linea_nombre);
    const nodo = linea && nodoId.get(`${e.genero_id}|${e.mundo_id}|${linea}`);
    if (!nodo) return falloEn("equivalencias", `no se encontró el nodo de ${e.linea_nombre} después de crearlo.`);
    equivalenciasInsert.push({
      genero_mundo_linea_id: nodo,
      nombre: e.nombre,
      codigo: e.codigo,
      es_generica: e.es_generica,
    });
    if (!e.es_generica && e.nombre === e.linea_nombre) igualALinea.add(`${nodo}|${e.nombre}`);
  }
  for (const tanda of enTandas(equivalenciasInsert)) {
    const { data, error: err } = await db
      .from("equivalencias")
      .upsert(tanda, { onConflict: "genero_mundo_linea_id,nombre", ignoreDuplicates: true })
      .select("id, genero_mundo_linea_id, nombre, es_generica");
    if (err) return falloEn("equivalencias", err);
    for (const fila of data ?? []) {
      if (fila.es_generica) creados.equivalencias_genericas += 1;
      else {
        creados.equivalencias += 1;
        if (igualALinea.has(`${fila.genero_mundo_linea_id}|${fila.nombre}`)) {
          creados.equivalencias_igual_a_linea = (creados.equivalencias_igual_a_linea ?? 0) + 1;
        }
      }
    }
  }

  const reporte: ReporteImportacion = { modo: "aplicar", ...plan.reporte, crear: creados };
  return ok(reporte);
}
