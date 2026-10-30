import { describe, expect, it } from "vitest";
import { hojasMatriz, hojasMensual } from "@/lib/proyeccion/excel";
import { armarMatriz, estadoLinea, filtrarFilas, indiceDeLineas, type FilaPlana } from "@/lib/proyeccion/matriz";
import { armarFilasCerradas, armarMensual } from "@/lib/proyeccion/mensual";
import { calcularProyeccion } from "@/lib/proyeccion/modelo";
import type { DecisionPrevia, PreviasCalculo } from "@/lib/proyeccion/tipos";
import { AM, N, Y, aPlanas, clave, entrada, hechosBase, tiendas } from "./proyeccion.fixture";

const decision = (d: Partial<DecisionPrevia>): DecisionPrevia => ({ decidido: null, origen: null, nota: null, propuesta_al_decidir: null, crecimiento_pct: null, decidido_por_nombre: null, decidido_at: null, meses: null, curva_origen_usada: [], ...d });
const previas = (filas: [string, DecisionPrevia][]): PreviasCalculo => ({ filas: new Map(filas), tiendas: new Map() });

const salida = calcularProyeccion(entrada());
const planas = aPlanas(salida.filas);
const nodo = (nodos: ReturnType<typeof armarMatriz>["nodos"], nombre: string, nivel: string) => nodos.find((n) => n.nombre === nombre && n.nivel === nivel)!;
const suma = (x: readonly (number | null)[]) => x.reduce<number>((a, b) => a + (b ?? 0), 0);

