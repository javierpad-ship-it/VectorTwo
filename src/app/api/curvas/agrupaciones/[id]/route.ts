import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlanner } from "@/lib/auth/guard";
import { error, idDeRuta, leerCuerpo, ok } from "@/lib/api/respuestas";
import { traducirErrorDb } from "@/lib/api/errores-db";
import { nombreDeUsuario } from "@/lib/ventas/http";
import { errorConCodigo } from "@/lib/curvas/lectura";
import {
  cambiarEstadoCurva,
  comoResultado,
  comoResumen,
  insertarCurva,
  leerAgrupacionPorId,
  leerCorridaPorId,
  leerCurvaVigente,
  leerUltimaVersion,
} from "@/lib/curvas/consultas";
import { elegirCurvaSchema } from "@/lib/curvas/esquemas";
import { huellaCargas } from "@/lib/curvas/huellas";
import { aCurvaAprobada, filaCurva, MENSAJE_AGRUPACION_NO_ENCONTRADA, motivoRechazoElegir } from "@/lib/curvas/reglas";
import type { ElegirCurvaRespuesta, RetirarCurvaRespuesta } from "@/lib/curvas/tipos-api";

type Params = { params: Promise<{ id: string }> };

/**
 * Aprueba UNA curva para la agrupación (`requirePlanner`; no hay aprobación en
 * bloque): copia la candidata `modelo` de la corrida `corrida_id` (la `T` de su
 * temporada si es `T`), pasa la vigente a `reemplazada` y crea la versión
 * siguiente como `vigente`. `201 { curva }`.
 *
 * `404` agrupación o corrida inexistente · `409` agrupación inactiva ·
 * `409 candidata_no_disponible` · `409 sin_cambio` (misma corrida y modelo que la
 * vigente) · `400` zod. Sin transacción: si el alta falla tras reemplazar, se
 * intenta devolver la anterior a vigente.
 */
export async function PUT(request: NextRequest, { params }: Params) {
  const { perfil, response } = await requirePlanner();
  if (response) return response;

  const { id, respuesta: respuestaId } = await idDeRuta(params, MENSAJE_AGRUPACION_NO_ENCONTRADA);
  if (respuestaId) return respuestaId;
  const { datos, respuesta } = await leerCuerpo(request, elegirCurvaSchema);
  if (respuesta) return respuesta;

  const db = supabaseAdmin();
  const [agrupacion, corrida, vigente] = await Promise.all([
    leerAgrupacionPorId(db, id),
    leerCorridaPorId(db, datos.corrida_id),
    leerCurvaVigente(db, id),
  ]);
  const fallo = agrupacion.error ?? corrida.error ?? vigente.error;
  if (fallo) return traducirErrorDb(fallo, "elegir curva: leer datos");

  const resultado = corrida.data ? comoResultado(corrida.data.resultado) : null;
  const rechazo = motivoRechazoElegir(
    agrupacion.data ? { id: agrupacion.data.id, activo: agrupacion.data.activo } : null,
    corrida.data && resultado ? { id: corrida.data.id, resultado } : null,
    datos.modelo,
    vigente.data ? { corrida_id: vigente.data.corrida_id, modelo: vigente.data.modelo } : null
  );
  if (rechazo) return rechazo.status === 404 ? error(rechazo.mensaje, 404) : errorConCodigo(rechazo.mensaje, 409, rechazo.codigo);
  if (!corrida.data || !resultado) return error("Corrida no encontrada.", 404);

  const delResultado = resultado.agrupaciones.find((a) => a.agrupacion_id === id);
  if (!delResultado) return errorConCodigo("Esa candidata no está disponible para esta agrupación en la corrida elegida.", 409, "candidata_no_disponible");

  const ultima = await leerUltimaVersion(db, id);
  if (ultima.error) return traducirErrorDb(ultima.error, "elegir curva: última versión");

  const fila = filaCurva({
    agrupacion: delResultado,
    temporada: resultado.temporadas.find((t) => t.temporada === delResultado.temporada) ?? null,
    modelo: datos.modelo,
    corrida_id: corrida.data.id,
    resumen: comoResumen(corrida.data.resumen),
    cargas_huella: huellaCargas(comoResumen(corrida.data.resumen).cargas ?? {}),
    version_anterior: ultima.data,
    perfil: { id: perfil.id, nombre: nombreDeUsuario(perfil) },
    nota: datos.nota ?? null,
  });
  if (!fila) return errorConCodigo("Esa candidata no está disponible para esta agrupación en la corrida elegida.", 409, "candidata_no_disponible");

  // Transición sin transacción: primero la vigente actual pasa a `reemplazada`, luego se inserta la nueva.
  if (vigente.data) {
    const { error: errReemplazo } = await cambiarEstadoCurva(db, vigente.data.id, "reemplazada");
    if (errReemplazo) return traducirErrorDb(errReemplazo, "elegir curva: reemplazar la vigente");
  }
  const { data: nueva, error: errInsert } = await insertarCurva(db, fila);
  if (errInsert) {
    if (vigente.data) await cambiarEstadoCurva(db, vigente.data.id, "vigente");
    return traducirErrorDb(errInsert, "elegir curva: guardar la versión nueva");
  }
  const cuerpo: ElegirCurvaRespuesta = { curva: aCurvaAprobada(nueva) };
  return ok(cuerpo, 201);
}

/**
 * Retira la curva vigente de la agrupación (`requirePlanner`): pasa a `retirada`
 * y la agrupación queda sin curva (M7 no podrá repartirla). `{ id, estado }`;
 * `404` si no existe la agrupación o no tiene curva vigente.
 */
export async function DELETE(_request: NextRequest, { params }: Params) {
  const { response } = await requirePlanner();
  if (response) return response;

  const { id, respuesta } = await idDeRuta(params, MENSAJE_AGRUPACION_NO_ENCONTRADA);
  if (respuesta) return respuesta;

  const db = supabaseAdmin();
  const { data: vigente, error: err } = await leerCurvaVigente(db, id);
  if (err) return traducirErrorDb(err, "retirar curva: buscar la vigente");
  if (!vigente) return error("Esa agrupación no tiene una curva vigente que retirar.", 404);

  const { data, error: errRetiro } = await cambiarEstadoCurva(db, vigente.id, "retirada");
  if (errRetiro) return traducirErrorDb(errRetiro, "retirar curva");
  if (!data) return error("Esa agrupación no tiene una curva vigente que retirar.", 404);
  const cuerpo: RetirarCurvaRespuesta = { id: data.id, estado: "retirada" };
  return ok(cuerpo);
}
