import { describe, expect, it } from "vitest";
import { cuentaComoAtraso, diasEntre, esMomentoFuturo, integridadDeHitos, ordenDeFechasRoto, sumarDias } from "@/lib/compras/agrupadores/fechas";
import { hitosDeEmbarque } from "@/lib/compras/agrupadores/hitos";
import { cambiaAlgunMes, huellaPlan, planCambiarFecha, planCambiarFechas, planificarMovimiento, type EntradaCambiarFechas } from "@/lib/compras/agrupadores/movimiento";
import { transicionEmbarque, validarGuardarEmbarqueFechas } from "@/lib/compras/agrupadores/estados";
import { AHORA_F, COMPRA_AGR, EMBARQUE_F, ENTREGA_AGR, HOY_F, LINEA_AGR } from "./agrupadores.fixture";
import { ctxF, embarqueDe, motivo, ok, porMes, siguiente, entregasDeLinea } from "./agrupadores.fechas.soporte";

/**
 * 08b-1b: fechas logísticas del embarque (`planCambiarFechas`, F3 a F9, F12, F19 a F21, F38 y F40; reglas F-R1 a F-R5 y F-R9). Hoy = 2026-11-12
 * a las 10:00 (Lima). Todo sobre las funciones puras con el fixture de F, sin base.
 */

const base = (e: string, revision: number, cambios: Omit<EntradaCambiarFechas, "embarque_id" | "revision" | "ahora">): EntradaCambiarFechas => ({ embarque_id: e, revision, ahora: AHORA_F, ...cambios });
const avisosDe = (r: { vista: { avisos: { aviso: string; detalle?: string }[] } }, tipo: string) => r.vista.avisos.filter((a) => a.aviso === tipo);

describe("F3: C1 cambia el Ingreso CD de 261101 a 03-dic (causa aduana)", () => {
  const c = ctxF();
  const r = ok(planCambiarFechas(base(EMBARQUE_F.e261101, 1, { fecha_ingreso_cd: "2026-12-03", motivo: "Aforo físico", causa: "aduana" }), c));

  it("el ingreso al stock sin fijar sigue al Ingreso CD y el mes cambia: l1 nov 300 → dic y POLO nov 400 → dic", () => {
    expect(r.vista.reprograma).toBe(true);
    expect(r.vista.cambios.find((x) => x.hito === "ingreso_cd")).toMatchObject({ antes: "2026-11-15", despues: "2026-12-03", dias: 18 });
    expect(r.vista.cambios.find((x) => x.hito === "ingreso_stock")).toMatchObject({ antes: "2026-11-15", despues: "2026-12-03" });
    expect(r.vista.meses).toEqual([{ de: "2026-11", a: "2026-12", unidades: 700 }]);
    expect(cambiaAlgunMes(r.aplicable)).toBe(true);
    expect(r.aplicable.compras.map((x) => x.id)).toEqual([COMPRA_AGR.c101, COMPRA_AGR.c102].sort());
    expect(r.aplicable.causa).toBe("aduana");
    expect(r.aplicable.embarques[0]).toMatchObject({ id: EMBARQUE_F.e261101, fecha_llegada_estimada: "2026-12-03" });
    expect(Object.keys(r.aplicable.embarques[0]).sort()).toEqual(["fecha_llegada_estimada", "id", "revision"]);
  });

  it("se funde con la entrega de dic (`entregas_fusionadas`; la de dic conserva su id), sube la revisión de las dos compras y la del embarque", () => {
    expect(avisosDe(r, "entregas_fusionadas")).toHaveLength(1);
    const s = siguiente(c, r.aplicable);
    expect(porMes(s, LINEA_AGR.l1)).toEqual({ "2026-12": 500 });
    expect(entregasDeLinea(s, LINEA_AGR.l1)[0].id).toBe(ENTREGA_AGR.l1Dic);
    expect(porMes(s, LINEA_AGR.l102)).toEqual({ "2026-12": 400 });
    expect(s.compras.find((x) => x.id === COMPRA_AGR.c101)?.revision).toBe(4);
    expect(s.compras.find((x) => x.id === COMPRA_AGR.c102)?.revision).toBe(2);
    expect(embarqueDe(s, EMBARQUE_F.e261101)).toMatchObject({ revision: 2, periodo_llegada: "2026-12", fecha_ingreso_estimada: null });
  });

  it("sin `huella_plan` del cliente el servidor no puede aplicar (cambia un mes) y la huella es la del resumen", () => {
    expect(r.vista.huella_plan).toHaveLength(64);
    expect(r.vista.huella_plan).toBe(huellaPlan(r.vista));
  });

  it("el retraso del Ingreso CD (+18 d) se calcula contra la fecha original del resumen de eventos", () => {
    const s = siguiente(c, r.aplicable);
    const hitos = hitosDeEmbarque(embarqueDe(s, EMBARQUE_F.e261101), HOY_F, [{ hito: "ingreso_cd", fecha_original: "2026-11-15", reprogramaciones: 1, ultima_causa: "aduana" }]);
    expect(hitos.find((h) => h.hito === "ingreso_cd")).toMatchObject({ fecha: "2026-12-03", fecha_original: "2026-11-15", retraso_dias: 18, reprogramaciones: 1 });
  });
});

