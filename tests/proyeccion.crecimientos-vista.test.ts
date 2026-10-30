import { describe, expect, it } from "vitest";
import {
  ayudaCrecimientoFila,
  ayudaRestoProvisional,
  basesDeLinea,
  equivalenteDeCrecimiento,
  esBruto,
  esMetodoAnterior,
  filaCambio,
  filaConNino,
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
  textoCerradaMetodoAnterior,
  textoCierresPuente,
  textoCorreccionNino,
  textoDesgloseResto,
  textoDesvioPorFijadas,
  textoEquivalente,
  textoMetodoAnterior,
  textoObjetivo,
  textoOrigenCrecimiento,
  textoPieCrecimientoLinea,
  textoQuienCuando,
  textoRestoDeFoto,
  textoSobreBase,
  textoVersion,
  textoVigenteHoy,
  textosDetalleCrecimiento,
  tieneMotivoCambiados,
  TITULO_FILAS_FIJADAS,
} from "../src/app/(app)/planificacion/proyeccion/crecimientos-vista";
import {
  accionParaCodigo,
  cierreExigeRecalcular,
  crecimientosSinAprobarDe,
  cuantosFaltanCrecimientos,
  enlaceCrecimientoGeneroMundo,
  enlaceDetalleGeneroMundo,
  enlaceFactoresNino,
  factoresCambiadosDeAnioEnCurso,
  leerCrecimientosSinAprobar,
  motivosCierreBloqueado,
  MOTIVOS_NO_FORZABLES,
  textoAperturaTardia,
  textoBasesNodo,
  textoColumnasVariacion,
  textoFaltanCrecimientos,
  textoMotivoDesactualizada,
  textoNoSePuedeCerrarPorCrecimientos,
  textoReaprobarCierre,
  textoReaprobarUno,
  textoVentaEsperadaTienda,
} from "../src/app/(app)/planificacion/proyeccion/vista";
import { VERSION_METODO } from "../src/lib/proyeccion/tipos-api";
import { filasDenim, proyeccion, tiendaProyeccion } from "./proyeccion.pantalla.fixture";
import { agregado, agregadoHombreFormal, resumenAlDia, resumenConReaprobar, resumenCrecimientos } from "./proyeccion.crecimientos-pantalla.fixture";

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

  it("base real y corregida, resultante y los dos % por fila; el Total suma las bases de las filas y su resultante sale de calcularPromedio sobre la foto", () => {
    const hf = por("HOMBRE · FORMAL");
    expect(hf.base).toBe(17800);
    expect(hf.baseCorregida).toBe(19500);
    expect(hf.siguiente).toBe(21570);
    expect(hf.resultantePct).toBeCloseTo(21.18, 2); // sobre 2026 real: 21 570 ÷ 17 800
    expect(hf.resultanteCorregidoPct).toBeCloseTo(10.615, 2); // sobre 2026 corregido: 21 570 ÷ 19 500
    const t = por("Total (mismas tiendas)");
    expect(t.base).toBe(120000);
    expect(t.baseCorregida).toBe(125100);
    expect(t.siguiente).toBeCloseTo(135010, 6);
    expect(t.resultantePct).toBeCloseTo(12.508, 2);
    expect(t.resultanteCorregidoPct).toBeCloseTo(7.922, 2);
    expect(t.ponderado).toBeCloseTo(9.3845, 3);
    expect(t.aplicado).toBeNull();
    expect(t.enlace).toBeNull();
  });

  it("un GM sin Niño muestra la misma base real y corregida y ninguna corrección", () => {
    const mf = por("MUJER · FORMAL");
    expect(mf.baseCorregida).toBe(mf.base);
    expect(mf.correccion).toBeNull();
    expect(mf.resultanteCorregidoPct).toBeCloseTo(mf.resultantePct ?? 0, 6);
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

  it("«corrección del Niño» = Σ B' ÷ Σ B − 1; por debajo del 0,5 % dice «(no material)» y sin Niño no hay corrección", () => {
    expect(por("HOMBRE · FORMAL").correccion?.texto).toBe("corrección del Niño +9.6 %");
    expect(por("HOMBRE · FORMAL").correccion?.titulo).toContain("base sobre la que se aplica el %");
    expect(por("HOMBRE · FORMAL").correccion?.material).toBe(true);
    expect(por("HOMBRE · URBANO").correccion?.texto).toBe("corrección del Niño +6.8 %");
    expect(por("Total (mismas tiendas)").correccion?.texto).toMatch(/^corrección del Niño \+4\.[23] %$/); // 125 100 ÷ 120 000 − 1 = 4,25 %
    expect(textoCorreccionNino(agregado(100))).toBeNull();
    expect(textoCorreccionNino({ base: 0, base_normalizada: 5 })).toBeNull();
    const chica = textoCorreccionNino({ base: 100000, base_normalizada: 100100 });
    expect(chica?.texto).toBe("corrección del Niño +0.1 % (no material)");
    expect(chica?.material).toBe(false);
    expect(chica?.titulo).toContain("vale tal cual");
    expect(textoCorreccionNino({ base: 100000, base_normalizada: 100500 })?.material).toBe(true);
    expect(textoCorreccionNino({ base: 100000, base_normalizada: 99400 })?.texto).toBe("corrección del Niño -0.6 %");
  });

  it("sobre qué base se aplicó cada %: lo que trae la foto, «bruta» si hay que reaprobar y «corregida» en el Resto provisional", () => {
    expect(por("HOMBRE · FORMAL").sobre).toBe("corregida");
    expect(por("MUJER · CASUAL").sobre).toBe("corregida"); // aplicó el Resto provisional
    expect(por("Resto").sobre).toBe("corregida");
    expect(por("Total (mismas tiendas)").sobre).toBeNull();
    const rea = filasDeResumen(resumenConReaprobar());
    expect(rea.find((f) => f.nombre === "HOMBRE · URBANO")?.sobre).toBe("bruta");
    expect(filasDeResumen(r, { sobreResto: "bruta" }).find((f) => f.tipo === "resto")?.sobre).toBe("bruta");
    expect(textoSobreBase("corregida", 2026)).toBe("sobre 2026 corregido");
    expect(textoSobreBase("bruta", 2026)).toBe("sobre 2026 real · antes de 0.14.0");
    expect(textoSobreBase(null, 2026)).toBeNull();
  });

  it("«reaprobar» y «u fuera de la base» salen como avisos del GM; las claves `g|m` y `g.m` se comparan igual", () => {
    const rea = filasDeResumen(resumenConReaprobar(), { anioEnCurso: 2026 });
    const u = rea.find((f) => f.nombre === "HOMBRE · URBANO")!;
    expect(u.reaprobar).toEqual({ version: 1, correccion_pct: 6.8 });
    expect(u.avisos.map((a) => a.texto)).toEqual(["reaprobar"]);
    expect(u.avisos[0].titulo).toContain("v1 se aprobó sobre 2026 real antes de 0.14.0");
    expect(rea.filter((f) => f.reaprobar).map((f) => f.nombre)).toEqual(["HOMBRE · URBANO"]);
    // M8: las filas sin B y su venta de `Y` (clave `genero_id|mundo_id`).
    const fuera = filasDeResumen(r, { gmFueraBase: { "g-hombre|m-urbano": { filas: 3, unidades: 412 } } });
    expect(fuera.find((f) => f.nombre === "HOMBRE · URBANO")?.avisos.map((a) => a.texto)).toEqual(["412 u fuera de la base"]);
    expect(fuera.find((f) => f.nombre === "HOMBRE · FORMAL")?.avisos).toEqual([]);
    expect(filasDeResumen(r).every((f) => f.avisos.length === 0)).toBe(true);
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

  it("proyección de método anterior al vigente: solo dice que se recalcule (en trabajo) o que es de solo lectura", () => {
    expect(esMetodoAnterior({ version_metodo: VERSION_METODO - 1 })).toBe(true);
    expect(esMetodoAnterior({ version_metodo: 3 })).toBe(true);
    expect(esMetodoAnterior({ version_metodo: null })).toBe(true);
    expect(esMetodoAnterior({ version_metodo: VERSION_METODO })).toBe(false);
    expect(textoMetodoAnterior(true)).toBe("Esta proyección se calculó con un método anterior (antes de 0.14.0): recalcúlala para ver sus crecimientos sobre la base corregida del Niño.");
    expect(textoMetodoAnterior(false)).not.toMatch(/[Rr]ecalc/);
    expect(textoMetodoAnterior(false)).toContain("no están corregidos");
  });

  it("una cerrada de método anterior avisa que M8 la sigue usando hasta el nuevo cierre; la vigente no avisa", () => {
    // La cerrada de método 4 que Javier cierra antes de 0.14.0 es «anterior» cuando el método vigente es el 5; con la constante en 4 (antes de subirla) nada avisa.
    const anterior = textoCerradaMetodoAnterior(VERSION_METODO - 1) ?? "";
    expect(anterior).toContain("no están corregidos");
    expect(anterior).toContain("M8");
    expect(anterior).toContain(VERSION_METODO - 1 === 4 ? "método 4 (antes de 0.14.0)" : `método ${VERSION_METODO - 1}`);
    if (VERSION_METODO - 1 === 4) {
      expect(anterior).toContain("M8 la sigue usando con un aviso");
      expect(anterior).toContain("la reemplazará");
    }
    expect(textoCerradaMetodoAnterior(2)).toContain("método 2");
    expect(textoCerradaMetodoAnterior(VERSION_METODO)).toBeNull();
    expect(textoCerradaMetodoAnterior(null)).toBeNull();
    expect(textoCerradaMetodoAnterior(undefined)).toBeNull();
  });

  it("la cabecera explica que el % es sobre el año en curso corregido del Niño y que se ve también sobre el real", () => {
    const t = textoCabeceraCrecimientos(2026, 2027);
    expect(t).toContain("Crecimiento de 2027 sobre 2026 corregido del Niño, de las mismas tiendas de 2027");
    expect(t).toContain("sin Niño, corregido = real");
    expect(t).toContain("Curvas de estacionalidad");
    expect(t).toContain("sobre 2026 real");
    expect(t).not.toContain("sin corregir por el Niño");
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
    // El objetivo es «sobre 2026 real»: Σ B real = 120 000 → 134 400 u para el 12 %; la foto da 135 010 (+12.5 % real).
    expect(total.objetivo).toMatchObject({ sobre: "real", faltan_unidades: expect.closeTo(-610, 0) });
    expect(total.base_total).toBe(120000);
    expect(total.base_corregida_total).toBe(125100);
    expect(textoObjetivo(total.objetivo!)).toBe("Objetivo +12.0 % → con lo aplicado te pasas por 2.0 pp; con el resultado, te pasas por 0.5 pp ≈ 610 u de más.");
    const o = { pct: 5, faltan_pp_escrito: -4.2, faltan_pp_resultado: -2.7, faltan_unidades: -3000 };
    expect(textoObjetivo(o)).toContain("te pasas por 4.2 pp");
    expect(textoObjetivo(o)).toContain("3,000 u de más");
    expect(textoObjetivo({ pct: 12, faltan_pp_escrito: null, faltan_pp_resultado: null, faltan_unidades: null })).not.toContain("≈");
  });

  it("desvío por filas fijadas y cierres sin decidir", () => {
    expect(textoDesvioPorFijadas(total)).toBe("1 fila con % propio y 1 decidida llevan el total de +9.4 % a +7.9 %.");
    expect(textoDesvioPorFijadas({ filas_con_pct_propio: 0, filas_decididas: 0, ponderado_escrito_pct: 3, resultante_pct: 3 })).toBe("No hay filas fijadas a mano: el resultado coincide con lo aplicado.");
    expect(textoCierresPuente({ cierres: 0, cierres_sin_decidir: 1 })).toBe("0 u (1 tienda sin decidir)");
    expect(textoCierresPuente({ cierres: 300, cierres_sin_decidir: 0 })).toBe("300 u");
    expect(textoCierresPuente({ cierres: 0, cierres_sin_decidir: 2 })).toBe("0 u (2 tiendas sin decidir)");
  });

  it("el puente: base × crecimiento + nuevas + aperturas + cierres = Total 2027, y la Var. de la Matriz", () => {
    const l = lineasPuente(total, 2026, 2027);
    expect(l.map((x) => x.clave)).toEqual(["base", "mismas", "nuevas", "aperturas", "cierres", "total", "comparado"]);
    const v = (clave: string) => l.find((x) => x.clave === clave)!;
    expect(v("base").texto).toBe("Base 2026 de las mismas tiendas de 2027");
    expect(v("mismas").texto).toContain("+7.9 %"); // sin las bases de la tabla, el % que trae el servidor
    expect(v("aperturas").valor).toBe("914 u");
    expect(v("total").valor).toBe("135,924 u");
    expect(v("total").negrita).toBe(true);
    expect(v("comparado").texto).toContain("118,000 u");
    expect(v("comparado").valor).toBe("+15.2 %");
  });

  it("con las bases de la tabla, el puente parte la base en real y corregida y dice el % sobre las dos", () => {
    const l = lineasPuente(total, 2026, 2027, { real: 120000, corregida: 125100 });
    expect(l.map((x) => x.clave)).toEqual(["base", "corregida", "mismas", "nuevas", "aperturas", "cierres", "total", "comparado"]);
    const v = (clave: string) => l.find((x) => x.clave === clave)!;
    expect(v("base").texto).toBe("Base 2026 real de las mismas tiendas de 2027");
    expect(v("base").valor).toBe("120,000 u");
    expect(v("corregida").valor).toBe("125,100 u");
    expect(v("mismas").texto).toBe("× crecimiento +7.9 % sobre 2026 corregido (+12.5 % sobre 2026 real) = 2027 de las mismas tiendas");
    expect(v("mismas").valor).toBe("135,010 u");
    // Sin Niño no hay línea de base corregida y el texto es el de siempre.
    const sin = lineasPuente(total, 2026, 2027, { real: 125100, corregida: 125100 });
    expect(sin.map((x) => x.clave)).not.toContain("corregida");
    expect(sin.find((x) => x.clave === "mismas")?.texto).toContain("× crecimiento resultante");
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

describe("Por línea: % efectivo, su origen y sobre qué base", () => {
  const celda = { pct: 8, origen: "celda" as const, celda: "HOMBRE · URBANO", version: 2, sobre_base: "corregida" as const };
  const bruta = { pct: 15, origen: "celda" as const, celda: "HOMBRE · URBANO", version: 1, sobre_base: "bruta" as const };

  it("el origen dice la versión: «8 % · HOMBRE · URBANO v2», «5 % · Resto v1», «5 % · Resto provisional»; una versión de antes de 0.14.0 dice «bruto»", () => {
    expect(textoOrigenCrecimiento(celda)).toBe("8 % · HOMBRE · URBANO v2");
    expect(textoOrigenCrecimiento({ pct: 5, origen: "resto", celda: null, version: 1 })).toBe("5 % · Resto v1");
    expect(textoOrigenCrecimiento({ pct: 5, origen: "resto", celda: null, version: null, provisional: true })).toBe("5 % · Resto provisional");
    expect(textoOrigenCrecimiento({ pct: 8.5, origen: "fila", celda: null })).toBe("8.5 % · esta fila");
    expect(textoOrigenCrecimiento(bruta)).toBe("15 % bruto · HOMBRE · URBANO v1");
    // Un % propio de la fila y el Resto provisional nunca son brutos, aunque el dato lo diga.
    expect(textoOrigenCrecimiento({ pct: 8, origen: "fila", celda: null, sobre_base: "bruta" })).toBe("8 % · esta fila");
    expect(textoOrigenCrecimiento(null)).toBeNull();
    // Datos de antes de 0.12.1 (sin versión ni sobre_base): el texto de siempre.
    expect(textoOrigenCrecimiento({ pct: 20, origen: "celda", celda: "HOMBRE · URBANO" })).toBe("20 % · HOMBRE · URBANO");
    expect(textoOrigenCrecimiento({ pct: 5, origen: "resto", celda: null })).toBe("5 % · Resto");
    expect(marcadorCrecimiento({ crecimiento_efectivo: celda })).toBe("8 % · HOMBRE · URBANO v2");
    expect(marcadorCrecimiento(undefined)).toBeNull();
    expect(esBruto(bruta)).toBe(true);
    expect(esBruto(celda)).toBe(false);
    expect(esBruto(null)).toBe(false);
  });

  it("el marcador agrega «(reaprobar)» solo si se lo pide el GM de la lista de cierre y el % es bruto", () => {
    expect(marcadorCrecimiento({ crecimiento_efectivo: bruta }, { reaprobar: true })).toBe("15 % bruto · HOMBRE · URBANO v1 (reaprobar)");
    expect(marcadorCrecimiento({ crecimiento_efectivo: bruta })).toBe("15 % bruto · HOMBRE · URBANO v1");
    expect(marcadorCrecimiento({ crecimiento_efectivo: celda }, { reaprobar: true })).toBe("8 % · HOMBRE · URBANO v2");
  });

  it("la ayuda del campo «Crec.»: sobre la venta corregida del Niño; vacío = el aprobado de la combinación o el Resto", () => {
    expect(ayudaCrecimientoFila(celda, 2027, 2026)).toBe("% de 2027 sobre la venta de 2026 corregida del Niño de esta fila. Vacío = el aprobado de HOMBRE · URBANO (8 %).");
    expect(ayudaCrecimientoFila({ pct: 5, origen: "resto", celda: null, version: 1 }, 2027, 2026)).toContain("Vacío = el Resto aprobado (5 %).");
    expect(ayudaCrecimientoFila({ pct: 5, origen: "resto", celda: null, provisional: true }, 2027, 2026)).toContain("Vacío = el Resto provisional (5 %).");
    expect(ayudaCrecimientoFila(null, 2027, 2026)).toContain("Vacío = el aprobado de la combinación");
    expect(ayudaCrecimientoFila({ pct: 8, origen: "fila", celda: null }, 2027, 2026)).toContain("Vacío = el aprobado de la combinación");
    // Nunca habla de «la proyección» como origen del %, ni de «bruto» si el aprobado es corregido.
    expect(ayudaCrecimientoFila(celda, 2027, 2026)).not.toContain("el de la proyección");
    expect(ayudaCrecimientoFila(celda, 2027, 2026)).not.toMatch(/bruto|Ojo/);
    // Un aprobado de antes de 0.14.0 avisa que se aplica sobre el año real hasta reaprobarlo.
    expect(ayudaCrecimientoFila(bruta, 2027, 2026)).toContain("Ojo: ese % se aprobó antes de 0.14.0 sobre 2026 real y así se aplica hasta que se reapruebe.");
  });

  it("detalle (ejemplo B): % sobre corregido y sobre real con sus bases, sentido de la corrección y decisión", () => {
    const abrigo = { crecimiento_efectivo: celda, base_siguiente: 15300, base_normalizada: 19125, pct_bruto: 35, pct_sobre_normalizada: 8, decidido: null };
    expect(filaConNino(abrigo)).toBe(true);
    expect(textosDetalleCrecimiento(abrigo, 2027, 2026)).toEqual([
      "Crecimiento +8.0 % sobre 2026 corregido (HOMBRE · URBANO v2)",
      "Base 2026 de las mismas tiendas de 2027: 15,300 u real · 19,125 u corregida del Niño (+25.0 %)",
      "+8.0 % sobre 2026 corregido (19,125) · +35.0 % sobre 2026 real (15,300)",
      "2026 vendió de menos por el Niño: la base corregida es mayor que lo vendido.",
    ]);
    // Verano (ejemplo C): la base corregida baja y la fila «vendió de más».
    const verano = textosDetalleCrecimiento({ crecimiento_efectivo: celda, base_siguiente: 12000, base_normalizada: 10000, pct_bruto: -10, pct_sobre_normalizada: 8, decidido: null }, 2027, 2026);
    expect(verano).toContain("+8.0 % sobre 2026 corregido (10,000) · -10.0 % sobre 2026 real (12,000)");
    expect(verano).toContain("2026 vendió de más por el Niño: la base corregida es menor que lo vendido.");
    // Una fila decidida muestra también su % sobre real y sobre corregido.
    expect(textosDetalleCrecimiento({ ...abrigo, decidido: 22000, pct_bruto: 43.8, pct_sobre_normalizada: 15 }, 2027, 2026)).toContain("Tu decisión: +43.8 % sobre 2026 real (+15.0 % sobre 2026 corregido).");
    // Sin Niño: un solo %, sin sentido de la corrección.
    const sin = textosDetalleCrecimiento({ crecimiento_efectivo: celda, base_siguiente: 19424, base_normalizada: 19424, pct_bruto: 8, pct_sobre_normalizada: 8, decidido: null }, 2027, 2026);
    expect(sin).toEqual(["Crecimiento +8.0 % sobre 2026 corregido (HOMBRE · URBANO v2)", "Base 2026 de las mismas tiendas de 2027: 19,424 u (sin corrección del Niño)", "+8.0 % sobre 2026 (19,424)"]);
    // Una versión de antes de 0.14.0 se dice sobre el año real.
    expect(textosDetalleCrecimiento({ crecimiento_efectivo: bruta, base_siguiente: 15300, base_normalizada: 19125, pct_bruto: 15, pct_sobre_normalizada: -8, decidido: null }, 2027, 2026)[0]).toBe("Crecimiento +15.0 % sobre 2026 real (HOMBRE · URBANO v1, aprobado antes de 0.14.0)");
    expect(textosDetalleCrecimiento({ crecimiento_efectivo: null, base_siguiente: null, base_normalizada: null, pct_bruto: null, pct_sobre_normalizada: null, decidido: null }, 2027, 2026)).toEqual([]);
  });

  it("lo que da un % escrito sobre la base corregida y su equivalente sobre lo vendido (ejemplo B: 8 % → 20,655 u = +35,0 % real)", () => {
    const eq = equivalenteDeCrecimiento({ real: 15300, corregida: 19125 }, 8);
    expect(eq).toEqual({ total: 20655, pctReal: (20655 / 15300 - 1) * 100 });
    expect(textoEquivalente(eq!, 2027, 2026)).toBe("= 20,655 u en 2027 (+35.0 % sobre 2026 real)");
    // GM del ejemplo A/B: 8 % sobre 59 925 → 64 719 (+15,4 % sobre 56 100).
    const gm = equivalenteDeCrecimiento({ real: 56100, corregida: 59925 }, 8)!;
    expect(gm.total).toBe(64719);
    expect(gm.pctReal).toBeCloseTo(15.36, 2);
    expect(equivalenteDeCrecimiento({ real: 15300, corregida: null }, 8)).toBeNull();
    expect(equivalenteDeCrecimiento({ real: 15300, corregida: 0 }, 8)).toBeNull();
    expect(equivalenteDeCrecimiento({ real: 15300, corregida: 100 }, Number.NaN)).toBeNull();
    expect(textoEquivalente({ total: 100, pctReal: null }, 2027, 2026)).toBe("= 100 u en 2027");
  });

  it("pie de «Línea (mismas)»: % sobre corregido y sobre real con las dos cifras; sin Niño, uno solo", () => {
    expect(textoPieCrecimientoLinea(60002, 50001, 2026, 55500)).toBe("+8.1 % sobre 2026 corregido (60,002 ÷ 55,500) · +20.0 % sobre 2026 real (60,002 ÷ 50,001)");
    expect(textoPieCrecimientoLinea(60002, 50001, 2026, 50001)).toBe("+20.0 % sobre 2026 real (60,002 ÷ 50,001); sin corrección del Niño");
    expect(textoPieCrecimientoLinea(60002, 50001, 2026)).toBe("+20.0 % sobre 2026 real (60,002 ÷ 50,001)");
    expect(textoPieCrecimientoLinea(60002, 0, 2026)).toBeNull();
    expect(textoPieCrecimientoLinea(60002, undefined, 2026)).toBeNull();
  });

  it("las bases de la línea se suman de sus filas base de 2027 con B; sin base corregida en ninguna, null", () => {
    const [a, b] = filasDenim();
    const conBase = (f: typeof a, real: number, corregida: number, vigente: number) => ({ ...f, anios: f.anios.map((x) => (x.anio === 2027 ? { ...x, base_siguiente: real, base_normalizada: corregida, vigente } : x)) });
    const filas = [conBase(a, 15300, 19125, 20655), conBase(b, 40800, 40800, 44064)];
    expect(basesDeLinea(filas, 2026)).toEqual({ real: 56100, corregida: 59925, vigente: 64719 });
    expect(basesDeLinea([{ ...a, tienda_id: "t1" }, { ...b, activo: false }], 2026)).toBeNull();
    expect(basesDeLinea(filasDenim(), 2026)).toBeNull();
  });

  it("la Matriz explica «Crec. sobre 2026 corregido» y «Crec. sobre 2026 real» (06e §4.2)", () => {
    const t = textoColumnasVariacion(2026);
    expect(t.var).toBe("Var. = Total 2027 ÷ Total 2026 (incluye tiendas nuevas, aperturas y cierres).");
    expect(t.crec).toContain("Crec. sobre 2026 corregido = 2027 de las mismas tiendas ÷ su 2026 corregido del Niño");
    expect(t.crec).toContain("es el % que apruebas en Curvas → Crecimiento por género × mundo (o el % propio de la fila)");
    expect(t.real).toContain("Crec. sobre 2026 real = 2027 de las mismas tiendas ÷ lo que vendieron en 2026");
    expect(t.nota).toBe("El % que apruebas se aplica sobre 2026 corregido del Niño; «real» compara con lo vendido. Var. incluye además tiendas nuevas, aperturas y cierres.");
    expect(t.nota).not.toContain("es lo que escribes en Crecimientos");
  });

  it("las dos bases del nodo de la Matriz van en el título de la celda; sin base corregida, nada", () => {
    expect(textoBasesNodo({ base_siguiente: 15300, base_corregida: 19125 })).toBe("Base 15,300 u real · 19,125 u corregida (+25.0 %)");
    expect(textoBasesNodo({ base_siguiente: 15300, base_corregida: 15300 })).toBe("Base 15,300 u real · 15,300 u corregida");
    expect(textoBasesNodo({ base_siguiente: 15300 })).toBeNull();
    expect(textoBasesNodo({ base_siguiente: 0, base_corregida: 5 })).toBeNull();
  });
});

describe("desactualización y cierre (06d y 06e)", () => {
  it("lo que bloquea el cierre sin poder forzarse: el método viejo, crecimientos, sin aprobar y todo lo del Niño de Y; el resto sí se fuerza", () => {
    expect(MOTIVOS_NO_FORZABLES).toEqual([
      "version_metodo",
      "crecimientos_cambiados",
      "crecimientos_sin_aprobar",
      "temporada_cambiada",
      "anio_siguiente_atipico",
      "factor_faltante",
      "factor_desfasado",
      "factor_sin_confirmar",
      "reaprobar",
    ]);
    for (const codigo of MOTIVOS_NO_FORZABLES) expect(cierreExigeRecalcular({ desactualizada: [{ codigo, mensaje: "x" }] })).toBe(true);
    expect(cierreExigeRecalcular({ desactualizada: [{ codigo: "config_cambiada", mensaje: "x" }] })).toBe(false);
    expect(cierreExigeRecalcular({ desactualizada: [{ codigo: "cargas_nuevas", mensaje: "x" }] })).toBe(false);
    expect(cierreExigeRecalcular({ desactualizada: [] })).toBe(false);
    expect(textoMotivoDesactualizada({ codigo: "crecimientos_cambiados", mensaje: "x" })).toContain("Los crecimientos aprobados cambiaron después de calcular");
  });

  it("`factores_cambiados` solo es no forzable si es un factor del año en curso; el de otro año se puede forzar", () => {
    const de = (detalle: string[]) => ({ anio_en_curso: 2026, desactualizada: [{ codigo: "factores_cambiados", mensaje: "x", detalle }] });
    expect(factoresCambiadosDeAnioEnCurso(de(["invierno 2026"]))).toBe(true);
    expect(cierreExigeRecalcular(de(["invierno 2026", "invierno 2023"]))).toBe(true);
    expect(factoresCambiadosDeAnioEnCurso(de(["invierno 2023"]))).toBe(false);
    expect(cierreExigeRecalcular(de(["invierno 2023"]))).toBe(false);
    // Sin el año en curso (llamadas de antes) no se puede saber: forzable. Con la lista del servidor, manda ella.
    expect(cierreExigeRecalcular({ desactualizada: [{ codigo: "factores_cambiados", mensaje: "x", detalle: ["invierno 2026"] }] })).toBe(false);
    expect(cierreExigeRecalcular({ anio_en_curso: 2026, desactualizada: [], cierre_bloqueado_por: [{ codigo: "factores_cambiados", mensaje: "x" }] })).toBe(true);
    expect(cierreExigeRecalcular({ anio_en_curso: 2026, desactualizada: [], cierre_bloqueado_por: null })).toBe(false);
  });

  it("los motivos desactualizada del Niño se explican en palabras: factor de Y (no se fuerza) y agrupación cambiada", () => {
    expect(textoMotivoDesactualizada({ codigo: "factores_cambiados", mensaje: "Cambió algún factor.", detalle: ["invierno 2026"] }, 2026)).toBe(
      "Cambió el factor del Niño de invierno 2026, que corrige la base de 2027: recalcula (no se puede cerrar forzando)."
    );
    expect(textoMotivoDesactualizada({ codigo: "factores_cambiados", mensaje: "Cambió algún factor.", detalle: ["invierno 2026", "verano 2026"] }, 2026)).toContain("invierno 2026 y verano 2026");
    // De otro año, o sin año en curso, el mensaje del servidor tal cual.
    expect(textoMotivoDesactualizada({ codigo: "factores_cambiados", mensaje: "Cambió algún factor.", detalle: ["invierno 2023"] }, 2026)).toBe("Cambió algún factor.");
    expect(textoMotivoDesactualizada({ codigo: "factores_cambiados", mensaje: "Cambió algún factor." })).toBe("Cambió algún factor.");
    expect(textoMotivoDesactualizada({ codigo: "temporada_cambiada", mensaje: "x" })).toBe("Cambió la agrupación de alguna línea con Niño y con ella su factor: recalcula. No se puede cerrar hasta entonces.");
    expect(textoMotivoDesactualizada({ codigo: "version_metodo", mensaje: "x" })).toContain("método nuevo");
  });

  it("los errores de crecimientos y del Niño ofrecen la acción que corresponde", () => {
    expect(accionParaCodigo("conflicto")).toBe("recargar");
    expect(accionParaCodigo("estado_cambiado")).toBe("recargar");
    expect(accionParaCodigo("calculo_en_curso")).toBe("recargar");
    expect(accionParaCodigo("crecimientos_cambiados")).toBe("recalcular");
    expect(accionParaCodigo("factores_cambiados")).toBe("recalcular");
    expect(accionParaCodigo("temporada_cambiada")).toBe("recalcular");
    // Sin aprobar, un factor sin confirmar o 2027 marcado no se arreglan recalculando: se resuelven en Curvas o en Factores del Niño.
    expect(accionParaCodigo("crecimientos_sin_aprobar")).toBeNull();
    expect(accionParaCodigo("factor_sin_confirmar")).toBeNull();
    expect(accionParaCodigo("factor_faltante")).toBeNull();
    expect(accionParaCodigo("anio_siguiente_atipico")).toBeNull();
    expect(accionParaCodigo("crecimientos_globales")).toBeNull();
  });

  const sin3 = { faltan: [{ clave: "a", nombre: "HOMBRE · URBANO" }, { clave: "b", nombre: "MUJER · RI" }, { clave: "c", nombre: "MUJER · DEPORTIVO" }], resto_provisional: true };
  const rea1 = { clave: "g-h|m-u", nombre: "HOMBRE · URBANO", version: 1, correccion_pct: 6.8 };

  it("qué falta aprobar: el mensaje de la ficha, con los nombres y el Resto provisional", () => {
    expect(textoFaltanCrecimientos(sin3, 2027)).toBe("Faltan 3 crecimientos aprobados para 2027 (HOMBRE · URBANO, MUJER · RI, MUJER · DEPORTIVO) y el Resto es provisional");
    expect(textoFaltanCrecimientos(sin3, 2027, false)).toBe("Faltan 3 crecimientos aprobados para 2027 y el Resto es provisional");
    expect(textoFaltanCrecimientos({ faltan: [{ clave: "a", nombre: "MUJER · CASUAL" }], resto_provisional: false }, 2027)).toBe("Falta 1 crecimiento aprobado para 2027 (MUJER · CASUAL)");
    expect(textoFaltanCrecimientos({ faltan: [], resto_provisional: true }, 2027)).toBe("El Resto de 2027 es provisional");
    expect(textoFaltanCrecimientos({ faltan: [], resto_provisional: false, reaprobar: [rea1] }, 2027)).toBe("");
    expect(cuantosFaltanCrecimientos(sin3)).toBe(4);
    expect(textoNoSePuedeCerrarPorCrecimientos(sin3, 2027)).toBe(
      "No se puede cerrar: faltan 3 crecimientos aprobados para 2027 y el Resto es provisional. Apruébalos en Curvas de estacionalidad → Crecimiento por género × mundo."
    );
  });

  it("qué hay que reaprobar (06e): el ejemplo D en una frase, y la lista si son varios", () => {
    expect(textoReaprobarUno(rea1, 2026)).toBe("HOMBRE · URBANO v1 se aprobó sobre 2026 real antes de 0.14.0 y este GM tuvo Niño en 2026 (+6.8 %): reapruébalo");
    expect(textoReaprobarUno({ clave: "resto", nombre: "Resto", version: 2, correccion_pct: 3.2 }, 2026)).toBe("Resto v2 se aprobó sobre 2026 real antes de 0.14.0 y tuvo Niño en 2026 (+3.2 %): reapruébalo");
    expect(textoReaprobarCierre([rea1], 2026)).toBe(textoReaprobarUno(rea1, 2026));
    const varios = textoReaprobarCierre([rea1, { clave: "g-m|m-r", nombre: "MUJER · RI", version: 3, correccion_pct: 2 }], 2026);
    expect(varios).toBe("2 crecimientos se aprobaron sobre 2026 real antes de 0.14.0 y esos GM tuvieron Niño en 2026 (HOMBRE · URBANO v1 +6.8 %, MUJER · RI v3 +2.0 %): reapruébalos");
    expect(textoReaprobarCierre([], 2026)).toBe("");
    expect(textoReaprobarCierre(undefined, 2026)).toBe("");
  });

  it("el título de «Cerrar» junta lo que falta y lo que hay que reaprobar", () => {
    const solo = textoNoSePuedeCerrarPorCrecimientos({ faltan: [], resto_provisional: false, reaprobar: [rea1] }, 2027);
    expect(solo).toBe("No se puede cerrar: HOMBRE · URBANO v1 se aprobó sobre 2026 real antes de 0.14.0 y este GM tuvo Niño en 2026 (+6.8 %): reapruébalo. Reaprueba en Curvas de estacionalidad → Crecimiento por género × mundo (un clic: «Reaprobar»).");
    const ambos = textoNoSePuedeCerrarPorCrecimientos({ faltan: [{ clave: "a", nombre: "MUJER · CASUAL" }], resto_provisional: false, reaprobar: [rea1] }, 2027);
    expect(ambos).toContain("falta 1 crecimiento aprobado para 2027. Apruébalos en");
    expect(ambos).toContain("HOMBRE · URBANO v1 se aprobó sobre 2026 real");
  });

  it("«Cerrar proyección» se deshabilita solo en trabajo y solo si falta algo o hay que reaprobar", () => {
    expect(crecimientosSinAprobarDe({ estado: "en_trabajo", crecimientos_sin_aprobar: sin3 })).toEqual(sin3);
    expect(crecimientosSinAprobarDe({ estado: "en_trabajo", crecimientos_sin_aprobar: null })).toBeNull();
    expect(crecimientosSinAprobarDe({ estado: "en_trabajo" })).toBeNull();
    expect(crecimientosSinAprobarDe({ estado: "en_trabajo", crecimientos_sin_aprobar: { faltan: [], resto_provisional: false } })).toBeNull();
    expect(crecimientosSinAprobarDe({ estado: "en_trabajo", crecimientos_sin_aprobar: { faltan: [], resto_provisional: false, reaprobar: [] } })).toBeNull();
    const soloReaprobar = { faltan: [], resto_provisional: false, reaprobar: [rea1] };
    expect(crecimientosSinAprobarDe({ estado: "en_trabajo", crecimientos_sin_aprobar: soloReaprobar })).toEqual(soloReaprobar);
    expect(crecimientosSinAprobarDe({ estado: "cerrada", crecimientos_sin_aprobar: sin3 })).toBeNull();
  });

  it("el cuerpo del 409 crecimientos_sin_aprobar se lee con o sin anidar en `detalle` y trae `reaprobar`; si no trae la forma, null", () => {
    const esperado = { faltan: [{ clave: "a", nombre: "HOMBRE · URBANO" }], resto_provisional: true };
    expect(leerCrecimientosSinAprobar({ codigo: "crecimientos_sin_aprobar", faltan: esperado.faltan, resto_provisional: true })).toEqual(esperado);
    expect(leerCrecimientosSinAprobar({ codigo: "crecimientos_sin_aprobar", detalle: { faltan: esperado.faltan, resto_provisional: true } })).toEqual(esperado);
    expect(leerCrecimientosSinAprobar({ faltan: [], resto_provisional: false })).toEqual({ faltan: [], resto_provisional: false });
    expect(leerCrecimientosSinAprobar({ codigo: "otro" })).toBeNull();
    expect(leerCrecimientosSinAprobar(null)).toBeNull();
    expect(leerCrecimientosSinAprobar({ faltan: [], resto_provisional: false, reaprobar: [rea1, { sin: "nombre" }] })).toEqual({ faltan: [], resto_provisional: false, reaprobar: [rea1] });
    expect(leerCrecimientosSinAprobar({ detalle: { faltan: [], resto_provisional: false, reaprobar: [rea1] } })?.reaprobar).toEqual([rea1]);
  });

  it("lo que impide cerrar por el Niño: la lista de la proyección en trabajo más el rechazo del servidor, con su enlace o con «recalcular»", () => {
    const lista = [
      { codigo: "factor_sin_confirmar" as const, mensaje: "El factor de invierno 2026 (0.70) es parcial y nadie lo confirmó con los datos de hoy." },
      { codigo: "anio_siguiente_atipico" as const, mensaje: "2027 está marcado como año del Niño." },
      { codigo: "factores_cambiados" as const, mensaje: "Cambió el factor del Niño de invierno 2026." },
    ];
    const p = proyeccion({ cierre_bloqueado_por: lista });
    const m = motivosCierreBloqueado(p);
    expect(m.map((x) => x.codigo)).toEqual(["factor_sin_confirmar", "anio_siguiente_atipico", "factores_cambiados"]);
    expect(m[0].enlace).toEqual({ href: "/planificacion/proyeccion?proyeccion=proy-1&pestana=factores", texto: "Ir a Factores del Niño" });
    expect(m[1].enlace).toEqual({ href: "/planificacion/curvas-estacionalidad", texto: "Curvas → Periodos atípicos" });
    expect(m[2].enlace).toBeNull();
    expect(m.map((x) => x.recalcular)).toEqual([false, false, true]);
    expect(enlaceFactoresNino("a b")).toBe("/planificacion/proyeccion?proyeccion=a%20b&pestana=factores");
    // Una cerrada o sin lista no bloquea; un rechazo del servidor con uno de esos códigos se suma (sin repetir) y los demás errores no cuentan.
    expect(motivosCierreBloqueado(proyeccion({ estado: "cerrada", cierre_bloqueado_por: lista }))).toEqual([]);
    expect(motivosCierreBloqueado(proyeccion())).toEqual([]);
    expect(motivosCierreBloqueado(proyeccion(), { codigo: "factor_faltante", mensaje: "Falta el factor del Niño de verano 2026." }).map((x) => x.codigo)).toEqual(["factor_faltante"]);
    expect(motivosCierreBloqueado(p, { codigo: "factor_sin_confirmar", mensaje: "otra vez" })).toHaveLength(3);
    expect(motivosCierreBloqueado(proyeccion(), { codigo: "conflicto", mensaje: "x" })).toEqual([]);
    expect(motivosCierreBloqueado(proyeccion(), { codigo: null, mensaje: "x" })).toEqual([]);
  });

  it("el enlace a la pantalla de un GM acepta la clave `genero|mundo` de la API y lleva el año y la proyección", () => {
    expect(enlaceDetalleGeneroMundo(2027, "proy-1", "g-h|m-u")).toBe("/planificacion/curvas-estacionalidad?gm=g-h.m-u&anio=2027&proyeccion=proy-1");
    expect(enlaceDetalleGeneroMundo(2027, "proy-1", "resto")).toBe("/planificacion/curvas-estacionalidad?gm=resto&anio=2027&proyeccion=proy-1");
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
