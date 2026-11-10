import { supabaseAdmin } from "@/lib/supabase/admin";
import { errorConCodigo, errorConDetalle } from "@/lib/api/respuestas";
import { CODIGO_LECTURA_LENTA } from "@/lib/api/plazos";
import { leerVersionesDeAnio } from "@/lib/crecimientos/consultas";
import { hastaPorDefecto } from "@/lib/curvas/anios";
import { leerCargasPublicadas } from "@/lib/curvas/consultas";
import { huellaCargas } from "@/lib/curvas/huellas";
import { planHorizonte } from "@/lib/flujo/filas";
import { leerCrecimientos, leerTiendasProyeccion, listarProyeccionesDb, type ProyeccionDb } from "@/lib/proyeccion/consultas";
import { calculoEnCurso, MENSAJE_CALCULO_EN_CURSO_PROYECCION } from "@/lib/proyeccion/reglas";
import { falla, fallaDb, fallaMensaje, listo, parametrosDe, sello, type Db, type Salida } from "@/lib/proyeccion/servicio-base";
import type { ResumenProyeccion } from "@/lib/proyeccion/tipos-api";
import { hoyLima } from "@/lib/tiendas/estado";
import { aAprobacionApi, aBreve, armarResumen, diferenciaConAprobada, estadoBreve, estadoDeProyeccion } from "./aprobacion";
import { CacheDireccion, claveCanonica } from "./cache";
import { MAX_LECTURAS_VENTA, MENSAJE_COLA_LLENA, PLAZO_COLA_VENTA_MS, REINTENTAR_TRAS_S, Semaforo } from "./semaforo";
import {
  leerAprobacionesDeProyeccion,
  leerAprobacionesLigeras,
  leerHuella,
  leerTableroProyeccion,
  leerTableroVenta,
  leerTendenciaVenta,
  leerUltimaAprobada,
  registrarAprobacion,
} from "./consultas";
import { leerMaestros, leerNinoDeHoy, type MaestrosDireccion } from "./contexto";
import type { DeclaradoGm, VersionCrecimiento } from "./crecimientos";
import {
  TEMPORADAS_NOMBRADAS,
  actualParaDiferencia,
  armarParteEntera,
  armarTablero,
  conjuntoTiendas,
  type ComparadaDeTablero,
  type EntradaEntera,
  type FiltrosResueltos,
  type ProyeccionDeTablero,
} from "./tablero";
import { mesAnio } from "./textos";
import {
  MAX_BYTES_RESUMEN,
  type AprobacionApi,
  type AprobacionesApi,
  type AprobarCuerpoApi,
  type EstadoDireccionApi,
  type FilaAprobacionSql,
  type FiltrosTableroApi,
  type OpcionesTableroApi,
  type ParamsTableroProyeccionSql,
  type ParamsTableroVentaSql,
  type TableroApi,
  type TableroProyeccionSql,
  type TableroVentaSql,
  type TableroVentaTendenciaSql,
} from "./tipos-api";
import type { EstadoQuery } from "./esquemas";

/**
 * Servicio del tablero de aprobación de dirección (ficha 14, §3). Cada operación abre su cliente con `supabaseAdmin()` (los handlers nunca tocan la
 * base) y devuelve `{ data, respuesta }`: los datos o la respuesta HTTP con la que cortar. Solo servidor. Todo es lectura salvo `aprobar`, que
 * registra una fila de `aprobaciones_direccion` a través de la función de la base.
 */

const db = (): Db => supabaseAdmin();

export const MENSAJE_NO_ENCONTRADA = "Proyección no encontrada.";
export const MENSAJE_COMPARADA_NO_ENCONTRADA = "La proyección para comparar no existe.";
export const MENSAJE_SIN_CALCULAR = "Calcula la proyección para verla en el tablero.";
export const MENSAJE_SIN_PROYECCION = "Todavía no hay ninguna proyección para mostrar: crea y calcula una en Proyección de unidades.";
export const MENSAJE_HUELLA_DISTINTA = "La proyección cambió mientras la mirabas: vuelve a cargar el tablero.";
export const MENSAJE_ARCHIVADA = "La proyección está archivada: no se puede aprobar.";
export const MENSAJE_MARCA_FUERA = "La marca elegida no es de ninguna de las agrupaciones de marca elegidas.";

// ─── Cachés (por contenido; ver `cache.ts`) ───

const cacheProyeccion = new CacheDireccion<TableroProyeccionSql>();
const cacheVenta = new CacheDireccion<TableroVentaSql>();
const cacheTendencia = new CacheDireccion<TableroVentaTendenciaSql>();

/**
 * T3 (seguridad): a lo sumo `MAX_LECTURAS_VENTA` lecturas de `tablero_venta` a la vez en el proceso (venta del recorte, venta sin filtros y
 * tendencia). El permiso se pide DENTRO del cargador de la caché: las peticiones con la misma clave comparten el vuelo único y cuentan una vez, y lo
 * que sale de la caché no pide permiso.
 */
export const semaforoVenta = new Semaforo(MAX_LECTURAS_VENTA);

/** Marca de «la cola no dejó entrar a tiempo» (no es un error de la base). */
const COLA_LLENA = { cola_llena: true } as const;
const esColaLlena = (e: unknown): e is typeof COLA_LLENA => e === COLA_LLENA;

