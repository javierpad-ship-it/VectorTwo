import type { NextRequest } from "next/server";
import { listarCatalogo } from "@/lib/api/catalogo";
import { catalogoAgrupacionesTalla } from "@/lib/arbol/catalogos";

/**
 * Agrupaciones de talla por `orden` (`requireUser`). Catálogo cerrado: no hay
 * POST/PATCH/DELETE; se cambia por migración.
 */
export async function GET(request: NextRequest) {
  return listarCatalogo(catalogoAgrupacionesTalla, request);
}
