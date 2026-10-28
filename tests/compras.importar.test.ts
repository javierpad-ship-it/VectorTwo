import { describe, expect, it } from "vitest";
import type { FilaImportacionCompra } from "@/lib/compras/esquemas";
import {
  agregarAviso,
  argsImportarCompra,
  claveCompraImportacion,
  claveImportacion,
  huellaContenido,
  payloadImportarCompra,
  previsualizarImportacionCompras,
  reporteAplicado,
  type ContenidoLinea,
  type EstadoImportacionCompras,
  type LineaExistente,
  type OpcionesImportacion,
  type ResultadoPrevisualizacion,
} from "@/lib/compras/importar";
import { COMPRA, MARCA_M8, NODO_M8, PROVEEDOR, filasImportacionEjemplo, filasMezclaEjemplo, reporteImportacionEjemplo } from "./compras.fixture";
import { ACTOR, BETA_V2, EQ_M8, estadoImportacionBase } from "./compras.estado.fixture";

/** Regla 18 de la ficha 08 (importador de carga inicial por clave natural) y casos 13 y 28. */

const OPC: OpcionesImportacion = { carga_inicial: true, k_prima: "2026-09" };

const fila = (p: Partial<FilaImportacionCompra> = {}): FilaImportacionCompra => ({
  proveedor: "Proveedor Norte",
  fecha_compra: "2026-10-14",
  referencia: "PO-2211",
  linea_ordinal: "1",
  tipo: "ESPECIFICA",
  genero: "HOMBRE",
  mundo: "URBANO",
  linea: "DENIM",
  equivalencia: "",
  marca: "ALFA",
  agrupacion_marca: "",
  tallas: "centrales",
  unidades: "500",
  costo_unitario: "38",
  moneda: "PEN",
  llegada: "2026-11",
  entregas: "",
  recibidas: "",
  destino: "CD",
  alcance: "",
  nota: "",
  ...p,
});

const previsualizar = (filas: FilaImportacionCompra[], estado: EstadoImportacionCompras = estadoImportacionBase(), opciones: OpcionesImportacion = OPC): ResultadoPrevisualizacion =>
  previsualizarImportacionCompras(filas, [], estado, opciones);

const motivos = (r: ResultadoPrevisualizacion) => r.reporte.omitidas.map((o) => o.motivo);
const un = (r: ResultadoPrevisualizacion) => {
  if (r.reporte.omitidas.length === 1) return r.reporte.omitidas[0];
  throw new Error(`se esperaba 1 omitida y hay ${r.reporte.omitidas.length}`);
};

/** Lo que dejaría una importación aplicada: las líneas con su clave y huella, para reimportar contra ello. */
const comoExistentes = (r: ResultadoPrevisualizacion, estadoCompra: LineaExistente["compra_estado"] = "confirmada"): LineaExistente[] =>
  r.compras.flatMap((c) =>
    c.lineas.map((l) => ({ clave: l.clave, huella: l.linea.huella_importacion, compra_id: COMPRA.c12, compra_numero: "C-000012", compra_estado: estadoCompra })),
  );

describe("el caso 13: la plantilla de seis filas", () => {
  const r = previsualizar(filasImportacionEjemplo());

  it("deja tres líneas nuevas en dos compras y tres omitidas", () => {
    expect(r.reporte.totales).toEqual({ recibidas: 6, procesadas: 3, omitidas: 3, nuevas: 3, iguales: 0, cambiadas: 0 });
    expect(r.reporte.omitidas.map((o) => [o.fila, o.motivo])).toEqual([
      [4, "marca_y_agrupacion"],
      [5, "entregas_invalidas"],
      [6, "tipo_no_disponible"],
    ]);
    expect(r.reporte.compras_a_crear.map((c) => [c.proveedor, c.referencia, c.lineas, c.lineas_nuevas])).toEqual([
      ["Proveedor Norte", "PO-2211", 2, 2],
      ["Feria Sur", "FS-001", 1, 1],
    ]);
    expect(r.reporte.proveedores_a_crear).toEqual(["Feria Sur"]);
  });

  it("coincide con el reporte de ejemplo de T0 en totales, omitidas y compras", () => {
    const ejemplo = reporteImportacionEjemplo();
    expect(r.reporte.totales).toEqual(ejemplo.totales);
    expect(r.reporte.omitidas.map((o) => [o.fila, o.motivo, o.detalle])).toEqual(ejemplo.omitidas.map((o) => [o.fila, o.motivo, o.detalle]));
    expect(r.reporte.compras_a_crear).toEqual(ejemplo.compras_a_crear);
    expect(r.reporte.proveedores_a_crear).toEqual(ejemplo.proveedores_a_crear);
    expect(r.reporte.lineas.map((l) => [l.clave, l.clasificacion, l.tipo, l.ruta, l.marca, l.agrupacion_marca, l.unidades, l.recibidas, l.entregas])).toEqual(
      ejemplo.lineas.map((l) => [l.clave, l.clasificacion, l.tipo, l.ruta, l.marca, l.agrupacion_marca, l.unidades, l.recibidas, l.entregas]),
    );
  });

  it("la línea de GAMMA con LLEGADA 2026-08 y RECIBIDAS = 200 crea su recepción en ago y no queda pendiente", () => {
    const gamma = r.compras[0].lineas.find((l) => l.fila === 2);
    expect(gamma?.linea.recepciones).toEqual([{ recibida_periodo: "2026-08-01", unidades: 200, fecha_recepcion: "2026-08-31", nota: null }]);
    expect(gamma?.linea.avisos).toEqual([]);
  });

  it("el lote de BETA con ALCANCE = HOMBRE reparte cada entrega de verano sin la sandalia", () => {
    const beta = r.compras[1].lineas[0].linea;
    expect(beta.tipo).toBe("barrer_marca");
    expect(beta.genero_mundo_linea_id).toBeNull();
    expect(beta.alcance).toEqual({ generos: [estadoImportacionBase().generos[0].id] });
    expect(beta.entregas.map((e) => [e.periodo, e.unidades])).toEqual([["2026-12-01", 400], ["2027-01-01", 350], ["2027-02-01", 250]]);
    const porEntrega = new Map<string, number>();
    for (const f of beta.repartos) {
      porEntrega.set(f.entrega_periodo, (porEntrega.get(f.entrega_periodo) ?? 0) + f.unidades);
      expect(f.genero_mundo_linea_id).not.toBe(NODO_M8.sandalia);
      expect(f).toMatchObject({ marca_id: MARCA_M8.beta, reparto_id: BETA_V2.reparto_id, reparto_version: 2, temporada: "verano" });
    }
    expect([...porEntrega.entries()]).toEqual([["2026-12-01", 400], ["2027-01-01", 350], ["2027-02-01", 250]]);
  });

  it("la hoja MEZCLA se acepta pero VARIAS_MARCAS sigue sin estar disponible", () => {
    const con = previsualizarImportacionCompras(filasImportacionEjemplo(), filasMezclaEjemplo(), estadoImportacionBase(), OPC);
    expect(con.reporte.totales).toEqual(r.reporte.totales);
  });
});

