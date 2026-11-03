import { beforeEach, describe, expect, it, vi } from "vitest";
import { estado as base, reiniciar, estadoAprobacion, clienteAprobacionFalso, type Fila } from "./aprobacion.fake-db";
import { sembrarIa, ProveedorDinamico } from "./ia.fake-db";
import { ctxIa, reiniciarCtxIa, sembrarCorrida } from "./ia.contexto-falso";
import { GEN } from "./proyeccion.fixture";
import { CLAVE_GM, FILAS_A, sembrarConfig, sembrarGM, type EscenarioSembrado, type FilaSemilla } from "./ia.escenario";
import { valida } from "./ia.proveedor-falso";
import { aprobarCrecimientosFalsos, reiniciarContexto } from "./proyeccion.contexto-falso";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", async () => {
  const { clienteAprobacionFalso } = await import("./aprobacion.fake-db");
  return { supabaseAdmin: () => clienteAprobacionFalso() };
});
vi.mock("@/lib/proyeccion/contexto", async (original) => {
  const real = await original<typeof import("@/lib/proyeccion/contexto")>();
  const c = await import("./ia.contexto-falso");
  const falso = await import("./proyeccion.contexto-falso");
  return {
    ...real,
    cargarCatalogo: async () => ({ data: { catalogo: c.ctxIa.catalogo, equivalencias: [], nodosDb: [], generos: [] }, respuesta: null }),
    cargarContextoCalculo: async () => ({ data: falso.contextoFalso(), respuesta: null }),
  };
});
// El escenario sintético de la IA no cuadra con las tiendas, la configuración de marcas ni los factores del contexto falso, así que `desactualizadaDe` real daría tres
// motivos de ruido. Se descartan SOLO esos tres; el resto (p. ej. `recalculo_pendiente`) pasa tal cual y bloquea, como en producción (R13).
vi.mock("@/lib/proyeccion/servicio", async (original) => {
  const real = await original<typeof import("@/lib/proyeccion/servicio")>();
  const RUIDO = ["config_cambiada", "tiendas_cambiadas", "factores_cambiados"];
  return {
    ...real,
    desactualizadaDe: async (...args: Parameters<typeof real.desactualizadaDe>) => {
      const r = await real.desactualizadaDe(...args);
      return r.respuesta ? r : { data: r.data.filter((m) => !RUIDO.includes(m.codigo)), respuesta: null };
    },
  };
});
vi.mock("@/lib/ia/entorno", async () => ({ leerEntornoIa: (await import("./ia.contexto-falso")).entornoFalso }));
vi.mock("@/lib/ia/proveedores", async () => ({ adaptadorDelEntorno: (await import("./ia.contexto-falso")).adaptadorFalso, proveedoresRegistrados: () => ["openai"] }));

import { aplicarLote, leerAprobacion, leerLote, listarLotes, revertirConfirmacion, revertirLote } from "@/lib/aprobacion/servicio";
import type { LoteCuerpo } from "@/lib/aprobacion/esquemas";
import type { AprobacionApi, FilaAprobacionApi } from "@/lib/aprobacion/tipos-api";
import { pasoGM } from "@/lib/ia/servicio-pasos";
import { decidirFila } from "@/lib/proyeccion/servicio-edicion";
import type { PasoGMApi } from "@/lib/ia/tipos-api";

const ACTOR = { id: "99999999-9999-4999-8999-999999999999", nombre: "Javier" };
const filas = (t: string): Fila[] => base.tablas[t] ?? [];
let esc: EscenarioSembrado;
let n = 0;
const uuid = (p: string) => `00000000-0000-4000-8000-${p}${String(++n).padStart(11 - p.length, "0")}`.slice(0, 36);

type Cuerpo = Record<string, unknown> & { codigo?: string; bloqueos?: { codigo: string }[] };
async function ok<T>(r: Promise<{ data: T | null; respuesta: Response | null }>): Promise<T> {
  const x = await r;
  if (x.respuesta) throw new Error(`falló con ${x.respuesta.status}: ${JSON.stringify(await x.respuesta.json())}`);
  return x.data as T;
}
async function falla(r: Promise<{ data: unknown; respuesta: Response | null }>): Promise<{ status: number; cuerpo: Cuerpo }> {
  const x = await r;
  if (!x.respuesta) throw new Error("se esperaba un error");
  return { status: x.respuesta.status, cuerpo: (await x.respuesta.json()) as Cuerpo };
}

function iniciar(conIa = true) {
  esc = sembrarGM(FILAS_A);
  ctxIa.catalogo = esc.catalogo;
  return conIa ? sembrarConfig() : null;
}

async function generar(configId: string, regenerar = false) {
  ctxIa.proveedor = new ProveedorDinamico([
    valida({ version_salida: 2, filas: [
      { f: "f001", natural_y1: 10300, razon_natural: "Crece 3 %.", banderas: [], confianza: "alta" },
      { f: "f002", natural_y1: 6600, razon_natural: "Crece 10 %.", banderas: [], confianza: "media" },
      { f: "f003", natural_y1: 5100, razon_natural: "Crece 2 %.", banderas: ["nino"], confianza: "media" },
    ] }),
    valida({ version_salida: 2, razon_gm: "Se empuja DENIM.", banderas_gm: [], filas: [
      { f: "f001", meta_y1: 11000, razon: "DENIM absorbe el esfuerzo.", banderas: [] },
      { f: "f002", meta_y1: 6700, razon: "POLO queda en su natural.", banderas: [] },
      { f: "f003", meta_y1: 5000, razon: "CASACA cede.", banderas: [] },
    ] }),
  ]);
  for (const c of filas("ia_corridas")) if (c.estado === "en_curso") c.estado = "cancelada";
  const { corridaId } = sembrarCorrida(esc.proyeccionId, { configuracionId: configId, corrida: { ultima_actividad_at: new Date().toISOString(), alcance: { gms: "todos", regenerar, semilla: null } } });
  for (let i = 0; i < 6; i++) {
    const r = await pasoGM(esc.proyeccionId, corridaId, CLAVE_GM, ACTOR);
    if (r.respuesta) throw new Error(`paso falló ${r.respuesta.status}`);
    if ((r.data as PasoGMApi).siguiente === "hecho") return corridaId;
  }
  throw new Error("no terminó");
}

const get = (anio = 2027, modo: "aprobar" | "reaprobar" = "aprobar") => ok(leerAprobacion(esc.proyeccionId, { anio, modo }, ACTOR));
const porLinea = (a: AprobacionApi, linea: string): FilaAprobacionApi => a.filas.find((f) => f.linea === linea) as FilaAprobacionApi;

/** Un cuerpo de lote con los ítems de IA (o de método) de las filas pedidas, tal como los armaría la pantalla. */
function cuerpoDe(a: AprobacionApi, lineas: string[], extra: Partial<LoteCuerpo> = {}, fuentes: Record<string, "ia" | "metodo"> = {}): LoteCuerpo {
  return {
    lote_id: uuid("1"),
    confirmacion_id: uuid("2"),
    tipo: "aprobar",
    anio: 2027,
    simular: false,
    revision_confirmada: false,
    filas: lineas.map((l) => {
      const f = porLinea(a, l);
      const fuente = fuentes[l] ?? f.fuente_sugerida ?? "ia";
      return fuente === "ia"
        ? { fila_id: f.fila_id, fuente, valor_esperado: f.ia?.valor ?? 0, propuesta_fila_id: f.ia?.propuesta_fila_id as string }
        : { fila_id: f.fila_id, fuente, valor_esperado: f.metodo.valor };
    }),
    ...extra,
  } as LoteCuerpo;
}

/** Simula y aplica con la huella de la simulación. */
async function simularYAplicar(a: AprobacionApi, lineas: string[], extra: Partial<LoteCuerpo> = {}) {
  const c = cuerpoDe(a, lineas, extra);
  const sim = await ok(aplicarLote(esc.proyeccionId, { ...c, simular: true }, ACTOR));
  const real = aplicarLote(esc.proyeccionId, { ...c, huella_simulacion: sim.huella_simulacion }, ACTOR);
  return { c, sim, real };
}

const registro = (linea: string, anio = 2027): Fila => {
  const id = (() => {
    const gml = [...esc.catalogo.nodos].find(([, v]) => v.linea === linea)?.[0];
    return filas("proyeccion_filas").find((f) => f.gml_id === gml)?.id;
  })();
  return filas("proyeccion_fila_anios").find((a) => a.fila_id === id && a.anio === anio) as Fila;
};

