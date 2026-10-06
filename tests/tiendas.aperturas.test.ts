import { describe, expect, it } from "vitest";
import { agruparPorMes, etiquetaMes, eventosTiendas, type TiendaParaEventos } from "@/lib/tiendas/aperturas";

const HOY = "2026-10-05";

const tienda = (
  codigo: string,
  fecha_apertura: string | null,
  fecha_cierre: string | null = null,
  extra: Partial<TiendaParaEventos> = {}
): TiendaParaEventos => ({
  id: `id-${codigo}`,
  codigo,
  nombre: `TIENDA ${codigo}`,
  tipo: "Tienda",
  zona: null,
  fecha_apertura,
  fecha_cierre,
  venta_esperada_promedio: null,
  activo: true,
  ...extra,
});

describe("eventosTiendas (regla 10)", () => {
  it("una tienda con apertura y cierre produce dos eventos; sin fechas, ninguno", () => {
    const r = eventosTiendas([tienda("R500", "2010-06-01", "2026-12-31"), tienda("R510", null)], HOY);
    expect(r.hoy).toBe(HOY);
    expect(r.eventos.map((e) => [e.codigo, e.evento])).toEqual([
      ["R500", "apertura"],
      ["R500", "cierre"],
    ]);
  });
  it("orden por fecha y luego código", () => {
    const r = eventosTiendas(
      [tienda("R512", "2027-03-01"), tienda("R401", "2019-03-15"), tienda("R300", "2027-03-01"), tienda("R500", "2010-06-01", "2026-12-31")],
      HOY
    );
    expect(r.eventos.map((e) => `${e.fecha} ${e.codigo} ${e.evento}`)).toEqual([
      "2010-06-01 R500 apertura",
      "2019-03-15 R401 apertura",
      "2026-12-31 R500 cierre",
      "2027-03-01 R300 apertura",
      "2027-03-01 R512 apertura",
    ]);
  });
  it("pasado es fecha < hoy: apertura hoy y cierre hoy no pasaron", () => {
    const r = eventosTiendas([tienda("A", HOY), tienda("B", "2019-01-01", HOY), tienda("C", "2019-01-01", "2026-10-04")], HOY);
    const porClave = Object.fromEntries(r.eventos.map((e) => [`${e.codigo}-${e.evento}`, e.pasado]));
    expect(porClave).toEqual({
      "A-apertura": false,
      "B-apertura": true,
      "B-cierre": false,
      "C-apertura": true,
      "C-cierre": true,
    });
  });
  it("cada evento lleva el estado de su tienda a hoy y sus datos", () => {
    const r = eventosTiendas(
      [tienda("R512", "2027-03-01", null, { zona: "LUKERS SUR ORIENTE", venta_esperada_promedio: 85000 })],
      HOY
    );
    expect(r.eventos[0]).toEqual({
      fecha: "2027-03-01",
      evento: "apertura",
      pasado: false,
      tienda_id: "id-R512",
      codigo: "R512",
      nombre: "TIENDA R512",
      tipo: "Tienda",
      zona: "LUKERS SUR ORIENTE",
      estado: "Planificada",
      venta_esperada_promedio: 85000,
    });
    // Con hoy = la fecha de apertura, la misma tienda sale Activa (hito del plan).
    expect(eventosTiendas([tienda("R512", "2027-03-01")], "2027-03-01").eventos[0].estado).toBe("Activa");
  });
  it("resumen: próximas aperturas y cierres cuentan eventos no pasados; sin_fecha_apertura solo tiendas activas de tipo Tienda", () => {
    const r = eventosTiendas(
      [
        tienda("R401", "2019-03-15"),
        tienda("R500", "2010-06-01", "2026-12-31"),
        tienda("R512", "2027-03-01"),
        tienda("R510", null),
        tienda("R520", null, null, { activo: false }),
        tienda("RD50", null, null, { tipo: "Centro de Distribución" }),
        tienda("R530", "2019-01-01", "2020-01-01"),
      ],
      HOY
    );
    expect(r.resumen).toEqual({ proximas_aperturas: 1, proximos_cierres: 1, sin_fecha_apertura: 1 });
  });
  it("desde/hasta acotan los eventos (inclusive) y los próximos, no sin_fecha_apertura", () => {
    const tiendas = [tienda("R401", "2019-03-15"), tienda("R500", "2010-06-01", "2026-12-31"), tienda("R512", "2027-03-01"), tienda("R510", null)];
    const r = eventosTiendas(tiendas, HOY, { desde: "2026-01-01", hasta: "2026-12-31" });
    expect(r.eventos.map((e) => e.codigo)).toEqual(["R500"]);
    expect(r.resumen).toEqual({ proximas_aperturas: 0, proximos_cierres: 1, sin_fecha_apertura: 1 });
    expect(eventosTiendas(tiendas, HOY, { desde: "2027-03-01" }).eventos.map((e) => e.codigo)).toEqual(["R512"]);
  });
  it("sin tiendas → vacío con resumen en cero", () => {
    expect(eventosTiendas([], HOY)).toEqual({
      hoy: HOY,
      eventos: [],
      resumen: { proximas_aperturas: 0, proximos_cierres: 0, sin_fecha_apertura: 0 },
    });
  });
});

describe("agruparPorMes (regla 11)", () => {
  it("etiqueta de mes en español", () => {
    expect(etiquetaMes("2027-03")).toBe("marzo de 2027");
    expect(etiquetaMes("2019-01")).toBe("enero de 2019");
    expect(etiquetaMes("2026-12")).toBe("diciembre de 2026");
  });
  it("grupos cronológicos sin meses vacíos; la suma de eventos es el total", () => {
    const { eventos } = eventosTiendas(
      [tienda("R512", "2027-03-01"), tienda("R401", "2019-03-15"), tienda("R300", "2027-03-20"), tienda("R500", "2010-06-01", "2026-12-31")],
      HOY
    );
    const grupos = agruparPorMes(eventos);
    expect(grupos.map((g) => [g.mes, g.etiqueta, g.eventos.length])).toEqual([
      ["2010-06", "junio de 2010", 1],
      ["2019-03", "marzo de 2019", 1],
      ["2026-12", "diciembre de 2026", 1],
      ["2027-03", "marzo de 2027", 2],
    ]);
    expect(grupos.reduce((n, g) => n + g.eventos.length, 0)).toBe(eventos.length);
    expect(grupos[3].eventos.map((e) => e.codigo)).toEqual(["R512", "R300"]);
  });
  it("ordena aunque los eventos lleguen desordenados; vacío → []", () => {
    const { eventos } = eventosTiendas([tienda("A", "2027-03-01"), tienda("B", "2019-03-15")], HOY);
    expect(agruparPorMes([...eventos].reverse()).map((g) => g.mes)).toEqual(["2019-03", "2027-03"]);
    expect(agruparPorMes([])).toEqual([]);
  });
});
