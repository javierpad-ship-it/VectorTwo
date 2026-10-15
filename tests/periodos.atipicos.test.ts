import { describe, expect, it } from "vitest";
import {
  aniosAEvaluar,
  aniosAtipicidad,
  claseDeAnio,
  contarMeses,
  mesesAtipicos,
  periodoAplica,
  rangoValido,
  temporadaDeLinea,
  temporadaSugerida,
  temporadaSugeridaDistinta,
} from "@/lib/curvas/atipicos";
import { listarMeses } from "@/lib/ventas/periodo";
import { ABRIGO, NINO_2023, PUBLICADOS_2023_2026_09, TODO_EL_ANO, VERANO, periodoFx } from "./periodos.fixture";

describe("regla 6 · mesesAtipicos", () => {
  it("un periodo de alcance invierno aplica solo a las agrupaciones de invierno", () => {
    expect([...mesesAtipicos([NINO_2023], ABRIGO)]).toEqual(["2023-03", "2023-04", "2023-05"]);
    expect(mesesAtipicos([NINO_2023], VERANO).size).toBe(0);
    expect(mesesAtipicos([NINO_2023], TODO_EL_ANO).size).toBe(0);
  });
  it("un periodo de alcance todas aplica a las tres temporadas", () => {
    const todas = periodoFx("p", "2023-03", "2023-05", { alcance: "todas" });
    for (const a of [ABRIGO, VERANO, TODO_EL_ANO]) expect(mesesAtipicos([todas], a).size).toBe(3);
  });
  it("un periodo inactivo no aplica", () => {
    expect(mesesAtipicos([periodoFx("p", "2023-03", "2023-05", { activo: false })], ABRIGO).size).toBe(0);
    expect(periodoAplica({ alcance: "todas", activo: false }, "invierno")).toBe(false);
  });
  it("dos periodos solapados cuentan cada mes una vez (la unión)", () => {
    const meses = mesesAtipicos([periodoFx("a", "2023-03", "2023-05"), periodoFx("b", "2023-05", "2023-07")], ABRIGO);
    expect([...meses].sort()).toEqual(["2023-03", "2023-04", "2023-05", "2023-06", "2023-07"]);
  });
  it("desde = hasta es un mes; un rango que cruza de año recorre diciembre y enero", () => {
    expect([...mesesAtipicos([periodoFx("a", "2024-02", "2024-02")], ABRIGO)]).toEqual(["2024-02"]);
    expect([...mesesAtipicos([periodoFx("a", "2023-11", "2024-02")], ABRIGO)]).toEqual(["2023-11", "2023-12", "2024-01", "2024-02"]);
  });
});

