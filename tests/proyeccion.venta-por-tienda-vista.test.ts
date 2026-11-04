import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { construirHojaLibro, nombreHojaValido } from "../src/app/(app)/planificacion/proyeccion/descarga-libro";
import {
  cabeceraPorTienda,
  clavePorTiendaValida,
  columnasPorTienda,
  etiquetaPeriodo,
  hojasPorTienda,
  mesAnioCorto,
  opcionesPorTienda,
  tablaPorTienda,
  textoAlertaDatosCambiados,
  textoFaltan,
  textoLeyendaPorTienda,
  textoPlano,
  tituloPorTienda,
  type FilaPorTienda,
} from "../src/app/(app)/planificacion/proyeccion/venta-por-tienda-vista";
import { nombreArchivoProyeccion } from "../src/app/(app)/planificacion/proyeccion/vista";
import type { VentaPorTiendaApi } from "../src/lib/proyeccion/tipos-api";
import { resumenCrecimientos } from "./proyeccion.crecimientos-pantalla.fixture";
import {
  ventaConMesFaltante,
  ventaConSinBloque,
  ventaMetodoAnterior,
  ventaMujerUrbano,
  ventaResto,
  ventaSinAtribuir,
  ventaSinFilas,
} from "./proyeccion.venta-por-tienda-pantalla.fixture";

/**
 * 07f · lógica de vista de «Ver por tienda» (ficha §5, §7 y el caso sintético de §8): las filas salen en el orden de la ficha, el subtotal de la base es Σ B, las
 * variaciones y sus motivos son los de §3.4, y el Excel lleva las mismas filas. Pura: sin React ni red.
 */

const fila = (filas: FilaPorTienda[], codigo: string): FilaPorTienda => {
  const f = filas.find((x) => x.codigo === codigo);
  if (!f) throw new Error(`falta la fila ${codigo}`);
  return f;
};
const resumen = (filas: FilaPorTienda[], tipo: FilaPorTienda["tipo"]): FilaPorTienda => {
  const f = filas.find((x) => x.tipo === tipo);
  if (!f) throw new Error(`falta la fila ${tipo}`);
  return f;
};
const lineas = (f: FilaPorTienda, clave: string) => f.variaciones[clave]?.lineas.map((l) => l.texto) ?? [];

describe("la clave de la URL y los conjuntos", () => {
  it("acepta `resto` y `<genero>.<mundo>`; rechaza todo lo demás", () => {
    expect(clavePorTiendaValida("resto")).toBe(true);
    expect(clavePorTiendaValida("a0000001-0000-4000-8000-000000000001.b0000001-0000-4000-8000-000000000001")).toBe(true);
    expect(clavePorTiendaValida("g-hombre.m-urbano")).toBe(true);
    for (const x of [null, "", "todos", "a|b", "a.b.c", "../x", "a.b?x=1", "RESTO "]) expect(clavePorTiendaValida(x), String(x)).toBe(false);
  });

  it("ofrece cada GM de la tabla y el Resto, y nunca el Total", () => {
    const o = opcionesPorTienda(resumenCrecimientos());
    expect(o.map((x) => x.nombre)).toEqual(["HOMBRE · FORMAL", "HOMBRE · URBANO", "MUJER · FORMAL", "MUJER · CASUAL", "Resto"]);
    expect(o.at(-1)?.clave).toBe("resto");
    expect(o.some((x) => /total/i.test(x.nombre))).toBe(false);
  });
});

