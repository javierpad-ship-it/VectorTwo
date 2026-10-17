import { describe, expect, it } from "vitest";
import { avanceAcumulado, proponerCierre, pruebaPorAvance } from "@/lib/proyeccion/cierre";
import { proponerSiguiente } from "@/lib/proyeccion/siguiente";
import { CURVA_INVIERNO, CURVA_PLANA, CURVA_VERANO } from "./proyeccion.fixture";

const UNOS = Array(12).fill(1);
const base = { umbralAvance: 0.3, planAnterior: null, factoresMes: UNOS };

describe("cierre del año en curso (reglas 8 a 11)", () => {
  it("φ de unos: P = V ÷ C_k repartido (caso 3: 1 350 ÷ 0,75 = 1 800; resto 150/150/150)", () => {
    const serie = [...Array(9).fill(150), 0, 0, 0];
    const r = proponerCierre({ ...base, serie, k: 9, curva: CURVA_PLANA });
    expect(r.vendido).toBe(1350);
    expect(r.avance).toBeCloseTo(0.75, 10);
    expect(r.propuesto).toBe(1800);
    expect(r.metodo).toBe("avance");
    expect(r.meses?.slice(9)).toEqual([150, 150, 150]);
    expect(r.origen_meses?.filter((o) => o === "real")).toHaveLength(9);
  });

  it("φ constante en los doce meses: el factor se cancela (propiedad con φ ∈ {0,5; 0,66; 1,24})", () => {
    const serie = [20, 20, 60, 120, 200, 240, 160, 80, 40, 0, 0, 0];
    for (const f of [0.5, 0.66, 1.24]) {
      const r = proponerCierre({ ...base, serie, k: 9, curva: CURVA_INVIERNO, factoresMes: Array(12).fill(f) });
      expect(r.propuesto).toBe(1000);
    }
  });

  it("verano con φ solo de setiembre a diciembre: setiembre se divide antes del avance y oct–dic se multiplican (regla 9)", () => {
    const phi = [...Array(8).fill(1), 1.24, 1.24, 1.24, 1.24];
    const serie = [140, 120, 80, 40, 30, 20, 20, 30, 124, 0, 0, 0];
    const r = proponerCierre({ ...base, serie, k: 9, curva: CURVA_VERANO, factoresMes: phi });
    const vNorm = 480 + 124 / 1.24;
    const ck = avanceAcumulado(CURVA_VERANO, 9);
    expect(ck).toBeCloseTo(0.56, 10);
    expect(r.vendido_normalizado).toBeCloseTo(vNorm, 10);
    const resto = (vNorm / ck) * (0.12 + 0.14 + 0.18) * 1.24;
    expect(r.propuesto).toBe(604 + Math.round(resto));
    expect(r.propuesto).toBe(1169);
    expect(r.meses?.slice(9).reduce((a, b) => a + b, 0)).toBe(Math.round(resto));
  });

  it("poco avance con plan anterior: max(V, plan), método plan_anterior, avance como referencia (caso 6)", () => {
    const serie = [140, 120, ...Array(10).fill(0)];
    const r = proponerCierre({ ...base, serie, k: 2, curva: CURVA_VERANO, planAnterior: 1200 });
    expect(r.avance).toBeCloseTo(0.26, 10);
    expect(r.propuesto).toBe(1200);
    expect(r.metodo).toBe("plan_anterior");
    expect(r.referencia_alternativa).toBe(1000);
    expect(r.avisos).toContain("plan_anterior");
    // Si lo vendido supera al plan, manda lo vendido.
    const grande = proponerCierre({ ...base, serie: [700, 600, ...Array(10).fill(0)], k: 2, curva: CURVA_VERANO, planAnterior: 1200 });
    expect(grande.propuesto).toBe(1300);
    // Sin cerrada que cubra el año: avance con aviso avance_bajo.
    const sin = proponerCierre({ ...base, serie, k: 2, curva: CURVA_VERANO });
    expect(sin.metodo).toBe("avance");
    expect(sin.propuesto).toBe(1000);
    expect(sin.avisos).toContain("avance_bajo");
  });

  it("sin curva o avance 0 → propuesta nula, sin_curva y meses nulos", () => {
    const r = proponerCierre({ ...base, serie: [10, ...Array(11).fill(0)], k: 1, curva: null });
    expect(r).toMatchObject({ propuesto: null, meses: null, metodo: "sin_propuesta" });
    expect(r.avisos).toContain("sin_curva");
    const cero = proponerCierre({ ...base, serie: Array(12).fill(1), k: 3, curva: [0, 0, 0, ...Array(9).fill(1 / 9)] });
    expect(cero.propuesto).toBeNull();
  });

  it("V = 0: propuesta 0 y sin_venta_anio si hubo venta el año anterior", () => {
    const a = proponerCierre({ ...base, serie: Array(12).fill(0), k: 9, curva: CURVA_PLANA, ventaAnioAnterior: true });
    expect(a.propuesto).toBe(0);
    expect(a.avisos).toContain("sin_venta_anio");
    expect(proponerCierre({ ...base, serie: Array(12).fill(0), k: 9, curva: CURVA_PLANA }).avisos).not.toContain("sin_venta_anio");
  });

  it("pruebaPorAvance aplica el mismo método sin plan anterior", () => {
    expect(pruebaPorAvance({ serie: Array(12).fill(140), k: 9, curva: CURVA_PLANA, factoresMes: UNOS })).toBe(1680);
  });
});

