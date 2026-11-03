import { asignarMeta, planMeta, type FilaMeta } from "@/lib/ia/meta";
import { aplicarDecision, armarRegistro, recalcularBaseSiguiente, registroDe, type ContextoModelo } from "@/lib/proyeccion/decision";
import { motivoRechazoCerrar } from "@/lib/proyeccion/reglas";
import type { CurvaOrigen, FilaModelo } from "@/lib/proyeccion/tipos";
import type { ItemLote } from "@/lib/aprobacion/esquemas";
import type { FilaPlan, GMPlan, IaFilaPlan, PropuestaFilaRef, RegistroPlan } from "@/lib/aprobacion/plan";
import { filasMetaA, OPCIONES_META } from "./ia.fixture";

/**
 * Fixture sintético de la aprobación en bloque (ficha 07g, §5.3). Ninguna marca, tienda ni cifra reales: nombres inventados y cifras del ejemplo A de 07e
 * (HOMBRE · URBANO 2027, `g = 8 %` sobre corregida, umbral 100; `Meta_GM = 26 006`; libres f1, f2 y f3; fijas f4 decidida en 3 300 y f5 de cola larga en 86).
 */

export const Y = 2026;
export const Y1 = 2027;
export const K = 9;
export const UMBRAL = 100;

export const uuid = (n: string): string => `00000000-0000-4000-8000-${n.padStart(12, "0")}`;
export const IDS = ["f1", "f2", "f3", "f4", "f5"] as const;
export type IdFila = (typeof IDS)[number];
/** `fila_id` de cada fila (uuid válidos: los esquemas los exigen). */
export const F: Record<IdFila, string> = { f1: uuid("f001"), f2: uuid("f002"), f3: uuid("f003"), f4: uuid("f004"), f5: uuid("f005") };
/** `ia_propuestas_filas.id` de cada fila en la propuesta vigente. */
export const PF: Record<IdFila, string> = { f1: uuid("e001"), f2: uuid("e002"), f3: uuid("e003"), f4: uuid("e004"), f5: uuid("e005") };
export const PGM = uuid("c001");
export const PGM_VIEJA = uuid("c0ff");
export const LOTE = (n: number): string => uuid(`1${String(n).padStart(3, "0")}`);
export const CONF = (n: number): string => uuid(`2${String(n).padStart(3, "0")}`);
/** Filas del GM sin IA (NIÑA · CASUAL del ejemplo L) y de otro GM con IA. */
export const FN = uuid("f0a1");
export const GM_A = "gm-hombre-urbano";
export const GM_B = "gm-nina-casual";
export const SELLO = "2026-11-03 10:00:00.123456+00";
export const CLAVE: Record<IdFila, string> = { f1: "k1", f2: "k2", f3: "k3", f4: "k4", f5: "k5" };
export const idDe = (f: string): IdFila => (IDS.find((i) => F[i] === f) ?? "f1") as IdFila;

const REG_ID = (f: IdFila, anio: number): string => uuid(`a${f.slice(1)}${String(anio).slice(2)}`);

/**
 * `filaBloqueaCierre` de la ficha (D1) sin duplicar la regla: se obtiene de `motivoRechazoCerrar`, que es la que manda hoy (R2). Con una sola fila base
 * sin decidir, `filas_sin_decidir` dice si bloquea y por qué motivo.
 */
export function motivoCierreDe(r: { propuesto: number | null; decidido: number | null; avisos?: string[] }, anio: number = Y1, umbral: number = UMBRAL): "umbral" | "revision_cola_larga" | null {
  const res = motivoRechazoCerrar({
    estado: "en_trabajo",
    calculandoDesde: null,
    ahora: "2026-11-03T10:00:00.000Z",
    anioEnCurso: Y,
    filasBase: [{ clave: "x", anios: { [anio]: { clave: "x", propuesto: r.propuesto, decidido: r.decidido, avisos: r.avisos ?? [] } } }],
    tiendas: [],
    desactualizada: false,
    forzar: false,
    umbralColaLarga: umbral,
  });
  if (res.ok) return null;
  return res.filas_sin_decidir?.[0]?.motivo ?? null;
}

export const registro = (f: IdFila, anio: number, o: Partial<RegistroPlan> = {}): RegistroPlan => ({
  id: REG_ID(f, anio),
  updated_at: SELLO,
  activo: true,
  vendido: 0,
  propuesto: null,
  decidido: null,
  crecimiento_pct: null,
  decision_lote_id: null,
  ...o,
});