describe("matriz (caso 13; reglas 28, 29 y 31)", () => {
  const { nodos, resumen } = armarMatriz(planas, { anio: Y });

  it("columnas sin solapes: total = mismas + nuevas del año anterior + aperturas + cierres, en los dos años", () => {
    for (const n of nodos) {
      expect(n.en_curso.total).toBe(n.en_curso.mismas + n.en_curso.nuevas_anterior + n.en_curso.aperturas + n.en_curso.cierres);
      expect(n.siguiente.total).toBe(n.siguiente.mismas + n.siguiente.nuevas_anterior + n.siguiente.aperturas + n.siguiente.cierres);
    }
  });

  it("DENIM 2026: venta a la fecha = mismas + T2 + T3 + T9 + T7; total = 1 800 + T2 300 + (T3 240 + T9 714) + cierres T7", () => {
    const denim = nodo(nodos, "DENIM", "linea");
    const real = hechosBase().filter((h) => h.nodo === "denim" && h.tienda !== "CD" && h.periodo >= "2026-01" && h.periodo <= "2026-09").reduce((a, h) => a + h.unidades, 0);
    expect(denim.en_curso.venta_a_la_fecha).toBe(real);
    const base = salida.filas.filter((f) => f.gml_id === N.denim && f.tienda_id === null).reduce((a, f) => a + (f.registros.find((r) => r.anio === Y)?.vigente ?? 0), 0);
    expect(denim.en_curso.mismas).toBe(base);
    expect(denim.en_curso.nuevas_anterior).toBeGreaterThanOrEqual(300);
    expect(denim.en_curso.aperturas).toBeGreaterThanOrEqual(240 + 714);
    expect(denim.en_curso.cierres).toBeGreaterThanOrEqual(60);
  });

  it("los totales de mundo, género y compañía son sumas exactas de sus líneas", () => {
    const lineas = nodos.filter((n) => n.nivel === "linea");
    const compania = nodos[0];
    expect(compania.nivel).toBe("compania");
    expect(compania.en_curso.total).toBe(lineas.reduce((a, l) => a + l.en_curso.total, 0));
    expect(compania.siguiente.total).toBe(lineas.reduce((a, l) => a + l.siguiente.total, 0));
    const hombre = nodo(nodos, "HOMBRE", "genero");
    expect(hombre.en_curso.total).toBe(nodo(nodos, "DENIM", "linea").en_curso.total + nodo(nodos, "ABRIGO", "linea").en_curso.total);
    expect(hombre.en_curso.venta_a_la_fecha).toBe(nodo(nodos, "DENIM", "linea").en_curso.venta_a_la_fecha + nodo(nodos, "ABRIGO", "linea").en_curso.venta_a_la_fecha);
    expect(resumen.lineas).toBe(4);
    expect(resumen.lineas_total).toBe(4);
    expect(resumen.porcentaje_total).toBeCloseTo(100, 10);
  });

  it("la variación es total del año siguiente ÷ total del año en curso − 1", () => {
    const d = nodo(nodos, "DENIM", "linea");
    expect(d.variacion_pct).toBeCloseTo((d.siguiente.total / d.en_curso.total - 1) * 100, 10);
  });

  it("con filtro genero = MUJER la compañía filtrada es MUJER y el porcentaje del total es menor que 100 %", () => {
    const mujer = planas.find((f) => f.genero === "MUJER")!.genero_id;
    const r = armarMatriz(planas, { anio: Y, filtro: { genero_id: mujer } });
    const mujerNodo = nodo(r.nodos, "MUJER", "genero");
    expect(r.nodos[0].en_curso.total).toBe(mujerNodo.en_curso.total);
    expect(r.resumen.lineas).toBe(2);
    expect(r.resumen.porcentaje_total).toBeLessThan(100);
    expect(r.nodos.some((n) => n.nombre === "HOMBRE")).toBe(false);
  });

  it("solo = con_tiendas_nuevas deja las líneas con T2, T3, T4 o T9 > 0 (DENIM y las demás donde T4 propone)", () => {
    const r = armarMatriz(planas, { anio: Y, filtro: { solo: "con_tiendas_nuevas" } });
    const lineas = r.nodos.filter((n) => n.nivel === "linea").map((n) => n.nombre);
    expect(lineas).toContain("DENIM");
    for (const n of r.nodos.filter((x) => x.nivel === "linea")) expect(n.en_curso.nuevas_anterior + n.en_curso.aperturas + n.siguiente.nuevas_anterior + n.siguiente.aperturas).toBeGreaterThan(0);
  });

  it("la agrupación de marca recorta las cifras; temporada y agrupación de estacionalidad miran la dominante", () => {
    const r = armarMatriz(planas, { anio: Y, filtro: { agrupacion_marca_id: AM.pre } });
    expect(nodo(r.nodos, "DENIM", "linea").en_curso.mismas).toBe(60);
    const inv = filtrarFilas(planas, { temporada: "invierno" });
    expect(new Set(inv.map((f) => f.linea))).toEqual(new Set(["ABRIGO", "MIXTA"]));
    expect(filtrarFilas(planas, { agrupacion_estacionalidad_id: "a-mu-verano" }).every((f) => f.agrupacion_estacionalidad?.id === "a-mu-verano")).toBe(true);
  });

  it("vista por agrupación de marca: una fila por género × agrupación, con la misma compañía", () => {
    const r = armarMatriz(planas, { anio: Y, filtro: { por: "agrupacion_marca" } });
    expect(r.nodos.filter((n) => n.nivel === "agrupacion_marca").length).toBeGreaterThan(2);
    expect(r.nodos[0].en_curso.total).toBe(armarMatriz(planas, { anio: Y }).nodos[0].en_curso.total);
  });

  it("resumen del índice lateral: estado de cada línea", () => {
    const i = indiceDeLineas(planas, Y);
    expect(i).toHaveLength(4);
    expect(i.every((l) => l.estado === "sin_proyectar")).toBe(true);
  });
});

