import { describe, expect, it } from "vitest";
import { analizarMarca } from "@/lib/marcas-barrer/modelo";
import type { AnalisisMarcaApi, FilaRepartoApi } from "@/lib/marcas-barrer/tipos-api";
import {
  ALCANCE_VACIO,
  CLAVE,
  EQ,
  GEN,
  MARCA,
  NODO,
  OTROS,
  PEQUENOS_C,
  PEQUENOS_U,
  datosGamma,
  entradaBeta,
  entradaGamma,
  hechosBeta,
  hechosBetaCambia,
  hechosBetaConstante,
  unidadesB,
  ventaDe,
} from "./marcas-barrer.fixture";

/** Caso 2 a 7 y 9 a 10 de la ficha 12 (sección 9) sobre el análisis completo, y la regla 15 (determinismo). */

const fila = (a: AnalisisMarcaApi, clave: string): FilaRepartoApi => {
  const f = a.filas.find((x) => x.clave === clave);
  if (!f) throw new Error(`falta la fila ${clave}`);
  return f;
};
const p2 = (a: AnalisisMarcaApi, clave: string, temporada: "verano" | "invierno" | null) =>
  fila(a, clave).p2.find((x) => x.temporada === temporada)!;
const suma = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("caso 2: p2 por temporada de BETA", () => {
  const { api } = analizarMarca(entradaBeta({ normaliza_nino: false }));

  it("dos vectores (verano e invierno), cada uno con suma 1 sobre las g con venta", () => {
    expect(api.parametros).toMatchObject({ modo: "por_temporada", modo_efectivo: "por_temporada", ventana_meses: 24, hasta_periodo: "2026-09", desde_periodo: "2024-10" });
    expect(api.parametros.meses_por_temporada).toEqual([{ temporada: "verano", meses: 12 }, { temporada: "invierno", meses: 12 }]);
    for (const t of ["verano", "invierno"] as const) {
      expect(suma(api.filas.map((f) => f.p2.find((x) => x.temporada === t)?.historico ?? 0))).toBeCloseTo(1, 9);
    }
  });
  it("valores del fixture: verano 2 230 u (DENIM 1 200, POLO 600, SANDALIA 240, pequeños 190) e invierno 2 140 u", () => {
    expect(p2(api, CLAVE.denim, "verano").historico).toBeCloseTo(1200 / 2230, 9);
    expect(p2(api, CLAVE.polo, "verano").historico).toBeCloseTo(600 / 2230, 9);
    expect(p2(api, CLAVE.sandalia, "verano").historico).toBeCloseTo(240 / 2230, 9);
    expect(p2(api, CLAVE.denim, "invierno").historico).toBeCloseTo(1200 / 2140, 9);
    // Los seis pequeños de CASUAL venden en febrero (verano) y los tres de URBANO en julio (invierno).
    expect(p2(api, CLAVE.c[0], "verano").historico).toBeCloseTo(PEQUENOS_C[0] / 2230, 9);
    expect(p2(api, CLAVE.c[0], "invierno").historico).toBe(0);
    expect(p2(api, CLAVE.u[0], "invierno").historico).toBeCloseTo(PEQUENOS_U[0] / 2140, 9);
  });
  it("con la normalización del Niño los vectores difieren de la cifra cruda en el tercer decimal", () => {
    const nino = analizarMarca(entradaBeta({ normaliza_nino: true })).api;
    const crudo = p2(api, CLAVE.polo, "invierno").historico;
    const normal = p2(nino, CLAVE.polo, "invierno").historico;
    expect(normal).not.toBeCloseTo(crudo, 3);
    expect(Math.abs(normal - crudo)).toBeLessThan(0.01);
    // Septiembre de 2026 de POLO (50 u) se divide entre 1,24 (verano atípico de 2026): 590,32 u de invierno.
    expect(p2(nino, CLAVE.polo, "invierno").historico).toBeCloseTo((600 - 50 + 50 / 1.24) / (1200 + 590.32258 + (240 - 20 + 20 / 1.24) + 100), 6);
    expect(nino.parametros.factores.map((f) => [f.anio, f.temporada, f.ratio])).toEqual([
      [2026, "invierno", 0.66],
      [2026, "verano", 1.24],
    ]);
  });
  it("anual iguala un solo reparto sobre toda la ventana", () => {
    const anual = analizarMarca(entradaBeta({ modo: "anual", normaliza_nino: false })).api;
    expect(anual.parametros.modo_efectivo).toBe("anual");
    expect(fila(anual, CLAVE.denim).p2).toHaveLength(1);
    expect(p2(anual, CLAVE.denim, null).historico).toBeCloseTo(2400 / 4370, 9);
    expect(p2(anual, CLAVE.polo, null).historico).toBeCloseTo(1200 / 4370, 9);
    expect(p2(anual, CLAVE.sandalia, null).historico).toBeCloseTo(480 / 4370, 9);
  });
  it("una ventana de 12 meses solo mira los últimos 12 (oct-2025 → set-2026)", () => {
    const a = analizarMarca(entradaBeta({ ventana: 12, normaliza_nino: false })).api;
    expect(a.parametros.desde_periodo).toBe("2025-10");
    expect(fila(a, CLAVE.denim).unidades_ventana).toBe(1200);
    // Los pequeños venden solo en 2025-02 y 2025-07: los dos meses quedan fuera de oct-2025 → set-2026.
    expect(a.filas.some((f) => f.clave === CLAVE.c[0])).toBe(false);
    expect(a.filas.some((f) => f.clave === CLAVE.u[0])).toBe(false);
    expect(a.restos).toEqual([]);
  });
});

