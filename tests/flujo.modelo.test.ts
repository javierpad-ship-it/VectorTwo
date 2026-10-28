import { describe, expect, it } from "vitest";
import { claveDeFila, mesesEntre } from "@/lib/flujo/filas";
import {
  aFilaDetalleApi,
  aFilaFlujoApi,
  aFilaListaApi,
  aSerieFlujoApi,
  armarHuecosApi,
  aTotalesApi,
  armarConciliacionApi,
  calcularFlujo,
  resumenTarjeta,
  rutaDe,
  type EntradaCalculoFlujo,
  type FilaCalculada,
  type NombresFlujo,
  type ResultadoFlujo,
} from "@/lib/flujo/modelo";
import type { RecepcionRegistro } from "@/lib/compras/tipos";
import {
  AGR_M8,
  EQ,
  LINEA,
  MARCA_M8,
  NODO_M8,
  registrosC09,
  registrosC12,
  registrosC15CargaInicial,
  type RegistrosCompra,
} from "./compras.fixture";
import { VENTAS_DENIM_12M, construirFlujo, filaCamisaJhEjemplo, filaDenimEjemplo } from "./flujo.fixture";
import { GEN, MUN } from "./intercompany.fixture";
import { DEMANDA_CASO1, REGLA_JH, cerradaDeFila, claveCamisaLarga, claveDenim, entrada, mapaDeStock, participaciones, stockMes, unirCompras } from "./flujo.soporte";
import type { SemillaStock } from "./flujo.soporte";

/**
 * `calcularFlujo` (reglas 1, 2, 8, 26, 28 y 29 de la ficha 08; casos 1, 2, 3, 8, 9, 9b, 10, 16, 24, 25 y 27). Los números de la ficha
 * (IMI set 4,44; C_oct 83,33; C_feb 134,33; X_nov 1 127; CAMISA 1 484 = 680 + 804) se comprueban contra el cálculo completo y contra
 * las cifras del fixture de T0.
 */

const cerca = (a: number | null, b: number, d = 1e-6) => expect(Math.abs((a as number) - b)).toBeLessThan(d);

// ─── Entradas de los casos ───

const DENIM = { gml: NODO_M8.urbano, agr: AGR_M8.reconocido };
const POLO_PREMIUM = { gml: NODO_M8.polo, agr: AGR_M8.premium };
const CAMISA = { gml: NODO_M8.camisa, eq: EQ.larga, agr: AGR_M8.reconocido };

const cerradaDenim = () => cerradaDeFila({ ...DENIM, demanda: DEMANDA_CASO1 });

/** El stock de DENIM × RECONOCIDO de `k'−12 … k'` con las cifras de la historia del fixture (CD 300 + tiendas 400 en set). */
function stockDenim(extra: SemillaStock[] = []) {
  const hist = filaDenimEjemplo().historia;
  const previo = hist[0].stock_fin - (hist[0].ingreso_inferido as number) + hist[0].venta;
  const meses = [stockMes("2025-09", [{ ...DENIM, cd: previo, tiendas: 0, venta: 0 }])];
  for (const h of hist) {
    const esK = h.periodo === "2026-09";
    meses.push(stockMes(h.periodo, [{ ...DENIM, cd: esK ? 300 : h.stock_fin, tiendas: esK ? 400 : 0, venta: h.venta, marcas: { [MARCA_M8.alfa]: { cd: esK ? 300 : h.stock_fin, tiendas: esK ? 400 : 0, venta: h.venta } } }, ...(esK ? extra : [])]));
  }
  return mapaDeStock(...meses);
}

const calcular = (op: Partial<EntradaCalculoFlujo> = {}): ResultadoFlujo => calcularFlujo(entrada({ cerrada: { filas: cerradaDenim(), version_metodo: 4, huella_flujo: "h", periodo_referencia: { desde: "2025-10", hasta: "2026-09" } }, stock: stockDenim(), ...op }));
const filaDe = (res: ResultadoFlujo, clave: string): FilaCalculada => {
  const f = res.filas.find((x) => x.clave === clave);
  if (!f) throw new Error(`falta la fila ${clave}`);
  return f;
};

const NOMBRES: NombresFlujo = {
  nodos: {
    [NODO_M8.urbano]: { genero_id: GEN.hombre, mundo_id: MUN.urbano, genero: "HOMBRE", mundo: "URBANO", linea: "DENIM", equivalencia: null, nivel: "GML" },
    [EQ.larga]: { genero_id: GEN.hombre, mundo_id: MUN.formal, genero: "HOMBRE", mundo: "FORMAL", linea: "CAMISA", equivalencia: "MANGA LARGA", nivel: "GMLE" },
    [NODO_M8.polo]: { genero_id: GEN.hombre, mundo_id: MUN.casual, genero: "HOMBRE", mundo: "CASUAL", linea: "POLO", equivalencia: null, nivel: "GML" },
    [NODO_M8.sandalia]: { genero_id: GEN.mujer, mundo_id: MUN.casual, genero: "MUJER", mundo: "CASUAL", linea: "SANDALIA", equivalencia: null, nivel: "GML" },
  },
  agrupaciones: { [AGR_M8.reconocido]: "RECONOCIDO", [AGR_M8.premium]: "PREMIUM", [AGR_M8.valor]: "VALOR" },
  responsables: {},
  marcas: { [MARCA_M8.alfa]: "ALFA", [MARCA_M8.beta]: "BETA", [MARCA_M8.jh]: "JOHN HOLDEN" },
};

// ─── Caso 1 y 2: DENIM × RECONOCIDO ───

describe("caso 1: DENIM × RECONOCIDO sin compras", () => {
  const res = calcular();
  const f = filaDe(res, claveDenim);

  it("VPM_set = 157,5 e imi_set = 4,44; S_oct = 550, imi_oct = 3,47, C_oct = 83,33 y C_nov = 153,33", () => {
    cerca(f.proyeccion.vpm_k, 157.5);
    cerca(f.proyeccion.imi_k, 700 / 157.5);
    expect(f.stock_k).toEqual({ cd: 300, tiendas: 400, total: 700 });
    const m = f.proyeccion.meses;
    cerca(m[0].stock, 550);
    cerca(m[0].imi, 550 / (1900 / 12));
    cerca(m[0].saldo, 83.3333333);
    cerca(m[1].saldo, 153.3333333);
  });

  it("tarjeta: primer_mes_falta = 2026-10, primer_mes_fuera_de_rango = 2026-10, IMI de set 4,4; FALTA con 3 meses y QUIEBRE con 6 (feb sin compras queda en −70)", () => {
    expect(resumenTarjeta(f, 3).resumen.senal).toBe("falta");
    const { resumen } = resumenTarjeta(f, 6);
    expect(f.proyeccion.meses[4].stock).toBe(-70);
    expect(resumen.senal).toBe("quiebre");
    expect(resumen.imi_k).toBe(4.4);
    expect(resumen.vpm_k).toBe(157.5);
    expect(resumen.primer_mes_falta).toBe("2026-10");
    expect(resumen.primer_mes_fuera_de_rango).toBe("2026-10");
    expect(resumen.exceso_desde).toBeNull();
  });

  it("el horizonte va de oct-26 a dic-27 y los periodos incluyen k'", () => {
    expect(res.periodos[0]).toBe("2026-09");
    expect(res.periodos[1]).toBe("2026-10");
    expect(res.periodos).toHaveLength(16);
    expect(f.proyeccion.meses).toHaveLength(15);
  });

  it("sin avisos de cabecera con una cerrada al día", () => {
    expect(res.avisos).toEqual([]);
  });
});

