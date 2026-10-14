import { describe, expect, it } from "vitest";
import {
  agrupacionNodoVisible,
  FILTROS_VACIOS,
  SIN_AGRUPACION,
  armarNodosMixtos,
  armarResumenAgrupaciones,
  enriquecerEquivalencias,
  filtrarAgrupacionesVacias,
  filtrarAnomaliasDeEquivalencia,
  filtrarEstructura,
  filtrarFilasResumen,
  filtrarLineasPartidas,
  filtrarNodosPorFilas,
  filtrarReporte,
  hayFiltros,
  normalizarBusqueda,
  ordenarFilas,
  ordenarResumen,
  siguienteOrden,
  textoLineaPartida,
  textoReparto,
  tieneAnomaliaAlta,
  type FiltrosGmle,
} from "@/lib/reportes/filtros";
import { AGR_INVIERNO, AGR_POLOS, AGR_VACIA, AGR_VERANO, AGR_VIEJA, crearReporteSintetico } from "./reportes.agrupacion-gmle.vista.fixture";

const reporte = crearReporteSintetico();
const detalle = enriquecerEquivalencias(reporte);
const con = (parcial: Partial<FiltrosGmle>): FiltrosGmle => ({ ...FILTROS_VACIOS, ...parcial });
const ids = (filas: { id: string }[]) => filas.map((f) => f.id);

describe("enriquecerEquivalencias", () => {
  it("conserva el orden y el número de filas y no muta la entrada", () => {
    const antes = JSON.stringify(reporte);
    const filas = enriquecerEquivalencias(reporte);
    expect(ids(filas)).toEqual(reporte.equivalencias.map((e) => e.id));
    expect(JSON.stringify(reporte)).toBe(antes);
  });
  it("trae del nodo la agrupación del nodo y el nombre de la mayoritaria", () => {
    const porId = new Map(detalle.map((f) => [f.id, f]));
    expect(porId.get("e1")).toMatchObject({ agrupacion_nodo: "mixta", mayoritaria: "PANTALONES INVIERNO" });
    expect(porId.get("e5")).toMatchObject({ agrupacion_nodo: "unica", mayoritaria: "PANTALONES VERANO" });
    // Nodo GMLE: sin agrupación de nodo y, con empate entre reales, sin mayoritaria.
    expect(porId.get("e7")).toMatchObject({ agrupacion_nodo: null, mayoritaria: "" });
  });
  it("muestra «—» (null) para filas de nodos no vigentes o con todas sus equivalencias inactivas, sin tocar la API", () => {
    const porId = new Map(detalle.map((f) => [f.id, f]));
    // n5 no está vigente: la API dice «sin», la presentación no.
    expect(reporte.nodos.find((n) => n.id === "n5")?.agrupacion_nodo).toBe("sin");
    expect(porId.get("e12")?.agrupacion_nodo).toBeNull();
    // n4 sigue con una equivalencia vigente: «sin» es un dato real y se conserva (también en su fila inactiva).
    expect(porId.get("e10")?.agrupacion_nodo).toBe("sin");
    expect(porId.get("e11")?.agrupacion_nodo).toBe("sin");
    // Todas las equivalencias de n4 inactivas: el nodo queda sin unidades.
    const sinUnidades = {
      ...reporte,
      nodos: reporte.nodos.map((n) => (n.id === "n4" ? { ...n, unidades: 0, reparto: [] } : n)),
    };
    const filas = new Map(enriquecerEquivalencias(sinUnidades).map((f) => [f.id, f]));
    expect(filas.get("e10")?.agrupacion_nodo).toBeNull();
    expect(filas.get("e11")?.agrupacion_nodo).toBeNull();
    // Un nodo que falta en la lista tampoco inventa «Sin».
    expect(agrupacionNodoVisible(undefined)).toBeNull();
    expect(agrupacionNodoVisible({ agrupacion_nodo: "mixta", vigente: true, unidades: 1 })).toBe("mixta");
  });
});

