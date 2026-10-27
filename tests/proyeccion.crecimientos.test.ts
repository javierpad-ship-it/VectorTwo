import { describe, expect, it } from "vitest";
import {
  agregarFilas,
  calcularPromedio,
  celdasFaltantes,
  claveGM,
  crearCrecimientoDe,
  crecimientoEfectivo,
  generosDeMatriz,
  matrizDeCeldas,
  type FilaCrecimiento,
} from "@/lib/proyeccion/crecimientos";
import { explicar } from "@/lib/proyeccion/explicar";
import { createHash } from "node:crypto";
import { huellaCrecimientos, huellaDeMatriz } from "@/lib/proyeccion/huellas-crecimientos";
import { calcularProyeccion, registroDe, type ContextoModelo } from "@/lib/proyeccion/modelo";
import { crecimientoDeTienda } from "@/lib/proyeccion/decision";
import { maduroDeVigente, rampaMensual, sumaCurva } from "@/lib/proyeccion/tiendas-nuevas";
import type { AgregadoCrecimientoApi, DecisionPrevia, FilaModelo, NodoProy, PreviasCalculo, SalidaCalculo } from "@/lib/proyeccion/tipos";
import { AM, CURVA_INVIERNO, CURVA_PLANA, EQ, GEN, MUN, N, Y, clave, claveTienda, entrada, nodos } from "./proyeccion.fixture";

/**
 * 07c y 06d (sintético; nada real): precedencia, agregados, huellas (con ids desde 0.12.1), «Calcular promedio» y el cálculo con
 * la matriz de crecimientos (método 4: el % es bruto).
 */

const MUJER = GEN.mujer;
const HOMBRE = GEN.hombre;
const FORMAL = "m-formal";
const URBANO = MUN.urbano;

const fc = (extra: Partial<FilaCrecimiento> & { fila_id: string }): FilaCrecimiento => ({
  genero_id: HOMBRE,
  mundo_id: FORMAL,
  crecimiento_pct: null,
  decidido: null,
  propuesto: null,
  base_siguiente: null,
  base_normalizada: null,
  ...extra,
});

describe("regla 1: crecimientoEfectivo (fila > celda GM > Resto)", () => {
  const celdas = new Map([[claveGM(HOMBRE, FORMAL), 20]]);

  it("una fila con % propio manda sobre la celda y el Resto, aunque sea 0", () => {
    expect(crecimientoEfectivo({ pctFila: 5, genero_id: HOMBRE, mundo_id: FORMAL }, celdas, 3)).toEqual({ pct: 5, origen: "fila" });
    expect(crecimientoEfectivo({ pctFila: 0, genero_id: HOMBRE, mundo_id: FORMAL }, celdas, 3)).toEqual({ pct: 0, origen: "fila" });
  });

  it("sin % propio manda la celda de su GM", () => {
    expect(crecimientoEfectivo({ pctFila: null, genero_id: HOMBRE, mundo_id: FORMAL }, celdas, 3)).toEqual({ pct: 20, origen: "celda" });
  });

  it("una celda de otro GM, una celda borrada o sin GM no se aplican: sigue el Resto", () => {
    expect(crecimientoEfectivo({ genero_id: HOMBRE, mundo_id: URBANO }, celdas, 3)).toEqual({ pct: 3, origen: "resto" });
    expect(crecimientoEfectivo({ genero_id: MUJER, mundo_id: FORMAL }, celdas, 3)).toEqual({ pct: 3, origen: "resto" });
    expect(crecimientoEfectivo({ genero_id: HOMBRE, mundo_id: FORMAL }, new Map(), 3)).toEqual({ pct: 3, origen: "resto" });
    expect(crecimientoEfectivo({ genero_id: null, mundo_id: null }, celdas, 3)).toEqual({ pct: 3, origen: "resto" });
  });

  it("una celda de un género fuera de la matriz (GENEROS_MATRIZ) no se aplica", () => {
    const jov = "g-jovencitos";
    const conJov = new Map([[claveGM(jov, FORMAL), 40], ...celdas]);
    expect(crecimientoEfectivo({ genero_id: jov, mundo_id: FORMAL }, conJov, 3, new Set([HOMBRE, MUJER]))).toEqual({ pct: 3, origen: "resto" });
    // `matrizDeCeldas` ya las descarta al armar la matriz del método.
    expect(matrizDeCeldas([{ genero_id: jov, mundo_id: FORMAL, pct: 40 }, { genero_id: HOMBRE, mundo_id: FORMAL, pct: 20 }], [HOMBRE, MUJER]).celdas.size).toBe(1);
  });

  it("generosDeMatriz resuelve HOMBRE y MUJER por upper(trim(nombre)) entre los activos, en ese orden", () => {
    const g = [
      { id: "1", nombre: " mujer ", activo: true },
      { id: "2", nombre: "Hombre", activo: true },
      { id: "3", nombre: "JOVENCITOS", activo: true },
    ];
    expect(generosDeMatriz(g).map((x) => x.id)).toEqual(["2", "1"]);
    expect(generosDeMatriz([{ id: "2", nombre: "HOMBRE", activo: false }, { id: "1", nombre: "MUJER", activo: true }]).map((x) => x.id)).toEqual(["1"]);
    expect(generosDeMatriz([{ id: "3", nombre: "JOVENCITOS" }])).toEqual([]);
  });

  it("crearCrecimientoDe: el nodo da el paso de la clave base al GM y trae el nombre de la celda", () => {
    const f = crearCrecimientoDe({
      matriz: matrizDeCeldas([{ genero_id: HOMBRE, mundo_id: URBANO, pct: 12 }], [HOMBRE, MUJER]),
      resto: 4,
      gmDe: (gml) => (gml === "n1" ? { genero_id: HOMBRE, mundo_id: URBANO, nombre: "HOMBRE · URBANO" } : undefined),
      pctFilaDe: (cb) => (cb === "|n1||am-propio" ? 7 : null),
    });
    expect(f("|n1||am-x")).toMatchObject({ pct: 12, origen: "celda", celda: "HOMBRE · URBANO", gm: claveGM(HOMBRE, URBANO) });
    expect(f("|n1||am-propio")).toMatchObject({ pct: 7, origen: "fila" });
    expect(f("|n1||am-x", null)).toMatchObject({ pct: 12, origen: "celda" });
    expect(f("|otro||am-x")).toMatchObject({ pct: 4, origen: "resto", celda: null, gm: null });
  });
});

