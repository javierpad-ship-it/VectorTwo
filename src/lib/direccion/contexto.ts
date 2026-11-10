import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { traducirErrorDb } from "@/lib/api/errores-db";
import { aPeriodoApi, leerAgrupacionesActivasBasicas, leerPeriodos } from "@/lib/curvas/consultas";
import { huellaCargas } from "@/lib/curvas/huellas";
import { TIPO_TIENDA } from "@/lib/curvas/red";
import { leerFactoresDb, leerGenerosMundos, type ProyeccionDb } from "@/lib/proyeccion/consultas";
import { cargarCatalogo, leerHuellasComposicion } from "@/lib/proyeccion/contexto";
import { generosDeMatriz } from "@/lib/proyeccion/crecimientos";
import { estadosFactoresDeY } from "@/lib/proyeccion/desactualizado";
import { falla, listo, type Salida } from "@/lib/proyeccion/servicio-base";
import type { ResumenProyeccion } from "@/lib/proyeccion/tipos-api";
import type { Database } from "@/lib/supabase/database.types";
import { leerTiendas } from "@/lib/tiendas/consultas";
import type { FactorProvisional } from "./alertas";
import { unidadDeMarca } from "@/lib/marcas/conjuntos/reglas";
import { leerMarcas } from "@/lib/marcas/consultas";
import type { MaestrosTablero } from "./tablero";

/**
 * Lo que el tablero de dirección lee de los maestros y de los factores del Niño (M2, M3, M4 y M6), con las consultas de esos módulos y sin
 * modificarlas. Solo servidor. No carga el contexto de cálculo de M7 (eso es de `cierre.ts`, solo para `GET /api/direccion/bloqueos`).
 */

type Db = SupabaseClient<Database>;

export type MaestrosDireccion = {
  /** Géneros activos, en el orden del catálogo; `es_resto`: fuera de los géneros de la matriz (HOMBRE y MUJER). */
  generos: { id: string; nombre: string; es_resto: boolean }[];
  mundos: { id: string; nombre: string }[];
  /** Nodos de planificación (género × mundo × línea): el «id» de una línea en los filtros es el del nodo. */
  nodos: { id: string; genero_id: string; mundo_id: string; nombre: string; activo: boolean }[];
  /** En el orden de M2. */
  agrupacionesMarca: { id: string; nombre: string }[];
  /** Unidades de marca (la cabeza de cada conjunto, o la marca suelta) con la agrupación de la unidad. */
  unidadesMarca: { id: string; nombre: string; agrupacion_marca_id: string; activa: boolean }[];
  /** Tiendas de tipo Tienda (el CD no entra). */
  tiendas: { id: string; codigo: string; nombre: string; fecha_apertura: string | null; fecha_cierre: string | null; activa: boolean }[];
  /** md5 de lo que mueve la venta agregada: equivalencia → nodo, marca → unidad → agrupación y tienda → tipo. Entra en la clave de la caché de venta. */
  huella: string;
  tablero: MaestrosTablero;
};

const md5 = (texto: string): string => createHash("md5").update(texto).digest("hex");

/** Los maestros se leen como mucho una vez por minuto (son nombres y relaciones que cambian rara vez; su huella invalida la caché de venta). */
export const TTL_MAESTROS_MS = 60_000;
let guardado: { valor: MaestrosDireccion; expira: number } | null = null;

/** Solo para pruebas. */
export const vaciarCacheMaestros = (): void => {
  guardado = null;
};

