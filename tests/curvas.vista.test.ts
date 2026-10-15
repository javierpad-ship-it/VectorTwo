import { describe, expect, it } from "vitest";
import type { AgrupacionResultado, EfectoAtipicoCorrida, EfectoTemporadaAnio, RedAnioApi } from "../src/lib/curvas/tipos-api";
import {
  cumpleEstado,
  celdaAnioMes,
  compararCurvas,
  contarEstados,
  descripcionClase,
  filasCsvAnioMes,
  filasCsvFactoresM7,
  filasCsvVigentes,
  filasForma,
  filtrarAgrupaciones,
  filtrarFilasForma,
  formatearDiferenciaPp,
  formatearFactor,
  formatearFechaHora,
  formatearPct,
  formatearPp,
  formatearRatio,
  fraseComparacion,
  lecturaVolumen,
  pideCorregirApertura,
  redVistaDeAgrupacion,
  redVistaDesdeRed,
  referenciaForma,
  textoAnio,
  textoAniosUsados,
  textoConfirmarAprobacion,
  textoMotivoRed,
  textoObsoleta,
  textoResumen,
  textoTotalRed,
  textoVeredictoForma,
  vistaPreviaDatos,
} from "../src/app/(app)/planificacion/curvas-estacionalidad/vista";
import { agrupacion, anio, aviso, curvaConPico, PLANA, propuesta, vigente } from "./curvas.pantalla.fixture";

describe("formatos", () => {
  it("porcentaje, puntos, ratio y factor (es-PE)", () => {
    expect(formatearPct(0.123)).toBe("12.3 %");
    expect(formatearPct(null)).toBe("—");
    expect(formatearPp(29.14)).toBe("29.1 pp");
    expect(formatearRatio(0.66)).toBe("0.66");
    expect(formatearRatio(0.975, 3)).toBe("0.975");
    expect(formatearFactor(0.6553)).toBe("×0.66");
    expect(formatearFactor(null)).toBe("—");
  });
  it("diferencia con signo: +, - y cero sin signo", () => {
    expect(formatearDiferenciaPp(1.84)).toBe("+1.8");
    expect(formatearDiferenciaPp(-0.44)).toBe("-0.4");
    expect(formatearDiferenciaPp(0.02)).toBe("0.0");
    expect(formatearDiferenciaPp(null)).toBe("—");
  });
  it("fecha y hora en Lima", () => {
    expect(formatearFechaHora("2026-10-14T15:42:00Z")).toBe("14/10/2026 10:42");
    expect(formatearFechaHora("no es fecha")).toBe("no es fecha");
  });
});

describe("textos de años", () => {
  it("normal, atípico completo incluido, con huecos imputado, en curso y escaso", () => {
    expect(textoAnio(anio(2024))).toBe("2024");
    expect(textoAnio(anio(2023, { clase: "atipico_completo", tratamiento: "incluido", meses_atipicos: 12 }))).toBe("2023 (atípico completo, incluido)");
    expect(textoAnio(anio(2023, { clase: "con_huecos", tratamiento: "imputado", meses_atipicos: 4 }))).toBe("2023 (4 meses atípicos, imputado)");
    expect(textoAnio(anio(2026, { clase: "en_curso", meses_atipicos: 9 }))).toBe("2026 parcial (atípico)");
    expect(textoAnio(anio(2025, { escaso: true }))).toBe("2025 (escaso)");
  });
  it("años usados: solo los que entraron al ajuste, con su clase", () => {
    const anios = [
      anio(2023, { clase: "atipico_completo", tratamiento: "incluido", meses_atipicos: 12 }),
      anio(2024),
      anio(2025),
      anio(2026, { clase: "en_curso", en_ajuste: false, meses_atipicos: 9 }),
    ];
    expect(textoAniosUsados(anios)).toBe("2023 (atípico completo, incluido) · 2024 · 2025");
  });
  it("descripción de la clase para la cabecera de la tabla", () => {
    expect(descripcionClase(anio(2024))).toBe("normal");
    expect(descripcionClase(anio(2026, { clase: "en_curso", meses_cargados: 9, meses_atipicos: 9 }))).toBe("parcial, ene–set, atípico");
  });
});

