import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth/guard";
import { ok } from "@/lib/api/respuestas";
import { traducirErrorDb } from "@/lib/api/errores-db";
import { incluirInactivos } from "@/lib/api/catalogo";
import { cargarEstadoArbol } from "@/lib/arbol/consultas";
import { armarArbol } from "@/lib/arbol/armar-arbol";

/**
 * Árbol completo Género → Mundo → Línea → Equivalencia en una sola llamada
 * (`requireUser`; `?incluir_inactivos=1`). Cinco selects paginados y
 * `armarArbol()`; ver docs/modulos/01-arbol-producto.md, "Árbol completo".
 */
export async function GET(request: NextRequest) {
  const { response } = await requireUser();
  if (response) return response;

  const { estado, error: err } = await cargarEstadoArbol(supabaseAdmin());
  if (err) return traducirErrorDb(err);

  return ok(
    armarArbol(estado.generos, estado.mundos, estado.lineas, estado.nodos, estado.equivalencias, {
      incluirInactivos: incluirInactivos(request),
    })
  );
}
