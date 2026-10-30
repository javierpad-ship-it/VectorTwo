import { describe, expect, it } from "vitest";
import {
  accionParaCodigo,
  aplicarCambiosUrl,
  aniosHistoricos,
  avisosDeFila,
  BLOQUES_MENSUAL,
  cabeceraCsvLinea,
  celdasDeAnio,
  construirBarras,
  esBloqueMensual,
  esPestana,
  esPlegable,
  etiquetaBloqueTienda,
  etiquetaReferenciaAlternativa,
  filasConCurvaNueva,
  filasCsvLinea,
  filaFijada,
  filtrarIndice,
  filtroAQuery,
  formatearAvance,
  formatearPct,
  geometriaBarras,
  hayCierres,
  hayCurvaNueva,
  hayFiltro,
  indiceMes,
  leerEntero,
  leerFactor,
  leerFiltro,
  leerPorcentaje,
  leerRampa,
  lineaElegida,
  lineasDeCierre,
  listaSinDecidir,
  listaTiendasSinDecidir,
  MAX_SIN_DECIDIR,
  nombreFilaSinDecidir,
  textoTendencia,
  textoParaRevision,
  textoMotivoDesactualizada,
  resumenColaLarga,
  datosColaLarga,
  esParaRevision,
  leerUmbralDisponibilidad,
  ETIQUETA_VEREDICTO,
  ETIQUETA_SOLO,
  mesAaaaMm,
  mesAnioTexto,
  mesesElegibles,
  minimoDecision,
  motivoCifraInvalida,
  nodoVisible,
  nombreArchivoProyeccion,
  nombrePorDefecto,
  opcionesLineas,
  ordenarTiendas,
  PESTANAS,
  puedeEditar,
  registroDe,
  resumenBloquesAnio,
  resumenCabecera,
  resumenTiendasLinea,
  seriesMensualesDeFila,
  tablaAnioMes,
  TEXTO_AVISO,
  textoComposicion,
  textoFactoresMes,
  textoOrigenMeses,
  textoPieMatriz,
  textoPruebaAnterior,
  textoPerfilApertura,
  textoRampa,
  tiendasSinDecidirQueAlimentan,
  totalesDeLinea,
  vecinas,
  FILTRO_VISTA_VACIO,
} from "../src/app/(app)/planificacion/proyeccion/vista";
import {
  anioEnCursoDeFactores,
  factor2,
  factor3,
  filasDiagnostico,
  formatearDiaMes,
  insigniasFactor,
  leerAplicado,
  listaDeMeses,
  pideConfirmar,
  textoCalculado,
  textoDesfase,
  textoDiferencia,
  textoEfectivo,
  textoIntroFactores,
  textoMesesPeriodo,
  textoResumenDiagnostico,
  type DiagnosticoVista,
  type FactorVista,
} from "../src/app/(app)/planificacion/proyeccion/factores-vista";
import { CODIGOS_AVISO_NINO, enlaceDeAvisoNino, enlaceDeMotivoNino } from "../src/app/(app)/planificacion/proyeccion/vista";
import type { AvisoFila } from "../src/lib/proyeccion/tipos-api";
import { bloques, colaLarga, detalleFila, diagnosticoInvierno, diagnosticoVerano, factorInviernoConfirmado, factores, filaRevision, filaMensual, filasDenim, INDICE, nodo, proyeccion, respuestaLineas, respuestaMensual, tiendaProyeccion, Y } from "./proyeccion.pantalla.fixture";

/** Lógica de vista de la pantalla de M7 con datos sintéticos (T01…T12): nada real de Lukers. */

const params = (q: string) => new URLSearchParams(q);

describe("estado en la URL", () => {
  it("las pestañas van en el orden de trabajo: factores, tiendas, crecimientos, por línea, matriz, mensual", () => {
    expect(PESTANAS.map((p) => p.id)).toEqual(["factores", "tiendas", "crecimientos", "linea", "matriz", "mensual"]);
    expect(esPestana("matriz")).toBe(true);
    expect(esPestana("otra")).toBe(false);
    expect(esPestana(null)).toBe(false);
  });

  it("lee los siete filtros de la URL y descarta lo que no corresponde", () => {
    const f = leerFiltro(params("genero=g-h&mundo=m-u&linea=l-denim&temporada=invierno&agrupacion_estacionalidad=ag1&agrupacion_marca=am1&solo=sin_proyectar"));
    expect(f).toEqual({ genero: "g-h", mundo: "m-u", linea: "l-denim", temporada: "invierno", agrupacion_estacionalidad: "ag1", agrupacion_marca: "am1", solo: "sin_proyectar" });
    const malo = leerFiltro(params("genero=%3Cscript%3E&temporada=primavera&solo=todo"));
    expect(malo).toEqual(FILTRO_VISTA_VACIO);
    expect(hayFiltro(f)).toBe(true);
    expect(hayFiltro(malo)).toBe(false);
  });

  it("manda a la API los nombres con _id y omite lo vacío", () => {
    const q = filtroAQuery({ ...FILTRO_VISTA_VACIO, genero: "g-h", agrupacion_marca: "am1", solo: "curva_cambio" });
    expect(q.toString()).toBe("genero_id=g-h&agrupacion_marca_id=am1&solo=curva_cambio");
    expect(filtroAQuery({ ...FILTRO_VISTA_VACIO, genero: "g", mundo: "m", linea: "l", solo: "cola_larga" }, ["genero", "mundo", "linea"]).toString()).toBe("genero_id=g&mundo_id=m&linea_id=l");
  });

  it("aplica cambios a la query conservando el resto; null o vacío quita el parámetro", () => {
    expect(aplicarCambiosUrl("?proyeccion=p1&pestana=linea", { fila: "f1" })).toBe("proyeccion=p1&pestana=linea&fila=f1");
    expect(aplicarCambiosUrl("proyeccion=p1&fila=f1", { fila: null, pestana: "matriz" })).toBe("proyeccion=p1&pestana=matriz");
    expect(aplicarCambiosUrl("genero=g", { genero: "" })).toBe("");
  });

  it("cada código 409 de M7 ofrece la acción que corresponde", () => {
    expect(accionParaCodigo("datos_cambiaron")).toBe("recalcular");
    expect(accionParaCodigo("calculo_en_curso")).toBe("recargar");
    expect(accionParaCodigo("cerrada")).toBe("recargar");
    expect(accionParaCodigo("menor_que_vendido")).toBeNull();
    expect(accionParaCodigo(null)).toBeNull();
  });
});

