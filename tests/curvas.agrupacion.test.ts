import { describe, expect, it } from "vitest";
import { listarMeses } from "@/lib/ventas/periodo";
import { armarEntradaAgrupacion, armarEntradaCorrida, ventaPorTiendaDeTemporadas } from "@/lib/curvas/entrada";
import { agrupacionesDeTemporada, huellaCalculo, huellaTemporada, parametrosCanonicos } from "@/lib/curvas/huellas";
import { calcularCorrida, ruidoNormalAgrupacion, VERSION_MODELO } from "@/lib/curvas/modelo";
import { armarFoto, calculoDeTrabajo, comparadorContra, piezasDeSalida, prepararTrabajo } from "@/lib/curvas/trabajo";
import { aVigenteResumen } from "@/lib/curvas/reglas";
import { PARAMETROS_POR_DEFECTO } from "@/lib/curvas/tipos-api";
import {
  ABRIGO_ID,
  CONSTANTE_ID,
  PEQUENA_ID,
  PERIODOS_NINO,
  PUBLICADOS,
  T1,
  T3,
  T4,
  VERANO_ID,
  agrupacionDe,
  agrupacionesFixture,
  corridaFixture,
  datosFixture,
  fixtureVentaEstacionalidad,
  insumosFixture,
  parametros,
  suma,
  tiendasFixture,
} from "./curvas.fixture";

const anio = (a: ReturnType<typeof agrupacionDe>, y: number) => a.anios.find((x) => x.anio === y)!;

function trabajo(id: string, extra: Partial<typeof PARAMETROS_POR_DEFECTO> = {}, variante: Parameters<typeof insumosFixture>[1] = "base", opciones: Parameters<typeof insumosFixture>[2] = {}, hasta?: string) {
  const r = prepararTrabajo(insumosFixture(id, variante, opciones), parametros(extra), hasta);
  if (r.rechazo) throw new Error(r.rechazo.mensaje);
  return r.trabajo;
}
const resultadoDe = (t: ReturnType<typeof trabajo>, id: string) => piezasDeSalida(t.salida, id)!.resultado;

describe("regla 34 · huellaCalculo", () => {
  const base = {
    cargas_huella: "c",
    red_huella: "r",
    composicion_huella: "k",
    temporada: "invierno" as const,
    huella_temporada: "t",
    hasta_periodo: "2026-09",
    periodos: PERIODOS_NINO,
    parametros: parametros(),
  };
  const h = huellaCalculo(base);
  it("es md5 y no depende del orden de los periodos ni de las listas de los parámetros", () => {
    expect(h).toMatch(/^[0-9a-f]{32}$/);
    expect(huellaCalculo({ ...base, periodos: [...PERIODOS_NINO].reverse() })).toBe(h);
    const a = huellaCalculo({ ...base, parametros: parametros({ anios_excluidos: [2024, 2023], tiendas_excluidas: ["b", "a"] }) });
    const b = huellaCalculo({ ...base, parametros: parametros({ anios_excluidos: [2023, 2024], tiendas_excluidas: ["a", "b"] }) });
    expect(a).toBe(b);
    expect(parametrosCanonicos(parametros({ anios_excluidos: [2024, 2023] }))).toContain("[2023,2024]");
  });
  it("cambia con VERSION_MODELO, un carga_id, la red, la composición, la temporada, huella_temporada, hasta_periodo, un periodo aplicable y cualquier parámetro", () => {
    expect(huellaCalculo({ ...base, version_modelo: VERSION_MODELO + 1 })).not.toBe(h);
    expect(huellaCalculo({ ...base, cargas_huella: "c2" })).not.toBe(h);
    expect(huellaCalculo({ ...base, red_huella: "r2" })).not.toBe(h);
    expect(huellaCalculo({ ...base, composicion_huella: "k2" })).not.toBe(h);
    expect(huellaCalculo({ ...base, temporada: "verano" })).not.toBe(h);
    expect(huellaCalculo({ ...base, huella_temporada: "t2" })).not.toBe(h);
    expect(huellaCalculo({ ...base, hasta_periodo: "2026-08" })).not.toBe(h);
    expect(huellaCalculo({ ...base, periodos: PERIODOS_NINO.map((p, i) => (i === 0 ? { ...p, hasta: "2023-11" } : p)) })).not.toBe(h);
    expect(huellaCalculo({ ...base, periodos: PERIODOS_NINO.slice(1) })).not.toBe(h);
    expect(huellaCalculo({ ...base, parametros: parametros({ umbral_forma: 4 }) })).not.toBe(h);
    expect(huellaCalculo({ ...base, parametros: parametros({ anios_excluidos: [2023] }) })).not.toBe(h);
    expect(huellaCalculo({ ...base, parametros: parametros({ tiendas_excluidas: ["x"] }) })).not.toBe(h);
    expect(huellaCalculo({ ...base, parametros: parametros({ sin_periodos_confirmado: true }) })).not.toBe(h);
  });
  it("no cambia con un periodo que no aplica a la temporada", () => {
    const conOtro = [...PERIODOS_NINO, { ...PERIODOS_NINO[0], id: "otro", temporadas: ["verano" as const] }];
    expect(huellaCalculo({ ...base, periodos: conOtro })).toBe(h); // invierno no ve el periodo de verano
    expect(huellaCalculo({ ...base, periodos: [...PERIODOS_NINO, { ...PERIODOS_NINO[0], id: "inactivo", activo: false }] })).toBe(h);
  });
});