describe("comparador vigente / propuesta", () => {
  it("curvas iguales: EAT 0 y no difieren si es el mismo modelo", () => {
    const c = compararCurvas(PLANA, PLANA, true)!;
    expect(c.eat).toBeCloseTo(0, 9);
    expect(c.difiere).toBe(false);
  });
  it("modelo distinto con curva igual sí «difiere»", () => {
    expect(compararCurvas(PLANA, PLANA, false)!.difiere).toBe(true);
  });
  it("diferencias en puntos, EAT y mes de mayor cambio", () => {
    const v = [...PLANA];
    const p = [...PLANA];
    p[0] += 0.018; // +1,8 pp en enero
    p[5] -= 0.018; // -1,8 pp en junio (menor magnitud abajo)
    p[2] += 0.005;
    p[7] -= 0.005;
    const c = compararCurvas(v, p, true)!;
    expect(c.diferencias[0]).toBeCloseTo(1.8, 6);
    expect(c.eat).toBeCloseTo(1.8 * 2 + 0.5 * 2, 6);
    expect(c.mesMayorCambio).toBe(1);
    expect(c.diferenciaMayor).toBeCloseTo(1.8, 6);
    expect(c.difiere).toBe(true);
    expect(fraseComparacion(c)).toBe("EAT entre ambas: 4.6 pp; el mes que más cambia: enero (+1.8)");
  });
  it("las diferencias suman cero (las dos curvas suman 1)", () => {
    const c = compararCurvas(curvaConPico(3, 0.3), curvaConPico(9, 0.25), true)!;
    expect(c.diferencias.reduce((s, d) => s + d, 0)).toBeCloseTo(0, 6);
  });
  it("longitudes inválidas devuelven null", () => {
    expect(compararCurvas([1], PLANA)).toBeNull();
  });
});

describe("confirm de aprobación", () => {
  const anios = [anio(2023, { clase: "atipico_completo", tratamiento: "incluido", meses_atipicos: 12 }), anio(2024), anio(2025), anio(2026, { clase: "en_curso", en_ajuste: false })];
  const base = {
    agrupacion: "ABRIGO SINTÉTICO",
    modelo: "B" as const,
    recomendada: "A" as const,
    anios,
    eat: 27.4,
    ruidoNormal: 33,
    versionVigente: 2,
    comparacion: compararCurvas(PLANA, curvaConPico(1, 0.1), false),
    avisos: [aviso("pocos_anos_normales", "2 años normales (2024, 2025)")],
    nota: "",
  };

  it("resume modelo, años con su clase, EAT frente al ruido, diferencia con la vigente y avisos", () => {
    const t = textoConfirmarAprobacion(base);
    expect(t).toContain("B · Ponderado por volumen");
    expect(t).toContain("ABRIGO SINTÉTICO");
    expect(t).toContain("No es la recomendada (A)");
    expect(t).toContain("Años usados: 2023 (atípico completo, incluido) · 2024 · 2025.");
    expect(t).toContain("Fuera del ajuste: 2026 parcial.");
    expect(t).toContain("EAT: 27.4 pp; ruido entre años normales: 33.0 pp.");
    expect(t).toContain("Reemplaza la v2: difiere");
    expect(t).toContain("el mes que más cambia es enero");
    expect(t).toContain("Avisos: 2 años normales (2024, 2025)");
  });
  it("sin vigente será la versión 1; sin ruido medible lo dice; con nota la repite", () => {
    const t = textoConfirmarAprobacion({ ...base, versionVigente: null, comparacion: null, ruidoNormal: null, recomendada: "B", avisos: [], nota: " porque sí " });
    expect(t).toContain("será la versión 1");
    expect(t).toContain("no medible");
    expect(t).not.toContain("No es la recomendada");
    expect(t).not.toContain("Avisos:");
    expect(t).toContain("Nota: porque sí");
  });
  it("una curva prestada (T) lo dice y no inventa EAT", () => {
    const t = textoConfirmarAprobacion({ ...base, modelo: "T", recomendada: "T", eat: null });
    expect(t).toContain("Curva prestada de la temporada");
    expect(t).not.toContain("EAT:");
  });
  it("con un solo año de ajuste, EAT sin backtesting", () => {
    expect(textoConfirmarAprobacion({ ...base, eat: null })).toContain("sin backtesting");
  });
});

