import { describe, expect, it } from "vitest";
import { aprobarCrecimientoSchemaEstricto } from "../src/lib/crecimientos/esquemas";
import {
  NINGUNA,
  anioAplicacionDe,
  anioEnCursoDe,
  avisosDeCierre,
  bandasDelNino,
  baseInicial,
  baseSiguienteGM,
  consultaApiGM,
  contarEstadosGM,
  correccionNinoPct,
  cuerpoAprobar,
  dividirRealProyectado,
  equivalenteSobreReal,
  errorDeAprobarGM,
  errorPct,
  estadoEfectivoGM,
  filasCsvLista,
  filasCsvSeries,
  filasDeCierre,
  filasDeLista,
  filasTablaAnioMes,
  filtrarFilasGM,
  formatearDifPp,
  formatearPctPlano,
  formatearPctSigno,
  hayNino,
  hayReferenciaValida,
  insigniasCierre,
  leerPct,
  leerUrlGM,
  lineasDeFoto,
  mesesRealesDelAnioEnCurso,
  motivoNotaObligatoria,
  opcionesDeBase,
  partesFactorInvierno,
  pctATexto,
  pctInicialTexto,
  periodoTocaNino,
  precargaDeBase,
  proximaVersion,
  rangoDeMeses,
  referenciasElegibles,
  referenciasVisibles,
  resumenAprobacion,
  resumenDiagnostico,
  resumenDiagnosticoFactor,
  resumenDiagnosticoGM,
  seriesDelGrafico,
  temporadasNino,
  textoAlertaReaprobar,
  textoAnioSiguienteAtipico,
  textoAprobadoOk,
  textoAvisoNino,
  textoBaseVersion,
  textoCierreProyeccion,
  textoCobertura,
  textoConfirmarGM,
  textoConfirmarReaprobar,
  textoCorreccionNino,
  textoEquivalenteVivo,
  textoEstadoFactor,
  textoEstadoGM,
  textoFactorAgrupacion,
  textoFactorVerano,
  textoFijoLista,
  textoLeyendaCorregido,
  textoLeyendaTiendas,
  textoRedistribucion,
  textoSinReferencia,
  textoSobreBase,
  textoTiendaMayor,
  textoTiendasBase,
  textoTotalSinAprobar,
  textoUltimoMes,
  textoVendioDeMas,
  tituloGM,
  totalSobreReal,
  urlGM,
  variacionPct,
  vistaPrevia2027,
} from "../src/app/(app)/planificacion/curvas-estacionalidad/genero-mundo/vista";
import {
  BANDA_INVIERNO_2026,
  BANDA_VERANO_2026,
  CLAVE_HOMBRE_DEPORTIVO,
  CLAVE_HOMBRE_URBANO,
  CLAVE_MUJER_RI,
  PROYECCION_ID,
  agrupacionesEjemploA,
  cierreEjemploA,
  detalle,
  detalleConVerano,
  detalleParaReaprobar,
  detalleSinAprobar,
  detalleSinNino,
  factorInvierno,
  factorVerano,
  fila,
  filaResto,
  lista,
  referencia,
  referenciaCierreCurva,
  referenciaMetodoAnterior,
  referenciasEjemplo,
  reaprobarEjemploD,
  version,
  versionBruta,
} from "./crecimientos.pantalla.fixture";

const params = (q: string) => new URLSearchParams(q);
const suma = (v: readonly (number | null)[]) => v.reduce<number>((a, b) => a + (b ?? 0), 0);

describe("URL de la pestaña (M10)", () => {
  it("?pestana=genero-mundo abre la lista y ?gm abre el detalle (implica la pestaña)", () => {
    expect(leerUrlGM(params(`pestana=genero-mundo&anio=2027&proyeccion=${PROYECCION_ID}`))).toEqual({ gm: null, pestanaGM: true, anio: 2027, proyeccion: PROYECCION_ID });
    expect(leerUrlGM(params(`gm=${CLAVE_HOMBRE_URBANO}&anio=2027`))).toEqual({ gm: CLAVE_HOMBRE_URBANO, pestanaGM: true, anio: 2027, proyeccion: null });
    expect(leerUrlGM(params("gm=resto")).gm).toBe("resto");
    expect(leerUrlGM(params("")).pestanaGM).toBe(false);
  });

  it("ignora valores inválidos en vez de romper", () => {
    const u = leerUrlGM(params("gm=basura&anio=27&proyeccion=nada&pestana=otra"));
    expect(u).toEqual({ gm: null, pestanaGM: false, anio: null, proyeccion: null });
    expect(leerUrlGM(params("anio=1999")).anio).toBeNull();
    expect(leerUrlGM(params("anio=2027abc")).anio).toBeNull();
  });

  it("urlGM y leerUrlGM son inversas, y la lista lleva ?pestana", () => {
    const l = urlGM("/planificacion/curvas-estacionalidad", { gm: null, anio: 2027, proyeccion: PROYECCION_ID });
    expect(l).toBe(`/planificacion/curvas-estacionalidad?pestana=genero-mundo&anio=2027&proyeccion=${PROYECCION_ID}`);
    expect(leerUrlGM(params(l.split("?")[1]))).toMatchObject({ gm: null, pestanaGM: true, anio: 2027, proyeccion: PROYECCION_ID });
    const detalleUrl = urlGM("/x", { gm: CLAVE_MUJER_RI, anio: 2027, proyeccion: null });
    expect(detalleUrl).toBe(`/x?gm=${CLAVE_MUJER_RI}&anio=2027`);
    expect(urlGM("/x", { gm: null, anio: null, proyeccion: null })).toBe("/x?pestana=genero-mundo");
  });

  it("consultaApiGM arma el query de la API o nada", () => {
    expect(consultaApiGM({ anio: null, proyeccion: null })).toBe("");
    expect(consultaApiGM({ anio: 2027, proyeccion: PROYECCION_ID })).toBe(`?anio=2027&proyeccion=${PROYECCION_ID}`);
  });
});

