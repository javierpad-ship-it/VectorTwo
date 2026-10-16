import { afterEach, describe, expect, it, vi } from "vitest";
import { evaluarCurvaUsuario } from "../src/lib/curvas/curva-usuario";
import { aprobarCurvaSchema } from "../src/lib/curvas/esquemas";
import type { AgrupacionResultado, CandidataApi, ParametrosCurvas, TrabajoAgrupacionApi } from "../src/lib/curvas/tipos-api";
import { CLAVE_USUARIO, COLOR_USUARIO, claveGml, construirSeries } from "../src/components/curvas/series";
import {
  PARTIDA_EN_BLANCO,
  borrarBorrador,
  guardarBorrador,
  leerBorrador,
  leerBorradorGuardado,
  leerCelda,
  lineasMedidaEnMuestra,
  normalizarTextos,
  opcionesPartida,
  serializarBorrador,
  sumaEnVivo,
  textoEatCandidata,
  textosDeValores,
  textosEnBlanco,
  valoresValidos,
} from "../src/app/(app)/planificacion/curvas-estacionalidad/curva-usuario-vista";
import {
  cuerpoAprobar,
  motivoNoSePuedeAprobar,
  motivosNotaRequerida,
  parametrosPorDefecto,
} from "../src/app/(app)/planificacion/curvas-estacionalidad/trabajo-vista";
import {
  cumpleEstado,
  filasCsvAnioMes,
  sistemaHoy,
  textoConfirmarAprobacion,
  textoPartida,
  textoPropone,
  textoResumen,
} from "../src/app/(app)/planificacion/curvas-estacionalidad/vista";
import { agrupacion, anio, PLANA, vigente } from "./curvas.pantalla.fixture";

/** Lógica pura de Mi curva (curva del usuario, 06c): editor, medida en muestra, aprobar, series, CSV y estado de la lista. */

const pct = (xs: number[]) => xs.map((x) => x / 100);
const P24 = pct([4.3, 4.4, 6.4, 8.3, 12.0, 13.7, 13.6, 11.65, 9.75, 6.9, 5.0, 4.0]);
const P25 = pct([4.3, 4.4, 6.4, 8.3, 10.1, 15.6, 13.6, 11.65, 9.75, 6.9, 5.0, 4.0]);
const A = pct([4.3, 4.4, 6.4, 8.3, 11.05, 14.65, 13.6, 11.65, 9.75, 6.9, 5.0, 4.0]);
const MI_CURVA = [5, 5, 6, 8, 11, 14, 13, 12, 10, 7, 5, 4];

const candidata = (modelo: CandidataApi["modelo"], curva: number[] | null, extra: Partial<CandidataApi> = {}): CandidataApi => ({
  modelo,
  curva,
  motivo: null,
  eat: 3.8,
  error_max: 1.9,
  pruebas: 2,
  pliegues: 2,
  eat_por_pliegue: [],
  eat_parcial: null,
  igual_a: null,
  prestada: modelo === "T",
  eat_en_muestra: 1.9,
  ...extra,
});

const resultado = {
  anios: [anio(2024, { participacion: P24, participacion_real: P24 }), anio(2025, { participacion: P25, participacion_real: P25 }), anio(2026, { clase: "en_curso", en_ajuste: false, meses_cargados: 9, participacion: null, participacion_real: null, participacion_parcial: P25, meses: [100, 100, 100, 100, 100, 100, 100, 100, 100, 0, 0, 0] })],
  candidatas: [candidata("A", A), candidata("F", null, { motivo: "sin_anos_ajuste" }), candidata("T", null, { motivo: "sin_anos_utilizables" })],
  ruido_normal: 3.8,
} as unknown as AgrupacionResultado;

