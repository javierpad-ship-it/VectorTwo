import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { armarReporteAgrupacionGmle } from "@/lib/reportes/agrupacion-gmle";
import { ANOMALIAS_GMLE, type AnomaliaGmle, type EquivalenciaGmle, type NodoGmle } from "@/lib/reportes/tipos-api";
import { analizarRuta } from "./api.guards.analizador";
import { entradaGmleFx, estadoGmleFx, type EstadoGmleFx } from "./reportes.agrupacion-gmle.fixture";

const armar = (estado: EstadoGmleFx = estadoGmleFx()) => {
  const { reporteM3, nodos } = entradaGmleFx(estado);
  return armarReporteAgrupacionGmle(reporteM3, nodos);
};

const nodoPor = (r: ReturnType<typeof armar>, id: string): NodoGmle => {
  const n = r.nodos.find((x) => x.id === id);
  if (!n) throw new Error(`nodo ${id} no está en el reporte`);
  return n;
};
const filaPor = (r: ReturnType<typeof armar>, id: string): EquivalenciaGmle => {
  const f = r.equivalencias.find((x) => x.id === id);
  if (!f) throw new Error(`equivalencia ${id} no está en el reporte`);
  return f;
};
const agrupacionPor = (r: ReturnType<typeof armar>, id: string) => {
  const a = r.agrupaciones.find((x) => x.id === id);
  if (!a) throw new Error(`agrupación ${id} no está en el reporte`);
  return a;
};
const idsConAnomalia = (r: ReturnType<typeof armar>, codigo: AnomaliaGmle) =>
  r.equivalencias.filter((e) => e.anomalias.includes(codigo)).map((e) => e.id);

describe("regla 1 · universo vigente", () => {
  it("solo equivalencias activas en nodos vigentes cuentan en el resumen", () => {
    const { resumen } = armar();
    expect(resumen.equivalencias).toBe(20);
    expect(resumen.genericas).toBe(7);
    expect(resumen.nodos).toBe(10);
    expect(resumen.agrupaciones).toBe(7);
    expect(resumen.agrupaciones_activas).toBe(5);
  });

  it("una fila inactiva o de un nodo no vigente sale sin unidad, sin anomalías y sin contar", () => {
    const r = armar();
    for (const id of ["e21", "e22"]) {
      const f = filaPor(r, id);
      expect(f.unidad).toBe("ninguna");
      expect(f.anomalias).toEqual([]);
    }
    expect(filaPor(r, "e21")).toMatchObject({ activo: false, vigente: true });
    expect(filaPor(r, "e22")).toMatchObject({ activo: true, vigente: false });
    // e21 y e22 apuntan a A pero no suman a ella (A tiene 8 vigentes).
    expect(agrupacionPor(r, "a-a").equivalencias).toBe(8);
  });

  it("un nodo no vigente no es mixto aunque su reparto lo fuera, y sale con cero unidades", () => {
    const estado = estadoGmleFx();
    estado.equivalencias.push({
      id: "e90",
      genero_mundo_linea_id: "n10",
      codigo: "OTRA",
      nombre: "OTRA",
      es_generica: false,
      activo: true,
      agrupacion_estacionalidad_id: "a-b",
    });
    const r = armar(estado);
    const n10 = nodoPor(r, "n10");
    expect(n10).toMatchObject({ vigente: false, unidades: 0, reparto: [], anomalias: [] });
    expect(r.resumen.nodos_gml_mixtos).toBe(2);
  });

  it("desactivar el género o la línea saca sus equivalencias del universo", () => {
    const estado = estadoGmleFx();
    const mujer = estado.generos.find((g) => g.id === "g-m");
    if (!mujer) throw new Error("fixture");
    mujer.activo = false;
    const r = armar(estado);
    // Quedan los nodos de HOMBRE: n1 3 · n2 2 · n3 4 · n4 3.
    expect(r.resumen.equivalencias).toBe(12);
    expect(r.resumen.nodos).toBe(4);
    expect(r.resumen.anomalias.sin_agrupacion).toBe(0);
    expect(nodoPor(r, "n6").vigente).toBe(false);
  });
});

