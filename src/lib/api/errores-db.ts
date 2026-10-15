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
/** `lock_not_available`: el lock de aviso del cálculo de M6 (`calculo_en_curso`). */
export const CODIGO_BLOQUEO = "55P03";
export const MENSAJE_CALCULO_EN_CURSO = "Hay otro cálculo de curvas en curso. Espera a que termine y vuelve a intentarlo.";

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
  // Géneros de una agrupación (único por pareja agrupación + género).
  ["agrupacion_estacionalidad_genero_par", "Esa agrupación ya incluye ese género."],
  // M4.
  ["tiendas_codigo", "Ya existe una tienda con ese código."],
  ["tiendas_nombre", "Ya existe una tienda con ese nombre."],
  // M1b. Solo alcanzable si alguien inserta a mano: la API usa `upsert`.
  ["responsables_genero_mundo_par", "Esa combinación género-mundo ya tiene responsable."],
  // M5. La API de cargas ya las traduce con más detalle (quién y desde cuándo); esto es la red de seguridad.
  ["cargas_periodo_en_curso_uniq", "Ya hay una carga en curso de ese mes."],
  ["cargas_periodo_publicada_uniq", "Ese mes ya tiene una carga publicada."],
  // M5b. La API de mapeos ya lo anticipa con el mapeo que choca; esto es la red de seguridad (carrera entre dos usuarios).
  ["mapeos_combinacion_origen_uniq", "Ese origen ya tiene un mapeo."],
  // M5c. La API ya lo anticipa solo para tiendas; el repetido lo detecta el único.
  ["ubicaciones_ignoradas_nombre", "Esa ubicación ya está en la lista."],
  // M2b. La API lo anticipa con el par que choca; esto es la red de seguridad (carrera entre dos usuarios).
  ["marca_gml_especial_par", "Esa marca ya es relevante en ese GML."],
  // M6 paso 2. La API lo anticipa con el reemplazo en dos pasos; esto es la red de seguridad (carrera entre dos planners).
  ["curvas_estacionalidad_vigente_uniq", "Esa agrupación ya tiene una curva vigente; vuelve a cargar."],
  ["curvas_estacionalidad_agrupacion_version_key", "Esa agrupación ya tiene una curva con esa versión; vuelve a cargar."],
  ["corridas_estacionalidad_referencia_uniq", "Ya hay otra corrida de referencia; vuelve a cargar."],
  // M7. Los dos primeros los anticipa la API con el nombre que choca; el resto es la red de seguridad (carrera entre dos planners).
  ["proyecciones_nombre_anio_uniq", "Ya existe una proyección con ese nombre para ese año."],
  ["proyecciones_cerrada_anio_uniq", "Ese año ya tiene una proyección cerrada; vuelve a cargar."],
  ["proyeccion_filas_proyeccion_clave_key", "Esa fila ya existe en la proyección; vuelve a cargar."],
  ["proyeccion_fila_anios_fila_anio_key", "Ese año ya existe en la fila; vuelve a cargar."],
  ["proyeccion_tiendas_proyeccion_tienda_anio_key", "Esa tienda ya está en la proyección para ese año; vuelve a cargar."],
  ["factores_volumen_atipico_anio_temporada_key", "Ya existe un factor para ese año y temporada."],
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
  // M5b.
  ["mapeos_combinacion_nota_len", "La nota no puede superar 200 caracteres."],
  ["mapeos_combinacion_terna_no_vacia", "Un origen necesita al menos género, mundo o línea."],
  ["mapeos_combinacion_origen_equivalencia", "La equivalencia de origen no puede estar vacía ni superar 120 caracteres."],
  ["mapeos_combinacion_origen_", "Género, mundo y línea de origen no pueden superar 120 caracteres."],
  // M5c. Los dos checks de las ubicaciones ignoradas (el esquema zod los atrapa antes; esto es la red de seguridad).
  ["ubicaciones_ignoradas_nombre_len", "El nombre debe tener entre 1 y 120 caracteres."],
  ["ubicaciones_ignoradas_nota_len", "La nota no puede superar 200 caracteres."],
  // M2b.
  ["genero_mundo_linea_nivel", "El nivel de planificación debe ser GML o GMLE."],
  ["marcas_modalidad_valor", "La modalidad debe ser por_gml o barrido."],
  ["marcas_modalidad_sin_tratamiento", "La modalidad solo se guarda si la marca tiene tratamiento especial."],
  ["marcas_conjunto_no_propio", "Una marca no puede ser su propio conjunto."],
  ["marca_gml_especial_nota_len", "La nota no puede superar 200 caracteres."],
  // M6 paso 1. La API ya los valida con zod; esto es la red de seguridad.
  ["agrupaciones_estacionalidad_temporada", "La temporada debe ser invierno, verano o todo_el_ano."],
  ["periodos_atipicos_desde_dia1", "El mes inicial debe ser el primer día del mes."],
  ["periodos_atipicos_hasta_dia1", "El mes final debe ser el primer día del mes."],
  ["periodos_atipicos_rango", "El mes final no puede ser anterior al inicial."],
  ["periodos_atipicos_motivo_len", "El motivo debe tener entre 1 y 120 caracteres."],
  ["periodos_atipicos_descripcion_len", "La descripción no puede superar 500 caracteres."],
  ["periodos_atipicos_alcance", "El alcance debe ser invierno o todas."],
  ["periodos_atipicos_temporadas", "Elige de una a tres temporadas entre invierno, verano y toda temporada."],
  // M6 paso 2.
  ["curvas_estacionalidad_suma", "Las doce participaciones de la curva deben sumar 1."],
  ["curvas_estacionalidad_nota_len", "La nota no puede superar 300 caracteres."],
  ["curvas_estacionalidad_", "La curva no cumple las reglas de la base (participaciones entre 0 y 1, estado, origen o medida)."],
  ["corridas_estacionalidad_resultado_size", "El resultado de la corrida es demasiado grande para guardarse."],
  // M7 (0018). La API ya valida con zod; esto es la red de seguridad.
  ["tiendas_referencia_no_propia", "Una tienda no puede ser su propia referencia."],
  ["proyecciones_nombre_len", "El nombre debe tener entre 1 y 80 caracteres."],
  ["proyecciones_hasta_periodo", "«Datos hasta» debe ser un mes del año en curso."],
  ["proyecciones_anio", "El año de la proyección no es válido."],
  ["proyecciones_nota_len", "La nota no puede superar 500 caracteres."],
  ["proyecciones_", "La proyección no cumple las reglas de la base (estado, parámetros o resumen)."],
  ["proyeccion_fila_anios_crecimiento", "El crecimiento debe estar entre −95 % y 500 %."],
  ["proyeccion_fila_anios_decidido", "El total decidido no puede ser negativo."],
  ["proyeccion_fila_anios_decision", "Una decisión necesita su origen (y sin decisión no hay origen)."],
  ["proyeccion_fila_anios_vendido", "Lo vendido no puede ser negativo."],
  ["proyeccion_fila_anios_propuesto", "La propuesta no puede ser negativa."],
  ["proyeccion_fila_anios_nota_len", "La nota no puede superar 300 caracteres."],
  ["proyeccion_fila_anios_meses", "El reparto mensual debe tener doce meses."],
  ["proyeccion_fila_anios_origen_meses", "El origen de cada mes debe ser real o proyectado, doce valores."],
  ["proyeccion_fila_anios_subbloque", "El subbloque solo existe en las tiendas nuevas."],
  ["proyeccion_fila_anios_", "El registro del año no cumple las reglas de la base."],
  ["proyeccion_filas_nivel_equivalencia", "Una fila de nodo GMLE lleva equivalencia y una de nodo GML no."],
  ["proyeccion_filas_", "La fila de la proyección no cumple las reglas de la base."],
  ["proyeccion_tiendas_rampa", "La rampa necesita entre 1 y 6 valores."],
  ["proyeccion_tiendas_nota_len", "La nota no puede superar 300 caracteres."],
  ["proyeccion_tiendas_decision", "Una decisión necesita su origen (y sin decisión no hay origen)."],
  ["proyeccion_tiendas_origen", "El origen de la decisión de una tienda debe ser propuesta o manual."],
  ["proyeccion_tiendas_", "La tienda de la proyección no cumple las reglas de la base."],
  ["factores_volumen_atipico_ratio_aplicado", "El factor debe ser mayor que 0,05 y como máximo 3."],
  ["factores_volumen_atipico_nota_len", "La nota no puede superar 200 caracteres."],
  ["factores_volumen_atipico_", "El factor no cumple las reglas de la base."],
  // Genéricos: cubren `*_codigo_len_check` y `*_nombre_len_check` de todas las tablas, incluidas tiendas.
  ["_codigo_len", "El código debe tener entre 1 y 40 caracteres."],
  ["_nombre_len", "El nombre debe tener entre 1 y 120 caracteres."],
];

