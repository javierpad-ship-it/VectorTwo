import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/guard", async () => (await import("./direccion.fake-db")).guardFalso());
vi.mock("@/lib/supabase/admin", async () => {
  const { clienteFalso } = await import("./direccion.fake-db");
  return { supabaseAdmin: () => clienteFalso() };
});
vi.mock("@/lib/direccion/contexto", async (original) => {
  const real = await original<typeof import("@/lib/direccion/contexto")>();
  const fx = await import("./direccion.fixture");
  return { ...real, leerMaestros: async () => ({ data: fx.maestrosCaso(), respuesta: null }), leerNinoDeHoy: async () => ({ data: fx.ninoCaso.valor, respuesta: null }) };
});
vi.mock("@/lib/tiendas/estado", async (original) => {
  const soporte = await import("./direccion.soporte");
  return { ...(await original<typeof import("@/lib/tiendas/estado")>()), hoyLima: () => soporte.relojDePrueba.hoy };
});

import { GET as tablero } from "@/app/api/direccion/tablero/route";
import {
  aniosDeComparativo,
  claseTienda,
  comparativo,
  etiquetaComparativo,
  mismasDe,
  parConNino,
  situacionTienda,
  variacionMismas,
  variacionTotal,
} from "@/lib/direccion/comparativos";
import { vaciarCachesDireccion } from "@/lib/direccion/servicio";
import { variacionPct } from "@/lib/direccion/textos";
import type { TableroApi } from "@/lib/direccion/tipos-api";
import { base } from "./direccion.fake-db";
import { CD1, G_HOMBRE, M_URBANO, T01, T02, T03, T04, T09, T10, T12, Y, bloquesCaso } from "./direccion.fixture";
import { lectorDeTablero, montarCaso } from "./direccion.montaje";

/** Ficha 14 · R7: comparativos (sobre sumas, mismas tiendas con `M(Z)` de las claves guardadas, años del Niño, motivos). Sintético. */

const ver = lectorDeTablero(tablero);
beforeEach(() => montarCaso(vaciarCachesDireccion));
const HU = { generos: G_HOMBRE, mundo_id: M_URBANO };
const de = (t: TableroApi, clave: string) => {
  const c = t.kpis.comparativos.find((x) => x.clave === clave);
  if (!c) throw new Error(`falta ${clave}`);
  return c;
};

describe("variaciones (puro)", () => {
  it("% sobre sumas; `nueva` si el anterior es 0 y el actual mayor; `sin_base` si no hay anterior; `incompleto` manda", () => {
    expect(variacionPct(110, 100)).toBeCloseTo(10, 9);
    expect(variacionPct(5, 0)).toBeNull();
    expect(variacionPct(5, -3)).toBeNull();
    expect(variacionTotal({ actual: 110, anterior: 100, incompleto: false })).toEqual({ pct: variacionPct(110, 100), motivo: null });
    expect(variacionTotal({ actual: 5, anterior: 0, incompleto: false })).toEqual({ pct: null, motivo: "nueva" });
    expect(variacionTotal({ actual: 0, anterior: 0, incompleto: false })).toEqual({ pct: null, motivo: "sin_base" });
    expect(variacionTotal({ actual: 5, anterior: -2, incompleto: false })).toEqual({ pct: null, motivo: "sin_base" });
    expect(variacionTotal({ actual: 110, anterior: 100, incompleto: true })).toEqual({ pct: null, motivo: "incompleto" });
    expect(variacionMismas(null)).toEqual({ pct: null, tiendas: [], motivo: "sin_base", pct_corregido: null });
    expect(variacionMismas({ actual: 10, anterior: 8, tiendas: [], incompleto: false })).toEqual({ pct: null, tiendas: [], motivo: "sin_base", pct_corregido: null });
    expect(variacionMismas({ actual: 10, anterior: 8, tiendas: ["T01"], incompleto: true })).toEqual({ pct: null, tiendas: ["T01"], motivo: "incompleto", pct_corregido: null });
    expect(variacionMismas({ actual: 10, anterior: 8, tiendas: ["T01"], incompleto: false })).toEqual({ pct: 25, tiendas: ["T01"], motivo: null, pct_corregido: null });
    expect(variacionMismas({ actual: 10, anterior: 8, anteriorCorregido: 10, tiendas: ["T01"], incompleto: false }).pct_corregido).toBe(0);
  });

  it("nunca es un promedio de %: dos partes de +100 % y −50 % dan el % de la suma", () => {
    // 10 → 20 (+100 %) y 1 000 → 500 (−50 %): el promedio de % sería +25 %; sobre sumas es −48,5 %.
    const c = comparativo({ clave: "sig_vs_cierre", etiqueta: "x", nino: false, total: { actual: 520, anterior: 1010, incompleto: false }, mismas: null });
    expect(c.total.pct).toBeCloseTo((520 / 1010 - 1) * 100, 9);
    expect(c.total.pct).not.toBeCloseTo(25, 0);
  });

  it("años y etiquetas de cada par; los pares con un año del Niño lo dicen", () => {
    expect(aniosDeComparativo("sig_vs_cierre", 2026)).toEqual([2027, 2026]);
    expect(aniosDeComparativo("sig_vs_anterior", 2026)).toEqual([2027, 2025]);
    expect(aniosDeComparativo("anterior_vs_hace_dos", 2026)).toEqual([2025, 2024]);
    const nino = new Set([2023, 2026]);
    expect(etiquetaComparativo("sig_vs_cierre", 2026, 10, nino)).toBe("2027 vs 2026 cierre");
    expect(etiquetaComparativo("sig_vs_anterior", 2026, 10, nino)).toBe("2027 vs 2025 (último año normal)");
    expect(etiquetaComparativo("ac_vs_ac", 2026, 10, nino)).toBe("2026 ene–oct vs 2025 ene–oct");
    expect(etiquetaComparativo("sig_vs_anterior", 2026, 10, new Set())).toBe("2027 vs 2025");
    expect(parConNino("sig_vs_cierre", 2026, nino)).toBe(true);
    expect(parConNino("sig_vs_anterior", 2026, nino)).toBe(false);
    expect(parConNino("cierre_vs_anterior", 2026, nino)).toBe(true);
    expect(parConNino("anterior_vs_hace_dos", 2026, nino)).toBe(false);
  });
});

