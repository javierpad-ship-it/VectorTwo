import { describe, expect, it } from "vitest";
import { asignarMeta, esAprobadaEnBloqueConIa, estadoFilaMeta, planMeta, type FilaMeta, type PesoFilaMeta } from "@/lib/ia/meta";
import { lecturaDeGM, motivoNoAceptable, type ArgsLecturaGM, type FilaHoy, type PropuestaGuardada } from "@/lib/ia/lectura-gm";
import { filaMetaDe } from "@/lib/ia/contexto-gm";
import { metaSiguienteDeGM } from "@/lib/proyeccion/matriz";
import type { FilaPlana } from "@/lib/proyeccion/matriz";
import type { FilaConAnios } from "@/lib/proyeccion/persistencia";
import { filasMetaA, fm, OPCIONES_META } from "./ia.fixture";

/**
 * 07g §3.5 (R25) · `libre_en_bloque`: una fila de 2027 decidida por un lote con traza de IA cuenta como libre al generar y al calcular `A`, no es aceptable fila por fila
 * y en la Matriz cuenta por su `decidido`. Ejemplos A1′ y M′ de la ficha (cifras sintéticas del ejemplo A de 07e).
 */

const LOTE = "lote-1";
const TRAZA = "pf-1";
const APROBADAS: Record<string, number> = { f1: 10961, f2: 6677, f3: 4982 };

/** Las cinco filas del ejemplo A con f1, f2 y f3 aprobadas en bloque por la IA (A1). `mod` ajusta alguna fila. */
function filasAprobadas(o: { lote?: string | null; traza?: string | null } = {}, mod: (f: FilaMeta) => FilaMeta = (f) => f): FilaMeta[] {
  const lote = o.lote === undefined ? LOTE : o.lote;
  const traza = o.traza === undefined ? TRAZA : o.traza;
  return filasMetaA().map((f) => (APROBADAS[f.fila_id] !== undefined ? mod({ ...f, decidido: APROBADAS[f.fila_id], vigente: APROBADAS[f.fila_id], decision_lote_id: lote, decision_ia_fila_id: traza }) : mod(f)));
}

const plan = (filas: FilaMeta[]) => planMeta({ filas, g: 8, sobre_base: "corregida", fuente: "gm", crecimiento_id: "c1", version: 2, opciones: OPCIONES_META });
const peso = (fila_id: string, clave: string, p_gm: number, modelo: number | null): PesoFilaMeta => ({ fila_id, clave, p_gm, meta_y1_modelo: modelo, natural_y1: null, base_s: null });

describe("R25 · estadoFilaMeta: libre_en_bloque se distingue de fija_decidida", () => {
  const f = (o: Partial<FilaMeta>) => fm({ fila_id: "a", clave: "a", propuesto: 5000, decidido: 5200, ...o });
  it("decidido con lote Y traza de IA = libre_en_bloque", () => {
    expect(estadoFilaMeta(f({ decision_lote_id: LOTE, decision_ia_fila_id: TRAZA }), OPCIONES_META)).toBe("libre_en_bloque");
  });
  it("solo el lote (aprobada en bloque con el método), solo la traza («Aceptar IA» de una fila) o ninguno: fija_decidida, como siempre", () => {
    expect(estadoFilaMeta(f({ decision_lote_id: LOTE, decision_ia_fila_id: null }), OPCIONES_META)).toBe("fija_decidida");
    expect(estadoFilaMeta(f({ decision_lote_id: null, decision_ia_fila_id: TRAZA }), OPCIONES_META)).toBe("fija_decidida");
    expect(estadoFilaMeta(f({}), OPCIONES_META)).toBe("fija_decidida");
    expect(estadoFilaMeta(f({ decision_lote_id: undefined, decision_ia_fila_id: undefined }), OPCIONES_META)).toBe("fija_decidida");
  });
  it("sin decidir no es libre_en_bloque aunque quede una traza vieja; sin propuesta sigue siendo sin_base; el % propio y la cola larga mandan sobre nada nuevo", () => {
    expect(estadoFilaMeta(f({ decidido: null, decision_lote_id: LOTE, decision_ia_fila_id: TRAZA }), OPCIONES_META)).toBe("libre");
    expect(estadoFilaMeta(f({ propuesto: null, decision_lote_id: LOTE, decision_ia_fila_id: TRAZA }), OPCIONES_META)).toBe("sin_base");
    expect(estadoFilaMeta(f({ decidido: null, crecimiento_pct: 3 }), OPCIONES_META)).toBe("fija_pct");
  });
  it("esAprobadaEnBloqueConIa exige las dos columnas", () => {
    expect(esAprobadaEnBloqueConIa({ decision_lote_id: LOTE, decision_ia_fila_id: TRAZA })).toBe(true);
    expect(esAprobadaEnBloqueConIa({ decision_lote_id: LOTE })).toBe(false);
    expect(esAprobadaEnBloqueConIa({ decision_ia_fila_id: TRAZA })).toBe(false);
    expect(esAprobadaEnBloqueConIa({})).toBe(false);
  });
});