describe("regla 6b · claseDeAnio (contrato para M7)", () => {
  it("año sin meses atípicos: normal, completo si los doce meses están publicados", () => {
    expect(claseDeAnio(2024, ABRIGO, [NINO_2023], PUBLICADOS_2023_2026_09)).toEqual({
      anio: 2024,
      clase: "normal",
      meses_atipicos: [],
      periodos: [],
      completo: true,
    });
  });
  it("año con meses atípicos: atipico con la lista ordenada y los periodos que los cubren", () => {
    const r = claseDeAnio(2023, ABRIGO, [NINO_2023], PUBLICADOS_2023_2026_09);
    expect(r).toEqual({
      anio: 2023,
      clase: "atipico",
      meses_atipicos: ["2023-03", "2023-04", "2023-05"],
      periodos: [{ id: "nino-2023", motivo: "Niño costero 2023", alcance: "invierno", temporadas: ["invierno"] }],
      completo: true,
    });
  });
  it("un periodo con meses futuros da atipico y completo false (2026-03 a 2026-05 con solo ene y feb publicados)", () => {
    const p = periodoFx("n26", "2026-03", "2026-05");
    const r = claseDeAnio(2026, ABRIGO, [p], ["2026-01", "2026-02"]);
    expect(r.clase).toBe("atipico");
    expect(r.completo).toBe(false);
    expect(r.meses_atipicos).toEqual(["2026-03", "2026-04", "2026-05"]);
  });
  it("el año en curso (enero a septiembre publicados) es completo false aunque sea normal", () => {
    expect(claseDeAnio(2026, VERANO, [], PUBLICADOS_2023_2026_09)).toMatchObject({ clase: "normal", completo: false });
  });
  it("un año con un mes sin publicar no es completo", () => {
    const sinJunio = PUBLICADOS_2023_2026_09.filter((m) => m !== "2024-06");
    expect(claseDeAnio(2024, ABRIGO, [], sinJunio).completo).toBe(false);
    expect(claseDeAnio(2025, ABRIGO, [], sinJunio).completo).toBe(true);
  });
  it("una agrupación de verano con un periodo de alcance invierno da normal; con alcance todas, atipico", () => {
    expect(claseDeAnio(2023, VERANO, [NINO_2023], PUBLICADOS_2023_2026_09).clase).toBe("normal");
    expect(claseDeAnio(2023, TODO_EL_ANO, [NINO_2023], PUBLICADOS_2023_2026_09).clase).toBe("normal");
    const todas = periodoFx("t", "2023-03", "2023-05", { alcance: "todas" });
    expect(claseDeAnio(2023, VERANO, [todas], PUBLICADOS_2023_2026_09).clase).toBe("atipico");
  });
  it("un periodo inactivo no cuenta", () => {
    const inactivo = periodoFx("i", "2023-03", "2023-05", { activo: false });
    expect(claseDeAnio(2023, ABRIGO, [inactivo], PUBLICADOS_2023_2026_09)).toMatchObject({ clase: "normal", periodos: [] });
  });
  it("un periodo que cruza de año aporta solo los meses de cada año y aparece en los dos", () => {
    const p = periodoFx("c", "2023-11", "2024-02");
    expect(claseDeAnio(2023, ABRIGO, [p], []).meses_atipicos).toEqual(["2023-11", "2023-12"]);
    expect(claseDeAnio(2024, ABRIGO, [p], []).meses_atipicos).toEqual(["2024-01", "2024-02"]);
    expect(claseDeAnio(2025, ABRIGO, [p], []).clase).toBe("normal");
  });
  it("varios periodos en un año: lista ordenada por desde y luego id, sin repetir meses solapados", () => {
    const b = periodoFx("b", "2023-05", "2023-06");
    const a = periodoFx("a", "2023-03", "2023-05");
    const r = claseDeAnio(2023, ABRIGO, [b, a], []);
    expect(r.meses_atipicos).toEqual(["2023-03", "2023-04", "2023-05", "2023-06"]);
    expect(r.periodos.map((p) => p.id)).toEqual(["a", "b"]);
  });
  it("acepta los meses publicados como aaaa-mm-01 y como cualquier iterable", () => {
    const comoFecha = new Set(listarMeses("2024-01", "2024-12").map((m) => `${m}-01`));
    expect(claseDeAnio(2024, ABRIGO, [], comoFecha).completo).toBe(true);
  });
  it("CONTRATO: claves y tipos de la salida (M7 depende de esto)", () => {
    const r = claseDeAnio(2023, ABRIGO, [NINO_2023], PUBLICADOS_2023_2026_09);
    expect(Object.keys(r).sort()).toEqual(["anio", "clase", "completo", "meses_atipicos", "periodos"]);
    expect(typeof r.anio).toBe("number");
    expect(["normal", "atipico"]).toContain(r.clase);
    expect(Array.isArray(r.meses_atipicos)).toBe(true);
    expect(r.meses_atipicos.every((m) => /^\d{4}-\d{2}$/.test(m))).toBe(true);
    expect(typeof r.completo).toBe("boolean");
    // Paso 2: cada periodo suma `temporadas` (lo que M7 debe leer); `alcance` queda como espejo heredado.
    expect(Object.keys(r.periodos[0]).sort()).toEqual(["alcance", "id", "motivo", "temporadas"]);
    expect(Array.isArray(r.periodos[0].temporadas)).toBe(true);
  });
});

