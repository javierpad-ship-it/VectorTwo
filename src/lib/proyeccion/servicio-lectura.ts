import { supabaseAdmin } from "@/lib/supabase/admin";
import { eatM6DeLinea } from "./calculo";
import { cargarCatalogo } from "./contexto";
import { leerFilaCompleta, leerFilasConAnios, leerNombresMarcas, leerTiendasProyeccion } from "./consultas";
import { claveTiendaAnio, filasTiendaDeLinea, marcasDeFilaApi, marcasQueNecesitanNombre, resumenFilasDeTienda } from "./apertura-linea";
import { baseDeAnio, filtrarFilas, indiceDeLineas, armarMatriz, type FilaPlana } from "./matriz";
import { armarMensual } from "./mensual";
import { aAniosApi, aFilaApi, aFilaModelo, aFilaPlana, ordenMarcaDe, type Catalogo } from "./persistencia";
import { aTiendaApi, cargarMatriz, crecimientoParaApi, falla, fallaDb, fallaMensaje, kDe, listo, parametrosDe, proyeccionOr404, type Db, type Salida } from "./servicio-base";
import { fraccionDeTienda } from "./decision";
import type { CrecimientoDeApi } from "./persistencia";
import type { ProyeccionDb } from "./consultas";
import type { FiltroMatrizApi, HistoricoFila, FilaDetalleApi, MarcasDeFilaApi, OrigenComposicion, RespuestaLineasApi, TiendaLineaApi, TiendaLineaBaseApi, RespuestaMatrizApi, RespuestaMensualApi, RespuestaFilasTiendaApi, RespuestaTiendasApi, ResumenProyeccion } from "./tipos";
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

