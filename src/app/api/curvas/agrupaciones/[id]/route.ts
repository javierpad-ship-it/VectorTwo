import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlanner } from "@/lib/auth/guard";
import { error, idDeRuta, leerCuerpo, ok } from "@/lib/api/respuestas";
import { traducirErrorDb } from "@/lib/api/errores-db";
import { nombreDeUsuario } from "@/lib/ventas/http";
import { errorConCodigo, leerContextoTrabajo } from "@/lib/curvas/lectura";
import { cambiarEstadoCurva, insertarCorrida, insertarCurva, leerCurvaVigente } from "@/lib/curvas/consultas";
import { aprobarCurvaSchema, parametrosDeCuerpo } from "@/lib/curvas/esquemas";
import { aCurvaAprobada, extrasDeCurva, filaCurva, MENSAJE_AGRUPACION_NO_ENCONTRADA, motivoRechazoAprobar } from "@/lib/curvas/reglas";
import { VERSION_MODELO } from "@/lib/curvas/modelo";
import { armarFoto, piezasDeSalida, prepararTrabajo } from "@/lib/curvas/trabajo";
import type { AprobarCurvaRespuesta, RetirarCurvaRespuesta } from "@/lib/curvas/tipos-api";

type Params = { params: Promise<{ id: string }> };

/**
 * APRUEBA UNA curva para la agrupación (`requirePlanner`; no hay aprobación en
 * bloque). Contrato para el frontend (docs/modulos/06b…):
 *
 *   cuerpo  `AprobarCurvaCuerpo`: `modelo`, `parametros` (los que vio el planner, con
 *           `hasta_periodo` OBLIGATORIO: el de `datos.hasta_periodo` de `calcular`),
 *           `huella_calculo` (la de `calcular`), `version_vigente` (la versión vigente que vio, o
 *           `null`) y `nota`.
 *   201     `{ curva, foto_id }` (`AprobarCurvaRespuesta`). El servidor recalcula con esos
 *           parámetros, guarda la FOTO en `corridas_estacionalidad`, pasa la vigente a
 *           `reemplazada` y crea la versión siguiente como `vigente`.
 *   404     agrupación inexistente · 400 zod (estricto: sin `hasta_periodo`, clave desconocida, modelo fuera de A…E/T,
 *           nota con caracteres de control…).
 *   409     `{ error, codigo }`, en este orden: `agrupacion_inactiva` · `hasta_periodo_sin_cargar` ·
 *           `prerrequisitos` · `sin_curva_posible` · `candidata_no_disponible` · `datos_cambiados` ·
 *           `vigente_cambiada` · `sin_cambio` · `nota_requerida` (modelo distinto de la recomendada,
 *           años o tiendas excluidos, o tratamiento del Niño distinto de `auto`, sin nota). Al guardar,
 *           `vigente_cambiada` también si otro usuario movió la vigente entre la lectura y el cambio.
 *
 * Sin transacción: si el alta falla tras reemplazar, se intenta devolver la anterior a
 * vigente; una foto sin curva es basura inofensiva (nadie la referencia).
 */