describe("regla 2 · unidades", () => {
  it("GML con equivalencias vigentes = 1; GMLE = una por equivalencia vigente; sin vigentes = 0", () => {
    const r = armar();
    expect(nodoPor(r, "n1").unidades).toBe(1);
    expect(nodoPor(r, "n4").unidades).toBe(3);
    expect(nodoPor(r, "n11").unidades).toBe(0); // sin ninguna equivalencia
    expect(nodoPor(r, "n10").unidades).toBe(0); // no vigente
  });

  it("la genérica de un GMLE es una unidad más", () => {
    const r = armar();
    const filas = ["e10", "e11", "e12"].map((id) => filaPor(r, id));
    expect(filas.map((f) => f.unidad)).toEqual(["equivalencia", "equivalencia", "equivalencia"]);
    expect(filaPor(r, "e01").unidad).toBe("nodo");
  });

  it("un GML cuyas equivalencias están todas inactivas tiene cero unidades", () => {
    const estado = estadoGmleFx();
    for (const e of estado.equivalencias) if (e.genero_mundo_linea_id === "n7") e.activo = false;
    const r = armar(estado);
    expect(nodoPor(r, "n7").unidades).toBe(0);
    expect(r.resumen.unidades).toBe(10);
  });

  it("resumen.unidades = Σ nodos.unidades", () => {
    const r = armar();
    expect(r.resumen.unidades).toBe(11);
    expect(r.resumen.unidades).toBe(r.nodos.reduce((s, n) => s + n.unidades, 0));
  });

  it("un nodo sin equivalencias solo sale si llega con su género, mundo, línea y activo", () => {
    const { reporteM3, nodos } = entradaGmleFx();
    const sinDatos = nodos.map((n) => (n.id === "n11" ? { id: n.id, nivel_planificacion: n.nivel_planificacion } : n));
    const r = armarReporteAgrupacionGmle(reporteM3, sinDatos);
    expect(r.nodos.some((n) => n.id === "n11")).toBe(false);
    expect(r.resumen.nodos).toBe(9);
  });
});

describe("regla 3 · agrupación del nodo (GML vs GMLE)", () => {
  it("GML: única, mixta o sin; el id solo con única", () => {
    const r = armar();
    expect(nodoPor(r, "n1")).toMatchObject({ agrupacion_nodo: "unica", agrupacion_id: "a-a" });
    expect(nodoPor(r, "n2")).toMatchObject({ agrupacion_nodo: "unica", agrupacion_id: "a-b" });
    expect(nodoPor(r, "n3")).toMatchObject({ agrupacion_nodo: "mixta", agrupacion_id: null });
    expect(nodoPor(r, "n9")).toMatchObject({ agrupacion_nodo: "sin", agrupacion_id: null });
  });

  it("los vacíos (sin agrupación o con agrupación inactiva) no cuentan para decidir única o mixta", () => {
    const r = armar();
    // n5: SKINNY sin agrupación + genérica A → única A.
    expect(nodoPor(r, "n5")).toMatchObject({ agrupacion_nodo: "unica", agrupacion_id: "a-a" });
  });

  it("GMLE: null, aunque haya tres agrupaciones", () => {
    const r = armar();
    expect(nodoPor(r, "n4")).toMatchObject({ nivel: "GMLE", agrupacion_nodo: null, agrupacion_id: null });
  });

  it("nivel desconocido o ausente se trata como GML", () => {
    const { reporteM3, nodos } = entradaGmleFx();
    const raros = nodos.map((n) => (n.id === "n4" ? { ...n, nivel_planificacion: "XYZ" } : n.id === "n1" ? { id: n.id } : n));
    const r = armarReporteAgrupacionGmle(reporteM3, raros);
    expect(nodoPor(r, "n4").nivel).toBe("GML");
    expect(nodoPor(r, "n1").nivel).toBe("GML");
  });
});

