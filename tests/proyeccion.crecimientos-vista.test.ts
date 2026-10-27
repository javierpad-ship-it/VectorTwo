import { describe, expect, it } from "vitest";
import {
  ayudaCrecimientoFila,
  ayudaRestoProvisional,
  esMetodoAnterior,
  filaCambio,
  filasDeResumen,
  insigniasDeFijadas,
  lineasPuente,
  listaEnPalabras,
  marcadorCrecimiento,
  restoAprobadoReciente,
  restoDeFoto,
  textoAlertaCambiados,
  textoAplicadoPrincipal,
  textoCabeceraCrecimientos,
  textoCambiado,
  textoCierresPuente,
  textoDesgloseResto,
  textoDesvioPorFijadas,
  textoMetodoAnterior,
  textoObjetivo,
  textoOrigenCrecimiento,
  textoPieCrecimientoLinea,
  textoQuienCuando,
  textoRebote,
  textoRestoDeFoto,
  textoVersion,
  textoVigenteHoy,
  textosDetalleBruto,
  tieneMotivoCambiados,
  TITULO_FILAS_FIJADAS,
} from "../src/app/(app)/planificacion/proyeccion/crecimientos-vista";
import {
  accionParaCodigo,
  cierreExigeRecalcular,
  crecimientosSinAprobarDe,
  cuantosFaltanCrecimientos,
  enlaceCrecimientoGeneroMundo,
  leerCrecimientosSinAprobar,
  MOTIVOS_NO_FORZABLES,
  textoAperturaTardia,
  textoColumnasVariacion,
  textoFaltanCrecimientos,
  textoMotivoDesactualizada,
  textoNoSePuedeCerrarPorCrecimientos,
  textoVentaEsperadaTienda,
} from "../src/app/(app)/planificacion/proyeccion/vista";
import { proyeccion, tiendaProyeccion } from "./proyeccion.pantalla.fixture";
import { agregado, agregadoHombreFormal, resumenAlDia, resumenCrecimientos } from "./proyeccion.crecimientos-pantalla.fixture";

/** Pruebas puras de la pestaña Crecimientos de solo lectura (06d, 0.12.1) y de la venta esperada de la tienda nueva (07d): datos sintéticos de las fichas. */