describe("06d: crearCrecimientoDe con la matriz ampliada (versión y Resto provisional)", () => {
  const gmDe = (gml: string) => (gml === "n1" ? { genero_id: HOMBRE, mundo_id: URBANO, nombre: "HOMBRE · URBANO" } : undefined);
  const base = matrizDeCeldas([{ genero_id: HOMBRE, mundo_id: URBANO, pct: 12 }], [HOMBRE, MUJER]);

  it("con ids y versiones: la celda trae su versión; el Resto aprobado, la suya; el % propio, ninguna", () => {
    const matriz = { ...base, ids: new Map([[claveGM(HOMBRE, URBANO), "v-h"]]), versiones: new Map([[claveGM(HOMBRE, URBANO), 2]]), resto: { id: "r1", version: 3 } };
    const f = crearCrecimientoDe({ matriz, resto: 4, gmDe, pctFilaDe: (cb) => (cb === "|n1||am-propio" ? 7 : null) });
    expect(f("|n1||am-x")).toMatchObject({ pct: 12, origen: "celda", version: 2, provisional: false });
    expect(f("|n1||am-propio")).toMatchObject({ pct: 7, origen: "fila", version: null, provisional: false });
    expect(f("|otro||am-x")).toMatchObject({ pct: 4, origen: "resto", version: 3, provisional: false });
  });

  it("sin Resto aprobado (id null) o con una matriz sin las claves nuevas, el Resto es provisional y no tiene versión", () => {
    const f1 = crearCrecimientoDe({ matriz: { ...base, resto: { id: null, version: null } }, resto: 4, gmDe });
    expect(f1("|otro||am-x")).toMatchObject({ pct: 4, origen: "resto", version: null, provisional: true });
    const f2 = crearCrecimientoDe({ matriz: base, resto: 4, gmDe });
    expect(f2("|otro||am-x")).toMatchObject({ origen: "resto", version: null, provisional: true });
    // Una celda sin versión conocida (matriz de un literal) tampoco inventa una.
    expect(f2("|n1||am-x")).toMatchObject({ origen: "celda", version: null, provisional: false });
  });
});

