import { describe, expect, it } from "vitest";
import {
  motivoRechazoEliminar,
  motivoRechazoEquivalencia,
  motivoRechazoMoverNodo,
  type EquivalenciaMin,
  type NodoMin,
} from "@/lib/arbol/reglas";

const generica: EquivalenciaMin = { id: "g", nombre: "SIN EQUIVALENCIA", codigo: "SIN_EQUIVALENCIA", es_generica: true };
const varios: EquivalenciaMin = { id: "v", nombre: "VARIOS", codigo: "VARIOS", es_generica: false };
const jogger: EquivalenciaMin = { id: "j", nombre: "JOGGER", codigo: "JOGGER", es_generica: false };
const nodo = [generica, varios, jogger];

describe("motivoRechazoEquivalencia (regla 16)", () => {
  it("rechaza una segunda genérica en el nodo", () => {
    expect(motivoRechazoEquivalencia(nodo, { nombre: "SIN EQUIVALENCIA", codigo: "SIN_EQUIVALENCIA", es_generica: true })).toMatch(
      /ya tiene la equivalencia genérica/
    );
  });
  it("permite la genérica si el nodo no la tiene", () => {
    expect(motivoRechazoEquivalencia([varios], { nombre: "SIN EQUIVALENCIA", codigo: "SIN_EQUIVALENCIA", es_generica: true })).toBeNull();
  });
  it("rechaza renombrar una genérica (nombre o código) pero permite activarla/desactivarla", () => {
    expect(motivoRechazoEquivalencia(nodo, { id: "g", nombre: "OTRA" })).toMatch(/no se puede renombrar/);
    expect(motivoRechazoEquivalencia(nodo, { id: "g", codigo: "OTRA" })).toMatch(/no se puede renombrar/);
    expect(motivoRechazoEquivalencia(nodo, { id: "g", activo: false })).toBeNull();
  });
  it("rechaza nombre repetido en el nodo tras normalizar", () => {
    expect(motivoRechazoEquivalencia(nodo, { nombre: "  varios ", codigo: "VARIOS_2" })).toMatch(/Ya existe una equivalencia llamada VARIOS/);
    expect(motivoRechazoEquivalencia(nodo, { id: "j", nombre: "varios" })).toMatch(/VARIOS/);
  });
  it("rechaza código repetido en el nodo", () => {
    expect(motivoRechazoEquivalencia(nodo, { nombre: "JOGGER CARGO", codigo: "jogger" })).toMatch(/código JOGGER/);
  });
  it("permite editar la propia equivalencia sin chocar consigo misma", () => {
    expect(motivoRechazoEquivalencia(nodo, { id: "j", nombre: "JOGGER", codigo: "JOGGER" })).toBeNull();
    expect(motivoRechazoEquivalencia(nodo, { id: "j", nombre: "JOGGER CARGO" })).toBeNull();
  });
  it("el mismo nombre en otro nodo está permitido (las listas son por nodo)", () => {
    expect(motivoRechazoEquivalencia([generica], { nombre: "VARIOS", codigo: "VARIOS", es_generica: false })).toBeNull();
  });
  it("reserva el nombre SIN EQUIVALENCIA para la genérica", () => {
    expect(motivoRechazoEquivalencia([varios], { id: "v", nombre: "sin equivalencia" })).toMatch(/reservado/);
  });
});

describe("motivoRechazoMoverNodo (regla 17)", () => {
  const nodo: NodoMin = { id: "n1", genero_id: "bebe", mundo_id: "sin_asignar", linea_id: "body" };
  const otros: NodoMin[] = [
    nodo,
    { id: "n2", genero_id: "bebe", mundo_id: "casual", linea_id: "body" },
    { id: "n3", genero_id: "bebe", mundo_id: "urbano", linea_id: "body", activo: false },
    { id: "n4", genero_id: "ninas", mundo_id: "formal", linea_id: "body" },
  ];
  it("rechaza destino igual al origen", () => {
    expect(motivoRechazoMoverNodo(nodo, "sin_asignar", otros)).toMatch(/ya está en ese mundo/);
  });
  it("rechaza si la tripleta ya existe en el destino", () => {
    expect(motivoRechazoMoverNodo(nodo, "casual", otros)).toMatch(/ya existe en el mundo destino/);
  });
  it("avisa si el choque es con un nodo inactivo", () => {
    expect(motivoRechazoMoverNodo(nodo, "urbano", otros)).toMatch(/inactiva/);
  });
  it("permite mover si el destino está libre (otro género no cuenta)", () => {
    expect(motivoRechazoMoverNodo(nodo, "formal", otros)).toBeNull();
    expect(motivoRechazoMoverNodo(nodo, "deportivo", otros)).toBeNull();
  });
});

describe("motivoRechazoEliminar (regla 18)", () => {
  it("devuelve null sin hijos", () => {
    expect(motivoRechazoEliminar("linea", 0)).toBeNull();
    expect(motivoRechazoEliminar("equivalencia", 0)).toBeNull();
  });
  it("con hijos da el conteo y sugiere desactivar", () => {
    expect(motivoRechazoEliminar("linea", 26)).toBe("No se puede eliminar la línea: tiene 26 nodos. Desactívala.");
    expect(motivoRechazoEliminar("genero", 1)).toBe("No se puede eliminar el género: tiene 1 nodo. Desactívalo.");
    expect(motivoRechazoEliminar("nodo", 3)).toBe("No se puede eliminar el nodo: tiene 3 equivalencias. Desactívalo.");
    expect(motivoRechazoEliminar("mundo", 14)).toMatch(/14 nodos/);
  });
});