describe("formatos (punto decimal y miles con coma)", () => {
  it("porcentajes con signo y avance", () => {
    expect(formatearPct(-1.9)).toBe("-1.9 %");
    expect(formatearPct(4.94)).toBe("+4.9 %");
    expect(formatearPct(0)).toBe("0.0 %");
    expect(formatearPct(null)).toBe("—");
    expect(formatearAvance(0.713)).toBe("71.3 %");
    expect(formatearAvance(null)).toBe("—");
  });

  it("ningún texto de la vista usa coma decimal", () => {
    const textos = [
      textoPruebaAnterior({ anio: 2025, propuesto: 16210, real: 16480, desvio_pct: -1.6, eat_m6: 9.8 }, "2026-09-01"),
      textoFactoresMes([1, 1, 1, 1, 1, 1, 1, 1, 1.24, 1.24, 1.24, 1.24]) ?? "",
      resumenCabecera(proyeccion()).join(" · "),
      textoPieMatriz({ lineas: 3, lineas_total: 41, porcentaje_total: 6.4 }, 2026),
      textoRampa([0.7, 0.85, 1]),
    ];
    for (const t of textos) expect(t).not.toMatch(/\d,\d{1,2}(?!\d)/);
  });

  it("meses: aaaa-mm, índice y nombre", () => {
    expect(mesAaaaMm("2026-09-01")).toBe("2026-09");
    expect(indiceMes("2026-09-01")).toBe(9);
    expect(mesAnioTexto("2026-09-01")).toBe("set-2026");
    expect(mesesElegibles("2026-09-01")).toHaveLength(9);
    expect(mesesElegibles("2026-09-01")[0]).toBe("2026-01");
    expect(nombrePorDefecto(2026)).toBe("Proyección 2026–2027");
    expect(nombreArchivoProyeccion(2026, "matriz")).toBe("proyeccion-2026-2027-matriz.xlsx");
    expect(nombreArchivoProyeccion(2026, "mensual")).toBe("proyeccion-2026-2027-mensual.xlsx");
  });
});

describe("lo que escribe el planner", () => {
  it("entero no negativo: miles bien puestos, sin decimales", () => {
    expect(leerEntero("17504")).toEqual({ ok: true, valor: 17504 });
    expect(leerEntero(" 17,504 ")).toEqual({ ok: true, valor: 17504 });
    expect(leerEntero("17 504")).toEqual({ ok: true, valor: 17504 });
    expect(leerEntero("0")).toEqual({ ok: true, valor: 0 });
    expect(leerEntero("17.5").ok).toBe(false);
    expect(leerEntero("17,5").ok).toBe(false);
    expect(leerEntero("-3").ok).toBe(false);
    expect(leerEntero("").ok).toBe(false);
    expect(leerEntero("abc").ok).toBe(false);
  });

  it("en el año en curso el mínimo es lo vendido; en el siguiente, cero", () => {
    expect(minimoDecision(2026, 2026, 12480)).toBe(12480);
    expect(minimoDecision(2027, 2026, 0)).toBe(0);
    expect(motivoCifraInvalida("12000", 12480)).toMatch(/mínimo es lo ya vendido \(12,480\)/);
    expect(motivoCifraInvalida("12480", 12480)).toBeNull();
    expect(motivoCifraInvalida("x", 0)).toMatch(/entero/);
  });

  it("crecimiento entre -95 y 500 con coma o punto", () => {
    expect(leerPorcentaje("5")).toEqual({ ok: true, valor: 5 });
    expect(leerPorcentaje("5,5")).toEqual({ ok: true, valor: 5.5 });
    expect(leerPorcentaje("-95")).toEqual({ ok: true, valor: -95 });
    expect(leerPorcentaje("-96").ok).toBe(false);
    expect(leerPorcentaje("501").ok).toBe(false);
    expect(leerPorcentaje("").ok).toBe(false);
    expect(leerPorcentaje("cinco").ok).toBe(false);
  });

  it("rampa de uno a seis valores en (0, 5]; las casillas vacías se ignoran", () => {
    expect(leerRampa(["1", "1", "1", "", "", ""])).toEqual({ ok: true, valor: [1, 1, 1] });
    expect(leerRampa(["3", "1,5", "", "", "", ""])).toEqual({ ok: true, valor: [3, 1.5] });
    expect(leerRampa(["0", "", "", "", "", ""]).ok).toBe(false);
    expect(leerRampa(["5.1", "", "", "", "", ""]).ok).toBe(false);
    expect(leerRampa(["", "", "", "", "", ""]).ok).toBe(false);
    expect(leerRampa(["x"]).ok).toBe(false);
    expect(textoRampa([1, 1, 1])).toBe("1 · 1 · 1");
    expect(textoRampa([0.7, 0.85, 1])).toBe("0.7 · 0.85 · 1");
  });

  it("factor del Niño: mayor que 0.05 y hasta 3; vacío = el calculado", () => {
    expect(leerFactor("0,66")).toEqual({ ok: true, valor: 0.66 });
    expect(leerFactor("")).toEqual({ ok: true, valor: null });
    expect(leerFactor("0.05").ok).toBe(false);
    expect(leerFactor("3").ok).toBe(true);
    expect(leerFactor("3.1").ok).toBe(false);
    expect(leerFactor("x").ok).toBe(false);
  });
});

describe("cabecera de la proyección", () => {
  it("resume datos hasta, bloques por año, decididas y el desvío del año anterior (dentro de muestra)", () => {
    const piezas = resumenCabecera(proyeccion());
    expect(piezas[0]).toBe("Proyección 2026–2027");
    expect(piezas).toContain("datos hasta 2026-09");
    expect(piezas).toContain("2026: 9 mismas tiendas, 1 nueva del año anterior (T10)");
    expect(piezas).toContain("2027: 10 mismas tiendas, 1 apertura (T12)");
    expect(piezas.join(" · ")).toContain("418 decididas en 2026, 402 en 2027");
    expect(piezas[piezas.length - 1]).toBe("en 2025 el método se desvió -1.9 % (dentro de muestra)");
  });

  it("sin resumen (todavía no calculada) solo trae lo esencial", () => {
    const piezas = resumenCabecera(proyeccion({ resumen: null }));
    expect(piezas).toHaveLength(4);
  });

  it("los bloques separan nuevas del año anterior y aperturas", () => {
    const b = resumenBloquesAnio(bloques()[2026]);
    expect(b.anterior.map((x) => x.codigo)).toEqual(["T10"]);
    expect(b.aperturas).toEqual([]);
    expect(b.texto.aperturas).toBeNull();
    expect(resumenBloquesAnio(bloques()[2027]).texto.aperturas).toBe("1 apertura (T12)");
    expect(resumenBloquesAnio(undefined).texto.mismas).toBe("0 mismas tiendas");
  });

  it("solo se edita una proyección en trabajo y que no esté calculando", () => {
    expect(puedeEditar(proyeccion())).toBe(true);
    expect(puedeEditar(proyeccion({ estado: "cerrada" }))).toBe(false);
    expect(puedeEditar(proyeccion({ estado: "archivada" }))).toBe(false);
    expect(puedeEditar(proyeccion({ calculando: true }))).toBe(false);
    expect(puedeEditar(proyeccion(), true)).toBe(false);
    expect(puedeEditar(null)).toBe(false);
  });

  it("el diálogo de cierre resume decididas, sin decidir, cola larga y desactualizada", () => {
    const l = lineasDeCierre(proyeccion({ desactualizada: [{ codigo: "cargas_nuevas", mensaje: "Se publicó 2026-10." }] }));
    expect(l[0]).toBe("2026: 418 filas decididas y 1,271 sin decidir");
    expect(l[1]).toBe("2027: 402 filas decididas y 1,287 sin decidir");
    expect(l.join("|")).toContain("509 registros de cola larga se cerrarán con la propuesta");
    expect(l.join("|")).toContain("1 registro con la curva nueva sin aplicar");
    expect(l[l.length - 1]).toBe("Desactualizada: Se publicó 2026-10.");
  });
});

