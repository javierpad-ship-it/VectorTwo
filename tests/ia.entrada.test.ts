import { describe, expect, it } from "vitest";
import { crearAliasador, type TerminoPrivado } from "@/lib/ia/alias";
import {
  armarBloquesGM,
  armarEntradaLineas,
  armarSufijoNatural,
  armarSufijoReparto,
  comparablePct,
  desempaquetarVentaLineasIa,
  estadisticasVenta,
  planDeGM,
  senalesDeFila,
  type DatosGM,
  type FilaDatosIa,
  type VentaLineasIaApi,
} from "@/lib/ia/entrada";
import { crearAleatorio, recortarAlCorte } from "@/lib/ia/evaluacion";
import { estadoFilaMeta, type FilaMeta } from "@/lib/ia/meta";
import type { BloqueGMIa } from "@/lib/ia/tipos";
import { claveFila } from "@/lib/proyeccion/tipos";
import { ProveedorFalso } from "./ia.proveedor-falso";
import { ANIO, datosA, datosGrandes, filaDatos, fm, K, OPCIONES_META, TERMINOS_J } from "./ia.fixture";

/** R10 y R28 (ficha 07e): lista blanca, años relativos, sin meta en el bloque, alias y modo jerárquico. */

const armar = (datos: DatosGM = datosA(), terminos: TerminoPrivado[] = TERMINOS_J, extra: { max_filas_llamada?: number } = {}) => {
  const r = armarBloquesGM(datos, { terminos, ...extra });
  if (!r.ok) throw new Error("bloqueado");
  return r;
};

const claves = (valor: unknown, acumulado = new Set<string>()): Set<string> => {
  if (Array.isArray(valor)) for (const v of valor) claves(v, acumulado);
  else if (valor !== null && typeof valor === "object") {
    for (const [k, v] of Object.entries(valor)) {
      acumulado.add(k);
      claves(v, acumulado);
    }
  }
  return acumulado;
};