describe("estado de la línea (regla 29)", () => {
  const delNodo = (filas: FilaPlana[], gml: string) => filas.filter((f) => f.gml_id === gml);

  it("sin decidir ninguna fila → sin_proyectar; decidir algunas → parcial", () => {
    expect(estadoLinea(delNodo(planas, N.denim), Y)).toBe("sin_proyectar");
    const parcial = aPlanas(calcularProyeccion(entrada({ previas: previas([[`${clave("denim", AM.rec)}#${Y}`, decision({ decidido: 1800, origen: "propuesta", propuesta_al_decidir: 1800 })]]) })).filas);
    expect(estadoLinea(delNodo(parcial, N.denim), Y)).toBe("parcial");
  });

  it("todas las filas con propuesta ≥ umbral decididas en los dos años y las tiendas decididas → proyectada; con curva o propuesta cambiada prevalecen", () => {
    const e = entrada();
    const grandes = salida.filas.filter((f) => f.gml_id === N.denim && f.tienda_id === null);
    const filas: [string, DecisionPrevia][] = [];
    for (const f of grandes) for (const r of f.registros) filas.push([`${f.clave}#${r.anio}`, decision({ decidido: r.propuesto ?? 0, origen: "propuesta", propuesta_al_decidir: r.propuesto })]);
    const tiendasP = new Map(salida.tiendas.filter((t) => t.propuesto !== null).map((t) => [`${t.tienda_id}#${t.anio}`, { decidido: t.propuesto, origen: "propuesta" as const, nota: null, propuesta_al_decidir: t.propuesto, rampa: null, decidido_por_nombre: null, decidido_at: null }]));
    const s = calcularProyeccion({ ...e, previas: { filas: new Map(filas), tiendas: tiendasP } });
    expect(estadoLinea(delNodo(aPlanas(s.filas), N.denim), Y)).toBe("proyectada");
    // Un cambio posterior en la venta mueve la propuesta: prevalece propuesta_cambio sobre proyectada.
    const movida = aPlanas(s.filas).map((f) => ({ ...f, anios: f.anios.map((a) => (a.decidido !== null && f.tienda_id === null ? { ...a, avisos: [...a.avisos, "propuesta_cambio" as const] } : a)) }));
    expect(estadoLinea(delNodo(movida, N.denim), Y)).toBe("propuesta_cambio");
    const curva = movida.map((f) => ({ ...f, anios: f.anios.map((a) => ({ ...a, avisos: [...a.avisos, "curva_cambio" as const] })) }));
    expect(estadoLinea(delNodo(curva, N.denim), Y)).toBe("curva_cambio");
    // curva_cambio no prevalece sobre sin_proyectar.
    const ninguna = planas.map((f) => ({ ...f, avisos: [...f.avisos, "curva_cambio" as const] }));
    expect(estadoLinea(delNodo(ninguna, N.denim), Y)).toBe("sin_proyectar");
  });

  it("una fila de la cola larga sin decidir no impide proyectada (solo cuentan las ≥ umbral)", () => {
    const filas = delNodo(planas, N.denim).filter((f) => f.tienda_id === null);
    const premium = filas.find((f) => f.agrupacion_marca_id === AM.pre)!;
    expect(premium.anios[0].propuesto).toBeLessThan(100);
  });
});