describe("regla 34b · huellaTemporada", () => {
  const a = (id: string, temporada: "invierno" | "verano" | "todo_el_ano", huella = `h-${id}`, activo = true) => ({ id, temporada, huella, activo });
  const todas = [a("i1", "invierno"), a("i2", "invierno"), a("v1", "verano"), a("t1", "todo_el_ano")];
  const h = (ts: typeof todas, t: "invierno" | "verano" | "todo_el_ano" = "invierno") => huellaTemporada(agrupacionesDeTemporada(t, ts));
  it("no depende del orden de entrada", () => {
    expect(h([...todas].reverse())).toBe(h(todas));
  });
  it("cambia si una de la temporada o de toda temporada cambia de composición o de temporada, o se activa o desactiva", () => {
    const base = h(todas);
    expect(h(todas.map((x) => (x.id === "i2" ? { ...x, huella: "otra" } : x)))).not.toBe(base);
    expect(h(todas.map((x) => (x.id === "t1" ? { ...x, huella: "otra" } : x)))).not.toBe(base);
    expect(h(todas.map((x) => (x.id === "i2" ? { ...x, temporada: "verano" as const } : x)))).not.toBe(base);
    expect(h(todas.map((x) => (x.id === "i2" ? { ...x, activo: false } : x)))).not.toBe(base);
    expect(h(todas.map((x) => (x.id === "v1" ? { ...x, temporada: "invierno" as const } : x)))).not.toBe(base);
  });
  it("no cambia por una agrupación de otra temporada (ni por su composición)", () => {
    const base = h(todas);
    expect(h(todas.map((x) => (x.id === "v1" ? { ...x, huella: "otra" } : x)))).toBe(base);
    expect(h([...todas, a("v2", "verano")])).toBe(base);
  });
});

describe("regla 35 · armarEntradaAgrupacion", () => {
  const p = parametros();
  const venta = fixtureVentaEstacionalidad(ABRIGO_ID);
  const entrada = armarEntradaAgrupacion(
    {
      hasta_periodo: "2026-09",
      meses_publicados: PUBLICADOS,
      venta,
      tiendas: tiendasFixture(),
      periodos: PERIODOS_NINO,
      agrupacion: { id: ABRIGO_ID, temporada: "invierno", composicion: { equivalencias: 10, huella: "h" }, temporada_sugerida: null, temporadas_mezcladas: false },
      activas_por_temporada: { invierno: 1, verano: 1, todo_el_ano: 2 },
    },
    p
  );
  it("la venta total por tienda es la suma de temporadas (la sin_agrupacion incluida)", () => {
    const total = ventaPorTiendaDeTemporadas(venta.temporadas);
    const t1Mar2024 = total.find((v) => v.tienda_id === T1 && v.periodo === "2024-03")!;
    expect(t1Mar2024.unidades).toBe(60 + 80 + 100 + 7);
    expect(venta.temporadas.some((f) => f.temporada === "sin_agrupacion")).toBe(true);
  });
  it("la red comparable coincide con la de armarEntradaCorrida (2023 → T1; 2024 → T1, T4; 2025 → T1, T2, T4; 2026 → T1..T4)", () => {
    const vieja = armarEntradaCorrida(datosFixture("base"), p);
    expect(JSON.stringify(entrada.redes)).toBe(JSON.stringify(vieja.redes));
    const entran = (anio: number) => entrada.redes.find((r) => r.anio === anio)!.tiendas.filter((t) => t.entra).map((t) => t.tienda_id).sort();
    expect(entran(2023)).toEqual([T1]);
    expect(entran(2024)).toEqual([T1, T4]);
    expect(entran(2025)).toEqual(["t2", T1, T4].sort());
    expect(entran(2026)).toEqual(["t2", T1, T3, T4].sort());
  });
  it("las series de la agrupación son las de armarEntradaCorrida", () => {
    const vieja = armarEntradaCorrida(datosFixture("base"), p).agrupaciones.find((a) => a.agrupacion_id === ABRIGO_ID)!;
    const nueva = entrada.agrupaciones[0];
    expect(nueva.unidades).toEqual(vieja.unidades);
    expect(nueva.venta).toEqual(vieja.venta);
    expect(nueva.costo).toEqual(vieja.costo);
    expect(nueva.por_tienda).toEqual(vieja.por_tienda);
    expect(nueva.sin_venta).toBe(false);
  });
  it("series_temporada lleva una entrada por temporada presente, con sus meses atípicos", () => {
    expect(entrada.series_temporada?.map((s) => s.temporada)).toEqual(["invierno", "verano", "todo_el_ano"]);
    const inv = entrada.series_temporada!.find((s) => s.temporada === "invierno")!;
    expect(inv.atipicos.has("2023-05")).toBe(true);
    const todo = entrada.series_temporada!.find((s) => s.temporada === "todo_el_ano")!;
    expect(todo.atipicos.size).toBe(0);
    expect(inv.agrupaciones).toBe(1);
  });
  it("sin agrupación (Años Niño) no hay agrupaciones pero sí series por temporada", () => {
    const sola = armarEntradaAgrupacion(
      { hasta_periodo: "2026-09", meses_publicados: PUBLICADOS, venta: fixtureVentaEstacionalidad(null), tiendas: tiendasFixture(), periodos: PERIODOS_NINO, agrupacion: null, activas_por_temporada: {} },
      p
    );
    expect(sola.agrupaciones).toEqual([]);
    expect(sola.series_temporada).toHaveLength(3);
  });
});

