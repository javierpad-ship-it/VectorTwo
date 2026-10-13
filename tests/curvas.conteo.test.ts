import { describe, expect, it } from "vitest";
import { contarAgrupaciones } from "../src/app/(app)/planificacion/curvas-estacionalidad/conteo";
import type { AgrupacionConTemporada } from "../src/app/(app)/planificacion/curvas-estacionalidad/tipos";

function agr(extra: Partial<AgrupacionConTemporada>): AgrupacionConTemporada {
  return {
    id: "x",
    codigo: "X",
    nombre: "X",
    orden: 0,
    activo: true,
    temporada: "todo_el_ano",
    temporada_sugerida: "todo_el_ano",
    temporada_sugerida_distinta: false,
    equivalencias_activas: 1,
    ...extra,
  } as unknown as AgrupacionConTemporada;
}

describe("contarAgrupaciones", () => {
  it("cuenta solo las activas y deja las inactivas aparte", () => {
    const c = contarAgrupaciones([
      agr({ temporada: "invierno" }),
      agr({ temporada: "verano" }),
      agr({ temporada: "todo_el_ano" }),
      agr({ temporada: "invierno", activo: false }),
    ]);
    expect(c).toEqual({ activas: 3, invierno: 1, verano: 1, todo_el_ano: 1, distinta: 0, inactivas: 1 });
  });

  it("cuenta como distinta solo a las activas cuya temporada difiere de la sugerida", () => {
    const c = contarAgrupaciones([
      agr({ temporada: "todo_el_ano", temporada_sugerida: "invierno", temporada_sugerida_distinta: true }),
      agr({ temporada: "todo_el_ano", temporada_sugerida: "invierno", temporada_sugerida_distinta: true, activo: false }),
      agr({ temporada_sugerida_distinta: false }),
    ]);
    expect(c.distinta).toBe(1);
    expect(c.inactivas).toBe(1);
    expect(c.activas).toBe(2);
  });

  it("los tres conteos de temporada suman las activas", () => {
    const c = contarAgrupaciones([agr({ temporada: "invierno" }), agr({ temporada: "invierno" }), agr({ temporada: "verano" })]);
    expect(c.invierno + c.verano + c.todo_el_ano).toBe(c.activas);
  });
});