describe("regla 3: ejemplo de §5.3 (HOMBRE · FORMAL al 20 %)", () => {
  // (A) CAMISA decidida 10 800; (B) TERNO invierno con Niño 2026 (B = 3 300, B'' = 5 000); (C) PANTALÓN con % propio 5 %.
  const filas: FilaCrecimiento[] = [
    fc({ fila_id: "A", base_siguiente: 10000, base_normalizada: 10000, decidido: 10800, propuesto: 12000 }),
    fc({ fila_id: "B", base_siguiente: 3300, base_normalizada: 5000, propuesto: 3960 }),
    fc({ fila_id: "C", base_siguiente: 4500, base_normalizada: 4500, crecimiento_pct: 5, propuesto: 4725 }),
  ];

  it("la celda tiene base 17 800, base libre 3 300 y resulta en 19 485 (+9,5 %); el rebote del Niño es +9,6 %", () => {
    const a = agregarFilas(filas);
    expect(a).toMatchObject({ filas: 3, filas_sin_base: 0, base: 17800, base_libre: 3300 });
    expect(a.pct_propio).toEqual({ filas: 1, base: 4500, siguiente: 4725 });
    expect(a.decididas).toEqual({ filas: 1, base: 10000, siguiente: 10800 });
    const resultante = a.pct_propio.siguiente + a.decididas.siguiente + a.base_libre * 1.2;
    expect(resultante).toBeCloseTo(19485, 6);
    expect((resultante / a.base - 1) * 100).toBeCloseTo(9.5, 1);
    expect(a.base_normalizada).toBe(19500);
    expect(a.rebote_nino_pct).toBeCloseTo(9.55, 1);
    expect(a.siguiente_vigente).toBe(10800 + 3960 + 4725);
    // TERNO a −20,8 % sobre la base normalizada: 3 960 ÷ 5 000 − 1.
    expect((3960 / 5000 - 1) * 100).toBeCloseTo(-20.8, 1);
  });

  it("sin filas con meses del Niño no hay rebote (null); una fila sin base cuenta pero no pesa", () => {
    expect(agregarFilas([fc({ fila_id: "x", base_siguiente: 100, base_normalizada: 100 })]).rebote_nino_pct).toBeNull();
    const sinBase = agregarFilas([fc({ fila_id: "x" }), fc({ fila_id: "y", base_siguiente: 50, base_normalizada: 50 })]);
    expect(sinBase).toMatchObject({ filas: 2, filas_sin_base: 1, base: 50, base_libre: 50 });
    expect(agregarFilas([]).base).toBe(0);
  });
});

