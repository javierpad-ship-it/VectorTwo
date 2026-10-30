import { hastaPorDefecto } from "@/lib/curvas/anios";
import { ultimoMesCerrado } from "@/lib/ventas/periodo";
import type { PeriodoParaClase } from "@/lib/curvas/atipicos";
import type { PeriodoEfectoApi } from "@/lib/curvas/tipos-api";
import { huellaTemporada } from "@/lib/curvas/huellas";
import type { ContextoCalculo } from "@/lib/proyeccion/contexto";
import type { Catalogo } from "@/lib/proyeccion/persistencia";
import type { Tables } from "@/lib/supabase/database.types";
import type { NodoProy, TemporadaFactor, TiendaProy } from "@/lib/proyeccion/tipos";
import { estado as baseFalsa, sembrar } from "./proyeccion.fake-db";
import { AM, GEN, MUN, agrupaciones, configFlujo, factores, hechosBase, meses, nodos, periodos, tiendas, vigentes, type Hecho } from "./proyeccion.fixture";

/**
 * El contexto que `servicio.ts` lee de M1 a M6, fabricado con el fixture sintético. Es mutable para que cada caso cambie lo que
 * necesite (una curva nueva, un factor, más nodos para forzar varias tandas).
 */

export const contexto = {
  hechos: [] as Hecho[],
  vigentes: vigentes(),
  factores: factores(),
  /** Nodos de relleno (sin venta) para que la lectura de venta salga en varias tandas. */
  nodosExtra: 0,
  publicadaAt: "2026-09-28T10:00:00.000Z",
  mesesPublicados: meses("2023-01", "2026-09"),
  obsoletas: 0,
  /** Lo que devuelve `calcularEfectoNino` (`null` = sin datos). */
  efectoNino: null as unknown,
  /** `gml_id → mundo_id` vigente en el árbol (un nodo que cambió de mundo después de calcular); vacío = el del fixture. */
  nodoMundo: {} as Record<string, string>,
  /** Cambios sobre las tiendas del fixture (por id), p. ej. la venta esperada de una tienda que ya abrió. */
  tiendasExtra: {} as Record<string, Partial<TiendaProy>>,
  /** M12: `huella_flujo` de hoy (la configuración de 02b); un test la cambia para simular que se movió una marca relevante. `null` = sin configuración leída. */
  huellaFlujo: "huella-flujo-de-prueba" as string | null,
  /** 0.12.1 (06d): ids de los géneros detallados (HOMBRE y MUJER); un test los recorta para probar que un género fuera de la lista exige el Resto. */
  generosMatriz: [GEN.hombre, GEN.mujer] as string[],
  /**
   * 06e (B2): lo que se sabe HOY de las cargas y de la composición de las agrupaciones. `huellaCargas` coincide con la `huella_cargas` que `efectoNinoFalso` entrega a
   * `sincronizarFactores` (así sincronizar y evaluar sin cambios en medio da `ok`); la composición, con la que lee la base falsa (sin agrupaciones: `huellaTemporada([])`).
   * Un test las cambia para simular un mes nuevo publicado o una equivalencia remapeada DESPUÉS de sincronizar.
   */
  huellaCargas: "huella-de-prueba",
  huellasComposicion: { invierno: huellaTemporada([]), verano: huellaTemporada([]) } as Record<TemporadaFactor, string>,
  /** 06e: columnas de `factores_volumen_atipico` que un test fija sobre el factor `anio#temporada` (p. ej. `calculado_at`, `parcial`, `huella_cargas`, `aplicado_huella`). */
  factoresExtra: {} as Record<string, Partial<Tables<"factores_volumen_atipico">>>,
  /** 06e: `true` = el contexto lee los factores de la base falsa (lo que escribieron `sincronizar` y `PUT`), como el contexto real; por defecto lee `factores` a mano. */
  factoresDesdeBase: false,
  /** 06e (M6): `equivalencia_id → agrupacion_estacionalidad_id` de hoy; un test remapea una equivalencia DESPUÉS de calcular (`temporada_cambiada`). */
  eqAgrupacion: {} as Record<string, string>,
  /** Hoy en Lima (`aaaa-mm-dd`): fija el último mes cerrado (`ultimoCerrado`, `hastaDefecto`); sin llamar al reloj real. Un test lo mueve para cerrar o no un mes publicado. */
  hoy: "2026-10-15",
  /** 06e (D7): periodos atípicos de más (p. ej. uno de 2027 para probar `anio_siguiente_atipico`). */
  periodosExtra: [] as PeriodoParaClase[],
};