describe("caso 2: C-000012 (500 u en nov) confirmada", () => {
  const res = calcular({ compras: registrosC12() });
  const f = filaDe(res, claveDenim);

  it("I_nov = 500, S_nov = 900, imi_nov = 5,65 y C_nov = C_dic = C_ene = 0; C_feb = 134,33", () => {
    const m = f.proyeccion.meses;
    expect(m[1].ingresos).toBe(500);
    cerca(m[1].stock, 900);
    cerca(m[1].imi, 900 / (1910 / 12));
    expect([m[1].saldo, m[2].saldo, m[3].saldo]).toEqual([0, 0, 0]);
    cerca(m[4].saldo, 134.3333333);
  });

  it("tarjeta: saldo de los próximos 6 meses = 378 (377,67 redondeado), en camino 500 u en nov", () => {
    const { resumen, detalle } = resumenTarjeta(f, 6);
    expect(resumen.saldo_n_meses).toBe(378);
    expect(resumen.en_camino).toBe(500);
    expect(detalle.en_camino_primer_mes).toEqual({ periodo: "2026-11", unidades: 500 });
    expect(detalle.saldo_primer_mes).toBe(83);
  });

  it("enero tiene IMI bajo 4 (fuera de rango) pero la señal es al_dia: la sugerencia de octubre ya lo cubre", () => {
    const ene = f.proyeccion.meses[3];
    expect(ene.fuera_de_rango).toBe(true);
    expect(ene.senal).toBe("al_dia");
    expect(f.proyeccion.meses[0].senal).toBe("falta");
  });

  it("coincide con las cifras del fixture de T0 en todos los meses (demanda, ingresos, stock, VPM, IMI, saldo, exceso, señal)", () => {
    const esperado = filaDenimEjemplo();
    const api = aFilaFlujoApi(f, NOMBRES, "2026-09", res.parametros);
    expect(api.meses).toHaveLength(esperado.meses.length);
    esperado.meses.slice(1).forEach((m, i) => expect(api.meses[i + 1], `mes ${m.periodo}`).toEqual(m));
    expect(api.resumen).toMatchObject({ ...esperado.resumen });
    expect(api.stock_k).toEqual(esperado.stock_k);
    expect(api.meses[0]).toMatchObject({ periodo: "2026-09", real: true, demanda: 1410, stock_fin: 700, ingreso_inferido: 120, recepciones_registradas: 0 });
  });

  it("la serie de la lista es la del fixture, con un carácter de señal por periodo y '-' en k'", () => {
    const esperado = construirFlujo({ filas: 2, horizonte: 15 }).filas[0].serie;
    const serie = aSerieFlujoApi(f);
    expect(serie).toEqual(esperado);
    expect(serie.senal).toHaveLength(16);
    expect(serie.senal[0]).toBe("-");
    expect(serie.fuera_de_rango).toHaveLength(16);
    expect(serie.reposicion).toBeNull();
  });

  it("la historia de doce meses y la conciliación salen del stock publicado", () => {
    const esperado = filaDenimEjemplo();
    expect(f.historia).toHaveLength(12);
    expect(f.historia.map((h) => [h.periodo, h.venta, h.stock_fin])).toEqual(esperado.historia.map((h) => [h.periodo, h.venta, h.stock_fin]));
    f.historia.slice(1).forEach((h, i) => expect(h.ingreso_inferido).toBe(esperado.historia[i + 1].ingreso_inferido));
    cerca(f.vpm_real_k, VENTAS_DENIM_12M.reduce((a, b) => a + b, 0) / 12);
  });

  it("caso 3: 2 000 u en nov → X_nov = 1 127, imi_nov = 15,1 y tarjeta EXCESO", () => {
    const grande = registrosC12();
    grande.lineas[0].unidades = 2000;
    grande.entregas[0].unidades = 2000;
    const r = calcular({ compras: grande });
    const g = filaDe(r, claveDenim);
    cerca(g.proyeccion.meses[1].exceso, 1126.6666667, 1e-5);
    cerca(g.proyeccion.meses[1].imi, 15.0785, 1e-3);
    expect(aFilaFlujoApi(g, NOMBRES, "2026-09", r.parametros).meses[2].imi).toBe(15.1);
    expect(g.proyeccion.meses[1].senal).toBe("exceso");
    expect(resumenTarjeta(g, 6).resumen).toMatchObject({ exceso_desde: "2026-11", senal: "falta" });
    expect(resumenTarjeta(g, 6).detalle.exceso_primer_mes).toBe(1127);
  });

  it("un borrador no cambia nada", () => {
    const b = calcular({ compras: registrosC12({ estado: "borrador" }) });
    const g = filaDe(b, claveDenim);
    cerca(g.proyeccion.meses[1].saldo, 153.3333333);
  });
});

describe("caso 9: recepción (B3) y anti-duplicación", () => {
  it("200 recibidas en oct con k' = set: I_oct = 200 y 300 siguen en nov; al publicar oct la recepción cuenta 0", () => {
    const r = registrosC12({ entregas: [["2026-11", 500]], recepciones: [["2026-10", 200]] });
    const antes = filaDe(calcular({ compras: r }), claveDenim);
    expect(antes.proyeccion.meses.slice(0, 3).map((m) => m.ingresos)).toEqual([200, 300, 0]);
    const despues = calcularFlujo(
      entrada({
        kPrima: "2026-10",
        horizonte: { desde: "2026-11", hasta: "2027-12" },
        cerrada: { filas: cerradaDenim(), version_metodo: 4, huella_flujo: "h", periodo_referencia: { desde: "2025-10", hasta: "2026-09" } },
        // el inventario de oct trae +200: S_oct = 700 − 150 + 200 = 750
        stock: mapaDeStock(
          stockMes("2026-09", [{ ...DENIM, cd: 700, tiendas: 0, venta: 1410 }]),
          stockMes("2026-10", [{ ...DENIM, cd: 750, tiendas: 0, venta: 150 }])
        ),
        compras: r,
      })
    );
    const g = filaDe(despues, claveDenim);
    expect(g.proyeccion.meses[0].ingresos).toBe(300);
    // S_nov proyectado: antes 900 − (550 + 200 + 300... ) se compara con 750 + 300 − 150
    cerca(antes.proyeccion.meses[1].stock, 900);
    cerca(g.proyeccion.meses[0].stock, 900);
  });

  it("si el inventario de oct no trae esas 200 (+0), la conciliación de oct muestra recepcion_sin_respaldo = 200", () => {
    const r = registrosC12({ entregas: [["2026-11", 500]], recepciones: [["2026-10", 200]] });
    const res = calcularFlujo(
      entrada({
        kPrima: "2026-10",
        horizonte: { desde: "2026-11", hasta: "2027-12" },
        cerrada: { filas: cerradaDenim(), version_metodo: 4, huella_flujo: "h", periodo_referencia: null },
        stock: mapaDeStock(stockMes("2026-09", [{ ...DENIM, cd: 700, tiendas: 0, venta: 1410 }]), stockMes("2026-10", [{ ...DENIM, cd: 550, tiendas: 0, venta: 150 }])),
        compras: r,
      })
    );
    const oct = filaDe(res, claveDenim).conciliacion.find((m) => m.periodo === "2026-10")!;
    expect(oct.ingreso_inferido).toBe(0);
    expect(oct.recepciones_registradas).toBe(200);
    expect(oct.sin_respaldo).toBe(200);
    expect(oct.avisos).toContain("recepcion_sin_respaldo");
  });
});