describe("F4 a F6: el ingreso al stock lo fija Javier", () => {
  it("F4: fijarlo en 28-nov (mismo mes) no mueve nada, no toca compras (I6) y deja la causa", () => {
    const c = ctxF();
    const r = ok(planCambiarFechas(base(EMBARQUE_F.e261101, 1, { fecha_ingreso_stock: "2026-11-28", motivo: "Cola de conteo", causa: "cola_conteo" }), c));
    expect(r.aplicable.movimientos).toEqual([]);
    expect(r.aplicable.compras).toEqual([]);
    expect(cambiaAlgunMes(r.aplicable)).toBe(false);
    expect(r.aplicable.causa).toBe("cola_conteo");
    expect(r.aplicable.embarques[0]).toMatchObject({ fecha_ingreso_estimada: "2026-11-28" });
    expect(r.vista.reprograma).toBe(true);
    expect(r.vista.meses).toEqual([]);
    const s = siguiente(c, r.aplicable);
    expect(embarqueDe(s, EMBARQUE_F.e261101)).toMatchObject({ fecha_ingreso_estimada: "2026-11-28", periodo_llegada: "2026-11", fecha_llegada_estimada: "2026-11-15" });
    expect(s.compras.map((x) => x.revision)).toEqual(c.compras.map((x) => x.revision));
  });

  it("F5: fijarlo en 04-dic (causa programacion) mueve a dic como en F3, y esa causa no cuenta como atraso", () => {
    const c = ctxF();
    const r = ok(planCambiarFechas(base(EMBARQUE_F.e261101, 1, { fecha_ingreso_stock: "2026-12-04", motivo: "Soltar en diciembre", causa: "programacion" }), c));
    expect(r.vista.meses).toEqual([{ de: "2026-11", a: "2026-12", unidades: 700 }]);
    expect(r.aplicable.embarques[0]).not.toHaveProperty("fecha_llegada_estimada");
    expect(cuentaComoAtraso("programacion")).toBe(false);
    expect(cuentaComoAtraso("correccion")).toBe(false);
    for (const causa of ["pago", "produccion", "naviera", "aduana", "transporte", "cola_conteo", "otro"] as const) expect(cuentaComoAtraso(causa)).toBe(true);
    expect(cuentaComoAtraso(null)).toBe(true);
  });

  it("F6: «Igualar al Ingreso CD» vuelve a nov; l1 queda nov 300 · dic 200 y la de dic conserva su id original", () => {
    const c0 = ctxF();
    const c1 = siguiente(c0, ok(planCambiarFechas(base(EMBARQUE_F.e261101, 1, { fecha_ingreso_stock: "2026-12-04", motivo: "Dic", causa: "programacion" }), c0)).aplicable);
    expect(porMes(c1, LINEA_AGR.l1)).toEqual({ "2026-12": 500 });
    const r = ok(planCambiarFechas(base(EMBARQUE_F.e261101, 2, { fecha_ingreso_stock: null, motivo: "Vuelve a su fecha", causa: "programacion" }), c1));
    expect(r.aplicable.embarques[0]).toMatchObject({ fecha_ingreso_estimada: null });
    const c2 = siguiente(c1, r.aplicable);
    expect(porMes(c2, LINEA_AGR.l1)).toEqual({ "2026-11": 300, "2026-12": 200 });
    expect(entregasDeLinea(c2, LINEA_AGR.l1).find((e) => e.periodo === "2026-12")?.id).toBe(ENTREGA_AGR.l1Dic);
    expect(embarqueDe(c2, EMBARQUE_F.e261101).periodo_llegada).toBe("2026-11");
  });
});