export function reiniciarContexto() {
  contexto.hechos = hechosBase();
  contexto.vigentes = vigentes();
  contexto.factores = factores();
  contexto.nodosExtra = 0;
  contexto.publicadaAt = "2026-09-28T10:00:00.000Z";
  contexto.mesesPublicados = meses("2023-01", "2026-09");
  contexto.obsoletas = 0;
  contexto.efectoNino = efectoNinoFalso();
  contexto.nodoMundo = {};
  contexto.tiendasExtra = {};
  contexto.huellaFlujo = "huella-flujo-de-prueba";
  contexto.generosMatriz = [GEN.hombre, GEN.mujer];
  contexto.huellaCargas = "huella-de-prueba";
  contexto.huellasComposicion = { invierno: huellaTemporada([]), verano: huellaTemporada([]) };
  contexto.factoresExtra = {};
  contexto.factoresDesdeBase = false;
  contexto.eqAgrupacion = {};
  contexto.periodosExtra = [];
  contexto.hoy = "2026-10-15";
}

/**
 * El bloque `periodo` de `efectoAtipicoCorrida` (06e §5.2) de una temporada: `ρ_P`, `κ_P` y los doce meses. `mesesPeriodo` son los meses (1 a 12) atípicos de la temporada y
 * `publicados` los publicados en el año y en la referencia; `conDato` cuántos de `P` tienen venta de referencia. Los demás meses publicados llevan un ratio neutro.
 */
export function periodoFalso(o: { rho: number | null; kappa: number | null; mesesPeriodo: number[]; publicados: number[]; fuera?: number | null }): PeriodoEfectoApi {
  const enPeriodo = (m: number) => o.mesesPeriodo.includes(m) && o.publicados.includes(m);
  const meses = Array.from({ length: 12 }, (_, i) => {
    const m = i + 1;
    const hay = o.publicados.includes(m);
    return {
      m,
      en_periodo: enPeriodo(m),
      u: hay ? 100 : 0,
      u_ref: hay ? 100 : 0,
      ratio: hay ? (enPeriodo(m) ? o.rho : 1) : null,
      control: hay ? (enPeriodo(m) ? o.kappa : 1) : null,
      relativo: hay && enPeriodo(m) && o.rho !== null && o.kappa !== null && o.kappa > 0 ? o.rho / o.kappa : hay ? 1 : null,
    };
  });
  return {
    meses_periodo: o.mesesPeriodo.length,
    meses_periodo_con_dato: meses.filter((x) => x.en_periodo).length,
    ratio_volumen: o.rho,
    ratio_control: o.kappa,
    relativo: o.rho !== null && o.kappa !== null && o.kappa > 0 ? o.rho / o.kappa : null,
    ratio_fuera: o.fuera ?? null,
    meses,
  };
}

const ENE_SET = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const TODO = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

/** El efecto del Niño por temporada y año, con las cifras del fixture (invierno 0,66 / verano 1,24 en 2026; 0,63 / 0,73 en 2023) y su bloque `periodo` (relativo = ratio ÷ control, control 1; verano 2026: solo setiembre del periodo set–dic). */
export function efectoNinoFalso() {
  const fila = (anio: number, temporada: string, ratio: number) => {
    const parcial2026 = anio === 2026;
    const periodo =
      temporada === "verano"
        ? periodoFalso({ rho: ratio, kappa: 1, mesesPeriodo: [9, 10, 11, 12], publicados: parcial2026 ? ENE_SET : TODO, fuera: 1.2 })
        : periodoFalso({ rho: ratio, kappa: 1, mesesPeriodo: TODO, publicados: parcial2026 ? ENE_SET : TODO });
    return {
      anio,
      temporada,
      ratio_volumen: ratio,
      ratio_control: 1,
      ratio_relativo: ratio,
      crecimiento_normal: 0.02,
      anio_referencia: anio - 1,
      tiendas_comunes: 8,
      meses_comparados: anio === 2026 && temporada === "verano" ? 1 : 12,
      agrupaciones: 5,
      periodo,
    };
  };
  return {
    entrada: null,
    salida: {
      efecto_atipico: {
        por_temporada: [fila(2023, "invierno", 0.6321), fila(2023, "verano", 0.7298), fila(2026, "invierno", 0.6612), fila(2026, "verano", 1.2441)],
      },
      resultado: { agrupaciones: [], temporadas: [] },
    },
    venta: { meses_publicados: meses("2023-01", "2026-09") },
    periodos: periodos().map((p) => ({ ...p, descripcion: null, temporadas: p.temporadas ?? [], created_at: "", updated_at: "" })),
    activas: [],
    hasta_periodo: "2026-09",
    huella_cargas: "huella-de-prueba",
    cacheada: false,
  };
}
reiniciarContexto();

