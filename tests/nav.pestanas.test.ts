import { describe, expect, it } from "vitest";
import { NAV_SECTIONS, esActivo, hrefDe, puedeVerRuta } from "@/lib/nav";

const links = NAV_SECTIONS.flatMap((s) => s.links);
const curvas = links.find((l) => l.label === "Curvas de estacionalidad")!;
const crecimiento = links.find((l) => l.label === "Crecimiento por GM")!;
const RUTA = "/planificacion/curvas-estacionalidad";

describe("menú: Crecimiento por GM", () => {
  it("tiene entrada propia que abre la pestaña", () => {
    expect(hrefDe(crecimiento)).toBe(`${RUTA}?pestana=genero-mundo`);
    expect(hrefDe(curvas)).toBe(RUTA);
  });

  it("solo uno de los dos items está activo en la página de curvas", () => {
    expect(esActivo(RUTA, curvas, null, false)).toBe(true);
    expect(esActivo(RUTA, crecimiento, null, false)).toBe(false);
    expect(esActivo(RUTA, curvas, "genero-mundo", false)).toBe(false);
    expect(esActivo(RUTA, crecimiento, "genero-mundo", false)).toBe(true);
  });

  it("el detalle de un género × mundo (?gm=) cuenta como la pestaña de crecimiento", () => {
    expect(esActivo(RUTA, crecimiento, null, true)).toBe(true);
    expect(esActivo(RUTA, curvas, null, true)).toBe(false);
  });

  it("otras pestañas de curvas dejan activo a Curvas", () => {
    expect(esActivo(RUTA, curvas, "anios-nino", false)).toBe(true);
    expect(esActivo(RUTA, crecimiento, "anios-nino", false)).toBe(false);
  });

  it("fuera de la página no se activa", () => {
    expect(esActivo("/planificacion/proyeccion", crecimiento, "genero-mundo", false)).toBe(false);
  });

  it("solo admin y planner pueden abrir la ruta", () => {
    expect(puedeVerRuta("planner", RUTA)).toBe(true);
    expect(puedeVerRuta("admin", RUTA)).toBe(true);
    expect(puedeVerRuta("comprador", RUTA)).toBe(false);
  });
});
