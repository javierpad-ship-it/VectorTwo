import { VERSION_METODO } from "@/lib/proyeccion/tipos-api";
import { describe, expect, it } from "vitest";
import {
  aplicarCurvaNueva,
  aplicarDecision,
  aplicarDecisionTienda,
  calcularProyeccion,
  recalcularBaseSiguiente,
  registroDe,
  type ContextoModelo,
} from "@/lib/proyeccion/modelo";
import type { DecisionPrevia, DecisionTiendaPrevia, FilaModelo, PreviasCalculo, SalidaCalculo } from "@/lib/proyeccion/tipos";
import {
  AG,
  AM,
  CURVA_PLANA,
  EQ,
  K,
  N,
  Y,
  clave,
  claveTienda,
  construirVenta,
  entrada,
  hechosBase,
  serie,
  tiendas,
  vigentes,
  type Hecho,
} from "./proyeccion.fixture";

const fila = (s: SalidaCalculo, c: string): FilaModelo => {
  const f = s.filas.find((x) => x.clave === c);
  if (!f) throw new Error(`No existe la fila ${c}`);
  return f;
};
const reg = (s: SalidaCalculo, c: string, anio: number) => {
  const r = registroDe(fila(s, c), anio);
  if (!r) throw new Error(`Sin registro ${anio} en ${c}`);
  return r;
};
const suma = (x: readonly number[] | null) => (x ?? []).reduce((a, b) => a + b, 0);

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
const decisionTienda = (d: Partial<DecisionTiendaPrevia>): DecisionTiendaPrevia => ({
  decidido: null,
  origen: null,
  nota: null,
  propuesta_al_decidir: null,
  rampa: null,
  decidido_por_nombre: null,
  decidido_at: null,
  ...d,
});
const previas = (filas: [string, DecisionPrevia][] = [], tiendasP: [string, DecisionTiendaPrevia][] = []): PreviasCalculo => ({ filas: new Map(filas), tiendas: new Map(tiendasP) });

const DENIM_REC = clave("denim", AM.rec);

describe("partición de los hechos (caso 2; regla 40)", () => {
  const s = calcularProyeccion(entrada());

  it("filas base: un hecho en el nodo GML cae en (DENIM, null, agrupación); en ABRIGO la fila lleva la equivalencia PARKA", () => {
    expect(s.filas.find((f) => f.clave === DENIM_REC)?.equivalencia_id).toBeNull();
    expect(s.filas.find((f) => f.clave === clave("denim", AM.pre))).toBeDefined();
    const abrigo = fila(s, clave("abrigo", AM.rec, EQ.parka));
    expect(abrigo.equivalencia_id).toBe(EQ.parka);
    expect(abrigo.nivel).toBe("GMLE");
  });

  it("Σ vendido de las filas base y de tienda de 2026 = Σ hechos de 2026 hasta k sin el CD; nada fuera de bloque", () => {
    const real = hechosBase()
      .filter((h) => h.tienda !== "CD" && h.periodo >= "2026-01" && h.periodo <= "2026-09")
      .reduce((a, h) => a + h.unidades, 0);
    const vendido = s.filas.reduce((a, f) => a + (registroDe(f, Y)?.vendido ?? 0), 0);
    expect(vendido).toBe(real);
    expect(s.resumen.fuera_bloque).toBe(0);
  });

  it("el CD no aparece en ninguna fila ni en el vendido", () => {
    expect(s.filas.some((f) => f.tienda_id === "CD")).toBe(false);
    expect(s.claves.CD).toBeUndefined();
  });

  it("es determinista: dos cálculos con la misma entrada dan lo mismo y nunca usan meses posteriores a k", () => {
    expect(JSON.stringify(calcularProyeccion(entrada()))).toBe(JSON.stringify(s));
    // Con hechos de octubre en la lectura, el resultado con k = 9 es el mismo que sin ellos.
    const conOctubre = [...hechosBase(), ...serie({ tienda: "T1", nodo: "denim", eq: EQ.skinny, agm: AM.rec, marca: "m-alfa" }, "2026-10", "2026-10", () => 999)];
    const e = entrada({ hechos: conOctubre });
    expect(JSON.stringify(calcularProyeccion(e).filas.map((f) => f.registros))).toBe(JSON.stringify(s.filas.map((f) => f.registros)));
  });
});