describe("año siguiente (reglas 12 a 14)", () => {
  const entrada = (extra: Partial<Parameters<typeof proponerSiguiente>[0]> = {}) => ({
    baseVigente: 1000,
    mesesBase: [20, 20, 60, 120, 200, 240, 160, 80, 40, 20, 20, 20],
    aportesTiendas: [],
    factoresMesEnCurso: Array(12).fill(0.66),
    crecimiento: 3,
    curva: CURVA_INVIERNO,
    factoresMesObjetivo: UNOS,
    ...extra,
  });

  it("caso 4 (método 4): % bruto → P = round(B × 1,03) = 1 030 aunque Y fuera Niño (φ = 0,66); B' = 1 515 y B'' = B' × Σ c φ_{Y+1} = 1 515 solo son referencia", () => {
    const r = proponerSiguiente(entrada());
    expect(r.base).toBe(1000);
    expect(r.base_nino).toBeCloseTo(1515.1515, 3);
    expect(r.base_normalizada).toBeCloseTo(1515.1515, 3);
    expect(r.propuesto).toBe(1030);
    expect(r.meses?.reduce((a, b) => a + b, 0)).toBe(1030);
  });

  it("propiedad: P no depende de φ_Y (0,5, 0,66, 1,24; constante o por meses), solo cambia B'' (regla 2)", () => {
    const propuestas = [0.5, 0.66, 1.24].map((f) => proponerSiguiente(entrada({ factoresMesEnCurso: Array(12).fill(f) })));
    expect(propuestas.map((r) => r.propuesto)).toEqual([1030, 1030, 1030]);
    expect(propuestas.map((r) => Math.round(r.base_normalizada as number))).toEqual([2000, 1515, 806]);
    const porMeses = proponerSiguiente(entrada({ factoresMesEnCurso: [...Array(8).fill(1), 1.24, 1.24, 1.24, 1.24], mesesBase: [140, 120, 80, 40, 30, 20, 20, 30, 124, 148, 174, 223] }));
    expect(porMeses.propuesto).toBe(1030);
  });

  it("propiedad: con φ_{Y+1} ≠ 1, P no cambia y solo cambia el reparto (c'_m ∝ c_m φ_{Y+1,m})", () => {
    const objetivo = [...Array(8).fill(1), 0.5, 0.5, 0.5, 0.5];
    const a = proponerSiguiente(entrada({ factoresMesEnCurso: UNOS }));
    const b = proponerSiguiente(entrada({ factoresMesEnCurso: UNOS, factoresMesObjetivo: objetivo }));
    expect(b.propuesto).toBe(a.propuesto);
    expect(b.meses?.reduce((x, y) => x + y, 0)).toBe(b.propuesto);
    expect(b.meses).not.toEqual(a.meses);
    // B'' = B' × Σ c φ_{Y+1} baja con el factor del año siguiente.
    expect(b.base_normalizada as number).toBeLessThan(a.base_normalizada as number);
  });

  it("sin factor (φ de unos): B' = 1 000 y la propuesta es 1 030", () => {
    const r = proponerSiguiente(entrada({ factoresMesEnCurso: UNOS }));
    expect(r.base_nino).toBe(1000);
    expect(r.base_normalizada).toBe(1000);
    expect(r.propuesto).toBe(1030);
  });

  it("cada sumando cambia B: tiendas que entran suman y las que salen restan (caso 8)", () => {
    const plana = { curva: CURVA_PLANA, factoresMesEnCurso: UNOS, mesesBase: Array(12).fill(150), crecimiento: 5 };
    const aportes = [
      { signo: 1 as const, total: 300, meses: Array(12).fill(25) },
      { signo: -1 as const, total: 240, meses: Array(12).fill(20) },
    ];
    const a = proponerSiguiente(entrada({ ...plana, baseVigente: 1800, aportesTiendas: aportes }));
    expect(a.base).toBe(1860);
    expect(a.propuesto).toBe(1953);
    const b = proponerSiguiente(entrada({ ...plana, baseVigente: 1900, aportesTiendas: aportes }));
    expect(b.base).toBe(1960);
    expect(b.propuesto).toBe(2058);
    const c = proponerSiguiente(entrada({ ...plana, baseVigente: 1800, aportesTiendas: [{ ...aportes[0], total: 400 }, aportes[1]] }));
    expect(c.base).toBe(1960);
    expect(c.propuesto).toBe(2058);
  });

  it("φ no constante en Y: la base se normaliza mes a mes; sin base → null y sin_base; sin curva → sin_curva", () => {
    const phi = [...Array(8).fill(1), 1.24, 1.24, 1.24, 1.24];
    const r = proponerSiguiente(entrada({ curva: CURVA_VERANO, factoresMesEnCurso: phi, mesesBase: [140, 120, 80, 40, 30, 20, 20, 30, 124, 148, 174, 223] }));
    expect(r.base_nino).toBeGreaterThan(0);
    expect(r.base_nino).toBeLessThan(r.base as number);
    expect(proponerSiguiente(entrada({ baseVigente: null }))).toMatchObject({ propuesto: null, avisos: ["sin_base"] });
    expect(proponerSiguiente(entrada({ curva: null })).avisos).toContain("sin_curva");
  });

  it("φ del año objetivo no trivial pondera la curva del reparto", () => {
    const objetivo = [...Array(8).fill(1), 0.5, 0.5, 0.5, 0.5];
    const r = proponerSiguiente(entrada({ factoresMesEnCurso: UNOS, curva: CURVA_VERANO, factoresMesObjetivo: objetivo, crecimiento: 0 }));
    // Σ c φ = 1 − 0,5 × (0,08 + 0,12 + 0,14 + 0,18) = 0,74: con el método 4 mueve B'' (referencia) y el reparto, no la propuesta bruta.
    expect(r.propuesto).toBe(1000);
    expect(r.base_normalizada).toBeCloseTo(740, 6);
    expect(r.meses?.reduce((a, b) => a + b, 0)).toBe(1000);
  });
});