describe("caso 24 y regla 4c: llegó y nadie lo confirmó", () => {
  /** k' = oct, la cerrada de set, D = 150; línea de 500 con entregas oct 300 · nov 200 y 100 confirmadas en oct. */
  const escenario = (stockOct: number, recepciones: [string, number][]) => {
    const compras = registrosC12({ entregas: [["2026-10", 300], ["2026-11", 200]], recepciones });
    return calcularFlujo(
      entrada({
        kPrima: "2026-10",
        horizonte: { desde: "2026-11", hasta: "2027-12" },
        cerrada: { filas: cerradaDeFila({ ...DENIM, demanda: [150, ...DEMANDA_CASO1] }), version_metodo: 4, huella_flujo: "h", periodo_referencia: { desde: "2025-10", hasta: "2026-09" } },
        stock: mapaDeStock(stockMes("2026-09", [{ ...DENIM, cd: 700, tiendas: 0, venta: 1410 }]), stockMes("2026-10", [{ ...DENIM, cd: stockOct, tiendas: 0, venta: 150 }])),
        compras,
      })
    );
  };

  it("con k' = set: S_oct = 850 y S_nov = 900", () => {
    const compras = registrosC12({ entregas: [["2026-10", 300], ["2026-11", 200]], recepciones: [["2026-10", 100]] });
    const f = filaDe(calcular({ compras }), claveDenim);
    cerca(f.proyeccion.meses[0].stock, 850);
    cerca(f.proyeccion.meses[1].stock, 900);
  });

  it("se publica oct con 850 sin confirmar las otras 200: I_nov = 400 y S_nov = 1 100 (no se corrige solo) con aviso, sugerencia y cabecera", () => {
    const res = escenario(850, [["2026-10", 100]]);
    const f = filaDe(res, claveDenim);
    expect(f.proyeccion.meses[0].ingresos).toBe(400);
    cerca(f.proyeccion.meses[0].stock, 1100);
    expect(f.por_confirmar).toBe(200);
    expect(f.posible_doble_conteo).toBe(200);
    expect(f.avisos).toEqual(expect.arrayContaining(["entregas_vencidas", "posible_doble_conteo"]));
    expect(res.por_confirmar).toEqual({ entregas: 1, unidades: 200, con_respaldo_entregas: 1, con_respaldo_unidades: 200 });
    expect(res.avisos).toEqual(["cerrada_atrasada", "entregas_sin_confirmar"]);
    const oct = f.conciliacion.find((m) => m.periodo === "2026-10")!;
    expect(oct).toMatchObject({ ingreso_inferido: 300, recepciones_registradas: 100, sin_registrar: 200 });
    expect(oct.sugerencias).toHaveLength(1);
    expect(oct.sugerencias[0]).toMatchObject({ tipo: "vencida", unidades: 200, compra_numero: "C-000012", periodo_entrega: "2026-10", boton: true });
  });

  it("tras aceptar la sugerencia (+200 recibidas en oct): S_nov = 900, sin banda ni sugerencia", () => {
    const res = escenario(850, [["2026-10", 100], ["2026-10", 200]]);
    const f = filaDe(res, claveDenim);
    cerca(f.proyeccion.meses[0].stock, 900);
    expect(f.por_confirmar).toBe(0);
    expect(f.posible_doble_conteo).toBe(0);
    expect(res.avisos).toEqual(["cerrada_atrasada"]);
    expect(f.conciliacion.find((m) => m.periodo === "2026-10")!.sin_registrar).toBe(0);
  });

  it("si en oct llegaron también las 200 de nov (adelantadas) sin confirmar, la conciliación añade la adelantada de nov", () => {
    const res = escenario(1050, [["2026-10", 100]]);
    const oct = filaDe(res, claveDenim).conciliacion.find((m) => m.periodo === "2026-10")!;
    expect(oct.sugerencias.map((s) => [s.tipo, s.periodo_entrega, s.unidades])).toEqual([["vencida", "2026-10", 200], ["adelantada", "2026-11", 200]]);
  });

  it("si el inventario de oct trae solo +100 no hay sugerencia ni posible_doble_conteo y las 200 siguen vencidas", () => {
    const res = escenario(650, [["2026-10", 100]]);
    const f = filaDe(res, claveDenim);
    expect(f.posible_doble_conteo).toBe(0);
    expect(f.por_confirmar).toBe(200);
    expect(res.por_confirmar).toMatchObject({ entregas: 1, unidades: 200, con_respaldo_entregas: 0, con_respaldo_unidades: 0 });
    expect(f.avisos).toContain("entregas_vencidas");
    expect(f.avisos).not.toContain("posible_doble_conteo");
  });
});

// ─── Conciliación (caso 9b) ───