describe("avisos", () => {
  it("todo aviso del contrato tiene su texto", () => {
    const todos: AvisoFila[] = [
      "sin_curva", "curva_incompleta", "curva_cambio", "propuesta_cambio", "avance_bajo", "plan_anterior", "sin_venta_anio", "sin_base", "sin_factor", "objetivo_atipico", "temporadas_mezcladas", "mes_negativo", "quiebre",
      "cola_larga", "nivel_cambiado", "bloque_cambiado", "sin_venta_esperada", "sin_referente", "referente_sin_historia", "fijadas_exceden", "cierre_no_proyectado", "apertura_dudosa", "cierre_dudoso",
      "revision_cola_larga", "cola_larga_con_quiebres", "sin_stock_historico", "apertura_tardia", "cifra_excesiva",
      "apertura_y_cierre", "venta_esperada_fuera_de_rango",
    ];
    for (const a of todos) {
      expect(TEXTO_AVISO[a].texto.length).toBeGreaterThan(10);
      expect(["alerta", "info"]).toContain(TEXTO_AVISO[a].tono);
    }
    expect(Object.keys(TEXTO_AVISO)).toHaveLength(todos.length);
    expect(Object.keys(TEXTO_AVISO)).not.toContain("canibalizacion");
  });

  it("los avisos de la fila salen sin repetir y con los de alerta primero", () => {
    const f = { avisos: ["cola_larga", "curva_cambio"] as AvisoFila[], anios: [{ ...filasDenim()[0].anios[0], avisos: ["curva_cambio", "plan_anterior"] as AvisoFila[] }] };
    expect(avisosDeFila(f)).toEqual(["curva_cambio", "cola_larga", "plan_anterior"]);
  });
});

describe("gráfico de barras por año", () => {
  const barras = () => construirBarras({ anioEnCurso: Y, lineas: respuestaLineas(), bloques: bloques() });

  it("una barra por año con la red de mismas tiendas de cada año (8 · 8 · 9 · 9 · 10)", () => {
    const b = barras();
    expect(b.map((x) => x.anio)).toEqual([2023, 2024, 2025, 2026, 2027]);
    expect(b.map((x) => x.tiendas)).toEqual([8, 8, 9, 9, 10]);
    expect(b.map((x) => x.tipo)).toEqual(["historico", "historico", "historico", "en_curso", "siguiente"]);
  });

  it("el año en curso es vendido + resto y el siguiente es la proyección vigente", () => {
    const [, , , y, s] = barras();
    expect(y.real).toBe(31980);
    expect(y.resto).toBe(45204 - 31980);
    // Las tiendas nuevas (T10 en 2026, la apertura T12 en 2027) van aparte: no están en M(año).
    expect(y.nuevas).toBe(4797);
    expect(y.total).toBe(45204 + 4797);
    expect(s.siguiente).toBe(52724);
    expect(s.nuevas).toBe(484);
    expect(s.total).toBe(52724 + 484);
  });

  it("2023 es año del Niño y la geometría lo marca con una banda", () => {
    const g = geometriaBarras(barras());
    expect(g.bandasNino.map((b) => b.anio)).toEqual([2023]);
    expect(g.barras).toHaveLength(5);
  });

  it("la altura de cada segmento es proporcional a sus unidades y la suma llega a la altura de la barra", () => {
    const g = geometriaBarras(barras());
    const y = g.barras.find((b) => b.anio === 2026);
    expect(y).toBeDefined();
    const altos = y!.segmentos.map((s) => s.alto);
    expect(y!.segmentos.map((s) => s.tipo)).toEqual(["real", "resto", "nuevas"]);
    const real = y!.segmentos[0];
    const resto = y!.segmentos[1];
    expect(real.alto / resto.alto).toBeCloseTo(31980 / (45204 - 31980), 5);
    const base = g.area.y + g.area.alto;
    expect(base - (real.y)).toBeCloseTo(real.alto, 5);
    expect(altos.reduce((a, b) => a + b, 0)).toBeCloseTo(base - y!.yTotal, 5);
    expect(y!.etiquetaTotal).toBe("31,980 + 13,224 + 4,797");
    const sig = g.barras.find((b) => b.anio === 2027)!;
    expect(sig.segmentos.map((s) => s.tipo)).toEqual(["siguiente", "nuevas"]);
    expect(sig.etiquetaTotal).toBe("52,724 + 484");
    // El eje llega al máximo con marcas redondas y el cero abajo.
    expect(g.ticksY[0].valor).toBe(0);
    expect(g.ticksY[g.ticksY.length - 1].valor).toBeGreaterThanOrEqual(52724 + 484);
  });

  it("sin filas (índice sin línea) sale una barra por año con lo que haya, sin lanzar", () => {
    const b = construirBarras({ anioEnCurso: Y, lineas: { filas: [], historico_linea: [], totales_por_anio: [] }, bloques: bloques() });
    expect(b.map((x) => x.anio)).toEqual([2026, 2027]);
    expect(b[0].tiendas).toBe(9);
    expect(geometriaBarras(b).barras).toHaveLength(2);
    expect(geometriaBarras([]).barras).toEqual([]);
  });
});