describe("textos", () => {
  it("meses en palabras y leyenda con el corte", () => {
    expect(mesAnioCorto("2024-03")).toBe("mar 2024");
    expect(mesAnioCorto("2026-09-01")).toBe("set 2026");
    expect(textoLeyendaPorTienda("2026-09")).toBe("Soles netos de IGV. Sin CD. Datos hasta set 2026.");
    expect(tituloPorTienda("MUJER · URBANO")).toBe("Venta por tienda · MUJER · URBANO");
  });

  it("«faltan: mar 2024» y, con muchos, «+N más»", () => {
    expect(textoFaltan([])).toBeNull();
    expect(textoFaltan(["2024-03"])).toBe("faltan: mar 2024");
    expect(textoFaltan(["2024-01", "2024-02", "2024-03", "2024-04", "2024-05"])).toBe("faltan: ene 2024, feb 2024, mar 2024 +2 más");
  });

  it("etiquetas de periodo: año, ene–k del año anterior y ene–k real del año en curso", () => {
    expect(etiquetaPeriodo({ clave: "2024", anio: 2024, hasta_mes: 12 }, 2026)).toBe("2024");
    expect(etiquetaPeriodo({ clave: "2025-ac", anio: 2025, hasta_mes: 9 }, 2026)).toBe("2025 ene–set");
    expect(etiquetaPeriodo({ clave: "2026-ac", anio: 2026, hasta_mes: 9 }, 2026)).toBe("2026 ene–set (real)");
  });

  it("aviso de datos cambiados solo con los motivos que mueven el real por tienda", () => {
    const con = (codigo: string) => ({ desactualizada: [{ codigo, mensaje: "x" }] }) as never;
    for (const c of ["cargas_nuevas", "tiendas_cambiadas", "crecimientos_cambiados"]) {
      expect(textoAlertaDatosCambiados(con(c)), c).toContain("La proyección cambió de datos después de calcular: el real por tienda es el de hoy; recalcula para que el reparto use la misma venta");
    }
    expect(textoAlertaDatosCambiados(con("factores_cambiados"))).toBeNull();
    expect(textoAlertaDatosCambiados({ desactualizada: [] })).toBeNull();
  });
});

describe("cabecera de la tarjeta", () => {
  it("dice la base, que es el vigente de las mismas tiendas, cuántas son y la corregida del Niño", () => {
    const t = textoPlano(cabeceraPorTienda(ventaMujerUrbano()));
    expect(t).toContain("Base 2027 = 15,600 u");
    expect(t).toContain("unidades 2026 vigentes (real ene–set + proyectado oct–dic)");
    expect(t).toContain("mismas tiendas de 2027 (4 tiendas: abiertas los doce meses de 2026)");
    expect(t).toContain("Es la «Base 2026 (u)» real de la tabla de arriba");
    expect(t).toContain("T10 entra con su 2026 vigente exacto");
    expect(t).toContain("base corregida del Niño (16,400 u), que no se reparte por tienda");
    expect(cabeceraPorTienda(ventaMujerUrbano()).filter((s) => s.negrita).map((s) => s.texto)).toContain("vigentes");
  });

  it("sin Niño (Σ B' = Σ B) no habla de la base corregida", () => {
    const t = textoPlano(cabeceraPorTienda(ventaResto()));
    expect(t).toContain("Base 2027 = 500 u");
    expect(t).not.toContain("corregida");
  });

  it("método anterior y sin filas base: el mensaje de la ficha, sin base", () => {
    expect(textoPlano(cabeceraPorTienda(ventaMetodoAnterior()))).toContain("Recalcula la proyección para ver la base 2027");
    expect(textoPlano(cabeceraPorTienda(ventaSinFilas()))).toContain("Este GM no tiene filas base en 2027");
    expect(textoPlano(cabeceraPorTienda({ ...ventaSinFilas(), conjunto: { clave: "resto", nombre: "Resto", es_resto: true } }))).toContain("El Resto no tiene filas base en 2027");
  });
});

describe("columnas", () => {
  it("tienda, cada año con su variación, las dos columnas de ene–set, y el cierre vigente con la suya", () => {
    expect(columnasPorTienda(ventaMujerUrbano()).map((c) => c.clave)).toEqual(["tienda", "2023", "2024", "var:2024", "2025", "var:2025", "2025-ac", "2026-ac", "var:2026-ac", "vigente", "var:vigente"]);
  });

  it("la variación dice contra qué se compara", () => {
    const c = columnasPorTienda(ventaMujerUrbano());
    expect(c.find((x) => x.clave === "var:2024")?.subtitulo).toBe("vs 2023");
    expect(c.find((x) => x.clave === "var:2026-ac")?.subtitulo).toBe("vs 2025 ene–set");
    expect(c.find((x) => x.clave === "var:vigente")?.subtitulo).toBe("vs 2025");
    expect(c.find((x) => x.clave === "vigente")?.titulo).toBe("2026 cierre vigente");
  });

  it("con método anterior no hay columna de vigente ni su variación", () => {
    const c = columnasPorTienda(ventaMetodoAnterior()).map((x) => x.clave);
    expect(c).not.toContain("vigente");
    expect(c).not.toContain("var:vigente");
    expect(tablaPorTienda(ventaMetodoAnterior()).conVigente).toBe(false);
  });

  it("un periodo con meses faltantes los lleva en su columna", () => {
    const c = columnasPorTienda(ventaConMesFaltante());
    expect(c.find((x) => x.clave === "2024")?.faltan).toEqual(["2024-03"]);
    expect(c.find((x) => x.clave === "2025")?.faltan).toEqual([]);
  });
});