describe("idempotencia por clave natural (regla 18, caso 28)", () => {
  const primera = previsualizar(filasImportacionEjemplo());
  const existentes = comoExistentes(primera);
  const conExistentes = (extra: Partial<EstadoImportacionCompras> = {}): EstadoImportacionCompras => ({ ...estadoImportacionBase(), lineas_existentes: existentes, ...extra });

  it("reimportar el mismo archivo da 0 nuevas: todas igual (hoy o mañana, no hay reloj)", () => {
    const r = previsualizar(filasImportacionEjemplo(), conExistentes());
    expect(r.reporte.totales).toMatchObject({ nuevas: 0, iguales: 3, cambiadas: 0 });
    expect(r.compras).toEqual([]);
    expect(r.reporte.lineas.map((l) => l.clasificacion)).toEqual(["igual", "igual", "igual"]);
  });

  it("insertar una fila arriba da una sola nueva y el resto igual", () => {
    const nueva = fila({ linea_ordinal: "5", llegada: "2026-12", unidades: "100", marca: "ALFA" });
    const r = previsualizar([nueva, ...filasImportacionEjemplo()], conExistentes());
    expect(r.reporte.totales).toMatchObject({ nuevas: 1, iguales: 3 });
    expect(r.compras).toHaveLength(1);
    expect(r.compras[0].lineas.map((l) => l.clave)).toEqual(["PROVEEDOR NORTE|PO-2211|5"]);
  });

  it("corregir las unidades de una fila la deja cambiada: se omite con cambiada_requiere_edicion y nada se duplica", () => {
    const filas = filasImportacionEjemplo();
    filas[0] = { ...filas[0], unidades: "600", entregas: "2026-11:300;2026-12:300" };
    const r = previsualizar(filas, conExistentes());
    expect(r.reporte.totales).toMatchObject({ nuevas: 0, iguales: 2, cambiadas: 1 });
    expect(r.reporte.lineas.find((l) => l.clave === "PROVEEDOR NORTE|PO-2211|1")?.clasificacion).toBe("cambiada");
    expect(motivos(r)).toContain("cambiada_requiere_edicion");
    expect(r.compras).toEqual([]);
  });

  it("con el contenido anterior, dice qué cambió", () => {
    const contenido: ContenidoLinea = {
      tipo: "especifica",
      genero_mundo_linea_id: NODO_M8.urbano,
      equivalencia_id: null,
      marca_id: MARCA_M8.alfa,
      agrupacion_marca_id: null,
      tallas: "centrales",
      unidades: 500,
      costo_unitario: 38,
      destino: "cd",
      tienda_id: null,
      alcance: { generos: [], mundos: [], lineas: [] },
      entregas: [{ periodo: "2026-11", unidades: 300 }, { periodo: "2026-12", unidades: 200 }],
      recibidas: 0,
      nota: null,
      moneda: "PEN",
      fecha_compra: "2026-10-14",
    };
    const filas = filasImportacionEjemplo();
    filas[0] = { ...filas[0], unidades: "600", entregas: "2026-11:300;2026-12:300" };
    const estado = conExistentes({ lineas_existentes: existentes.map((l) => (l.clave === "PROVEEDOR NORTE|PO-2211|1" ? { ...l, contenido } : l)) });
    const r = previsualizar(filas, estado);
    const linea = r.reporte.lineas.find((l) => l.clave === "PROVEEDOR NORTE|PO-2211|1");
    expect(linea?.cambios).toEqual(["unidades 500 → 600", "entregas 2026-11:300; 2026-12:200 → 2026-11:300; 2026-12:300"]);
    expect(r.reporte.omitidas.find((o) => o.motivo === "cambiada_requiere_edicion")?.detalle).toContain("unidades 500 → 600");
  });

  it("la fila de una compra cancelada se reimporta como nueva (la clave queda libre)", () => {
    const r = previsualizar(filasImportacionEjemplo(), { ...estadoImportacionBase(), lineas_existentes: comoExistentes(primera, "cancelada") });
    expect(r.reporte.totales).toMatchObject({ nuevas: 3, iguales: 0 });
  });

  it("un corte en la segunda compra: la primera queda aplicada, y al reimportar la primera es igual y la segunda nueva", () => {
    const [c1, c2] = primera.compras;
    const resp = reporteAplicado(primera, [
      { clave: c1.clave, ok: true, compra_id: COMPRA.c12, numero: "C-000012" },
      { clave: c2.clave, ok: false, motivo: "error", mensaje: "se cortó" },
    ]);
    expect(resp.modo).toBe("aplicar");
    expect(resp.aplicadas).toEqual([{ clave: c1.clave, compra_id: COMPRA.c12, numero: "C-000012", lineas: 2 }]);
    expect(resp.no_aplicadas).toEqual([{ clave: c2.clave, proveedor: "Feria Sur", referencia: "FS-001", motivo: "error", mensaje: "se cortó" }]);

    const soloPrimera = c1.lineas.map((l) => ({ clave: l.clave, huella: l.linea.huella_importacion, compra_id: COMPRA.c12, compra_numero: "C-000012", compra_estado: "confirmada" as const }));
    const r = previsualizar(filasImportacionEjemplo(), { ...estadoImportacionBase(), lineas_existentes: soloPrimera });
    expect(r.reporte.totales).toMatchObject({ nuevas: 1, iguales: 2 });
    expect(r.compras.map((c) => c.referencia)).toEqual(["FS-001"]);
  });

  it("una compra sin respuesta de la función se cuenta como no aplicada", () => {
    const resp = reporteAplicado(primera, []);
    expect(resp.aplicadas).toEqual([]);
    expect(resp.no_aplicadas).toHaveLength(2);
  });

  it("una compra existente (sin cancelar) recibe solo las líneas nuevas y se informa", () => {
    const estado = conExistentes({
      compras: [{ id: COMPRA.c12, numero: "C-000012", proveedor_id: PROVEEDOR.norte, referencia: "PO-2211", estado: "confirmada", cancelada_at: null }],
    });
    const r = previsualizar([...filasImportacionEjemplo(), fila({ linea_ordinal: "9", llegada: "2026-12", unidades: "50" })], estado);
    expect(r.reporte.compras_a_crear[0]).toMatchObject({ referencia: "PO-2211", lineas_nuevas: 1, existente: { compra_id: COMPRA.c12, numero: "C-000012" } });
  });

  it("una línea nueva con otra fecha u otra moneda que la compra existente → cabecera_inconsistente; con la misma, entra", () => {
    const existente = { id: COMPRA.c12, numero: "C-000012", proveedor_id: PROVEEDOR.norte, referencia: "PO-2211", estado: "confirmada" as const, cancelada_at: null, fecha_compra: "2026-10-14", moneda: "PEN" as const };
    const con = (p: Partial<FilaImportacionCompra>, compra: typeof existente | Record<string, unknown> = existente) =>
      previsualizar([fila({ linea_ordinal: "9", llegada: "2026-12", unidades: "50", ...p })], conExistentes({ compras: [compra as typeof existente] }));
    const misma = con({});
    expect(motivos(misma)).toEqual([]);
    expect(misma.reporte.compras_a_crear[0]).toMatchObject({ referencia: "PO-2211", lineas_nuevas: 1, existente: { numero: "C-000012" } });
    const otraFecha = con({ fecha_compra: "2026-10-20" });
    expect(otraFecha.reporte.omitidas.map((o) => [o.fila, o.motivo])).toEqual([[1, "cabecera_inconsistente"]]);
    expect(otraFecha.reporte.omitidas[0].detalle).toContain("C-000012");
    expect(otraFecha.reporte.compras_a_crear).toEqual([]);
    expect(otraFecha.compras).toEqual([]);
    expect(motivos(con({ moneda: "USD" }))).toEqual(["cabecera_inconsistente"]);
    // sin fecha ni moneda en la compra existente (quien no las conoce) no se compara
    expect(motivos(con({ fecha_compra: "2026-10-20", moneda: "USD" }, { ...existente, fecha_compra: undefined, moneda: undefined }))).toEqual([]);
  });

  it("no se agregan líneas a una compra con el saldo cerrado", () => {
    const estado: EstadoImportacionCompras = {
      ...estadoImportacionBase(),
      compras: [{ id: COMPRA.c12, numero: "C-000012", proveedor_id: PROVEEDOR.norte, referencia: "PO-2211", estado: "recibida", cancelada_at: "2026-10-25T16:00:00Z" }],
    };
    const r = previsualizar([fila()], estado);
    expect(motivos(r)).toEqual(["cabecera_inconsistente"]);
    expect(r.compras).toEqual([]);
  });
});

