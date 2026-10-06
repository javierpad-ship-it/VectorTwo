import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth/guard";
import { ok } from "@/lib/api/respuestas";
import { traducirErrorDb } from "@/lib/api/errores-db";
import { incluirInactivos } from "@/lib/api/catalogo";
import { cargarEstadoEstacionalidad } from "@/lib/estacionalidad/consultas";
import { armarArbol } from "@/lib/arbol/armar-arbol";

/**
 * Árbol completo Género → Mundo → Línea → Equivalencia en una sola llamada
 * (`requireUser`; `?incluir_inactivos=1`). Seis selects paginados (las cinco
 * tablas del árbol más `agrupaciones_estacionalidad` completa, activas e
 * inactivas) y `armarArbol()`; ver docs/modulos/01-arbol-producto.md, "Árbol
 * completo", y docs/modulos/03-agrupaciones-estacionalidad.md, "Árbol": cada
 * equivalencia trae `agrupacion_estacionalidad` y el resumen
 * `equivalencias_sin_agrupacion`.
 */
export async function GET(request: NextRequest) {
  const { response } = await requireUser();
  if (response) return response;

  const { estado, error: err } = await cargarEstadoEstacionalidad(supabaseAdmin());
  if (err) return traducirErrorDb(err);

  return ok(
    armarArbol(estado.generos, estado.mundos, estado.lineas, estado.nodos, estado.equivalencias, estado.agrupaciones, {
      incluirInactivos: incluirInactivos(request),
    })
  );
}