describe("regla 12: huellas", () => {
  it("huellaCrecimientos no depende del orden; cambia con una celda o con el Resto; no con la nota ni el objetivo", () => {
    const celdas = [
      { genero_id: HOMBRE, mundo_id: FORMAL, pct: 20 },
      { genero_id: MUJER, mundo_id: URBANO, pct: 5 },
    ];
    const h = huellaCrecimientos(celdas, 5);
    expect(huellaCrecimientos([...celdas].reverse(), 5)).toBe(h);
    expect(huellaCrecimientos(celdas, "5.00")).toBe(h);
    expect(huellaCrecimientos([{ ...celdas[0], pct: 21 }, celdas[1]], 5)).not.toBe(h);
    expect(huellaCrecimientos(celdas, 6)).not.toBe(h);
    expect(huellaCrecimientos(celdas.slice(1), 5)).not.toBe(h);
    expect(huellaDeMatriz(matrizDeCeldas(celdas, [HOMBRE, MUJER]), 5)).toBe(h);
  });

  it("06d regla 7: sin ids el texto es el de 0.10.8 (md5 de «resto=20»); con ids cambia aunque el % sea igual y no depende del orden", () => {
    const md5 = (t: string) => createHash("md5").update(t).digest("hex");
    expect(huellaCrecimientos([], 20)).toBe(md5("resto=20"));
    expect(huellaCrecimientos([{ genero_id: HOMBRE, mundo_id: FORMAL, pct: 20 }], 5)).toBe(md5(`${HOMBRE}|${FORMAL}=20\nresto=5`));
    const celdas = [
      { genero_id: HOMBRE, mundo_id: FORMAL, pct: 20, crecimiento_id: "v1" },
      { genero_id: MUJER, mundo_id: URBANO, pct: 5, crecimiento_id: null },
    ];
    const h = huellaCrecimientos(celdas, 5, "r1");
    expect(h).toBe(md5(`${HOMBRE}|${FORMAL}=20#v1\n${MUJER}|${URBANO}=5\nresto=5#r1`));
    expect(huellaCrecimientos([...celdas].reverse(), 5, "r1")).toBe(h);
    // Aprobar otra versión con el mismo valor cambia la huella (la foto debe decir quién decidió); el Resto aprobado también.
    expect(huellaCrecimientos([{ ...celdas[0], crecimiento_id: "v2" }, celdas[1]], 5, "r1")).not.toBe(h);
    expect(huellaCrecimientos(celdas, 5, "r2")).not.toBe(h);
    expect(huellaCrecimientos(celdas, 5)).not.toBe(h);
    expect(huellaCrecimientos(celdas, 5, null)).toBe(huellaCrecimientos(celdas, 5));
  });

  it("huellaDeMatriz lee los ids de matriz.ids y matriz.resto; sin ellos da la huella de 0.10.8", () => {
    const celdas = [{ genero_id: HOMBRE, mundo_id: FORMAL, pct: 20 }];
    const sinIds = matrizDeCeldas(celdas, [HOMBRE, MUJER]);
    expect(huellaDeMatriz(sinIds, 5)).toBe(huellaCrecimientos(celdas, 5));
    const conIds = { ...sinIds, ids: new Map([[claveGM(HOMBRE, FORMAL), "v1"]]), versiones: new Map([[claveGM(HOMBRE, FORMAL), 1]]), resto: { id: "r1", version: 1 } };
    expect(huellaDeMatriz(conIds, 5)).toBe(huellaCrecimientos([{ ...celdas[0], crecimiento_id: "v1" }], 5, "r1"));
    expect(huellaDeMatriz({ ...conIds, resto: { id: null, version: null } }, 5)).toBe(huellaCrecimientos([{ ...celdas[0], crecimiento_id: "v1" }], 5));
  });

  it("celdasFaltantes lista las obligatorias que no vinieron", () => {
    const pares = [{ genero_id: HOMBRE, mundo_id: FORMAL }, { genero_id: MUJER, mundo_id: FORMAL }];
    expect(celdasFaltantes(pares, new Set([claveGM(HOMBRE, FORMAL)]))).toEqual([pares[1]]);
    expect(celdasFaltantes(pares, new Set(pares.map((p) => claveGM(p.genero_id, p.mundo_id))))).toEqual([]);
  });
});