describe("editor: leer celdas y suma en vivo", () => {
  it("una celda acepta punto o coma decimal y %; vacía o con letras es null", () => {
    expect(leerCelda("5")).toBe(5);
    expect(leerCelda(" 4,3 ")).toBe(4.3);
    expect(leerCelda("4.3%")).toBe(4.3);
    expect(leerCelda(".5")).toBe(0.5);
    expect(leerCelda("")).toBeNull();
    expect(leerCelda("abc")).toBeNull();
    expect(leerCelda("-3")).toBeNull();
  });
  it("suma: faltan, sobran, ok y celdas vacías", () => {
    expect(sumaEnVivo(textosDeValores([5, 5, 6, 8, 11, 14, 13, 12, 10, 7, 5, 2])).texto).toBe("Suma 98.0 % · faltan 2.0");
    expect(sumaEnVivo(textosDeValores([5, 5, 6, 8, 11, 14, 13, 12, 10, 7, 5, 7])).texto).toBe("Suma 103.0 % · sobran 3.0");
    const ok = sumaEnVivo(textosDeValores(MI_CURVA));
    expect(ok.texto).toBe("Suma 100.0 % ✓");
    expect(ok.ok).toBe(true);
    const incompleta = sumaEnVivo(["50", ...Array<string>(11).fill("")]);
    expect(incompleta.ok).toBe(false);
    expect(incompleta.texto).toContain("celdas vacías");
  });
  it("válida solo con doce números de 0 a 100 que suman 100 ± 0.05", () => {
    expect(valoresValidos(textosDeValores(MI_CURVA))).toEqual(MI_CURVA);
    expect(valoresValidos(textosDeValores([5, 5, 6, 8, 11, 14, 13, 12, 10, 7, 5, 3.95]))).not.toBeNull();
    expect(valoresValidos(textosDeValores([5, 5, 6, 8, 11, 14, 13, 12, 10, 7, 5, 3.9]))).toBeNull();
    expect(valoresValidos(textosEnBlanco())).toBeNull();
    expect(valoresValidos(["101", ...Array<string>(11).fill("0")])).toBeNull();
  });
  it("normalizar reparte proporcionalmente (celdas vacías = 0); con letras o suma cero no hace nada", () => {
    const n = normalizarTextos(textosDeValores([5, 5, 6, 8, 11, 14, 13, 12, 10, 7, 5, 2]))!;
    expect(n.map(Number)).toEqual([5.102, 5.102, 6.1224, 8.1633, 11.2245, 14.2857, 13.2653, 12.2449, 10.2041, 7.1429, 5.102, 2.0408]);
    expect(valoresValidos(n)).not.toBeNull();
    expect(normalizarTextos(["50", ...Array<string>(11).fill("")])!.slice(0, 2)).toEqual(["100", "0"]);
    expect(normalizarTextos(["x", ...Array<string>(11).fill("1")])).toBeNull();
    expect(normalizarTextos(textosEnBlanco())).toBeNull();
  });
});

describe("editor: borrador y puntos de partida", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("serializa y lee el borrador; uno dañado, vacío o de otra forma da null", () => {
    const b = { textos: textosDeValores(MI_CURVA), partida: { tipo: "candidata" as const, referencia: "A" as const } };
    expect(leerBorradorGuardado(serializarBorrador(b))).toEqual(b);
    expect(leerBorradorGuardado(null)).toBeNull();
    expect(leerBorradorGuardado("no es json")).toBeNull();
    expect(leerBorradorGuardado(JSON.stringify({ textos: ["1"], partida: { tipo: "en_blanco", referencia: null } }))).toBeNull();
    expect(leerBorradorGuardado(JSON.stringify({ textos: textosEnBlanco(), partida: PARTIDA_EN_BLANCO }))).toBeNull();
    expect(leerBorradorGuardado(JSON.stringify({ textos: textosDeValores(MI_CURVA), partida: { tipo: "inventada", referencia: null } }))).toBeNull();
  });
  it("guardar, leer y borrar con sessionStorage; un borrador sin celdas escritas lo borra; sin almacenamiento no lanza", () => {
    const mem = new Map<string, string>();
    vi.stubGlobal("window", { sessionStorage: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) } });
    const b = { textos: textosDeValores(MI_CURVA), partida: { tipo: "pegado" as const, referencia: null } };
    guardarBorrador("agr-1", b);
    expect(mem.has("curva-usuario:agr-1")).toBe(true);
    expect(leerBorrador("agr-1")).toEqual(b);
    expect(leerBorrador("otra")).toBeNull();
    guardarBorrador("agr-1", { textos: textosEnBlanco(), partida: PARTIDA_EN_BLANCO });
    expect(leerBorrador("agr-1")).toBeNull();
    guardarBorrador("agr-2", b);
    borrarBorrador("agr-2");
    expect(mem.size).toBe(0);
    vi.unstubAllGlobals();
    expect(() => guardarBorrador("x", b)).not.toThrow();
    expect(leerBorrador("x")).toBeNull();
  });
  it("«Partir de»: candidatas con curva, años con curva y la vigente; las candidatas sin curva no aparecen", () => {
    const o = opcionesPartida(resultado, { version: 2, curva: PLANA });
    expect(o.map((x) => x.id)).toEqual(["c-A", "a-2024", "a-2025", "v"]);
    expect(o[0].etiqueta).toBe("A · Promedio simple");
    expect(o[1].partida).toEqual({ tipo: "anio", referencia: "2024" });
    expect(o[3].partida).toEqual({ tipo: "vigente", referencia: "v2" });
    expect(opcionesPartida(resultado, null).some((x) => x.id === "v")).toBe(false);
  });
  it("de dónde partió, en texto", () => {
    expect(textoPartida({ tipo: "candidata", referencia: "F" })).toBe("la candidata F · Modelo avanzado");
    expect(textoPartida({ tipo: "anio", referencia: "2025" })).toBe("la curva del año 2025");
    expect(textoPartida({ tipo: "vigente", referencia: "v2" })).toBe("la curva vigente v2");
    expect(textoPartida({ tipo: "pegado", referencia: null })).toBe("valores pegados desde Excel");
    expect(textoPartida(PARTIDA_EN_BLANCO)).toBe("una curva en blanco");
  });
});