const NOMBRE_AM: Record<string, string> = { [AM.rec]: "RECONOCIDO", [AM.pre]: "PREMIUM", [AM.val]: "VALOR" };

const NOMBRE_MUNDO: Record<string, string> = { [MUN.urbano]: "URBANO", [MUN.casual]: "CASUAL" };
/** Los nodos del fixture con el mundo vigente de `contexto.nodoMundo` aplicado (el árbol de hoy). */
const nodosVigentes = (): NodoProy[] =>
  nodos()
    .map((n) => (contexto.nodoMundo[n.gml_id] ? { ...n, mundo_id: contexto.nodoMundo[n.gml_id], mundo: NOMBRE_MUNDO[contexto.nodoMundo[n.gml_id]] ?? n.mundo } : n))
    .map((n) => ({ ...n, equivalencias: n.equivalencias.map((q) => (contexto.eqAgrupacion[q.id] ? { ...q, agrupacion_estacionalidad_id: contexto.eqAgrupacion[q.id] } : q)) }));

export function catalogoFalso(): Catalogo {
  const todos = nodosVigentes();
  return {
    nodos: new Map(
      todos.map((n) => [
        n.gml_id,
        { genero_id: n.genero_id, mundo_id: n.mundo_id, linea_id: n.linea_id, genero: n.genero, mundo: n.mundo, linea: n.linea, equivalencias: new Map(n.equivalencias.map((e) => [e.id, e.nombre])) },
      ])
    ),
    agrupacionesMarca: new Map(Object.entries(NOMBRE_AM)),
    agrupacionesEstacionalidad: new Map(agrupaciones().map((a) => [a.id, { nombre: a.nombre, temporada: a.temporada }])),
  };
}

export function contextoFalso(): ContextoCalculo {
  const nodosCalc: NodoProy[] = [
    ...nodosVigentes(),
    ...Array.from({ length: contexto.nodosExtra }, (_, i): NodoProy => ({
      gml_id: `relleno-${i}`,
      nivel: "GML",
      genero_id: "g-x",
      mundo_id: "m-x",
      linea_id: "l-x",
      genero: "X",
      mundo: "X",
      linea: `X${i}`,
      equivalencias: [],
    })),
  ];
  const publicados = [...contexto.mesesPublicados];
  const todosLosPeriodos = [...periodos(), ...contexto.periodosExtra];
  const periodosApi = todosLosPeriodos.map((p) => ({ ...p, descripcion: null, temporadas: p.temporadas ?? [], created_at: "2026-01-01T00:00:00Z", updated_at: "2026-09-01T00:00:00.000Z" }));
  const factoresDb = contexto.factoresDesdeBase
    ? ((baseFalsa.tablas.factores_volumen_atipico ?? []) as unknown as Tables<"factores_volumen_atipico">[])
    : contexto.factores.map((f) => ({
        id: `f-${f.anio}-${f.temporada}`,
        anio: f.anio,
        temporada: f.temporada,
        ratio_calculado: f.ratio_calculado,
        ratio_aplicado: f.ratio_aplicado,
        huella_cargas: null,
        aplicado_huella: null,
        diagnostico: null,
        formula: null,
        huella_composicion: null,
        ratio_control: null,
        ratio_volumen: null,
        calculado_at: null,
        tiendas_comunes: null,
        meses_comparados: null,
        parcial: false,
        nota: null,
        perfil_id: null,
        usuario_nombre: null,
        activo: true,
        created_at: "",
        updated_at: "",
        ...(contexto.factoresExtra[`${f.anio}#${f.temporada}`] ?? {}),
      }));
  return {
    tiendasDb: [],
    tiendas: tiendas(contexto.tiendasExtra),
    cargas: Object.fromEntries(publicados.map((m) => [m, `carga-${m}`])),
    cargasLista: publicados.map((m) => ({ id: `carga-${m}`, periodo: m, publicada_at: contexto.publicadaAt })),
    publicados,
    catalogo: catalogoFalso(),
    nodos: nodosCalc,
    agrupaciones: agrupaciones(),
    vigentesFilas: [],
    vigentes: contexto.vigentes,
    periodos: periodosApi as never,
    periodosClase: todosLosPeriodos,
    factoresDb,
    factores: factoresDb.map((f) => ({ anio: f.anio, temporada: f.temporada === "verano" ? ("verano" as const) : ("invierno" as const), ratio_calculado: f.ratio_calculado === null ? null : Number(f.ratio_calculado), ratio_aplicado: f.ratio_aplicado === null ? null : Number(f.ratio_aplicado) })),
    configFlujo: configFlujo(),
    huellaFlujo: contexto.huellaFlujo,
    generosMatriz: [...contexto.generosMatriz],
    huellaCargas: contexto.huellaCargas,
    huellasComposicion: { ...contexto.huellasComposicion },
    hoy: contexto.hoy,
    ultimoCerrado: publicados.length > 0 ? ultimoMesCerrado(contexto.hoy) : null,
    hastaDefecto: hastaPorDefecto(publicados, contexto.hoy),
  };
}

