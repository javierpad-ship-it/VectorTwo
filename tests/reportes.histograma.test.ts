import { describe, expect, it } from "vitest";
import {
  MAX_EQUIVALENCIAS_PETICION,
  PALETA_ANIOS,
  armarMatriz,
  calcularGeometria,
  clasificarPeticion,
  colorAnio,
  escalaBonita,
  etiquetaBarra,
  formatearSoles,
  formatearUnidades,
  formatearVariacion,
  idsParaPeticion,
  parsearPeriodo,
  variacionAnual,
  variacionPct,
  variacionesMatriz,
} from "@/lib/reportes/histograma";
import type { MesUnidades } from "@/lib/reportes/tipos-unidades";

const mes = (periodo: string, unidades: number, venta = unidades * 10): MesUnidades => ({ periodo, unidades, venta_soles: venta });

/** 2023 completo (100 por mes), 2024 completo (110) y 2025 solo ene-mar (120). Datos sintéticos. */
function sintetico(): MesUnidades[] {
  const filas: MesUnidades[] = [];
  for (let m = 1; m <= 12; m++) filas.push(mes(`2023-${String(m).padStart(2, "0")}`, 100));
  for (let m = 1; m <= 12; m++) filas.push(mes(`2024-${String(m).padStart(2, "0")}`, 110));
  for (let m = 1; m <= 3; m++) filas.push(mes(`2025-${String(m).padStart(2, "0")}`, 120));
  return filas;
}

describe("parsearPeriodo", () => {
  it("lee YYYY-MM con el mes en base 0", () => {
    expect(parsearPeriodo("2026-09")).toEqual({ anio: 2026, mes: 8 });
    expect(parsearPeriodo("2023-01")).toEqual({ anio: 2023, mes: 0 });
  });
  it("rechaza lo que no es un periodo válido", () => {
    for (const malo of ["2026-13", "2026-00", "2026-9", "26-09", "2026/09", "", "2026-09-01"]) expect(parsearPeriodo(malo)).toBeNull();
  });
});