/** Una lectura de venta con permiso del semáforo; si no hay cupo a tiempo, `error = COLA_LLENA` sin llamar a la base. */
async function conCupoVenta<T, E>(leer: () => PromiseLike<{ data: T | null; error: E | null }>): Promise<{ data: T | null; error: E | typeof COLA_LLENA | null }> {
  const r = await semaforoVenta.conPermiso(PLAZO_COLA_VENTA_MS, leer);
  return r.cupo ? r.valor : { data: null, error: COLA_LLENA };
}

/** `503 lectura_lenta` con `Retry-After`: la misma respuesta que una lectura que se cortó por tiempo, para que la pantalla ofrezca reintentar. */
export function respuestaColaLlena() {
  const r = errorConCodigo(MENSAJE_COLA_LLENA, 503, CODIGO_LECTURA_LENTA);
  r.headers.set("Retry-After", String(REINTENTAR_TRAS_S));
  return r;
}

/** Solo para pruebas. */
export function vaciarCachesDireccion(): void {
  cacheProyeccion.vaciar();
  cacheVenta.vaciar();
  cacheTendencia.vaciar();
  semaforoVenta.reiniciar();
}

// ─── Proyecciones y la que usa Compras ───

const estadoDe = (p: ProyeccionDb): "en_trabajo" | "cerrada" | "archivada" => (p.estado === "cerrada" || p.estado === "archivada" ? p.estado : "en_trabajo");

function aProyeccion(p: ProyeccionDb, usaComprasId: string | null): ProyeccionDeTablero {
  const parametros = parametrosDe(p.parametros);
  const resumen = p.resumen as unknown as (Partial<ResumenProyeccion> & { version_metodo?: number }) | null;
  return {
    id: p.id,
    nombre: p.nombre,
    estado: estadoDe(p),
    anio_en_curso: p.anio_en_curso,
    anio_siguiente: p.anio_en_curso + 1,
    hasta_periodo: p.hasta_periodo.slice(0, 7),
    k: Number(p.hasta_periodo.slice(5, 7)),
    version_metodo: typeof resumen?.version_metodo === "number" ? resumen.version_metodo : null,
    cerrada_at: p.cerrada_at,
    cerrada_por_nombre: p.cerrada_por_nombre,
    usa_compras: p.id === usaComprasId,
    bloques: parametros.bloques,
    objetivo_pct: typeof parametros.crecimiento_objetivo_pct === "number" ? parametros.crecimiento_objetivo_pct : null,
    desvio_prueba_anterior_pct: typeof resumen?.desvio_prueba_anterior_pct === "number" ? resumen.desvio_prueba_anterior_pct : null,
  };
}

const aApi = (p: ProyeccionDeTablero) => ({
  id: p.id,
  nombre: p.nombre,
  estado: p.estado,
  anio_en_curso: p.anio_en_curso,
  anio_siguiente: p.anio_siguiente,
  hasta_periodo: p.hasta_periodo,
  k: p.k,
  version_metodo: p.version_metodo,
  cerrada_at: p.cerrada_at,
  cerrada_por_nombre: p.cerrada_por_nombre,
  usa_compras: p.usa_compras,
});

type Panorama = {
  /** Las proyecciones no eliminadas, las más recientes primero. */
  proyecciones: ProyeccionDb[];
  cargas: Record<string, string>;
  /** `k'`: último mes publicado y terminado en Lima (`aaaa-mm`), o `null`. */
  ultimoPublicado: string | null;
  hoy: string;
  /** La cerrada que lee el flujo de Compras (misma regla que M8), o `null`. */
  usaCompras: ProyeccionDb | null;
  /** La que se abre por defecto: la que usa Compras o, si no hay, la en trabajo más reciente. */
  porDefecto: { proyeccion: ProyeccionDb; motivo: "usa_compras" | "en_trabajo_mas_reciente" } | null;
};

/**
 * Las proyecciones y la que usa Compras, con la MISMA regla que M8 (`src/lib/flujo/servicio.ts`): `k' = hastaPorDefecto(publicados, hoy)` y
 * `planHorizonte(k', años con cerrada).anio_cerrada`. En enero, antes del primer cierre del año, es la cerrada del año anterior (R22).
 */
async function leerPanorama(d: Db): Promise<Salida<Panorama>> {
  const [lista, cargas] = await Promise.all([listarProyeccionesDb(d), leerCargasPublicadas(d)]);
  if (lista.error) return fallaDb(lista.error, "dirección: leer las proyecciones");
  if (cargas.error) return fallaDb(cargas.error, "dirección: leer los meses publicados");
  const proyecciones = lista.data.filter((p) => p.activo !== false);
  const hoy = hoyLima();
  const ultimoPublicado = hastaPorDefecto(Object.keys(cargas.data), hoy);
  const cerradas = proyecciones.filter((p) => p.estado === "cerrada");
  const plan = ultimoPublicado === null ? null : planHorizonte(ultimoPublicado, cerradas.map((p) => p.anio_en_curso));
  const usaCompras = plan ? (cerradas.find((p) => p.anio_en_curso === plan.anio_cerrada) ?? null) : null;
  const enTrabajo = proyecciones.find((p) => p.estado === "en_trabajo") ?? null;
  const porDefecto: Panorama["porDefecto"] = usaCompras ? { proyeccion: usaCompras, motivo: "usa_compras" } : enTrabajo ? { proyeccion: enTrabajo, motivo: "en_trabajo_mas_reciente" } : null;
  return listo({ proyecciones, cargas: cargas.data, ultimoPublicado, hoy, usaCompras, porDefecto });
}

