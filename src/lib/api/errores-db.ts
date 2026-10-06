import type { NextResponse } from "next/server";
import type { PostgrestError } from "@supabase/supabase-js";
import { error } from "./respuestas";

/**
 * Traducción de errores de Postgres que el usuario puede provocar a mensajes
 * de pantalla (docs/modulos/01-arbol-producto.md, "Contratos de API"):
 *
 *   23505 (único)  → 409 "Ya existe …"
 *   23503 (FK)     → 409 "No se puede eliminar: tiene registros asociados."
 *   23514 (check)  → 400
 *   resto          → 500 con un mensaje genérico; el detalle (código, mensaje,
 *                    details, hint) va al log del servidor, nunca a la pantalla
 *
 * `describirErrorDb` es pura (probada en tests/errores-db.test.ts);
 * `traducirErrorDb` la envuelve en la respuesta HTTP y registra el error.
 */

export const CODIGO_UNICO = "23505";
export const CODIGO_FK = "23503";
export const CODIGO_CHECK = "23514";

export type DescripcionErrorDb = { status: number; mensaje: string };

export const MENSAJE_DB_INESPERADO = "Error inesperado en la base de datos.";

/** Qué dice cada índice único cuando se viola. Se busca por prefijo del nombre del índice. */
const MENSAJES_UNICO: ReadonlyArray<readonly [string, string]> = [
  ["generos_codigo", "Ya existe un género con ese código."],
  ["generos_nombre", "Ya existe un género con ese nombre."],
  ["mundos_codigo", "Ya existe un mundo con ese código."],
  ["mundos_nombre", "Ya existe un mundo con ese nombre."],
  ["lineas_codigo", "Ya existe una línea con ese código."],
  ["lineas_nombre", "Ya existe una línea con ese nombre."],
  ["agrupaciones_talla_codigo", "Ya existe una agrupación de talla con ese código."],
  ["agrupaciones_talla_nombre", "Ya existe una agrupación de talla con ese nombre."],
  ["genero_mundo_linea_tripleta", "Esa línea ya existe en ese género y mundo."],
  ["equivalencias_nodo_nombre", "Ya existe una equivalencia con ese nombre en este nodo."],
  ["equivalencias_nodo_codigo", "Ya existe una equivalencia con ese código en este nodo."],
  ["equivalencias_nodo_generica", "Este nodo ya tiene la equivalencia genérica SIN EQUIVALENCIA."],
  ["perfiles_email", "Ya existe un usuario con ese correo."],
  // M2. `agrupaciones_marca_*` va antes que `marcas_*`: el nombre del índice
  // de agrupaciones no contiene "marcas_", pero el orden deja claro el criterio.
  ["agrupaciones_marca_codigo", "Ya existe una agrupación de marca con ese código."],
  ["agrupaciones_marca_nombre", "Ya existe una agrupación de marca con ese nombre."],
  ["marcas_codigo", "Ya existe una marca con ese código."],
  ["marcas_nombre", "Ya existe una marca con ese nombre."],
  // M3.
  ["agrupaciones_estacionalidad_codigo", "Ya existe una agrupación de estacionalidad con ese código."],
  ["agrupaciones_estacionalidad_nombre", "Ya existe una agrupación de estacionalidad con ese nombre."],
  // M4.
  ["tiendas_codigo", "Ya existe una tienda con ese código."],
  ["tiendas_nombre", "Ya existe una tienda con ese nombre."],
];

const MENSAJES_CHECK: ReadonlyArray<readonly [string, string]> = [
  ["lineas_temporada", "La temporada debe ser Verano, Invierno o Todo el año."],
  ["agrupaciones_estacionalidad_descripcion", "La descripción no puede superar 500 caracteres."],
  ["marcas_nota_len", "La nota no puede superar 200 caracteres."],
  ["marcas_nota_sin_tratamiento", "La nota solo se guarda si la marca tiene tratamiento especial."],
  // M4. `tiendas_cierre_requiere_apertura` va antes que `tiendas_cierre_apertura`
  // por claridad; los dos nombres no se contienen entre sí.
  ["tiendas_tipo", "El tipo debe ser Tienda o Centro de Distribución."],
  ["tiendas_cierre_requiere_apertura", "Para registrar un cierre, la tienda necesita fecha de apertura."],
  ["tiendas_cierre_apertura", "La fecha de cierre no puede ser anterior a la de apertura."],
  ["tiendas_venta_no_negativa", "La venta esperada no puede ser negativa."],
  ["tiendas_venta_solo_tienda", "Un centro de distribución no lleva venta esperada."],
  ["tiendas_zona_len", "La zona no puede superar 120 caracteres."],
  ["tiendas_razon_social_len", "La razón social no puede superar 120 caracteres."],
  // Genéricos: cubren `*_codigo_len_check` y `*_nombre_len_check` de todas las tablas, incluidas tiendas.
  ["_codigo_len", "El código debe tener entre 1 y 40 caracteres."],
  ["_nombre_len", "El nombre debe tener entre 1 y 120 caracteres."],
];