describe("armarMatriz", () => {
  it("coloca cada periodo en su año y mes, con totales por año, por mes y general", () => {
    const m = armarMatriz(sintetico());
    expect(m.anios).toEqual([2023, 2024, 2025]);
    expect(m.valores[0][0]).toBe(100);
    expect(m.valores[1][11]).toBe(110);
    expect(m.valores[2][2]).toBe(120);
    expect(m.totalesAnio).toEqual([1200, 1320, 360]);
    expect(m.totalesMes[0]).toBe(330);
    expect(m.totalesMes[3]).toBe(210);
    expect(m.total).toBe(1200 + 1320 + 360);
    expect(m.mesesConDatos).toBe(27);
    expect(m.ventas[2][0]).toBe(1200);
  });

  it("los meses sin datos son null, no cero", () => {
    const m = armarMatriz(sintetico());
    expect(m.valores[2][3]).toBeNull();
    expect(m.valores[2][11]).toBeNull();
    expect(m.ventas[2][11]).toBeNull();
  });

  it("un mes con datos y valor 0 sigue siendo 0 (distinto de null)", () => {
    const m = armarMatriz([mes("2024-05", 0, 0)]);
    expect(m.valores[0][4]).toBe(0);
    expect(m.totalesAnio).toEqual([0]);
    expect(m.mesesConDatos).toBe(1);
  });

  it("un año intermedio sin datos queda como columna vacía (años continuos)", () => {
    const m = armarMatriz([mes("2023-06", 50), mes("2025-06", 70)]);
    expect(m.anios).toEqual([2023, 2024, 2025]);
    expect(m.valores[1].every((v) => v === null)).toBe(true);
    expect(m.totalesAnio).toEqual([50, null, 70]);
    expect(m.totalesMes[5]).toBe(120);
    expect(m.totalesMes[0]).toBeNull();
  });

  it("acepta los meses en cualquier orden y suma periodos repetidos", () => {
    const m = armarMatriz([mes("2024-02", 5, 50), mes("2023-12", 7), mes("2024-02", 3, 30)]);
    expect(m.anios).toEqual([2023, 2024]);
    expect(m.valores[1][1]).toBe(8);
    expect(m.ventas[1][1]).toBe(80);
    expect(m.valores[0][11]).toBe(7);
    expect(m.mesesConDatos).toBe(2);
  });

  it("ignora periodos inválidos y números no finitos", () => {
    const m = armarMatriz([mes("basura", 5), mes("2024-02", Number.NaN), mes("2024-03", 4)]);
    expect(m.anios).toEqual([2024]);
    expect(m.mesesConDatos).toBe(1);
    expect(m.total).toBe(4);
  });

  it("sin datos devuelve una matriz vacía con 12 totales de mes nulos", () => {
    const m = armarMatriz([]);
    expect(m.anios).toEqual([]);
    expect(m.valores).toEqual([]);
    expect(m.totalesMes).toEqual(Array(12).fill(null));
    expect(m.total).toBe(0);
    expect(m.mesesConDatos).toBe(0);
  });

  it("las devoluciones netas pueden dejar un mes negativo y se respetan", () => {
    const m = armarMatriz([mes("2024-01", -15)]);
    expect(m.valores[0][0]).toBe(-15);
    expect(m.total).toBe(-15);
  });

  it("cubre el rango real del cliente: ene-2023 a set-2026 (45 meses, oct-dic 2026 vacíos)", () => {
    const filas: MesUnidades[] = [];
    for (let a = 2023; a <= 2026; a++) for (let mm = 1; mm <= 12; mm++) if (a < 2026 || mm <= 9) filas.push(mes(`${a}-${String(mm).padStart(2, "0")}`, 1));
    expect(filas).toHaveLength(45);
    const m = armarMatriz(filas);
    expect(m.anios).toEqual([2023, 2024, 2025, 2026]);
    expect(m.mesesConDatos).toBe(45);
    expect(m.valores[3].slice(9)).toEqual([null, null, null]);
    expect(m.totalesAnio[3]).toBe(9);
  });

  it("no muta la entrada", () => {
    const entrada = sintetico();
    const copia = JSON.parse(JSON.stringify(entrada));
    armarMatriz(entrada);
    expect(entrada).toEqual(copia);
  });
});

describe("variación porcentual", () => {
  it("variacionPct calcula contra el anterior", () => {
    expect(variacionPct(110, 100)).toBeCloseTo(10);
    expect(variacionPct(75, 100)).toBeCloseTo(-25);
    expect(variacionPct(100, 100)).toBe(0);
    expect(variacionPct(0, 50)).toBe(-100);
  });
  it("es null si falta alguno de los dos meses o no hay base", () => {
    expect(variacionPct(null, 100)).toBeNull();
    expect(variacionPct(100, null)).toBeNull();
    expect(variacionPct(10, 0)).toBeNull();
    expect(variacionPct(Number.NaN, 5)).toBeNull();
  });
  it("con base negativa usa su valor absoluto (el signo indica la dirección real)", () => {
    expect(variacionPct(-5, -10)).toBeCloseTo(50);
  });

  it("variacionesMatriz: primer año null, y null donde falta alguno de los dos meses", () => {
    const m = armarMatriz(sintetico());
    const v = variacionesMatriz(m);
    expect(v).toHaveLength(3);
    expect(v[0].every((x) => x === null)).toBe(true);
    expect(v[1][0]).toBeCloseTo(10);
    expect(v[2][0]).toBeCloseTo((120 / 110 - 1) * 100);
    expect(v[2][3]).toBeNull(); // abr-2025 no existe
  });

  it("variacionesMatriz con un año intermedio vacío no inventa comparaciones", () => {
    const m = armarMatriz([mes("2023-06", 50), mes("2025-06", 70)]);
    const v = variacionesMatriz(m);
    expect(v[1][5]).toBeNull();
    expect(v[2][5]).toBeNull();
  });

  it("variacionAnual compara solo los meses que existen en ambos años", () => {
    const m = armarMatriz(sintetico());
    expect(variacionAnual(m, 0)).toBeNull();
    expect(variacionAnual(m, 1)).toBeCloseTo(10);
    // 2025 (ene-mar: 360) contra los mismos tres meses de 2024 (330), no contra los 1 320 del año completo.
    expect(variacionAnual(m, 2)).toBeCloseTo((360 / 330 - 1) * 100);
    expect(variacionAnual(m, 3)).toBeNull();
    expect(variacionAnual(m, -1)).toBeNull();
  });

  it("variacionAnual es null si los años no comparten ningún mes", () => {
    const m = armarMatriz([mes("2023-01", 10), mes("2024-02", 20)]);
    expect(variacionAnual(m, 1)).toBeNull();
  });
});