beforeEach(() => {
  reiniciar();
  reiniciarContexto();
  reiniciarCtxIa();
  n = 0;
  aprobarCrecimientosFalsos(2027, { pct: 5, resto: 5 });
});

describe("GET …/aprobacion", () => {
  it("2027 con IA al día: las tres libres con la cifra de IA; la decidida y la cola larga no entran; el GM cuadra con su meta", async () => {
    await generar(iniciar()!.id as string);
    const a = await get();
    expect(a.bloqueos).toEqual([]);
    expect(a.editable).toBe(true);
    expect(a.ia).toMatchObject({ disponible: true, motivo: null, corrida_en_curso: false, gms_con_propuesta: 1 });
    expect(a.filas.map((f) => f.linea).sort()).toEqual(["CASACA", "DENIM", "POLO"]);
    expect(a.filas.map((f) => [f.linea, f.ia?.valor, f.metodo.valor, f.fuente_sugerida, f.badge])).toEqual(
      expect.arrayContaining([["DENIM", 10961, 10800, "ia", "ia"], ["POLO", 6677, 6480, "ia", "ia"], ["CASACA", 4982, 5400, "ia", "ia"]])
    );
    expect(a.gms[0]).toMatchObject({ gm_clave: CLAVE_GM, meta: 26006, estado_ia: "al_dia", pendientes: 3 });
    expect(a.pendientes_cierre).toMatchObject({ filas_y1: 3 });
  });

  it("R8 · IA apagada: `ia.disponible = false`, sin cifra de IA y el método con el badge «GM sin IA»", async () => {
    iniciar(false);
    const a = await get();
    expect(a.ia).toMatchObject({ disponible: false, motivo: "sin_configuracion", gms_con_propuesta: 0 });
    expect(a.filas.every((f) => f.ia === null && f.fuente_sugerida === "metodo" && f.badge === "metodo_gm_sin_ia")).toBe(true);
    expect(porLinea(a, "DENIM").metodo.valor).toBe(10800);
  });

  it("`anio_no_admitido` y 404", async () => {
    iniciar(false);
    const r = await falla(leerAprobacion(esc.proyeccionId, { anio: 2030, modo: "aprobar" }, ACTOR));
    expect(r).toMatchObject({ status: 409, cuerpo: { codigo: "anio_no_admitido" } });
    expect((await falla(leerAprobacion("00000000-0000-4000-8000-0000000fffff", { anio: 2027, modo: "aprobar" }, ACTOR))).status).toBe(404);
  });

  it("D14 · cada bloqueo se informa y quita la edición", async () => {
    iniciar(false);
    base.tablas.proyecciones[0].resumen = { version_metodo: 3 };
    const a = await get();
    expect(a.editable).toBe(false);
    expect(a.bloqueos.map((b) => b.codigo)).toContain("version_metodo");
  });
});

