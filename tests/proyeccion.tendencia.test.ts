import { describe, expect, it } from "vitest";
import { tendenciaUltimoAnioPct, factorMensualGlobal } from "@/lib/proyeccion/tendencia";
import type { TiendaMaestro } from "@/lib/curvas/tipos";

const meses = (anio: number) => Array.from({ length: 12 }, (_, i) => `${anio}-${String(i + 1).padStart(2, "0")}`);
const tienda = (id: string, apertura: string, cierre: string | null = null): TiendaMaestro => ({ id, codigo: id, nombre: id, tipo: "Tienda", activo: true, fecha_apertura: apertura, fecha_cierre: cierre });
const todos = [...meses(2024), ...meses(2025), ...meses(2026)].filter((m) => m <= "2026-09");
const venta = (id: string, porAnio: Record<number, number>) => Object.entries(porAnio).flatMap(([a, u]) => meses(Number(a)).map((periodo) => ({ tienda_id: id, periodo, unidades: u / 12 })));

describe("tendencia del último año completo (ficha 07, paso 1 y 8)", () => {
  const base = { anioEnCurso: 2026, publicados: todos, periodos: [], factores: [] };

  it("total(2025) ÷ total(2024) − 1 sobre las tiendas de M(2025) ∩ M(2026), en %", () => {
    const tiendas = [tienda("A", "2020-01-01"), tienda("B", "2020-01-01"), tienda("N", "2025-06-01")];
    const v = [...venta("A", { 2024: 1200, 2025: 1320 }), ...venta("B", { 2024: 600, 2025: 660 }), ...venta("N", { 2025: 5000 })];
    // N abrió en 2025: no entra. (1320 + 660) ÷ (1200 + 600) − 1 = 10 %.
    expect(tendenciaUltimoAnioPct({ ...base, tiendas, venta: v })).toBe(10);
  });

  it("una tienda que cierra en 2026 no está en M(2026): no cuenta", () => {
    const tiendas = [tienda("A", "2020-01-01"), tienda("C", "2020-01-01", "2026-05-31")];
    const v = [...venta("A", { 2024: 1000, 2025: 1100 }), ...venta("C", { 2024: 1000, 2025: 100 })];
    expect(tendenciaUltimoAnioPct({ ...base, tiendas, venta: v })).toBe(10);
  });

  it("falta un mes de 2024 o 2025 → null; sin tiendas comunes → null; 2024 sin venta → null", () => {
    const tiendas = [tienda("A", "2020-01-01")];
    const v = venta("A", { 2024: 1200, 2025: 1320 });
    expect(tendenciaUltimoAnioPct({ ...base, tiendas, venta: v, publicados: todos.filter((m) => m !== "2024-03") })).toBeNull();
    expect(tendenciaUltimoAnioPct({ ...base, tiendas: [tienda("N", "2026-02-01")], venta: v })).toBeNull();
    expect(tendenciaUltimoAnioPct({ ...base, tiendas, venta: venta("A", { 2025: 1320 }) })).toBeNull();
  });

  it("el Niño se normaliza: un año de venta baja por el factor no se lee como caída", () => {
    const tiendas = [tienda("A", "2020-01-01")];
    const periodos = [{ id: "p", desde: "2025-01", hasta: "2025-12", motivo: "Niño 2025", alcance: "invierno", temporadas: ["invierno"], activo: true }] as never;
    const factores = [{ anio: 2025, temporada: "invierno" as const, ratio_calculado: null, ratio_aplicado: 0.5 }];
    const v = venta("A", { 2024: 1200, 2025: 600 });
    const sin = tendenciaUltimoAnioPct({ ...base, tiendas, venta: v });
    const con = tendenciaUltimoAnioPct({ ...base, tiendas, venta: v, periodos, factores });
    expect(sin).toBe(-50);
    expect(con).not.toBeNull();
    expect(con as number).toBeGreaterThan(-50);
  });

  it("factorMensualGlobal sin periodos atípicos son doce unos", () => {
    expect(factorMensualGlobal(2025, [], [])).toEqual(Array(12).fill(1));
  });
});