describe("tabla por GM, Resto y Total (§4.2)", () => {
  const r = resumenCrecimientos();
  const filas = filasDeResumen(r);
  const por = (nombre: string) => filas.find((f) => f.nombre === nombre)!;

  it("los GM, luego el Resto y al final el Total; sin Total (método anterior) no hay fila Total", () => {
    expect(filas.map((f) => f.tipo)).toEqual(["gm", "gm", "gm", "gm", "resto", "total"]);
    expect(filas.map((f) => f.nombre)).toEqual(["HOMBRE · FORMAL", "HOMBRE · URBANO", "MUJER · FORMAL", "MUJER · CASUAL", "Resto", "Total (mismas tiendas)"]);
    expect(filasDeResumen({ ...r, total: null }).map((f) => f.tipo)).toEqual(["gm", "gm", "gm", "gm", "resto"]);
  });

  it("lo aplicado sale de la foto y lo vigente de hoy del global; «cambió» solo si difieren", () => {
    expect(textoAplicadoPrincipal(por("HOMBRE · FORMAL").aplicado!)).toBe("20 % · v1");
    expect(textoVigenteHoy(por("HOMBRE · FORMAL").vigenteHoy)).toBe("20 % · v1");
    expect(por("HOMBRE · FORMAL").cambio).toBe(false);
    expect(textoAplicadoPrincipal(por("HOMBRE · URBANO").aplicado!)).toBe("10 % · v1");
    expect(textoVigenteHoy(por("HOMBRE · URBANO").vigenteHoy)).toBe("15 % · v2");
    expect(por("HOMBRE · URBANO").cambio).toBe(true);
    // Un GM sin aprobar sigue al Resto provisional: no hay nada vigente que haya cambiado.
    expect(textoAplicadoPrincipal(por("MUJER · CASUAL").aplicado!)).toBe("5 % · provisional");
    expect(textoVigenteHoy(por("MUJER · CASUAL").vigenteHoy)).toBe("sin aprobar");
    expect(por("MUJER · CASUAL").cambio).toBe(false);
    expect(filas.filter((f) => f.cambio).map((f) => f.nombre)).toEqual(["HOMBRE · URBANO"]);
    expect(filasDeResumen(resumenAlDia()).some((f) => f.cambio)).toBe(false);
  });

  it("filaCambio: otra versión, otro % o una versión aplicada que hoy ya no está vigente", () => {
    const f = (aplicado: Parameters<typeof filaCambio>[0]["aplicado"], vigente_hoy: Parameters<typeof filaCambio>[0]["vigente_hoy"]) => filaCambio({ aplicado, vigente_hoy });
    const v1 = { pct: 20, version: 1, provisional: false, por_nombre: "J", at: null };
    expect(f(v1, { pct: 20, version: 1, por_nombre: "J", aprobada_at: "x" })).toBe(false);
    expect(f(v1, { pct: 20, version: 2, por_nombre: "J", aprobada_at: "x" })).toBe(true);
    expect(f(v1, { pct: 21, version: 1, por_nombre: "J", aprobada_at: "x" })).toBe(true);
    expect(f(v1, null)).toBe(true);
    // El Resto provisional pasa a aprobado: cambió.
    expect(f({ pct: 5, version: null, provisional: true, por_nombre: null, at: null }, { pct: 5, version: 1, por_nombre: "J", aprobada_at: "x" })).toBe(true);
    expect(f({ pct: 5, version: null, provisional: true, por_nombre: null, at: null }, null)).toBe(false);
  });

  it("base, resultante y % resultante por fila; el Total sale de calcularPromedio sobre la foto", () => {
    expect(por("HOMBRE · FORMAL").base).toBe(17800);
    expect(por("HOMBRE · FORMAL").siguiente).toBe(19485);
    expect(por("HOMBRE · FORMAL").resultantePct).toBeCloseTo(9.466, 2);
    const t = por("Total (mismas tiendas)");
    expect(t.base).toBe(120000);
    expect(t.siguiente).toBeCloseTo(129185, 6);
    expect(t.resultantePct).toBeCloseTo(7.654, 2);
    expect(t.ponderado).toBeCloseTo(9.2167, 3);
    expect(t.aplicado).toBeNull();
    expect(t.enlace).toBeNull();
  });

  it("el Resto lleva el desglose de su base por género; los GM traen su enlace «Analizar y aprobar»", () => {
    expect(por("Resto").desglose).toBe("JOVENCITOS 8,200 · NIÑOS 6,100 · ACCESORIOS 5,700");
    expect(textoDesgloseResto([])).toBeNull();
    expect(textoDesgloseResto([{ genero: "SIN", base: 0 }])).toBeNull();
    expect(por("HOMBRE · URBANO").enlace).toBe("/planificacion/curvas-estacionalidad?gm=g-hombre.m-urbano&anio=2027&proyeccion=proy-1");
    expect(por("Resto").enlace).toContain("gm=resto");
  });

  it("insignias informativas sin acción: «N con % propio» y «N decidida(s)», con el título de dónde se cambian", () => {
    const i = insigniasDeFijadas(agregadoHombreFormal);
    expect(i.map((x) => x.texto)).toEqual(["1 con % propio", "1 decidida"]);
    expect(i.every((x) => x.titulo === TITULO_FILAS_FIJADAS)).toBe(true);
    expect(TITULO_FILAS_FIJADAS).toBe("Se cambian fila a fila en Por línea: vacía «Crec.» o usa «Volver a la propuesta»");
    expect(insigniasDeFijadas({ ...agregadoHombreFormal, pct_propio: { filas: 2, base: 1, siguiente: 1 }, decididas: { filas: 3, base: 1, siguiente: 1 } }).map((x) => x.texto)).toEqual(["2 con % propio", "3 decididas"]);
    expect(insigniasDeFijadas(agregado(1000))).toEqual([]);
    expect(por("HOMBRE · FORMAL").insignias.map((x) => x.texto)).toEqual(["1 con % propio", "1 decidida"]);
    expect(por("Total (mismas tiendas)").insignias.map((x) => x.texto)).toEqual(["1 con % propio", "1 decidida"]);
  });

  it("rebote del Niño solo como referencia; en el Total, Σ B'' ÷ Σ B − 1", () => {
    expect(por("HOMBRE · FORMAL").rebote?.texto).toBe("rebote del Niño +9.6 %");
    expect(por("HOMBRE · FORMAL").rebote?.titulo).toContain("Es referencia: no se aplica");
    expect(por("HOMBRE · URBANO").rebote).toBeNull();
    expect(textoRebote(agregado(100))).toBeNull();
    expect(por("Total (mismas tiendas)").rebote?.texto).toBe("rebote del Niño +1.4 %");
  });
});