describe("POST …/lotes · aprobar con IA (R3, R22)", () => {
  it("simular no escribe; aplicar da lo mismo (filas, efecto y huella), deja el GM en su meta y escribe la traza del lote", async () => {
    await generar(iniciar()!.id as string);
    const a = await get();
    const { sim, real, c } = await simularYAplicar(a, ["DENIM", "POLO", "CASACA"]);
    expect(estadoAprobacion.llamadas).toBe(0);
    expect(registro("DENIM").decidido).toBeNull();
    expect(sim).toMatchObject({ simulado: true, repetido: false, lote: null });
    expect(sim.totales).toMatchObject({ pedidas: 3, aplicadas: 3, rechazadas: 0, unidades: 10961 + 6677 + 4982 });
    expect(sim.efecto_gm[0]).toMatchObject({ gm_clave: CLAVE_GM, meta_despues: 26006, desvio_despues_u: 0, total_despues: 26006 });
    const r = await ok(real);
    expect(r.repetido).toBe(false);
    expect(r.filas).toEqual(sim.filas);
    expect(r.efecto_gm).toEqual(sim.efecto_gm);
    expect(r.huella_simulacion).toBe(sim.huella_simulacion);
    expect(r.lote).toMatchObject({ id: c.lote_id, tipo: "aprobar", anio: 2027, resumen: { pedidas: 3, aplicadas: 3 }, estado: "vigente", usuario_nombre: "Javier" });
    expect(r.pendientes_cierre.filas_y1).toBe(0);
    for (const [linea, valor] of [["DENIM", 10961], ["POLO", 6677], ["CASACA", 4982]] as const) {
      expect(registro(linea)).toMatchObject({ decidido: valor, origen: "manual", decision_lote_id: c.lote_id });
      expect(registro(linea).decision_ia_fila_id).toBeTruthy();
    }
    expect(registro("BUZO").decision_lote_id ?? null).toBeNull();
    // R9/R10: el payload lleva `registros_lectura` de todo el GM (dos años de las cinco filas) y el grupo de IA con su propuesta vigente.
    const payload = estadoAprobacion.payloads[0] as { lote: Record<string, unknown>; grupos: { tipo: string; propuesta_gm_id: string; registros_lectura: unknown[]; filas: { registros: { objetivo: boolean; set: Record<string, unknown> }[] }[] }[] };
    expect(payload.grupos).toHaveLength(1);
    expect(payload.grupos[0]).toMatchObject({ tipo: "ia", propuesta_gm_id: filas("ia_propuestas_gm")[0].id });
    expect(payload.grupos[0].registros_lectura).toHaveLength(10);
    expect(payload.lote.calculado_at_esperado).toBe(base.tablas.proyecciones[0].calculado_at);
    for (const f of payload.grupos[0].filas) {
      expect(f.registros).toHaveLength(1);
      expect(Object.keys(f.registros[0].set)).not.toEqual(expect.arrayContaining(["activo", "id", "fila_id", "anio"]));
      expect(f.registros[0].set.decision_lote_id).toBe(c.lote_id);
    }
  });

  it("R20 · un solo refrescarResumen por lote (una escritura del resumen de la proyección)", async () => {
    await generar(iniciar()!.id as string);
    const a = await get();
    const { real } = await simularYAplicar(a, ["DENIM", "POLO", "CASACA"]);
    let escrituras = 0;
    base.alOperar = (t, op) => {
      if (t === "proyecciones" && op === "update") escrituras += 1;
    };
    await ok(real);
    base.alOperar = null;
    expect(escrituras).toBe(1);
  });

  it("A2 · solo dos filas deja un desvío fuera de ±1 %: pide «Revisé el resumen» (R22)", async () => {
    await generar(iniciar()!.id as string);
    const a = await get();
    const c = cuerpoDe(a, ["DENIM", "POLO"]);
    const sim = await ok(aplicarLote(esc.proyeccionId, { ...c, simular: true }, ACTOR));
    expect(sim.revision_requerida).toBe(true);
    expect(sim.efecto_gm[0].desvio_despues_u).toBe(418);
    const sin = await falla(aplicarLote(esc.proyeccionId, { ...c, huella_simulacion: sim.huella_simulacion }, ACTOR));
    expect(sin).toMatchObject({ status: 409, cuerpo: { codigo: "revision_requerida" } });
    expect(estadoAprobacion.llamadas).toBe(0);
    const con = await ok(aplicarLote(esc.proyeccionId, { ...c, huella_simulacion: sim.huella_simulacion, revision_confirmada: true }, ACTOR));
    expect(con.lote).toMatchObject({ revision_confirmada: true });
  });

  it("R22 · una huella distinta es 409 `simulacion_distinta` y no se escribe nada", async () => {
    await generar(iniciar()!.id as string);
    const a = await get();
    const c = cuerpoDe(a, ["DENIM", "POLO", "CASACA"]);
    const r = await falla(aplicarLote(esc.proyeccionId, { ...c, huella_simulacion: "0".repeat(64) }, ACTOR));
    expect(r).toMatchObject({ status: 409, cuerpo: { codigo: "simulacion_distinta" } });
    expect(estadoAprobacion.llamadas).toBe(0);
  });

  it("R9 · el mismo `lote_id` y cuerpo en serie y en paralelo: una aplicación y `repetido`; otro cuerpo, `lote_ajeno`", async () => {
    await generar(iniciar()!.id as string);
    const a = await get();
    const { c, real } = await simularYAplicar(a, ["DENIM", "POLO", "CASACA"]);
    const primero = await ok(real);
    const otra = await ok(aplicarLote(esc.proyeccionId, { ...c, huella_simulacion: primero.huella_simulacion }, ACTOR));
    expect(otra).toMatchObject({ repetido: true, lote: { id: c.lote_id } });
    expect(filas("proyeccion_lotes")).toHaveLength(1);
    expect(estadoAprobacion.llamadas).toBe(1);
    const otroCuerpo = { ...c, huella_simulacion: primero.huella_simulacion, nota: "otra" };
    expect((await falla(aplicarLote(esc.proyeccionId, otroCuerpo, ACTOR))).cuerpo.codigo).toBe("lote_ajeno");
  });

  it("R9 · dos peticiones iguales a la vez: la función las ve en serie (una escribe, la otra es `repetido`)", async () => {
    await generar(iniciar()!.id as string);
    const a = await get();
    const c = cuerpoDe(a, ["DENIM", "POLO", "CASACA"]);
    const sim = await ok(aplicarLote(esc.proyeccionId, { ...c, simular: true }, ACTOR));
    const cuerpo = { ...c, huella_simulacion: sim.huella_simulacion };
    const [x, y] = await Promise.all([aplicarLote(esc.proyeccionId, cuerpo, ACTOR), aplicarLote(esc.proyeccionId, cuerpo, ACTOR)]);
    const rs = [await ok(Promise.resolve(x)), await ok(Promise.resolve(y))];
    expect(rs.filter((r) => r.repetido)).toHaveLength(1);
    expect(filas("proyeccion_lotes")).toHaveLength(1);
    expect(registro("DENIM").decision_lote_id).toBe(c.lote_id);
  });

  it("R4 · L′: cambia una fila no seleccionada entre la foto y la función: el grupo IA entero `cambio_concurrente`, nada escrito", async () => {
    await generar(iniciar()!.id as string);
    const a = await get();
    const { real } = await simularYAplicar(a, ["DENIM", "POLO", "CASACA"]);
    estadoAprobacion.antesDeRpc = () => {
      registro("BUZO").updated_at = "2026-11-03T13:00:00.000Z";
    };
    const r = await ok(real);
    expect(r.filas.map((f) => f.codigo)).toEqual(["cambio_concurrente", "cambio_concurrente", "cambio_concurrente"]);
    expect(r.totales.aplicadas).toBe(0);
    expect(registro("DENIM").decidido).toBeNull();
    expect(r.lote?.resumen).toMatchObject({ aplicadas: 0, rechazadas: { cambio_concurrente: 3 } });
  });

  it("R4 · L: otra persona fija una fila antes de aprobar: la cifra de IA cambió y el grupo entero se rechaza (`ia_valor_cambio`, `grupo_rechazado`)", async () => {
    await generar(iniciar()!.id as string);
    const a = await get();
    await ok(decidirFila(esc.proyeccionId, porLinea(a, "DENIM").fila_id, 2027, { decidido: 11500, origen: "manual" }, ACTOR));
    const c = cuerpoDe(a, ["POLO", "CASACA"]);
    const sim = await ok(aplicarLote(esc.proyeccionId, { ...c, simular: true }, ACTOR));
    expect(sim.filas.map((f) => f.codigo).sort()).toEqual(["ia_valor_cambio", "ia_valor_cambio"]);
    expect(sim.filas.map((f) => f.valor_actual).sort()).toEqual([4752, 6368]);
    expect(sim.totales.aplicadas).toBe(0);
  });

  it("R23 · confianza baja o sin dato: ni «IA» ni «Método»; el resto del grupo queda `grupo_rechazado` (ejemplo C)", async () => {
    await generar(iniciar()!.id as string);
    const a = await get();
    const pf = filas("ia_propuestas_filas").find((f) => f.id === porLinea(a, "POLO").ia?.propuesta_fila_id) as Fila;
    pf.confianza = "baja";
    const b = await get();
    expect(porLinea(b, "POLO")).toMatchObject({ fuente_sugerida: null, excluida: "confianza_baja" });
    const comoIa = await ok(aplicarLote(esc.proyeccionId, { ...cuerpoDe(a, ["DENIM", "POLO", "CASACA"]), simular: true }, ACTOR));
    expect(comoIa.filas.map((f) => [f.fuente, f.codigo]).sort()).toEqual([["ia", "confianza_baja"], ["ia", "grupo_rechazado"], ["ia", "grupo_rechazado"]]);
    const comoMetodo = await ok(aplicarLote(esc.proyeccionId, { ...cuerpoDe(a, ["POLO"], {}, { POLO: "metodo" }), simular: true }, ACTOR));
    expect(comoMetodo.filas[0].codigo).toBe("confianza_baja");
    pf.confianza = null;
    expect(porLinea(await get(), "POLO").excluida).toBe("confianza_baja");
  });

  it("R8 · un ítem «Método» en un GM con IA se rechaza (`metodo_en_gm_con_ia`)", async () => {
    await generar(iniciar()!.id as string);
    const a = await get();
    const r = await ok(aplicarLote(esc.proyeccionId, { ...cuerpoDe(a, ["DENIM"], {}, { DENIM: "metodo" }), simular: true }, ACTOR));
    expect(r.filas[0].codigo).toBe("metodo_en_gm_con_ia");
  });

  it("R7 · la fuente «ia» en el año en curso es 409 `anio_no_admitido` del cuerpo entero", async () => {
    await generar(iniciar()!.id as string);
    const a = await get();
    const r = await falla(aplicarLote(esc.proyeccionId, { ...cuerpoDe(a, ["DENIM"]), anio: 2026, simular: true }, ACTOR));
    expect(r).toMatchObject({ status: 409, cuerpo: { codigo: "anio_no_admitido" } });
  });
});

describe("POST …/lotes · método y IA apagada (R8)", () => {
  it("N · con la IA apagada el método de 2027 se aprueba como «Método · GM sin IA»; un ítem de IA es 409 `ia_no_disponible` y nada se escribe", async () => {
    iniciar(false);
    const a = await get();
    const ia = await falla(aplicarLote(esc.proyeccionId, { ...cuerpoDe(a, ["DENIM"], {}, {}), filas: [{ fila_id: porLinea(a, "DENIM").fila_id, fuente: "ia", valor_esperado: 10800, propuesta_fila_id: uuid("3") }], simular: true }, ACTOR));
    expect(ia).toMatchObject({ status: 409, cuerpo: { codigo: "ia_no_disponible" } });
    const { sim, real } = await simularYAplicar(a, ["DENIM", "POLO", "CASACA"]);
    expect(sim.efecto_gm[0]).toMatchObject({ desvio_despues_u: 60 });
    const r = await ok(real);
    expect(r.totales).toMatchObject({ aplicadas: 3, por_fuente: { metodo: { filas: 3, unidades: 22680 }, ia: { filas: 0 } } });
    expect(registro("DENIM")).toMatchObject({ decidido: 10800, origen: "propuesta" });
    expect(registro("DENIM").decision_lote_id).toBe(r.lote?.id);
    expect(registro("DENIM").decision_ia_fila_id ?? null).toBeNull();
  });

  it("`propuesta_cambio`: la propuesta del método no es la que viste", async () => {
    iniciar(false);
    const a = await get();
    registro("DENIM").propuesto = 10900;
    const r = await ok(aplicarLote(esc.proyeccionId, { ...cuerpoDe(a, ["DENIM"]), simular: true }, ACTOR));
    expect(r.filas[0]).toMatchObject({ codigo: "propuesta_cambio", valor_actual: 10900 });
  });

  it("`ya_decidida`: lo decidido a mano no se toca (R1)", async () => {
    iniciar(false);
    const a = await get();
    await ok(decidirFila(esc.proyeccionId, porLinea(a, "DENIM").fila_id, 2027, { decidido: 11500, origen: "manual" }, ACTOR));
    const r = await ok(aplicarLote(esc.proyeccionId, { ...cuerpoDe(a, ["DENIM", "POLO"]), simular: true }, ACTOR));
    expect(r.filas.map((f) => f.codigo ?? "aplicada").sort()).toEqual(["aplicada", "ya_decidida"]);
    expect(r.filas.find((f) => f.codigo === "ya_decidida")?.valor_actual).toBe(11500);
  });

  it("IA con corrida en curso: 409 `corrida_en_curso` del cuerpo entero (R17); sin capacidades: `ia_no_disponible`", async () => {
    const cfg = iniciar()!;
    await generar(cfg.id as string);
    const a = await get();
    sembrarCorrida(esc.proyeccionId, { configuracionId: cfg.id as string, corrida: { ultima_actividad_at: new Date().toISOString() } });
    const r = await falla(aplicarLote(esc.proyeccionId, { ...cuerpoDe(a, ["DENIM"]), simular: true }, ACTOR));
    expect(r).toMatchObject({ status: 409, cuerpo: { codigo: "corrida_en_curso" } });
    expect(estadoAprobacion.llamadas).toBe(0);
    for (const c of filas("ia_corridas")) c.estado = "cancelada";
    base.tablas.ia_configuraciones[0].capacidades = [];
    const b = await falla(aplicarLote(esc.proyeccionId, { ...cuerpoDe(a, ["DENIM"]), simular: true }, ACTOR));
    expect(b).toMatchObject({ status: 409, cuerpo: { codigo: "ia_no_disponible", motivo: "sin_capacidades" } });
  });

  it("R17 · una propuesta más reciente entre la foto y la función: `ia_no_vigente` en el grupo", async () => {
    const cfg = iniciar()!;
    await generar(cfg.id as string);
    const a = await get();
    const { real } = await simularYAplicar(a, ["DENIM", "POLO", "CASACA"]);
    estadoAprobacion.antesDeRpc = () => {
      filas("ia_propuestas_gm")[0].created_at = "2020-01-01T00:00:00.000Z";
      base.tablas.ia_propuestas_gm.push({ ...filas("ia_propuestas_gm")[0], id: uuid("9"), created_at: "2030-01-01T00:00:00.000Z" });
    };
    const r = await ok(real);
    expect(r.filas.every((f) => f.codigo === "ia_no_vigente")).toBe(true);
    expect(registro("DENIM").decidido).toBeNull();
  });
});