describe("regla 4 · mayoritaria", () => {
  it("la que tiene más reales; la genérica no vota", () => {
    const r = armar();
    // n3: A 2 reales, B 1 real + genérica B → B no gana por la genérica.
    expect(nodoPor(r, "n3").mayoritaria_id).toBe("a-a");
  });

  it("empate entre reales → null (aunque la genérica tenga una)", () => {
    const r = armar();
    expect(nodoPor(r, "n6").mayoritaria_id).toBeNull(); // RAYADO A, LISO B
    expect(nodoPor(r, "n4").mayoritaria_id).toBeNull(); // PUFFER A, PARKA B, genérica C
  });

  it("sin reales con agrupación, la de la genérica; sin ninguna, null", () => {
    const r = armar();
    expect(nodoPor(r, "n5").mayoritaria_id).toBe("a-a"); // SKINNY sin agrupación, genérica A
    expect(nodoPor(r, "n7").mayoritaria_id).toBe("a-b"); // solo la genérica
    expect(nodoPor(r, "n9").mayoritaria_id).toBeNull(); // WALLY apunta a una inactiva
    expect(nodoPor(r, "n11").mayoritaria_id).toBeNull();
  });
});

describe("regla 5 · conteos por agrupación e invariantes", () => {
  it("cifras de la fixture", () => {
    const r = armar();
    expect(agrupacionPor(r, "a-a")).toMatchObject({
      equivalencias: 8,
      genericas: 2,
      nodos_gml: 2, // n1, n5
      nodos_gml_mixtos: 2, // n3, n6
      unidades_gmle: 1, // PUFFER
      lineas: 3,
      anomalias: [],
    });
    expect(agrupacionPor(r, "a-b")).toMatchObject({
      equivalencias: 7,
      genericas: 3,
      nodos_gml: 2, // n2, n7
      nodos_gml_mixtos: 2,
      unidades_gmle: 1,
      lineas: 3,
    });
    expect(agrupacionPor(r, "a-c")).toMatchObject({ equivalencias: 1, genericas: 1, nodos_gml: 0, unidades_gmle: 1, lineas: 1 });
    expect(agrupacionPor(r, "a-s")).toMatchObject({ equivalencias: 1, nodos_gml: 1 });
  });

  it("una agrupación inactiva cuenta sus equivalencias vigentes", () => {
    const r = agrupacionPor(armar(), "a-i");
    expect(r).toMatchObject({ activo: false, equivalencias: 1, nodos_gml: 0, anomalias: [] });
  });

  it("Σ agrupaciones.equivalencias + vigentes sin agrupación_id = resumen.equivalencias", () => {
    const r = armar();
    const suma = r.agrupaciones.reduce((s, a) => s + a.equivalencias, 0);
    const sinId = r.equivalencias.filter((e) => e.activo && e.vigente && e.agrupacion_id === null).length;
    expect(sinId).toBe(2);
    expect(suma + sinId).toBe(r.resumen.equivalencias);
  });

  it("Σ unidades_gmle + unidades GMLE sin agrupación + nodos GML con unidades = resumen.unidades", () => {
    const r = armar();
    const gmle = r.agrupaciones.reduce((s, a) => s + a.unidades_gmle, 0);
    const gmleSinAgrupacion = r.equivalencias.filter(
      (e) => e.unidad === "equivalencia" && e.agrupacion_id === null
    ).length;
    const gmlConUnidades = r.nodos.filter((n) => n.nivel === "GML" && n.unidades > 0).length;
    expect(gmle + gmleSinAgrupacion + gmlConUnidades).toBe(r.resumen.unidades);
  });

  it("el reparto de cada nodo suma sus equivalencias vigentes", () => {
    const r = armar();
    for (const n of r.nodos) {
      const vigentes = r.equivalencias.filter((e) => e.nodo_id === n.id && e.activo && e.vigente).length;
      expect(n.reparto.reduce((s, x) => s + x.equivalencias, 0)).toBe(vigentes);
    }
    expect(nodoPor(r, "n3").reparto).toEqual([
      { agrupacion_id: "a-a", equivalencias: 2 },
      { agrupacion_id: "a-b", equivalencias: 2 },
    ]);
    expect(nodoPor(r, "n5").reparto).toEqual([
      { agrupacion_id: "a-a", equivalencias: 1 },
      { agrupacion_id: null, equivalencias: 1 },
    ]);
  });

  it("el resumen de nodos: GML + GMLE = nodos y mixtos = nodos con la anomalía", () => {
    const { resumen, nodos } = armar();
    expect(resumen.nodos_gml + resumen.nodos_gmle).toBe(resumen.nodos);
    expect([resumen.nodos_gml, resumen.nodos_gmle]).toEqual([9, 1]);
    expect(resumen.nodos_gml_mixtos).toBe(nodos.filter((n) => n.anomalias.includes("nodo_gml_mixto")).length);
  });
});