describe("formatos y textos fijos", () => {
  it("formatea porcentajes con signo y puntos (es-PE: decimal con punto)", () => {
    expect(formatearPctPlano(15)).toBe("15.0 %");
    expect(formatearPctPlano(8, 2)).toBe("8.00 %");
    expect(formatearPctPlano(null)).toBe("—");
    expect(formatearPctSigno(3)).toBe("+3.0 %");
    expect(formatearPctSigno(-2)).toBe("-2.0 %");
    expect(formatearPctSigno(15.3608, 2)).toBe("+15.36 %");
    expect(formatearPctSigno(-5, 0)).toBe("-5 %");
    expect(formatearPctSigno(0.001, 2)).toBe("0.00 %");
    expect(formatearDifPp(-3.4)).toBe("-3.4 pp");
    expect(formatearDifPp(0.04)).toBe("0.0 pp");
  });

  it("el texto fijo de la lista es el de la ficha 06e y el de «sin proyección» habla del método 5", () => {
    const t = textoFijoLista(2027);
    expect(t).toContain("% de 2027 sobre la venta de 2026 corregida del Niño, de las tiendas que tendrá 2027.");
    expect(t).toContain("El factor del Niño es relativo: quita lo que la temporada cayó o subió de más frente a la red, y conserva la tendencia de la red.");
    expect(t).toContain("En un GM sin Niño (corrección menor que 0.5 %), corregida = real.");
    expect(textoSinReferencia(2027)).toContain("método 5");
    expect(textoSinReferencia(2027)).not.toContain("Cierre proyectado");
    expect(textoUltimoMes("2026-09")).toBe("setiembre 2026");
  });

  it("el aviso de 2027 marcado como Niño (D7) es el de la ficha y lista los meses", () => {
    expect(textoAnioSiguienteAtipico(2027)).toBe(
      "2027 está marcado como año del Niño en Curvas → Periodos atípicos. Por ahora el crecimiento de 2027 no incluye el Niño: si no lo habrá, quita la marca; si lo habrá, hay que decidir cómo modelarlo antes de aprobar."
    );
    expect(textoAnioSiguienteAtipico(2027, ["2027-03", "2027-04"])).toContain("Meses marcados: marzo 2027, abril 2027.");
  });

  it("tituloGM y estados", () => {
    expect(tituloGM(fila())).toBe("HOMBRE · URBANO");
    expect(tituloGM(filaResto())).toBe("Resto");
    expect(textoEstadoGM(fila())).toBe("Aprobado v2");
    expect(textoEstadoGM(fila({ vigente: null, estado: "sin_aprobar" }))).toBe("Sin aprobar");
    expect(textoEstadoGM(fila({ estado: "obsoleto", motivo_obsoleto: "metodo_anterior" }))).toBe("Obsoleto: se aprobó sobre 2026 real, antes de 0.14.0, y este género × mundo tuvo Niño: hay que reaprobarlo sobre 2026 corregido");
    expect(textoEstadoGM(fila({ detallable: false }))).toBe("Sigue al Resto");
    expect(textoTotalSinAprobar(3)).toBe("3 GM sin aprobar siguen al Resto");
    expect(textoTotalSinAprobar(1)).toBe("1 GM sin aprobar sigue al Resto");
  });
});

describe("lista: filtros, orden, Resto y Total", () => {
  const l = lista();

  it("los géneros que siguen al Resto van al final y se cuentan aparte", () => {
    const orden = filtrarFilasGM(l.filas, { estado: "todos", genero: "" }).map((f) => f.clave);
    expect(orden[orden.length - 1]).toContain("3333");
    expect(estadoEfectivoGM(l.filas[3])).toBe("sigue_resto");
    expect(contarEstadosGM(l.filas)).toEqual({ todos: 4, sin_aprobar: 1, aprobado: 1, obsoleto: 1, sigue_resto: 1 });
  });

  it("filtra por estado y por género; el Resto y el Total siempre van", () => {
    const soloObsoletos = filasDeLista(l, { estado: "obsoleto", genero: "" });
    expect(soloObsoletos.map((x) => x.tipo)).toEqual(["gm", "resto", "total"]);
    expect(soloObsoletos[0].tipo === "gm" && soloObsoletos[0].fila.clave).toBe(CLAVE_HOMBRE_DEPORTIVO);
    const mujer = filasDeLista(l, { estado: "todos", genero: "MUJER" });
    expect(mujer.filter((x) => x.tipo === "gm")).toHaveLength(1);
    expect(filasDeLista(l, { estado: "todos", genero: "" }).map((x) => x.tipo)).toEqual(["gm", "gm", "gm", "gm", "resto", "total"]);
  });

  it("referencia válida: solo método 5 o posterior (la elegida actual siempre queda)", () => {
    expect(hayReferenciaValida(l)).toBe(true);
    expect(referenciasElegibles(l).map((p) => p.nombre)).toEqual(["Proyección 2026"]);
    const sin = lista({ proyeccion_referencia: null, proyecciones_disponibles: [] });
    expect(hayReferenciaValida(sin)).toBe(false);
    const vieja = lista({ proyeccion_referencia: { id: PROYECCION_ID, nombre: "P", calculado_at: null, version_metodo: 4 } });
    expect(hayReferenciaValida(vieja)).toBe(false);
  });

  it("el Total se lee sobre corregido y sobre real (cada GM con su versión; los que no se aprueban siguen al Resto)", () => {
    const t = totalSobreReal(l);
    // ΣP = 21 021 (MUJER · RI con el 5 % del Resto) + 64 719 + 7 000 (v1 bruta sobre real) + 3 465 + 13 755 = 109 960; ΣB = 97 500; ΣB' = 101 745
    expect(t.real).toBeCloseTo((109960 / 97500 - 1) * 100, 6);
    expect(t.corregido).toBeCloseTo((109960 / 101745 - 1) * 100, 6);
    expect(totalSobreReal({ filas: l.filas, resto: { ...l.resto, vigente: null } })).toEqual({ corregido: null, real: null });
    expect(totalSobreReal({ filas: [{ ...l.filas[0], base_corregida: null }], resto: l.resto })).toEqual({ corregido: null, real: null });
  });

  it("insignias del cierre: avance bajo, sin curva, factor parcial y sin factor", () => {
    expect(insigniasCierre(cierreEjemploA()).map((i) => i.texto)).toEqual(["factor parcial"]);
    const c = cierreEjemploA({ avance_bajo: true, agrupaciones_avance_bajo: ["CASACAS MU"], sin_curva_pct: 4, factor_parcial: false });
    expect(insigniasCierre(c).map((i) => i.texto)).toEqual(["avance bajo", "sin curva 4 %"]);
    expect(insigniasCierre(c)[0].titulo).toContain("CASACAS MU");
    expect(insigniasCierre(cierreEjemploA({ sin_factor: true })).map((i) => i.texto)).toEqual(["sin factor"]);
    expect(insigniasCierre(null)).toEqual([]);
  });

  it("el CSV trae una fila por GM visible y el Resto, con la misma cantidad de columnas y las columnas nuevas", () => {
    const { campos, datos } = filasCsvLista(l, l.filas);
    expect(datos).toHaveLength(l.filas.length + 1);
    for (const d of datos) expect(d).toHaveLength(campos.length);
    expect(campos).toContain("Unidades 2025");
    expect(campos).toContain("Cierre 2026 por curva corregido (u)");
    expect(campos).toContain("Base 2027 corregida");
    const hombre = datos.find((d) => d[0] === "HOMBRE" && d[1] === "URBANO");
    expect(hombre?.[campos.indexOf("Cierre 2026 por curva corregido (u)")]).toBe(58750);
    expect(hombre?.[campos.indexOf("Sobre")]).toBe("corregido");
    expect(datos.at(-1)?.[0]).toBe("RESTO");
  });
});

