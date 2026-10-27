import { describe, expect, it } from "vitest";
import { aplicarCancelacion, argsCancelarCompra, planCancelacion, validarCancelacion } from "@/lib/compras/cancelar";
import { pendientesPorEntrega } from "@/lib/compras/pendientes";
import { aplicarQuitarRecepcion, aplicarRecepciones, ingresosDeRecepciones } from "@/lib/compras/recepciones";
import { transicion, type ModeloCompra } from "@/lib/compras/reglas";
import { COMPRA, LINEA, registrosC12 } from "./compras.fixture";
import { ACTOR, modeloDeRegistros } from "./compras.estado.fixture";

/** Regla 16 (cancelar) y regla 31 de la ficha 08: cancelar con recepciones cierra el saldo. */

const AHORA = "2026-10-25T16:00:00.000Z";
const op = { compra_id: COMPRA.c12, actor: ACTOR, ahora: AHORA, numero: "C-000012" };

/** Caso 31: 500 en dos entregas (oct 300 · nov 200) con 300 recibidas (100 en ago, 200 en oct). */
const parcial = (): ModeloCompra =>
  modeloDeRegistros(registrosC12({ entregas: [["2026-10", 300], ["2026-11", 200]], recepciones: [["2026-08", 100], ["2026-10", 200]] }));

describe("planCancelacion", () => {
  it("sin recepciones cancela la compra entera: nada queda cancelado línea a línea", () => {
    const plan = planCancelacion(modeloDeRegistros(registrosC12()), "C-000012");
    expect(plan).toMatchObject({ ok: true, resultado: "cancelada", estado: "cancelada", unidades: 500, unidades_recibidas: 0, unidades_canceladas: 0, lineas: [] });
  });

  it("con recepciones cierra el saldo: canceladas = unidades − recibidas y la compra queda recibida", () => {
    const plan = planCancelacion(parcial(), "C-000012");
    expect(plan).toMatchObject({
      ok: true,
      resultado: "saldo_cerrado",
      estado: "recibida",
      unidades: 500,
      unidades_recibidas: 300,
      unidades_canceladas: 200,
      lineas: [{ linea_id: LINEA.c12, unidades_canceladas: 200 }],
    });
    if (plan.ok) {
      expect(plan.mensaje_confirmacion).toBe("C-000012 tiene 300 u confirmadas de 500: se cancela el saldo de 200 u y la compra queda como recibida parcialmente.");
    }
  });

  it("todo recibido, o saldo ya cerrado, responde recibida; una cancelada es no_editable", () => {
    const todo = aplicarRecepciones(modeloDeRegistros(registrosC12()), 3, [{ linea_id: LINEA.c12, recibida_periodo: "2026-10", unidades: 500, fecha_recepcion: "2026-10-20", nota: null, origen: "manual" }], op);
    if (!todo.ok) throw new Error("debía aplicar");
    expect(planCancelacion(todo.modelo)).toEqual({ ok: false, motivo: "recibida" });
    expect(planCancelacion({ ...parcial(), estado: "recibida", cancelada_at: AHORA })).toEqual({ ok: false, motivo: "recibida" });
    expect(planCancelacion({ ...parcial(), estado: "cancelada" })).toEqual({ ok: false, motivo: "no_editable" });
  });
});

describe("validarCancelacion (orden de cancelar_compra)", () => {
  const m = modeloDeRegistros(registrosC12());
  it("pasa con la revisión vigente y un motivo", () => {
    expect(validarCancelacion(m, 3, "Se compró por error")).toBeNull();
  });
  it("compra_cambio, no_editable, recibida y motivo_requerido", () => {
    expect(validarCancelacion(m, 2, "x")).toBe("compra_cambio");
    expect(validarCancelacion({ ...m, estado: "cancelada" }, 3, "x")).toBe("no_editable");
    expect(validarCancelacion({ ...m, estado: "recibida" }, 3, "x")).toBe("recibida");
    expect(validarCancelacion(m, 3, "   ")).toBe("motivo_requerido");
    expect(validarCancelacion(m, 3, "x".repeat(201))).toBe("motivo_requerido");
    expect(validarCancelacion(m, 3, "x".repeat(200))).toBeNull();
  });
  it("un borrador sin recepciones se puede cancelar", () => {
    expect(validarCancelacion({ ...m, estado: "borrador" }, 3, "x")).toBeNull();
  });
});