describe("F7: con el ingreso fijado, mover el Ingreso CD no lo mueve", () => {
  it("queda en 04-dic, no se mueve nada (I6) y avisa `orden_de_fechas`", () => {
    const c0 = ctxF();
    const c1 = siguiente(c0, ok(planCambiarFechas(base(EMBARQUE_F.e261101, 1, { fecha_ingreso_stock: "2026-12-04", motivo: "Dic", causa: "programacion" }), c0)).aplicable);
    const r = ok(planCambiarFechas(base(EMBARQUE_F.e261101, 2, { fecha_ingreso_cd: "2026-12-10", motivo: "La naviera se atrasa", causa: "naviera" }), c1));
    expect(r.aplicable.movimientos).toEqual([]);
    expect(r.aplicable.compras).toEqual([]);
    expect(avisosDe(r, "orden_de_fechas").map((a) => a.detalle)).toEqual(["Ingreso al stock (04-dic) es anterior al Ingreso CD (10-dic)."]);
    expect(r.vista.cambios.map((x) => x.hito)).toEqual(["ingreso_cd"]);
    const s = siguiente(c1, r.aplicable);
    expect(embarqueDe(s, EMBARQUE_F.e261101)).toMatchObject({ fecha_ingreso_estimada: "2026-12-04", fecha_llegada_estimada: "2026-12-10", periodo_llegada: "2026-12" });
  });
});

describe("F8 y F9: Arribo, motivo y causa", () => {
  it("F8: el Arribo de 08-nov a 18-nov no toca compras ni mes; queda +10 d", () => {
    const c = ctxF();
    const r = ok(planCambiarFechas(base(EMBARQUE_F.e261101, 1, { fecha_arribo: "2026-11-18", motivo: "Demora de la naviera", causa: "naviera" }), c));
    expect(r.aplicable.movimientos).toEqual([]);
    expect(r.aplicable.compras).toEqual([]);
    expect(r.aplicable.entregas).toEqual([]);
    expect(r.vista.cambios).toEqual([{ hito: "arribo", antes: "2026-11-08", despues: "2026-11-18", dias: 10 }]);
    const s = siguiente(c, r.aplicable);
    expect(s.entregas).toEqual(c.entregas);
    expect(s.compras).toEqual(c.compras);
  });

  it("F9: sin causa o sin motivo se rechaza; completar un Arribo vacío no los pide; fijar por primera vez un ingreso que cambia la fecha efectiva, sí", () => {
    const c = ctxF();
    expect(motivo(planCambiarFechas(base(EMBARQUE_F.e261101, 1, { fecha_arribo: "2026-11-18", motivo: "x" }), c))).toBe("causa_requerida");
    expect(motivo(planCambiarFechas(base(EMBARQUE_F.e261101, 1, { fecha_arribo: "2026-11-18", causa: "naviera" }), c))).toBe("motivo_requerido");
    expect(motivo(planCambiarFechas(base(EMBARQUE_F.e261101, 1, { fecha_arribo: "2026-11-18", causa: "naviera", motivo: "   " }), c))).toBe("motivo_requerido");
    const completar = ok(planCambiarFechas(base(EMBARQUE_F.e270301, 1, { fecha_arribo: "2027-02-20" }), c));
    expect(completar.vista.reprograma).toBe(false);
    expect(completar.aplicable.causa).toBeUndefined();
    expect(motivo(planCambiarFechas(base(EMBARQUE_F.e270301, 1, { fecha_ingreso_stock: "2027-03-20" }), c))).toBe("motivo_requerido");
    expect(motivo(planCambiarFechas(base(EMBARQUE_F.e270301, 1, { fecha_ingreso_stock: "2027-03-20", motivo: "Soltar más tarde" }), c))).toBe("causa_requerida");
  });

  it("sin nada que cambiar da `sin_cambios` (también «igualar» un ingreso que no estaba fijado y repetir lo mismo)", () => {
    const c = ctxF();
    expect(motivo(planCambiarFechas(base(EMBARQUE_F.e261101, 1, { fecha_ingreso_stock: null }), c))).toBe("sin_cambios");
    expect(motivo(planCambiarFechas(base(EMBARQUE_F.e261101, 1, { fecha_arribo: "2026-11-08" }), c))).toBe("sin_cambios");
    expect(motivo(planCambiarFechas(base(EMBARQUE_F.e261101, 1, { fecha_ingreso_cd: "2026-11-15" }), c))).toBe("sin_cambios");
  });

  it("que el ingreso sin fijar siga al Ingreso CD es parte del cambio del Ingreso CD y no pide otro motivo", () => {
    const c = ctxF();
    const r = ok(planCambiarFechas(base(EMBARQUE_F.e270301, 1, { fecha_ingreso_cd: "2027-03-20", motivo: "Se atrasa", causa: "naviera" }), c));
    expect(r.aplicable.motivo).toBe("Se atrasa");
    expect(r.vista.cambios.map((x) => x.hito)).toEqual(["ingreso_cd", "ingreso_stock"]);
  });

  it("la revisión vieja da `agrupador_cambio` y un embarque inexistente `no_encontrado`", () => {
    expect(motivo(planCambiarFechas(base(EMBARQUE_F.e261101, 0, { fecha_arribo: "2026-11-18", motivo: "x", causa: "otro" }), ctxF()))).toBe("agrupador_cambio");
    expect(motivo(planCambiarFechas(base("00000000-0000-4000-8000-000000000000", 1, { fecha_arribo: "2026-11-18" }), ctxF()))).toBe("no_encontrado");
  });
});

