import { describe, expect, it } from "vitest";
import {
  armarGrupos,
  confianzaExcluyente,
  fuentePermitida,
  modoIaDeGM,
  planificarLote,
  planificarReversion,
  resultadoFilaApi,
  sinCifraIa,
  tieneCifraIa,
  type EntradaPlan,
  type FilaPlan,
  type RegistroAEscribir,
} from "@/lib/aprobacion/plan";
import type { ItemLote } from "@/lib/aprobacion/esquemas";
import { filasMetaA } from "./ia.fixture";
import {
  A_EJEMPLO,
  CLAVE,
  con,
  escenarioA2027,
  F,
  filaPlan,
  FN,
  GM_A,
  GM_B,
  iaFila,
  itemIa,
  itemMetodo,
  itemsIaA,
  LOTE,
  motivoCierreDe,
  PF,
  PGM,
  PGM_VIEJA,
  registro,
  valoresIaGM,
  Y,
  Y1,
  type Escenario,
} from "./aprobacion.fixture";

/** Plan de un lote (07g): R1, R4, R5, R7, R23, R24 y los ejemplos A1, A2, C, L, L′, M, M′ y N, con cifras sintéticas. */

const entrada = (e: Escenario, tipo: "aprobar" | "reaprobar", items: ItemLote[], anio: number = Y1): EntradaPlan => ({
  tipo,
  anio,
  anioEnCurso: Y,
  items,
  filas: e.filas,
  gms: e.gms,
  propuestasFila: e.propuestasFila,
});
const plan = (e: Escenario, items: ItemLote[], tipo: "aprobar" | "reaprobar" = "aprobar", anio: number = Y1) => planificarLote(entrada(e, tipo, items, anio));
const IDS_A = ["f1", "f2", "f3", "f4", "f5"] as const;
const codigos = (p: ReturnType<typeof plan>) => p.filas.map((f) => f.codigo);

describe("D1 · qué filas bloquean el cierre (el predicado viene de motivoRechazoCerrar, sin copia)", () => {
  it("el ejemplo A: f1 · f2 · f3 por umbral; f4 decidida y f5 de cola larga no bloquean; la cola larga con revisión sí", () => {
    const e = escenarioA2027();
    expect(IDS_A.map((id) => e.filas.get(F[id])?.motivo_cierre)).toEqual(["umbral", "umbral", "umbral", null, null]);
    expect(motivoCierreDe({ propuesto: 86, decidido: null, avisos: ["revision_cola_larga"] })).toBe("revision_cola_larga");
    expect(motivoCierreDe({ propuesto: 100, decidido: null })).toBe("umbral");
    expect(motivoCierreDe({ propuesto: 99, decidido: null })).toBeNull();
    expect(motivoCierreDe({ propuesto: null, decidido: null })).toBeNull();
  });
});

