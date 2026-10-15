import { describe, expect, it } from "vitest";
import {
  alcanceEspejo,
  claseDeAnio,
  compararFormaAgrupacion,
  compararFormaAnio,
  compararFormaParcial,
  imputarHuecos,
  mesesAtipicos,
  periodoAplica,
  pocosAniosNormales,
  referencia,
  resolverTemporadas,
  ruidoNormal,
  temporadaSugeridaDistinta,
  temporadaSugeridaVisible,
  temporadasDePeriodo,
  tratamientoEfectivo,
} from "@/lib/curvas/atipicos";
import { eat } from "@/lib/curvas/backtesting";
import { efectoAtipicoCorrida, medirVolumen, ratioMensual, ratioVolumen, referenciaVolumen, type GrupoParaEfecto } from "@/lib/curvas/efecto";
import { normalizarCurva, participacion } from "@/lib/curvas/anios";
import { corridaFixture, PERIODOS_NINO, periodoFx, PUBLICADOS } from "./curvas.fixture";

const ABRIGO = { temporada: "invierno" } as const;
const VERANO = { temporada: "verano" } as const;
const TODO = { temporada: "todo_el_ano" } as const;

describe("regla 6 · periodos con temporadas", () => {
  it("el conjunto decide: {invierno} no afecta a verano ni a toda temporada; las tres afectan a todas", () => {
    const inv = periodoFx("a", "2023-01", "2023-12", ["invierno"]);
    expect(mesesAtipicos([inv], ABRIGO).size).toBe(12);
    expect(mesesAtipicos([inv], VERANO).size).toBe(0);
    expect(mesesAtipicos([inv], TODO).size).toBe(0);
    const todas = periodoFx("b", "2023-03", "2023-05", ["invierno", "verano", "todo_el_ano"]);
    for (const a of [ABRIGO, VERANO, TODO]) expect(mesesAtipicos([todas], a).size).toBe(3);
  });
  it("un conjunto de dos temporadas aplica a ambas y no a la tercera", () => {
    const p = periodoFx("c", "2023-03", "2023-05", ["invierno", "verano"]);
    expect(periodoAplica(p, "verano")).toBe(true);
    expect(periodoAplica(p, "todo_el_ano")).toBe(false);
  });
  it("un rango 2023-09 a 2024-02 reparte entre años", () => {
    const p = periodoFx("d", "2023-09", "2024-02", ["verano"]);
    expect(claseDeAnio(2023, VERANO, [p], PUBLICADOS).meses_atipicos).toHaveLength(4);
    expect(claseDeAnio(2024, VERANO, [p], PUBLICADOS).meses_atipicos).toHaveLength(2);
  });
  it("sin temporadas (filas del paso 1) el conjunto se deriva de alcance; el espejo vuelve a alcance", () => {
    expect(temporadasDePeriodo({ alcance: "invierno", temporadas: null })).toEqual(["invierno"]);
    expect(temporadasDePeriodo({ alcance: "todas", temporadas: undefined })).toEqual(["invierno", "verano", "todo_el_ano"]);
    expect(temporadasDePeriodo({ alcance: "invierno", temporadas: ["todo_el_ano", "invierno"] })).toEqual(["invierno", "todo_el_ano"]);
    expect(alcanceEspejo(["invierno", "verano", "todo_el_ano"])).toBe("todas");
    expect(alcanceEspejo(["verano"])).toBe("invierno");
  });
  it("resolverTemporadas: manda temporadas; solo alcance se traduce; contradictorios se marcan", () => {
    expect(resolverTemporadas({ temporadas: ["verano"] })).toMatchObject({ temporadas: ["verano"], alcance: "invierno", contradiccion: false });
    expect(resolverTemporadas({ alcance: "todas" })).toMatchObject({ temporadas: ["invierno", "verano", "todo_el_ano"], contradiccion: false });
    expect(resolverTemporadas({ temporadas: ["invierno"], alcance: "todas" })?.contradiccion).toBe(true);
    expect(resolverTemporadas({ temporadas: ["invierno", "verano", "todo_el_ano"], alcance: "todas" })?.contradiccion).toBe(false);
    expect(resolverTemporadas({})).toBeNull();
  });
});

describe("regla 6b · claseDeAnio mantiene su contrato y suma temporadas a cada periodo", () => {
  it("claves y tipos fijos; periodos[] con id, motivo, alcance (espejo) y temporadas", () => {
    const r = claseDeAnio(2023, ABRIGO, [PERIODOS_NINO[0]], PUBLICADOS);
    expect(Object.keys(r).sort()).toEqual(["anio", "clase", "completo", "meses_atipicos", "periodos"]);
    expect(r.periodos).toEqual([{ id: "nino-2023-inv", motivo: "Periodo nino-2023-inv", alcance: "invierno", temporadas: ["invierno"] }]);
    expect(r.clase).toBe("atipico");
  });
});

