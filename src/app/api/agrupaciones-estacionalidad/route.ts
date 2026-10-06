import type { NextRequest } from "next/server";
import { crearEnCatalogo, listarCatalogo } from "@/lib/api/catalogo";
import { catalogoAgrupacionesEstacionalidad } from "@/lib/estacionalidad/catalogos";

/**
 * Agrupaciones de estacionalidad por `orden, nombre` (`requireUser`;
 * `?incluir_inactivos=1`), cada fila con `equivalencias` (las asignadas,
 * activas o no).
 */
export async function GET(request: NextRequest) {
  return listarCatalogo(catalogoAgrupacionesEstacionalidad, request);
}

/** Crea una agrupación (`requirePlanner`), 201; `409` nombre o código repetido. */
export async function POST(request: NextRequest) {
  return crearEnCatalogo(catalogoAgrupacionesEstacionalidad, request);
}