describe("filtrarReporte (regla 10: conjunción de filtros)", () => {
  it("con filtros vacíos devuelve todo lo vigente y activo, en el orden recibido", () => {
    expect(ids(filtrarReporte(detalle, FILTROS_VACIOS))).toEqual(["e1", "e2", "e3", "e4", "e5", "e6", "e7", "e8", "e9", "e10"]);
  });
  it("«Incluir inactivos» devuelve además las inactivas y las de nodo no vigente", () => {
    expect(ids(filtrarReporte(detalle, con({ incluirInactivos: true })))).toHaveLength(12);
    expect(ids(filtrarReporte(detalle, con({ incluirInactivos: false })))).not.toContain("e11");
    expect(ids(filtrarReporte(detalle, con({ incluirInactivos: false })))).not.toContain("e12");
  });
  it("agrupación: una por id, o «Sin agrupación»", () => {
    expect(ids(filtrarReporte(detalle, con({ agrupacion: AGR_INVIERNO })))).toEqual(["e1", "e2", "e8"]);
    expect(ids(filtrarReporte(detalle, con({ agrupacion: SIN_AGRUPACION })))).toEqual(["e9", "e10"]);
  });
  it("género, mundo y nivel", () => {
    expect(ids(filtrarReporte(detalle, con({ genero: "MUJER" })))).toEqual(["e7", "e8", "e9", "e10"]);
    expect(ids(filtrarReporte(detalle, con({ mundo: "FORMAL" })))).toEqual(["e5", "e6"]);
    expect(ids(filtrarReporte(detalle, con({ nivel: "GMLE" })))).toEqual(["e7", "e8", "e9"]);
  });
  it("solo genéricas", () => {
    expect(ids(filtrarReporte(detalle, con({ soloGenericas: true })))).toEqual(["e4", "e6", "e9"]);
  });
  it("solo anomalías ⇔ anomalias.length > 0", () => {
    const filas = filtrarReporte(detalle, con({ soloAnomalias: true }));
    expect(filas.every((f) => f.anomalias.length > 0)).toBe(true);
    expect(ids(filas)).toEqual(["e1", "e2", "e3", "e4", "e5", "e6", "e9", "e10"]);
  });
  it("chip de anomalía: las filas que llevan ese código (los de nodo y línea se propagan)", () => {
    expect(ids(filtrarReporte(detalle, con({ anomalia: "sin_agrupacion" })))).toEqual(["e9", "e10"]);
    expect(ids(filtrarReporte(detalle, con({ anomalia: "generica_discrepante" })))).toEqual(["e4"]);
    expect(ids(filtrarReporte(detalle, con({ anomalia: "nodo_gml_mixto" })))).toEqual(["e1", "e2", "e3", "e4"]);
    expect(ids(filtrarReporte(detalle, con({ anomalia: "linea_partida" })))).toEqual(["e1", "e2", "e3", "e4", "e5", "e6"]);
    expect(filtrarReporte(detalle, con({ anomalia: "agrupacion_vacia" }))).toEqual([]);
  });
  it("el texto busca en línea, equivalencia y código, sin acentos ni mayúsculas", () => {
    expect(ids(filtrarReporte(detalle, con({ texto: "pantalon" })))).toEqual(["e1", "e2", "e3", "e4", "e5", "e6"]);
    expect(ids(filtrarReporte(detalle, con({ texto: "  JoGgEr " })))).toEqual(["e1"]);
    expect(ids(filtrarReporte(detalle, con({ texto: "sin_equivalencia" })))).toEqual(["e4", "e6", "e9"]);
    // No busca en el género ni en la agrupación.
    expect(filtrarReporte(detalle, con({ texto: "hombre" }))).toEqual([]);
  });
  it("normaliza acentos y mayúsculas", () => {
    expect(normalizarBusqueda("  CASACÁ   Niño ")).toBe("casaca nino");
    const acentuada = detalle.map((f) => (f.id === "e1" ? { ...f, linea: "PANTALÓN" } : f));
    expect(ids(filtrarReporte(acentuada, con({ texto: "pantalon" })))).toContain("e1");
  });
  it("combina varios filtros a la vez (conjunción)", () => {
    const f = con({ agrupacion: AGR_VERANO, genero: "HOMBRE", soloGenericas: true, anomalia: "linea_partida" });
    expect(ids(filtrarReporte(detalle, f))).toEqual(["e4", "e6"]);
    expect(filtrarReporte(detalle, con({ agrupacion: AGR_VERANO, genero: "MUJER" }))).toEqual([]);
  });
  it("no muta la entrada", () => {
    const copia = JSON.stringify(detalle);
    filtrarReporte(detalle, con({ soloAnomalias: true, incluirInactivos: true }));
    expect(JSON.stringify(detalle)).toBe(copia);
  });
});

