import type { NextRequest } from "next/server";
import { requirePlanner } from "@/lib/auth/guard";
import { idDeRuta, leerCuerpo, ok } from "@/lib/api/respuestas";
import { guardarCrecimientosSchema } from "@/lib/proyeccion/esquemas";
import { guardarCrecimientos, leerCrecimientosDeProyeccion } from "@/lib/proyeccion/servicio-crecimientos";

type Params = { params: Promise<{ id: string }> };

const NO_ENCONTRADA = "Proyección no encontrada.";

/**
 * La matriz de crecimientos del año siguiente por género × mundo (`requirePlanner`; el comprador recibe `403`): las celdas con su % y sus
 * agregados (base `B`, filas con % propio, decididas, rebote del Niño), el Resto con su desglose por género, el objetivo global, el puente al
 * Total del año siguiente y la `huella` del bloqueo optimista. No lee `historico`, `factores_mes` ni venta. `404` si la proyección no existe.
 */
export async function GET(_request: NextRequest, { params }: Params) {
  const { response } = await requirePlanner();
  if (response) return response;

  const { id, respuesta } = await idDeRuta(params, NO_ENCONTRADA);
  if (respuesta) return respuesta;
  const r = await leerCrecimientosDeProyeccion(id);
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}

/**
 * «Guardar y recalcular» (`requirePlanner`): reemplazo completo e idempotente de la matriz (HOMBRE y MUJER × mundos, más el Resto y el
 * objetivo). `huella` es la del `GET` (`409 conflicto` si cambió). La matriz debe venir completa (`400 celdas_incompletas`). Si choca con
 * filas fijadas a mano responde `409 filas_manuales` con la lista y su `huella_choque`, sin escribir nada; con `resolucion` (`pisar` o
 * `conservar`) y esa `huella_choque` se guarda. Toma el candado de cálculo, escribe y recalcula en el servidor: `200` con el `GET`
 * recalculado y el resultado (`pisadas`, `revertidas`, `celdas_descartadas`, `recalculo`; si el recálculo falla, `recalculo.ok = false` y la matriz queda guardada).
 * Otros errores: `400` (`celda_repetida`, `genero_no_permitido`, `mundo_inactivo`, `resolucion_invalida`), `404`, `409 cerrada` / `archivada` /
 * `calculo_en_curso`, `500 guardado_parcial`.
 */
export async function PUT(request: NextRequest, { params }: Params) {
  const { perfil, response } = await requirePlanner();
  if (response) return response;

  const { id, respuesta: respuestaId } = await idDeRuta(params, NO_ENCONTRADA);
  if (respuestaId) return respuestaId;
  const { datos, respuesta } = await leerCuerpo(request, guardarCrecimientosSchema);
  if (respuesta) return respuesta;
  const r = await guardarCrecimientos(id, datos, { id: perfil.id, nombre: perfil.nombre });
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}
