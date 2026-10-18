import { describe, expect, it } from "vitest";
import {
  AGRUPACION_NO_ENCONTRADA,
  MENSAJE_MODALIDAD_SIN_BANDERA_PATCH,
  MENSAJE_NOTA_SIN_BANDERA_PATCH,
  marcaVigente,
  modalidadEfectiva,
  modalidadPorDefecto,
  normalizarModalidad,
  motivoRechazoEliminarMarca,
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

describe("normalizarTratamiento (regla 6, ampliada por 02b)", () => {
  const conNota = { tratamiento_especial: true, nota_tratamiento: "Licencia", modalidad_tratamiento: "por_gml" as const, resto_al_barrer: false };
  const sinTratamiento = { tratamiento_especial: false, nota_tratamiento: null, modalidad_tratamiento: null };
  const apagada = { tratamiento_especial: false, nota_tratamiento: null, modalidad_tratamiento: null, resto_al_barrer: false };

  it("desmarcar la bandera borra la nota y la modalidad, aunque el cuerpo traiga nota", () => {
    expect(normalizarTratamiento({ tratamiento_especial: false }, conNota)).toEqual({ motivo: null, valor: apagada });
    expect(normalizarTratamiento({ tratamiento_especial: false, nota_tratamiento: "x" }, conNota)).toEqual({
      motivo: null,
      valor: apagada,
    });
    expect(normalizarTratamiento({ tratamiento_especial: false, modalidad_tratamiento: "barrido" }, conNota)).toEqual({
      motivo: null,
      valor: apagada,
    });
  });

  it("bandera true: la nota del cuerpo si viene; si no, la actual", () => {
    expect(normalizarTratamiento({ tratamiento_especial: true, nota_tratamiento: "Nueva" }, conNota).valor).toEqual({
      tratamiento_especial: true,
      nota_tratamiento: "Nueva",
      modalidad_tratamiento: "por_gml",
      resto_al_barrer: false,
    });
    expect(normalizarTratamiento({ tratamiento_especial: true }, conNota).valor).toEqual(conNota);
    // Solo la nota, sobre una marca que ya tiene tratamiento.
    expect(normalizarTratamiento({ nota_tratamiento: "Otra" }, conNota).valor).toEqual({
      tratamiento_especial: true,
      nota_tratamiento: "Otra",
      modalidad_tratamiento: "por_gml",
      resto_al_barrer: false,
    });
  });

  it("regla 6: marcar sin modalidad escribe la actual, si no por_gml con GML y barrido sin ellos", () => {
    expect(normalizarTratamiento({ tratamiento_especial: true }, sinTratamiento).valor).toEqual({
      tratamiento_especial: true,
      nota_tratamiento: null,
      modalidad_tratamiento: "barrido",
      resto_al_barrer: false,
    });
    expect(normalizarTratamiento({ tratamiento_especial: true }, sinTratamiento, 0).valor?.modalidad_tratamiento).toBe("barrido");
    expect(normalizarTratamiento({ tratamiento_especial: true }, sinTratamiento, 3).valor?.modalidad_tratamiento).toBe("por_gml");
    // Con modalidad en el cuerpo manda el cuerpo; con la actual, la actual aunque haya GML.
    expect(normalizarTratamiento({ tratamiento_especial: true, modalidad_tratamiento: "barrido" }, sinTratamiento, 3).valor?.modalidad_tratamiento).toBe("barrido");
    const enBarrido = { tratamiento_especial: true, nota_tratamiento: null, modalidad_tratamiento: "barrido" };
    expect(normalizarTratamiento({ nota_tratamiento: "x" }, enBarrido, 5).valor?.modalidad_tratamiento).toBe("barrido");
    // Casilla con modalidad nula (heredada): se escribe una al tocar el tratamiento.
    const heredada = { tratamiento_especial: true, nota_tratamiento: null, modalidad_tratamiento: null };
    expect(normalizarTratamiento({ nota_tratamiento: "x" }, heredada, 2).valor?.modalidad_tratamiento).toBe("por_gml");
    // Cambiar solo la modalidad.
    expect(normalizarTratamiento({ modalidad_tratamiento: "barrido" }, conNota).valor).toEqual({
      tratamiento_especial: true,
      nota_tratamiento: "Licencia",
      modalidad_tratamiento: "barrido",
      resto_al_barrer: false,
    });
  });

  it("M12: elegir mixta escribe el par; cambiar a otra modalidad o desmarcar apaga resto_al_barrer; sin modalidad en el cuerpo se conserva la mixta", () => {
    const mixta = { tratamiento_especial: true, nota_tratamiento: null, modalidad_tratamiento: "por_gml", resto_al_barrer: true };
    expect(normalizarTratamiento({ modalidad_tratamiento: "mixta" }, conNota).valor).toEqual({
      tratamiento_especial: true,
      nota_tratamiento: "Licencia",
      modalidad_tratamiento: "por_gml",
      resto_al_barrer: true,
    });
    expect(normalizarTratamiento({ nota_tratamiento: "x" }, mixta).valor).toMatchObject({ modalidad_tratamiento: "por_gml", resto_al_barrer: true });
    expect(normalizarTratamiento({ modalidad_tratamiento: "barrido" }, mixta).valor).toMatchObject({ modalidad_tratamiento: "barrido", resto_al_barrer: false });
    expect(normalizarTratamiento({ modalidad_tratamiento: "por_gml" }, mixta).valor).toMatchObject({ modalidad_tratamiento: "por_gml", resto_al_barrer: false });
    expect(normalizarTratamiento({ tratamiento_especial: false }, mixta).valor).toMatchObject({ modalidad_tratamiento: null, resto_al_barrer: false });
    // Mixta de una marca sin tratamiento que se marca en el mismo cuerpo.
    expect(normalizarTratamiento({ tratamiento_especial: true, modalidad_tratamiento: "mixta" }, sinTratamiento).valor).toMatchObject({ modalidad_tratamiento: "por_gml", resto_al_barrer: true });
  });

  it("modalidad sin casilla y sin traerla → 400 con el mensaje de la ficha", () => {
    expect(normalizarTratamiento({ modalidad_tratamiento: "por_gml" }, sinTratamiento)).toEqual({
      motivo: MENSAJE_MODALIDAD_SIN_BANDERA_PATCH,
      valor: null,
    });
    expect(MENSAJE_MODALIDAD_SIN_BANDERA_PATCH).toBe("Marca el tratamiento especial para definir la modalidad.");
  });

  it("nota vacía, solo espacios o null → null (borra la nota conservando la bandera)", () => {
    expect(normalizarTratamiento({ nota_tratamiento: "" }, conNota).valor?.nota_tratamiento).toBeNull();
    expect(normalizarTratamiento({ nota_tratamiento: "   " }, conNota).valor?.nota_tratamiento).toBeNull();
    expect(normalizarTratamiento({ nota_tratamiento: null }, conNota).valor).toEqual({
      tratamiento_especial: true,
      nota_tratamiento: null,
      modalidad_tratamiento: "por_gml",
      resto_al_barrer: false,
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
    expect(normalizarTratamiento({ nota_tratamiento: "" }, sinTratamiento).valor).toEqual(apagada);
  });

  it("sin cambios de tratamiento devuelve lo actual", () => {
    expect(normalizarTratamiento({}, conNota).valor).toEqual(conNota);
    expect(normalizarTratamiento({}, sinTratamiento).valor).toEqual(apagada);
  });
});

describe("modalidadEfectiva (02b regla 5) y modalidadPorDefecto", () => {
  it("sin casilla → null; con casilla: por_gml es por_gml y barrido o nula es barrido", () => {
    expect(modalidadEfectiva({ tratamiento_especial: false, modalidad_tratamiento: null })).toBeNull();
    expect(modalidadEfectiva({ tratamiento_especial: true, modalidad_tratamiento: "por_gml" })).toBe("por_gml");
    expect(modalidadEfectiva({ tratamiento_especial: true, modalidad_tratamiento: "barrido" })).toBe("barrido");
    expect(modalidadEfectiva({ tratamiento_especial: true, modalidad_tratamiento: null })).toBe("barrido");
  });
  it("M12: por_gml con resto_al_barrer es mixta; sin casilla sigue siendo null", () => {
    expect(modalidadEfectiva({ tratamiento_especial: true, modalidad_tratamiento: "por_gml", resto_al_barrer: true })).toBe("mixta");
    expect(modalidadEfectiva({ tratamiento_especial: true, modalidad_tratamiento: "por_gml", resto_al_barrer: false })).toBe("por_gml");
    expect(modalidadEfectiva({ tratamiento_especial: false, modalidad_tratamiento: null, resto_al_barrer: true })).toBeNull();
    // Con barrido o nula la bandera no cambia la lectura (el check de la base impide ese par).
    expect(modalidadEfectiva({ tratamiento_especial: true, modalidad_tratamiento: "barrido", resto_al_barrer: true })).toBe("barrido");
    expect(modalidadEfectiva({ tratamiento_especial: true, modalidad_tratamiento: null, resto_al_barrer: true })).toBe("barrido");
  });
  it("M12: normalizarModalidad escribe el par; mixta es por_gml + resto_al_barrer y las demás apagan la bandera", () => {
    expect(normalizarModalidad("mixta")).toEqual({ modalidad_tratamiento: "por_gml", resto_al_barrer: true });
    expect(normalizarModalidad("por_gml")).toEqual({ modalidad_tratamiento: "por_gml", resto_al_barrer: false });
    expect(normalizarModalidad("barrido")).toEqual({ modalidad_tratamiento: "barrido", resto_al_barrer: false });
  });
  it("por defecto: por_gml si hay GML y barrido si no", () => {
    expect(modalidadPorDefecto(0)).toBe("barrido");
    expect(modalidadPorDefecto(1)).toBe("por_gml");
  });
});

describe("motivoRechazoEliminarMarca (02b)", () => {
  it("sin nada colgando → null", () => {
    expect(motivoRechazoEliminarMarca(0, 0)).toBeNull();
  });
  it("con venta o stock manda el mensaje de M5", () => {
    expect(motivoRechazoEliminarMarca(3, 2)).toBe("No se puede eliminar la marca: tiene 3 registros asociados. Desactívala.");
  });
  it("cabeza con miembros → 409 con el conteo (caso 22)", () => {
    expect(motivoRechazoEliminarMarca(0, 2)).toContain("es cabeza de un conjunto con 2 marcas");
    expect(motivoRechazoEliminarMarca(0, 1)).toContain("con 1 marca.");
  });
});