describe("caso 3: alcance HOMBRE", () => {
  const alcance = { generos: [GEN.hombre], mundos: [], lineas: [] };
  const sin = analizarMarca(entradaBeta({ normaliza_nino: false })).api;
  const con = analizarMarca(entradaBeta({ alcance, normaliza_nino: false })).api;

  it("SANDALIA (MUJER) sale: fuera_de_alcance = [{ SANDALIA, 480 }] y no tiene p2", () => {
    expect(con.fuera_de_alcance).toEqual([{ ruta: "MUJER · CASUAL · SANDALIA", unidades: 480 }]);
    expect(fila(con, CLAVE.sandalia)).toMatchObject({ en_alcance: false, p2: [] });
    expect(sin.fuera_de_alcance).toEqual([]);
    expect(fila(sin, CLAVE.sandalia).en_alcance).toBe(true);
  });
  it("DENIM, POLO y los pequeños se renormalizan (suma 1 sin la sandalia)", () => {
    expect(p2(con, CLAVE.denim, "verano").historico).toBeCloseTo(1200 / 1990, 9);
    for (const t of ["verano", "invierno"] as const) {
      expect(suma(con.filas.map((f) => f.p2.find((x) => x.temporada === t)?.historico ?? 0))).toBeCloseTo(1, 9);
    }
  });
  it("las opciones de alcance traen los géneros, mundos y líneas donde la marca vende al barrer", () => {
    expect(sin.opciones_alcance.generos.map((g) => g.nombre)).toEqual(["HOMBRE", "MUJER"]);
    expect(sin.opciones_alcance.mundos.map((m) => m.nombre)).toEqual(["CASUAL", "URBANO"]);
    expect(con.parametros.alcance).toEqual({ generos: [GEN.hombre], mundos: [], lineas: [] });
  });
  it("el alcance cambia la huella (la aprobación no sirve sobre otro alcance)", () => {
    expect(con.huella).not.toBe(sin.huella);
  });
});