describe("conjuntos de tiendas de los bloques guardados", () => {
  const bloques = bloquesCaso();
  it("`M(Z)` sale de la clave de pertenencia de cada tienda", () => {
    const codigos = (ids: Set<string>) => [...ids].sort();
    expect(codigos(mismasDe(bloques, Y, Y + 1))).toEqual([T01, T02, T03, T10].sort());
    expect(codigos(mismasDe(bloques, Y, Y))).toEqual([T01, T02, T03, T04].sort());
    expect(codigos(mismasDe(bloques, Y, Y - 1))).toEqual([T01, T02, T03, T04].sort());
    // T09 cerró el 2024-08-31: fue misma tienda en 2023 y ya no en 2024.
    expect(mismasDe(bloques, Y, Y - 3).has(T09)).toBe(true);
    expect(mismasDe(bloques, Y, Y - 2).has(T09)).toBe(false);
    expect(mismasDe(bloques, Y, Y + 1).has(CD1)).toBe(false);
  });
  it("situación (para agrupar el filtro) y clase (para la atribución)", () => {
    expect([T01, T10, T12, T04, T09, CD1].map((t) => situacionTienda(bloques, Y, t))).toEqual(["mismas", "mismas", "aperturas", "cierres", "fuera", "fuera"]);
    expect([T01, T10, T12, T04, T09].map((t) => claseTienda(bloques, Y, t))).toEqual(["misma", "entra", "otra", "sale", "otra"]);
  });
});