describe("filas y subtotales (§5 y caso §8)", () => {
  const t = tablaPorTienda(ventaMujerUrbano());

  it("orden: base, subtotal de la base, fuera, subtotal de fuera y total; sin CD", () => {
    expect(t.filas.map((f) => f.codigo || f.tipo)).toEqual(["T01", "T02", "T10", "T03", "subtotal_base", "T04", "T11", "T09", "subtotal_fuera", "total"]);
    expect(t.filas.some((f) => f.codigo === "CD1" || /CD1/.test(f.nombre))).toBe(false);
    expect(resumen(t.filas, "subtotal_base").nombre).toBe("Base 2027 · mismas tiendas de 2027 (4)");
    expect(resumen(t.filas, "subtotal_fuera").nombre).toBe("Fuera de la base (3)");
    expect(resumen(t.filas, "total").nombre).toBe("Total MUJER · URBANO (todas las tiendas, sin CD)");
  });

  it("el subtotal de la base es Σ B y cuadra con la suma de sus tiendas", () => {
    const v = ventaMujerUrbano();
    const sub = resumen(t.filas, "subtotal_base");
    expect(sub.vigente?.valor?.u).toBe(15600);
    expect(sub.vigente?.principal).toBe("15,600 u");
    expect(sub.vigente?.marca).toBe("= base de la tabla de arriba");
    const suma = t.filas.filter((f) => f.tipo === "tienda" && f.grupo === "base").reduce((a, f) => a + (f.vigente?.valor?.u ?? 0), 0);
    expect(suma + v.base.sin_atribuir).toBe(v.base.total);
    expect(v.base.total).toBe(15600);
  });

  it("las mismas tiendas llevan su vigente estimado y T10 el exacto; las cifras de §8", () => {
    expect(fila(t.filas, "T01").vigente?.principal).toBe("8,400 u");
    expect(fila(t.filas, "T01").vigente?.detalle).toBe("real 6,000 + proy. 2,400 · estimado");
    expect(fila(t.filas, "T02").vigente?.principal).toBe("4,200 u");
    expect(fila(t.filas, "T03").vigente?.principal).toBe("1,400 u");
    expect(fila(t.filas, "T10").vigente?.principal).toBe("1,600 u");
    expect(fila(t.filas, "T10").vigente?.detalle).toBe("real 1,200 + proy. 400");
    expect(fila(t.filas, "T10").vigente?.detalle).not.toContain("estimado");
  });

  it("cada periodo trae unidades y soles, en formato es-PE", () => {
    const p = fila(t.filas, "T01").periodos["2026-ac"];
    expect(p.u).toBe("6,000 u");
    expect(p.s).toBe("S/ 480,000");
    expect(fila(t.filas, "T01").periodos["2025-ac"].s).toBe("S/ 380,000");
  });

  it("variaciones de §8: T01 +20,0 % u y +26,3 % S/; T03 −8,3 % y +27,3 %", () => {
    expect(lineas(fila(t.filas, "T01"), "2026-ac")).toEqual(["+20.0 % u", "+26.3 % S/"]);
    expect(lineas(fila(t.filas, "T01"), "vigente")).toEqual(["+20.0 % u"]);
    expect(lineas(fila(t.filas, "T03"), "2024")).toEqual(["-8.3 % u", "-8.3 % S/"]);
    expect(lineas(fila(t.filas, "T03"), "2025")).toEqual(["+27.3 % u", "+27.3 % S/"]);
    expect(lineas(fila(t.filas, "T03"), "vigente")).toEqual(["0.0 % u"]);
  });

  it("motivos: nueva, parcial y sin dato", () => {
    // T10 abrió en nov 2025: ene–set 2025 es 0 → «nueva»; 2025 y el vigente frente a un 2025 parcial → «nueva» y «parcial».
    expect(lineas(fila(t.filas, "T10"), "2026-ac")).toEqual(["nueva"]);
    expect(lineas(fila(t.filas, "T10"), "2025")).toEqual(["nueva"]);
    expect(lineas(fila(t.filas, "T10"), "vigente")).toEqual(["parcial"]);
    expect(lineas(fila(t.filas, "T10"), "2024")).toEqual(["—"]);
    // T09 cerró en agosto de 2024: 2024 parcial y 2025 frente a un 2024 parcial, también.
    expect(lineas(fila(t.filas, "T09"), "2024")).toEqual(["parcial"]);
    expect(lineas(fila(t.filas, "T09"), "2025")).toEqual(["parcial"]);
    expect(fila(t.filas, "T10").variaciones["vigente"].titulo).toContain("Parcial: la tienda no estuvo abierta todo uno de los dos periodos");
  });

  it("un año parcial con venta va en gris con «parcial»; un cero de antes de abrir va en gris sin la marca", () => {
    const t10 = fila(t.filas, "T10");
    expect(t10.periodos["2025"]).toMatchObject({ gris: true, parcial: true });
    expect(t10.periodos["2023"]).toMatchObject({ gris: true, parcial: false });
    expect(fila(t.filas, "T01").periodos["2025"]).toMatchObject({ gris: false, parcial: false });
    expect(fila(t.filas, "T09").periodos["2024"]).toMatchObject({ gris: true, parcial: true });
  });

  it("subtotal de la base: variación total y comparable (sin T10) con la nota de por qué", () => {
    const sub = resumen(t.filas, "subtotal_base");
    expect(sub.periodos["2026-ac"].u).toBe("11,200 u");
    expect(lineas(sub, "2026-ac")[0]).toBe("+31.8 % u");
    expect(sub.variaciones["2026-ac"].comparable?.texto).toMatch(/^comparable \+17\.6 % u/);
    expect(sub.variaciones["2026-ac"].comparable?.titulo).toContain("El subtotal incluye T10, sin 2025 ene–set completo");
    expect(sub.vigente?.principal).toBe("15,600 u");
    expect(lineas(sub, "vigente")).toEqual(["+27.9 % u"]);
    expect(sub.variaciones["vigente"].comparable?.texto).toBe("comparable +17.6 % u");
    // Una tienda parcial con 0 en los dos periodos no mueve la cifra: no se repite una «comparable» idéntica.
    expect(sub.variaciones["2024"].comparable).toBeNull();
  });

  it("las tiendas de fuera: T04 sale (— en el vigente), T11 abrió en 2026 (vigente exacto) y T09 cerró", () => {
    const t04 = fila(t.filas, "T04");
    expect(t04.grupo).toBe("fuera");
    expect(t04.vigente?.principal).toBe("—");
    expect(t04.vigente?.titulo).toBe("Su 2026 sale de la base (B2); no se reparte por tienda.");
    expect(t04.insignia?.texto).toBe("sale");
    expect(t04.nota).toContain("Cierra el 30 jun 2027");
    const t11 = fila(t.filas, "T11");
    expect(t11.vigente?.principal).toBe("700 u");
    expect(t11.vigente?.detalle).toBe("real 400 + proy. 300");
    expect(t11.insignia?.texto).toBe("abrió en 2026");
    expect(t11.nota).toContain("entra en la base de 2028");
    expect(fila(t.filas, "T09").nota).toBe("Cerró el 31 ago 2024");
    expect(fila(t.filas, "T09").vigente?.principal).toBe("—");
  });

  it("las mismas no repiten su motivo bajo el nombre; entra, sale y las de fuera sí", () => {
    expect(fila(t.filas, "T01").nota).toBeNull();
    expect(fila(t.filas, "T10").nota).toContain("entra en la base de 2027");
    expect(fila(t.filas, "T01").insignia?.titulo).toBe("Misma tienda de 2026 y de 2027");
  });

  it("el total del conjunto no trae vigente", () => {
    const total = resumen(t.filas, "total");
    expect(total.vigente).toBeNull();
    expect(total.variaciones["vigente"]).toBeUndefined();
    expect(total.periodos["2026-ac"].u).toBe("12,400 u");
  });
});