describe("Parte 1: línea, filas y totales", () => {
  it("los totales de la línea salen del servidor y el vendido, de las filas", () => {
    const t26 = totalesDeLinea(respuestaLineas(), 2026);
    expect(t26).toEqual({ vendido: 12480 + 9040 + 6310 + 3100 + 1050, propuesto: 44854, vigente: 45204, decididas: 2, filas: 5 });
    expect(totalesDeLinea(respuestaLineas(), 2027).vigente).toBe(52724);
  });

  it("la propuesta de 2026 de las cinco filas suma la de la línea y el vigente cambia con VALOR decidido en 9,200", () => {
    const filas = filasDenim();
    const suma = filas.reduce((s, f) => s + (registroDe(f, 2026)?.propuesto ?? 0), 0);
    const vigente = filas.reduce((s, f) => s + (registroDe(f, 2026)?.vigente ?? 0), 0);
    expect(suma).toBe(44854);
    expect(vigente).toBe(45204);
    expect(filas.reduce((s, f) => s + (registroDe(f, 2027)?.propuesto ?? 0), 0)).toBe(52724);
  });

  it("avisa de la tienda nueva sin decidir que alimenta la base del año siguiente", () => {
    expect(tiendasSinDecidirQueAlimentan(respuestaLineas(), 2026)).toEqual(["T10"]);
    const decidida = respuestaLineas({ tiendas_linea: [{ ...respuestaLineas().tiendas_linea[0], decidida: true }] });
    expect(tiendasSinDecidirQueAlimentan(decidida, 2026)).toEqual([]);
  });

  it("resume las tiendas de la línea por año", () => {
    const l26 = resumenTiendasLinea(respuestaLineas(), 2026);
    expect(l26[0]).toBe("Nuevas del año anterior 2026 (T10): vendido 3,420 · vigente 4,797");
    expect(l26[1]).toBe("Aperturas 2026: —");
    expect(l26[2]).toBe("Cierres 2026: —");
    expect(resumenTiendasLinea(respuestaLineas(), 2027)[1]).toBe("Aperturas 2027 (T12): vigente 484");
  });

  it("el índice se recorta por género, mundo y texto, y las opciones se encadenan", () => {
    expect(filtrarIndice(INDICE, FILTRO_VISTA_VACIO, "denim").map((i) => `${i.genero}-${i.linea}`)).toEqual(["HOMBRE-DENIM", "MUJER-DENIM"]);
    expect(filtrarIndice(INDICE, { genero: "g-h", mundo: "m-f" }, "").map((i) => i.linea)).toEqual(["CAMISA"]);
    const o = opcionesLineas(INDICE, { genero: "g-h", mundo: "" });
    expect(o.generos.map((g) => g.nombre)).toEqual(["HOMBRE", "MUJER"]);
    expect(o.mundos.map((m) => m.nombre)).toEqual(["FORMAL", "URBANO"]);
    expect(o.lineas.map((l) => l.nombre)).toEqual(["CAMISA", "CASACA", "DENIM", "POLO"]);
    expect(opcionesLineas(INDICE, { genero: "g-m", mundo: "m-u" }).lineas.map((l) => l.completo)).toEqual(["MUJER · URBANO · DENIM"]);
  });

  it("la línea elegida exige los tres ids y las vecinas siguen el orden del índice visible", () => {
    const f = { ...FILTRO_VISTA_VACIO, genero: "g-h", mundo: "m-u", linea: "l-polo" };
    const elegida = lineaElegida(INDICE, f);
    expect(elegida?.linea).toBe("POLO");
    expect(lineaElegida(INDICE, { ...f, linea: "" })).toBeNull();
    expect(lineaElegida(INDICE, { ...f, linea: "l-nada" })).toBeNull();
    const { anterior, siguiente } = vecinas(INDICE, elegida);
    expect(anterior?.linea).toBe("DENIM");
    expect(siguiente?.linea).toBe("CASACA");
    expect(vecinas(INDICE, INDICE[0]).anterior).toBeNull();
    expect(vecinas(INDICE, null)).toEqual({ anterior: null, siguiente: null });
  });

  it("detecta las filas con una curva nueva por aplicar", () => {
    const filas = filasDenim();
    expect(filasConCurvaNueva(filas)).toBe(0);
    filas[0].anios[0].meses_propuestos = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    expect(hayCurvaNueva(filas[0])).toBe(true);
    expect(filasConCurvaNueva(filas)).toBe(1);
  });

  it("el CSV de la línea trae lo que se ve en la tabla; lo no decidido va vacío", () => {
    expect(cabeceraCsvLinea(2026)).toEqual(["AGRUPACION_MARCA", "EQUIVALENCIA", "2023", "2024", "2025", "VENDIDO_2026", "AVANCE_%", "PROPUESTO_2026", "DECIDIDO_2026", "CRECIMIENTO_%", "PROPUESTO_2027", "DECIDIDO_2027"]);
    expect(aniosHistoricos(2026)).toEqual([2023, 2024, 2025]);
    const filas = filasCsvLinea(filasDenim(), 2026);
    expect(filas).toHaveLength(5);
    expect(filas[0]).toEqual(["RECONOCIDO", "", 14500, 15310, 16480, 12480, 71.3, 17504, 17504, 5, 20395, ""]);
    expect(filas[1][8]).toBe("");
  });
});

describe("detalle de una fila", () => {
  it("la prueba con el año anterior se rotula «dentro de muestra» y lleva la EAT de M6 al lado", () => {
    const texto = textoPruebaAnterior({ anio: 2025, propuesto: 16210, real: 16480, desvio_pct: -1.6, eat_m6: 9.8 }, "2026-09-01");
    expect(texto).toBe("A set-2025 el método habría dado 16,210; el real fue 16,480 (-1.6 %) · dentro de muestra · M6 dejando 2025 fuera: EAT 9.8 pp");
    expect(textoPruebaAnterior({ anio: 2025, propuesto: 1, real: 2, desvio_pct: null, eat_m6: null }, "2026-09-01")).toContain("sin backtesting de M6");
  });

  it("muestra el factor del Niño por mes solo donde no es 1", () => {
    expect(textoFactoresMes(Array(12).fill(1))).toBeNull();
    expect(textoFactoresMes(null)).toBeNull();
    expect(textoFactoresMes([1, 1, 1, 1, 1, 1, 1, 1, 1.24, 1.12, 1, 1])).toBe("set 1.24, oct 1.12");
  });

  it("la tabla año × mes trae clase, quiebre y tiendas del bloque de cada año", () => {
    const t = tablaAnioMes(detalleFila());
    expect(t.map((x) => x.anio)).toEqual([2023, 2025, 2026]);
    expect(t[0].clase).toBe("atipico");
    expect(t[0].meses[0]?.atipico).toBe(true);
    expect(t[1].meses[4]?.quiebre).toBe(true);
    expect(t[2].meses[9]).toBeNull();
    expect(t[1].tiendas).toEqual(["T01", "T02", "T03"]);
  });

  it("la serie mensual dibuja los años históricos y los dos proyectados, estos discontinuos", () => {
    const s = seriesMensualesDeFila(detalleFila(), 2026);
    expect(s.map((x) => x.clave)).toEqual(["anio-2023", "anio-2025", "proyectado-2026", "proyectado-2027"]);
    expect(s[0].trazo).toBe("punteado");
    expect(s[0].etiqueta).toBe("2023 (Niño)");
    expect(s[2].trazo).toBe("discontinuo");
    expect(s[2].valores).toHaveLength(12);
  });
});