describe("caso 4: resto", () => {
  const { api, interno } = analizarMarca(entradaBeta({ normaliza_nino: false }));

  it("los nueve pequeños forman 'Resto de HOMBRE · CASUAL' (6) y 'Resto de HOMBRE · URBANO' (3)", () => {
    expect(api.restos.map((r) => [r.etiqueta, r.miembros.length, r.unidades_ventana])).toEqual([
      ["Resto de HOMBRE · CASUAL", 6, 190],
      ["Resto de HOMBRE · URBANO", 3, 100],
    ]);
    expect(api.filas.filter((f) => f.pequena)).toHaveLength(9);
    expect(api.filas.filter((f) => !f.pequena).map((f) => f.clave).sort()).toEqual([CLAVE.denim, CLAVE.polo, CLAVE.sandalia].sort());
    const casual = api.restos[0];
    expect(casual.p2.find((x) => x.temporada === "verano")!.historico).toBeCloseTo(190 / 2230, 9);
    expect(casual.p2.find((x) => x.temporada === "invierno")!.historico).toBe(0);
  });
  it("cada miembro lleva su grupo_resto género|mundo y el peso con que el resto se reparte", () => {
    const c1 = api.filas.find((f) => f.clave === CLAVE.c[0])!;
    expect(c1.grupo_resto).toBe(`${GEN.hombre}|${api.filas.find((f) => f.clave === CLAVE.polo)!.mundo_id}`);
    expect(interno.filas.get(CLAVE.c[0])!.peso).toBe(40);
  });
  it("las filas se ordenan por unidades de la ventana y luego por ruta", () => {
    expect(api.filas[0].clave).toBe(CLAVE.denim);
    expect(api.filas[1].clave).toBe(CLAVE.polo);
  });
});

describe("caso 5: error del reparto", () => {
  const sinNino = { normaliza_nino: false };

  it("BETA constante → 0 pp y estable", () => {
    const a = analizarMarca(entradaBeta(sinNino, hechosBetaConstante())).api;
    expect(a.error_reparto.pp).toBeCloseTo(0, 9);
    expect(a.error_reparto.veredicto).toBe("estable");
    expect(a.avisos).not.toContain("sin_backtesting");
  });
  it("BETA cambia (2024-25 DENIM 70 % y POLO 30 %, 2026 al revés) → 40 pp e inestable", () => {
    const a = analizarMarca(entradaBeta(sinNino, hechosBetaCambia())).api;
    expect(a.error_reparto.pp).toBeCloseTo(40, 9);
    expect(a.error_reparto.veredicto).toBe("inestable");
    expect(a.error_reparto.anios).toEqual([{ anio: 2026, pp: expect.closeTo(40, 9) }]);
  });
  it("con un solo año de datos previos insuficientes (ventana 12) → null y aviso sin_backtesting", () => {
    const a = analizarMarca(entradaBeta({ ...sinNino, ventana: 12 }, hechosBetaConstante())).api;
    expect(a.error_reparto).toMatchObject({ pp: null, veredicto: null, anios: [] });
    expect(a.avisos).toContain("sin_backtesting");
  });
});

describe("caso 6: p2 según la cerrada", () => {
  const a = analizarMarca(entradaBeta({ normaliza_nino: false })).api;

  it("con las participaciones barrido de BETA de 0,12 (DENIM × PREMIUM) y 0,30 (POLO × PREMIUM) la cerrada reparte 50 / 50 y el resto es 0", () => {
    for (const t of ["verano", "invierno"] as const) {
      expect(p2(a, CLAVE.denim, t).cerrada).toBeCloseTo(0.5, 9);
      expect(p2(a, CLAVE.polo, t).cerrada).toBeCloseTo(0.5, 9);
      expect(p2(a, CLAVE.sandalia, t).cerrada).toBe(0);
    }
    expect(a.parametros.fuente_disponible).toEqual(["historico", "cerrada"]);
    expect(a.avisos).not.toContain("sin_cerrada");
  });
  it("el histórico y el de la cerrada se muestran lado a lado y son distintos", () => {
    expect(p2(a, CLAVE.denim, "verano").historico).not.toBeCloseTo(p2(a, CLAVE.denim, "verano").cerrada ?? 0, 2);
  });
  it("sin cerrada → p2.cerrada es null, solo la fuente histórica y aviso sin_cerrada", () => {
    const sin = analizarMarca(entradaBeta({ normaliza_nino: false, cerrada: null })).api;
    expect(p2(sin, CLAVE.denim, "verano").cerrada).toBeNull();
    expect(sin.parametros.fuente_disponible).toEqual(["historico"]);
    expect(sin.avisos).toContain("sin_cerrada");
  });
  it("la cerrada respeta el alcance (SANDALIA fuera) y el modo anual", () => {
    const hombre = analizarMarca(entradaBeta({ normaliza_nino: false, modo: "anual", alcance: { generos: [GEN.hombre], mundos: [], lineas: [] } })).api;
    expect(p2(hombre, CLAVE.denim, null).cerrada).toBeCloseTo(0.5, 9);
  });
});