describe("corrección del Niño, base y equivalentes", () => {
  it("hay Niño sale de la fila o del cierre; una corrección menor que el umbral es «no material» (ejemplo E)", () => {
    expect(hayNino(fila())).toBe(true);
    expect(hayNino({ hay_nino: undefined, cierre: cierreEjemploA({ hay_nino: false }) })).toBe(false);
    expect(textoCorreccionNino(fila())).toBe("corrección del Niño +6.8 %");
    expect(textoCorreccionNino(fila({ hay_nino: false, correccion_nino_pct: 0.1 }))).toBe("corrección del Niño +0.1 % (no material)");
    expect(textoCorreccionNino(fila({ hay_nino: false, correccion_nino_pct: 0 }))).toBeNull();
    expect(correccionNinoPct({ correccion_nino_pct: null, cierre: cierreEjemploA() })).toBe(6.82);
  });

  it("la base 2027 sale de la proyección de referencia y, sin ella, de la base por curva (ejemplo A)", () => {
    expect(baseSiguienteGM(fila())).toEqual({ origen: "proyeccion", real: 56100, corregida: 59925, tiendas: null, fueraCy: [] });
    const sinReferencia = baseSiguienteGM(fila({ base_siguiente: null, base_corregida: null }));
    expect(sinReferencia).toEqual({ origen: "curva", real: 56100, corregida: 59925, tiendas: 10, fueraCy: ["T10"] });
    expect(baseSiguienteGM(fila({ base_siguiente: null, base_corregida: null, cierre: undefined }))).toBeNull();
  });

  it("el % sobre corregido visto sobre real: 8 % de 59 925 sobre 56 100 es +15.36 % (ejemplo B)", () => {
    const base = baseSiguienteGM(fila());
    expect(equivalenteSobreReal(8, base)).toBeCloseTo(15.36, 2);
    expect(resumenAprobacion(fila(), 8).resultado).toBe(64719);
    expect(equivalenteSobreReal(null, base)).toBeNull();
    expect(equivalenteSobreReal(8, null)).toBeNull();
  });

  it("2026 vendió de más por el Niño cuando la base corregida queda por debajo (ejemplo C)", () => {
    expect(textoVendioDeMas(2026, -10)).toContain("vendió de más por el Niño");
    expect(textoVendioDeMas(2026, 6.8)).toBeNull();
    expect(textoVendioDeMas(2026, null)).toBeNull();
  });
});

