import { describe, expect, it } from "vitest";
import { armarReporteMes } from "@/lib/ventas/informe";
import { tablaCombinacionesDesconocidas } from "@/lib/ventas/descargas";
import { totalReasignadas } from "@/lib/ventas/recalcular";
import { UMBRAL_BLOQUEO_ERRORES, type FilaCruda, type InformeMes } from "@/lib/ventas/tipos";
import { ARBOL, informe as armar, mapeo } from "./ventas.fixture";

/**
 * Informe con mapeos (M5b, reglas 7 a 9 de la ficha 05b): identidad exacta,
 * bloqueo del 2 % después de aplicar mapeos, avisos con el detalle
 * `ORIGEN → DESTINO` y descargas sin las reasignadas. Datos sintéticos.
 */

const mes = (r: ReturnType<typeof armar>, periodo = "2026-09"): InformeMes => {
  const m = r.informe.meses.find((x) => x.periodo === periodo);
  if (!m) throw new Error(`falta el mes ${periodo}`);
  return m;
};
const aviso = (m: InformeMes, codigo: string) => m.avisos.find((a) => a.codigo === codigo);

const M_JEAN = mapeo("m-jean", ["HOMBRE", "CASUAL", "DENIM", "JEAN"], "e1s");
const M_CHOMPA = mapeo("m-chompa", ["HOMBRE", "CASUAL", "CHOMPA", "*"], "e1g");

/** Filas del escenario base: una nativa, una reasignada que colisiona con ella, una reasignada con comodín y un error sin mapeo. */
const ESCENARIO: Partial<FilaCruda>[] = [
  {}, // nativa: PANTALON VARIOS (e1s), venta 1000
  { equivalencia: "JEAN", venta_soles: "500" }, // reasignada a e1s, misma clave que la nativa
  { linea: "CHOMPA", equivalencia: "-", venta_soles: "200" }, // reasignada por comodín a e1g
  { equivalencia: "FOO", venta_soles: "300" }, // sin mapeo: error
];