describe("cierre y año siguiente (casos 3 a 7)", () => {
  it("caso 3: DENIM × RECONOCIDO V = 1 350, C_9 = 0,75, P = 1 800, resto 150/150/150, explicación con las cifras", () => {
    const s = calcularProyeccion(entrada());
    const r = reg(s, DENIM_REC, Y);
    expect(r).toMatchObject({ vendido: 1350, propuesto: 1800, metodo: "avance", vigente: 1800 });
    expect(r.avance).toBeCloseTo(0.75, 10);
    expect(r.meses?.slice(9)).toEqual([150, 150, 150]);
    expect(r.origen_meses?.slice(0, 9).every((o) => o === "real")).toBe(true);
    expect(r.origen_meses?.slice(9)).toEqual(["proyectado", "proyectado", "proyectado"]);
    for (const trozo of ["1,350", "75.0 %", "DENIM HO v1", "1,800"]) expect(r.explicacion).toContain(trozo);
    expect(fila(s, DENIM_REC).curva_origen).toEqual([{ agrupacion_id: AG.denim, curva_id: "c-denim-v1", version: 1, peso: 1 }]);
  });

  it("caso 4 (método 5): Niño de invierno en ABRIGO — el cierre no cambia (1 000) y el % es sobre 2026 corregido: B' = 1 000 ÷ 0,66 = 1 515, 2027 = 1 515 × 1,03 = 1 561 (el método 4 daba 1 030)", () => {
    const e = entrada({ parametros: { crecimiento_pct_defecto: 3, umbral_avance: 0.3, umbral_cobertura: 0.25, umbral_cola_larga: 100, umbral_disponibilidad: 0.75, rampa_maduracion: [1, 1, 1] } });
    const s = calcularProyeccion(e);
    const c = clave("abrigo", AM.rec, EQ.parka);
    expect(reg(s, c, Y)).toMatchObject({ vendido: 940, propuesto: 1000 });
    expect(reg(s, c, Y).meses?.slice(9)).toEqual([20, 20, 20]);
    expect(reg(s, c, Y + 1).propuesto).toBe(1561);
    // `B` = 1 000 real; `B'` = 1 000 ÷ 0,66 = 1 515,15 (la base del %: P = round(B' × 1,03)); sobre 2026 real son +56,1 %.
    expect(reg(s, c, Y + 1).base_siguiente).toBe(1000);
    expect(reg(s, c, Y + 1).base_normalizada).toBeCloseTo(1515.15, 2);
    expect(reg(s, c, Y + 1).explicacion).toContain("corregida del Niño de invierno (÷ 0.66, relativo) = 1,515");
    expect(reg(s, c, Y + 1).explicacion).toContain("sobre 2026 corregido) = 1,561 (56.1 % sobre 2026 real)");

    const sin = calcularProyeccion({ ...e, factores: [] });
    expect(reg(sin, c, Y).propuesto).toBe(1000);
    expect(reg(sin, c, Y + 1).propuesto).toBe(1030);
    expect(fila(sin, c).avisos).toContain("sin_factor");
  });

  it("caso 5: Niño de verano en SANDALIA — setiembre ÷ 1,24 antes del avance, oct–dic × 1,24; 2027 sin factor", () => {
    const s = calcularProyeccion(entrada());
    const c = clave("sandalia", AM.val);
    const r = reg(s, c, Y);
    const vNorm = 480 + 100;
    expect(r.vendido).toBe(604);
    expect(r.propuesto).toBe(604 + Math.round((vNorm / 0.56) * 0.44 * 1.24));
    expect(r.explicacion).toContain("÷ 1.24");
    expect(fila(s, c).factores_mes?.[Y + 1]).toEqual(Array(12).fill(1));
    // Base de 2027: lo vigente de 2026 normalizado mes a mes (setiembre ÷ 1,24, oct–dic ÷ 1,24) × 1,05.
    expect(reg(s, c, Y + 1).propuesto).toBeGreaterThan(0);
  });

  it("caso 6: poco avance (k = 2) con la cerrada de 2025: propuesto = plan; sin cerrada, avance_bajo", () => {
    const plan = { nombre: "Proyección 2025–2026", totales: new Map([[clave("sandalia", AM.val), 1200]]) };
    const s = calcularProyeccion(entrada({ k: 2, planAnterior: plan }));
    const r = reg(s, clave("sandalia", AM.val), Y);
    expect(r).toMatchObject({ propuesto: 1200, metodo: "plan_anterior", referencia_alternativa: 1125, vendido: 260 });
    // El avance de referencia incluye el factor del verano de 2026: 260 ÷ 0,26 = 1 000, y oct–dic y setiembre × 1,24 → 1 125.
    expect(r.explicacion).toContain("Proyección 2025–2026");
    const sin = calcularProyeccion(entrada({ k: 2 }));
    const r2 = reg(sin, clave("sandalia", AM.val), Y);
    expect(r2).toMatchObject({ propuesto: 1125, metodo: "avance" });
    expect(r2.avisos).toContain("avance_bajo");
  });

  it("caso 7: sin curva vigente — propuesta nula, meses nulos y sin_curva; decidir a mano deja los meses vacíos", () => {
    const sinCurva = vigentes().filter((v) => v.agrupacion_id !== AG.denim);
    const s = calcularProyeccion(entrada({ vigentes: sinCurva }));
    const r = reg(s, DENIM_REC, Y);
    expect(r).toMatchObject({ propuesto: null, meses: null, metodo: "sin_propuesta" });
    expect(r.avisos).toContain("sin_curva");
    const d = calcularProyeccion(entrada({ vigentes: sinCurva, previas: previas([[`${DENIM_REC}#${Y}`, decision({ decidido: 1800, origen: "manual" })]]) }));
    expect(reg(d, DENIM_REC, Y)).toMatchObject({ decidido: 1800, vigente: 1800, meses: null });
  });
});