describe("casos borde (§7)", () => {
  it("mes faltante: el periodo trae el badge y sus dos variaciones salen «incompleto»", () => {
    const t = tablaPorTienda(ventaConMesFaltante());
    const t01 = fila(t.filas, "T01");
    expect(lineas(t01, "2024")).toEqual(["incompleto"]);
    expect(lineas(t01, "2025")).toEqual(["incompleto"]);
    expect(lineas(t01, "2026-ac")[0]).toBe("+20.0 % u");
    expect(t01.variaciones["2024"].titulo).toContain("falta un mes publicado");
  });

  it("sin venta publicada: todo R va a «Sin atribuir a tienda», entre las tiendas de la base y su subtotal", () => {
    const v = ventaSinAtribuir();
    const t = tablaPorTienda(v);
    const i = t.filas.findIndex((f) => f.tipo === "sin_atribuir");
    expect(i).toBeGreaterThan(0);
    expect(t.filas[i + 1].tipo).toBe("subtotal_base");
    expect(t.filas[i].nombre).toBe("Sin atribuir a tienda");
    expect(t.filas[i].vigente?.principal).toBe("14,000 u");
    expect(t.filas[i].periodos).toEqual({});
    expect(resumen(t.filas, "subtotal_base").vigente?.valor?.u).toBe(15600);
    expect(v.avisos.map((a) => a.codigo)).toContain("sin_atribuir");
  });

  it("sin «sin atribuir» no hay fila (el caso normal)", () => {
    expect(tablaPorTienda(ventaMujerUrbano()).filas.some((f) => f.tipo === "sin_atribuir")).toBe(false);
  });

  it("método anterior: las columnas reales se muestran y el vigente no", () => {
    const v = ventaMetodoAnterior();
    expect(v.base.motivo_nulo).toBe("metodo_anterior");
    const t = tablaPorTienda(v);
    expect(fila(t.filas, "T01").periodos["2026-ac"].u).toBe("6,000 u");
    expect(resumen(t.filas, "subtotal_base").vigente).toBeNull();
    expect(t.filas.every((f) => f.tipo !== "sin_atribuir")).toBe(true);
  });

  it("GM sin filas base: motivo `sin_filas` y las columnas reales siguen", () => {
    const v = ventaSinFilas();
    expect(v.base.motivo_nulo).toBe("sin_filas");
    expect(columnasPorTienda(v).map((c) => c.clave)).not.toContain("vigente");
    expect(fila(tablaPorTienda(v).filas, "T01").periodos["2025"].u).toBe("7,000 u");
  });

  it("tienda creada después de calcular: `sin_bloque`, fuera, con su aviso", () => {
    const v = ventaConSinBloque();
    const t = tablaPorTienda(v);
    const f = fila(t.filas, "T12");
    expect(f.grupo).toBe("fuera");
    expect(f.insignia?.texto).toBe("sin clasificar");
    expect(f.nota).toBe("No existía al calcular: recalcula");
    expect(v.avisos.map((a) => a.codigo)).toContain("sin_bloque");
  });

  it("el Resto: misma forma, sin Niño y sin tiendas de fuera", () => {
    const v = ventaResto();
    expect(v.conjunto.es_resto).toBe(true);
    const t = tablaPorTienda(v);
    expect(t.filas.some((f) => f.tipo === "subtotal_fuera")).toBe(false);
    expect(resumen(t.filas, "subtotal_base").vigente?.valor?.u).toBe(500);
    expect(resumen(t.filas, "total").nombre).toBe("Total Resto (todas las tiendas, sin CD)");
  });

  it("variación con un número negativo: la línea se marca como negativa", () => {
    const t = tablaPorTienda(ventaMujerUrbano());
    expect(fila(t.filas, "T03").variaciones["2024"].lineas.every((l) => l.negativo)).toBe(true);
    expect(fila(t.filas, "T01").variaciones["2024"].lineas.some((l) => l.negativo)).toBe(false);
  });

  it("nunca inventa soles del cierre vigente: la columna es solo de unidades", () => {
    const t = tablaPorTienda(ventaMujerUrbano());
    for (const f of t.filas) expect(f.vigente?.principal ?? "").not.toMatch(/S\//);
    expect(t.columnas.find((c) => c.clave === "vigente")?.subtitulo).toBe("solo unidades");
    expect(t.filas.every((f) => (f.variaciones["vigente"]?.s ?? null) === null)).toBe(true);
  });
});

describe("Excel", () => {
  const datos = ventaMujerUrbano();
  const hojas = hojasPorTienda({ datos, proyeccion: "Proyección 2026–2027", fecha: "04/11/2026 10:00" });

  it("dos hojas, POR_TIENDA y FILTROS, y el archivo se llama como el resto de la proyección", () => {
    expect(Object.keys(hojas)).toEqual(["POR_TIENDA", "FILTROS"]);
    expect(nombreArchivoProyeccion(2026, "por-tienda")).toBe("proyeccion-2026-2027-por-tienda.xlsx");
    expect(hojas.FILTROS).toEqual([
      ["FILTRO", "VALOR"],
      ["proyeccion", "Proyección 2026–2027"],
      ["conjunto", "MUJER · URBANO"],
      ["corte", "2026-09"],
      ["fecha", "04/11/2026 10:00"],
    ]);
  });

  it("las mismas filas que la tabla, con una columna por cifra (u, S/ y %)", () => {
    const t = tablaPorTienda(datos);
    expect(hojas.POR_TIENDA).toHaveLength(1 + t.filas.length);
    const cab = hojas.POR_TIENDA[0];
    expect(cab.slice(0, 4)).toEqual(["GRUPO", "CODIGO", "TIENDA", "ESTADO"]);
    expect(cab).toContain("2026 ENE–SET (REAL) U");
    expect(cab).toContain("2026 ENE–SET (REAL) S/");
    expect(cab).toContain("2026 CIERRE VIGENTE U");
    expect(cab).toContain("2026 CIERRE VIGENTE TIPO");
    expect(cab).toContain("VAR 2026 ENE–SET (REAL) U %");
    expect(cab).toContain("VAR 2026 ENE–SET (REAL) COMPARABLE U %");
    // Todas las filas tienen el ancho de la cabecera (sin columnas corridas).
    for (const f of hojas.POR_TIENDA) expect(f).toHaveLength(cab.length);
  });

  it("T01: cifras, % con un decimal, vigente estimado; el subtotal de la base trae Σ B y su comparable", () => {
    const cab = hojas.POR_TIENDA[0];
    const col = (n: string) => cab.indexOf(n);
    const t01 = hojas.POR_TIENDA.find((f) => f[1] === "T01") ?? [];
    expect(t01[0]).toBe("BASE");
    expect(t01[col("2026 ENE–SET (REAL) U")]).toBe(6000);
    expect(t01[col("2026 ENE–SET (REAL) S/")]).toBe(480000);
    expect(t01[col("VAR 2026 ENE–SET (REAL) U %")]).toBe(20);
    expect(t01[col("VAR 2026 ENE–SET (REAL) S/ %")]).toBe(26.3);
    expect(t01[col("2026 CIERRE VIGENTE U")]).toBe(8400);
    expect(t01[col("2026 CIERRE VIGENTE TIPO")]).toBe("estimado");
    const sub = hojas.POR_TIENDA.find((f) => f[0] === "SUBTOTAL BASE") ?? [];
    expect(sub[col("2026 CIERRE VIGENTE U")]).toBe(15600);
    expect(sub[col("VAR 2026 CIERRE VIGENTE U %")]).toBe(27.9);
    expect(sub[col("VAR 2026 CIERRE VIGENTE COMPARABLE U %")]).toBe(17.6);
    const t10 = hojas.POR_TIENDA.find((f) => f[1] === "T10") ?? [];
    expect(t10[col("VAR 2026 CIERRE VIGENTE U %")]).toBeNull();
    expect(t10[col("VAR 2026 CIERRE VIGENTE MOTIVO")]).toBe("u: parcial");
    expect(t10[col("2026 CIERRE VIGENTE TIPO")]).toBe("exacto");
  });

  it("T04 (sale) deja el vigente vacío y no aparece ningún CD", () => {
    const cab = hojas.POR_TIENDA[0];
    const t04 = hojas.POR_TIENDA.find((f) => f[1] === "T04") ?? [];
    expect(t04[0]).toBe("FUERA");
    expect(t04[cab.indexOf("2026 CIERRE VIGENTE U")]).toBeNull();
    expect(hojas.POR_TIENDA.some((f) => f[1] === "CD1")).toBe(false);
  });

  it("se convierte a una hoja de Excel válida (un texto con = se escribe como texto) y los nombres de hoja valen", () => {
    const libro = XLSX.utils.book_new();
    for (const [nombre, filas] of Object.entries(hojas)) XLSX.utils.book_append_sheet(libro, construirHojaLibro(XLSX, filas), nombreHojaValido(nombre));
    expect(libro.SheetNames).toEqual(["POR_TIENDA", "FILTROS"]);
    const hoja = libro.Sheets.POR_TIENDA;
    expect(hoja["!cols"]).toHaveLength(hojas.POR_TIENDA[0].length);
    // La celda del subtotal de la base queda con su etiqueta, sin fórmulas.
    const sub = hojas.POR_TIENDA.findIndex((f) => f[0] === "SUBTOTAL BASE");
    expect(hoja[`C${sub + 1}`].t).toBe("s");
  });

  it("con método anterior no hay columnas de vigente en el Excel", () => {
    const h = hojasPorTienda({ datos: ventaMetodoAnterior() as VentaPorTiendaApi, proyeccion: "p", fecha: "f" });
    expect(h.POR_TIENDA[0].some((c) => String(c).includes("VIGENTE"))).toBe(false);
  });
});