describe("regla 6 · anomalías", () => {
  it("conteos del resumen por grano", () => {
    expect(armar().resumen.anomalias).toEqual({
      sin_agrupacion: 3,
      genero_no_incluido: 1,
      generica_discrepante: 1,
      nodo_gml_mixto: 2,
      linea_partida: 4,
      agrupacion_vacia: 1,
    });
  });

  it("sin_agrupacion: sin agrupación o con agrupación inactiva, genéricas incluidas", () => {
    expect(idsConAnomalia(armar(), "sin_agrupacion")).toEqual(["e13", "e17", "e20"]);
  });

  it("genero_no_incluido: la agrupación no incluye el género del nodo (o no tiene géneros)", () => {
    const r = armar();
    expect(idsConAnomalia(r, "genero_no_incluido")).toEqual(["e19"]); // agrupación S sin género
    const estado = estadoGmleFx();
    const c = estado.agrupaciones.find((a) => a.id === "a-c");
    if (!c) throw new Error("fixture");
    c.genero_ids = ["g-m"]; // C ya no incluye HOMBRE: e12 (genérica de n4)
    expect(idsConAnomalia(armar(estado), "genero_no_incluido").sort()).toEqual(["e12", "e19"]);
  });

  it("generica_discrepante: la genérica no coincide con la mayoritaria del nodo", () => {
    expect(idsConAnomalia(armar(), "generica_discrepante")).toEqual(["e09"]);
  });

  it("generica_discrepante exige mayoritaria: con empate no se marca", () => {
    const r = armar();
    expect(filaPor(r, "e12").anomalias).not.toContain("generica_discrepante"); // n4: empate A/B, genérica C
  });

  it("una genérica sin agrupación lleva sin_agrupacion y no generica_discrepante", () => {
    const f = filaPor(armar(), "e17");
    expect(f.anomalias).toContain("sin_agrupacion");
    expect(f.anomalias).not.toContain("generica_discrepante");
  });

  it("una genérica con agrupación inactiva tampoco es discrepante", () => {
    const estado = estadoGmleFx();
    const e = estado.equivalencias.find((x) => x.id === "e09");
    if (!e) throw new Error("fixture");
    e.agrupacion_estacionalidad_id = "a-i"; // inactiva
    const f = filaPor(armar(estado), "e09");
    expect(f.anomalias).toContain("sin_agrupacion");
    expect(f.anomalias).not.toContain("generica_discrepante");
  });

  it("una genérica sola en su nodo no es anomalía", () => {
    expect(filaPor(armar(), "e18").anomalias).toEqual([]);
  });

  it("nodo_gml_mixto se marca en el nodo y en todas sus equivalencias vigentes", () => {
    const r = armar();
    expect(nodoPor(r, "n3").anomalias).toEqual(["nodo_gml_mixto"]);
    expect(nodoPor(r, "n6").anomalias).toEqual(["nodo_gml_mixto"]);
    for (const id of ["e06", "e07", "e08", "e09", "e15", "e16", "e17"]) expect(filaPor(r, id).anomalias).toContain("nodo_gml_mixto");
    expect(idsConAnomalia(r, "nodo_gml_mixto")).toHaveLength(7);
  });

  it("agrupacion_vacia solo en agrupaciones activas sin equivalencias vigentes", () => {
    const r = armar();
    expect(r.agrupaciones.filter((a) => a.anomalias.includes("agrupacion_vacia")).map((a) => a.id)).toEqual(["a-d"]);
    expect(agrupacionPor(r, "a-x")).toMatchObject({ activo: false, equivalencias: 0, anomalias: [] }); // inactiva vacía
    expect(agrupacionPor(r, "a-d")).toMatchObject({ activo: true, equivalencias: 0 });
  });

  it("una agrupación activa cuyas únicas equivalencias están inactivas cuenta como vacía", () => {
    const estado = estadoGmleFx();
    for (const e of estado.equivalencias) if (e.agrupacion_estacionalidad_id === "a-s") e.activo = false;
    const r = armar(estado);
    expect(agrupacionPor(r, "a-s")).toMatchObject({ equivalencias: 0, anomalias: ["agrupacion_vacia"] });
    expect(r.resumen.anomalias.agrupacion_vacia).toBe(2);
  });

  it("los códigos de cada fila salen en el orden de prioridad", () => {
    const r = armar();
    for (const f of r.equivalencias) {
      const posiciones = f.anomalias.map((c) => ANOMALIAS_GMLE.indexOf(c));
      expect(posiciones).toEqual([...posiciones].sort((a, b) => a - b));
    }
    expect(filaPor(r, "e17").anomalias).toEqual(["sin_agrupacion", "nodo_gml_mixto", "linea_partida"]);
    expect(filaPor(r, "e09").anomalias).toEqual(["generica_discrepante", "nodo_gml_mixto", "linea_partida"]);
  });
});

