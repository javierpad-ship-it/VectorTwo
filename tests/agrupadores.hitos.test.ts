import { describe, expect, it } from "vitest";
import { avisosDeHitos, estadoHito, fechaDelHito, hitosDeEmbarque, proximoHitoEmbarque, reprogramacionesTotal, retrasoDias, textoEstadoHito, tieneHitoVencido, type EmbarqueParaHitos } from "@/lib/compras/agrupadores/hitos";
import { avisosEmbarque } from "@/lib/compras/agrupadores/avisos";
import { responsableEfectivo } from "@/lib/compras/agrupadores/responsable";
import { ESTADOS_HITO, HITOS, HITOS_LOGISTICOS } from "@/lib/compras/agrupadores/tipos";
import { ETIQUETA_ESTADO_HITO, ETIQUETA_HITO, MARCADOR_HITO } from "@/lib/compras/agrupadores/tipos-api";
import { EMBARQUE_F, HOY_F, perfilesAgrupadores } from "./agrupadores.fixture";
import { ctxF, embarqueDe } from "./agrupadores.fechas.soporte";

/**
 * 08b-1b §2.2: el estado de cada hito (`real`, `sin_registrar`, `vencido`, `por_confirmar`, `previsto`, `pendiente`, `no_aplica`), el próximo
 * hito y los textos (F-R5, F-R16; F21, F25 en el embarque y F39). Hoy = 2026-11-12.
 */

const e261101 = (): EmbarqueParaHitos => embarqueDe(ctxF(), EMBARQUE_F.e261101);
const con = (cambios: Partial<EmbarqueParaHitos>): EmbarqueParaHitos => ({ ...e261101(), ...cambios });
const estados = (e: EmbarqueParaHitos) => hitosDeEmbarque(e, HOY_F).map((h) => [h.hito, h.estado]);

describe("estado de cada hito de un embarque (§2.2)", () => {
  it("261101 de la ficha (zarpe confirmado): Zarpe real, Arribo vencido, Ingreso CD previsto, Inicio operativo pendiente, ingreso al stock previsto", () => {
    expect(estados(e261101())).toEqual([
      ["zarpe", "real"],
      ["arribo", "vencido"],
      ["ingreso_cd", "previsto"],
      ["inicio_operativo", "pendiente"],
      ["ingreso_stock", "previsto"],
    ]);
  });

  it("sin ninguna confirmación, el Zarpe de 05-oct (ya pasó) es vencido: por eso el fixture lo confirma", () => {
    expect(estadoHito("zarpe", con({ hito_confirmado: null }), HOY_F)).toBe("vencido");
  });

  it("`sin_registrar`: en o antes del hito confirmado pero sin fecha («Ocurrió · sin fecha»)", () => {
    const e = con({ fecha_salida_estimada: null, fecha_puerto_estimada: null, fecha_llegada_estimada: "2026-11-02", hito_confirmado: "inicio_operativo", fecha_inicio_operativo_estimada: "2026-11-05", hora_inicio_operativo: "09:22" });
    expect(estados(e)).toEqual([
      ["zarpe", "sin_registrar"],
      ["arribo", "sin_registrar"],
      ["ingreso_cd", "real"],
      ["inicio_operativo", "real"],
      ["ingreso_stock", "por_confirmar"],
    ]);
  });

  it("`no_aplica`: el Arribo de un embarque local, aunque tenga fecha o esté confirmado", () => {
    expect(estadoHito("arribo", con({ tipo: "local" }), HOY_F)).toBe("no_aplica");
    expect(estadoHito("arribo", con({ tipo: "local", fecha_puerto_estimada: null, hito_confirmado: "ingreso_cd" }), HOY_F)).toBe("no_aplica");
    const h = hitosDeEmbarque(con({ tipo: "local" }), HOY_F).find((x) => x.hito === "arribo");
    expect(h).toMatchObject({ estado: "no_aplica", fecha: null });
  });

  it("`previsto` desde hoy en adelante (hoy mismo es previsto) y `vencido` el día siguiente", () => {
    expect(estadoHito("arribo", con({ fecha_puerto_estimada: "2026-11-12" }), HOY_F)).toBe("previsto");
    expect(estadoHito("arribo", con({ fecha_puerto_estimada: "2026-11-11" }), HOY_F)).toBe("vencido");
  });

  it("el ingreso al stock sin fijar usa el Ingreso CD; fijado, el fijado; con real, `real`", () => {
    expect(fechaDelHito(e261101(), "ingreso_stock")).toBe("2026-11-15");
    expect(fechaDelHito(con({ fecha_ingreso_estimada: "2026-12-04" }), "ingreso_stock")).toBe("2026-12-04");
    expect(fechaDelHito(con({ fecha_llegada_real: "2026-11-10", fecha_ingreso_estimada: "2026-12-04" }), "ingreso_stock")).toBe("2026-11-10");
    expect(estadoHito("ingreso_stock", con({ fecha_llegada_real: "2026-11-10" }), HOY_F)).toBe("real");
  });

  it("un embarque recibido: todo lo anterior al ingreso ocurrió", () => {
    const e = con({ estado: "recibido", fecha_llegada_real: "2026-11-10", hito_confirmado: null });
    expect(estados(e)).toEqual([["zarpe", "real"], ["arribo", "real"], ["ingreso_cd", "real"], ["inicio_operativo", "sin_registrar"], ["ingreso_stock", "real"]]);
  });
});