describe("regla 7: la identidad cierra con mapeos", () => {
  it("escenario base: reasignadas dentro de lo cargado y fusionadas, archivo = cargadas + fusionadas + excluidas", () => {
    const m = mes(armar(ESCENARIO, { mapeos: [M_JEAN, M_CHOMPA] }));
    expect(m.archivo.filas).toBe(4);
    expect(m.cargado.filas).toBe(2); // e1s (nativa + JEAN fusionadas) y e1g
    expect(m.fusionadas).toBe(1);
    expect(m.excluido.filas).toBe(1);
    expect(m.archivo.filas).toBe(m.cargado.filas + m.fusionadas + m.excluido.filas);
    expect(m.identidad_ok).toBe(true);
    for (const c of m.conciliacion) expect(c.descuadre, c.medida).toBe(0);
    expect(m.cargado.venta_soles).toBe(1700);
    expect(m.reasignadas).toMatchObject({ filas: 2, venta_soles: 700, unidades: 20 });
    expect(m.mapeos_aplicados).toEqual(["m-chompa", "m-jean"]);
  });

  it("una reasignada que coincide en clave con una nativa se suma y cuenta como fusionada; el aviso de claves repetidas lo dice", () => {
    const m = mes(armar(ESCENARIO, { mapeos: [M_JEAN, M_CHOMPA] }));
    const rep = aviso(m, "claves_repetidas_se_suman");
    expect(rep?.filas).toBe(1);
    expect(rep?.mensaje).toContain("reasignadas por mapeo");
    // sin mapeos no hay fusión ni mención
    const sin = mes(armar(ESCENARIO));
    expect(sin.fusionadas).toBe(0);
    expect(aviso(sin, "claves_repetidas_se_suman")).toBeUndefined();
  });

  it("dos reasignadas que no chocan con nativas no mencionan mapeos en claves repetidas", () => {
    const m = mes(armar([{ equivalencia: "JEAN" }, { equivalencia: "JEAN" }, { linea: "CHOMPA", equivalencia: "-" }], { mapeos: [M_JEAN, M_CHOMPA] }));
    const rep = aviso(m, "claves_repetidas_se_suman");
    expect(rep?.filas).toBe(1); // las dos JEAN comparten clave
    expect(rep?.mensaje).toContain("reasignadas por mapeo"); // aportaron las dos filas al mismo registro: también se dice
  });

  it("propiedad (semilla fija) con orígenes mapeados, colisiones de clave y todos los motivos", () => {
    const mapeos = [
      M_JEAN,
      M_CHOMPA,
      mapeo("m-inc", ["", "CASUAL", "DENIM", "PANTALON VARIOS"], "e1s"),
      mapeo("m-inc2", ["HOMBRE", "", "", "*"], "e1g"),
      mapeo("m-g", ["OTRO", "CASUAL", "DENIM", "*"], "e1l"),
      mapeo("m-roto", ["HOMBRE", "ZZ", "DENIM", "*"], "e3x"), // destino no vigente
      mapeo("m-inactivo", ["MUJER", "URBANO", "DENIM", "*"], "e2g", false),
    ];
    for (const semilla of [1, 7, 2026, 90210, 424242]) {
      const rng = aleatorioSemilla(semilla);
      const pick = <T,>(l: T[]) => l[Math.floor(rng() * l.length)];
      const filas: Partial<FilaCruda>[] = Array.from({ length: 2500 }, () => ({
        mes: pick(["Ago", "Set", "Set", "Set", "xx"]),
        tienda: pick(["LUKERS UNO", "LUKERS UNO", "LUKERS DOS", "CD LUKERS", "OFICINA CENTRAL", "LOCAL X", "", "TOTAL"]),
        genero: pick(["HOMBRE", "HOMBRE", "MUJER", "NIÑOS", "OTRO", ""]),
        mundo: pick(["CASUAL", "CASUAL", "URBANO", "RI", "ZZ", ""]),
        linea: pick(["DENIM", "DENIM", "POLO", "BERMUDA", "CHOMPA", ""]),
        equivalencia: pick(["", "-", "PANTALON VARIOS", "PANTALON VARIOS", "JEAN", "DENIM", "POLO CLASICO", "NO EXISTE"]),
        marca: pick(["ALFA", "BETA", "VIEJA", "NUEVA UNO", "-", "VARIOS"]),
        talla: pick(["Central", "Extrema", "Revisar", "-", "", "XL"]),
        unidades: pick(["0", "5", "-2", "7.4", "abc"]),
        venta_soles: pick(["0", "100", "250.55", "-30", "12,5"]),
        costo_vendido: pick(["0", "40", "100.1"]),
        stock_unidades: pick(["0", "9", "-1"]),
        stock_valorizado: pick(["0", "300", "50.25", "-10"]),
      }));
      const r = armar(filas, { mapeos });
      let reasignadasTotal = 0;
      for (const m of r.informe.meses) {
        expect(m.identidad_ok, `semilla ${semilla} mes ${m.periodo}`).toBe(true);
        for (const c of m.conciliacion) expect(c.descuadre, `semilla ${semilla} ${m.periodo} ${c.medida}`).toBe(0);
        expect(m.archivo.filas).toBe(m.cargado.filas + m.fusionadas + m.excluido.filas);
        // reasignadas ⊆ cargado: cada fila reasignada está cargada (sola o fusionada con otra de su clave).
        expect(m.reasignadas.filas).toBeLessThanOrEqual(m.cargado.filas + m.fusionadas);
        expect(m.reasignadas.filas).toBeLessThanOrEqual(m.archivo.filas);
        reasignadasTotal += m.reasignadas.filas;
        const a = aviso(m, "reasignadas_por_mapeo");
        expect(a?.filas ?? 0).toBe(m.reasignadas.filas);
      }
      expect(totalReasignadas(r.informe)).toBe(reasignadasTotal);
      expect(reasignadasTotal, `semilla ${semilla}`).toBeGreaterThan(0);
    }
  });
});