describe("medida EN MUESTRA de Mi curva", () => {
  const e = evaluarCurvaUsuario(MI_CURVA, resultado, null, { tipo: "pegado", referencia: null });
  it("el caso 38 de la ficha: 4.6 y 5.8 por año, promedio 5.2", () => {
    expect(e.eat_en_muestra_por_anio.map((x) => x.anio)).toEqual([2024, 2025]);
    expect(e.eat_en_muestra_por_anio[0].eat).toBeCloseTo(4.6, 6);
    expect(e.eat_en_muestra_por_anio[1].eat).toBeCloseTo(5.8, 6);
    expect(e.eat_en_muestra).toBeCloseTo(5.2, 6);
    expect(e.en_muestra).toBe(true);
  });
  it("las líneas dicen EN MUESTRA, el año en curso (en muestra) y el ruido", () => {
    const l = lineasMedidaEnMuestra(e);
    expect(l[0]).toContain("EN MUESTRA");
    expect(l[0]).toContain("2024 4.6 pp (máx.");
    expect(l[0]).toContain("promedio 5.2");
    expect(l[0]).toContain("(en muestra)");
    expect(l[0]).toContain("ruido entre años normales 3.8");
    expect(lineasMedidaEnMuestra({ ...e, ruido_normal: null })[0]).toContain("no medible");
    expect(lineasMedidaEnMuestra({ ...e, igual_a: "A" })[1]).toBe("Tu curva coincide con la candidata A.");
    expect(lineasMedidaEnMuestra({ ...e, eat_en_muestra: null })[0]).toContain("no tiene EAT en muestra");
  });
  it("las candidatas se muestran con fuera de muestra y en muestra, lado a lado", () => {
    expect(textoEatCandidata(candidata("A", A))).toBe("A: 3.8 fuera de muestra · 1.9 en muestra");
    expect(textoEatCandidata(candidata("F", A, { eat: null }))).toBe("F: 1.9 en muestra");
    expect(textoEatCandidata(candidata("E", null, { eat: null, eat_en_muestra: null }))).toBeNull();
  });
});