describe("tiendas nuevas y cierres", () => {
  it("dice de dónde sale la composición", () => {
    expect(textoComposicion(tiendaProyeccion())).toBe("Composición de T03 · Tienda 3");
    expect(textoComposicion(tiendaProyeccion({ referente: null, origen_composicion: "red" }))).toMatch(/promedio de las mismas tiendas/);
    expect(textoComposicion(tiendaProyeccion({ origen_composicion: "propia" }))).toMatch(/propia/);
  });

  it("rotula el bloque, la cifra alternativa y el perfil de apertura", () => {
    expect(etiquetaBloqueTienda(tiendaProyeccion())).toBe("Apertura en 2027");
    expect(etiquetaBloqueTienda(tiendaProyeccion({ subbloque: "nuevas_anterior", anio: 2026 }))).toBe("Nueva del año anterior en 2026");
    expect(etiquetaBloqueTienda(tiendaProyeccion({ bloque: "cierres", subbloque: null }))).toBe("Cierre en 2027");
    expect(etiquetaReferenciaAlternativa("avance_propio")).toBe("Por venta esperada y referente");
    expect(etiquetaReferenciaAlternativa("apertura")).toBe("Por su propio avance");
    expect(textoPerfilApertura([2.9, 1.8, 1.2])).toBe("×2.9 · ×1.8 · ×1.2");
  });

  it("una fila de tienda está fijada solo si se escribió a mano; las escaladas no", () => {
    expect(filaFijada({ decidido: 5000, origen: "manual" })).toBe(true);
    expect(filaFijada({ decidido: 1000, origen: "escalada" })).toBe(false);
    expect(filaFijada({ decidido: null, origen: null })).toBe(false);
    expect(filaFijada(undefined)).toBe(false);
  });

  it("ordena por año, nuevas antes que cierres y las sin decidir primero", () => {
    const base = tiendaProyeccion();
    const lista = [
      { ...base, anio: 2027, bloque: "cierres" as const, decidido: null, codigo: "T05" },
      { ...base, anio: 2027, bloque: "nuevas" as const, decidido: 100, codigo: "T11" },
      { ...base, anio: 2027, bloque: "nuevas" as const, decidido: null, codigo: "T12" },
      { ...base, anio: 2026, bloque: "nuevas" as const, decidido: null, codigo: "T10" },
    ];
    expect(ordenarTiendas(lista).map((t) => t.codigo)).toEqual(["T10", "T12", "T11", "T05"]);
  });
});

describe("matriz y mensual", () => {
  const nodos = [
    nodo("compania", "Compañía", {}),
    nodo("genero", "HOMBRE", { genero_id: "g-h" }),
    nodo("mundo", "URBANO", { genero_id: "g-h", mundo_id: "m-u" }),
    nodo("linea", "DENIM", { genero_id: "g-h", mundo_id: "m-u", linea_id: "l-denim" }),
    nodo("mundo", "FORMAL", { genero_id: "g-h", mundo_id: "m-f" }),
  ];

  it("género y mundo se pliegan; la compañía y los géneros siempre se ven", () => {
    expect(nodos.filter((n) => nodoVisible(n, new Set())).map((n) => n.nombre)).toEqual(["Compañía", "HOMBRE", "URBANO", "DENIM", "FORMAL"]);
    expect(nodos.filter((n) => nodoVisible(n, new Set(["m:g-h:m-u"]))).map((n) => n.nombre)).toEqual(["Compañía", "HOMBRE", "URBANO", "FORMAL"]);
    expect(nodos.filter((n) => nodoVisible(n, new Set(["g:g-h"]))).map((n) => n.nombre)).toEqual(["Compañía", "HOMBRE"]);
    expect(esPlegable(nodos[1])).toBe(true);
    expect(esPlegable(nodos[3])).toBe(false);
  });

  it("las columnas de cierres solo aparecen si alguna línea tiene cierres", () => {
    expect(hayCierres(nodos, "en_curso")).toBe(false);
    const con = [...nodos, nodo("linea", "X", {}, { en_curso: { ...nodos[0].en_curso, cierres: 40 } })];
    expect(hayCierres(con, "en_curso")).toBe(true);
    expect(hayCierres(con, "siguiente")).toBe(false);
  });

  it("el pie dice cuántas líneas y qué parte del total", () => {
    expect(textoPieMatriz({ lineas: 3, lineas_total: 41, porcentaje_total: 6.4 }, 2026)).toBe("3 líneas de 41 · 6.4 % del total de 2026");
    expect(textoPieMatriz({ lineas: 41, lineas_total: 41, porcentaje_total: null }, 2026)).toBe("41 líneas de 41");
  });

  it("las celdas mensuales distinguen real y proyectado; un mes sin curva queda nulo", () => {
    const f = filaMensual();
    const celdas = celdasDeAnio(f.anios[0]);
    expect(celdas).toHaveLength(12);
    expect(celdas.slice(0, 9).every((c) => c.origen === "real")).toBe(true);
    expect(celdas.slice(9).every((c) => c.origen === "proyectado")).toBe(true);
    expect(textoOrigenMeses(f.anios[0])).toBe("real:9/proy:3");
    expect(textoOrigenMeses(f.anios[1])).toBe("real:0/proy:12");
    const sin = respuestaMensual().filas[1].anios[0];
    expect(celdasDeAnio(sin).every((c) => c.valor === null)).toBe(true);
    expect(textoOrigenMeses(sin)).toBeNull();
  });

  it("los bloques del conmutador son los cuatro de la ficha", () => {
    expect([...BLOQUES_MENSUAL]).toEqual(["todas", "mismas", "nuevas", "cierres"]);
    expect(esBloqueMensual("nuevas")).toBe(true);
    expect(esBloqueMensual("x")).toBe(false);
  });
});

describe("concordancia del cierre, filas sin decidir y tendencia", () => {
  const con = (avisos: Record<string, number>) => lineasDeCierre(proyeccion({ resumen: { ...proyeccion().resumen!, avisos } })).join("|");

  it("singular y plural correctos en cola larga, curva nueva y propuesta distinta", () => {
    expect(con({ cola_larga: 1 })).toContain("1 registro de cola larga se cerrará con la propuesta");
    expect(con({ cola_larga: 2 })).toContain("2 registros de cola larga se cerrarán con la propuesta");
    expect(con({ curva_cambio: 1 })).toContain("1 registro con la curva nueva sin aplicar (se cierra con el reparto guardado)");
    expect(con({ curva_cambio: 3 })).toContain("3 registros con la curva nueva sin aplicar (se cierran con el reparto guardado)");
    expect(con({ propuesta_cambio: 1 })).toContain("1 decisión con la propuesta distinta (se cierra con tu cifra)");
    expect(con({ propuesta_cambio: 2 })).toContain("2 decisiones con la propuesta distinta (se cierran con tu cifra)");
  });

  it("la lista de filas sin decidir cuenta FILAS (no años), separada por motivo, ordenada por propuesta y limitada a 50 de cada una", () => {
    const base = { genero: "HOMBRE", mundo: "URBANO", linea: "DENIM", agrupacion_marca: "RECONOCIDO" };
    const umbral = Array.from({ length: 60 }, (_, i) => ({ ...base, clave: `|g${i}||a`, anio: 2026, propuesto: 100 + i, motivo: "umbral" as const }));
    const revision = Array.from({ length: 25 }, (_, i) => [2026, 2027].map((anio) => ({ ...base, clave: `|r${i}||a`, anio, propuesto: 10 + i + (anio - 2026), motivo: "revision_cola_larga" as const, demanda_corregida: 180.4, disponibilidad: 0.62 }))).flat();
    const l = listaSinDecidir({ filas_sin_decidir: [...umbral, ...revision], total_filas_sin_decidir: 85, total_filas_para_revision: 25 });
    expect(l?.umbral.total).toBe(60);
    expect(l?.umbral.lineas).toHaveLength(MAX_SIN_DECIDIR);
    expect(l?.umbral.lineas[0]).toBe("HOMBRE · URBANO · DENIM · RECONOCIDO · propuesta 2026: 159");
    // Las dos filas-año de una misma fila son UNA línea y UNA fila en el total.
    expect(l?.revision.total).toBe(25);
    expect(l?.revision.lineas).toHaveLength(25);
    expect(l?.revision.lineas[0]).toBe("HOMBRE · URBANO · DENIM · RECONOCIDO · propuesta 2026: 34 · 2027: 35 (demanda corregida 180 · disponibilidad 62.0 %)");
    expect(listaSinDecidir({})).toBeNull();
    expect(listaSinDecidir({ filas_sin_decidir: [] })).toBeNull();
    expect(listaSinDecidir(null)).toBeNull();
  });

  it("sin nombres del servidor la fila no queda anónima del todo", () => {
    expect(nombreFilaSinDecidir({ clave: "|gml-1234567890||am-99" })).toBe("Fila gml-1234 · am-99");
    expect(nombreFilaSinDecidir({ nombre: "X · Y" })).toBe("X · Y");
    expect(nombreFilaSinDecidir({})).toBe("Fila sin nombre");
  });

  it("las tiendas sin decidir salen con su código", () => {
    expect(listaTiendasSinDecidir({ tiendas_sin_decidir: [{ tienda_id: "tienda-12", anio: 2027 }, { tienda_id: "x", anio: 2026 }] }, bloques())).toEqual(["T12 · Tienda nueva B · 2027", "Tienda nueva · 2026"]);
    expect(listaTiendasSinDecidir({}, bloques())).toBeNull();
  });

  it("la tendencia solo se muestra si el dato está disponible, con punto decimal", () => {
    expect(textoTendencia(4.9, 2026)).toBe("Referencia: la tendencia de 2025 frente a 2024 fue +4.9 %.");
    expect(textoTendencia(null, 2026)).toBeNull();
    expect(textoTendencia(undefined, 2026)).toBeNull();
  });
});