describe("caso 9b: conciliación de set", () => {
  const poloConRecepcion = (): RegistrosCompra => {
    const c = registrosC09();
    c.lineas[0].unidades = 800;
    c.entregas[0].unidades = 800;
    c.lineas[0].unidades_recibidas = 300;
    const recepcion: RecepcionRegistro = { id: "r9", linea_id: LINEA.c09, recibida_periodo: "2026-09", unidades: 300, fecha_recepcion: "2026-09-15", origen: "manual" };
    c.recepciones.push(recepcion);
    return c;
  };
  const camisaRecibida = (): RegistrosCompra => {
    const c = registrosC15CargaInicial();
    c.lineas[0].equivalencia_id = EQ.larga;
    c.lineas[0].unidades = 950;
    c.lineas[0].unidades_recibidas = 950;
    c.entregas[0] = { ...c.entregas[0], periodo: "2026-09", unidades: 950 };
    c.recepciones[0] = { ...c.recepciones[0], recibida_periodo: "2026-09", unidades: 950 };
    return c;
  };

  const stock = mapaDeStock(
    stockMes("2026-08", [
      { ...DENIM, cd: 1990, venta: 1500 },
      { ...POLO_PREMIUM, cd: 960, venta: 800 },
      { ...CAMISA, cd: 2300, venta: 1200 },
    ]),
    stockMes("2026-09", [
      { ...DENIM, cd: 300, tiendas: 400, venta: 1410 },
      { ...POLO_PREMIUM, cd: 940, venta: 820 },
      { ...CAMISA, cd: 1950, venta: 1200 },
    ])
  );
  const cerrada = [
    ...cerradaDenim(),
    ...cerradaDeFila({ ...POLO_PREMIUM, demanda: DEMANDA_CASO1 }),
    ...cerradaDeFila({ ...CAMISA, demanda: DEMANDA_CASO1.map(() => 1200) }),
  ];
  const res = calcular({ cerrada: { filas: cerrada, version_metodo: 4, huella_flujo: "h", periodo_referencia: { desde: "2025-10", hasta: "2026-09" } }, stock, compras: unirCompras(poloConRecepcion(), camisaRecibida()) });
  const set = armarConciliacionApi(res, "2026-09", NOMBRES)!;
  const fila = (ruta: string) => set.filas.find((f) => f.ruta === ruta && f.marca_id === null)!;

  it("DENIM: Ing = 120 sin recepciones → ingreso_sin_registrar sin sugerencia (no hay entregas vencidas)", () => {
    const f = fila("HOMBRE · URBANO · DENIM");
    expect(f).toMatchObject({ venta: 1410, stock_inicio: 1990, stock_fin: 700, ingreso_inferido: 120, recepciones_registradas: 0, sin_registrar: 120 });
    expect(f.avisos).toContain("ingreso_sin_registrar");
    expect(f.sugerencias).toEqual([]);
  });

  it("POLO × PREMIUM: Ing = 800, recepciones 300 y la entrega de set de C-000009 vencida → sugerencia de 500 con botón", () => {
    const f = fila("HOMBRE · CASUAL · POLO");
    expect(f).toMatchObject({ ingreso_inferido: 800, recepciones_registradas: 300, sin_registrar: 500, entregas_programadas: 800 });
    expect(f.sugerencias).toHaveLength(1);
    expect(f.sugerencias[0]).toMatchObject({ tipo: "vencida", unidades: 500, compra_numero: "C-000009", periodo_entrega: "2026-09", boton: true });
  });

  it("registrar esa recepción (aceptar) deja sin_registrar = 0 y la sugerencia desaparece", () => {
    const c = poloConRecepcion();
    c.recepciones.push({ id: "r9b", linea_id: LINEA.c09, recibida_periodo: "2026-09", unidades: 500, fecha_recepcion: "2026-09-30", origen: "sugerencia" });
    c.lineas[0].unidades_recibidas = 800;
    const r = calcular({ cerrada: { filas: cerrada, version_metodo: 4, huella_flujo: "h", periodo_referencia: { desde: "2025-10", hasta: "2026-09" } }, stock, compras: unirCompras(c) });
    const f = armarConciliacionApi(r, "2026-09", NOMBRES)!.filas.find((x) => x.ruta === "HOMBRE · CASUAL · POLO")!;
    expect(f.sin_registrar).toBe(0);
    expect(f.sugerencias).toEqual([]);
    expect(f.avisos).not.toContain("ingreso_sin_registrar");
  });

  it("CAMISA: recepciones 950 e Ing = 850 → recepcion_sin_respaldo = 100", () => {
    const f = fila("HOMBRE · FORMAL · CAMISA › MANGA LARGA");
    expect(f).toMatchObject({ ingreso_inferido: 850, recepciones_registradas: 950, sin_respaldo: 100 });
    expect(f.avisos).toContain("recepcion_sin_respaldo");
  });

  it("totales de las filas completas y avisos del mes", () => {
    expect(set.totales.venta).toBe(1410 + 820 + 1200);
    expect(set.totales.ingreso_inferido).toBe(120 + 800 + 850);
    expect(set.totales.recepciones_registradas).toBe(300 + 950);
    expect(set.mes_anterior_publicado).toBe(true);
    expect(set.avisos.map((a) => a.aviso)).toEqual(expect.arrayContaining(["ingreso_sin_registrar", "recepcion_sin_respaldo"]));
  });

  it("un mes no publicado devuelve null (404 sin_mes) y uno sin el anterior marca sin_mes_anterior", () => {
    expect(armarConciliacionApi(res, "2026-10", NOMBRES)).toBeNull();
    const ago = armarConciliacionApi(res, "2026-08", NOMBRES)!;
    expect(ago.mes_anterior_publicado).toBe(false);
    expect(ago.filas.every((f) => f.avisos.includes("sin_mes_anterior"))).toBe(true);
    expect(ago.avisos).toEqual([{ aviso: "sin_mes_anterior", filas: 3, unidades: null }]);
  });

  it("los filtros solo=… y incluir=… reducen las filas", () => {
    expect(armarConciliacionApi(res, "2026-09", NOMBRES, { solo: "sin_respaldo" })!.filas.map((f) => f.ruta)).toEqual(["HOMBRE · FORMAL · CAMISA › MANGA LARGA"]);
    expect(armarConciliacionApi(res, "2026-09", NOMBRES, { solo: "por_confirmar" })!.filas.map((f) => f.ruta)).toEqual(["HOMBRE · CASUAL · POLO"]);
    expect(armarConciliacionApi(res, "2026-09", NOMBRES, { solo: "entregas_vencidas" })!.filas.map((f) => f.ruta)).toEqual(["HOMBRE · CASUAL · POLO"]);
    expect(armarConciliacionApi(res, "2026-09", NOMBRES, { incluir: (f) => f.gml_id === NODO_M8.urbano })!.filas).toHaveLength(1);
  });

  it("una transferencia CD → tienda no produce ingreso y una tienda desactivada que pasa su stock al CD tampoco", () => {
    const st = mapaDeStock(
      stockMes("2026-08", [{ ...DENIM, cd: 600, tiendas: 400, inactivas: 0, venta: 0 }]),
      stockMes("2026-09", [{ ...DENIM, cd: 400, tiendas: 600, inactivas: 0, venta: 0 }])
    );
    const a = calcular({ stock: st });
    expect(filaDe(a, claveDenim).conciliacion.find((m) => m.periodo === "2026-09")!.ingreso_inferido).toBe(0);
    const st2 = mapaDeStock(
      stockMes("2026-08", [{ ...DENIM, cd: 100, tiendas: 200, inactivas: 300, venta: 0 }]),
      stockMes("2026-09", [{ ...DENIM, cd: 400, tiendas: 200, inactivas: 0, venta: 0 }])
    );
    const b = calcular({ stock: st2 });
    expect(filaDe(b, claveDenim).conciliacion.find((m) => m.periodo === "2026-09")!.ingreso_inferido).toBe(0);
  });

  it("reclasificación probable: una fila con +300 y otra de la misma línea con −290 avisan las dos", () => {
    const st = mapaDeStock(
      stockMes("2026-08", [{ gml: NODO_M8.polo, agr: AGR_M8.premium, cd: 500 }, { gml: NODO_M8.polo, agr: AGR_M8.reconocido, cd: 800 }]),
      stockMes("2026-09", [{ gml: NODO_M8.polo, agr: AGR_M8.premium, cd: 800 }, { gml: NODO_M8.polo, agr: AGR_M8.reconocido, cd: 510 }])
    );
    const r = calcular({ stock: st });
    const a = filaDe(r, claveDeFila({ gml_id: NODO_M8.polo, equivalencia_id: null, agrupacion_marca_id: AGR_M8.premium }));
    const b = filaDe(r, claveDeFila({ gml_id: NODO_M8.polo, equivalencia_id: null, agrupacion_marca_id: AGR_M8.reconocido }));
    expect(a.conciliacion.find((m) => m.periodo === "2026-09")!.avisos).toContain("reclasificacion_probable");
    expect(b.conciliacion.find((m) => m.periodo === "2026-09")!.avisos).toEqual(expect.arrayContaining(["salida_neta", "reclasificacion_probable"]));
  });
});

// ─── Intercompany (casos 8 y 25; reglas 2, 27 y 28) ───