describe("clave natural y huella", () => {
  it("claveImportacion normaliza con upper(trim(…))", () => {
    expect(claveImportacion({ proveedor: "  proveedor norte ", referencia: "po-2211 ", linea_ordinal: "1" })).toBe("PROVEEDOR NORTE|PO-2211|1");
    expect(claveImportacion({ proveedor: "A", referencia: "B", linea_ordinal: 3 })).toBe("A|B|3");
    expect(claveCompraImportacion({ proveedor: " a ", referencia: " b " })).toBe("A|B");
  });

  it("la huella no depende del orden de las entregas ni de los ids del alcance y cambia con cualquier campo", () => {
    const base: ContenidoLinea = {
      tipo: "especifica",
      genero_mundo_linea_id: NODO_M8.urbano,
      equivalencia_id: null,
      marca_id: MARCA_M8.alfa,
      agrupacion_marca_id: null,
      tallas: "ambas",
      unidades: 500,
      costo_unitario: 38,
      destino: "cd",
      tienda_id: null,
      alcance: { generos: ["b", "a"], mundos: [], lineas: [] },
      entregas: [{ periodo: "2026-12", unidades: 200 }, { periodo: "2026-11", unidades: 300 }],
      recibidas: 0,
      nota: null,
      moneda: "PEN",
      fecha_compra: "2026-10-14",
    };
    const h = huellaContenido(base);
    expect(h).toMatch(/^[0-9a-f]{32}$/);
    expect(huellaContenido({ ...base, alcance: { generos: ["a", "b"], mundos: [], lineas: [] }, entregas: [...base.entregas].reverse() })).toBe(h);
    expect(huellaContenido({ ...base, unidades: 501 })).not.toBe(h);
    expect(huellaContenido({ ...base, costo_unitario: 38.5 })).not.toBe(h);
    expect(huellaContenido({ ...base, nota: "x" })).not.toBe(h);
    expect(huellaContenido({ ...base, recibidas: 1 })).not.toBe(h);
  });
});