describe("D4 y D5 · la fuente que admite cada fila", () => {
  it("GM con IA: las libres con cifra van por «IA»; las excluidas, sin fuente", () => {
    const e = escenarioA2027();
    const gm = e.gms.get(GM_A);
    const p = (id: keyof typeof F) => fuentePermitida(e.filas.get(F[id]) as FilaPlan, gm, Y1, Y);
    expect(p("f1")).toMatchObject({ fuente: "ia", badge: "ia", excluida: null });
    expect(p("f2")).toMatchObject({ fuente: "ia", badge: "ia", excluida: null });
  });

  it("GM sin IA: método con el badge «Método · GM sin IA»", () => {
    const e = escenarioA2027({ modo: "sin_ia" });
    expect(fuentePermitida(e.filas.get(F.f1) as FilaPlan, e.gms.get(GM_A), Y1, Y)).toMatchObject({ fuente: "metodo", badge: "metodo_gm_sin_ia" });
    expect(fuentePermitida(e.filas.get(F.f1) as FilaPlan, undefined, Y1, Y)).toMatchObject({ fuente: "metodo", badge: "metodo_gm_sin_ia" });
  });

  it("GM desactualizado: sin fuente («regenera el GM»)", () => {
    const e = escenarioA2027({ modo: "desactualizada" });
    const r = fuentePermitida(e.filas.get(F.f1) as FilaPlan, e.gms.get(GM_A), Y1, Y);
    expect(r).toMatchObject({ fuente: null, badge: null, excluida: "ia_desactualizada" });
    expect(r.motivo).toMatch(/regenera/i);
  });

  it("2026: siempre método, sin la regla de confianza", () => {
    const e = escenarioA2027();
    const f = { ...(e.filas.get(F.f1) as FilaPlan), ia: iaFila("f1", { confianza: null, natural: 100, valor: 100 }) };
    expect(fuentePermitida(f, e.gms.get(GM_A), Y, Y)).toMatchObject({ fuente: "metodo", badge: "metodo", excluida: null });
  });

  it("confianza baja o nula con cifra: excluida; sin cifra no aplica; alta y media pasan", () => {
    expect(confianzaExcluyente("baja")).toBe(true);
    expect(confianzaExcluyente(null)).toBe(true);
    expect(confianzaExcluyente("media")).toBe(false);
    expect(confianzaExcluyente("alta")).toBe(false);
    for (const conf of ["baja", null] as const) {
      const e = escenarioA2027({ conf: { f2: conf } });
      expect(fuentePermitida(e.filas.get(F.f2) as FilaPlan, e.gms.get(GM_A), Y1, Y)).toMatchObject({ fuente: null, excluida: "confianza_baja", codigo_rechazo: "confianza_baja" });
    }
  });

  it("libre sin cifra de IA (libre nueva o sin cifra del modelo): excluida con «sin_cifra_ia»", () => {
    const nueva = con(escenarioA2027(), "f2", { ia: null });
    expect(fuentePermitida(nueva.filas.get(F.f2) as FilaPlan, nueva.gms.get(GM_A), Y1, Y)).toMatchObject({ fuente: null, excluida: "sin_cifra_ia" });
    const sinCifra = con(escenarioA2027(), "f2", { ia: { avisos: ["sin_propuesta_ia"] } });
    expect(fuentePermitida(sinCifra.filas.get(F.f2) as FilaPlan, sinCifra.gms.get(GM_A), Y1, Y)).toMatchObject({ fuente: null, excluida: "sin_cifra_ia" });
    expect(sinCifraIa(null)).toBe(true);
    expect(tieneCifraIa(null)).toBe(false);
    expect(tieneCifraIa(iaFila("f1", { natural: null, valor: 10 }))).toBe(true);
    expect(tieneCifraIa(iaFila("f1", { natural: null, valor: 10, avisos: ["sin_propuesta_ia"] }))).toBe(false);
  });

  it("fila con % propio en un GM con IA: método, porque la IA no la reparte", () => {
    const e = con(escenarioA2027(), "f2", { registro: { crecimiento_pct: 3 }, ia: { estado_meta: "fija_pct", valor: null } });
    expect(fuentePermitida(e.filas.get(F.f2) as FilaPlan, e.gms.get(GM_A), Y1, Y)).toMatchObject({ fuente: "metodo", badge: "metodo" });
  });

  it("una libre sin reparto o fija en la IA queda excluida con «ia_no_aceptable»", () => {
    const sinValor = con(escenarioA2027(), "f2", { ia: { valor: null } });
    expect(fuentePermitida(sinValor.filas.get(F.f2) as FilaPlan, sinValor.gms.get(GM_A), Y1, Y)).toMatchObject({ excluida: "ia_no_aceptable", codigo_rechazo: "ia_sin_valor" });
    const fija = con(escenarioA2027(), "f2", { ia: { estado_meta: "fija_decidida" } });
    expect(fuentePermitida(fija.filas.get(F.f2) as FilaPlan, fija.gms.get(GM_A), Y1, Y)).toMatchObject({ excluida: "ia_no_aceptable", codigo_rechazo: "fila_no_libre" });
  });

  it("modoIaDeGM: con IA solo al día o meta movida y con meta; el resto, sin IA o desactualizada", () => {
    const base = { ia_disponible: true, estado: "al_dia" as const, sin_meta: false, fijadas_exceden_meta: false };
    expect(modoIaDeGM(base)).toBe("con_ia");
    expect(modoIaDeGM({ ...base, estado: "meta_movida" })).toBe("con_ia");
    expect(modoIaDeGM({ ...base, estado: "desactualizada" })).toBe("desactualizada");
    for (const estado of ["sin_propuesta", "sin_filas_libres", "fallida", "bloqueado_privacidad", null] as const) expect(modoIaDeGM({ ...base, estado })).toBe("sin_ia");
    expect(modoIaDeGM({ ...base, ia_disponible: false })).toBe("sin_ia");
    expect(modoIaDeGM({ ...base, ia_disponible: false, estado: "desactualizada" })).toBe("sin_ia");
    expect(modoIaDeGM({ ...base, sin_meta: true })).toBe("sin_ia");
    expect(modoIaDeGM({ ...base, fijadas_exceden_meta: true })).toBe("sin_ia");
  });
});

