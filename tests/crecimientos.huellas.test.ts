import { describe, expect, it } from "vitest";
import { huellaComposicionGM, huellaDatosGM, huellaFactoresNino, huellaPeriodosNino, type PartesHuellaDatos } from "@/lib/crecimientos/huellas";

/** `huella_datos`: el bloqueo optimista del POST cambia con todo lo que cambia una cifra y no depende del orden (sintético). */

const base: PartesHuellaDatos = {
  anio: 2027,
  cargas_huella: "c1",
  marcas: { nodos: "2026-10-01T10:00:00Z", equivalencias: "2026-10-01T11:00:00Z", agrupaciones: "2026-10-01T12:00:00Z" },
  red_huella: "r1",
  periodos_huella: "p1",
  factores_huella: "f1",
  proyeccion: { id: "p", calculado_at: "2026-10-20T10:00:00Z", version_metodo: 4 },
};

describe("huellaDatosGM", () => {
  it("es md5 y estable", () => {
    expect(huellaDatosGM(base)).toMatch(/^[0-9a-f]{32}$/);
    expect(huellaDatosGM({ ...base })).toBe(huellaDatosGM(base));
  });

  it("cambia con cada parte", () => {
    const h = huellaDatosGM(base);
    const cambios: Partial<PartesHuellaDatos>[] = [
      { anio: 2028 },
      { cargas_huella: "c2" },
      { marcas: { ...base.marcas, nodos: "x" } },
      { marcas: { ...base.marcas, equivalencias: "x" } },
      { marcas: { ...base.marcas, agrupaciones: "x" } },
      { red_huella: "r2" },
      { periodos_huella: "p2" },
      { factores_huella: "f2" },
      { proyeccion: null },
      { proyeccion: { ...(base.proyeccion as object), id: "otra" } as PartesHuellaDatos["proyeccion"] },
      { proyeccion: { ...(base.proyeccion as object), calculado_at: "2026-10-21T00:00:00Z" } as PartesHuellaDatos["proyeccion"] },
      { proyeccion: { ...(base.proyeccion as object), version_metodo: 3 } as PartesHuellaDatos["proyeccion"] },
    ];
    for (const c of cambios) expect(huellaDatosGM({ ...base, ...c }), JSON.stringify(c)).not.toBe(h);
  });
});

describe("huellas de periodos y factores del Niño", () => {
  const periodos = [
    { id: "a", desde: "2026-06", hasta: "2026-08", activo: true, temporadas: ["verano", "invierno"] },
    { id: "b", desde: "2023-06-01", hasta: "2023-08-01", activo: true },
  ];
  const factores = [
    { anio: 2026, temporada: "invierno", ratio_calculado: 0.8, ratio_aplicado: null, parcial: true },
    { anio: 2023, temporada: "invierno", ratio_calculado: 0.9, ratio_aplicado: 0.95 },
  ];

  it("no dependen del orden de entrada ni del formato de la fecha", () => {
    expect(huellaPeriodosNino([...periodos].reverse())).toBe(huellaPeriodosNino(periodos));
    expect(huellaPeriodosNino([{ ...periodos[0]!, temporadas: ["invierno", "verano"] }, periodos[1]!])).toBe(huellaPeriodosNino(periodos));
    expect(huellaFactoresNino([...factores].reverse())).toBe(huellaFactoresNino(factores));
  });

  it("cambian con un rango, un estado, un factor o su carácter parcial", () => {
    expect(huellaPeriodosNino([{ ...periodos[0]!, hasta: "2026-09" }, periodos[1]!])).not.toBe(huellaPeriodosNino(periodos));
    expect(huellaPeriodosNino([{ ...periodos[0]!, activo: false }, periodos[1]!])).not.toBe(huellaPeriodosNino(periodos));
    expect(huellaFactoresNino([{ ...factores[0]!, ratio_aplicado: 0.7 }, factores[1]!])).not.toBe(huellaFactoresNino(factores));
    expect(huellaFactoresNino([{ ...factores[0]!, parcial: false }, factores[1]!])).not.toBe(huellaFactoresNino(factores));
  });

  it("la composición de un GM no depende del orden de los nodos", () => {
    expect(huellaComposicionGM(["n2", "n1"])).toBe(huellaComposicionGM(["n1", "n2"]));
    expect(huellaComposicionGM(["n1"])).not.toBe(huellaComposicionGM(["n1", "n2"]));
  });
});
