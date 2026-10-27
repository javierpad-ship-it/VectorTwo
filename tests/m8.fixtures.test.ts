import { describe, expect, it } from "vitest";
import { pendientesPorEntrega } from "@/lib/compras/pendientes";
import { importarComprasSchema, recibirSchema } from "@/lib/compras/esquemas";
import { CARACTER_SENAL, senalDeCaracter, SENALES } from "@/lib/flujo/tipos-api";
import {
  compraApiC09Vencida,
  compraApiC12,
  compraApiC12Parcial,
  compraApiC12SaldoCerrado,
  compraApiC20Lote,
  compraApiCancelada,
  comprasApiEjemplo,
  filasImportacionEjemplo,
  registrosEjemplo,
  reporteImportacionEjemplo,
} from "./compras.fixture";
import {
  DEMANDA_DENIM,
  calcularSerieReferencia,
  conciliacionEjemplo,
  conciliarFilaReferencia,
  construirFlujo,
  filaCamisaJhEjemplo,
  filaDenimEjemplo,
  flujoEjemplo,
  huecosEjemplo,
  sumarMes,
} from "./flujo.fixture";

/**
 * Los fixtures de T0 son la base de T2a, T2b y T3a: estas pruebas fijan que reproducen las cifras de la ficha 08 (casos 1, 2, 3, 8, 9b,
 * 25 y 26) y que los objetos de API no se contradicen con sus registros.
 */

describe("aritmética de referencia (sección 3 y casos 1–3)", () => {
  const sinCompras = calcularSerieReferencia({ stock_k: 700, demanda: DEMANDA_DENIM });
  const conC12 = calcularSerieReferencia({ stock_k: 700, demanda: DEMANDA_DENIM, ingresos: DEMANDA_DENIM.map((_, i) => (i === 1 ? 500 : 0)) });

  it("VPM e IMI de set: 157,5 y 4,44", () => {
    expect(sinCompras.vpm_k).toBeCloseTo(157.5, 6);
    expect(sinCompras.imi_k).toBeCloseTo(4.4444, 3);
  });

  it("sin compras: S_oct = 550, VPM_oct = 158,33, imi_oct = 3,47, C_oct = 83,33 y C_nov = 153,33", () => {
    expect(sinCompras.stock[0]).toBe(550);
    expect(sinCompras.vpm[0]).toBeCloseTo(158.3333, 3);
    expect(sinCompras.imi[0]).toBeCloseTo(3.4737, 3);
    expect(sinCompras.saldo[0]).toBeCloseTo(83.3333, 3);
    expect(sinCompras.saldo[1]).toBeCloseTo(153.3333, 3);
    expect(sinCompras.senal[0]).toBe("falta");
  });

  it("con C-000012 (500 en nov): S_nov = 900, imi 5,65, C_nov = C_dic = C_ene = 0, C_feb = 134,33, C_mar = 160", () => {
    expect(conC12.stock[1]).toBe(900);
    expect(conC12.imi[1]).toBeCloseTo(5.6544, 3);
    expect(conC12.saldo.slice(0, 6).map((x) => Math.round(x * 100) / 100)).toEqual([83.33, 0, 0, 0, 134.33, 160]);
    expect(conC12.saldo.slice(0, 6).reduce((a, b) => a + b, 0)).toBeCloseTo(377.67, 2);
    expect(conC12.imi[3]).toBeCloseTo(3.6437, 3);
    expect(conC12.fuera_de_rango[3]).toBe(true);
    expect(conC12.senal[3]).toBe("al_dia");
  });

  it("2 000 u en nov: X_nov = 1 127 e imi 15,1 (caso 3)", () => {
    const r = calcularSerieReferencia({ stock_k: 700, demanda: DEMANDA_DENIM, ingresos: DEMANDA_DENIM.map((_, i) => (i === 1 ? 2000 : 0)) });
    expect(r.exceso[1]).toBeCloseTo(1126.67, 1);
    expect(r.imi[1]).toBeCloseTo(15.08, 1);
    expect(r.senal[1]).toBe("exceso");
  });

  it("demanda toda cero: sin_demanda e IMI nulo; stock negativo: quiebre", () => {
    const r = calcularSerieReferencia({ stock_k: 50, demanda: [0, 0, 0] });
    expect(r.senal).toEqual(["sin_demanda", "sin_demanda", "sin_demanda"]);
    expect(r.imi).toEqual([null, null, null]);
    const q = calcularSerieReferencia({ stock_k: 100, demanda: [150, 150] });
    expect(q.stock[0]).toBe(-50);
    expect(q.senal[0]).toBe("quiebre");
    expect(q.imi[0]).toBe(0);
  });

  it("más allá del horizonte se repiten los últimos doce meses (extendido)", () => {
    expect(sinCompras.extendido.slice(-1)[0]).toBe(true);
    expect(sinCompras.extendido[0]).toBe(false);
  });
});