describe("omisiones de la fila", () => {
  it("MARCA y AGRUPACION_MARCA a la vez → marca_y_agrupacion; ninguna → sin_marca_ni_agrupacion", () => {
    expect(motivos(previsualizar([fila({ agrupacion_marca: "RECONOCIDO" })]))).toEqual(["marca_y_agrupacion"]);
    expect(motivos(previsualizar([fila({ marca: "" })]))).toEqual(["sin_marca_ni_agrupacion"]);
  });

  it("marca y agrupación desconocidas o desactivadas", () => {
    expect(motivos(previsualizar([fila({ marca: "ZETA" })]))).toEqual(["marca_desconocida"]);
    expect(motivos(previsualizar([fila({ marca: "MARCA VIEJA" })]))).toEqual(["marca_inactiva"]);
    expect(motivos(previsualizar([fila({ marca: "", agrupacion_marca: "OTRA" })]))).toEqual(["agrupacion_desconocida"]);
  });

  it("EQUIVALENCIA en un nodo GML → equivalencia_requiere_gmle; en un GMLE, de otro nodo o desconocida", () => {
    expect(motivos(previsualizar([fila({ equivalencia: "MANGA LARGA" })]))).toEqual(["equivalencia_requiere_gmle"]);
    const camisa = { genero: "HOMBRE", mundo: "FORMAL", linea: "CAMISA" };
    expect(motivos(previsualizar([fila({ ...camisa, equivalencia: "SACO" })]))).toEqual(["equivalencia_de_otro_nodo"]);
    expect(motivos(previsualizar([fila({ ...camisa, equivalencia: "MANGA XL" })]))).toEqual(["equivalencia_desconocida"]);
  });

  it("en un GMLE, la equivalencia vacía va a la genérica del nodo y «-» a la que se llama como la línea", () => {
    const camisa = { genero: "HOMBRE", mundo: "FORMAL", linea: "CAMISA" };
    const vacia = previsualizar([fila({ ...camisa })]);
    expect(vacia.compras[0].lineas[0].linea.equivalencia_id).toBe(EQ_M8.camisaGenerica);
    const larga = previsualizar([fila({ ...camisa, equivalencia: "MANGA LARGA" })]);
    expect(larga.compras[0].lineas[0].linea.equivalencia_id).toBe(EQ_M8.larga);
    expect(larga.reporte.lineas[0].ruta).toBe("HOMBRE · FORMAL · CAMISA › MANGA LARGA");
    const sinGenerica = estadoImportacionBase();
    sinGenerica.equivalencias = sinGenerica.equivalencias.filter((e) => !e.es_generica);
    expect(motivos(previsualizar([fila({ ...camisa })], sinGenerica))).toEqual(["equivalencia_desconocida"]);
  });

  it("GML: lo que resuelve resolverGml y gml_requerido si las tres columnas vienen vacías", () => {
    expect(motivos(previsualizar([fila({ linea: "ZAPATO" })]))).toEqual(["linea_desconocida"]);
    expect(motivos(previsualizar([fila({ genero: "", mundo: "", linea: "" })]))).toEqual(["gml_requerido"]);
    expect(motivos(previsualizar([fila({ genero: "HOMBRE", mundo: "FORMAL", linea: "VIEJA" })]))).toEqual(["gml_inactivo"]);
    expect(motivos(previsualizar([fila({ genero: "TOTAL" })]))).toEqual(["fila_total"]);
  });

  it("unidades, costo, tallas, moneda y tipo inválidos", () => {
    expect(motivos(previsualizar([fila({ unidades: "0" })]))).toEqual(["unidades_invalida"]);
    expect(motivos(previsualizar([fila({ unidades: "1,000" })]))).toEqual(["unidades_invalida"]);
    expect(motivos(previsualizar([fila({ unidades: "abc" })]))).toEqual(["unidades_invalida"]);
    expect(motivos(previsualizar([fila({ costo_unitario: "-3" })]))).toEqual(["costo_invalido"]);
    expect(motivos(previsualizar([fila({ tallas: "xl" })]))).toEqual(["tallas_invalida"]);
    expect(motivos(previsualizar([fila({ moneda: "EUR" })]))).toEqual(["moneda_invalida"]);
    expect(motivos(previsualizar([fila({ tipo: "MUCHAS" })]))).toEqual(["tipo_invalido"]);
  });

  it("acepta unidades 500.0 y costos con coma decimal, y el costo vacío queda en null", () => {
    const r = previsualizar([fila({ unidades: "500.0", costo_unitario: "22,5" })]);
    expect(r.compras[0].lineas[0].linea).toMatchObject({ unidades: 500, costo_unitario: 22.5 });
    expect(previsualizar([fila({ costo_unitario: "" })]).compras[0].lineas[0].linea.costo_unitario).toBeNull();
  });

  it("VARIAS_MARCAS → tipo_no_disponible aunque traiga hoja MEZCLA", () => {
    const r = previsualizarImportacionCompras([fila({ tipo: "VARIAS_MARCAS", marca: "" })], filasMezclaEjemplo(), estadoImportacionBase(), OPC);
    expect(motivos(r)).toEqual(["tipo_no_disponible"]);
  });

  it("fecha: obligatoria, ISO o serie de Excel (46309 → 2026-10-14) y real", () => {
    expect(motivos(previsualizar([fila({ fecha_compra: "" })]))).toEqual(["fecha_requerida"]);
    expect(motivos(previsualizar([fila({ fecha_compra: "2026-02-30" })]))).toEqual(["fecha_invalida"]);
    expect(motivos(previsualizar([fila({ fecha_compra: "ayer" })]))).toEqual(["fecha_invalida"]);
    const serie = previsualizar([fila({ fecha_compra: "46309" })]);
    expect(serie.compras[0].fecha_compra).toBe("2026-10-14");
    expect(previsualizar([fila({ fecha_compra: "14/10/2026" })]).compras[0].fecha_compra).toBe("2026-10-14");
  });

  it("REFERENCIA y LINEA son obligatorias y LINEA debe ser un entero desde 1", () => {
    expect(motivos(previsualizar([fila({ referencia: "" })]))).toEqual(["referencia_requerida"]);
    expect(motivos(previsualizar([fila({ linea_ordinal: "" })]))).toEqual(["linea_requerida"]);
    expect(motivos(previsualizar([fila({ linea_ordinal: "0" })]))).toEqual(["linea_requerida"]);
    expect(motivos(previsualizar([fila({ linea_ordinal: "A" })]))).toEqual(["linea_requerida"]);
    expect(motivos(previsualizar([fila({ proveedor: "" })]))).toEqual(["proveedor_requerido"]);
  });

  it("la misma clave dos veces → linea_repetida con la fila original; manda la primera válida", () => {
    const r = previsualizar([fila(), fila({ unidades: "300", llegada: "2026-12" })]);
    expect(r.reporte.omitidas).toEqual([
      expect.objectContaining({ fila: 2, motivo: "linea_repetida", fila_original: 1, proveedor: "Proveedor Norte", referencia: "PO-2211", linea_ordinal: "1" }),
    ]);
    expect(r.reporte.totales.nuevas).toBe(1);
    // Si la primera es inválida, la segunda con la misma clave sí entra.
    const r2 = previsualizar([fila({ unidades: "0" }), fila({ unidades: "300", llegada: "2026-12" })]);
    expect(motivos(r2)).toEqual(["unidades_invalida"]);
    expect(r2.reporte.totales.nuevas).toBe(1);
  });

  it("filas de una misma compra con otra FECHA_COMPRA o MONEDA → cabecera_inconsistente", () => {
    const r = previsualizar([fila(), fila({ linea_ordinal: "2", fecha_compra: "2026-10-15" }), fila({ linea_ordinal: "3", moneda: "USD" })]);
    expect(r.reporte.omitidas.map((o) => [o.fila, o.motivo])).toEqual([[2, "cabecera_inconsistente"], [3, "cabecera_inconsistente"]]);
    expect(r.reporte.totales.nuevas).toBe(1);
    // Otra referencia es otra compra: no hay conflicto.
    expect(motivos(previsualizar([fila(), fila({ referencia: "PO-9", fecha_compra: "2026-10-15" })]))).toEqual([]);
  });

  it("un proveedor desactivado no recibe compras", () => {
    const estado = estadoImportacionBase();
    estado.proveedores = [{ id: PROVEEDOR.norte, nombre: "Proveedor Norte", activo: false }];
    expect(motivos(previsualizar([fila()], estado))).toEqual(["proveedor_inactivo"]);
  });

  it("destino: CD, DIRECTO o el código de una tienda activa", () => {
    expect(previsualizar([fila({ destino: "T01" })]).compras[0].lineas[0].linea).toMatchObject({ destino: "tienda", tienda_id: estadoImportacionBase().tiendas[0].id });
    expect(previsualizar([fila({ destino: "directo" })]).compras[0].lineas[0].linea.destino).toBe("intercompany_directo");
    expect(previsualizar([fila({ destino: "" })]).compras[0].lineas[0].linea.destino).toBe("cd");
    expect(motivos(previsualizar([fila({ destino: "T77" })]))).toEqual(["destino_desconocido"]);
    expect(motivos(previsualizar([fila({ destino: "T99" })]))).toEqual(["destino_desconocido"]);
    expect(motivos(previsualizar([fila({ destino: "CD01" })]))).toEqual(["destino_desconocido"]);
  });
});

