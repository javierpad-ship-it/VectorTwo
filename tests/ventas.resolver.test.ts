import { describe, expect, it } from "vitest";
import {
  agrupacionPorDefecto,
  crearResolutorMarcas,
  csvMarcasNuevas,
  distanciaEdicionUno,
  filasMarcasNuevas,
  planificarAltaMarcas,
  planificarMarcasNuevas,
  resolverCombinacion,
  resolverMarca,
  resolverTienda,
} from "@/lib/ventas/resolver";
import { AGRUPACIONES, ARBOL, MARCAS, TIENDAS } from "./ventas.fixture";

describe("resolverTienda (regla 28)", () => {
  it("por nombre normalizado primero y por código después", () => {
    expect(resolverTienda("lukers  uno", TIENDAS)).toMatchObject({ resultado: "ok", id: "t-uno", codigo: "R101", tipo: "Tienda" });
    expect(resolverTienda("r102", TIENDAS)).toMatchObject({ resultado: "ok", id: "t-dos" });
    expect(resolverTienda("CD LUKERS", TIENDAS)).toMatchObject({ resultado: "ok", tipo: "Centro de Distribución", fecha_apertura: null });
  });

  it("un valor que coincide por nombre con una tienda y por código con otra se resuelve por nombre", () => {
    const tiendas = [
      { ...TIENDAS[0], id: "a", nombre: "R102", codigo: "A1" },
      { ...TIENDAS[1], id: "b", nombre: "OTRA", codigo: "R102" },
    ];
    expect(resolverTienda("R102", tiendas)).toMatchObject({ resultado: "ok", id: "a" });
  });

  it("inactiva se distingue de desconocida y la lista de ignoradas se mira antes que desconocida", () => {
    expect(resolverTienda("OFICINA CENTRAL", TIENDAS)).toEqual({ valor: "OFICINA CENTRAL", resultado: "inactiva" });
    expect(resolverTienda("LOCAL X", TIENDAS)).toEqual({ valor: "LOCAL X", resultado: "desconocida" });
    const ignoradas = new Map([["LOCAL X", { id: "u-1", nota: "Central, no es tienda" }]]);
    expect(resolverTienda("local x", TIENDAS, ignoradas)).toEqual({
      valor: "LOCAL X",
      resultado: "ignorada",
      id: "u-1",
      nota: "Central, no es tienda",
    });
    // una tienda existente no se ve afectada por la lista
    expect(resolverTienda("LUKERS UNO", TIENDAS, new Map([["LUKERS UNO", { id: "u-2", nota: null }]])).resultado).toBe("ok");
  });
});

describe("resolverCombinacion (regla 29)", () => {
  const r = (genero: string, mundo: string, linea: string, equivalencia: string) =>
    resolverCombinacion({ genero, mundo, linea, equivalencia }, ARBOL);

  it("resuelve la equivalencia real, la genérica y `-`", () => {
    expect(r("HOMBRE", "CASUAL", "DENIM", "JEAN")).toMatchObject({ resultado: "equivalencia_inexistente" });
    expect(r("HOMBRE", "CASUAL", "DENIM", "PANTALON VARIOS")).toEqual({ resultado: "ok", equivalencia_id: "e1s" });
    expect(r("HOMBRE", "CASUAL", "DENIM", "")).toEqual({ resultado: "ok", equivalencia_id: "e1g" });
    expect(r("HOMBRE", "CASUAL", "DENIM", "SIN EQUIVALENCIA")).toEqual({ resultado: "ok", equivalencia_id: "e1g" });
    expect(r("HOMBRE", "CASUAL", "DENIM", "-")).toEqual({ resultado: "ok", equivalencia_id: "e1l" });
    expect(r("hombre", "casual", "denim", "denim")).toEqual({ resultado: "ok", equivalencia_id: "e1l" });
  });

  it("la genérica se resuelve por bandera aunque su nombre cambiara", () => {
    const estado = {
      ...ARBOL,
      equivalencias: ARBOL.equivalencias.map((e) => (e.id === "e1g" ? { ...e, nombre: "OTRO NOMBRE" } : e)),
    };
    expect(resolverCombinacion({ genero: "HOMBRE", mundo: "CASUAL", linea: "DENIM", equivalencia: "" }, estado)).toEqual({
      resultado: "ok",
      equivalencia_id: "e1g",
    });
  });

  it("orden género → mundo → línea → nodo → equivalencia", () => {
    expect(r("XX", "ZZ", "QQ", "")).toMatchObject({ resultado: "genero_desconocido", detalle: "XX" });
    expect(r("HOMBRE", "ZZ", "QQ", "")).toMatchObject({ resultado: "mundo_desconocido", detalle: "ZZ" });
    expect(r("HOMBRE", "CASUAL", "QQ", "")).toMatchObject({ resultado: "linea_desconocida", detalle: "QQ" });
    expect(r("MUJER", "URBANO", "DENIM", "")).toMatchObject({ resultado: "nodo_inexistente", detalle: "MUJER / URBANO / DENIM" });
    expect(r("HOMBRE", "CASUAL", "DENIM", "NO EXISTE")).toMatchObject({ resultado: "equivalencia_inexistente" });
  });

  it("inactivos → motivo informativo", () => {
    expect(r("NIÑOS", "CASUAL", "DENIM", "").resultado).toBe("genero_inactivo");
    expect(r("HOMBRE", "RI", "DENIM", "").resultado).toBe("mundo_inactivo");
    expect(r("HOMBRE", "CASUAL", "BERMUDA", "").resultado).toBe("linea_inactiva");
    expect(r("HOMBRE", "CASUAL", "POLO", "").resultado).toBe("nodo_inactivo");
    expect(r("HOMBRE", "URBANO", "POLO", "POLO CLASICO").resultado).toBe("equivalencia_inactiva");
  });

  it("un nodo que existe sin la equivalencia es `equivalencia_inexistente`, no `nodo_inexistente`", () => {
    expect(r("MUJER", "CASUAL", "DENIM", "NO EXISTE").resultado).toBe("equivalencia_inexistente");
  });

  it("también se resuelve por código de género y de mundo", () => {
    expect(r("H", "CASUAL", "DENIM", "").resultado).toBe("ok");
  });
});