describe("F39: `por_confirmar` (ingreso al stock pasado con la mercadería ya en el CD) no es atraso", () => {
  const javier = (hito: EmbarqueParaHitos["hito_confirmado"]): EmbarqueParaHitos => ({
    ...e261101(),
    fecha_salida_estimada: null,
    fecha_puerto_estimada: null,
    fecha_llegada_estimada: "2026-11-02",
    fecha_ingreso_estimada: "2026-11-08",
    fecha_inicio_operativo_estimada: null,
    hito_confirmado: hito,
  });

  it("Ingreso CD 02-nov, ingreso fijado 08-nov y `hito_confirmado = ingreso_cd`: el ingreso al stock es `por_confirmar`; no hay hitos vencidos ni «atrasado»", () => {
    const e = javier("ingreso_cd");
    expect(estadoHito("ingreso_stock", e, HOY_F)).toBe("por_confirmar");
    const hitos = hitosDeEmbarque(e, HOY_F);
    expect(tieneHitoVencido(hitos)).toBe(false);
    expect(proximoHitoEmbarque(hitos)).toEqual({ hito: "ingreso_stock", fecha: "2026-11-08", hora: null, estado: "por_confirmar" });
    expect(avisosDeHitos(hitos, HOY_F)).toEqual([]);
    const perfiles = perfilesAgrupadores();
    const avisos = avisosEmbarque({ embarque: { ...e, estado: "en_transito", periodo_llegada: "2026-11" }, viaje: null, responsable: responsableEfectivo({ propio: perfiles[0].id }, perfiles), asignaciones: [], hoy: HOY_F });
    expect(avisos).not.toContain("atrasado");
  });

  it("con `hito_confirmado = arribo`: Ingreso CD e ingreso al stock son `vencido` y el embarque sale en Atrasados", () => {
    const e = javier("arribo");
    expect(estadoHito("ingreso_cd", e, HOY_F)).toBe("vencido");
    expect(estadoHito("ingreso_stock", e, HOY_F)).toBe("vencido");
    expect(tieneHitoVencido(hitosDeEmbarque(e, HOY_F))).toBe(true);
    const perfiles = perfilesAgrupadores();
    const avisos = avisosEmbarque({ embarque: { ...e, estado: "en_transito", periodo_llegada: "2026-11" }, viaje: null, responsable: responsableEfectivo({ propio: perfiles[0].id }, perfiles), asignaciones: [], hoy: HOY_F });
    expect(avisos).toContain("atrasado");
  });

  it("sin confirmar nada y con el ingreso pasado también es `vencido` («Debía ocurrir»)", () => {
    expect(estadoHito("ingreso_stock", javier(null), HOY_F)).toBe("vencido");
  });

  it("08b-1: con los campos nuevos ausentes, `atrasado` sigue siendo «la llegada ya pasó» (los avisos de 08b-1 no cambian)", () => {
    const perfiles = perfilesAgrupadores();
    const avisos = (llegada: string) =>
      avisosEmbarque({ embarque: { estado: "planificado", fecha_llegada_estimada: llegada, periodo_llegada: llegada.slice(0, 7) }, viaje: null, responsable: responsableEfectivo({ propio: perfiles[0].id }, perfiles), asignaciones: [], hoy: HOY_F });
    expect(avisos("2026-11-11")).toContain("atrasado");
    expect(avisos("2026-11-12")).not.toContain("atrasado");
  });
});