describe("filas de la ficha", () => {
  it("DENIM × RECONOCIDO: tarjeta 378 u, IMI 4,4, primer mes con falta oct-2026 y 16 meses con k'", () => {
    const f = filaDenimEjemplo();
    expect(f.meses).toHaveLength(DEMANDA_DENIM.length + 1);
    expect(f.meses[0]).toMatchObject({ periodo: "2026-09", real: true, demanda: 1410, ingreso_inferido: 120, stock_fin: 700 });
    expect(f.resumen).toMatchObject({ saldo_n_meses: 378, imi_k: 4.4, vpm_k: 157.5, primer_mes_falta: "2026-10", primer_mes_fuera_de_rango: "2026-10", en_camino: 500, senal: "falta" });
    expect(f.meses[2]).toMatchObject({ periodo: "2026-11", ingresos: 500, stock_fin: 900, imi: 5.7 });
    expect(f.historia).toHaveLength(12);
    expect(f.historia[11]).toMatchObject({ periodo: "2026-09", venta: 1410, stock_fin: 700, ingreso_inferido: 120 });
    expect(f.historia[10]).toMatchObject({ periodo: "2026-08", stock_fin: 1990 });
  });

  it("conciliación de DENIM en set: Ing = 120 sin registrar, con aviso", () => {
    const set = filaDenimEjemplo().conciliacion.at(-1)!;
    expect(set).toMatchObject({ periodo: "2026-09", ingreso_inferido: 120, sin_registrar: 120, sin_respaldo: 0 });
    expect(set.avisos).toEqual(["ingreso_sin_registrar"]);
    expect(filaDenimEjemplo().conciliacion[0].avisos).toContain("sin_mes_anterior");
  });

  it("CAMISA con JH (casos 8 y 25): R = 384, S_JH = 804, imi_JH 1,7, C_JH = 1 116 y la fila baja 816 por mes", () => {
    const f = filaCamisaJhEjemplo();
    const jh = f.subflujos[0];
    expect(jh.meses[1]).toMatchObject({ reposicion_esperada: 384, stock_fin: 804, saldo: 1116, senal: "falta" });
    expect(jh.meses[0].imi).toBe(1.9);
    expect(jh.meses[1].imi).toBe(1.7);
    expect(jh.pct_directo_observado).toEqual({ periodo: "2026-09", valor: 80 });
    expect(f.resto!.meses[1].stock_fin).toBe(680);
    expect(f.meses[1].stock_fin).toBe(1484);
    expect(f.meses[1].stock_fin).toBe(f.resto!.meses[1].stock_fin + jh.meses[1].stock_fin);
    expect(f.meses[1].stock_fin - f.meses[0].stock_fin).toBe(-816);
    expect(f.meses[2].stock_fin - f.meses[1].stock_fin).toBe(-816);
    expect(f.meses[1].saldo).toBe(f.resto!.meses[1].saldo + jh.meses[1].saldo);
    expect(f.subflujos_resumen[0]).toMatchObject({ marca: "JOHN HOLDEN", senal: "falta", rango: [4, 8] });
  });
});