describe("F19: Zarpe ≤ Ingreso CD; Arribo en un local", () => {
  it("Zarpe 25-feb con Ingreso CD 22-feb: `salida_despues_de_llegada`; en el mismo envío con Ingreso CD 28-feb, se acepta", () => {
    const c = ctxF();
    const pide = (llegada: string) => planCambiarFechas(base(EMBARQUE_F.e270301, 1, { fecha_zarpe: "2027-02-25", fecha_ingreso_cd: llegada, motivo: "Adelantar", causa: "naviera" }), c);
    expect(motivo(pide("2027-02-22"))).toBe("salida_despues_de_llegada");
    const r = ok(pide("2027-02-28"));
    expect(r.vista.meses).toEqual([{ de: "2027-03", a: "2027-02", unidades: 600 }]);
  });

  it("el Arribo de un embarque `local` da `puerto_en_local` (también confirmar el arribo)", () => {
    const c = ctxF({ embarques: ctxF().embarques.map((e) => (e.id === EMBARQUE_F.e270301 ? { ...e, tipo: "local" as const } : e)) });
    expect(motivo(planCambiarFechas(base(EMBARQUE_F.e270301, 1, { fecha_arribo: "2027-02-20" }), c))).toBe("puerto_en_local");
    expect(motivo(planCambiarFechas(base(EMBARQUE_F.e270301, 1, { hito_confirmado: "arribo" }), c))).toBe("puerto_en_local");
    expect(ok(planCambiarFechas(base(EMBARQUE_F.e270301, 1, { fecha_zarpe: "2027-02-20" }), c)).ok).toBe(true);
  });
});

describe("F20: marcar un hito como ocurrido", () => {
  it("el Arribo en 18-nov (futuro) marcado «ya arribó» da `fecha_futura`; Zarpe 10-nov «ya zarpó» pasa a en tránsito con aviso", () => {
    const c = ctxF();
    expect(motivo(planCambiarFechas(base(EMBARQUE_F.e270301, 1, { fecha_arribo: "2026-11-18", hito_confirmado: "arribo" }), c))).toBe("fecha_futura");
    const r = ok(planCambiarFechas(base(EMBARQUE_F.e270301, 1, { fecha_zarpe: "2026-11-10", hito_confirmado: "zarpe" }), c));
    expect(avisosDe(r, "pasa_a_en_transito")).toHaveLength(1);
    expect(r.vista.reprograma).toBe(false);
    const s = siguiente(c, r.aplicable);
    expect(embarqueDe(s, EMBARQUE_F.e270301)).toMatchObject({ estado: "en_transito", hito_confirmado: "zarpe", fecha_salida_estimada: "2026-11-10" });
  });

  it("volver a planificado con un hito confirmado da `hito_confirmado`; sin hito se permite", () => {
    const sin = { asignaciones_activas: 0, recepciones_vinculadas: 0 };
    expect(transicionEmbarque("en_transito", "volver_a_planificado", { ...sin, hito_confirmado: "zarpe" })).toEqual({ ok: false, motivo: "hito_confirmado" });
    expect(transicionEmbarque("en_transito", "volver_a_planificado", { ...sin, hito_confirmado: null })).toEqual({ ok: true, hacia: "planificado" });
    expect(transicionEmbarque("en_transito", "volver_a_planificado", sin)).toEqual({ ok: true, hacia: "planificado" });
  });

  it("confirmar exige la fecha del hito y que ninguno de los anteriores con fecha sea futuro", () => {
    const c = ctxF();
    expect(motivo(planCambiarFechas(base(EMBARQUE_F.e270301, 1, { hito_confirmado: "zarpe" }), c))).toBe("fecha_requerida");
    // Zarpe sin fecha y Arribo en el pasado: «arribo» se acepta (el zarpe queda «ocurrió sin fecha»)...
    expect(ok(planCambiarFechas(base(EMBARQUE_F.e270301, 1, { fecha_arribo: "2026-11-10", hito_confirmado: "arribo" }), c)).ok).toBe(true);
    // ...pero con un Zarpe futuro delante no.
    expect(motivo(planCambiarFechas(base(EMBARQUE_F.e270301, 1, { fecha_zarpe: "2026-11-20", fecha_arribo: "2026-11-10", hito_confirmado: "arribo" }), c))).toBe("fecha_futura");
  });
});

