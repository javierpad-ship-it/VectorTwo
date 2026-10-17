import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { calcularProyeccion, registroDe } from "@/lib/proyeccion/modelo";
import {
  anioMaduroSoles,
  fraccionAnioApertura,
  fraccionDeFila,
  rampaMensual,
  sumaSConCurva,
  unidadesMadurasDeFila,
  ventaAnioApertura,
} from "@/lib/proyeccion/tiendas-nuevas";
import { VERSION_METODO, VERSION_METODO_MIN_M8, type SalidaCalculo } from "@/lib/proyeccion/tipos";
import { AM, CURVA_INVIERNO, CURVA_PLANA, EQ, Y, claveTienda, entrada, hechosBase, serie, type Hecho } from "./proyeccion.fixture";

/**
 * 07d (sintético): la venta esperada de una tienda nueva es la venta MENSUAL promedio en régimen (× 12, estacionalizada en los meses
 * abiertos). «T12 · Tienda nueva B» es ficticia; las cifras salen del fixture del caso 9 de la ficha 07.
 */

const UNOS = Array<number>(12).fill(1);
const V = 85000;

/** El ejemplo de §5: T12 abre el 2027-03-15 con referente T03; DENIM 70 % de los soles a S/ 100 (plana) y ABRIGO 30 % a S/ 200 (invierno). */
function ejemplo(apertura: string, rampa: number[], v = V) {
  const r = rampaMensual(apertura, rampa, 2027);
  const filas = [
    { s: 0.7, p: 100, curva: CURVA_PLANA },
    { s: 0.3, p: 200, curva: CURVA_INVIERNO },
  ].map((f) => ({ ...f, phi: UNOS }));
  const suma = sumaSConCurva(filas);
  const F = fraccionAnioApertura(filas, r);
  const propuestas = filas.map((f) => Math.round(unidadesMadurasDeFila({ V: v, s: f.s, p: f.p, sumaSConCurva: suma }) * fraccionDeFila(f.curva, r, UNOS)));
  return { F, propuestas, total: propuestas[0] + propuestas[1], E: ventaAnioApertura(v, F) as number, maduras: filas.map((f) => unidadesMadurasDeFila({ V: v, s: f.s, p: f.p, sumaSConCurva: suma })) };
}

describe("regla 1: funciones básicas", () => {
  it("anioMaduroSoles(85 000) = 1 020 000; unidadesMadurasDeFila = 12 V s ÷ (p × Σ s con curva); 0 con p = 0 o sin suma", () => {
    expect(anioMaduroSoles(85000)).toBe(1020000);
    expect(unidadesMadurasDeFila({ V: 85000, s: 0.7, p: 100, sumaSConCurva: 1 })).toBeCloseTo(7140, 8);
    expect(unidadesMadurasDeFila({ V: 85000, s: 0.3, p: 200, sumaSConCurva: 1 })).toBeCloseTo(1530, 8);
    // Con una fila sin curva fuera de la suma, la composición se renormaliza: 0,7 de 0,9.
    expect(unidadesMadurasDeFila({ V: 85000, s: 0.7, p: 100, sumaSConCurva: 0.9 })).toBeCloseTo((12 * 85000 * 0.7) / (100 * 0.9), 8);
    expect(unidadesMadurasDeFila({ V: 85000, s: 0.7, p: 0, sumaSConCurva: 1 })).toBe(0);
    expect(unidadesMadurasDeFila({ V: 85000, s: 0.7, p: 100, sumaSConCurva: 0 })).toBe(0);
    expect(ventaAnioApertura(85000, null)).toBeNull();
    expect(ventaAnioApertura(85000, 0.5)).toBe(510000);
  });
});