describe("año siguiente con tiendas nuevas que pasan a mismas (caso 8, B2)", () => {
  const sinDecisiones = calcularProyeccion(entrada());

  it("B = 1 800 + T2 (300, avance propio) − T5 (240) = 1 860; g = 5 % → 1 953", () => {
    const t2 = reg(sinDecisiones, claveTienda("T2", "denim", AM.rec), Y);
    expect(t2).toMatchObject({ vendido: 225, propuesto: 300, metodo: "avance_propio" });
    expect(reg(sinDecisiones, DENIM_REC, Y + 1).propuesto).toBe(1953);
    expect(reg(sinDecisiones, DENIM_REC, Y + 1).metodo).toBe("crecimiento");
  });

  it("cambiar la decisión de 2026 de la fila base a 1 900 → B = 1 960 → 2 058", () => {
    const s = calcularProyeccion(entrada({ previas: previas([[`${DENIM_REC}#${Y}`, decision({ decidido: 1900, origen: "manual", propuesta_al_decidir: 1800 })]]) }));
    expect(reg(s, DENIM_REC, Y).vigente).toBe(1900);
    expect(reg(s, DENIM_REC, Y + 1).propuesto).toBe(2058);
  });

  it("decidir la tienda nueva T2 = 400 (fila base en 1 800) → B = 1 960 → 2 058, y sin releer venta con aplicarDecisionTienda", () => {
    const s = calcularProyeccion(entrada({ previas: previas([], [[`T2#${Y}`, decisionTienda({ decidido: 400, origen: "manual", propuesta_al_decidir: 300 })]]) }));
    expect(reg(s, claveTienda("T2", "denim", AM.rec), Y)).toMatchObject({ vigente: 400, origen: "escalada" });
    expect(reg(s, DENIM_REC, Y + 1).propuesto).toBe(2058);

    // En vivo: la misma decisión aplicada sobre lo guardado (sin leer venta).
    const ctx = contextoDe(sinDecisiones);
    const filasT2 = sinDecisiones.filas.filter((f) => f.tienda_id === "T2");
    const r = aplicarDecisionTienda({ filas: filasT2, tiendaId: "T2", anio: Y, decision: { decidido: 400, origen: "manual" }, ctx });
    expect(r.clavesBaseAfectadas).toContain(DENIM_REC);
    expect(r.filas_base_recalculadas).toBeGreaterThan(0);
    const tiendasDeLaFila = [...sinDecisiones.filas.filter((f) => f.tienda_id !== null && f.tienda_id !== "T2"), ...r.filas].filter((f) => f.clave.endsWith(DENIM_REC.slice(1)));
    const nueva = recalcularBaseSiguiente(fila(sinDecisiones, DENIM_REC), tiendasDeLaFila, ctx);
    expect(registroDe(nueva, Y + 1)?.propuesto).toBe(2058);
  });

  it("si la fila base de 2027 ya estaba decidida en 1 953, conserva su decisión y queda con propuesta_cambio", () => {
    const s = calcularProyeccion(
      entrada({
        previas: previas(
          [[`${DENIM_REC}#${Y + 1}`, decision({ decidido: 1953, origen: "propuesta", propuesta_al_decidir: 1953 })]],
          [[`T2#${Y}`, decisionTienda({ decidido: 400, origen: "manual", propuesta_al_decidir: 300 })]]
        ),
      })
    );
    const r = reg(s, DENIM_REC, Y + 1);
    expect(r).toMatchObject({ decidido: 1953, propuesto: 2058, vigente: 1953 });
    expect(r.avisos).toContain("propuesta_cambio");
  });

  it("aplicarDecision sobre la fila base de 2026 recalcula la propuesta de 2027 de esa fila (regla 41)", () => {
    const ctx = contextoDe(sinDecisiones);
    const base = fila(sinDecisiones, DENIM_REC);
    const tiendasFila = sinDecisiones.filas.filter((f) => f.tienda_id !== null && f.clave.endsWith(DENIM_REC.slice(1)));
    const nueva = aplicarDecision(base, tiendasFila, Y, { decidido: 1900, origen: "manual", nota: "Sube por Fiestas" }, ctx);
    expect(registroDe(nueva, Y)).toMatchObject({ decidido: 1900, origen: "manual", nota: "Sube por Fiestas", propuesto: 1800 });
    expect(suma(registroDe(nueva, Y)?.meses ?? null)).toBe(1900);
    expect(registroDe(nueva, Y + 1)?.propuesto).toBe(2058);
    // No cambia ni el histórico ni la curva.
    expect(nueva.historico).toBe(base.historico);
    expect(nueva.curva).toBe(base.curva);
    // Aceptar la propuesta copia `propuesto`; null vuelve a la propuesta.
    const acepta = aplicarDecision(base, tiendasFila, Y, { decidido: 5, origen: "propuesta" }, ctx);
    expect(registroDe(acepta, Y)).toMatchObject({ decidido: 1800, origen: "propuesta" });
    const vuelve = aplicarDecision(nueva, tiendasFila, Y, { decidido: null, origen: "manual" }, ctx);
    expect(registroDe(vuelve, Y)).toMatchObject({ decidido: null, origen: null, vigente: 1800 });
    expect(registroDe(vuelve, Y + 1)?.propuesto).toBe(1953);
  });

  it("T2 sin decidir: la fila base de 2027 depende de ella y T2 figura entre las tiendas que pasan a mismas", () => {
    expect(sinDecisiones.bloques[Y + 1].mismas.map((t) => t.codigo)).toContain("T2");
    expect(sinDecisiones.tiendas.find((t) => t.tienda_id === "T2" && t.anio === Y)).toMatchObject({ decidido: null, propuesto: 300, bloque: "nuevas", subbloque: "nuevas_anterior" });
  });
});

