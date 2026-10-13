import { describe, expect, it } from "vitest";
import { MEDIDAS_VENTA, type FilaCruda, type InformeMes, type MotivoExclusion } from "@/lib/ventas/tipos";
import { coincideConQlik, conciliarMes, estadoQlik } from "@/lib/ventas/informe";
import { informe as armar } from "./ventas.fixture";

const mes = (r: ReturnType<typeof armar>, periodo = "2026-09"): InformeMes => {
  const m = r.informe.meses.find((x) => x.periodo === periodo);
  if (!m) throw new Error(`falta el mes ${periodo}`);
  return m;
};
const aviso = (m: InformeMes, codigo: string) => m.avisos.find((a) => a.codigo === codigo);
const excl = (m: InformeMes, motivo: MotivoExclusion) => m.exclusiones.filter((e) => e.motivo === motivo);

/** Pseudoaleatorio con semilla fija (mulberry32). */
function aleatorio(semilla: number) {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("identidad archivo = cargado + exclusiones (regla 20)", () => {
  it("se cumple con datos aleatorios que mezclan todos los motivos (semilla fija)", () => {
    const rng = aleatorio(2026);
    const pick = <T,>(l: T[]) => l[Math.floor(rng() * l.length)];
    const filas: Partial<FilaCruda>[] = Array.from({ length: 3000 }, () => ({
      mes: pick(["Ago", "Set", "Set", "Set", "xx"]),
      tienda: pick(["LUKERS UNO", "LUKERS DOS", "CD LUKERS", "OFICINA CENTRAL", "LOCAL X", "", "TOTAL"]),
      genero: pick(["HOMBRE", "MUJER", "NIÑOS", "OTRO", ""]),
      mundo: pick(["CASUAL", "URBANO", "RI", "ZZ", ""]),
      linea: pick(["DENIM", "POLO", "BERMUDA", "QQ", ""]),
      equivalencia: pick(["", "-", "PANTALON VARIOS", "DENIM", "POLO CLASICO", "NO EXISTE"]),
      marca: pick(["ALFA", "BETA", "VIEJA", "NUEVA UNO", "-", "", "VARIOS"]),
      talla: pick(["Central", "Extrema", "Revisar", "-", "", "XL"]),
      unidades: pick(["0", "5", "-2", "7.4", "abc"]),
      venta_soles: pick(["0", "100", "250.55", "-30", "12,5"]),
      costo_vendido: pick(["0", "40", "100.1"]),
      stock_unidades: pick(["0", "9", "-1"]),
      stock_valorizado: pick(["0", "300", "50.25", "-10"]),
    }));
    const r = armar(filas);
    expect(r.informe.filas_archivo).toBe(3000);
    for (const m of r.informe.meses) {
      expect(m.identidad_ok, `mes ${m.periodo}`).toBe(true);
      for (const c of m.conciliacion) expect(c.descuadre, `${m.periodo} ${c.medida}`).toBe(0);
      expect(m.archivo.filas).toBe(m.cargado.filas + m.fusionadas + m.excluido.filas);
    }
    // Las filas sin mes no pertenecen a ningún mes y también cierran.
    const enMeses = r.informe.meses.reduce((s, m) => s + m.archivo.filas, 0);
    expect(enMeses + r.informe.sin_mes.filas).toBe(3000);
    expect(r.informe.sin_mes.filas).toBeGreaterThan(0);
  });

  it("las claves repetidas que se sumaron cuentan como fusionadas, no como excluidas", () => {
    const m = mes(armar([{ equivalencia: "PANTALON  VARIOS" }, { equivalencia: "pantalon varios" }, { marca: "BETA" }]));
    expect(m.archivo.filas).toBe(3);
    expect(m.cargado.filas).toBe(2);
    expect(m.fusionadas).toBe(1);
    expect(m.excluido.filas).toBe(0);
    expect(m.identidad_ok).toBe(true);
    const a = aviso(m, "claves_repetidas_se_suman");
    expect(a?.filas).toBe(1);
    expect(a?.detalle[0].valor).toContain("primera fila 1");
  });

  it("Central y Revisar de la misma combinación se fusionan tras mapear la talla", () => {
    const m = mes(armar([{ talla: "Central" }, { talla: "Revisar" }, { talla: "Extrema" }]));
    expect(m.cargado.filas).toBe(2);
    expect(m.fusionadas).toBe(1);
    expect(m.cargado.unidades).toBe(30);
    expect(aviso(m, "talla_revisar_a_centrales")?.filas).toBe(1);
    expect(aviso(m, "talla_revisar_a_centrales")?.detalle[0].valor).toBe("Revisar");
  });
});

describe("exclusiones agrupadas por valor", () => {
  it("errores y decisiones, con su primera fila y su peso", () => {
    const m = mes(
      armar([
        {},
        { tienda: "LOCAL X" },
        { tienda: "LOCAL X", marca: "BETA" },
        { tienda: "OFICINA CENTRAL" },
        { genero: "", mundo: "", linea: "" },
        { marca: "VIEJA" },
        { genero: "OTRO" },
        { equivalencia: "NO EXISTE" },
      ])
    );
    const desconocida = excl(m, "tienda_desconocida");
    expect(desconocida).toHaveLength(1);
    expect(desconocida[0]).toMatchObject({ valor: "LOCAL X", filas: 2, primera_fila: 2, tipo: "error", venta_soles: 2000 });
    expect(excl(m, "tienda_inactiva")[0]).toMatchObject({ valor: "OFICINA CENTRAL", tipo: "decision", filas: 1 });
    expect(excl(m, "sin_clasificar")).toHaveLength(1);
    expect(excl(m, "marca_inactiva")[0].valor).toBe("VIEJA");
    expect(excl(m, "genero_desconocido")[0].valor).toBe("OTRO");
    expect(excl(m, "equivalencia_inexistente")[0]).toMatchObject({
      valor: "HOMBRE / CASUAL / DENIM / NO EXISTE",
      combinacion: { genero: "HOMBRE", mundo: "CASUAL", linea: "DENIM", equivalencia: "NO EXISTE" },
    });
    // errores antes que decisiones
    const tipos = m.exclusiones.map((e) => e.tipo);
    expect(tipos.indexOf("decision")).toBeGreaterThan(tipos.lastIndexOf("error"));
    expect(m.resumen_exclusiones.find((x) => x.motivo === "tienda_desconocida")).toMatchObject({ filas: 2, grupos: 1 });
  });

  it("una talla desconocida cede ante un error de tienda (precedencia entre fases)", () => {
    const m = mes(armar([{ talla: "XL", tienda: "LOCAL X" }, { talla: "XL" }]));
    expect(excl(m, "tienda_desconocida")[0].filas).toBe(1);
    expect(excl(m, "talla_desconocida")[0]).toMatchObject({ valor: "XL", filas: 1, primera_fila: 2 });
  });

  it("una combinación inactiva o desconocida cede ante una tienda inexistente, y la marca inactiva ante la combinación", () => {
    const m = mes(
      armar([
        { tienda: "LOCAL X", genero: "OTRO" },
        { genero: "OTRO", marca: "VIEJA" },
        { genero: "NIÑOS", marca: "VIEJA" },
        { marca: "VIEJA" },
      ])
    );
    expect(excl(m, "tienda_desconocida")[0].filas).toBe(1);
    expect(excl(m, "genero_desconocido")[0].filas).toBe(1);
    expect(excl(m, "genero_inactivo")[0].filas).toBe(1);
    expect(excl(m, "marca_inactiva")[0].filas).toBe(1);
  });

  it("nodo inexistente frente a equivalencia inexistente (regla 29) y nodo inactivo", () => {
    const m = mes(
      armar([
        { genero: "MUJER", mundo: "URBANO", linea: "DENIM" },
        { equivalencia: "OTRA" },
        { genero: "HOMBRE", mundo: "CASUAL", linea: "POLO", equivalencia: "" },
        { genero: "HOMBRE", mundo: "URBANO", linea: "POLO", equivalencia: "POLO CLASICO" },
      ])
    );
    expect(excl(m, "nodo_inexistente")).toHaveLength(1);
    expect(excl(m, "equivalencia_inexistente")).toHaveLength(1);
    expect(excl(m, "nodo_inactivo")).toHaveLength(1);
    expect(excl(m, "equivalencia_inactiva")).toHaveLength(1);
  });

  it("las combinaciones desconocidas salen listas para el formato árbol (la equivalencia como vino)", () => {
    const r = armar([
      { equivalencia: "-", genero: "MUJER", mundo: "URBANO", linea: "POLO" },
      { equivalencia: "", genero: "MUJER", mundo: "URBANO", linea: "POLO", marca: "BETA" },
      { linea: "NUEVA LINEA", equivalencia: "" },
    ]);
    const lista = r.combinacionesDesconocidas;
    expect(lista.map((c) => [c.motivo, c.linea, c.equivalencia, c.filas])).toEqual(
      expect.arrayContaining([
        ["nodo_inexistente", "POLO", "-", 1],
        ["nodo_inexistente", "POLO", "", 1],
        ["linea_desconocida", "NUEVA LINEA", "", 1],
      ])
    );
    expect(lista).toHaveLength(3);
  });
});

describe("bloqueo por mes (regla 20)", () => {
  const sanas = (n: number) => Array.from({ length: n }, (_, i) => ({ marca: `M${i}` }));

  it("errores del 2 % o más en filas bloquean el mes; las exclusiones por decisión nunca", () => {
    const bloqueado = mes(armar([...sanas(98), { tienda: "LOCAL X" }, { tienda: "LOCAL Y" }]));
    expect(bloqueado.errores.pct_filas).toBe(2);
    expect(bloqueado.bloqueado).toBe(true);
    const libre = mes(armar([...sanas(98), { tienda: "LOCAL X" }]));
    expect(libre.bloqueado).toBe(false);
    const soloDecision = mes(armar([...sanas(10), ...Array.from({ length: 10 }, () => ({ tienda: "OFICINA CENTRAL" }))]));
    expect(soloDecision.bloqueado).toBe(false);
    expect(soloDecision.resumen_exclusiones[0].resaltada).toBe(true);
  });

  it("también bloquea por peso en venta o en stock valorizado", () => {
    const porVenta = mes(armar([...sanas(99), { tienda: "LOCAL X", venta_soles: "100000" }]));
    expect(porVenta.errores.pct_filas).toBe(1);
    expect(porVenta.errores.pct_venta).toBeGreaterThan(2);
    expect(porVenta.bloqueado).toBe(true);
    const porStock = mes(armar([...sanas(99), { tienda: "LOCAL X", stock_valorizado: "100000" }]));
    expect(porStock.errores.pct_stock).toBeGreaterThan(2);
    expect(porStock.bloqueado).toBe(true);
  });

  it("cada mes decide por su cuenta", () => {
    const r = armar([...sanas(10).map((f) => ({ ...f, mes: "Ago" })), ...sanas(10).map((f) => ({ ...f, mes: "Set" })), { mes: "Ago", tienda: "LOCAL X" }]);
    expect(mes(r, "2026-08").bloqueado).toBe(true);
    expect(mes(r, "2026-09").bloqueado).toBe(false);
  });

  it("un diagnóstico global bloquea el archivo entero", () => {
    const comas = Array.from({ length: 50 }, () => ({ venta_soles: "12,5" }));
    const r = armar([...sanas(60), ...comas]);
    expect(r.informe.diagnosticos.map((d) => d.codigo)).toContain("coma_decimal");
    expect(r.informe.bloqueado_global).toBe(true);
    expect(armar(sanas(5)).informe.bloqueado_global).toBe(false);
    const vacia = armar([{ tienda: "" }, { tienda: "" }]);
    expect(vacia.informe.diagnosticos.find((d) => d.codigo === "columna_vacia")?.mensaje).toContain("Tienda");
  });

  it("las filas sin mes se informan aparte", () => {
    const r = armar([{}, { mes: "xx" }]);
    expect(r.informe.sin_mes.filas).toBe(1);
    expect(r.informe.sin_mes.exclusiones[0].motivo).toBe("mes_invalido");
    expect(r.informe.diagnosticos.find((d) => d.codigo === "filas_sin_mes")).toBeTruthy();
  });
});

describe("conciliación contra QlikView (regla 21)", () => {
  it("unidades y stock en unidades coinciden solo con diferencia 0", () => {
    expect(coincideConQlik("unidades", 100, 100)).toBe(true);
    expect(coincideConQlik("unidades", 100, 101)).toBe(false);
    expect(coincideConQlik("stock_unidades", 5, 5)).toBe(true);
    expect(coincideConQlik("stock_unidades", 5, 6)).toBe(false);
  });

  it("soles coinciden con diferencia relativa menor a 0,1 % (0,0999 % sí, 0,1 % no)", () => {
    expect(coincideConQlik("venta_soles", 1_000_000, 1_000_999)).toBe(true); // 0,0999 %
    expect(coincideConQlik("venta_soles", 1_000_000, 1_001_000)).toBe(false); // 0,1 %
    expect(coincideConQlik("costo_vendido", 1_000_000, 999_001)).toBe(true);
    expect(coincideConQlik("stock_valorizado", 1_000_000, 998_999)).toBe(false);
    expect(coincideConQlik("venta_soles", 0, 0)).toBe(true);
    expect(coincideConQlik("venta_soles", 0, 1)).toBe(false);
  });

  it("sin totales de QlikView no hay conciliación y no es un error", () => {
    expect(estadoQlik("venta_soles", null, 100)).toBe("sin_qlik");
    expect(estadoQlik("venta_soles", undefined, 100)).toBe("sin_qlik");
    const m = mes(armar([{}]));
    expect(m.conciliacion.every((c) => c.estado_qlik === "sin_qlik" && c.qlik === null)).toBe(true);
    expect(m.bloqueado).toBe(false);
  });

  it("la tabla de un mes con totales de QlikView", () => {
    const r = armar([{ unidades: "100", venta_soles: "10000", costo_vendido: "4000", stock_unidades: "50", stock_valorizado: "2000" }], {
      totalesQlik: { "2026-09": { unidades: 100, venta_soles: 10_005, stock_unidades: 51 } },
    });
    const c = Object.fromEntries(mes(r).conciliacion.map((x) => [x.medida, x]));
    expect(c.unidades.estado_qlik).toBe("coincide");
    expect(c.venta_soles.estado_qlik).toBe("coincide"); // 0,05 %
    expect(c.venta_soles.diferencia_qlik).toBe(-5);
    expect(c.venta_soles.comparable).toBe(10_000);
    expect(c.stock_unidades.estado_qlik).toBe("difiere");
    expect(c.costo_vendido.estado_qlik).toBe("sin_qlik");
    expect(MEDIDAS_VENTA.every((k) => c[k].descuadre === 0)).toBe(true);
  });

  it("conciliarMes expone archivo, no comparable, comparable, excluido y cargado", () => {
    const m = mes(armar([{}, { tienda: "OFICINA CENTRAL" }]));
    const v = m.conciliacion.find((x) => x.medida === "venta_soles");
    // Sin filas sin clasificar ni de totales, comparable = archivo.
    expect(v).toMatchObject({ archivo: 2000, no_comparable: 0, comparable: 2000, excluido: 1000, cargado: 1000, descuadre: 0 });
    expect(conciliarMes).toBeTypeOf("function");
  });
});

describe("avisos y notas (reglas 22, 23 y 26)", () => {
  it("fuera_de_vigencia: antes de la apertura; el mes de apertura cuenta como vigente", () => {
    // LUKERS DOS abrió el 2024-06-15.
    const antes = mes(armar([{ tienda: "LUKERS DOS", anio: "2024", mes: "May" }]), "2024-05");
    expect(aviso(antes, "fuera_de_vigencia")?.detalle[0].valor).toBe("LUKERS DOS · 2024-05");
    const deApertura = mes(armar([{ tienda: "LUKERS DOS", anio: "2024", mes: "Jun" }]), "2024-06");
    expect(aviso(deApertura, "fuera_de_vigencia")).toBeUndefined();
    const despues = mes(armar([{ tienda: "LUKERS DOS", mes: "Ene" }]), "2026-01");
    expect(aviso(despues, "fuera_de_vigencia")).toBeUndefined();
  });

  it("fuera_de_vigencia después del cierre y sin fechas no hay aviso", () => {
    const tiendas = [
      { id: "t-c", codigo: "R1", nombre: "CERRADA", tipo: "Tienda", fecha_apertura: "2020-01-01", fecha_cierre: "2026-03-20", activo: true },
      { id: "t-s", codigo: "R2", nombre: "SIN FECHAS", tipo: "Tienda", fecha_apertura: null, fecha_cierre: null, activo: true },
    ];
    const r = armar([{ tienda: "CERRADA", mes: "Abr" }, { tienda: "SIN FECHAS", mes: "Abr" }, { tienda: "CERRADA", mes: "Mar" }], { tiendas });
    expect(aviso(mes(r, "2026-04"), "fuera_de_vigencia")?.detalle).toHaveLength(1);
    expect(aviso(mes(r, "2026-03"), "fuera_de_vigencia")).toBeUndefined();
  });

  it("venta_en_cd: venta o costo en el centro de distribución; solo stock no avisa", () => {
    const conVenta = mes(armar([{ tienda: "CD LUKERS" }]));
    expect(aviso(conVenta, "venta_en_cd")?.filas).toBe(1);
    const soloStock = mes(armar([{ tienda: "CD LUKERS", unidades: "0", venta_soles: "0", costo_vendido: "0" }]));
    expect(aviso(soloStock, "venta_en_cd")).toBeUndefined();
  });

  it("comparación con el mes anterior (>25 %): del archivo o del ya publicado; sin anterior no se calcula", () => {
    const filas = [
      ...Array.from({ length: 4 }, (_, i) => ({ mes: "Ago", marca: `A${i}` })),
      ...Array.from({ length: 8 }, (_, i) => ({ mes: "Set", marca: `A${i}` })),
    ];
    const r = armar(filas);
    expect(aviso(mes(r, "2026-09"), "comparacion_mes_anterior")?.detalle.map((d) => d.valor.split(":")[0])).toEqual(["Filas", "Venta", "Stock valorizado"]);
    expect(aviso(mes(r, "2026-08"), "comparacion_mes_anterior")).toBeUndefined();
    const conAnterior = armar([{ mes: "Set" }, { mes: "Set", marca: "BETA" }], {
      anterior: { periodo: "2026-08", filas: 2, venta_soles: 2000, stock_valorizado: 1600 },
    });
    expect(aviso(mes(conAnterior), "comparacion_mes_anterior")).toBeUndefined();
    const distinto = armar([{ mes: "Set" }], { anterior: { periodo: "2026-08", filas: 2, venta_soles: 2000, stock_valorizado: 1600 } });
    expect(aviso(mes(distinto), "comparacion_mes_anterior")).toBeTruthy();
    const noEsElInmediato = armar([{ mes: "Set" }], { anterior: { periodo: "2026-07", filas: 99, venta_soles: 9, stock_valorizado: 9 } });
    expect(aviso(mes(noEsElInmediato), "comparacion_mes_anterior")).toBeUndefined();
  });

  it("stock negativo, unidades con decimales, mes abierto y notas de cifras", () => {
    const m = mes(
      armar([
        { stock_unidades: "-3" },
        { marca: "BETA", unidades: "2.6" },
        { marca: "GAMA", unidades: "-4" },
        { marca: "DELTA", unidades: "3", venta_soles: "0" },
        { marca: "EPS", unidades: "0", venta_soles: "50", costo_vendido: "0" },
        { marca: "ZETA", venta_soles: "100", costo_vendido: "150" },
        { marca: "ETA", unidades: "1", venta_soles: "0", costo_vendido: "20" },
      ])
    );
    expect(aviso(m, "stock_negativo")?.severidad).toBe("aviso");
    expect(aviso(m, "unidades_con_decimales")?.filas).toBe(1);
    expect(aviso(m, "unidades_negativas")?.severidad).toBe("nota");
    expect(aviso(m, "unidades_sin_venta")?.filas).toBe(2);
    expect(aviso(m, "venta_sin_unidades")?.filas).toBe(1);
    expect(aviso(m, "costo_mayor_que_venta")?.filas).toBe(1);
    expect(aviso(m, "costo_sin_venta")?.filas).toBe(2);
    expect(aviso(m, "cifras_enteras")).toBeDefined();
    expect(aviso(m, "mes_abierto")).toBeUndefined();
    const abierto = mes(armar([{ mes: "Oct" }]), "2026-10");
    expect(aviso(abierto, "mes_abierto")?.severidad).toBe("aviso");
  });

  it("fechas con día distinto de 1: el día se ignora y se cuenta en una nota", () => {
    const m = mes(armar([{ anio: "", mes: "15/09/2026" }, { anio: "", mes: "2026-09", marca: "BETA" }]));
    expect(m.archivo.filas).toBe(2);
    expect(aviso(m, "fechas_con_dia")).toMatchObject({ severidad: "nota", filas: 1 });
  });

  it("cifras enteras: con céntimos reales la nota desaparece; nunca bloquea", () => {
    const m = mes(armar([{ venta_soles: "100.55" }]));
    expect(aviso(m, "cifras_enteras")).toBeUndefined();
    const enteras = mes(armar([{}]));
    expect(enteras.bloqueado).toBe(false);
    expect(aviso(enteras, "cifras_enteras")?.severidad).toBe("nota");
  });

  it("severidades: ningún aviso o nota bloquea; los de red de seguridad salen en rojo", () => {
    const m = mes(armar([{ stock_unidades: "0", stock_valorizado: "0" }]));
    const roja = aviso(m, "stock_en_cero");
    expect(roja?.rojo).toBe(true);
    expect(m.bloqueado).toBe(false);
    for (const a of m.avisos) expect(["aviso", "nota"]).toContain(a.severidad);
  });

  it("plegado salvo que pese más del 1 % de la venta o del stock", () => {
    const pesado = mes(armar([{ marca: "A", unidades: "-1" }, { marca: "B", venta_soles: "1000000" }]));
    expect(aviso(pesado, "unidades_negativas")?.plegado).toBe(false);
    const ligero = mes(armar([{ marca: "A", unidades: "-1", venta_soles: "1", stock_valorizado: "1" }, { marca: "B", venta_soles: "1000000", stock_valorizado: "1000000" }]));
    expect(aviso(ligero, "unidades_negativas")?.plegado).toBe(true);
  });
});

describe("huella de stock y red de seguridad (reglas 24 y 26)", () => {
  const meses = (stockPorMes: Record<string, string>) =>
    Object.entries(stockPorMes).flatMap(([m, s]) => [{ mes: m, stock_unidades: s, stock_valorizado: String(Number(s) * 10) }]);

  it("un mes pasado con stock en cero en todas las filas dispara stock_en_cero", () => {
    const r = armar(meses({ Ago: "0", Set: "5" }));
    expect(aviso(mes(r, "2026-08"), "stock_en_cero")).toBeDefined();
    expect(aviso(mes(r, "2026-09"), "stock_en_cero")).toBeUndefined();
    expect(mes(r, "2026-08").huella_stock).toEqual({ filas_con_stock: 0, stock_unidades: 0, stock_valorizado: 0 });
  });

  it("dos meses del archivo con la misma huella disparan stock_identico_a_otro_mes", () => {
    const r = armar(meses({ Jul: "7", Ago: "7", Set: "9" }));
    expect(aviso(mes(r, "2026-07"), "stock_identico_a_otro_mes")).toBeDefined();
    expect(aviso(mes(r, "2026-08"), "stock_identico_a_otro_mes")).toBeDefined();
    expect(aviso(mes(r, "2026-09"), "stock_identico_a_otro_mes")).toBeUndefined();
  });

  it("también contra los meses ya publicados, pero no contra el mismo periodo que se reemplaza", () => {
    const huellas = [{ periodo: "2026-05", filas_con_stock: 1, stock_unidades: 7, stock_valorizado: 70 }];
    const r = armar(meses({ Ago: "7" }), { huellas });
    expect(aviso(mes(r, "2026-08"), "stock_identico_a_otro_mes")?.mensaje).toContain("2026-05");
    const mismo = armar(meses({ May: "7" }), { huellas });
    expect(aviso(mes(mismo, "2026-05"), "stock_identico_a_otro_mes")).toBeUndefined();
  });

  it("dos meses reales distintos nunca coinciden en las tres cifras", () => {
    const r = armar(meses({ Jul: "7", Ago: "8" }));
    expect(aviso(mes(r, "2026-07"), "stock_identico_a_otro_mes")).toBeUndefined();
  });

  it("un mes abierto sin stock no dispara stock_en_cero", () => {
    const r = armar([{ mes: "Oct", stock_unidades: "0", stock_valorizado: "0" }]);
    expect(aviso(mes(r, "2026-10"), "stock_en_cero")).toBeUndefined();
  });
});

describe("estado frente a lo ya publicado y archivo truncado", () => {
  const publicada = (extra: Partial<{ filas: number; venta_soles: number }> = {}) => ({
    periodo: "2026-09",
    publicada: {
      id: "c1",
      publicada_at: "2026-10-09T15:02:11Z",
      usuario_nombre: "Ana",
      filas: 1,
      unidades: 10,
      venta_soles: 1000,
      costo_vendido: 400,
      stock_unidades: 20,
      stock_valorizado: 800,
      ...extra,
    },
    en_curso: null,
  });
  const huella = [{ periodo: "2026-09", filas_con_stock: 1, stock_unidades: 20, stock_valorizado: 800 }];

  it("mes nuevo, mes que reemplaza y mes idéntico", () => {
    expect(mes(armar([{}])).estado).toBe("nuevo");
    expect(mes(armar([{}], { periodos: [publicada({ venta_soles: 999 })], huellas: huella })).estado).toBe("reemplaza");
    const identico = mes(armar([{}], { periodos: [publicada()], huellas: huella }));
    expect(identico.estado).toBe("identico");
    expect(identico.publicada?.id).toBe("c1");
    // sin huella publicada no se puede afirmar que es idéntico
    expect(mes(armar([{}], { periodos: [publicada()] })).estado).toBe("reemplaza");
  });

  it("la hoja de exactamente 65 536 filas es un diagnóstico que no bloquea", () => {
    const r = armar([{}], { posiblementeTruncado: true });
    const d = r.informe.diagnosticos.find((x) => x.codigo === "archivo_posiblemente_truncado");
    expect(d?.bloqueante).toBe(false);
    expect(r.informe.bloqueado_global).toBe(false);
    expect(armar([{}]).informe.diagnosticos).toHaveLength(0);
  });
});

describe("marcas nuevas en el reporte (regla 30)", () => {
  it("se listan con filas, venta y stock, ordenadas por venta, con posible_tipeo en las de 1 o 2 filas", () => {
    const filas: Partial<FilaCruda>[] = [
      { marca: "NUEVA GRANDE", venta_soles: "5000" },
      { marca: "NUEVA GRANDE", venta_soles: "5000", talla: "Extrema" },
      { marca: "NUEVA GRANDE", venta_soles: "5000", tienda: "LUKERS DOS" },
      { marca: "ALFAA", venta_soles: "10" },
      { marca: "-", venta_soles: "300" },
      { marca: "ALFA" },
    ];
    const nuevas = armar(filas).informe.marcas_nuevas;
    expect(nuevas.map((m) => m.nombre)).toEqual(["NUEVA GRANDE", "SIN MARCA", "ALFAA"]);
    expect(nuevas[0]).toMatchObject({ filas: 3, venta_soles: 15000, posible_tipeo: false, comodin: false });
    expect(nuevas[1]).toMatchObject({ comodin: true, posible_tipeo: false });
    expect(nuevas[2]).toMatchObject({ posible_tipeo: true, parecida: "ALFA", filas: 1 });
  });

  it("una marca nueva cuyas filas se excluyen no aparece", () => {
    const nuevas = armar([{ marca: "FANTASMA", tienda: "LOCAL X" }]).informe.marcas_nuevas;
    expect(nuevas).toHaveLength(0);
  });
});

describe("idempotencia (regla 27)", () => {
  it("el mismo archivo da el mismo informe y las mismas filas a cargar", () => {
    const filas = Array.from({ length: 200 }, (_, i) => ({ marca: i % 7 === 0 ? "BETA" : `X${i % 13}`, venta_soles: String(i), talla: i % 3 ? "Central" : "Revisar" }));
    const a = armar(filas);
    const b = armar(filas);
    expect(JSON.stringify(b.informe)).toBe(JSON.stringify(a.informe));
    expect([...b.consolidado.meses.get("2026-09")!.venta]).toEqual([...a.consolidado.meses.get("2026-09")!.venta]);
  });
});