describe("Ejemplo A1 · las tres libres con IA (R3, R5)", () => {
  it("se aplican con origen manual, traza de IA y las cifras 10 961 · 6 677 · 4 982", () => {
    const e = escenarioA2027();
    expect(["f1", "f2", "f3"].map((i) => e.filas.get(F[i as "f1"])?.ia?.valor)).toEqual([10961, 6677, 4982]);
    const p = plan(e, itemsIaA());
    expect(p.filas.map((f) => [f.resultado, f.valor, f.decision?.origen, f.decision?.decision_ia_fila_id])).toEqual([
      ["aplicada", 10961, "manual", PF.f1],
      ["aplicada", 6677, "manual", PF.f2],
      ["aplicada", 4982, "manual", PF.f3],
    ]);
    expect(p.filas.every((f) => f.fuente === "ia" && f.propuesta_gm_id === PGM)).toBe(true);
    // brecha = A − natural (07e: 661, 77 y −118)
    expect(p.filas.map((f) => f.brecha_u)).toEqual([661, 77, -118]);
    expect(p.filas.reduce((s, f) => s + (f.valor ?? 0), 0) + 3300 + 86).toBe(26006);
  });

  it("A2 · solo f1 y f2: se aplican; f3 queda libre", () => {
    const p = plan(escenarioA2027(), [itemIa("f1", 10961), itemIa("f2", 6677)]);
    expect(codigos(p)).toEqual([null, null]);
    expect(p.filas.every((f) => f.resultado === "aplicada")).toBe(true);
  });

  it("la proyección a la API conserva fuente, valor y brecha", () => {
    const p = plan(escenarioA2027(), itemsIaA());
    expect(resultadoFilaApi(p.filas[0])).toEqual({ fila_id: F.f1, anio: Y1, gm_clave: GM_A, fuente: "ia", resultado: "aplicada", codigo: null, valor: 10961, valor_actual: null, brecha_u: 661 });
  });
});

describe("R1 · nunca se toca lo decidido a mano", () => {
  it("aprobar: una fila con decisión (f4) o ya decidida a mano después de ver → ya_decidida", () => {
    const e = escenarioA2027();
    const p = plan(e, [itemMetodo(F.f4, 3240)]);
    expect(p.filas[0]).toMatchObject({ resultado: "rechazada", codigo: "ya_decidida", valor_actual: 3300, valor: null });
  });

  it("aprobar una fila que no bloquea el cierre (cola larga, f5) → no_bloquea_cierre", () => {
    const e = escenarioA2027({ modo: "sin_ia" });
    expect(codigos(plan(e, [itemMetodo(F.f5, 86)]))).toEqual(["no_bloquea_cierre"]);
  });

  it("una fila de tienda nunca entra: no_bloquea_cierre (aprobar) / no_reaprobable (reaprobar)", () => {
    const e = escenarioA2027({ modo: "sin_ia" });
    con(e, "f1", { plan: { es_base: false } });
    expect(codigos(plan(e, [itemMetodo(F.f1, 10800)]))).toEqual(["no_bloquea_cierre"]);
    expect(codigos(plan(e, [itemMetodo(F.f1, 10800, { decidido_esperado: 1 })], "reaprobar"))).toEqual(["no_reaprobable"]);
  });

  it("fila desconocida, sin registro del año o desactivada", () => {
    const e = escenarioA2027({ modo: "sin_ia" });
    expect(codigos(plan(e, [itemMetodo("00000000-0000-4000-8000-0000000000ff", 1)]))).toEqual(["fila_no_encontrada"]);
    con(e, "f1", { plan: { registro: null } });
    expect(codigos(plan(e, [itemMetodo(F.f1, 10800)]))).toEqual(["fila_no_encontrada"]);
    con(e, "f2", { plan: { activa: false } });
    expect(codigos(plan(e, [itemMetodo(F.f2, 6480)]))).toEqual(["fila_inactiva"]);
    con(e, "f3", { registro: { activo: false } });
    expect(codigos(plan(e, [itemMetodo(F.f3, 5400)]))).toEqual(["fila_inactiva"]);
  });

  it("reaprobar: una fila decidida a mano (sin decision_lote_id) → no_reaprobable", () => {
    const e = escenarioA2027({ modo: "sin_ia" });
    con(e, "f1", { registro: { decidido: 10000, decision_lote_id: null } });
    const p = plan(e, [itemMetodo(F.f1, 10800, { decidido_esperado: 10000 })], "reaprobar");
    expect(p.filas[0]).toMatchObject({ resultado: "rechazada", codigo: "no_reaprobable", valor_actual: 10000 });
  });
});

