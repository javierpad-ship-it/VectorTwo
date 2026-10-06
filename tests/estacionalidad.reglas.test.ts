import { describe, expect, it } from "vitest";
import * as reglas from "@/lib/estacionalidad/reglas";
import {
  AGRUPACION_NO_ENCONTRADA,
  anexarGeneroIds,
  diferenciaGeneros,
  generoPermitido,
  generosDeAgrupacion,
  motivoFaltante,
  motivoRechazoAsignacion,
  motivoRechazoEliminar,
  motivoRechazoGeneroAsignacion,
  motivoRechazoGenerosPedidos,
  motivoRechazoQuitarGeneros,
  motivoRechazoSinGenero,
  planificarAsignacion,
  rechazoAsignacion,
  rechazoDestinoAsignacion,
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

const HOMBRE = { id: "g-h", nombre: "HOMBRE" };
const MUJER = { id: "g-m", nombre: "MUJER" };
const soloHombre = { nombre: "ASESORIA 1", activo: true, genero_ids: ["g-h"] };
const sinGenero = { nombre: "AASE_INVIERNO", activo: true, genero_ids: [] };

describe("generoPermitido", () => {
  it("true solo si el género está entre los de la agrupación", () => {
    expect(generoPermitido({ genero_ids: ["g-h", "g-m"] }, "g-m")).toBe(true);
    expect(generoPermitido({ genero_ids: ["g-h"] }, "g-m")).toBe(false);
  });
  it("sin géneros nunca", () => {
    expect(generoPermitido({ genero_ids: [] }, "g-h")).toBe(false);
  });
});

describe("motivoRechazoGeneroAsignacion", () => {
  it("género incluido → null", () => {
    expect(motivoRechazoGeneroAsignacion(soloHombre, HOMBRE)).toBeNull();
  });
  it("género no incluido → 409 con el género y la salida", () => {
    expect(motivoRechazoGeneroAsignacion(soloHombre, MUJER)).toEqual({
      status: 409,
      mensaje: "La agrupación ASESORIA 1 no incluye el género MUJER: edítala para añadírselo o elige otra.",
    });
  });
  it("sin géneros → 409 'no tiene géneros' (gana sobre 'no incluido')", () => {
    const esperado = {
      status: 409,
      mensaje: "La agrupación AASE_INVIERNO no tiene géneros: asígnale al menos uno antes de usarla.",
    };
    expect(motivoRechazoGeneroAsignacion(sinGenero, HOMBRE)).toEqual(esperado);
    expect(motivoRechazoSinGenero(sinGenero)).toEqual(esperado);
    expect(motivoRechazoSinGenero(soloHombre)).toBeNull();
  });
});

describe("rechazoAsignacion: inexistente → inactiva → sin género → género no incluido", () => {
  it("destino nulo (quitar) siempre se permite, aunque no exista o sea de otro género", () => {
    expect(rechazoAsignacion(undefined, true, MUJER)).toBeNull();
    expect(rechazoAsignacion({ ...soloHombre, activo: false }, true, MUJER)).toBeNull();
    expect(rechazoDestinoAsignacion(null, true)).toBeNull();
  });
  it("1. inexistente → 404", () => {
    expect(rechazoAsignacion(undefined, false, HOMBRE)).toEqual({ status: 404, mensaje: AGRUPACION_NO_ENCONTRADA });
    expect(rechazoDestinoAsignacion(null, false)).toEqual({ status: 404, mensaje: AGRUPACION_NO_ENCONTRADA });
  });
  it("2. inactiva → 409, aunque además no tenga géneros o no incluya el género", () => {
    const esperado = { status: 409, mensaje: "La agrupación X está inactiva: reactívala o elige otra." };
    expect(rechazoAsignacion({ nombre: "X", activo: false, genero_ids: [] }, false, MUJER)).toEqual(esperado);
    expect(rechazoAsignacion({ nombre: "X", activo: false, genero_ids: ["g-h"] }, false, MUJER)).toEqual(esperado);
  });
  it("3. sin género → 409 antes que 'no incluido'", () => {
    expect(rechazoAsignacion(sinGenero, false, HOMBRE)?.mensaje).toMatch(/no tiene géneros/);
    expect(rechazoDestinoAsignacion(sinGenero, false)?.mensaje).toMatch(/no tiene géneros/);
  });
  it("4. género no incluido → 409; incluido → null", () => {
    expect(rechazoAsignacion(soloHombre, false, MUJER)).toEqual({
      status: 409,
      mensaje: "La agrupación ASESORIA 1 no incluye el género MUJER: edítala para añadírselo o elige otra.",
    });
    expect(rechazoAsignacion(soloHombre, false, HOMBRE)).toBeNull();
  });
  it("el destino solo (masiva) no mira el género de ninguna equivalencia", () => {
    expect(rechazoDestinoAsignacion(soloHombre, false)).toBeNull();
  });
});

describe("géneros pedidos para una agrupación", () => {
  const generos = [
    { id: "g-h", nombre: "HOMBRE", activo: true },
    { id: "g-m", nombre: "MUJER", activo: true },
    { id: "g-x", nombre: "OTROS", activo: false },
  ];
  it("alguno inexistente → 404 'Género no encontrado.'", () => {
    expect(motivoRechazoGenerosPedidos(["g-h", "g-zz"], generos, ["g-h", "g-zz"])).toEqual({
      status: 404,
      mensaje: "Género no encontrado.",
    });
  });
  it("agregar uno inactivo → 409 con su nombre", () => {
    expect(motivoRechazoGenerosPedidos(["g-h", "g-x"], generos, ["g-h", "g-x"])).toEqual({
      status: 409,
      mensaje: "El género OTROS está inactivo: no se puede asignar a una agrupación.",
    });
  });
  it("conservar un género que se desactivó después no se rechaza", () => {
    expect(motivoRechazoGenerosPedidos(["g-h", "g-x"], generos, [])).toBeNull();
  });
  it("todos activos → null", () => {
    expect(motivoRechazoGenerosPedidos(["g-h", "g-m"], generos, ["g-h", "g-m"])).toBeNull();
  });
});

describe("quitar géneros de una agrupación", () => {
  it("con equivalencias de ese género → 409 con el conteo y 'Reasígnalas antes.'", () => {
    expect(motivoRechazoQuitarGeneros({ nombre: "ASESORIA 1" }, [{ nombre: "HOMBRE", equivalencias: 7 }])).toBe(
      "No se puede quitar HOMBRE de ASESORIA 1: tiene 7 equivalencias de HOMBRE. Reasígnalas antes."
    );
    expect(motivoRechazoQuitarGeneros({ nombre: "ASESORIA 1" }, [{ nombre: "HOMBRE", equivalencias: 1 }])).toBe(
      "No se puede quitar HOMBRE de ASESORIA 1: tiene 1 equivalencia de HOMBRE. Reasígnalas antes."
    );
  });
  it("sin equivalencias de ese género → null; si hay varios, manda el primero bloqueado", () => {
    expect(motivoRechazoQuitarGeneros({ nombre: "A" }, [{ nombre: "MUJER", equivalencias: 0 }])).toBeNull();
    expect(motivoRechazoQuitarGeneros({ nombre: "A" }, [])).toBeNull();
    expect(
      motivoRechazoQuitarGeneros({ nombre: "A" }, [
        { nombre: "MUJER", equivalencias: 0 },
        { nombre: "BEBE", equivalencias: 2 },
      ])
    ).toMatch(/quitar BEBE de A: tiene 2 equivalencias de BEBE/);
  });
  it("diferenciaGeneros separa lo que se agrega de lo que se quita", () => {
    expect(diferenciaGeneros(["a", "b"], ["b", "c"])).toEqual({ agregar: ["c"], quitar: ["a"] });
    expect(diferenciaGeneros([], ["a"])).toEqual({ agregar: ["a"], quitar: [] });
    expect(diferenciaGeneros(["a"], ["a"])).toEqual({ agregar: [], quitar: [] });
  });
});

describe("géneros de las agrupaciones (lectura)", () => {
  it("anexarGeneroIds pliega los vínculos; las agrupaciones sin vínculos quedan con []", () => {
    const r = anexarGeneroIds(
      [{ id: "a1" }, { id: "a2" }],
      [
        { agrupacion_estacionalidad_id: "a1", genero_id: "g-h" },
        { agrupacion_estacionalidad_id: "a1", genero_id: "g-m" },
      ]
    );
    expect(r).toEqual([
      { id: "a1", genero_ids: ["g-h", "g-m"] },
      { id: "a2", genero_ids: [] },
    ]);
  });
  it("generosDeAgrupacion ordena por orden y nombre del género", () => {
    const generos = [
      { id: "g-m", codigo: "M", nombre: "MUJER", orden: 20 },
      { id: "g-h", codigo: "H", nombre: "HOMBRE", orden: 10 },
      { id: "g-b", codigo: "B", nombre: "BEBE", orden: 20 },
    ];
    expect(generosDeAgrupacion(["g-m", "g-b", "g-h"], generos)).toEqual([
      { id: "g-h", codigo: "H", nombre: "HOMBRE" },
      { id: "g-b", codigo: "B", nombre: "BEBE" },
      { id: "g-m", codigo: "M", nombre: "MUJER" },
    ]);
    expect(generosDeAgrupacion([], generos)).toEqual([]);
  });
});

describe("planificarAsignacion (asignación masiva)", () => {
  const encontradas = [
    { id: "e1", agrupacion_estacionalidad_id: null, genero_id: "g-h", genero_nombre: "HOMBRE" },
    { id: "e2", agrupacion_estacionalidad_id: "a1", genero_id: "g-h", genero_nombre: "HOMBRE" },
    { id: "e3", agrupacion_estacionalidad_id: "a2", genero_id: "g-h", genero_nombre: "HOMBRE" },
  ];
  const a1 = { id: "a1", genero_ids: ["g-h", "g-m"] };
  it("separa las que cambian, las que ya tenían el destino y las que no existen", () => {
    expect(planificarAsignacion(["e1", "e2", "e3", "e9"], encontradas, a1)).toEqual({
      a_asignar: ["e1", "e3"],
      sin_cambio: 1,
      no_encontradas: ["e9"],
      no_permitidas: [],
    });
  });
  it("destino nulo: quitar; las que ya no tenían quedan sin cambio y no se comprueban géneros", () => {
    expect(planificarAsignacion(["e1", "e2", "e3"], encontradas, null)).toEqual({
      a_asignar: ["e2", "e3"],
      sin_cambio: 1,
      no_encontradas: [],
      no_permitidas: [],
    });
  });
  it("deduplica los ids pedidos", () => {
    expect(planificarAsignacion(["e1", "e1", "e9", "e9"], encontradas, a1)).toEqual({
      a_asignar: ["e1"],
      sin_cambio: 0,
      no_encontradas: ["e9"],
      no_permitidas: [],
    });
  });
  it("es idempotente: tras aplicar, todo queda sin cambio", () => {
    const despues = encontradas.map((e) => ({ ...e, agrupacion_estacionalidad_id: "a1" }));
    expect(planificarAsignacion(["e1", "e2", "e3"], despues, a1)).toEqual({
      a_asignar: [],
      sin_cambio: 3,
      no_encontradas: [],
      no_permitidas: [],
    });
  });

  describe("géneros: las de un género que la agrupación no incluye no abortan", () => {
    const mixtas = [
      ...encontradas,
      { id: "e4", agrupacion_estacionalidad_id: null, genero_id: "g-m", genero_nombre: "MUJER" },
      { id: "e5", agrupacion_estacionalidad_id: "a2", genero_id: "g-b", genero_nombre: "BEBE" },
    ];
    const soloH = { id: "a1", genero_ids: ["g-h"] };
    it("van a no_permitidas con el nombre del género y no se asignan", () => {
      expect(planificarAsignacion(["e1", "e4", "e3", "e5"], mixtas, soloH)).toEqual({
        a_asignar: ["e1", "e3"],
        sin_cambio: 0,
        no_encontradas: [],
        no_permitidas: [
          { id: "e4", genero: "MUJER" },
          { id: "e5", genero: "BEBE" },
        ],
      });
    });
    it("conviven con no_encontradas y sin_cambio, y los conteos cierran", () => {
      const plan = planificarAsignacion(["e1", "e2", "e4", "e9"], mixtas, soloH);
      expect(plan).toEqual({
        a_asignar: ["e1"],
        sin_cambio: 1,
        no_encontradas: ["e9"],
        no_permitidas: [{ id: "e4", genero: "MUJER" }],
      });
    });
    it("una agrupación con varios géneros admite a todos ellos", () => {
      const plan = planificarAsignacion(["e1", "e4"], mixtas, { id: "a1", genero_ids: ["g-h", "g-m"] });
      expect(plan.a_asignar).toEqual(["e1", "e4"]);
      expect(plan.no_permitidas).toEqual([]);
    });
    it("quitar (destino nulo) no comprueba géneros", () => {
      const plan = planificarAsignacion(["e3", "e5"], mixtas, null);
      expect(plan.a_asignar).toEqual(["e3", "e5"]);
      expect(plan.no_permitidas).toEqual([]);
    });
    it("no_permitidas está siempre presente, vacía si no hay", () => {
      expect(planificarAsignacion(["e1"], mixtas, soloH).no_permitidas).toEqual([]);
    });
  });
});