describe("regla 36 · calcularCorrida con series_temporada", () => {
  it("la curva_T es la de la serie agregada y no la A de la agrupación; 2023 es atípico en T", () => {
    const t = trabajo(ABRIGO_ID);
    const p = piezasDeSalida(t.salida, ABRIGO_ID)!;
    expect(p.temporada!.anios.find((a) => a.anio === 2023)!.clase).toBe("atipico_completo");
    // T suma ABRIGO y a las tiendas de la red: coincide con la T de la corrida de las tres agrupaciones solo si la serie agregada es la misma.
    const vieja = agrupacionDe(corridaFixture("base"), ABRIGO_ID);
    const curvaTVieja = corridaFixture("base").resultado.temporadas.find((x) => x.temporada === "invierno")!.curva_T;
    expect(p.temporada!.curva_T).toEqual(curvaTVieja);
    expect(vieja.agrupacion_id).toBe(ABRIGO_ID);
  });
  it("con ABRIGO sola, temporadas trae también todo_el_ano (el control) y verano", () => {
    const t = trabajo(ABRIGO_ID);
    expect(t.salida!.resultado.temporadas.map((x) => x.temporada)).toEqual(["invierno", "verano", "todo_el_ano"]);
    const filas = t.salida!.efecto_atipico.por_temporada;
    const inv2023 = filas.find((f) => f.temporada === "invierno" && f.anio === 2023)!;
    expect(inv2023.ratio_volumen).toBeCloseTo(0.65, 2);
    expect(inv2023.ratio_control).toBeCloseTo(1, 2);
    expect(inv2023.ratio_relativo).toBeCloseTo(0.65, 2);
  });
  it("con una segunda agrupación de invierno en la serie agregada, T está más cerca de la grande", () => {
    const venta = fixtureVentaEstacionalidad(ABRIGO_ID);
    const inflada = {
      ...venta,
      temporadas: venta.temporadas.map((f) => (f.temporada === "invierno" ? { ...f, unidades: f.unidades * 3 } : f)),
    };
    const base = trabajo(ABRIGO_ID).salida!.resultado.temporadas.find((x) => x.temporada === "invierno")!;
    const insumos = { ...insumosFixture(ABRIGO_ID), venta: inflada };
    const r = prepararTrabajo(insumos, parametros(), undefined);
    expect(r.rechazo).toBeNull();
    const t3 = r.trabajo!.salida!.resultado.temporadas.find((x) => x.temporada === "invierno")!;
    // Multiplicar toda la serie por 3 no cambia las participaciones de la temporada.
    expect(t3.curva_T).toEqual(base.curva_T);
  });
  it("sin series_temporada el comportamiento es el de la 0.9.6 (suma de las agrupaciones de la entrada)", () => {
    const vieja = armarEntradaCorrida(datosFixture("base"), parametros());
    expect(vieja.series_temporada).toBeUndefined();
    const s = calcularCorrida(vieja, parametros());
    expect(s.resultado.temporadas.map((x) => x.temporada)).toEqual(["invierno", "verano", "todo_el_ano"]);
  });
});

