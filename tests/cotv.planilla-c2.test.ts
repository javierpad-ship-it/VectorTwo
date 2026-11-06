import { describe, expect, it } from "vitest";
import { filaImportacionCompraConAgrupadoresSchema } from "@/lib/compras/agrupadores/esquemas";
import { previsualizarImportacionCompras } from "@/lib/compras/importar";
import { agruparItemsCotv, COLUMNAS_PLANILLA_C2, diaEnLima, ENCABEZADOS_GRUPOS, LLEGADA_INICIAL_COTV, MAX_NOTA_PLANILLA, referenciaCotv, type FilaPlanillaC2, type ItemCotv } from "../scripts/cotv/planilla-c2";
import { PROVEEDOR } from "./compras.fixture";
import { estadoImportacionBase } from "./compras.estado.fixture";

/**
 * F42 (08b-1b §2.7, F-R18): la planilla C2 agrupada de la carga de COTV. Datos SINTÉTICOS: ningún dato real de COTV ni de Lukers. La función es
 * pura (`scripts/cotv/planilla-c2.ts`): agrupa los ítems en compras por proveedor y viaje y arma las filas, con una sola `FECHA_COMPRA` por grupo.
 */

const V = "261001";
const ID_X = "11111111-aaaa-4aaa-8aaa-111111111111";
const ID_Y = "22222222-bbbb-4bbb-8bbb-222222222222";

const item = (p: Partial<ItemCotv> & Pick<ItemCotv, "item_id" | "created_at">): ItemCotv => ({
  supplier_id: ID_X,
  proveedor: "Proveedor Norte",
  codigo_viaje: V,
  comprador: "C1",
  nota: null,
  genero: "H",
  mundo: "URBANO",
  linea: "DENIM",
  marca: "ALFA",
  unidades: 100,
  costo_fob: 38,
  ...p,
});

/** Proveedor X: registrado el 06-jul a las 23:30 de Lima (en UTC ya es 07-jul: `purchase_date` diría 07-jul) y el 20-jul a las 10:00. Z (unido a X en C1) lleva el supplier_id de X. */
const itemsF42 = (): ItemCotv[] => [
  item({ item_id: "i-x-2", created_at: "2026-07-20T15:00:00Z", unidades: 200, comprador: "C2" }), // 20-jul 10:00 Lima
  item({ item_id: "i-x-1", created_at: "2026-07-07T04:30:00Z", unidades: 300 }), // 06-jul 23:30 Lima = 07-jul UTC
  item({ item_id: "i-z-1", created_at: "2026-07-07T04:45:00Z", unidades: 50, comprador: "C1", nota: "Pedido urgente" }), // proveedor Z, unido a X
  item({ item_id: "i-y-1", created_at: "2026-07-08T15:00:00Z", supplier_id: ID_Y, proveedor: "Feria Sur", unidades: 500, comprador: "C1" }),
];

const porItem = (filas: readonly FilaPlanillaC2[], id: string) => filas.find((f) => f.ITEM_COTV === id) as FilaPlanillaC2;