describe("D14 · bloqueos de todo lote (R13)", () => {
  const cuerpoMetodo = async () => cuerpoDe(await get(), ["DENIM"], { simular: true });

  it("cerrada, archivada y cálculo en curso", async () => {
    iniciar(false);
    const c = await cuerpoMetodo();
    base.tablas.proyecciones[0].estado = "cerrada";
    expect((await falla(aplicarLote(esc.proyeccionId, c, ACTOR))).cuerpo.codigo).toBe("cerrada");
    base.tablas.proyecciones[0].estado = "archivada";
    expect((await falla(aplicarLote(esc.proyeccionId, c, ACTOR))).cuerpo.codigo).toBe("archivada");
    base.tablas.proyecciones[0].estado = "en_trabajo";
    base.tablas.proyecciones[0].calculando_desde = new Date().toISOString();
    expect((await falla(aplicarLote(esc.proyeccionId, c, ACTOR))).cuerpo.codigo).toBe("calculo_en_curso");
  });

  it("método viejo y desactualizada por cualquier motivo (aquí `recalculo_pendiente`), con los motivos en el cuerpo", async () => {
    iniciar(false);
    const c = await cuerpoMetodo();
    const resumen = base.tablas.proyecciones[0].resumen;
    base.tablas.proyecciones[0].resumen = { ...(resumen as object), version_metodo: 4 };
    expect((await falla(aplicarLote(esc.proyeccionId, c, ACTOR))).cuerpo.codigo).toBe("version_metodo");
    base.tablas.proyecciones[0].resumen = resumen;
    const parametros = base.tablas.proyecciones[0].parametros as Record<string, unknown>;
    base.tablas.proyecciones[0].parametros = { ...parametros, recalculo_pendiente: true };
    const r = await falla(aplicarLote(esc.proyeccionId, c, ACTOR));
    expect(r).toMatchObject({ status: 409, cuerpo: { codigo: "proyeccion_desactualizada" } });
    expect(JSON.stringify(r.cuerpo.detalle)).toContain("recalculo_pendiente");
    expect(estadoAprobacion.llamadas).toBe(0);
  });

  it("revertir no se bloquea por desactualizada (solo exige en trabajo y sin cálculo)", async () => {
    iniciar(false);
    const a = await get();
    const { real } = await simularYAplicar(a, ["DENIM", "POLO", "CASACA"]);
    const lote = (await ok(real)).lote!;
    const parametros = base.tablas.proyecciones[0].parametros as Record<string, unknown>;
    base.tablas.proyecciones[0].parametros = { ...parametros, recalculo_pendiente: true };
    const r = await ok(revertirLote(esc.proyeccionId, lote.id, { lote_id: uuid("4"), simular: false }, ACTOR));
    expect(r.totales.aplicadas).toBe(3);
  });

  it("D16 · si la proyección se recalcula entre la foto y la función: `datos_cambiaron` (LP003)", async () => {
    iniciar(false);
    const a = await get();
    const { real } = await simularYAplicar(a, ["DENIM"]);
    estadoAprobacion.antesDeRpc = () => {
      base.tablas.proyecciones[0].calculado_at = "2026-11-03T09:00:00.000Z";
    };
    expect((await falla(real)).cuerpo.codigo).toBe("datos_cambiaron");
    expect(registro("DENIM").decidido).toBeNull();
  });

  it("los errores de la función se traducen: LP001, LP002, LP004, LP005 y 40P01", async () => {
    iniciar(false);
    const a = await get();
    const { real } = await simularYAplicar(a, ["DENIM"]);
    estadoAprobacion.falloRpc = { code: "40P01", message: "deadlock" };
    expect(await falla(real)).toMatchObject({ status: 409, cuerpo: { codigo: "conflicto_reintentar" } });
    estadoAprobacion.falloRpc = { code: "LP001", message: "proyeccion_archivada" };
    const c = cuerpoDe(a, ["POLO"]);
    const sim = await ok(aplicarLote(esc.proyeccionId, { ...c, simular: true }, ACTOR));
    expect((await falla(aplicarLote(esc.proyeccionId, { ...c, huella_simulacion: sim.huella_simulacion }, ACTOR))).cuerpo.codigo).toBe("archivada");
    estadoAprobacion.falloRpc = { code: "LP002", message: "calculo_en_curso" };
    expect((await falla(aplicarLote(esc.proyeccionId, { ...c, huella_simulacion: sim.huella_simulacion }, ACTOR))).cuerpo.codigo).toBe("calculo_en_curso");
    estadoAprobacion.falloRpc = { code: "LP004", message: "lote_ajeno" };
    expect((await falla(aplicarLote(esc.proyeccionId, { ...c, huella_simulacion: sim.huella_simulacion }, ACTOR))).cuerpo.codigo).toBe("lote_ajeno");
    estadoAprobacion.falloRpc = { code: "LP007", message: "payload_invalido" };
    expect((await falla(aplicarLote(esc.proyeccionId, { ...c, huella_simulacion: sim.huella_simulacion }, ACTOR))).status).toBe(500);
  });
});