// ─── Lecturas cacheadas ───

/** `tablero_proyeccion` con caché por `(proyeccion, huella, filtros)`: primero la huella (barata); nunca se guarda si la huella cambió en medio. */
async function docProyeccion(d: Db, id: string, params: ParamsTableroProyeccionSql): Promise<Salida<TableroProyeccionSql | null>> {
  const huella = await leerHuella(d, id);
  if (huella.error) return fallaDb(huella.error, "dirección: leer la huella de la proyección");
  if (huella.data === null) return listo(null);
  const clave = `${id}|${huella.data}|${claveCanonica(params)}`;
  let noExiste = false;
  const r = await cacheProyeccion.obtener(
    clave,
    async () => {
      const leido = await leerTableroProyeccion(d, id, params);
      if (!leido.error && leido.data === null) noExiste = true;
      return leido;
    },
    { vigente: (doc) => doc.huella === huella.data }
  );
  if (r.error) return fallaDb(r.error, "dirección: leer la proyección");
  if (noExiste || r.data === null) return listo(null);
  return listo(r.data);
}

/** `tablero_venta` con caché por cargas publicadas + maestros + proyección calculada + filtros. */
async function docVenta(d: Db, params: ParamsTableroVentaSql, llaves: { cargas: string; maestros: string; calculado: string }): Promise<Salida<TableroVentaSql>> {
  const clave = `${llaves.cargas}|${llaves.maestros}|${llaves.calculado}|${claveCanonica(params)}`;
  const r = await cacheVenta.obtener(clave, () => conCupoVenta(() => leerTableroVenta(d, params)));
  if (esColaLlena(r.error)) return falla(respuestaColaLlena());
  if (r.error) return fallaDb(r.error, "dirección: leer la venta");
  if (r.data === null) return fallaMensaje("No se pudo leer la venta publicada. Vuelve a intentarlo.", 500);
  return listo(r.data);
}

async function docTendencia(d: Db, params: Pick<ParamsTableroVentaSql, "desde" | "hasta" | "k_prima">, llaves: { cargas: string; maestros: string }): Promise<Salida<TableroVentaTendenciaSql | null>> {
  const clave = `${llaves.cargas}|${llaves.maestros}|${claveCanonica(params)}`;
  const r = await cacheTendencia.obtener(clave, () => conCupoVenta(() => leerTendenciaVenta(d, params)));
  if (esColaLlena(r.error)) return falla(respuestaColaLlena());
  if (r.error) return fallaDb(r.error, "dirección: leer la tendencia de venta");
  return listo(r.data);
}

// ─── Rango de venta ───

/** De enero de `Y−3` al último mes publicado, sin pasar de diciembre de `Y` (el año de `hasta` es `Y` para la función SQL). */
function rangoVenta(p: ProyeccionDeTablero, ultimoPublicado: string | null): { desde: string; hasta: string; k_prima: number } {
  const Y = p.anio_en_curso;
  let hasta = ultimoPublicado ?? p.hasta_periodo;
  if (hasta > `${Y}-12`) hasta = `${Y}-12`;
  if (hasta < `${Y}-01`) hasta = p.hasta_periodo;
  return { desde: `${Y - 3}-01-01`, hasta: `${hasta}-01`, k_prima: Number(hasta.slice(5, 7)) };
}

// ─── Lo de la proyección entera ───

/** Lo que `armarParteEntera` necesita además del documento sin filtros: tendencia, crecimientos declarados y sus versiones, factores y aperturas. */
async function leerEntera(d: Db, p: ProyeccionDb, proyeccion: ProyeccionDeTablero, docTotal: TableroProyeccionSql, maestros: MaestrosDireccion, panorama: Panorama): Promise<Salida<EntradaEntera>> {
  const rango = rangoVenta(proyeccion, panorama.ultimoPublicado);
  const [tendencia, celdas, versiones, tiendas, nino] = await Promise.all([
    docTendencia(d, rango, { cargas: huellaCargas(panorama.cargas), maestros: maestros.huella }),
    leerCrecimientos(d, p.id),
    leerVersionesDeAnio(d, p.anio_en_curso + 1),
    leerTiendasProyeccion(d, p.id),
    leerNinoDeHoy(d, p, panorama.cargas, panorama.hoy),
  ]);
  if (tendencia.respuesta) return falla(tendencia.respuesta);
  if (celdas.error) return fallaDb(celdas.error, "dirección: leer los crecimientos de la proyección");
  if (versiones.error) return fallaDb(versiones.error, "dirección: leer las versiones de crecimiento");
  if (tiendas.error) return fallaDb(tiendas.error, "dirección: leer las tiendas de la proyección");
  if (nino.respuesta) return falla(nino.respuesta);

  const declarados: DeclaradoGm[] = celdas.data
    .filter((c) => c.activo)
    .map((c) => ({ genero_id: c.genero_id, mundo_id: c.mundo_id, pct: Number(c.pct), sobre_base: c.sobre_base === "corregida" ? "corregida" : c.sobre_base === "bruta" ? "bruta" : null, version: c.version ?? null, crecimiento_id: c.crecimiento_id ?? null }));
  const versionesGm: VersionCrecimiento[] = versiones.data.map((v) => ({
    id: v.id,
    alcance: v.alcance,
    genero_id: v.genero_id,
    mundo_id: v.mundo_id,
    version: v.version,
    estado: v.estado,
    aprobada_at: v.aprobada_at,
    usuario_nombre: v.usuario_nombre,
    nota: v.nota,
    base_valor: v.base_valor === null || v.base_valor === undefined ? null : Number(v.base_valor),
  }));
  const usado = parametrosDe(p.parametros).crecimiento_resto_usado;
  const aperturas = (tiendas.data ?? [])
    .filter((t) => t.activo && t.anio === p.anio_en_curso + 1 && t.bloque === "nuevas" && t.subbloque === "aperturas" && t.venta_esperada_usada !== null)
    .map((t) => ({ tienda_id: t.tienda_id, fecha: t.fecha_usada ?? null }));

  return listo({
    proyeccion,
    maestros: maestros.tablero,
    docTotal,
    tendencia: tendencia.data,
    declarados,
    versiones: versionesGm,
    resto: { version: usado?.version ?? null, crecimiento_id: usado?.crecimiento_id ?? null, por_nombre: usado?.por_nombre ?? null, at: usado?.at ?? null },
    factoresProvisionales: nino.data.factoresProvisionales,
    aperturasSinHistoria: aperturas,
    aniosNino: nino.data.aniosNino,
    ultimoPublicado: panorama.ultimoPublicado,
  });
}