describe("F42: dos compras (X + Z en una, Y aparte)", () => {
  const r = agruparItemsCotv(itemsF42());

  it("una compra por proveedor y viaje: X y Z (unido) en `COTV-{V}-{id de X}`; Y aparte", () => {
    expect(r.grupos.map((g) => [g.proveedor, g.referencia, g.lineas])).toEqual([
      ["Feria Sur", referenciaCotv(V, ID_Y), 1],
      ["Proveedor Norte", referenciaCotv(V, ID_X), 3],
    ]);
    expect(new Set(r.filas.map((f) => f.REFERENCIA)).size).toBe(2);
    expect(referenciaCotv(V, ID_X)).toBe(`COTV-261001-${ID_X}`);
    expect(referenciaCotv(V, ID_X)).toHaveLength(48);
  });

  it("LINEA_ORDINAL 1, 2, 3… por `created_at` y luego `id`, aunque lleguen desordenados", () => {
    const x = r.filas.filter((f) => f.REFERENCIA === referenciaCotv(V, ID_X));
    expect(x.map((f) => [f.LINEA_ORDINAL, f.ITEM_COTV])).toEqual([["1", "i-x-1"], ["2", "i-z-1"], ["3", "i-x-2"]]);
    expect(r.filas.filter((f) => f.REFERENCIA === referenciaCotv(V, ID_Y)).map((f) => f.LINEA_ORDINAL)).toEqual(["1"]);
  });

  it("`FECHA_COMPRA` es el 06-jul (el día en Lima del ítem más antiguo, no el 07-jul UTC de `purchase_date`) en TODAS las filas del grupo", () => {
    const x = r.filas.filter((f) => f.REFERENCIA === referenciaCotv(V, ID_X));
    expect(x.map((f) => f.FECHA_COMPRA)).toEqual(["2026-07-06", "2026-07-06", "2026-07-06"]);
    expect(r.filas.find((f) => f.REFERENCIA === referenciaCotv(V, ID_Y))?.FECHA_COMPRA).toBe("2026-07-08");
    expect(diaEnLima("2026-07-07T04:30:00Z")).toBe("2026-07-06");
    expect(diaEnLima("2026-07-07T05:00:00Z")).toBe("2026-07-07");
    expect(diaEnLima("2026-07-06T04:59:59Z")).toBe("2026-07-05");
  });

  it("`DIA_REGISTRO` por fila (el día en Lima de cada ítem) e `ITEM_COTV` con el id; las filas salen ordenadas por proveedor y día de registro", () => {
    expect(r.filas.map((f) => [f.PROVEEDOR, f.DIA_REGISTRO, f.ITEM_COTV])).toEqual([
      ["Feria Sur", "2026-07-08", "i-y-1"],
      ["Proveedor Norte", "2026-07-06", "i-x-1"],
      ["Proveedor Norte", "2026-07-06", "i-z-1"],
      ["Proveedor Norte", "2026-07-20", "i-x-2"],
    ]);
  });

  it("la hoja GRUPOS marca «varios días» el grupo de X (06-jul y 20-jul) y no el de Y", () => {
    expect(r.hojas.GRUPOS[0]).toEqual([...ENCABEZADOS_GRUPOS]);
    expect(r.hojas.GRUPOS.slice(1)).toEqual([
      ["Feria Sur", V, referenciaCotv(V, ID_Y), 1, "2026-07-08", "2026-07-08", "2026-07-08", ""],
      ["Proveedor Norte", V, referenciaCotv(V, ID_X), 3, "2026-07-06", "2026-07-06", "2026-07-20", "varios días"],
    ]);
    expect(r.grupos.map((g) => g.varios_dias)).toEqual([false, true]);
  });

  it("la hoja LEEME explica cómo partir un grupo con dos OC", () => {
    const texto = r.hojas.LEEME.map((f) => String(f[0])).join("\n");
    expect(texto).toContain("cambia la REFERENCIA");
    expect(texto).toContain("una sola FECHA_COMPRA");
    expect(texto).toContain("GRUPOS");
  });

  it("LLEGADA = 2026-12 (un mes) en todas las filas; EMBARQUE, PAQUETE y OC vacías; VIAJE con el código; USD; la NOTA es una por grupo", () => {
    expect(LLEGADA_INICIAL_COTV).toBe("2026-12");
    expect(r.filas.every((f) => f.LLEGADA === "2026-12" && f.EMBARQUE === "" && f.PAQUETE === "" && f.OC === "" && f.VIAJE === V && f.MONEDA === "USD" && f.TIPO === "ESPECIFICA" && f.RECIBIDAS === "")).toBe(true);
    const notas = new Set(r.filas.filter((f) => f.REFERENCIA === referenciaCotv(V, ID_X)).map((f) => f.NOTA));
    expect([...notas]).toEqual(["Registrada en COTV por C1, C2 · Pedido urgente"]);
    expect(porItem(r.filas, "i-y-1").NOTA).toBe("Registrada en COTV por C1");
  });

  it("las columnas son las del importador, en su orden, más las dos informativas al final", () => {
    expect(COLUMNAS_PLANILLA_C2.slice(0, 20)).toEqual(["PROVEEDOR", "FECHA_COMPRA", "REFERENCIA", "LINEA_ORDINAL", "TIPO", "GENERO", "MUNDO", "LINEA", "EQUIVALENCIA", "MARCA", "AGRUPACION_MARCA", "TALLAS", "UNIDADES", "COSTO_UNITARIO", "MONEDA", "LLEGADA", "ENTREGAS", "RECIBIDAS", "DESTINO", "ALCANCE"]);
    expect(COLUMNAS_PLANILLA_C2.slice(20)).toEqual(["NOTA", "VIAJE", "EMBARQUE", "PAQUETE", "OC", "DIA_REGISTRO", "ITEM_COTV"]);
    expect(r.hojas.COMPRAS[0]).toEqual([...COLUMNAS_PLANILLA_C2]);
    expect(r.hojas.COMPRAS).toHaveLength(1 + r.filas.length);
    expect(r.hojas.COMPRAS[1]).toHaveLength(COLUMNAS_PLANILLA_C2.length);
  });
});