describe("regla 7 · GMLE nunca es mixto y la línea partida mira todos los mundos", () => {
  it("un nodo GMLE con varias agrupaciones no es nodo_gml_mixto", () => {
    const r = armar();
    expect(nodoPor(r, "n4").anomalias).toEqual([]);
    for (const id of ["e10", "e11", "e12"]) expect(filaPor(r, id).anomalias).not.toContain("nodo_gml_mixto");
  });

  it("pasar un nodo mixto a GMLE quita la anomalía y sube las unidades", () => {
    const antes = armar();
    const estado = estadoGmleFx();
    estado.niveles.n3 = "GMLE";
    const despues = armar(estado);
    expect(despues.resumen.nodos_gml_mixtos).toBe(antes.resumen.nodos_gml_mixtos - 1);
    expect(despues.resumen.unidades).toBe(antes.resumen.unidades + 3); // 4 equivalencias en vez de 1 unidad
    expect(filaPor(despues, "e06")).toMatchObject({ unidad: "equivalencia" });
    expect(filaPor(despues, "e06").anomalias).not.toContain("nodo_gml_mixto");
  });

  it("línea partida: género · línea con agrupaciones distintas en cualquier mundo, con sus mundos", () => {
    const r = armar();
    expect(r.lineas_partidas.map((l) => `${l.genero}/${l.linea}`)).toEqual([
      "HOMBRE/CASACA",
      "HOMBRE/PANTALON",
      "HOMBRE/POLO",
      "MUJER/POLO",
    ]);
    const pantalon = r.lineas_partidas.find((l) => l.linea === "PANTALON");
    expect(pantalon?.agrupaciones).toEqual([
      { id: "a-a", nombre: "A", equivalencias: 3, mundos: ["URBANO"] },
      { id: "a-b", nombre: "B", equivalencias: 2, mundos: ["FORMAL"] },
    ]);
    const polo = r.lineas_partidas.find((l) => l.genero === "MUJER");
    expect(polo?.agrupaciones.map((a) => [a.nombre, a.equivalencias, a.mundos])).toEqual([
      ["A", 1, ["URBANO"]],
      ["B", 1, ["URBANO"]],
      ["S", 1, ["FORMAL"]],
    ]);
  });

  it("la línea partida marca todas las equivalencias vigentes de la línea, de todos sus nodos", () => {
    const r = armar();
    expect(idsConAnomalia(r, "linea_partida").sort()).toEqual(
      ["e01", "e02", "e03", "e04", "e05", "e06", "e07", "e08", "e09", "e10", "e11", "e12", "e15", "e16", "e17", "e19"].sort()
    );
    // M · PANTALON (n5) y M · CASACA (n7, n9) no están partidas.
    for (const id of ["e13", "e14", "e18", "e20"]) expect(filaPor(r, id).anomalias).not.toContain("linea_partida");
  });

  it("una agrupación inactiva no parte la línea", () => {
    // M · CASACA: n7 con B y n9 con I (inactiva) → no partida.
    expect(armar().lineas_partidas.some((l) => l.genero === "MUJER" && l.linea === "CASACA")).toBe(false);
  });

  it("lo inactivo no parte la línea: HOMBRE · POLO sin el nodo mixto queda sola", () => {
    const estado = estadoGmleFx();
    for (const e of estado.equivalencias) if (e.genero_mundo_linea_id === "n3") e.agrupacion_estacionalidad_id = "a-a";
    const r = armar(estado);
    // n10 (nodo inactivo, A) no cuenta; n3 ahora solo A → HOMBRE · POLO ya no está partida.
    expect(r.lineas_partidas.some((l) => l.genero === "HOMBRE" && l.linea === "POLO")).toBe(false);
  });
});