describe("regla 7 · imputarHuecos", () => {
  const r = normalizarCurva([5, 5, 10, 15, 25, 20, 10, 5, 2, 1, 1, 1]);
  const medidas = [10, 10, 5, 5, 5, 60, 40, 20, 10, 5, 5, 5];
  it("suma 1, los meses A valen r_m y el resto conserva proporciones", () => {
    const x = imputarHuecos(medidas, [3, 4, 5], r);
    expect(x).not.toBeNull();
    const p = x!.participacion;
    expect(p.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 9);
    for (const m of [3, 4, 5]) expect(p[m - 1]).toBeCloseTo(r[m - 1], 9);
    // Proporción entre dos meses no imputados: igual que en las medidas.
    expect(p[0] / p[1]).toBeCloseTo(medidas[0] / medidas[1], 9);
    expect(p[5] / p[6]).toBeCloseTo(medidas[5] / medidas[6], 9);
  });
  it("devuelve pesoImputado = Σ r_m de A", () => {
    const x = imputarHuecos(medidas, [3, 4, 5], r)!;
    expect(x.pesoImputado).toBeCloseTo(r[2] + r[3] + r[4], 9);
  });
  it("sin ventas fuera de A no hay con qué reescalar: null", () => {
    expect(imputarHuecos([0, 0, 5, 5, 5, 0, 0, 0, 0, 0, 0, 0], [3, 4, 5], r)).toBeNull();
  });
});

describe("regla 8 y 8a · referencia y ruido normal", () => {
  const a = normalizarCurva([10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10]);
  const b = normalizarCurva([20, 0, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10]);
  const c = normalizarCurva([10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 0, 20]);
  it("referencia es el promedio simple; sin normales, null", () => {
    expect(referencia([a, b])?.[0]).toBeCloseTo((a[0] + b[0]) / 2, 9);
    expect(referencia([])).toBeNull();
  });
  it("ruido: EAT entre dos; con tres, promedio de pares; con uno o ninguno, null", () => {
    expect(ruidoNormal([a, b])).toBeCloseTo(eat(a, b), 9);
    expect(ruidoNormal([a, b, c])).toBeCloseTo((eat(a, b) + eat(a, c) + eat(b, c)) / 3, 9);
    expect(ruidoNormal([a])).toBeNull();
    expect(ruidoNormal([])).toBeNull();
  });
});

describe("regla 8b · compararFormaAnio (relativa al ruido, B1)", () => {
  const r = normalizarCurva([5, 5, 10, 20, 25, 15, 10, 5, 2, 1.2, 1, 0.8]);
  const conDiferencia = (pp: number) => {
    // Mueve `pp` puntos de EAT: pp/2 puntos de un mes a otro.
    const p = [...r];
    p[0] -= pp / 200;
    p[1] += pp / 200;
    return p;
  };
  it("año = normal × constante → diferencia 0, estable", () => {
    const c = compararFormaAnio(participacion(r.map((x) => x * 7))!, r, 3, null);
    expect(c.diferencia_anio).toBeCloseTo(0, 9);
    expect(c.veredicto).toBe("forma_estable");
  });
  it("curva desplazada un mes → corrimiento_pico = −1", () => {
    const desplazada = r.map((_, m) => r[(m + 1) % 12]);
    const c = compararFormaAnio(desplazada, r, 3, null);
    expect(c.corrimiento_pico).toBe(-1);
    expect(c.pico_referencia).toBe(5);
    expect(c.pico).toBe(4);
  });
  it("con piso 3 y ruido 33, un año a 31 pp es estable y uno a 48 pp cambia", () => {
    expect(compararFormaAnio(conDiferencia(31), r, 3, 33).veredicto).toBe("forma_estable");
    expect(compararFormaAnio(conDiferencia(31), r, 3, 33).umbral_efectivo).toBe(33);
    const rr = r.map((x) => x);
    const lejano = rr.map((_, m) => (m < 6 ? 0.02 : 0.1466666));
    expect(compararFormaAnio(normalizarCurva(lejano), r, 3, 33).veredicto).toBe("forma_cambia");
  });
  it("con ruido nulo manda el piso; sin referencia, sin_comparacion", () => {
    expect(compararFormaAnio(conDiferencia(4), r, 3, null).veredicto).toBe("forma_cambia");
    expect(compararFormaAnio(conDiferencia(2), r, 3, null).veredicto).toBe("forma_estable");
    expect(compararFormaAnio(r, null, 3, 10)).toMatchObject({ veredicto: "sin_comparacion", diferencia_anio: null });
  });
  it("compararFormaParcial da las dos versiones con parcial: true y nunca tratamiento", () => {
    const publicados = [true, true, true, true, true, true, true, true, true, false, false, false];
    const completa = participacion([10, 10, 10, 10, 10, 10, 10, 10, 10, 0, 0, 0])!;
    const comunes = participacion([20, 10, 10, 10, 10, 10, 10, 10, 10, 0, 0, 0])!;
    const f = compararFormaParcial(2026, r, publicados, completa, { participacion: comunes, tiendas: 3 });
    expect(f).toMatchObject({ parcial: true, meses_comparados: 9, veredicto: null, tratamiento_aplicado: null });
    expect(f.red_completa).not.toBeNull();
    expect(f.tiendas_comunes?.tiendas).toBe(3);
    expect(f.tiendas_comunes?.diferencia_anio).not.toBe(f.red_completa?.diferencia_anio);
  });
  it("compararFormaAgrupacion: cambia si alguno cambia; estable si todos; sin_comparacion si ninguno", () => {
    expect(compararFormaAgrupacion(["forma_estable", "forma_cambia"])).toBe("forma_cambia");
    expect(compararFormaAgrupacion(["forma_estable", "forma_estable"])).toBe("forma_estable");
    expect(compararFormaAgrupacion(["sin_comparacion"])).toBe("sin_comparacion");
    expect(compararFormaAgrupacion([])).toBe("sin_comparacion");
  });
});