describe("formatos", () => {
  it("unidades con separador de miles es-PE y sin decimales", () => {
    expect(formatearUnidades(0)).toBe("0");
    expect(formatearUnidades(999)).toBe("999");
    expect(formatearUnidades(12345)).toBe("12,345");
    expect(formatearUnidades(1234567)).toBe("1,234,567");
    expect(formatearUnidades(1234.6)).toBe("1,235");
    expect(formatearUnidades(-1500)).toBe("-1,500");
  });
  it("soles con prefijo S/ y sin decimales", () => {
    expect(formatearSoles(1234567.4)).toBe("S/ 1,234,567");
    expect(formatearSoles(0)).toBe("S/ 0");
  });
  it("variación con signo explícito y un decimal", () => {
    expect(formatearVariacion(12.34)).toBe("+12.3 %");
    expect(formatearVariacion(-3)).toBe("-3.0 %");
    expect(formatearVariacion(0)).toBe("0.0 %");
    expect(formatearVariacion(0.04)).toBe("0.0 %");
    expect(formatearVariacion(-0.04)).toBe("0.0 %");
    expect(formatearVariacion(1234.5)).toBe("+1,234.5 %");
  });
  it("variación ausente se muestra como raya", () => {
    expect(formatearVariacion(null)).toBe("—");
    expect(formatearVariacion(Number.NaN)).toBe("—");
  });
  it("etiquetaBarra es legible y menciona el año de comparación", () => {
    expect(etiquetaBarra(2025, 2, 12345, null)).toBe("Marzo 2025: 12,345 unidades");
    expect(etiquetaBarra(2025, 8, 100, 4.5)).toBe("Setiembre 2025: 100 unidades (+4.5 % vs 2024)");
  });
});

describe("colorAnio", () => {
  it("es estable por año y distinto entre años consecutivos", () => {
    expect(colorAnio(2025)).toBe(colorAnio(2025));
    const colores = [2023, 2024, 2025, 2026].map(colorAnio);
    expect(new Set(colores).size).toBe(4);
  });
  it("la paleta no repite colores y rota después de agotarla", () => {
    expect(new Set(PALETA_ANIOS).size).toBe(PALETA_ANIOS.length);
    expect(colorAnio(2023 + PALETA_ANIOS.length)).toBe(colorAnio(2023));
  });
});

