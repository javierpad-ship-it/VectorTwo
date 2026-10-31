import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { indiceMes } from "@/lib/proyeccion/calendario";
import { leerFilasConAnios, type ProyeccionDb } from "@/lib/proyeccion/consultas";
import { cargarCatalogo } from "@/lib/proyeccion/contexto";
import { crecimientoDeGMDeFoto, type CrecimientoDeGM } from "@/lib/proyeccion/matriz";
import { aFilaModelo, type Catalogo, type FilaConAnios } from "@/lib/proyeccion/persistencia";
import { cargarMatriz, falla, fallaDb, kDe, listo, parametrosDe, proyeccionOr404, type FotoCrecimientos, type Salida } from "@/lib/proyeccion/servicio-base";
import { UMBRAL_COLA_LARGA, type AvisoFila, type FilaModelo, type ParametrosProyeccion, type RegistroModelo, type ResumenProyeccion } from "@/lib/proyeccion/tipos";
import { aportesDeFila, aporteSalientesFila } from "./aportes";
import type { DatosGM, FilaDatosIa } from "./entrada";
import { comparablePct, estadisticasVenta, type RegistroVentaIa } from "./entrada";
import { huellaHistoria, type FilaParaHuellaHistoria } from "./huellas";
import { planMeta, type FilaMeta, type OpcionesMeta, type PlanMeta } from "./meta";
import type { FuenteMeta } from "@/lib/proyeccion/meta-gm";
import type { AnioRelComparable, TemporadaIa } from "./tipos";
import type { EstadoMetaFila } from "./tipos-api";

/**
 * Lo que la propuesta con IA lee de M7 (ficha 07e, §3.5 y §5.1): resuelve los GM del árbol, su fuente de meta (la FOTO de los crecimientos de la
 * proyección), la clasificación de las filas y arma los datos de entrada de un GM. Lee M7 solo por sus funciones exportadas y no escribe nada.
 */

type Db = SupabaseClient<Database>;

// ─── Clave de GM ───

/** `<genero_id>.<mundo_id>` (la clave que usa `ia_*` y las rutas). */
export const gmClaveDe = (generoId: string, mundoId: string): string => `${generoId}.${mundoId}`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Los dos ids de una clave de GM, o `null` si no tiene la forma `uuid.uuid`. */
export function leerClaveGM(clave: string): { genero_id: string; mundo_id: string } | null {
  const [g, m, resto] = clave.split(".");
  if (resto !== undefined || !g || !m || !UUID.test(g) || !UUID.test(m)) return null;
  return { genero_id: g, mundo_id: m };
}

// ─── Proyección y GM ───

export type GMCatalogo = { gm_clave: string; genero_id: string; mundo_id: string; genero: string; mundo: string; es_resto: boolean; gml_ids: string[] };

export type ProyeccionIa = {
  p: ProyeccionDb;
  /** Año en curso (`A`). */
  Y: number;
  /** Último mes cerrado. */
  k: number;
  parametros: ParametrosProyeccion;
  resumen: Partial<ResumenProyeccion> | null;
  catalogo: Catalogo;
  foto: FotoCrecimientos;
  fuenteDe: CrecimientoDeGM;
  umbral_cola_larga: number;
  /** Los GM del árbol (con al menos un nodo), ordenados por género y mundo. */
  gms: GMCatalogo[];
};

export function gmsDeCatalogo(catalogo: Catalogo, generosMatriz: ReadonlySet<string>): GMCatalogo[] {
  const porClave = new Map<string, GMCatalogo>();
  for (const [gmlId, n] of catalogo.nodos) {
    const clave = gmClaveDe(n.genero_id, n.mundo_id);
    const previo = porClave.get(clave);
    if (previo) previo.gml_ids.push(gmlId);
    else porClave.set(clave, { gm_clave: clave, genero_id: n.genero_id, mundo_id: n.mundo_id, genero: n.genero, mundo: n.mundo, es_resto: !generosMatriz.has(n.genero_id), gml_ids: [gmlId] });
  }
  return [...porClave.values()].sort((a, b) => a.genero.localeCompare(b.genero, "es") || a.mundo.localeCompare(b.mundo, "es") || (a.gm_clave < b.gm_clave ? -1 : 1));
}