describe("revertir (R11) y reaprobar (R24)", () => {
  async function aprobarTodo() {
    await generar(iniciar()!.id as string);
    const a = await get();
    const { c, real } = await simularYAplicar(a, ["DENIM", "POLO", "CASACA"]);
    const r = await ok(real);
    return { a, c, lote: r.lote! };
  }

  it("M · revertir un lote: vuelven a sin decidir f1 y f2; la que se cambió a mano después queda `cambiada_despues`", async () => {
    const { lote } = await aprobarTodo();
    await ok(decidirFila(esc.proyeccionId, registro("CASACA").fila_id as string, 2027, { decidido: 5000, origen: "manual" }, ACTOR));
    expect(registro("CASACA").decision_lote_id ?? null).toBeNull();
    const sim = await ok(revertirLote(esc.proyeccionId, lote.id, { lote_id: uuid("5"), simular: true }, ACTOR));
    expect(sim.simulado).toBe(true);
    expect(registro("DENIM").decidido).toBe(10961);
    const r = await ok(revertirLote(esc.proyeccionId, lote.id, { lote_id: uuid("5"), simular: false }, ACTOR));
    expect(r.lote).toMatchObject({ tipo: "revertir", revierte_lote_id: lote.id, estado: null });
    expect(r.filas.map((f) => f.codigo ?? "aplicada").sort()).toEqual(["aplicada", "aplicada", "cambiada_despues"]);
    for (const l of ["DENIM", "POLO"]) expect(registro(l)).toMatchObject({ decidido: null, origen: null, decision_lote_id: null, decision_ia_fila_id: null });
    expect(registro("CASACA").decidido).toBe(5000);
    const lista = await ok(listarLotes(esc.proyeccionId));
    expect(lista.lotes.map((l) => [l.tipo, l.estado])).toEqual([["revertir", null], ["aprobar", "revertido_en_parte"]]);
    const uno = await ok(leerLote(esc.proyeccionId, lote.id));
    expect(uno).toMatchObject({ estado: "revertido_en_parte", filas_revertidas: 2 });
    expect(uno.filas).toHaveLength(3);
  });

  it("una reversión no se revierte (`no_revertible`) y un lote de otra proyección es 404", async () => {
    const { lote } = await aprobarTodo();
    const rev = await ok(revertirLote(esc.proyeccionId, lote.id, { lote_id: uuid("5"), simular: false }, ACTOR));
    expect((await falla(revertirLote(esc.proyeccionId, rev.lote!.id, { lote_id: uuid("6"), simular: false }, ACTOR))).cuerpo.codigo).toBe("no_revertible");
    expect((await falla(revertirLote(esc.proyeccionId, "00000000-0000-4000-8000-0000000fffff", { lote_id: uuid("6"), simular: false }, ACTOR))).status).toBe(404);
    expect((await falla(leerLote(esc.proyeccionId, "00000000-0000-4000-8000-0000000fffff"))).status).toBe(404);
  });

  it("revertir solo las filas marcadas y por confirmación (todas las tandas)", async () => {
    const { a, lote, c } = await aprobarTodo();
    const filaDenim = porLinea(a, "DENIM").fila_id;
    const parcial = await ok(revertirLote(esc.proyeccionId, lote.id, { lote_id: uuid("5"), filas: [filaDenim], simular: false }, ACTOR));
    expect(parcial.totales.aplicadas).toBe(1);
    expect(registro("POLO").decidido).toBe(6677);
    expect((await falla(revertirConfirmacion(esc.proyeccionId, c.confirmacion_id, { lote_ids: [], simular: false } as never, ACTOR))).status).toBe(400);
    const todo = await ok(revertirConfirmacion(esc.proyeccionId, c.confirmacion_id, { lote_ids: [uuid("7")], simular: false }, ACTOR));
    expect(todo).toHaveLength(1);
    expect(todo[0].totales).toMatchObject({ aplicadas: 2, rechazadas: 1 });
    expect(registro("POLO").decidido).toBeNull();
    expect((await falla(revertirConfirmacion(esc.proyeccionId, uuid("8"), { lote_ids: [uuid("7")], simular: false }, ACTOR))).status).toBe(404);
  });

  it("una tanda de la confirmación sin ninguna fila aplicada (la función las rechazó todas) se ignora al revertir la confirmación", async () => {
    iniciar(false);
    const a = await get();
    const primera = await simularYAplicar(a, ["DENIM", "POLO"]);
    const c = primera.c;
    const r1 = await ok(primera.real);
    expect(r1.totales.aplicadas).toBe(2);
    // Segunda tanda de la misma confirmación: entre la foto y la función alguien decide CASACA; la función rechaza la fila y el lote queda con 0 aplicadas.
    const casaca = porLinea(a, "CASACA");
    const vacia: LoteCuerpo = { lote_id: uuid("1"), confirmacion_id: c.confirmacion_id, tipo: "aprobar", anio: 2027, simular: true, revision_confirmada: true, filas: [{ fila_id: casaca.fila_id, fuente: "metodo", valor_esperado: casaca.metodo.valor }] };
    const sim = await ok(aplicarLote(esc.proyeccionId, vacia, ACTOR));
    estadoAprobacion.antesDeRpc = () => {
      Object.assign(registro("CASACA"), { decidido: 5000, origen: "manual" });
    };
    const r = await ok(aplicarLote(esc.proyeccionId, { ...vacia, simular: false, huella_simulacion: sim.huella_simulacion }, ACTOR));
    expect(r.lote?.resumen).toMatchObject({ pedidas: 1, aplicadas: 0, rechazadas: { ya_decidida: 1 } });
    const todo = await ok(revertirConfirmacion(esc.proyeccionId, c.confirmacion_id, { lote_ids: [uuid("7")], simular: false }, ACTOR));
    expect(todo).toHaveLength(1);
    expect(todo[0].totales.aplicadas).toBe(2);
  });

  it("revertir es idempotente con el mismo `lote_id`", async () => {
    const { lote } = await aprobarTodo();
    const id = uuid("5");
    await ok(revertirLote(esc.proyeccionId, lote.id, { lote_id: id, simular: false }, ACTOR));
    const otra = await ok(revertirLote(esc.proyeccionId, lote.id, { lote_id: id, simular: false }, ACTOR));
    expect(otra.repetido).toBe(true);
    expect(filas("proyeccion_lotes").filter((l) => l.tipo === "revertir")).toHaveLength(1);
  });

  it("M′ · tras un cambio de meta, «Reaprobar» ofrece las filas aprobadas en bloque con la cifra nueva y deja el desvío en 0; lo decidido a mano no aparece", async () => {
    const { lote } = await aprobarTodo();
    // La meta sube (B2 de otra fila): la propuesta de DENIM, que alimenta `P^GM`, pasa de 10 800 a 11 340.
    registro("DENIM").propuesto = 11340;
    const a = await get(2027, "reaprobar");
    expect(a.reaprobables.y1).toBe(3);
    expect(a.filas.map((f) => [f.linea, f.decidido, f.ia?.valor])).toEqual(expect.arrayContaining([["DENIM", 10961, 11223], ["POLO", 6677, 6836], ["CASACA", 4982, 5101]]));
    expect(a.filas.every((f) => f.fuente_sugerida === "ia")).toBe(true);
    const c = cuerpoDe(a, ["DENIM", "POLO", "CASACA"], { tipo: "reaprobar" });
    c.filas = c.filas.map((f, i) => ({ ...f, decidido_esperado: [10961, 6677, 4982][["DENIM", "POLO", "CASACA"].indexOf(["DENIM", "POLO", "CASACA"][i])] }));
    const sim = await ok(aplicarLote(esc.proyeccionId, { ...c, simular: true }, ACTOR));
    expect(sim.totales.aplicadas).toBe(3);
    const r = await ok(aplicarLote(esc.proyeccionId, { ...c, huella_simulacion: sim.huella_simulacion, revision_confirmada: true }, ACTOR));
    expect(r.lote).toMatchObject({ tipo: "reaprobar" });
    expect(registro("DENIM")).toMatchObject({ decidido: 11223, decision_lote_id: c.lote_id });
    expect(lote.id).not.toBe(c.lote_id);
    // Lo decidido a mano después no es reaprobable.
    await ok(decidirFila(esc.proyeccionId, registro("POLO").fila_id as string, 2027, { decidido: 7000, origen: "manual" }, ACTOR));
    registro("POLO").propuesto = 7100;
    const b = await get(2027, "reaprobar");
    expect(b.filas.map((f) => f.linea)).not.toContain("POLO");
  });
});