describe("regla 8 · la regla de faltante es la de M3", () => {
  it("sin_agrupacion ⇔ faltante de aplanarEquivalencias, fila a fila", () => {
    const { reporteM3, nodos } = entradaGmleFx();
    const r = armarReporteAgrupacionGmle(reporteM3, nodos);
    expect(r.equivalencias).toHaveLength(reporteM3.equivalencias.length);
    for (const m3 of reporteM3.equivalencias) {
      expect(filaPor(r, m3.id).anomalias.includes("sin_agrupacion"), m3.id).toBe(m3.faltante);
    }
    expect(r.resumen.anomalias.sin_agrupacion).toBe(reporteM3.resumen.faltantes);
  });
});

describe("regla 9 · determinismo", () => {
  it("misma entrada → misma salida y la entrada no se muta", () => {
    const { reporteM3, nodos } = entradaGmleFx();
    const copiaReporte = structuredClone(reporteM3);
    const copiaNodos = structuredClone(nodos);
    const a = armarReporteAgrupacionGmle(reporteM3, nodos);
    const b = armarReporteAgrupacionGmle(reporteM3, nodos);
    expect(b).toEqual(a);
    expect(reporteM3).toEqual(copiaReporte);
    expect(nodos).toEqual(copiaNodos);
  });

  it("el orden de la salida no depende del orden de la entrada", () => {
    const { reporteM3, nodos } = entradaGmleFx();
    const barajado = {
      ...reporteM3,
      equivalencias: [...reporteM3.equivalencias].reverse(),
      agrupaciones: [...reporteM3.agrupaciones].reverse(),
      generos: [...reporteM3.generos].reverse(),
      mundos: [...reporteM3.mundos].reverse(),
      lineas: [...reporteM3.lineas].reverse(),
    };
    expect(armarReporteAgrupacionGmle(barajado, [...nodos].reverse())).toEqual(armarReporteAgrupacionGmle(reporteM3, nodos));
  });

  it("orden del contrato: género, mundo, línea y, en el nodo, reales por nombre con la genérica al final", () => {
    const r = armar();
    expect(r.nodos.map((n) => n.id)).toEqual(["n4", "n1", "n3", "n2", "n10", "n7", "n5", "n6", "n9", "n11", "n8"]);
    expect(r.equivalencias.map((e) => e.id)).toEqual([
      "e11", "e10", "e12", // HOMBRE URBANO CASACA: PARKA, PUFFER, genérica
      "e02", "e01", "e03", // PANTALON: CARGO, JOGGER, genérica
      "e06", "e08", "e07", "e09", // POLO: BASICO, DEPORTIVO, PIQUE, genérica
      "e04", "e05", // HOMBRE FORMAL PANTALON
      "e22", // HOMBRE FORMAL POLO (nodo inactivo)
      "e18", // MUJER URBANO CASACA
      "e13", "e14", // PANTALON
      "e16", "e15", "e17", // POLO: LISO, RAYADO, genérica
      "e21", "e20", // MUJER FORMAL CASACA: VIEJA (inactiva), WALLY
      "e19", // MUJER FORMAL POLO
    ]);
    // Por nombre: A, B, C, D, I, MUERTA, S.
    expect(r.agrupaciones.map((a) => a.id)).toEqual(["a-a", "a-b", "a-c", "a-d", "a-i", "a-x", "a-s"]);
  });

  it("los catálogos salen por orden", () => {
    const r = armar();
    expect(r.catalogos.generos.map((g) => g.nombre)).toEqual(["HOMBRE", "MUJER"]);
    expect(r.catalogos.mundos.map((m) => m.nombre)).toEqual(["URBANO", "FORMAL"]);
  });
});

