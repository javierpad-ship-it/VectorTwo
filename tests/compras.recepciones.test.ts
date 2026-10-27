import { describe, expect, it } from "vitest";
import {
  aplicarQuitarRecepcion,
  aplicarRecepciones,
  argsQuitarRecepcion,
  argsRegistrarRecepciones,
  avisosRecepcion,
  ingresosDeRecepciones,
  recepcionDeSugerencia,
  validarQuitarRecepcion,
  validarRecepciones,
} from "@/lib/compras/recepciones";
import { estadoDeCompra, type ModeloCompra } from "@/lib/compras/reglas";
import type { RecepcionNueva } from "@/lib/compras/tipos";
import { COMPRA, LINEA, registrosC12 } from "./compras.fixture";
import { ACTOR, modeloDeRegistros } from "./compras.estado.fixture";

/** Regla 13 de la ficha 08: confirmar ingreso (recepciones) y sus avisos. */

const K = "2026-09";
const AHORA = "2026-10-27T10:00:00.000Z";
const op = { compra_id: COMPRA.c12, actor: ACTOR, ahora: AHORA };

const nueva = (unidades: number, periodo: string, extra: Partial<RecepcionNueva> = {}): RecepcionNueva => ({
  linea_id: LINEA.c12,
  recibida_periodo: periodo,
  unidades,
  fecha_recepcion: `${periodo}-15`,
  nota: null,
  origen: "manual",
  ...extra,
});

const c12 = (o: Parameters<typeof registrosC12>[0] = {}): ModeloCompra => modeloDeRegistros(registrosC12(o));

describe("validarRecepciones (orden de registrar_recepciones)", () => {
  it("acepta un ingreso que cabe en lo pendiente", () => {
    expect(validarRecepciones(c12(), 3, [nueva(500, "2026-10")])).toBeNull();
  });

  it("excede_pendiente si la suma supera las unidades de la línea", () => {
    expect(validarRecepciones(c12(), 3, [nueva(600, "2026-10")])).toMatchObject({ motivo: "excede_pendiente", linea_id: LINEA.c12 });
    // Varias recepciones sobre la misma línea suman.
    expect(validarRecepciones(c12(), 3, [nueva(300, "2026-10"), nueva(300, "2026-11")])).toMatchObject({ motivo: "excede_pendiente" });
    // Y se cuenta lo ya recibido.
    expect(validarRecepciones(c12({ recepciones: [["2026-10", 200]] }), 3, [nueva(301, "2026-10")])).toMatchObject({ motivo: "excede_pendiente" });
    expect(validarRecepciones(c12({ recepciones: [["2026-10", 200]] }), 3, [nueva(300, "2026-10")])).toBeNull();
  });

  it("recepcion_antes_de_compra si el mes es anterior al de la fecha de compra (2026-10-14)", () => {
    expect(validarRecepciones(c12(), 3, [nueva(10, "2026-09")])).toMatchObject({ motivo: "recepcion_antes_de_compra" });
    expect(validarRecepciones(c12(), 3, [nueva(10, "2026-10")])).toBeNull();
  });

  it("no_pertenece si una línea es de otra compra", () => {
    expect(validarRecepciones(c12(), 3, [nueva(10, "2026-10", { linea_id: LINEA.c09 })])).toMatchObject({ motivo: "no_pertenece", linea_id: LINEA.c09 });
  });

  it("compra_cambio manda sobre todo lo demás (revisión distinta)", () => {
    expect(validarRecepciones(c12(), 2, [nueva(600, "2026-09")])).toEqual({ motivo: "compra_cambio" });
  });

  it("una cancelada es no_editable, un borrador no_confirmada y una lista vacía sin_recepciones", () => {
    expect(validarRecepciones(c12({ estado: "cancelada" }), 3, [nueva(1, "2026-10")])).toEqual({ motivo: "no_editable" });
    expect(validarRecepciones(c12({ estado: "borrador" }), 3, [nueva(1, "2026-10")])).toEqual({ motivo: "no_confirmada" });
    expect(validarRecepciones(c12(), 3, [])).toEqual({ motivo: "sin_recepciones" });
  });
});