describe("reglas 37 y 38 · exclusiones", () => {
  it("anios_excluidos = [2024]: 2024 descartado con motivo excluido_manual, fuera del ajuste, con aviso", () => {
    const a = resultadoDe(trabajo(ABRIGO_ID, { anios_excluidos: [2024] }), ABRIGO_ID);
    expect(anio(a, 2024)).toMatchObject({ tratamiento: "descartado", tratamiento_motivo: "excluido_manual", en_ajuste: false });
    expect(anio(a, 2024).participacion_real).not.toBeNull();
    expect(a.avisos.filter((x) => x.codigo === "anio_excluido")).toHaveLength(1);
    expect(a.motivo_recomendacion).not.toBeNull();
  });
  it("las candidatas con anios_excluidos = [2023] coinciden con tratamiento_atipicos = descartar", () => {
    const x = resultadoDe(trabajo(ABRIGO_ID, { anios_excluidos: [2023] }), ABRIGO_ID);
    const y = resultadoDe(trabajo(ABRIGO_ID, { tratamiento_atipicos: "descartar" }), ABRIGO_ID);
    // `F` queda fuera: contrae hacia `T`, que no aplica `anios_excluidos` (la curva de la temporada sigue con 2023).
    const propias = (r: typeof x) => r.candidatas.filter((c) => c.modelo !== "T" && c.modelo !== "F").map((c) => c.curva);
    expect(propias(x)).toEqual(propias(y));
  });
  it("excluir un año atípico sigue midiendo su volumen", () => {
    const a = resultadoDe(trabajo(ABRIGO_ID, { anios_excluidos: [2023] }), ABRIGO_ID);
    expect(a.efecto_atipico.volumen.find((v) => v.anio === 2023)!.ratio_volumen).toBeCloseTo(0.65, 2);
  });
  it("excluir todos los años de ajuste → pocos_anos_ajuste y T", () => {
    const a = resultadoDe(trabajo(ABRIGO_ID, { anios_excluidos: [2023, 2024, 2025] }), ABRIGO_ID);
    expect(a.avisos.some((x) => x.codigo === "pocos_anos_ajuste")).toBe(true);
    expect(a.recomendada).toBe("T");
    expect(a.origen).toBe("prestada");
  });
  it("un año excluido sale del ruido entre años normales", () => {
    const a = resultadoDe(trabajo(ABRIGO_ID, { anios_excluidos: [2025] }), ABRIGO_ID);
    expect(a.ruido_normal).toBeNull();
  });
  it("tiendas_excluidas = [T3]: la red de 2026 pasa a T1, T2, T4 con motivo excluida_manual; huellaRed no cambia", () => {
    const sin = trabajo(ABRIGO_ID);
    const con = trabajo(ABRIGO_ID, { tiendas_excluidas: [T3] });
    const r2026 = con.entrada!.redes.find((r) => r.anio === 2026)!;
    expect(r2026.tiendas.filter((t) => t.entra).map((t) => t.tienda_id).sort()).toEqual(["t2", T1, T4].sort());
    expect(r2026.tiendas.find((t) => t.tienda_id === T3)).toMatchObject({ entra: false, motivos: ["excluida_manual"] });
    expect(con.red_huella).toBe(sin.red_huella);
    expect(con.huella_calculo).not.toBe(sin.huella_calculo);
  });
  it("tiendas_excluidas = [T1]: sale de todos los años antes de evaluar fechas y datos; los pesos se reparten entre las demás", () => {
    const t = trabajo(ABRIGO_ID, { tiendas_excluidas: [T1] });
    for (const r of t.entrada!.redes) expect(r.tiendas.find((x) => x.tienda_id === T1)).toMatchObject({ entra: false, motivos: ["excluida_manual"] });
    const r2025 = t.entrada!.redes.find((r) => r.anio === 2025)!;
    expect(r2025.tiendas.filter((x) => x.entra).reduce((s, x) => s + x.peso, 0)).toBeCloseTo(1, 6);
  });
  it("meses_tienda_nueva = 12 deja a T3 como tienda_nueva en 2026", () => {
    const t = trabajo(ABRIGO_ID, { meses_tienda_nueva: 12 });
    const r = t.entrada!.redes.find((x) => x.anio === 2026)!.tiendas.find((x) => x.tienda_id === T3)!;
    expect(r.motivos).toContain("tienda_nueva");
  });
});