describe("filtros de la tabla de Curvas", () => {
  const sinCurva = agrupacion({ id: "1", nombre: "A SIN CURVA" });
  const obsoleta = agrupacion({
    id: "2",
    nombre: "B OBSOLETA",
    vigente: vigente(),
    obsoleta: { motivos: [{ codigo: "tienda_entra_red", detalle: "la tienda X entra en la red de 2026" }] },
    propuesta: propuesta({ difiere_de_vigente: true, eat_vs_vigente: 4.1, avisos: [aviso("pocos_anos_normales")] }),
  });
  const prestada = agrupacion({ id: "3", nombre: "C PRESTADA", temporada: "verano", vigente: vigente({ origen: "prestada", modelo: "T" }), propuesta: propuesta({ origen: "prestada", veredicto_forma: "forma_cambia" }) });
  const inactiva = agrupacion({ id: "4", nombre: "0 INACTIVA", activo: false, vigente: vigente() });
  const todas = [inactiva, prestada, obsoleta, sinCurva];

  it("cada chip de estado", () => {
    expect(cumpleEstado(sinCurva, "sin_curva")).toBe(true);
    expect(cumpleEstado(obsoleta, "sin_curva")).toBe(false);
    expect(cumpleEstado(obsoleta, "obsoletas")).toBe(true);
    expect(cumpleEstado(obsoleta, "distinta")).toBe(true);
    expect(cumpleEstado(obsoleta, "con_avisos")).toBe(true);
    expect(cumpleEstado(prestada, "prestadas")).toBe(true);
    expect(cumpleEstado(prestada, "forma_cambia")).toBe(true);
    expect(cumpleEstado(sinCurva, "con_avisos")).toBe(false);
  });
  it("los conteos solo cuentan agrupaciones activas", () => {
    const c = contarEstados(todas);
    expect(c.todas).toBe(3);
    expect(c.sin_curva).toBe(1);
    expect(c.obsoletas).toBe(1);
    expect(c.prestadas).toBe(1);
  });
  it("sin chips: alfabético y las inactivas al final; con chip, solo activas", () => {
    expect(filtrarAgrupaciones(todas, { temporada: "todas", estado: "todas", genero: "", busqueda: "" }).map((a) => a.id)).toEqual(["1", "2", "3", "4"]);
    expect(filtrarAgrupaciones(todas, { temporada: "invierno", estado: "todas", genero: "", busqueda: "" }).map((a) => a.id)).toEqual(["1", "2"]);
    expect(filtrarAgrupaciones(todas, { temporada: "todas", estado: "obsoletas", genero: "", busqueda: "" }).map((a) => a.id)).toEqual(["2"]);
  });
  it("género y buscador", () => {
    const m = agrupacion({ id: "5", nombre: "MUJER ALGO", generos: ["MUJER"] });
    expect(filtrarAgrupaciones([...todas, m], { temporada: "todas", estado: "todas", genero: "MUJER", busqueda: "" }).map((a) => a.id)).toEqual(["5"]);
    expect(filtrarAgrupaciones(todas, { temporada: "todas", estado: "todas", genero: "", busqueda: "prestada" }).map((a) => a.id)).toEqual(["3"]);
  });
  it("texto de obsolescencia con todos los motivos", () => {
    expect(textoObsoleta(obsoleta.obsoleta)).toBe("Obsoleta: la tienda X entra en la red de 2026");
    expect(textoObsoleta(null)).toBeNull();
    expect(textoObsoleta({ motivos: [] })).toBeNull();
  });
  it("resumen de la cabecera", () => {
    expect(textoResumen({ agrupaciones_activas: 15, con_curva_vigente: 12, sin_curva_con_venta: 3, obsoletas: 2, sin_revisar_toda_temporada: 10 })).toBe(
      "15 agrupaciones activas · 12 con curva vigente · 3 sin curva con venta · 2 obsoletas · 10 siguen en Toda temporada"
    );
    expect(textoResumen({ agrupaciones_activas: 1, con_curva_vigente: 1, sin_curva_con_venta: 0, obsoletas: 1, sin_revisar_toda_temporada: 1 })).toBe(
      "1 agrupación activa · 1 con curva vigente · 0 sin curva con venta · 1 obsoleta · 1 sigue en Toda temporada"
    );
  });
});

