import { describe, expect, it } from "vitest";
import { leerAgregado } from "@/lib/curvas/agregado";
import { armarEntradaCorrida, unidadesSinAgrupacion, ventaPorTienda } from "@/lib/curvas/entrada";
import { datosFixture, filasFixture, parametros, T1 } from "./curvas.fixture";

describe("leerAgregado", () => {
  const ok = {
    refresco: { filas: 85385, duracion_ms: 2300, refrescada_at: "2026-10-14T10:00:00Z" },
    filas: [
      { agrupacion_id: "a1", tienda_id: "t1", periodo: "2024-03-01", unidades: 10, venta_soles: "1500.50", costo_vendido: 700 },
      { agrupacion_id: null, tienda_id: "t1", periodo: "2024-03-01", unidades: "7", venta_soles: 700, costo_vendido: null },
    ],
  };
  it("normaliza periodos (aaaa-mm), números como texto y la agrupación nula", () => {
    const r = leerAgregado(ok)!;
    expect(r.refresco).toEqual({ filas: 85385, duracion_ms: 2300, refrescada_at: "2026-10-14T10:00:00Z" });
    expect(r.filas[0]).toEqual({ agrupacion_id: "a1", tienda_id: "t1", periodo: "2024-03", unidades: 10, venta_soles: 1500.5, costo_vendido: 700 });
    expect(r.filas[1]).toMatchObject({ agrupacion_id: null, unidades: 7, costo_vendido: 0 });
  });
  it("devuelve null si la forma no es la esperada", () => {
    expect(leerAgregado(null)).toBeNull();
    expect(leerAgregado({ refresco: {} })).toBeNull();
    expect(leerAgregado({ filas: [{ tienda_id: 1, periodo: "2024-03-01" }] })).toBeNull();
    expect(leerAgregado({ filas: [{ tienda_id: "t", periodo: "2024-03-01", unidades: "abc" }] })).toBeNull();
  });
  it("sin refresco usa valores neutros", () => {
    expect(leerAgregado({ filas: [] })).toEqual({ refresco: { filas: 0, duracion_ms: 0, refrescada_at: null }, filas: [] });
  });
});

describe("armarEntradaCorrida (series sobre la red de cada año)", () => {
  const p = parametros();
  const entrada = armarEntradaCorrida(datosFixture("base"), p);
  it("una serie por año de la corrida, con doce meses y los meses publicados marcados", () => {
    const a = entrada.agrupaciones.find((x) => x.agrupacion_id === "abrigo")!;
    expect(a.unidades.map((s) => s.anio)).toEqual([2023, 2024, 2025, 2026]);
    expect(a.unidades[0].completo).toBe(true);
    expect(a.unidades[3].completo).toBe(false);
    expect(a.unidades[3].publicados.filter(Boolean)).toHaveLength(9);
    expect(a.unidades[1].meses[5]).toBe(240);
  });
  it("suma solo las tiendas de la red de cada año (T3 aparece en 2026 y no antes)", () => {
    const a = entrada.agrupaciones.find((x) => x.agrupacion_id === "abrigo")!;
    const t3 = a.por_tienda.find((t) => t.tienda_id === "t3")!;
    expect(t3.unidades.map((s) => s.anio)).toEqual([2026]);
    expect(a.por_tienda.find((t) => t.tienda_id === T1)!.unidades.map((s) => s.anio)).toEqual([2023, 2024, 2025, 2026]);
    // 2025 no incluye a T3 aunque ya vendiera en noviembre y diciembre.
    expect(a.unidades[2].meses[11]).toBe(60);
  });
  it("venta y costo van sobre la misma red (para el CV %)", () => {
    const a = entrada.agrupaciones.find((x) => x.agrupacion_id === "abrigo")!;
    expect(a.venta[1].meses[5]).toBe(24000);
    expect(a.costo[1].meses[5]).toBe(12000);
  });
  it("ventaPorTienda suma todas las agrupaciones (la nula incluida) por tienda y mes", () => {
    const v = ventaPorTienda(filasFixture("base"));
    const t1Marzo2024 = v.find((x) => x.tienda_id === T1 && x.periodo === "2024-03")!;
    // ABRIGO 60 + VERANO 80 + CONSTANTE 100 + 7 sin agrupación.
    expect(t1Marzo2024.unidades).toBe(60 + 80 + 100 + 7);
  });
  it("unidadesSinAgrupacion suma las filas con agrupación nula hasta hasta_periodo", () => {
    expect(unidadesSinAgrupacion(filasFixture("base"), "2026-09")).toBeGreaterThan(7);
    expect(unidadesSinAgrupacion(filasFixture("base"), "2024-02")).toBe(5 * 8 + 0 + 0);
  });
  it("ignora lo posterior a hasta_periodo", () => {
    const corto = armarEntradaCorrida({ ...datosFixture("base"), hasta_periodo: "2025-12" }, p);
    expect(corto.redes.map((r) => r.anio)).toEqual([2023, 2024, 2025]);
    expect(corto.meses_publicados.at(-1)).toBe("2025-12");
  });
});