describe("hayFiltros", () => {
  it("falso con el estado inicial y verdadero con cualquier cambio", () => {
    expect(hayFiltros(FILTROS_VACIOS)).toBe(false);
    expect(hayFiltros(con({ texto: "x" }))).toBe(true);
    expect(hayFiltros(con({ incluirInactivos: true }))).toBe(true);
    expect(hayFiltros(con({ anomalia: "linea_partida" }))).toBe(true);
  });
});

describe("tieneAnomaliaAlta", () => {
  it("sin_agrupacion y genero_no_incluido son altas; el resto no", () => {
    expect(tieneAnomaliaAlta({ anomalias: ["sin_agrupacion"] })).toBe(true);
    expect(tieneAnomaliaAlta({ anomalias: ["linea_partida", "genero_no_incluido"] })).toBe(true);
    expect(tieneAnomaliaAlta({ anomalias: ["nodo_gml_mixto", "generica_discrepante", "linea_partida"] })).toBe(false);
    expect(tieneAnomaliaAlta({ anomalias: [] })).toBe(false);
  });
});

describe("Resumen por agrupación", () => {
  it("con filtros vacíos coincide con los conteos de la API, más la fila «Sin agrupación» al final", () => {
    const filas = armarResumenAgrupaciones(reporte, filtrarEstructura(detalle, FILTROS_VACIOS));
    expect(filas).toHaveLength(reporte.agrupaciones.length + 1);
    for (const a of reporte.agrupaciones) {
      const f = filas.find((x) => x.id === a.id);
      expect(f, a.nombre).toMatchObject({
        nodos_gml: a.nodos_gml,
        nodos_gml_mixtos: a.nodos_gml_mixtos,
        unidades_gmle: a.unidades_gmle,
        equivalencias: a.equivalencias,
        genericas: a.genericas,
        lineas: a.lineas,
        anomalias: a.anomalias,
      });
    }
    const sin = filas[filas.length - 1];
    expect(sin).toMatchObject({ id: null, nombre: "Sin agrupación", clave: SIN_AGRUPACION, equivalencias: 2, genericas: 1, lineas: 2, nodos_gml: 1, unidades_gmle: 1 });
  });
  it("las equivalencias de las agrupaciones más «Sin agrupación» suman el total vigente de la cabecera", () => {
    const filas = armarResumenAgrupaciones(reporte, filtrarEstructura(detalle, FILTROS_VACIOS));
    expect(filas.reduce((s, f) => s + f.equivalencias, 0)).toBe(reporte.resumen.equivalencias);
  });
  it("una agrupación inactiva con solo equivalencias inactivas sale con 0", () => {
    const vieja = armarResumenAgrupaciones(reporte, filtrarEstructura(detalle, FILTROS_VACIOS)).find((f) => f.id === AGR_VIEJA);
    expect(vieja).toMatchObject({ activo: false, equivalencias: 0 });
  });
  it("con filtro de género solo cuenta lo de ese género", () => {
    const filas = armarResumenAgrupaciones(reporte, filtrarEstructura(detalle, con({ genero: "MUJER" })));
    const invierno = filas.find((f) => f.id === AGR_INVIERNO);
    // De las tres de INVIERNO solo ESTAMPADO es de MUJER; el nodo mixto es de HOMBRE y no cuenta.
    expect(invierno).toMatchObject({ equivalencias: 1, unidades_gmle: 1, nodos_gml_mixtos: 0, lineas: 1 });
    expect(filas.find((f) => f.id === AGR_VERANO)).toMatchObject({ equivalencias: 0, nodos_gml: 0 });
  });
  it("el filtro de agrupación y los inactivos no cambian los conteos (solo las filas visibles)", () => {
    const base = armarResumenAgrupaciones(reporte, filtrarEstructura(detalle, FILTROS_VACIOS));
    const filtrado = armarResumenAgrupaciones(reporte, filtrarEstructura(detalle, con({ agrupacion: AGR_VERANO, incluirInactivos: true })));
    expect(filtrado).toEqual(base);
  });
  it("filtrarFilasResumen elige las filas a mostrar", () => {
    const todas = armarResumenAgrupaciones(reporte, filtrarEstructura(detalle, FILTROS_VACIOS));
    const estructura = (f: FiltrosGmle) => filtrarEstructura(detalle, f);
    const claves = (f: FiltrosGmle) => filtrarFilasResumen(todas, f, estructura(f)).map((x) => x.clave);
    expect(claves(FILTROS_VACIOS)).toHaveLength(6);
    expect(claves(con({ agrupacion: AGR_VERANO }))).toEqual([AGR_VERANO]);
    expect(claves(con({ agrupacion: SIN_AGRUPACION }))).toEqual([SIN_AGRUPACION]);
    expect(claves(con({ anomalia: "agrupacion_vacia" }))).toEqual([AGR_VACIA]);
    expect(claves(con({ anomalia: "sin_agrupacion" }))).toEqual([SIN_AGRUPACION]);
    expect(claves(con({ anomalia: "nodo_gml_mixto" }))).toEqual([AGR_INVIERNO, AGR_VERANO]);
    expect(claves(con({ soloAnomalias: true }))).toEqual([AGR_INVIERNO, AGR_VERANO, AGR_VACIA, SIN_AGRUPACION]);
  });
  it("filtrarFilasResumen: los avisos de equivalencia dejan solo las agrupaciones con filas que los llevan", () => {
    const claves = (filas: typeof detalle, f: FiltrosGmle) => {
      const base = armarResumenAgrupaciones(reporte, filtrarEstructura(filas, FILTROS_VACIOS));
      return filtrarFilasResumen(base, f, filtrarEstructura(filas, f)).map((x) => x.clave);
    };
    // Solo e4 (de VERANO) es genérica discrepante; las líneas partidas tocan INVIERNO y VERANO.
    expect(claves(detalle, con({ anomalia: "generica_discrepante" }))).toEqual([AGR_VERANO]);
    expect(claves(detalle, con({ anomalia: "linea_partida" }))).toEqual([AGR_INVIERNO, AGR_VERANO]);
    // Nadie lleva `genero_no_incluido` en la fixture.
    expect(claves(detalle, con({ anomalia: "genero_no_incluido" }))).toEqual([]);
    // Con una fila POLOS (e7) marcada, solo POLOS queda; y con «Solo anomalías» también aparece.
    const marcada = detalle.map((f) => (f.id === "e7" ? { ...f, anomalias: ["genero_no_incluido" as const] } : f));
    expect(claves(marcada, con({ anomalia: "genero_no_incluido" }))).toEqual([AGR_POLOS]);
    expect(claves(marcada, con({ soloAnomalias: true }))).toEqual([AGR_INVIERNO, AGR_VERANO, AGR_POLOS, AGR_VACIA, SIN_AGRUPACION]);
    // Combina con el filtro estructural: MUJER no tiene filas de línea partida.
    expect(claves(detalle, con({ anomalia: "linea_partida", genero: "MUJER" }))).toEqual([]);
  });
  it("ordenarResumen deja «Sin agrupación» siempre al pie", () => {
    const todas = armarResumenAgrupaciones(reporte, filtrarEstructura(detalle, FILTROS_VACIOS));
    const porEquivalencias = ordenarResumen(todas, (f) => f.equivalencias, { clave: "equivalencias", dir: "desc" });
    expect(porEquivalencias.map((f) => f.clave).at(-1)).toBe(SIN_AGRUPACION);
    expect(porEquivalencias.slice(0, 3).map((f) => f.equivalencias)).toEqual([4, 3, 1]);
  });
});