describe("caso 8 y 25: CAMISA × RECONOCIDO con el subflujo de JH", () => {
  const camisa = (op: Partial<EntradaCalculoFlujo> = {}, partic = participaciones({ [MARCA_M8.jh]: 0.4 })) =>
    calcular({
      cerrada: { filas: cerradaDeFila({ ...CAMISA, demanda: DEMANDA_CASO1.map(() => 1200), partic }), version_metodo: 4, huella_flujo: "h", periodo_referencia: { desde: "2025-10", hasta: "2026-09" } },
      stock: mapaDeStock(
        stockMes("2026-09", [{ ...CAMISA, cd: 1400, tiendas: 900, venta: 1200, marcas: { [MARCA_M8.jh]: { cd: 300, tiendas: 600, venta: 480 }, [MARCA_M8.alfa]: { cd: 1100, tiendas: 300, venta: 720 } } }])
      ),
      reglas: [REGLA_JH],
      ...op,
    });

  const res = camisa();
  const f = filaDe(res, claveCamisaLarga);
  const jh = f.proyeccion.subflujos[0];

  it("subflujo de JH: D^B = 480, R^B = 384, S^B_oct = 804, VPM^B = 480, imi^B = 1,675, C^B = 1 116 y señal falta", () => {
    expect(f.proyeccion.subflujos).toHaveLength(1);
    const m = jh.componente.meses[0];
    cerca(m.demanda, 480);
    cerca(m.reposicion, 384);
    cerca(m.stock, 804);
    cerca(m.vpm, 480);
    cerca(m.imi, 1.675);
    cerca(m.objetivo, 1920);
    cerca(m.saldo, 1116);
    expect(m.senal).toBe("falta");
    expect(jh.senal_resumen).toBe("falta");
    expect(jh.part).toBe(0.4);
    expect(jh.stock_k).toBe(900);
  });

  it("con la regla editada a 2–4: C^B_oct = 156", () => {
    const r = camisa({ reglas: [{ ...REGLA_JH, imi_min: 2, imi_max: 4 }] });
    cerca(filaDe(r, claveCamisaLarga).proyeccion.subflujos[0].componente.meses[0].saldo, 156);
  });

  it("el resto de la fila (D = 720, stock 1 400) se evalúa con el 4–8 general: S_oct = 680", () => {
    const resto = f.proyeccion.resto!;
    cerca(resto.meses[0].demanda, 720);
    cerca(resto.meses[0].stock, 680);
    cerca(resto.meses[0].objetivo, 2880);
    cerca(resto.meses[0].saldo, 2200);
    expect(resto.rango).toEqual({ imi_min: 4, imi_max: 8 });
  });

  it("caso 25 (§0.9): S_fila_oct = 2 300 + 384 − 1 200 = 1 484 = 680 + 804; el stock de la fila baja 816 por mes, no 1 200", () => {
    const m = f.proyeccion.meses;
    cerca(m[0].stock, 1484);
    cerca(m[0].reposicion, 384);
    cerca(m[1].stock, 1484 - 816);
    cerca(m[2].stock, 1484 - 2 * 816);
    m.forEach((x, i) => cerca(x.stock, f.proyeccion.resto!.meses[i].stock + jh.componente.meses[i].stock, 1e-6));
  });

  it("el IMI de la fila va sobre la foto conjunta, C_fila = C^resto + C^JH y X_fila = X^resto + X^JH; la fila queda fuera de rango", () => {
    const m = f.proyeccion.meses[0];
    cerca(m.imi, 1484 / 1200);
    cerca(m.saldo, 2200 + 1116);
    cerca(m.exceso, f.proyeccion.resto!.meses[0].exceso + jh.componente.meses[0].exceso);
    expect(m.fuera_de_rango).toBe(true);
    expect(m.senal).toBe("falta");
    cerca(f.proyeccion.imi_k, 2300 / 1200);
  });

  it("fuera_de_rango de la fila ⇔ el resto o algún subflujo sale de SU rango: con JH en 1–2 y el resto sano, sigue marcándose por el resto o no según cada rango", () => {
    // Un resto con 12 meses de stock (dentro de 4–8) y JH con rango 1–3 (su IMI 1,7 está dentro): la fila no queda fuera de rango.
    const holgado = camisa({
      reglas: [{ ...REGLA_JH, imi_min: 1, imi_max: 3 }],
      stock: mapaDeStock(stockMes("2026-09", [{ ...CAMISA, cd: 5000, tiendas: 1000, venta: 1200, marcas: { [MARCA_M8.jh]: { cd: 900, tiendas: 900, venta: 480 } } }])),
    });
    const g = filaDe(holgado, claveCamisaLarga);
    const a = g.proyeccion.resto!.meses[0];
    const b = g.proyeccion.subflujos[0].componente.meses[0];
    expect(g.proyeccion.meses[0].fuera_de_rango).toBe(a.fuera_de_rango || b.fuera_de_rango);
  });

  it("la línea «reposición directa esperada» = 384 y sale en la serie solo en filas con subflujo", () => {
    const serie = aSerieFlujoApi(f);
    expect(serie.reposicion).not.toBeNull();
    expect(serie.reposicion![0]).toBe(0);
    expect(serie.reposicion![1]).toBe(384);
    expect(aSerieFlujoApi(filaDe(calcular(), claveDenim)).reposicion).toBeNull();
  });

  it("coincide con las cifras del fixture de T0 (fila y subflujo)", () => {
    const esperado = filaCamisaJhEjemplo();
    const api = aFilaDetalleApi(f, res, NOMBRES);
    // La señal de la fila es la peor de sus componentes (§0.9): el resto (S = 680 − 720 < 0) entra en quiebre desde nov, aunque la suma
    // de la fila siga positiva; el fixture de T0 la deriva de la suma, así que aquí se compara todo salvo `senal`.
    esperado.meses.slice(1).forEach((m, i) => {
      const x = api.meses[i + 1];
      expect([x.demanda, x.ingresos, x.stock_fin, x.vpm, x.imi, x.objetivo_min, x.tope, x.saldo, x.exceso, x.fuera_de_rango, x.extendido], `fila ${m.periodo}`).toEqual([m.demanda, m.ingresos, m.stock_fin, m.vpm, m.imi, m.objetivo_min, m.tope, m.saldo, m.exceso, m.fuera_de_rango, m.extendido]);
    });
    expect(api.meses[1].senal).toBe("falta");
    expect(api.meses[2].senal).toBe("quiebre");
    const sub = api.subflujos[0];
    const esperadoSub = esperado.subflujos[0];
    esperadoSub.meses.slice(1).forEach((m, i) => {
      const x = sub.meses[i + 1];
      expect([x.demanda, x.stock_fin, x.imi, x.saldo, x.exceso, x.senal, x.reposicion_esperada], `JH ${m.periodo}`).toEqual([m.demanda, m.stock_fin, m.imi, m.saldo, m.exceso, m.senal, m.reposicion_esperada]);
    });
    expect(sub).toMatchObject({ marca_id: MARCA_M8.jh, imi_min: 4, imi_max: 8, pct_directo: 80, part: 0.4, stock_k: 900 });
    expect(api.resto!.meses.slice(1).map((m) => [m.demanda, m.stock_fin, m.saldo])).toEqual(esperado.resto!.meses.slice(1).map((m) => [m.demanda, m.stock_fin, m.saldo]));
    expect(api.subflujos_resumen).toEqual([{ marca: "JOHN HOLDEN", senal: "falta", imi_k: 1.9, rango: [4, 8] }]);
  });

  it("regla 27: la señal de M8 puede diferir de la de M13 (falta ⇔ C > 0) y pct_directo_observado sale en puntos { periodo, valor: 80 }", () => {
    // Set: Ing^B = 384 con stock JH ago 996 y set 900, venta 480 y sin recepciones → 80 %
    const r = camisa({
      stock: mapaDeStock(
        stockMes("2026-08", [{ ...CAMISA, cd: 3116, venta: 0, marcas: { [MARCA_M8.jh]: { cd: 996, venta: 0 } } }]),
        stockMes("2026-09", [{ ...CAMISA, cd: 1400, tiendas: 900, venta: 1200, marcas: { [MARCA_M8.jh]: { cd: 300, tiendas: 600, venta: 480 } } }])
      ),
    });
    const sub = aFilaDetalleApi(filaDe(r, claveCamisaLarga), r, NOMBRES).subflujos[0];
    expect(sub.pct_directo_observado).toEqual({ periodo: "2026-09", valor: 80 });
    expect(sub.pct_directo_observado_12m).toEqual({ desde: "2026-09", hasta: "2026-09", valor: 80 });
    const conc = armarConciliacionApi(r, "2026-09", NOMBRES)!;
    const filaJh = conc.filas.find((x) => x.marca_id === MARCA_M8.jh)!;
    expect(filaJh).toMatchObject({ marca: "JOHN HOLDEN", ingreso_inferido: 384, sin_registrar: 384, pct_directo_regla: 80 });
    expect(filaJh.pct_directo_observado).toEqual({ periodo: "2026-09", valor: 80 });
    expect(conc.filas.find((x) => x.marca_id === null)!.pct_directo_observado).toBeNull();
  });

  it("una línea JH · CAMISA con destino intercompany_directo suma a I^B además de la reposición esperada", () => {
    const compras = registrosC12({ entregas: [["2026-11", 300]] });
    compras.lineas[0] = { ...compras.lineas[0], unidades: 300, genero_mundo_linea_id: NODO_M8.camisa, equivalencia_id: EQ.larga, marca_id: MARCA_M8.jh, destino: "intercompany_directo" };
    const r = camisa({ compras });
    const g = filaDe(r, claveCamisaLarga);
    expect(g.proyeccion.subflujos[0].ingresos[1]).toBe(300);
    expect(g.proyeccion.meses[1].ingresos).toBe(300);
    cerca(g.proyeccion.subflujos[0].componente.meses[1].stock, 804 + 300 + 384 - 480);
    // El resto no recibe esos 300
    cerca(g.proyeccion.resto!.meses[1].ingresos, 0);
  });

  it("regla no aplicable (cerrada de 0.10.0 sin la marca) → sin subflujo y aviso intercompany_no_aplicable", () => {
    const sinMarca = { por_clave_flujo: [{ clave_flujo: "otras", marca_id: null, participacion: 1 }], por_marca: null };
    const r = camisa({}, sinMarca);
    const g = filaDe(r, claveCamisaLarga);
    expect(g.proyeccion.subflujos).toHaveLength(0);
    expect(g.proyeccion.resto).toBeNull();
    expect(g.avisos).toContain("intercompany_no_aplicable");
  });

  it("una cerrada de 0.10.0 (sin por_marca) pero con la marca en por_clave_flujo sí aplica (part_B de por_clave_flujo)", () => {
    const r = camisa({}, { por_clave_flujo: [{ clave_flujo: `marca:${MARCA_M8.jh}`, marca_id: MARCA_M8.jh, participacion: 0.4 }, { clave_flujo: "otras", marca_id: null, participacion: 0.6 }], por_marca: null });
    expect(filaDe(r, claveCamisaLarga).proyeccion.subflujos).toHaveLength(1);
  });

  it("fila sin participaciones (sin fila base) → sin_participaciones y sin subflujo", () => {
    const r = camisa({
      cerrada: { filas: cerradaDeFila({ ...CAMISA, demanda: DEMANDA_CASO1.map(() => 1200), tienda: "t-nueva" }), version_metodo: 4, huella_flujo: "h", periodo_referencia: null },
    });
    const g = filaDe(r, claveCamisaLarga);
    expect(g.proyeccion.subflujos).toHaveLength(0);
    expect(g.avisos).toContain("sin_participaciones");
  });

  it("regla con vigente_desde = k'+3 además de la de k'+1 → el subflujo usa la de k'+1 y avisa regla_cambia_en_horizonte", () => {
    const futura: typeof REGLA_JH = { ...REGLA_JH, id: "10000000-0000-4000-8000-000000000002", vigente_desde: "2026-12", imi_min: 2, imi_max: 4 };
    const g = filaDe(camisa({ reglas: [REGLA_JH, futura] }), claveCamisaLarga);
    expect(g.proyeccion.subflujos[0].regla.id).toBe(REGLA_JH.id);
    expect(g.avisos).toContain("regla_cambia_en_horizonte");
  });

  it("solo una regla futura → sin subflujo y regla_futura", () => {
    const g = filaDe(camisa({ reglas: [{ ...REGLA_JH, vigente_desde: "2026-12" }] }), claveCamisaLarga);
    expect(g.proyeccion.subflujos).toHaveLength(0);
    expect(g.avisos).toContain("regla_futura");
  });

  it("la regla de la equivalencia manda sobre la del GML", () => {
    const eq = { ...REGLA_JH, id: "10000000-0000-4000-8000-000000000003", equivalencia_id: EQ.larga, imi_min: 3, imi_max: 6, pct_directo: 50 };
    const g = filaDe(camisa({ reglas: [REGLA_JH, eq] }), claveCamisaLarga);
    expect(g.proyeccion.subflujos[0].regla.id).toBe(eq.id);
    cerca(g.proyeccion.subflujos[0].componente.meses[0].reposicion, 480 * 0.5);
  });
});

