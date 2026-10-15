import { supabaseAdmin } from "@/lib/supabase/admin";
import { cargarCatalogo } from "./contexto";
import { leerFilaCompleta, leerFilasConAnios, leerTiendasProyeccion } from "./consultas";
import { filtrarFilas, indiceDeLineas, armarMatriz, type FilaPlana } from "./matriz";
import { armarMensual } from "./mensual";
import { aAnioApi, aFilaApi, aFilaModelo, aFilaPlana, type Catalogo } from "./persistencia";
import { aTiendaApi, falla, fallaDb, fallaMensaje, kDe, listo, parametrosDe, proyeccionOr404, type Db, type Salida } from "./servicio-base";
import type { ProyeccionDb } from "./consultas";
import type { FiltroMatrizApi, HistoricoFila, FilaDetalleApi, RespuestaLineasApi, RespuestaMatrizApi, RespuestaMensualApi, RespuestaFilasTiendaApi, RespuestaTiendasApi, ResumenProyeccion } from "./tipos";
import { UMBRAL_COLA_LARGA } from "./tipos";

/**
 * Lecturas de una proyección (Parte 1, detalle de fila, matriz, mensual y tiendas). Solo servidor; ninguna escribe. La matriz
 * y la mensual NO seleccionan `historico`: son sumas de lo guardado.
 */

const db = (): Db => supabaseAdmin();

type Base = { p: ProyeccionDb; catalogo: Catalogo; k: number; umbral: number };

async function base(d: Db, id: string): Promise<Salida<Base>> {
  const p = await proyeccionOr404(d, id);
  if (p.respuesta) return falla(p.respuesta);
  const cat = await cargarCatalogo(d);
  if (cat.respuesta) return falla(cat.respuesta);
  return listo({ p: p.data, catalogo: cat.data.catalogo, k: kDe(p.data), umbral: parametrosDe(p.data.parametros).umbral_cola_larga ?? UMBRAL_COLA_LARGA });
}

async function planas(d: Db, b: Base, columnas: "ligeras" | "cerrada" = "ligeras"): Promise<Salida<FilaPlana[]>> {
  const filas = await leerFilasConAnios(d, b.p.id, { columnas, soloActivas: true });
  if (filas.error) return fallaDb(filas.error, "proyección: leer filas");
  return listo(filas.data.map((f) => aFilaPlana(f, b.catalogo, b.k, b.p.anio_en_curso)).filter((f): f is FilaPlana => f !== null));
}

const sinAcentos = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// ─── Parte 1: GET /lineas ───

const MAX_LINEAS_CON_FILAS = 40;