describe("curva de venta", () => {
  const d = detalle();

  it("2026 se parte en real continuo y cierre por curva discontinuo; «2026 corregido (sin Niño)» va punteado y los doce meses", () => {
    const series = seriesDelGrafico(d, "unidades");
    expect(series.map((s) => s.clave)).toEqual(["anio-2023", "anio-2024", "anio-2025", "anio-2026-real", "anio-2026-proy", "anio-corregido-2026"]);
    const real = series.find((s) => s.clave === "anio-2026-real")!;
    const proy = series.find((s) => s.clave === "anio-2026-proy")!;
    const corregido = series.find((s) => s.clave === "anio-corregido-2026")!;
    expect(real.trazo).toBe("continuo");
    expect(proy.trazo).toBe("discontinuo");
    expect(real.valores.filter((v) => v !== null)).toHaveLength(9);
    expect(proy.valores[8]).toBe(real.valores[8]);
    expect(proy.valores[7]).toBeNull();
    expect(proy.valores.filter((v) => v !== null)).toHaveLength(4);
    expect(real.etiqueta).toBe("2026 real (ene–set)");
    expect(proy.etiqueta).toBe("2026 cierre por curva");
    expect(corregido.etiqueta).toBe("2026 corregido (sin Niño)");
    expect(corregido.trazo).toBe("punteado");
    expect(corregido.color).toBe(real.color);
    expect(corregido.valores.filter((v) => v !== null)).toHaveLength(12);
    expect(series.find((s) => s.clave === "anio-2026-real")!.grupo).toBe(proy.grupo);
    expect(corregido.grupo).not.toBe(real.grupo);
  });

  it("la vista previa de 2027 es la base corregida por curva × (1 + %), de las tiendas de 2027, y se mueve con el %", () => {
    const con8 = seriesDelGrafico(d, "unidades", { pct: 8 }).find((s) => s.clave === "vista-previa")!;
    expect(con8.etiqueta).toBe("2027 vista previa (8.00 %)");
    expect(con8.trazo).toBe("discontinuo");
    expect(con8.opacidad).toBeLessThan(1);
    const base = d.serie_base_curva!.corregida;
    expect(con8.valores[5]).toBeCloseTo(base[5] * 1.08, 6);
    expect(suma(con8.valores)).toBeCloseTo(suma(base) * 1.08, 6);
    expect(suma(con8.valores)).toBeGreaterThan(64700); // ≈ 59 925 × 1,08 = 64 719
    expect(suma(con8.valores)).toBeLessThan(64740);
    const con20 = seriesDelGrafico(d, "unidades", { pct: 20 }).find((s) => s.clave === "vista-previa")!;
    expect(con20.etiqueta).toBe("2027 vista previa (20.00 %)");
    expect(suma(con20.valores)).toBeGreaterThan(suma(con8.valores));
    expect(seriesDelGrafico(d, "unidades", { pct: null }).some((s) => s.clave === "vista-previa")).toBe(false);
    expect(seriesDelGrafico(d, "unidades").some((s) => s.clave === "vista-previa")).toBe(false);
    expect(vistaPrevia2027(d.serie_base_curva, 8)).toHaveLength(12);
    expect(vistaPrevia2027(null, 8)).toBeNull();
    expect(vistaPrevia2027(d.serie_base_curva, null)).toBeNull();
  });

  it("Forma no dibuja las dos líneas nuevas; Sin Niño usa la serie corregida en 2026 y no repite la línea corregida", () => {
    const forma = seriesDelGrafico(d, "forma", { pct: 8 });
    expect(forma.some((s) => s.clave === "vista-previa" || s.clave.startsWith("anio-corregido"))).toBe(false);
    const f2025 = forma.find((s) => s.clave === "anio-2025")!;
    expect(f2025.valores[6]).toBeCloseTo((d.series[2].forma[6] as number) / 100, 6);
    expect(forma.at(-1)?.clave).toBe("forma-tipica");
    const sin = seriesDelGrafico(d, "sin_nino", { pct: 8 });
    expect(sin.some((s) => s.clave.startsWith("anio-corregido"))).toBe(false);
    expect(sin.find((s) => s.clave === "anio-2026-real")!.valores[5]).toBe(d.serie_corregida!.meses[5]);
    expect(sin.find((s) => s.clave === "anio-2025")!.valores[5]).toBe(d.series[2].meses_sin_nino[5]);
    expect(sin.some((s) => s.clave === "vista-previa")).toBe(true);
    expect(seriesDelGrafico(d, "unidades").some((s) => s.clave === "forma-tipica")).toBe(false);
  });

  it("un GM sin Niño material no dibuja la línea corregida (ejemplo E)", () => {
    const sinNino = detalleSinNino();
    const series = seriesDelGrafico(sinNino, "unidades", { pct: 10 });
    expect(series.some((s) => s.clave.startsWith("anio-corregido"))).toBe(false);
    expect(series.some((s) => s.clave === "vista-previa")).toBe(true);
    expect(filasTablaAnioMes(sinNino, "unidades").some((f) => f.tipo === "corregido")).toBe(false);
  });

  it("dividirRealProyectado sin meses proyectados deja todo real", () => {
    const r = dividirRealProyectado([1, 2, 3], ["real", "real", "real"]);
    expect(r.proyectado).toBeNull();
    expect(r.real).toEqual([1, 2, 3]);
    const p = dividirRealProyectado([1, 2, null, 4], ["real", "real", null, "proyectado"]);
    expect(p.real).toEqual([1, 2, null, null]);
    expect(p.proyectado).toEqual([null, 2, null, 4]);
  });

  it("año en curso y meses reales salen de los meses proyectados", () => {
    expect(anioEnCursoDe(d.series)).toBe(2026);
    expect(mesesRealesDelAnioEnCurso(d.series)).toBe(9);
    expect(anioAplicacionDe(d)).toBe(2027);
  });

  it("las bandas del Niño dicen «factor parcial (ene–set)» cuando el factor es parcial (I7)", () => {
    const b = bandasDelNino(d);
    expect(b[0].texto).toBe("Niño 2026 · invierno (ene–dic): factor 0.80 · factor parcial (ene–set)");
    expect(b[1].texto).toBe("Niño 2023 · verano (ene–mar, dic): factor 1.31");
    expect(rangoDeMeses([6, 7, 8, 9])).toBe("jun–set");
    expect(rangoDeMeses([12, 1, 2, 3])).toBe("ene–mar, dic");
    expect(bandasDelNino({ ...d, bandas_nino: [{ ...d.bandas_nino[0], factor: null }] })[0].texto).toContain("sin factor");
  });

  it("la leyenda del corregido nombra cada factor: invierno relativo y verano escrito por Javier", () => {
    const ambos = detalleConVerano();
    expect(textoLeyendaCorregido(ambos.factores_y!, ambos.bandas_nino, 2026)).toBe("invierno ÷ 0.80 (relativo) · verano set–dic ÷ 1.50 (escrito por Javier)");
    expect(textoLeyendaCorregido([factorVerano({ efectivo: null, origen: null })], [BANDA_VERANO_2026], 2026)).toBe("verano set–dic sin factor");
    expect(textoLeyendaCorregido([], [], 2026)).toBeNull();
    expect(textoLeyendaCorregido([factorInvierno()], [BANDA_INVIERNO_2026], 2025)).toBeNull();
  });

  it("la tabla año × mes trae 2026 corregido, la base 2027 por curva (real y corregida) y la vista previa", () => {
    const filas = filasTablaAnioMes(d, "unidades", { pct: 8 });
    expect(filas.map((f) => f.clave)).toEqual(["anio-2023", "anio-2024", "anio-2025", "anio-2026", "corregido-2026", "base-real", "base-corregida", "vista-previa"]);
    const por = (c: string) => filas.find((f) => f.clave === c)!;
    expect(por("corregido-2026").etiqueta).toBe("2026 corregido (sin Niño)");
    expect(por("base-real").etiqueta).toBe("Base 2027 por curva, real — tiendas de 2027 (incluye T10)");
    expect(por("base-corregida").etiqueta).toContain("corregida");
    expect(por("vista-previa").etiqueta).toBe("2027 vista previa (8.00 %)");
    expect(por("anio-2023").variacion).toBeNull();
    expect(por("anio-2024").variacion).toBeCloseTo((por("anio-2024").total! / por("anio-2023").total! - 1) * 100, 6);
    expect(por("anio-2026").incompleto).toBe(true);
    // la fila corregida compara con 2025 corregido (total_sin_nino de 2025), no con el real
    expect(por("corregido-2026").variacion).toBeCloseTo((d.serie_corregida!.total / d.series[2].total_sin_nino - 1) * 100, 6);
    expect(por("corregido-2026").notaVariacion).toBe("Frente a 2025 corregido");
    // las filas de base no se comparan; la vista previa muestra el % que se escribe
    expect(por("base-real").variacion).toBeNull();
    expect(por("base-corregida").variacion).toBeNull();
    expect(por("vista-previa").variacion).toBe(8);
    // meses proyectados: la base marca «p» desde el mes siguiente a k; la vista previa, todos
    expect(por("base-real").origen.slice(0, 9).every((o) => o === "real")).toBe(true);
    expect(por("base-real").origen.slice(9).every((o) => o === "proyectado")).toBe(true);
    expect(por("vista-previa").origen.every((o) => o === "proyectado")).toBe(true);
    expect(por("anio-2026").origen.filter((o) => o === "proyectado")).toHaveLength(3);
    expect(suma(por("vista-previa").valores)).toBeCloseTo(suma(d.serie_base_curva!.corregida) * 1.08, 6);
  });

  it("en Sin Niño la tabla usa 2026 corregido sin fila aparte; en Forma solo van los años", () => {
    const sin = filasTablaAnioMes(d, "sin_nino", { pct: 8 });
    expect(sin.map((f) => f.clave)).toEqual(["anio-2023", "anio-2024", "anio-2025", "anio-2026", "base-corregida", "vista-previa"]);
    expect(sin.find((f) => f.clave === "anio-2026")!.total).toBe(d.serie_corregida!.total);
    const forma = filasTablaAnioMes(d, "forma", { pct: 8 });
    expect(forma.map((f) => f.tipo)).toEqual(["anio", "anio", "anio", "anio"]);
    expect(forma.every((f) => f.total === null && f.variacion === null)).toBe(true);
    expect(variacionPct(10, 0)).toBeNull();
    expect(variacionPct(11, 10)).toBeCloseTo(10, 6);
  });

  it("sin Niño material la base por curva es una sola fila (real = corregida)", () => {
    const filas = filasTablaAnioMes(detalleSinNino(), "unidades", { pct: 10 });
    expect(filas.map((f) => f.clave)).toEqual(["anio-2023", "anio-2024", "anio-2025", "anio-2026", "base-real", "vista-previa"]);
    expect(filas.find((f) => f.clave === "base-real")!.etiqueta).toBe("Base 2027 por curva — tiendas de 2027 (incluye T10)");
  });

  it("el CSV lleva las mismas filas: tres por año, el corregido, la base real y corregida y la vista previa", () => {
    const { campos, datos } = filasCsvSeries(d, { pct: 8 });
    expect(datos).toHaveLength(12 + 4);
    for (const fila of datos) expect(fila).toHaveLength(campos.length);
    expect(datos.filter((f) => f[1] === "Unidades")).toHaveLength(4);
    expect(datos.find((f) => f[0] === 2026 && f[1] === "Unidades")?.at(-1)).toBe(3);
    expect(datos.some((f) => f[0] === 2026 && f[1] === "Unidades corregidas (sin Niño)")).toBe(true);
    expect(datos.some((f) => f[0] === 2027 && String(f[1]).startsWith("Base por curva real"))).toBe(true);
    expect(datos.some((f) => f[0] === 2027 && String(f[1]).startsWith("Base por curva corregida"))).toBe(true);
    const previa = datos.find((f) => f[0] === 2027 && String(f[1]).startsWith("Vista previa"))!;
    expect(previa[1]).toBe("Vista previa con 8.00 % sobre corregido");
    expect(Math.abs((previa.at(-2) as number) - 64719)).toBeLessThan(25);
    expect(filasCsvSeries(d).datos).toHaveLength(12 + 3);
  });

  it("la leyenda de tiendas dice cuántas y desde cuándo; la base de 2027 dice qué tienda suma", () => {
    expect(textoLeyendaTiendas(d, 2026)).toBe("Mismas tiendas de 2026: 9 tiendas (abiertas todo 2025 y ene–set 2026).");
    expect(textoTiendasBase(2027, d.cierre!.base_curva)).toBe("tiendas de 2027 (incluye T10)");
    expect(textoTiendasBase(2027, null)).toBe("tiendas de 2027");
  });
});