describe("R7 · comparativos del caso de §6.1", () => {
  it("HOMBRE · URBANO: total y mismas tiendas, con el conjunto `M(Z)` de cada par", async () => {
    const t = await ver(HU);
    // 2025 ene–set 33 000 y 2026 ene–set 34 000: +3,0 % (el tablero compara ene–oct, que es lo publicado).
    expect(de(t, "ac_vs_ac").total.pct).toBeCloseTo((38300 / 36455 - 1) * 100, 9);
    expect(de(t, "ac_vs_ac").etiqueta).toBe("2026 ene–oct vs 2025 ene–oct");
    expect(de(t, "cierre_vs_anterior").total.pct).toBeCloseTo((50001 / 47000 - 1) * 100, 9);
    expect(de(t, "cierre_vs_anterior").total.pct).toBeCloseTo(6.4, 1);
    expect(de(t, "cierre_vs_hace_dos").total.pct).toBeCloseTo(19.0, 0);
    expect(de(t, "sig_vs_cierre").total.pct).toBeCloseTo(5.4, 1);
    expect(de(t, "sig_vs_anterior").total.pct).toBeCloseTo(12.1, 1);

    // Mismas 2026 vs 2025: `M(2026)` = T01–T04 arriba y abajo: 45 901 ÷ 46 700 − 1 = −1,7 %.
    expect(de(t, "cierre_vs_anterior").mismas).toEqual({ pct: variacionPct(45901, 46700), tiendas: ["T01", "T02", "T03", "T04"], motivo: null, pct_corregido: null });
    // Mismas 2027 vs 2026: `M(2027)` = T01, T02, T03 y T10: Σ vigente ÷ Σ B − 1 = +6,9 %.
    // … y +5,2 % sobre la base corregida del Niño (47 793).
    expect(de(t, "sig_vs_cierre").mismas).toEqual({ pct: variacionPct(50300, 47040), tiendas: ["T01", "T02", "T03", "T10"], motivo: null, pct_corregido: variacionPct(50300, 47793) });
    // En lo que va: las mismas tiendas de 2026, 34 290 frente a 36 455.
    expect(de(t, "ac_vs_ac").mismas.pct).toBeCloseTo((34290 / 36455 - 1) * 100, 9);
    // 2027 vs 2025: solo las tiendas de `M(2027)` abiertas todo 2025 (T10 abrió en noviembre de 2025 y no entra).
    expect(de(t, "sig_vs_anterior").mismas.tiendas).toEqual(["T01", "T02", "T03"]);
    expect(de(t, "sig_vs_anterior").mismas.pct).toBeCloseTo(((23749 + 14250 + 7917) / (22000 + 14000 + 7500) - 1) * 100, 9);
    expect(de(t, "anterior_vs_hace_dos").mismas.tiendas).toEqual(["T01", "T02", "T03", "T04"]);
    expect(de(t, "anterior_vs_hace_dos").mismas.pct).toBeCloseTo((46700 / 41700 - 1) * 100, 9);

    expect(t.kpis.comparativos.map((c) => [c.clave, c.nino])).toEqual([
      ["sig_vs_cierre", true],
      ["sig_vs_anterior", false],
      ["cierre_vs_anterior", true],
      ["cierre_vs_hace_dos", true],
      ["ac_vs_ac", true],
      ["anterior_vs_hace_dos", false],
    ]);
  });

  it("toda la proyección: 2027 +7,9 % sobre el cierre 2026 y +13,7 % sobre 2025; mismas tiendas +9,0 % sobre real", async () => {
    const t = await ver();
    expect(de(t, "sig_vs_cierre").total.pct).toBeCloseTo((84714 / 78501 - 1) * 100, 9);
    expect(de(t, "sig_vs_anterior").total.pct).toBeCloseTo((84714 / 74500 - 1) * 100, 9);
    expect(de(t, "sig_vs_cierre").mismas.pct).toBeCloseTo((82306 / 75540 - 1) * 100, 9);
  });

  it("cambiar la fecha de una tienda en M4 después de calcular no cambia el conjunto: manda la clave guardada", async () => {
    const antes = await ver(HU);
    // «Hoy» T04 ya no cerraría (no se usa: la pantalla lee las tiendas del maestro solo para nombres).
    const m = await import("./direccion.fixture");
    const t04 = m.TIENDAS.find((x) => x.id === T04);
    if (!t04) throw new Error("falta T04");
    const cierre = t04.fecha_cierre;
    t04.fecha_cierre = null;
    vaciarCachesDireccion();
    const despues = await ver(HU);
    t04.fecha_cierre = cierre;
    expect(de(despues, "sig_vs_cierre").mismas).toEqual(de(antes, "sig_vs_cierre").mismas);
    expect(de(despues, "cierre_vs_anterior").mismas).toEqual(de(antes, "cierre_vs_anterior").mismas);
    expect(despues.datos.tiendas.find((x) => x.tienda_id === T04)?.situacion).toBe("cierres");
  });

  it("falta una carga: los comparativos que usan ese año salen `incompleto`, hay alerta y el año se marca parcial", async () => {
    base.tablas.cargas_venta_stock = (base.tablas.cargas_venta_stock ?? []).filter((c) => String(c.periodo).slice(0, 7) !== "2024-03");
    const t = await ver(HU);
    expect(t.datos.meses_faltantes).toEqual(["2024-03"]);
    expect(de(t, "cierre_vs_hace_dos").total).toEqual({ pct: null, motivo: "incompleto" });
    expect(de(t, "cierre_vs_hace_dos").mismas.motivo).toBe("incompleto");
    expect(de(t, "anterior_vs_hace_dos").total.motivo).toBe("incompleto");
    expect(de(t, "cierre_vs_anterior").total.motivo).toBeNull();
    expect(t.series.find((s) => s.clave === "real_2024")?.tipo).toBe("real_parcial");
    expect(t.series.find((s) => s.clave === "real_2024")?.meses[2]).toBeNull();
    const alerta = t.alertas.find((a) => a.codigo === "meses_faltantes");
    expect(alerta?.nivel).toBe("importante");
    expect(alerta?.detalle).toBe("Falta mar 2024: 2024 está incompleto.");
    expect(t.desglose.total.anios.find((a) => a.anio === 2024)?.tipo).toBe("real_parcial");
  });

  it("con una tienda elegida, «mismas» es esa tienda si pertenece a `M(Z)`", async () => {
    const t = await ver({ ...HU, tiendas: T03 });
    expect(de(t, "sig_vs_cierre").mismas).toMatchObject({ pct: variacionPct(7917, 7404), tiendas: ["T03"], motivo: null });
    expect(de(t, "sig_vs_cierre").mismas.pct_corregido).toBeCloseTo((7917 / ((7404 * 47793) / 47040) - 1) * 100, 9);
    expect(de(t, "cierre_vs_anterior").mismas.pct).toBeCloseTo((7404 / 7500 - 1) * 100, 9);
    // T10 no es de `M(2026)`: sin conjunto para «2026 vs 2025».
    const t10 = await ver({ ...HU, tiendas: T10 });
    expect(de(t10, "cierre_vs_anterior").mismas).toEqual({ pct: null, tiendas: [], motivo: "sin_base", pct_corregido: null });
    expect(de(t10, "sig_vs_cierre").mismas.tiendas).toEqual(["T10"]);
    expect(de(t10, "sig_vs_cierre").mismas.pct).toBeCloseTo((4384 / 4100 - 1) * 100, 9);
  });
});
