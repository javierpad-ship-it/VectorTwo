import { describe, expect, it } from "vitest";
import { composicionPromedio, composicionTienda, tieneHistoria, type HechoTiendaFila } from "@/lib/proyeccion/composicion";
import { fraccionAbierta, proponerCierreTienda } from "@/lib/proyeccion/cierres-tienda";
import {
  avancePropio,
  escalarTienda,
  maduroDeVigente,
  maduroSiguiente,
  mesesCompletos,
  motivoRampaInvalida,
  perfilApertura,
  proponerFilaTienda,
  rampaMensual,
  sumaCurva,
} from "@/lib/proyeccion/tiendas-nuevas";
import { CURVA_INVIERNO, CURVA_PLANA, meses } from "./proyeccion.fixture";

const UNOS = Array(12).fill(1);
const suma = (x: Iterable<number>) => [...x].reduce((a, b) => a + b, 0);

describe("composición de una tienda y de un bloque (reglas 17, 18 y 22 de la sección 9)", () => {
  const ventana = meses("2025-10", "2026-09");
  const hechos = (fila: string, unidades: number, soles: number): HechoTiendaFila[] => ventana.map((periodo) => ({ fila, periodo, unidades, venta_soles: soles }));

  it("Σ s = 1; p = soles ÷ unidades; una fila sin unidades toma el precio medio de la tienda", () => {
    const c = composicionTienda([...hechos("a", 10, 1000), ...hechos("b", 5, 1000), ...hechos("c", 0, 500)], ventana, () => 1);
    expect(suma(c.filas.map((f) => f.s))).toBeCloseTo(1, 12);
    expect(c.filas.find((f) => f.fila === "a")?.p).toBe(100);
    expect(c.filas.find((f) => f.fila === "b")?.p).toBe(200);
    expect(c.filas.find((f) => f.fila === "c")?.p).toBeCloseTo(c.precio_medio, 10);
    expect(tieneHistoria(c)).toBe(true);
  });

  it("los meses del Niño se normalizan en soles y unidades por igual (el precio no cambia)", () => {
    const phi = (_: string, periodo: string) => (periodo >= "2026-01" ? 0.66 : 1);
    const c = composicionTienda(hechos("a", 66, 6600), ventana, phi);
    expect(c.filas[0].p).toBeCloseTo(100, 10);
    expect(c.filas[0].U).toBeCloseTo(3 * 66 + 9 * 100, 8);
  });

  it("referente con menos de doce meses con venta no tiene historia", () => {
    const c = composicionTienda(hechos("a", 10, 1000).slice(0, 6), ventana, () => 1);
    expect(tieneHistoria(c)).toBe(false);
  });

  it("sin referente: promedio con IGUAL peso por tienda, no ponderado (caso 22: 50/50 y no 74,5/25,5)", () => {
    const t1 = composicionTienda([...hechos("x", 8, 800), ...hechos("y", 2, 200)].map((h) => ({ ...h, venta_soles: h.fila === "x" ? 8000 / 12 : 2000 / 12 })), ventana, () => 1);
    const t6 = composicionTienda([...hechos("x", 2, 200), ...hechos("y", 8, 800)].map((h) => ({ ...h, venta_soles: h.fila === "x" ? 200 / 12 : 800 / 12 })), ventana, () => 1);
    expect(t1.total_S).toBeCloseTo(10000, 6);
    expect(t6.total_S).toBeCloseTo(1000, 6);
    const red = composicionPromedio([t1, t6]);
    expect(red.filas.find((f) => f.fila === "x")?.s).toBeCloseTo(0.5, 12);
    expect(red.filas.find((f) => f.fila === "y")?.s).toBeCloseTo(0.5, 12);
    expect(suma(red.filas.map((f) => f.s))).toBeCloseTo(1, 12);
    // El precio es el agregado de la red (Σ soles ÷ Σ unidades).
    const x = red.filas.find((f) => f.fila === "x")!;
    expect(x.p).toBeCloseTo((x.S) / x.U, 10);
  });
});

