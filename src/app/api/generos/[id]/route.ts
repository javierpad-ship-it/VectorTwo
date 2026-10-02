import type { NextRequest } from "next/server";
import { editarEnCatalogo, eliminarDeCatalogo } from "@/lib/api/catalogo";
import { catalogoGeneros } from "@/lib/arbol/catalogos";

type Params = { params: Promise<{ id: string }> };

/** Edita nombre, código, orden y/o activo (`requireAdmin`). */
export async function PATCH(request: NextRequest, ctx: Params) {
  return editarEnCatalogo(catalogoGeneros, request, ctx);
}

/** Elimina el género si no tiene nodos (`requireAdmin`); `409` si los tiene. */
export async function DELETE(_request: NextRequest, ctx: Params) {
  return eliminarDeCatalogo(catalogoGeneros, ctx);
}