describe("regla 9: calcularPromedio (ejemplo sintético de §5.2)", () => {
  const ag = (extra: Partial<AgregadoCrecimientoApi>): AgregadoCrecimientoApi => ({
    filas: 1,
    filas_sin_base: 0,
    base: 0,
    base_libre: 0,
    pct_propio: { filas: 0, base: 0, siguiente: 0 },
    decididas: { filas: 0, base: 0, siguiente: 0 },
    base_normalizada: 0,
    rebote_nino_pct: null,
    siguiente_vigente: 0,
    ...extra,
  });
  const libre = (b: number) => ag({ base: b, base_libre: b, base_normalizada: b });
  const celdas = () => [
    // HOMBRE · FORMAL es la celda de §5.3: base 17 800, con una fila con % propio y otra decidida.
    {
      genero: "HOMBRE",
      mundo: "FORMAL",
      pct: 20 as number | null,
      sin_filas: false,
      agregado: ag({ filas: 3, base: 17800, base_libre: 3300, pct_propio: { filas: 1, base: 4500, siguiente: 4725 }, decididas: { filas: 1, base: 10000, siguiente: 10800 } }),
    },
    { genero: "HOMBRE", mundo: "URBANO", pct: 10 as number | null, sin_filas: false, agregado: libre(50000) },
    { genero: "HOMBRE", mundo: "CASUAL", pct: null, sin_filas: true, agregado: ag({ filas: 0 }) },
    { genero: "MUJER", mundo: "CASUAL", pct: 15 as number | null, sin_filas: false, agregado: libre(30000) },
    { genero: "MUJER", mundo: "FORMAL", pct: 0 as number | null, sin_filas: false, agregado: libre(2200) },
    { genero: "MUJER", mundo: "URBANO", pct: null, sin_filas: true, agregado: ag({ filas: 0 }) },
  ];
  const resto = { pct: 5, agregado: libre(20000) };
  const puente = { total_en_curso: 120000, nuevas_anterior: 0, aperturas: 914, cierres: 0, cierres_sin_decidir: 0 };

  it("ponderado escrito 11,7 %, resultante 10,2 % (132 185 u), faltan 2 215 u frente al 12 % y Total 2027 = 133 099", () => {
    const { resultado: r, faltan } = calcularPromedio(celdas(), resto, 12, puente);
    expect(faltan).toEqual([]);
    expect(r).not.toBeNull();
    if (!r) return;
    expect(r.base_total).toBe(120000);
    expect(r.ponderado_escrito_pct).toBeCloseTo(11.7, 1);
    expect(r.siguiente_total).toBeCloseTo(132185, 6);
    expect(r.resultante_pct).toBeCloseTo(10.2, 1);
    expect(r.filas.map((f) => Math.round(f.siguiente))).toEqual([19485, 55000, 34500, 2200, 21000]);
    expect(r.filas[0].pct_resultante).toBeCloseTo(9.5, 1);
    expect(r.filas_con_pct_propio).toBe(1);
    expect(r.filas_decididas).toBe(1);
    expect(r.objetivo).not.toBeNull();
    expect(r.objetivo?.faltan_pp_escrito).toBeCloseTo(0.3, 1);
    expect(r.objetivo?.faltan_pp_resultado).toBeCloseTo(1.8, 1);
    expect(r.objetivo?.faltan_unidades).toBeCloseTo(2215, 6);
    expect(r.puente.total_siguiente).toBeCloseTo(133099, 6);
    expect(r.puente.var_pct).toBeCloseTo((133099 / 120000 - 1) * 100, 6);
    expect(r.sin_base).toBe(false);
  });

  it("con un cierre de 300 u en Y+1 el Total 2027 SUMA 300 (y con cierres sin decidir lo dice el puente)", () => {
    const { resultado: r } = calcularPromedio(celdas(), resto, 12, { ...puente, cierres: 300, cierres_sin_decidir: 1 });
    expect(r?.puente.total_siguiente).toBeCloseTo(133099 + 300, 6);
    expect(r?.puente.cierres).toBe(300);
    expect(r?.puente.cierres_sin_decidir).toBe(1);
  });

  it("con una celda vacía (con filas) devuelve null con la lista de las que faltan; las «sin filas» no cuentan", () => {
    const c = celdas();
    c[1] = { ...c[1], pct: null };
    c[4] = { ...c[4], pct: null };
    const r = calcularPromedio(c, resto, 12, puente);
    expect(r.resultado).toBeNull();
    expect(r.faltan).toEqual([{ genero: "HOMBRE", mundo: "URBANO" }, { genero: "MUJER", mundo: "FORMAL" }]);
  });

  it("sin objetivo no hay comparación; con Σ B = 0 queda «sin base»", () => {
    expect(calcularPromedio(celdas(), resto, null, puente).resultado?.objetivo).toBeNull();
    const vacia = calcularPromedio([], { pct: 5, agregado: ag({ filas: 0 }) }, 12, puente).resultado;
    expect(vacia).toMatchObject({ sin_base: true, ponderado_escrito_pct: null, resultante_pct: null });
    expect(vacia?.objetivo).toMatchObject({ faltan_unidades: null });
  });
});

// ─── calcularProyeccion con celdas ───

const DENIM_REC = clave("denim", AM.rec);
const ABRIGO_REC = clave("abrigo", AM.rec, EQ.parka);
const SANDALIA_VAL = clave("sandalia", AM.val);
const matriz = (celdas: [string, string, number][]) => matrizDeCeldas(celdas.map(([genero_id, mundo_id, pct]) => ({ genero_id, mundo_id, pct })), [HOMBRE, MUJER]);
const fila = (s: SalidaCalculo, c: string): FilaModelo => s.filas.find((f) => f.clave === c) as FilaModelo;
const reg = (s: SalidaCalculo, c: string, anio: number) => registroDe(fila(s, c), anio)!;
const decision = (d: Partial<DecisionPrevia>): DecisionPrevia => ({
  decidido: null,
  origen: null,
  nota: null,
  propuesta_al_decidir: null,
  crecimiento_pct: null,
  decidido_por_nombre: null,
  decidido_at: null,
  meses: null,
  curva_origen_usada: [],
  ...d,
});
const previas = (filas: [string, DecisionPrevia][]): PreviasCalculo => ({ filas: new Map(filas), tiendas: new Map() });