describe("R5 · método: decidido = propuesto, origen = propuesta, sin traza de IA", () => {
  it("2026: aprobar con el método escribe la propuesta de cada fila", () => {
    const e = escenarioA2027();
    const f26 = new Map<string, FilaPlan>();
    ([["f1", 10000], ["f2", 6000], ["f3", 4000]] as const).forEach(([id, propuesto]) => {
      f26.set(F[id], filaPlan(F[id], CLAVE[id], GM_A, registro(id, Y, { propuesto, vendido: 6000 }), {}, Y));
    });
    const p = planificarLote({ tipo: "aprobar", anio: Y, anioEnCurso: Y, items: [itemMetodo(F.f1, 10000), itemMetodo(F.f2, 6000), itemMetodo(F.f3, 4000)], filas: f26, gms: e.gms, propuestasFila: e.propuestasFila });
    expect(p.filas.map((f) => [f.resultado, f.valor, f.decision])).toEqual([
      ["aplicada", 10000, { decidido: 10000, origen: "propuesta", decision_ia_fila_id: null }],
      ["aplicada", 6000, { decidido: 6000, origen: "propuesta", decision_ia_fila_id: null }],
      ["aplicada", 4000, { decidido: 4000, origen: "propuesta", decision_ia_fila_id: null }],
    ]);
  });

  it("propuesta_cambio si lo que se vio ya no es la propuesta de hoy", () => {
    const e = escenarioA2027({ modo: "sin_ia" });
    const p = plan(e, [itemMetodo(F.f1, 10500)]);
    expect(p.filas[0]).toMatchObject({ codigo: "propuesta_cambio", valor_actual: 10800, valor: null });
  });

  it("una fila sin propuesta no se aprueba por el método", () => {
    const e = con(escenarioA2027({ modo: "sin_ia" }), "f1", { registro: { propuesto: null }, plan: { motivo_cierre: "umbral" } });
    expect(codigos(plan(e, [itemMetodo(F.f1, 0)]))).toEqual(["no_bloquea_cierre"]);
  });

  it("con IA y la fila con % propio: se aprueba por el método; una libre por el método → metodo_en_gm_con_ia; la IA en una fija → fila_no_libre", () => {
    const e = con(escenarioA2027(), "f2", { registro: { crecimiento_pct: 3 }, ia: { estado_meta: "fija_pct", valor: null } });
    expect(plan(e, [itemMetodo(F.f2, 6480)]).filas[0]).toMatchObject({ resultado: "aplicada", valor: 6480, decision: { origen: "propuesta" } });
    expect(codigos(plan(e, [itemMetodo(F.f1, 10800)]))).toEqual(["metodo_en_gm_con_ia"]);
    expect(codigos(plan(e, [itemIa("f2", 6677)]))).toEqual(["fila_no_libre"]);
  });
});

describe("Ejemplo N · IA apagada", () => {
  it("2027 se aprueba con el método (GM sin IA): 10 800 · 6 480 · 5 400; un ítem de IA no tiene propuesta vigente", () => {
    const e = escenarioA2027({ modo: "sin_ia" });
    const p = plan(e, [itemMetodo(F.f1, 10800), itemMetodo(F.f2, 6480), itemMetodo(F.f3, 5400)]);
    expect(p.filas.map((f) => [f.resultado, f.valor])).toEqual([["aplicada", 10800], ["aplicada", 6480], ["aplicada", 5400]]);
    expect(codigos(plan(e, [itemIa("f1", 10961)]))).toEqual(["ia_no_vigente"]);
  });

  it("R7 · un ítem de IA en el año en curso no se acepta", () => {
    const e = escenarioA2027();
    expect(codigos(plan(e, [itemIa("f1", 10961)], "aprobar", Y))).toEqual(["ia_no_vigente"]);
  });
});

describe("Ejemplo C y R23 · confianza baja o sin dato", () => {
  for (const conf of ["baja", null] as const) {
    it(`f2 con confianza ${conf ?? "nula"}: por «IA» o por «Método» se rechaza; las demás del grupo quedan grupo_rechazado`, () => {
      const e = escenarioA2027({ conf: { f2: conf } });
      const p = plan(e, itemsIaA());
      expect(p.filas.map((f) => [f.resultado, f.codigo])).toEqual([["rechazada", "grupo_rechazado"], ["rechazada", "confianza_baja"], ["rechazada", "grupo_rechazado"]]);
      expect(p.filas.every((f) => f.valor === null && f.decision === null)).toBe(true);
      // por «Método» tampoco (I4)
      expect(codigos(plan(e, [itemMetodo(F.f2, 6480)]))).toEqual(["confianza_baja"]);
    });
  }

  it("sin f2 en el cuerpo, f1 y f3 sí pasan", () => {
    const e = escenarioA2027({ conf: { f2: "baja" } });
    const p = plan(e, [itemIa("f1", 10961), itemIa("f3", 4982)]);
    expect(p.filas.every((f) => f.resultado === "aplicada")).toBe(true);
  });

  it("en un GM sin IA y en 2026 la confianza no aplica (la fila no tiene cifra de IA)", () => {
    const e = escenarioA2027({ modo: "sin_ia", conf: { f2: null } });
    expect(plan(e, [itemMetodo(F.f2, 6480)]).filas[0].resultado).toBe("aplicada");
  });

  it("confianza media y alta pasan", () => {
    const p = plan(escenarioA2027({ conf: { f1: "media", f2: "alta" } }), itemsIaA());
    expect(p.filas.every((f) => f.resultado === "aplicada")).toBe(true);
  });
});

