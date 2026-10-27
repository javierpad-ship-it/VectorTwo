import { describe, expect, it } from "vitest";
import { claveDeFila } from "@/lib/flujo/filas";
import { ingresosDeFila, ingresosDeMarca, ingresosPorFila, type ResultadoIngresos } from "@/lib/flujo/ingresos";
import { repartirEntero } from "@/lib/proyeccion/reparto";
import { COMPRA, LINEA, registrosC09, registrosC12, registrosC15CargaInicial, registrosC20Lote, type RegistrosCompra } from "./compras.fixture";
import { AGR_M8, MARCA_M8, NODO_M8, RESOLVER, claveDenim } from "./flujo.soporte";

/** Regla 4 (entregas e ingresos), 4b y 31 (cancelar cierra el saldo) de la ficha 08; casos 4, 9, 11 y 26. */

const K = "2026-09";
const HASTA = "2027-12";
const MESES = ["2026-10", "2026-11", "2026-12", "2027-01", "2027-02"];

const calcular = (r: RegistrosCompra, kPrima = K, hasta = HASTA): ResultadoIngresos => ingresosPorFila({ ...r, kPrima, hasta, resolver: RESOLVER });
const serie = (res: ResultadoIngresos, clave = claveDenim) => ingresosDeFila(res.filas.get(clave), MESES);
const claveFila = (gml: string, agr: string) => claveDeFila({ gml_id: gml, equivalencia_id: null, agrupacion_marca_id: agr });
const total = (res: ResultadoIngresos, mes: string) => [...res.filas.values()].reduce((a, f) => a + (f.por_mes.get(mes) ?? 0), 0);