export function filaPlan(id: string, clave: string, gm: string, reg: RegistroPlan | null, o: Partial<FilaPlan> = {}, anio: number = Y1): FilaPlan {
  return {
    fila_id: id,
    clave,
    gm_clave: gm,
    activa: true,
    es_base: true,
    registro: reg,
    motivo_cierre: reg ? motivoCierreDe(reg, anio) : null,
    ia: null,
    lectura: [],
    ...o,
  };
}

export const iaFila = (f: IdFila, o: Partial<IaFilaPlan> = {}): IaFilaPlan => ({
  propuesta_fila_id: PF[f],
  estado_meta: "libre",
  valor: null,
  natural: null,
  confianza: "alta",
  avisos: [],
  ...o,
});

// ─── Ejemplo A en 2027 ───

/** Naturales y confianza que guardó la propuesta de IA del ejemplo A (07e). */
export const NATURAL: Record<IdFila, number> = { f1: 10300, f2: 6600, f3: 5100, f4: 3100, f5: 80 };
export const CONFIANZA: Record<IdFila, "alta" | "media" | "baja"> = { f1: "alta", f2: "media", f3: "alta", f4: "alta", f5: "media" };
/** Pesos del modelo (`meta_y1_modelo`) de las tres libres. */
export const PESOS_MODELO: Record<string, number> = { f1: 11000, f2: 6700, f3: 5000 };
/** Lo que la IA da al ejemplo A con las tres libres: 10 961 · 6 677 · 4 982. */
export const A_EJEMPLO: Record<"f1" | "f2" | "f3", number> = { f1: 10961, f2: 6677, f3: 4982 };

/**
 * Lo que daría `lecturaDelGM` (una sola `asignarMeta`) con las filas de hoy. `comoLibres` son las filas que se reaprueban (§3.5, `libre_en_bloque`): se tratan
 * como libres aunque tengan decidido. Devuelve `fila_id → A_f` de las libres y la meta.
 */
export function valoresIaGM(filas: readonly FilaMeta[], comoLibres: readonly string[] = [], pesos: Record<string, number | null> = PESOS_MODELO) {
  const efectivas = filas.map((f) => (comoLibres.includes(f.fila_id) ? { ...f, decidido: null, vigente: f.propuesto } : f));
  const plan = planMeta({ filas: efectivas, g: 8, sobre_base: "corregida", fuente: "gm", crecimiento_id: "c1", version: 2, opciones: OPCIONES_META });
  const a = asignarMeta(
    plan.meta?.meta_libre ?? null,
    plan.libres.map((f) => ({ fila_id: f.fila_id, clave: f.clave, p_gm: plan.p_gm.get(f.fila_id) ?? 0, meta_y1_modelo: pesos[f.fila_id] ?? null, natural_y1: null, base_s: f.base_corregida }))
  );
  return { plan, a: a.a };
}

export type Escenario = {
  filas: Map<string, FilaPlan>;
  gms: Map<string, GMPlan>;
  propuestasFila: Map<string, PropuestaFilaRef>;
};

/** Lectura de un GM: los registros base de los dos años con su `updated_at`. */
const lecturaA = () => IDS.flatMap((f) => [Y, Y1].map((anio) => ({ id: REG_ID(f, anio), updated_at: SELLO })));

/**
 * El ejemplo A en 2027 como lo entrega el servicio: tres libres con cifra de IA (f1, f2 y f3), f4 decidida a mano, f5 de cola larga. `ia` de cada una trae la
 * cifra de HOY que `lecturaDelGM` calculó de una sola foto.
 */