describe("avisos, foto y cabecera", () => {
  const r = resumenCrecimientos();

  it("quién y cuándo de la foto: vacío en el Resto provisional", () => {
    expect(textoQuienCuando(null, null)).toBeNull();
    expect(textoQuienCuando("Javier", null)).toBe("Javier");
    const q = textoQuienCuando("Javier", "2026-10-20T15:30:00Z");
    expect(q).toContain("Javier · ");
    expect(q).toContain("2026");
    expect(textoVersion({ version: 2, provisional: false })).toBe("v2");
    expect(textoVersion({ version: null, provisional: true })).toBe("provisional");
    expect(textoVersion({ version: null, provisional: false })).toBe("sin versión");
  });

  it("lo aprobado cambió después de calcular: lista cada GM con su versión y su %", () => {
    expect(textoCambiado(r.cambiados[0])).toBe("HOMBRE · URBANO v1 → v2 (10 % → 15 %)");
    expect(textoCambiado({ clave: "k", nombre: "Resto", aplicado: null, vigente: { pct: 15, version: 1 } })).toBe("Resto provisional → v1 (— → 15 %)");
    expect(textoCambiado({ clave: "k", nombre: "MUJER · RI", aplicado: { pct: 8.5, version: 2 }, vigente: null })).toBe("MUJER · RI v2 → sin aprobar (8.5 % → —)");
    expect(textoAlertaCambiados(r.cambiados, true)).toBe("Los crecimientos aprobados cambiaron después de calcular: HOMBRE · URBANO v1 → v2 (10 % → 15 %). Recalcula.");
    // Sin lista pero con el motivo (un nodo cambió de mundo): aviso genérico; sin ninguno, nada.
    expect(textoAlertaCambiados([], true)).toContain("cambiaron después de calcular");
    expect(textoAlertaCambiados([], false)).toBeNull();
    const muchos = Array.from({ length: 7 }, (_, i) => ({ clave: `k${i}`, nombre: `GM ${i}`, aplicado: { pct: 1, version: 1 }, vigente: { pct: 2, version: 2 } }));
    expect(textoAlertaCambiados(muchos, true)).toContain("y 2 más");
    expect(tieneMotivoCambiados({ desactualizada: [{ codigo: "crecimientos_cambiados", mensaje: "x" }] })).toBe(true);
    expect(tieneMotivoCambiados({ desactualizada: [] })).toBe(false);
  });

  it("proyección de método anterior: solo dice que se recalcule (en trabajo) o que es de solo lectura", () => {
    expect(esMetodoAnterior({ version_metodo: 3 })).toBe(true);
    expect(esMetodoAnterior({ version_metodo: null })).toBe(true);
    expect(esMetodoAnterior({ version_metodo: 4 })).toBe(false);
    expect(textoMetodoAnterior(true)).toBe("Esta proyección se calculó con un método anterior: recalcúlala para ver sus crecimientos.");
    expect(textoMetodoAnterior(false)).not.toMatch(/[Rr]ecalc/);
  });

  it("la cabecera explica que el crecimiento es global y bruto", () => {
    const t = textoCabeceraCrecimientos(2026, 2027);
    expect(t).toContain("Crecimiento bruto 2027 frente a 2026 de las mismas tiendas de 2027");
    expect(t).toContain("sin corregir por el Niño");
    expect(t).toContain("Curvas de estacionalidad");
  });

  it("listaEnPalabras", () => {
    expect(listaEnPalabras(["A"])).toBe("A");
    expect(listaEnPalabras(["A", "B"])).toBe("A y B");
    expect(listaEnPalabras(["A", "B", "C"])).toBe("A, B y C");
  });
});