describe("vista previa de los datos", () => {
  it("45 meses: tres años completos y 2026 parcial", () => {
    const t = vistaPreviaDatos({ desde: "2023-01", hasta: "2026-09", meses_publicados: 45, faltantes: [] }, 4, { invierno: 4, verano: 1, todo_el_ano: 10 });
    expect(t).toBe("45 meses, 2023-01 a 2026-09; 2023, 2024 y 2025 completos; 2026 parcial (9); 4 periodos activos; 4 de invierno, 1 de verano, 10 de toda temporada");
  });
  it("un mes faltante deja el año como parcial; sin datos lo dice", () => {
    const t = vistaPreviaDatos({ desde: "2024-01", hasta: "2025-12", meses_publicados: 23, faltantes: ["2024-05"] }, 1, { invierno: 0, verano: 0, todo_el_ano: 1 });
    expect(t).toContain("2025 completo");
    expect(t).toContain("2024 parcial (11)");
    expect(t).toContain("1 periodo activo");
    expect(vistaPreviaDatos({ desde: null, hasta: null, meses_publicados: 0, faltantes: [] }, 0, { invierno: 0, verano: 0, todo_el_ano: 0 })).toContain("Todavía no hay meses");
  });
});

describe("efecto del Niño: lecturas", () => {
  const fila = (extra: Partial<EfectoTemporadaAnio>): EfectoTemporadaAnio => ({
    anio: 2026,
    temporada: "invierno",
    agrupaciones: 4,
    ratio_volumen: 0.66,
    ratio_control: 0.975,
    ratio_relativo: 0.68,
    crecimiento_normal: 1.034,
    anio_referencia: 2025,
    tiendas_comunes: 9,
    meses_comparados: 9,
    unidades: 100,
    unidades_referencia: 150,
    ratio_mensual: Array(12).fill(null),
    ...extra,
  });

  it("invierno 2026 ene–set con control y relativo", () => {
    expect(lecturaVolumen(fila({}))).toBe(
      "Invierno 2026 (ene–set): 0.66 frente a 2025 en las mismas 9 tiendas; la red de toda temporada hace 0.975: relativo 0.68, distinto del crecimiento normal de la temporada (1.03)."
    );
  });
  it("verano con relativo del orden del crecimiento normal", () => {
    expect(lecturaVolumen(fila({ temporada: "verano", ratio_volumen: 1.238, ratio_relativo: 1.27, crecimiento_normal: 1.287, agrupaciones: 1 }))).toContain("del orden del crecimiento normal de la temporada (1.29)");
  });
  it("sin referencia o sin control", () => {
    expect(lecturaVolumen(fila({ ratio_volumen: null }))).toContain("sin año normal o sin tiendas comunes");
    const t = lecturaVolumen(fila({ temporada: "todo_el_ano", ratio_control: null, ratio_relativo: null }));
    expect(t).toBe("Toda temporada 2026 (ene–set): 0.66 frente a 2025 en las mismas 9 tiendas.");
  });
  it("año completo no lleva rango de meses", () => {
    expect(lecturaVolumen(fila({ anio: 2023, anio_referencia: 2024, meses_comparados: 12 }))).toMatch(/^Invierno 2023: /);
  });

  it("veredicto de forma con las tres cifras", () => {
    expect(textoVeredictoForma({ veredicto: "forma_estable", diferencia: 31.2, ruido: 33, umbralEfectivo: 33 })).toBe(
      "difiere 31.2 pp de la referencia; los años normales difieren 33.0 pp entre sí: estable respecto al ruido"
    );
    expect(textoVeredictoForma({ veredicto: "forma_cambia", diferencia: 48, ruido: 24, umbralEfectivo: 24 })).toContain("la forma cambia");
    expect(textoVeredictoForma({ veredicto: "forma_estable", diferencia: 2, ruido: null, umbralEfectivo: 3 })).toContain("manda el piso de 3.0 pp");
    expect(textoVeredictoForma({ veredicto: "sin_comparacion", diferencia: null, ruido: null, umbralEfectivo: 3 })).toContain("Sin año normal");
  });

  it("filas de forma: una por agrupación y año, con filtros", () => {
    const forma = (veredicto: "forma_estable" | "forma_cambia") => ({
      ruido_normal: 33 as number | null,
      umbral_efectivo: 33,
      por_anio: [
        { anio: 2023, parcial: false as const, diferencia_anio: veredicto === "forma_cambia" ? 48 : 31, pico: 6, pico_referencia: 6, corrimiento_pico: 0, mes_mayor_diferencia: 4, veredicto, tratamiento_aplicado: "incluido" as const },
        { anio: 2026, parcial: true as const, meses_comparados: 9, red_completa: { diferencia_anio: 12.1, pico: 7 }, tiendas_comunes: { diferencia_anio: 9.4, pico: 7, tiendas: 9 }, veredicto: null, tratamiento_aplicado: null },
      ],
    });
    const filas = filasForma(
      [
        { id: "b", nombre: "B", temporada: "invierno", efecto_atipico: { forma: forma("forma_cambia") } },
        { id: "a", nombre: "A", temporada: "invierno", efecto_atipico: { forma: forma("forma_estable") } },
        { id: "c", nombre: "C", temporada: "todo_el_ano", efecto_atipico: { forma: null } },
      ],
      [
        { anio: 2023, clase_por_temporada: { invierno: "atipico_completo", verano: "con_huecos", todo_el_ano: "normal" } },
        { anio: 2026, clase_por_temporada: { invierno: "en_curso", verano: "en_curso", todo_el_ano: "en_curso" } },
      ]
    );
    expect(filas.map((f) => f.clave)).toEqual(["a-2023", "a-2026", "b-2023", "b-2026"]);
    expect(filas[0].clase).toBe("atipico_completo");
    expect(filas[1].parcial).toBe(true);
    expect(filas[1].parcialRed).toBe(12.1);
    expect(filas[1].parcialComunes).toBe(9.4);
    expect(filtrarFilasForma(filas, "todas", "forma_cambia").map((f) => f.agrupacion)).toEqual(["B"]);
    expect(filtrarFilasForma(filas, "todas", "parcial")).toHaveLength(2);
    expect(filtrarFilasForma(filas, "verano", "todos")).toHaveLength(0);
    expect(filtrarFilasForma(filas, "invierno", "todos")).toHaveLength(4);
  });
});