describe("tiendas nuevas por venta esperada (caso 9)", () => {
  // T1 es el referente: DENIM × RECONOCIDO 70 % de los soles a S/ 100 y ABRIGO × RECONOCIDO 30 % a S/ 200, con el
  // invierno de 2026 ÷ 0,66.
  const a = (3 / 14) * 100;
  const hechosT1 = (): Hecho[] => [
    ...serie({ tienda: "T1", nodo: "denim", eq: EQ.skinny, agm: AM.rec, marca: "m-alfa" }, "2023-01", "2026-09", () => 100),
    ...serie({ tienda: "T1", nodo: "abrigo", eq: EQ.parka, agm: AM.rec, marca: "m-alfa", precio: 200 }, "2023-01", "2026-09", (an, m) => (an === 2026 && m <= 9 ? a * 0.66 : a)),
  ];
  const T4 = (extra: Record<string, unknown> = {}) => ({ T4: { rampa: [0.7, 0.85, 1], ...extra } });

  it("con rampa explícita [0,7; 0,85; 1] (V = 85 000 al mes): DENIM 5 494 + ABRIGO 1 385 = 6 879; en soles ≈ E = 826 355", () => {
    const s = calcularProyeccion(entrada({ hechos: hechosT1(), tiendasExtra: T4() }));
    const d = reg(s, claveTienda("T4", "denim", AM.rec), Y + 1);
    const ab = reg(s, claveTienda("T4", "abrigo", AM.rec, EQ.parka), Y + 1);
    // Md_f = 12 V s̃_f ÷ p_f: 12 × 85 000 × 0,7 ÷ 100 = 7 140 y 12 × 85 000 × 0,3 ÷ 200 = 1 530; no dependen de la rampa.
    expect(fila(s, claveTienda("T4", "denim", AM.rec)).composicion?.unidades_maduras).toBeCloseTo(7140, 1);
    expect(fila(s, claveTienda("T4", "abrigo", AM.rec, EQ.parka)).composicion?.unidades_maduras).toBeCloseTo(1530, 1);
    expect([d.propuesto, ab.propuesto]).toEqual([5494, 1385]);
    const t = s.tiendas.find((x) => x.tienda_id === "T4" && x.anio === Y + 1)!;
    expect(t).toMatchObject({ propuesto: 6879, metodo: "apertura", origen_composicion: "referente", unidades_maduras: 8670 });
    expect(t.rampa).toEqual([0.7, 0.85, 1]);
    // Propiedad: Σ_f P_f × p_f = 12 V F ± Σ_f p_f ÷ 2 (aquí p = 100 y 200); E = 826 355.
    const soles = (d.propuesto as number) * 100 + (ab.propuesto as number) * 200;
    expect(Math.abs(soles - 826355)).toBeLessThanOrEqual((100 + 200) / 2);
    // La explicación dice la venta mensual, el año maduro S = 12 V, la fracción del año y los soles del año de apertura.
    expect(t.explicacion).toContain("venta esperada S/ 85,000 al mes en régimen (sin IGV) × 12 = año maduro S/ 1,020,000");
    expect(t.explicacion).toContain("abre el 15 de marzo: en 2027 vende el 81.0 % de un año (S/ 826,355)");
    expect(t.explicacion).toContain("año maduro 8,670 u");
    expect(t.explicacion).toContain("rampa 0.70 · 0.85 · 1.00");
    expect(t.explicacion).not.toContain("su año de apertura");
    // Ya no hay aviso de canibalización aunque T4 comparte zona con T1 (regla 45): la zona es solo una etiqueta.
    expect(t.avisos).not.toContain("canibalizacion" as never);
    expect(t.avisos).not.toContain("apertura_tardia");
  });

  it("con la rampa por defecto [1, 1, 1] (07d §5): F = 0,83686, S = 1 020 000; DENIM 5 681 + ABRIGO 1 427 = 7 108 (el método 3 daba 708 con la misma cifra)", () => {
    const s = calcularProyeccion(entrada({ hechos: hechosT1() }));
    const t = s.tiendas.find((x) => x.tienda_id === "T4" && x.anio === Y + 1)!;
    expect(fila(s, claveTienda("T4", "denim", AM.rec)).composicion?.unidades_maduras).toBeCloseTo(7140, 1);
    expect(fila(s, claveTienda("T4", "abrigo", AM.rec, EQ.parka)).composicion?.unidades_maduras).toBeCloseTo(1530, 1);
    expect(reg(s, claveTienda("T4", "denim", AM.rec), Y + 1).propuesto).toBe(5681);
    expect(reg(s, claveTienda("T4", "abrigo", AM.rec, EQ.parka), Y + 1).propuesto).toBe(1427);
    expect(t.propuesto).toBe(7108);
    expect(t.explicacion).toContain("83.7 %");
    expect(t.explicacion).toContain("año maduro S/ 1,020,000");
    expect(t.explicacion).toContain("(S/ 853,597)");
    // Σ de las filas = propuesta de la tienda; la explicación nombra al referente y la rampa.
    expect(t.explicacion).toContain("T1");
    expect(t.explicacion).toContain("sin rampa");
  });

  it("regla 4 (07d): abre el 1 de enero sin rampa → F = 1 y P_f = round(12 V s̃_f ÷ p_f)", () => {
    const s = calcularProyeccion(entrada({ hechos: hechosT1(), tiendasExtra: { T4: { fecha_apertura: "2027-01-01", venta_esperada: 85000 } } }));
    // 12 × 85 000 × 0,7 ÷ 100 = 7 140 u; 12 × 85 000 × 0,3 ÷ 200 = 1 530 u (año completo: A_f = 1).
    expect(reg(s, claveTienda("T4", "denim", AM.rec), Y + 1).propuesto).toBe(7140);
    expect(reg(s, claveTienda("T4", "abrigo", AM.rec, EQ.parka), Y + 1).propuesto).toBe(1530);
  });

  it("regla 6 (07d): abre el 2027-11-01 (F < 0,25) → aviso apertura_tardia, informativo; 1 251 u con E = 131 240 (el método 3 daba 811, más que abriendo en marzo)", () => {
    const s = calcularProyeccion(entrada({ hechos: hechosT1(), tiendasExtra: { T4: { fecha_apertura: "2027-11-01" } } }));
    const t = s.tiendas.find((x) => x.tienda_id === "T4" && x.anio === Y + 1)!;
    expect(t.avisos).toContain("apertura_tardia");
    expect(reg(s, claveTienda("T4", "denim", AM.rec), Y + 1).propuesto).toBe(1190);
    expect(reg(s, claveTienda("T4", "abrigo", AM.rec, EQ.parka), Y + 1).propuesto).toBe(61);
    expect(t.propuesto).toBe(1251);
    // E = 12 V F = 131 240 (a ± Σ p ÷ 2 de las filas).
    const soles = (reg(s, claveTienda("T4", "denim", AM.rec), Y + 1).propuesto as number) * 100 + (reg(s, claveTienda("T4", "abrigo", AM.rec, EQ.parka), Y + 1).propuesto as number) * 200;
    expect(Math.abs(soles - 131240)).toBeLessThanOrEqual(150);
    expect(t.explicacion).toContain("(S/ 131,240)");
  });

  it("sin referente: composición promedio de las mismas tiendas de 2027 (origen red, igual peso por tienda)", () => {
    const t6 = serie({ tienda: "T6", nodo: "denim", eq: EQ.skinny, agm: AM.rec, marca: "m-alfa" }, "2025-01", "2026-09", () => 100);
    const s = calcularProyeccion(entrada({ hechos: [...hechosT1(), ...t6], tiendasExtra: { T4: { referente_id: null } } }));
    const t = s.tiendas.find((x) => x.tienda_id === "T4" && x.anio === Y + 1)!;
    expect(t.origen_composicion).toBe("red");
    expect(t.avisos).toContain("sin_referente");
    // T1: 70/30; T6: 100/0 → promedio 85/15; precio agregado de la red.
    const dMd = fila(s, claveTienda("T4", "denim", AM.rec)).composicion;
    expect(dMd?.s).toBeCloseTo(0.85, 6);
    expect(fila(s, claveTienda("T4", "abrigo", AM.rec, EQ.parka)).composicion?.s).toBeCloseTo(0.15, 6);
  });

  it("referente sin doce meses cerrados: referente_sin_historia y composición promedio", () => {
    const corto = hechosT1().filter((h) => h.periodo >= "2026-04");
    const s = calcularProyeccion(entrada({ hechos: corto }));
    const t = s.tiendas.find((x) => x.tienda_id === "T4" && x.anio === Y + 1)!;
    expect(t.avisos).toContain("referente_sin_historia");
    expect(t.origen_composicion).toBe("red");
  });

  it("sin venta esperada: propuesta nula y sin_venta_esperada; el total decidido se reparte igual con la composición", () => {
    const s = calcularProyeccion(entrada({ hechos: hechosT1(), tiendasExtra: { T4: { venta_esperada: null } } }));
    const t = s.tiendas.find((x) => x.tienda_id === "T4" && x.anio === Y + 1)!;
    expect(t.propuesto).toBeNull();
    expect(t.avisos).toContain("sin_venta_esperada");
  });

  it("decidir 6 000 para T4 → filas escaladas con Σ = 6 000; fijar DENIM = 5 000 → ABRIGO = 1 000", () => {
    const cd = claveTienda("T4", "denim", AM.rec);
    const ca = claveTienda("T4", "abrigo", AM.rec, EQ.parka);
    const e = (filas: [string, DecisionPrevia][] = []) =>
      entrada({ hechos: hechosT1(), previas: previas(filas, [[`T4#${Y + 1}`, decisionTienda({ decidido: 6000, origen: "manual", propuesta_al_decidir: 7108 })]]) });
    const s = calcularProyeccion(e());
    expect(reg(s, cd, Y + 1).vigente! + reg(s, ca, Y + 1).vigente!).toBe(6000);
    const t = s.tiendas.find((x) => x.tienda_id === "T4" && x.anio === Y + 1)!;
    expect(t).toMatchObject({ decidido: 6000, propuesto: 7108, propuesta_al_decidir: 7108 });
    const fijada = calcularProyeccion(e([[`${cd}#${Y + 1}`, decision({ decidido: 5000, origen: "manual", propuesta_al_decidir: 5681 })]]));
    expect([reg(fijada, cd, Y + 1).vigente, reg(fijada, ca, Y + 1).vigente]).toEqual([5000, 1000]);
    expect(reg(fijada, cd, Y + 1).origen).toBe("manual");
    expect(reg(fijada, ca, Y + 1).origen).toBe("escalada");
  });
});