describe("F21: el caso de Javier", () => {
  const c0 = ctxF();
  const confirmar = (inicio: { fecha: string; hora: string | null }) => planCambiarFechas(base(EMBARQUE_F.eJavier, 1, { inicio_operativo: inicio, hito_confirmado: "inicio_operativo" }), c0);

  it("Zarpe y Arribo vacíos, Ingreso CD 02-nov, inicio operativo 05-nov 09:22 confirmado: se acepta tal cual", () => {
    const r = ok(confirmar({ fecha: "2026-11-05", hora: "09:22" }));
    expect(r.vista.reprograma).toBe(false);
    expect(r.aplicable.embarques[0]).toMatchObject({ fecha_inicio_operativo_estimada: "2026-11-05", hora_inicio_operativo: "09:22", hito_confirmado: "inicio_operativo" });
    const s = siguiente(c0, r.aplicable);
    const hitos = hitosDeEmbarque(embarqueDe(s, EMBARQUE_F.eJavier), HOY_F);
    expect(hitos.map((h) => [h.hito, h.estado])).toEqual([
      ["zarpe", "sin_registrar"],
      ["arribo", "sin_registrar"],
      ["ingreso_cd", "real"],
      ["inicio_operativo", "real"],
      ["ingreso_stock", "por_confirmar"],
    ]);
    expect(hitos[3]).toMatchObject({ fecha: "2026-11-05", hora: "09:22" });
    expect(hitos[4]).toMatchObject({ fecha: "2026-11-02", igual_a_ingreso_cd: true, manda_el_mes: true });
  });

  it("con un inicio operativo de hoy más tarde que la hora actual (11:00 > 10:00) da `fecha_futura`; a las 10:00 en punto se acepta", () => {
    expect(motivo(confirmar({ fecha: "2026-11-12", hora: "11:00" }))).toBe("fecha_futura");
    expect(ok(confirmar({ fecha: "2026-11-12", hora: "10:00" })).ok).toBe(true);
    expect(ok(confirmar({ fecha: "2026-11-12", hora: null })).ok).toBe(true);
    expect(motivo(confirmar({ fecha: "2026-11-13", hora: null }))).toBe("fecha_futura");
  });
});

