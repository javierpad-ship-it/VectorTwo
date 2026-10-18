import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlanner } from "@/lib/auth/guard";
import { leerCuerpo, ok } from "@/lib/api/respuestas";
import { crearReglaSchema, reglasQuerySchema } from "@/lib/intercompany/esquemas";
import { leerConsulta } from "@/lib/intercompany/rutas";
import { crearRegla, listarReglas } from "@/lib/intercompany/servicio";

/**
 * Reglas de intercompany (`requirePlanner`, solo lectura: M13). `?mes=aaaa-mm` (por defecto el mes en curso de Lima) y
 * `?incluir_historial=1`. Sin historial, la regla vigente de cada clave (marca × GML × equivalencia) en ese mes; con él, todas. Cada
 * una lleva `hasta_derivado`, `aplicable` (según la proyección cerrada de M7), `fuera_de_ambito` y los nombres. El comprador no
 * accede (`403`: ve el efecto en M8, no la tabla).
 */
export async function GET(request: NextRequest) {
  const { response } = await requirePlanner();
  if (response) return response;

  const { datos, respuesta } = leerConsulta(request, reglasQuerySchema);
  if (respuesta) return respuesta;
  const r = await listarReglas(supabaseAdmin(), datos.mes, datos.incluir_historial);
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}

/**
 * Crea una regla (`requirePlanner`, escribe: M13), `201` con la regla y sus `avisos`. Sin `imi_min` ni `imi_max` se guardan 4 y 8
 * (`es_rango_defecto`). `400` por validación (porcentaje fuera de 0–100, tope menor que el mínimo, mes que no es primer día de
 * mes). `404` marca, nodo o equivalencia. `409` con `codigo`: `marca_en_conjunto`, `marca_generica`, `marca_inactiva`,
 * `nodo_no_vigente`, `nodo_no_gmle`, `equivalencia_de_otro_nodo`, `clave_mes_repetido`.
 */
export async function POST(request: NextRequest) {
  const { perfil, response } = await requirePlanner();
  if (response) return response;

  const { datos, respuesta } = await leerCuerpo(request, crearReglaSchema);
  if (respuesta) return respuesta;
  const r = await crearRegla(supabaseAdmin(), datos, { id: perfil.id, nombre: perfil.nombre });
  if (r.respuesta) return r.respuesta;
  return ok(r.data, 201);
}
