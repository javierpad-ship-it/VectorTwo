import { describe, expect, it } from "vitest";
import {
  AGRUPACION_NO_ENCONTRADA,
  MENSAJE_NOTA_SIN_BANDERA_PATCH,
  marcaVigente,
  motivoRechazoAgrupacionDestino,
  motivoRechazoEliminar,
  motivoRechazoMarca,
  normalizarTratamiento,
  type MarcaMin,
} from "@/lib/marcas/reglas";
import { MENSAJE_NOTA_LARGA } from "@/lib/marcas/esquemas";

describe("marcaVigente (regla 1)", () => {
  it("es activo ∧ agrupacion.activo", () => {
    expect(marcaVigente({ activo: true }, { activo: true })).toBe(true);
    expect(marcaVigente({ activo: true }, { activo: false })).toBe(false);
    expect(marcaVigente({ activo: false }, { activo: true })).toBe(false);
    expect(marcaVigente({ activo: false }, { activo: false })).toBe(false);
  });
  it("sin agrupación no es vigente", () => {
    expect(marcaVigente({ activo: true }, null)).toBe(false);
    expect(marcaVigente({ activo: true }, undefined)).toBe(false);
  });
});

describe("motivoRechazoAgrupacionDestino (regla 2)", () => {
  it("undefined → no encontrada (404 en el handler)", () => {
    expect(motivoRechazoAgrupacionDestino(undefined)).toBe(AGRUPACION_NO_ENCONTRADA);
    expect(motivoRechazoAgrupacionDestino(null)).toBe("Agrupación de marca no encontrada.");
  });
  it("inactiva → mensaje con el nombre (409)", () => {
    expect(motivoRechazoAgrupacionDestino({ nombre: "VALOR", activo: false })).toBe(
      "La agrupación VALOR está inactiva: reactívala antes de asignarle marcas."
    );
  });
  it("activa → null", () => {
    expect(motivoRechazoAgrupacionDestino({ nombre: "PREMIUM", activo: true })).toBeNull();
  });
});

describe("motivoRechazoMarca (regla 3)", () => {
  const existentes: MarcaMin[] = [
    { id: "m1", nombre: "LEVI'S", codigo: "LEVI_S" },
    { id: "m2", nombre: "ADIDAS", codigo: "ADIDAS" },
  ];
  it("nombre repetido tras normalizar", () => {
    expect(motivoRechazoMarca(existentes, { nombre: "  levi's " })).toBe("Ya existe una marca llamada LEVI'S.");
  });
  it("código repetido sin distinguir caja", () => {
    expect(motivoRechazoMarca(existentes, { nombre: "LEVIS", codigo: "levi_s" })).toBe(
      "Ya existe una marca con el código LEVI_S."
    );
  });
  it("no cuenta la propia marca al editar", () => {
    expect(motivoRechazoMarca(existentes, { id: "m1", nombre: "LEVI'S", codigo: "LEVI_S" })).toBeNull();
    expect(motivoRechazoMarca(existentes, { id: "m1", nombre: "ADIDAS" })).toMatch(/ADIDAS/);
  });
  it("sin choque → null", () => {
    expect(motivoRechazoMarca(existentes, { nombre: "Levis", codigo: "LEVIS" })).toBeNull();
    expect(motivoRechazoMarca([], { nombre: "ZARA" })).toBeNull();
  });
});

describe("motivoRechazoEliminar con los tipos de M2 (regla 4)", () => {
  it("agrupación de marca con marcas → mensaje con conteo", () => {
    expect(motivoRechazoEliminar("agrupacion_marca", 2)).toBe(
      "No se puede eliminar la agrupación de marca: tiene 2 marcas. Desactívala."
    );
    expect(motivoRechazoEliminar("agrupacion_marca", 1)).toBe(
      "No se puede eliminar la agrupación de marca: tiene 1 marca. Desactívala."
    );
  });
  it("sin hijos → null", () => {
    expect(motivoRechazoEliminar("agrupacion_marca", 0)).toBeNull();
    expect(motivoRechazoEliminar("marca", 0)).toBeNull();
  });
  it("marca con hijos (a partir de M5)", () => {
    expect(motivoRechazoEliminar("marca", 3)).toBe("No se puede eliminar la marca: tiene 3 registros asociados. Desactívala.");
  });
});