describe("cola larga con disponibilidad y filas para revisión (0.10.1)", () => {
  it("«N filas para revisión» en la cabecera y en el cierre", () => {
    expect(textoParaRevision(1)).toBe("1 fila para revisión");
    expect(textoParaRevision(12)).toBe("12 filas para revisión");
    expect(resumenCabecera(proyeccion()).join(" · ")).toContain("12 filas para revisión");
    expect(resumenCabecera(proyeccion({ resumen: { ...proyeccion().resumen!, filas_para_revision: 0 } })).join(" · ")).not.toContain("para revisión");
    expect(lineasDeCierre(proyeccion()).join("|")).toContain("12 filas para revisión: cola larga con quiebres de stock; hay que decidirlas para cerrar");
  });

  it("el filtro «para revisión» existe y tiene su etiqueta", () => {
    expect(ETIQUETA_SOLO.para_revision).toBe("Para revisión");
    expect(leerFiltro(params("solo=para_revision")).solo).toBe("para_revision");
  });

  it("el método nuevo se explica como motivo de desactualizada; los demás motivos, tal cual", () => {
    expect(textoMotivoDesactualizada({ codigo: "version_metodo", mensaje: "x" })).toMatch(/método nuevo/);
    expect(textoMotivoDesactualizada({ codigo: "cargas_nuevas", mensaje: "Se publicó 2026-10." })).toBe("Se publicó 2026-10.");
    expect(lineasDeCierre(proyeccion({ desactualizada: [{ codigo: "version_metodo", mensaje: "x" }] })).join("|")).toContain("método nuevo");
  });

  it("resume la validación de una fila en una línea; cierra sin quiebres o sin dato no dice nada", () => {
    expect(resumenColaLarga(colaLarga())).toBe("Para revisión · disponibilidad 62.0 % · corregida 181");
    expect(resumenColaLarga(colaLarga({ veredicto: "cierra_con_quiebres" }))).toMatch(/^Cola larga con quiebres/);
    expect(resumenColaLarga(colaLarga({ veredicto: "cierra" }))).toBeNull();
    expect(resumenColaLarga(colaLarga({ veredicto: "sin_dato", disponibilidad: null, demanda_corregida: null }))).toBeNull();
    expect(resumenColaLarga(null)).toBeNull();
  });

  it("el detalle trae disponibilidad, tienda-meses, ritmo, meses sin stock y venta corregida", () => {
    const d = Object.fromEntries(datosColaLarga(colaLarga()).map((x) => [x.rotulo, x.valor]));
    expect(d["Disponibilidad"]).toBe("62.0 %");
    expect(d["Tienda-meses con stock"]).toBe("67 de 108");
    expect(d["Ritmo (u por tienda-mes con stock)"]).toBe("1.4");
    expect(d["Meses sin stock en ninguna tienda"]).toBe("1");
    expect(d["Venta corregida (A_f)"]).toBe("180.5");
    expect(datosColaLarga(colaLarga({ ritmo: null, demanda_corregida: null, disponibilidad: null }))[0].valor).toBe("—");
    expect(Object.keys(ETIQUETA_VEREDICTO)).toEqual(["cierra", "cierra_con_quiebres", "revision", "sin_dato"]);
  });

  it("una fila está para revisión si algún registro lo avisa", () => {
    expect(esParaRevision(filaRevision())).toBe(true);
    expect(esParaRevision(filasDenim()[0])).toBe(false);
  });

  it("umbral de disponibilidad: de 0 a 1, coma o punto", () => {
    expect(leerUmbralDisponibilidad("0,75")).toEqual({ ok: true, valor: 0.75 });
    expect(leerUmbralDisponibilidad("0")).toEqual({ ok: true, valor: 0 });
    expect(leerUmbralDisponibilidad("1")).toEqual({ ok: true, valor: 1 });
    expect(leerUmbralDisponibilidad("1.1").ok).toBe(false);
    expect(leerUmbralDisponibilidad("-0.1").ok).toBe(false);
    expect(leerUmbralDisponibilidad("").ok).toBe(false);
    expect(leerUmbralDisponibilidad("x").ok).toBe(false);
  });
});

