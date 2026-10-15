import { describe, expect, it } from "vitest";
import { redComparable, sumarMesesAFecha, ultimoDiaDelMes } from "@/lib/curvas/red";
import { ventaPorTienda } from "@/lib/curvas/entrada";
import { diagnosticarTiendas } from "@/lib/curvas/red";
import { listarMeses } from "@/lib/ventas/periodo";
import { PARAMETROS_POR_DEFECTO } from "@/lib/curvas/tipos-api";
import type { TiendaMaestro, VentaTiendaMes } from "@/lib/curvas/tipos";
import { CD, PUBLICADOS, T1, T2, T3, T4, filasFixture, parametros, tiendasFixture } from "./curvas.fixture";

const ANIOS = [2023, 2024, 2025, 2026];
const red = (variante: Parameters<typeof tiendasFixture>[0] = "base", extra = {}, hasta = "2026-09") =>
  redComparable(tiendasFixture(variante), ventaPorTienda(filasFixture(variante)), ANIOS, hasta, parametros(extra), { mesesPublicados: PUBLICADOS });
const entran = (r: ReturnType<typeof red>, anio: number) => r.find((x) => x.anio === anio)?.tiendas.filter((t) => t.entra).map((t) => t.tienda_id).sort();
const fila = (r: ReturnType<typeof red>, anio: number, id: string) => {
  const t = r.find((x) => x.anio === anio)?.tiendas.find((x) => x.tienda_id === id);
  if (!t) throw new Error("sin tienda");
  return t;
};

describe("regla 4 · red comparable con el fixture (caso 2b)", () => {
  const r = red();
  it("2023 → T1; 2024 → T1, T4; 2025 → T1, T2, T4; 2026 → T1, T2, T3, T4", () => {
    expect(entran(r, 2023)).toEqual([T1]);
    expect(entran(r, 2024)).toEqual([T1, T4].sort());
    expect(entran(r, 2025)).toEqual([T1, T2, T4].sort());
    expect(entran(r, 2026)).toEqual([T1, T2, T3, T4].sort());
  });
  it("T4 queda fuera de 2023 por FECHAS (no_abierta_todo_el_ano), sin aviso de apertura dudosa", () => {
    expect(fila(r, 2023, T4)).toMatchObject({ entra: false, motivos: ["no_abierta_todo_el_ano"], meses_sin_venta: [] });
  });
  it("T3 queda fuera de 2025 por fechas y entra en 2026; T2 fuera de 2024", () => {
    expect(fila(r, 2025, T3).motivos).toEqual(["no_abierta_todo_el_ano"]);
    expect(fila(r, 2024, T2).motivos).toEqual(["no_abierta_todo_el_ano"]);
  });
  it("el centro de distribución sale con centro_distribucion en todos los años", () => {
    for (const a of ANIOS) expect(fila(r, a, CD)).toMatchObject({ entra: false, motivos: ["centro_distribucion"] });
  });
  it("T4 desactivada → tienda_desactivada (tiene hechos, no se oculta)", () => {
    const d = red("t4_desactivada");
    expect(fila(d, 2025, T4)).toMatchObject({ entra: false, motivos: ["tienda_desactivada"] });
  });
  it("una tienda desactivada sin ninguna venta no aparece", () => {
    const tiendas: TiendaMaestro[] = [...tiendasFixture(), { id: "zz", codigo: "ZZ", nombre: "Cerrada", tipo: "Tienda", activo: false, fecha_apertura: null, fecha_cierre: null }];
    const resultado = redComparable(tiendas, ventaPorTienda(filasFixture()), ANIOS, "2026-09", parametros(), { mesesPublicados: PUBLICADOS });
    expect(resultado[0].tiendas.some((t) => t.tienda_id === "zz")).toBe(false);
  });
  it("años posteriores a hasta_periodo se ignoran", () => {
    const parcial = redComparable(tiendasFixture(), ventaPorTienda(filasFixture()), [...ANIOS, 2027], "2026-09", parametros(), { mesesPublicados: PUBLICADOS });
    expect(parcial.map((x) => x.anio)).toEqual(ANIOS);
  });
});