describe("Anomalías: filas de los bloques", () => {
  it("equivalencias con aviso propio: solo las tres de equivalencia, con o sin código elegido", () => {
    expect(ids(filtrarAnomaliasDeEquivalencia(detalle, FILTROS_VACIOS))).toEqual(["e4", "e9", "e10"]);
    expect(ids(filtrarAnomaliasDeEquivalencia(detalle, FILTROS_VACIOS, "sin_agrupacion"))).toEqual(["e9", "e10"]);
    expect(ids(filtrarAnomaliasDeEquivalencia(detalle, FILTROS_VACIOS, "generica_discrepante"))).toEqual(["e4"]);
    expect(filtrarAnomaliasDeEquivalencia(detalle, FILTROS_VACIOS, "genero_no_incluido")).toEqual([]);
    expect(ids(filtrarAnomaliasDeEquivalencia(detalle, con({ genero: "MUJER" }))).sort()).toEqual(["e10", "e9"]);
  });
  it("nodos y líneas siguen a las equivalencias filtradas", () => {
    const filtradas = filtrarReporte(detalle, con({ genero: "MUJER" }));
    expect(filtrarNodosPorFilas(reporte.nodos, filtradas).map((n) => n.id)).toEqual(["n3", "n4"]);
    expect(filtrarLineasPartidas(reporte.lineas_partidas, filtradas)).toEqual([]);
    expect(filtrarLineasPartidas(reporte.lineas_partidas, filtrarReporte(detalle, con({ genero: "HOMBRE", texto: "pantalon" })))).toHaveLength(1);
    expect(filtrarLineasPartidas(reporte.lineas_partidas, filtrarReporte(detalle, con({ mundo: "FORMAL" })))).toHaveLength(1);
  });
  it("agrupaciones vacías: solo las activas con el aviso, filtradas por agrupación, género, texto y chip", () => {
    expect(filtrarAgrupacionesVacias(reporte.agrupaciones, FILTROS_VACIOS).map((a) => a.id)).toEqual([AGR_VACIA]);
    expect(filtrarAgrupacionesVacias(reporte.agrupaciones, con({ genero: "MUJER" }))).toEqual([]);
    expect(filtrarAgrupacionesVacias(reporte.agrupaciones, con({ agrupacion: AGR_VERANO }))).toEqual([]);
    expect(filtrarAgrupacionesVacias(reporte.agrupaciones, con({ agrupacion: SIN_AGRUPACION }))).toEqual([]);
    expect(filtrarAgrupacionesVacias(reporte.agrupaciones, con({ texto: "vací" }))).toHaveLength(1);
    expect(filtrarAgrupacionesVacias(reporte.agrupaciones, con({ anomalia: "linea_partida" }))).toEqual([]);
    expect(filtrarAgrupacionesVacias(reporte.agrupaciones, con({ anomalia: "agrupacion_vacia" }))).toHaveLength(1);
  });
  it("nodos mixtos: reparto legible, mayoritaria y número de equivalencias", () => {
    const filas = armarNodosMixtos(reporte.nodos, reporte.agrupaciones);
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      reparto: "2 PANTALONES INVIERNO · 2 PANTALONES VERANO",
      mayoritaria: "PANTALONES INVIERNO",
      equivalencias: 4,
    });
    const nombres = new Map(reporte.agrupaciones.map((a) => [a.id, a.nombre]));
    expect(textoReparto(reporte.nodos[2], nombres)).toBe("1 POLOS · 1 PANTALONES INVIERNO · 1 sin");
  });
  it("texto de la línea partida con equivalencias y mundos", () => {
    expect(textoLineaPartida(reporte.lineas_partidas[0])).toBe("PANTALONES INVIERNO (2: URBANO) · PANTALONES VERANO (4: URBANO, FORMAL)");
  });
});