/** Venta mensual por tienda (lo que lee M6 para la red por datos). */
export function ventaTiendaFalsa() {
  const acum = new Map<string, number>();
  for (const h of contexto.hechos) {
    if (h.tienda === "CD") continue;
    const k = `${h.tienda}|${h.periodo}`;
    acum.set(k, (acum.get(k) ?? 0) + h.unidades);
  }
  return [...acum].map(([k, unidades]) => {
    const [tienda_id, periodo] = k.split("|");
    return { tienda_id, periodo, unidades };
  });
}

/**
 * `0.12.1` (06d): siembra en la base falsa los crecimientos aprobados VIGENTES (versión 1) de `anio` (el año siguiente de la proyección: 2027) para cada
 * GM del fixture más el Resto, como si alguien los hubiera aprobado en Curvas de estacionalidad. Todo cierre necesita aprobados los GM con filas base (y
 * el Resto si hay filas de otros géneros): el `beforeEach` de las pruebas de rutas la llama ANTES de crear las proyecciones (si no, quedarían
 * desactualizadas por `crecimientos_cambiados`). Sin opciones aprueba todo al 0 % (el mismo % que el Resto provisional por defecto, así las cifras no se mueven).
 *
 * - `pct`: % de todos los GM (un número) o por GM (`"HOMBRE · URBANO"`; los que falten, 0).
 * - `resto`: % del Resto, o `null` para no aprobar el Resto.
 * - `sin`: GM (por nombre) que NO se aprueban.
 * - `sobre`: `sobre_base` de las versiones (por defecto `corregida`, lo que escribe la API de 0.14.0; `bruta` = versión de antes de 0.14.0), un valor para todos o por GM
 *   (`"HOMBRE · URBANO"`; `"resto"` para el Resto). Una versión `bruta` en un GM con Niño material hay que reaprobarla para cerrar.
 * Devuelve las filas sembradas (con su `id`).
 */
export function aprobarCrecimientosFalsos(
  anio: number,
  o: { pct?: number | Record<string, number>; resto?: number | null; sin?: readonly string[]; sobre?: "bruta" | "corregida" | Record<string, "bruta" | "corregida"> } = {}
) {
  const gm = new Map<string, { genero_id: string; mundo_id: string; nombre: string }>();
  for (const n of nodos()) gm.set(`${n.genero_id}|${n.mundo_id}`, { genero_id: n.genero_id, mundo_id: n.mundo_id, nombre: `${n.genero} · ${n.mundo}` });
  const base = { anio_aplicacion: anio, version: 1, estado: "vigente", base_tipo: "ninguna", referencia: {}, usuario_nombre: "Javier de prueba", aprobada_at: "2026-10-10T12:00:00.000Z" };
  const pctDe = (nombre: string) => (typeof o.pct === "number" ? o.pct : (o.pct?.[nombre] ?? 0));
  const sobreDe = (nombre: string): "bruta" | "corregida" => (typeof o.sobre === "string" ? o.sobre : (o.sobre?.[nombre] ?? "corregida"));
  const filas: Record<string, unknown>[] = [...gm.values()]
    .filter((g) => !(o.sin ?? []).includes(g.nombre))
    .map((g) => ({ ...base, alcance: "gm", genero_id: g.genero_id, mundo_id: g.mundo_id, pct: pctDe(g.nombre), sobre_base: sobreDe(g.nombre) }));
  if (o.resto !== null) filas.push({ ...base, alcance: "resto", genero_id: null, mundo_id: null, pct: o.resto ?? 0, sobre_base: sobreDe("resto") });
  return sembrar("crecimientos_genero_mundo", filas);
}
