import type { NextRequest } from "next/server";
import { editarEnCatalogo, eliminarDeCatalogo } from "@/lib/api/catalogo";
import { catalogoMundos } from "@/lib/arbol/catalogos";

type Params = { params: Promise<{ id: string }> };

/** Edita nombre, código, orden y/o activo (`requireAdmin`). */
export async function PATCH(request: NextRequest, ctx: Params) {
  return editarEnCatalogo(catalogoMundos, request, ctx);
}

/** Elimina el mundo si no tiene nodos (`requireAdmin`); `409` si los tiene. */
export async function DELETE(_request: NextRequest, ctx: Params) {
  return eliminarDeCatalogo(catalogoMundos, ctx);
}