describe("referencia de forma y celdas año × mes", () => {
  it("la referencia es el promedio de los años normales (no de atípicos ni del año en curso)", () => {
    const a = curvaConPico(1, 0.2);
    const b = curvaConPico(7, 0.2);
    const r = referenciaForma([anio(2024, { participacion: a, participacion_real: a }), anio(2025, { participacion: b, participacion_real: b }), anio(2023, { clase: "atipico_completo" })])!;
    expect(r[0]).toBeCloseTo((a[0] + b[0]) / 2, 9);
    expect(r.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 9);
    expect(referenciaForma([anio(2023, { clase: "atipico_completo" })])).toBeNull();
  });

  it("año en curso: «—» (null) en los meses sin cargar", () => {
    const parcial = Array.from({ length: 12 }, (_, i) => (i < 9 ? 1 / 9 : 0));
    const a = anio(2026, { clase: "en_curso", meses_cargados: 9, participacion: null, participacion_parcial: parcial, atipicos: ["2026-02"], liquidacion: ["2026-03"], imputados: [] });
    expect(celdaAnioMes(a, 1)).toMatchObject({ atipico: true, liquidacion: false });
    expect(celdaAnioMes(a, 2).liquidacion).toBe(true);
    expect(celdaAnioMes(a, 9)).toMatchObject({ participacion: null, unidades: null });
    expect(celdaAnioMes(a, 0).participacion).toBeCloseTo(1 / 9, 9);
  });

  it("imputados 1-12 se marcan en la celda del mes correspondiente", () => {
    const a = anio(2023, { imputados: [9] });
    expect(celdaAnioMes(a, 8).imputado).toBe(true);
    expect(celdaAnioMes(a, 9).imputado).toBe(false);
  });

  it("CSV año × mes: 12 filas, dos columnas por año y diferencia", () => {
    const { campos, datos } = filasCsvAnioMes([anio(2025), anio(2024)], PLANA, curvaConPico(1, 0.1));
    expect(campos).toEqual(["MES", "2024 (%)", "2024 (unidades)", "2025 (%)", "2025 (unidades)", "PROPUESTA (%)", "VIGENTE (%)", "DIFERENCIA (pp)"]);
    expect(datos).toHaveLength(12);
    expect(datos[0][0]).toBe("Ene");
    expect(datos[0][1]).toBe(8.3);
    expect(datos[0][2]).toBe(100);
    expect(datos[0]).toHaveLength(campos.length);
    expect(filasCsvAnioMes([anio(2024)], null, null).datos[0].slice(-3)).toEqual(["", "", ""]);
  });
});