describe("cómo se cierra 2026", () => {
  const d = detalle();

  it("el cierre del ejemplo A: cada agrupación con su curva y el total (se comprueba una fila a mano)", () => {
    const filas = filasDeCierre(d);
    expect(filas.map((f) => f.tipo)).toEqual(["agrupacion", "agrupacion", "total"]);
    const abrigos = agrupacionesEjemploA()[0];
    // vendido 12 000 ÷ 0,80 = 15 000 corregido; avance 0,80 → cierre corregido 15 000 ÷ 0,80 = 18 750; real = 18 750 × 0,80 = 15 000
    expect(abrigos.vendido / 0.8).toBe(abrigos.vendido_corregido);
    expect(abrigos.vendido_corregido / 0.8).toBe(abrigos.cierre_corregido);
    expect((abrigos.cierre_corregido ?? 0) * 0.8).toBe(abrigos.cierre);
    const total = filas[2];
    expect(total.tipo === "total" && total.c.cierre).toBe(55000);
    expect(total.tipo === "total" && total.c.cierre_corregido).toBe(58750);
    expect(total.tipo === "total" && total.c.base_curva?.real).toBe(56100);
    expect(total.tipo === "total" && total.c.base_curva?.corregida).toBe(59925);
    expect(agrupacionesEjemploA().reduce((a, x) => a + (x.base_curva_corregida ?? 0), 0)).toBe(59925);
  });

  it("el factor de una agrupación: constante, ninguno o solo algunos meses", () => {
    expect(textoFactorAgrupacion(Array.from({ length: 12 }, () => 0.8))).toBe("÷ 0.80");
    expect(textoFactorAgrupacion(Array.from({ length: 12 }, () => 1))).toBe("—");
    expect(textoFactorAgrupacion([])).toBe("—");
    expect(textoFactorAgrupacion([1, 1, 1, 1, 1, 1, 1, 1, 1.5, 1.5, 1.5, 1.5])).toBe("÷ 1.50 (set–dic)");
  });

  it("avisos: avance bajo, sin curva, meses faltantes y sin factor", () => {
    expect(avisosDeCierre(cierreEjemploA())).toEqual([]);
    const a = avisosDeCierre(cierreEjemploA({ avance_bajo: true, agrupaciones_avance_bajo: ["CASACAS MU"], sin_curva_pct: 4, sin_factor: true }), [
      { ...agrupacionesEjemploA()[0], nombre: "SIN CURVA X", curva: null },
    ]);
    expect(a.some((t) => t.includes("Avance bajo") && t.includes("CASACAS MU") && t.includes("Año completo"))).toBe(true);
    expect(a.some((t) => t.includes("4 % del vendido") && t.includes("SIN CURVA X"))).toBe(true);
    expect(a.some((t) => t.includes("no tiene factor"))).toBe(true);
    expect(avisosDeCierre(cierreEjemploA({ cierre: null, motivo_nulo: "meses_faltantes" }))[0]).toContain("Faltan meses publicados");
    expect(avisosDeCierre(null)).toEqual([]);
  });

  it("la cifra de la proyección de referencia queda como dato", () => {
    expect(textoCierreProyeccion(d.cierre_proyeccion, 2027)).toContain("En la proyección «Plan 2026»: base 2027 56,120 u real · 59,940 u corregida");
    expect(textoCierreProyeccion(null, 2027)).toBeNull();
  });

  it("el factor de invierno muestra sus dos números con los rótulos de la ficha (relativo = volumen ÷ red)", () => {
    const t = partesFactorInvierno(factorInvierno())
      .map((p) => p.t)
      .join("");
    expect(t).toContain("Factor 0.80 = 0.76 ÷ 0.95.");
    expect(t).toContain("0.76: invierno 2026 ÷ 2025 de las mismas tiendas en ene–set (9 de 12 meses del periodo).");
    expect(t).toContain("0.95: la red de todo el año en los mismos meses y tiendas.");
    expect(t).toContain("El invierno corregido es lo que habría vendido si hubiera seguido la tendencia de la red (-5 % frente a 2025), no 2025 repetido.");
    const negritas = partesFactorInvierno(factorInvierno())
      .filter((p) => p.b)
      .map((p) => p.t);
    expect(negritas).toEqual(["0.76", "0.95"]);
  });

  it("si Javier escribió otro valor, se ven los dos; sin factor, el aviso de que no podrá cerrar", () => {
    const t = partesFactorInvierno(factorInvierno({ efectivo: 0.72, ratio_aplicado: 0.72 }))
      .map((p) => p.t)
      .join("");
    expect(t).toContain("Factor 0.72 (tu valor) · calculado hoy 0.80 = 0.76 ÷ 0.95.");
    const sin = partesFactorInvierno(factorInvierno({ efectivo: null, origen: null, ratio_aplicado: null }))
      .map((p) => p.t)
      .join("");
    expect(sin).toContain("Sin factor de invierno 2026");
    expect(sin).toContain("no podrás cerrar");
  });

  it("estados del factor (ejemplo H): al día, por confirmar, desfasado y sin factor", () => {
    expect(textoEstadoFactor(factorInvierno())).toEqual({ texto: "factor parcial · confirmado por Javier", tono: "exito" });
    expect(textoEstadoFactor(factorInvierno({ estado: "sin_confirmar" })).texto).toBe("factor parcial · por confirmar en Factores del Niño");
    expect(textoEstadoFactor(factorInvierno({ estado: "desfasado" })).texto).toBe("factor parcial · desfasado: sincroniza en Factores del Niño");
    expect(textoEstadoFactor(factorInvierno({ estado: "faltante", efectivo: null, parcial: false }))).toEqual({ texto: "sin factor", tono: "alerta" });
    expect(textoEstadoFactor(factorInvierno({ parcial: false, origen: "calculado" })).texto).toBe("al día");
  });

  it("el factor de verano lo escribe Javier: rótulo con oct–dic proyectado ×1.50, y sin factor el aviso de la ficha", () => {
    expect(textoFactorVerano(factorVerano(), [BANDA_VERANO_2026], 9)).toBe("Factor 1.50 escrito por Javier · oct–dic de 2026 se proyecta ×1.50 (supone que el Niño sigue hasta diciembre)");
    expect(textoFactorVerano(factorVerano({ efectivo: null, origen: null, ratio_aplicado: null }), [BANDA_VERANO_2026], 9)).toBe("Sin factor: 2026 de verano no se corrigió y no podrás cerrar.");
    expect(textoFactorVerano(factorVerano(), [BANDA_VERANO_2026], 12)).not.toContain("se proyecta");
  });

  it("cómo crece el verano atípicamente (ejemplo G): 1,90 / 1,20 / 0,95 / 1,58 / 2,00 y dato frágil con un solo mes", () => {
    const r = resumenDiagnosticoFactor(factorVerano(), [BANDA_VERANO_2026])!;
    expect(r.resumen.linea).toBe("Setiembre: ×1.90 frente a 2025; su tendencia ene–ago ×1.20; la red ×0.95 → crece ×1.58 sobre su tendencia y ×2.00 sobre la red.");
    expect(r.resumen.aviso).toBe("1 solo mes del periodo, y es el de inicio de temporada: dato frágil.");
    expect(r.resumen.excesoPropio).toBeCloseTo(1.5833, 3);
    expect(r.resumen.excesoRed).toBeCloseTo(2, 6);
    expect(r.meses).toHaveLength(12);
    expect(r.meses.find((m) => m.m === 9)!.relativo).toBe(2.0);
    // la misma tabla solo con las agrupaciones de verano de este GM (informativa)
    const gm = resumenDiagnosticoGM(detalleConVerano().diagnostico_verano_gm, 2026, [BANDA_VERANO_2026])!;
    expect(gm.resumen.linea).toContain("×1.90 frente a 2025");
    expect(gm.resumen.linea).toContain("×1.58 sobre su tendencia y ×2.00 sobre la red");
    expect(gm.meses.find((m) => m.m === 9)!.relativo).toBeCloseTo(2, 6);
    expect(resumenDiagnosticoGM(null, 2026, [])).toBeNull();
  });

  it("sin datos del periodo, sin línea y con el aviso; con varios meses, sin aviso de fragilidad", () => {
    const vacio = resumenDiagnostico({ meses: [], anioRef: 2025, ratioFuera: null });
    expect(vacio).toEqual({ linea: null, aviso: "Sin datos del periodo todavía.", excesoPropio: null, excesoRed: null });
    const dos = resumenDiagnostico({
      anioRef: 2025,
      ratioFuera: 1.2,
      meses: [
        { m: 9, en_periodo: true, u: 130, u_ref: 70, ratio: 1.857, control: 0.95 },
        { m: 10, en_periodo: true, u: 150, u_ref: 100, ratio: 1.5, control: 0.95 },
      ],
    });
    expect(dos.aviso).toBeNull();
    expect(dos.linea).toContain("Set–oct");
    // el invierno (todo el año es periodo): sin tendencia propia
    const inv = resumenDiagnosticoFactor(factorInvierno(), [BANDA_INVIERNO_2026])!;
    expect(inv.resumen.linea).toContain("no hay meses fuera del periodo para medir su tendencia");
    expect(inv.resumen.linea).toContain("×0.80 sobre la red");
  });
});