describe("rampa de maduración (regla 19)", () => {
  it("0 antes de abrir, apertura por días del mes, luego la rampa y después 1 (abre el 15 de marzo: r₃ = rampa[0] × 17/31)", () => {
    const r = rampaMensual("2027-03-15", [0.7, 0.85, 1], 2027);
    expect(r.slice(0, 2)).toEqual([0, 0]);
    expect(r[2]).toBeCloseTo(0.7 * (17 / 31), 12);
    expect(r[2]).toBeCloseTo(0.3839, 4);
    expect(r[3]).toBe(0.85);
    expect(r.slice(4)).toEqual(Array(8).fill(1));
    expect(rampaMensual("2027-03-15", [1, 1, 1], 2027)[2]).toBeCloseTo(0.5484, 4);
  });

  it("se admite rampa[0] = 3 (pico) y se rechaza > 5, ≤ 0 y más de seis valores", () => {
    expect(motivoRampaInvalida([3, 1.5, 1])).toBeNull();
    expect(motivoRampaInvalida([5.1])).not.toBeNull();
    expect(motivoRampaInvalida([0, 1])).not.toBeNull();
    expect(motivoRampaInvalida([-1])).not.toBeNull();
    expect(motivoRampaInvalida([1, 1, 1, 1, 1, 1, 1])).not.toBeNull();
    expect(motivoRampaInvalida([])).not.toBeNull();
  });

  it("la rampa sigue contando en el año siguiente si no terminó en el año de apertura", () => {
    // Abre el 1 de noviembre de 2026: noviembre (0,5), diciembre (0,8), enero (1) ya fuera de la rampa corta.
    const y2027 = rampaMensual("2026-11-01", [0.5, 0.8, 0.9, 0.95], 2027);
    expect(y2027.slice(0, 3)).toEqual([0.9, 0.95, 1]);
    expect(rampaMensual("2026-11-01", [0.5, 0.8, 0.9, 0.95], 2026).slice(9)).toEqual([0, 0.5, 0.8]);
  });

  it("meses completos desde la apertura: el mes de apertura cuenta solo si abrió el día 1", () => {
    expect(mesesCompletos("2026-07-01", 2026, 9)).toBe(3);
    expect(mesesCompletos("2026-08-15", 2026, 9)).toBe(1);
    expect(mesesCompletos("2025-11-20", 2026, 9)).toBe(10);
    expect(mesesCompletos("2026-11-01", 2026, 9)).toBe(0);
  });
});

describe("avance propio con la rampa en el denominador (B1; casos 10 y 11)", () => {
  const rampa = [0.7, 0.85, 1];
  const r = rampaMensual("2026-03-01", rampa, 2026);
  const serie = [0, 0, 100, 80, 70, 70, 70, 55, 55, 0, 0, 0];

  it("el denominador es Σ c·r = 0,546 y no C_9 = 0,75; A = 916; total 729", () => {
    const a = avancePropio({ serie, k: 9, curva: CURVA_PLANA, rampa: r, factoresMes: UNOS });
    expect(a.denominador).toBeCloseTo(6.55 / 12, 10);
    expect(a.denominador).toBeCloseTo(0.546, 3);
    expect(Math.round(a.A as number)).toBe(916);
    expect(a.vendido).toBe(500);
    expect(a.factor_resto).toBeCloseTo(0.25, 10);
    expect(500 + Math.round(a.resto as number)).toBe(729);
  });

  it("con rampa [1,1,1] el denominador es 0,583, A = 857 y el total 714", () => {
    const a = avancePropio({ serie, k: 9, curva: CURVA_PLANA, rampa: rampaMensual("2026-03-01", [1, 1, 1], 2026), factoresMes: UNOS });
    expect(a.denominador).toBeCloseTo(7 / 12, 10);
    expect(Math.round(a.A as number)).toBe(857);
    expect(500 + Math.round(a.resto as number)).toBe(714);
  });

  it("una tienda abierta todo el año: el denominador es C_k", () => {
    const a = avancePropio({ serie: Array(12).fill(25), k: 9, curva: CURVA_PLANA, rampa: UNOS, factoresMes: UNOS });
    expect(a.denominador).toBeCloseTo(0.75, 10);
    expect(a.A).toBeCloseTo(300, 8);
  });

  it("A³ usa los últimos tres meses cerrados", () => {
    const a = avancePropio({ serie: [0, 0, 0, 0, 0, 0, 40, 40, 40, 0, 0, 0], k: 9, curva: CURVA_PLANA, rampa: rampaMensual("2026-07-01", [1, 1, 1], 2026), factoresMes: UNOS });
    expect(a.A_tres_meses).toBeCloseTo(480, 8);
  });
});