describe("tienda que abre en el año en curso (casos 10 y 11)", () => {
  it("caso 10: T3 abre el 2026-07-01 → n = 3, avance_propio: V = 120, A = 480, total 240; 2027 = 504 (maduro_propio)", () => {
    const s = calcularProyeccion(entrada());
    const c = claveTienda("T3", "denim", AM.rec);
    expect(reg(s, c, Y)).toMatchObject({ vendido: 120, propuesto: 240, metodo: "avance_propio", referencia_tres_meses: 480 });
    expect(reg(s, c, Y + 1)).toMatchObject({ propuesto: 504, metodo: "maduro_propio", subbloque: "nuevas_anterior" });
  });

  it("caso 10: decidir T3 de 2026 = 300 → A = 600 → 2027 = 630", () => {
    const s = calcularProyeccion(entrada({ previas: previas([], [[`T3#${Y}`, decisionTienda({ decidido: 300, origen: "manual", propuesta_al_decidir: 240 })]]) }));
    const c = claveTienda("T3", "denim", AM.rec);
    expect(reg(s, c, Y).vigente).toBe(300);
    expect(reg(s, c, Y + 1).propuesto).toBe(630);
  });

  it("caso 10: si abriera el 2026-08-15, n = 1 → apertura desde octubre con venta esperada", () => {
    const sinT3 = hechosBase().filter((h) => h.tienda !== "T3");
    const t3 = [
      ...serie({ tienda: "T3", nodo: "denim", eq: EQ.skinny, agm: AM.rec, marca: "m-alfa" }, "2026-08", "2026-08", () => 20),
      ...serie({ tienda: "T3", nodo: "denim", eq: EQ.skinny, agm: AM.rec, marca: "m-alfa" }, "2026-09", "2026-09", () => 40),
    ];
    const s = calcularProyeccion(entrada({ hechos: [...sinT3, ...t3], tiendasExtra: { T3: { fecha_apertura: "2026-08-15", venta_esperada: 30000, referente_id: "T1" } } }));
    const r = reg(s, claveTienda("T3", "denim", AM.rec), Y);
    expect(r.metodo).toBe("apertura");
    expect(r.vendido).toBe(60);
    expect(s.tiendas.find((t) => t.tienda_id === "T3" && t.anio === Y)?.metodo).toBe("apertura");
  });

  it("caso 11: T9 abre el 2026-03-01 con rampa [0,70; 0,85; 1] → A = 916, total 729; con [1, 1, 1] → 714", () => {
    const c = claveTienda("T9", "denim", AM.rec);
    const con = calcularProyeccion(entrada({ tiendasExtra: { T9: { rampa: [0.7, 0.85, 1] } } }));
    expect(reg(con, c, Y)).toMatchObject({ vendido: 500, propuesto: 729, metodo: "avance_propio" });
    expect(reg(calcularProyeccion(entrada()), c, Y).propuesto).toBe(714);
  });
});

