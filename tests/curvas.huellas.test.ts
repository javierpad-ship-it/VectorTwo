import { describe, expect, it } from "vitest";
import { huellaCargas, huellaComposicion, huellaRed } from "@/lib/curvas/huellas";
import { tiendasFixture } from "./curvas.fixture";

describe("regla 22 · huellas", () => {
  it("huellaComposicion es md5 de los ids ordenados (no depende del orden de entrada)", () => {
    const a = huellaComposicion(["b", "a", "c"]);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(huellaComposicion(["c", "b", "a"])).toBe(a);
    expect(huellaComposicion(["a", "b"])).not.toBe(a);
    expect(huellaComposicion([])).toMatch(/^[0-9a-f]{32}$/);
  });
  it("huellaRed cambia si cambia una fecha de apertura, un cierre, activo o tipo; no con el nombre", () => {
    const base = tiendasFixture();
    const h = huellaRed(base);
    expect(huellaRed([...base].reverse())).toBe(h);
    const con = (i: number, cambio: Partial<(typeof base)[number]>) => huellaRed(base.map((t, j) => (j === i ? { ...t, ...cambio } : t)));
    expect(con(0, { fecha_apertura: "2024-03-01" })).not.toBe(h);
    expect(con(0, { fecha_cierre: "2026-01-31" })).not.toBe(h);
    expect(con(0, { activo: false })).not.toBe(h);
    expect(con(0, { tipo: "Centro de Distribución" })).not.toBe(h);
    expect(con(0, { nombre: "Otro nombre", codigo: "OTRO" })).toBe(h);
  });
  it("huellaCargas cambia si cambia un carga_id o entra un mes", () => {
    const base = { "2026-01": "c1", "2026-02": "c2" };
    const h = huellaCargas(base);
    expect(huellaCargas({ "2026-02": "c2", "2026-01": "c1" })).toBe(h);
    expect(huellaCargas({ ...base, "2026-02": "c9" })).not.toBe(h);
    expect(huellaCargas({ ...base, "2026-03": "c3" })).not.toBe(h);
  });
});