describe("propuesta de una fila de tienda (reglas 20 a 22)", () => {
  const base = { esAnioEnCurso: false, k: 0, subbloque: "aperturas" as const, nCompletos: 0, real: Array(12).fill(0), curva: CURVA_PLANA, phi: UNOS, maduroPrevio: null, crecimiento: 5 };

  it("apertura en el año siguiente: Md × Σ c·r·φ; sin venta esperada → null y sin_venta_esperada", () => {
    const r = rampaMensual("2027-03-15", [0.7, 0.85, 1], 2027);
    const p = proponerFilaTienda({ ...base, rampa: r, maduras: 7140 });
    expect(p.propuesto).toBe(5494);
    expect(p.metodo).toBe("apertura");
    const sin = proponerFilaTienda({ ...base, rampa: r, maduras: null });
    expect(sin.propuesto).toBeNull();
    expect(sin.avisos).toContain("sin_venta_esperada");
  });

  it("ABRIGO: la curva de invierno pondera la rampa (0,905 × 1 530 = 1 385)", () => {
    const r = rampaMensual("2027-03-15", [0.7, 0.85, 1], 2027);
    expect(sumaCurva(CURVA_INVIERNO, r, null)).toBeCloseTo(0.905032, 5);
    expect(proponerFilaTienda({ ...base, rampa: r, maduras: 1530, curva: CURVA_INVIERNO }).propuesto).toBe(1385);
  });

  it("año en curso con 3 meses completos: avance_propio con A³ y la cifra por venta esperada al lado", () => {
    const real = [0, 0, 0, 0, 0, 0, 40, 40, 40, 0, 0, 0];
    const p = proponerFilaTienda({ ...base, esAnioEnCurso: true, k: 9, nCompletos: 3, real, rampa: rampaMensual("2026-07-01", [1, 1, 1], 2026), maduras: 600 });
    expect(p).toMatchObject({ propuesto: 240, metodo: "avance_propio", referencia_tres_meses: 480, vendido: 120 });
    expect(p.referencia_alternativa).toBe(300); // 600 × Σ c·r = 600 × 0,5
  });

  it("con menos de tres meses completos: apertura desde k + 1 con venta esperada y el avance propio como referencia", () => {
    const real = [0, 0, 0, 0, 0, 0, 0, 20, 40, 0, 0, 0];
    const p = proponerFilaTienda({ ...base, esAnioEnCurso: true, k: 9, nCompletos: 1, real, rampa: rampaMensual("2026-08-15", [1, 1, 1], 2026), maduras: 480 });
    expect(p.metodo).toBe("apertura");
    expect(p.propuesto).toBe(60 + Math.round(480 * (3 / 12)));
    expect(p.referencia_alternativa).not.toBeNull();
    const sinE = proponerFilaTienda({ ...base, esAnioEnCurso: true, k: 9, nCompletos: 1, real, rampa: rampaMensual("2026-08-15", [1, 1, 1], 2026), maduras: null });
    expect(sinE.propuesto).toBeNull();
    expect(sinE.avisos).toContain("sin_venta_esperada");
  });

  it("año siguiente de una tienda que abrió en Y: A × (1 + g) × Σ c·r = 504; si cambia lo vigente de Y cambia (300 → 630)", () => {
    const rY = rampaMensual("2026-07-01", [1, 1, 1], 2026);
    const rY1 = rampaMensual("2026-07-01", [1, 1, 1], 2027);
    const A = maduroDeVigente({ vigente: 240, curva: CURVA_PLANA, rampa: rY, phi: UNOS }) as number;
    expect(A).toBeCloseTo(480, 8);
    expect(maduroSiguiente({ maduro: A, crecimiento: 5, curva: CURVA_PLANA, rampa: rY1 })).toBe(504);
    const A2 = maduroDeVigente({ vigente: 300, curva: CURVA_PLANA, rampa: rY, phi: UNOS }) as number;
    expect(A2).toBeCloseTo(600, 8);
    const p = proponerFilaTienda({ ...base, subbloque: "nuevas_anterior", rampa: rY1, maduras: null, maduroPrevio: A2 });
    expect(p).toMatchObject({ propuesto: 630, metodo: "maduro_propio" });
  });

  it("sin curva → propuesta nula y sin_curva", () => {
    expect(proponerFilaTienda({ ...base, rampa: UNOS, maduras: 100, curva: null }).avisos).toContain("sin_curva");
  });
});

