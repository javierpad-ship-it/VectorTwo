import type { NextRequest } from "next/server";
import { crearEnCatalogo, listarCatalogo } from "@/lib/api/catalogo";
import { catalogoAgrupacionesMarca } from "@/lib/marcas/catalogos";

/**
 * Agrupaciones de marca por `orden, nombre` (`requireUser`;
 * `?incluir_inactivos=1`), cada fila con `marcas` (todas) y `marcas_activas`.
 */
export async function GET(request: NextRequest) {
  return listarCatalogo(catalogoAgrupacionesMarca, request);
}

/** Crea una agrupación de marca (`requireAdmin`), 201; `409` nombre o código repetido. */
export async function POST(request: NextRequest) {
  return crearEnCatalogo(catalogoAgrupacionesMarca, request);
}