// ─── Filtros contra el catálogo ───

type FiltrosSql = { gml_ids: string[] | null; agrupacion_marca_ids: string[] | null; unidad_marca_id: string | null; temporadas: FiltrosTableroApi["temporadas"] | null };

/**
 * Convierte los filtros de la query en lo que entienden las funciones SQL (géneros × mundo × línea → nodos, como 07f) y valida lo que depende de
 * los datos: la línea debe ser de ese género y ese mundo; la unidad de marca debe existir y, si se eligieron agrupaciones, ser de una de ellas
 * (`400 marca_fuera_de_agrupacion`); las tiendas deben ser tiendas.
 */
export function resolverFiltros(f: FiltrosTableroApi, m: MaestrosDireccion): Salida<{ sql: FiltrosSql; resueltos: FiltrosResueltos }> {
  const partes: string[] = [];
  const generos = new Set(f.generos ?? []);
  if (f.resto) for (const g of m.generos) if (g.es_resto) generos.add(g.id);
  for (const g of f.generos ?? []) if (!m.tablero.nombres.genero.has(g)) return fallaMensaje("Uno de los géneros elegidos no existe.", 400);
  if (f.mundo_id !== undefined && !m.tablero.nombres.mundo.has(f.mundo_id)) return fallaMensaje("El mundo elegido no existe.", 400);

  let gml: string[] | null = null;
  if (f.linea_id !== undefined) {
    const nodo = m.nodos.find((n) => n.id === f.linea_id);
    if (!nodo || !generos.has(nodo.genero_id) || nodo.mundo_id !== f.mundo_id) return fallaMensaje("La línea elegida no es de ese género y ese mundo.", 400);
    gml = [nodo.id];
  } else if (generos.size > 0 || f.mundo_id !== undefined) {
    gml = m.nodos.filter((n) => (generos.size === 0 || generos.has(n.genero_id)) && (f.mundo_id === undefined || n.mundo_id === f.mundo_id)).map((n) => n.id);
  }
  const nombresGenero = (f.generos ?? []).map((g) => m.tablero.nombres.genero.get(g) ?? "—");
  if (f.resto) nombresGenero.push("Resto");
  if (nombresGenero.length > 0 && f.mundo_id !== undefined && nombresGenero.length === 1) partes.push(`${nombresGenero[0]} · ${m.tablero.nombres.mundo.get(f.mundo_id)}`);
  else {
    if (nombresGenero.length > 0) partes.push(nombresGenero.join(", "));
    if (f.mundo_id !== undefined) partes.push(m.tablero.nombres.mundo.get(f.mundo_id) ?? "—");
  }
  if (f.linea_id !== undefined) partes.push(m.nodos.find((n) => n.id === f.linea_id)?.nombre ?? "—");
  if (f.temporadas) partes.push(f.temporadas.map((t) => TEMPORADAS_NOMBRADAS.find((x) => x.id === t)?.nombre ?? t).join(", "));

  const am = f.am ?? null;
  if (am) {
    for (const a of am) if (!m.tablero.nombres.agrupacionMarca.has(a)) return fallaMensaje("Una de las agrupaciones de marca elegidas no existe.", 400);
    partes.push(`AM: ${am.map((a) => m.tablero.nombres.agrupacionMarca.get(a)).join(", ")}`);
  }
  if (f.marca !== undefined) {
    const unidad = m.unidadesMarca.find((u) => u.id === f.marca);
    if (!unidad) return fallaMensaje("La marca elegida no existe (debe ser una marca principal, no una que forma parte de un conjunto).", 400);
    if (am && !am.includes(unidad.agrupacion_marca_id)) return falla(errorConDetalle(MENSAJE_MARCA_FUERA, 400, "marca_fuera_de_agrupacion", {}));
    partes.push(`marca: ${unidad.nombre}`);
  }
  for (const t of f.tiendas ?? []) if (!m.tablero.tiendas.has(t)) return fallaMensaje("Una de las tiendas elegidas no existe o no es una tienda.", 400);

  return listo({
    sql: { gml_ids: gml, agrupacion_marca_ids: am, unidad_marca_id: f.marca ?? null, temporadas: f.temporadas ?? null },
    resueltos: {
      hayFiltroProducto: gml !== null || am !== null || f.marca !== undefined || f.temporadas !== undefined,
      unidadMarcaId: f.marca ?? null,
      tiendas: f.tiendas ?? null,
      bloque: f.bloque,
      desglose: f.desglose,
      partesTexto: partes,
    },
  });
}