/** Carga lo común de una proyección: la proyección, el árbol con sus nombres y la foto de los crecimientos. */
export async function cargarProyeccionIa(db: Db, id: string): Promise<Salida<ProyeccionIa>> {
  const pR = await proyeccionOr404(db, id);
  if (pR.respuesta) return falla(pR.respuesta);
  const p = pR.data;
  const cat = await cargarCatalogo(db);
  if (cat.respuesta) return falla(cat.respuesta);
  const foto = await cargarMatriz(db, p);
  if (foto.respuesta) return falla(foto.respuesta);
  const parametros = parametrosDe(p.parametros);
  return listo({
    p,
    Y: p.anio_en_curso,
    k: kDe(p),
    parametros,
    resumen: p.resumen as unknown as Partial<ResumenProyeccion> | null,
    catalogo: cat.data.catalogo,
    foto: foto.data,
    fuenteDe: crecimientoDeGMDeFoto({ matriz: foto.data.matriz, resto: foto.data.resto }),
    umbral_cola_larga: parametros.umbral_cola_larga ?? UMBRAL_COLA_LARGA,
    gms: gmsDeCatalogo(cat.data.catalogo, foto.data.matriz.generos),
  });
}

export type FuenteMetaIa = { g: number; sobre_base: "bruta" | "corregida"; fuente: FuenteMeta; crecimiento_id: string | null; version: number | null };

/** De dónde sale la meta de un GM en la foto de la proyección (celda del GM o Resto), con la versión aprobada que la respalda. */
export function fuenteMetaDe(pi: Pick<ProyeccionIa, "fuenteDe" | "foto">, gm: Pick<GMCatalogo, "genero_id" | "mundo_id">): FuenteMetaIa | null {
  const e = pi.fuenteDe(gm.genero_id, gm.mundo_id);
  if (!e) return null;
  const celda = `${gm.genero_id}|${gm.mundo_id}`;
  const m = pi.foto.matriz;
  if (e.fuente === "gm") return { ...e, crecimiento_id: m.ids?.get(celda) ?? null, version: m.versiones?.get(celda) ?? null };
  return { ...e, crecimiento_id: pi.foto.resto.crecimiento_id ?? null, version: pi.foto.resto.version ?? null };
}

// ─── Filas del GM ───

/** Las filas base activas del GM (sin las de tienda). */
export function filasBaseDeGM(filas: readonly FilaConAnios[], gm: Pick<GMCatalogo, "gml_ids">): FilaConAnios[] {
  const nodos = new Set(gm.gml_ids);
  return filas.filter((f) => f.tienda_id === null && f.activo && nodos.has(f.gml_id));
}

const registroDe = (f: FilaConAnios, anio: number) => f.proyeccion_fila_anios.find((a) => a.anio === anio && a.activo);
const tieneAviso = (avisos: unknown, codigo: string): boolean => Array.isArray(avisos) && avisos.includes(codigo);

/** La fila como la ve la meta (`Y+1`); `null` si no tiene registro del año siguiente. */
export function filaMetaDe(f: FilaConAnios, Y: number): FilaMeta | null {
  const sig = registroDe(f, Y + 1);
  if (!sig) return null;
  const y = registroDe(f, Y);
  const decidido = sig.decidido ?? null;
  const propuesto = sig.propuesto ?? null;
  return {
    fila_id: f.id,
    clave: f.clave,
    propuesto,
    base: sig.base_siguiente === null || sig.base_siguiente === undefined ? null : Number(sig.base_siguiente),
    base_corregida: sig.base_normalizada === null || sig.base_normalizada === undefined ? null : Number(sig.base_normalizada),
    crecimiento_pct: sig.crecimiento_pct === null || sig.crecimiento_pct === undefined ? null : Number(sig.crecimiento_pct),
    decidido,
    vigente: decidido ?? propuesto,
    revision_cola_larga: tieneAviso(sig.avisos, "revision_cola_larga") || tieneAviso(y?.avisos, "revision_cola_larga"),
  };
}

/** La fila del modelo (p. ej. de un pliegue armado en memoria) como la ve la meta, con `id` propio. */
export function filaMetaDeModelo(id: string, m: FilaModelo, Y: number): FilaMeta | null {
  const sig = m.registros.find((r) => r.anio === Y + 1);
  if (!sig) return null;
  const y = m.registros.find((r) => r.anio === Y);
  return {
    fila_id: id,
    clave: m.clave,
    propuesto: sig.propuesto,
    base: sig.base_siguiente ?? null,
    base_corregida: sig.base_normalizada ?? null,
    crecimiento_pct: sig.crecimiento_pct,
    decidido: sig.decidido,
    vigente: sig.decidido ?? sig.propuesto,
    revision_cola_larga: sig.avisos.includes("revision_cola_larga") || (y?.avisos.includes("revision_cola_larga") ?? false),
  };
}

