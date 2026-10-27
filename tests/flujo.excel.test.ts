import { describe, expect, it } from "vitest";
import {
  hojaConciliacion,
  hojaFlujo,
  hojaParametros,
  hojaSaldo,
  hojasCompras,
  hojasFlujo,
  filasVisibles,
} from "@/lib/flujo/excel";
import { comprasApiEjemplo, compraApiC12, compraApiCancelada } from "./compras.fixture";
import { conciliacionEjemplo, construirFlujo, flujoEjemplo } from "./flujo.fixture";

/** Regla 10 de la ficha 08 («Excel = pantalla») y el caso 18: las hojas del flujo y de las compras. */

const flujo = flujoEjemplo();

describe("hojasFlujo (regla 10)", () => {
  it("FLUJO tiene una columna por periodo (k' y el horizonte) y una fila por fila del flujo y magnitud, más los totales", () => {
    const hoja = hojaFlujo(flujo);
    expect(hoja[0]).toEqual(["GÉNERO", "MUNDO", "LÍNEA", "EQUIVALENCIA", "AGRUPACIÓN DE MARCA", "MAGNITUD", ...flujo.datos.periodos]);
    const conReposicion = flujo.filas.filter((f) => f.serie.reposicion).length;
    // 8 magnitudes por fila (7 sin reposición directa) y las de los totales
    expect(hoja.length).toBe(1 + flujo.filas.length * 7 + conReposicion + 7);
    expect(hoja.every((fila) => fila.length === hoja[0].length)).toBe(true);
  });

  it("las celdas son las de la pantalla: las series de la lista, con las señales con su nombre", () => {
    const hoja = hojaFlujo(flujo);
    const f0 = flujo.filas[0];
    const nodo = flujo.catalogo.nodos[f0.equivalencia_id ?? f0.gml_id];
    const propias = hoja.filter((fila) => fila[0] === nodo.genero && fila[2] === nodo.linea && fila[4] === flujo.catalogo.agrupaciones[f0.agrupacion_marca_id]);
    const por = (m: string) => propias.find((x) => x[5] === m)!.slice(6);
    expect(por("Venta real / demanda")).toEqual(f0.serie.demanda);
    expect(por("Stock fin de mes (cadena)")).toEqual(f0.serie.stock);
    expect(por("IMI")).toEqual(f0.serie.imi);
    expect(por("Saldo por comprar")).toEqual(f0.serie.saldo);
    expect(por("Señal").slice(0, 3)).toEqual(["—", "Falta", "Al día"]);
  });

  it("la fila de reposición directa esperada solo aparece en las filas con subflujo", () => {
    const hoja = hojaFlujo(flujo);
    expect(hoja.filter((fila) => fila[5] === "Reposición directa esperada" && fila[0] !== "TOTAL").length).toBe(flujo.filas.filter((f) => f.serie.reposicion).length);
  });

  it("caso 18: con el filtro HOMBRE solo salen las filas de HOMBRE y las hojas son iguales a la pantalla filtrada", () => {
    const hombre = flujo.catalogo.nodos[flujo.filas[0].equivalencia_id ?? flujo.filas[0].gml_id].genero_id;
    const visibles = filasVisibles(flujo, { genero_id: hombre });
    expect(visibles.length).toBeGreaterThan(0);
    expect(visibles.length).toBeLessThan(flujo.filas.length);
    const hoja = hojaFlujo(flujo, { genero_id: hombre });
    const generos = new Set(hoja.slice(1).filter((f) => f[0] !== "TOTAL").map((f) => f[0]));
    expect([...generos]).toEqual(["HOMBRE"]);
    const filtrado = { ...flujo, filas: visibles };
    expect(hojaFlujo(filtrado)).toEqual(hoja);
  });

  it("los filtros solo=… y mio=… reducen las filas", () => {
    expect(filasVisibles(flujo, { mio: true }).every((f) => f.mia)).toBe(true);
    expect(filasVisibles(flujo, { solo: "por_confirmar" }).every((f) => f.resumen.por_confirmar > 0)).toBe(true);
    expect(filasVisibles(flujo, { solo: "falta" }).every((f) => f.resumen.senal === "falta")).toBe(true);
  });

  it("SALDO: el saldo por periodo del horizonte, su suma, el stock y el IMI de k'", () => {
    const hoja = hojaSaldo(flujo);
    expect(hoja[0].slice(0, 9)).toEqual(["GÉNERO", "MUNDO", "LÍNEA", "EQUIVALENCIA", "AGRUPACIÓN DE MARCA", "RESPONSABLE", "STOCK CADENA", "IMI", "SEÑAL"]);
    expect(hoja[0]).toHaveLength(9 + (flujo.datos.periodos.length - 1) + 1);
    const f0 = flujo.filas[0];
    const fila = hoja[1];
    expect(fila.slice(9, -1)).toEqual(f0.serie.saldo.slice(1));
    expect(fila[fila.length - 1]).toBe(f0.serie.saldo.slice(1).reduce((a, x) => a + x, 0));
    expect(fila[6]).toBe(f0.stock_k.total);
    expect(hoja[hoja.length - 1][0]).toBe("TOTAL");
  });

  it("PARAMETROS y las hojas juntas", () => {
    const p = hojaParametros(flujo);
    expect(p).toContainEqual(["IMI mínimo (meses)", 4]);
    expect(p).toContainEqual(["IMI máximo (meses)", 8]);
    expect(p).toContainEqual(["Verano", "mes 10 a mes 3"]);
    const hojas = hojasFlujo({ flujo, conciliacion: conciliacionEjemplo(), filtro: {} });
    expect(Object.keys(hojas)).toEqual(["FLUJO", "SALDO", "CONCILIACION", "PARAMETROS", "FILTROS"]);
    expect(hojasFlujo({ flujo }).CONCILIACION).toBeNull();
    expect(hojas.FILTROS).toContainEqual(["datos_hasta", "2026-09"]);
  });

  it("CONCILIACION: una fila por fila conciliada con sus sugerencias y el % directo observado", () => {
    const c = conciliacionEjemplo();
    const hoja = hojaConciliacion(c);
    expect(hoja).toHaveLength(1 + c.filas.length + 1);
    const polo = hoja.find((f) => String(f[0]).includes("POLO"))!;
    expect(String(polo[14])).toContain("C-000009: confirmar 500 u en 2026-09");
    const jh = hoja.find((f) => f[2] === "JOHN HOLDEN")!;
    expect(jh[15]).toBe(80);
    expect(jh[16]).toBe(80);
    expect(hoja[hoja.length - 1][0]).toBe("TOTAL");
  });

  it("una lista grande se exporta sin perder filas", () => {
    const grande = construirFlujo({ filas: 200, horizonte: 15 });
    expect(hojaFlujo(grande).length).toBeGreaterThan(200 * 7);
  });
});