describe("conciliación (caso 9b y regla 4b)", () => {
  it("Ing = S_m − S_{m−1} + V_m y los umbrales de 10 u y 20 %", () => {
    const base = { gml_id: "g", equivalencia_id: null, agrupacion_marca_id: "a", ruta: "R", agrupacion_marca: "A", periodo: "2026-09", venta: 1410, stock_inicio: 1990, stock_fin: 700 };
    expect(conciliarFilaReferencia({ ...base, recepciones: 100 })).toMatchObject({ ingreso_inferido: 120, sin_registrar: 20, avisos: [] });
    expect(conciliarFilaReferencia({ ...base, recepciones: 0 }).avisos).toEqual(["ingreso_sin_registrar"]);
    expect(conciliarFilaReferencia({ ...base, venta: 820, stock_inicio: 2300, stock_fin: 1950, recepciones: 950 })).toMatchObject({ ingreso_inferido: 470, sin_respaldo: 480 });
    expect(conciliarFilaReferencia({ ...base, venta: 100, stock_inicio: 500, stock_fin: 360, recepciones: 0 })).toMatchObject({ ingreso_inferido: 0, salida_inferida: 40, avisos: ["salida_neta"] });
    expect(conciliarFilaReferencia({ ...base, stock_inicio: null, recepciones: 0 }).avisos).toEqual(["sin_mes_anterior"]);
  });

  it("la conciliación de set trae la sugerencia de 500 u de C-000009 y el % directo observado de JH en puntos", () => {
    const c = conciliacionEjemplo();
    expect(c.periodo).toBe("2026-09");
    const polo = c.filas.find((f) => f.agrupacion_marca === "PREMIUM")!;
    expect(polo).toMatchObject({ ingreso_inferido: 800, recepciones_registradas: 300, sin_registrar: 500, entregas_programadas: 500 });
    expect(polo.sugerencias).toHaveLength(1);
    expect(polo.sugerencias[0]).toMatchObject({ tipo: "vencida", compra_numero: "C-000009", unidades: 500, boton: true });
    const camisa = c.filas.find((f) => f.ruta.includes("MANGA LARGA") && f.marca_id === null)!;
    expect(camisa).toMatchObject({ sin_respaldo: 100, avisos: ["recepcion_sin_respaldo"] });
    const jh = c.filas.find((f) => f.marca === "JOHN HOLDEN")!;
    expect(jh).toMatchObject({ ingreso_inferido: 384, pct_directo_regla: 80 });
    expect(jh.pct_directo_observado).toEqual({ periodo: "2026-09", valor: 80 });
    expect(c.totales.ingreso_inferido).toBe(120 + 800 + 850);
  });
});