describe("regla 2: ejemplo de §5 (T12 · Tienda nueva B, ficticia)", () => {
  it("sin rampa: F = 0,836860; 8 670 u maduras; 5 681 + 1 427 = 7 108 u; E = 853 597", () => {
    const r = ejemplo("2027-03-15", [1, 1, 1]);
    expect(r.F).toBeCloseTo(0.83686, 5);
    expect(r.maduras[0] + r.maduras[1]).toBeCloseTo(8670, 6);
    expect(r.propuestas).toEqual([5681, 1427]);
    expect(r.total).toBe(7108);
    expect(Math.round(r.E)).toBe(853597);
    // En soles: 5 681 × 100 + 1 427 × 200 = 853 500 ≈ E.
    expect(5681 * 100 + 1427 * 200).toBe(853500);
  });

  it("rampa explícita [0,7, 0,85, 1]: F = 0,810152; 5 494 + 1 385 = 6 879 u; E = 826 355", () => {
    const r = ejemplo("2027-03-15", [0.7, 0.85, 1]);
    expect(r.F).toBeCloseTo(0.810152, 5);
    expect(r.propuestas).toEqual([5494, 1385]);
    expect(r.total).toBe(6879);
    expect(Math.round(r.E)).toBe(826355);
  });

  it("rampa de pico [1,5, 1, 0,75] (la forma de la apertura cargada): 5 696 + 1 376 = 7 072 u; E = 844 771; −0,5 % frente a la plana", () => {
    const r = ejemplo("2027-03-15", [1.5, 1, 0.75]);
    expect(r.F).toBeCloseTo(0.828207, 5);
    expect(r.propuestas).toEqual([5696, 1376]);
    expect(r.total).toBe(7072);
    expect(Math.round(r.E)).toBe(844771);
    expect((r.total / 7108 - 1) * 100).toBeCloseTo(-0.5, 1);
  });

  it("apertura tardía (1 de noviembre): F = 0,1287; 1 190 + 61 = 1 251 u; E = 131 240 (el método 3 daba 811, más que abriendo en marzo)", () => {
    const r = ejemplo("2027-11-01", [1, 1, 1]);
    expect(r.F).toBeCloseTo(0.1287, 4);
    expect(r.propuestas).toEqual([1190, 61]);
    expect(r.total).toBe(1251);
    expect(Math.round(r.E)).toBe(131240);
    expect(r.F).toBeLessThan(0.25);
  });
});

describe("regla 3 a 5: propiedades", () => {
  it("Σ_f round(Md_f A_f) × p_f = 12 V F ± Σ_f p_f ÷ 2", () => {
    for (const [fecha, rampa] of [["2027-03-15", [1, 1, 1]], ["2027-03-15", [0.7, 0.85, 1]], ["2027-07-01", [1.5, 1, 0.75]], ["2027-11-01", [1, 1, 1]]] as const) {
      const r = ejemplo(fecha, [...rampa]);
      const soles = r.propuestas[0] * 100 + r.propuestas[1] * 200;
      expect(Math.abs(soles - r.E)).toBeLessThanOrEqual((100 + 200) / 2);
    }
  });

  it("las unidades crecen de forma monótona con V; con rampa plana decrecen al atrasar la fecha de apertura", () => {
    const totales = [10000, 40000, 85000, 120000].map((v) => ejemplo("2027-03-15", [1, 1, 1], v).total);
    expect([...totales].sort((a, b) => a - b)).toEqual(totales);
    expect(new Set(totales).size).toBe(totales.length);
    const porFecha = ["2027-01-01", "2027-03-15", "2027-06-01", "2027-09-15", "2027-11-01", "2027-12-20"].map((f) => ejemplo(f, [1, 1, 1]).total);
    for (let i = 1; i < porFecha.length; i++) expect(porFecha[i]).toBeLessThan(porFecha[i - 1]);
  });

  it("apertura el 1 de enero sin rampa: F = 1 y P_f = round(12 V s̃_f ÷ p_f)", () => {
    const r = ejemplo("2027-01-01", [1, 1, 1]);
    expect(r.F).toBeCloseTo(1, 9);
    expect(r.propuestas).toEqual([Math.round((12 * V * 0.7) / 100), Math.round((12 * V * 0.3) / 200)]);
  });

  it("filas sin curva: quedan fuera de s̃, F con s̃ es ≥ que con s sin renormalizar (igual si todas tienen curva) y Σ soles = 12 V F", () => {
    const r = rampaMensual("2027-03-15", [1, 1, 1], 2027);
    const todas = [
      { s: 0.6, curva: CURVA_PLANA, phi: UNOS },
      { s: 0.3, curva: CURVA_INVIERNO, phi: UNOS },
    ];
    const conSinCurva = [...todas, { s: 0.1, curva: null, phi: UNOS }];
    const sinRenormalizar = todas.reduce((f, x) => f + x.s * fraccionDeFila(x.curva, r, x.phi), 0);
    expect(fraccionAnioApertura(conSinCurva, r)).toBeGreaterThan(sinRenormalizar);
    expect(fraccionAnioApertura(conSinCurva, r)).toBeCloseTo(fraccionAnioApertura(todas, r), 12);
    // Con todas las filas con curva, F con s̃ = F con s (Σ s = 1).
    const completas = [{ s: 0.7, curva: CURVA_PLANA, phi: UNOS }, { s: 0.3, curva: CURVA_INVIERNO, phi: UNOS }];
    expect(fraccionAnioApertura(completas, r)).toBeCloseTo(completas.reduce((f, x) => f + x.s * fraccionDeFila(x.curva, r, x.phi), 0), 12);
    // La suma de soles de las demás filas es 12 V F (cada una con su p).
    const suma = sumaSConCurva(conSinCurva);
    const soles = todas.reduce((a, x) => a + unidadesMadurasDeFila({ V, s: x.s, p: 100, sumaSConCurva: suma }) * fraccionDeFila(x.curva, r, x.phi) * 100, 0);
    expect(soles).toBeCloseTo(12 * V * fraccionAnioApertura(conSinCurva, r), 4);
    expect(sumaSConCurva(conSinCurva)).toBeCloseTo(0.9, 12);
  });
});