describe("hitos de un embarque: fechas originales, retraso y reprogramaciones (de `agrupador_hitos_resumen`)", () => {
  it("retrasoDias: positivo si se atrasó, nulo si no hay original o no cambió", () => {
    expect(retrasoDias("2026-11-15", "2026-12-03")).toBe(18);
    expect(retrasoDias("2026-11-08", "2026-11-18")).toBe(10);
    expect(retrasoDias("2026-11-18", "2026-11-08")).toBe(-10);
    expect(retrasoDias(null, "2026-11-08")).toBeNull();
    expect(retrasoDias("2026-11-08", "2026-11-08")).toBeNull();
    expect(retrasoDias("2026-11-08", null)).toBeNull();
  });

  it("F24: Ingreso CD 1 reprogramación (+18 d, aduana); Arribo 1 (+10 d); el cambio de programación queda en el historial y no suma atraso", () => {
    const e = con({ fecha_llegada_estimada: "2026-12-03", fecha_puerto_estimada: "2026-11-18", fecha_ingreso_estimada: "2026-12-04" });
    const hitos = hitosDeEmbarque(e, HOY_F, [
      { hito: "ingreso_cd", fecha_original: "2026-11-15", reprogramaciones: 1, ultima_causa: "aduana" },
      { hito: "arribo", fecha_original: "2026-11-08", reprogramaciones: 1, ultima_causa: "naviera" },
      { hito: "ingreso_stock", fecha_original: "2026-11-15", reprogramaciones: 0, ultima_causa: "programacion" },
    ]);
    const de = (h: string) => hitos.find((x) => x.hito === h);
    expect(de("ingreso_cd")).toMatchObject({ retraso_dias: 18, reprogramaciones: 1 });
    expect(de("arribo")).toMatchObject({ retraso_dias: 10, reprogramaciones: 1 });
    expect(de("ingreso_stock")).toMatchObject({ reprogramaciones: 0, manda_el_mes: true, fecha: "2026-12-04" });
    expect(de("ingreso_stock")?.igual_a_ingreso_cd).toBeUndefined();
    expect(reprogramacionesTotal([{ hito: "ingreso_cd", fecha_original: null, reprogramaciones: 1 }, { hito: "arribo", fecha_original: null, reprogramaciones: 2 }])).toBe(3);
  });

  it("el ingreso al stock sin fijar lleva `igual_a_ingreso_cd`; solo ese hito manda el mes", () => {
    const hitos = hitosDeEmbarque(e261101(), HOY_F);
    expect(hitos.map((h) => h.hito)).toEqual([...HITOS_LOGISTICOS]);
    expect(hitos.filter((h) => h.manda_el_mes).map((h) => h.hito)).toEqual(["ingreso_stock"]);
    expect(hitos.find((h) => h.hito === "ingreso_stock")?.igual_a_ingreso_cd).toBe(true);
  });
});