describe("R10 · el bloque del ejemplo A", () => {
  const r = armar();
  const bloque = r.lotes[0].bloque;

  it("modo directo, un lote, plan n1 → r1; las filas libres y la fija viajan y la cola larga solo se resume", () => {
    expect(r.modo).toBe("directo");
    expect(r.lotes).toHaveLength(1);
    expect(r.plan).toEqual([{ id: "n1", tipo: "natural", lote: 1 }, { id: "r1", tipo: "reparto", lote: 1 }]);
    expect(bloque.filas.map((f) => [f.estado, f.y1.pedir])).toEqual([["libre", true], ["libre", true], ["libre", true], ["fija", false]]);
    expect(bloque.filas.map((f) => f.f)).toEqual(["f001", "f002", "f003", "f004"]);
    expect(bloque.filas[3].y1.fija_en).toBe(3300);
    expect(bloque.filas[0].y1.fija_en).toBeNull();
    expect(bloque.gm.cola_larga).toEqual({ filas: 1, unidades_y1: 86 });
    expect(bloque.lote).toEqual({ n: 1, de: 1 });
    expect(r.lotes[0].filas_libres).toEqual(["f001", "f002", "f003"]);
    expect(r.lotes[0].diccionario.f).toEqual({ f001: "k1", f002: "k2", f003: "k3", f004: "k4" });
  });

  it("contexto: A+1 normal, Niño en años relativos y el año en curso con ultimo_mes_cerrado valores", () => {
    expect(bloque.contexto).toEqual({ ultimo_mes_cerrado: K, objetivo: "A+1", objetivo_normal: true, nino: [{ anio: "A", temporada: "invierno", meses: [6, 7, 8], factor: 0.8 }], umbral_cola_larga: 100 });
    for (const f of bloque.filas) {
      expect(Object.keys(f.meses)).toEqual(["A-3", "A-2", "A-1", "A"]);
      expect(f.meses["A"]).toHaveLength(K);
      expect(f.meses["A-1"]).toHaveLength(12);
    }
    expect(bloque.gm.historia.map((h) => h.anio)).toEqual(["A-3", "A-2", "A-1", "A"]);
    expect(bloque.gm.historia[0].comparable_pct).toBeNull();
  });

  it("lista blanca: ningún uuid, año real, nombre de marca o tienda, ni claves de dinero, stock o personas", () => {
    const texto = r.lotes[0].contenido;
    expect(texto).not.toMatch(/\b(19|20)\d{2}\b/);
    expect(texto).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i);
    expect(texto).not.toMatch(/MARCAX|Z901/);
    const k = claves(bloque);
    for (const prohibida of ["soles", "costo", "stock", "tienda", "email", "marca", "clave"]) {
      expect(k.has(prohibida)).toBe(false);
      expect([...k].some((c) => c.includes(prohibida) && c !== "agrupacion_marca")).toBe(false);
    }
    for (const f of bloque.filas) {
      expect(f.f).toMatch(/^f\d{3,4}$/);
      expect(f.l).toMatch(/^l\d{2,3}$/);
      for (const m of Object.values(f.meses)) expect((m as number[]).every((x) => Number.isInteger(x) && x >= 0)).toBe(true);
    }
  });

  it("el bloque natural no contiene meta, pct, propuesta ni cifras que dependan de g", () => {
    const k = claves(bloque);
    for (const prohibida of ["meta", "pct", "g", "propuesta", "propuesto", "propuesta_metodo", "total", "libre", "fijas"]) expect(k.has(prohibida)).toBe(false);
    expect([...k].some((c) => c.startsWith("propuest"))).toBe(false);
    expect(armarSufijoNatural()).toEqual({ tarea: "natural" });
  });

  it("propiedad: cambiar g no cambia el bloque (el estado de las filas lejos del umbral no depende de g)", () => {
    const bloques = [-20, 0, 3, 8, 15, 30].map((g) => {
      const filas: FilaMeta[] = [
        fm({ fila_id: "f1", clave: "k1", propuesto: Math.round(10000 * (1 + g / 100)), base: 10000, base_corregida: 10000 }),
        fm({ fila_id: "f4", clave: "k4", propuesto: Math.round(3000 * (1 + g / 100)), base: 3000, base_corregida: 3000, decidido: 3300 }),
        fm({ fila_id: "f5", clave: "k5", propuesto: Math.round(40 * (1 + g / 100)), base: 40, base_corregida: 40 }),
      ];
      const estado = new Map(filas.map((f) => [f.clave, estadoFilaMeta(f, OPCIONES_META)]));
      const datos = datosA({
        filas: datosA().filas
          .filter((f) => ["k1", "k4", "k5"].includes(f.clave))
          .map((f): FilaDatosIa => ({ ...f, estado: estado.get(f.clave) === "libre" ? "libre" : estado.get(f.clave) === "fija_decidida" ? "fija" : "cola_larga" })),
      });
      return armar(datos).lotes[0].contenido;
    });
    expect(new Set(bloques).size).toBe(1);
  });

  it("propiedad (cortes aleatorios): el año en curso trae exactamente k meses y nada posterior al corte ni año siguiente", () => {
    const azar = crearAleatorio(2026);
    for (let i = 0; i < 50; i++) {
      const k = 1 + Math.floor(azar() * 12);
      const fila = filaDatos({
        clave: "k1",
        linea: "DENIM",
        meses_por_anio: { [ANIO - 1]: Array.from({ length: 12 }, () => 100), [ANIO]: Array.from({ length: 12 }, (_, m) => (m < k ? 100 : 777777)), [ANIO + 1]: Array.from({ length: 12 }, () => 888888), [ANIO - 5]: [1] },
      });
      const res = armar(datosA({ ultimo_mes_cerrado: k, filas: [fila] }));
      const b = res.lotes[0].bloque;
      expect(b.filas[0].meses["A"]).toEqual(Array.from({ length: k }, () => 100));
      expect(Object.keys(b.filas[0].meses).sort()).toEqual(["A", "A-1"]);
      expect(res.lotes[0].contenido).not.toMatch(/777777|888888/);
      expect(b.contexto.ultimo_mes_cerrado).toBe(k);
    }
  });

  it("la entrada es determinista: mismo dato, mismo texto y misma huella", () => {
    const a = armar();
    const b = armar();
    expect(a.lotes[0].contenido).toBe(b.lotes[0].contenido);
    expect(a.lotes[0].huella).toBe(b.lotes[0].huella);
    expect(a.lotes[0].huella).toMatch(/^[0-9a-f]{64}$/);
    expect(a.lotes[0].bytes).toBe(Buffer.byteLength(a.lotes[0].contenido));
  });
});