describe("resolverMarca (regla 30)", () => {
  it("existente activa, inactiva y nueva", () => {
    expect(resolverMarca("alfa", MARCAS)).toEqual({ resultado: "existe", id: "mk-alfa", agrupacion_marca_id: "ag-pre" });
    expect(resolverMarca("VIEJA", MARCAS)).toEqual({ resultado: "inactiva", id: "mk-vieja" });
    expect(resolverMarca("NUEVA", MARCAS)).toEqual({ resultado: "nueva", comodin: false, parecida: null });
  });

  it("los comodines nuevos se marcan y no llevan parecida", () => {
    expect(resolverMarca("OTROS", MARCAS)).toEqual({ resultado: "nueva", comodin: true, parecida: null });
    expect(resolverMarca("SIN MARCA", MARCAS)).toMatchObject({ comodin: true });
  });

  it("encuentra la existente más parecida: misma `aCodigo` o distancia de edición 1", () => {
    const rm = crearResolutorMarcas(MARCAS);
    expect(rm("ALFAA")).toMatchObject({ parecida: "ALFA" });
    expect(rm("BET")).toMatchObject({ parecida: "BETA" });
    expect(rm("ÁLFA")).toMatchObject({ parecida: "ALFA" }); // misma aCodigo
    const conGuion = crearResolutorMarcas([{ id: "x", nombre: "MARCA S", agrupacion_marca_id: "ag-mid", activo: true }]);
    expect(conGuion("MARCA-S")).toMatchObject({ parecida: "MARCA S" });
    expect(rm("ZZZZ")).toMatchObject({ parecida: null });
    // dos nombres que solo difieren en una palabra son marcas distintas: no hay alias
    expect(rm("ALFA PLUS")).toMatchObject({ resultado: "nueva", parecida: null });
  });

  it("distanciaEdicionUno", () => {
    expect(distanciaEdicionUno("ALFA", "ALFAA")).toBe(true);
    expect(distanciaEdicionUno("ALFA", "ALFE")).toBe(true);
    expect(distanciaEdicionUno("ALFA", "AFA")).toBe(true);
    expect(distanciaEdicionUno("ALFA", "ALFA")).toBe(false);
    expect(distanciaEdicionUno("ALFA", "ALGE")).toBe(false);
    expect(distanciaEdicionUno("ALFA", "ALFAAA")).toBe(false);
  });
});