describe("cierres de tienda (caso 12)", () => {
  const s = calcularProyeccion(entrada());

  it("T7 (cierra el 2026-06-30 ≤ k): solo el real; propuesto = vendido; metodo = cierre", () => {
    const r = reg(s, claveTienda("T7", "denim", AM.rec), Y);
    expect(r).toMatchObject({ vendido: 60, propuesto: 60, metodo: "cierre", bloque: "cierres" });
    expect(r.avisos).not.toContain("cierre_no_proyectado");
    expect(r.meses?.slice(6)).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it("T5 (cierra el 2027-06-30): en 2027 propuesto = 0 y cierre_no_proyectado; sigue en mismas de 2026", () => {
    const r = reg(s, claveTienda("T5", "denim", AM.rec), Y + 1);
    expect(r).toMatchObject({ propuesto: 0, metodo: "cierre", bloque: "cierres" });
    expect(s.tiendas.find((t) => t.tienda_id === "T5" && t.anio === Y + 1)?.avisos).toContain("cierre_no_proyectado");
    expect(registroDe(fila(s, claveTienda("T5", "denim", AM.rec)), Y)).toBeUndefined();
  });
});

describe("la curva cambió y la propuesta cambió (casos 15 y 16)", () => {
  const v1 = [{ agrupacion_id: AG.denim, curva_id: "c-denim-v1", version: 1, peso: 1 }];
  const curvaV2 = [0.07, 0.07, 0.07, 0.08, 0.08, 0.09, 0.09, 0.09, 0.09, 0.08, 0.09, 0.1];
  const vigentesV2 = () => vigentes().map((v) => (v.agrupacion_id === AG.denim ? { ...v, curva_id: "c-denim-v2", version: 2, curva: curvaV2 } : v));

  it("caso 15: el registro decidido conserva meses y curva v1 y recibe meses_propuestos con v2; aplicar copia el reparto nuevo", () => {
    const previa = decision({ decidido: 1800, origen: "manual", propuesta_al_decidir: 1800, meses: [...Array(9).fill(150), 150, 150, 150], curva_origen_usada: v1 });
    const s = calcularProyeccion(entrada({ vigentes: vigentesV2(), previas: previas([[`${DENIM_REC}#${Y}`, previa]]) }));
    const r = reg(s, DENIM_REC, Y);
    expect(r.decidido).toBe(1800);
    expect(r.meses?.slice(9)).toEqual([150, 150, 150]);
    expect(r.curva_origen_usada).toEqual(v1);
    expect(r.meses_propuestos?.slice(9)).toEqual([133, 150, 167]);
    expect(suma(r.meses_propuestos)).toBe(1800);
    expect(r.curva_origen_propuesta?.[0].version).toBe(2);
    expect(r.avisos).toContain("curva_cambio");

    const aplicada = aplicarCurvaNueva(r);
    expect(aplicada.meses).toEqual(r.meses_propuestos);
    expect(aplicada.meses_propuestos).toBeNull();
    expect(aplicada.curva_origen_usada[0].version).toBe(2);
    expect(aplicada.avisos).not.toContain("curva_cambio");

    // Un registro sin decisión se reparte directamente con la vigente (v2).
    const sinDecidir = reg(s, clave("denim", AM.pre), Y);
    expect(sinDecidir.meses_propuestos).toBeNull();
    expect(sinDecidir.curva_origen_usada[0].version).toBe(2);
    // Y la fila ya trae la curva v2 como la vigente.
    expect(fila(s, DENIM_REC).curva_origen[0].version).toBe(2);
  });

  it("aplicarCurvaNueva sobre un registro sin meses_propuestos lo deja igual", () => {
    const r = reg(calcularProyeccion(entrada()), DENIM_REC, Y);
    expect(aplicarCurvaNueva(r)).toBe(r);
  });

  it("caso 16: ABRIGO decidido aceptando la propuesta (1 000); al publicar octubre la propuesta se mueve y queda propuesta_cambio", () => {
    const c = clave("abrigo", AM.rec, EQ.parka);
    const oct = serie({ tienda: "T1", nodo: "abrigo", eq: EQ.parka, agm: AM.rec, marca: "m-alfa", precio: 200 }, "2026-10", "2026-10", () => 60);
    const s = calcularProyeccion(entrada({ k: 10, hechos: [...hechosBase(), ...oct], previas: previas([[`${c}#${Y}`, decision({ decidido: 1000, origen: "propuesta", propuesta_al_decidir: 1000 })]]) }));
    const r = reg(s, c, Y);
    // V = 1 000 con C_10 = 0,96 → 1 000 ÷ 0,96 = 1 041,7: la propuesta de hoy ya no es la que vio al decidir.
    expect(r).toMatchObject({ vendido: 1000, decidido: 1000, propuesta_al_decidir: 1000, propuesto: 1042, vigente: 1000 });
    expect(r.avisos).toContain("propuesta_cambio");
  });
});

describe("prueba con el año anterior, dentro de muestra (caso 18)", () => {
  it("2025 con k = 9 sobre M(2025) y curva plana: propuesto = real exacto; eat_m6 de 2025", () => {
    const s = calcularProyeccion(entrada());
    const p = fila(s, DENIM_REC).historico?.prueba_anterior;
    expect(p).toMatchObject({ anio: 2025, propuesto: 1680, real: 1680, desvio_pct: 0, dentro_de_muestra: true, eat_m6: 9.8 });
    expect(fila(s, DENIM_REC).historico?.anios.find((a) => a.anio === 2025)?.tiendas).toEqual(["T1", "T5", "T7", "T8"]);
  });

  it("con diciembre al doble el desvío es negativo, y el agregado de la proyección lo recoge", () => {
    const extra = serie({ tienda: "T1", nodo: "denim", eq: EQ.skinny, agm: AM.rec, marca: "m-alfa" }, "2025-12", "2025-12", () => 140);
    const s = calcularProyeccion(entrada({ hechos: [...hechosBase(), ...extra] }));
    const p = fila(s, DENIM_REC).historico?.prueba_anterior;
    expect(p?.real).toBe(1820);
    expect(p?.propuesto).toBe(1680);
    expect(p?.desvio_pct).toBeLessThan(0);
    expect(s.resumen.desvio_prueba_anterior_pct).not.toBeNull();
  });

  it("el histórico de cada año usa la red de su año (2023: 8 tiendas fuera de T6, T2…) y la tendencia se mide sobre M(Y−1) ∩ M(Y)", () => {
    const s = calcularProyeccion(entrada());
    const h = fila(s, DENIM_REC).historico!;
    expect(h.anios.map((a) => a.anio)).toEqual([2023, 2024, 2025, 2026]);
    expect(h.anios[0].tiendas).toEqual(["T1", "T5", "T7", "T8"]);
    expect(h.anios[3].tiendas).toEqual(["T1", "T5", "T6"]);
    expect(h.anios[3].clase).toBe("en_curso");
    // T1 + T5 (en M(2025) ∩ M(2026)) venden lo mismo los dos años: tendencia 0.
    expect(h.tendencia).toBeCloseTo(0, 10);
  });
});

describe("GML que mezcla temporadas (caso 20) y participaciones (caso 14)", () => {
  it("MIXTA: factor por mes ponderado por las equivalencias, aviso temporadas_mezcladas, pesos 0,8 / 0,2", () => {
    const s = calcularProyeccion(entrada());
    const m = fila(s, clave("mixta", AM.rec));
    const phi = m.factores_mes?.[Y] as number[];
    const esperado = (0.8 * 0.04 * 0.66 + 0.2 * 0.08 * 1.24) / (0.8 * 0.04 + 0.2 * 0.08);
    expect(phi[8]).toBeCloseTo(esperado, 10);
    expect(m.avisos).toContain("temporadas_mezcladas");
    expect(m.historico?.pesos_equivalencias).toEqual([
      { equivalencia_id: EQ.mixtaInv, peso: 0.8 },
      { equivalencia_id: EQ.mixtaVer, peso: 0.2 },
    ]);
    expect(m.curva_origen.map((o) => o.agrupacion_id).sort()).toEqual([AG.inv, AG.ver].sort());
    expect(suma(m.curva)).toBeCloseTo(1, 10);
  });

  it("participaciones históricas en las filas base: cada eje suma 1; las filas de tienda no las llevan", () => {
    const s = calcularProyeccion(entrada());
    const p = fila(s, DENIM_REC).participaciones!;
    expect(suma(p.por_clave_flujo.map((x) => x.participacion))).toBeCloseTo(1, 9);
    expect(suma(p.por_talla.map((x) => x.participacion))).toBeCloseTo(1, 9);
    expect(p.por_clave_flujo.find((x) => x.clave_flujo === "marca:m-alfa")?.participacion).toBeCloseTo(110 / 150, 6);
    expect(p.por_clave_flujo.find((x) => x.clave_flujo === "otras")?.participacion).toBeCloseTo(40 / 150, 6);
    expect(p.por_talla.find((x) => x.agrupacion_talla_id === "t-central")?.participacion).toBeGreaterThan(0.5);
    expect(s.filas.filter((f) => f.tienda_id !== null).every((f) => f.participaciones === null)).toBe(true);
  });
});

describe("resumen y señales", () => {
  const s = calcularProyeccion(entrada());

  it("cuenta filas y decididas por año, totales por bloque y versión del método", () => {
    expect(s.resumen.version_metodo).toBe(VERSION_METODO);
    expect(s.resumen.totales[Y].total).toBe(s.resumen.totales[Y].mismas + s.resumen.totales[Y].nuevas_anterior + s.resumen.totales[Y].aperturas + s.resumen.totales[Y].cierres);
    expect(s.resumen.decididas).toEqual({ [Y]: 0, [Y + 1]: 0 });
    expect(s.resumen.huella_cargas).toMatch(/^[0-9a-f]{32}$/);
    expect(s.resumen.curvas_usadas).toHaveLength(3);
  });

  it("cola larga: DENIM × PREMIUM (propuesto 60 < 100) lleva el aviso y no bloquea", () => {
    const r = reg(s, clave("denim", AM.pre), Y);
    expect(r.propuesto).toBe(60);
    expect(r.avisos).toContain("cola_larga");
  });

  it("el quiebre se marca cuando el stock de fin de mes cubre menos de 0,25 de la venta", () => {
    const flaco = hechosBase().map((h) => (h.tienda === "T1" && h.nodo === "sandalia" && h.periodo === "2026-09" ? { ...h, stock: 1 } : h));
    const q = calcularProyeccion(entrada({ hechos: flaco }));
    const f = fila(q, clave("sandalia", AM.val));
    expect(f.avisos).toContain("quiebre");
    expect(f.historico?.anios[3].meses[8].quiebre).toBe(true);
    expect(fila(s, clave("sandalia", AM.val)).avisos).not.toContain("quiebre");
  });

  it("tienda_nueva sin ventas en la lectura de por_tienda (sin detalle) no rompe el cálculo", () => {
    const e = entrada();
    const sinDetalle = { ...e, venta: construirVenta(hechosBase(), tiendas(), { detalle: [], hasta: "2026-09" }) };
    const r = calcularProyeccion(sinDetalle);
    expect(reg(r, DENIM_REC, Y).propuesto).toBe(1800);
  });
});

/** El contexto de las decisiones en vivo, armado desde el cálculo (lo que la ruta reconstruye desde la base). */
function contextoDe(s: SalidaCalculo): ContextoModelo {
  const tiendasMap = new Map(tiendas().map((t) => [t.id, { codigo: t.codigo, nombre: t.nombre, fecha_apertura: t.fecha_apertura, fecha_cierre: t.fecha_cierre, venta_esperada: t.venta_esperada, referente_codigo: t.referente_id }]));
  return {
    anio: Y,
    k: K,
    crecimiento_pct_defecto: 5,
    umbral_cola_larga: 100,
    rampa_maduracion: [1, 1, 1],
    nombresCurva: new Map([[AG.denim, "DENIM HO"], [AG.inv, "HO INVIERNO"], [AG.ver, "MU VERANO"]]),
    mismasSiguiente: new Set(s.bloques[Y + 1].mismas.map((t) => t.tienda_id)),
    tiendas: tiendasMap,
  };
}

void N;
void CURVA_PLANA;
