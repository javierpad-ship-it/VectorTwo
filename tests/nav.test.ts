import { describe, expect, it } from "vitest";
import { puedeVerRuta, seccionesVisibles } from "@/lib/nav";

describe("puedeVerRuta", () => {
  it("el comprador ve el árbol de producto (solo lectura)", () => {
    expect(puedeVerRuta("comprador", "/maestros/arbol")).toBe(true);
  });
  it("el comprador no entra a los otros maestros", () => {
    expect(puedeVerRuta("comprador", "/maestros/marcas")).toBe(false);
    expect(puedeVerRuta("comprador", "/maestros/tiendas")).toBe(false);
  });
  it("las subrutas heredan el permiso del padre", () => {
    expect(puedeVerRuta("comprador", "/maestros/arbol/catalogos")).toBe(true);
    expect(puedeVerRuta("planner", "/maestros/arbol/catalogos")).toBe(true);
  });
  it("admin y planner entran a agrupaciones y marcas (M2); el comprador no", () => {
    expect(puedeVerRuta("admin", "/maestros/marcas")).toBe(true);
    expect(puedeVerRuta("planner", "/maestros/marcas")).toBe(true);
    expect(puedeVerRuta("comprador", "/maestros/marcas")).toBe(false);
  });
  it("los módulos pendientes no se pueden abrir aunque el rol los vea en el menú", () => {
    expect(puedeVerRuta("admin", "/maestros/tiendas")).toBe(false);
    expect(puedeVerRuta("planner", "/maestros/estacionalidad")).toBe(false);
  });
  it("solo el admin entra a usuarios", () => {
    expect(puedeVerRuta("admin", "/usuarios")).toBe(true);
    expect(puedeVerRuta("planner", "/usuarios")).toBe(false);
    expect(puedeVerRuta("comprador", "/usuarios")).toBe(false);
  });
  it("el inicio es de todos", () => {
    expect(puedeVerRuta("comprador", "/")).toBe(true);
  });
});

describe("seccionesVisibles", () => {
  it("al comprador la sección Maestros solo le muestra el árbol", () => {
    const maestros = seccionesVisibles("comprador").find((s) => s.title === "Maestros");
    expect(maestros?.links.map((l) => l.href)).toEqual(["/maestros/arbol"]);
  });
  it("el planner ve los cuatro maestros", () => {
    const maestros = seccionesVisibles("planner").find((s) => s.title === "Maestros");
    expect(maestros?.links).toHaveLength(4);
  });
});