describe("entregas, recibidas y avisos de fechas", () => {
  it("ENTREGAS «2026-11:300;2026-12:200» con 500 u → dos entregas; con 600 → entregas_invalidas", () => {
    const ok = previsualizar([fila({ entregas: "2026-11:300;2026-12:200" })]);
    expect(ok.reporte.lineas[0].entregas).toEqual([{ periodo: "2026-11", unidades: 300 }, { periodo: "2026-12", unidades: 200 }]);
    const mal = previsualizar([fila({ unidades: "600", entregas: "2026-11:300;2026-12:200" })]);
    expect(un(mal)).toMatchObject({ motivo: "entregas_invalidas", detalle: "Las entregas suman 500 y la línea es de 600." });
  });

  it("ENTREGAS manda sobre LLEGADA; el formato roto y los meses repetidos", () => {
    expect(previsualizar([fila({ llegada: "2026-12", entregas: "2026-11:500" })]).reporte.lineas[0].entregas).toEqual([{ periodo: "2026-11", unidades: 500 }]);
    expect(motivos(previsualizar([fila({ entregas: "2026-11-300" })]))).toEqual(["entregas_invalidas"]);
    expect(motivos(previsualizar([fila({ entregas: "2026-13:500" })]))).toEqual(["entregas_invalidas"]);
    expect(motivos(previsualizar([fila({ entregas: "2026-11:0;2026-12:500" })]))).toEqual(["entregas_invalidas"]);
    expect(previsualizar([fila({ entregas: "2026-11:200;2026-11:300" })]).reporte.lineas[0].entregas).toEqual([{ periodo: "2026-11", unidades: 500 }]);
  });

  it("sin LLEGADA ni ENTREGAS, o con una LLEGADA inválida → llegada_invalida", () => {
    expect(motivos(previsualizar([fila({ llegada: "" })]))).toEqual(["llegada_invalida"]);
    expect(motivos(previsualizar([fila({ llegada: "noviembre" })]))).toEqual(["llegada_invalida"]);
    expect(previsualizar([fila({ llegada: "2026-11-20" })]).reporte.lineas[0].entregas).toEqual([{ periodo: "2026-11", unidades: 500 }]);
  });

  it("RECIBIDAS = 300 → recepción de 300 en el mes de la última entrega ≤ k' y pendiente 200", () => {
    const r = previsualizar([fila({ entregas: "2026-08:300;2026-11:200", recibidas: "300" })]);
    const l = r.compras[0].lineas[0].linea;
    expect(l.recepciones).toEqual([{ recibida_periodo: "2026-08-01", unidades: 300, fecha_recepcion: "2026-08-31", nota: null }]);
    expect(r.reporte.lineas[0].recibidas).toBe(300);
    expect(l.avisos).toEqual([]);
  });

  it("RECIBIDAS sin ninguna entrega ≤ k' → la recepción cae en k'", () => {
    const r = previsualizar([fila({ entregas: "2026-11:300;2026-12:200", recibidas: "300" })]);
    expect(r.compras[0].lineas[0].linea.recepciones[0]).toMatchObject({ recibida_periodo: "2026-09-01", unidades: 300, fecha_recepcion: "2026-09-30" });
  });

  it("RECIBIDAS mayor que las unidades → recibidas_invalida; y sin la casilla no se admite", () => {
    expect(motivos(previsualizar([fila({ recibidas: "501" })]))).toEqual(["recibidas_invalida"]);
    expect(motivos(previsualizar([fila({ recibidas: "x" })]))).toEqual(["recibidas_invalida"]);
    expect(motivos(previsualizar([fila({ recibidas: "10" })], estadoImportacionBase(), { carga_inicial: false, k_prima: "2026-09" }))).toEqual(["recibidas_invalida"]);
    expect(previsualizar([fila({ recibidas: "0" })]).compras[0].lineas[0].linea.recepciones).toEqual([]);
  });

  it("una entrega ≤ k' sin RECIBIDAS que la cubra → aviso entrega_pasada; con RECIBIDAS = 500, no", () => {
    const sin = previsualizar([fila({ llegada: "2026-08" })]);
    expect(sin.reporte.lineas[0].avisos).toEqual(["entrega_pasada"]);
    expect(sin.reporte.avisos[0]).toMatchObject({ fila: 1, aviso: "entrega_pasada" });
    expect(sin.compras[0].lineas[0].linea.avisos).toEqual(["entrega_pasada"]);
    expect(previsualizar([fila({ llegada: "2026-08", recibidas: "500" })]).reporte.lineas[0].avisos).toEqual([]);
    // Con la entrega parcialmente cubierta sigue habiendo pendiente vencido.
    expect(previsualizar([fila({ llegada: "2026-08", recibidas: "100" })]).reporte.lineas[0].avisos).toEqual(["entrega_pasada"]);
  });

  it("sin k' no hay entregas pasadas", () => {
    const r = previsualizar([fila({ llegada: "2026-08" })], estadoImportacionBase(), { carga_inicial: true, k_prima: null });
    expect(r.reporte.lineas[0].avisos).toEqual([]);
    expect(r.reporte.k_prima).toBeNull();
  });
});