describe("ingresos de una línea específica (regla 4)", () => {
  it("una confirmada con una entrega en nov aporta 500 a DENIM × RECONOCIDO en nov", () => {
    expect(serie(calcular(registrosC12()))).toEqual([0, 500, 0, 0, 0]);
  });

  it("un borrador no cuenta; una cancelada tampoco", () => {
    expect(calcular(registrosC12({ estado: "borrador" })).filas.size).toBe(0);
    expect(calcular(registrosC12({ estado: "cancelada" })).filas.size).toBe(0);
  });

  it("línea de 500 con entregas nov 300 y dic 200: sin recepciones son 300 y 200", () => {
    expect(serie(calcular(registrosC12({ entregas: [["2026-11", 300], ["2026-12", 200]] })))).toEqual([0, 300, 200, 0, 0]);
  });

  it("100 recibidas en oct (> k'): FIFO deja nov en 200 y dic en 200; I_oct = 100", () => {
    const r = registrosC12({ entregas: [["2026-11", 300], ["2026-12", 200]], recepciones: [["2026-10", 100]] });
    expect(serie(calcular(r))).toEqual([100, 200, 200, 0, 0]);
  });

  it("350 recibidas: nov queda en 0 y dic en 150; I_oct = 350", () => {
    const r = registrosC12({ entregas: [["2026-11", 300], ["2026-12", 200]], recepciones: [["2026-10", 350]] });
    expect(serie(calcular(r))).toEqual([350, 0, 150, 0, 0]);
  });

  it("una entrega ≤ k' que nadie confirmó se proyecta en k'+1 con entrega vencida (nunca deja de contarse sola)", () => {
    const res = calcular(registrosC09());
    const clave = claveFila(NODO_M8.polo, AGR_M8.premium);
    expect(ingresosDeFila(res.filas.get(clave), MESES)).toEqual([500, 0, 0, 0, 0]);
    const fila = res.filas.get(clave)!;
    expect(fila.vencidas).toBe(500);
    expect(fila.candidatas).toHaveLength(1);
    expect(fila.candidatas[0]).toMatchObject({ vencida: true, pendiente: 500, compra_numero: "C-000009", boton: true, periodo: "2026-09" });
  });

  it("una recepción fechada ≤ k' no suma al flujo (ya está en el stock) pero sí cuenta como registrada en su mes", () => {
    const r = registrosC12({ entregas: [["2026-09", 300], ["2026-11", 200]], recepciones: [["2026-09", 300]] });
    const res = calcular(r);
    expect(serie(res)).toEqual([0, 200, 0, 0, 0]);
    expect(res.filas.get(claveDenim)!.recepciones_por_mes.get("2026-09")).toBe(300);
  });

  it("recibida del todo con recepciones ≤ k' → 0", () => {
    const r = registrosC12({ recepciones: [["2026-08", 200], ["2026-09", 300]], estado: "recibida" });
    expect(serie(calcular(r))).toEqual([0, 0, 0, 0, 0]);
    expect(calcular(r).filas.get(claveDenim)!.vencidas).toBe(0);
  });

  it("caso 9: 200 recibidas en oct → I_oct = 200 y 300 siguen en nov; al publicar oct (k' = oct) la recepción cuenta 0", () => {
    const r = registrosC12({ entregas: [["2026-11", 500]], recepciones: [["2026-10", 200]] });
    expect(serie(calcular(r))).toEqual([200, 300, 0, 0, 0]);
    const publicado = calcular(r, "2026-10");
    expect(ingresosDeFila(publicado.filas.get(claveDenim), ["2026-11", "2026-12"])).toEqual([300, 0]);
    expect(publicado.filas.get(claveDenim)!.recepciones_por_mes.get("2026-10")).toBe(200);
  });

  it("anti-duplicación: publicar oct baja I_oct en la recepción y la traslada al inventario; el pendiente de nov no cambia", () => {
    const r = registrosC12({ entregas: [["2026-11", 500]], recepciones: [["2026-10", 200]] });
    const antes = calcular(r);
    const despues = calcular(r, "2026-10");
    expect(total(antes, "2026-10")).toBe(200);
    expect(total(despues, "2026-10")).toBe(0);
    expect(total(antes, "2026-11")).toBe(total(despues, "2026-11"));
  });

  it("caso 26 (regla 31): cancelada con recepciones = saldo cerrado: pendientes 0 y las recepciones > k' siguen sumando", () => {
    const r = registrosC12({ entregas: [["2026-10", 300], ["2026-11", 200]], recepciones: [["2026-08", 100], ["2026-10", 200]], canceladas: 200, estado: "recibida", cancelada_at: "2026-10-20T00:00:00Z" });
    const res = calcular(r);
    expect(serie(res)).toEqual([200, 0, 0, 0, 0]);
    expect(res.filas.get(claveDenim)!.vencidas).toBe(0);
    expect(res.filas.get(claveDenim)!.candidatas).toHaveLength(0);
  });

  it("el destino intercompany_directo cuenta igual que el CD o una tienda", () => {
    const r = registrosC12();
    r.lineas[0].destino = "intercompany_directo";
    expect(serie(calcular(r))).toEqual([0, 500, 0, 0, 0]);
    r.lineas[0].destino = "tienda";
    r.lineas[0].tienda_id = "t01";
    expect(serie(calcular(r))).toEqual([0, 500, 0, 0, 0]);
  });

  it("lo programado por mes (E_m) cuenta las entregas enteras, estén recibidas o no", () => {
    const r = registrosC12({ entregas: [["2026-11", 300], ["2026-12", 200]], recepciones: [["2026-10", 350]] });
    const f = calcular(r).filas.get(claveDenim)!;
    expect(f.entregas_por_mes.get("2026-11")).toBe(300);
    expect(f.entregas_por_mes.get("2026-12")).toBe(200);
  });

  it("los ingresos de una marca (I^B) salen de las líneas con esa unidad de marca", () => {
    const res = calcular(registrosC12());
    expect(ingresosDeMarca(res.filas.get(claveDenim), MARCA_M8.alfa, MESES)).toEqual([0, 500, 0, 0, 0]);
    expect(ingresosDeMarca(res.filas.get(claveDenim), MARCA_M8.jh, MESES)).toEqual([0, 0, 0, 0, 0]);
  });
});