describe("pie: objetivo y puente al Total 2027 (sobre la foto)", () => {
  const total = resumenCrecimientos().total!;

  it("objetivo frente a lo aplicado y al resultado, en pp y en unidades", () => {
    expect(textoObjetivo(total.objetivo!)).toBe("Objetivo +12.0 % → con lo aplicado te faltan 2.8 pp; con el resultado, te faltan 4.3 pp ≈ 5,215 u.");
    const o = { pct: 5, faltan_pp_escrito: -4.2, faltan_pp_resultado: -2.7, faltan_unidades: -3000 };
    expect(textoObjetivo(o)).toContain("te pasas por 4.2 pp");
    expect(textoObjetivo(o)).toContain("3,000 u de más");
    expect(textoObjetivo({ pct: 12, faltan_pp_escrito: null, faltan_pp_resultado: null, faltan_unidades: null })).not.toContain("≈");
  });

  it("desvío por filas fijadas y cierres sin decidir", () => {
    expect(textoDesvioPorFijadas(total)).toBe("1 fila con % propio y 1 decidida llevan el total de +9.2 % a +7.7 %.");
    expect(textoDesvioPorFijadas({ filas_con_pct_propio: 0, filas_decididas: 0, ponderado_escrito_pct: 3, resultante_pct: 3 })).toBe("No hay filas fijadas a mano: el resultado coincide con lo aplicado.");
    expect(textoCierresPuente({ cierres: 0, cierres_sin_decidir: 1 })).toBe("0 u (1 tienda sin decidir)");
    expect(textoCierresPuente({ cierres: 300, cierres_sin_decidir: 0 })).toBe("300 u");
    expect(textoCierresPuente({ cierres: 0, cierres_sin_decidir: 2 })).toBe("0 u (2 tiendas sin decidir)");
  });

  it("el puente: base × crecimiento resultante + nuevas + aperturas + cierres = Total 2027, y la Var. de la Matriz", () => {
    const l = lineasPuente(total, 2026, 2027);
    expect(l.map((x) => x.clave)).toEqual(["base", "mismas", "nuevas", "aperturas", "cierres", "total", "comparado"]);
    const v = (clave: string) => l.find((x) => x.clave === clave)!;
    expect(v("base").valor).toBe("120,000 u");
    expect(v("mismas").texto).toContain("+7.7 %");
    expect(v("aperturas").valor).toBe("914 u");
    expect(v("total").valor).toBe("130,099 u");
    expect(v("total").negrita).toBe(true);
    expect(v("comparado").texto).toContain("118,000 u");
    expect(v("comparado").valor).toBe("+10.3 %");
  });
});