describe("R25 · A1′: al calcular A cuenta como libre", () => {
  it("planMeta con f1, f2 y f3 aprobadas en bloque da la misma meta que con las tres libres: 26 006 / 3 386 / 22 620; sus aportes no son fijos", () => {
    const p = plan(filasAprobadas());
    const sinAprobar = plan(filasMetaA());
    expect(p.meta).toEqual(sinAprobar.meta);
    expect(p.meta).toMatchObject({ meta_gm: 26006, fijas: 3386, meta_libre: 22620, filas_libres: 3, filas_fijas: 2, fijas_detalle: { decididas: 3300, pct_propio: 0, cola_larga: 86 } });
    expect(p.libres.map((x) => x.fila_id)).toEqual(["f1", "f2", "f3"]);
    expect(p.aportes.has("f1") || p.aportes.has("f2") || p.aportes.has("f3")).toBe(false);
    expect([...p.aportes.keys()].sort()).toEqual(["f4", "f5"]);
  });

  it("plan.estados las deja como libre (quien reparte o genera no cambia) y plan.en_bloque dice cuáles son", () => {
    const p = plan(filasAprobadas());
    for (const id of ["f1", "f2", "f3"]) expect(p.estados.get(id)).toBe("libre");
    expect(p.estados.get("f4")).toBe("fija_decidida");
    expect(p.estados.get("f5")).toBe("fija_cola_larga");
    expect([...p.en_bloque].sort()).toEqual(["f1", "f2", "f3"]);
    expect(plan(filasMetaA()).en_bloque.size).toBe(0);
  });

  it("asignarMeta(22 620, mismos pesos) = 10 961 · 6 677 · 4 982: igual a lo aprobado, nada que reaprobar", () => {
    const p = plan(filasAprobadas());
    const a = asignarMeta(p.meta?.meta_libre ?? null, [peso("f1", "k1", 10800, 11000), peso("f2", "k2", 6480, 6700), peso("f3", "k3", 5400, 5000)]);
    expect([...(a.a ?? [])]).toEqual([["f1", 10961], ["f2", 6677], ["f3", 4982]]);
    for (const [id, v] of a.a ?? []) expect(v).toBe(APROBADAS[id]);
  });

  it("sin la marca de lote (aprobadas a mano) o sin la traza (aprobadas con el método) son fijas y el GM queda sin meta libre", () => {
    for (const o of [{ lote: null }, { traza: null }]) {
      const p = plan(filasAprobadas(o));
      expect(p.meta).toMatchObject({ meta_libre: 0, filas_libres: 0, filas_fijas: 5 });
      expect(p.en_bloque.size).toBe(0);
      for (const id of ["f1", "f2", "f3"]) expect(p.estados.get(id)).toBe("fija_decidida");
    }
  });

  it("M′: tras un cierre de mes la meta pasa a 26 546 y las tres aprobadas en bloque vuelven a recibir cifra: 11 223 · 6 836 · 5 101; f4 no se toca", () => {
    const filas = filasAprobadas({}, (f) => (f.fila_id === "f1" ? { ...f, propuesto: 11340, base: 10500, base_corregida: 10500 } : f));
    const p = plan(filas);
    expect(p.meta).toMatchObject({ meta_gm: 26546, fijas: 3386, meta_libre: 23160, filas_libres: 3 });
    const a = asignarMeta(p.meta?.meta_libre ?? null, [peso("f1", "k1", 11340, 11000), peso("f2", "k2", 6480, 6700), peso("f3", "k3", 5400, 5000)]);
    expect([...(a.a ?? [])]).toEqual([["f1", 11223], ["f2", 6836], ["f3", 5101]]);
    expect(p.aportes.get("f4")).toBe(3300);
  });
});