describe("aprobar Mi curva (U)", () => {
  const params: ParametrosCurvas = parametrosPorDefecto();
  const trabajo = {
    parametros: params,
    datos: { hasta_periodo: "2026-09" },
    huella_calculo: "0123456789abcdef0123456789abcdef",
    vigente: vigente({ version: 2 }),
  } as unknown as Pick<TrabajoAgrupacionApi, "parametros" | "datos" | "huella_calculo" | "vigente">;

  it("la nota es siempre obligatoria con U, y se suma a los demás motivos", () => {
    expect(motivosNotaRequerida(params, "U", "A")).toEqual(["aprobaste tu propia curva (U): siempre lleva motivo"]);
    expect(motivosNotaRequerida(params, "U", null)).toHaveLength(1);
    expect(motivosNotaRequerida({ ...params, anios_excluidos: [2023] }, "U", "A")).toHaveLength(2);
    expect(motivosNotaRequerida(params, "A", "A")).toEqual([]);
  });

  it("el PUT lleva modelo U, los doce valores escritos, de dónde partió y pasa el esquema; sin valores no hay cuerpo", () => {
    const c = cuerpoAprobar(trabajo, "U", " porque la conozco ", { valores: MI_CURVA, partida: { tipo: "pegado", referencia: null } })!;
    expect(c.modelo).toBe("U");
    expect(c.curva_usuario).toEqual(MI_CURVA);
    expect(c.partida).toEqual({ tipo: "pegado", referencia: null });
    expect(c.nota).toBe("porque la conozco");
    expect(c.version_vigente).toBe(2);
    expect(c.parametros.hasta_periodo).toBe("2026-09");
    expect(aprobarCurvaSchema.safeParse(c).success).toBe(true);
    expect(cuerpoAprobar(trabajo, "U", "nota", null)).toBeNull();
  });
  it("con otro modelo el cuerpo NO lleva curva_usuario ni partida (el servidor los prohíbe)", () => {
    const c = cuerpoAprobar(trabajo, "F", "", { valores: MI_CURVA, partida: PARTIDA_EN_BLANCO })!;
    expect(c).not.toHaveProperty("curva_usuario");
    expect(c).not.toHaveProperty("partida");
    expect(aprobarCurvaSchema.safeParse(c).success).toBe(true);
  });
  it("el botón dice por qué no se puede si la curva no es válida", () => {
    const datos = { agrupacion: { activo: true }, prerrequisitos: { bloquea: [] }, datos: { hasta_periodo: "2026-09" } } as unknown as TrabajoAgrupacionApi;
    expect(motivoNoSePuedeAprobar({ datos, recalculando: false, desactualizado: false, tieneCandidata: false, esUsuario: true })).toMatch(/Tu curva no es válida/);
    expect(motivoNoSePuedeAprobar({ datos, recalculando: false, desactualizado: false, tieneCandidata: true, esUsuario: true })).toBeNull();
  });
  it("el confirm repite los doce valores, el EAT en muestra frente al ruido, lo que proponía el sistema y de dónde partió", () => {
    const e = evaluarCurvaUsuario(MI_CURVA, resultado, null, { tipo: "candidata", referencia: "A" });
    const t = textoConfirmarAprobacion({
      agrupacion: "ABRIGO SINTÉTICO",
      temporada: "invierno",
      modelo: "U",
      recomendada: "A",
      anios: resultado.anios,
      eat: null,
      ruidoNormal: 3.8,
      versionVigente: 2,
      comparacion: null,
      comparableConVigente: null,
      aniosAjusteVigente: null,
      aniosExcluidos: [],
      tiendasExcluidas: [],
      tratamiento: "auto",
      hasta: "2026-09",
      avisos: [],
      nota: "la conozco",
      usuario: { valores: MI_CURVA, eatEnMuestra: e.eat_en_muestra, parcialEnMuestra: e.eat_parcial_en_muestra, partida: e.partida, igualA: null },
    });
    expect(t).toContain("¿Aprobar TU curva (U · Mi curva) de ABRIGO SINTÉTICO?");
    expect(t).toContain("Tus doce valores (%): 5.0 · 5.0 · 6.0 · 8.0 · 11.0 · 14.0 · 13.0 · 12.0 · 10.0 · 7.0 · 5.0 · 4.0.");
    expect(t).toContain("EAT EN MUESTRA: 5.2 pp");
    expect(t).toContain("las candidatas se miden fuera de muestra");
    expect(t).toContain("ruido entre años normales: 3.8 pp");
    expect(t).toContain("El sistema proponía A · Promedio simple.");
    expect(t).toContain("Partiste de: la candidata A · Promedio simple.");
    expect(t).toContain("Reemplaza la v2.");
    expect(t).toContain("NO se marcará obsoleta por datos nuevos");
    expect(t).toContain("Nota: la conozco");
    expect(t).not.toContain("Años usados");
  });
});

