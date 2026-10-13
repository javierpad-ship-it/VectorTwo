import type { NextRequest } from "next/server";
import { crearAgrupacion, listarAgrupaciones } from "@/lib/estacionalidad/agrupaciones";

/**
 * Agrupaciones de estacionalidad por `orden, nombre` (`requireUser`;
 * `?incluir_inactivos=1`), cada fila con `equivalencias` y
 * `equivalencias_activas` (las asignadas), `genero_ids` y `generos`
 * (`{ id, codigo, nombre }`, por `orden, nombre` del género) y, desde M6,
 * `temporada`, `temporada_sugerida` (mayoritaria entre las líneas de sus
 * equivalencias activas; empate o sin equivalencias, `todo_el_ano`) y el aviso
 * `temporada_sugerida_distinta`.
 */
export async function GET(request: NextRequest) {
  return listarAgrupaciones(request);
}

/**
 * Crea una agrupación (`requirePlanner`), 201, con `genero_ids` obligatorio
 * (mínimo 1) y `temporada` opcional (por defecto `todo_el_ano`). `400`
 * temporada inválida · `404` género inexistente · `409` género inactivo,
 * nombre o código repetido.
 */
export async function POST(request: NextRequest) {
  return crearAgrupacion(request);
}