export async function leerLineas(id: string, f: { genero_id?: string; mundo_id?: string; linea_id?: string; q?: string }): Promise<Salida<RespuestaLineasApi>> {
  const d = db();
  const bR = await base(d, id);
  if (bR.respuesta) return falla(bR.respuesta);
  const b = bR.data;
  const Y = b.p.anio_en_curso;
  const pR = await planas(d, b);
  if (pR.respuesta) return falla(pR.respuesta);
  const todas = pR.data;
  const parametros = parametrosDe(b.p.parametros);

  // Índice lateral: respeta género, mundo y búsqueda (no la línea, para poder saltar entre líneas).
  const q = f.q ? sinAcentos(f.q) : null;
  const paraIndice = filtrarFilas(todas, { genero_id: f.genero_id ?? null, mundo_id: f.mundo_id ?? null }).filter(
    (x) => q === null || sinAcentos(`${x.genero} ${x.mundo} ${x.linea}`).includes(q)
  );
  const indice = indiceDeLineas(paraIndice, Y, b.umbral).map((l) => ({
    genero_id: l.genero_id,
    mundo_id: l.mundo_id,
    linea_id: l.linea_id,
    genero: l.genero,
    mundo: l.mundo,
    linea: l.linea,
    estado: l.estado,
  }));

  const hayFiltro = !!(f.genero_id || f.mundo_id || f.linea_id);
  const elegidas = filtrarFilas(todas, { genero_id: f.genero_id ?? null, mundo_id: f.mundo_id ?? null, linea_id: f.linea_id ?? null });
  const nodos = [...new Set(elegidas.map((x) => x.gml_id))];

  const totalesPorAnio = [Y, Y + 1].map((anio) => {
    let vigente = 0;
    let propuesto = 0;
    let decididas = 0;
    let filas = 0;
    for (const x of elegidas.filter((e) => e.tienda_id === null)) {
      const r = x.anios.find((a) => a.anio === anio);
      if (!r) continue;
      filas += 1;
      vigente += r.vigente ?? 0;
      propuesto += r.propuesto ?? 0;
      if (r.decidido !== null) decididas += 1;
    }
    return { anio, vigente, propuesto, decididas, filas };
  });

  const vacia: RespuestaLineasApi = {
    filtro: { genero_id: f.genero_id ?? null, mundo_id: f.mundo_id ?? null, linea_id: f.linea_id ?? null, q: f.q ?? null },
    filas: [],
    totales_por_anio: hayFiltro ? totalesPorAnio : [],
    historico_linea: [],
    tiendas_linea: [],
    prueba_anterior: null,
    avisos_linea: [],
    indice_lineas: indice,
  };
  if (!hayFiltro || nodos.length === 0 || nodos.length > MAX_LINEAS_CON_FILAS) return listo(vacia);

  const completas = await leerFilasConAnios(d, id, { columnas: "completas", gmlIds: nodos, soloActivas: true });
  if (completas.error) return fallaDb(completas.error, "proyección: leer la línea");
  const tiendasRows = await leerTiendasProyeccion(d, id);
  if (tiendasRows.error) return fallaDb(tiendasRows.error, "proyección: leer tiendas");

  const base_ = completas.data.filter((x) => x.tienda_id === null);
  const filasApi = base_.map((x) => aFilaApi(x, b.catalogo, b.k, Y)).filter((x): x is NonNullable<typeof x> => x !== null);
  const modelos = base_.map((x) => aFilaModelo(x, b.k, Y));

  // Histórico de la línea: cada año con su red de mismas tiendas.
  const porAnio = new Map<number, { unidades: number; clase: "normal" | "atipico" | "en_curso"; tiendas: number }>();
  for (const m of modelos) {
    for (const a of m.historico?.anios ?? []) {
      const previo = porAnio.get(a.anio) ?? { unidades: 0, clase: a.clase, tiendas: a.tiendas.length };
      previo.unidades += a.total;
      if (a.clase === "atipico") previo.clase = "atipico";
      porAnio.set(a.anio, previo);
    }
  }
  const historicoLinea = [...porAnio].sort((x, y) => x[0] - y[0]).map(([anio, v]) => ({ anio, ...v }));

  // Prueba con el año anterior (dentro de muestra), agregada por línea.
  let propuestoPrueba = 0;
  let realPrueba = 0;
  const eats: number[] = [];
  for (const m of modelos) {
    const pr = (m.historico as HistoricoFila | null)?.prueba_anterior;
    if (!pr) continue;
    propuestoPrueba += pr.propuesto;
    realPrueba += pr.real;
    if (pr.eat_m6 !== null) eats.push(pr.eat_m6);
  }
  const prueba = realPrueba > 0 ? { propuesto: propuestoPrueba, real: realPrueba, desvio_pct: (propuestoPrueba / realPrueba - 1) * 100, eat_m6: eats.length > 0 ? eats.reduce((a, c) => a + c, 0) / eats.length : null } : null;

  // Tiendas nuevas y cierres que tocan la línea.
  const nombres = new Map<string, string>();
  for (const bl of Object.values(parametros.bloques)) for (const lista of [bl.mismas, bl.nuevas, bl.cierres, bl.fuera]) for (const t of lista) nombres.set(t.tienda_id, t.codigo);
  const deTienda = completas.data.filter((x) => x.tienda_id !== null);
  const decididaPorTienda = new Map(tiendasRows.data.map((t) => [`${t.tienda_id}#${t.anio}`, t.decidido !== null]));
  const acumulado = new Map<string, RespuestaLineasApi["tiendas_linea"][number]>();
  for (const x of deTienda) {
    const m = aFilaModelo(x, b.k, Y);
    for (const r of m.registros) {
      if (r.bloque === "mismas") continue;
      const clave = `${x.tienda_id}#${r.anio}`;
      const previo = acumulado.get(clave) ?? {
        anio: r.anio,
        bloque: r.bloque === "cierres" ? ("cierres" as const) : ("nuevas" as const),
        subbloque: r.subbloque,
        tienda: nombres.get(x.tienda_id as string) ?? (x.tienda_id as string).slice(0, 8),
        vendido: 0,
        vigente: 0 as number | null,
        decidida: decididaPorTienda.get(clave) ?? false,
      };
      previo.vendido += r.vendido;
      previo.vigente = (previo.vigente ?? 0) + (r.vigente ?? 0);
      acumulado.set(clave, previo);
    }
  }
  const tiendasLinea = [...acumulado.values()].sort((a, c) => a.anio - c.anio || a.tienda.localeCompare(c.tienda));

  // B2: una tienda nueva de `Y` que pasa a `M(Y+1)` y está sin decidir alimenta la base del año siguiente.
  const mismasSiguiente = new Set((parametros.bloques[Y + 1]?.mismas ?? []).map((t) => t.tienda_id));
  const sinDecidir = deTienda.some((x) => {
    if (!mismasSiguiente.has(x.tienda_id as string)) return false;
    const r = x.proyeccion_fila_anios.find((a) => a.anio === Y && a.activo);
    return !!r && r.bloque === "nuevas" && !(decididaPorTienda.get(`${x.tienda_id}#${Y}`) ?? false) && (r.propuesto ?? 0) > 0;
  });

  return listo({
    ...vacia,
    filas: filasApi,
    historico_linea: historicoLinea,
    tiendas_linea: tiendasLinea,
    prueba_anterior: prueba,
    avisos_linea: sinDecidir ? ["tienda_nueva_sin_decidir"] : [],
  });
}

