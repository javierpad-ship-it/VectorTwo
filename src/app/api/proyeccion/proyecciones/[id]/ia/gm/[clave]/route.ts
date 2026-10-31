import type { NextRequest } from "next/server";
import { requirePlanner } from "@/lib/auth/guard";
import { error, ok } from "@/lib/api/respuestas";
import { leerGMDetalle } from "@/lib/ia/servicio";
import { leerSegmentos } from "@/lib/proyeccion/rutas";

type Params = { params: Promise<{ id: string; clave: string }> };

/**
 * Detalle de la propuesta de IA de un género y mundo (`requirePlanner`): meta de hoy, filas con natural, cifra vigente (`asignarMeta` al leer),
 * absorbido, brecha, razones, estado y propuestas anteriores. `404` si no es un GM de la proyección. Solo lectura.
 */
export async function GET(_request: NextRequest, { params }: Params) {
  const { perfil, response } = await requirePlanner();
  if (response) return response;

  const s = await leerSegmentos(params, ["id"], "Proyección no encontrada.");
  if (s.respuesta) return s.respuesta;
  const clave = (await params).clave;
  if (typeof clave !== "string" || clave.length > 80) return error("Género y mundo no encontrado.", 404);
  const r = await leerGMDetalle(s.valores.id, clave, { id: perfil.id, nombre: perfil.nombre });
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}