describe("regla 8: el bloqueo del 2 % se calcula después de aplicar mapeos", () => {
  const filas = (n: number, extra: Partial<FilaCruda>): Partial<FilaCruda>[] => Array.from({ length: n }, () => ({ ...extra }));

  it("un mes bloqueado solo por combinaciones mapeadas queda cargable", () => {
    const datos = [...filas(90, {}), ...filas(10, { equivalencia: "JEAN" })];
    const sin = mes(armar(datos));
    expect(sin.errores.pct_filas).toBeGreaterThanOrEqual(UMBRAL_BLOQUEO_ERRORES * 100);
    expect(sin.bloqueado).toBe(true);
    const con = mes(armar(datos, { mapeos: [M_JEAN] }));
    expect(con.errores.maximo).toBe(0);
    expect(con.bloqueado).toBe(false);
    expect(con.identidad_ok).toBe(true);
  });

  it("lo que sigue sin mapear sí pesa: 3 de 100 sin mapeo bloquean, 1 de 100 no", () => {
    const base = [...filas(60, {}), ...filas(36, { equivalencia: "JEAN" })];
    expect(mes(armar([...base, ...filas(4, { equivalencia: "FOO" })], { mapeos: [M_JEAN] })).bloqueado).toBe(true);
    expect(mes(armar([...base, ...filas(1, { equivalencia: "FOO" })], { mapeos: [M_JEAN] })).bloqueado).toBe(false);
  });

  it("un mapeo con destino no vigente no ayuda: las filas siguen siendo error y bloquean", () => {
    const datos = [...filas(90, {}), ...filas(10, { equivalencia: "JEAN" })];
    const roto = mapeo("m-roto", ["HOMBRE", "CASUAL", "DENIM", "JEAN"], "e3x");
    const m = mes(armar(datos, { mapeos: [roto] }));
    expect(m.bloqueado).toBe(true);
    expect(m.reasignadas.filas).toBe(0);
    expect(m.exclusiones.find((e) => e.motivo === "equivalencia_inexistente")?.filas).toBe(10);
  });
});