describe("regla 39 y caso 20 · determinismo con huella", () => {
  it("diez cálculos con la misma entrada dan la misma huella y el mismo resultado", () => {
    const a = trabajo(ABRIGO_ID);
    for (let i = 0; i < 9; i++) {
      const b = trabajo(ABRIGO_ID);
      expect(b.huella_calculo).toBe(a.huella_calculo);
      expect(JSON.stringify(b.salida!.resultado)).toBe(JSON.stringify(a.salida!.resultado));
    }
  });
  it("cambiar una unidad en un mes publicado no cambia la huella (la huella cubre las CARGAS, no los hechos), pero cambiar un carga_id sí", () => {
    const a = trabajo(ABRIGO_ID);
    const b = trabajo(ABRIGO_ID, {}, "base", { cargas: { ...Object.fromEntries(PUBLICADOS.map((m) => [m, `carga-${m}`])), "2024-03": "otra" } });
    expect(b.huella_calculo).not.toBe(a.huella_calculo);
    expect(b.cargas_huella).not.toBe(a.cargas_huella);
  });
  it("publicar un mes (entra en las cargas) cambia la huella solo si es ≤ hasta_periodo", () => {
    const a = trabajo(ABRIGO_ID, {}, "base", { publicados: PUBLICADOS.filter((m) => m <= "2026-08") }, "2026-08");
    const conSep = trabajo(ABRIGO_ID, {}, "base", {}, "2026-08");
    expect(conSep.huella_calculo).toBe(a.huella_calculo);
    expect(conSep.meses_posteriores).toEqual(["2026-09"]);
    const conHastaSep = trabajo(ABRIGO_ID, {}, "base", {}, "2026-09");
    expect(conHastaSep.huella_calculo).not.toBe(a.huella_calculo);
  });
  it("calcularCorrida sobre una agrupación tarda unos milisegundos (humo)", () => {
    const t = trabajo(ABRIGO_ID);
    const inicio = performance.now();
    calcularCorrida(t.entrada!, parametros());
    expect(performance.now() - inicio).toBeLessThan(500);
  });
});

describe("regla 48 y caso 22 · ruido entre años normales de la agrupación", () => {
  it("ruidoNormalAgrupacion: null con menos de dos; con dos, la EAT; con tres, el promedio de los pares con detalle", () => {
    const p = (v: number[]) => v.map((x) => x / v.reduce((s, y) => s + y, 0));
    const a = p([1, 2, 3, 4]);
    const b = p([2, 2, 3, 3]);
    const c = p([4, 3, 2, 1]);
    expect(ruidoNormalAgrupacion([{ anio: 2024, participacion: a }])).toEqual({ ruido_normal: null, ruido_normal_detalle: [] });
    const dos = ruidoNormalAgrupacion([{ anio: 2025, participacion: b }, { anio: 2024, participacion: a }]);
    expect(dos.ruido_normal_detalle).toHaveLength(1);
    expect(dos.ruido_normal_detalle[0].anios).toEqual([2024, 2025]);
    expect(dos.ruido_normal).toBe(dos.ruido_normal_detalle[0].eat);
    const tres = ruidoNormalAgrupacion([{ anio: 2023, participacion: c }, { anio: 2024, participacion: a }, { anio: 2025, participacion: b }]);
    expect(tres.ruido_normal_detalle.map((d) => d.anios.join("-"))).toEqual(["2023-2024", "2023-2025", "2024-2025"]);
    expect(tres.ruido_normal).toBeCloseTo(tres.ruido_normal_detalle.reduce((s, d) => s + d.eat, 0) / 3, 9);
  });
  it("una agrupación de toda temporada sin periodos tiene ruido aunque efecto_atipico.forma sea null (CONSTANTE: tres años iguales → 0; PEQUEÑA: años distintos → > 0)", () => {
    const c = resultadoDe(trabajo(CONSTANTE_ID, {}, "base", { periodos: [] }), CONSTANTE_ID);
    expect(c.efecto_atipico.forma).toBeNull();
    expect(c.ruido_normal).toBe(0);
    expect(c.ruido_normal_detalle).toHaveLength(3);
    const p = resultadoDe(trabajo(PEQUENA_ID, { min_unidades_ano: 0 }, "escasa", { periodos: [] }), PEQUENA_ID);
    expect(p.efecto_atipico.forma).toBeNull();
    expect(p.ruido_normal).toBeGreaterThan(0);
  });
  it("con menos de dos años normales no es medible (null)", () => {
    const p = resultadoDe(trabajo(PEQUENA_ID, {}, "escasa", { periodos: [] }), PEQUENA_ID);
    expect(p.ruido_normal).toBeNull();
    expect(p.ruido_normal_detalle).toEqual([]);
  });
  it("en ABRIGO coincide con efecto_atipico.forma.ruido_normal y viaja en la comparación", () => {
    const a = resultadoDe(trabajo(ABRIGO_ID), ABRIGO_ID);
    expect(a.ruido_normal).toBe(a.efecto_atipico.forma?.ruido_normal);
    expect(a.comparacion?.ruido_normal).toBe(a.ruido_normal);
    expect(a.comparacion?.margen_ruido).toBe(0.25);
  });
  it("la frase usa el porcentaje del parámetro y el formato de la pantalla; con margen_ruido distinto cambia el texto", () => {
    const a = resultadoDe(trabajo(ABRIGO_ID), ABRIGO_ID);
    const b = resultadoDe(trabajo(ABRIGO_ID, { margen_ruido: 0.5 }), ABRIGO_ID);
    for (const r of [a, b]) {
      if (r.comparacion && r.motivo_recomendacion === "sin_evidencia") {
        expect(r.comparacion.frase).toContain(`${Math.round(r.comparacion.margen_ruido * 100)} % del ruido`);
        expect(r.comparacion.frase).not.toContain("un cuarto");
      }
    }
  });
});