// ─── Detalle de una fila: GET /filas/[filaId] ───

export async function leerFilaDetalle(id: string, filaId: string): Promise<Salida<FilaDetalleApi>> {
  const d = db();
  const bR = await base(d, id);
  if (bR.respuesta) return falla(bR.respuesta);
  const b = bR.data;
  const r = await leerFilaCompleta(d, id, filaId);
  if (r.error) return fallaDb(r.error, "proyección: leer fila");
  if (!r.data) return fallaMensaje("Fila no encontrada.", 404);
  const api = aFilaApi(r.data, b.catalogo, b.k, b.p.anio_en_curso);
  if (!api) return fallaMensaje("Fila no encontrada.", 404);
  const m = aFilaModelo(r.data, b.k, b.p.anio_en_curso);
  return listo({
    ...api,
    historico: m.historico && (m.historico as HistoricoFila).anios ? m.historico : null,
    curva: m.curva,
    curva_origen: m.curva_origen,
    factores_mes: m.factores_mes,
    participaciones: m.participaciones,
    anios: m.registros.map(aAnioApi),
  });
}

// ─── Matriz y mensual ───

export type ConsultaMatriz = {
  genero_id?: string;
  mundo_id?: string;
  linea_id?: string;
  temporada?: string;
  agrupacion_estacionalidad_id?: string;
  agrupacion_marca_id?: string;
  solo?: FiltroMatrizApi["solo"] | undefined;
};

const filtroDe = (q: ConsultaMatriz): Omit<FiltroMatrizApi, "por"> => ({
  genero_id: q.genero_id ?? null,
  mundo_id: q.mundo_id ?? null,
  linea_id: q.linea_id ?? null,
  temporada: q.temporada ?? null,
  agrupacion_estacionalidad_id: q.agrupacion_estacionalidad_id ?? null,
  agrupacion_marca_id: q.agrupacion_marca_id ?? null,
  solo: q.solo ?? null,
});

export async function leerMatriz(id: string, q: ConsultaMatriz & { por: "arbol" | "agrupacion_marca" }): Promise<Salida<RespuestaMatrizApi>> {
  const d = db();
  const bR = await base(d, id);
  if (bR.respuesta) return falla(bR.respuesta);
  const b = bR.data;
  const pR = await planas(d, b);
  if (pR.respuesta) return falla(pR.respuesta);
  const filtro = { ...filtroDe(q), por: q.por };
  const m = armarMatriz(pR.data, { anio: b.p.anio_en_curso, filtro, umbralColaLarga: b.umbral });
  const resumen = b.p.resumen as unknown as ResumenProyeccion | null;
  return listo({
    filtro,
    nodos: m.nodos,
    bloques: parametrosDe(b.p.parametros).bloques,
    resumen: { ...m.resumen, desvio_prueba_anterior_pct: resumen?.desvio_prueba_anterior_pct ?? null },
  });
}