describe("regla 10: calcularProyeccion con celdas", () => {
  // B de DENIM × RECONOCIDO en 2027 = 1 800 + T2 300 − T5 240 = 1 860 (caso 8).
  const base = calcularProyeccion(entrada());

  it("una fila sin decidir de una celda al 12 % da round(B × 1,12); B queda en base_siguiente", () => {
    const s = calcularProyeccion(entrada({ crecimientos: matriz([[HOMBRE, URBANO, 12]]) }));
    expect(reg(s, DENIM_REC, Y + 1)).toMatchObject({ base_siguiente: 1860, propuesto: Math.round(1860 * 1.12), metodo: "crecimiento" });
    expect(reg(s, DENIM_REC, Y + 1).explicacion).toContain("crecimiento bruto de HOMBRE · URBANO");
    // La otra línea de HOMBRE (ABRIGO · CASUAL) no tiene celda: sigue el Resto (5 %).
    expect(reg(s, ABRIGO_REC, Y + 1).explicacion).toContain("crecimiento bruto del Resto");
    expect(reg(s, ABRIGO_REC, Y + 1).propuesto).toBe(Math.round((reg(s, ABRIGO_REC, Y + 1).base_siguiente as number) * 1.05));
  });

  it("una fila con % propio del 5 % da round(B × 1,05) aunque la celda sea del 12 %", () => {
    const s = calcularProyeccion(entrada({ crecimientos: matriz([[HOMBRE, URBANO, 12]]), previas: previas([[`${DENIM_REC}#${Y + 1}`, decision({ crecimiento_pct: 5 })]]) }));
    expect(reg(s, DENIM_REC, Y + 1)).toMatchObject({ propuesto: 1953, crecimiento_pct: 5 });
    expect(reg(s, DENIM_REC, Y + 1).explicacion).toContain("crecimiento bruto propio de la fila");
  });

  it("una fila de un género que no es de la matriz sigue el Resto aunque haya una celda de su mundo", () => {
    const jov = "g-jovencitos";
    const nodosJov: NodoProy[] = nodos().map((n) => (n.gml_id === N.sandalia ? { ...n, genero_id: jov, genero: "JOVENCITOS" } : n));
    const celdas = new Map([[claveGM(jov, MUN.casual), 50], [claveGM(MUJER, MUN.casual), 9]]);
    const s = calcularProyeccion(entrada({ nodos: nodosJov, parametros: { ...entrada().parametros, crecimiento_pct_defecto: 3 }, crecimientos: { celdas, generos: new Set([HOMBRE, MUJER]) } }));
    const r = reg(s, SANDALIA_VAL, Y + 1);
    expect(r.propuesto).toBe(Math.round((r.base_siguiente as number) * 1.03));
    expect(r.explicacion).toContain("del Resto");
    // MIXTA sigue siendo MUJER · CASUAL: toma la celda del 9 %.
    const mixta = reg(s, clave("mixta", AM.rec), Y + 1);
    expect(mixta.propuesto).toBe(Math.round((mixta.base_siguiente as number) * 1.09));
  });

  it("una apertura de Y+1 no cambia por la matriz (va por la venta esperada, 07d)", () => {
    const sin = calcularProyeccion(entrada());
    const con = calcularProyeccion(entrada({ crecimientos: matriz([[HOMBRE, URBANO, 40], [HOMBRE, MUN.casual, 40], [MUJER, MUN.casual, 40]]) }));
    const t4 = (s: SalidaCalculo) => s.tiendas.find((t) => t.tienda_id === "T4" && t.anio === Y + 1);
    expect(t4(con)?.propuesto).toBe(t4(sin)?.propuesto);
    expect(reg(con, claveTienda("T4", "denim", AM.rec), Y + 1).propuesto).toBe(reg(sin, claveTienda("T4", "denim", AM.rec), Y + 1).propuesto);
  });

  it("T3 (abrió en 2026, maduro_propio) toma el % de su GML-AM en bruto: A^b = 480 (φ_Y = 1) × 1,20 = 576, y la explicación cita la celda", () => {
    const s = calcularProyeccion(entrada({ crecimientos: matriz([[HOMBRE, URBANO, 20]]) }));
    const t3 = reg(s, claveTienda("T3", "denim", AM.rec), Y + 1);
    expect(t3).toMatchObject({ propuesto: 576, metodo: "maduro_propio" });
    const tienda = s.tiendas.find((t) => t.tienda_id === "T3" && t.anio === Y + 1)!;
    expect(tienda.explicacion).toContain("× (1 + 20.0 % crecimiento bruto de HOMBRE · URBANO)");
    expect(tienda.explicacion).not.toContain("5.0 %");
    // Con el Resto (sin celda) la explicación cita el Resto.
    expect(base.tiendas.find((t) => t.tienda_id === "T3" && t.anio === Y + 1)?.explicacion).toContain("crecimiento bruto del Resto");
  });

  it("A^b de una tienda con Niño en los meses abiertos: mayor que vigente ÷ Σ c·r y menor que el A normalizado; con φ_Y = 1 coincide con vigente ÷ Σ c·r", () => {
    const rY = rampaMensual("2026-05-01", [1, 1, 1], 2026);
    const phiAbiertos = Array.from({ length: 12 }, (_, i) => (i >= 4 ? 0.66 : 1));
    const vigente = 1000;
    const plano = vigente / sumaCurva(CURVA_INVIERNO, rY, null);
    const ab = maduroDeVigente({ vigente, curva: CURVA_INVIERNO, rampa: rY, phi: phiAbiertos }) as number;
    const normalizado = vigente / 0.66 / sumaCurva(CURVA_INVIERNO, rY, null); // A normalizado = (V ÷ φ) ÷ Σ c r
    expect(ab).toBeGreaterThan(plano);
    expect(ab).toBeLessThan(normalizado);
    const unos = Array(12).fill(1);
    expect(maduroDeVigente({ vigente, curva: CURVA_PLANA, rampa: rY, phi: unos }) as number).toBeCloseTo(vigente / sumaCurva(CURVA_PLANA, rY, null), 8);
  });

  it("recalcular conserva el total decidido de una fila: la propuesta se rehace con el % efectivo y queda propuesta_cambio", () => {
    const s = calcularProyeccion(entrada({ crecimientos: matriz([[HOMBRE, URBANO, 12]]), previas: previas([[`${DENIM_REC}#${Y + 1}`, decision({ decidido: 1953, origen: "manual", propuesta_al_decidir: 1953 })]]) }));
    expect(reg(s, DENIM_REC, Y + 1)).toMatchObject({ decidido: 1953, propuesto: 2083, vigente: 1953 });
    expect(reg(s, DENIM_REC, Y + 1).avisos).toContain("propuesta_cambio");
  });
});

