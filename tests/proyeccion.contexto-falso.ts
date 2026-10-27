import type { ContextoCalculo } from "@/lib/proyeccion/contexto";
import type { Catalogo } from "@/lib/proyeccion/persistencia";
import type { NodoProy, TiendaProy } from "@/lib/proyeccion/tipos";
import { sembrar } from "./proyeccion.fake-db";
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
}

/** El efecto del Niño por temporada y año, con las cifras del fixture (invierno 0,66 / verano 1,24 en 2026; 0,63 / 0,73 en 2023). */
export function efectoNinoFalso() {
  const fila = (anio: number, temporada: string, ratio: number) => ({
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
  });
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
const nodosVigentes = (): NodoProy[] => nodos().map((n) => (contexto.nodoMundo[n.gml_id] ? { ...n, mundo_id: contexto.nodoMundo[n.gml_id], mundo: NOMBRE_MUNDO[contexto.nodoMundo[n.gml_id]] ?? n.mundo } : n));

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
  const periodosApi = periodos().map((p) => ({ ...p, descripcion: null, temporadas: p.temporadas ?? [], created_at: "2026-01-01T00:00:00Z", updated_at: "2026-09-01T00:00:00.000Z" }));
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
    periodosClase: periodos(),
    factoresDb: contexto.factores.map((f) => ({
      id: `f-${f.anio}-${f.temporada}`,
      anio: f.anio,
      temporada: f.temporada,
      ratio_calculado: f.ratio_calculado,
      ratio_aplicado: f.ratio_aplicado,
      huella_cargas: null,
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
    })),
    factores: contexto.factores,
    configFlujo: configFlujo(),
    huellaFlujo: contexto.huellaFlujo,
    generosMatriz: [...contexto.generosMatriz],
    hoy: "2026-10-15",
    ultimoCerrado: "2026-09",
    hastaDefecto: publicados[publicados.length - 1] ?? null,
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
 * Devuelve las filas sembradas (con su `id`).
 */
export function aprobarCrecimientosFalsos(anio: number, o: { pct?: number | Record<string, number>; resto?: number | null; sin?: readonly string[] } = {}) {
  const gm = new Map<string, { genero_id: string; mundo_id: string; nombre: string }>();
  for (const n of nodos()) gm.set(`${n.genero_id}|${n.mundo_id}`, { genero_id: n.genero_id, mundo_id: n.mundo_id, nombre: `${n.genero} · ${n.mundo}` });
  const base = { anio_aplicacion: anio, version: 1, estado: "vigente", base_tipo: "ninguna", referencia: {}, usuario_nombre: "Javier de prueba", aprobada_at: "2026-10-10T12:00:00.000Z" };
  const pctDe = (nombre: string) => (typeof o.pct === "number" ? o.pct : (o.pct?.[nombre] ?? 0));
  const filas: Record<string, unknown>[] = [...gm.values()]
    .filter((g) => !(o.sin ?? []).includes(g.nombre))
    .map((g) => ({ ...base, alcance: "gm", genero_id: g.genero_id, mundo_id: g.mundo_id, pct: pctDe(g.nombre) }));
  if (o.resto !== null) filas.push({ ...base, alcance: "resto", genero_id: null, mundo_id: null, pct: o.resto ?? 0 });
  return sembrar("crecimientos_genero_mundo", filas);
}