describe("caso 7 y regla 9: GAMMA mixta y parte al barrer", () => {
  const { api } = analizarMarca(entradaGamma({ normaliza_nino: false }));

  it("40 u/mes en CAMISA › MANGA LARGA (específica) y 60 en DENIM (al barrer): share_barrido = 0,6", () => {
    expect(api.share_barrido).toBeCloseTo(0.6, 9);
    expect(api.unidades_barrer).toBe(1440);
    expect(api.unidades_especificas).toBe(960);
  });
  it("p2 = { DENIM 1,0 } y CAMISA es específica con p2 = 0 (no se reparte)", () => {
    expect(p2(api, CLAVE.denim, "verano").historico).toBe(1);
    expect(p2(api, CLAVE.denim, "invierno").historico).toBe(1);
    const camisa = fila(api, CLAVE.camisaLarga);
    expect(camisa.es_especifico).toBe(true);
    expect(camisa.p2.every((x) => x.historico === 0)).toBe(true);
    expect(camisa.ruta).toBe("HOMBRE · FORMAL · CAMISA › MANGA LARGA");
    expect(camisa.nivel).toBe("GMLE");
    expect(api.marca.gml_especificos).toEqual([{ gml_id: NODO.camisa, ruta: "HOMBRE · FORMAL · CAMISA" }]);
    expect(camisa.pequena).toBe(false);
  });
  it("p1 cuenta la parte específica: CAMISA pesa 40 de sus 40 u (sin otras marcas)", () => {
    expect(fila(api, CLAVE.camisaLarga).p1_ventana).toBe(1);
    expect(fila(api, CLAVE.denim).p1_ventana).toBeCloseTo(60 / 960, 9);
  });
  it("una mixta sin GML específicos se comporta como al barrer y avisa mixta_sin_gml; una barrido es 1", () => {
    const sinGml = analizarMarca(entradaGamma({ marca: { ...datosGamma(), gml_especificos: [] } })).api;
    expect(sinGml.avisos).toContain("mixta_sin_gml");
    expect(analizarMarca(entradaBeta()).api.share_barrido).toBe(1);
    expect(analizarMarca(entradaBeta()).api.unidades_especificas).toBe(0);
  });
});

describe("caso 10: DELTA sin venta", () => {
  const delta = { id: MARCA.delta, nombre: "DELTA", modalidad: "barrido" as const, agrupacion_marca: "VALOR", agrupacion_marca_id: "ag", miembros: [], gml_especificos: [] };
  const { api, interno } = analizarMarca(entradaBeta({ marca: delta, venta: ventaDe([], OTROS), cerrada: null }));

  it("sin_venta_barrer, filas = [] y ningún vector", () => {
    expect(api.avisos).toContain("sin_venta_barrer");
    expect(api.filas).toEqual([]);
    expect(api.restos).toEqual([]);
    expect([...interno.historico.vectores.values()].every((v) => v === null)).toBe(true);
    expect(api.error_reparto.pp).toBeNull();
    expect(api.estacionalidad.propia).toBeNull();
    expect(api.share_barrido).toBe(1);
  });
});