describe("el Resto en Nueva proyección y Parámetros", () => {
  it("el Resto de la foto: el usado en el último cálculo o, antes de 0.12.1, el provisional", () => {
    const base = proyeccion();
    expect(restoDeFoto(base)).toEqual({ pct: 0, version: null, aprobado: false });
    expect(textoRestoDeFoto(restoDeFoto(base))).toBe("0 % · Resto provisional");
    const aprobado = proyeccion({ parametros: { ...base.parametros, crecimiento_resto_usado: { pct: 10, crecimiento_id: "c-1", version: 2, por_nombre: "Javier", at: "2026-10-20T00:00:00Z" } } });
    expect(restoDeFoto(aprobado)).toEqual({ pct: 10, version: 2, aprobado: true });
    expect(textoRestoDeFoto(restoDeFoto(aprobado))).toBe("10 % · Resto v2 (aprobado)");
    // `crecimiento_id = null` = el cálculo usó el provisional.
    const prov = proyeccion({ parametros: { ...base.parametros, crecimiento_resto_usado: { pct: 5, crecimiento_id: null, version: null, por_nombre: null, at: null } } });
    expect(textoRestoDeFoto(restoDeFoto(prov))).toBe("5 % · Resto provisional");
  });

  it("la ayuda del Resto provisional: solo se usa mientras no haya un Resto aprobado; si lo hay, lo dice", () => {
    expect(ayudaRestoProvisional(2027, null)).toBe("Se usa solo mientras no haya un Resto aprobado para 2027.");
    const t = ayudaRestoProvisional(2027, { pct: 5, version: 1, nombre: "Proyección 2026–2027" });
    expect(t).toContain("Se usa solo mientras no haya un Resto aprobado para 2027.");
    expect(t).toContain("Resto aprobado para 2027");
    expect(t).toContain("5 % (v1)");
  });

  it("el Resto aprobado sale de la foto de la proyección calculada más reciente del año; sin ninguno, null", () => {
    const base = proyeccion();
    const con = (nombre: string, calculado_at: string | null, usado: { pct: number; version: number | null; id: string | null } | null, anio = 2026) =>
      proyeccion({ nombre, anio_en_curso: anio, calculado_at, parametros: { ...base.parametros, ...(usado ? { crecimiento_resto_usado: { pct: usado.pct, crecimiento_id: usado.id, version: usado.version, por_nombre: null, at: null } } : {}) } });
    expect(restoAprobadoReciente([con("A", "2026-10-01T00:00:00Z", null)], 2026)).toBeNull();
    expect(restoAprobadoReciente([con("A", "2026-10-01T00:00:00Z", { pct: 5, version: null, id: null })], 2026)).toBeNull();
    const r = restoAprobadoReciente(
      [con("Vieja", "2026-10-01T00:00:00Z", { pct: 5, version: 1, id: "c1" }), con("Nueva", "2026-10-10T00:00:00Z", { pct: 8, version: 2, id: "c2" }), con("Otro año", "2026-10-20T00:00:00Z", { pct: 1, version: 9, id: "c9" }, 2025)],
      2026
    );
    expect(r).toEqual({ pct: 8, version: 2, nombre: "Nueva" });
    expect(restoAprobadoReciente([con("Sin calcular", null, { pct: 5, version: 1, id: "c1" })], 2026)).toBeNull();
  });
});