describe("regla 11 y 12: columnas nuevas, huella y gm_gml en el resumen", () => {
  it("|propuesto − B × (1 + g)| ≤ 0,5 en toda fila base de Y+1 y B'' queda guardada", () => {
    const s = calcularProyeccion(entrada({ crecimientos: matriz([[HOMBRE, URBANO, 12], [HOMBRE, MUN.casual, -10], [MUJER, MUN.casual, 33]]) }));
    const gs: Record<string, number> = { [DENIM_REC]: 12, [ABRIGO_REC]: -10, [SANDALIA_VAL]: 33, [clave("mixta", AM.rec)]: 33 };
    for (const [c, g] of Object.entries(gs)) {
      const r = reg(s, c, Y + 1);
      expect(Math.abs((r.propuesto as number) - (r.base_siguiente as number) * (1 + g / 100)), c).toBeLessThanOrEqual(0.5);
      expect(r.base_normalizada, c).not.toBeNull();
    }
    // La fila de ABRIGO (invierno, Niño 2026 a 0,66): B'' = B ÷ 0,66.
    const ab = reg(s, ABRIGO_REC, Y + 1);
    expect(ab.base_normalizada as number).toBeCloseTo((ab.base_siguiente as number) / 0.66, 0);
    // El resto de los registros (Y, aperturas, tiendas) no llevan B.
    expect(reg(s, DENIM_REC, Y).base_siguiente).toBeNull();
    expect(reg(s, claveTienda("T4", "denim", AM.rec), Y + 1).base_siguiente).toBeNull();
  });

  it("sin base o sin curva, base_siguiente y base_normalizada son null", () => {
    const sinCurva = calcularProyeccion(entrada({ vigentes: entrada().vigentes.filter((v) => v.agrupacion_id !== "a-denim-ho") }));
    expect(reg(sinCurva, DENIM_REC, Y + 1)).toMatchObject({ propuesto: null, base_siguiente: null, base_normalizada: null });
  });

  it("el resumen trae la huella de la matriz y el GM de cada nodo con filas base", () => {
    const m = matriz([[HOMBRE, URBANO, 12]]);
    const s = calcularProyeccion(entrada({ crecimientos: m }));
    expect(s.resumen.huella_crecimientos).toBe(huellaDeMatriz(m, 5));
    expect(s.resumen.gm_gml).toMatchObject({ [N.denim]: claveGM(HOMBRE, URBANO), [N.abrigo]: claveGM(HOMBRE, MUN.casual), [N.sandalia]: claveGM(MUJER, MUN.casual) });
    expect(s.resumen.version_metodo).toBe(4);
    // Otra matriz u otro Resto → otra huella.
    expect(calcularProyeccion(entrada()).resumen.huella_crecimientos).not.toBe(s.resumen.huella_crecimientos);
  });
});

