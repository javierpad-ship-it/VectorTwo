import { describe, expect, it } from "vitest";
import { PALETA_AGRUPACIONES, colorDeAgrupacion, mapaColores } from "@/lib/estacionalidad/colores";
import { estadoFx } from "./estacionalidad.fixture";

const agrupaciones = () => estadoFx().agrupaciones;

describe("colores de agrupación · asignación estable por `orden, nombre`", () => {
  it("la posición en el catálogo ordenado decide el color, no el orden del array", () => {
    const a = agrupaciones();
    // Por orden: VIEJA (5) · PANTALONES INVIERNO (10) · PANTALONES VERANO (20).
    expect(colorDeAgrupacion("a-old", a)).toBe(PALETA_AGRUPACIONES[0]);
    expect(colorDeAgrupacion("a-inv", a)).toBe(PALETA_AGRUPACIONES[1]);
    expect(colorDeAgrupacion("a-ver", a)).toBe(PALETA_AGRUPACIONES[2]);
    // Mismo catálogo barajado → mismos colores.
    const barajadas = [a[2], a[0], a[1]];
    expect(mapaColores(barajadas)).toEqual(mapaColores(a));
  });

  it("a igual `orden` desempata por nombre", () => {
    const m = mapaColores([
      { id: "b", orden: 1, nombre: "BLUSAS" },
      { id: "a", orden: 1, nombre: "ABRIGOS" },
    ]);
    expect(m.get("a")).toBe(PALETA_AGRUPACIONES[0]);
    expect(m.get("b")).toBe(PALETA_AGRUPACIONES[1]);
  });

  it("una inactiva conserva su posición: desactivarla no cambia el color de las demás", () => {
    const a = agrupaciones();
    const antes = mapaColores(a);
    const despues = mapaColores(a.map((x) => (x.id === "a-inv" ? { ...x, activo: false } : x)));
    expect(despues).toEqual(antes);
  });
});

describe("colores de agrupación · paleta", () => {
  it("tiene 12 colores distintos con fondo, texto y pleno en hexadecimal", () => {
    expect(PALETA_AGRUPACIONES).toHaveLength(12);
    const hex = /^#[0-9a-f]{6}$/;
    for (const c of PALETA_AGRUPACIONES) {
      expect(c.suave).toMatch(hex);
      expect(c.texto).toMatch(hex);
      expect(c.pleno).toMatch(hex);
    }
    expect(new Set(PALETA_AGRUPACIONES.map((c) => c.pleno)).size).toBe(12);
  });

  it("rota tras 12: la decimotercera repite el color de la primera", () => {
    const muchas = Array.from({ length: 14 }, (_, i) => ({ id: `id-${i}`, orden: i, nombre: `AGRUPACION ${i}` }));
    const m = mapaColores(muchas);
    expect(m.get("id-12")).toBe(PALETA_AGRUPACIONES[0]);
    expect(m.get("id-13")).toBe(PALETA_AGRUPACIONES[1]);
    expect(m.get("id-11")).toBe(PALETA_AGRUPACIONES[11]);
  });
});

describe("colores de agrupación · sin agrupación", () => {
  it("`null`, `undefined`, vacío o un id fuera del catálogo nunca reciben color", () => {
    const a = agrupaciones();
    expect(colorDeAgrupacion(null, a)).toBeNull();
    expect(colorDeAgrupacion(undefined, a)).toBeNull();
    expect(colorDeAgrupacion("", a)).toBeNull();
    expect(colorDeAgrupacion("a-no-existe", a)).toBeNull();
    expect(mapaColores(a).has("a-no-existe")).toBe(false);
  });

  it("con catálogo vacío no hay colores", () => {
    expect(mapaColores([]).size).toBe(0);
    expect(colorDeAgrupacion("a-inv", [])).toBeNull();
  });
});