describe("aplicarRecepciones y aplicarQuitarRecepcion (espejo de las funciones SQL)", () => {
  it("unidades_recibidas es la suma de las recepciones y recibida cuando todas las líneas llegan", () => {
    const parcial = aplicarRecepciones(c12(), 3, [nueva(200, "2026-10")], { ...op, ids: ["r1"] });
    if (!parcial.ok) throw new Error("debía aplicar");
    expect(parcial.modelo.lineas[0].unidades_recibidas).toBe(200);
    expect(parcial.modelo.estado).toBe("confirmada");
    expect(parcial.modelo.revision).toBe(4);

    const total = aplicarRecepciones(parcial.modelo, 4, [nueva(300, "2026-11")], { ...op, ids: ["r2"] });
    if (!total.ok) throw new Error("debía aplicar");
    expect(total.modelo.lineas[0].unidades_recibidas).toBe(500);
    expect(total.modelo.estado).toBe("recibida");
    expect(estadoDeCompra(total.modelo)).toBe("recibida");
  });

  it("quitar una recepción resta, vuelve a confirmada y deja el evento quitar_recepcion", () => {
    const hecho = aplicarRecepciones(c12(), 3, [nueva(500, "2026-10")], { ...op, ids: ["r1"] });
    if (!hecho.ok) throw new Error("debía aplicar");
    expect(hecho.modelo.estado).toBe("recibida");
    const quitado = aplicarQuitarRecepcion(hecho.modelo, 4, "r1", op);
    if (!quitado.ok) throw new Error("debía quitar");
    expect(quitado.modelo.lineas[0].unidades_recibidas).toBe(0);
    expect(quitado.modelo.estado).toBe("confirmada");
    expect(quitado.evento).toMatchObject({ accion: "quitar_recepcion", linea_id: LINEA.c12, usuario_nombre: "Planner Uno" });
    expect(quitado.evento.antes).toMatchObject({ estado: "recibida" });
    expect(quitado.evento.despues).toMatchObject({ estado: "confirmada" });
  });

  it("un rechazo no cambia nada", () => {
    const r = aplicarRecepciones(c12(), 3, [nueva(600, "2026-10")], op);
    expect(r.ok).toBe(false);
    const q = aplicarQuitarRecepcion(c12(), 3, "no-existe", op);
    expect(q).toMatchObject({ ok: false, rechazo: { motivo: "no_pertenece" } });
  });

  it("el evento recibir lleva el motivo, el nombre del usuario y la línea si es una sola", () => {
    const r = aplicarRecepciones(c12(), 3, [nueva(100, "2026-10")], { ...op, motivo: "sugerencia de conciliación oct-2026", ids: ["r1"] });
    if (!r.ok) throw new Error("debía aplicar");
    expect(r.evento).toMatchObject({ accion: "recibir", linea_id: LINEA.c12, motivo: "sugerencia de conciliación oct-2026", usuario_nombre: "Planner Uno", compra_id: COMPRA.c12 });
    expect(r.evento.antes).toMatchObject({ revision: 3 });
    expect(r.evento.despues).toMatchObject({ revision: 4 });
  });
});

describe("validarQuitarRecepcion (orden de quitar_recepcion)", () => {
  const con = c12({ recepciones: [["2026-10", 100]] });
  const id = con.recepciones[0].id;

  it("pasa con la revisión vigente y una recepción de la compra", () => {
    expect(validarQuitarRecepcion(con, 3, id)).toBeNull();
  });
  it("compra_cambio, no_editable y no_pertenece", () => {
    expect(validarQuitarRecepcion(con, 9, id)).toEqual({ motivo: "compra_cambio" });
    expect(validarQuitarRecepcion({ ...con, estado: "cancelada" }, 3, id)).toEqual({ motivo: "no_editable" });
    expect(validarQuitarRecepcion(con, 3, "de-otra-compra")).toEqual({ motivo: "no_pertenece" });
  });
});