describe("R11 · alias y control de salida en el armado", () => {
  it("las marcas viajan como alias y el diccionario guarda ids, no nombres", () => {
    const datos = datosA({ filas: [filaDatos({ clave: "k1", linea: "POLO", equivalencia_id: "eq-1", equivalencia: "MARCAX SLIM", agrupacion_marca: "MARCAX" })] });
    const r = armar(datos);
    const f = r.lotes[0].bloque.filas[0];
    expect([f.equivalencia, f.agrupacion_marca]).toEqual(["MARCA_A SLIM", "MARCA_A"]);
    expect(r.lotes[0].diccionario.alias).toEqual({ MARCA_A: { tipo: "marca", id: TERMINOS_J[0].id } });
    expect(JSON.stringify(r.lotes[0].diccionario)).not.toMatch(/MARCAX/);
    expect(r.lotes[0].diccionario.e).toEqual({ e01: "eq-1" });
  });

  it("un término que sobrevive al alias bloquea el GM y no hay ninguna llamada al proveedor", async () => {
    const proveedor = new ProveedorFalso();
    const datos = datosA({ filas: [filaDatos({ clave: "k1", linea: "LINEA Z901" })] });
    // El aliasador no conoce la tienda (falló), pero el control final sí.
    const r = armarBloquesGM(datos, { terminos: TERMINOS_J, aliasador: crearAliasador([TERMINOS_J[0]]) });
    expect(r).toEqual({ ok: false, motivo: "bloqueado_privacidad", hallazgos: ["termino"] });
    if (r.ok) await proveedor.llamar({} as never);
    expect(proveedor.llamadas).toBe(0);
  });

  it("un año real en un nombre bloquea el GM", () => {
    const r = armarBloquesGM(datosA({ filas: [filaDatos({ clave: "k1", linea: "COLECCION 2025" })] }), { terminos: [] });
    expect(r).toEqual({ ok: false, motivo: "bloqueado_privacidad", hallazgos: ["anio"] });
  });
});

describe("R28 · modo jerárquico", () => {
  it("con 61 filas libres: plan n1, n2, l, r1, r2; lotes de líneas completas de ≤ 60", () => {
    const r = armar(datosGrandes(61, 3));
    expect(r.modo).toBe("jerarquico");
    expect(r.plan.map((p) => p.id)).toEqual(["n1", "n2", "l", "r1", "r2"]);
    expect(r.plan.map((p) => p.tipo)).toEqual(["natural", "natural", "lineas", "reparto", "reparto"]);
    expect(r.lotes).toHaveLength(2);
    for (const l of r.lotes) expect(l.bloque.filas.length).toBeLessThanOrEqual(60);
    expect(r.lotes.map((l) => l.bloque.lote)).toEqual([{ n: 1, de: 2 }, { n: 2, de: 2 }]);
    // Cada fila va en un solo lote y una línea nunca se parte.
    const todas = r.lotes.flatMap((l) => l.bloque.filas.map((f) => f.f));
    expect(new Set(todas).size).toBe(61);
    const lotesDeLinea = new Map<string, Set<number>>();
    r.lotes.forEach((l, i) => l.bloque.filas.forEach((f) => lotesDeLinea.set(f.l, (lotesDeLinea.get(f.l) ?? new Set()).add(i))));
    for (const lotes of lotesDeLinea.values()) expect(lotes.size).toBe(1);
    expect(r.lineas.map((l) => l.filas_libres).reduce((a, b) => a + b, 0)).toBe(61);
    expect(r.avisos).toEqual([]);
  });

  it("hasta 60 filas el modo es directo", () => {
    expect(armar(datosGrandes(60, 3)).modo).toBe("directo");
    expect(armar(datosGrandes(60, 3)).plan.map((p) => p.id)).toEqual(["n1", "r1"]);
  });

  it("una línea de más de 60 filas se parte por clave y se avisa", () => {
    const r = armar(datosGrandes(130, 1));
    expect(r.modo).toBe("jerarquico");
    expect(r.avisos).toContain("linea_partida");
    expect(r.lotes.map((l) => l.bloque.filas.length)).toEqual([60, 60, 10]);
    expect(r.plan.map((p) => p.id)).toEqual(["n1", "n2", "n3", "l", "r1", "r2", "r3"]);
  });

  it("planDeGM", () => {
    expect(planDeGM("directo", 1).map((p) => p.id)).toEqual(["n1", "r1"]);
    expect(planDeGM("jerarquico", 1).map((p) => p.id)).toEqual(["n1", "l", "r1"]);
    expect(planDeGM("directo", 0)).toEqual([]);
  });

  it("un GM sin filas libres no arma nada", () => {
    const r = armar(datosA({ filas: [filaDatos({ clave: "k1", linea: "A", estado: "fija" })] }));
    expect(r.lotes).toEqual([]);
    expect(r.plan).toEqual([]);
  });

  it("la entrada de líneas lleva la natural sumada por línea, la sub-meta no viaja y el control la revisa", () => {
    const r = armar(datosGrandes(61, 3));
    const naturales = new Map<string, number | null>(r.lotes.flatMap((l) => l.filas_libres).map((f) => [f, 100]));
    const e = armarEntradaLineas({ contexto: r.contexto, gm: r.gm, meta: { pct: 8, sobre: "corregida", total: 7000, fijas: 100, libre: 6900, provisional: false }, lineas: r.lineas, naturales }, TERMINOS_J);
    if (!e.ok) throw new Error("bloqueado");
    expect(e.entrada.lineas.map((l) => l.natural_y1)).toEqual(r.lineas.map((l) => l.filas_libres * 100));
    expect(e.entrada.meta).toEqual({ pct: 8, sobre: "corregida", total: 7000, fijas: 100, libre: 6900, provisional: false });
    expect(Object.keys(e.entrada.lineas[0]).sort()).toEqual(["base_corregida", "comparable_pct", "fijas", "filas_libres", "historia", "l", "linea", "natural_y1"]);
    const malo = armarEntradaLineas({ contexto: r.contexto, gm: r.gm, meta: { pct: 8, sobre: "corregida", total: 1, fijas: 0, libre: 1, provisional: false }, lineas: [{ ...r.lineas[0], linea: "LINEA Z901" }], naturales }, TERMINOS_J);
    expect(naturales.size).toBe(61);
    expect(malo.ok).toBe(false);
  });
});