describe("planificarAltaMarcas (regla 30, servidor)", () => {
  it("crea con tratamiento_especial en falso, la agrupación elegida y código único", () => {
    const plan = planificarAltaMarcas(["MARCA'S", "MARCA-S", "ALFA", "alfa", ""], MARCAS, AGRUPACIONES, "ag-ul");
    if (plan.error) throw new Error(plan.error.mensaje);
    expect(plan.crear).toEqual([
      { nombre: "MARCA'S", codigo: "MARCA_S", agrupacion_marca_id: "ag-ul", tratamiento_especial: false },
      { nombre: "MARCA-S", codigo: "MARCA_S_2", agrupacion_marca_id: "ag-ul", tratamiento_especial: false },
    ]);
    expect(plan.existentes).toBe(1);
  });

  it("VARIOS, OTROS y SIN MARCA van a MID VALUE sea cual sea la elegida", () => {
    const plan = planificarAltaMarcas(["OTROS", "SIN MARCA", "VARIOS", "X"], MARCAS, AGRUPACIONES, "ag-pre");
    if (plan.error) throw new Error(plan.error.mensaje);
    const porNombre = Object.fromEntries(plan.crear.map((m) => [m.nombre, m.agrupacion_marca_id]));
    expect(porNombre).toEqual({ OTROS: "ag-mid", "SIN MARCA": "ag-mid", X: "ag-pre" }); // VARIOS ya existe
    expect(plan.comodines).toEqual(["OTROS", "SIN MARCA"]);
  });

  it("sin MID VALUE activa y con un comodín nuevo es un error de la petición y no se crea nada", () => {
    const sin = AGRUPACIONES.filter((a) => a.id !== "ag-mid");
    const plan = planificarAltaMarcas(["OTROS", "X"], MARCAS, sin, "ag-pre");
    expect(plan.error).toEqual({ status: 409, mensaje: "Crea o reactiva MID VALUE: VARIOS, OTROS y SIN MARCA van ahí." });
    const inactiva = AGRUPACIONES.map((a) => (a.id === "ag-mid" ? { ...a, activo: false } : a));
    expect(planificarAltaMarcas(["OTROS"], MARCAS, inactiva, "ag-pre").error?.status).toBe(409);
    // sin comodines nuevos no hace falta MID VALUE
    expect(planificarAltaMarcas(["X"], MARCAS, sin, "ag-pre").error).toBeNull();
  });

  it("agrupación inexistente (404) o inactiva (409)", () => {
    expect(planificarAltaMarcas(["X"], MARCAS, AGRUPACIONES, "no-existe").error?.status).toBe(404);
    const inactiva = AGRUPACIONES.map((a) => (a.id === "ag-ul" ? { ...a, activo: false } : a));
    expect(planificarAltaMarcas(["X"], MARCAS, inactiva, "ag-ul").error?.status).toBe(409);
  });

  it("la agrupación por defecto es MID VALUE si está activa", () => {
    expect(agrupacionPorDefecto(AGRUPACIONES)?.id).toBe("ag-mid");
    expect(agrupacionPorDefecto(AGRUPACIONES.map((a) => ({ ...a, activo: a.id !== "ag-mid" })))).toBeNull();
  });
});

describe("planificarMarcasNuevas y csvMarcasNuevas (regla 30, cliente)", () => {
  const candidatas = [
    { nombre: "PEQUEÑA", comodin: false, parecida: null, filas: 2, venta_soles: 10, stock_unidades: 1, stock_valorizado: 5 },
    { nombre: "GRANDE", comodin: false, parecida: null, filas: 300, venta_soles: 9000, stock_unidades: 100, stock_valorizado: 4000 },
    { nombre: "VARIOS", comodin: true, parecida: null, filas: 1, venta_soles: 50, stock_unidades: 0, stock_valorizado: 0 },
  ];

  it("ordena por venta y marca posible_tipeo solo a las de una o dos filas que no son comodines", () => {
    const plan = planificarMarcasNuevas(candidatas);
    expect(plan.map((m) => [m.nombre, m.posible_tipeo])).toEqual([
      ["GRANDE", false],
      ["VARIOS", false],
      ["PEQUEÑA", true],
    ]);
  });

  it("el CSV lleva MARCA, AGRUPACION con la agrupación por defecto y los comodines en MID VALUE", () => {
    const plan = planificarMarcasNuevas(candidatas);
    expect(filasMarcasNuevas(plan, "VALOR").datos).toEqual([
      ["GRANDE", "VALOR"],
      ["VARIOS", "MID VALUE"],
      ["PEQUEÑA", "VALOR"],
    ]);
    expect(csvMarcasNuevas(plan, "VALOR").split("\r\n")).toEqual(["MARCA,AGRUPACION", "GRANDE,VALOR", "VARIOS,MID VALUE", "PEQUEÑA,VALOR"]);
    expect(csvMarcasNuevas([{ nombre: 'A "B", C', comodin: false }], "VALOR")).toContain('"A ""B"", C",VALOR');
  });
});
