import { describe, expect, it } from "vitest";
import { cambioMarca, motivoRechazoAsignacion, modalidadEfectiva, modalidadPorDefecto } from "@/lib/marcas/gml/reglas";
import { arbolFixture, estadoFixture, indiceFixture } from "./marcas.gml.fixture";

/** Regla 7 de 02b: rechazo de una asignación y cambio de la marca. */

const e = estadoFixture();
const marca = (id: string) => e.marcas.find((m) => m.id === id);
const n1 = e.nodos.get("n1");

describe("motivoRechazoAsignacion (regla 7)", () => {
  it("marca inexistente → marca_no_encontrada (404)", () => {
    expect(motivoRechazoAsignacion(undefined, n1, e.marcas)).toMatchObject({ motivo: "marca_no_encontrada", status: 404 });
  });
  it("marca inactiva → marca_inactiva (409)", () => {
    const r = motivoRechazoAsignacion(marca("m-omega"), n1, e.marcas);
    expect(r).toMatchObject({ motivo: "marca_inactiva", status: 409 });
    expect(r?.mensaje).toContain("OMEGA");
  });
  it("miembro de un conjunto efectivo → marca_en_conjunto (409) con el nombre de la cabeza", () => {
    const r = motivoRechazoAsignacion(marca("m-alfa-jeans"), n1, e.marcas);
    expect(r).toMatchObject({ motivo: "marca_en_conjunto", status: 409, detalle: "cuenta como ALFA" });
    expect(r?.mensaje).toBe("ALFA JEANS cuenta como ALFA: hazlo relevante en ALFA.");
  });
  it("con la cabeza inactiva el miembro vuelve a contar como ella misma y sí se puede asignar", () => {
    const sinAlfa = e.marcas.map((m) => (m.id === "m-alfa" ? { ...m, activo: false } : m));
    expect(motivoRechazoAsignacion(sinAlfa.find((m) => m.id === "m-alfa-jeans"), n1, sinAlfa)).toBeNull();
  });
  it("nodo inexistente → nodo_no_encontrado (404); nodo no vigente → nodo_no_vigente (409) con el padre inactivo", () => {
    expect(motivoRechazoAsignacion(marca("m-gamma"), undefined, e.marcas)).toMatchObject({ motivo: "nodo_no_encontrado", status: 404 });
    const arbol = arbolFixture();
    arbol.lineas = arbol.lineas.map((l) => (l.id === "l-terno" ? { ...l, activo: false } : l));
    const n3 = indiceFixture(arbol).get("n3");
    const r = motivoRechazoAsignacion(marca("m-gamma"), n3, e.marcas);
    expect(r).toMatchObject({ motivo: "nodo_no_vigente", status: 409, detalle: "línea TERNO inactiva" });
    expect(r?.mensaje).toContain("HOMBRE · FORMAL · TERNO");
  });
  it("sin casilla, al barrer o sin modalidad no se rechaza (se marcará)", () => {
    for (const id of ["m-gamma", "m-beta", "m-epsilon", "m-alfa", "m-delta"]) {
      expect(motivoRechazoAsignacion(marca(id), n1, e.marcas), id).toBeNull();
    }
  });
});

describe("cambioMarca (regla 7)", () => {
  it("sin casilla, al barrer y sin modalidad pasan a por_gml; por_gml no cambia", () => {
    expect(cambioMarca(marca("m-gamma")!)).toEqual({ de: "sin_tratamiento", a: "por_gml" });
    expect(cambioMarca(marca("m-beta")!)).toEqual({ de: "barrido", a: "por_gml" });
    expect(cambioMarca(marca("m-epsilon")!)).toEqual({ de: "sin_modalidad", a: "por_gml" });
    expect(cambioMarca(marca("m-alfa")!)).toBeNull();
  });
});

describe("modalidadEfectiva (regla 5)", () => {
  it("se reexporta desde gml/reglas con la misma semántica", () => {
    expect(modalidadEfectiva(marca("m-gamma")!)).toBeNull();
    expect(modalidadEfectiva(marca("m-alfa")!)).toBe("por_gml");
    expect(modalidadEfectiva(marca("m-beta")!)).toBe("barrido");
    expect(modalidadEfectiva(marca("m-epsilon")!)).toBe("barrido");
    expect(modalidadPorDefecto(2)).toBe("por_gml");
  });
});
