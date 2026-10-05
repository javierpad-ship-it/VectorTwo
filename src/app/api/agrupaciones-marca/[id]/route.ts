import type { NextRequest } from "next/server";
import { editarEnCatalogo, eliminarDeCatalogo } from "@/lib/api/catalogo";
import { catalogoAgrupacionesMarca } from "@/lib/marcas/catalogos";

type Params = { params: Promise<{ id: string }> };

/** Edita nombre, código, orden y/o activo (`requireAdmin`); `404`; `409` repetido. */
export async function PATCH(request: NextRequest, ctx: Params) {
  return editarEnCatalogo(catalogoAgrupacionesMarca, request, ctx);
}

/** Elimina la agrupación si no tiene marcas, activas o no (`requireAdmin`); `409` con el conteo si las tiene. */
export async function DELETE(_request: NextRequest, ctx: Params) {
  return eliminarDeCatalogo(catalogoAgrupacionesMarca, ctx);
}