/**
 * FKs con mensaje propio. Postgres distingue en el texto quién violó la FK:
 * `update or delete on table "<padre>"` (se intentó borrar el padre con hijos)
 * frente a `insert or update on table "<hijo>"` (el hijo apunta a un padre que
 * no existe). El handler ya anticipa los dos casos; esto es la red de seguridad.
 */
const MENSAJES_FK: ReadonlyArray<readonly [string, { eliminar: string; asignar: DescripcionErrorDb }]> = [
  [
    "marcas_agrupacion_marca_id_fkey",
    {
      eliminar: "No se puede eliminar la agrupación de marca: tiene marcas. Desactívala.",
      asignar: { status: 404, mensaje: "Agrupación de marca no encontrada." },
    },
  ],
  [
    "equivalencias_agrupacion_estacionalidad_id_fkey",
    {
      eliminar: "No se puede eliminar la agrupación de estacionalidad: tiene equivalencias. Desactívala.",
      asignar: { status: 404, mensaje: "Agrupación de estacionalidad no encontrada." },
    },
  ],
];

const FK_GENERICA = "No se puede eliminar: tiene registros asociados. Desactívalo.";

/** Extrae el nombre del índice o constraint del mensaje de Postgres (`… constraint "nombre"`). */
export function nombreConstraint(message: string): string | null {
  const m = /constraint "([^"]+)"/.exec(message);
  return m ? m[1] : null;
}

function buscar(tabla: ReadonlyArray<readonly [string, string]>, texto: string): string | null {
  const encontrado = tabla.find(([prefijo]) => texto.includes(prefijo));
  return encontrado ? encontrado[1] : null;
}

/**
 * Describe un error de Postgres con el status HTTP y el mensaje de pantalla.
 * Pura: solo mira el código SQLSTATE y el texto del mensaje/detalle.
 */
export function describirErrorDb(
  code: string | null | undefined,
  message: string,
  details?: string | null
): DescripcionErrorDb {
  const texto = `${nombreConstraint(message) ?? ""} ${message} ${details ?? ""}`;

  if (code === CODIGO_UNICO) {
    return { status: 409, mensaje: buscar(MENSAJES_UNICO, texto) ?? "Ya existe un registro con esos datos." };
  }
  if (code === CODIGO_FK) {
    const fk = MENSAJES_FK.find(([nombre]) => texto.includes(nombre));
    if (!fk) return { status: 409, mensaje: FK_GENERICA };
    const esAsignacion = /insert or update/i.test(message);
    return esAsignacion ? fk[1].asignar : { status: 409, mensaje: fk[1].eliminar };
  }
  if (code === CODIGO_CHECK) {
    return { status: 400, mensaje: buscar(MENSAJES_CHECK, texto) ?? "Los datos no cumplen las reglas de la base." };
  }
  return { status: 500, mensaje: MENSAJE_DB_INESPERADO };
}

/** Deja el error crudo en el log del servidor (solo los que no sabemos traducir). */
export function registrarErrorDb(err: PostgrestError, contexto?: string): void {
  console.error(`[db]${contexto ? ` ${contexto}` : ""}`, {
    code: err.code,
    message: err.message,
    details: err.details,
    hint: err.hint,
  });
}

/** Respuesta HTTP para un error de PostgREST. Los 500 se registran con su detalle. */
export function traducirErrorDb(err: PostgrestError, contexto?: string): NextResponse {
  const { status, mensaje } = describirErrorDb(err.code, err.message, err.details);
  if (status >= 500) registrarErrorDb(err, contexto);
  return error(mensaje, status);
}