describe("regla 56 · pruebas y comparabilidad", () => {
  it("cada candidata lleva pruebas = pliegues (3 con 2023–2025; 2 con 2023 excluido; 0 con un solo año)", () => {
    const t = trabajo(ABRIGO_ID, { tratamiento_atipicos: "incluir" });
    const a = resultadoDe(t, ABRIGO_ID);
    expect(a.candidatas.find((c) => c.modelo === "A")!.pruebas).toBe(3);
    const sin2023 = resultadoDe(trabajo(ABRIGO_ID, { anios_excluidos: [2023] }), ABRIGO_ID);
    for (const c of sin2023.candidatas.filter((x) => x.curva && x.modelo !== "T" && x.modelo !== "F")) expect(c.pruebas).toBe(2);
    // Con dos años de ajuste `F` se muestra pero no compite (un solo año de entrenamiento por prueba): sin pruebas ni EAT.
    const f = sin2023.candidatas.find((x) => x.modelo === "F")!;
    expect(f.curva).not.toBeNull();
    expect([f.pruebas, f.eat, f.motivo]).toEqual([0, null, "sin_backtesting_honesto"]);
    const uno = resultadoDe(trabajo(ABRIGO_ID, { anios_excluidos: [2023, 2024] }), ABRIGO_ID);
    for (const c of uno.candidatas) expect(c.pruebas).toBe(0);
  });
  it("comparable_con_vigente: true si el conjunto de años de ajuste coincide, false si no, null sin dato", () => {
    const t = trabajo(ABRIGO_ID);
    const { resultado, temporada } = piezasDeSalida(t.salida, ABRIGO_ID)!;
    const aprobada = (anios: number[] | null) => ({ modelo: "A" as const, curva: resultado.candidatas[0].curva!, eat: null, anios_ajuste: anios });
    const ajuste = resultado.anios.filter((a) => a.en_ajuste).map((a) => a.anio);
    expect(comparadorContra(resultado, temporada, aprobada(ajuste), null)!.comparable_con_vigente).toBe(true);
    expect(comparadorContra(resultado, temporada, aprobada([2023, ...ajuste]), null)!.comparable_con_vigente).toBe(false);
    expect(comparadorContra(resultado, temporada, aprobada(null), null)!.comparable_con_vigente).toBeNull();
    expect(comparadorContra(resultado, temporada, null, null)).toBeNull();
  });
  it("caso 31 · ABRIGO con 2023 excluido frente a una vigente ajustada con 2023–2025: comparable_con_vigente = false", () => {
    const t = trabajo(ABRIGO_ID, { anios_excluidos: [2023] });
    const { resultado, temporada } = piezasDeSalida(t.salida, ABRIGO_ID)!;
    const c = comparadorContra(resultado, temporada, { modelo: "A", curva: resultado.candidatas[0].curva!, eat: null, anios_ajuste: [2023, 2024, 2025] }, null)!;
    expect(c.comparable_con_vigente).toBe(false);
  });
});

describe("caso 14 · las tres curvas en la vista", () => {
  it("comparador con eat_vs_vigente 0 si la vigente es la A del cálculo; pedir B cambia el comparador sin cambiar el resultado", () => {
    const t = trabajo(ABRIGO_ID);
    const { resultado, temporada } = piezasDeSalida(t.salida, ABRIGO_ID)!;
    const a = resultado.candidatas.find((c) => c.modelo === "A")!;
    const vigente = { modelo: "A" as const, curva: a.curva!, eat: a.eat, anios_ajuste: null };
    const porDefecto = comparadorContra(resultado, temporada, vigente, null)!;
    expect(resultado.recomendada).toBe("A");
    expect(porDefecto).toMatchObject({ modelo: "A", eat_vs_vigente: 0, difiere: false });
    const b = comparadorContra(resultado, temporada, vigente, "B")!;
    expect(b.modelo).toBe("B");
    expect(resultado.anios.every((x) => (x.clase === "incompleto" ? true : x.participacion_real !== null || x.participacion_parcial !== null || x.clase === "en_curso"))).toBe(true);
    expect(resultado.anios.filter((x) => x.participacion_real !== null)).toHaveLength(3);
  });
});