describe("decisión por tienda: escalar (regla 23)", () => {
  const filas = [
    { id: "a", propuesto: 5681, fijada: null, peso: 0.7 },
    { id: "b", propuesto: 1427, fijada: null, peso: 0.3 },
  ];

  it("las filas no fijadas se escalan y la suma es D (6 000)", () => {
    const { asignado, escaladas } = escalarTienda(filas, 6000);
    expect(suma(asignado.values())).toBe(6000);
    expect(asignado.get("a")).toBe(Math.round((6000 * 5681) / 7108));
    expect(escaladas.size).toBe(2);
  });

  it("fijar una fila deja la otra con lo que resta (DENIM = 5 000 → ABRIGO = 1 000)", () => {
    const { asignado, escaladas } = escalarTienda([{ ...filas[0], fijada: 5000 }, filas[1]], 6000);
    expect(asignado.get("a")).toBe(5000);
    expect(asignado.get("b")).toBe(1000);
    expect(escaladas.has("a")).toBe(false);
  });

  it("Σ fijadas > D: el resto queda en 0 y aviso fijadas_exceden", () => {
    const r = escalarTienda([{ ...filas[0], fijada: 7000 }, filas[1]], 6000);
    expect(r.asignado.get("b")).toBe(0);
    expect(r.avisos).toContain("fijadas_exceden");
  });

  it("propiedad: la suma final es D para totales de 0 a 2 000; sin propuestas se reparte con la composición", () => {
    for (let d = 0; d <= 2000; d += 13) expect(suma(escalarTienda(filas, d).asignado.values())).toBe(d);
    const sin = escalarTienda([{ id: "a", propuesto: null, fijada: null, peso: 0.75 }, { id: "b", propuesto: null, fijada: null, peso: 0.25 }], 100);
    expect(sin.asignado.get("a")).toBe(75);
    expect(sin.asignado.get("b")).toBe(25);
  });
});

describe("cierres de tienda (regla 24) y perfil de apertura", () => {
  it("primera entrega: propuesto = vendido y cierre_no_proyectado si el cierre es posterior a k", () => {
    const ya = proponerCierreTienda({ vendido: 60, fechaCierre: "2026-06-30", anio: 2026, anioEnCurso: 2026, k: 9 });
    expect(ya).toMatchObject({ propuesto: 60, metodo: "cierre", avisos: [] });
    const luego = proponerCierreTienda({ vendido: 0, fechaCierre: "2027-06-30", anio: 2027, anioEnCurso: 2026, k: 9 });
    expect(luego).toMatchObject({ propuesto: 0, metodo: "cierre", avisos: ["cierre_no_proyectado"] });
  });

  it("q_m: 1 hasta el mes anterior, días ÷ días del mes en el mes del cierre y 0 después (0.10.1)", () => {
    const q = fraccionAbierta("2027-06-15", 2027);
    expect(q.slice(0, 5)).toEqual([1, 1, 1, 1, 1]);
    expect(q[5]).toBe(0.5);
    expect(q.slice(6)).toEqual(Array(6).fill(0));
    expect(fraccionAbierta("2027-06-30", 2027)[5]).toBe(1);
  });

  it("perfilApertura: null con menos de doce meses; con doce, el ritmo de los seis primeros frente al maduro", () => {
    expect(perfilApertura([1, 2, 3], [0.1, 0.1, 0.1])).toBeNull();
    const c = Array(12).fill(1 / 12);
    const v = [300, 250, 200, 150, 120, 110, 100, 100, 100, 100, 100, 100];
    const p = perfilApertura(v, c) as number[];
    expect(p).toHaveLength(6);
    expect(p[0]).toBeCloseTo(3, 10); // el primer mes vendió 3× el ritmo de régimen
    expect(p[5]).toBeCloseTo(1.1, 10);
  });
});