describe("sufijo de reparto", () => {
  it("lleva la meta del lote y los naturales ordenados por f, sin nada más", () => {
    const s = armarSufijoReparto({ meta: { pct: 8, sobre: "corregida", total: 26006, fijas: 3386, libre: 22620, provisional: false, del_lote: 22620 }, naturales: [{ f: "f003", natural_y1: 5100 }, { f: "f001", natural_y1: 10300 }, { f: "f002", natural_y1: null }] });
    expect(s).toEqual({
      tarea: "reparto",
      meta: { pct: 8, sobre: "corregida", total: 26006, fijas: 3386, libre: 22620, provisional: false, del_lote: 22620 },
      naturales: [{ f: "f001", natural_y1: 10300 }, { f: "f002", natural_y1: null }, { f: "f003", natural_y1: 5100 }],
    });
  });
});

describe("señales del código", () => {
  const base = { meses_con_venta_24: 24, meses_desde_primera_venta: 40, meses_quiebre_w12: 0, disponibilidad: 0.95, factores_mes_y: null, avisos: [] as string[], aportes: { entrantes: 0, salientes: 0 }, base: 10000 };
  it("dato_insuficiente con menos de 12 meses con venta; linea_nueva dentro de los últimos 18", () => {
    expect(senalesDeFila({ ...base, meses_con_venta_24: 11 })).toEqual(["dato_insuficiente"]);
    expect(senalesDeFila({ ...base, meses_con_venta_24: 12 })).toEqual([]);
    expect(senalesDeFila({ ...base, meses_desde_primera_venta: 18 })).toEqual(["linea_nueva"]);
    expect(senalesDeFila({ ...base, meses_desde_primera_venta: 19 })).toEqual([]);
  });
  it("quiebres con 3 meses de quiebre o disponibilidad < 0,75", () => {
    expect(senalesDeFila({ ...base, meses_quiebre_w12: 3 })).toEqual(["quiebres"]);
    expect(senalesDeFila({ ...base, meses_quiebre_w12: 2 })).toEqual([]);
    expect(senalesDeFila({ ...base, disponibilidad: 0.74 })).toEqual(["quiebres"]);
    expect(senalesDeFila({ ...base, disponibilidad: 0.75 })).toEqual([]);
    expect(senalesDeFila({ ...base, disponibilidad: null })).toEqual([]);
  });
  it("nino si φ ≠ 1 en algún mes; los avisos de la fila y las tiendas, en orden fijo", () => {
    expect(senalesDeFila({ ...base, factores_mes_y: [1, 1, 0.9, 1, 1, 1, 1, 1, 1, 1, 1, 1] })).toEqual(["nino"]);
    expect(senalesDeFila({ ...base, factores_mes_y: Array.from({ length: 12 }, () => 1) })).toEqual([]);
    expect(senalesDeFila({ ...base, avisos: ["revision_cola_larga", "plan_anterior", "otro_aviso", "avance_bajo", "temporadas_mezcladas"], aportes: { entrantes: 2200, salientes: 0 } })).toEqual([
      "temporadas_mezcladas",
      "avance_bajo",
      "plan_anterior",
      "revision_cola_larga",
      "tiendas_entrantes",
    ]);
  });
});

