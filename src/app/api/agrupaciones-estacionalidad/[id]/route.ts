import type { NextRequest } from "next/server";
import { editarEnCatalogo, eliminarDeCatalogo } from "@/lib/api/catalogo";
import { catalogoAgrupacionesEstacionalidad } from "@/lib/estacionalidad/catalogos";

type Params = { params: Promise<{ id: string }> };

/**
 * Edita nombre, código, descripción, orden y/o activo (`requirePlanner`);
 * `404`; `409` repetido. Desactivar con equivalencias está permitido: pasan a
 * faltantes por "agrupación inactiva" y vuelven al reactivarla.
 */
export async function PATCH(request: NextRequest, ctx: Params) {
  return editarEnCatalogo(catalogoAgrupacionesEstacionalidad, request, ctx);
}

/** Elimina la agrupación si no tiene equivalencias, activas o no (`requirePlanner`); `409` con el conteo si las tiene. */
export async function DELETE(_request: NextRequest, ctx: Params) {
  return eliminarDeCatalogo(catalogoAgrupacionesEstacionalidad, ctx);
}