describe("2026 con el método (B2, D15)", () => {
  it("el lote de 2026 se aprueba con «Método», reescribe el 2027 sin columnas de decisión y la simulación informa el efecto", async () => {
    iniciar(false);
    const a = await get(2026);
    expect(a.filas.length).toBeGreaterThan(0);
    expect(a.filas.every((f) => f.fuente_sugerida === "metodo" && f.badge === "metodo" && f.ia === null)).toBe(true);
    const { sim, real } = await simularYAplicar(a, ["DENIM"], { anio: 2026 });
    // El desvío frente a la meta solo se informa en 2027; la meta de 2027 sí se mueve (aquí el escenario no tiene curva: B2 deja el 2027 sin propuesta).
    expect(sim.efecto_gm[0]).toMatchObject({ desvio_antes_u: null, desvio_despues_u: null, meta_antes: 26006 });
    expect(sim.crecimientos_a_reaprobar).toEqual([]);
    const r = await ok(real);
    expect(r.totales.aplicadas).toBe(1);
    const payload = estadoAprobacion.payloads[0] as { grupos: { tipo: string; registros_lectura: unknown[]; filas: { registros: { objetivo: boolean; set: Record<string, unknown> }[] }[] }[] };
    expect(payload.grupos[0]).toMatchObject({ tipo: "metodo", registros_lectura: [] });
    const [objetivo, siguiente] = payload.grupos[0].filas[0].registros;
    expect(objetivo).toMatchObject({ objetivo: true, set: { decidido: 9600, origen: "propuesta", decision_lote_id: r.lote?.id, decision_ia_fila_id: null } });
    // B2 reescribe el 2027 con `update` condicional por `updated_at` y SIN ninguna columna de decisión (§3.6).
    expect(siguiente.objetivo).toBe(false);
    for (const c of ["decidido", "origen", "nota", "decidido_at", "decidido_por_id", "decidido_por_nombre", "decision_ia_fila_id", "decision_lote_id", "propuesta_al_decidir", "crecimiento_pct"]) {
      expect(Object.keys(siguiente.set)).not.toContain(c);
    }
    expect(registro("DENIM", 2026)).toMatchObject({ decidido: 9600, origen: "propuesta", decision_lote_id: r.lote?.id });
    // Una decisión individual limpia la marca del lote (la hace M7, no este módulo) y entonces el lote ya no la puede revertir.
    expect(registro("DENIM", 2027).decision_lote_id ?? null).toBeNull();
  });
});


// ─── Correcciones tras QA y seguridad (H1 a H8, M2, M4, I4) ───

/** Genera la propuesta de IA con el proveedor dinámico (responde lo que pide la entrada), sobre un escenario ya sembrado. */
async function generarDinamico(configId: string) {
  ctxIa.proveedor = new ProveedorDinamico([]);
  for (const c of filas("ia_corridas")) if (c.estado === "en_curso") c.estado = "cancelada";
  const { corridaId } = sembrarCorrida(esc.proyeccionId, { configuracionId: configId, corrida: { ultima_actividad_at: new Date().toISOString(), alcance: { gms: "todos", regenerar: false, semilla: null } } });
  for (let i = 0; i < 8; i++) {
    const r = await pasoGM(esc.proyeccionId, corridaId, CLAVE_GM, ACTOR);
    if (r.respuesta) throw new Error(`paso falló ${r.respuesta.status}`);
    if ((r.data as PasoGMApi).siguiente === "hecho") return;
  }
  throw new Error("no terminó");
}

/** El GM A con una fila de % propio (método) en la posición `pos` de las cinco: la IA reparte las libres y la de % propio se aprueba con el método. */
const conPctPropio = (pos: number): FilaSemilla[] => FILAS_A.map((f, i) => (i === pos ? { ...f, crecimiento_pct: 5, P: Math.round(f.Bc * 1.05) } : f));

describe("H1 · caso mixto IA + método en el mismo GM, en ambos órdenes de id", () => {
  for (const [pos, linea] of [[0, "DENIM"], [2, "CASACA"]] as const) {
    it(`la fila con % propio es ${linea} (${pos === 0 ? "la primera" : "la tercera"} por id): las libres con IA y esa con método se aplican juntas`, async () => {
      esc = sembrarGM(conPctPropio(pos));
      ctxIa.catalogo = esc.catalogo;
      await generarDinamico(sembrarConfig().id as string);
      const a = await get();
      const sugeridas = a.filas.filter((f) => f.fuente_sugerida !== null);
      expect(sugeridas.map((f) => [f.linea, f.fuente_sugerida])).toEqual(expect.arrayContaining([[linea, "metodo"]]));
      expect(sugeridas.filter((f) => f.fuente_sugerida === "ia")).toHaveLength(2);
      const { real, c } = await simularYAplicar(a, sugeridas.map((f) => f.linea));
      const r = await ok(real);
      expect(r.filas.map((f) => f.codigo ?? "aplicada")).toEqual(["aplicada", "aplicada", "aplicada"]);
      expect(r.lote?.resumen).toMatchObject({ aplicadas: 3, por_fuente: { ia: { filas: 2 }, metodo: { filas: 1 } } });
      expect(registro(linea)).toMatchObject({ origen: "propuesta", decision_lote_id: c.lote_id });
      expect(registro(linea).decision_ia_fila_id ?? null).toBeNull();
      for (const f of sugeridas.filter((x) => x.fuente_sugerida === "ia")) expect(registro(f.linea)).toMatchObject({ origen: "manual", decision_lote_id: c.lote_id });
      // El payload lleva el grupo de IA ANTES que el de método (defensa de `armarGrupos`).
      const payload = estadoAprobacion.payloads[estadoAprobacion.payloads.length - 1] as { grupos: { tipo: string }[] };
      expect(payload.grupos.map((g) => g.tipo)).toEqual(["ia", "metodo"]);
    });
  }

  it("la función SQL verifica TODOS los `registros_lectura` contra el estado del inicio del lote: el orden de los grupos no cambia el resultado (método antes que IA)", async () => {
    esc = sembrarGM(conPctPropio(0));
    ctxIa.catalogo = esc.catalogo;
    await generarDinamico(sembrarConfig().id as string);
    const a = await get();
    const lineas = a.filas.filter((f) => f.fuente_sugerida !== null).map((f) => f.linea);
    const c = cuerpoDe(a, lineas);
    const sim = await ok(aplicarLote(esc.proyeccionId, { ...c, simular: true }, ACTOR));
    // Se captura el payload sin escribir (la función falla antes) y se manda a mano con los grupos al revés.
    estadoAprobacion.falloRpc = { code: "55P03", message: "lock_timeout" };
    await falla(aplicarLote(esc.proyeccionId, { ...c, huella_simulacion: sim.huella_simulacion }, ACTOR));
    const payload = estadoAprobacion.payloads[estadoAprobacion.payloads.length - 1] as { lote: Record<string, unknown>; grupos: unknown[] };
    expect(registro("DENIM").decidido).toBeNull();
    const alReves = { ...payload, grupos: [...payload.grupos].reverse() };
    const r = (await clienteAprobacionFalso().rpc("aplicar_lote_proyeccion", { p: alReves })) as { data: { filas: { resultado: string; fuente: string }[] }; error: unknown };
    expect(r.error).toBeNull();
    expect(r.data.filas.map((f) => f.resultado)).toEqual(["aplicada", "aplicada", "aplicada"]);
    expect(registro("DENIM")).toMatchObject({ origen: "propuesta" });
    expect(registro("POLO").decidido).not.toBeNull();
    expect(registro("CASACA").decidido).not.toBeNull();
  });

  it("un cambio de TERCEROS sigue dando `cambio_concurrente`: en una fila no seleccionada rechaza el grupo IA entero y el de método se aplica", async () => {
    esc = sembrarGM(conPctPropio(0));
    ctxIa.catalogo = esc.catalogo;
    await generarDinamico(sembrarConfig().id as string);
    const a = await get();
    const { real } = await simularYAplicar(a, a.filas.filter((f) => f.fuente_sugerida !== null).map((f) => f.linea));
    estadoAprobacion.antesDeRpc = () => {
      registro("BUZO").updated_at = "2026-11-03T13:00:00.000Z";
    };
    const r = await ok(real);
    const porFuente = (fuente: string) => r.filas.filter((f) => f.fuente === fuente).map((f) => f.codigo ?? "aplicada");
    expect(porFuente("ia")).toEqual(["cambio_concurrente", "cambio_concurrente"]);
    expect(porFuente("metodo")).toEqual(["aplicada"]);
    expect(registro("DENIM").decision_lote_id).toBe(r.lote?.id);
    expect(registro("POLO").decidido).toBeNull();
  });

  it("un tercero que cambia la fila de método antes de la función: esa fila y el grupo IA (que la lee) dan `cambio_concurrente`", async () => {
    esc = sembrarGM(conPctPropio(0));
    ctxIa.catalogo = esc.catalogo;
    await generarDinamico(sembrarConfig().id as string);
    const a = await get();
    const { real } = await simularYAplicar(a, a.filas.filter((f) => f.fuente_sugerida !== null).map((f) => f.linea));
    estadoAprobacion.antesDeRpc = () => {
      registro("DENIM").updated_at = "2026-11-03T13:00:00.000Z";
    };
    const r = await ok(real);
    expect(r.filas.map((f) => f.codigo)).toEqual(["cambio_concurrente", "cambio_concurrente", "cambio_concurrente"]);
    expect(r.totales.aplicadas).toBe(0);
  });
});