describe("venta_lineas_ia: lectura compacta y variación comparable", () => {
  // Claves de pertenencia: posiciones M(2023) … M(2027). «11111» está en todas; «00011» solo en M(2026) y M(2027).
  const compacta: VentaLineasIaApi = {
    dic: { filas: [["g1", "am1", null], ["g1", "am2", null]], claves: ["11111", "00011"], desde: "2023-01-01" },
    //        2024-01     2025-01     2025-01(excl.)  2025-09    2026-09     2026-10 (>k)  2026-09 otra fila
    f: [0, 0, 0, 0, 0, 0, 1],
    c: [0, 0, 1, 0, 0, 0, 0],
    p: [12, 24, 24, 32, 44, 45, 44],
    u: [100, 110, 500, 100, 120, 999, 7],
    cargas: {},
  };
  const porFila = desempaquetarVentaLineasIa(compacta);
  const regs = porFila.get(claveFila(null, "g1", null, "am1")) ?? [];

  it("desempaqueta por fila con año y mes reales", () => {
    expect([...porFila.keys()].sort()).toEqual([claveFila(null, "g1", null, "am1"), claveFila(null, "g1", null, "am2")].sort());
    expect(regs.slice(0, 2).map((r) => [r.anio, r.mes, r.clave, r.unidades])).toEqual([[2024, 1, "11111", 100], [2025, 1, "11111", 110]]);
    expect(regs.map((r) => [r.anio, r.mes]).slice(-2)).toEqual([[2026, 9], [2026, 10]]);
  });

  it("año completo: solo cuentan las claves en M(Z) y M(Z+1)", () => {
    // 2025: la clave 00011 no está en M(2025) y se excluye → (110 + 100) ÷ 100 − 1 = +110 %.
    expect(comparablePct(regs, { anioEnCurso: 2026, k: 9, anio: 2025 })).toBeCloseTo(110, 6);
  });

  it("año en curso: solo los meses 1…k (el 10 no cuenta) y las claves en M(Y) y M(Y+1)", () => {
    // 2026: la clave 00011 sí está en M(2026) y M(2027): su 500 de enero de 2025 entra en el denominador (110 + 500 + 100).
    expect(comparablePct(regs, { anioEnCurso: 2026, k: 9, anio: 2026 })).toBeCloseTo((120 / 710 - 1) * 100, 6);
    expect(comparablePct(regs, { anioEnCurso: 2026, k: 10, anio: 2026 })).toBeCloseTo((1119 / 710 - 1) * 100, 6);
  });

  it("nula si el denominador es 0", () => {
    expect(comparablePct(regs, { anioEnCurso: 2026, k: 9, anio: 2024 })).toBeNull();
  });

  it("estadisticas: meses con venta en los últimos 24 y meses desde la primera venta", () => {
    const e = estadisticasVenta(regs, { anioEnCurso: 2026, k: 9 });
    // Ref = 2026-09. Ventas > 0 en 2024-01 (fuera de la ventana), 2025-01, 2025-09, 2026-09 (2026-10 es posterior).
    expect(e.meses_con_venta_24).toBe(3);
    expect(e.meses_desde_primera_venta).toBe(32);
  });

  it("recortarAlCorte: un pliegue no ve meses posteriores", () => {
    const recortado = recortarAlCorte(regs, "2025-09");
    expect(recortado.every((r) => r.anio * 12 + r.mes <= 2025 * 12 + 9)).toBe(true);
    expect(recortado).toHaveLength(regs.length - 2);
  });
});

describe("el bloque es de tipo BloqueGMIa", () => {
  it("compila con la forma de §3.5", () => {
    const b: BloqueGMIa = armar().lotes[0].bloque;
    expect(b.version_entrada).toBe(2);
  });
});