/** Solo las claves con valor: `claveCanonica` y la función SQL tratan lo ausente como «sin filtro». */
const sinNulos = <T extends Record<string, unknown>>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined)) as T;

// ─── Comprobaciones de una proyección ───

function proyeccionDe(panorama: Panorama, id: string): ProyeccionDb | null {
  return panorama.proyecciones.find((p) => p.id === id) ?? null;
}

function rechazoParaVer(p: ProyeccionDb): Salida<never> | null {
  if (p.resumen === null) return fallaMensaje(MENSAJE_SIN_CALCULAR, 409, "sin_calcular");
  if (calculoEnCurso(p.calculando_desde, sello())) return fallaMensaje(MENSAJE_CALCULO_EN_CURSO_PROYECCION, 409, "calculo_en_curso");
  return null;
}

// ─── GET /api/direccion/opciones ───

export async function leerOpciones(): Promise<Salida<OpcionesTableroApi>> {
  const d = db();
  const [panoramaR, maestrosR, ligeras] = await Promise.all([leerPanorama(d), leerMaestros(d), leerAprobacionesLigeras(d)]);
  if (panoramaR.respuesta) return falla(panoramaR.respuesta);
  if (maestrosR.respuesta) return falla(maestrosR.respuesta);
  if (ligeras.error) return fallaDb(ligeras.error, "dirección: leer las aprobaciones");
  const panorama = panoramaR.data;
  const m = maestrosR.data;

  // La más reciente de cada proyección (la lista llega de la más reciente a la más antigua) y la huella de hoy de las que tienen alguna.
  const ultimaDe = new Map<string, (typeof ligeras.data)[number]>();
  for (const a of ligeras.data) if (!ultimaDe.has(a.proyeccion_id)) ultimaDe.set(a.proyeccion_id, a);
  const conAprobacion = panorama.proyecciones.filter((p) => ultimaDe.has(p.id));
  const huellas = await Promise.all(conAprobacion.map((p) => leerHuella(d, p.id)));
  const falloHuella = huellas.find((h) => h.error)?.error;
  if (falloHuella) return fallaDb(falloHuella, "dirección: leer las huellas");
  const huellaDe = new Map(conAprobacion.map((p, i) => [p.id, huellas[i].data]));

  const usaId = panorama.usaCompras?.id ?? null;
  const porDefecto = panorama.porDefecto;
  const ultimaAprobada = ligeras.data.find((a) => a.resultado !== "rechazada" && panorama.proyecciones.some((p) => p.id === a.proyeccion_id)) ?? null;
  return listo({
    proyecciones: panorama.proyecciones.map((p) => ({ ...aApi(aProyeccion(p, usaId)), estado_direccion: estadoBreve(ultimaDe.get(p.id) ?? null, huellaDe.get(p.id) ?? null) })),
    por_defecto: porDefecto ? { proyeccion_id: porDefecto.proyeccion.id, motivo: porDefecto.motivo } : null,
    comparar_por_defecto: ultimaAprobada && ultimaAprobada.proyeccion_id !== porDefecto?.proyeccion.id ? { proyeccion_id: ultimaAprobada.proyeccion_id, aprobacion_id: ultimaAprobada.id } : null,
    generos: m.generos,
    mundos: m.mundos,
    lineas: m.nodos.filter((n) => n.activo).map((n) => ({ id: n.id, nombre: n.nombre, genero_id: n.genero_id, mundo_id: n.mundo_id })),
    temporadas: TEMPORADAS_NOMBRADAS,
    agrupaciones_marca: m.agrupacionesMarca,
    unidades_marca: m.unidadesMarca.filter((u) => u.activa).map((u) => ({ id: u.id, nombre: u.nombre, agrupacion_marca_id: u.agrupacion_marca_id })),
    tiendas: m.tiendas,
  });
}

// ─── GET /api/direccion/tablero ───

export const MENSAJE_COMPARAR_IGUAL_SERVICIO = "La proyección para comparar no puede ser la misma que estás viendo.";

/**
 * El tablero. `esAdmin` solo decide `puede_aprobar`. La comparada, si no se pide, es la proyección de la última aprobación no rechazada (salvo que
 * sea la mostrada); `comparar_igual` se responde cuando la comparada pedida resulta ser la mostrada por defecto (los dos ids explícitos e iguales ya
 * los rechaza el esquema).
 */