describe("F40: integridad después de confirmar (I7) en todo guardado", () => {
  const c0 = ctxF();
  const c1 = siguiente(c0, ok(planCambiarFechas(base(EMBARQUE_F.eJavier, 1, { inicio_operativo: { fecha: "2026-11-05", hora: "09:22" }, hito_confirmado: "inicio_operativo" }), c0)).aplicable);
  const dar = (cambios: Omit<EntradaCambiarFechas, "embarque_id" | "revision" | "ahora">) => planCambiarFechas(base(EMBARQUE_F.eJavier, 2, { motivo: "Se reprograma", causa: "cola_conteo", ...cambios }), c1);

  it("(a) cambiar el inicio operativo confirmado a 20-nov da `fecha_futura`", () => {
    expect(motivo(dar({ inicio_operativo: { fecha: "2026-11-20", hora: null } }))).toBe("fecha_futura");
  });
  it("(b) lo mismo bajando en el mismo envío `hito_confirmado` a nulo se acepta como reprogramación (pide motivo y causa)", () => {
    const r = ok(dar({ inicio_operativo: { fecha: "2026-11-20", hora: null }, hito_confirmado: null }));
    expect(r.vista.reprograma).toBe(true);
    expect(motivo(planCambiarFechas(base(EMBARQUE_F.eJavier, 2, { inicio_operativo: { fecha: "2026-11-20", hora: null }, hito_confirmado: null }), c1))).toBe("motivo_requerido");
    const s = siguiente(c1, r.aplicable);
    expect(embarqueDe(s, EMBARQUE_F.eJavier)).toMatchObject({ hito_confirmado: null, fecha_inicio_operativo_estimada: "2026-11-20" });
  });
  it("(c) vaciar el inicio operativo (el hito confirmado) da `fecha_requerida`", () => {
    expect(motivo(dar({ inicio_operativo: null }))).toBe("fecha_requerida");
  });
  it("(c bis) vaciar el inicio operativo bajando la confirmación vacía también la hora", () => {
    const r = ok(dar({ inicio_operativo: null, hito_confirmado: null }));
    const s = siguiente(c1, r.aplicable);
    expect(embarqueDe(s, EMBARQUE_F.eJavier)).toMatchObject({ fecha_inicio_operativo_estimada: null, hora_inicio_operativo: null });
  });
  it("completar la hora de un inicio operativo que ya tenía fecha pero no hora no reprograma", () => {
    const c = siguiente(c0, ok(planCambiarFechas(base(EMBARQUE_F.eJavier, 1, { inicio_operativo: { fecha: "2026-11-05", hora: null } }), c0)).aplicable);
    const r = ok(planCambiarFechas(base(EMBARQUE_F.eJavier, 2, { inicio_operativo: { fecha: "2026-11-05", hora: "09:22" } }), c));
    expect(r.vista.reprograma).toBe(false);
    const c2 = siguiente(c, r.aplicable);
    // Cambiar una hora que ya tenía valor SÍ reprograma: pide motivo y causa.
    expect(motivo(planCambiarFechas(base(EMBARQUE_F.eJavier, 3, { inicio_operativo: { fecha: "2026-11-05", hora: "10:00" } }), c2))).toBe("motivo_requerido");
    const cambio = ok(planCambiarFechas(base(EMBARQUE_F.eJavier, 3, { inicio_operativo: { fecha: "2026-11-05", hora: "10:00" }, motivo: "Empezó más tarde", causa: "cola_conteo" }), c2));
    expect(cambio.vista.reprograma).toBe(true);
  });
  it("(d) pasar un embarque con Arribo (o con hito arribo) a `local` por PATCH da `puerto_en_local`; sin ellos pasa", () => {
    const e = embarqueDe(c0, EMBARQUE_F.e261101);
    const entrada = { tipo: "local" as const, viaje_id: null };
    expect(validarGuardarEmbarqueFechas(entrada, e)).toBe("puerto_en_local");
    expect(validarGuardarEmbarqueFechas(entrada, { ...e, fecha_puerto_estimada: null, hito_confirmado: "arribo" })).toBe("puerto_en_local");
    expect(validarGuardarEmbarqueFechas(entrada, { ...e, fecha_puerto_estimada: null, hito_confirmado: null })).toBeNull();
  });
  it("integridadDeHitos: el hito confirmado con fecha, ningún hito en o antes con fecha futura", () => {
    const v = { fecha_salida_estimada: "2026-10-05", fecha_puerto_estimada: null, fecha_llegada_estimada: "2026-11-02", fecha_inicio_operativo_estimada: null, hora_inicio_operativo: null, hito_confirmado: null } as const;
    expect(integridadDeHitos(v, AHORA_F)).toBeNull();
    expect(integridadDeHitos({ ...v, hito_confirmado: "zarpe" }, AHORA_F)).toBeNull();
    expect(integridadDeHitos({ ...v, hito_confirmado: "arribo" }, AHORA_F)).toBe("fecha_requerida");
    expect(integridadDeHitos({ ...v, hito_confirmado: "ingreso_cd", fecha_llegada_estimada: "2026-11-13" }, AHORA_F)).toBe("fecha_futura");
    expect(integridadDeHitos({ ...v, hito_confirmado: "zarpe", fecha_llegada_estimada: "2026-11-13" }, AHORA_F)).toBeNull();
    expect(integridadDeHitos({ ...v, hito_confirmado: "inicio_operativo", fecha_inicio_operativo_estimada: "2026-11-12", hora_inicio_operativo: "10:01" }, AHORA_F)).toBe("fecha_futura");
  });
});

