import type { NextRequest } from "next/server";
import { crearEnCatalogo, listarCatalogo } from "@/lib/api/catalogo";
import { catalogoMundos } from "@/lib/arbol/catalogos";

/** Mundos ordenados por `orden, nombre` (`requireUser`; `?incluir_inactivos=1`). */
export async function GET(request: NextRequest) {
  return listarCatalogo(catalogoMundos, request);
}

/** Crea un mundo (`requireAdmin`), 201. */
export async function POST(request: NextRequest) {
  return crearEnCatalogo(catalogoMundos, request);
}
