import { describe, expect, it } from "vitest";
import {
  FUNCIONES_DISPONIBLES_0_13_1,
  compraEsMia,
  esPlanner,
  lineaEsMia,
  puede,
  puedeEscribirCompras,
  puedeImportar,
} from "@/lib/compras/permisos";
import { GEN, MUN, NODO_M8 } from "./compras.fixture";

/** Permisos de las compras (decisión 28: el estado manda, nunca la propiedad) y filtro «mis líneas». */

const confirmada = { estado: "confirmada" as const, cancelada_at: null };

describe("puede: el estado y el rol, nunca quién creó la compra", () => {
  it("en M8 el planner y el admin escriben; el comprador no", () => {
    expect(puedeEscribirCompras("planner")).toBe(true);
    expect(puedeEscribirCompras("admin")).toBe(true);
    expect(puedeEscribirCompras("comprador")).toBe(false);
    expect(puedeEscribirCompras("comprador", "m9a")).toBe(true);
  });

  it("en 0.13.0 una confirmada se puede recibir y cancelar (editar, confirmar y repartir no existen todavía)", () => {
    expect(puede(confirmada, { rol: "planner" })).toEqual({ editar: false, confirmar: false, recibir: true, cancelar: true, aplicar_reparto: false });
  });

  it("el comprador en M8 no puede nada (el guard de la ruta daría 403)", () => {
    expect(puede(confirmada, { rol: "comprador" })).toEqual({ editar: false, confirmar: false, recibir: false, cancelar: false, aplicar_reparto: false });
  });

  it("en M9a el comprador recibe y cancela cualquier compra, pero no aplica reparto", () => {
    const p = puede(confirmada, { rol: "comprador" }, { fase: "m9a", disponibles: FUNCIONES_DISPONIBLES_0_13_1 });
    expect(p).toEqual({ editar: true, confirmar: false, recibir: true, cancelar: true, aplicar_reparto: false });
    expect(puede(confirmada, { rol: "planner" }, { fase: "m9a", disponibles: FUNCIONES_DISPONIBLES_0_13_1 }).aplicar_reparto).toBe(true);
  });

  it("una cancelada no admite nada; una recibida normal solo se edita (0.13.1)", () => {
    const cancelada = puede({ estado: "cancelada", cancelada_at: "x" }, { rol: "planner" }, { disponibles: FUNCIONES_DISPONIBLES_0_13_1 });
    expect(cancelada).toEqual({ editar: false, confirmar: false, recibir: false, cancelar: false, aplicar_reparto: false });
    const recibida = puede({ estado: "recibida", cancelada_at: null }, { rol: "planner" }, { disponibles: FUNCIONES_DISPONIBLES_0_13_1 });
    expect(recibida).toMatchObject({ editar: true, recibir: false, cancelar: false });
  });

  it("una recibida con saldo cerrado admite el ingreso tardío pero no cancelar", () => {
    expect(puede({ estado: "recibida", cancelada_at: "2026-10-25T16:00:00Z" }, { rol: "planner" })).toMatchObject({ recibir: true, cancelar: false });
  });

  it("un borrador se confirma (0.13.1) si tiene líneas, no recibe y se puede cancelar", () => {
    const b = { estado: "borrador" as const, cancelada_at: null, lineas_activas: 2 };
    expect(puede(b, { rol: "planner" }, { disponibles: FUNCIONES_DISPONIBLES_0_13_1 })).toMatchObject({ confirmar: true, recibir: false, cancelar: true });
    expect(puede({ ...b, lineas_activas: 0 }, { rol: "planner" }, { disponibles: FUNCIONES_DISPONIBLES_0_13_1 }).confirmar).toBe(false);
  });
});

describe("importar y planner", () => {
  it("la carga inicial es de planner o admin siempre", () => {
    expect(puedeImportar("planner", true)).toBe(true);
    expect(puedeImportar("admin", true)).toBe(true);
    expect(puedeImportar("comprador", true)).toBe(false);
    expect(puedeImportar("comprador", true, "m9a")).toBe(false);
    expect(puedeImportar("comprador", false, "m9a")).toBe(true);
    expect(puedeImportar("comprador", false)).toBe(false);
  });

  it("esPlanner", () => {
    expect(esPlanner("planner")).toBe(true);
    expect(esPlanner("admin")).toBe(true);
    expect(esPlanner("comprador")).toBe(false);
  });
});

describe("mis líneas: un filtro, nunca un permiso", () => {
  const nodos = new Map([
    [NODO_M8.urbano, { genero_id: GEN.hombre, mundo_id: MUN.urbano }],
    [NODO_M8.polo, { genero_id: GEN.hombre, mundo_id: MUN.casual }],
    [NODO_M8.sandalia, { genero_id: GEN.mujer, mundo_id: MUN.casual }],
  ]);
  const c1 = [{ genero_id: GEN.hombre, mundo_id: MUN.urbano }];
  const c2 = [{ genero_id: GEN.mujer, mundo_id: MUN.casual }];

  it("una línea es mía si su GML cae en mi género × mundo", () => {
    expect(lineaEsMia({ genero_mundo_linea_id: NODO_M8.urbano }, c1, nodos)).toBe(true);
    expect(lineaEsMia({ genero_mundo_linea_id: NODO_M8.polo }, c1, nodos)).toBe(false);
    expect(lineaEsMia({ genero_mundo_linea_id: NODO_M8.sandalia }, c2, nodos)).toBe(true);
  });

  it("un lote es mío si algún GML de su reparto lo es", () => {
    const lote = { genero_mundo_linea_id: null, reparto_gml_ids: [NODO_M8.urbano, NODO_M8.polo, NODO_M8.sandalia] };
    expect(lineaEsMia(lote, c1, nodos)).toBe(true);
    expect(lineaEsMia(lote, c2, nodos)).toBe(true);
    expect(lineaEsMia({ genero_mundo_linea_id: null, reparto_gml_ids: [NODO_M8.polo] }, c1, nodos)).toBe(false);
    expect(lineaEsMia({ genero_mundo_linea_id: null }, c1, nodos)).toBe(false);
  });

  it("sin combinaciones, «mis líneas» queda vacío; una compra es mía si alguna línea lo es", () => {
    expect(lineaEsMia({ genero_mundo_linea_id: NODO_M8.urbano }, [], nodos)).toBe(false);
    expect(compraEsMia([{ genero_mundo_linea_id: NODO_M8.polo }, { genero_mundo_linea_id: NODO_M8.urbano }], c1, nodos)).toBe(true);
    expect(compraEsMia([{ genero_mundo_linea_id: NODO_M8.polo }], c1, nodos)).toBe(false);
  });

  it("el filtro no cambia lo que se puede hacer", () => {
    const antes = puede(confirmada, { rol: "planner" });
    lineaEsMia({ genero_mundo_linea_id: NODO_M8.urbano }, [], nodos);
    expect(puede(confirmada, { rol: "planner" })).toEqual(antes);
  });
});
