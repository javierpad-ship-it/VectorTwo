import { describe, expect, it } from "vitest";
import { clasesControl } from "@/components/ui/form";

const tiene = (clases: string, c: string) => clases.split(/\s+/).includes(c);

describe("clasesControl (Select e Input)", () => {
  it("sin className conserva el aspecto de siempre: h-10 y w-full", () => {
    const c = clasesControl();
    expect(tiene(c, "h-10")).toBe(true);
    expect(tiene(c, "w-full")).toBe(true);
    expect(tiene(c, "px-3")).toBe(true);
  });

  it("con un className sin ancho ni alto no cambia los valores por defecto", () => {
    const c = clasesControl("font-mono max-w-xs");
    expect(tiene(c, "h-10")).toBe(true);
    expect(tiene(c, "w-full")).toBe(true);
    expect(tiene(c, "font-mono")).toBe(true);
  });

  it("un ancho pedido quita w-full", () => {
    for (const w of ["w-44", "w-[4.75rem]", "w-auto", "w-auto!", "md:w-1/2"]) {
      const c = clasesControl(`h-8 ${w}`);
      expect(tiene(c, "w-full"), w).toBe(false);
      expect(tiene(c, w), w).toBe(true);
    }
  });

  it("un alto pedido quita h-10", () => {
    for (const h of ["h-8", "h-9", "h-8!"]) {
      const c = clasesControl(h);
      expect(tiene(c, "h-10"), h).toBe(false);
      expect(tiene(c, h), h).toBe(true);
      expect(tiene(c, "w-full"), h).toBe(true);
    }
  });

  it("max-w y min-w no cuentan como ancho", () => {
    const c = clasesControl("h-8 max-w-xs min-w-28");
    expect(tiene(c, "w-full")).toBe(true);
  });

  it("si el className trae su propio w-full no lo duplica", () => {
    const c = clasesControl("h-8 w-full min-w-28 max-w-40");
    expect(c.split(/\s+/).filter((x) => x === "w-full")).toHaveLength(1);
  });
});
