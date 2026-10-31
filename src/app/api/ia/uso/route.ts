import type { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth/guard";
import { ok } from "@/lib/api/respuestas";
import { usoQuerySchema } from "@/lib/ia/esquemas";
import { leerUsoIa } from "@/lib/ia/servicio";
import { leerConsulta } from "@/lib/proyeccion/rutas";

/** Uso del motor de IA de un mes de Lima (`?mes=aaaa-mm`, por defecto el actual): costo, tope, corridas y gasto por día, todo derivado de las llamadas (`requireAdmin`). */
export async function GET(request: NextRequest) {
  const { response } = await requireAdmin();
  if (response) return response;

  const q = leerConsulta(request, usoQuerySchema);
  if (q.respuesta) return q.respuesta;
  const r = await leerUsoIa(q.datos.mes);
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}