export async function leerMaestros(d: Db): Promise<Salida<MaestrosDireccion>> {
  const ahora = Date.now();
  if (guardado && guardado.expira > ahora) return listo(guardado.valor);
  const [cat, orden, tiendas, marcas] = await Promise.all([cargarCatalogo(d), leerGenerosMundos(d), leerTiendas(d, { soloActivas: false }), leerMarcas(d)]);
  if (cat.respuesta) return falla(cat.respuesta);
  const fallo = orden.error ?? tiendas.error ?? marcas.error;
  if (fallo) return falla(traducirErrorDb(fallo, "dirección: leer los maestros"));

  const matriz = new Set(generosDeMatriz(orden.generos).map((g) => g.id));
  const generos = orden.generos.filter((g) => g.activo).map((g) => ({ id: g.id, nombre: g.nombre, es_resto: !matriz.has(g.id) }));
  const mundos = orden.mundos.filter((m) => m.activo).map((m) => ({ id: m.id, nombre: m.nombre }));
  const nombreGenero = new Map(orden.generos.map((g) => [g.id, g.nombre]));
  const nombreMundo = new Map(orden.mundos.map((m) => [m.id, m.nombre]));
  const activoNodo = new Map(cat.data.nodosDb.map((n) => [n.id, n.activo]));
  const nodos = [...cat.data.catalogo.nodos]
    .map(([id, n]) => ({ id, genero_id: n.genero_id, mundo_id: n.mundo_id, nombre: n.linea, activo: activoNodo.get(id) ?? true }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es") || a.id.localeCompare(b.id));
  const ordenAm = cat.data.catalogo.ordenAgrupacionesMarca ?? new Map<string, number>();
  const agrupacionesMarca = [...cat.data.catalogo.agrupacionesMarca]
    .map(([id, nombre]) => ({ id, nombre }))
    .sort((a, b) => (ordenAm.get(a.id) ?? 0) - (ordenAm.get(b.id) ?? 0) || a.nombre.localeCompare(b.nombre, "es") || a.id.localeCompare(b.id));

  // La unidad de cada marca con la regla de M2 (`unidadDeMarca`: la misma definición que la vista de unidades de marca que usan las funciones SQL).
  const marcaPorId = new Map(marcas.data.map((m) => [m.id, m]));
  const unidades = marcas.data.map((m) => ({ marca_id: m.id, unidad_marca_id: unidadDeMarca(m, marcas.data).unidad_marca_id }));
  const miembros = new Map<string, string[]>();
  for (const u of unidades) miembros.set(u.unidad_marca_id, [...(miembros.get(u.unidad_marca_id) ?? []), u.marca_id]);
  const unidadesMarca = [...miembros]
    .flatMap(([id, ids]) => {
      const cabeza = marcaPorId.get(id);
      if (!cabeza) return [];
      return [{ id, nombre: cabeza.nombre, agrupacion_marca_id: cabeza.agrupacion_marca_id, activa: ids.some((m) => marcaPorId.get(m)?.activo === true) }];
    })
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es") || a.id.localeCompare(b.id));

  const deTienda = tiendas.data.filter((t) => t.tipo === TIPO_TIENDA);
  const listaTiendas = deTienda.map((t) => ({ id: t.id, codigo: t.codigo, nombre: t.nombre, fecha_apertura: t.fecha_apertura, fecha_cierre: t.fecha_cierre, activa: t.activo }));

  const lineas: string[] = [];
  for (const q of [...cat.data.equivalencias].sort((a, b) => a.id.localeCompare(b.id))) lineas.push(`e|${q.id}|${q.genero_mundo_linea_id}`);
  for (const n of [...cat.data.nodosDb].sort((a, b) => a.id.localeCompare(b.id))) lineas.push(`n|${n.id}|${n.genero_id}|${n.mundo_id}|${n.nivel_planificacion}`);
  for (const u of [...unidades].sort((a, b) => a.marca_id.localeCompare(b.marca_id))) lineas.push(`u|${u.marca_id}|${u.unidad_marca_id}|${marcaPorId.get(u.unidad_marca_id)?.agrupacion_marca_id ?? ""}`);
  for (const t of [...tiendas.data].sort((a, b) => a.id.localeCompare(b.id))) lineas.push(`t|${t.id}|${t.tipo}`);

  const valor: MaestrosDireccion = {
    generos,
    mundos,
    nodos,
    agrupacionesMarca,
    unidadesMarca,
    tiendas: listaTiendas,
    huella: md5(lineas.join("\n")),
    tablero: {
      tiendas: new Map(listaTiendas.map((t) => [t.id, t])),
      generosMatriz: matriz,
      nombres: {
        genero: nombreGenero,
        mundo: nombreMundo,
        linea: new Map(nodos.map((n) => [n.id, `${nombreGenero.get(n.genero_id) ?? "—"} · ${nombreMundo.get(n.mundo_id) ?? "—"} · ${n.nombre}`])),
        agrupacionMarca: new Map(agrupacionesMarca.map((a) => [a.id, a.nombre])),
        marca: new Map(unidadesMarca.map((u) => [u.id, u.nombre])),
      },
    },
  };
  guardado = { valor, expira: ahora + TTL_MAESTROS_MS };
  return listo(valor);
}

export type NinoDeHoy = {
  /** Factores del Niño del año en curso cuyo estado NO es `ok` (`estadoFactorY` de M7, sin modificar), solo de las temporadas que entran en las filas. */
  factoresProvisionales: FactorProvisional[];
  /** Años con algún periodo atípico activo (`periodos_atipicos`): se rotulan «Niño» (D14). */
  aniosNino: number[];
};

/**
 * Estado de los factores del Niño del año en curso y años del Niño. Cinco lecturas pequeñas (factores, periodos, agrupaciones activas y la huella
 * de composición de cada temporada): no es el contexto de cálculo de M7. `cargas` son las publicadas (`aaaa-mm → carga_id`).
 */
export async function leerNinoDeHoy(d: Db, p: Pick<ProyeccionDb, "anio_en_curso" | "resumen">, cargas: Readonly<Record<string, string>>, hoyLima: string): Promise<Salida<NinoDeHoy>> {
  const [factores, periodos, agrupaciones, composicion] = await Promise.all([leerFactoresDb(d), leerPeriodos(d, { soloActivos: true }), leerAgrupacionesActivasBasicas(d), leerHuellasComposicion(d)]);
  const fallo = factores.error ?? periodos.error ?? agrupaciones.error;
  if (fallo) return falla(traducirErrorDb(fallo, "dirección: leer los factores del Niño"));
  if (composicion.respuesta) return falla(composicion.respuesta);
  const periodosApi = periodos.data.map(aPeriodoApi);
  const resumen = p.resumen as unknown as Partial<ResumenProyeccion> | null;
  const enFilas = resumen?.temporadas_filas ? new Set(resumen.temporadas_filas) : null;
  const estados = estadosFactoresDeY({
    anioEnCurso: p.anio_en_curso,
    factores: factores.data,
    hoy: { huella_cargas: huellaCargas(cargas), huella_composicion: composicion.data, periodos: periodosApi, publicados: Object.keys(cargas).sort(), hoy_lima: hoyLima },
    temporadasActivas: new Set(agrupaciones.data.map((a) => a.temporada)),
  }).filter((x) => enFilas === null || enFilas.has(x.temporada));
  const anios = new Set<number>();
  for (const x of periodosApi) for (let z = Number(x.desde.slice(0, 4)); z <= Number(x.hasta.slice(0, 4)); z++) anios.add(z);
  return listo({
    factoresProvisionales: estados.filter((x) => x.estado !== "ok").map((x) => ({ anio: x.anio, temporada: x.temporada, estado: x.estado, efectivo: x.efectivo, parcial: x.parcial })),
    aniosNino: [...anios].sort((a, b) => a - b),
  });
}