export async function PUT(request: NextRequest, { params }: Params) {
  const { perfil, response } = await requirePlanner();
  if (response) return response;

  const { id, respuesta: respuestaId } = await idDeRuta(params, MENSAJE_AGRUPACION_NO_ENCONTRADA);
  if (respuestaId) return respuestaId;
  const { datos, respuesta } = await leerCuerpo(request, aprobarCurvaSchema);
  if (respuesta) return respuesta;

  const inicio = Date.now();
  const db = supabaseAdmin();
  const contexto = await leerContextoTrabajo(db, id);
  if (contexto.respuesta) return contexto.respuesta;
  if (!contexto.data) return error(MENSAJE_AGRUPACION_NO_ENCONTRADA, 404);
  const { insumos, vigente, ultima_version } = contexto.data;
  if (!insumos.agrupacion.activo) {
    return errorConCodigo("La agrupación está inactiva: actívala antes de aprobarle una curva.", 409, "agrupacion_inactiva");
  }

  const parametros = parametrosDeCuerpo(datos.parametros);
  const preparado = prepararTrabajo(insumos, parametros, datos.parametros.hasta_periodo);
  if (preparado.rechazo) return errorConCodigo(preparado.rechazo.mensaje, preparado.rechazo.status, preparado.rechazo.codigo);
  const trabajo = preparado.trabajo;
  const piezas = piezasDeSalida(trabajo.salida, id);

  const rechazo = motivoRechazoAprobar({
    agrupacion: { id: insumos.agrupacion.id, activo: insumos.agrupacion.activo },
    prerrequisitos: trabajo.prerrequisitos,
    resultado: piezas?.resultado ?? null,
    temporada: piezas?.temporada ?? null,
    modelo: datos.modelo,
    huella_enviada: datos.huella_calculo,
    huella_actual: trabajo.huella_calculo,
    vigente: vigente ? { version: vigente.version, modelo: vigente.modelo, huella_calculo: extrasDeCurva(vigente.anios_utilizados).huella_calculo } : null,
    version_vigente: datos.version_vigente,
    parametros,
    nota: datos.nota,
  });
  if (rechazo) return rechazo.status === 404 ? error(rechazo.mensaje, 404) : errorConCodigo(rechazo.mensaje, 409, rechazo.codigo);
  if (!piezas || trabajo.hasta_periodo === null) return errorConCodigo("Esta agrupación no tiene curva posible.", 409, "sin_curva_posible");

  const foto = armarFoto(trabajo, insumos.agrupacion, insumos.periodos, Date.now() - inicio);
  if (!foto) return errorConCodigo("Esta agrupación no tiene curva posible.", 409, "sin_curva_posible");
  const usuario = { id: perfil.id, nombre: nombreDeUsuario(perfil) };

  // La fila de la curva se comprueba ANTES de guardar la foto: así un fallo aquí no deja una foto huérfana.
  // El id de la foto se pone después (la fila solo lo necesita para `corrida_id`).
  const fila = filaCurva({
    agrupacion: piezas.resultado,
    temporada: piezas.temporada,
    modelo: datos.modelo,
    corrida_id: "",
    red_huella: trabajo.red_huella,
    cargas_huella: trabajo.cargas_huella,
    version_anterior: ultima_version,
    perfil: usuario,
    nota: datos.nota ?? null,
    foto: {
      huella_calculo: trabajo.huella_calculo,
      huella_temporada: trabajo.huella_temporada,
      version_modelo: VERSION_MODELO,
      hasta_periodo: trabajo.hasta_periodo,
      hasta_fue_por_defecto: trabajo.hasta_fue_por_defecto,
      parametros,
    },
  });
  if (!fila) return errorConCodigo("Esa candidata no está disponible para esta agrupación con estos parámetros.", 409, "candidata_no_disponible");

  const { data: fotoGuardada, error: errFoto } = await insertarCorrida(db, { ...foto, perfil_id: usuario.id, usuario_nombre: usuario.nombre });
  if (errFoto) return traducirErrorDb(errFoto, "aprobar curva: guardar la foto");

  // Transición sin transacción y CONDICIONAL: la vigente pasa a `reemplazada` solo si sigue vigente; luego se inserta la nueva.
  const MENSAJE_VIGENTE_CAMBIADA = "Otra persona aprobó o retiró una curva de esta agrupación: vuelve a cargar.";
  if (vigente) {
    const { data: movida, error: errReemplazo } = await cambiarEstadoCurva(db, vigente.id, "vigente", "reemplazada");
    if (errReemplazo) return traducirErrorDb(errReemplazo, "aprobar curva: reemplazar la vigente");
    if (!movida) return errorConCodigo(MENSAJE_VIGENTE_CAMBIADA, 409, "vigente_cambiada");
  }
  const { data: nueva, error: errInsert } = await insertarCurva(db, { ...fila, corrida_id: fotoGuardada.id });
  if (errInsert) {
    if (vigente) await cambiarEstadoCurva(db, vigente.id, "reemplazada", "vigente");
    return traducirErrorDb(errInsert, "aprobar curva: guardar la versión nueva");
  }
  const cuerpo: AprobarCurvaRespuesta = { curva: aCurvaAprobada(nueva), foto_id: fotoGuardada.id };
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

  const { data, error: errRetiro } = await cambiarEstadoCurva(db, vigente.id, "vigente", "retirada");
  if (errRetiro) return traducirErrorDb(errRetiro, "retirar curva");
  if (!data) return errorConCodigo("Otra persona cambió la curva de esta agrupación mientras tanto: vuelve a cargar.", 409, "vigente_cambiada");
  const cuerpo: RetirarCurvaRespuesta = { id: data.id, estado: "retirada" };
  return ok(cuerpo);
}
