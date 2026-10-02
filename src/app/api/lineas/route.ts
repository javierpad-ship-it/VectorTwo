import type { NextRequest } from "next/server";
import { crearEnCatalogo, listarCatalogo } from "@/lib/api/catalogo";
import { catalogoLineas } from "@/lib/arbol/catalogos";

/** Líneas por `nombre` con `nodos: number` (`requireUser`; `?incluir_inactivos=1`). */
export async function GET(request: NextRequest) {
  return listarCatalogo(catalogoLineas, request);
}

/** Crea una línea (`requirePlanner`), 201. Temporada por defecto `Todo el año`. */
export async function POST(request: NextRequest) {
  return crearEnCatalogo(catalogoLineas, request);
}