describe("Factores del Niño: lectura de la fila, estados y diagnóstico (06e §4.2 y §5.2)", () => {
  const [f2023, invierno, verano, objetivo] = factores() as FactorVista[];

  it("el año en curso sale de las filas con estado; sin ellas, del año objetivo; el texto fijo lo nombra con el factor relativo", () => {
    expect(anioEnCursoDeFactores(factores())).toBe(2026);
    expect(anioEnCursoDeFactores([f2023, objetivo])).toBe(2026);
    expect(anioEnCursoDeFactores([f2023])).toBeNull();
    expect(anioEnCursoDeFactores([])).toBeNull();
    expect(textoIntroFactores(2026)).toBe("El factor de 2026 corrige la base de 2027 de cada temporada (método 5). Es relativo: la temporada frente a la red en los mismos meses. Si una temporada no tuvo efecto, escribe 1.00.");
    expect(textoIntroFactores(null)).toContain("el año en curso");
  });

  it("formatos: dos decimales en el texto corrido, tres en las tablas, «—» sin valor, y el día y mes en Lima", () => {
    expect(factor2(0.7021)).toBe("0.70");
    expect(factor2(1)).toBe("1.00");
    expect(factor3(0.7021)).toBe("0.702");
    expect(factor2(null)).toBe("—");
    expect(factor3(undefined)).toBe("—");
    expect(formatearDiaMes("2026-10-29T20:00:00Z")).toBe("29/10");
    expect(formatearDiaMes(null)).toBeNull();
    expect(formatearDiaMes("no es fecha")).toBeNull();
  });

  it("«9 de 12 del periodo»; sin los meses del periodo (calculado antes de 0.14.0), «12 meses»; sin nada, null", () => {
    expect(textoMesesPeriodo(invierno)).toBe("9 de 12 del periodo");
    expect(textoMesesPeriodo(verano)).toBe("1 de 4 del periodo");
    expect(textoMesesPeriodo(f2023)).toBe("12 meses");
    expect(textoMesesPeriodo({ meses_comparados: 1 })).toBe("1 mes");
    expect(textoMesesPeriodo({ meses_comparados: null })).toBeNull();
  });

  it("el calculado: el valor relativo, o por qué no hay (un mes, sin datos, sin calcular)", () => {
    expect(textoCalculado(invierno)).toEqual({ valor: "0.70", nota: null });
    expect(textoCalculado(verano)).toEqual({ valor: "—", nota: "1 mes del periodo, escríbelo tú" });
    expect(textoCalculado({ ratio_calculado: null, calculado_at: "2026-10-29T00:00:00Z", meses_periodo_con_dato: 0 })).toEqual({ valor: "—", nota: "sin datos del periodo todavía" });
    expect(textoCalculado({ ratio_calculado: null, calculado_at: "2026-10-29T00:00:00Z", meses_periodo_con_dato: 3 }).nota).toBe("sin valor calculado");
    expect(textoCalculado({ ratio_calculado: null, calculado_at: null, meses_periodo_con_dato: undefined })).toEqual({ valor: "—", nota: "sin calcular" });
    expect(textoCalculado({ ratio_calculado: null, calculado_at: "2026-10-29T00:00:00Z", meses_periodo_con_dato: undefined }).nota).toBe("sin valor calculado");
  });

  it("«tu valor 0.72 · calculado hoy 0.70» solo si difieren a dos decimales", () => {
    expect(textoDiferencia(invierno)).toBe("tu valor 0.72 · calculado hoy 0.70");
    expect(textoDiferencia({ ratio_aplicado: 0.7, ratio_calculado: 0.7021 })).toBeNull();
    expect(textoDiferencia({ ratio_aplicado: null, ratio_calculado: 0.7 })).toBeNull();
    expect(textoDiferencia({ ratio_aplicado: 0.7, ratio_calculado: null })).toBeNull();
  });

  it("efectivo con su origen, y «sin factor»", () => {
    expect(textoEfectivo(invierno)).toBe("0.72 · escrito por ti");
    expect(textoEfectivo(f2023)).toBe("0.63 · calculado");
    expect(textoEfectivo(verano)).toBe("sin factor");
  });

  it("insignias por estado: fórmula anterior solo si se calculó con ella; parcial; por confirmar; confirmado con o sin fecha; desfasado; sin factor", () => {
    const t = (f: FactorVista) => insigniasFactor(f).map((i) => i.texto);
    expect(t(f2023)).toEqual(["fórmula anterior"]);
    expect(t(invierno)).toEqual(["parcial", "por confirmar"]);
    expect(t(verano)).toEqual(["parcial", "Sin factor"]);
    expect(t(objetivo)).toEqual(["Año objetivo", "Sin factor"]);
    expect(t(factorInviernoConfirmado())).toEqual(["parcial", "confirmado el 29/10"]);
    expect(t({ ...factorInviernoConfirmado(), aplicado_at: undefined })).toEqual(["parcial", "confirmado"]);
    expect(t({ ...invierno, estado: "desfasado", motivos_desfase: ["formula"] })).toEqual(["parcial", "desfasado: sincroniza"]);
    // Un factor completo (no parcial) al día no lleva insignias; uno sin fórmula (no calculado nunca) tampoco dice «fórmula anterior».
    expect(t({ ...f2023, formula: "relativo_periodo" })).toEqual([]);
    expect(t({ ...f2023, formula: null, calculado_at: null })).toEqual([]);
    expect(insigniasFactor({ ...invierno, estado: "desfasado", motivos_desfase: ["cargas"] }).find((i) => i.clave === "desfasado")?.titulo).toContain("se cargaron datos nuevos después de calcular");
    expect(insigniasFactor(invierno).find((i) => i.clave === "sin_confirmar")?.titulo).toContain("el mismo lo confirma");
  });

  it("por confirmar es solo el estado `sin_confirmar`", () => {
    expect(pideConfirmar({ estado: "sin_confirmar" })).toBe(true);
    for (const estado of ["ok", "faltante", "desfasado", undefined] as const) expect(pideConfirmar({ estado })).toBe(false);
  });

  it("el motivo del desfase en palabras: cada condición por separado, juntas y sin motivo", () => {
    expect(textoDesfase(["formula"])).toBe("Desfasado: se calculó con la fórmula anterior. Pulsa «Sincronizar» y revisa el valor.");
    expect(textoDesfase(["cargas", "meses"])).toBe("Desfasado: se cargaron datos nuevos después de calcular y hay más meses publicados del periodo que cuando se calculó. Pulsa «Sincronizar» y revisa el valor.");
    expect(textoDesfase(["composicion"])).toContain("cambió la composición de las agrupaciones");
    expect(textoDesfase(["formula", "cargas", "composicion"])).toContain("fórmula anterior, se cargaron datos nuevos después de calcular y cambió la composición");
    expect(textoDesfase([])).toBe("Desfasado. Pulsa «Sincronizar» y revisa el valor.");
    expect(textoDesfase(undefined)).toBe("Desfasado. Pulsa «Sincronizar» y revisa el valor.");
  });

  it("lo que se escribe en «Aplicado»: vacío = el calculado; con `exigir` (confirmar) hay que escribir el valor; los límites son los de siempre", () => {
    expect(leerAplicado("0,72", false)).toEqual({ ok: true, valor: 0.72 });
    expect(leerAplicado("", false)).toEqual({ ok: true, valor: null });
    expect(leerAplicado("", true)).toEqual({ ok: false, motivo: "Escribe el valor para confirmarlo." });
    expect(leerAplicado("0.70", true)).toEqual({ ok: true, valor: 0.7 });
    expect(leerAplicado("1", true)).toEqual({ ok: true, valor: 1 });
    expect(leerAplicado("0.05", true).ok).toBe(false);
    expect(leerAplicado("3.1", false).ok).toBe(false);
    expect(leerAplicado("x", false).ok).toBe(false);
  });

  it("meses en palabras: uno, seguidos («setiembre a diciembre») o salteados", () => {
    expect(listaDeMeses([9])).toBe("setiembre");
    expect(listaDeMeses([12, 9, 10, 11])).toBe("setiembre a diciembre");
    expect(listaDeMeses([1, 2, 3, 4, 5, 6, 7, 8, 9])).toBe("enero a setiembre");
    expect(listaDeMeses([1, 3])).toBe("enero y marzo");
    expect(listaDeMeses([1, 3, 5])).toBe("enero, marzo y mayo");
    expect(listaDeMeses([])).toBe("");
  });

  it("la tabla de diagnóstico trae los doce meses en orden con tres decimales, y marca los del periodo", () => {
    const f = filasDiagnostico(diagnosticoVerano());
    expect(f).toHaveLength(12);
    expect(f.map((x) => x.mes).slice(0, 3)).toEqual(["ene", "feb", "mar"]);
    const set = f[8];
    expect(set).toEqual({ m: 9, mes: "set", enPeriodo: true, uRef: "7,000", u: "13,300", ratio: "1.900", control: "0.950", relativo: "2.000" });
    expect(f.filter((x) => x.enPeriodo).map((x) => x.mes)).toEqual(["set"]);
    expect(f[11]).toMatchObject({ enPeriodo: false, ratio: "—", control: "—", relativo: "—" });
    expect(filasDiagnostico(diagnosticoInvierno()).filter((x) => x.enPeriodo)).toHaveLength(9);
    // El orden no depende del que mande el servidor.
    const d = diagnosticoVerano();
    expect(filasDiagnostico({ ...d, meses: [...d.meses].reverse() })[0].mes).toBe("ene");
  });

  it("resumen del verano (ejemplo G): setiembre ×1.90, tendencia ene–ago ×1.20, red ×0.95 → ×1.58 sobre su tendencia y ×2.00 sobre la red, y el dato frágil", () => {
    const d: DiagnosticoVista = { ...diagnosticoVerano(), anio_ref: 2025 };
    expect(textoResumenDiagnostico(verano, d)).toEqual([
      "Setiembre: ×1.90 frente a 2025; su tendencia ene–ago ×1.20; la red ×0.95 → crece ×1.58 sobre su tendencia y ×2.00 sobre la red.",
      "1 solo mes del periodo, y es el de inicio de temporada: dato frágil. El sistema no propone factor: escríbelo tú.",
    ]);
    // Sin el año de referencia, lo dice en palabras.
    expect(textoResumenDiagnostico(verano, diagnosticoVerano())[0]).toContain("×1.90 frente al año normal de referencia;");
  });

  it("resumen del invierno: sin tendencia propia, el relativo frente a la red; con 2 o más meses del periodo no hay aviso de fragilidad", () => {
    expect(textoResumenDiagnostico(invierno, diagnosticoInvierno())).toEqual(["Enero a setiembre: ×0.66 frente al año normal de referencia; la red ×0.94 → ×0.70 frente a la red (el factor relativo)."]);
    // Verano con dos meses del periodo (set y oct): ya hay valor calculado y no hay aviso.
    const dos = { ...diagnosticoVerano(), meses_periodo_con_dato: 2, meses: diagnosticoVerano().meses.map((m) => (m.m === 10 ? { ...m, en_periodo: true, u: 9000, u_ref: 6000, ratio: 1.5, control: 0.95, relativo: 1.58 } : m)) };
    const r = textoResumenDiagnostico(verano, dos);
    expect(r).toHaveLength(1);
    expect(r[0]).toContain("Setiembre a octubre:");
    // Un solo mes de invierno con dato: también es frágil (el mínimo son 2 meses del periodo).
    expect(textoResumenDiagnostico(invierno, { ...diagnosticoInvierno(), meses_periodo_con_dato: 1 })[1]).toBe("1 solo mes del periodo: dato frágil. El sistema no propone factor: escríbelo tú.");
  });

  it("sin meses del periodo con dato: «Sin datos del periodo todavía»", () => {
    const sinDatos: DiagnosticoVista = { meses: diagnosticoVerano().meses.map((m) => ({ ...m, en_periodo: false })), ratio_fuera: 1.2, meses_periodo: 4, meses_periodo_con_dato: 0 };
    expect(textoResumenDiagnostico(verano, sinDatos)).toEqual(["Sin datos del periodo todavía."]);
  });

  it("sin la tendencia propia ni la red, el resumen dice solo lo que hay (sin inventar excesos)", () => {
    const sinRed = textoResumenDiagnostico({ temporada: "verano", ratio_volumen: 1.9, ratio_control: null }, { ...diagnosticoVerano(), ratio_fuera: null });
    expect(sinRed[0]).toBe("Setiembre: ×1.90 frente al año normal de referencia.");
    const soloTendencia = textoResumenDiagnostico({ temporada: "verano", ratio_volumen: 1.9, ratio_control: null }, diagnosticoVerano());
    expect(soloTendencia[0]).toBe("Setiembre: ×1.90 frente al año normal de referencia; su tendencia ene–ago ×1.20 → crece ×1.58 sobre su tendencia.");
  });
});

