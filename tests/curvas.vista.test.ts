import { describe, expect, it } from "vitest";
import type { AgrupacionResultado, EfectoAtipicoCorrida, EfectoTemporadaAnio, RedAnioApi, TrabajoAgrupacionApi } from "../src/lib/curvas/tipos-api";
import {
  celdaAnioMes,
  compararCurvas,
  contarEstados,
  cumpleEstado,
  descripcionClase,
  esIdAgrupacion,
  esModeloCurva,
  etiquetaAprobada,
  etiquetaPropuesta,
  filasCsvAnioMes,
  filasCsvFactoresM7,
  filasCsvVigentes,
  filtrarAgrupaciones,
  formatearDiferenciaPp,
  formatearFactor,
  formatearFechaHora,
  formatearPct,
  formatearPp,
  formatearRatio,
  fraseComparacion,
  lecturaVolumen,
  motivoAnioSinDatos,
  pideCorregirApertura,
  redVistaDeAgrupacion,
  redVistaDesdeRed,
  referenciaForma,
  resumenMensual,
  resumirComparacion,
  sistemaHoy,
  textoAnio,
  textoAniosUsados,
  textoBloqueo,
  textoComparacionFila,
  textoConfirmarAprobacion,
  textoEatConRuido,
  textoMotivoRed,
  textoNoComparable,
  textoObsoleta,
  textoPropone,
  textoResumen,
  textoRuido,
  textoTotalRed,
  textoVeredictoForma,
} from "../src/app/(app)/planificacion/curvas-estacionalidad/vista";
import { agrupacion, anio, curvaConPico, PLANA, vigente } from "./curvas.pantalla.fixture";

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
    temporada: "invierno" as const,
    modelo: "B" as const,
    recomendada: "A" as const,
    anios,
    eat: 27.4,
    ruidoNormal: 33,
    versionVigente: 2,
    comparacion: compararCurvas(PLANA, curvaConPico(1, 0.1), false),
    comparableConVigente: true as boolean | null,
    aniosAjusteVigente: [2023, 2024, 2025] as number[] | null,
    aniosExcluidos: [] as number[],
    tiendasExcluidas: [] as string[],
    tratamiento: "auto" as const,
    hasta: "2026-09",
    avisos: [{ detalle: "2 años normales (2024, 2025)" }],
    nota: "",
  };

  it("resume agrupación, temporada, modelo, años con su clase, EAT frente al ruido, hasta, diferencia con la vigente y avisos", () => {
    const t = textoConfirmarAprobacion(base);
    expect(t).toContain("B · Ponderado por volumen");
    expect(t).toContain("ABRIGO SINTÉTICO");
    expect(t).toContain("Temporada: Invierno.");
    expect(t).toContain("No es la recomendada (A)");
    expect(t).toContain("Años usados: 2023 (atípico completo, incluido) · 2024 · 2025.");
    expect(t).toContain("Fuera del ajuste: 2026 parcial.");
    expect(t).toContain("EAT: 27.4 pp; ruido entre años normales: 33.0 pp.");
    expect(t).toContain("Datos hasta 2026-09.");
    expect(t).toContain("Reemplaza la v2: difiere");
    expect(t).toContain("el mes que más cambia es enero");
    expect(t).toContain("Avisos: 2 años normales (2024, 2025)");
    expect(t).not.toContain("no comparable");
    expect(t).not.toContain("excluidos a mano");
    expect(t).not.toContain("Tratamiento del Niño");
  });
  it("lo excluido a mano, el tratamiento distinto de auto y el EAT no comparable se dicen", () => {
    const t = textoConfirmarAprobacion({ ...base, comparableConVigente: false, aniosAjusteVigente: [2024, 2025], aniosExcluidos: [2023], tiendasExcluidas: ["T10", "T04"], tratamiento: "descartar" });
    expect(t).toContain("Años excluidos a mano: 2023.");
    expect(t).toContain("Tiendas excluidas a mano: T10 y T04.");
    expect(t).toContain("Tratamiento del Niño: descartar");
    expect(t).toContain("EAT no comparable con el de la v2: aquella ajustó con 2024 y 2025; esta, con 2023, 2024 y 2025.");
  });
  it("sin vigente será la versión 1; sin ruido medible lo dice; con nota la repite", () => {
    const t = textoConfirmarAprobacion({ ...base, versionVigente: null, comparacion: null, comparableConVigente: null, aniosAjusteVigente: null, ruidoNormal: null, recomendada: "B", avisos: [], nota: " porque sí " });
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

describe("lista de agrupaciones (v2): estados, filtros y resumen", () => {
  const sinCurva = agrupacion({ id: "1", nombre: "A SIN CURVA" });
  const bloqueada = agrupacion({ id: "6", nombre: "A2 BLOQUEADA", bloqueada_por: ["periodos_temporada_faltantes"] });
  const alDia = agrupacion({ id: "2", nombre: "B AL DIA", estado: "al_dia", vigente: vigente() });
  const distinta = agrupacion({ id: "3", nombre: "C DISTINTA", temporada: "verano", estado: "al_dia_distinta", vigente: vigente({ modelo: "B", recomendada: false, recomendada_entonces: "A" }) });
  const obsoleta = agrupacion({
    id: "4",
    nombre: "D OBSOLETA",
    estado: "obsoleta",
    vigente: vigente(),
    obsoleta: { motivos: [{ codigo: "tienda_entra_red", detalle: "la tienda X entra en la red de 2026" }] },
  });
  const inactiva = agrupacion({ id: "5", nombre: "0 INACTIVA", activo: false, estado: "inactiva_con_curva", vigente: vigente() });
  const todas = [inactiva, distinta, alDia, obsoleta, bloqueada, sinCurva];
  const f = (o: Partial<{ temporada: "todas" | "invierno" | "verano" | "todo_el_ano"; estado: "todas" | "sin_curva" | "obsoletas" | "distintas" | "al_dia" | "bloqueadas"; genero: string; busqueda: string }> = {}) =>
    filtrarAgrupaciones(todas, { temporada: "todas", estado: "todas", genero: "", busqueda: "", ...o }).map((a) => a.id);

  it("cada chip de estado sale del campo `estado` y de `bloqueada_por`", () => {
    expect(cumpleEstado(sinCurva, "sin_curva")).toBe(true);
    expect(cumpleEstado(alDia, "sin_curva")).toBe(false);
    expect(cumpleEstado(alDia, "al_dia")).toBe(true);
    expect(cumpleEstado(distinta, "distintas")).toBe(true);
    expect(cumpleEstado(distinta, "al_dia")).toBe(false);
    expect(cumpleEstado(obsoleta, "obsoletas")).toBe(true);
    expect(cumpleEstado(bloqueada, "bloqueadas")).toBe(true);
    expect(cumpleEstado(sinCurva, "bloqueadas")).toBe(false);
  });
  it("los conteos solo cuentan agrupaciones activas", () => {
    const c = contarEstados(todas);
    expect(c).toEqual({ todas: 5, sin_curva: 2, obsoletas: 1, distintas: 1, al_dia: 1, bloqueadas: 1 });
  });
  it("sin chips: alfabético y las inactivas al final; con chip, solo activas", () => {
    expect(f()).toEqual(["1", "6", "2", "3", "4", "5"]);
    expect(f({ temporada: "invierno" })).toEqual(["1", "6", "2", "4"]);
    expect(f({ estado: "obsoletas" })).toEqual(["4"]);
    expect(f({ estado: "bloqueadas" })).toEqual(["6"]);
  });
  it("género y buscador", () => {
    const m = agrupacion({ id: "7", nombre: "MUJER ALGO", generos: ["MUJER"] });
    expect(filtrarAgrupaciones([...todas, m], { temporada: "todas", estado: "todas", genero: "MUJER", busqueda: "" }).map((a) => a.id)).toEqual(["7"]);
    expect(f({ busqueda: "distinta" })).toEqual(["3"]);
  });
  it("texto de obsolescencia con todos los motivos", () => {
    expect(textoObsoleta(obsoleta.obsoleta)).toBe("Obsoleta: la tienda X entra en la red de 2026");
    expect(textoObsoleta(null)).toBeNull();
    expect(textoObsoleta({ motivos: [] })).toBeNull();
  });
  it("resumen de la cabecera con bloqueadas y calculables", () => {
    const r = { agrupaciones_activas: 15, por_temporada: { invierno: 4, verano: 1, todo_el_ano: 10 }, sin_revisar_toda_temporada: 10, con_curva_vigente: 6, al_dia: 3, al_dia_distintas: 1, obsoletas: 2, sin_curva: 9, bloqueadas: 5, bloqueadas_sin_curva: 5, calculables_sin_curva: 4, vigentes_prestadas: 0, inactivas_con_curva: 0, equivalencias_sin_agrupacion: 0 };
    expect(textoResumen(r)).toBe(
      "15 agrupaciones activas · 3 con curva al día · 1 aprobada distinta de la recomendada · 2 obsoletas · 9 sin curva (5 bloqueadas, 4 calculables) · 10 siguen en Toda temporada (revísalas)"
    );
    expect(textoResumen({ ...r, agrupaciones_activas: 1, al_dia: 1, al_dia_distintas: 0, obsoletas: 1, sin_curva: 0, bloqueadas_sin_curva: 0, calculables_sin_curva: 0, sin_revisar_toda_temporada: 0, inactivas_con_curva: 2 })).toBe(
      "1 agrupación activa · 1 con curva al día · 0 aprobadas distintas de la recomendada · 1 obsoleta · 0 sin curva · 2 inactivas con curva · 0 siguen en Toda temporada"
    );
  });
  it("bloqueos legibles por código", () => {
    expect(textoBloqueo("periodos_temporada_faltantes", "invierno")).toBe("Bloqueada: sin periodos para invierno");
    expect(textoBloqueo("periodos_temporada_faltantes", "todo_el_ano")).toBe("Bloqueada: sin periodos para toda temporada");
    expect(textoBloqueo("composicion_vacia", "verano")).toContain("sin equivalencias");
    expect(textoBloqueo("tienda_sin_apertura", "verano")).toContain("fecha de apertura");
  });
  it("«Sistema hoy» sin calcular: = (A) al día, A (vs B) distinta, comparar si obsoleta o sin curva calculable, nada si bloqueada o inactiva", () => {
    expect(sistemaHoy(alDia)).toEqual({ tipo: "igual", texto: "= (A)" });
    expect(sistemaHoy(distinta)).toEqual({ tipo: "distinta", texto: "A (vs B)" });
    expect(sistemaHoy(obsoleta)).toEqual({ tipo: "comparar" });
    expect(sistemaHoy(sinCurva)).toEqual({ tipo: "comparar" });
    expect(sistemaHoy(bloqueada)).toEqual({ tipo: "ninguno" });
    expect(sistemaHoy(inactiva)).toEqual({ tipo: "ninguno" });
  });
});

describe("Comparar con el sistema (por fila)", () => {
  const prerreq = { bloquea: [], avisa: [] };
  const resultado = {
    recomendada: "A",
    candidatas: [
      { modelo: "A", curva: PLANA, eat: 29.1 },
      { modelo: "T", curva: null, eat: null },
    ],
  };
  const t = (extra: Partial<Pick<TrabajoAgrupacionApi, "prerrequisitos" | "calculo" | "comparador">>) =>
    ({ prerrequisitos: prerreq, calculo: { resultado, temporada_curva: { curva_T: PLANA } }, comparador: null, ...extra }) as unknown as Pick<TrabajoAgrupacionApi, "prerrequisitos" | "calculo" | "comparador">;

  it("bloqueada por prerrequisitos: dice cuál", () => {
    const r = resumirComparacion(t({ calculo: null, prerrequisitos: { bloquea: [{ codigo: "periodos_temporada_faltantes", nivel: "bloquea", detalle: "No hay periodos atípicos para invierno.", enlace: null }], avisa: [] } }));
    expect(r).toEqual({ tipo: "bloqueada", detalle: "No hay periodos atípicos para invierno." });
    expect(textoComparacionFila(r)).toBe("No se puede calcular: No hay periodos atípicos para invierno.");
  });
  it("sin vigente: la candidata recomendada y su curva", () => {
    const r = resumirComparacion(t({}));
    expect(r).toEqual({ tipo: "sin_vigente", modelo: "A", eat: 29.1, curva: PLANA });
    expect(textoComparacionFila(r)).toBe("A · sin vigente con la que comparar");
  });
  it("con vigente: diferencia en pp, igualdad y comparabilidad", () => {
    const comp = { modelo: "A", propuesta: PLANA, vigente: PLANA, eat_vs_vigente: 4.1, diferencia_por_mes: [], mes_mayor_cambio: 1, difiere: true, comparable_con_vigente: true };
    const r = resumirComparacion(t({ comparador: comp as TrabajoAgrupacionApi["comparador"] }));
    expect(textoComparacionFila(r)).toBe("A · difiere 4.1 pp de la vigente");
    expect(textoComparacionFila(resumirComparacion(t({ comparador: { ...comp, comparable_con_vigente: false } as TrabajoAgrupacionApi["comparador"] })))).toContain("EAT no comparable");
    expect(textoComparacionFila(resumirComparacion(t({ comparador: { ...comp, eat_vs_vigente: 0, difiere: false } as TrabajoAgrupacionApi["comparador"] })))).toBe("A · igual a la vigente");
  });
  it("sin candidata recomendada: sin curva posible", () => {
    const r = resumirComparacion(t({ calculo: { resultado: { ...resultado, recomendada: null } } as unknown as TrabajoAgrupacionApi["calculo"] }));
    expect(r.tipo).toBe("sin_candidata");
  });
});

describe("lo que propone el sistema", () => {
  const frase = "B se equivoca 27.4 pp frente a 29.1 de A en 3 pruebas; la diferencia (1.7) no llega al margen (8.3 = 25.0 % del ruido entre años normales, 33.0): se recomienda A.";
  const anios = [
    anio(2023, { clase: "atipico_completo", tratamiento: "incluido", meses_atipicos: 12 }),
    anio(2024),
    anio(2025),
    anio(2026, { clase: "en_curso", en_ajuste: false }),
  ];
  const r = (extra: Partial<AgrupacionResultado> = {}) =>
    ({ recomendada: "A", anios, comparacion: { frase }, origen: "propia", ruido_normal: 33, ruido_normal_detalle: [{ anios: [2024, 2025], eat: 33 }], ...extra }) as unknown as AgrupacionResultado;

  it("la frase: propone, con qué años, qué pasa con el del Niño y por qué no otra", () => {
    const t = textoPropone(r());
    expect(t.startsWith("Propone A · Promedio simple de 2023, 2024 y 2025 (2023, año del Niño, entra incluido).")).toBe(true);
    expect(t).toContain(frase);
    expect(t).not.toMatch(/\d\.\d{3}/);
  });
  it("nombra los años que quedaron fuera por tratamiento o por exclusión manual", () => {
    const t = textoPropone(r({ anios: [anio(2023, { clase: "atipico_completo", tratamiento: "descartado", tratamiento_motivo: "excluido_manual", en_ajuste: false }), anio(2024), anio(2025)], comparacion: null }));
    expect(t).toBe("Propone A · Promedio simple de 2024 y 2025. Fuera del ajuste: 2023 (excluido a mano).");
  });
  it("prestada (T) y sin curva posible", () => {
    expect(textoPropone(r({ recomendada: "T", comparacion: null }))).toContain("Curva de la temporada (prestada)");
    expect(textoPropone(r({ recomendada: null, comparacion: null }))).toContain("no puede proponer una curva");
  });
  it("el ruido entre años normales se muestra siempre: con los pares, o «no medible»", () => {
    expect(textoRuido(r())).toBe("Ruido entre años normales: 33.0 pp (2024 frente a 2025: 33.0 pp). Se muestra aunque no haya Niño.");
    expect(textoRuido(r({ ruido_normal: null, ruido_normal_detalle: [] }))).toContain("no medible");
  });
  it("EAT no comparable: dice con qué años ajustó la vigente y con cuáles hoy", () => {
    expect(textoNoComparable(false, [2025, 2024], [2023, 2024, 2025])).toBe("EAT no comparable con el cálculo anterior (la vigente usó 2024 y 2025; hoy 2023, 2024 y 2025).");
    expect(textoNoComparable(true, [2024], [2024])).toBeNull();
    expect(textoNoComparable(null, null, [2024])).toBeNull();
    expect(textoNoComparable(undefined, null, [2024])).toBeNull();
    expect(textoNoComparable(false, null, [])).toContain("otros años");
  });
  it("etiquetas de la propuesta y de la aprobada", () => {
    expect(etiquetaPropuesta("A")).toBe("Propuesta A · Promedio simple");
    expect(etiquetaAprobada(2, "A")).toBe("Aprobada v2 (A)");
  });
  it("la agrupación y la candidata de la URL se validan", () => {
    expect(esIdAgrupacion("0b8b6f0e-1c2d-4e3f-8a9b-0c1d2e3f4a5b")).toBe(true);
    expect(esIdAgrupacion("abc")).toBe(false);
    expect(esIdAgrupacion(null)).toBe(false);
    expect(esModeloCurva("T")).toBe(true);
    expect(esModeloCurva("F")).toBe(false);
    expect(esModeloCurva(null)).toBe(false);
  });
});

describe("EAT siempre con el ruido al lado (lista y Versiones)", () => {
  it("con ruido, no medible, sin dato y sin EAT", () => {
    expect(textoEatConRuido(29.14, 33)).toBe("EAT 29.1 · ruido 33.0");
    expect(textoEatConRuido(0, 33)).toBe("EAT 0.0 · ruido 33.0");
    expect(textoEatConRuido(29.1, null)).toBe("EAT 29.1 · ruido no medible");
    expect(textoEatConRuido(29.1, undefined)).toBe("EAT 29.1 · ruido sin dato");
    expect(textoEatConRuido(null, 33)).toBeNull();
  });
});

describe("tabla año × mes: promedio, índice, años considerados y años sin datos", () => {
  it("promedio y años considerados cuentan solo los años del ajuste; el índice es 1.00 en el mes promedio", () => {
    const a = anio(2024, { meses: [100, 200, ...Array(10).fill(100)] });
    const b = anio(2025, { meses: [300, 200, ...Array(10).fill(100)] });
    const fuera = anio(2023, { en_ajuste: false, meses: Array(12).fill(9999) });
    const r = resumenMensual([a, b, fuera]);
    expect(r.considerados).toEqual(Array(12).fill(2));
    expect(r.promedio[0]).toBe(200);
    expect(r.promedio[1]).toBe(200);
    expect(r.promedio[2]).toBe(100);
    // promedio de los doce promedios: (200 + 200 + 10 × 100) / 12 = 116.67
    expect(r.indice[0]).toBeCloseTo(200 / (1400 / 12), 9);
    expect(r.indice[2]).toBeLessThan(1);
    expect(r.indice.reduce<number>((s, v) => s + (v ?? 0), 0)).toBeCloseTo(12, 9);
  });
  it("sin años de ajuste (curva prestada) todo es «—» (null)", () => {
    const r = resumenMensual([anio(2024, { en_ajuste: false })]);
    expect(r.promedio.every((p) => p === null)).toBe(true);
    expect(r.indice.every((p) => p === null)).toBe(true);
    expect(r.considerados.every((n) => n === 0)).toBe(true);
  });
  it("un año del ajuste con meses sin cargar no aporta a los meses que le faltan", () => {
    const r = resumenMensual([anio(2024), anio(2025, { clase: "normal", meses_cargados: 6 })]);
    expect(r.considerados.slice(0, 6)).toEqual(Array(6).fill(2));
    expect(r.considerados.slice(6)).toEqual(Array(6).fill(1));
  });
  it("motivo de un año sin curva: sin red, meses sin cargar (con la lista), sin volumen; con curva, null", () => {
    const vacio = { participacion: null, participacion_real: null, participacion_parcial: null };
    expect(motivoAnioSinDatos(anio(2024), { sinRed: false, faltantes: [] })).toBeNull();
    expect(motivoAnioSinDatos(anio(2022, vacio), { sinRed: true, faltantes: [] })).toBe("sin red comparable");
    expect(motivoAnioSinDatos(anio(2024, { ...vacio, clase: "incompleto", meses_cargados: 7 }), { sinRed: false, faltantes: ["2024-05", "2025-02"] })).toBe("meses sin cargar: 2024-05");
    expect(motivoAnioSinDatos(anio(2024, { ...vacio, unidades: 0 }), { sinRed: false, faltantes: [] })).toBe("sin volumen en la red");
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
    expect(campos).toEqual([
      "MES",
      "2024 (%)",
      "2024 (unidades)",
      "2025 (%)",
      "2025 (unidades)",
      "PROPUESTA (%)",
      "APROBADA (%)",
      "DIFERENCIA (pp)",
      "PROMEDIO (unidades)",
      "INDICE (1.00 = promedio)",
      "ANIOS CONSIDERADOS",
    ]);
    expect(datos).toHaveLength(12);
    expect(datos[0][0]).toBe("Ene");
    expect(datos[0][1]).toBe(8.3);
    expect(datos[0][2]).toBe(100);
    expect(datos[0]).toHaveLength(campos.length);
    expect(filasCsvAnioMes([anio(2024)], null, null).datos[0].slice(-6, -3)).toEqual(["", "", ""]);
    // promedio, índice (1.00 si todos los meses valen igual) y años considerados de enero
    expect(datos[0].slice(-3)).toEqual([100, 1, 2]);
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