// ─── Con el cálculo completo (fixture sintético) ───

const hechosT1 = (): Hecho[] => {
  const a = (3 / 14) * 100;
  return [
    ...serie({ tienda: "T1", nodo: "denim", eq: EQ.skinny, agm: AM.rec, marca: "m-alfa" }, "2023-01", "2026-09", () => 100),
    ...serie({ tienda: "T1", nodo: "abrigo", eq: EQ.parka, agm: AM.rec, marca: "m-alfa", precio: 200 }, "2023-01", "2026-09", (an, m) => (an === 2026 && m <= 9 ? a * 0.66 : a)),
  ];
};
const calc = (extra: Record<string, unknown> = {}, hechos: Hecho[] = hechosT1()): SalidaCalculo => calcularProyeccion(entrada({ hechos, ...extra } as never));
const tienda = (s: SalidaCalculo, id: string, anio: number) => s.tiendas.find((t) => t.tienda_id === id && t.anio === anio)!;
const reg = (s: SalidaCalculo, c: string, anio: number) => registroDe(s.filas.find((f) => f.clave === c)!, anio)!;
const CD = claveTienda("T4", "denim", AM.rec);
const CA = claveTienda("T4", "abrigo", AM.rec, EQ.parka);

describe("regla 6 y 7: avisos y rampa en el cálculo", () => {
  it("F < 0,25 → apertura_tardia (informativo); sin V → sin_propuesta y sin_venta_esperada; V = 0 → todas las filas en 0", () => {
    expect(tienda(calc({ tiendasExtra: { T4: { fecha_apertura: "2027-11-01" } } }), "T4", Y + 1).avisos).toContain("apertura_tardia");
    expect(tienda(calc(), "T4", Y + 1).avisos).not.toContain("apertura_tardia");
    const sinV = tienda(calc({ tiendasExtra: { T4: { venta_esperada: null } } }), "T4", Y + 1);
    expect(sinV).toMatchObject({ propuesto: null, metodo: "sin_propuesta" });
    expect(sinV.avisos).toContain("sin_venta_esperada");
    const cero = calc({ tiendasExtra: { T4: { venta_esperada: 0 } } });
    expect(reg(cero, CD, Y + 1).propuesto).toBe(0);
    expect(reg(cero, CA, Y + 1).propuesto).toBe(0);
    expect(tienda(cero, "T4", Y + 1)).toMatchObject({ propuesto: 0, metodo: "apertura" });
  });

  it("con el método 4 la misma V con rampa [1,5, 1, 0,75] y con [1, 1, 1] da totales distintos (la rampa mueve el total): 7 072 frente a 7 108", () => {
    const pico = tienda(calc({ tiendasExtra: { T4: { rampa: [1.5, 1, 0.75] } } }), "T4", Y + 1);
    const plana = tienda(calc(), "T4", Y + 1);
    expect(plana.propuesto).toBe(7108);
    expect(pico.propuesto).toBe(7072);
    expect(pico.propuesto).not.toBe(plana.propuesto);
    // Las unidades maduras (año maduro) no dependen de la rampa.
    expect(pico.unidades_maduras).toBe(plana.unidades_maduras);
    expect(pico.explicacion).toContain("rampa 1.50 · 1.00 · 0.75");
  });

  it("una fila sin curva queda sin propuesta (sin_curva) y las demás se reparten el 100 % de 12 V F", () => {
    const sinCurvaAbrigo = entrada({ hechos: hechosT1() });
    sinCurvaAbrigo.vigentes = sinCurvaAbrigo.vigentes.filter((v) => v.agrupacion_id !== "a-ho-invierno");
    const s = calcularProyeccion(sinCurvaAbrigo);
    expect(reg(s, CA, Y + 1)).toMatchObject({ propuesto: null });
    expect(reg(s, CA, Y + 1).avisos).toContain("sin_curva");
    // Con s̃ = 0,7 ÷ 0,7 = 1 toda la venta cae en DENIM: 12 × 85 000 ÷ 100 = 10 200 u de año maduro; A = 17/31 + 9 sobre 12.
    const A = (17 / 31 + 9) / 12;
    expect(reg(s, CD, Y + 1).propuesto).toBe(Math.round(10200 * A));
    expect(tienda(s, "T4", Y + 1).propuesto).toBe(Math.round(10200 * A));
  });

  it("regla 8: la referencia «por venta esperada» de una tienda en su año y en el siguiente usa el Md_f nuevo (apertura con n < 3 incluida)", () => {
    // T3 abre el 2026-07-01 (n = 3: avance propio) y tiene venta esperada: la referencia es round(Md_f × A_f).
    const s = calc({ tiendasExtra: { T3: { venta_esperada: 12000, referente_id: "T1" } } });
    const cd3 = claveTienda("T3", "denim", AM.rec);
    const fila3 = s.filas.find((f) => f.clave === cd3)!;
    const md = fila3.composicion?.unidades_maduras as number;
    // Md = 12 V s ÷ (p Σ s): con la composición de T1 (70 % DENIM a S/ 100): 12 × 12 000 × 0,7 ÷ 100 = 1 008.
    expect(md).toBeCloseTo(1008, 4);
    expect(reg(s, cd3, Y).referencia_alternativa).toBe(Math.round(md * 0.5)); // A_f = 6 meses abiertos de 12 con curva plana
    expect(reg(s, cd3, Y + 1).referencia_alternativa).toBe(Math.round(md * 1)); // el año siguiente es un año completo
    // Abre el 2026-08-01 (n = 1 < 3): apertura = vendido + Md_f × Σ_{m>k} c r φ = Md_f × 0,25 con k = 9.
    const t = calc({ tiendasExtra: { T3: { fecha_apertura: "2026-08-01", venta_esperada: 12000, referente_id: "T1" } } });
    const r3 = reg(t, cd3, Y);
    expect(r3.metodo).toBe("apertura");
    const md2 = t.filas.find((f) => f.clave === cd3)!.composicion?.unidades_maduras as number;
    expect(r3.propuesto).toBe(r3.vendido + Math.round(md2 * 0.25));
    expect(tienda(t, "T3", Y).unidades_maduras).toBe(Math.round(md2 + (t.filas.find((f) => f.clave === claveTienda("T3", "abrigo", AM.rec, EQ.parka))?.composicion?.unidades_maduras ?? 0)));
  });

  it("aviso informativo venta_esperada_fuera_de_rango: 12·V fuera de [0,3, 3] veces la venta anual media de una tienda de la red; no con V = 0", () => {
    // Venta anual media de las mismas tiendas de 2026 con detalle (T1, T5, T6) sobre `W12` (octubre 2025 a setiembre 2026), en soles sin normalizar.
    const media = hechosBase()
      .filter((x) => ["T1", "T5", "T6"].includes(x.tienda) && x.periodo >= "2025-10" && x.periodo <= "2026-09")
      .reduce((a, h) => a + (h.soles ?? h.unidades * 100), 0) / 3;
    expect(media).toBeGreaterThan(0);
    const aviso = (v: number) => tienda(calc({ tiendasExtra: { T4: { venta_esperada: v } } }, hechosBase()), "T4", Y + 1).avisos.includes("venta_esperada_fuera_de_rango");
    expect(aviso(media / 12)).toBe(false);
    expect(aviso((media / 12) * 0.05)).toBe(true);
    expect(aviso((media / 12) * 20)).toBe(true);
    expect(aviso(0)).toBe(false);
  });
});