describe("pesos, dominante y distinta (caso 2c)", () => {
  const r = red();
  it("los pesos de las tiendas que entran suman 1 y figuran en todos los años", () => {
    for (const a of ANIOS) {
      const anio = r.find((x) => x.anio === a)!;
      const suma = anio.tiendas.filter((t) => t.entra).reduce((s, t) => s + t.peso, 0);
      expect(suma).toBeCloseTo(1, 9);
      expect(anio.peso_mayor).not.toBeNull();
    }
  });
  it("peso(T1, 2024) ≈ 0,99 y T1 es la dominante (sobre el umbral de 35 %)", () => {
    const a = r.find((x) => x.anio === 2024)!;
    expect(fila(r, 2024, T1).peso).toBeGreaterThan(0.98);
    expect(a.dominante).toBe(T1);
  });
  it("la dominante solo salta sobre el umbral: con umbral 0,9 y un reparto parejo no hay", () => {
    const parejo = redComparable(tiendasFixture(), ventaPorTienda(filasFixture()), [2026], "2026-09", parametros({ umbral_tienda_dominante: 0.9 }), { mesesPublicados: PUBLICADOS });
    expect(parejo[0].dominante).toBeNull();
  });
  it("en 2026 T3 (perfil distinto) es distinta y T2 (peso < 0,05) no", () => {
    const t3 = fila(r, 2026, T3);
    expect(t3.distinta).toBe(true);
    expect(t3.eat_vs_red).toBeGreaterThan(3);
    expect(t3.peso).toBeGreaterThan(0.05);
    expect(fila(r, 2026, T2).peso).toBeLessThan(0.05);
    expect(fila(r, 2026, T2).distinta).toBe(false);
  });
});

describe("diagnosticarTiendas", () => {
  const red12 = [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10].map((x) => x / 120);
  it("una tienda idéntica a la red da eat_vs_red = 0", () => {
    const [d] = diagnosticarTiendas([{ unidades: Array(12).fill(10) }], red12, 3, null, 0.05);
    expect(d.eat_vs_red).toBeCloseTo(0, 9);
    expect(d.distinta).toBe(false);
  });
  it("una con enero al doble y peso 2 % no es distinta (peso insuficiente); con más peso sí", () => {
    const chica = { unidades: [2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1] };
    const grande = { unidades: Array(12).fill(90) };
    const [c] = diagnosticarTiendas([chica, grande], red12, 3, null, 0.05);
    expect(c.peso).toBeLessThan(0.05);
    expect(c.eat_vs_red).toBeGreaterThan(3);
    expect(c.distinta).toBe(false);
    const [p] = diagnosticarTiendas([{ unidades: [200, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100] }, grande], red12, 3, null, 0.05);
    expect(p.distinta).toBe(true);
  });
  it("el umbral es relativo al ruido: con ruido alto no marca", () => {
    const t = { unidades: [20, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10] };
    expect(diagnosticarTiendas([t], red12, 3, null, 0.05)[0].distinta).toBe(true);
    expect(diagnosticarTiendas([t], red12, 3, 40, 0.05)[0].distinta).toBe(false);
  });
});

describe("regla 4b · tienda nueva", () => {
  it("con meses_tienda_nueva = 0 la tienda abierta el 2025-11-20 queda fuera de 2025 y entra en 2026", () => {
    const r = red("base", { meses_tienda_nueva: 0 });
    expect(fila(r, 2025, T3).motivos).toEqual(["no_abierta_todo_el_ano"]);
    expect(fila(r, 2026, T3).entra).toBe(true);
  });
  it("con 12 → tienda_nueva en 2026 (entra en 2027)", () => {
    const r = red("base", { meses_tienda_nueva: 12 });
    expect(fila(r, 2026, T3)).toMatchObject({ entra: false, motivos: ["tienda_nueva"], entra_desde: 2027 });
  });
  it("sumarMesesAFecha recorta el día y ultimoDiaDelMes entiende los bisiestos", () => {
    expect(sumarMesesAFecha("2025-11-30", 3)).toBe("2026-02-28");
    expect(sumarMesesAFecha("2023-11-30", 3)).toBe("2024-02-29");
    expect(ultimoDiaDelMes("2024-02")).toBe("2024-02-29");
    expect(ultimoDiaDelMes("2026-09")).toBe("2026-09-30");
  });
});