describe("orden", () => {
  it("siguienteOrden: ascendente, descendente y de vuelta al orden original", () => {
    const asc = siguienteOrden(null, "linea");
    expect(asc).toEqual({ clave: "linea", dir: "asc" });
    const desc = siguienteOrden(asc, "linea");
    expect(desc).toEqual({ clave: "linea", dir: "desc" });
    expect(siguienteOrden(desc, "linea")).toBeNull();
    expect(siguienteOrden(desc, "mundo")).toEqual({ clave: "mundo", dir: "asc" });
  });
  it("ordena por texto (sin distinguir acentos ni mayúsculas) o por número, sin mutar, de forma estable", () => {
    const filas = [
      { id: "a", t: "b", n: 2 },
      { id: "b", t: "Á", n: 10 },
      { id: "c", t: "a", n: 2 },
      { id: "d", t: "B", n: 1 },
    ];
    const copia = structuredClone(filas);
    expect(ordenarFilas(filas, (f) => f.t, { clave: "t", dir: "asc" }).map((f) => f.id)).toEqual(["b", "c", "a", "d"]);
    expect(ordenarFilas(filas, (f) => f.n, { clave: "n", dir: "asc" }).map((f) => f.id)).toEqual(["d", "a", "c", "b"]);
    expect(ordenarFilas(filas, (f) => f.n, { clave: "n", dir: "desc" }).map((f) => f.id)).toEqual(["b", "a", "c", "d"]);
    expect(filas).toEqual(copia);
  });
  it("sin orden devuelve una copia en el orden del contrato", () => {
    const filas = [{ id: "x" }, { id: "y" }];
    const r = ordenarFilas(filas, undefined, null);
    expect(r).toEqual(filas);
    expect(r).not.toBe(filas);
  });
  it("números en el texto se comparan por su valor (casa 2 antes que casa 10)", () => {
    const r = ordenarFilas(["casa 10", "casa 2"], (s) => s, { clave: "x", dir: "asc" });
    expect(r).toEqual(["casa 2", "casa 10"]);
  });
});