describe("R25 · en la Matriz cuenta por su decidido, como siempre", () => {
  const plana = (f: FilaMeta): FilaPlana =>
    ({
      id: f.fila_id,
      activo: true,
      tienda_id: null,
      anios: [{ anio: 2027, propuesto: f.propuesto, base_siguiente: f.base, base_normalizada: f.base_corregida, crecimiento_pct: f.crecimiento_pct, decidido: f.decidido, vigente: f.decidido ?? f.propuesto }],
    }) as unknown as FilaPlana;
  const fuente = { g: 8, sobre_base: "corregida" as const, fuente: "gm" as const };

  it("el desvío del GM suma lo decidido de las aprobadas en bloque (0 con las tres aprobadas) y no depende del estado `libre_en_bloque`", () => {
    const aprobadas = metaSiguienteDeGM(filasAprobadas().map(plana), 2026, fuente);
    expect(aprobadas).toMatchObject({ meta_gm: 26006, desvio_u: 0 });
    // Sin aprobar nada (el método): +60, el desvío de hoy del ejemplo.
    expect(metaSiguienteDeGM(filasMetaA().map(plana), 2026, fuente)).toMatchObject({ meta_gm: 26006, desvio_u: 60 });
    // Lo mismo si las mismas cifras se decidieron a mano (sin lote ni traza): la Matriz no distingue.
    expect(metaSiguienteDeGM(filasAprobadas({ lote: null, traza: null }).map(plana), 2026, fuente)).toEqual(aprobadas);
  });
});

describe("R25 · lectura del GM: se muestra como libre_en_bloque, con la cifra de hoy, y no es aceptable fila por fila", () => {
  const GM = { gm_clave: "gm", genero: "HOMBRE", mundo: "URBANO", es_resto: false };
  const propuesta = (): PropuestaGuardada => ({
    id: "pgm-1",
    created_at: "2026-10-30T10:00:00.000Z",
    usuario_nombre: "Ana Planner",
    proveedor: "proveedor-falso",
    modelo: "modelo-a",
    version_prompt: "v1",
    razon_gm: null,
    version_metodo: 5,
    huella_historia: "h1",
    meta: plan(filasMetaA()).meta,
    costo_usd: 0.1,
    filas: [
      { id: "pf-1", fila_id: "f1", fila_clave: "k1", estado_meta: "libre", base_corregida_al_generar: 10000, aporte_fijo_al_generar: null, natural_y1: 10300, razon_natural: null, meta_y1_modelo: 11000, meta_y1_al_generar: 10961, razon: null, banderas: [], senales: [], avisos: [], confianza: "alta" },
      { id: "pf-2", fila_id: "f2", fila_clave: "k2", estado_meta: "libre", base_corregida_al_generar: 6000, aporte_fijo_al_generar: null, natural_y1: 6600, razon_natural: null, meta_y1_modelo: 6700, meta_y1_al_generar: 6677, razon: null, banderas: [], senales: [], avisos: [], confianza: "media" },
      { id: "pf-3", fila_id: "f3", fila_clave: "k3", estado_meta: "libre", base_corregida_al_generar: 5000, aporte_fijo_al_generar: null, natural_y1: 5100, razon_natural: null, meta_y1_modelo: 5000, meta_y1_al_generar: 4982, razon: null, banderas: [], senales: [], avisos: [], confianza: "alta" },
    ],
  });
  const hoy = (f: FilaMeta): FilaHoy => ({
    fila_id: f.fila_id,
    clave: f.clave,
    linea: "DENIM",
    equivalencia: null,
    agrupacion_marca: "RECONOCIDO",
    meta: f,
    vigente_y1: f.vigente,
    decidida_y1: f.decidido !== null,
    vigente_y: null,
    decidida_y: false,
  });
  const args = (filas: FilaMeta[]): ArgsLecturaGM => ({
    gm: GM,
    filas: filas.map(hoy),
    plan: plan(filas),
    propuesta: propuesta(),
    anteriores: [],
    ultimo_intento: null,
    huella_historia_hoy: "h1",
    version_metodo_hoy: 5,
    capacidad_encendida: true,
    servicio_disponible: true,
    config: { modelo: "modelo-a", version_prompt: "v1" },
    contexto: { aperturas_y1: 0, cierres_y1: 0 },
  });

  it("A1′: las tres aprobadas en bloque salen como libre_en_bloque, con la cifra IA de hoy igual a lo aprobado, sin absorción y no aceptables", () => {
    const l = lecturaDeGM(args(filasAprobadas()));
    expect(l.resumen.estado).toBe("al_dia");
    expect(l.resumen.meta).toMatchObject({ meta_libre: 22620, filas_libres: 3 });
    for (const id of ["f1", "f2", "f3"]) {
      const x = l.porFila.get(id);
      expect(x?.estado_meta, id).toBe("libre_en_bloque");
      expect(x?.meta_y1, id).toBe(APROBADAS[id]);
      expect(x?.aceptable.y1, id).toBe(false);
      expect(x?.aceptable.motivo, id).toMatch(/aprobada en bloque/);
      expect(x?.absorbido_u, id).toBe(0);
    }
    expect(l.resumen.absorcion?.absorbido_u).toBe(0);
    expect(l.resumen.filas_y_sin_decidir).toBe(3);
  });

  it("mezcla: una fila libre de verdad sigue siendo aceptable; la aprobada en bloque, no; las otras libres absorben igual que si no se hubiera aprobado", () => {
    const filas = filasMetaA().map((f) => (f.fila_id === "f1" ? { ...f, decidido: 10961, vigente: 10961, decision_lote_id: LOTE, decision_ia_fila_id: TRAZA } : f));
    const l = lecturaDeGM(args(filas));
    expect(l.porFila.get("f1")?.estado_meta).toBe("libre_en_bloque");
    expect(l.porFila.get("f2")).toMatchObject({ estado_meta: "libre", meta_y1: 6677, aceptable: { y1: true, motivo: null } });
    expect(l.porFila.get("f3")).toMatchObject({ estado_meta: "libre", meta_y1: 4982, aceptable: { y1: true, motivo: null } });
    // f4 y f5 no están en la propuesta; la meta libre no cambió por haber aprobado f1.
    expect(l.resumen.meta).toMatchObject({ meta_libre: 22620, filas_libres: 3 });
    expect(l.resumen.absorcion?.absorbido_u).toBe(0);
  });

  it("M′: con la meta movida, la cifra de hoy de las aprobadas en bloque es la nueva (11 223 · 6 836 · 5 101): lo que «Reaprobar» escribiría", () => {
    const filas = filasAprobadas({}, (f) => (f.fila_id === "f1" ? { ...f, propuesto: 11340, base: 10500, base_corregida: 10500 } : f));
    const l = lecturaDeGM(args(filas));
    expect(l.porFila.get("f1")).toMatchObject({ estado_meta: "libre_en_bloque", meta_y1: 11223 });
    expect(l.porFila.get("f2")).toMatchObject({ estado_meta: "libre_en_bloque", meta_y1: 6836 });
    expect(l.porFila.get("f3")).toMatchObject({ estado_meta: "libre_en_bloque", meta_y1: 5101 });
  });

  it("motivoNoAceptable: libre_en_bloque lo explica con su propio texto; las fijas de siempre, con el suyo", () => {
    const base = { capacidad_encendida: true, servicio_disponible: true, estado: "al_dia" as const, meta_y1: 100 };
    expect(motivoNoAceptable({ ...base, estado_meta: "libre_en_bloque" })).toMatch(/aprobada en bloque con la IA/);
    expect(motivoNoAceptable({ ...base, estado_meta: "fija_decidida" })).toMatch(/La fila es fija/);
    expect(motivoNoAceptable({ ...base, estado_meta: "libre" })).toBeNull();
    // La IA apagada o el GM desactualizado mandan sobre el estado de la fila.
    expect(motivoNoAceptable({ ...base, capacidad_encendida: false, estado_meta: "libre_en_bloque" })).toMatch(/apagada/);
  });
});