describe("F42: el ensayo contra el importador real de compras (0 `cabecera_inconsistente`; las informativas se ignoran)", () => {
  const proveedores = [{ id: PROVEEDOR.norte, nombre: "Proveedor Norte", codigo: "PN", activo: true, es_intercompany: false }, { id: PROVEEDOR.feria, nombre: "Feria Sur", activo: true, es_intercompany: false }];
  const importar = (filas: FilaPlanillaC2[]) => {
    const parseadas = filas.map((f) =>
      filaImportacionCompraConAgrupadoresSchema.parse({
        proveedor: f.PROVEEDOR,
        fecha_compra: f.FECHA_COMPRA,
        referencia: f.REFERENCIA,
        linea_ordinal: f.LINEA_ORDINAL,
        tipo: f.TIPO,
        genero: f.GENERO,
        mundo: f.MUNDO,
        linea: f.LINEA,
        equivalencia: f.EQUIVALENCIA,
        marca: f.MARCA,
        agrupacion_marca: f.AGRUPACION_MARCA,
        tallas: f.TALLAS,
        unidades: f.UNIDADES,
        costo_unitario: f.COSTO_UNITARIO,
        moneda: f.MONEDA,
        llegada: f.LLEGADA,
        entregas: f.ENTREGAS,
        recibidas: f.RECIBIDAS,
        destino: f.DESTINO,
        alcance: f.ALCANCE,
        nota: f.NOTA,
        viaje: f.VIAJE,
        embarque: f.EMBARQUE,
        paquete: f.PAQUETE,
        oc: f.OC,
        // Las informativas viajan en el archivo y el esquema de la fila las descarta:
        DIA_REGISTRO: f.DIA_REGISTRO,
        ITEM_COTV: f.ITEM_COTV,
      }),
    );
    return previsualizarImportacionCompras(parseadas, [], { ...estadoImportacionBase(), proveedores }, { carga_inicial: true, k_prima: "2026-09" });
  };
  const { filas } = agruparItemsCotv(itemsF42());

  it("la planilla tal cual: 2 compras, 4 líneas, sin omitidas ni `cabecera_inconsistente`, con entregas dic-26", () => {
    const r = importar(filas);
    expect(r.reporte.omitidas).toEqual([]);
    expect(r.reporte.totales).toMatchObject({ nuevas: 4, omitidas: 0 });
    expect(r.reporte.compras_a_crear.map((c) => [c.proveedor, c.referencia, c.lineas, c.fecha_compra])).toEqual([
      ["Feria Sur", referenciaCotv(V, ID_Y), 1, "2026-07-08"],
      ["Proveedor Norte", referenciaCotv(V, ID_X), 3, "2026-07-06"],
    ]);
    expect(r.reporte.lineas.every((l) => l.entregas.length === 1 && l.entregas[0].periodo === "2026-12")).toBe(true);
  });

  it("si Javier cambia la REFERENCIA de las filas del 20-jul a `…-2` y su FECHA_COMPRA a 20-jul: tres compras, sin `cabecera_inconsistente`", () => {
    const partidas = filas.map((f) => (f.DIA_REGISTRO === "2026-07-20" ? { ...f, REFERENCIA: `${f.REFERENCIA}-2`, FECHA_COMPRA: "2026-07-20" } : f));
    const r = importar(partidas);
    expect(r.reporte.omitidas.filter((o) => o.motivo === "cabecera_inconsistente")).toEqual([]);
    expect(r.reporte.omitidas).toEqual([]);
    expect(r.reporte.compras_a_crear).toHaveLength(3);
    expect(r.reporte.compras_a_crear.map((c) => [c.referencia.endsWith("-2"), c.fecha_compra, c.lineas])).toEqual([
      [false, "2026-07-08", 1],
      [false, "2026-07-06", 2],
      [true, "2026-07-20", 1],
    ]);
  });

  it("si cambia la REFERENCIA pero no la fecha, la segunda compra queda con 06-jul (sin error)", () => {
    const partidas = filas.map((f) => (f.DIA_REGISTRO === "2026-07-20" ? { ...f, REFERENCIA: `${f.REFERENCIA}-2` } : f));
    const r = importar(partidas);
    expect(r.reporte.omitidas).toEqual([]);
    expect(r.reporte.compras_a_crear.map((c) => c.fecha_compra)).toEqual(["2026-07-08", "2026-07-06", "2026-07-06"]);
  });

  it("si Javier deja fechas distintas dentro de una misma referencia, lo ve en la previsualización: esa fila sale `cabecera_inconsistente`", () => {
    const mal = filas.map((f) => (f.ITEM_COTV === "i-x-2" ? { ...f, FECHA_COMPRA: "2026-07-20" } : f));
    expect(importar(mal).reporte.omitidas.map((o) => o.motivo)).toEqual(["cabecera_inconsistente"]);
  });
});

