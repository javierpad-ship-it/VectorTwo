import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlanner } from "@/lib/auth/guard";
import { error, leerCuerpo, ok } from "@/lib/api/respuestas";
import { traducirErrorDb } from "@/lib/api/errores-db";
import { enTandas, TANDA_IN } from "@/lib/arbol/importar";
import type { TablesInsert } from "@/lib/supabase/database.types";
import { asignarMasivaSchema } from "@/lib/responsables/esquemas";
import { leerAsignaciones, leerGeneros, leerMundos, leerPerfiles } from "@/lib/responsables/consultas";
import { clasificarCombinaciones, motivoRechazoPerfil, planificarAsignacion } from "@/lib/responsables/reglas";
import type { ResultadoAsignacionMasiva } from "@/lib/responsables/tipos";

/**
 * Asignación en bloque (`requirePlanner`): una fila, una columna o toda la
 * matriz. Orden: zod (incluido `perfil_id: null` con `solo_faltantes`) →
 * destino (`404` usuario inexistente, `409` no comprador o desactivado: falla
 * toda la petición porque el error es del destino) → clasificar combinaciones
 * (las de un género o mundo borrado van a `no_encontradas` y, al asignar, las
 * de uno inactivo a `no_vigentes`; ninguna aborta) → `planificarAsignacion`
 * (`solo_faltantes` respeta a quien ya tiene un responsable válido; se hace en
 * el servidor para no pisar lo que otro planner hizo hace un minuto) →
 * `upsert` con `onConflict: "genero_id,mundo_id"` y `activo: true`, y `delete`
 * por `id` en tandas de `TANDA_IN`. Sin transacción: si una tanda falla,
 * respuesta de error y repetir la misma petición completa el resto (es
 * idempotente).
 */
export async function POST(request: NextRequest) {
  const { response } = await requirePlanner();
  if (response) return response;

  const { datos, respuesta } = await leerCuerpo(request, asignarMasivaSchema);
  if (respuesta) return respuesta;

  const db = supabaseAdmin();

  // Un solo perfil, o los de todos (para saber quién de los actuales es válido). Son decenas de filas.
  const [perfiles, generos, mundos, actuales] = await Promise.all([
    leerPerfiles(db),
    leerGeneros(db),
    leerMundos(db),
    leerAsignaciones(db),
  ]);
  const fallo = perfiles.error ?? generos.error ?? mundos.error ?? actuales.error;
  if (fallo) return traducirErrorDb(fallo, "asignar en bloque: leer datos");

  if (datos.perfil_id !== null) {
    const destino = perfiles.data.find((p) => p.id === datos.perfil_id);
    const rechazo = motivoRechazoPerfil(destino);
    if (rechazo) return error(rechazo.mensaje, rechazo.status);
  }

  const clasificadas = clasificarCombinaciones(datos.combinaciones, generos.data, mundos.data, {
    soloVigentes: datos.perfil_id !== null,
  });
  const plan = planificarAsignacion(
    actuales.data,
    clasificadas.validas,
    datos.perfil_id,
    { soloFaltantes: datos.solo_faltantes },
    perfiles.data
  );

  let asignadas = 0;
  if (datos.perfil_id !== null) {
    const perfilId = datos.perfil_id;
    const filas: TablesInsert<"responsables_genero_mundo">[] = plan.asignar.map((c) => ({
      genero_id: c.genero_id,
      mundo_id: c.mundo_id,
      perfil_id: perfilId,
      activo: true,
    }));
    for (const tanda of enTandas(filas)) {
      const { data, error: err } = await db
        .from("responsables_genero_mundo")
        .upsert(tanda, { onConflict: "genero_id,mundo_id" })
        .select("id");
      if (err) return traducirErrorDb(err, "asignar en bloque: escribir");
      asignadas += data?.length ?? 0;
    }
  }

  let quitadas = 0;
  for (const tanda of enTandas(
    plan.quitar.map((f) => f.id),
    TANDA_IN
  )) {
    const { data, error: err } = await db.from("responsables_genero_mundo").delete().in("id", tanda).select("id");
    if (err) return traducirErrorDb(err, "quitar en bloque: borrar");
    quitadas += data?.length ?? 0;
  }

  const resultado: ResultadoAsignacionMasiva = {
    asignadas,
    quitadas,
    sin_cambio: plan.sin_cambio,
    con_responsable: plan.con_responsable,
    no_encontradas: clasificadas.no_encontradas,
    no_vigentes: clasificadas.no_vigentes,
  };
  return ok(resultado);
}