describe("F22: el PATCH nunca cambia ni vacía fechas ni horas (`guardar_embarque`)", () => {
  const e = embarqueDe(ctxF(), EMBARQUE_F.e261101);
  const patch = (cuerpo: Partial<Parameters<typeof validarGuardarEmbarqueFechas>[0]>) => validarGuardarEmbarqueFechas({ tipo: "importacion", viaje_id: null, ...cuerpo }, e);

  it("sin la salida en el cuerpo se conserva (null: no hay error); con otra distinta, o `null` explícito con una salida guardada: `fecha_por_movimiento`; con la misma: OK", () => {
    expect(patch({})).toBeNull();
    expect(patch({ fecha_salida_estimada: "2026-10-28" })).toBe("fecha_por_movimiento");
    expect(patch({ fecha_salida_estimada: null })).toBe("fecha_por_movimiento");
    expect(patch({ fecha_salida_estimada: "2026-10-05" })).toBeNull();
  });
  it("lo mismo con las demás fechas y la hora; el origen no es una fecha", () => {
    expect(patch({ fecha_puerto_estimada: "2026-11-09" })).toBe("fecha_por_movimiento");
    expect(patch({ fecha_llegada_estimada: "2026-11-20" })).toBe("fecha_por_movimiento");
    expect(patch({ fecha_llegada_estimada: "2026-11-15" })).toBeNull();
    expect(patch({ fecha_inicio_operativo_estimada: "2026-11-16" })).toBe("fecha_por_movimiento");
    expect(patch({ hora_inicio_operativo: "09:00" })).toBe("fecha_por_movimiento");
    expect(patch({ hora_inicio_operativo: null })).toBeNull();
    expect(patch({ fecha_ingreso_estimada: "2026-11-20" })).toBe("fecha_por_movimiento");
  });
  it("al crear: Ingreso CD obligatorio, hora sin fecha, Arribo en un local y salida después del Ingreso CD", () => {
    const crear = (cuerpo: Parameters<typeof validarGuardarEmbarqueFechas>[0]) => validarGuardarEmbarqueFechas(cuerpo, null);
    expect(crear({ tipo: "importacion", viaje_id: null })).toBe("fecha_requerida");
    expect(crear({ tipo: "importacion", viaje_id: null, fecha_llegada_estimada: "2026-11-15", hora_inicio_operativo: "09:00" })).toBe("hora_sin_fecha");
    expect(crear({ tipo: "importacion", viaje_id: null, fecha_llegada_estimada: "2026-11-15", fecha_inicio_operativo_estimada: "2026-11-16", hora_inicio_operativo: "09:00" })).toBeNull();
    expect(crear({ tipo: "local", viaje_id: null, fecha_llegada_estimada: "2026-11-15", fecha_puerto_estimada: "2026-11-10" })).toBe("puerto_en_local");
    expect(crear({ tipo: "importacion", viaje_id: null, fecha_llegada_estimada: "2026-11-15", fecha_salida_estimada: "2026-11-16" })).toBe("salida_despues_de_llegada");
  });
});

describe("el plan «viejo» (alias de /fecha) se comporta como en 08b-1", () => {
  it("planCambiarFecha: motivo siempre, `causa` fija `otro`, sin `paquetes` y solo `fecha_llegada_estimada` en el embarque", () => {
    const c = ctxF();
    const r = ok(planCambiarFecha({ embarque_id: EMBARQUE_F.e261101, revision: 1, fecha_llegada_estimada: "2026-12-03", motivo: "Retraso" }, c));
    expect(r.aplicable.causa).toBe("otro");
    expect(r.aplicable).not.toHaveProperty("paquetes");
    expect(Object.keys(r.aplicable.embarques[0]).sort()).toEqual(["fecha_llegada_estimada", "id", "revision"]);
    expect(r.aplicable.motivo).toBe("Retraso");
    expect(motivo(planCambiarFecha({ embarque_id: EMBARQUE_F.e261101, revision: 1, fecha_llegada_estimada: "2026-12-03", motivo: " " }, c))).toBe("motivo_requerido");
    expect(planificarMovimiento({ operacion: "cambiar_fecha", embarque_id: EMBARQUE_F.e261101, revision: 1, fecha_llegada_estimada: "2026-12-03", motivo: "Retraso" }, c)).toEqual(r);
  });

  it("F23: equivale a /fechas con solo el Ingreso CD y causa `otro`: mismas entregas y mismo efecto (la causa aparte)", () => {
    const c = ctxF();
    const viejo = ok(planCambiarFecha({ embarque_id: EMBARQUE_F.e261101, revision: 1, fecha_llegada_estimada: "2026-12-03", motivo: "Retraso" }, c));
    const nuevo = ok(planCambiarFechas(base(EMBARQUE_F.e261101, 1, { fecha_ingreso_cd: "2026-12-03", motivo: "Retraso", causa: "otro" }), c));
    expect(nuevo.aplicable.movimientos).toEqual(viejo.aplicable.movimientos);
    expect(nuevo.aplicable.entregas).toEqual(viejo.aplicable.entregas);
    expect(nuevo.aplicable.repartos).toEqual(viejo.aplicable.repartos);
    expect(nuevo.aplicable.compras).toEqual(viejo.aplicable.compras);
    expect(nuevo.vista.huella_plan).toBe(viejo.vista.huella_plan);
    expect(nuevo.aplicable.causa).toBe("otro");
  });
});