describe("R25 · filaMetaDe pasa lote y traza de la fila de hoy", () => {
  const fila = (a: Record<string, unknown>) =>
    ({
      id: "f1",
      clave: "k1",
      proyeccion_fila_anios: [
        { anio: 2026, activo: true, avisos: [] },
        { anio: 2027, activo: true, avisos: [], propuesto: 10800, decidido: 10961, base_siguiente: 10000, base_normalizada: 10000, crecimiento_pct: null, ...a },
      ],
    }) as unknown as FilaConAnios;

  it("con decision_lote_id y decision_ia_fila_id la clasificación da libre_en_bloque; sin ellas (lectura que no las trae) da fija_decidida", () => {
    const con = filaMetaDe(fila({ decision_lote_id: LOTE, decision_ia_fila_id: TRAZA }), 2026) as FilaMeta;
    expect(con).toMatchObject({ decision_lote_id: LOTE, decision_ia_fila_id: TRAZA, decidido: 10961, vigente: 10961 });
    expect(estadoFilaMeta(con, OPCIONES_META)).toBe("libre_en_bloque");
    const sin = filaMetaDe(fila({}), 2026) as FilaMeta;
    expect(sin).toMatchObject({ decision_lote_id: null, decision_ia_fila_id: null });
    expect(estadoFilaMeta(sin, OPCIONES_META)).toBe("fija_decidida");
  });
});