export type PlanMetaGM = PlanMeta & { filasMeta: FilaMeta[]; fuente: FuenteMetaIa | null };

/** Meta, fijas y libres del GM con las filas de HOY (columnas ligeras bastan). */
export function planMetaDeGM(args: { pi: Pick<ProyeccionIa, "Y" | "fuenteDe" | "foto" | "umbral_cola_larga">; gm: Pick<GMCatalogo, "genero_id" | "mundo_id" | "gml_ids">; filas: readonly FilaConAnios[]; incluir_cola_larga: boolean }): PlanMetaGM {
  const filasMeta = filasBaseDeGM(args.filas, args.gm).flatMap((f) => {
    const m = filaMetaDe(f, args.pi.Y);
    return m ? [m] : [];
  });
  const fuente = fuenteMetaDe(args.pi, args.gm);
  const opciones: OpcionesMeta = { umbral_cola_larga: args.pi.umbral_cola_larga, incluir_cola_larga: args.incluir_cola_larga };
  const plan = planMeta({
    filas: filasMeta,
    g: fuente?.g ?? null,
    sobre_base: fuente?.sobre_base ?? "corregida",
    fuente: fuente?.fuente ?? "resto",
    crecimiento_id: fuente?.crecimiento_id ?? null,
    version: fuente?.version ?? null,
    opciones,
  });
  return { ...plan, filasMeta, fuente };
}

// ─── Tiendas nuevas y cierres de `Y+1` (contexto: fuera de la meta) ───

/** Unidades vigentes de `Y+1` de las filas de tienda del GM: aperturas y tiendas nuevas (`nuevas`) y cierres. Solo contexto (D5). */
export async function leerContextoTiendasGM(db: Db, proyeccionId: string, gm: Pick<GMCatalogo, "gml_ids">, Y: number): Promise<Salida<{ aperturas_y1: number; cierres_y1: number }>> {
  const r = await leerFilasConAnios(db, proyeccionId, { columnas: "ligeras", gmlIds: gm.gml_ids, soloTiendas: true, soloActivas: true });
  if (r.error) return fallaDb(r.error, "IA: leer las tiendas de la proyección");
  let aperturas = 0;
  let cierres = 0;
  for (const f of r.data) {
    const a = registroDe(f, Y + 1);
    if (!a) continue;
    const vigente = a.decidido ?? a.propuesto ?? 0;
    if (a.bloque === "nuevas") aperturas += vigente;
    else if (a.bloque === "cierres") cierres += vigente;
  }
  return listo({ aperturas_y1: aperturas, cierres_y1: cierres });
}

// ─── Datos de entrada (con la historia) ───

const SEÑALES_DE_AVISO: readonly AvisoFila[] = ["temporadas_mezcladas", "avance_bajo", "plan_anterior", "revision_cola_larga"];

/** Doce unidades por mes (enero primero) de un año del histórico. */
function mesesDeAnio(a: { meses: readonly { periodo: string; unidades: number }[] }): number[] {
  const salida = Array.from({ length: 12 }, () => 0);
  for (const m of a.meses) {
    const mes = Number(m.periodo.slice(5, 7));
    if (mes >= 1 && mes <= 12) salida[mes - 1] += m.unidades;
  }
  return salida;
}

const temporadaDe = (t: string | null, avisos: readonly AvisoFila[]): TemporadaIa => {
  if (avisos.includes("temporadas_mezcladas")) return "mixta";
  return t === "invierno" || t === "verano" ? t : "todo_el_ano";
};

/** Meses de `W12` con quiebre en la ventana de doce meses que termina en `Y-k`. */
function mesesQuiebreW12(m: FilaModelo, Y: number, k: number): number {
  const fin = indiceMes(Y, k);
  let n = 0;
  for (const a of m.historico?.anios ?? []) {
    for (const mes of a.meses) {
      const idx = indiceMes(Number(mes.periodo.slice(0, 4)), Number(mes.periodo.slice(5, 7)));
      if (idx > fin - 12 && idx <= fin && mes.quiebre) n += 1;
    }
  }
  return n;
}