export function escenarioA2027(o: { filasMeta?: FilaMeta[]; comoLibres?: string[]; conf?: Partial<Record<IdFila, "alta" | "media" | "baja" | null>>; modo?: GMPlan["modo"] } = {}): Escenario {
  const meta = o.filasMeta ?? filasMetaA();
  const { plan, a } = valoresIaGM(meta, o.comoLibres ?? []);
  const filas = new Map<string, FilaPlan>();
  for (const f of meta) {
    const id = f.fila_id as IdFila;
    const estado = plan.estados.get(id) ?? "sin_base";
    const reg = registro(id, Y1, { propuesto: f.propuesto, decidido: f.decidido, vendido: 0 });
    const valorIa = estado === "libre" ? (a?.get(id) ?? null) : null;
    filas.set(
      F[id],
      filaPlan(F[id], CLAVE[id], GM_A, reg, {
        ia: iaFila(id, {
          estado_meta: estado,
          valor: valorIa,
          natural: NATURAL[id],
          confianza: o.conf && id in o.conf ? (o.conf[id] ?? null) : CONFIANZA[id],
        }),
      })
    );
  }
  const gms = new Map<string, GMPlan>([[GM_A, { gm_clave: GM_A, modo: o.modo ?? "con_ia", propuesta_gm_id: PGM, lectura: lecturaA() }]]);
  const propuestasFila = new Map<string, PropuestaFilaRef>(IDS.map((i) => [PF[i], { fila_id: F[i], propuesta_gm_id: PGM }]));
  return { filas, gms, propuestasFila };
}

/** Cambia un campo de una fila del escenario (devuelve el mismo escenario). */
export function con(e: Escenario, id: IdFila | string, cambio: { registro?: Partial<RegistroPlan>; plan?: Partial<FilaPlan>; ia?: Partial<IaFilaPlan> | null }): Escenario {
  const clave = id in F ? F[id as IdFila] : id;
  const f = e.filas.get(clave);
  if (!f) throw new Error(`Sin fila ${id}`);
  e.filas.set(clave, {
    ...f,
    ...(cambio.registro && f.registro ? { registro: { ...f.registro, ...cambio.registro } } : {}),
    ...(cambio.ia === null ? { ia: null } : cambio.ia && f.ia ? { ia: { ...f.ia, ...cambio.ia } } : {}),
    ...cambio.plan,
  });
  return e;
}

export const itemIa = (id: IdFila, valor: number, extra: Partial<ItemLote> = {}): ItemLote => ({ fila_id: F[id], fuente: "ia", valor_esperado: valor, propuesta_fila_id: PF[id], ...extra });
export const itemMetodo = (id: IdFila | string, valor: number, extra: Partial<ItemLote> = {}): ItemLote => ({ fila_id: id in F ? F[id as IdFila] : id, fuente: "metodo", valor_esperado: valor, ...extra });

/** Las tres libres de IA con sus cifras del ejemplo. */
export const itemsIaA = (valores: Record<"f1" | "f2" | "f3", number> = A_EJEMPLO): ItemLote[] => (["f1", "f2", "f3"] as const).map((i) => itemIa(i, valores[i]));

// ─── Ejemplo K / M′ en memoria (FilaModelo + aplicarDecision con B2) ───

export const CTX_MODELO: ContextoModelo = {
  anio: Y,
  k: K,
  crecimiento_pct_defecto: 8,
  umbral_cola_larga: UMBRAL,
  rampa_maduracion: [1, 1, 1],
  nombresCurva: new Map(),
  mismasSiguiente: new Set(),
  tiendas: new Map(),
};

export const CURVA_PLANA = Array.from({ length: 12 }, () => 1 / 12);
export const CURVA_INVIERNO = [0.02, 0.02, 0.06, 0.12, 0.2, 0.24, 0.16, 0.08, 0.04, 0.02, 0.02, 0.02];
export const ORIGEN_V1: CurvaOrigen[] = [{ agrupacion_id: "ag-plana", curva_id: "cv-1", version: 1, peso: 1 }];
export const ORIGEN_V2: CurvaOrigen[] = [{ agrupacion_id: "ag-plana", curva_id: "cv-1", version: 2, peso: 1 }];
const UNOS = Array.from({ length: 12 }, () => 1);
export const PHI_INVIERNO = [1, 1, 1, 1, 1, 0.8, 0.8, 0.8, 1, 1, 1, 1];