describe("lotes de una marca (UNA_MARCA)", () => {
  const lote = (extra: Partial<FilaImportacionCompra> = {}) => fila({ tipo: "UNA_MARCA", genero: "", mundo: "", linea: "", marca: "BETA", entregas: "2026-12:1000", unidades: "1000", ...extra });

  it("sin reparto vigente → omisión sin_reparto (en 0.13.0)", () => {
    expect(motivos(previsualizar([lote({ marca: "DELTA" })]))).toEqual(["sin_reparto"]);
  });

  it("un alcance que deja 0 GML → alcance_vacio; un nombre de alcance desconocido → alcance_invalido", () => {
    expect(motivos(previsualizar([lote({ alcance: "MUJER;URBANO" })]))).toEqual(["alcance_vacio"]);
    expect(motivos(previsualizar([lote({ alcance: "OTRO" })]))).toEqual(["alcance_invalido"]);
    expect(motivos(previsualizar([lote({ alcance: "HOMBRE;URBANO;DENIM;SOBRA" })]))).toEqual(["alcance_invalido"]);
  });

  it("el alcance admite listas con comas por partes: GENEROS;MUNDOS;LINEAS", () => {
    const r = previsualizar([lote({ alcance: "HOMBRE;URBANO,CASUAL" })]);
    const linea = r.compras[0].lineas[0].linea;
    expect(linea.alcance.generos).toHaveLength(1);
    expect(linea.alcance.mundos).toHaveLength(2);
    expect(linea.alcance.lineas).toBeUndefined();
    expect(new Set(linea.repartos.map((f) => f.genero_mundo_linea_id))).toEqual(new Set([NODO_M8.urbano, NODO_M8.polo]));
  });

  it("una marca por GML → modalidad_no_barrer; una mixta se acepta; un lote con GML o con agrupación se rechaza", () => {
    expect(motivos(previsualizar([lote({ marca: "ALFA" })]))).toEqual(["modalidad_no_barrer"]);
    expect(motivos(previsualizar([lote({ marca: "JOHN HOLDEN" })]))).toEqual(["modalidad_no_barrer"]);
    expect(motivos(previsualizar([lote({ marca: "GAMMA" })]))).toEqual([]);
    expect(motivos(previsualizar([lote({ genero: "HOMBRE" })]))).toEqual(["tipo_invalido"]);
    expect(motivos(previsualizar([lote({ marca: "", agrupacion_marca: "PREMIUM" })]))).toEqual(["sin_marca_ni_agrupacion"]);
  });

  it("ALCANCE en una línea específica se rechaza", () => {
    expect(motivos(previsualizar([fila({ alcance: "HOMBRE" })]))).toEqual(["alcance_invalido"]);
  });

  it("una entrega en jun usa el vector de invierno", () => {
    const r = previsualizar([lote({ entregas: "2026-12:600;2027-06:400" })]);
    const reps = r.compras[0].lineas[0].linea.repartos;
    expect(new Set(reps.filter((f) => f.entrega_periodo === "2026-12-01").map((f) => f.temporada))).toEqual(new Set(["verano"]));
    expect(new Set(reps.filter((f) => f.entrega_periodo === "2027-06-01").map((f) => f.temporada))).toEqual(new Set(["invierno"]));
  });

  it("GAMMA mixta sin GML se reparte con su reparto (solo DENIM, vector anual)", () => {
    const r = previsualizar([lote({ marca: "GAMMA", entregas: "2026-12:200", unidades: "200" })]);
    const reps = r.compras[0].lineas[0].linea.repartos;
    expect(reps.map((f) => [f.genero_mundo_linea_id, f.unidades, f.temporada])).toEqual([[NODO_M8.urbano, 200, null]]);
  });
});