describe("explicación de una tienda maduro_propio: % efectivo único o ponderado (07c §2.4)", () => {
  // Dos filas de la tienda T7 que abrió en 2026: vigente 2026 de 480 (HOMBRE · URBANO, A^b = 960) y de 120 (MUJER · CASUAL, A^b = 240).
  const fila = (gml: string, vigente: number): FilaModelo =>
    ({
      clave: `T7|${gml}||${AM.rec}`,
      tienda_id: "T7",
      curva: CURVA_PLANA,
      factores_mes: null,
      registros: [
        { anio: Y, vigente, metodo: "avance_propio" },
        { anio: Y + 1, vigente: 0, metodo: "maduro_propio" },
      ],
    }) as unknown as FilaModelo;
  const info = { codigo: "T7", nombre: "Tienda T7", fecha_apertura: "2026-07-01", fecha_cierre: null, venta_esperada: null, referente_codigo: null };
  const ctxCon = (celdas: [string, string, number][]) =>
    ({
      anio: Y,
      k: 9,
      crecimiento_pct_defecto: 5,
      rampa_maduracion: [1, 1, 1],
      crecimientoDe: crearCrecimientoDe({
        matriz: matriz(celdas),
        resto: 5,
        gmDe: (gml) => (gml === N.denim ? { genero_id: HOMBRE, mundo_id: URBANO, nombre: "HOMBRE · URBANO" } : { genero_id: MUJER, mundo_id: MUN.casual, nombre: "MUJER · CASUAL" }),
      }),
    }) as unknown as ContextoModelo;
  const filas = [fila(N.denim, 480), fila(N.sandalia, 120)];

  it("si todas las filas comparten el mismo % y origen, se muestra ese; si no, el ponderado Σ w g ÷ Σ w", () => {
    const igual = crecimientoDeTienda(filas, Y + 1, info, null, ctxCon([[HOMBRE, URBANO, 20], [MUJER, MUN.casual, 20]]));
    expect(igual).toMatchObject({ pct: 20, origen: "celda", ponderado: false });
    const distinto = crecimientoDeTienda(filas, Y + 1, info, null, ctxCon([[HOMBRE, URBANO, 20], [MUJER, MUN.casual, 10]]));
    expect(distinto?.ponderado).toBe(true);
    // w ∝ A^b × Σ_{Y+1} c r = 960 y 240 → (960 × 20 + 240 × 10) ÷ 1 200 = 18.
    expect(distinto?.pct).toBeCloseTo(18, 6);
    // Sin ninguna fila maduro_propio no hay % que explicar.
    expect(crecimientoDeTienda([], Y + 1, info, null, ctxCon([]))).toBeNull();
  });
});

describe("explicación del año siguiente: la cuenta de la frase se reproduce", () => {
  const frase = (crecimiento: number, propuesto: number) =>
    explicar({
      metodo: "crecimiento",
      anio: Y + 1,
      anioEnCurso: Y,
      k: 0,
      vendido: 0,
      propuesto,
      curvaTexto: "DENIM HO v1",
      baseVigente: 1860,
      baseTotal: 1860,
      crecimiento,
      crecimientoOrigen: { origen: "resto", celda: null },
    });

  it("g = 7,5 % sobre B = 1 860 muestra «× (1 + 7.5 %)» y no un factor redondeado a «1.08» (que daría 2,009 y no 2,000)", () => {
    const t = frase(7.5, 2000);
    expect(t).toContain("× (1 + 7.5 % crecimiento bruto del Resto, sin corregir por el Niño) = 2,000");
    expect(t).not.toContain("× 1.08");
    expect(Math.round(1860 * (1 + 7.5 / 100))).toBe(2000);
  });

  it("un % entero se lee con un decimal y uno con dos decimales no pierde el segundo", () => {
    expect(frase(5, 1953)).toContain("× (1 + 5.0 % crecimiento bruto del Resto");
    expect(frase(7.25, 1995)).toContain("× (1 + 7.25 % crecimiento bruto del Resto");
  });
});