describe("rangoValido y contarMeses", () => {
  it("hasta no puede ser anterior a desde; un mes es válido; formatos malos no", () => {
    expect(rangoValido("2023-03", "2023-05")).toBe(true);
    expect(rangoValido("2023-03", "2023-03")).toBe(true);
    expect(rangoValido("2023-05", "2023-03")).toBe(false);
    expect(rangoValido("2023-13", "2024-01")).toBe(false);
    expect(rangoValido("2023-3", "2023-05")).toBe(false);
  });
  it("cuenta los meses inclusive y cruza años", () => {
    expect(contarMeses("2023-03", "2023-05")).toBe(3);
    expect(contarMeses("2023-03", "2023-03")).toBe(1);
    expect(contarMeses("2023-11", "2024-02")).toBe(4);
    expect(contarMeses("2023-05", "2023-03")).toBe(0);
  });
});

describe("GET /api/periodos-atipicos/anios · años evaluados y respuesta", () => {
  it("por defecto: del primer al último año publicado, con 2026 atípico incompleto y 2023 atípico completo (hito del paso 1)", () => {
    const n26 = periodoFx("n26", "2026-03", "2026-04", { motivo: "Niño costero 2026" });
    const { anios, resumen } = aniosAtipicidad({
      agrupacion: ABRIGO,
      periodos: [NINO_2023, n26],
      mesesPublicados: PUBLICADOS_2023_2026_09,
    });
    expect(anios.map((a) => [a.anio, a.clase, a.completo])).toEqual([
      [2023, "atipico", true],
      [2024, "normal", true],
      [2025, "normal", true],
      [2026, "atipico", false],
    ]);
    expect(anios.every((a) => a.ratio_volumen === null)).toBe(true);
    expect(resumen).toEqual({ anios_atipicos: [2023, 2026], anios_normales_completos: [2024, 2025] });
  });
  it("una agrupación de verano ve 2023 normal", () => {
    const { anios, resumen } = aniosAtipicidad({ agrupacion: VERANO, periodos: [NINO_2023], mesesPublicados: PUBLICADOS_2023_2026_09 });
    expect(anios[0]).toMatchObject({ anio: 2023, clase: "normal" });
    expect(resumen.anios_atipicos).toEqual([]);
    expect(resumen.anios_normales_completos).toEqual([2023, 2024, 2025]);
  });
  it("agrega los años de periodos activos futuros que aplican, pero no los de otros alcances ni los inactivos", () => {
    const futuro = periodoFx("f", "2027-02", "2027-03");
    const inactivo = periodoFx("i", "2028-01", "2028-01", { activo: false });
    const soloInvierno = (agrupacion: typeof ABRIGO | typeof VERANO) =>
      aniosAEvaluar({ agrupacion, periodos: [futuro, inactivo], mesesPublicados: PUBLICADOS_2023_2026_09 });
    expect(soloInvierno(ABRIGO)).toEqual([2023, 2024, 2025, 2026, 2027]);
    expect(soloInvierno(VERANO)).toEqual([2023, 2024, 2025, 2026]);
  });
  it("un periodo antes del primer mes publicado no agrega años (solo se evalúa el histórico y lo futuro)", () => {
    expect(aniosAEvaluar({ agrupacion: ABRIGO, periodos: [periodoFx("v", "2020-03", "2020-05")], mesesPublicados: PUBLICADOS_2023_2026_09 })).toEqual([
      2023, 2024, 2025, 2026,
    ]);
  });
  it("sin ningún mes publicado: los años de los periodos que aplican", () => {
    expect(aniosAEvaluar({ agrupacion: ABRIGO, periodos: [NINO_2023, periodoFx("f", "2026-03", "2026-05")], mesesPublicados: [] })).toEqual([
      2023, 2026,
    ]);
    expect(aniosAEvaluar({ agrupacion: ABRIGO, periodos: [], mesesPublicados: [] })).toEqual([]);
  });
  it("con desde y hasta: el rango completo; con uno solo: recorta el conjunto por defecto", () => {
    const base = { agrupacion: ABRIGO, periodos: [NINO_2023], mesesPublicados: PUBLICADOS_2023_2026_09 };
    expect(aniosAEvaluar({ ...base, desde: 2022, hasta: 2024 })).toEqual([2022, 2023, 2024]);
    expect(aniosAEvaluar({ ...base, desde: 2025 })).toEqual([2025, 2026]);
    expect(aniosAEvaluar({ ...base, hasta: 2024 })).toEqual([2023, 2024]);
  });
  it("sin meses publicados y sin periodos: sin años y resumen vacío", () => {
    expect(aniosAtipicidad({ agrupacion: ABRIGO, periodos: [], mesesPublicados: [] })).toEqual({
      anios: [],
      resumen: { anios_atipicos: [], anios_normales_completos: [] },
    });
  });
  it("CONTRATO: cada año trae las claves de claseDeAnio más ratio_volumen y volumen (null sin corrida de referencia)", () => {
    const { anios } = aniosAtipicidad({ agrupacion: ABRIGO, periodos: [NINO_2023], mesesPublicados: PUBLICADOS_2023_2026_09 });
    expect(Object.keys(anios[0]).sort()).toEqual(["anio", "clase", "completo", "meses_atipicos", "periodos", "ratio_volumen", "volumen"]);
    expect(anios.every((a) => a.ratio_volumen === null && a.volumen === null)).toBe(true);
  });
});

