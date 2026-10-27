import { describe, expect, it } from "vitest";
import { esMia, filtroMioInicial, tieneMisLineas } from "@/lib/flujo/mio";

/** Regla 9 de la ficha 08: «Mis líneas» es un filtro, nunca un permiso. */

const HOMBRE_URBANO = { genero_id: "g-h", mundo_id: "m-urbano" };
const HOMBRE_FORMAL = { genero_id: "g-h", mundo_id: "m-formal" };
const MUJER_CASUAL = { genero_id: "g-m", mundo_id: "m-casual" };

describe("esMia (regla 9)", () => {
  it("una fila de HOMBRE × URBANO es mía si soy responsable de esa combinación", () => {
    expect(esMia(HOMBRE_URBANO, [HOMBRE_URBANO])).toBe(true);
    expect(esMia(HOMBRE_FORMAL, [HOMBRE_URBANO])).toBe(false);
    expect(esMia({ genero_id: "g-h", mundo_id: "m-casual" }, [HOMBRE_URBANO])).toBe(false);
  });

  it("un lote es mío si algún g de su reparto lo es", () => {
    expect(esMia([HOMBRE_FORMAL, MUJER_CASUAL, HOMBRE_URBANO], [HOMBRE_URBANO])).toBe(true);
    expect(esMia([HOMBRE_FORMAL, MUJER_CASUAL], [HOMBRE_URBANO])).toBe(false);
    expect(esMia([], [HOMBRE_URBANO])).toBe(false);
  });

  it("un planner sin combinaciones tiene «Mis líneas» vacío y la pantalla abre en Todas", () => {
    expect(esMia(HOMBRE_URBANO, [])).toBe(false);
    expect(tieneMisLineas([])).toBe(false);
    expect(filtroMioInicial([])).toBe("todas");
    expect(filtroMioInicial([HOMBRE_URBANO])).toBe("mias");
  });

  it("C2 (HOMBRE × FORMAL y MUJER × CASUAL) ve suyo lo de CAMISA y SANDALIA, no lo de DENIM", () => {
    const c2 = [HOMBRE_FORMAL, MUJER_CASUAL];
    expect(esMia(HOMBRE_FORMAL, c2)).toBe(true);
    expect(esMia(MUJER_CASUAL, c2)).toBe(true);
    expect(esMia(HOMBRE_URBANO, c2)).toBe(false);
  });

  it("sin unidad (nodo desconocido) nunca es mía", () => {
    expect(esMia(null, [HOMBRE_URBANO])).toBe(false);
    expect(esMia(undefined, [HOMBRE_URBANO])).toBe(false);
  });
});
