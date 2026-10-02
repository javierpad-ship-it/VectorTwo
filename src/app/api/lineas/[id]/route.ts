import type { NextRequest } from "next/server";
import { editarEnCatalogo, eliminarDeCatalogo } from "@/lib/api/catalogo";
import { catalogoLineas } from "@/lib/arbol/catalogos";

type Params = { params: Promise<{ id: string }> };

/** Edita nombre, código, temporada y/o activo (`requirePlanner`). */
export async function PATCH(request: NextRequest, ctx: Params) {
  return editarEnCatalogo(catalogoLineas, request, ctx);
}

/** Elimina la línea si no está en ningún nodo (`requirePlanner`); `409` si lo está. */
export async function DELETE(_request: NextRequest, ctx: Params) {
  return eliminarDeCatalogo(catalogoLineas, ctx);
}
