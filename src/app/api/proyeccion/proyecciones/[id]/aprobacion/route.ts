import type { NextRequest } from "next/server";
import { z } from "zod";
import { requirePlanner } from "@/lib/auth/guard";
import { idDeRuta, ok } from "@/lib/api/respuestas";
import { leerAprobacion } from "@/lib/aprobacion/servicio";
import { leerConsulta } from "@/lib/proyeccion/rutas";

type Params = { params: Promise<{ id: string }> };

/** `?anio=<Y | Y+1>&modo=aprobar | reaprobar`: el año lo valida el servicio contra el año en curso de la proyección (`409 anio_no_admitido`). */
const consultaSchema = z.strictObject({
  anio: z.string("Falta el año.").regex(/^\d{4}$/, "El año debe ser un número de cuatro cifras.").transform(Number),
  modo: z.enum(["aprobar", "reaprobar"], "El modo debe ser «aprobar» o «reaprobar».").default("aprobar"),
});

/**
 * Filas elegibles para aprobar en bloque (`requirePlanner`, `GET`; no escribe): las que bloquean el cierre en `anio` (o, con `modo=reaprobar`, las aprobadas en bloque
 * cuya cifra de hoy cambió), con la propuesta del método, la IA vigente, la confianza, el cuadre por género × mundo y los bloqueos de hoy (07g, D14).
 * `404` proyección no encontrada; `409 anio_no_admitido`.
 */
export async function GET(request: NextRequest, { params }: Params) {
  const { perfil, response } = await requirePlanner();
  if (response) return response;

  const { id, respuesta: respuestaId } = await idDeRuta(params, "Proyección no encontrada.");
  if (respuestaId) return respuestaId;
  const q = leerConsulta(request, consultaSchema);
  if (q.respuesta) return q.respuesta;
  const r = await leerAprobacion(id, q.datos, { id: perfil.id, nombre: perfil.nombre });
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}