// ─── Filas sin curva y sin proyección (reglas 1 y 29; casos 16 y 27) ───

describe("filas sin curva (regla 29, caso 27) y sin proyección (caso 16)", () => {
  const sinCurva = () => [
    ...cerradaDeFila({ ...POLO_PREMIUM, demanda: DEMANDA_CASO1, sinMeses: true, total: 3600 }),
    // tiendas nuevas sin curva con total 0: no avisan nada
    ...cerradaDeFila({ ...DENIM, demanda: DEMANDA_CASO1.map(() => 0), tienda: "t-nueva", sinMeses: true, total: 0 }),
  ];
  const res = calcular({
    cerrada: { filas: [...cerradaDenim(), ...sinCurva()], version_metodo: 4, huella_flujo: "h", periodo_referencia: { desde: "2025-10", hasta: "2026-09" } },
    stock: mapaDeStock(stockMes("2026-09", [{ ...DENIM, cd: 300, tiendas: 400, venta: 1410 }, { ...POLO_PREMIUM, cd: 400, venta: 100 }])),
  });
  const polo = filaDe(res, claveDeFila({ gml_id: NODO_M8.polo, equivalencia_id: null, agrupacion_marca_id: AGR_M8.premium }));

  it("aviso filas_sin_curva con las filas, su venta anual y su stock", () => {
    expect(res.avisos).toContain("filas_sin_curva");
    expect(res.filas_sin_curva.filas).toBe(1);
    expect(res.filas_sin_curva.stock).toBe(400);
    expect(res.filas_sin_curva.venta_anual).toBe(3600);
  });

  it("la fila sin curva se proyecta sin demanda: S_m = S_{m−1} + I_m, IMI nulo, señal sin_curva, sin saldo ni exceso", () => {
    expect(polo.sin_curva).toBe(true);
    polo.proyeccion.meses.forEach((m) => {
      expect(m.stock).toBe(400);
      expect(m.imi).toBeNull();
      expect(m.senal).toBe("sin_curva");
      expect(m.saldo).toBe(0);
      expect(m.exceso).toBe(0);
      expect(m.fuera_de_rango).toBe(false);
    });
    expect(polo.avisos).toContain("sin_curva");
    expect(resumenTarjeta(polo, 6).resumen).toMatchObject({ senal: "sin_curva", imi_k: null, vpm_k: null, saldo_n_meses: 0 });
    expect(aSerieFlujoApi(polo).senal).toBe("-" + "c".repeat(15));
  });

  it("la fila de tienda sin curva con total 0 no genera demanda_parcial_sin_curva", () => {
    expect(filaDe(res, claveDenim).avisos).toEqual([]);
  });

  it("el IMI de los totales excluye el stock y la demanda de las filas sin curva (su stock se muestra aparte)", () => {
    expect(res.totales.stock[0]).toBe(700);
    cerca(res.totales.imi[0], 700 / 157.5);
    // Σ de todas las filas SÍ incluye el stock de la fila sin curva
    expect(res.filas.reduce((a, f) => a + f.stock_k.total, 0)).toBe(1100);
  });

  it("caso 16: un stock sin fila en la cerrada → fila sin proyección con D = 0, sin_demanda, y entra al IMI total", () => {
    const r = calcular({
      stock: mapaDeStock(stockMes("2026-09", [{ ...DENIM, cd: 300, tiendas: 400, venta: 1410 }, { gml: NODO_M8.sandalia, agr: AGR_M8.valor, cd: 90, tiendas: 10, venta: 0 }])),
    });
    const g = filaDe(r, claveDeFila({ gml_id: NODO_M8.sandalia, equivalencia_id: null, agrupacion_marca_id: AGR_M8.valor }));
    expect(g.avisos).toContain("fila_sin_proyeccion");
    expect(g.proyeccion.meses.every((m) => m.demanda === 0 && m.senal === "sin_demanda")).toBe(true);
    expect(r.filas.reduce((a, f) => a + f.stock_k.total, 0)).toBe(800);
    expect(r.totales.stock[0]).toBe(800);
    expect(g.proyeccion.imi_k).toBeNull();
  });

  it("una base con curva y una de tienda sin curva con total 120 → demanda sin esos 120 y demanda_parcial_sin_curva", () => {
    const r = calcular({
      cerrada: { filas: [...cerradaDenim(), ...cerradaDeFila({ ...DENIM, demanda: DEMANDA_CASO1.map(() => 0), tienda: "t-nueva", sinMeses: true, total: 120 })], version_metodo: 4, huella_flujo: "h", periodo_referencia: null },
    });
    const g = filaDe(r, claveDenim);
    expect(g.avisos).toContain("demanda_parcial_sin_curva");
    expect(g.unidades_sin_curva).toBeGreaterThanOrEqual(120);
    expect(g.proyeccion.meses[0].demanda).toBe(150);
  });
});