describe("contenido de las filas", () => {
  it("lleva nombres, temporada y banderas de la agrupación", () => {
    const r = armar();
    expect(filaPor(r, "e01")).toEqual({
      id: "e01",
      nodo_id: "n1",
      agrupacion_id: "a-a",
      agrupacion: "A",
      temporada: "invierno",
      genero: "HOMBRE",
      mundo: "URBANO",
      linea: "PANTALON",
      nivel: "GML",
      unidad: "nodo",
      equivalencia: "JOGGER",
      codigo: "JOGGER",
      es_generica: false,
      activo: true,
      vigente: true,
      agrupacion_activa: true,
      anomalias: ["linea_partida"],
    });
    expect(filaPor(r, "e13")).toMatchObject({ agrupacion_id: null, agrupacion: "", temporada: null, agrupacion_activa: false });
    expect(filaPor(r, "e20")).toMatchObject({ agrupacion_id: "a-i", agrupacion: "I", agrupacion_activa: false });
  });

  it("el nodo trae su ruta y el nivel guardado aunque esté inactivo", () => {
    const estado = estadoGmleFx();
    estado.niveles.n10 = "GMLE";
    const n = nodoPor(armar(estado), "n10");
    expect(n).toMatchObject({ ruta: "HOMBRE / FORMAL / POLO", nivel: "GMLE", vigente: false, agrupacion_nodo: null });
  });

  it("los géneros de cada agrupación van con nombre y la sin género queda vacía", () => {
    const r = armar();
    expect(agrupacionPor(r, "a-a").generos).toEqual([
      { id: "g-h", nombre: "HOMBRE" },
      { id: "g-m", nombre: "MUJER" },
    ]);
    expect(agrupacionPor(r, "a-s").generos).toEqual([]);
    expect(agrupacionPor(r, "a-a").temporada).toBe("invierno");
  });
});

describe("regla 12 · seguridad de la ruta", () => {
  const ruta = path.resolve(__dirname, "..", "src", "app", "api", "reportes", "agrupacion-gmle", "route.ts");
  const fuente = readFileSync(ruta, "utf8");

  it("el handler abre con requirePlanner (y no con requireUser)", () => {
    expect(analizarRuta("agrupacion-gmle/route.ts", fuente)).toEqual([]);
    expect(fuente).toMatch(/await requirePlanner\(\)/);
    expect(fuente).not.toMatch(/requireUser|requireAdmin/);
  });

  it("es solo lectura: exporta únicamente GET", () => {
    expect([...fuente.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g)].map((m) => m[1])).toEqual(["GET"]);
    expect(fuente).not.toMatch(/\.(insert|update|upsert|delete)\(/);
  });

  it("no nombra tablas: lee con cargarEstadoEstacionalidad", () => {
    expect(fuente).not.toMatch(/\.from\(/);
    expect(fuente).toContain("cargarEstadoEstacionalidad");
  });
});