describe("hojasCompras", () => {
  const compras = comprasApiEjemplo();
  const hojas = hojasCompras(compras);

  it("COMPRAS: una fila por compra con sus totales, entregas y avisos", () => {
    expect(hojas.COMPRAS).toHaveLength(1 + compras.length);
    const c12 = hojas.COMPRAS.find((f) => f[0] === "C-000012")!;
    expect(c12.slice(0, 5)).toEqual(["C-000012", "2026-10-14", "Proveedor Norte", "comprador", "confirmada"]);
    expect(c12[9]).toBe(500);
    expect(c12[10]).toBe(19000);
  });

  it("ENTREGAS: una fila por entrega con lo asignado, lo cancelado y lo pendiente", () => {
    const totalEntregas = compras.reduce((a, c) => a + c.lineas.reduce((b, l) => b + l.entregas.length, 0), 0);
    expect(hojas.ENTREGAS).toHaveLength(1 + totalEntregas);
    const e = hojas.ENTREGAS.find((f) => f[0] === "C-000012")!;
    expect(e[7]).toBe("2026-11");
    expect(e[8]).toBe(500);
    expect(e[11]).toBe(500);
  });

  it("POR_PROVEEDOR y COSTO no cuentan las compras canceladas", () => {
    const todas = hojasCompras([...compras, compraApiCancelada()]);
    expect(todas.POR_PROVEEDOR).toEqual(hojas.POR_PROVEEDOR);
    expect(todas.COSTO).toEqual(hojas.COSTO);
    expect(todas.COMPRAS).toHaveLength(hojas.COMPRAS.length + 1);
    const norte = hojas.POR_PROVEEDOR.find((f) => f[0] === "Proveedor Norte")!;
    expect(norte[1]).toBeGreaterThanOrEqual(1);
    expect(hojas.COSTO.find((f) => f[0] === "C-000012")![8]).toBe(19000);
  });

  it("una sola compra", () => {
    const una = hojasCompras([compraApiC12()]);
    expect(una.COMPRAS).toHaveLength(2);
    expect(una.POR_PROVEEDOR).toEqual([["PROVEEDOR", "COMPRAS", "UNIDADES", "RECIBIDAS", "COSTO PEN", "COSTO USD"], ["Proveedor Norte", 1, 500, 0, 19000, 0]]);
  });
});