describe("regla 4c · venta en todo el año", () => {
  const base = (omitir: string[], extra: Partial<typeof PARAMETROS_POR_DEFECTO> = {}) => {
    const venta: VentaTiendaMes[] = listarMeses("2024-01", "2024-12")
      .filter((m) => !omitir.includes(m))
      .map((periodo) => ({ tienda_id: "a", periodo, unidades: 10 }));
    const tienda: TiendaMaestro = { id: "a", codigo: "A", nombre: "A", tipo: "Tienda", activo: true, fecha_apertura: "2020-01-01", fecha_cierre: null };
    return redComparable([tienda], venta, [2024], "2024-12", parametros(extra), { mesesPublicados: listarMeses("2024-01", "2024-12") });
  };
  it("unidades 0 (sin fila) en febrero → meses_sin_venta [2024-02] y la tienda sale", () => {
    const r = base(["2024-02"]);
    expect(r[0].tiendas[0]).toMatchObject({ entra: false, meses_sin_venta: ["2024-02"] });
    expect(r[0].tiendas[0].motivos).toContain("meses_sin_venta");
    expect(r[0].sin_red).toBe(true);
  });
  it("un mes negativo cuenta como sin venta", () => {
    const tienda: TiendaMaestro = { id: "a", codigo: "A", nombre: "A", tipo: "Tienda", activo: true, fecha_apertura: "2020-01-01", fecha_cierre: null };
    const venta = listarMeses("2024-01", "2024-12").map((periodo) => ({ tienda_id: "a", periodo, unidades: periodo === "2024-05" ? -3 : 10 }));
    const r = redComparable([tienda], venta, [2024], "2024-12", parametros(), { mesesPublicados: listarMeses("2024-01", "2024-12") });
    expect(r[0].tiendas[0].meses_sin_venta).toEqual(["2024-05"]);
  });
  it("con exigir_venta_todo_el_ano apagado la tienda entra aunque falte un mes", () => {
    expect(base(["2024-02"], { exigir_venta_todo_el_ano: false })[0].tiendas[0].entra).toBe(true);
  });
  it("en el año en curso solo se exigen los meses publicados hasta hasta_periodo", () => {
    const tienda: TiendaMaestro = { id: "a", codigo: "A", nombre: "A", tipo: "Tienda", activo: true, fecha_apertura: "2020-01-01", fecha_cierre: null };
    const venta = listarMeses("2026-01", "2026-09").map((periodo) => ({ tienda_id: "a", periodo, unidades: 5 }));
    const r = redComparable([tienda], venta, [2026], "2026-09", parametros(), { mesesPublicados: listarMeses("2026-01", "2026-09") });
    expect(r[0].tiendas[0].entra).toBe(true);
  });
  it("sin año con red: sin_red y participacion nula", () => {
    const r = base(["2024-02"]);
    expect(r[0]).toMatchObject({ sin_red: true, participacion: null, dominante: null });
  });
});

describe("regla 4d · fechas dudosas", () => {
  it("apertura 2021 y primera venta positiva en 2023-07: meses_sin_venta ene–jun y apertura_dudosa", () => {
    const r = red("apertura_dudosa");
    const t = fila(r, 2023, T4);
    expect(t.entra).toBe(false);
    expect(t.meses_sin_venta).toEqual(["2023-01", "2023-02", "2023-03", "2023-04", "2023-05", "2023-06"]);
    expect(t.motivos).toContain("apertura_dudosa");
    expect(t.primer_mes_con_venta).toBe("2023-07");
    expect(fila(r, 2024, T4).entra).toBe(true);
  });
  const un = (ventas: Record<string, number>, cierre: string | null = null) => {
    const tienda: TiendaMaestro = { id: "a", codigo: "A", nombre: "A", tipo: "Tienda", activo: true, fecha_apertura: "2020-01-01", fecha_cierre: cierre };
    const venta = Object.entries(ventas).map(([periodo, unidades]) => ({ tienda_id: "a", periodo, unidades }));
    return redComparable([tienda], venta, [2024], "2024-12", parametros(), { mesesPublicados: listarMeses("2024-01", "2024-12") }).at(0)!.tiendas[0];
  };
  const todos = (omitir: string[]) => Object.fromEntries(listarMeses("2024-01", "2024-12").filter((m) => !omitir.includes(m)).map((m) => [m, 10]));
  it("tramo contiguo al final y sin volver a vender: cierre_dudoso", () => {
    expect(un(todos(["2024-10", "2024-11", "2024-12"])).motivos).toContain("cierre_dudoso");
  });
  it("un hueco en medio: ni apertura ni cierre dudosos", () => {
    const t = un(todos(["2024-05"]));
    expect(t.motivos).toEqual(["meses_sin_venta"]);
  });
  it("sin fecha de apertura entra con el aviso tienda_sin_apertura", () => {
    const tienda: TiendaMaestro = { id: "a", codigo: "A", nombre: "A", tipo: "Tienda", activo: true, fecha_apertura: null, fecha_cierre: null };
    const venta = listarMeses("2024-01", "2024-12").map((periodo) => ({ tienda_id: "a", periodo, unidades: 10 }));
    const t = redComparable([tienda], venta, [2024], "2024-12", parametros(), { mesesPublicados: listarMeses("2024-01", "2024-12") })[0].tiendas[0];
    expect(t).toMatchObject({ entra: true, motivos: ["tienda_sin_apertura"] });
  });
  it("una fecha de cierre anterior al fin del año (o de hasta, en el año en curso) la saca", () => {
    expect(un(todos([]), "2024-06-30").motivos).toEqual(["no_abierta_todo_el_ano"]);
    expect(un(todos([]), "2024-12-31").entra).toBe(true);
  });
});