describe("próximo hito de un embarque", () => {
  it("F25: el vencido más antiguo gana (Arribo 08-nov vencido, con el Zarpe confirmado)", () => {
    expect(proximoHitoEmbarque(hitosDeEmbarque(e261101(), HOY_F))).toEqual({ hito: "arribo", fecha: "2026-11-08", hora: null, estado: "vencido" });
  });
  it("sin vencidos, el primero previsto con la fecha más temprana", () => {
    const e = con({ fecha_puerto_estimada: "2026-11-13" });
    expect(proximoHitoEmbarque(hitosDeEmbarque(e, HOY_F))).toMatchObject({ hito: "arribo", estado: "previsto" });
  });
  it("un embarque completo (todo ocurrió) no tiene próximo hito", () => {
    const e = con({ estado: "recibido", fecha_llegada_real: "2026-11-10", hito_confirmado: "inicio_operativo", fecha_inicio_operativo_estimada: "2026-11-11" });
    expect(proximoHitoEmbarque(hitosDeEmbarque(e, HOY_F))).toBeNull();
  });
});

describe("textos: siempre en palabras además del color", () => {
  const h = (e: EmbarqueParaHitos, hito: string) => hitosDeEmbarque(e, HOY_F).find((x) => x.hito === hito)!;
  it("cada estado tiene su texto", () => {
    expect(textoEstadoHito(h(e261101(), "zarpe"), HOY_F)).toBe("05/10/2026 · Ocurrió ✓");
    expect(textoEstadoHito(h(e261101(), "arribo"), HOY_F)).toBe("08/11/2026 · Debía ocurrir hace 4 días");
    expect(textoEstadoHito(h(e261101(), "ingreso_cd"), HOY_F)).toBe("15/11/2026 · Previsto");
    expect(textoEstadoHito(h(e261101(), "inicio_operativo"), HOY_F)).toBe("Pendiente");
    expect(textoEstadoHito(h(e261101(), "ingreso_stock"), HOY_F)).toBe("15/11/2026 · Previsto (igual al Ingreso CD)");
    const javier = con({ fecha_salida_estimada: null, fecha_puerto_estimada: null, fecha_llegada_estimada: "2026-11-02", fecha_inicio_operativo_estimada: "2026-11-05", hora_inicio_operativo: "09:22", hito_confirmado: "inicio_operativo" });
    expect(textoEstadoHito(h(javier, "zarpe"), HOY_F)).toBe("Ocurrió · sin fecha");
    expect(textoEstadoHito(h(javier, "inicio_operativo"), HOY_F)).toBe("05/11/2026 09:22 · Ocurrió ✓");
    expect(textoEstadoHito(h(javier, "ingreso_stock"), HOY_F)).toBe("02/11/2026 · Llegó, falta confirmar el ingreso");
    expect(textoEstadoHito(h(con({ tipo: "local" }), "arribo"), HOY_F)).toBe("No aplica");
    expect(textoEstadoHito({ ...h(e261101(), "arribo"), fecha: "2026-11-11" }, HOY_F)).toBe("11/11/2026 · Debía ocurrir hace 1 día");
  });
  it("hay un nombre, un marcador y un texto de estado por cada hito y estado", () => {
    for (const x of HITOS) {
      expect(ETIQUETA_HITO[x]).toBeTruthy();
      expect(MARCADOR_HITO[x]).toBeTruthy();
    }
    expect(new Set(HITOS.map((x) => MARCADOR_HITO[x])).size).toBe(6);
    for (const s of ESTADOS_HITO) expect(ETIQUETA_ESTADO_HITO[s]).toBeTruthy();
  });
  it("avisosDeHitos: `hito_vencido` con el texto de Javier y `atrasado` para el ingreso al stock vencido", () => {
    expect(avisosDeHitos(hitosDeEmbarque(e261101(), HOY_F), HOY_F)).toEqual([{ aviso: "hito_vencido", detalle: "Debía arribar a puerto el 08-nov (hace 4 días): ¿ya arribó?" }]);
    const vencido = con({ fecha_llegada_estimada: "2026-11-02", hito_confirmado: "arribo", fecha_puerto_estimada: "2026-11-01" });
    expect(avisosDeHitos(hitosDeEmbarque(vencido, HOY_F), HOY_F).map((a) => a.aviso)).toEqual(["hito_vencido", "atrasado"]);
  });
});