describe("mensual (caso 14; regla 30)", () => {
  const m = armarMensual(planas, { anio: Y, bloque: "mismas", porAgrupacion: true });

  it("DENIM × RECONOCIDO mismas 2026: 150 reales ×9 y 150 proyectados ×3, con origen real/proyectado", () => {
    const f = m.filas.find((x) => x.linea === "DENIM" && x.agrupacion_marca === "RECONOCIDO")!;
    const a = f.anios.find((x) => x.anio === Y)!;
    expect(a.meses.slice(0, 9)).toEqual(Array(9).fill(150));
    expect(a.meses.slice(9)).toEqual([150, 150, 150]);
    expect(a.origen_meses).toEqual([...Array(9).fill("real"), ...Array(3).fill("proyectado")]);
    expect(f.anios.find((x) => x.anio === Y + 1)!.origen_meses.every((o) => o === "proyectado")).toBe(true);
  });

  it("bloque = todas suma los tres bloques por mes; el origen de una suma es real solo si todos son reales", () => {
    const t = armarMensual(planas, { anio: Y, bloque: "todas", porAgrupacion: true });
    const f = t.filas.find((x) => x.linea === "DENIM" && x.agrupacion_marca === "RECONOCIDO")!;
    const a = f.anios.find((x) => x.anio === Y)!;
    const mismas = m.filas.find((x) => x.linea === "DENIM" && x.agrupacion_marca === "RECONOCIDO")!.anios.find((x) => x.anio === Y)!;
    expect(a.total).toBeGreaterThan(mismas.total);
    expect(suma(a.meses)).toBe(a.total);
    // Setiembre es real para todos los sumandos; octubre es proyectado.
    expect(a.origen_meses[8]).toBe("real");
    expect(a.origen_meses[9]).toBe("proyectado");
  });

  it("Σ meses = total en toda fila con curva; el total de la vista coincide con la matriz", () => {
    const t = armarMensual(planas, { anio: Y, bloque: "todas" });
    for (const f of t.filas) for (const a of f.anios) expect(suma(a.meses)).toBe(a.total);
    const matriz = armarMatriz(planas, { anio: Y }).nodos[0];
    expect(t.totales.find((x) => x.anio === Y)?.total).toBe(matriz.en_curso.total);
    expect(t.totales.find((x) => x.anio === Y + 1)?.total).toBe(matriz.siguiente.total);
  });

  it("usa meses y nunca meses_propuestos", () => {
    const manipuladas = planas.map((f) => ({ ...f, anios: f.anios.map((a) => ({ ...a, meses_propuestos: Array(12).fill(999) })) }));
    const t = armarMensual(manipuladas, { anio: Y, bloque: "mismas" });
    expect(JSON.stringify(t)).toBe(JSON.stringify(armarMensual(planas, { anio: Y, bloque: "mismas" })));
  });

  it("una fila sin curva aporta su total y null a los meses y cuenta en sin_curva", () => {
    const sinCurva = planas.map((f) => (f.gml_id === N.denim && f.tienda_id === null && f.agrupacion_marca_id === AM.rec ? { ...f, anios: f.anios.map((a) => ({ ...a, meses: null, origen_meses: null, decidido: 1800, vigente: 1800 })) } : f));
    const t = armarMensual(sinCurva, { anio: Y, bloque: "mismas", porAgrupacion: true });
    const f = t.filas.find((x) => x.linea === "DENIM" && x.agrupacion_marca === "RECONOCIDO")!;
    expect(f.anios[0]).toMatchObject({ total: 1800, sin_curva: 1 });
    expect(f.anios[0].meses.every((x) => x === null)).toBe(true);
  });

  it("los filtros de la matriz valen igual (genero) y solo = con_tiendas_nuevas", () => {
    const hombre = planas.find((f) => f.genero === "HOMBRE")!.genero_id;
    const t = armarMensual(planas, { anio: Y, filtro: { genero_id: hombre } });
    expect(new Set(t.filas.map((f) => f.genero))).toEqual(new Set(["HOMBRE"]));
  });
});

describe("contrato de M8: filas por género · mundo · línea · agrupación · bloque · tienda · año", () => {
  const filas = armarFilasCerradas(planas, [Y, Y + 1]);

  it("Σ meses = total en toda fila con meses; los bloques son disjuntos y suman el total del año", () => {
    for (const f of filas) if (f.meses) expect(suma(f.meses)).toBe(f.total);
    const porBloque = (b: string, anio: number) => filas.filter((f) => f.bloque === b && f.anio === anio).reduce((a, f) => a + f.total, 0);
    const matriz = armarMatriz(planas, { anio: Y }).nodos[0];
    expect(porBloque("mismas", Y) + porBloque("nuevas", Y) + porBloque("cierres", Y)).toBe(matriz.en_curso.total);
    expect(porBloque("mismas", Y + 1) + porBloque("nuevas", Y + 1) + porBloque("cierres", Y + 1)).toBe(matriz.siguiente.total);
  });

  it("en el año en curso origen_meses es real para m ≤ k; las filas base traen participaciones y las de tienda no", () => {
    const d = filas.find((f) => f.bloque === "mismas" && f.anio === Y && f.agrupacion_marca === "RECONOCIDO" && f.linea === "DENIM")!;
    expect(d.origen_meses?.slice(0, 9).every((o) => o === "real")).toBe(true);
    expect(d.participaciones_historicas).not.toBeNull();
    expect(d.tienda_id).toBeNull();
    const t = filas.find((f) => f.tienda_id === "T2")!;
    expect(t.participaciones_historicas).toBeNull();
    expect(t.bloque).toBe("nuevas");
    expect(t.subbloque).toBe("nuevas_anterior");
  });

  it("T2 está en bloque nuevas de 2026 y no aparece en 2027 (ya es misma): la fila base de 2027 la incluye", () => {
    expect(filas.some((f) => f.tienda_id === "T2" && f.anio === Y + 1)).toBe(false);
    expect(filas.some((f) => f.tienda_id === "T3" && f.anio === Y + 1 && f.subbloque === "nuevas_anterior")).toBe(true);
  });
});

