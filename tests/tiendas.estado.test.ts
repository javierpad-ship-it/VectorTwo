import { afterEach, describe, expect, it, vi } from "vitest";
import { esEstadoTienda, esTipoTienda, estadoTienda, hoyLima } from "@/lib/tiendas/estado";
import { ESTADOS_TIENDA, TIPOS_TIENDA } from "@/lib/tiendas/tipos";

const HOY = "2026-10-05";
const t = (fecha_apertura: string | null, fecha_cierre: string | null = null) => ({ fecha_apertura, fecha_cierre });

describe("estadoTienda (regla 1)", () => {
  it("sin apertura → Planificada (también un CD sin fechas)", () => {
    expect(estadoTienda(t(null), HOY)).toBe("Planificada");
  });
  it("apertura mañana → Planificada; apertura hoy → Activa; apertura pasada sin cierre → Activa", () => {
    expect(estadoTienda(t("2026-10-06"), HOY)).toBe("Planificada");
    expect(estadoTienda(t("2026-10-05"), HOY)).toBe("Activa");
    expect(estadoTienda(t("2019-03-15"), HOY)).toBe("Activa");
  });
  it("cierre futuro → Activa; cierre hoy → Activa (último día con venta); cierre ayer → Cerrada", () => {
    expect(estadoTienda(t("2019-03-15", "2026-12-31"), HOY)).toBe("Activa");
    expect(estadoTienda(t("2019-03-15", "2026-10-05"), HOY)).toBe("Activa");
    expect(estadoTienda(t("2019-03-15", "2026-10-04"), HOY)).toBe("Cerrada");
  });
  it("sin apertura pero con cierre pasado (fila imposible por el check) → Planificada, sin reventar", () => {
    expect(estadoTienda(t(null, "2020-01-01"), HOY)).toBe("Planificada");
  });
  it("abrió y cerró el mismo día: Activa ese día, Cerrada al siguiente", () => {
    expect(estadoTienda(t("2026-10-05", "2026-10-05"), "2026-10-05")).toBe("Activa");
    expect(estadoTienda(t("2026-10-05", "2026-10-05"), "2026-10-06")).toBe("Cerrada");
  });
});

describe("hoyLima (regla 2)", () => {
  afterEach(() => vi.useRealTimers());

  it("a las 23:30 de Lima del 5 de octubre (04:30Z del 6) sigue siendo 2026-10-05", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-05T23:30:00-05:00"));
    expect(hoyLima()).toBe("2026-10-05");
    expect(new Date().toISOString().slice(0, 10)).toBe("2026-10-06"); // lo que daría UTC
  });
  it("acepta una fecha explícita y devuelve aaaa-mm-dd con ceros", () => {
    expect(hoyLima(new Date("2027-03-01T05:00:00Z"))).toBe("2027-03-01");
    expect(hoyLima(new Date("2027-03-01T04:59:59Z"))).toBe("2027-02-28");
  });
});

describe("esEstadoTienda / esTipoTienda (regla 3)", () => {
  it("solo los valores exactos", () => {
    for (const e of ESTADOS_TIENDA) expect(esEstadoTienda(e)).toBe(true);
    for (const t of TIPOS_TIENDA) expect(esTipoTienda(t)).toBe(true);
    expect(esEstadoTienda("activa")).toBe(false);
    expect(esEstadoTienda("ACTIVA")).toBe(false);
    expect(esEstadoTienda("")).toBe(false);
    expect(esEstadoTienda(null)).toBe(false);
    expect(esTipoTienda("CD")).toBe(false);
    expect(esTipoTienda("tienda")).toBe(false);
    expect(esTipoTienda(undefined)).toBe(false);
  });
});