describe("cómo crece: marcas y textos", () => {
  it("tienda mayor, cobertura y aviso del Niño con las cifras del cierre corregido", () => {
    const r = referencia();
    expect(textoTiendaMayor(r)).toBe("T07 aporta el 38.5 % de 2025; sin ella, +1.2 %");
    expect(textoCobertura(r, 9)).toBe("ene–set es el 74 % del año 2025");
    expect(textoCobertura(referencia({ tipo: "anio_completo" }), 9)).toBeNull();
    expect(textoTiendaMayor(referencia({ tienda_mayor: null }))).toBeNull();
    expect(textoTiendaMayor(referencia({ tienda_mayor: { codigo: "T01", aporte_pct: 100, pct_sin_ella: null } }))).toContain("sin ella no quedan tiendas");
    expect(temporadasNino(detalle().bandas_nino, 2026)).toEqual(["invierno"]);
    expect(textoAvisoNino(2026, ["invierno"], cierreEjemploA())).toBe(
      "2026 fue Niño en invierno: el % de 2027 se escribe sobre 2026 corregido (58,750 u en las mismas tiendas, +8.8 % frente a 2025)."
    );
    expect(textoAvisoNino(2026, ["invierno"], null)).toBe("2026 fue Niño en invierno: el % de 2027 se escribe sobre 2026 corregido.");
  });

  it("las referencias salen en el orden de la ficha y sin «Cierre proyectado»", () => {
    const refs = referenciasVisibles([...referenciasEjemplo(), referencia({ tipo: "cierre_proyectado", etiqueta: "Cierre proyectado 2026" })]);
    expect(refs.map((r) => `${r.tipo}${r.tipo === "anio_completo" ? r.anio : ""}`)).toEqual(["cierre_curva", "acumulado", "anio_completo2025", "anio_completo2024", "aplicado_hoy"]);
  });
});