/** Una fila base con su registro de `Y` (propuesta `propuestoY`, real de los primeros `K` meses) y el de `Y+1` que B2 calcula con `g = 8 %`. */
export function filaModelo(o: {
  clave: string;
  propuestoY: number;
  curva?: number[];
  origen?: CurvaOrigen[];
  phiY?: number[];
  /** Real de los `K` primeros meses; por defecto, el 60 % de `propuestoY` repartido parejo. */
  real?: number[];
}): FilaModelo {
  const curva = o.curva ?? CURVA_PLANA;
  const phi = o.phiY ?? UNOS;
  const origen = o.origen ?? [];
  const real = o.real ?? Array.from({ length: K }, () => Math.round((o.propuestoY * 0.6) / K));
  const reg = armarRegistro(
    { anio: Y, bloque: "mismas", subbloque: null, vendido: real.reduce((a, b) => a + b, 0), propuesto: o.propuestoY, metodo: "avance", referencia_alternativa: null, referencia_tres_meses: null, explicacion: "", avance: null, avisos: [] },
    null,
    { anio: Y, anioEnCurso: Y, k: K, curva, curva_origen: origen, phi, real: [...real, 0, 0, 0] }
  );
  const fila: FilaModelo = {
    clave: o.clave,
    tienda_id: null,
    gml_id: "gml-1",
    equivalencia_id: null,
    agrupacion_marca_id: "am-1",
    nivel: "GML",
    agrupacion_estacionalidad_id: null,
    temporada: null,
    curva,
    curva_origen: origen,
    factores_mes: { [Y]: phi, [Y1]: UNOS },
    historico: null,
    participaciones: null,
    composicion: null,
    avisos: [],
    activo: true,
    registros: [reg],
  };
  return recalcularBaseSiguiente(fila, [], CTX_MODELO);
}

/** El ejemplo A completo en memoria: f1 · f2 · f3 con propuesta 2026 de K, f4 con decidido 3 300 en 2027 y f5 de cola larga. */
export function filasModeloA(): Map<string, FilaModelo> {
  const m = new Map<string, FilaModelo>();
  m.set(F.f1, filaModelo({ clave: CLAVE.f1, propuestoY: 10000 }));
  m.set(F.f2, filaModelo({ clave: CLAVE.f2, propuestoY: 6000 }));
  m.set(F.f3, filaModelo({ clave: CLAVE.f3, propuestoY: 4000, phiY: Array.from({ length: 12 }, () => 0.8) }));
  m.set(F.f4, aplicarDecision(filaModelo({ clave: CLAVE.f4, propuestoY: 3000 }), [], Y1, { decidido: 3300, origen: "manual" }, CTX_MODELO));
  m.set(F.f5, filaModelo({ clave: CLAVE.f5, propuestoY: 80 }));
  return m;
}

/** φ con efecto en los meses que faltan (10 a 12) y una curva nueva que los reparte distinto: aprobar de nuevo un registro `curva_cambio` mueve `B'`. */
export const PHI_FIN = [1, 1, 1, 1, 1, 1, 1, 1, 1, 0.8, 1, 1.2];
export const CURVA_NUEVA = [0.14, 0.12, 0.08, 0.04, 0.03, 0.02, 0.02, 0.03, 0.08, 0.12, 0.14, 0.18];

/**
 * Una fila aprobada con la curva v1 y que después recibió la curva v2: su registro de `Y` queda con `curva_cambio` (conserva los meses de la curva vieja y guarda
 * los nuevos en `meses_propuestos`) y su `Y+1` sigue calculado con los meses viejos. Volver a aprobarla (reaprobar) reparte con la curva nueva y mueve `Y+1`.
 */
export function filaConCurvaCambio(clave: string, propuestoY = 4000): FilaModelo {
  const v1 = aplicarDecision(filaModelo({ clave, propuestoY, curva: CURVA_PLANA, origen: ORIGEN_V1, phiY: PHI_FIN }), [], Y, { decidido: propuestoY, origen: "propuesta" }, CTX_MODELO);
  const rY = registroDe(v1, Y);
  if (!rY || rY.meses === null) throw new Error("fixture: sin meses");
  const nuevo = armarRegistro(
    { ...rY, avisos: [] },
    { decidido: rY.decidido, origen: rY.origen, nota: null, propuesta_al_decidir: rY.propuesta_al_decidir, crecimiento_pct: null, decidido_por_nombre: null, decidido_at: null, meses: rY.meses, curva_origen_usada: ORIGEN_V1 },
    { anio: Y, anioEnCurso: Y, k: K, curva: CURVA_NUEVA, curva_origen: ORIGEN_V2, phi: PHI_FIN, real: [...rY.meses.slice(0, K), 0, 0, 0] }
  );
  return { ...v1, curva: CURVA_NUEVA, curva_origen: ORIGEN_V2, registros: v1.registros.map((r) => (r.anio === Y ? nuevo : r)) };
}