describe("regla 55 y caso 30 · versión del modelo", () => {
  it("VERSION_MODELO viaja a la foto (resumen.version_modelo) y la foto lleva el resumen completo", () => {
    const t = trabajo(ABRIGO_ID);
    const foto = armarFoto(t, insumosFixture(ABRIGO_ID).agrupacion, PERIODOS_NINO, 12)!;
    const resumen = foto.resumen as Record<string, unknown>;
    expect(resumen.version_modelo).toBe(VERSION_MODELO);
    for (const k of ["cargas", "cargas_huella", "red_huella", "composicion_huella", "temporada", "huella_temporada", "huella_calculo", "atipicos", "ruido_normal", "hasta_periodo", "hasta_fue_por_defecto", "meses_publicados", "duracion_ms"]) {
      expect(resumen, k).toHaveProperty(k);
    }
    expect(foto.agrupacion_estacionalidad_id).toBe(ABRIGO_ID);
    expect(foto.hasta_periodo).toBe("2026-09-01");
    expect(resumen.hasta_fue_por_defecto).toBe(true);
    const res = foto.resultado as { agrupaciones: unknown[]; temporadas: { temporada: string }[] };
    expect(res.agrupaciones).toHaveLength(1);
    expect(res.temporadas.map((x) => x.temporada)).toEqual(["invierno", "todo_el_ano"]);
    expect(Math.max(...(resumen.atipicos as string[]).map((m) => Number(m.replace("-", ""))))).toBeLessThanOrEqual(202609);
    expect(JSON.stringify(foto.resultado).length).toBeLessThan(200_000);
  });
  it("la foto de una agrupación de toda temporada lleva solo su temporada (el control es ella misma)", () => {
    const t = trabajo(CONSTANTE_ID);
    const foto = armarFoto(t, insumosFixture(CONSTANTE_ID).agrupacion, PERIODOS_NINO, 1)!;
    expect((foto.resultado as { temporadas: unknown[] }).temporadas).toHaveLength(1);
  });
});

describe("caso 28 · hasta explícito", () => {
  it("con hasta = 2026-07 y defecto 2026-09: hasta_fue_por_defecto = false y los meses posteriores se listan", () => {
    const t = trabajo(ABRIGO_ID, {}, "base", {}, "2026-07");
    expect(t.hasta_periodo).toBe("2026-07");
    expect(t.hasta_fue_por_defecto).toBe(false);
    expect(t.meses_posteriores).toEqual(["2026-08", "2026-09"]);
    expect(trabajo(ABRIGO_ID).hasta_fue_por_defecto).toBe(true);
  });
  it("un hasta no publicado → rechazo hasta_periodo_sin_cargar", () => {
    const r = prepararTrabajo(insumosFixture(ABRIGO_ID), parametros(), "2027-01");
    expect(r.rechazo).toMatchObject({ status: 409, codigo: "hasta_periodo_sin_cargar" });
  });
  it("sin meses publicados no hay hasta: bloquea sin_meses_publicados y no hay cálculo", () => {
    const t = trabajo(ABRIGO_ID, {}, "base", { publicados: [] });
    expect(t.hasta_periodo).toBeNull();
    expect(t.prerrequisitos.bloquea.map((p) => p.codigo)).toContain("sin_meses_publicados");
    expect(t.salida).toBeNull();
    expect(calculoDeTrabajo(t, ABRIGO_ID, tiendasFixture(), 0)).toBeNull();
  });
});

describe("caso 27 · control del Niño con una sola agrupación", () => {
  it("calcular de ABRIGO sola devuelve efecto_temporada con invierno y todo_el_ano", () => {
    const t = trabajo(ABRIGO_ID);
    const calculo = calculoDeTrabajo(t, ABRIGO_ID, tiendasFixture(), 5)!;
    const temporadas = new Set(calculo.efecto_temporada.map((f) => f.temporada));
    expect(temporadas.has("invierno")).toBe(true);
    expect(temporadas.has("todo_el_ano")).toBe(true);
    expect(temporadas.has("verano")).toBe(false);
    expect(calculo.temporada_curva!.temporada).toBe("invierno");
    expect(calculo.red.length).toBe(4);
    expect(calculo.red[0].tiendas[0].codigo).toBeTruthy();
  });
});

