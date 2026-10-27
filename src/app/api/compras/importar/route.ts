import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlanner } from "@/lib/auth/guard";
import { leerCuerpo, ok } from "@/lib/api/respuestas";
import { importarComprasSchema } from "@/lib/compras/esquemas";
import { importarCompras } from "@/lib/compras/servicio";
import { excesoDeLineasNuevas } from "@/lib/flujo/servicio";

/**
 * `POST /api/compras/importar` (`requirePlanner`; solo `carga_inicial` en `0.13.0`: sin ella, `400 carga_inicial_requerida`).
 * `modo = "previsualizar"` clasifica cada línea (`nueva`, `igual`, `cambiada`) por su CLAVE NATURAL (proveedor + referencia + línea) y dice
 * qué se omite y por qué; `modo = "aplicar"` llama a `importar_compra` UNA vez por compra (todo o nada por compra) y devuelve cuáles se
 * aplicaron. Idempotente: reimportar el mismo archivo da 0 nuevas. El aviso informativo `exceso` lo calcula el flujo (si no hay cerrada, no hay aviso).
 */
export async function POST(request: NextRequest) {
  const { perfil, rol, response } = await requirePlanner();
  if (response) return response;

  const { datos, respuesta } = await leerCuerpo(request, importarComprasSchema);
  if (respuesta) return respuesta;
  const d = supabaseAdmin();
  const r = await importarCompras(d, { id: perfil.id, nombre: perfil.nombre ?? perfil.email, rol }, datos, async (lineas) => {
    const exceso = await excesoDeLineasNuevas(d, lineas);
    return exceso.respuesta ? new Map<number, string>() : exceso.data;
  });
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}
