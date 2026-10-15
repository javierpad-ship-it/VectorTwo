import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlanner } from "@/lib/auth/guard";
import { error, idDeRuta, leerCuerpo, ok } from "@/lib/api/respuestas";
import { traducirErrorDb } from "@/lib/api/errores-db";
import { aCorridaResumen, comoEfecto, comoRed, comoResultado, leerCorridaPorId, leerCurvasVigentes, leerMarcasDeCorridas, leerAgrupacionesConDatos, leerTiendas, marcarReferencia, quitarReferencia } from "@/lib/curvas/consultas";
import { CORRIDA_NO_ENCONTRADA, marcarReferenciaSchema } from "@/lib/curvas/esquemas";
import { aVigenteResumen, planificarReferencia } from "@/lib/curvas/reglas";
import type { CorridaDetalleApi, MarcarReferenciaRespuesta, RedAnioApi } from "@/lib/curvas/tipos-api";

type Params = { params: Promise<{ id: string }> };

/**
 * La corrida completa (`requirePlanner`): `resultado`, `red_comparable` con
 * `codigo` y `nombre` de cada tienda, `efecto_atipico` y, aparte, las
 * agrupaciones (nombre, géneros, temporada y su curva vigente). No lee la vista
 * materializada. `404` si no existe o el id no es un UUID.
 */
export async function GET(_request: NextRequest, { params }: Params) {
  const { response } = await requirePlanner();
  if (response) return response;

  const { id, respuesta } = await idDeRuta(params, CORRIDA_NO_ENCONTRADA);
  if (respuesta) return respuesta;

  const db = supabaseAdmin();
  const [corrida, agrupaciones, vigentes, tiendas] = await Promise.all([
    leerCorridaPorId(db, id),
    leerAgrupacionesConDatos(db, { soloActivas: false }),
    leerCurvasVigentes(db),
    leerTiendas(db),
  ]);
  const fallo = corrida.error ?? agrupaciones.error ?? vigentes.error ?? tiendas.error;
  if (fallo) return traducirErrorDb(fallo, "leer corrida de curvas");
  if (!corrida.data) return error(CORRIDA_NO_ENCONTRADA, 404);

  const nombres = new Map(tiendas.data.map((t) => [t.id, { codigo: t.codigo, nombre: t.nombre }]));
  const red: RedAnioApi[] = comoRed(corrida.data.red_comparable).map((r) => ({
    ...r,
    tiendas: r.tiendas.map((t) => ({ ...t, codigo: nombres.get(t.tienda_id)?.codigo ?? t.tienda_id, nombre: nombres.get(t.tienda_id)?.nombre ?? t.tienda_id })),
  }));
  const vigentePorAgrupacion = new Map(vigentes.data.map((v) => [v.agrupacion_estacionalidad_id, aVigenteResumen(v)]));

  const cuerpo: CorridaDetalleApi = {
    corrida: aCorridaResumen(corrida.data),
    resultado: comoResultado(corrida.data.resultado),
    red_comparable: red,
    efecto_atipico: comoEfecto(corrida.data.efecto_atipico),
    agrupaciones: agrupaciones.data
      .filter((a) => a.activo || vigentePorAgrupacion.has(a.id))
      .map((a) => ({
        id: a.id,
        nombre: a.nombre,
        codigo: a.codigo,
        activo: a.activo,
        temporada: a.temporada,
        generos: a.generos,
        vigente: vigentePorAgrupacion.get(a.id) ?? null,
      })),
  };
  return ok(cuerpo);
}

/**
 * Marca la corrida como la de referencia (`requirePlanner`, cuerpo
 * `{ referencia: true }`): quita la marca de la anterior (a lo sumo una la tiene)
 * y la pone aquí. `{ corrida }`; `404` si no existe. Sin transacción: si falla
 * a la mitad, repetir la acción lo arregla.
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  const { response } = await requirePlanner();
  if (response) return response;

  const { id, respuesta: respuestaId } = await idDeRuta(params, CORRIDA_NO_ENCONTRADA);
  if (respuestaId) return respuestaId;
  const { respuesta } = await leerCuerpo(request, marcarReferenciaSchema);
  if (respuesta) return respuesta;

  const db = supabaseAdmin();
  const marcas = await leerMarcasDeCorridas(db);
  if (marcas.error) return traducirErrorDb(marcas.error, "marcar referencia: leer corridas");
  const plan = planificarReferencia(marcas.data, id);
  if (!plan.existe) return error(CORRIDA_NO_ENCONTRADA, 404);

  if (plan.quitar.length > 0) {
    const { error: errQuitar } = await quitarReferencia(db, plan.marcar);
    if (errQuitar) return traducirErrorDb(errQuitar, "marcar referencia: quitar la anterior");
  }
  const { data, error: errMarcar } = await marcarReferencia(db, plan.marcar);
  if (errMarcar) return traducirErrorDb(errMarcar, "marcar referencia");
  if (!data) return error(CORRIDA_NO_ENCONTRADA, 404);
  const cuerpo: MarcarReferenciaRespuesta = { corrida: aCorridaResumen(data) };
  return ok(cuerpo);
}