describe("agruparItemsCotv: casos borde", () => {
  it("sin ítems: solo los encabezados", () => {
    const r = agruparItemsCotv([]);
    expect(r.filas).toEqual([]);
    expect(r.hojas.COMPRAS).toEqual([[...COLUMNAS_PLANILLA_C2]]);
    expect(r.hojas.GRUPOS).toEqual([[...ENCABEZADOS_GRUPOS]]);
  });

  it("no agrupa por día: dos ítems de días distintos del mismo proveedor y viaje son una sola compra; el mismo proveedor en otro viaje, otra", () => {
    const r = agruparItemsCotv([
      item({ item_id: "a", created_at: "2026-07-06T15:00:00Z" }),
      item({ item_id: "b", created_at: "2026-08-06T15:00:00Z" }),
      item({ item_id: "c", created_at: "2026-07-06T15:00:00Z", codigo_viaje: "261002" }),
    ]);
    expect(r.grupos.map((g) => [g.viaje, g.lineas, g.fecha_compra])).toEqual([[V, 2, "2026-07-06"], ["261002", 1, "2026-07-06"]]);
  });

  it("un código de género de COTV sin equivalente se deja y avisa para revisar la fila; los conocidos se traducen", () => {
    const r = agruparItemsCotv([
      item({ item_id: "a", created_at: "2026-07-06T15:00:00Z", genero: "JH" }),
      item({ item_id: "b", created_at: "2026-07-06T15:01:00Z", genero: "NM" }),
      item({ item_id: "c", created_at: "2026-07-06T15:02:00Z", genero: "XX" }),
    ]);
    expect(r.filas.map((f) => f.GENERO)).toEqual(["JOVENCITOS", "NINAS", "XX"]);
    expect(r.avisos).toEqual([{ aviso: "genero_desconocido", referencia: referenciaCotv(V, ID_X), item: "c", detalle: expect.stringContaining("XX") }]);
  });

  it("la nota se corta a 500 con aviso; las notas repetidas y los compradores repetidos no se repiten", () => {
    const largo = "n".repeat(600);
    const r = agruparItemsCotv([item({ item_id: "a", created_at: "2026-07-06T15:00:00Z", nota: largo }), item({ item_id: "b", created_at: "2026-07-06T15:01:00Z", nota: largo })]);
    expect(r.filas[0].NOTA).toHaveLength(MAX_NOTA_PLANILLA);
    expect(r.filas[0].NOTA.endsWith("…")).toBe(true);
    expect(r.avisos.map((a) => a.aviso)).toEqual(["nota_cortada"]);
    const dos = agruparItemsCotv([item({ item_id: "a", created_at: "2026-07-06T15:00:00Z", nota: "Igual" }), item({ item_id: "b", created_at: "2026-07-06T15:01:00Z", nota: " Igual " })]);
    expect(dos.filas[0].NOTA).toBe("Registrada en COTV por C1 · Igual");
    expect(agruparItemsCotv([item({ item_id: "a", created_at: "2026-07-06T15:00:00Z", comprador: null })]).filas[0].NOTA).toBe("Registrada en COTV");
  });

  it("unidades con decimales se dejan tal cual (el importador omite la fila con `unidades_invalida`); no muta la entrada", () => {
    const items = [item({ item_id: "a", created_at: "2026-07-06T15:00:00Z", unidades: 12.5, costo_fob: 38.9 })];
    const copia = JSON.stringify(items);
    const r = agruparItemsCotv(items);
    expect(r.filas[0].UNIDADES).toBe("12.5");
    expect(r.filas[0].COSTO_UNITARIO).toBe("38.9");
    expect(JSON.stringify(items)).toBe(copia);
  });

  it("un instante inválido lanza (no inventa una fecha)", () => {
    expect(() => agruparItemsCotv([item({ item_id: "a", created_at: "no es una fecha" })])).toThrow(RangeError);
  });
});