export async function leerTablero(f: FiltrosTableroApi, esAdmin: boolean): Promise<Salida<TableroApi>> {
  const d = db();
  const [panoramaR, maestrosR, ultimaR] = await Promise.all([leerPanorama(d), leerMaestros(d), leerUltimaAprobada(d)]);
  if (panoramaR.respuesta) return falla(panoramaR.respuesta);
  if (maestrosR.respuesta) return falla(maestrosR.respuesta);
  if (ultimaR.error) return fallaDb(ultimaR.error, "dirección: leer la última aprobación");
  const panorama = panoramaR.data;
  const m = maestrosR.data;

  // La proyección mostrada.
  let p: ProyeccionDb | null;
  if (f.proyeccion_id !== undefined) {
    p = proyeccionDe(panorama, f.proyeccion_id);
    if (!p) return fallaMensaje(MENSAJE_NO_ENCONTRADA, 404, "proyeccion_no_encontrada");
  } else {
    if (!panorama.porDefecto) return fallaMensaje(MENSAJE_SIN_PROYECCION, 409, "sin_proyeccion");
    p = panorama.porDefecto.proyeccion;
  }
  const rechazo = rechazoParaVer(p);
  if (rechazo) return rechazo;

  // Con qué se compara.
  const ultimaAprobada = ultimaR.data && proyeccionDe(panorama, ultimaR.data.proyeccion_id) ? ultimaR.data : null;
  let comparadaDb: ProyeccionDb | null = null;
  let motivoComparada: "aprobada" | "elegida" = "elegida";
  if (f.comparar_id !== undefined && f.comparar_id !== "ninguna") {
    if (f.comparar_id === p.id) return fallaMensaje(MENSAJE_COMPARAR_IGUAL_SERVICIO, 400, "comparar_igual");
    comparadaDb = proyeccionDe(panorama, f.comparar_id);
    if (!comparadaDb) return fallaMensaje(MENSAJE_COMPARADA_NO_ENCONTRADA, 404, "proyeccion_no_encontrada");
    if (comparadaDb.resumen === null) return fallaMensaje("La proyección para comparar todavía no está calculada.", 409, "sin_calcular");
    motivoComparada = ultimaAprobada?.proyeccion_id === comparadaDb.id ? "aprobada" : "elegida";
  } else if (f.comparar_id === undefined && ultimaAprobada && ultimaAprobada.proyeccion_id !== p.id) {
    const candidata = proyeccionDe(panorama, ultimaAprobada.proyeccion_id);
    if (candidata && candidata.resumen !== null) {
      comparadaDb = candidata;
      motivoComparada = "aprobada";
    }
  }

  const filtros = resolverFiltros(f, m);
  if (filtros.respuesta) return falla(filtros.respuesta);
  const { sql, resueltos } = filtros.data;
  const usaId = panorama.usaCompras?.id ?? null;
  const proyeccion = aProyeccion(p, usaId);
  const conjunto = conjuntoTiendas(proyeccion.bloques, proyeccion.anio_en_curso, resueltos.bloque, resueltos.tiendas);
  const rango = rangoVenta(proyeccion, panorama.ultimoPublicado);
  const desgloseSql = resueltos.desglose === "tienda" ? null : resueltos.desglose;
  const llaves = { cargas: huellaCargas(panorama.cargas), maestros: m.huella, calculado: `${p.id}|${p.calculado_at ?? ""}` };

  const paramsRecorte: ParamsTableroProyeccionSql = sinNulos({ ...sql, desglose: desgloseSql });
  const sinFiltros = !resueltos.hayFiltroProducto;
  const paramsVenta: ParamsTableroVentaSql = sinNulos({
    ...sql,
    tienda_ids: conjunto.recortado ? [...(conjunto.ids ?? [])].sort() : null,
    proyeccion_id: p.id,
    desde: rango.desde,
    hasta: rango.hasta,
    k: proyeccion.k,
    k_prima: rango.k_prima,
    desglose: desgloseSql,
  });
  const ventaSinFiltros = sinFiltros && !conjunto.recortado;

  const [recorteR, totalR, ventaR, ventaTotalR, aprobacionesR] = await Promise.all([
    docProyeccion(d, p.id, paramsRecorte),
    // Sin filtros de producto el documento del recorte ES el de la proyección entera (`por_gm` y `anios` no dependen del desglose).
    sinFiltros ? Promise.resolve(null) : docProyeccion(d, p.id, {}),
    docVenta(d, paramsVenta, llaves),
    ventaSinFiltros ? Promise.resolve(null) : docVenta(d, sinNulos({ proyeccion_id: p.id, desde: rango.desde, hasta: rango.hasta, k: proyeccion.k, k_prima: rango.k_prima }), llaves),
    leerAprobacionesDeProyeccion(d, p.id),
  ]);
  if (recorteR.respuesta) return falla(recorteR.respuesta);
  if (totalR?.respuesta) return falla(totalR.respuesta);
  if (ventaR.respuesta) return falla(ventaR.respuesta);
  if (ventaTotalR?.respuesta) return falla(ventaTotalR.respuesta);
  if (aprobacionesR.error) return fallaDb(aprobacionesR.error, "dirección: leer las aprobaciones");
  const docRecorte = recorteR.data;
  const docTotal = totalR ? totalR.data : docRecorte;
  if (!docRecorte || !docTotal) return fallaMensaje(MENSAJE_NO_ENCONTRADA, 404, "proyeccion_no_encontrada");

  const enteraR = await leerEntera(d, p, proyeccion, docTotal, m, panorama);
  if (enteraR.respuesta) return falla(enteraR.respuesta);

  // La comparada, con los mismos filtros.
  let comparada: ComparadaDeTablero | null = null;
  if (comparadaDb) {
    const [docC, aprobacionesC] = await Promise.all([docProyeccion(d, comparadaDb.id, sinNulos({ ...sql })), leerAprobacionesDeProyeccion(d, comparadaDb.id)]);
    if (docC.respuesta) return falla(docC.respuesta);
    if (aprobacionesC.error) return fallaDb(aprobacionesC.error, "dirección: leer las aprobaciones de la comparada");
    if (docC.data) {
      const aprobadaC = aprobacionesC.data.find((a) => a.resultado !== "rechazada") ?? null;
      comparada = { proyeccion: aProyeccion(comparadaDb, usaId), doc: docC.data, motivo: motivoComparada, huella_igual_a_aprobada: aprobadaC ? aprobadaC.huella === docC.data.huella : null };
    }
  }

  const nombreDeUltima = ultimaAprobada ? (proyeccionDe(panorama, ultimaAprobada.proyeccion_id)?.nombre ?? "otra proyección") : "";
  return listo(
    armarTablero({
      ...enteraR.data,
      filtros: resueltos,
      docRecorte,
      venta: ventaR.data,
      ventaTotal: ventaTotalR ? ventaTotalR.data : ventaR.data,
      comparada,
      aprobaciones: aprobacionesR.data,
      ultimaAprobada: ultimaAprobada ? { fila: ultimaAprobada, proyeccion_nombre: nombreDeUltima } : null,
      puedeAprobar: esAdmin,
    })
  );
}