describe("compras: objetos de API desde registros", () => {
  it("todas las compras tienen totales y entregas coherentes con sus pendientes", () => {
    for (const c of comprasApiEjemplo()) {
      for (const l of c.lineas) {
        const sumaEntregas = l.entregas.reduce((a, e) => a + e.unidades, 0);
        expect(sumaEntregas, `${c.numero} entregas`).toBe(l.unidades);
        const pend = l.entregas.reduce((a, e) => a + e.pendiente, 0);
        expect(pend, `${c.numero} pendiente`).toBe(l.unidades - l.unidades_recibidas - l.unidades_canceladas);
        for (const e of l.entregas) expect(e.asignadas + e.canceladas + e.pendiente).toBe(e.unidades);
        expect(l.llegada_periodo).toBe(l.entregas[0].periodo);
      }
      expect(c.totales.unidades).toBe(c.lineas.reduce((a, l) => a + l.unidades, 0));
    }
  });

  it("C-000012: confirmada, 500 u a S/ 38 = S/ 19 000, una entrega en nov, sin recepciones", () => {
    const c = compraApiC12();
    expect(c).toMatchObject({ numero: "C-000012", estado: "confirmada", saldo_cerrado: false, totales: { unidades: 500, costo: 19000, recibidas: 0 } });
    expect(c.proveedor.nombre).toBe("Proveedor Norte");
    expect(c.llegadas).toEqual({ desde: "2026-11", hasta: "2026-11", entregas: 1 });
    expect(c.puede).toMatchObject({ recibir: true, cancelar: true });
  });

  it("FIFO: nov 300 · dic 200 con 100 recibidas en oct deja 200 y 200 pendientes", () => {
    const l = compraApiC12Parcial().lineas[0];
    expect(l.entregas.map((e) => e.pendiente)).toEqual([200, 200]);
    expect(l.unidades_recibidas).toBe(100);
    expect(l.recepciones[0]).toMatchObject({ recibida_periodo: "2026-10", unidades: 100 });
  });

  it("saldo cerrado (caso 26): recibida, 200 canceladas, pendiente 0, ingreso en ago con aviso de mes cerrado", () => {
    const c = compraApiC12SaldoCerrado();
    expect(c).toMatchObject({ estado: "recibida", saldo_cerrado: true });
    expect(c.cancelada_por?.motivo).toBeTruthy();
    expect(c.lineas[0].unidades_canceladas).toBe(200);
    expect(c.lineas[0].entregas.reduce((a, e) => a + e.pendiente, 0)).toBe(0);
    expect(c.lineas[0].recepciones.find((r) => r.recibida_periodo === "2026-08")?.avisos).toEqual(["recepcion_en_mes_cerrado"]);
    expect(c.puede.recibir).toBe(true);
    expect(c.historial.map((h) => h.accion)).toEqual(["importar", "recibir", "quitar_recepcion", "recibir", "cancelar"]);
  });

  it("C-000009: entrega de set vencida con sugerencia de 500 u en set y aviso entrega_vencida", () => {
    const c = compraApiC09Vencida();
    expect(c.lineas[0].entregas[0]).toMatchObject({ vencida: true, pendiente: 500, sugerencia: { periodo: "2026-09", unidades: 500 } });
    expect(c.avisos).toEqual(["entrega_vencida"]);
  });

  it("C-000020: lote de BETA con reparto v2 por entrega que suma 590 / 292 / 118 (±redondeo por entrega)", () => {
    const l = compraApiC20Lote().lineas[0];
    expect(l.tipo).toBe("barrer_marca");
    expect(l.reparto?.version).toBe(2);
    expect(l.reparto?.por_entrega).toHaveLength(3);
    for (const [i, e] of l.entregas.entries()) {
      expect(l.reparto!.por_entrega[i].filas.reduce((a, f) => a + f.unidades, 0)).toBe(e.unidades);
      expect(e.temporada).toBe("verano");
    }
    expect(l.reparto!.filas.reduce((a, f) => a + f.unidades, 0)).toBe(1000);
    expect(l.reparto!.filas.map((f) => f.unidades)).toEqual([590, 292, 118]);
  });

  it("una compra cancelada sin recepciones no se puede editar para recibir", () => {
    const c = compraApiCancelada();
    expect(c).toMatchObject({ estado: "cancelada", saldo_cerrado: false });
    expect(c.puede).toMatchObject({ editar: false, recibir: false, cancelar: false });
  });

  it("los registros del ejemplo calculan los mismos pendientes que la API", () => {
    const reg = registrosEjemplo();
    for (const l of reg.lineas) {
      const p = pendientesPorEntrega(l, reg.entregas.filter((e) => e.linea_id === l.id), reg.recepciones.filter((x) => x.linea_id === l.id));
      expect(p.recibidas).toBe(l.unidades_recibidas);
      expect(p.sin_asignar).toBe(0);
    }
  });
});