describe("regla 8: estacionalidad y tendencia en el análisis", () => {
  const { api } = analizarMarca(entradaBeta({ normaliza_nino: false }));

  it("propia y del GML suman 1, hay un año completo (2025) y el EAT con su veredicto", () => {
    expect(api.estacionalidad.anios_completos).toEqual([2025]);
    expect(suma(api.estacionalidad.propia!)).toBeCloseTo(1, 9);
    expect(suma(api.estacionalidad.gml!)).toBeCloseTo(1, 9);
    expect(api.estacionalidad.eat_pp).toBeGreaterThan(0);
    expect(["similar", "dudosa", "distinta"]).toContain(api.estacionalidad.veredicto);
  });
  it("con un solo año completo la tendencia es null; los años de cada g llevan completo = true solo si tienen los doce meses", () => {
    expect(api.tendencia_total).toBeNull();
    const denim = fila(api, CLAVE.denim);
    expect(denim.tendencia).toBeNull();
    expect(denim.unidades_anual).toEqual([
      { anio: 2024, unidades: 300, completo: false },
      { anio: 2025, unidades: 1200, completo: true },
      { anio: 2026, unidades: 900, completo: false },
    ]);
    expect(denim.p1_anual.map((p) => [p.anio, p.completo])).toEqual([[2024, false], [2025, true], [2026, false]]);
  });
  it("p1 = unidades de BETA ÷ unidades totales del GML (DENIM 10 %, POLO 12,5 %, SANDALIA 4 %) por mes, año y ventana", () => {
    expect(fila(api, CLAVE.denim).p1_ventana).toBeCloseTo(0.1, 9);
    expect(fila(api, CLAVE.polo).p1_ventana).toBeCloseTo(50 / 400, 9);
    expect(fila(api, CLAVE.sandalia).p1_ventana).toBeCloseTo(20 / 500, 9);
    expect(fila(api, CLAVE.denim).p1_anual.find((p) => p.anio === 2025)!.valor).toBeCloseTo(0.1, 9);
    const mensual = fila(api, CLAVE.denim).p1_mensual.find((p) => p.anio === 2025)!.meses;
    expect(mensual).toHaveLength(12);
    expect(mensual.every((v) => v !== null && Math.abs(v - 0.1) < 1e-9)).toBe(true);
    // 2024 solo tiene octubre a diciembre dentro de la ventana.
    const m2024 = fila(api, CLAVE.denim).p1_mensual.find((p) => p.anio === 2024)!.meses;
    expect(m2024.slice(0, 9).every((v) => v === null)).toBe(true);
    expect(m2024[9]).toBeCloseTo(0.1, 9);
  });
});

describe("regla 15: determinismo y pureza", () => {
  it("misma entrada → misma salida", () => {
    const a = analizarMarca(entradaBeta());
    const b = analizarMarca(entradaBeta());
    expect(JSON.stringify(a.api)).toBe(JSON.stringify(b.api));
    expect(a.interno.huellaConfig("historico")).toBe(b.interno.huellaConfig("historico"));
  });
  it("no muta la entrada", () => {
    const e = entradaBeta();
    const copia = JSON.stringify({ ...e, unidades: undefined });
    analizarMarca(e);
    expect(JSON.stringify({ ...e, unidades: undefined })).toBe(copia);
  });
  it("VERSION_METODO_BARRER entra en huella_config (otra versión del método, otra huella) y la huella cambia con las cargas", () => {
    const base = analizarMarca(entradaBeta());
    const otraCarga = entradaBeta();
    otraCarga.venta = { ...otraCarga.venta, cargas: { ...otraCarga.venta.cargas, "2026-09": "carga-nueva" } };
    expect(analizarMarca(otraCarga).api.huella).not.toBe(base.api.huella);
    expect(base.interno.huellaConfig("historico").split(".")).toHaveLength(3);
  });
  it("los meses fuera de la ventana no cuentan (se puede pedir más venta de la necesaria)", () => {
    const largo = analizarMarca(entradaBeta({ ventana: 12, normaliza_nino: false }, [...hechosBeta(), { unidad: MARCA.beta, nodo: NODO.denim, eq: null, mes: "2020-01", u: 99999 }])).api;
    const corto = analizarMarca(entradaBeta({ ventana: 12, normaliza_nino: false })).api;
    expect(fila(largo, CLAVE.denim).unidades_ventana).toBe(fila(corto, CLAVE.denim).unidades_ventana);
  });
  it("una g que el catálogo no conoce no entra ni rompe", () => {
    const base = unidadesB();
    const a = analizarMarca(entradaBeta({ unidades: (c) => (c === CLAVE.sandalia ? null : base(c)) })).api;
    expect(a.filas.some((f) => f.clave === CLAVE.sandalia)).toBe(false);
    expect(ALCANCE_VACIO.generos).toEqual([]);
    expect(EQ.denim).toBeTruthy();
  });
});