describe("Ejemplo L y R4 · un cambio entre ver y aprobar", () => {
  /** Otra persona fija f1 en 11 500: la IA de hoy da 6 368 y 4 752. */
  function escenarioL(): Escenario {
    const meta = filasMetaA().map((f) => (f.fila_id === "f1" ? { ...f, decidido: 11500, vigente: 11500 } : f));
    const e = escenarioA2027({ filasMeta: meta });
    // el GM sin IA del ejemplo (NIÑA · CASUAL): una fila con método 841
    e.filas.set(FN, filaPlan(FN, "n1", GM_B, registro("f1", Y1, { propuesto: 841 })));
    e.gms.set(GM_B, { gm_clave: GM_B, modo: "sin_ia", propuesta_gm_id: null, lectura: [] });
    return e;
  }

  it("f2 y f3 → ia_valor_cambio (con la cifra de hoy); NIÑA · CASUAL se aplica por el método con badge «GM sin IA»", () => {
    const e = escenarioL();
    expect(valoresIaGM(filasMetaA().map((f) => (f.fila_id === "f1" ? { ...f, decidido: 11500, vigente: 11500 } : f))).a).toEqual(
      new Map([["f2", 6368], ["f3", 4752]])
    );
    const p = plan(e, [itemIa("f2", 6677), itemIa("f3", 4982), itemMetodo(FN, 841)]);
    expect(p.filas.map((f) => [f.codigo, f.valor_actual])).toEqual([["ia_valor_cambio", 6368], ["ia_valor_cambio", 4752], [null, null]]);
    expect(p.filas[2]).toMatchObject({ resultado: "aplicada", valor: 841, fuente: "metodo" });
    expect(fuentePermitida(e.filas.get(FN) as FilaPlan, e.gms.get(GM_B), Y1, Y).badge).toBe("metodo_gm_sin_ia");
  });

  it("si una sola fila del grupo falla, las demás del GM que pasaban quedan grupo_rechazado; otro GM no se afecta (R4)", () => {
    const e = escenarioA2027();
    e.filas.set(FN, filaPlan(FN, "n1", GM_B, registro("f1", Y1, { propuesto: 841 })));
    e.gms.set(GM_B, { gm_clave: GM_B, modo: "sin_ia", propuesta_gm_id: null, lectura: [] });
    const p = plan(e, [itemIa("f1", 10961), itemIa("f2", 6000), itemIa("f3", 4982), itemMetodo(FN, 841)]);
    expect(p.filas.map((f) => f.codigo)).toEqual(["grupo_rechazado", "ia_valor_cambio", "grupo_rechazado", null]);
    expect(p.filas[3].resultado).toBe("aplicada");
  });

  it("una fila ya decidida en el grupo (f1 fijada por otra persona) deja el grupo sin escribir", () => {
    const e = escenarioA2027();
    con(e, "f1", { registro: { decidido: 11500 }, ia: { estado_meta: "fija_decidida", valor: null } });
    const p = plan(e, itemsIaA());
    expect(p.filas.map((f) => f.codigo)).toEqual(["ya_decidida", "grupo_rechazado", "grupo_rechazado"]);
  });
});

describe("comprobaciones de la IA (las de «Aceptar IA», 07e §3.1)", () => {
  it("propuesta de otra fila → ia_fila_ajena; propuesta que no existe o de otra versión → ia_no_vigente", () => {
    const e = escenarioA2027();
    expect(codigos(plan(e, [itemIa("f1", 10961, { propuesta_fila_id: PF.f2 })]))).toEqual(["ia_fila_ajena"]);
    expect(codigos(plan(e, [itemIa("f1", 10961, { propuesta_fila_id: "00000000-0000-4000-8000-0000000000aa" })]))).toEqual(["ia_no_vigente"]);
    e.propuestasFila.set(PF.f1, { fila_id: F.f1, propuesta_gm_id: PGM_VIEJA });
    expect(codigos(plan(e, [itemIa("f1", 10961)]))).toEqual(["ia_no_vigente"]);
  });

  it("GM desactualizado → ia_desactualizada para «IA» y para «Método»", () => {
    const e = escenarioA2027({ modo: "desactualizada" });
    expect(codigos(plan(e, [itemIa("f1", 10961)]))).toEqual(["ia_desactualizada"]);
    expect(codigos(plan(e, [itemMetodo(F.f1, 10800)]))).toEqual(["ia_desactualizada"]);
  });

  it("libre sin cifra de IA: por «IA» sin_cifra_ia (o fila ajena si no está en la propuesta); por «Método» sin_cifra_ia (D4)", () => {
    const e = con(escenarioA2027(), "f2", { ia: null });
    expect(codigos(plan(e, [itemMetodo(F.f2, 6480)]))).toEqual(["sin_cifra_ia"]);
    expect(codigos(plan(e, [itemIa("f2", 6677)]))).toEqual(["ia_fila_ajena"]);
    const sin = con(escenarioA2027(), "f2", { ia: { avisos: ["sin_propuesta_ia"] } });
    expect(codigos(plan(sin, [itemIa("f2", 6677)]))).toEqual(["sin_cifra_ia"]);
  });

  it("sin reparto → ia_sin_valor", () => {
    const e = con(escenarioA2027(), "f2", { ia: { valor: null } });
    expect(codigos(plan(e, [itemIa("f2", 6677)]))).toEqual(["ia_sin_valor"]);
  });
});