describe("H2 · el volumen leído por petición no arrastra el `historico` entero", () => {
  /** Rellena el `historico` de cada fila con una clave que ninguna escritura necesita: si se lee, el volumen se dispara. */
  function engordarHistorico() {
    for (const f of filas("proyeccion_filas")) f.historico = { ...(f.historico as Record<string, unknown>), relleno: "x".repeat(40_000) };
  }

  for (const anio of [2026, 2027]) {
    it(`lote de ${anio}: simular y aplicar leen mucho menos que el relleno del historico (5 filas × 40 KB)`, async () => {
      iniciar(false);
      engordarHistorico();
      const a = await get(anio);
      const lineas = a.filas.map((f) => f.linea);
      expect(lineas.length).toBeGreaterThan(0);
      estadoAprobacion.medir = true;
      const { sim, real } = await simularYAplicar(a, lineas, { anio, revision_confirmada: true });
      await ok(real);
      estadoAprobacion.medir = false;
      expect(sim.totales.aplicadas).toBe(lineas.length);
      // Cinco filas con 40 KB de relleno son 200 KB por lectura completa: dos peticiones (simular y aplicar) que lo leyeran pasarían de 400 KB.
      expect(estadoAprobacion.bytes.total).toBeLessThan(anio === 2026 ? 160_000 : 60_000);
    });
  }

  it("2026: el efecto sigue usando lo vendido en 2025 del histórico (crecimiento implícito de 2026) aunque solo se lea `historico->anios`", async () => {
    iniciar(false);
    const a = await get(2026);
    const sim = await ok(aplicarLote(esc.proyeccionId, { ...cuerpoDe(a, ["DENIM"], { anio: 2026 }), simular: true }, ACTOR));
    expect(sim.efecto_gm[0].crecimiento_implicito_antes_pct).not.toBeNull();
    expect(sim.efecto_gm[0].crecimiento_implicito_despues_pct).not.toBeNull();
  });
});

describe("H3 · `crecimientos_sin_aprobar` no frena las tandas siguientes de la MISMA confirmación", () => {
  /**
   * Lo que un lote de 2026 con el Niño puede dejar entre dos tandas (D15): el cierre empieza a exigir crecimientos de `Y+1` (en producción, un GM «bruto» con Niño material que hay que
   * reaprobar; aquí, un GM exigido sin versión vigente). El escenario sintético de la IA no comparte nodos con el contexto falso, así que el Niño real no se puede armar: se
   * fabrica el estado que deja y se comprueba que el bloqueo es el real (`crecimientosDeHoy` → `crecimientos_sin_aprobar`). Que un lote de `Y` deja GM por reaprobar lo cubre `aprobacion.efecto.test.ts`.
   */
  const exigirCrecimientos = () => {
    const resumen = base.tablas.proyecciones[0].resumen as Record<string, unknown>;
    base.tablas.proyecciones[0].resumen = { ...resumen, gm_gml: { [esc.gmlIds[0]]: `${GEN.hombre}|00000000-0000-4000-8000-00000000ffff` } };
  };

  it("la primera tanda y toda confirmación nueva se bloquean; la segunda tanda de la misma confirmación pasa", async () => {
    iniciar(false);
    const a = await get(2026);
    expect(a.bloqueos).toEqual([]);

    const confirmacion = uuid("2");
    const tanda1 = await simularYAplicar(a, ["DENIM"], { anio: 2026, confirmacion_id: confirmacion });
    expect((await ok(tanda1.real)).totales.aplicadas).toBe(1);

    exigirCrecimientos();
    const b = await get(2026);
    expect(b.bloqueos.map((x) => x.codigo)).toContain("crecimientos_sin_aprobar");
    expect(b.editable).toBe(false);

    // Una confirmación NUEVA (su primera tanda) sí se bloquea.
    const nueva = cuerpoDe(b, ["POLO"], { anio: 2026, simular: true, confirmacion_id: uuid("2") });
    expect(await falla(aplicarLote(esc.proyeccionId, nueva, ACTOR))).toMatchObject({ status: 409, cuerpo: { codigo: "crecimientos_sin_aprobar" } });

    // La segunda tanda de la MISMA confirmación pasa (simula y aplica).
    const tanda2 = await simularYAplicar(b, ["POLO"], { anio: 2026, confirmacion_id: confirmacion });
    const r2 = await ok(tanda2.real);
    expect(r2.totales.aplicadas).toBe(1);
    expect(r2.lote?.confirmacion_id).toBe(confirmacion);

    // Los demás bloqueos no se relajan: con la proyección desactualizada la misma confirmación se frena igual.
    const parametros = base.tablas.proyecciones[0].parametros as Record<string, unknown>;
    base.tablas.proyecciones[0].parametros = { ...parametros, recalculo_pendiente: true };
    const c3 = cuerpoDe(b, ["CASACA"], { anio: 2026, simular: true, confirmacion_id: confirmacion });
    expect((await falla(aplicarLote(esc.proyeccionId, c3, ACTOR))).cuerpo.codigo).toBe("proyeccion_desactualizada");
  });

  it("la primera tanda de una confirmación con crecimientos sin aprobar se bloquea aunque su `confirmacion_id` no exista todavía", async () => {
    iniciar(false);
    const a = await get(2026);
    exigirCrecimientos();
    const c = cuerpoDe(a, ["DENIM"], { anio: 2026, simular: true });
    expect((await falla(aplicarLote(esc.proyeccionId, c, ACTOR))).cuerpo.codigo).toBe("crecimientos_sin_aprobar");
  });

  it("tras un recálculo (otro `calculado_at`) la confirmación ya no está «empezada»: vuelve a exigirse todo", async () => {
    iniciar(false);
    const a = await get(2026);
    const confirmacion = uuid("2");
    await ok((await simularYAplicar(a, ["DENIM"], { anio: 2026, confirmacion_id: confirmacion })).real);
    exigirCrecimientos();
    const b = await get(2026);
    base.tablas.proyecciones[0].calculado_at = "2026-11-03T09:00:00.000Z";
    const c = cuerpoDe(b, ["POLO"], { anio: 2026, simular: true, confirmacion_id: confirmacion });
    expect((await falla(aplicarLote(esc.proyeccionId, c, ACTOR))).cuerpo.codigo).toBe("crecimientos_sin_aprobar");
  });

  it("una confirmación cuyas tandas no aplicaron ninguna fila no cuenta como empezada", async () => {
    iniciar(false);
    const a = await get(2026);
    const confirmacion = uuid("2");
    const c = cuerpoDe(a, ["DENIM"], { anio: 2026, simular: true, confirmacion_id: confirmacion });
    const sim = await ok(aplicarLote(esc.proyeccionId, c, ACTOR));
    estadoAprobacion.antesDeRpc = () => {
      Object.assign(registro("DENIM", 2026), { decidido: 9000, origen: "manual" });
    };
    const vacia = await ok(aplicarLote(esc.proyeccionId, { ...c, simular: false, huella_simulacion: sim.huella_simulacion }, ACTOR));
    expect(vacia.totales.aplicadas).toBe(0);
    exigirCrecimientos();
    const b = await get(2026);
    const otra = cuerpoDe(b, ["POLO"], { anio: 2026, simular: true, confirmacion_id: confirmacion });
    expect((await falla(aplicarLote(esc.proyeccionId, otra, ACTOR))).cuerpo.codigo).toBe("crecimientos_sin_aprobar");
  });
});

describe("H6 · el contador `reaprobables` solo cuenta lo que «Reaprobar» podría tomar", () => {
  it("con la IA al día cuenta las aprobadas en bloque que cambiaron; si el GM queda desactualizado, ya no cuenta ninguna", async () => {
    await generar(iniciar()!.id as string);
    const a = await get();
    await ok((await simularYAplicar(a, ["DENIM", "POLO", "CASACA"])).real);
    registro("DENIM").propuesto = 11340;
    expect((await get(2027, "reaprobar")).reaprobables.y1).toBe(3);
    // La historia del GM cambió: su propuesta de IA queda desactualizada y sus filas saldrían excluidas (`ia_desactualizada`).
    filas("ia_propuestas_gm")[0].huella_historia = "otra-historia";
    const b = await get(2027, "reaprobar");
    expect(b.gms[0].estado_ia).toBe("desactualizada");
    expect(b.reaprobables.y1).toBe(0);
    expect(b.filas.every((f) => f.fuente_sugerida === null && f.excluida === "ia_desactualizada")).toBe(true);
  });

  it("las aprobadas en bloque con el método (GM sin IA) siguen contando cuando su propuesta cambia", async () => {
    iniciar(false);
    const a = await get();
    await ok((await simularYAplicar(a, ["DENIM", "POLO", "CASACA"])).real);
    registro("DENIM").propuesto = 11340;
    expect((await get(2027, "reaprobar")).reaprobables.y1).toBe(1);
  });
});