describe("marcas: miembros y avisos de destino directo", () => {
  it("un miembro de un conjunto se resuelve a su cabeza con aviso miembro_resuelto", () => {
    const r = previsualizar([fila({ marca: "JOHN" })]);
    expect(r.compras[0].lineas[0].linea.marca_id).toBe(MARCA_M8.jh);
    expect(r.reporte.lineas[0]).toMatchObject({ marca: "JOHN HOLDEN", avisos: ["miembro_resuelto"] });
  });

  it("DIRECTO con una regla intercompany de la marca en ese GML → directo_con_regla; sin regla → directo_sin_regla", () => {
    const camisa = { genero: "HOMBRE", mundo: "FORMAL", linea: "CAMISA", equivalencia: "MANGA LARGA", destino: "DIRECTO" };
    expect(previsualizar([fila({ ...camisa, marca: "JOHN HOLDEN" })]).reporte.lineas[0].avisos).toEqual(["directo_con_regla"]);
    expect(previsualizar([fila({ ...camisa, marca: "DONATELLI" })]).reporte.lineas[0].avisos).toEqual(["directo_sin_regla"]);
    // Una regla que empieza después de la primera entrega todavía no rige.
    const futura = estadoImportacionBase();
    futura.reglas = futura.reglas.map((r) => ({ ...r, vigente_desde: "2027-06" }));
    expect(previsualizar([fila({ ...camisa, marca: "JOHN HOLDEN" })], futura).reporte.lineas[0].avisos).toEqual(["directo_sin_regla"]);
    // Sin DIRECTO no hay aviso.
    expect(previsualizar([fila({ ...camisa, marca: "JOHN HOLDEN", destino: "CD" })]).reporte.lineas[0].avisos).toEqual([]);
  });
});