describe("Ejemplo M′ y R24 · reaprobar tras un cierre de mes", () => {
  /**
   * Tras A1, el recálculo mueve la meta a 26 546 (f1: propuesta 11 340, B' 10 500). f1, f2 y f3 están aprobadas en bloque
   * (decision_lote_id) y se tratan como libres (`libre_en_bloque`): A = 11 223 · 6 836 · 5 101.
   */
  function escenarioMp(): Escenario {
    const meta = filasMetaA().map((f) => {
      if (f.fila_id === "f1") return { ...f, propuesto: 11340, base_corregida: 10500, decidido: 10961, vigente: 10961 };
      if (f.fila_id === "f2") return { ...f, decidido: 6677, vigente: 6677 };
      if (f.fila_id === "f3") return { ...f, decidido: 4982, vigente: 4982 };
      return f;
    });
    const e = escenarioA2027({ filasMeta: meta, comoLibres: ["f1", "f2", "f3"] });
    con(e, "f1", { registro: { decision_lote_id: LOTE(1), decidido: 10961 } });
    con(e, "f2", { registro: { decision_lote_id: LOTE(1), decidido: 6677 } });
    con(e, "f3", { registro: { decision_lote_id: LOTE(1), decidido: 4982 } });
    return e;
  }
  const itemsRe = (): ItemLote[] => [
    itemIa("f1", 11223, { decidido_esperado: 10961 }),
    itemIa("f2", 6836, { decidido_esperado: 6677 }),
    itemIa("f3", 5101, { decidido_esperado: 4982 }),
  ];

  it("la IA de hoy da 11 223 · 6 836 · 5 101 y Reaprobar las escribe con origen manual y la traza", () => {
    const e = escenarioMp();
    expect(["f1", "f2", "f3"].map((i) => e.filas.get(F[i as "f1"])?.ia?.valor)).toEqual([11223, 6836, 5101]);
    const p = plan(e, itemsRe(), "reaprobar");
    expect(p.filas.map((f) => [f.resultado, f.valor, f.decidido_anterior, f.decidido_esperado])).toEqual([
      ["aplicada", 11223, 10961, 10961],
      ["aplicada", 6836, 6677, 6677],
      ["aplicada", 5101, 4982, 4982],
    ]);
    expect(p.filas.every((f) => f.decision?.origen === "manual" && f.decision.decision_ia_fila_id !== null)).toBe(true);
  });

  it("f4 (decidida a mano, sin decision_lote_id) no es reaprobable y no se toca", () => {
    const e = escenarioMp();
    const p = plan(e, [...itemsRe(), itemMetodo(F.f4, 3240, { decidido_esperado: 3300 })], "reaprobar");
    expect(p.filas[3]).toMatchObject({ resultado: "rechazada", codigo: "no_reaprobable" });
    expect(p.filas.slice(0, 3).every((f) => f.resultado === "aplicada")).toBe(true);
  });

  it("si alguien cambió la fila después de ver → cambiada_despues y el grupo de IA no se escribe", () => {
    const e = escenarioMp();
    con(e, "f2", { registro: { decidido: 7000 } });
    const p = plan(e, itemsRe(), "reaprobar");
    expect(p.filas.map((f) => f.codigo)).toEqual(["grupo_rechazado", "cambiada_despues", "grupo_rechazado"]);
  });

  it("sin cambio: si lo de hoy ya es lo aprobado (A1′), no hay nada que reaprobar y no arrastra al resto del grupo", () => {
    // tras A1 con la meta de siempre: A = 10 961 · 6 677 · 4 982, igual a lo aprobado
    const meta = filasMetaA().map((f) => {
      const d = ({ f1: 10961, f2: 6677, f3: 4982 } as Record<string, number>)[f.fila_id];
      return d === undefined ? f : { ...f, decidido: d, vigente: d };
    });
    const e = escenarioA2027({ filasMeta: meta, comoLibres: ["f1", "f2", "f3"] });
    for (const id of ["f1", "f2", "f3"] as const) con(e, id, { registro: { decision_lote_id: LOTE(1), decidido: A_EJEMPLO[id] } });
    expect(["f1", "f2", "f3"].map((i) => e.filas.get(F[i as "f1"])?.ia?.valor)).toEqual([10961, 6677, 4982]);
    const p = plan(e, itemsIaA() .map((it, i) => ({ ...it, decidido_esperado: [10961, 6677, 4982][i] })), "reaprobar");
    expect(p.filas.every((f) => f.codigo === "sin_cambio")).toBe(true);
    // una `sin_cambio` no rechaza al resto: solo f3 cambia
    con(e, "f3", { ia: { valor: 5000 } });
    const q = plan(e, [itemIa("f1", 10961, { decidido_esperado: 10961 }), itemIa("f3", 5000, { decidido_esperado: 4982 })], "reaprobar");
    expect(q.filas.map((f) => [f.codigo, f.resultado])).toEqual([["sin_cambio", "rechazada"], [null, "aplicada"]]);
  });

  it("reaprobar por el método (2026): decidido pasa a la propuesta de hoy con origen propuesta", () => {
    const f26 = new Map<string, FilaPlan>([
      [F.f1, filaPlan(F.f1, CLAVE.f1, GM_A, registro("f1", Y, { propuesto: 10400, decidido: 10000, decision_lote_id: LOTE(2) }), { motivo_cierre: "umbral" }, Y)],
    ]);
    const e = escenarioA2027();
    const p = planificarLote({ tipo: "reaprobar", anio: Y, anioEnCurso: Y, items: [itemMetodo(F.f1, 10400, { decidido_esperado: 10000 })], filas: f26, gms: e.gms, propuestasFila: e.propuestasFila });
    expect(p.filas[0]).toMatchObject({ resultado: "aplicada", valor: 10400, decision: { decidido: 10400, origen: "propuesta", decision_ia_fila_id: null } });
  });
});