describe("regla 9: avisos y descargas", () => {
  it("reasignadas_por_mapeo suma exactamente las filas y medidas con mapeo y agrupa por `ORIGEN → DESTINO`", () => {
    const m = mes(armar(ESCENARIO, { mapeos: [M_JEAN, M_CHOMPA] }));
    const a = aviso(m, "reasignadas_por_mapeo");
    expect(a).toBeDefined();
    expect(a?.severidad).toBe("aviso");
    expect(a?.rojo).toBe(false);
    expect(a?.filas).toBe(m.reasignadas.filas);
    expect(a?.venta_soles).toBe(m.reasignadas.venta_soles);
    expect(a?.costo_vendido).toBe(m.reasignadas.costo_vendido);
    expect(a?.stock_unidades).toBe(m.reasignadas.stock_unidades);
    expect(a?.stock_valorizado).toBe(m.reasignadas.stock_valorizado);
    const valores = a?.detalle.map((d) => d.valor).sort();
    expect(valores).toEqual([
      "HOMBRE / CASUAL / CHOMPA / CHOMPA → HOMBRE / CASUAL / DENIM / SIN EQUIVALENCIA",
      "HOMBRE / CASUAL / DENIM / JEAN → HOMBRE / CASUAL / DENIM / PANTALON VARIOS",
    ]);
    const jean = a?.detalle.find((d) => d.valor.includes("JEAN"));
    expect(jean).toMatchObject({ filas: 1, venta_soles: 500, stock_valorizado: 800 });
  });

  it("se pliega por debajo del 1 % de la venta y del stock, y se abre por encima", () => {
    const poco = mes(armar([...Array.from({ length: 200 }, () => ({})), { equivalencia: "JEAN", venta_soles: "1", stock_valorizado: "1" }], { mapeos: [M_JEAN] }));
    expect(aviso(poco, "reasignadas_por_mapeo")?.plegado).toBe(true);
    const mucho = mes(armar([{}, { equivalencia: "JEAN" }], { mapeos: [M_JEAN] }));
    expect(aviso(mucho, "reasignadas_por_mapeo")?.plegado).toBe(false);
  });

  it("sin reasignaciones no hay aviso ni reasignadas", () => {
    const m = mes(armar([{}, { equivalencia: "FOO" }], { mapeos: [M_JEAN] }));
    expect(aviso(m, "reasignadas_por_mapeo")).toBeUndefined();
    expect(m.reasignadas.filas).toBe(0);
    expect(m.mapeos_aplicados).toEqual([]);
  });

  it("`tablaCombinacionesDesconocidas` no incluye las reasignadas (ya no son desconocidas) pero sí las demás", () => {
    const r = armar(ESCENARIO, { mapeos: [M_JEAN, M_CHOMPA] });
    const tabla = tablaCombinacionesDesconocidas(r.combinacionesDesconocidas);
    expect(tabla.datos.map((f) => f[3])).toEqual(["FOO"]);
    // sin mapeos aparecen las tres combinaciones inexistentes
    const sin = tablaCombinacionesDesconocidas(armar(ESCENARIO).combinacionesDesconocidas);
    expect(sin.datos.map((f) => f[3]).sort()).toEqual(["-", "FOO", "JEAN"].sort());
  });

  it("mapeos_no_aplicables: aviso rojo con el origen y el destino desactivado; las filas siguen excluidas", () => {
    const roto = mapeo("m-roto", ["HOMBRE", "CASUAL", "DENIM", "JEAN"], "e3x");
    const r = armar([{}, { equivalencia: "JEAN", venta_soles: "400" }], { mapeos: [roto] });
    const m = mes(r);
    const a = aviso(m, "mapeos_no_aplicables");
    expect(a).toMatchObject({ rojo: true, severidad: "aviso", filas: 1, venta_soles: 400 });
    expect(a?.detalle[0].valor).toBe(
      "HOMBRE / CASUAL / DENIM / JEAN → HOMBRE / URBANO / POLO / POLO CLASICO (destino desactivado)"
    );
    expect(m.exclusiones.map((e) => e.motivo)).toContain("equivalencia_inexistente");
    expect(m.reasignadas.filas).toBe(0);
    // y el rojo va primero en la lista de avisos
    expect(m.avisos[0].codigo).toBe("mapeos_no_aplicables");
    expect(r.combinacionesDesconocidas).toHaveLength(1);
  });
});