describe("regla 8e · temporada sugerida", () => {
  it("temporadaDeLinea traduce las etiquetas de M1 a códigos", () => {
    expect(temporadaDeLinea("Verano")).toBe("verano");
    expect(temporadaDeLinea("Invierno")).toBe("invierno");
    expect(temporadaDeLinea("Todo el año")).toBe("todo_el_ano");
    expect(temporadaDeLinea("lo que sea")).toBe("todo_el_ano");
  });
  it("todas las líneas de Invierno → invierno; dos Invierno y una Todo el año → invierno", () => {
    expect(temporadaSugerida(["Invierno", "Invierno", "Invierno"])).toBe("invierno");
    expect(temporadaSugerida(["Invierno", "Invierno", "Todo el año"])).toBe("invierno");
  });
  it("empate o lista vacía → todo_el_ano", () => {
    expect(temporadaSugerida(["Invierno", "Todo el año"])).toBe("todo_el_ano");
    expect(temporadaSugerida(["Invierno", "Verano"])).toBe("todo_el_ano");
    expect(temporadaSugerida([])).toBe("todo_el_ano");
  });
  it("un empate por abajo no impide una mayoría clara", () => {
    expect(temporadaSugerida(["Verano", "Invierno", "Todo el año", "Verano"])).toBe("verano");
    expect(temporadaSugerida(["Todo el año", "Verano", "Invierno", "Verano", "Verano"])).toBe("verano");
  });
  it("acepta objetos con temporada (la forma de las líneas)", () => {
    expect(temporadaSugerida([{ temporada: "Verano" }, { temporada: "Verano" }, { temporada: "Invierno" }])).toBe("verano");
  });
  it("aviso temporada_sugerida_distinta: ABRIGO con todas sus líneas de Invierno y marcada todo_el_ano avisa; sin equivalencias no", () => {
    expect(temporadaSugeridaDistinta("todo_el_ano", "invierno", 140)).toBe(true);
    expect(temporadaSugeridaDistinta("invierno", "invierno", 140)).toBe(false);
    expect(temporadaSugeridaDistinta("invierno", "todo_el_ano", 0)).toBe(false);
  });
});