describe("regla 8c · tratamientoEfectivo", () => {
  it("imputar sobre atipico_completo → descartado; sobre con_huecos → imputado", () => {
    expect(tratamientoEfectivo("imputar", "forma_estable", "atipico_completo")).toBe("descartado");
    expect(tratamientoEfectivo("imputar", "forma_estable", "con_huecos")).toBe("imputado");
    expect(tratamientoEfectivo("imputar", "sin_comparacion", "con_huecos")).toBe("descartado");
  });
  it("auto sigue el veredicto", () => {
    expect(tratamientoEfectivo("auto", "forma_estable", "con_huecos")).toBe("incluido");
    expect(tratamientoEfectivo("auto", "forma_cambia", "con_huecos")).toBe("imputado");
    expect(tratamientoEfectivo("auto", "forma_cambia", "atipico_completo")).toBe("descartado");
    expect(tratamientoEfectivo("auto", "sin_comparacion", "atipico_completo")).toBe("incluido");
  });
  it("incluir y descartar mandan; en_curso e incompleto no se tratan; normal entra", () => {
    expect(tratamientoEfectivo("incluir", "forma_cambia", "atipico_completo")).toBe("incluido");
    expect(tratamientoEfectivo("descartar", "forma_estable", "con_huecos")).toBe("descartado");
    expect(tratamientoEfectivo("auto", "forma_cambia", "en_curso")).toBeNull();
    expect(tratamientoEfectivo("auto", "forma_cambia", "incompleto")).toBeNull();
    expect(tratamientoEfectivo("descartar", "forma_cambia", "normal")).toBe("incluido");
  });
});

describe("regla 8d y 8e · volumen sobre tiendas comunes", () => {
  const mascara = Array(12).fill(true);
  it("ratioVolumen suma los meses de la máscara; con referencia 0, null", () => {
    expect(ratioVolumen([10, 10, ...Array(10).fill(0)], [20, 20, ...Array(10).fill(0)], mascara)).toBe(0.5);
    expect(ratioVolumen(Array(12).fill(5), Array(12).fill(0), mascara)).toBeNull();
    const nueve = mascara.map((_, m) => m < 9);
    expect(ratioVolumen(Array(12).fill(10), Array(12).fill(20), nueve)).toBe(0.5);
  });
  it("ratioMensual: null donde no hay mes o la referencia es 0", () => {
    const r = ratioMensual([10, 10, 10, ...Array(9).fill(0)], [20, 0, 10, ...Array(9).fill(0)], mascara.map((_, m) => m < 3));
    expect(r.slice(0, 4)).toEqual([0.5, null, 1, null]);
  });
  it("referenciaVolumen: el normal más cercano; en empate, el anterior", () => {
    expect(referenciaVolumen(2023, [2024, 2025])).toBe(2024);
    expect(referenciaVolumen(2026, [2024, 2025])).toBe(2025);
    expect(referenciaVolumen(2025, [2024, 2026])).toBe(2024);
    expect(referenciaVolumen(2025, [])).toBeNull();
  });
  it("medirVolumen usa solo las tiendas comunes", () => {
    const redes = new Map(
      [2024, 2025].map((anio) => [
        anio,
        {
          anio,
          tiendas: [
            { tienda_id: "a", entra: true },
            ...(anio === 2025 ? [{ tienda_id: "b", entra: true }] : []),
          ],
        },
      ])
    ) as never;
    const serie = (anio: number, a: number, b?: number) => ({
      anio,
      unidades: Array(12).fill(a + (b ?? 0)),
      publicados: Array(12).fill(true),
      por_tienda: new Map<string, number[]>([["a", Array(12).fill(a)], ...(b !== undefined ? ([["b", Array(12).fill(b)]] as [string, number[]][]) : [])]),
    });
    const m = medirVolumen(serie(2025, 10, 1000), 2024, [serie(2024, 20)], redes);
    expect(m.ratio_volumen).toBe(0.5);
    expect(m.tiendas_comunes).toBe(1);
  });
});