/** Los factores del Niño que el cálculo usó y los meses en que alguna fila los aplica (`φ ≠ 1`), por temporada y año. */
export function ninoDeGM(parametros: Pick<ParametrosProyeccion, "factores_usados">, modelos: readonly FilaModelo[]): DatosGM["nino"] {
  const salida: DatosGM["nino"] = [];
  for (const f of parametros.factores_usados) {
    if (f.ratio === null || f.ratio === 1 || (f.temporada !== "invierno" && f.temporada !== "verano")) continue;
    const meses = new Set<number>();
    for (const m of modelos) {
      if (m.temporada !== f.temporada) continue;
      (m.factores_mes?.[f.anio] ?? []).forEach((phi, i) => {
        if (phi !== 1) meses.add(i + 1);
      });
    }
    if (meses.size > 0) salida.push({ anio: f.anio, temporada: f.temporada, meses: [...meses].sort((a, b) => a - b), factor: f.ratio });
  }
  return salida;
}

const metodoDe = (m: string): "avance" | "plan_anterior" | "otro" => (m === "avance" ? "avance" : m === "plan_anterior" ? "plan_anterior" : "otro");

/**
 * Aportes de tiendas a la base de `Y+1` de una fila (§5.1, I5): `salientes = Σ aporteSaliente(…)` sobre `historico.salientes` con
 * `cierreBase = propuesto_Y ?? decidido_Y` y `entrantes = B − vigente_Y + salientes` (identidad de `proponerSiguiente`).
 */
export function aportesDeModelo(m: Pick<FilaModelo, "historico">, regY: RegistroModelo | undefined, regS: RegistroModelo): { entrantes: number; salientes: number } {
  const salientes = aporteSalientesFila({ cierreBase: regY ? (regY.propuesto ?? regY.decidido) : null, vendidoBase: regY?.vendido ?? 0, salientes: m.historico?.salientes ?? [] });
  const base = regS.base_siguiente ?? null;
  if (base === null) return { entrantes: 0, salientes };
  const a = aportesDeFila({ base, vigenteY: regY?.vigente ?? 0, salientes });
  return { entrantes: a.entrantes, salientes: a.salientes };
}

export type ResultadoDatosGM = { datos: DatosGM; /** `clave de la fila → id de la fila` de las que viajan o se resumen (para unir cifras al volver). */ idPorClave: Map<string, string> };

/**
 * Datos de entrada de un GM (la entrada de `armarBloquesGM`): las filas base de `Y+1` con su historia, base, aportes de tiendas y señales. Cada cifra
 * la calcula el código (D17). `filas` trae las columnas completas (con `historico`); `venta` es la lectura desempaquetada de `venta_lineas_ia`.
 */