describe("red comparable", () => {
  const tienda = (id: string, extra: Record<string, unknown> = {}) => ({
    tienda_id: id,
    codigo: id.toUpperCase(),
    nombre: `TIENDA ${id.toUpperCase()}`,
    entra: true,
    motivos: [] as never[],
    meses_sin_venta: [] as string[],
    primer_mes_con_venta: null,
    entra_desde: null,
    unidades: 100,
    peso: 0.31,
    participacion: PLANA,
    eat_vs_red: 3,
    distinta: false,
    ...extra,
  });
  const red: RedAnioApi[] = [
    {
      anio: 2025,
      tiendas: [tienda("t1", { peso: 0.62 }), tienda("t2", { entra: false, peso: 0, participacion: null, motivos: ["no_abierta_todo_el_ano"] })],
      total_unidades: 200,
      dominante: "t1",
      peso_mayor: 0.62,
      sin_red: false,
      participacion: PLANA,
      ruido_normal: null,
    },
    {
      anio: 2026,
      tiendas: [tienda("t1", { peso: 0.3 }), tienda("t2", { peso: 0.22, distinta: true, eat_vs_red: 14.2 })],
      total_unidades: 300,
      dominante: null,
      peso_mayor: 0.3,
      sin_red: false,
      participacion: PLANA,
      ruido_normal: 30,
    },
  ];

  it("adapta la red de la corrida: tiendas ordenadas y datos por año", () => {
    const v = redVistaDesdeRed(red);
    expect(v.tiendas.map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(v.anios[0].tiendasEnRed).toBe(1);
    expect(v.anios[0].tiendasTotal).toBe(2);
    expect(v.anios[0].dominante).toBe("t1");
    expect(v.anios[1].tiendas.get("t2")!.distinta).toBe(true);
    expect(textoTotalRed(v.anios[0])).toBe("1 de 2 tiendas · la mayor pesa 62.0 %");
    expect(textoTotalRed({ sinRed: true, tiendasEnRed: 0, tiendasTotal: 3, pesoMayor: null })).toContain("Sin red comparable");
  });

  it("la red de una agrupación usa los pesos de la agrupación y recalcula la dominante con el umbral", () => {
    const resultado = {
      anios: [
        anio(2025, { por_tienda: [{ tienda_id: "t1", unidades: 90, peso: 0.9, participacion: PLANA, eat_vs_red: 0, distinta: false }] }),
        anio(2026, { por_tienda: [
          { tienda_id: "t1", unidades: 60, peso: 0.6, participacion: PLANA, eat_vs_red: 1, distinta: false },
          { tienda_id: "t2", unidades: 40, peso: 0.4, participacion: curvaConPico(1, 0.3), eat_vs_red: 20, distinta: true },
        ] }),
      ],
    } as Pick<AgrupacionResultado, "anios">;
    const v = redVistaDeAgrupacion(red, [{ id: "t1", codigo: "T1", nombre: "T1" }, { id: "t2", codigo: "T2", nombre: "T2" }], resultado, 0.5);
    expect(v.anios[0].tiendas.get("t1")!.peso).toBe(0.9);
    expect(v.anios[0].tiendas.get("t2")!.entra).toBe(false);
    expect(v.anios[0].dominante).toBe("t1");
    expect(v.anios[1].dominante).toBe("t1");
    expect(v.anios[1].tiendas.get("t2")!.eatVsRed).toBe(20);
    expect(v.anios[1].totalUnidades).toBe(100);
    // con un umbral más alto nadie es dominante
    expect(redVistaDeAgrupacion(red, [], resultado, 0.95).anios[1].dominante).toBeNull();
  });

  it("motivos legibles de las tiendas fuera de la red", () => {
    const base = { entra: false, motivos: [], mesesSinVenta: [], primerMesConVenta: null, entraDesde: null };
    expect(textoMotivoRed({ ...base, motivos: ["centro_distribucion"] })).toBe("Centro de distribución");
    expect(textoMotivoRed({ ...base, motivos: ["tienda_desactivada"] })).toBe("Tienda desactivada");
    expect(textoMotivoRed({ ...base, motivos: ["no_abierta_todo_el_ano"] })).toBe("No abierta todo el año");
    expect(textoMotivoRed({ ...base, motivos: ["tienda_nueva"], entraDesde: 2027 })).toBe("Tienda nueva: entra en 2027");
    expect(textoMotivoRed({ ...base, motivos: ["meses_sin_venta"], mesesSinVenta: ["2024-01", "2024-02", "2024-03", "2024-04", "2024-05"] })).toBe("Sin venta en ene–may");
    expect(textoMotivoRed({ ...base, motivos: ["meses_sin_venta", "apertura_dudosa"], mesesSinVenta: ["2023-01", "2023-02"], primerMesConVenta: "2023-07" })).toBe("Apertura dudosa: vende desde 2023-07");
    expect(textoMotivoRed({ ...base, motivos: ["meses_sin_venta", "cierre_dudoso"], mesesSinVenta: ["2025-11", "2025-12"] })).toBe("Sin venta en nov–dic (cierre dudoso)");
    expect(pideCorregirApertura({ motivos: ["apertura_dudosa"] })).toBe(true);
    expect(pideCorregirApertura({ motivos: ["centro_distribucion"] })).toBe(false);
  });

  it("una tienda que entra solo muestra aviso si falta su fecha de apertura", () => {
    const base = { entra: true, motivos: [] as never[], mesesSinVenta: [], primerMesConVenta: null, entraDesde: null };
    expect(textoMotivoRed(base)).toBeNull();
    expect(textoMotivoRed({ ...base, motivos: ["tienda_sin_apertura"] })).toBe("Sin fecha de apertura en Tiendas");
  });
});

describe("CSV", () => {
  it("curvas vigentes: solo activas con curva, alfabético, meses en %", () => {
    const { campos, datos } = filasCsvVigentes([
      agrupacion({ id: "2", nombre: "B", codigo: "B", vigente: vigente({ version: 3, eat: null }) }),
      agrupacion({ id: "1", nombre: "A", codigo: "A", vigente: vigente({ version: 1, curva: curvaConPico(1, 0.5) }) }),
      agrupacion({ id: "3", nombre: "C", codigo: "C" }),
      agrupacion({ id: "4", nombre: "D", codigo: "D", activo: false, vigente: vigente() }),
    ]);
    expect(campos.slice(0, 6)).toEqual(["AGRUPACION", "CODIGO", "VERSION", "MODELO", "ORIGEN", "ENE (%)"]);
    expect(campos.slice(-2)).toEqual(["EAT", "APROBADA"]);
    expect(datos.map((f) => f[0])).toEqual(["A", "B"]);
    expect(datos[0][5]).toBe(50);
    expect(datos[1][17]).toBe("");
    expect(datos[0]).toHaveLength(campos.length);
    expect(datos[0][18]).toBe("2026-10-14");
  });

  it("factores para M7: una fila por factor y una por crecimiento normal", () => {
    const efecto = {
      umbral_forma: 3,
      margen_ruido: 0.25,
      por_temporada: [
        { anio: 2026, temporada: "verano", agrupaciones: 1, ratio_volumen: 1.238, ratio_control: 0.975, ratio_relativo: 1.27, crecimiento_normal: 1.287, anio_referencia: 2025, tiendas_comunes: 9, meses_comparados: 9, unidades: 1, unidades_referencia: 1, ratio_mensual: [] },
      ],
      crecimiento_normal: [{ temporada: "verano", anio: 2025, anio_referencia: 2024, ratio: 1.287, tiendas_comunes: 9 }],
      forma: {},
      avisos: [],
    } as unknown as EfectoAtipicoCorrida;
    const { campos, datos } = filasCsvFactoresM7(efecto);
    expect(campos).toContain("AGRUPACIONES");
    expect(datos).toHaveLength(2);
    expect(datos[0].slice(0, 6)).toEqual(["factor", "verano", 2026, 2025, 1, 1.238]);
    expect(datos[1].slice(0, 4)).toEqual(["crecimiento_normal", "verano", 2025, 2024]);
    expect(datos.every((f) => f.length === campos.length)).toBe(true);
  });
});