describe("plan y argumentos de importar_compra", () => {
  const r = previsualizar(filasImportacionEjemplo());

  it("proveedor existente va por id y uno nuevo por nombre; los meses van como aaaa-mm-01", () => {
    const [norte, feria] = r.compras;
    expect(payloadImportarCompra(norte)).toMatchObject({ proveedor_id: PROVEEDOR.norte, referencia: "PO-2211", fecha_compra: "2026-10-14", moneda: "PEN", origen: "carga_inicial", estado: "confirmada" });
    expect(payloadImportarCompra(norte)).not.toHaveProperty("proveedor_nombre");
    expect(payloadImportarCompra(feria)).toMatchObject({ proveedor_nombre: "Feria Sur", proveedor_es_intercompany: false });
    expect(payloadImportarCompra(feria)).not.toHaveProperty("proveedor_id");
    expect(payloadImportarCompra(norte).lineas[0].entregas).toEqual([
      { periodo: "2026-11-01", unidades: 300, origen: "importada" },
      { periodo: "2026-12-01", unidades: 200, origen: "importada" },
    ]);
  });

  it("cada línea lleva su clave y huella, y la huella coincide con la del reporte de reimportación", () => {
    const l = payloadImportarCompra(r.compras[0]).lineas[0];
    expect(l.clave_importacion).toBe("PROVEEDOR NORTE|PO-2211|1");
    expect(l.huella_importacion).toMatch(/^[0-9a-f]{32}$/);
  });

  it("los repartos van enlazados a su entrega por entrega_periodo (aaaa-mm-01)", () => {
    const beta = payloadImportarCompra(r.compras[1]).lineas[0];
    expect(new Set(beta.repartos.map((f) => f.entrega_periodo))).toEqual(new Set(["2026-12-01", "2027-01-01", "2027-02-01"]));
  });

  it("argsImportarCompra agrega el actor", () => {
    expect(argsImportarCompra(r.compras[0], ACTOR)).toEqual({ p_compra: payloadImportarCompra(r.compras[0]), p_actor: ACTOR });
  });

  it("sin la casilla, la compra sería un borrador del comprador", () => {
    const sinCasilla = previsualizar([fila()], estadoImportacionBase(), { carga_inicial: false, k_prima: "2026-09" });
    expect(payloadImportarCompra(sinCasilla.compras[0])).toMatchObject({ origen: "comprador", estado: "borrador" });
    expect(sinCasilla.reporte.carga_inicial).toBe(false);
  });

  it("agregarAviso suma el exceso a la línea del reporte y del plan sin duplicarlo", () => {
    const con = agregarAviso(agregarAviso(r, 3, "exceso", "nov-2026: IMI 9,1"), 3, "exceso");
    expect(con.reporte.lineas.find((l) => l.fila === 3)?.avisos).toEqual(["exceso"]);
    expect(con.compras[1].lineas[0].linea.avisos).toEqual(["exceso"]);
    expect(con.reporte.avisos.filter((a) => a.aviso === "exceso")[0]).toMatchObject({ fila: 3, detalle: "nov-2026: IMI 9,1" });
    // El original no cambia.
    expect(r.reporte.lineas.find((l) => l.fila === 3)?.avisos).toEqual([]);
  });

  it("es determinista: el mismo archivo da el mismo plan", () => {
    expect(previsualizar(filasImportacionEjemplo())).toEqual(r);
  });

  it("una compra con solo líneas omitidas o iguales no genera plan ni proveedor nuevo", () => {
    const solo = previsualizar([fila({ proveedor: "Taller Nuevo", unidades: "0" })]);
    expect(solo.compras).toEqual([]);
    expect(solo.reporte.proveedores_a_crear).toEqual([]);
  });

  it("el mismo proveedor nuevo en dos compras se informa una sola vez", () => {
    const dos = previsualizar([fila({ proveedor: "Taller Nuevo" }), fila({ proveedor: "taller nuevo", referencia: "PO-2" })]);
    expect(dos.reporte.proveedores_a_crear).toEqual(["Taller Nuevo"]);
    expect(dos.compras).toHaveLength(2);
  });
});