// ─── GET /api/direccion/aprobaciones ───

export async function leerAprobaciones(proyeccionId: string): Promise<Salida<AprobacionesApi>> {
  const d = db();
  const [huella, filas] = await Promise.all([leerHuella(d, proyeccionId), leerAprobacionesDeProyeccion(d, proyeccionId)]);
  if (huella.error) return fallaDb(huella.error, "dirección: leer la huella");
  if (huella.data === null) return fallaMensaje(MENSAJE_NO_ENCONTRADA, 404, "proyeccion_no_encontrada");
  if (filas.error) return fallaDb(filas.error, "dirección: leer las aprobaciones");
  const e = estadoDeProyeccion(filas.data, huella.data);
  return listo({ huella_actual: huella.data, estado: e.estado, vigente: e.vigente, historial: e.historial });
}

// ─── POST /api/direccion/aprobaciones ───

export type ActorAprobacion = { id: string; nombre: string };

/**
 * Registra la decisión de dirección sobre la proyección ENTERA (R15). La foto (`resumen`) sale de una lectura sin filtros y SIN caché, que trae
 * su huella: si no es la que vio el admin, `409 huella_distinta` antes de llamar a la función (R14); la función vuelve a compararla.
 */
export async function aprobar(cuerpo: AprobarCuerpoApi, actor: ActorAprobacion): Promise<Salida<AprobacionApi>> {
  const d = db();
  const [panoramaR, maestrosR] = await Promise.all([leerPanorama(d), leerMaestros(d)]);
  if (panoramaR.respuesta) return falla(panoramaR.respuesta);
  if (maestrosR.respuesta) return falla(maestrosR.respuesta);
  const panorama = panoramaR.data;
  const p = proyeccionDe(panorama, cuerpo.proyeccion_id);
  if (!p) return fallaMensaje(MENSAJE_NO_ENCONTRADA, 404, "proyeccion_no_encontrada");
  if (p.estado === "archivada") return fallaMensaje(MENSAJE_ARCHIVADA, 409, "archivada");
  if (calculoEnCurso(p.calculando_desde, sello())) return fallaMensaje(MENSAJE_CALCULO_EN_CURSO_PROYECCION, 409, "calculo_en_curso");
  if (p.resumen === null) return fallaMensaje("Calcula la proyección antes de aprobarla.", 409, "sin_calcular");

  const leido = await leerTableroProyeccion(d, p.id, {});
  if (leido.error) return fallaDb(leido.error, "dirección: leer la proyección");
  const doc = leido.data;
  if (!doc) return fallaMensaje(MENSAJE_NO_ENCONTRADA, 404, "proyeccion_no_encontrada");
  if (doc.huella !== cuerpo.huella_vista) return falla(errorConDetalle(MENSAJE_HUELLA_DISTINTA, 409, "huella_distinta", { huella_actual: doc.huella }));

  const proyeccion = aProyeccion(p, panorama.usaCompras?.id ?? null);
  const enteraR = await leerEntera(d, p, proyeccion, doc, maestrosR.data, panorama);
  if (enteraR.respuesta) return falla(enteraR.respuesta);
  const parte = armarParteEntera(enteraR.data);
  const resumen = armarResumen({
    doc,
    hastaPeriodo: proyeccion.hasta_periodo,
    versionMetodo: proyeccion.version_metodo,
    puentes: parte.puentes,
    crecimientos: parte.crecimientos,
    alertas: parte.alertas,
    ...(cuerpo.filtros_vistos !== undefined ? { filtrosVistos: cuerpo.filtros_vistos } : {}),
  });
  if (Buffer.byteLength(JSON.stringify(resumen), "utf8") > MAX_BYTES_RESUMEN) return fallaMensaje("El resumen de la aprobación es demasiado grande para guardarse. Avisa al administrador.", 500);

  const r = await registrarAprobacion(d, {
    proyeccion_id: p.id,
    huella_vista: cuerpo.huella_vista,
    resultado: cuerpo.resultado,
    motivo: cuerpo.motivo,
    comentario: cuerpo.comentario,
    resumen,
    perfil_id: actor.id,
    usuario_nombre: actor.nombre,
    rol: "admin",
  });
  if (r.error) return fallaDb(r.error, "dirección: registrar la aprobación");
  const fila = r.data;
  if (fila === null) return fallaMensaje("No se pudo registrar la aprobación. Vuelve a intentarlo.", 500);
  if ("error" in fila) {
    switch (fila.error) {
      case "no_encontrada":
        return fallaMensaje(MENSAJE_NO_ENCONTRADA, 404, "proyeccion_no_encontrada");
      case "archivada":
        return fallaMensaje(MENSAJE_ARCHIVADA, 409, "archivada");
      case "calculo_en_curso":
        return fallaMensaje(MENSAJE_CALCULO_EN_CURSO_PROYECCION, 409, "calculo_en_curso");
      case "sin_calcular":
        return fallaMensaje("Calcula la proyección antes de aprobarla.", 409, "sin_calcular");
      case "huella_distinta":
        return falla(errorConDetalle(MENSAJE_HUELLA_DISTINTA, 409, "huella_distinta", { huella_actual: fila.huella_actual }));
    }
  }
  // La huella de la proyección puede haber cambiado justo después del registro (una decisión fila a fila): el tablero lo dirá al recargar (M-A).
  return listo(aAprobacionApi(fila as FilaAprobacionSql, (fila as FilaAprobacionSql).huella));
}