describe("regla 31: cancelar cierra el saldo", () => {
  it("con 300 de 500 recibidas deja recibida, canceladas 200 y pendientes 0", () => {
    const r = aplicarCancelacion(parcial(), 3, "El proveedor no entrega el saldo", op);
    if (!r.ok) throw new Error("debía cancelar");
    expect(r.modelo.estado).toBe("recibida");
    expect(r.modelo.cancelada_at).toBe(AHORA);
    expect(r.modelo.lineas[0]).toMatchObject({ unidades: 500, unidades_recibidas: 300, unidades_canceladas: 200 });
    expect(r.modelo.revision).toBe(4);

    const entregas = [{ id: "oct", periodo: "2026-10", unidades: 300 }, { id: "nov", periodo: "2026-11", unidades: 200 }];
    const recepciones = r.modelo.recepciones.map((x) => ({ id: x.id, recibida_periodo: x.recibida_periodo, unidades: x.unidades, fecha_recepcion: x.fecha_recepcion }));
    const p = pendientesPorEntrega({ unidades: 500, unidades_canceladas: r.modelo.lineas[0].unidades_canceladas }, entregas, recepciones);
    expect(p.pendiente).toBe(0);
    // I_oct = 200 sigue sumando (recepción de oct > k' = set) y la de ago (≤ k') no cuenta.
    expect(ingresosDeRecepciones(r.modelo.recepciones, "2026-09")).toEqual([{ periodo: "2026-10", unidades: 200 }]);
    expect(r.evento).toMatchObject({ accion: "cancelar", motivo: "El proveedor no entrega el saldo", linea_id: null });
    expect(r.evento.resumen).toBe("Saldo cancelado: 200 u; la compra queda recibida (300 u recibidas)");
  });

  it("sin recepciones queda cancelada y las líneas no se tocan", () => {
    const r = aplicarCancelacion(modeloDeRegistros(registrosC12()), 3, "Se compró por error", op);
    if (!r.ok) throw new Error("debía cancelar");
    expect(r.modelo.estado).toBe("cancelada");
    expect(r.modelo.lineas[0]).toMatchObject({ unidades_recibidas: 0, unidades_canceladas: 0 });
    expect(r.evento.resumen).toBe("Compra cancelada");
  });

  it("todo recibido responde recibida y no escribe nada", () => {
    const todo = modeloDeRegistros(registrosC12({ recepciones: [["2026-10", 500]], estado: "recibida" }));
    expect(aplicarCancelacion(todo, 3, "x", op)).toEqual({ ok: false, motivo: "recibida" });
  });

  it("confirmar después 50 u tardías: recibidas 350, canceladas 150 y aviso recepcion_sobre_saldo_cancelado", () => {
    const cerrada = aplicarCancelacion(parcial(), 3, "Cierre", op);
    if (!cerrada.ok) throw new Error("debía cancelar");
    const tardio = aplicarRecepciones(
      cerrada.modelo,
      4,
      [{ linea_id: LINEA.c12, recibida_periodo: "2026-10", unidades: 50, fecha_recepcion: "2026-10-30", nota: null, origen: "manual" }],
      { ...op, ids: ["tardia"] },
    );
    if (!tardio.ok) throw new Error("debía aceptar el ingreso tardío");
    expect(tardio.modelo.lineas[0]).toMatchObject({ unidades_recibidas: 350, unidades_canceladas: 150 });
    expect(tardio.modelo.estado).toBe("recibida");
    expect(tardio.avisos).toEqual(["recepcion_sobre_saldo_cancelado"]);
    // Más de lo cancelado no cabe.
    const demasiado = aplicarRecepciones(
      cerrada.modelo,
      4,
      [{ linea_id: LINEA.c12, recibida_periodo: "2026-10", unidades: 201, fecha_recepcion: "2026-10-30", nota: null, origen: "manual" }],
      op,
    );
    expect(demasiado).toMatchObject({ ok: false, rechazo: { motivo: "excede_pendiente" } });
  });

  it("quitar una recepción en saldo cerrado devuelve las unidades a lo cancelado; sin ninguna queda cancelada", () => {
    const cerrada = aplicarCancelacion(parcial(), 3, "Cierre", op);
    if (!cerrada.ok) throw new Error("debía cancelar");
    const [r1, r2] = cerrada.modelo.recepciones;

    const sinUna = aplicarQuitarRecepcion(cerrada.modelo, 4, r1.id, op);
    if (!sinUna.ok) throw new Error("debía quitar");
    expect(sinUna.modelo.estado).toBe("recibida");
    expect(sinUna.modelo.lineas[0]).toMatchObject({ unidades_recibidas: 200, unidades_canceladas: 300 });

    const sinNinguna = aplicarQuitarRecepcion(sinUna.modelo, 5, r2.id, op);
    if (!sinNinguna.ok) throw new Error("debía quitar");
    expect(sinNinguna.modelo.estado).toBe("cancelada");
    expect(sinNinguna.modelo.lineas[0].unidades_recibidas).toBe(0);
  });

  it("una cancelada es inmutable: no admite recibir ni quitar", () => {
    const cancelada = aplicarCancelacion(modeloDeRegistros(registrosC12({ recepciones: [] })), 3, "x", op);
    if (!cancelada.ok) throw new Error("debía cancelar");
    expect(transicion(cancelada.modelo, "recibir")).toEqual({ ok: false, motivo: "no_editable" });
    expect(transicion(cancelada.modelo, "editar")).toEqual({ ok: false, motivo: "no_editable" });
  });
});

describe("argsCancelarCompra", () => {
  it("recorta el motivo", () => {
    expect(argsCancelarCompra({ compra_id: COMPRA.c12, revision: 3, motivo: "  Se compró por error  ", actor: ACTOR })).toEqual({
      p_compra: COMPRA.c12,
      p_revision: 3,
      p_motivo: "Se compró por error",
      p_actor: ACTOR,
    });
  });
});
