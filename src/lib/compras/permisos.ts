import type { Rol } from "@/lib/auth/roles";
import { transicion } from "./reglas";
import type { EstadoCompra } from "./tipos";
import type { CompraApi } from "./tipos-api";

/**
 * Permisos de las compras (ficha 08, §5.10, decisión 28 y sección «Guards»). Pura.
 *
 * Decisión 28: NO hay propiedad. Cualquier usuario con escritura edita, recibe o cancela CUALQUIER compra: `puede` mira el ESTADO de
 * la compra y el ROL de quien pregunta, nunca quién la creó (no existe `403 no_es_tuya`). Quién tiene escritura depende de la fase:
 *  - M8 (`0.13.0` y `0.13.1`): solo `admin` y `planner` (la ruta usa `requirePlanner`); el comprador solo lee.
 *  - M9a: también el comprador (`requireUser`), salvo aplicar reparto, carga inicial y desactivar proveedores (siempre planner).
 * El guard de la ruta sigue siendo la barrera real; `puede` sirve para que la pantalla oculte lo que daría `403` o `409`.
 */

export type FaseEscritura = "m8" | "m9a";

/** `true` si el rol puede escribir compras en esa fase. */
export function puedeEscribirCompras(rol: Rol, fase: FaseEscritura = "m8"): boolean {
  if (rol === "admin" || rol === "planner") return true;
  return fase === "m9a";
}

/** Aplicar reparto, carga inicial, parámetros y desactivar proveedores: siempre planner o admin. */
export const esPlanner = (rol: Rol): boolean => rol === "admin" || rol === "planner";

/** `POST /api/compras/importar`: con `carga_inicial` solo planner/admin (en `0.13.0` es la única forma de importar). */
export function puedeImportar(rol: Rol, cargaInicial: boolean, fase: FaseEscritura = "m8"): boolean {
  if (cargaInicial) return esPlanner(rol);
  return puedeEscribirCompras(rol, fase);
}

/** Funciones de escritura que ya existen: en `0.13.0` solo recibir y cancelar (editar, confirmar y reparto llegan en `0.13.1`). */
export type FuncionesDisponibles = { editar: boolean; confirmar: boolean; aplicar_reparto: boolean };
export const FUNCIONES_DISPONIBLES_0_13_0: FuncionesDisponibles = { editar: false, confirmar: false, aplicar_reparto: false };
export const FUNCIONES_DISPONIBLES_0_13_1: FuncionesDisponibles = { editar: true, confirmar: true, aplicar_reparto: true };

/**
 * Qué puede hacer `usuario` sobre una compra (`CompraApi.puede`): el estado manda (`transicion`) y el rol y la fase lo limitan.
 * `aplicar_reparto` solo si la compra está `confirmada` (hay entregas por repartir) y el rol es planner o admin.
 */
export function puede(
  compra: { estado: EstadoCompra; cancelada_at: string | null; unidades_recibidas?: number; lineas_activas?: number },
  usuario: { rol: Rol },
  opciones: { fase?: FaseEscritura; disponibles?: FuncionesDisponibles } = {},
): CompraApi["puede"] {
  const escribe = puedeEscribirCompras(usuario.rol, opciones.fase ?? "m8");
  const disp = opciones.disponibles ?? FUNCIONES_DISPONIBLES_0_13_0;
  const ctx = { lineas_activas: compra.lineas_activas ?? 1, unidades_recibidas: compra.unidades_recibidas ?? 0 };
  const admite = (accion: Parameters<typeof transicion>[1]) => transicion(compra, accion, ctx).ok;
  return {
    editar: escribe && disp.editar && admite("editar"),
    confirmar: escribe && disp.confirmar && admite("confirmar"),
    recibir: escribe && admite("recibir"),
    cancelar: escribe && admite("cancelar"),
    aplicar_reparto: esPlanner(usuario.rol) && disp.aplicar_reparto && compra.estado === "confirmada",
  };
}

// ─── «Mis líneas»: un filtro, nunca un permiso ───

export type CombinacionGeneroMundo = { genero_id: string; mundo_id: string };
export type NodoGeneroMundo = { genero_id: string; mundo_id: string };

const clave = (c: CombinacionGeneroMundo) => `${c.genero_id}|${c.mundo_id}`;

/**
 * Una línea es mía si su GML pertenece a una combinación género × mundo de la que soy responsable (M1b); un lote (sin GML propio) es
 * mío si alguno de los GML de su reparto lo es. `nodos` traduce `genero_mundo_linea_id` → género y mundo.
 */
export function lineaEsMia(
  linea: { genero_mundo_linea_id: string | null; reparto_gml_ids?: readonly string[] },
  combinaciones: readonly CombinacionGeneroMundo[],
  nodos: ReadonlyMap<string, NodoGeneroMundo>,
): boolean {
  if (combinaciones.length === 0) return false;
  const mias = new Set(combinaciones.map(clave));
  const ids = linea.genero_mundo_linea_id !== null ? [linea.genero_mundo_linea_id] : (linea.reparto_gml_ids ?? []);
  return ids.some((id) => {
    const n = nodos.get(id);
    return n !== undefined && mias.has(clave(n));
  });
}

/** Una compra es mía si alguna de sus líneas lo es. */
export function compraEsMia(
  lineas: readonly { genero_mundo_linea_id: string | null; reparto_gml_ids?: readonly string[] }[],
  combinaciones: readonly CombinacionGeneroMundo[],
  nodos: ReadonlyMap<string, NodoGeneroMundo>,
): boolean {
  return lineas.some((l) => lineaEsMia(l, combinaciones, nodos));
}