const FK_GENERICA = "No se puede eliminar: tiene registros asociados. Desactívalo.";

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
  // Géneros de una agrupación. La FK al género es `restrict`: borrar un género
  // con agrupaciones asignadas se rechaza. La FK a la agrupación es `cascade`
  // (los vínculos se van con ella), así que su mensaje de "eliminar" no debería
  // verse nunca; queda por si el modelo cambia.
  [
    "agrupacion_estacionalidad_genero_genero_id_fkey",
    {
      eliminar:
        "No se puede eliminar el género: tiene agrupaciones de estacionalidad asignadas. Quítalo de ellas o desactívalo.",
      asignar: { status: 404, mensaje: "Género no encontrado." },
    },
  ],
  [
    "agrupacion_estacionalidad_genero_agrupacion_id_fkey",
    {
      eliminar: "No se puede eliminar la agrupación de estacionalidad: tiene géneros asignados.",
      asignar: { status: 404, mensaje: "Agrupación de estacionalidad no encontrada." },
    },
  ],
  // M1b. Géneros y mundos son `restrict`: las asignaciones cuentan como hijos
  // (el handler de catálogos solo cuenta nodos, así que esta FK es la red de
  // seguridad de eliminar un género o mundo sin nodos pero con responsables).
  [
    "responsables_genero_mundo_genero_id_fkey",
    {
      eliminar: "No se puede eliminar el género: tiene responsables asignados. Quítalos o desactívalo.",
      asignar: { status: 404, mensaje: "Género no encontrado." },
    },
  ],
  [
    "responsables_genero_mundo_mundo_id_fkey",
    {
      eliminar: "No se puede eliminar el mundo: tiene responsables asignados. Quítalos o desactívalo.",
      asignar: { status: 404, mensaje: "Mundo no encontrado." },
    },
  ],
  // `perfil_id` es `cascade`: borrar un perfil nunca viola esta FK, así que
  // `eliminar` queda con el texto genérico.
  [
    "responsables_genero_mundo_perfil_id_fkey",
    {
      eliminar: FK_GENERICA,
      asignar: { status: 404, mensaje: "Usuario no encontrado." },
    },
  ],
  // M5. Los hechos de venta y stock cuelgan de marca, tienda, equivalencia y
  // agrupación de talla con `restrict`: eliminar con histórico se rechaza (los
  // handlers lo anticipan con el conteo; esto es la red de seguridad). En la
  // rama `asignar` (una tanda apunta a un id que ya no existe) responde 404.
  [
    "venta_stock_mensual_marca_id_fkey",
    {
      eliminar: "No se puede eliminar: tiene venta o stock cargados. Desactívala.",
      asignar: { status: 404, mensaje: "Marca no encontrada." },
    },
  ],
  [
    "venta_stock_mensual_tienda_id_fkey",
    {
      eliminar: "No se puede eliminar: tiene venta o stock cargados. Desactívala.",
      asignar: { status: 404, mensaje: "Tienda no encontrada." },
    },
  ],
  [
    "venta_stock_mensual_equivalencia_id_fkey",
    {
      eliminar: "No se puede eliminar: tiene venta o stock cargados. Desactívala.",
      asignar: { status: 404, mensaje: "Equivalencia no encontrada." },
    },
  ],
  [
    "venta_stock_mensual_agrupacion_talla_id_fkey",
    {
      eliminar: "No se puede eliminar: tiene venta o stock cargados. Desactívala.",
      asignar: { status: 404, mensaje: "Agrupación de talla no encontrada." },
    },
  ],
  // M5b. El destino de un mapeo (`cascade`: eliminar la equivalencia borra sus mapeos, así que
  // `eliminar` no debería verse). Al guardar, un destino que ya no existe responde 404.
  [
    "mapeos_combinacion_equivalencia_id_fkey",
    {
      eliminar: FK_GENERICA,
      asignar: { status: 404, mensaje: "Equivalencia no encontrada." },
    },
  ],
  // M2b. Un nodo con marcas relevantes no se elimina (`restrict`); la marca arrastra sus GML (`cascade`, así que
  // su rama `eliminar` no debería verse). La cabeza de un conjunto con miembros tampoco se elimina (`restrict`).
  [
    "marca_gml_especial_gml_id_fkey",
    {
      eliminar: "No se puede eliminar el nodo: tiene marcas relevantes asignadas. Quítalas o desactívalo.",
      asignar: { status: 404, mensaje: "Nodo género-mundo-línea no encontrado." },
    },
  ],
  [
    "marca_gml_especial_marca_id_fkey",
    {
      eliminar: FK_GENERICA,
      asignar: { status: 404, mensaje: "Marca no encontrada." },
    },
  ],
  [
    "marcas_conjunto_marca_id_fkey",
    {
      eliminar: "No se puede eliminar la marca: es cabeza de un conjunto con marcas. Quítalas o desactívala.",
      asignar: { status: 404, mensaje: "Marca cabeza no encontrada." },
    },
  ],
  // M6 paso 2. Las curvas y las corridas nunca se eliminan (cambian de estado): la agrupación con curvas no se borra.
  [
    "curvas_estacionalidad_agrupacion_fkey",
    {
      eliminar: "No se puede eliminar la agrupación de estacionalidad: tiene curvas. Desactívala.",
      asignar: { status: 404, mensaje: "Agrupación de estacionalidad no encontrada." },
    },
  ],
  [
    "curvas_estacionalidad_corrida_id_fkey",
    {
      eliminar: "No se puede eliminar la corrida: hay curvas aprobadas a partir de ella.",
      asignar: { status: 404, mensaje: "Corrida no encontrada." },
    },
  ],
  // M7. Una tienda que es referente de otra, o que está en una proyección, no se elimina (`restrict`): se cambia la referencia o se desactiva.
  [
    "tiendas_tienda_referencia_id_fkey",
    {
      eliminar: "La tienda es la referencia de otra tienda: cambia esa referencia antes de eliminarla, o desactívala.",
      asignar: { status: 404, mensaje: "Tienda de referencia no encontrada." },
    },
  ],
  [
    "proyeccion_filas_tienda_id_fkey",
    {
      eliminar: "La tienda está en una proyección: no se puede eliminar. Desactívala.",
      asignar: { status: 404, mensaje: "Tienda no encontrada." },
    },
  ],
  [
    "proyeccion_tiendas_tienda_id_fkey",
    {
      eliminar: "La tienda está en una proyección: no se puede eliminar. Desactívala.",
      asignar: { status: 404, mensaje: "Tienda no encontrada." },
    },
  ],
  // Las filas de una proyección cuelgan de nodo, equivalencia, agrupación de marca y de estacionalidad con `restrict`.
  [
    "proyeccion_filas_gml_id_fkey",
    {
      eliminar: "No se puede eliminar el nodo: está en una proyección. Desactívalo.",
      asignar: { status: 404, mensaje: "Nodo género-mundo-línea no encontrado." },
    },
  ],
  [
    "proyeccion_filas_equivalencia_id_fkey",
    {
      eliminar: "No se puede eliminar la equivalencia: está en una proyección. Desactívala.",
      asignar: { status: 404, mensaje: "Equivalencia no encontrada." },
    },
  ],
  [
    "proyeccion_filas_agrupacion_marca_id_fkey",
    {
      eliminar: "No se puede eliminar la agrupación de marca: está en una proyección. Desactívala.",
      asignar: { status: 404, mensaje: "Agrupación de marca no encontrada." },
    },
  ],
  [
    "proyeccion_filas_agrupacion_estacionalidad_id_fkey",
    {
      eliminar: "No se puede eliminar la agrupación de estacionalidad: está en una proyección. Desactívala.",
      asignar: { status: 404, mensaje: "Agrupación de estacionalidad no encontrada." },
    },
  ],
  // Las cargas nunca se eliminan (cambian de estado); la FK es la red de seguridad.
  [
    "venta_stock_mensual_carga_id_fkey",
    {
      eliminar: "No se puede eliminar la carga: todavía tiene filas de venta y stock.",
      asignar: { status: 404, mensaje: "Carga no encontrada." },
    },
  ],
];

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

  if (code === CODIGO_BLOQUEO || /calculo_en_curso/.test(message)) {
    return { status: 409, mensaje: MENSAJE_CALCULO_EN_CURSO };
  }

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