describe("Ejemplo M · revertir (R11)", () => {
  /** Tras A1, alguien cambia f3 a mano a 5 000: f1 y f2 conservan el decision_lote_id del lote; f3 lo perdió. */
  const filasRevertir = (): Map<string, FilaPlan> => {
    const e = escenarioA2027();
    con(e, "f1", { registro: { decidido: 10961, decision_lote_id: LOTE(1) } });
    con(e, "f2", { registro: { decidido: 6677, decision_lote_id: LOTE(1) } });
    con(e, "f3", { registro: { decidido: 5000, decision_lote_id: null } });
    return e.filas;
  };
  const filasLote = (["f1", "f2", "f3"] as const).map((i) => ({ fila_id: F[i], fila_clave: CLAVE[i], gm_clave: GM_A, anio: Y1 }));

  it("f1 y f2 vuelven a sin decidir; f3 queda cambiada_despues", () => {
    const p = planificarReversion({ loteId: LOTE(1), anio: Y1, filasLote, filas: filasRevertir() });
    expect(p.filas.map((f) => [f.resultado, f.codigo, f.decidido_anterior, f.decision?.decidido ?? null])).toEqual([
      ["aplicada", null, 10961, null],
      ["aplicada", null, 6677, null],
      ["rechazada", "cambiada_despues", 5000, null],
    ]);
    expect(p.filas.every((f) => f.fuente === "revertir")).toBe(true);
    expect(p.filas[0].decidido_esperado).toBe(10961);
  });

  it("revertir en parte: solo las filas marcadas; una marcada que no es del lote → fila_no_encontrada", () => {
    const p = planificarReversion({ loteId: LOTE(1), anio: Y1, filasLote, seleccion: [F.f2, F.f4], filas: filasRevertir() });
    expect(p.filas.map((f) => [f.fila_id, f.codigo])).toEqual([[F.f2, null], [F.f4, "fila_no_encontrada"]]);
  });

  it("una fila que un recálculo desactivó → fila_inactiva; un registro de otro lote → cambiada_despues", () => {
    const filas = filasRevertir();
    filas.set(F.f1, { ...(filas.get(F.f1) as FilaPlan), activa: false });
    const f2 = filas.get(F.f2) as FilaPlan;
    filas.set(F.f2, { ...f2, registro: { ...(f2.registro as NonNullable<FilaPlan["registro"]>), decision_lote_id: LOTE(9) } });
    const p = planificarReversion({ loteId: LOTE(1), anio: Y1, filasLote, filas });
    expect(p.filas.map((f) => f.codigo)).toEqual(["fila_inactiva", "cambiada_despues", "cambiada_despues"]);
  });

  it("con f3 fija en 5 000, f1 y f2 libres de nuevo daría 10 950 · 6 670 (asignarMeta de 17 620)", () => {
    const meta = filasMetaA().map((f) => (f.fila_id === "f3" ? { ...f, decidido: 5000, vigente: 5000 } : f));
    const { plan: pm, a } = valoresIaGM(meta);
    expect(pm.meta?.meta_libre).toBe(17620);
    expect(a).toEqual(new Map([["f1", 10950], ["f2", 6670]]));
  });
});