describe("regla 8f · efectoAtipicoCorrida (caso 1f)", () => {
  const salida = corridaFixture("base");
  const fila = (anio: number, temporada: string) => salida.efecto_atipico.por_temporada.find((f) => f.anio === anio && f.temporada === temporada);
  it("invierno 2023: ratio 0,65, control 1, relativo 0,65 y crecimiento normal 1,236", () => {
    const f = fila(2023, "invierno");
    expect(f).toMatchObject({ ratio_volumen: 0.65, ratio_control: 1, ratio_relativo: 0.65, agrupaciones: 1, anio_referencia: 2024, meses_comparados: 12 });
    expect(f?.crecimiento_normal).toBeCloseTo(1.236, 6);
  });
  it("verano 2023: 1,46 / 1 / 1,46; todo_el_ano: control null", () => {
    expect(fila(2023, "verano")).toMatchObject({ ratio_volumen: 1.46, ratio_control: 1, ratio_relativo: 1.46 });
    expect(fila(2023, "todo_el_ano")).toMatchObject({ ratio_volumen: 1, ratio_control: null, ratio_relativo: null });
  });
  it("2026 en curso compara enero–setiembre con enero–setiembre de 2025", () => {
    const f = fila(2026, "invierno");
    expect(f).toMatchObject({ ratio_volumen: 0.65, meses_comparados: 9, anio_referencia: 2025 });
    expect(f?.ratio_mensual.slice(9)).toEqual([null, null, null]);
  });
  it("existe la fila red (todas las agrupaciones) y ninguna clave de sustitución", () => {
    expect(fila(2023, "red")?.agrupaciones).toBe(3);
    expect(JSON.stringify(salida.efecto_atipico)).not.toMatch(/sustitucion/);
    expect(JSON.stringify(salida.resultado)).not.toMatch(/sustitucion/);
  });
  it("crecimiento_normal por temporada: dos normales más recientes sobre sus tiendas comunes", () => {
    const c = salida.efecto_atipico.crecimiento_normal.find((x) => x.temporada === "invierno");
    expect(c).toMatchObject({ anio: 2025, anio_referencia: 2024 });
    expect(c?.ratio).toBeCloseTo(1.236, 6);
    expect(c?.tiendas_comunes).toBe(2);
  });
  it("con menos de dos años normales, crecimiento null; sin grupos, tablas vacías", () => {
    const grupo: GrupoParaEfecto = {
      temporada: "invierno",
      agrupaciones: 1,
      anios: [{ anio: 2024, clase: "normal", meses_atipicos: 0, unidades: Array(12).fill(1), publicados: Array(12).fill(true), por_tienda: new Map() }],
    };
    const e = efectoAtipicoCorrida([grupo], [], { umbral_forma: 3, margen_ruido: 0.25 });
    expect(e.por_temporada).toEqual([]);
    expect(e.crecimiento_normal).toEqual([]);
  });
});

describe("regla 8g y 8h", () => {
  it("pocosAniosNormales: menos de tres normales", () => {
    const anios = (...c: string[]) => c.map((clase) => ({ clase })) as never;
    expect(pocosAniosNormales(anios("normal", "normal", "atipico_completo"))).toBe(true);
    expect(pocosAniosNormales(anios("normal", "normal", "normal"))).toBe(false);
  });
  it("temporadaSugeridaDistinta es falsa si la sugerida es todo_el_ano (I5), sin importar la temporada", () => {
    for (const t of ["invierno", "verano", "todo_el_ano"] as const) expect(temporadaSugeridaDistinta(t, "todo_el_ano", 87)).toBe(false);
    expect(temporadaSugeridaDistinta("todo_el_ano", "invierno", 10)).toBe(true);
    expect(temporadaSugeridaDistinta("invierno", "invierno", 10)).toBe(false);
    expect(temporadaSugeridaDistinta("todo_el_ano", "verano", 0)).toBe(false);
    expect(temporadaSugeridaVisible("todo_el_ano")).toBeNull();
    expect(temporadaSugeridaVisible("invierno")).toBe("invierno");
  });
});