describe("importador (caso 13)", () => {
  it("las filas de ejemplo pasan el esquema y el reporte cuadra: 3 nuevas, 3 omitidas, proveedor nuevo", () => {
    expect(importarComprasSchema.safeParse({ modo: "previsualizar", carga_inicial: true, filas: filasImportacionEjemplo() }).success).toBe(true);
    const r = reporteImportacionEjemplo();
    expect(r.totales).toMatchObject({ recibidas: 6, procesadas: 3, omitidas: 3, nuevas: 3 });
    expect(r.omitidas.map((o) => o.motivo)).toEqual(["marca_y_agrupacion", "entregas_invalidas", "tipo_no_disponible"]);
    expect(r.proveedores_a_crear).toEqual(["Feria Sur"]);
    expect(r.lineas).toHaveLength(r.totales.procesadas);
    expect(r.compras_a_crear.reduce((a, c) => a + c.lineas_nuevas, 0)).toBe(r.totales.nuevas);
    expect(reporteImportacionEjemplo("aplicar").aplicadas).toHaveLength(2);
  });

  it("una recepción de la plantilla coincide con el esquema de recibir", () => {
    expect(recibirSchema.safeParse({ revision: 0, recepciones: [{ linea_id: "a0000000-0000-4000-8000-000000000001", recibida_periodo: "2026-09", unidades: 500, fecha_recepcion: "2026-09-30" }] }).success).toBe(true);
  });
});

describe("flujo de ejemplo y señales", () => {
  it("la lista de ejemplo lleva DENIM y CAMISA al principio, con el catálogo resolviendo sus nombres", () => {
    const f = flujoEjemplo();
    expect(f.datos.periodos).toHaveLength(16);
    expect(f.datos.periodos[0]).toBe("2026-09");
    expect(f.datos.periodos[15]).toBe("2027-12");
    expect(f.filas[0].serie.stock[2]).toBe(900);
    expect(f.catalogo.nodos[f.filas[0].gml_id]).toMatchObject({ genero: "HOMBRE", mundo: "URBANO", linea: "DENIM" });
    expect(f.catalogo.nodos[f.filas[1].equivalencia_id!]).toMatchObject({ linea: "CAMISA", equivalencia: "MANGA LARGA", nivel: "GMLE" });
    expect(f.filas[1].serie.reposicion?.[1]).toBe(384);
    for (const fila of f.filas) {
      expect(f.catalogo.nodos[fila.equivalencia_id ?? fila.gml_id]).toBeDefined();
      expect(f.catalogo.agrupaciones[fila.agrupacion_marca_id]).toBeDefined();
    }
  });

  it("los totales no cuentan las filas sin curva y la cabecera las resume", () => {
    const f = construirFlujo({ filas: 200, horizonte: 15 });
    expect(f.datos.filas_sin_curva.filas).toBeGreaterThan(0);
    expect(f.filas.filter((x) => x.resumen.senal === "sin_curva")).toHaveLength(f.datos.filas_sin_curva.filas);
    const sinCurva = f.filas.filter((x) => x.resumen.senal === "sin_curva").reduce((a, x) => a + x.stock_k.total, 0);
    const todas = f.filas.reduce((a, x) => a + x.stock_k.total, 0);
    expect(f.totales.stock[0]).toBe(todas - sinCurva);
  });

  it("Huecos viene ordenado por saldo descendente y con el detalle de la tarjeta", () => {
    const h = huecosEjemplo();
    const saldos = h.tarjetas.map((t) => t.resumen.saldo_n_meses);
    expect(saldos).toEqual([...saldos].sort((a, b) => b - a));
    const denim = h.tarjetas.find((t) => t.linea === "DENIM")!;
    expect(denim).toMatchObject({ genero: "HOMBRE", mundo: "URBANO", agrupacion_marca: "RECONOCIDO" });
    expect(denim.detalle).toMatchObject({ saldo_primer_mes: 83, en_camino_primer_mes: { periodo: "2026-11", unidades: 500 }, falta_desde: "2027-02" });
    expect(denim.responsable?.nombre).toBe("Comprador Uno");
  });

  it("los caracteres de señal son únicos y se decodifican", () => {
    const chars = SENALES.map((s) => CARACTER_SENAL[s]);
    expect(new Set(chars).size).toBe(SENALES.length);
    for (const s of SENALES) expect(senalDeCaracter(CARACTER_SENAL[s])).toBe(s);
    expect(senalDeCaracter("-")).toBeNull();
  });

  it("sumarMes cruza el fin de año", () => {
    expect(sumarMes("2026-11", 3)).toBe("2027-02");
    expect(sumarMes("2026-01", -1)).toBe("2025-12");
  });
});