describe("H8 · errores de tiempo de la base se reintentan igual que un interbloqueo", () => {
  it("40P01, 55P03 y 57014 son 409 `conflicto_reintentar`; otro código sigue siendo 500", async () => {
    iniciar(false);
    const a = await get();
    const c = cuerpoDe(a, ["DENIM"]);
    const sim = await ok(aplicarLote(esc.proyeccionId, { ...c, simular: true }, ACTOR));
    for (const code of ["40P01", "55P03", "57014"]) {
      estadoAprobacion.falloRpc = { code, message: "error de la base" };
      expect(await falla(aplicarLote(esc.proyeccionId, { ...c, huella_simulacion: sim.huella_simulacion }, ACTOR)), code).toMatchObject({ status: 409, cuerpo: { codigo: "conflicto_reintentar" } });
    }
    estadoAprobacion.falloRpc = { code: "XX000", message: "otra cosa" };
    expect((await falla(aplicarLote(esc.proyeccionId, { ...c, huella_simulacion: sim.huella_simulacion }, ACTOR))).status).toBe(500);
    // Nada se escribió y el reintento con el mismo `lote_id` funciona.
    expect(registro("DENIM").decidido).toBeNull();
    expect((await ok(aplicarLote(esc.proyeccionId, { ...c, huella_simulacion: sim.huella_simulacion }, ACTOR))).totales.aplicadas).toBe(1);
  });
});

describe("M2 · sin ninguna fila aplicable no se llama a la función SQL", () => {
  it("aprobar: todas las filas rechazadas en TypeScript → 409 `sin_filas_aplicables`, sin llamada ni lote vacío; simular sí responde", async () => {
    iniciar(false);
    const a = await get();
    await ok(decidirFila(esc.proyeccionId, porLinea(a, "DENIM").fila_id, 2027, { decidido: 11500, origen: "manual" }, ACTOR));
    const c = cuerpoDe(a, ["DENIM"]);
    const sim = await ok(aplicarLote(esc.proyeccionId, { ...c, simular: true }, ACTOR));
    expect(sim.totales).toMatchObject({ aplicadas: 0, rechazadas: 1 });
    const r = await falla(aplicarLote(esc.proyeccionId, { ...c, huella_simulacion: sim.huella_simulacion }, ACTOR));
    expect(r).toMatchObject({ status: 409, cuerpo: { codigo: "sin_filas_aplicables" } });
    expect(String(r.cuerpo.error)).toContain("Ninguna de las filas elegidas se puede aprobar ahora");
    expect(estadoAprobacion.llamadas).toBe(0);
    expect(filas("proyeccion_lotes")).toHaveLength(0);
  });

  it("revertir: un lote cuyas filas ya cambiaron a mano → 409 `sin_filas_aplicables` sin llamar a la función; revertir una confirmación tolera las tandas vacías", async () => {
    iniciar(false);
    const a = await get();
    const { c, real } = await simularYAplicar(a, ["DENIM", "POLO"]);
    const lote = (await ok(real)).lote!;
    for (const l of ["DENIM", "POLO"]) await ok(decidirFila(esc.proyeccionId, registro(l).fila_id as string, 2027, { decidido: 12000, origen: "manual" }, ACTOR));
    const llamadas = estadoAprobacion.llamadas;
    const sim = await ok(revertirLote(esc.proyeccionId, lote.id, { lote_id: uuid("5"), simular: true }, ACTOR));
    expect(sim.totales.aplicadas).toBe(0);
    expect(await falla(revertirLote(esc.proyeccionId, lote.id, { lote_id: uuid("5"), simular: false }, ACTOR))).toMatchObject({ status: 409, cuerpo: { codigo: "sin_filas_aplicables" } });
    expect(await falla(revertirConfirmacion(esc.proyeccionId, c.confirmacion_id, { lote_ids: [uuid("6")], simular: false }, ACTOR))).toMatchObject({ status: 409, cuerpo: { codigo: "sin_filas_aplicables" } });
    expect(estadoAprobacion.llamadas).toBe(llamadas);
    expect(filas("proyeccion_lotes").filter((l) => l.tipo === "revertir")).toHaveLength(0);
  });
});

describe("I4 · revertir busca el lote repetido ANTES de mirar si la proyección se cerró o se está calculando", () => {
  it("el reintento con el mismo `lote_id` devuelve lo guardado aunque la proyección ya esté cerrada o calculándose; sin reintento, 409", async () => {
    iniciar(false);
    const a = await get();
    const { real } = await simularYAplicar(a, ["DENIM", "POLO", "CASACA"]);
    const lote = (await ok(real)).lote!;
    const idRev = uuid("5");
    const primera = await ok(revertirLote(esc.proyeccionId, lote.id, { lote_id: idRev, simular: false }, ACTOR));
    expect(primera.repetido).toBe(false);
    base.tablas.proyecciones[0].estado = "cerrada";
    const otra = await ok(revertirLote(esc.proyeccionId, lote.id, { lote_id: idRev, simular: false }, ACTOR));
    expect(otra).toMatchObject({ repetido: true, lote: { id: idRev } });
    expect((await falla(revertirLote(esc.proyeccionId, lote.id, { lote_id: uuid("6"), simular: false }, ACTOR))).cuerpo.codigo).toBe("cerrada");
    base.tablas.proyecciones[0].estado = "en_trabajo";
    base.tablas.proyecciones[0].calculando_desde = new Date().toISOString();
    expect((await ok(revertirLote(esc.proyeccionId, lote.id, { lote_id: idRev, simular: false }, ACTOR))).repetido).toBe(true);
    expect((await falla(revertirLote(esc.proyeccionId, lote.id, { lote_id: uuid("7"), simular: false }, ACTOR))).cuerpo.codigo).toBe("calculo_en_curso");
    // Mismo `lote_id` con otro cuerpo sigue siendo `lote_ajeno`, también con la proyección cerrada.
    base.tablas.proyecciones[0].calculando_desde = null;
    base.tablas.proyecciones[0].estado = "cerrada";
    expect((await falla(revertirLote(esc.proyeccionId, lote.id, { lote_id: idRev, nota: "otra", simular: false }, ACTOR))).cuerpo.codigo).toBe("lote_ajeno");
  });
});

describe("Entrada a la IA con filas `libre_en_bloque` (QA y seguridad)", () => {
  it("una fila aprobada en bloque con IA se pide de nuevo a la IA: `y1.fija_en` nulo y `pedir` verdadero; la decidida a mano sigue fija", async () => {
    const cfg = iniciar()!.id as string;
    await generar(cfg);
    const a = await get();
    await ok((await simularYAplicar(a, ["DENIM", "POLO", "CASACA"])).real);
    expect(registro("DENIM")).toMatchObject({ decision_lote_id: expect.any(String), decision_ia_fila_id: expect.any(String) });
    await generar(cfg, true);
    const peticiones = (ctxIa.proveedor as unknown as { peticiones: { bloque: string }[] }).peticiones;
    expect(peticiones.length).toBeGreaterThan(0);
    const filasDe = peticiones.flatMap((p) => ((JSON.parse(p.bloque) as { filas?: { f: string; estado?: string; y1: { fija_en: number | null; pedir: boolean } }[] }).filas ?? []));
    // Las tres aprobadas en bloque (f001 a f003) se piden de nuevo: no llegan como fijas.
    for (const f of ["f001", "f002", "f003"]) {
      const x = filasDe.find((r) => r.f === f);
      expect(x, f).toBeDefined();
      expect(x?.y1.fija_en, f).toBeNull();
      expect(x?.y1.pedir, f).toBe(true);
    }
    // BUZO (decidida a mano, f004) sigue fija y no se pide.
    const buzo = filasDe.find((r) => r.f === "f004");
    expect(buzo?.y1.fija_en).toBe(3300);
    expect(buzo?.y1.pedir).toBe(false);
  });
});

void sembrarIa;