// ─── GET /api/direccion/estado ───

const SIN_PROYECCION: EstadoDireccionApi = { proyeccion: null, estado: "sin_aprobacion", vigente: null, ultima: null, diferencia: null };

/**
 * Lectura barata para los avisos de Proyección y de Flujo mensual (§4.11): la proyección (con `para=compras`, la cerrada que usa el flujo), su
 * estado de dirección y la diferencia con la última aprobada. No lee venta.
 */
export async function leerEstado(q: EstadoQuery): Promise<Salida<EstadoDireccionApi>> {
  const d = db();
  const panoramaR = await leerPanorama(d);
  if (panoramaR.respuesta) return falla(panoramaR.respuesta);
  const panorama = panoramaR.data;
  let p: ProyeccionDb | null;
  if ("para" in q) {
    p = panorama.usaCompras;
    if (!p) return listo(SIN_PROYECCION);
  } else {
    p = proyeccionDe(panorama, q.proyeccion_id);
    if (!p) return fallaMensaje(MENSAJE_NO_ENCONTRADA, 404, "proyeccion_no_encontrada");
  }
  const proyeccion = aProyeccion(p, panorama.usaCompras?.id ?? null);
  const [filas, ultimaR, huella] = await Promise.all([leerAprobacionesDeProyeccion(d, p.id), leerUltimaAprobada(d), leerHuella(d, p.id)]);
  if (filas.error) return fallaDb(filas.error, "dirección: leer las aprobaciones");
  if (ultimaR.error) return fallaDb(ultimaR.error, "dirección: leer la última aprobación");
  if (huella.error) return fallaDb(huella.error, "dirección: leer la huella");
  const e = estadoDeProyeccion(filas.data, huella.data);
  const base: EstadoDireccionApi = {
    proyeccion: aApi(proyeccion),
    estado: e.estado,
    vigente: e.vigente ? { resultado: e.vigente.resultado, usuario_nombre: e.vigente.usuario_nombre, created_at: e.vigente.created_at } : null,
    ultima: aBreve(e.ultima),
    diferencia: null,
  };
  const ultimaAprobada = ultimaR.data && proyeccionDe(panorama, ultimaR.data.proyeccion_id) ? ultimaR.data : null;
  if (!ultimaAprobada || p.resumen === null) return listo(base);

  const [maestrosR, docR] = await Promise.all([leerMaestros(d), docProyeccion(d, p.id, {})]);
  if (maestrosR.respuesta) return falla(maestrosR.respuesta);
  if (docR.respuesta) return falla(docR.respuesta);
  if (!docR.data) return listo(base);
  const parte = armarParteEntera({
    proyeccion,
    maestros: maestrosR.data.tablero,
    docTotal: docR.data,
    tendencia: null,
    declarados: [],
    versiones: [],
    resto: { version: null, crecimiento_id: null, por_nombre: null, at: null },
    factoresProvisionales: [],
    aperturasSinHistoria: [],
    aniosNino: [],
    ultimoPublicado: panorama.ultimoPublicado,
  });
  const nombre = proyeccionDe(panorama, ultimaAprobada.proyeccion_id)?.nombre ?? "otra proyección";
  return listo({ ...base, diferencia: diferenciaConAprobada(ultimaAprobada, nombre, actualParaDiferencia(proyeccion, docR.data.huella, parte)) });
}

/** Texto de «datos hasta» para quien lo necesite fuera del tablero. */
export const datosHasta = (p: { hasta_periodo: string }): string => mesAnio(p.hasta_periodo);