describe("armarGrupos · lo que recibe la función SQL (D7, D9)", () => {
  const reg = (id: string, anio: number, objetivo: boolean): RegistroAEscribir => ({ id: `${id}-${anio}`, updated_at_esperado: "2026-11-03 10:00:00.123456+00", objetivo, set: { decidido: 1 } });

  it("un grupo IA por GM con todos sus ítems, la propuesta y registros_lectura de todo el GM (L′)", () => {
    const e = escenarioA2027();
    const p = plan(e, itemsIaA());
    const registros = new Map(p.filas.map((f) => [`${f.fila_id}#${f.anio}`, [reg(f.fila_id, Y1, true)]] as const));
    const grupos = armarGrupos({ plan: p, filas: e.filas, gms: e.gms, registros });
    expect(grupos).toHaveLength(1);
    expect(grupos[0]).toMatchObject({ tipo: "ia", gm_clave: GM_A, propuesta_gm_id: PGM });
    expect(grupos[0].registros_lectura).toHaveLength(10);
    expect(grupos[0].filas.map((f) => f.fila_id)).toEqual([F.f1, F.f2, F.f3]);
    expect(grupos[0].filas[0]).toMatchObject({ fuente: "ia", valor: 10961, valor_esperado: 10961, propuesta_fila_id: PF.f1 });
    expect(grupos[0].filas[0].registros).toHaveLength(1);
  });

  it("método: un grupo por fila, con los registros de tienda que B2 leyó; las rechazadas viajan con rechazo y sin registros", () => {
    const e = escenarioA2027({ modo: "sin_ia" });
    con(e, "f1", { plan: { lectura: [{ id: "tienda-2", updated_at: "x" }, { id: "tienda-1", updated_at: "y" }] } });
    const p = plan(e, [itemMetodo(F.f1, 10800), itemMetodo(F.f2, 1)]);
    const registros = new Map([[`${F.f1}#${Y1}`, [reg(F.f1, Y1, true), reg("sig", Y1 + 1, false)]]]);
    const grupos = armarGrupos({ plan: p, filas: e.filas, gms: e.gms, registros });
    expect(grupos.map((g) => [g.tipo, g.filas.length])).toEqual([["metodo", 1], ["metodo", 1]]);
    expect(grupos[0].registros_lectura).toEqual([{ id: "tienda-1", updated_at_esperado: "y" }, { id: "tienda-2", updated_at_esperado: "x" }]);
    expect(grupos[0].filas[0].registros?.map((r) => r.objetivo)).toEqual([true, false]);
    expect(grupos[1].filas[0]).toMatchObject({ rechazo: "propuesta_cambio", valor_actual: 6480 });
    expect(grupos[1].filas[0].registros).toBeUndefined();
    expect(grupos[1].registros_lectura).toEqual([]);
  });

  it("un grupo IA entero rechazado viaja sin registros_lectura y con cada código", () => {
    const e = escenarioA2027({ conf: { f2: "baja" } });
    const p = plan(e, itemsIaA());
    const grupos = armarGrupos({ plan: p, filas: e.filas, gms: e.gms, registros: new Map() });
    expect(grupos[0].registros_lectura).toEqual([]);
    expect(grupos[0].filas.map((f) => f.rechazo)).toEqual(["grupo_rechazado", "confianza_baja", "grupo_rechazado"]);
    expect(grupos[0].filas.every((f) => f.registros === undefined)).toBe(true);
  });

  it("la reversión: un grupo «revertir» por fila, ordenados por fila_id", () => {
    const e = escenarioA2027();
    con(e, "f1", { registro: { decidido: 10961, decision_lote_id: LOTE(1) } });
    con(e, "f2", { registro: { decidido: 6677, decision_lote_id: LOTE(1) } });
    const p = planificarReversion({ loteId: LOTE(1), anio: Y1, filasLote: [F.f2, F.f1].map((id) => ({ fila_id: id, fila_clave: id, gm_clave: GM_A, anio: Y1 })), filas: e.filas });
    const grupos = armarGrupos({ plan: p, filas: e.filas, gms: e.gms, registros: new Map() });
    expect(grupos.map((g) => [g.tipo, g.filas[0].fila_id])).toEqual([["revertir", F.f1], ["revertir", F.f2]]);
    expect(grupos[0].filas[0]).toMatchObject({ decidido_anterior: 10961, decidido_esperado: 10961 });
  });
});