describe("escalaBonita", () => {
  it("redondea el máximo a un múltiplo de un paso 1/2/2.5/5 × 10^k", () => {
    expect(escalaBonita(0, 87)).toMatchObject({ min: 0, max: 100, paso: 20 });
    expect(escalaBonita(0, 100)).toMatchObject({ max: 100, paso: 20 });
    expect(escalaBonita(0, 1234)).toMatchObject({ max: 1250, paso: 250 });
    expect(escalaBonita(0, 52000)).toMatchObject({ max: 60000, paso: 20000 });
  });
  it("las marcas van de min a max cada paso y el máximo siempre cubre el dato", () => {
    for (const max of [1, 3, 7, 19, 101, 999, 4321, 123456, 98765432]) {
      const e = escalaBonita(0, max);
      expect(e.ticks[0]).toBe(0);
      expect(e.ticks.at(-1)).toBe(e.max);
      expect(e.max).toBeGreaterThanOrEqual(max);
      expect(e.ticks.length).toBeLessThanOrEqual(7);
      e.ticks.slice(1).forEach((t, i) => expect(t - e.ticks[i]).toBeCloseTo(e.paso));
      expect([1, 2, 2.5, 5]).toContain(e.paso / 10 ** Math.floor(Math.log10(e.paso)));
    }
  });
  it("sin datos o con cero deja una escala válida [0, 1]", () => {
    expect(escalaBonita(0, 0)).toMatchObject({ min: 0, max: 1, paso: 1, ticks: [0, 1] });
    expect(escalaBonita(Number.NaN, Number.NaN).ticks).toEqual([0, 1]);
  });
  it("con entero el paso nunca baja de 1 (sin marcas fraccionarias)", () => {
    const e = escalaBonita(0, 3);
    expect(e.paso).toBeGreaterThanOrEqual(1);
    expect(e.ticks.every(Number.isInteger)).toBe(true);
    expect(escalaBonita(0, 0.5, 5, false).paso).toBeLessThan(1);
  });
  it("incluye el cero cuando hay valores negativos", () => {
    const e = escalaBonita(-35, 80);
    expect(e.min).toBeLessThanOrEqual(-35);
    expect(e.max).toBeGreaterThanOrEqual(80);
    expect(e.ticks).toContain(0);
  });
  it("si todo es positivo, el mínimo es 0 aunque el menor dato sea alto", () => {
    expect(escalaBonita(500, 900).min).toBe(0);
  });
});

