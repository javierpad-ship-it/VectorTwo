import type { NextRequest } from "next/server";
import { crearEnCatalogo, listarCatalogo } from "@/lib/api/catalogo";
import { catalogoGeneros } from "@/lib/arbol/catalogos";

/** Géneros ordenados por `orden, nombre` (`requireUser`; `?incluir_inactivos=1`). */
export async function GET(request: NextRequest) {
  return listarCatalogo(catalogoGeneros, request);
}

/** Crea un género (`requireAdmin`), 201. */
export async function POST(request: NextRequest) {
  return crearEnCatalogo(catalogoGeneros, request);
}
