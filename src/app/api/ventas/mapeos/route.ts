import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlanner } from "@/lib/auth/guard";
import { error, leerCuerpo, ok } from "@/lib/api/respuestas";
import { traducirErrorDb } from "@/lib/api/errores-db";
import { cargarEstadoArbol } from "@/lib/arbol/consultas";
import { crearMapeosSchema } from "@/lib/ventas/esquemas";
import { esConflictoOrigenMapeo, insertarMapeos, leerMapeos, upsertMapeos, type MapeoDb, type MapeoInsert } from "@/lib/ventas/consultas";
import { errorConCodigo, nombreDeUsuario } from "@/lib/ventas/http";
import {
  columnasDeOrigen,
  crearEvaluadorMapeos,
  esEstadoMapeo,
  filtrarMapeos,
  planificarCrearMapeos,
  resumirEstados,
  type ActualizarMapeo,
  type NuevoMapeo,
} from "@/lib/ventas/mapeos";
import type { CrearMapeosRespuesta, MapeosRespuesta } from "@/lib/ventas/tipos-mapeo";

/**
 * Lista los mapeos de combinación (`requirePlanner`), del más recientemente
 * cambiado al más viejo. El `estado` de cada uno (vigente, inactivo, obsoleto,
 * destino_inactivo) se calcula contra el árbol de hoy. `?q=` filtra por texto
 * sobre origen, destino y nota; `?estado=` por estado. `resumen` cuenta TODOS
 * los mapeos, no solo los filtrados (para los chips de la pantalla).
 */
export async function GET(request: NextRequest) {
  const { response } = await requirePlanner();
  if (response) return response;

  const estadoPedido = request.nextUrl.searchParams.get("estado");
  const q = request.nextUrl.searchParams.get("q");
  if (estadoPedido !== null && estadoPedido !== "" && !esEstadoMapeo(estadoPedido)) {
    return error("El estado debe ser vigente, inactivo, obsoleto o destino_inactivo.", 400);
  }

  const db = supabaseAdmin();
  const [arbol, mapeos] = await Promise.all([cargarEstadoArbol(db), leerMapeos(db)]);
  if (arbol.error) return traducirErrorDb(arbol.error, "mapeos: árbol");
  if (mapeos.error) return traducirErrorDb(mapeos.error, "mapeos: listar");

  const evaluador = crearEvaluadorMapeos(arbol.estado);
  const todos = mapeos.data.map((m) => evaluador.aApi(m));
  const estadoFiltro = estadoPedido && esEstadoMapeo(estadoPedido) ? estadoPedido : null;
  const cuerpo: MapeosRespuesta = {
    mapeos: filtrarMapeos(todos, q, estadoFiltro),
    resumen: resumirEstados(todos),
  };
  return ok(cuerpo);
}

const filaDe = (m: NuevoMapeo | ActualizarMapeo, perfilId: string | null, usuario: string | null): MapeoInsert => ({
  ...columnasDeOrigen(m.origen),
  equivalencia_id: m.equivalencia_id,
  motivo_origen: m.motivo_origen,
  nota: m.nota,
  perfil_id: perfilId,
  usuario_nombre: usuario,
  activo: true,
});

/**
 * Crea mapeos (`requirePlanner`), 1 a 500, TODO O NADA: `planificarCrearMapeos`
 * valida la lista entera contra el árbol y los mapeos existentes antes de
 * escribir, y la escritura es una sola sentencia. Errores por item (con
 * `codigo` e `indice` junto a `error`): `400` origen sin terna o repetido en la
 * petición · `404` equivalencia destino inexistente · `409 destino_inactivo` ·
 * `409 origen_existe_en_arbol` (hoy resuelve `ok`: no hace falta mapeo) ·
 * `409 origen_repetido` (ya tiene otro destino y `reemplazar` es falso). Con
 * `reemplazar` se actualizan destino y nota (y se reactiva) en vez de fallar.
 * Responde `201` con lo creado y actualizado.
 */
export async function POST(request: NextRequest) {
  const { perfil, response } = await requirePlanner();
  if (response) return response;

  const { datos, respuesta } = await leerCuerpo(request, crearMapeosSchema);
  if (respuesta) return respuesta;

  const db = supabaseAdmin();
  const [arbol, existentes] = await Promise.all([cargarEstadoArbol(db), leerMapeos(db)]);
  if (arbol.error) return traducirErrorDb(arbol.error, "crear mapeos: árbol");
  if (existentes.error) return traducirErrorDb(existentes.error, "crear mapeos: leer existentes");

  const plan = planificarCrearMapeos(datos.mapeos, arbol.estado, existentes.data, { reemplazar: datos.reemplazar });
  if (plan.error) {
    return errorConCodigo(plan.error.mensaje, plan.error.status, plan.error.codigo, { indice: plan.error.indice });
  }

  const usuario = nombreDeUsuario(perfil);
  const filas: MapeoInsert[] = [
    ...plan.crear.map((m) => filaDe(m, perfil.id, usuario)),
    ...plan.actualizar.map((m) => filaDe(m, m.perfil_id, m.usuario_nombre)),
  ];

  const evaluador = crearEvaluadorMapeos(arbol.estado);
  let guardados: MapeoDb[] = [];
  if (filas.length > 0) {
    // Sin actualizaciones basta un `insert` estricto (una carrera con otro usuario sale como `409`); con ellas, un `upsert` sobre el único.
    const r = plan.actualizar.length === 0 ? await insertarMapeos(db, filas) : await upsertMapeos(db, filas);
    if (r.error) {
      // Carrera: otra persona guardó el mismo origen justo antes. Mismo código que el conflicto detectado al planificar.
      if (esConflictoOrigenMapeo(r.error)) {
        return errorConCodigo("Otra persona acaba de guardar un mapeo para ese origen. Vuelve a cargar la lista y revisa antes de reemplazarlo.", 409, "origen_repetido");
      }
      return traducirErrorDb(r.error, "crear mapeos: guardar");
    }
    guardados = r.data ?? [];
  }

  const cuerpo: CrearMapeosRespuesta = {
    creados: plan.crear.length,
    actualizados: plan.actualizar.length,
    sin_cambio: plan.sinCambio,
    mapeos: guardados.map((m) => evaluador.aApi(m)),
  };
  return ok(cuerpo, 201);
}