describe("regla 10: apertura y cierre en el mismo año de Y+1", () => {
  it("una tienda con apertura y cierre en Y+1 y sin venta queda con el aviso apertura_y_cierre y sin filas; abrir en Y y cerrar en Y+1 no lo lleva", () => {
    const s = calc({ tiendasExtra: { T4: { fecha_apertura: "2027-03-15", fecha_cierre: "2027-09-30" } } });
    const t4 = tienda(s, "T4", Y + 1);
    expect(t4.bloque).toBe("cierres");
    expect(t4.avisos).toContain("apertura_y_cierre");
    expect(t4.propuesto).toBeNull();
    expect(s.filas.filter((f) => f.tienda_id === "T4")).toHaveLength(0);
    // T3 abrió en 2026 y cierra en 2027: en 2027 es cierre, pero no abre en 2027.
    const u = calc({ tiendasExtra: { T3: { fecha_cierre: "2027-06-30" } } });
    const t3 = tienda(u, "T3", Y + 1);
    expect(t3.bloque).toBe("cierres");
    expect(t3.avisos).not.toContain("apertura_y_cierre");
    expect(tienda(u, "T3", Y).bloque).toBe("nuevas");
  });
});

describe("regla 9 y 14 de 07d: versión del método", () => {
  it("VERSION_METODO = 4 y entra en el resumen; M8 exige una cerrada con version_metodo ≥ VERSION_METODO_MIN_M8 = 4 (constante fija)", () => {
    expect(VERSION_METODO).toBe(4);
    expect(VERSION_METODO_MIN_M8).toBe(4);
    expect(calc().resumen.version_metodo).toBe(VERSION_METODO);
  });

  it("recalcular conserva el total decidido de la tienda y marca propuesta_cambio (la propuesta del método 3 era unas 10 veces menor)", () => {
    const previas = {
      filas: new Map(),
      tiendas: new Map([[`T4#${Y + 1}`, { decidido: 700, origen: "manual" as const, nota: "del método 3", propuesta_al_decidir: 708, rampa: null, decidido_por_nombre: "Javier", decidido_at: "2026-10-01T00:00:00Z" }]]),
    };
    const s = calc({ previas });
    const t = tienda(s, "T4", Y + 1);
    expect(t).toMatchObject({ decidido: 700, propuesto: 7108, propuesta_al_decidir: 708 });
    expect(t.avisos).toContain("propuesta_cambio");
    expect((reg(s, CD, Y + 1).vigente ?? 0) + (reg(s, CA, Y + 1).vigente ?? 0)).toBe(700);
  });
});