describe("Antes de proyectar y cierre: avisos del Niño y sus enlaces (06e §3.3)", () => {
  it("los avisos del Niño tienen enlace: Factores del Niño (con la proyección si se conoce) o Curvas", () => {
    expect(CODIGOS_AVISO_NINO).toEqual(["factor_sin_calcular", "factor_desfasado", "factor_sin_confirmar", "anio_siguiente_atipico"]);
    expect(enlaceDeAvisoNino("factor_desfasado")).toEqual({ href: "/planificacion/proyeccion?pestana=factores", texto: "Ir a Factores del Niño" });
    expect(enlaceDeAvisoNino("anio_siguiente_atipico")).toEqual({ href: "/planificacion/curvas-estacionalidad", texto: "Curvas → Periodos atípicos" });
    expect(enlaceDeAvisoNino("apertura_dudosa")).toBeNull();
    expect(enlaceDeMotivoNino("factor_faltante", "p1")?.href).toBe("/planificacion/proyeccion?proyeccion=p1&pestana=factores");
    expect(enlaceDeMotivoNino("factores_cambiados", "p1")).toBeNull();
    expect(enlaceDeMotivoNino("temporada_cambiada", "p1")).toBeNull();
  });

  it("los avisos de fila del Niño dicen lo nuevo: sin factor ya no se cierra; 2027 marcado no se aprueba ni se cierra", () => {
    expect(TEXTO_AVISO.sin_factor.texto).toContain("no podrás cerrar");
    expect(TEXTO_AVISO.sin_factor.texto).toContain("Factores del Niño");
    expect(TEXTO_AVISO.objetivo_atipico.texto).toContain("no aprobar su crecimiento ni cerrar");
    expect(TEXTO_AVISO.objetivo_atipico.tono).toBe("alerta");
    expect(TEXTO_AVISO.objetivo_atipico.texto).not.toContain("tu % es bruto");
  });
});
