import { describe, expect, it } from "vitest";
import * as reglas from "@/lib/estacionalidad/reglas";
import {
  AGRUPACION_NO_ENCONTRADA,
  motivoFaltante,
  motivoRechazoAsignacion,
  motivoRechazoEliminar,
  planificarAsignacion,
  statusRechazoAsignacion,
} from "@/lib/estacionalidad/reglas";

describe("motivoRechazoAsignacion (regla 4)", () => {
  it("destino nulo → permitido aunque no haya agrupación", () => {
    expect(motivoRechazoAsignacion(undefined, true)).toBeNull();
    expect(motivoRechazoAsignacion({ nombre: "X", activo: false }, true)).toBeNull();
  });
  it("undefined → no encontrada (404 en el handler)", () => {
    const motivo = motivoRechazoAsignacion(undefined, false);
    expect(motivo).toBe("Agrupación de estacionalidad no encontrada.");
    expect(motivo).toBe(AGRUPACION_NO_ENCONTRADA);
    expect(statusRechazoAsignacion(motivo as string)).toBe(404);
    expect(motivoRechazoAsignacion(null, false)).toBe(AGRUPACION_NO_ENCONTRADA);
  });
  it("inactiva → mensaje con el nombre (409)", () => {
    const motivo = motivoRechazoAsignacion({ nombre: "PANTALONES INVIERNO", activo: false }, false);
    expect(motivo).toBe("La agrupación PANTALONES INVIERNO está inactiva: reactívala o elige otra.");
    expect(statusRechazoAsignacion(motivo as string)).toBe(409);
  });
  it("activa → null", () => {
    expect(motivoRechazoAsignacion({ nombre: "X", activo: true }, false)).toBeNull();
  });
});

describe("motivoRechazoEliminar agrupacion_estacionalidad (regla 5)", () => {
  it("con equivalencias → mensaje con el conteo y 'Desactívala'", () => {
    expect(motivoRechazoEliminar("agrupacion_estacionalidad", 3)).toBe(
      "No se puede eliminar la agrupación de estacionalidad: tiene 3 equivalencias. Desactívala."
    );
    expect(motivoRechazoEliminar("agrupacion_estacionalidad", 1)).toBe(
      "No se puede eliminar la agrupación de estacionalidad: tiene 1 equivalencia. Desactívala."
    );
  });
  it("con 0 → null", () => {
    expect(motivoRechazoEliminar("agrupacion_estacionalidad", 0)).toBeNull();
  });
});

describe("desactivar nunca se rechaza (regla 6)", () => {
  it("no existe motivoRechazoDesactivarAgrupacion: agregarla exige cambiar la ficha", () => {
    expect("motivoRechazoDesactivarAgrupacion" in reglas).toBe(false);
  });
});

describe("motivoFaltante (regla 7)", () => {
  const on = { activo: true };
  const off = { activo: false };
  it("activa, vigente y sin agrupación → sin_agrupacion", () => {
    expect(motivoFaltante(on, true, null)).toBe("sin_agrupacion");
    expect(motivoFaltante(on, true, undefined)).toBe("sin_agrupacion");
  });
  it("activa, vigente y con agrupación inactiva → agrupacion_inactiva", () => {
    expect(motivoFaltante(on, true, off)).toBe("agrupacion_inactiva");
  });
  it("con agrupación activa → null", () => {
    expect(motivoFaltante(on, true, on)).toBeNull();
  });
  it("inactiva o en nodo no vigente → nunca faltante", () => {
    expect(motivoFaltante(off, true, null)).toBeNull();
    expect(motivoFaltante(on, false, null)).toBeNull();
    expect(motivoFaltante(off, false, off)).toBeNull();
  });
});

describe("planificarAsignacion (asignación masiva)", () => {
  const encontradas = [
    { id: "e1", agrupacion_estacionalidad_id: null },
    { id: "e2", agrupacion_estacionalidad_id: "a1" },
    { id: "e3", agrupacion_estacionalidad_id: "a2" },
  ];
  it("separa las que cambian, las que ya tenían el destino y las que no existen", () => {
    expect(planificarAsignacion(["e1", "e2", "e3", "e9"], encontradas, "a1")).toEqual({
      a_asignar: ["e1", "e3"],
      sin_cambio: 1,
      no_encontradas: ["e9"],
    });
  });
  it("destino nulo: quitar; las que ya no tenían quedan sin cambio", () => {
    expect(planificarAsignacion(["e1", "e2", "e3"], encontradas, null)).toEqual({
      a_asignar: ["e2", "e3"],
      sin_cambio: 1,
      no_encontradas: [],
    });
  });
  it("deduplica los ids pedidos", () => {
    expect(planificarAsignacion(["e1", "e1", "e9", "e9"], encontradas, "a1")).toEqual({
      a_asignar: ["e1"],
      sin_cambio: 0,
      no_encontradas: ["e9"],
    });
  });
  it("es idempotente: tras aplicar, todo queda sin cambio", () => {
    const despues = encontradas.map((e) => ({ ...e, agrupacion_estacionalidad_id: "a1" }));
    expect(planificarAsignacion(["e1", "e2", "e3"], despues, "a1")).toEqual({
      a_asignar: [],
      sin_cambio: 3,
      no_encontradas: [],
    });
  });
});