export function armarDatosGM(a: {
  pi: Pick<ProyeccionIa, "Y" | "k" | "catalogo" | "parametros" | "umbral_cola_larga">;
  gm: Pick<GMCatalogo, "genero" | "mundo" | "es_resto">;
  /** Las filas base del GM ya convertidas al modelo (con su `id`, que une la fila con la meta). */
  filas: readonly { id: string; m: FilaModelo }[];
  plan: { estados: ReadonlyMap<string, EstadoMetaFila> };
  venta: ReadonlyMap<string, readonly RegistroVentaIa[]>;
  tiendas: { aperturas_y1: number; cierres_y1: number };
}): ResultadoDatosGM {
  const { pi, gm, plan } = a;
  const { Y, k } = pi;
  const modelos: FilaModelo[] = [];
  const filasDatos: FilaDatosIa[] = [];
  const idPorClave = new Map<string, string>();
  const todosRegistros: RegistroVentaIa[] = [];
  const registrosPorLinea = new Map<string, RegistroVentaIa[]>();

  for (const { id, m } of a.filas) {
    const f = { id, clave: m.clave, gml_id: m.gml_id, equivalencia_id: m.equivalencia_id, agrupacion_marca_id: m.agrupacion_marca_id, temporada: m.temporada };
    const estado = plan.estados.get(id);
    if (estado === undefined || estado === "sin_base") continue;
    const regY: RegistroModelo | undefined = m.registros.find((r) => r.anio === Y);
    const regS: RegistroModelo | undefined = m.registros.find((r) => r.anio === Y + 1);
    if (!regS) continue;
    modelos.push(m);
    idPorClave.set(f.clave, f.id);
    const nodo = pi.catalogo.nodos.get(f.gml_id);
    const registros = [...(a.venta.get(f.clave) ?? [])];
    todosRegistros.push(...registros);
    const deLinea = registrosPorLinea.get(nodo?.linea_id ?? f.gml_id) ?? [];
    deLinea.push(...registros);
    registrosPorLinea.set(nodo?.linea_id ?? f.gml_id, deLinea);

    const meses_por_anio: Record<number, number[]> = {};
    for (const an of m.historico?.anios ?? []) meses_por_anio[an.anio] = mesesDeAnio(an);

    const base = regS.base_siguiente ?? null;
    const aportes = aportesDeModelo(m, regY, regS);
    const comparable: Partial<Record<AnioRelComparable, number | null>> = {
      "A-2": comparablePct(registros, { anioEnCurso: Y, k, anio: Y - 2 }),
      "A-1": comparablePct(registros, { anioEnCurso: Y, k, anio: Y - 1 }),
      A: comparablePct(registros, { anioEnCurso: Y, k, anio: Y }),
    };
    const estadisticas = estadisticasVenta(registros, { anioEnCurso: Y, k });
    const avisos = [...new Set([...(regY?.avisos ?? []), ...regS.avisos, ...m.avisos])].filter((x) => (SEÑALES_DE_AVISO as readonly string[]).includes(x));

    filasDatos.push({
      clave: f.clave,
      linea_id: nodo?.linea_id ?? f.gml_id,
      linea: nodo?.linea ?? "—",
      equivalencia_id: f.equivalencia_id,
      equivalencia: f.equivalencia_id ? (nodo?.equivalencias.get(f.equivalencia_id) ?? null) : null,
      agrupacion_marca_id: f.agrupacion_marca_id,
      agrupacion_marca: pi.catalogo.agrupacionesMarca.get(f.agrupacion_marca_id) ?? "—",
      temporada: temporadaDe(f.temporada, m.avisos),
      estado: estado === "libre" ? "libre" : estado === "fija_cola_larga" ? "cola_larga" : "fija",
      meses_por_anio,
      comparable_pct: comparable,
      y: { vendido: regY?.vendido ?? 0, vigente: regY?.vigente ?? null, avance: regY?.avance ?? null, metodo: metodoDe(regY?.metodo ?? "sin_propuesta"), decidido: regY?.decidido !== null && regY?.decidido !== undefined },
      y1: { base, base_corregida: regS.base_normalizada ?? null, aporte_entrantes: aportes.entrantes, aporte_salientes: aportes.salientes, fija_en: regS.vigente },
      senales: {
        meses_quiebre_w12: mesesQuiebreW12(m, Y, k),
        disponibilidad: m.historico?.cola_larga?.disponibilidad ?? null,
        meses_desde_primera_venta: estadisticas.meses_desde_primera_venta,
        meses_con_venta_24: estadisticas.meses_con_venta_24,
        factores_mes_y: m.factores_mes?.[Y] ?? null,
        avisos,
      },
    });
  }

  const comparablePorLinea: Record<string, Partial<Record<AnioRelComparable, number | null>>> = {};
  for (const [lineaId, registros] of registrosPorLinea) {
    comparablePorLinea[lineaId] = {
      "A-2": comparablePct(registros, { anioEnCurso: Y, k, anio: Y - 2 }),
      "A-1": comparablePct(registros, { anioEnCurso: Y, k, anio: Y - 1 }),
      A: comparablePct(registros, { anioEnCurso: Y, k, anio: Y }),
    };
  }

  return {
    idPorClave,
    datos: {
      genero: gm.genero,
      mundo: gm.mundo,
      es_resto: gm.es_resto,
      anio_en_curso: Y,
      ultimo_mes_cerrado: k,
      nino: ninoDeGM(pi.parametros, modelos),
      umbral_cola_larga: pi.umbral_cola_larga,
      fuera_de_meta: a.tiendas,
      comparable_gm: {
        "A-2": comparablePct(todosRegistros, { anioEnCurso: Y, k, anio: Y - 2 }),
        "A-1": comparablePct(todosRegistros, { anioEnCurso: Y, k, anio: Y - 1 }),
        A: comparablePct(todosRegistros, { anioEnCurso: Y, k, anio: Y }),
      },
      comparable_por_linea: comparablePorLinea,
      filas: filasDatos,
    },
  };
}