describe("aprobar: base, precarga y nota (R-N)", () => {
  const refs = referenciasEjemplo();

  it("cada referencia se ofrece corregida y real; «sin Niño + rebote» y «Cierre proyectado» ya no", () => {
    const o = opcionesDeBase(refs);
    expect(o).toHaveLength(10);
    expect(o.map((x) => x.variante)).not.toContain("sin_nino_mas_rebote");
    expect(o.some((x) => x.tipo === "cierre_proyectado")).toBe(false);
    expect(o[0].etiqueta).toBe("Cierre 2026 por curva · corregido");
    expect(o[1].etiqueta).toBe("Cierre 2026 por curva · real");
    expect(o.find((x) => x.id === "cierre_curva||corregido")?.valor).toBe(8.8);
    expect(o.find((x) => x.id === "cierre_curva||bruto")?.valor).toBe(1.85);
    expect(o.find((x) => x.id === "anio_completo|2025|corregido")?.valor).toBe(5);
    const sinRef = opcionesDeBase([referenciaMetodoAnterior()]);
    expect(sinRef.every((x) => x.valor === null)).toBe(true);
    expect(sinRef[0].motivo).toContain("recalcula la proyección con 0.14.0");
  });

  it("la base inicial es «Cierre por curva · corregido»; con avance bajo, «Año completo 2025 · corregido»", () => {
    expect(baseInicial(refs)).toBe("cierre_curva||corregido");
    expect(baseInicial(refs, true)).toBe("anio_completo|2025|corregido");
    const sinCurva = [referenciaCierreCurva({ equivalente: { corregido: null, bruto: null, sin_nino_mas_rebote: null }, pct_bruto: null, pct_sin_nino: null, motivo_nulo: "meses_faltantes" }), ...refs.filter((r) => r.tipo !== "cierre_curva")];
    expect(baseInicial(sinCurva)).toBe("anio_completo|2025|corregido");
    expect(baseInicial([referenciaMetodoAnterior()])).toBe(NINGUNA);
    expect(pctInicialTexto(detalle())).toBe("8.80");
    expect(pctInicialTexto(detalle({ cierre: cierreEjemploA({ avance_bajo: true }) }))).toBe("5.00");
  });

  it("precarga a dos decimales y lee coma o punto", () => {
    expect(precargaDeBase(7.666)).toBe(7.67);
    expect(precargaDeBase(7.66)).toBe(7.66);
    expect(precargaDeBase(null)).toBeNull();
    expect(pctATexto(8.8)).toBe("8.80");
    expect(pctATexto(null)).toBe("");
    expect(leerPct("15,5")).toBe(15.5);
    expect(leerPct(" 15.5 ")).toBe(15.5);
    expect(leerPct("quince")).toBeNull();
    expect(leerPct("")).toBeNull();
    expect(errorPct("")).toContain("Escribe");
    expect(errorPct("abc")).toContain("número");
    expect(errorPct("-96")).toContain("−95");
    expect(errorPct("501")).toContain("500");
    expect(errorPct("-95")).toBeNull();
    expect(errorPct("500")).toBeNull();
  });

  it("la nota es obligatoria sin base, sin valor, con más de 0,5 puntos de diferencia o con la variante real en un GM con Niño (ejemplo F)", () => {
    expect(motivoNotaObligatoria({ pct: 8, tipoBase: "cierre_curva", valorBase: 8.8 })).toContain("0.8 puntos");
    expect(motivoNotaObligatoria({ pct: 8.8, tipoBase: "cierre_curva", valorBase: 8.8 })).toBeNull();
    expect(motivoNotaObligatoria({ pct: 8.3, tipoBase: "cierre_curva", valorBase: 8.8 })).toBeNull();
    expect(motivoNotaObligatoria({ pct: 8.2, tipoBase: "cierre_curva", valorBase: 8.8 })).not.toBeNull();
    expect(motivoNotaObligatoria({ pct: 10, tipoBase: NINGUNA, valorBase: null })).toContain("base");
    expect(motivoNotaObligatoria({ pct: 10, tipoBase: "aplicado_hoy", valorBase: null })).toContain("no se pudo calcular");
    // Acumulado real (+3,0) escrito con ese mismo valor: la diferencia es 0 y aun así se pide nota por la variante real con Niño
    expect(motivoNotaObligatoria({ pct: 3, tipoBase: "acumulado", valorBase: 3, variante: "bruto", hayNino: true, periodoTocaNino: true })).toContain("variante «real»");
    expect(motivoNotaObligatoria({ pct: 3, tipoBase: "acumulado", valorBase: 3, variante: "bruto", hayNino: false, periodoTocaNino: true })).toBeNull();
    expect(motivoNotaObligatoria({ pct: 3, tipoBase: "acumulado", valorBase: 3, variante: "bruto", hayNino: true, periodoTocaNino: false })).toBeNull();
    expect(periodoTocaNino(2026, detalle().bandas_nino)).toBe(true);
    expect(periodoTocaNino(2025, detalle().bandas_nino)).toBe(false);
  });

  it("la próxima versión es la mayor + 1", () => {
    expect(proximaVersion([])).toBe(1);
    expect(proximaVersion([{ version: 1 }, { version: 3 }, { version: 2 }])).toBe(4);
  });

  it("el cuerpo del POST pasa el esquema final del servidor (sin bases ni variantes retiradas)", () => {
    const o = opcionesDeBase(refs);
    const base = o.find((x) => x.id === "anio_completo|2025|corregido")!;
    const cuerpo = cuerpoAprobar({ anio: 2027, pct: 8.123, nota: "  prudente  ", base, proyeccionId: PROYECCION_ID, huella: "h", versionVigente: 2 });
    expect(cuerpo.pct).toBe(8.12);
    expect(cuerpo.nota).toBe("prudente");
    expect(cuerpo.base).toEqual({ tipo: "anio_completo", anio: 2025, variante: "corregido" });
    expect(aprobarCrecimientoSchemaEstricto.safeParse(cuerpo).success).toBe(true);
    const sinBase = cuerpoAprobar({ anio: 2027, pct: 15, nota: "  ", base: null, proyeccionId: null, huella: "h", versionVigente: null });
    expect(sinBase.nota).toBeNull();
    expect(sinBase.base).toEqual({ tipo: "ninguna", anio: null, variante: "corregido" });
    expect(aprobarCrecimientoSchemaEstricto.safeParse(sinBase).success).toBe(true);
    for (const x of o) {
      expect(aprobarCrecimientoSchemaEstricto.safeParse(cuerpoAprobar({ anio: 2027, pct: 8, nota: "n", base: x, proyeccionId: null, huella: "h", versionVigente: null })).success).toBe(true);
    }
  });

  it("la frase en vivo: «= +15.36 % sobre 2026 real · base 2027 … → 64,719 u» (ejemplo B); estimada por curva sin proyección", () => {
    const d = detalle();
    const r8 = resumenAprobacion(d, 8);
    expect(textoEquivalenteVivo({ anioY: 2026, anio: 2027, pct: 8, resumen: r8, hayNino: true })).toBe("= +15.36 % sobre 2026 real · base 2027 (tiendas de 2027): 56,100 real / 59,925 corregida → 64,719 u");
    const sinRef = resumenAprobacion({ ...d, base_siguiente: null, base_corregida: null }, 8);
    expect(textoEquivalenteVivo({ anioY: 2026, anio: 2027, pct: 8, resumen: sinRef, hayNino: true })).toContain("· estimado por curva");
    expect(textoEquivalenteVivo({ anioY: 2026, anio: 2027, pct: null, resumen: r8, hayNino: true })).toContain("Escribe el %");
    expect(textoEquivalenteVivo({ anioY: 2026, anio: 2027, pct: 8, resumen: { base: null, resultado: null, equivalenteReal: null }, hayNino: true })).toContain("no se puede mostrar el equivalente");
    const sn = detalleSinNino();
    expect(textoEquivalenteVivo({ anioY: 2026, anio: 2027, pct: 10, resumen: resumenAprobacion(sn, 10), hayNino: false })).toContain("sin Niño material");
  });

  it("el confirm repite los dos %, las dos bases, la base elegida, la diferencia y las proyecciones que quedan desactualizadas", () => {
    const d = detalle();
    const base = opcionesDeBase(refs).find((x) => x.id === "cierre_curva||corregido")!;
    const texto = textoConfirmarGM({
      titulo: "HOMBRE · URBANO",
      anio: 2027,
      version: 3,
      pct: 8,
      base,
      vigente: { version: 2, pct: 15, sobre_base: "bruta" },
      desactualizadas: [{ id: "p1", nombre: "Proyección 2026" }],
      resumen: resumenAprobacion(d, 8),
      hayNino: true,
    });
    expect(texto).toContain("v3 de HOMBRE · URBANO para 2027");
    expect(texto).toContain("Crecimiento: 8.00 % sobre 2026 corregido = +15.36 % sobre 2026 real.");
    expect(texto).toContain("Base 2027 (tiendas de 2027): 56,100 u real / 59,925 u corregida → 64,719 u.");
    expect(texto).toContain("Base elegida: Cierre 2026 por curva · corregido (+8.8 %). Diferencia: -0.8 pp.");
    expect(texto).toContain("Reemplaza a la v2 (15.00 % sobre 2026 real, antes de 0.14.0)");
    expect(texto).toContain("1 proyección en trabajo quedará desactualizada");
    const sin = textoConfirmarGM({ titulo: "Resto", anio: 2027, version: 1, pct: 5, base: null, vigente: null, desactualizadas: null });
    expect(sin).toContain("Base: ninguna");
    expect(sin).toContain("quedarán desactualizadas hasta que las recalcules");
    expect(textoConfirmarGM({ titulo: "Resto", anio: 2027, version: 1, pct: 5, base: null, vigente: null, desactualizadas: [] })).toContain("No hay proyecciones en trabajo");
    expect(textoConfirmarGM({ titulo: "Resto", anio: 2027, version: 1, pct: 5, base: null, vigente: null, desactualizadas: [{ id: "a", nombre: "A" }, { id: "b", nombre: "B" }] })).toContain("2 proyecciones en trabajo quedarán desactualizadas");
  });

  it("los 409 y 400 recargan (datos y vigente) o explican; 2027 marcado y base retirada pasan el mensaje del servidor", () => {
    const v = { version: 2 };
    expect(errorDeAprobarGM("datos_cambiados", "Los datos cambiaron.", v)).toMatchObject({ recargar: true });
    expect(errorDeAprobarGM("vigente_cambiada", "Otra persona aprobó.", v)).toMatchObject({ recargar: true });
    expect(errorDeAprobarGM("sin_cambio", "x", v)).toEqual({ mensaje: "Es igual a la v2: no se crea otra versión.", recargar: false });
    expect(errorDeAprobarGM("nota_requerida", "Falta la nota.", v)).toEqual({ mensaje: "Falta la nota.", recargar: false });
    expect(errorDeAprobarGM("anio_siguiente_atipico", "2027 está marcado.", v)).toEqual({ mensaje: "2027 está marcado.", recargar: false });
    expect(errorDeAprobarGM("base_retirada", "Esa base ya no se usa.", v)).toEqual({ mensaje: "Esa base ya no se usa.", recargar: false });
    expect(errorDeAprobarGM(null, "Error 500", null)).toEqual({ mensaje: "Error 500", recargar: false });
  });

  it("el aviso de éxito dice «Recalcula la proyección y sigue en Por línea» y nombra las desactualizadas", () => {
    expect(textoAprobadoOk("HOMBRE · URBANO", { version: 3, pct: 8 }, 2027, [{ nombre: "Proyección 2026" }])).toBe(
      "HOMBRE · URBANO: aprobada la v3 (8.00 % sobre 2026 corregido) para 2027. Quedaron desactualizadas la proyección Proyección 2026. Recalcula la proyección y sigue en Por línea."
    );
    expect(textoAprobadoOk("Resto", { version: 1, pct: 5 }, 2027, [])).toBe("Resto: aprobada la v1 (5.00 % sobre 2026 corregido) para 2027. Recalcula la proyección y sigue en Por línea.");
  });
});