// ─── Cabecera (regla 26) ───

describe("avisos de cabecera y contratos reales (regla 26)", () => {
  const base = (op: Partial<EntradaCalculoFlujo>) => calcular(op).avisos;

  it("cerrada con version_metodo = 3 → cerrada_metodo_anterior y el flujo se calcula igual", () => {
    const filas = cerradaDenim();
    const r = calcular({ cerrada: { filas, version_metodo: 3, huella_flujo: "h", periodo_referencia: { desde: "2025-10", hasta: "2026-09" } } });
    expect(r.avisos).toEqual(["cerrada_metodo_anterior"]);
    expect(r.filas).toHaveLength(1);
  });

  it("huella_flujo de la cerrada nula o distinta de la de hoy → config_cambiada", () => {
    const cerrada = (huella: string | null) => ({ filas: cerradaDenim(), version_metodo: 4, huella_flujo: huella, periodo_referencia: { desde: "2025-10", hasta: "2026-09" } });
    expect(base({ cerrada: cerrada(null) })).toEqual(["config_cambiada"]);
    expect(base({ cerrada: cerrada("otra") })).toEqual(["config_cambiada"]);
    expect(base({ cerrada: cerrada("h") })).toEqual([]);
  });

  it("sin periodo de referencia → cerrada_sin_periodo; con la cerrada siguiente → horizonte_corto", () => {
    expect(base({ cerrada: { filas: cerradaDenim(), version_metodo: 4, huella_flujo: "h", periodo_referencia: null } })).toEqual(["cerrada_sin_periodo"]);
    expect(base({ cubre: "siguiente" })).toEqual(["horizonte_corto"]);
  });

  it("stock en tiendas desactivadas y stock sin clave se informan sin romper el cálculo", () => {
    const st = mapaDeStock(stockMes("2026-09", [{ ...DENIM, cd: 300, tiendas: 400, venta: 1410 }], { excluido: { stock: 50, unidades: 5 }, sin_clave: { stock: 20, unidades: 3 } }));
    const r = calcular({ stock: st });
    expect(r.avisos).toEqual(["stock_en_tiendas_inactivas", "stock_sin_clave"]);
    expect(r.stock_excluido).toEqual({ stock: 50, unidades: 5 });
    expect(r.stock_sin_clave).toBe(20);
  });

  it("caso 10: con oct publicado y la cerrada de set el flujo arranca con el stock de oct y el horizonte empieza en nov (cerrada_atrasada)", () => {
    const r = calcularFlujo(
      entrada({
        kPrima: "2026-10",
        horizonte: { desde: "2026-11", hasta: "2027-12" },
        cerrada: { filas: cerradaDeFila({ ...DENIM, demanda: [150, ...DEMANDA_CASO1] }), version_metodo: 4, huella_flujo: "h", periodo_referencia: { desde: "2025-10", hasta: "2026-09" } },
        stock: mapaDeStock(stockMes("2026-09", [{ ...DENIM, cd: 700, venta: 1410 }]), stockMes("2026-10", [{ ...DENIM, cd: 550, venta: 150 }])),
      })
    );
    expect(r.avisos).toEqual(["cerrada_atrasada"]);
    expect(r.periodos[0]).toBe("2026-10");
    expect(r.periodos[1]).toBe("2026-11");
    const f = filaDe(r, claveDenim);
    expect(f.stock_k.total).toBe(550);
    expect(f.venta_k).toBe(150);
    expect(f.proyeccion.meses[0].periodo).toBe("2026-11");
  });

  it("sin el stock de k' publicado no revienta: todo en cero", () => {
    const r = calcular({ stock: new Map() });
    expect(filaDe(r, claveDenim).stock_k.total).toBe(0);
    expect(r.por_confirmar.entregas).toBe(0);
  });
});

// ─── Determinismo y balance (regla 8) ───