describe("argumentos de las funciones SQL", () => {
  it("registrar_recepciones lleva los meses como aaaa-mm-01 y el origen manual por defecto", () => {
    const a = argsRegistrarRecepciones({
      compra_id: COMPRA.c12,
      revision: 3,
      recepciones: [{ linea_id: LINEA.c12, recibida_periodo: "2026-10", unidades: 200, fecha_recepcion: "2026-10-20" }],
      actor: ACTOR,
    });
    expect(a).toEqual({
      p_compra: COMPRA.c12,
      p_revision: 3,
      p_recepciones: [{ linea_id: LINEA.c12, recibida_periodo: "2026-10-01", unidades: 200, fecha_recepcion: "2026-10-20", nota: null, origen: "manual" }],
      p_actor: ACTOR,
      p_motivo: null,
    });
  });

  it("quitar_recepcion", () => {
    expect(argsQuitarRecepcion({ compra_id: COMPRA.c12, recepcion_id: "r1", revision: 5, actor: ACTOR })).toEqual({ p_compra: COMPRA.c12, p_recepcion: "r1", p_revision: 5, p_actor: ACTOR });
  });
});

describe("Aceptar sugerencia (§0.5)", () => {
  it("registra la recepción en el mes X con fecha el último día, origen sugerencia y su nota y motivo", () => {
    const { recepcion, motivo } = recepcionDeSugerencia({ linea_id: LINEA.c09, periodo: "2026-09", unidades: 500 });
    expect(recepcion).toEqual({
      linea_id: LINEA.c09,
      recibida_periodo: "2026-09",
      unidades: 500,
      fecha_recepcion: "2026-09-30",
      nota: "Aceptada desde la conciliación de set-2026",
      origen: "sugerencia",
    });
    expect(motivo).toBe("sugerencia de conciliación set-2026");
  });

  it("febrero de un año bisiesto termina el 29", () => {
    expect(recepcionDeSugerencia({ linea_id: "l", periodo: "2028-02", unidades: 1 }).recepcion.fecha_recepcion).toBe("2028-02-29");
  });
});

describe("ingresos al flujo y avisos (regla 13)", () => {
  it("solo suman las recepciones con recibida_periodo > k'; las de ≤ k' ya están en el stock publicado", () => {
    const ing = ingresosDeRecepciones(
      [
        { recibida_periodo: "2026-10", unidades: 100 },
        { recibida_periodo: "2026-10", unidades: 50 },
        { recibida_periodo: "2026-09", unidades: 200 },
        { recibida_periodo: "2026-08", unidades: 300 },
        { recibida_periodo: "2026-12", unidades: 30 },
      ],
      K,
    );
    expect(ing).toEqual([
      { periodo: "2026-10", unidades: 150 },
      { periodo: "2026-12", unidades: 30 },
    ]);
  });

  it("publicar el mes de una recepción la quita del flujo: con k' = oct la de oct cuenta 0", () => {
    const rec = [{ recibida_periodo: "2026-10", unidades: 200 }];
    expect(ingresosDeRecepciones(rec, "2026-09")).toEqual([{ periodo: "2026-10", unidades: 200 }]);
    expect(ingresosDeRecepciones(rec, "2026-10")).toEqual([]);
  });

  it("recepcion_en_mes_cerrado si ≤ k' y recibida_futura si es posterior al mes de hoy", () => {
    expect(avisosRecepcion({ recibida_periodo: "2026-09" }, K, "2026-10-27")).toEqual(["recepcion_en_mes_cerrado"]);
    expect(avisosRecepcion({ recibida_periodo: "2026-10" }, K, "2026-10-27")).toEqual([]);
    expect(avisosRecepcion({ recibida_periodo: "2026-12" }, K, "2026-10-27")).toEqual(["recibida_futura"]);
    expect(avisosRecepcion({ recibida_periodo: "2026-12" }, K, "2026-10")).toEqual(["recibida_futura"]);
  });

  it("recepcion_sobre_saldo_cancelado lo pide quien llama", () => {
    expect(avisosRecepcion({ recibida_periodo: "2026-10" }, K, "2026-10-27", { sobre_saldo_cancelado: true })).toEqual(["recepcion_sobre_saldo_cancelado"]);
  });
});