describe("reaprobar (ejemplo D)", () => {
  it("la alerta dice cuánto equivale hoy y hacia dónde se redistribuye; el confirm cuenta filas y decididas", () => {
    const d = detalleParaReaprobar();
    const alerta = textoAlertaReaprobar(d.vigente!, d.reaprobar!, 2026, d.factores_y);
    expect(alerta).toContain("v1 (15.00 % sobre 2026 real) se aprobó antes de 0.14.0.");
    expect(alerta).toContain("Hoy equivale a 7.66 % sobre 2026 corregido.");
    expect(alerta).toContain("Reaprobar conserva el total del GM y redistribuye entre sus líneas: suben las de invierno y bajan las demás.");
    expect(textoAlertaReaprobar(d.vigente!, undefined, 2026)).toContain("recalcula la proyección con 0.14.0");
    expect(textoConfirmarReaprobar({ titulo: "HOMBRE · URBANO", anio: 2027, version: 2, r: d.reaprobar! })).toBe(
      [
        "¿Reaprobar la v2 de HOMBRE · URBANO con 7.66 % sobre 2026 corregido?",
        "2027 de HOMBRE · URBANO: 64,515 → 64,515 u.",
        "Cambian 2 filas (1 sube, 1 baja; 2,995 u se mueven).",
        "0 filas decididas quedarán con “propuesta cambió”. Después recalcula la proyección.",
      ].join("\n")
    );
    const una = textoConfirmarReaprobar({ titulo: "X", anio: 2027, version: 2, r: reaprobarEjemploD({ filas_suben: 1, filas_bajan: 0, decididas_con_propuesta_cambio: 1 }) });
    expect(una).toContain("Cambian 1 fila (1 sube, 0 bajan");
    expect(una).toContain("1 fila decidida quedará con “propuesta cambió”");
  });

  it("la redistribución: factor menor que 1 sube, mayor que 1 baja", () => {
    expect(textoRedistribucion([factorInvierno()], 2026)).toBe("entre sus líneas: suben las de invierno y bajan las demás");
    expect(textoRedistribucion([factorVerano()], 2026)).toBe("entre sus líneas: bajan las de verano y suben las demás");
    expect(textoRedistribucion([factorInvierno(), factorVerano()], 2026)).toBe("entre sus líneas");
    expect(textoRedistribucion([], 2026)).toBe("entre sus líneas");
  });

  it("una versión bruta se reconoce aunque no traiga sobre_base", () => {
    expect(textoSobreBase(version(), 2026)).toBe("sobre 2026 corregido");
    expect(textoSobreBase(versionBruta(), 2026)).toBe("sobre 2026 real (antes de 0.14.0)");
    expect(textoSobreBase({ sobre_base: undefined }, 2026)).toBe("sobre 2026 real (antes de 0.14.0)");
  });
});

describe("versiones y foto", () => {
  it("el texto de la base de una versión: las heredadas conservan su nombre", () => {
    expect(textoBaseVersion(version().base)).toBe("Cierre por curva · corregido · +8.8 %");
    expect(textoBaseVersion(versionBruta().base)).toBe("Acumulado · sin Niño + rebote · +18.4 %");
    expect(textoBaseVersion({ tipo: "acumulado", anio: null, variante: "bruto", valor: 3 })).toBe("Acumulado · real · +3.0 %");
    expect(textoBaseVersion({ tipo: "ninguna", anio: null, variante: "corregido", valor: null })).toBe("sin base");
  });

  it("aplana la referencia en pares legibles y muestra el cierre por agrupación y los factores con su origen", () => {
    const l = lineasDeFoto({ bruto: 3, extremo: false, tienda_mayor: { codigo: "T07", aporte_pct: 38.5 }, gml_ids: ["a", "b"], nada: null });
    expect(l).toContainEqual({ clave: "bruto", valor: "3" });
    expect(l).toContainEqual({ clave: "extremo", valor: "no" });
    expect(l).toContainEqual({ clave: "tienda_mayor · codigo", valor: "T07" });
    expect(l).toContainEqual({ clave: "gml_ids", valor: "a, b" });
    expect(l).toContainEqual({ clave: "nada", valor: "—" });
    expect(lineasDeFoto(undefined)).toEqual([]);

    const foto = lineasDeFoto({
      metodo: 5,
      sobre_base: "corregida",
      k: 9,
      tiendas_cy: ["T01", "T02"],
      tiendas_m: ["T01", "T02", "T10"],
      cierre: { cierre: 55000, cierre_corregido: 58750, pct: 1.85, pct_corregido: 8.8 },
      cierre_por_agrupacion: [{ nombre: "ABRIGOS HO", curva_id: "c1", curva_version: 3, avance: 0.8, cierre: 15000, cierre_corregido: 18750, base_curva: 15300, base_curva_corregida: 19125 }],
      factores: [{ anio: 2026, temporada: "invierno", efectivo: 0.8, origen: "aplicado", formula: "relativo_periodo", parcial: true }],
      serie_corregida: [{ gigante: true }],
      base_siguiente: 56100,
      base_corregida: 59925,
    });
    const por = (k: string) => foto.find((x) => x.clave === k)?.valor;
    expect(por("Método de la proyección")).toBe("5");
    expect(por("El % es sobre")).toBe("corregida");
    expect(por("Base corregida (Σ B')")).toBe("59,925");
    expect(por("Cierre · ABRIGOS HO")).toContain("curva v3");
    expect(por("Cierre · ABRIGOS HO")).toContain("avance 80 %");
    expect(por("Cierre · ABRIGOS HO")).toContain("cierre 15,000 → corregido 18,750 u");
    expect(por("Factor · invierno 2026")).toBe("0.80 (escrito por Javier) · fórmula relativo_periodo · parcial");
    expect(por("Tiendas del %")).toBe("2");
    expect(por("Tiendas de la base")).toBe("3");
    expect(por("Cierre del año en curso (mismas tiendas)")).toContain("corregido 58,750 u");
    expect(foto.some((x) => x.clave.includes("serie_corregida"))).toBe(false);
  });

  it("detalle sin aprobar no tiene vigente y la próxima versión es la 1", () => {
    const d = detalleSinAprobar();
    expect(d.vigente).toBeNull();
    expect(proximaVersion(d.versiones)).toBe(1);
    expect(version().estado).toBe("vigente");
    expect(CLAVE_MUJER_RI).toContain(".");
  });
});