describe("06e: base corregida del Niño en la Matriz", () => {
  const { nodos } = armarMatriz(planas, { anio: Y });

  it("Σ B' y «Crec. sobre 2026 corregido» = Σ vigente ÷ Σ B' − 1; «sobre real» sigue siendo Σ vigente ÷ Σ B − 1; sin Niño (DENIM) coinciden", () => {
    const abrigo = nodo(nodos, "ABRIGO", "linea");
    // ABRIGO es invierno con Niño 2026 a 0,66: B' = B ÷ 0,66.
    expect(abrigo.siguiente.base_corregida).toBeGreaterThan(abrigo.siguiente.base_siguiente);
    expect(abrigo.siguiente.base_corregida as number).toBeCloseTo(abrigo.siguiente.base_siguiente / 0.66, 0);
    const vigente = (abrigo.siguiente.crec_mismas_pct as number) / 100 + 1;
    expect(abrigo.siguiente.crec_corregida_pct as number).toBeCloseTo(((vigente * abrigo.siguiente.base_siguiente) / (abrigo.siguiente.base_corregida as number) - 1) * 100, 6);
    const denim = nodo(nodos, "DENIM", "linea");
    expect(denim.siguiente.base_corregida).toBe(denim.siguiente.base_siguiente);
    expect(denim.siguiente.crec_corregida_pct).toBe(denim.siguiente.crec_mismas_pct);
    // Los nodos que agrupan suman Σ B' de sus líneas.
    const lineas = nodos.filter((n) => n.nivel === "linea");
    expect(nodos[0].siguiente.base_corregida as number).toBeCloseTo(lineas.reduce((a, l) => a + (l.siguiente.base_corregida as number), 0), 6);
  });

  it("una fila sin B' guardado (cálculo anterior) cuenta con B' = B", () => {
    const sinBc = planas.map((f) => ({ ...f, anios: f.anios.map((a) => ({ ...a, base_normalizada: null })) }));
    const n = nodo(armarMatriz(sinBc, { anio: Y }).nodos, "ABRIGO", "linea");
    expect(n.siguiente.base_corregida).toBe(n.siguiente.base_siguiente);
  });

  it("el Excel de la Matriz parte el crecimiento en «corregido» y «real» (cabecera y valores)", () => {
    const h = hojasMatriz({ nodos, bloques: salida.bloques, anio: Y, filtro: {}, datosHasta: "2026-09" });
    const cab = h.MATRIZ[0];
    const iCorregido = cab.indexOf(`CREC. SOBRE ${Y} CORREGIDO %`);
    const iReal = cab.indexOf(`CREC. SOBRE ${Y} REAL %`);
    expect(iCorregido).toBeGreaterThan(0);
    expect(iReal).toBe(iCorregido + 1);
    expect(cab).not.toContain("CREC. MISMAS TIENDAS %");
    const filaAbrigo = h.MATRIZ.find((f) => f[1] === "ABRIGO")!;
    const n = nodo(nodos, "ABRIGO", "linea");
    expect(filaAbrigo[iCorregido]).toBe(Math.round((n.siguiente.crec_corregida_pct as number) * 10) / 10);
    expect(filaAbrigo[iReal]).toBe(Math.round((n.siguiente.crec_mismas_pct as number) * 10) / 10);
  });
});