describe("normalizarTratamiento (regla 6)", () => {
  const conNota = { tratamiento_especial: true, nota_tratamiento: "Licencia" };
  const sinTratamiento = { tratamiento_especial: false, nota_tratamiento: null };

  it("desmarcar la bandera borra la nota, aunque el cuerpo traiga nota", () => {
    expect(normalizarTratamiento({ tratamiento_especial: false }, conNota)).toEqual({
      motivo: null,
      valor: { tratamiento_especial: false, nota_tratamiento: null },
    });
    expect(normalizarTratamiento({ tratamiento_especial: false, nota_tratamiento: "x" }, conNota)).toEqual({
      motivo: null,
      valor: { tratamiento_especial: false, nota_tratamiento: null },
    });
  });

  it("bandera true: la nota del cuerpo si viene; si no, la actual", () => {
    expect(normalizarTratamiento({ tratamiento_especial: true, nota_tratamiento: "Nueva" }, conNota).valor).toEqual({
      tratamiento_especial: true,
      nota_tratamiento: "Nueva",
    });
    expect(normalizarTratamiento({ tratamiento_especial: true }, conNota).valor).toEqual(conNota);
    expect(normalizarTratamiento({ tratamiento_especial: true }, sinTratamiento).valor).toEqual({
      tratamiento_especial: true,
      nota_tratamiento: null,
    });
    // Solo la nota, sobre una marca que ya tiene tratamiento.
    expect(normalizarTratamiento({ nota_tratamiento: "Otra" }, conNota).valor).toEqual({
      tratamiento_especial: true,
      nota_tratamiento: "Otra",
    });
  });

  it("nota vacía, solo espacios o null → null (borra la nota conservando la bandera)", () => {
    expect(normalizarTratamiento({ nota_tratamiento: "" }, conNota).valor?.nota_tratamiento).toBeNull();
    expect(normalizarTratamiento({ nota_tratamiento: "   " }, conNota).valor?.nota_tratamiento).toBeNull();
    expect(normalizarTratamiento({ nota_tratamiento: null }, conNota).valor).toEqual({
      tratamiento_especial: true,
      nota_tratamiento: null,
    });
    expect(normalizarTratamiento({ nota_tratamiento: "  recortada  " }, conNota).valor?.nota_tratamiento).toBe("recortada");
  });

  it("nota de más de 200 caracteres → rechazo", () => {
    const larga = "x".repeat(201);
    expect(normalizarTratamiento({ nota_tratamiento: larga }, conNota)).toEqual({ motivo: MENSAJE_NOTA_LARGA, valor: null });
    expect(normalizarTratamiento({ tratamiento_especial: true, nota_tratamiento: larga }, sinTratamiento).motivo).toBe(
      MENSAJE_NOTA_LARGA
    );
    expect(normalizarTratamiento({ nota_tratamiento: "x".repeat(200) }, conNota).motivo).toBeNull();
  });

  it("nota sin bandera sobre una marca sin tratamiento → 'Marca el tratamiento especial…'", () => {
    expect(normalizarTratamiento({ nota_tratamiento: "x" }, sinTratamiento)).toEqual({
      motivo: MENSAJE_NOTA_SIN_BANDERA_PATCH,
      valor: null,
    });
    expect(MENSAJE_NOTA_SIN_BANDERA_PATCH).toBe("Marca el tratamiento especial para agregar una nota.");
    // Nota vacía sin bandera no es un error: no hay nada que guardar.
    expect(normalizarTratamiento({ nota_tratamiento: "" }, sinTratamiento).valor).toEqual(sinTratamiento);
  });

  it("sin cambios de tratamiento devuelve lo actual", () => {
    expect(normalizarTratamiento({}, conNota).valor).toEqual(conNota);
    expect(normalizarTratamiento({}, sinTratamiento).valor).toEqual(sinTratamiento);
  });
});