describe("Por línea: % bruto efectivo y su origen", () => {
  it("el origen dice la versión: «20 % · HOMBRE · URBANO v2», «5 % · Resto v1», «5 % · Resto provisional»", () => {
    expect(textoOrigenCrecimiento({ pct: 20, origen: "celda", celda: "HOMBRE · URBANO", version: 2 })).toBe("20 % · HOMBRE · URBANO v2");
    expect(textoOrigenCrecimiento({ pct: 5, origen: "resto", celda: null, version: 1 })).toBe("5 % · Resto v1");
    expect(textoOrigenCrecimiento({ pct: 5, origen: "resto", celda: null, version: null, provisional: true })).toBe("5 % · Resto provisional");
    expect(textoOrigenCrecimiento({ pct: 8.5, origen: "fila", celda: null })).toBe("8.5 % · esta fila");
    expect(textoOrigenCrecimiento(null)).toBeNull();
    // Datos de antes de 0.12.1 (sin versión): el texto de siempre.
    expect(textoOrigenCrecimiento({ pct: 20, origen: "celda", celda: "HOMBRE · URBANO" })).toBe("20 % · HOMBRE · URBANO");
    expect(textoOrigenCrecimiento({ pct: 5, origen: "resto", celda: null })).toBe("5 % · Resto");
    expect(marcadorCrecimiento({ crecimiento_efectivo: { pct: 20, origen: "celda", celda: "HOMBRE · URBANO", version: 2 } })).toBe("20 % · HOMBRE · URBANO v2");
    expect(marcadorCrecimiento(undefined)).toBeNull();
  });

  it("la ayuda del campo «Crec.»: vacío = el aprobado de la combinación o el Resto (aprobado o provisional)", () => {
    const celda = { pct: 20, origen: "celda" as const, celda: "HOMBRE · URBANO", version: 2 };
    expect(ayudaCrecimientoFila(celda, 2027, 2026)).toBe("% bruto 2027 ÷ 2026 de esta fila, sin corregir por el Niño. Vacío = el aprobado de HOMBRE · URBANO (20 %).");
    expect(ayudaCrecimientoFila({ pct: 5, origen: "resto", celda: null, version: 1 }, 2027, 2026)).toContain("Vacío = el Resto aprobado (5 %).");
    expect(ayudaCrecimientoFila({ pct: 5, origen: "resto", celda: null, provisional: true }, 2027, 2026)).toContain("Vacío = el Resto provisional (5 %).");
    expect(ayudaCrecimientoFila(null, 2027, 2026)).toContain("Vacío = el aprobado de la combinación");
    expect(ayudaCrecimientoFila({ pct: 8, origen: "fila", celda: null }, 2027, 2026)).toContain("Vacío = el aprobado de la combinación");
    // Nunca habla de «la proyección» como origen del %.
    expect(ayudaCrecimientoFila(celda, 2027, 2026)).not.toContain("el de la proyección");
  });

  it("detalle: bruto efectivo con su versión, base, equivalencia sobre la normalizada por el Niño y decisión", () => {
    const t = textosDetalleBruto(
      { crecimiento_efectivo: { pct: 20, origen: "celda", celda: "HOMBRE · URBANO", version: 2 }, base_siguiente: 19424, base_normalizada: 19424, pct_bruto: 20, pct_sobre_normalizada: 20, decidido: null },
      2027,
      2026
    );
    expect(t).toEqual(["Crecimiento bruto efectivo +20.0 % (HOMBRE · URBANO v2) · base 2026 de las mismas tiendas de 2027: 19,424 u"]);
    const nino = textosDetalleBruto(
      { crecimiento_efectivo: { pct: 20, origen: "resto", celda: null, provisional: true }, base_siguiente: 3300, base_normalizada: 5000, pct_bruto: 20, pct_sobre_normalizada: -20.8, decidido: 3700 },
      2027,
      2026
    );
    expect(nino[0]).toContain("(Resto provisional)");
    expect(nino).toContain("Sobre la base normalizada por el Niño equivale a -20.8 %.");
    expect(nino).toContain("Tu decisión: +20.0 % bruto.");
    expect(textosDetalleBruto({ crecimiento_efectivo: null, base_siguiente: null, base_normalizada: null, pct_bruto: null, pct_sobre_normalizada: null, decidido: null }, 2027, 2026)).toEqual([]);
  });

  it("pie de «Línea (mismas)»: % bruto sobre la base con las dos cifras", () => {
    expect(textoPieCrecimientoLinea(60002, 50001, 2027, 2026)).toBe("+20.0 % bruto sobre la base 2026 de las mismas tiendas de 2027 (60,002 ÷ 50,001)");
    expect(textoPieCrecimientoLinea(60002, 0, 2027, 2026)).toBeNull();
    expect(textoPieCrecimientoLinea(60002, undefined, 2027, 2026)).toBeNull();
  });

  it("la Matriz explica que «Crec. mismas tiendas» es el % aprobado en Curvas (o el % propio de la fila)", () => {
    const t = textoColumnasVariacion(2026);
    expect(t.var).toBe("Var. = Total 2027 ÷ Total 2026 (incluye tiendas nuevas, aperturas y cierres).");
    expect(t.crec).toBe("Crec. mismas tiendas = 2027 de las mismas tiendas ÷ su 2026: es el % aprobado en Curvas → Crecimiento por género × mundo (o el % propio de la fila).");
    expect(t.nota).not.toContain("es lo que escribes en Crecimientos");
  });
});