export async function leerMensual(id: string, q: ConsultaMatriz & { bloque: "todas" | "mismas" | "nuevas" | "cierres"; por_agrupacion: boolean }): Promise<Salida<RespuestaMensualApi>> {
  const d = db();
  const bR = await base(d, id);
  if (bR.respuesta) return falla(bR.respuesta);
  const b = bR.data;
  const pR = await planas(d, b);
  if (pR.respuesta) return falla(pR.respuesta);
  const filtro = { ...filtroDe(q), por: "arbol" as const };
  const m = armarMensual(pR.data, { anio: b.p.anio_en_curso, filtro, bloque: q.bloque, porAgrupacion: q.por_agrupacion, umbralColaLarga: b.umbral });
  return listo({
    filtro: { ...filtro, bloque: q.bloque, por_agrupacion: q.por_agrupacion },
    filas: m.filas,
    totales: m.totales,
    bloques: parametrosDe(b.p.parametros).bloques,
  });
}

// ─── Tiendas nuevas y cierres ───

/**
 * Las tiendas SIN sus filas (`filas: []`): con ellas la respuesta pesaba ~10 MB. Las filas de una tienda y año se piden aparte
 * con `leerFilasDeTienda` (`GET …/tiendas/[tiendaId]/filas?anio=`).
 */
export async function leerTiendasDeProyeccion(id: string, q: { anio?: number; bloque?: "nuevas" | "cierres" }): Promise<Salida<RespuestaTiendasApi>> {
  const d = db();
  const bR = await base(d, id);
  if (bR.respuesta) return falla(bR.respuesta);
  const b = bR.data;
  const tiendas = await leerTiendasProyeccion(d, id);
  if (tiendas.error) return fallaDb(tiendas.error, "proyección: leer tiendas");
  const parametros = parametrosDe(b.p.parametros);
  const salida = tiendas.data
    .filter((t) => t.activo && (q.anio === undefined || t.anio === q.anio) && (q.bloque === undefined || t.bloque === q.bloque))
    .map((t) => aTiendaApi(t, [], b.catalogo, parametros, b.p))
    .sort((x, y) => x.anio - y.anio || x.codigo.localeCompare(y.codigo, "es"));
  const resumen = b.p.resumen as unknown as ResumenProyeccion | null;
  return listo({ tiendas: salida, perfiles_apertura: resumen?.perfiles_apertura ?? [] });
}

/** Las filas (género · mundo · línea · …) de UNA tienda en UN año: `404` si la tienda no está en la proyección o no tiene ese año. */
export async function leerFilasDeTienda(id: string, tiendaId: string, anio: number): Promise<Salida<RespuestaFilasTiendaApi>> {
  const d = db();
  const bR = await base(d, id);
  if (bR.respuesta) return falla(bR.respuesta);
  const b = bR.data;
  const tiendas = await leerTiendasProyeccion(d, id);
  if (tiendas.error) return fallaDb(tiendas.error, "proyección: leer tiendas");
  // El segmento de la ruta no es un uuid garantizado: solo se usa en la consulta si es una tienda de esta proyección.
  const t = tiendas.data.find((x) => x.activo && x.tienda_id === tiendaId && x.anio === anio);
  if (!t) return fallaMensaje("La tienda no está en esa proyección para ese año.", 404);
  const filas = await leerFilasConAnios(d, id, { columnas: "completas", tiendaId: t.tienda_id, soloActivas: true });
  if (filas.error) return fallaDb(filas.error, "proyección: leer las filas de la tienda");
  const delAnio = filas.data
    .filter((f) => f.proyeccion_fila_anios.some((a) => a.anio === anio && a.activo))
    .map((f) => ({ ...f, proyeccion_fila_anios: f.proyeccion_fila_anios.filter((a) => a.anio === anio) }));
  const k = kDe(b.p);
  const lista = delAnio.map((f) => aFilaApi(f, b.catalogo, k, b.p.anio_en_curso)).filter((f): f is NonNullable<typeof f> => f !== null);
  return listo({ tienda_id: t.tienda_id, anio, filas: lista });
}
