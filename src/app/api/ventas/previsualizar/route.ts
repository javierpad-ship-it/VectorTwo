import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlanner } from "@/lib/auth/guard";
import { error, leerCuerpo, ok } from "@/lib/api/respuestas";
import { traducirErrorDb } from "@/lib/api/errores-db";
import { cargarEstadoArbol } from "@/lib/arbol/consultas";
import { leerAgrupacionesMarca, leerMarcas } from "@/lib/marcas/consultas";
import { leerTiendas } from "@/lib/tiendas/consultas";
import { hoyLima } from "@/lib/tiendas/estado";
import { previsualizarSchema } from "@/lib/ventas/esquemas";
import {
  aEnCurso,
  aResumenPublicada,
  leerCargasVigentes,
  leerCodigosTalla,
  leerHuellasStock,
  leerMapeosActivos,
} from "@/lib/ventas/consultas";
import { mesAnterior, mesDeHoy, recortarPeriodo } from "@/lib/ventas/periodo";
import { normalizarMarca } from "@/lib/ventas/interpretar";
import { origenDeFila } from "@/lib/ventas/mapeos";
import {
  agrupacionPorDefecto,
  crearResolutorCombinaciones,
  crearResolutorMarcas,
  crearResolutorTiendas,
} from "@/lib/ventas/resolver";
import type { PeriodoPrevisualizado, PrevisualizarRespuesta } from "@/lib/ventas/tipos-api";

/**
 * Previsualización de una carga de venta y stock (`requirePlanner`). No
 * escribe nada: recibe solo los valores DISTINTOS del archivo (tiendas,
 * combinaciones, marcas, periodos) y devuelve cómo se resuelve cada uno contra
 * los maestros, más el estado de cada mes (publicada, en curso), la carga del
 * mes anterior y las huellas de stock de lo ya publicado. Cada lista de la
 * respuesta tiene el mismo orden que la de la petición.
 *
 * M5b. Carga los mapeos activos y los pasa al resolutor de combinaciones: el
 * árbol manda y un mapeo solo entra cuando el árbol no resuelve (una
 * combinación puede volver `ok` con `mapeo`). Los mapeos activos cuyo destino
 * ya no es vigente no se aplican y se listan en `mapeos_no_aplicables`.
 */
export async function POST(request: NextRequest) {
  const { response } = await requirePlanner();
  if (response) return response;

  const { datos, respuesta } = await leerCuerpo(request, previsualizarSchema);
  if (respuesta) return respuesta;

  const db = supabaseAdmin();
  const hoy = hoyLima();

  const [arbol, tiendas, marcas, agrupaciones, talla, cargas, mapeos] = await Promise.all([
    cargarEstadoArbol(db),
    leerTiendas(db, { soloActivas: false }),
    leerMarcas(db),
    leerAgrupacionesMarca(db),
    leerCodigosTalla(db),
    leerCargasVigentes(db),
    leerMapeosActivos(db),
  ]);
  if (arbol.error) return traducirErrorDb(arbol.error, "previsualizar ventas: árbol");
  if (tiendas.error) return traducirErrorDb(tiendas.error, "previsualizar ventas: tiendas");
  if (marcas.error) return traducirErrorDb(marcas.error, "previsualizar ventas: marcas");
  if (agrupaciones.error) return traducirErrorDb(agrupaciones.error, "previsualizar ventas: agrupaciones de marca");
  if (talla.error) return traducirErrorDb(talla.error, "previsualizar ventas: tallas");
  if (cargas.error) return traducirErrorDb(cargas.error, "previsualizar ventas: cargas");
  if (mapeos.error) return traducirErrorDb(mapeos.error, "previsualizar ventas: mapeos");
  if (!talla.data) return error("Faltan las agrupaciones de talla CENTRALES y EXTREMAS en el catálogo.", 500);

  const resolverTienda = crearResolutorTiendas(tiendas.data);
  const resolverCombinacion = crearResolutorCombinaciones(
    arbol.estado,
    mapeos.data.map((m) => ({ id: m.id, origen: origenDeFila(m), equivalencia_id: m.equivalencia_id, activo: m.activo }))
  );
  const resolverMarca = crearResolutorMarcas(marcas.data);

  const publicadas = cargas.data.filter((c) => c.estado === "publicada");
  const enCurso = cargas.data.filter((c) => c.estado === "en_curso");
  const ahora = new Date();

  const periodos: PeriodoPrevisualizado[] = [...new Set(datos.periodos)].sort().map((periodo) => {
    const pub = publicadas.find((c) => recortarPeriodo(c.periodo) === periodo);
    const cur = enCurso.find((c) => recortarPeriodo(c.periodo) === periodo);
    return {
      periodo,
      publicada: pub ? aResumenPublicada(pub) : null,
      en_curso: cur ? aEnCurso(cur, ahora) : null,
    };
  });

  let anterior: PrevisualizarRespuesta["anterior"] = null;
  if (periodos.length > 0) {
    const previo = mesAnterior(periodos[0].periodo);
    const c = publicadas.find((x) => recortarPeriodo(x.periodo) === previo);
    if (c) {
      anterior = {
        periodo: previo,
        filas: c.filas ?? 0,
        venta_soles: c.venta_soles ?? 0,
        stock_valorizado: c.stock_valorizado ?? 0,
      };
    }
  }

  const huellas = await leerHuellasStock(db, publicadas);
  if (huellas.error) return traducirErrorDb(huellas.error, "previsualizar ventas: huellas de stock");

  const activas = agrupaciones.data.filter((a) => a.activo);
  const defecto = agrupacionPorDefecto(agrupaciones.data);

  // Las combinaciones se resuelven antes de armar el cuerpo: `mapeosNoAplicables()` lista los que se cruzaron.
  const combinaciones = datos.combinaciones.map(resolverCombinacion);

  const cuerpo: PrevisualizarRespuesta = {
    hoy,
    mes_actual: mesDeHoy(hoy),
    tiendas: datos.tiendas.map(resolverTienda),
    combinaciones,
    marcas: datos.marcas.map((m) => resolverMarca(normalizarMarca(m))),
    agrupaciones_talla: talla.data,
    agrupaciones_marca: activas.map((a) => ({ id: a.id, codigo: a.codigo, nombre: a.nombre })),
    agrupacion_defecto_id: defecto ? defecto.id : null,
    periodos,
    anterior,
    huellas_stock: huellas.data,
    mapeos_no_aplicables: resolverCombinacion.mapeosNoAplicables(),
  };
  return ok(cuerpo);
}