/** El % efectivo de las filas base de `Y+1` para las respuestas de lectura (la foto de lo aplicado + su Resto + el árbol vigente). */
async function crecimientoDeLectura(d: Db, b: Base): Promise<Salida<CrecimientoDeApi>> {
  const foto = await cargarMatriz(d, b.p);
  if (foto.respuesta) return falla(foto.respuesta);
  return listo(crecimientoParaApi(foto.data.matriz, foto.data.resto.pct, b.catalogo));
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
    // Mismo criterio que la Matriz (`baseDeAnio`): `Σ B` y el vigente de las MISMAS filas, las que tienen `B`; una fila sin `B` no cuenta en ninguno.
    const b = baseDeAnio(elegidas, anio);
    return { anio, vigente, propuesto, decididas, filas, base_siguiente: b.base, vigente_con_base: b.vigente };
  });

  const vacia: RespuestaLineasApi = {
    filtro: { genero_id: f.genero_id ?? null, mundo_id: f.mundo_id ?? null, linea_id: f.linea_id ?? null, q: f.q ?? null },
    filas: [],
    totales_por_anio: hayFiltro ? totalesPorAnio : [],
    historico_linea: [],
    tiendas_linea: [],
    filas_tienda: [],
    marcas: [],
    prueba_anterior: null,
    avisos_linea: [],
    indice_lineas: indice,
  };
  if (!hayFiltro || nodos.length === 0 || nodos.length > MAX_LINEAS_CON_FILAS) return listo(vacia);

  const completas = await leerFilasConAnios(d, id, { columnas: "completas", gmlIds: nodos, soloActivas: true });
  if (completas.error) return fallaDb(completas.error, "proyección: leer la línea");
  const crec = await crecimientoDeLectura(d, b);
  if (crec.respuesta) return falla(crec.respuesta);
  const tiendasRows = await leerTiendasProyeccion(d, id);
  if (tiendasRows.error) return fallaDb(tiendasRows.error, "proyección: leer tiendas");

  // Cada GML (y equivalencia) conserva su lugar; dentro de cada uno, las agrupaciones de marca en el orden del catálogo (PREMIUM → ULTRA LOW).
  const sinTienda = completas.data.filter((x) => x.tienda_id === null);
  const lugarGml = new Map<string, number>();
  for (const x of sinTienda) if (!lugarGml.has(x.gml_id)) lugarGml.set(x.gml_id, lugarGml.size);
  const base_ = [...sinTienda].sort(
    (x, y) =>
      (lugarGml.get(x.gml_id) ?? 0) - (lugarGml.get(y.gml_id) ?? 0) ||
      (x.equivalencia_id ?? "").localeCompare(y.equivalencia_id ?? "") ||
      ordenMarcaDe(x.agrupacion_marca_id, b.catalogo) - ordenMarcaDe(y.agrupacion_marca_id, b.catalogo)
  );
  const apis = base_.map((x) => aFilaApi(x, b.catalogo, b.k, Y, crec.data));
  const filasApi = apis.filter((x): x is NonNullable<typeof x> => x !== null);
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
  const pruebas: { real: number; eat_m6: number | null; eat_m6_cobertura?: number | null }[] = [];
  for (const m of modelos) {
    const pr = (m.historico as HistoricoFila | null)?.prueba_anterior;
    if (!pr) continue;
    propuestoPrueba += pr.propuesto;
    realPrueba += pr.real;
    pruebas.push({ real: pr.real, eat_m6: pr.eat_m6, eat_m6_cobertura: pr.eat_m6_cobertura });
  }
  const eatLinea = eatM6DeLinea(pruebas);
  const prueba =
    realPrueba > 0
      ? {
          propuesto: propuestoPrueba,
          real: realPrueba,
          desvio_pct: (propuestoPrueba / realPrueba - 1) * 100,
          // 06c: con cobertura menor que 1 el EAT queda null ("sin backtesting de M6 (cubre x %)"), como en la fila.
          eat_m6: eatLinea.eat_m6,
          // Peso (0 a 1, por real del año anterior) de la línea cuyas agrupaciones traen backtesting de M6.
          eat_m6_cobertura: eatLinea.cobertura,
        }
      : null;

  // Tiendas nuevas y cierres que tocan la línea.
  const nombres = new Map<string, string>();
  for (const bl of Object.values(parametros.bloques)) for (const lista of [bl.mismas, bl.nuevas, bl.cierres, bl.fuera]) for (const t of lista) nombres.set(t.tienda_id, t.codigo);
  const deTienda = completas.data.filter((x) => x.tienda_id !== null);
  const decididaPorTienda = new Map(tiendasRows.data.map((t) => [`${t.tienda_id}#${t.anio}`, t.decidido !== null]));
  const filaTiendaDb = new Map(tiendasRows.data.filter((t) => t.activo).map((t) => [claveTiendaAnio(t.tienda_id, t.anio), t]));
  // Solo cuentan los registros activos de cada año (los de un año que dejó de existir no suman ni en la barra ni en el pie).
  const modelosTienda = deTienda.map((x) => aFilaModelo({ ...x, proyeccion_fila_anios: x.proyeccion_fila_anios.filter((a) => a.activo) }, b.k, Y));
  const acumulado = new Map<string, TiendaLineaBaseApi & { tienda_id: string }>();
  deTienda.forEach((x, i) => {
    for (const r of modelosTienda[i].registros) {
      if (r.bloque === "mismas") continue;
      const clave = `${x.tienda_id}#${r.anio}`;
      const previo = acumulado.get(clave) ?? {
        tienda_id: x.tienda_id as string,
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
  });
  // `0.10.7`: cada tienda con lo que necesita la cabecera de su sección (fecha, referente, composición y total de TODA la tienda).
  const tiendasLinea: TiendaLineaApi[] = [...acumulado.values()]
    .sort((a, c) => a.anio - c.anio || a.tienda.localeCompare(c.tienda))
    .map((t) => {
      const row = filaTiendaDb.get(claveTiendaAnio(t.tienda_id, t.anio));
      const origen: OrigenComposicion = row?.origen_composicion === "referente" || row?.origen_composicion === "propia" ? row.origen_composicion : "red";
      return {
        ...t,
        fecha_apertura: row && t.bloque === "nuevas" ? row.fecha_usada : null,
        origen_composicion: origen,
        referente: row?.referente_id_usado ? (nombres.get(row.referente_id_usado) ?? null) : null,
        total_tienda: { propuesto: row?.propuesto ?? null, decidido: row?.decidido ?? null },
      };
    });

  // `0.10.7`: las filas de apertura (una por agrupación de marca de cada tienda nueva), ya leídas con la línea: no hay lectura nueva.
  const composicionS = new Map(deTienda.map((x, i) => [x.id, modelosTienda[i].composicion?.s ?? null]));
  const filasTienda = filasTiendaDeLinea(
    deTienda.map((x) => aFilaApi(x, b.catalogo, b.k, Y)).filter((x): x is NonNullable<typeof x> => x !== null),
    {
      codigoDe: (tiendaId) => nombres.get(tiendaId) ?? tiendaId.slice(0, 8),
      composicionSDe: (filaId) => composicionS.get(filaId) ?? null,
      lugarGml,
      ordenMarca: (id) => ordenMarcaDe(id, b.catalogo),
    }
  );

  // `0.10.7`: las 3 marcas de más peso de cada fila base (de `participaciones.por_marca`, ya leído) y el resto. Solo se piden a la base los
  // nombres de las marcas del top, en tandas de 100.
  const paraMarcas = apis.flatMap((api, i) => (api ? [{ api, participaciones: modelos[i].participaciones }] : []));
  const nombresMarca = await leerNombresMarcas(d, paraMarcas.flatMap((x) => marcasQueNecesitanNombre(x.participaciones)));
  if (nombresMarca.error) return fallaDb(nombresMarca.error, "proyección: leer los nombres de marca");
  const tiendasMismas = parametros.bloques[Y]?.mismas.length ?? 0;
  const marcas: MarcasDeFilaApi[] = paraMarcas.map((x) => marcasDeFilaApi(x.api, x.participaciones, nombresMarca.data, tiendasMismas));

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
    filas_tienda: filasTienda,
    marcas,
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
  const crec = await crecimientoDeLectura(d, b);
  if (crec.respuesta) return falla(crec.respuesta);
  const api = aFilaApi(r.data, b.catalogo, b.k, b.p.anio_en_curso, crec.data);
  if (!api) return fallaMensaje("Fila no encontrada.", 404);
  const m = aFilaModelo(r.data, b.k, b.p.anio_en_curso);
  return listo({
    ...api,
    historico: m.historico && (m.historico as HistoricoFila).anios ? m.historico : null,
    curva: m.curva,
    curva_origen: m.curva_origen,
    factores_mes: m.factores_mes,
    participaciones: m.participaciones,
    anios: aAniosApi(m, b.p.anio_en_curso, crec.data),
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
  // `0.10.7`: suma de lo vigente de las filas de cada tienda y cuántas están fijadas a mano; columnas ligeras, sin `historico`, y las filas no viajan.
  const filasDeTiendas = await leerFilasConAnios(d, id, { columnas: "ligeras", soloTiendas: true, soloActivas: true });
  if (filasDeTiendas.error) return fallaDb(filasDeTiendas.error, "proyección: leer las filas de las tiendas");
  const resumenes = resumenFilasDeTienda(filasDeTiendas.data);
  const elegidas = tiendas.data.filter((t) => t.activo && (q.anio === undefined || t.anio === q.anio) && (q.bloque === undefined || t.bloque === q.bloque));
  // `0.10.8` (07d): `escala` lleva `F`, que sale de la composición y las curvas de las filas de la tienda. Solo se leen las de las aperturas con `V`
  // (columnas completas, pero sin `historico`: las filas de tienda no lo traen) y una sola vez por tienda.
  const fracciones = new Map<string, number | null>();
  for (const t of elegidas) {
    if (t.bloque !== "nuevas" || t.subbloque !== "aperturas" || t.venta_esperada_usada === null || fracciones.has(t.tienda_id)) continue;
    const delaTienda = await leerFilasConAnios(d, id, { columnas: "completas", tiendaId: t.tienda_id, soloActivas: true });
    if (delaTienda.error) return fallaDb(delaTienda.error, "proyección: leer las filas de la tienda");
    const info = { codigo: "", nombre: "", fecha_apertura: t.fecha_usada, fecha_cierre: null, venta_esperada: t.venta_esperada_usada, referente_codigo: null };
    const rampa = Array.isArray(t.rampa) ? (t.rampa as unknown[]).map(Number) : parametros.rampa_maduracion;
    fracciones.set(t.tienda_id, fraccionDeTienda(delaTienda.data.map((f) => aFilaModelo(f, b.k, b.p.anio_en_curso)), info, rampa));
  }
  const salida = elegidas
    .map((t) => aTiendaApi(t, [], b.catalogo, parametros, b.p, resumenes.get(claveTiendaAnio(t.tienda_id, t.anio)), fracciones.get(t.tienda_id)))
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