describe("estados: en qué estado del embarque se puede cambiar cada fecha", () => {
  const recibido = ctxF({ embarques: ctxF().embarques.map((e) => (e.id === EMBARQUE_F.e261101 ? { ...e, estado: "recibido" as const, fecha_llegada_real: "2026-11-10" } : e)) });
  it("en un embarque recibido el Ingreso CD y el ingreso al stock no cambian, pero el Zarpe, Arribo e Inicio operativo sí", () => {
    expect(motivo(planCambiarFechas(base(EMBARQUE_F.e261101, 1, { fecha_ingreso_cd: "2026-12-03", motivo: "x", causa: "otro" }), recibido))).toBe("embarque_no_editable");
    expect(motivo(planCambiarFechas(base(EMBARQUE_F.e261101, 1, { fecha_ingreso_stock: "2026-12-03", motivo: "x", causa: "otro" }), recibido))).toBe("embarque_no_editable");
    expect(ok(planCambiarFechas(base(EMBARQUE_F.e261101, 1, { fecha_arribo: "2026-11-09", motivo: "x", causa: "correccion" }), recibido)).ok).toBe(true);
  });
  it("en un embarque cancelado, nada", () => {
    const cancelado = ctxF({ embarques: ctxF().embarques.map((e) => (e.id === EMBARQUE_F.e270301 ? { ...e, estado: "cancelado" as const } : e)) });
    expect(motivo(planCambiarFechas(base(EMBARQUE_F.e270301, 1, { fecha_arribo: "2027-02-20" }), cancelado))).toBe("embarque_no_editable");
  });
  it("con recepciones vinculadas a una asignación cuyo mes cambiaría: `embarque_con_recepciones`; si el mes no cambia, se permite", () => {
    const c = ctxF({ recepciones_vinculadas: new Map([["f0f90000-0000-4000-8000-000000000001", 10]]) });
    const vinculada = ctxF({ recepciones_vinculadas: new Map([[c.asignaciones[0].id, 10]]) });
    expect(motivo(planCambiarFechas(base(EMBARQUE_F.e261101, 1, { fecha_ingreso_cd: "2026-12-03", motivo: "x", causa: "otro" }), vinculada))).toBe("embarque_con_recepciones");
    expect(ok(planCambiarFechas(base(EMBARQUE_F.e261101, 1, { fecha_ingreso_cd: "2026-11-28", motivo: "x", causa: "otro" }), vinculada)).ok).toBe(true);
  });
});

describe("utilidades de fecha", () => {
  it("diasEntre y sumarDias", () => {
    expect(diasEntre("2026-11-15", "2026-12-03")).toBe(18);
    expect(diasEntre("2026-12-03", "2026-11-15")).toBe(-18);
    expect(sumarDias("2026-12-30", 3)).toBe("2027-01-02");
  });
  it("esMomentoFuturo mide con la hora solo el día de hoy", () => {
    expect(esMomentoFuturo("2026-11-12", "10:01", AHORA_F)).toBe(true);
    expect(esMomentoFuturo("2026-11-12", "10:00", AHORA_F)).toBe(false);
    expect(esMomentoFuturo("2026-11-12", null, AHORA_F)).toBe(false);
    expect(esMomentoFuturo("2026-11-11", "23:59", AHORA_F)).toBe(false);
    expect(esMomentoFuturo("2026-11-13", null, AHORA_F)).toBe(true);
  });
  it("ordenDeFechasRoto avisa los pares fuera de orden, no el Zarpe después del Ingreso CD (lo bloquea la base)", () => {
    expect(ordenDeFechasRoto({ zarpe: "2026-10-05", arribo: "2026-11-08", ingreso_cd: "2026-11-15", inicio_operativo: "2026-11-16", ingreso_stock: "2026-11-20" })).toEqual([]);
    expect(ordenDeFechasRoto({ ingreso_cd: "2026-11-15", ingreso_stock: "2026-11-12" })).toEqual(["Ingreso al stock (12-nov) es anterior al Ingreso CD (15-nov)."]);
    expect(ordenDeFechasRoto({ zarpe: "2026-11-20", ingreso_cd: "2026-11-15" })).toEqual([]);
    expect(ordenDeFechasRoto({ arribo: "2026-11-16", ingreso_cd: "2026-11-15" })).toEqual(["Ingreso CD (15-nov) es anterior al Arribo (16-nov)."]);
    expect(ordenDeFechasRoto({ arribo: null, ingreso_cd: "2026-11-15", inicio_operativo: null, ingreso_stock: null })).toEqual([]);
  });
});