describe("clasificacion_incompleta pasa por el resolutor (ajuste de la regla 14 de M5)", () => {
  const incompleta: Partial<FilaCruda> = { genero: "", mundo: "CASUAL", linea: "DENIM", venta_soles: "300" };

  it("sin mapeo es error con el detalle de las piezas y pesa para el bloqueo", () => {
    const m = mes(armar([{}, incompleta]));
    const e = m.exclusiones.find((x) => x.motivo === "clasificacion_incompleta");
    expect(e).toMatchObject({ tipo: "error", valor: "(vacío) / CASUAL / DENIM", filas: 1, venta_soles: 300 });
    expect(m.errores.pct_filas).toBe(50);
    expect(m.identidad_ok).toBe(true);
  });

  it("con un mapeo exacto de su origen se reasigna y deja de ser error", () => {
    const mp = mapeo("m-inc", ["", "CASUAL", "DENIM", "PANTALON VARIOS"], "e1s");
    const m = mes(armar([{}, incompleta], { mapeos: [mp] }));
    expect(m.exclusiones).toEqual([]);
    expect(m.reasignadas.filas).toBe(1);
    expect(m.fusionadas).toBe(1);
    expect(aviso(m, "reasignadas_por_mapeo")?.detalle[0].valor).toBe(
      "(vacío) / CASUAL / DENIM / PANTALON VARIOS → HOMBRE / CASUAL / DENIM / PANTALON VARIOS"
    );
  });

  it("tienda_vacia y talla_desconocida ganan a la clasificación incompleta; sin_clasificar sigue sin mapearse", () => {
    const mp = mapeo("m-inc", ["", "CASUAL", "DENIM", "PANTALON VARIOS"], "e1s");
    const m = mes(
      armar(
        [
          { ...incompleta, tienda: "" },
          { ...incompleta, talla: "XL" },
          { genero: "", mundo: "", linea: "" },
        ],
        { mapeos: [mp, mapeo("todo", ["", "", "", "*"], "e1g")] }
      )
    );
    const motivos = m.exclusiones.map((e) => e.motivo).sort();
    expect(motivos).toEqual(["sin_clasificar", "talla_desconocida", "tienda_vacia"]);
    expect(m.reasignadas.filas).toBe(0);
    expect(m.identidad_ok).toBe(true);
  });

  it("los motivos inactivos (decisión) también se reasignan y dejan de contar como excluidos por decisión", () => {
    const mp = mapeo("m-bermuda", ["HOMBRE", "CASUAL", "BERMUDA", "BERMUDA"], "e1s");
    const sin = mes(armar([{ linea: "BERMUDA", equivalencia: "-" }]));
    expect(sin.exclusiones[0]).toMatchObject({ motivo: "linea_inactiva", tipo: "decision" });
    const con = mes(armar([{ linea: "BERMUDA", equivalencia: "-" }], { mapeos: [mp] }));
    expect(con.exclusiones).toEqual([]);
    expect(con.reasignadas.filas).toBe(1);
  });
});

describe("reporte que se guarda con la carga", () => {
  it("incluye `reasignadas`, los ids de mapeo aplicados y el aviso con su detalle", () => {
    const r = armar(ESCENARIO, { mapeos: [M_JEAN, M_CHOMPA] });
    const reporte = armarReporteMes(r.informe, "2026-09", { archivo_nombre: "sintetico.csv" });
    expect(reporte.reasignadas).toMatchObject({ filas: 2, venta_soles: 700 });
    expect(reporte.mapeos_aplicados).toEqual(["m-chompa", "m-jean"]);
    const avisos = reporte.avisos as { codigo: string; detalle: unknown[] }[];
    expect(avisos.find((a) => a.codigo === "reasignadas_por_mapeo")?.detalle).toHaveLength(2);
    expect(JSON.stringify(reporte).length).toBeLessThan(200 * 1024);
  });

  it("el detalle de reasignadas admite hasta 500 entradas (el resto de avisos, 50)", () => {
    // 120 orígenes distintos reasignados por un comodín por terna → 120 líneas de detalle.
    const filas: Partial<FilaCruda>[] = Array.from({ length: 120 }, (_, i) => ({ equivalencia: `EQ ${i}`, venta_soles: String(10 + i) }));
    const r = armar(filas, { mapeos: [mapeo("c", ["HOMBRE", "CASUAL", "DENIM", "*"], "e1s")] });
    const a = aviso(mes(r), "reasignadas_por_mapeo");
    expect(a?.detalle).toHaveLength(120);
    const reporte = armarReporteMes(r.informe, "2026-09", { archivo_nombre: "x.csv" });
    const guardado = (reporte.avisos as { codigo: string; detalle: unknown[] }[]).find((x) => x.codigo === "reasignadas_por_mapeo");
    expect(guardado?.detalle).toHaveLength(120);
  });
});

describe("el árbol de la ficha no cambia", () => {
  it("el estado sintético sigue siendo el de los tests de M5", () => {
    expect(ARBOL.equivalencias.find((e) => e.id === "e1s")?.nombre).toBe("PANTALON VARIOS");
  });
});

/** Pseudoaleatorio con semilla fija (mulberry32). */
function aleatorioSemilla(semilla: number) {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