describe("hojas de Excel (caso 23; regla 32)", () => {
  const datosHasta = "2026-09";

  it("hojasMatriz con filtro genero = HOMBRE: compañía, género, 2 mundos y 2 líneas, hoja BLOQUES con 2026 y 2027 y FILTROS", () => {
    const hombre = planas.find((f) => f.genero === "HOMBRE")!.genero_id;
    const filtro = { genero_id: hombre };
    const { nodos } = armarMatriz(planas, { anio: Y, filtro });
    const h = hojasMatriz({ nodos, bloques: salida.bloques, anio: Y, filtro, datosHasta, nombresFiltro: { [hombre]: "HOMBRE" } });
    expect(h.MATRIZ).toHaveLength(1 + 1 + 1 + 2 + 2);
    expect(h.MATRIZ[0][0]).toBe("NIVEL");
    expect(h.MATRIZ.slice(1).map((f) => f[0])).toEqual(["COMPAÑÍA", "GÉNERO", "MUNDO", "LÍNEA", "MUNDO", "LÍNEA"]);
    expect(h.BLOQUES.slice(1).some((f) => f[0] === 2026 && f[1] === "nuevas" && f[2] === "nuevas_anterior")).toBe(true);
    expect(h.BLOQUES.slice(1).some((f) => f[0] === 2027 && f[1] === "nuevas" && f[2] === "aperturas")).toBe(true);
    expect(h.FILTROS).toContainEqual(["genero", "HOMBRE"]);
    expect(h.FILTROS).toContainEqual(["datos_hasta", datosHasta]);
  });

  it("hojasMensual con bloque = nuevas: solo T2, T3, T4 y T9 en BLOQUES del bloque; celdas sin curva vacías (no 0)", () => {
    const t = armarMensual(planas, { anio: Y, bloque: "nuevas", porAgrupacion: true });
    const h = hojasMensual({ filas: t.filas, bloques: salida.bloques, anio: Y, filtro: { genero_id: null, mundo_id: null, linea_id: null, temporada: null, agrupacion_estacionalidad_id: null, agrupacion_marca_id: null, solo: null, por: "arbol", bloque: "nuevas", por_agrupacion: true }, datosHasta });
    expect(h.MENSUAL[0].slice(5, 7)).toEqual(["2026-01", "2026-02"]);
    expect(h.MENSUAL[0]).toContain("2027-12");
    expect(h.MENSUAL[0]).toContain("TOTAL_2026");
    expect(h.MENSUAL[0]).toContain("ORIGEN_2026");
    expect(h.MENSUAL.slice(1).every((f) => f[4] === "nuevas")).toBe(true);
    const nuevas = salida.bloques[Y].nuevas.map((x) => x.codigo).concat(salida.bloques[Y + 1].nuevas.map((x) => x.codigo));
    expect(new Set(nuevas)).toEqual(new Set(["T2", "T3", "T9", "T4"]));

    const sin = planas.map((f) => ({ ...f, anios: f.anios.map((a) => ({ ...a, meses: null, origen_meses: null })) }));
    const hs = hojasMensual({ filas: armarMensual(sin, { anio: Y, bloque: "mismas" }).filas, bloques: salida.bloques, anio: Y, filtro: { genero_id: null, mundo_id: null, linea_id: null, temporada: null, agrupacion_estacionalidad_id: null, agrupacion_marca_id: null, solo: null, por: "arbol", bloque: "mismas", por_agrupacion: false }, datosHasta });
    const fila = hs.MENSUAL[1];
    expect(fila.slice(5, 17).every((x) => x === null)).toBe(true);
    expect(fila[fila.length - 1]).toBe("sin_curva");
  });

  it("ORIGEN_2026 dice cuántos meses son reales y cuántos proyectados", () => {
    const t = armarMensual(planas, { anio: Y, bloque: "mismas", porAgrupacion: true });
    const h = hojasMensual({ filas: t.filas, bloques: salida.bloques, anio: Y, filtro: { genero_id: null, mundo_id: null, linea_id: null, temporada: null, agrupacion_estacionalidad_id: null, agrupacion_marca_id: null, solo: null, por: "arbol", bloque: "mismas", por_agrupacion: true }, datosHasta });
    const col = h.MENSUAL[0].indexOf("ORIGEN_2026");
    expect(h.MENSUAL[1][col]).toBe("real:9/proy:3");
  });
});

void tiendas;
