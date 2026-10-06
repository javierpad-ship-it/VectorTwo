import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth/guard";
import { ok } from "@/lib/api/respuestas";
import { traducirErrorDb } from "@/lib/api/errores-db";
import { incluirInactivos } from "@/lib/api/catalogo";
import { agrupacionesConGeneros, cargarEstadoEstacionalidad } from "@/lib/estacionalidad/consultas";
import { aplanarEquivalencias } from "@/lib/estacionalidad/aplanar";

/**
 * Lista plana de equivalencias con ruta y agrupación (`requireUser`). Sin
 * parámetros, solo las activas y vigentes; `?incluir_inactivos=1` devuelve
 * también inactivas y no vigentes con sus banderas. Los catálogos (géneros,
 * mundos, líneas, agrupaciones) viajan completos en el mismo cuerpo, cada
 * agrupación con sus `genero_ids`, y `resumen` cuenta lo devuelto.
 */
export async function GET(request: NextRequest) {
  const { response } = await requireUser();
  if (response) return response;

  const { estado, error: err } = await cargarEstadoEstacionalidad(supabaseAdmin());
  if (err) return traducirErrorDb(err, "estacionalidad: leer estado");

  return ok(aplanarEquivalencias(estado, agrupacionesConGeneros(estado), { incluirInactivos: incluirInactivos(request) }));
}
