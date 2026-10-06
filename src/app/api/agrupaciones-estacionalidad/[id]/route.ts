import type { NextRequest } from "next/server";
import { eliminarDeCatalogo } from "@/lib/api/catalogo";
import { editarAgrupacion } from "@/lib/estacionalidad/agrupaciones";
import { catalogoAgrupacionesEstacionalidad } from "@/lib/estacionalidad/catalogos";

type Params = { params: Promise<{ id: string }> };

/**
 * Edita nombre, código, descripción, orden, activo y/o `genero_ids`
 * (`requirePlanner`); `404`; `409` repetido, género inactivo o género quitado
 * con equivalencias. Desactivar con equivalencias está permitido: pasan a
 * faltantes por "agrupación inactiva" y vuelven al reactivarla.
 */
export async function PATCH(request: NextRequest, ctx: Params) {
  return editarAgrupacion(request, ctx);
}

/**
 * Elimina la agrupación si no tiene equivalencias, activas o no
 * (`requirePlanner`); `409` con el conteo si las tiene. Sus vínculos con
 * géneros se van con ella (`on delete cascade`).
 */
export async function DELETE(_request: NextRequest, ctx: Params) {
  return eliminarDeCatalogo(catalogoAgrupacionesEstacionalidad, ctx);
}