describe("lotes de una marca: repartos guardados por entrega (regla 4)", () => {
  const premium = (gml: string) => claveFila(gml, AGR_M8.premium);

  it("sin recepciones, cada entrega aporta su reparto guardado a DENIM, POLO y SANDALIA × PREMIUM", () => {
    const res = calcular(registrosC20Lote());
    expect(ingresosDeFila(res.filas.get(premium(NODO_M8.urbano)), ["2026-12", "2027-01", "2027-02"])).toEqual([236, 207, 147]);
    expect(ingresosDeFila(res.filas.get(premium(NODO_M8.polo)), ["2026-12", "2027-01", "2027-02"])).toEqual([117, 102, 73]);
    expect(ingresosDeFila(res.filas.get(premium(NODO_M8.sandalia)), ["2026-12", "2027-01", "2027-02"])).toEqual([47, 41, 30]);
    expect(total(res, "2026-12")).toBe(400);
    expect(total(res, "2027-01")).toBe(350);
    expect(total(res, "2027-02")).toBe(250);
  });

  it("con 300 recibidas en set (≤ k'), las entregas quedan en 100 / 350 / 250, cada una con el vector de su entrega", () => {
    const res = calcular(registrosC20Lote({ recepciones: [["2026-09", 300]] }));
    expect(total(res, "2026-12")).toBe(100);
    expect(total(res, "2027-01")).toBe(350);
    expect(total(res, "2027-02")).toBe(250);
    const esperadoDic = repartirEntero(100, [236, 117, 47])!;
    expect(ingresosDeFila(res.filas.get(premium(NODO_M8.urbano)), ["2026-12"])).toEqual([esperadoDic[0]]);
    expect(ingresosDeFila(res.filas.get(premium(NODO_M8.sandalia)), ["2026-12"])).toEqual([esperadoDic[2]]);
  });

  it("una recepción de lote con periodo > k' usa el vector de la entrega a la que se asigna por FIFO", () => {
    const res = calcular(registrosC20Lote({ recepciones: [["2026-10", 500]] }));
    // 400 de dic + 100 de ene por FIFO, recibidas en oct
    const dic = repartirEntero(400, [236, 117, 47])!;
    const ene = repartirEntero(100, [207, 102, 41])!;
    expect(ingresosDeFila(res.filas.get(premium(NODO_M8.urbano)), ["2026-10"])).toEqual([dic[0] + ene[0]]);
    expect(total(res, "2026-10")).toBe(500);
  });

  it("la suma por entrega se conserva siempre (Σ_f I_m = pendientes + recepciones > k')", () => {
    const r = registrosC20Lote({ recepciones: [["2026-11", 123], ["2026-09", 77]] });
    const res = calcular(r);
    const sumaMeses = (res: ResultadoIngresos) => [...res.filas.values()].reduce((a, f) => a + [...f.por_mes.values()].reduce((b, x) => b + x, 0), 0);
    expect(sumaMeses(res)).toBe(1000 - 77);
  });

  it("un lote confirmado sin reparto guardado no cuenta y se lista", () => {
    const r = registrosC20Lote();
    r.repartos.length = 0;
    const res = calcular(r);
    expect(res.filas.size).toBe(0);
    expect(res.sin_reparto).toEqual([LINEA.c20]);
  });

  it("las candidatas de un lote no llevan botón (0.13.0) y llevan la parte de su reparto en la fila", () => {
    const f = calcular(registrosC20Lote({ recepciones: [] }), "2026-12").filas.get(premium(NODO_M8.urbano))!;
    const vencida = f.candidatas.find((c) => c.vencida)!;
    expect(vencida).toMatchObject({ boton: false, tipo: "barrer_marca", pendiente: 236, periodo: "2026-12" });
  });
});

describe("otras compras", () => {
  it("la carga inicial con RECIBIDAS = 200 de 200 (caso 11/13) no suma al flujo", () => {
    const res = calcular(registrosC15CargaInicial());
    expect([...res.filas.values()].every((f) => f.por_mes.size === 0)).toBe(true);
  });

  it("lo que cae después del horizonte no entra a por_mes pero se cuenta fuera del horizonte", () => {
    const res = calcular(registrosC12({ entregas: [["2026-11", 200], ["2028-02", 300]] }), K, "2027-12");
    expect(serie(res)).toEqual([0, 200, 0, 0, 0]);
    expect(res.fuera_de_horizonte).toBe(300);
  });

  it("varias compras suman en la misma fila", () => {
    const a = registrosC12();
    const b = registrosC12();
    const res = calcular({
      compras: [...a.compras, { ...b.compras[0], id: COMPRA.c21, numero: "C-000021" }],
      lineas: [...a.lineas, { ...b.lineas[0], id: LINEA.c21, compra_id: COMPRA.c21 }],
      entregas: [...a.entregas, { ...b.entregas[0], id: "ent-21", linea_id: LINEA.c21 }],
      repartos: [],
      recepciones: [],
    });
    expect(serie(res)).toEqual([0, 1000, 0, 0, 0]);
  });
});
