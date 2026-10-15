import { describe, expect, it } from "vitest";
import { leerVentaEstacionalidad } from "@/lib/curvas/agregado";
import { armarEntradaCorrida, unidadesSinAgrupacion, ventaPorTienda } from "@/lib/curvas/entrada";
import { datosFixture, filasFixture, parametros, T1 } from "./curvas.fixture";

describe("leerVentaEstacionalidad", () => {
  const ok = {
    agrupacion: [
      { tienda_id: "t1", periodo: "2024-03-01", unidades: 10, venta_soles: "1500.50", costo_vendido: 700 },
      { tienda_id: "t2", periodo: "2024-04-01", unidades: "7", venta_soles: 700, costo_vendido: null },
    ],
    temporadas: [
      { temporada: "invierno", tienda_id: "t1", periodo: "2024-03-01", unidades: 12030 },
      { temporada: "sin_agrupacion", tienda_id: "t1", periodo: "2024-03-01", unidades: "7" },
    ],
    meses_publicados: ["2024-03-01", "2024-04-01"],
    cargas: { "2024-04-01": "c2", "2024-03-01": "c1" },
  };
  it("normaliza periodos (aaaa-mm), números como texto y las cargas; meses_publicados sale de las llaves de cargas, ordenadas", () => {
    const r = leerVentaEstacionalidad(ok)!;
    expect(r.agrupacion![0]).toEqual({ tienda_id: "t1", periodo: "2024-03", unidades: 10, venta_soles: 1500.5, costo_vendido: 700 });
    expect(r.agrupacion![1]).toMatchObject({ unidades: 7, costo_vendido: 0 });
    expect(r.temporadas[1]).toEqual({ temporada: "sin_agrupacion", tienda_id: "t1", periodo: "2024-03", unidades: 7 });
    expect(r.cargas).toEqual({ "2024-03": "c1", "2024-04": "c2" });
    expect(r.meses_publicados).toEqual(["2024-03", "2024-04"]);
  });
  it("agrupacion nula (Años Niño) se conserva como null", () => {
    expect(leerVentaEstacionalidad({ ...ok, agrupacion: null })!.agrupacion).toBeNull();
  });
  it("devuelve null si la forma no es la esperada (incluida la falta de cargas)", () => {
    expect(leerVentaEstacionalidad(null)).toBeNull();
    expect(leerVentaEstacionalidad({ ...ok, temporadas: undefined })).toBeNull();
    const { cargas: _c, ...sinCargas } = ok;
    void _c;
    expect(leerVentaEstacionalidad(sinCargas)).toBeNull();
    expect(leerVentaEstacionalidad({ ...ok, cargas: { "2024-03-01": 5 } })).toBeNull();
    expect(leerVentaEstacionalidad({ ...ok, agrupacion: [{ tienda_id: 1, periodo: "2024-03-01" }] })).toBeNull();
    expect(leerVentaEstacionalidad({ ...ok, temporadas: [{ temporada: "otoño", tienda_id: "t", periodo: "2024-03-01", unidades: 1 }] })).toBeNull();
    expect(leerVentaEstacionalidad({ ...ok, temporadas: [{ temporada: "invierno", tienda_id: "t", periodo: "2024-03-01", unidades: "abc" }] })).toBeNull();
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