// ─── Estático (regla 11) ───

const RAIZ = path.resolve(__dirname, "..");
function archivos(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((nombre) => {
    const p = path.join(dir, nombre);
    if (statSync(p).isDirectory()) return archivos(p);
    return /\.(ts|tsx)$/.test(nombre) ? [p] : [];
  });
}
const sinComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const leerSrc = (rel: string) => readFileSync(path.join(RAIZ, rel), "utf8");

describe("regla 11 (estático): ninguna conversión de IGV y la venta esperada se dice mensual", () => {
  it("ningún archivo de src/lib/proyeccion ni de src/lib/tiendas divide o multiplica por 1,18", () => {
    for (const dir of ["src/lib/proyeccion", "src/lib/tiendas"]) {
      for (const f of archivos(path.join(RAIZ, dir))) {
        const t = sinComentarios(readFileSync(f, "utf8"));
        expect(t, f).not.toMatch(/[*/]\s*1[.,]18\b|\b1[.,]18\s*[*/]/);
      }
    }
  });

  it("ningún texto de las pantallas de tiendas ni de la proyección dice «año de apertura» como significado de la venta esperada", () => {
    for (const dir of ["src/app/(app)/maestros/tiendas", "src/app/(app)/planificacion/proyeccion"]) {
      for (const f of archivos(path.join(RAIZ, dir))) {
        const t = sinComentarios(readFileSync(f, "utf8"));
        expect(t, f).not.toMatch(/venta[^\n.]{0,80}año de apertura|año de apertura[^\n.]{0,80}venta/i);
      }
    }
  });

  it("las pantallas de §6 dicen «mensual promedio» y el importador reconoce VENTA_MENSUAL y VENTA_PROMEDIO_MENSUAL (no los alias anuales)", () => {
    for (const rel of [
      "src/app/(app)/maestros/tiendas/formulario-tienda.tsx",
      "src/app/(app)/maestros/tiendas/venta-esperada.ts",
      "src/app/(app)/planificacion/proyeccion/atajo-tienda.tsx",
    ]) {
      expect(leerSrc(rel).toLowerCase(), rel).toContain("mensual promedio");
    }
    const importar = sinComentarios(leerSrc("src/app/(app)/maestros/tiendas/importar-tiendas.tsx"));
    expect(importar).toContain("VENTA_MENSUAL");
    expect(importar).toContain("VENTA_PROMEDIO_MENSUAL");
    expect(importar).not.toContain("VENTA_ESPERADA_ANIO_APERTURA");
    expect(importar).not.toMatch(/["']VENTA_APERTURA["']/);
  });
});