/** `p_grupos` de `venta_lineas_ia`: `tienda_id → clave de pertenencia`, de las claves que la proyección guardó al calcular (`parametros.bloques[Y]`). */
export function gruposDeProyeccion(parametros: Pick<ParametrosProyeccion, "bloques">, Y: number): Record<string, string> {
  const grupos: Record<string, string> = {};
  const b = parametros.bloques?.[Y];
  if (!b) return grupos;
  for (const lista of [b.mismas, b.nuevas, b.cierres, b.fuera]) for (const t of lista) grupos[t.tienda_id] = t.clave;
  return grupos;
}

// ─── Huella de la historia (caché en memoria por `(proyeccion, calculado_at)`) ───

/** La fila como la lee `huellaHistoria`: historia, vendido y avance de `Y`, curva y factores. No lleva el estado de la fila (B1). */
export function filaParaHuellaDeModelo(m: FilaModelo, Y: number): FilaParaHuellaHistoria {
  const regY = m.registros.find((r) => r.anio === Y);
  return {
    clave: m.clave,
    anios: (m.historico?.anios ?? []).map((a) => ({ anio: a.anio, meses: a.meses.map((x) => ({ periodo: x.periodo, unidades: x.unidades, atipico: x.atipico })) })),
    vendido_y: regY?.vendido ?? 0,
    avance_y: regY?.avance ?? null,
    curva_origen: m.curva_origen,
    factores_mes_y: m.factores_mes?.[Y] ?? null,
  };
}

export const filaParaHuella = (f: FilaConAnios, k: number, Y: number): FilaParaHuellaHistoria => filaParaHuellaDeModelo(aFilaModelo(f, k, Y), Y);

/** `huella_historia` de un GM a partir de sus filas base con `historico`. */
export function huellaHistoriaDeGM(filas: readonly FilaConAnios[], gm: Pick<GMCatalogo, "gml_ids">, k: number, Y: number): string {
  return huellaHistoria(filasBaseDeGM(filas, gm).map((f) => filaParaHuella(f, k, Y)));
}

const CACHE_MAX = 6;
const cacheHuellas = new Map<string, Map<string, string>>();

/** Pruebas: vacía la caché de huellas. */
export const vaciarCacheHuellas = (): void => cacheHuellas.clear();

/**
 * `huella_historia` de los GM pedidos. Todo lo que entra solo cambia con `calcular`, así que se guarda por `(proyeccion_id, calculado_at)` y no se
 * relee el `historico` en cada lectura (I10). Los GM que faltan se leen con las columnas completas: uno por uno si son pocos; si no, todas las filas.
 */
export async function huellasHistoriaDe(db: Db, pi: ProyeccionIa, gms: readonly GMCatalogo[]): Promise<Salida<Map<string, string>>> {
  const clave = `${pi.p.id}|${pi.p.calculado_at ?? ""}`;
  let guardadas = cacheHuellas.get(clave);
  if (!guardadas) {
    guardadas = new Map();
    cacheHuellas.set(clave, guardadas);
    while (cacheHuellas.size > CACHE_MAX) cacheHuellas.delete(cacheHuellas.keys().next().value as string);
  }
  const faltan = gms.filter((g) => !guardadas.has(g.gm_clave));
  if (faltan.length > 0) {
    if (faltan.length <= 3) {
      for (const g of faltan) {
        const r = await leerFilasConAnios(db, pi.p.id, { columnas: "completas", gmlIds: g.gml_ids, tiendaId: null, soloActivas: true });
        if (r.error) return fallaDb(r.error, "IA: leer la historia del género y mundo");
        guardadas.set(g.gm_clave, huellaHistoriaDeGM(r.data, g, pi.k, pi.Y));
      }
    } else {
      const r = await leerFilasConAnios(db, pi.p.id, { columnas: "completas", tiendaId: null, soloActivas: true });
      if (r.error) return fallaDb(r.error, "IA: leer la historia");
      for (const g of pi.gms) guardadas.set(g.gm_clave, huellaHistoriaDeGM(r.data, g, pi.k, pi.Y));
    }
  }
  const salida = new Map<string, string>();
  for (const g of gms) salida.set(g.gm_clave, guardadas.get(g.gm_clave) ?? huellaHistoria([]));
  return listo(salida);
}