describe("agrupación vacía y prestada (caso 24)", () => {
  const vacia = { id: "vacia", temporada: "todo_el_ano" as const, composicion: { equivalencias: 10, huella: "h-vacia" }, temporada_sugerida: null, temporadas_mezcladas: false };
  it("una agrupación sin filas → sin_venta bloquea", () => {
    const t = trabajo("vacia", {}, "base", { agrupaciones: [...agrupacionesFixture("base"), vacia] });
    expect(t.prerrequisitos.bloquea.map((p) => p.codigo)).toContain("sin_venta");
    expect(t.salida).toBeNull();
  });
  it("con venta pero sin años suficientes → prestada (no sin_venta)", () => {
    const t = trabajo(PEQUENA_ID, {}, "escasa", { periodos: PERIODOS_NINO }, "2023-12");
    expect(t.prerrequisitos.bloquea).toEqual([]);
    expect(t.entrada!.agrupaciones[0].sin_venta).toBe(false);
  });
  it("sin_venta cruda: aunque la red no tenga ventas, si la agrupación vende no es sin_venta", () => {
    const venta = fixtureVentaEstacionalidad(ABRIGO_ID);
    expect(venta.agrupacion!.length).toBeGreaterThan(0);
    const t = trabajo(ABRIGO_ID, { tiendas_excluidas: [T1, T4, "t2", T3] });
    expect(t.entrada!.agrupaciones[0].sin_venta).toBe(false);
  });
});

describe("la vigente de la foto se lee de anios_utilizados", () => {
  it("aVigenteResumen devuelve parámetros, huella, hasta y años de ajuste; una curva de la 0.9.6 los trae null", () => {
    const fila = { id: "c", version: 1, modelo: "A", origen: "propia", recomendada: true, eat: 1, aprobada_at: "x", usuario_nombre: "u", corrida_id: "f", nota: null, p01: 0.1, p02: 0.1, p03: 0.1, p04: 0.1, p05: 0.1, p06: 0.1, p07: 0.1, p08: 0.1, p09: 0.1, p10: 0.1, p11: 0.0, p12: 0.0 };
    const v = aVigenteResumen({ ...fila, anios_utilizados: { huella_calculo: "h", hasta_periodo: "2026-08", version_modelo: 1, anios_ajuste: [2024, 2025], recomendada_entonces: "B", parametros: { anios_excluidos: [2023] } } } as never);
    expect(v).toMatchObject({ foto_id: "f", huella_calculo: "h", hasta_periodo: "2026-08", version_modelo: 1, anios_ajuste: [2024, 2025], recomendada_entonces: "B" });
    expect(v.parametros!.anios_excluidos).toEqual([2023]);
    expect(v.parametros!.umbral_forma).toBe(3);
    const vieja = aVigenteResumen({ ...fila, anios_utilizados: { anios: [] } } as never);
    expect(vieja).toMatchObject({ huella_calculo: null, hasta_periodo: null, version_modelo: null, anios_ajuste: null, parametros: null, recomendada_entonces: null });
  });
});

describe("meses sin cargar", () => {
  it("quitar 2024-05 de los publicados → meses_sin_cargar avisa, 2024 incompleto, y sigue calculando", () => {
    const publicados = PUBLICADOS.filter((m) => m !== "2024-05");
    const t = trabajo(ABRIGO_ID, {}, "base", { publicados });
    expect(t.prerrequisitos.bloquea).toEqual([]);
    expect(t.prerrequisitos.avisa.map((p) => p.codigo)).toContain("meses_sin_cargar");
    expect(resultadoDe(t, ABRIGO_ID).anios.find((a) => a.anio === 2024)!.clase).toBe("incompleto");
  });
  it("sin ningún año completo → sin_anio_completo bloquea", () => {
    const publicados = listarMeses("2025-01", "2026-09").filter((m) => m !== "2025-05");
    const t = trabajo(ABRIGO_ID, {}, "base", { publicados });
    expect(t.prerrequisitos.bloquea.map((p) => p.codigo)).toContain("sin_anio_completo");
  });
  it("con T4 sin apertura y con venta → tienda_sin_apertura bloquea con enlace a Tiendas", () => {
    const tiendas = tiendasFixture().map((x) => (x.id === T4 ? { ...x, fecha_apertura: null } : x));
    for (const id of [ABRIGO_ID, VERANO_ID, CONSTANTE_ID]) {
      const t = trabajo(id, {}, "base", { tiendas });
      const p = t.prerrequisitos.bloquea.find((x) => x.codigo === "tienda_sin_apertura")!;
      expect(p.enlace).toEqual({ pantalla: "tiendas", id: T4 });
    }
  });
});

describe("suma de la agrupación", () => {
  it("las unidades del año de la agrupación suman sobre la red (no sobre la venta cruda)", () => {
    const a = resultadoDe(trabajo(ABRIGO_ID), ABRIGO_ID);
    expect(suma(anio(a, 2024).meses)).toBe(anio(a, 2024).unidades);
  });
});