describe("determinismo y balance (regla 8)", () => {
  const completo = () =>
    calcular({
      cerrada: {
        filas: [...cerradaDenim(), ...cerradaDeFila({ ...CAMISA, demanda: DEMANDA_CASO1.map(() => 1200), partic: participaciones({ [MARCA_M8.jh]: 0.4 }) }), ...cerradaDeFila({ ...POLO_PREMIUM, demanda: DEMANDA_CASO1.map((d) => d + 40) })],
        version_metodo: 4,
        huella_flujo: "h",
        periodo_referencia: { desde: "2025-10", hasta: "2026-09" },
      },
      stock: mapaDeStock(
        stockMes("2026-09", [
          { ...DENIM, cd: 300, tiendas: 400, venta: 1410 },
          { ...CAMISA, cd: 1400, tiendas: 900, venta: 1200, marcas: { [MARCA_M8.jh]: { cd: 300, tiendas: 600, venta: 480 } } },
          { ...POLO_PREMIUM, cd: 120, tiendas: 80, venta: 90 },
        ])
      ),
      reglas: [REGLA_JH],
      compras: registrosC12({ entregas: [["2026-11", 300], ["2026-12", 200]] }),
    });

  it("el mismo insumo da el mismo resultado", () => {
    expect(completo()).toEqual(completo());
  });

  it("Σ_f (S_k' + Σ I + Σ R − Σ D) = Σ_f S_H, con la reposición directa de los subflujos", () => {
    const res = completo();
    let lhs = 0;
    let rhs = 0;
    for (const f of res.filas) {
      const m = f.proyeccion.meses;
      lhs += f.stock_k.total + m.reduce((a, x) => a + x.ingresos + x.reposicion - x.demanda, 0);
      rhs += m[m.length - 1].stock;
    }
    cerca(lhs, rhs, 1e-6);
    expect(res.filas.reduce((a, f) => a + f.proyeccion.meses.reduce((b, x) => b + x.reposicion, 0), 0)).toBeGreaterThan(0);
  });

  it("los totales suman las filas: stock, saldo y exceso; el IMI total sale del stock y la demanda totales", () => {
    const res = completo();
    const t = res.totales;
    cerca(t.stock[1], res.filas.reduce((a, f) => a + f.proyeccion.meses[0].stock, 0));
    cerca(t.saldo[3], res.filas.reduce((a, f) => a + f.proyeccion.meses[2].saldo, 0));
    cerca(t.demanda[1], res.filas.reduce((a, f) => a + f.proyeccion.meses[0].demanda, 0));
    expect(t.stock[0]).toBe(700 + 2300 + 200);
    expect(t.reposicion).not.toBeNull();
    const api = aTotalesApi(t);
    expect(api.senal).toHaveLength(16);
    expect(api.senal[0]).toBe("-");
  });

  it("Σ_f D_m = el total mensual de la cerrada", () => {
    const res = completo();
    cerca(res.totales.demanda[1], 150 + 1200 + 190);
  });

  it("las tarjetas se ordenan por saldo descendente de forma estable", () => {
    const res = completo();
    const { tarjetas, catalogo } = armarHuecosApi(res.filas, NOMBRES, 6);
    expect(tarjetas).toHaveLength(res.filas.length);
    for (const t of tarjetas) {
      expect(catalogo.nodos[t.nodo]).toBeDefined();
      expect(catalogo.agrupaciones[t.agrupacion]).toBeDefined();
    }
    const saldos = tarjetas.map((t) => t.resumen.saldo_n_meses);
    expect(saldos).toEqual([...saldos].sort((a, b) => b - a));
    expect(tarjetas.map((t) => t.resumen.saldo_n_meses)).toEqual(saldos);
  });

  it("la lista y el detalle comparten ruta y nombres con el catálogo", () => {
    const res = completo();
    const f = filaDe(res, claveDenim);
    const lista = aFilaListaApi(f, NOMBRES, 6);
    expect(lista.serie.demanda).toHaveLength(16);
    expect(lista).not.toHaveProperty("meses");
    const detalle = aFilaDetalleApi(f, res, NOMBRES);
    expect(detalle.historia).toHaveLength(1);
    expect(detalle.genero).toBe("HOMBRE");
    expect(detalle.entregas.map((e) => [e.periodo, e.pendiente])).toEqual([["2026-11", 300], ["2026-12", 200]]);
    expect(rutaDe(NOMBRES.nodos[EQ.larga])).toBe("HOMBRE · FORMAL · CAMISA › MANGA LARGA");
    const camisa = aFilaDetalleApi(filaDe(res, claveCamisaLarga), res, NOMBRES);
    expect(camisa.subflujos).toHaveLength(1);
    expect(mesesEntre(res.periodos[0], res.periodos[15])).toEqual(res.periodos);
  });

  it("el detalle lista las entregas pendientes con su estado y si están vencidas", () => {
    const res = calcular({ compras: unirCompras(registrosC12({ entregas: [["2026-09", 100], ["2026-11", 400]] })) });
    const detalle = aFilaDetalleApi(filaDe(res, claveDenim), res, NOMBRES);
    expect(detalle.entregas.map((e) => [e.numero, e.periodo, e.pendiente, e.vencida, e.estado, e.marca])).toEqual([
      ["C-000012", "2026-09", 100, true, "confirmada", "ALFA"],
      ["C-000012", "2026-11", 400, false, "confirmada", "ALFA"],
    ]);
    expect(detalle.entregas[0]).toMatchObject({ proveedor: "Proveedor Norte", tipo: "especifica", tallas: "centrales", unidades: 100 });
  });
});

// ─── Volumen (§0.6: el cálculo en TS debe caber en ~0,3 s con ~1 700 filas) ───

describe("volumen real", () => {
  it("1 700 filas × 15 meses × 13 meses de stock se calculan sin error, de forma determinista y en tiempo razonable", () => {
    const filas = Array.from({ length: 1700 }, (_, i) => ({ gml: `d0000000-0000-4000-8000-${String(i % 170).padStart(12, "0")}`, agr: `9000000${i % 9}-0000-4000-8000-000000000001`, eq: i % 6 === 0 ? `e0000000-0000-4000-8000-${String(i % 340).padStart(12, "0")}` : null, i }));
    const claves = new Set(filas.map((f) => claveDeFila({ gml_id: f.gml, equivalencia_id: f.eq, agrupacion_marca_id: f.agr })));
    const unicas = filas.filter((f, k) => filas.findIndex((g) => g.gml === f.gml && g.agr === f.agr && g.eq === f.eq) === k).slice(0, claves.size);
    const cerradaFilas = unicas.flatMap((f) => cerradaDeFila({ gml: f.gml, eq: f.eq, agr: f.agr, demanda: DEMANDA_CASO1.map((d, j) => d + ((f.i + j) % 40)) }));
    const meses = ["2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];
    const stock = mapaDeStock(...meses.map((m, k) => stockMes(m, unicas.map((f) => ({ gml: f.gml, eq: f.eq, agr: f.agr, cd: 200 + ((f.i * 7 + k * 13) % 900), tiendas: 100, venta: 120 + (f.i % 50) })))));
    const op = { cerrada: { filas: cerradaFilas, version_metodo: 4, huella_flujo: "h", periodo_referencia: null }, stock };
    const t0 = Date.now();
    const r = calcular(op);
    const ms = Date.now() - t0;
    expect(r.filas.length).toBe(unicas.length);
    expect(unicas.length).toBeGreaterThan(1000);
    expect(ms).toBeLessThan(5000);
    expect(calcular(op).totales).toEqual(r.totales);
  });
});