describe("Mi curva en el gráfico, la tabla y la lista", () => {
  it("series extra: Mi curva y los GML marcados van después de la propuesta, encendidas y solo en participación", () => {
    const extras = [
      { clave: CLAVE_USUARIO, etiqueta: "Mi curva", valores: pct(MI_CURVA), color: COLOR_USUARIO, trazo: "discontinuo" as const, grosor: 3.5 },
      { clave: claveGml("g1"), etiqueta: "HOMBRE · URBANO · CASACA", valores: A, color: "#7c3aed" },
      { clave: "mala", etiqueta: "incompleta", valores: [0.5], color: "#000" },
    ];
    const s = construirSeries([anio(2024), anio(2025)], { modo: "participacion", propuesta: { etiqueta: "P", curva: PLANA }, vigente: { etiqueta: "V", curva: PLANA }, temporada: { curva_T: PLANA }, extras });
    expect(s.map((x) => x.clave)).toEqual(["anio-2024", "anio-2025", "temporada", "vigente", "propuesta", "usuario", "gml-g1"]);
    const u = s.find((x) => x.clave === "usuario")!;
    expect(u).toMatchObject({ porDefecto: true, trazo: "discontinuo", grosor: 3.5, color: "#0f766e" });
    expect(construirSeries([anio(2024)], { modo: "unidades", extras }).map((x) => x.clave)).toEqual(["anio-2024"]);
  });

  it("CSV año × mes: con Mi curva añade su porcentaje y su diferencia con la aprobada; sin ella, igual que antes", () => {
    const sin = filasCsvAnioMes([anio(2024)], PLANA, PLANA);
    const con = filasCsvAnioMes([anio(2024)], PLANA, PLANA, pct(MI_CURVA));
    expect(con.campos.length).toBe(sin.campos.length + 2);
    const i = con.campos.indexOf("MI CURVA (%)");
    expect(i).toBeGreaterThan(0);
    expect(con.campos[i + 1]).toBe("MI CURVA - APROBADA (pp)");
    expect(con.datos[0][i]).toBe(5);
    expect(con.datos[0][i + 1]).toBe(Math.round((0.05 - 1 / 12) * 1000) / 10);
    expect(con.datos.every((f) => f.length === con.campos.length)).toBe(true);
    expect(filasCsvAnioMes([anio(2024)], PLANA, null, pct(MI_CURVA)).datos[0][i + 1]).toBe("");
  });

  const u = agrupacion({ id: "u", estado: "curva_usuario", vigente: vigente({ modelo: "U", recomendada: false, recomendada_entonces: "A", origen_curva: "usuario" }) });
  it("estado curva_usuario: filtro propio, «A (vs U)» en Sistema hoy y resumen aparte", () => {
    expect(cumpleEstado(u, "usuario")).toBe(true);
    expect(cumpleEstado(u, "al_dia")).toBe(false);
    expect(cumpleEstado(u, "obsoletas")).toBe(false);
    expect(sistemaHoy(u)).toEqual({ tipo: "distinta", texto: "A (vs U)" });
    const r = { agrupaciones_activas: 3, por_temporada: { invierno: 3, verano: 0, todo_el_ano: 0 }, sin_revisar_toda_temporada: 0, con_curva_vigente: 3, al_dia: 1, al_dia_distintas: 0, obsoletas: 0, curvas_usuario: 2, sin_curva: 0, bloqueadas: 0, bloqueadas_sin_curva: 0, calculables_sin_curva: 0, vigentes_prestadas: 0, inactivas_con_curva: 0, equivalencias_sin_agrupacion: 0 };
    expect(textoResumen(r)).toContain("2 con curva del usuario");
    expect(textoResumen({ ...r, curvas_usuario: 0 })).not.toContain("curva del usuario");
  });

  it("T recomendada por backtesting no es «prestada por falta de años»", () => {
    const base = { anios: [anio(2024), anio(2025)], origen: "prestada" as const, comparacion: { frase: "T se equivoca 3.0 pp frente a 6.0 de A en 2 pruebas." } } as unknown as Pick<AgrupacionResultado, "recomendada" | "anios" | "comparacion" | "origen">;
    const gana = textoPropone({ ...base, recomendada: "T", motivo_recomendacion: "menor_error" });
    expect(gana).toContain("se equivoca menos que las propias, por más del margen");
    expect(gana).toContain("T se equivoca 3.0 pp");
    expect(textoPropone({ ...base, recomendada: "T", motivo_recomendacion: "prestada" })).toContain("no tiene años suficientes");
    expect(textoPropone({ ...base, recomendada: "F", motivo_recomendacion: "menor_error" })).toContain("Propone F · Modelo avanzado de 2024 y 2025");
  });
});