describe("desactualización y cierre (06d)", () => {
  it("crecimientos_cambiados, crecimientos_sin_aprobar y version_metodo no se pueden forzar al cerrar; el resto sí", () => {
    expect(MOTIVOS_NO_FORZABLES).toEqual(["version_metodo", "crecimientos_cambiados", "crecimientos_sin_aprobar"]);
    for (const codigo of MOTIVOS_NO_FORZABLES) expect(cierreExigeRecalcular({ desactualizada: [{ codigo, mensaje: "x" }] })).toBe(true);
    expect(cierreExigeRecalcular({ desactualizada: [{ codigo: "config_cambiada", mensaje: "x" }] })).toBe(false);
    expect(cierreExigeRecalcular({ desactualizada: [{ codigo: "cargas_nuevas", mensaje: "x" }] })).toBe(false);
    expect(cierreExigeRecalcular({ desactualizada: [] })).toBe(false);
    expect(textoMotivoDesactualizada({ codigo: "crecimientos_cambiados", mensaje: "x" })).toContain("Los crecimientos aprobados cambiaron después de calcular");
  });

  it("los errores de crecimientos ofrecen la acción que corresponde", () => {
    expect(accionParaCodigo("conflicto")).toBe("recargar");
    expect(accionParaCodigo("estado_cambiado")).toBe("recargar");
    expect(accionParaCodigo("calculo_en_curso")).toBe("recargar");
    expect(accionParaCodigo("crecimientos_cambiados")).toBe("recalcular");
    // Sin aprobar no se arregla recalculando: se aprueba en Curvas.
    expect(accionParaCodigo("crecimientos_sin_aprobar")).toBeNull();
    expect(accionParaCodigo("crecimientos_globales")).toBeNull();
  });

  const sin3 = { faltan: [{ clave: "a", nombre: "HOMBRE · URBANO" }, { clave: "b", nombre: "MUJER · RI" }, { clave: "c", nombre: "MUJER · DEPORTIVO" }], resto_provisional: true };

  it("qué falta aprobar: el mensaje de la ficha, con los nombres y el Resto provisional", () => {
    expect(textoFaltanCrecimientos(sin3, 2027)).toBe("Faltan 3 crecimientos aprobados para 2027 (HOMBRE · URBANO, MUJER · RI, MUJER · DEPORTIVO) y el Resto es provisional");
    expect(textoFaltanCrecimientos(sin3, 2027, false)).toBe("Faltan 3 crecimientos aprobados para 2027 y el Resto es provisional");
    expect(textoFaltanCrecimientos({ faltan: [{ clave: "a", nombre: "MUJER · CASUAL" }], resto_provisional: false }, 2027)).toBe("Falta 1 crecimiento aprobado para 2027 (MUJER · CASUAL)");
    expect(textoFaltanCrecimientos({ faltan: [], resto_provisional: true }, 2027)).toBe("El Resto de 2027 es provisional");
    expect(cuantosFaltanCrecimientos(sin3)).toBe(4);
    expect(textoNoSePuedeCerrarPorCrecimientos(sin3, 2027)).toBe(
      "No se puede cerrar: faltan 3 crecimientos aprobados para 2027 y el Resto es provisional. Apruébalos en Curvas de estacionalidad → Crecimiento por género × mundo."
    );
  });

  it("«Cerrar proyección» se deshabilita solo en trabajo y solo si falta algo", () => {
    expect(crecimientosSinAprobarDe({ estado: "en_trabajo", crecimientos_sin_aprobar: sin3 })).toEqual(sin3);
    expect(crecimientosSinAprobarDe({ estado: "en_trabajo", crecimientos_sin_aprobar: null })).toBeNull();
    expect(crecimientosSinAprobarDe({ estado: "en_trabajo" })).toBeNull();
    expect(crecimientosSinAprobarDe({ estado: "en_trabajo", crecimientos_sin_aprobar: { faltan: [], resto_provisional: false } })).toBeNull();
    expect(crecimientosSinAprobarDe({ estado: "cerrada", crecimientos_sin_aprobar: sin3 })).toBeNull();
  });

  it("el cuerpo del 409 crecimientos_sin_aprobar se lee con o sin anidar en `detalle`; si no trae la forma, null", () => {
    const esperado = { faltan: [{ clave: "a", nombre: "HOMBRE · URBANO" }], resto_provisional: true };
    expect(leerCrecimientosSinAprobar({ codigo: "crecimientos_sin_aprobar", faltan: esperado.faltan, resto_provisional: true })).toEqual(esperado);
    expect(leerCrecimientosSinAprobar({ codigo: "crecimientos_sin_aprobar", detalle: { faltan: esperado.faltan, resto_provisional: true } })).toEqual(esperado);
    expect(leerCrecimientosSinAprobar({ faltan: [], resto_provisional: false })).toEqual({ faltan: [], resto_provisional: false });
    expect(leerCrecimientosSinAprobar({ codigo: "otro" })).toBeNull();
    expect(leerCrecimientosSinAprobar(null)).toBeNull();
  });

  it("el enlace a Curvas lleva la pestaña, el año y la proyección", () => {
    expect(enlaceCrecimientoGeneroMundo(2027, "proy-1")).toBe("/planificacion/curvas-estacionalidad?pestana=genero-mundo&anio=2027&proyeccion=proy-1");
  });
});


