import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlanner, requireUser } from "@/lib/auth/guard";
import { puedeEditarMaestros } from "@/lib/auth/roles";
import { error, leerCuerpo, ok } from "@/lib/api/respuestas";
import { traducirErrorDb } from "@/lib/api/errores-db";
import { incluirInactivos } from "@/lib/api/catalogo";
import type { TablesInsert } from "@/lib/supabase/database.types";
import { asignarUnaSchema } from "@/lib/responsables/esquemas";
import { armarMatriz, compradoresAsignables, type AsignacionEntrada, type PerfilEntrada } from "@/lib/responsables/matriz";
import { motivoRechazoAsignacion } from "@/lib/responsables/reglas";
import { cargarEstadoResponsables, leerNodosDePareja } from "@/lib/responsables/consultas";
import { leerLineas } from "@/lib/arbol/consultas";
import type { Celda, ReporteMatriz, ResultadoAsignacionUna } from "@/lib/responsables/tipos";

/**
 * Matriz género × mundo completa (`requireUser`: el comprador lee todo). Una
 * sola lectura con catálogos, el producto cartesiano de celdas, los
 * compradores asignables y el resumen. Por defecto solo géneros y mundos
 * activos; con `?incluir_inactivos=1`, todos (la celda lleva `vigente`).
 * `compradores` solo se llena para admin y planner (los que pueden asignar);
 * al comprador se le devuelve `[]`. No lee equivalencias.
 */
export async function GET(request: NextRequest) {
  const { rol, response } = await requireUser();
  if (response) return response;

  const { estado, error: err } = await cargarEstadoResponsables(supabaseAdmin());
  if (err) return traducirErrorDb(err, "leer matriz de responsables");

  const matriz = armarMatriz(
    estado.generos,
    estado.mundos,
    estado.asignaciones,
    estado.perfiles,
    estado.nodos,
    estado.lineas,
    { incluirInactivos: incluirInactivos(request) }
  );
  const reporte: ReporteMatriz = {
    ...matriz,
    compradores: puedeEditarMaestros(rol) ? compradoresAsignables(estado.perfiles) : [],
  };
  return ok(reporte);
}

/**
 * Asigna, cambia o quita el responsable de UNA combinación (`requirePlanner`).
 * Idempotente. `perfil_id` no nulo: `upsert` sobre `(genero_id, mundo_id)` con
 * `activo: true`; `null`: borra la fila si existe (si no, `200` sin cambios).
 * Orden: zod → género, mundo y usuario existen (`404`) → usuario comprador y
 * activo, género y mundo activos (`409`, solo al asignar) → escribir →
 * `traducirErrorDb`. Devuelve la celda resultante.
 */
export async function PUT(request: NextRequest) {
  const { response } = await requirePlanner();
  if (response) return response;

  const { datos, respuesta } = await leerCuerpo(request, asignarUnaSchema);
  if (respuesta) return respuesta;

  const db = supabaseAdmin();
  const [genero, mundo, perfil] = await Promise.all([
    db.from("generos").select("id, codigo, nombre, orden, activo").eq("id", datos.genero_id).maybeSingle(),
    db.from("mundos").select("id, codigo, nombre, orden, activo").eq("id", datos.mundo_id).maybeSingle(),
    datos.perfil_id === null
      ? Promise.resolve({ data: null, error: null })
      : db.from("perfiles").select("id, nombre, email, rol, activo").eq("id", datos.perfil_id).maybeSingle(),
  ]);
  const fallo = genero.error ?? mundo.error ?? perfil.error;
  if (fallo) return traducirErrorDb(fallo, "asignar responsable: leer datos");

  const rechazo = motivoRechazoAsignacion({
    perfilId: datos.perfil_id,
    perfil: perfil.data,
    genero: genero.data,
    mundo: mundo.data,
  });
  if (rechazo) return error(rechazo.mensaje, rechazo.status);
  // `motivoRechazoAsignacion` ya garantizó que existen; esto solo estrecha los tipos.
  if (!genero.data || !mundo.data) return error("Género no encontrado.", 404);

  let asignacion: AsignacionEntrada | null = null;
  if (datos.perfil_id === null) {
    const { error: errBorrar } = await db
      .from("responsables_genero_mundo")
      .delete()
      .eq("genero_id", datos.genero_id)
      .eq("mundo_id", datos.mundo_id);
    if (errBorrar) return traducirErrorDb(errBorrar, "quitar responsable");
  } else {
    const fila: TablesInsert<"responsables_genero_mundo"> = {
      genero_id: datos.genero_id,
      mundo_id: datos.mundo_id,
      perfil_id: datos.perfil_id,
      activo: true,
    };
    const { data, error: errUpsert } = await db
      .from("responsables_genero_mundo")
      .upsert(fila, { onConflict: "genero_id,mundo_id" })
      .select("genero_id, mundo_id, perfil_id, activo")
      .single();
    if (errUpsert) return traducirErrorDb(errUpsert, "asignar responsable");
    asignacion = data;
  }

  // La celda resultante: la misma `armarMatriz`, sobre la pareja sola (1 × 1).
  const [nodos, lineas] = await Promise.all([
    leerNodosDePareja(db, datos.genero_id, datos.mundo_id),
    leerLineas(db),
  ]);
  const fallo2 = nodos.error ?? lineas.error;
  if (fallo2) return traducirErrorDb(fallo2, "asignar responsable: contar líneas");

  const perfiles: PerfilEntrada[] = perfil.data ? [perfil.data] : [];
  const { celdas } = armarMatriz(
    [genero.data],
    [mundo.data],
    asignacion ? [asignacion] : [],
    perfiles,
    nodos.data,
    lineas.data,
    { incluirInactivos: true }
  );
  const celda: Celda | undefined = celdas[0];
  if (!celda) return error("No se pudo armar la celda.", 500);
  const resultado: ResultadoAsignacionUna = celda;
  return ok(resultado);
}