describe("calcularGeometria", () => {
  const matriz = armarMatriz(sintetico());
  const g = calcularGeometria(matriz);

  it("genera una barra por celda con dato y ninguna por las vacías", () => {
    expect(g.barras).toHaveLength(27);
    expect(g.barras.some((b) => b.anio === 2025 && b.mes === 3)).toBe(false);
    expect(g.barras.filter((b) => b.anio === 2025).map((b) => b.mes)).toEqual([0, 1, 2]);
  });

  it("12 grupos con etiqueta de mes, ordenados y dentro del área", () => {
    expect(g.grupos.map((x) => x.etiqueta)).toEqual(["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Set", "Oct", "Nov", "Dic"]);
    for (let i = 1; i < 12; i++) expect(g.grupos[i].x).toBeGreaterThan(g.grupos[i - 1].x);
    expect(g.grupos[0].x).toBeCloseTo(g.area.x);
    expect(g.grupos[11].x + g.grupos[11].ancho).toBeCloseTo(g.area.x + g.area.ancho);
  });

  it("las barras quedan dentro del área de dibujo y no se pisan dentro de un mes", () => {
    for (const b of g.barras) {
      expect(b.x).toBeGreaterThanOrEqual(g.area.x - 1e-6);
      expect(b.x + b.ancho).toBeLessThanOrEqual(g.area.x + g.area.ancho + 1e-6);
      expect(b.y).toBeGreaterThanOrEqual(g.area.y - 1e-6);
      expect(b.y + b.alto).toBeLessThanOrEqual(g.area.y + g.area.alto + 1e-6);
    }
    const enero = g.barras.filter((b) => b.mes === 0).sort((a, b) => a.x - b.x);
    expect(enero.map((b) => b.anio)).toEqual([2023, 2024, 2025]);
    for (let i = 1; i < enero.length; i++) expect(enero[i].x).toBeGreaterThanOrEqual(enero[i - 1].x + enero[i - 1].ancho);
  });

  it("la altura es proporcional al valor y todas las barras apoyan en el cero", () => {
    const a = g.barras.find((b) => b.anio === 2023 && b.mes === 0)!; // 100
    const b = g.barras.find((x) => x.anio === 2025 && x.mes === 0)!; // 120
    expect(b.alto / a.alto).toBeCloseTo(1.2);
    for (const barra of g.barras) expect(barra.y + barra.alto).toBeCloseTo(g.yCero);
  });

  it("el eje Y cubre el máximo y sus marcas llevan separador de miles", () => {
    expect(g.escala.max).toBeGreaterThanOrEqual(120);
    const grande = calcularGeometria(armarMatriz([mes("2024-01", 123456)]));
    expect(grande.ticks.at(-1)!.etiqueta).toMatch(/^\d{1,3}(,\d{3})+$/);
    expect(grande.margen.izq).toBeGreaterThan(g.margen.izq);
  });

  it("cada barra lleva el color de su año", () => {
    for (const barra of g.barras) expect(barra.color).toBe(colorAnio(barra.anio));
  });

  it("más años ensanchan el gráfico (scroll en vez de barras diminutas) y nunca baja del mínimo", () => {
    const poco = calcularGeometria(armarMatriz([mes("2024-01", 1)]));
    expect(poco.ancho).toBeGreaterThanOrEqual(640);
    const muchos = calcularGeometria(armarMatriz(Array.from({ length: 8 }, (_, i) => mes(`${2020 + i}-01`, 10))));
    expect(muchos.ancho).toBeGreaterThan(poco.ancho);
    expect(Math.min(...muchos.barras.map((b) => b.ancho))).toBeGreaterThanOrEqual(2);
  });

  it("un valor no nulo nunca desaparece (mínimo 1 px) y el cero queda sin altura", () => {
    const gg = calcularGeometria(armarMatriz([mes("2024-01", 1), mes("2024-02", 1_000_000), mes("2024-03", 0)]));
    expect(gg.barras.find((b) => b.mes === 0)!.alto).toBeGreaterThanOrEqual(1);
    expect(gg.barras.find((b) => b.mes === 2)!.alto).toBe(0);
  });

  it("los valores negativos cuelgan del cero hacia abajo", () => {
    const gg = calcularGeometria(armarMatriz([mes("2024-01", 100), mes("2024-02", -40)]));
    const neg = gg.barras.find((b) => b.mes === 1)!;
    expect(neg.y).toBeCloseTo(gg.yCero);
    expect(neg.y + neg.alto).toBeLessThanOrEqual(gg.area.y + gg.area.alto + 1e-6);
    expect(gg.yCero).toBeLessThan(gg.area.y + gg.area.alto);
  });

  it("sin datos devuelve una geometría vacía pero válida", () => {
    const vacia = calcularGeometria(armarMatriz([]));
    expect(vacia.barras).toEqual([]);
    expect(vacia.grupos).toHaveLength(12);
    expect(vacia.ticks.length).toBeGreaterThanOrEqual(2);
    expect(Number.isFinite(vacia.yCero)).toBe(true);
  });
});

describe("petición al endpoint", () => {
  it("sin ningún filtro activo no se envían ids (= todas)", () => {
    expect(idsParaPeticion(["a", "b"], false)).toBeNull();
    expect(clasificarPeticion(null)).toBe("todas");
  });
  it("con filtros se envían los ids únicos, en el orden recibido", () => {
    expect(idsParaPeticion(["b", "a", "b"], true)).toEqual(["b", "a"]);
  });
  it("los filtros que no dejan nada no llaman a la API", () => {
    expect(idsParaPeticion([], true)).toEqual([]);
    expect(clasificarPeticion([])).toBe("vacia");
  });
  it("hasta 5 000 ids se piden; más, no", () => {
    const ids = (n: number) => Array.from({ length: n }, (_, i) => String(i));
    expect(MAX_EQUIVALENCIAS_PETICION).toBe(5000);
    expect(clasificarPeticion(ids(1))).toBe("ids");
    expect(clasificarPeticion(ids(5000))).toBe("ids");
    expect(clasificarPeticion(ids(5001))).toBe("excede");
  });
});