describe("venta esperada de la tienda nueva (07d)", () => {
  it("sin meses reales: venta mensual, año maduro y lo que vende en su año de apertura", () => {
    const t = textoVentaEsperadaTienda(tiendaProyeccion());
    expect(t?.principal).toBe("S/ 85,000 al mes (sin IGV, en régimen) · año maduro S/ 1,020,000");
    expect(t?.escala).toBe("en 2027 abre el 15-mar y vende el 83.7 % del año → S/ 853,597");
  });

  it("con meses reales es solo una referencia: la propuesta sale de lo vendido", () => {
    const base = tiendaProyeccion();
    const t = textoVentaEsperadaTienda({ ...base, escala: { ...base.escala!, con_meses_reales: true } });
    expect(t?.escala).toBe("referencia: con la venta esperada vendería el 83.7 % del año → S/ 853,597; la propuesta sale de lo vendido");
  });

  it("sin escala (cierre o proyección anterior) solo dice la venta mensual; sin venta, nada", () => {
    expect(textoVentaEsperadaTienda(tiendaProyeccion({ escala: null }))).toEqual({ principal: "S/ 85,000 al mes (sin IGV, en régimen)", escala: null });
    expect(textoVentaEsperadaTienda(tiendaProyeccion({ venta_esperada: null, escala: null }))).toBeNull();
  });

  it("apertura tardía con las cifras de la tienda", () => {
    const base = tiendaProyeccion();
    const t = textoAperturaTardia({ ...base, escala: { venta_mensual: 85000, anio_maduro: 1020000, fraccion: 0.1287, venta_anio_apertura: 131240, con_meses_reales: false } });
    expect(t).toBe("Abre tarde: en 2027 vende el 12.9 % de un año maduro (S/ 131,240 de S/ 1,020,000). En 2028 pasará a nueva del año anterior.");
    expect(textoAperturaTardia({ ...base, escala: null })).toBeNull();
  });
});
