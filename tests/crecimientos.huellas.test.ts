import { describe, expect, it } from "vitest";
import { huellaComposicionGM, huellaCurvasVigentes, huellaDatosGM, huellaFactoresNino, huellaPeriodosNino, huellaTiendasSiguiente, VERSION_REFERENCIAS, type PartesHuellaDatos } from "@/lib/crecimientos/huellas";

/**
 * `huella_datos`: el bloqueo optimista del POST cambia con todo lo que cambia una cifra y no depende del orden (sintético). Desde `0.14.0` (06e,
 * R21) cubre también las curvas vigentes, las tiendas de `M(Y+1)` y los factores de `Y` con sus columnas nuevas; `VERSION_REFERENCIAS = 2`.
 */

const base: PartesHuellaDatos = {
  anio: 2027,
  cargas_huella: "c1",
  marcas: { nodos: "2026-10-01T10:00:00Z", equivalencias: "2026-10-01T11:00:00Z", agrupaciones: "2026-10-01T12:00:00Z" },
  red_huella: "r1",
  periodos_huella: "p1",
  factores_huella: "f1",
  curvas_huella: "k1",
  tiendas_siguiente_huella: "t1",
  proyeccion: { id: "p", calculado_at: "2026-10-20T10:00:00Z", version_metodo: 5 },
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
      { curvas_huella: "k2" },
      { tiendas_siguiente_huella: "t2" },
      { proyeccion: null },
      { proyeccion: { ...(base.proyeccion as object), id: "otra" } as PartesHuellaDatos["proyeccion"] },
      { proyeccion: { ...(base.proyeccion as object), calculado_at: "2026-10-21T00:00:00Z" } as PartesHuellaDatos["proyeccion"] },
      { proyeccion: { ...(base.proyeccion as object), version_metodo: 4 } as PartesHuellaDatos["proyeccion"] },
    ];
    for (const c of cambios) expect(huellaDatosGM({ ...base, ...c }), JSON.stringify(c)).not.toBe(h);
  });
});

describe("R21 · versión de las referencias, curvas vigentes y tiendas de M(Y+1)", () => {
  it("VERSION_REFERENCIAS es 2 y entra en la huella", () => {
    expect(VERSION_REFERENCIAS).toBe(2);
  });

  it("cambiar la curva vigente de una agrupación (otro id o otra versión) cambia la huella; el orden no", () => {
    const curvas = [
      { agrupacion_id: "a1", id: "c1", version: 3 },
      { agrupacion_id: "a2", id: "c2", version: 1 },
    ];
    const h = huellaCurvasVigentes(curvas);
    expect(huellaCurvasVigentes([...curvas].reverse())).toBe(h);
    expect(huellaCurvasVigentes([{ agrupacion_id: "a1", id: "c1", version: 4 }, curvas[1]!])).not.toBe(h);
    expect(huellaCurvasVigentes([{ agrupacion_id: "a1", id: "c9", version: 3 }, curvas[1]!])).not.toBe(h);
    expect(huellaCurvasVigentes([curvas[0]!])).not.toBe(h);
    const completa = huellaDatosGM({ ...base, curvas_huella: h });
    expect(huellaDatosGM({ ...base, curvas_huella: huellaCurvasVigentes([{ agrupacion_id: "a1", id: "c1", version: 4 }, curvas[1]!]) })).not.toBe(completa);
  });

  it("una tienda que entra o sale de M(Y+1) cambia la huella; el orden no", () => {
    const h = huellaTiendasSiguiente(["t1", "t2", "t3"]);
    expect(huellaTiendasSiguiente(["t3", "t1", "t2"])).toBe(h);
    expect(huellaTiendasSiguiente(["t1", "t2", "t3", "t10"])).not.toBe(h);
    expect(huellaTiendasSiguiente(["t1", "t2"])).not.toBe(h);
  });

  it("los factores con sus columnas nuevas cambian la huella (fórmula, volumen, control, cargas, composición y confirmación)", () => {
    const f = { anio: 2026, temporada: "invierno", ratio_calculado: 0.7, ratio_aplicado: 0.7, parcial: true, formula: "relativo_periodo", ratio_volumen: 0.66, ratio_control: 0.94, huella_cargas: "h1", huella_composicion: "c1", aplicado_huella: "h1" };
    const h = huellaFactoresNino([f]);
    for (const cambio of [{ formula: null }, { ratio_volumen: 0.67 }, { ratio_control: 0.95 }, { huella_cargas: "h2" }, { huella_composicion: "c2" }, { aplicado_huella: "h2" }]) {
      expect(huellaFactoresNino([{ ...f, ...cambio }]), JSON.stringify(cambio)).not.toBe(h);
    }
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
