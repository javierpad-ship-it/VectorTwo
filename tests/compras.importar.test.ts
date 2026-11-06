import { describe, expect, it } from "vitest";
import { filaImportacionCompraSchema, type FilaImportacionCompra } from "@/lib/compras/esquemas";
import {
  agregarAviso,
  argsEditarOcCompra,
  argsImportarCompra,
  claveCompraImportacion,
  claveImportacion,
  huellaContenido,
  omitirFilasDelPlan,
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

describe("el comprador solo agrega líneas a su propio borrador (0034, A1/A2)", () => {
  const YO = "10000000-0000-4000-8000-0000000000c1";
  const OTRO = "10000000-0000-4000-8000-0000000000c2";
  const OPC_COMPRADOR = (perfil: string | null): OpcionesImportacion => ({ carga_inicial: false, k_prima: "2026-09", comprador: perfil === null ? null : { perfil_id: perfil } });
  const existente = (p: Partial<EstadoImportacionCompras["compras"][number]>) => ({
    id: COMPRA.c12,
    numero: "C-000012",
    proveedor_id: PROVEEDOR.norte,
    referencia: "PO-2211",
    estado: "borrador" as const,
    cancelada_at: null,
    perfil_id: YO,
    fecha_compra: "2026-10-14",
    moneda: "PEN" as const,
    ...p,
  });
  const con = (compra: ReturnType<typeof existente>, opciones: OpcionesImportacion) =>
    previsualizar([fila({ linea_ordinal: "9", llegada: "2026-12", unidades: "50" })], { ...estadoImportacionBase(), compras: [compra] }, opciones);

  it("compra existente confirmada de carga inicial → la fila se omite con compra_no_borrador y no queda nada en el plan", () => {
    const r = con(existente({ estado: "confirmada", perfil_id: OTRO }), OPC_COMPRADOR(YO));
    expect(motivos(r)).toEqual(["compra_no_borrador"]);
    expect(un(r).detalle).toBe("La compra C-000012 ya está confirmada o es de otra persona; usa otra referencia o agrégale líneas desde la compra (0.13.1).");
    expect(r.compras).toEqual([]);
    expect(r.reporte.totales).toMatchObject({ nuevas: 0, procesadas: 0, omitidas: 1 });
  });

  it("una confirmada que es suya también se omite: solo cuenta el borrador", () => {
    expect(motivos(con(existente({ estado: "confirmada" }), OPC_COMPRADOR(YO)))).toEqual(["compra_no_borrador"]);
  });

  it("borrador de otra persona, o sin dueño → se omite", () => {
    expect(motivos(con(existente({ perfil_id: OTRO }), OPC_COMPRADOR(YO)))).toEqual(["compra_no_borrador"]);
    expect(motivos(con(existente({ perfil_id: null }), OPC_COMPRADOR(YO)))).toEqual(["compra_no_borrador"]);
  });

  it("su propio borrador → agrega las líneas nuevas", () => {
    const r = con(existente({}), OPC_COMPRADOR(YO));
    expect(motivos(r)).toEqual([]);
    expect(r.reporte.compras_a_crear[0]).toMatchObject({ referencia: "PO-2211", lineas_nuevas: 1, existente: { numero: "C-000012" } });
  });

  it("una referencia sin compra existente, o de una compra cancelada, sigue creando la suya", () => {
    expect(previsualizar([fila()], estadoImportacionBase(), OPC_COMPRADOR(YO)).compras).toHaveLength(1);
    expect(motivos(con(existente({ estado: "cancelada", perfil_id: OTRO }), OPC_COMPRADOR(YO)))).toEqual([]);
  });

  it("admin y planner (sin `comprador`) conservan su comportamiento: agregan a cualquier compra viva", () => {
    for (const compra of [existente({ estado: "confirmada", perfil_id: OTRO }), existente({ perfil_id: OTRO }), existente({ perfil_id: null })]) {
      const r = con(compra, OPC_COMPRADOR(null));
      expect(motivos(r)).toEqual([]);
      expect(r.reporte.compras_a_crear[0]).toMatchObject({ lineas_nuevas: 1, existente: { numero: "C-000012" } });
    }
  });

  it("solo omite las filas NUEVAS: una fila igual a la ya importada sigue siendo igual, y el resto del archivo entra", () => {
    const base = previsualizar([fila()], estadoImportacionBase(), OPC_COMPRADOR(YO));
    const estado: EstadoImportacionCompras = {
      ...estadoImportacionBase(),
      compras: [existente({ estado: "confirmada", perfil_id: OTRO })],
      lineas_existentes: comoExistentes(base),
    };
    const r = previsualizar([fila(), fila({ proveedor: "Proveedor Norte", referencia: "PO-NUEVA", llegada: "2026-12" })], estado, OPC_COMPRADOR(YO));
    expect(r.reporte.totales).toMatchObject({ iguales: 1, nuevas: 1, omitidas: 0 });
    expect(r.compras.map((c) => c.referencia)).toEqual(["PO-NUEVA"]);
  });

  it("argsImportarCompra deja pasar `restringido` en p_actor", () => {
    const plan = previsualizar([fila()], estadoImportacionBase(), OPC_COMPRADOR(YO)).compras[0];
    expect(argsImportarCompra(plan, { perfil_id: YO, nombre: "Comprador", restringido: true }).p_actor).toEqual({ perfil_id: YO, nombre: "Comprador", restringido: true });
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

  it("PROVEEDOR de más de 120 caracteres y REFERENCIA de más de 80 se omiten; en el tope exacto pasan", () => {
    expect(motivos(previsualizar([fila({ proveedor: "P".repeat(121) })]))).toEqual(["proveedor_largo"]);
    expect(motivos(previsualizar([fila({ referencia: "R".repeat(81) })]))).toEqual(["referencia_larga"]);
    expect(motivos(previsualizar([fila({ proveedor: "P".repeat(120), referencia: "R".repeat(80) })]))).toEqual([]);
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

describe("columnas VIAJE, EMBARQUE y PAQUETE (ficha 08b, §3.9, R21): las filas que se omiten salen del plan", () => {
  const base = () => previsualizar(filasImportacionEjemplo());

  it("las columnas de agrupador NO entran en la huella: la misma línea con o sin ellas es la misma (y una `igual` lo sigue siendo tras moverla)", () => {
    const sin = previsualizar([fila()]);
    const con = previsualizar([{ ...fila(), viaje: "261001", embarque: "261201", paquete: "261101" } as FilaImportacionCompra]);
    expect(con.compras[0].lineas[0].linea.huella_importacion).toBe(sin.compras[0].lineas[0].linea.huella_importacion);
    const iguales = previsualizar([{ ...fila(), embarque: "261201" } as FilaImportacionCompra], { ...estadoImportacionBase(), lineas_existentes: comoExistentes(sin) });
    expect(iguales.reporte.totales).toMatchObject({ nuevas: 0, iguales: 1 });
  });

  it("una fila `nueva` omitida sale del plan, del reporte de líneas, de los avisos y de las cuentas, y pasa a `omitidas` con su proveedor, referencia y línea", () => {
    const r = base();
    const fuera = omitirFilasDelPlan(r, [{ fila: 2, motivo: "embarque_desconocido", detalle: "No existe el embarque 999999." }]);
    expect(fuera.reporte.totales).toEqual({ recibidas: 6, procesadas: 2, omitidas: 4, nuevas: 2, iguales: 0, cambiadas: 0 });
    expect(fuera.reporte.omitidas.map((o) => [o.fila, o.motivo])).toEqual([
      [2, "embarque_desconocido"],
      [4, "marca_y_agrupacion"],
      [5, "entregas_invalidas"],
      [6, "tipo_no_disponible"],
    ]);
    expect(fuera.reporte.omitidas[0]).toMatchObject({ proveedor: "Proveedor Norte", referencia: "PO-2211", linea_ordinal: "2", detalle: "No existe el embarque 999999." });
    expect(fuera.reporte.lineas.map((l) => l.fila)).toEqual([1, 3]);
    expect(fuera.compras.map((c) => c.lineas.map((l) => l.fila))).toEqual([[1], [3]]);
    expect(fuera.reporte.compras_a_crear.map((c) => [c.referencia, c.lineas, c.lineas_nuevas])).toEqual([["PO-2211", 1, 1], ["FS-001", 1, 1]]);
  });

  it("si se queda sin líneas nuevas la compra desaparece, y el proveedor nuevo ya no se crea", () => {
    const fuera = omitirFilasDelPlan(base(), [{ fila: 3, motivo: "viaje_cancelado" }]);
    expect(fuera.compras.map((c) => c.referencia)).toEqual(["PO-2211"]);
    expect(fuera.reporte.compras_a_crear.map((c) => c.referencia)).toEqual(["PO-2211"]);
    expect(fuera.reporte.proveedores_a_crear).toEqual([]);
    expect(fuera.reporte.avisos.some((a) => a.fila === 3)).toBe(false);
  });

  it("una fila `igual` omitida se anota sin tocar las cuentas de procesadas; sin omisiones el resultado es el mismo objeto; el original no cambia", () => {
    const nuevas = base();
    const iguales = previsualizar(filasImportacionEjemplo(), { ...estadoImportacionBase(), lineas_existentes: comoExistentes(nuevas) });
    const fuera = omitirFilasDelPlan(iguales, [{ fila: 1, motivo: "paquete_desconocido" }]);
    expect(fuera.reporte.totales).toMatchObject({ procesadas: 3, iguales: 3, nuevas: 0, omitidas: 4 });
    expect(fuera.reporte.lineas).toHaveLength(3);
    expect(omitirFilasDelPlan(nuevas, [])).toBe(nuevas);
    omitirFilasDelPlan(nuevas, [{ fila: 1, motivo: "embarque_desconocido" }]);
    expect(nuevas.reporte.totales).toEqual({ recibidas: 6, procesadas: 3, omitidas: 3, nuevas: 3, iguales: 0, cambiadas: 0 });
    expect(nuevas.compras[0].lineas).toHaveLength(2);
  });
});

// ─── 08b-1b: compras de COTV agrupadas (F14, F16) y número de OC (F31, F32) ───

describe("08b-1b · F14 y F16: una compra por proveedor y viaje, llegada en diciembre, sin embarque", () => {
  const cotv = (p: Partial<FilaImportacionCompra>): FilaImportacionCompra => fila({ moneda: "USD", llegada: "2026-12", tallas: "", destino: "", ...p });
  const norte = (ordinal: string, unidades: string, extra: Partial<FilaImportacionCompra> = {}) => cotv({ referencia: "COTV-261001-1", fecha_compra: "2026-07-06", linea_ordinal: ordinal, unidades, ...extra });
  const feria = cotv({ proveedor: "Feria Sur", referencia: "COTV-261001-2", fecha_compra: "2026-07-10", linea_ordinal: "1", unidades: "500" });
  const estadoDosProveedores = (): EstadoImportacionCompras => ({ ...estadoImportacionBase(), proveedores: [{ id: PROVEEDOR.norte, nombre: "Proveedor Norte", codigo: "PN", activo: true, es_intercompany: false }, { id: PROVEEDOR.feria, nombre: "Feria Sur", activo: true, es_intercompany: false }] });

  it("F14: dos filas de Proveedor Norte con la misma REFERENCIA y una de Feria Sur dan DOS compras, con entregas dic-26 sin embarque", () => {
    const r = previsualizar([norte("1", "300"), norte("2", "200"), feria], estadoDosProveedores());
    expect(r.reporte.omitidas).toEqual([]);
    expect(r.reporte.compras_a_crear.map((c) => [c.proveedor, c.referencia, c.lineas, c.fecha_compra])).toEqual([
      ["Proveedor Norte", "COTV-261001-1", 2, "2026-07-06"],
      ["Feria Sur", "COTV-261001-2", 1, "2026-07-10"],
    ]);
    expect(r.reporte.lineas.map((l) => [l.unidades, l.entregas])).toEqual([[300, [{ periodo: "2026-12", unidades: 300 }]], [200, [{ periodo: "2026-12", unidades: 200 }]], [500, [{ periodo: "2026-12", unidades: 500 }]]]);
    expect(r.compras.map((c) => c.lineas.reduce((s, l) => s + l.linea.unidades, 0))).toEqual([500, 500]);
    expect(r.compras.every((c) => c.origen === "carga_inicial" && c.estado === "confirmada")).toBe(true);
  });

  it("F14: con la segunda fila de Norte en FECHA_COMPRA 07-jul, esa fila sale `cabecera_inconsistente` y no entra", () => {
    const r = previsualizar([norte("1", "300"), norte("2", "200", { fecha_compra: "2026-07-07" }), feria], estadoDosProveedores());
    expect(r.reporte.omitidas.map((o) => [o.fila, o.motivo])).toEqual([[2, "cabecera_inconsistente"]]);
    expect(r.compras[0].lineas).toHaveLength(1);
  });

  it("las columnas informativas (DIA_REGISTRO, ITEM_COTV) y las de agrupador las ignora el esquema de la fila: no cambian nada", () => {
    const conExtras = { ...norte("1", "300"), DIA_REGISTRO: "2026-07-06", ITEM_COTV: "abc" } as unknown as FilaImportacionCompra;
    expect(previsualizar([conExtras], estadoDosProveedores()).reporte.omitidas).toEqual([]);
    expect(filaImportacionCompraSchema.parse({ ...conExtras })).not.toHaveProperty("DIA_REGISTRO");
  });

  it("F16: reimportar el mismo archivo da 3 `igual` y no crea nada", () => {
    const filas = [norte("1", "300"), norte("2", "200"), feria];
    const primera = previsualizar(filas, estadoDosProveedores());
    const existentes = primera.compras.flatMap((c, i) => c.lineas.map((l) => ({ clave: l.clave, huella: l.linea.huella_importacion, compra_id: i === 0 ? COMPRA.c12 : COMPRA.c15, compra_numero: i === 0 ? "C-000201" : "C-000202", compra_estado: "confirmada" as const })));
    const otra = previsualizar(filas, { ...estadoDosProveedores(), lineas_existentes: existentes });
    expect(otra.reporte.totales).toMatchObject({ iguales: 3, nuevas: 0, cambiadas: 0, omitidas: 0 });
    expect(otra.compras).toEqual([]);
  });
});

describe("08b-1b · F31 y F32: la columna OC del importador de compras", () => {
  const ID = { norte1: "c0000000-0000-4000-8000-000000000201", norte2: "c0000000-0000-4000-8000-000000000203", feria: "c0000000-0000-4000-8000-000000000202" };
  const cotv = (p: Partial<FilaImportacionCompra>): FilaImportacionCompra => fila({ moneda: "USD", llegada: "2026-12", tallas: "", destino: "", ...p });
  const n1 = (ordinal: string, oc?: string) => cotv({ referencia: "COTV-261001-1", fecha_compra: "2026-07-06", linea_ordinal: ordinal, unidades: "100", ...(oc === undefined ? {} : { oc }) });
  const n2 = (ordinal: string, oc?: string) => cotv({ referencia: "COTV-261001-1-2", fecha_compra: "2026-07-06", linea_ordinal: ordinal, unidades: "100", ...(oc === undefined ? {} : { oc }) });
  const fs = (ordinal: string, oc?: string) => cotv({ proveedor: "Feria Sur", referencia: "COTV-261001-2", fecha_compra: "2026-07-10", linea_ordinal: ordinal, unidades: "100", ...(oc === undefined ? {} : { oc }) });
  const proveedores = [{ id: PROVEEDOR.norte, nombre: "Proveedor Norte", codigo: "PN", activo: true, es_intercompany: false }, { id: PROVEEDOR.feria, nombre: "Feria Sur", activo: true, es_intercompany: false }];

  /** El estado después de haber importado `filas` una vez: sus compras ya existen (con el número de OC que se diga). */
  function existente(filas: FilaImportacionCompra[], compras: { clave: string; id: string; numero: string; proveedor_id: string; referencia: string; numero_oc?: string | null; estado?: "borrador" | "confirmada"; perfil_id?: string | null }[]): EstadoImportacionCompras {
    const r = previsualizar(filas, { ...estadoImportacionBase(), proveedores });
    return {
      ...estadoImportacionBase(),
      proveedores,
      compras: compras.map((c) => ({ id: c.id, numero: c.numero, proveedor_id: c.proveedor_id, referencia: c.referencia, estado: c.estado ?? "confirmada", cancelada_at: null, perfil_id: c.perfil_id ?? null, fecha_compra: "2026-07-06", moneda: "USD" as const, numero_oc: c.numero_oc ?? null })),
      lineas_existentes: r.compras.flatMap((pc) => {
        const c = compras.find((x) => x.clave === pc.clave) ?? compras[0];
        return pc.lineas.map((l) => ({ clave: l.clave, huella: l.linea.huella_importacion, compra_id: c.id, compra_numero: c.numero, compra_estado: c.estado ?? ("confirmada" as const) }));
      }),
    };
  }
  const CLAVE_N1 = claveCompraImportacion({ proveedor: "Proveedor Norte", referencia: "COTV-261001-1" });
  const CLAVE_N2 = claveCompraImportacion({ proveedor: "Proveedor Norte", referencia: "COTV-261001-1-2" });
  const CLAVE_FS = claveCompraImportacion({ proveedor: "Feria Sur", referencia: "COTV-261001-2" });
  const ambas = [n1("1"), n1("2"), fs("1")];
  const estadoBase = (extra: Partial<EstadoImportacionCompras> = {}) => ({
    ...existente(ambas, [
      { clave: CLAVE_N1, id: ID.norte1, numero: "C-000201", proveedor_id: PROVEEDOR.norte, referencia: "COTV-261001-1" },
      { clave: CLAVE_FS, id: ID.feria, numero: "C-000202", proveedor_id: PROVEEDOR.feria, referencia: "COTV-261001-2" },
    ]),
    ...extra,
  });
  const reimportar = (filas: FilaImportacionCompra[], estado = estadoBase(), opciones: OpcionesImportacion = { ...OPC, archivo_nombre: "planilla-c2.csv" }) => previsualizarImportacionCompras(filas, [], estado, opciones);

  it("F31: reimportar con la OC en las dos filas de C-000201 (y C-000202 vacía): las 3 líneas son `igual`, C-000201 queda con OC (registrada) y C-000202 sin cambio", () => {
    const r = reimportar([n1("1", "4500012345"), n1("2", "4500012345"), fs("1")]);
    expect(r.reporte.totales).toMatchObject({ iguales: 3, nuevas: 0, cambiadas: 0, omitidas: 0 });
    expect(r.compras).toEqual([]);
    expect(r.reporte.oc).toEqual([
      { compra_clave: CLAVE_N1, proveedor: "Proveedor Norte", referencia: "COTV-261001-1", compra: { id: ID.norte1, numero: "C-000201" }, numero_oc: "4500012345", antes: null, accion: "registrada", avisos: [] },
    ]);
    expect(r.ocs).toEqual([{ compra_clave: CLAVE_N1, compra_id: ID.norte1, numero_oc: "4500012345", antes: null, motivo: "Importado de planilla-c2.csv" }]);
    expect(argsEditarOcCompra(r.ocs[0], ID.norte1, ACTOR)).toEqual({ p_compra: ID.norte1, p_antes: null, p_numero_oc: "4500012345", p_motivo: "Importado de planilla-c2.csv", p_actor: ACTOR });
  });

  it("la OC NO entra en la huella ni en la clave: con o sin ella, la misma huella y la misma clasificación (nunca `cambiada` ni `nueva`)", () => {
    const sin = previsualizar([n1("1")], { ...estadoImportacionBase(), proveedores });
    const con = previsualizar([n1("1", "4500012345")], { ...estadoImportacionBase(), proveedores });
    expect(con.compras[0].lineas[0].clave).toBe(sin.compras[0].lineas[0].clave);
    expect(con.compras[0].lineas[0].linea.huella_importacion).toBe(sin.compras[0].lineas[0].linea.huella_importacion);
    // Y sobre una compra ya importada sin OC: `igual`.
    expect(reimportar([n1("1", "4500012345"), n1("2")]).reporte.lineas.map((l) => l.clasificacion)).toEqual(["igual", "igual"]);
  });

  it("vacía no dice nada: nunca borra una OC; reimportar otra vez la misma no cambia nada (`sin_cambio`)", () => {
    const conOc = estadoBase({ compras: estadoBase().compras.map((c) => (c.id === ID.norte1 ? { ...c, numero_oc: "4500012345" } : c)) });
    const vacia = reimportar([n1("1"), n1("2"), fs("1")], conOc);
    expect(vacia.reporte.oc).toEqual([]);
    expect(vacia.ocs).toEqual([]);
    const igual = reimportar([n1("1", "4500012345"), n1("2", "4500012345")], conOc);
    expect(igual.reporte.oc?.map((o) => o.accion)).toEqual(["sin_cambio"]);
    expect(igual.ocs).toEqual([]);
    // La comparación no distingue mayúsculas (`upper(btrim)`).
    expect(reimportar([n1("1", "4500ab"), n1("2", "4500ab")], estadoBase({ compras: estadoBase().compras.map((c) => (c.id === ID.norte1 ? { ...c, numero_oc: "4500AB" } : c)) })).ocs).toEqual([]);
  });

  it("una OC distinta de la guardada se cambia (`cambiada`), con `p_antes` = la guardada", () => {
    const conOc = estadoBase({ compras: estadoBase().compras.map((c) => (c.id === ID.norte1 ? { ...c, numero_oc: "4500012300" } : c)) });
    const r = reimportar([n1("1", "4500012345"), n1("2", "4500012345")], conOc);
    expect(r.reporte.oc?.[0]).toMatchObject({ accion: "cambiada", antes: "4500012300", numero_oc: "4500012345" });
    expect(r.ocs[0]).toMatchObject({ antes: "4500012300", numero_oc: "4500012345" });
  });

  it("dos filas de una compra con OC distintas: `oc_distinta_en_compra` y la OC no se aplica (las líneas siguen su regla)", () => {
    const r = reimportar([n1("1", "4500012345"), n1("2", "4500012399")]);
    expect(r.reporte.oc?.[0]).toMatchObject({ accion: "omitida", motivo: "oc_distinta_en_compra", numero_oc: null });
    expect(r.ocs).toEqual([]);
    expect(r.reporte.totales.iguales).toBe(2);
  });

  it("OC repetida en el mismo proveedor: en la base, `oc_repetida` con el número de la otra compra; el aviso en otro proveedor no bloquea", () => {
    const vivas = [
      { compra_id: ID.norte2, compra_numero: "C-000203", proveedor_id: PROVEEDOR.norte, proveedor_nombre: "Proveedor Norte", numero_oc: "4500012345" },
      { compra_id: ID.feria, compra_numero: "C-000202", proveedor_id: PROVEEDOR.feria, proveedor_nombre: "Feria Sur", numero_oc: "4500777777" },
    ];
    const repetida = reimportar([n1("1", "4500012345"), n1("2", "4500012345")], estadoBase({ ocs_vivas: vivas }));
    expect(repetida.reporte.oc?.[0]).toMatchObject({ accion: "omitida", motivo: "oc_repetida" });
    expect(repetida.reporte.oc?.[0].detalle).toContain("C-000203");
    expect(repetida.ocs).toEqual([]);
    expect(repetida.reporte.totales.iguales).toBe(2);
    // En otro proveedor solo avisa y se aplica.
    const otroProveedor = reimportar([n1("1", "4500777777"), n1("2", "4500777777")], estadoBase({ ocs_vivas: vivas }));
    expect(otroProveedor.reporte.oc?.[0]).toMatchObject({ accion: "registrada" });
    expect(otroProveedor.reporte.oc?.[0].avisos).toEqual([{ aviso: "oc_de_otro_proveedor", detalle: "La OC 4500777777 también está en C-000202 de Feria Sur: ¿es otra orden?" }]);
    expect(otroProveedor.ocs).toHaveLength(1);
  });

  it("OC repetida en el mismo archivo y proveedor: la segunda compra, en el orden del archivo, sale `oc_repetida`; sus líneas sí siguen su regla", () => {
    const filas = [n1("1", "4500012345"), n2("1", "4500012345")];
    const estado = existente(
      [n1("1"), n2("1")],
      [
        { clave: CLAVE_N1, id: ID.norte1, numero: "C-000201", proveedor_id: PROVEEDOR.norte, referencia: "COTV-261001-1" },
        { clave: CLAVE_N2, id: ID.norte2, numero: "C-000203", proveedor_id: PROVEEDOR.norte, referencia: "COTV-261001-1-2" },
      ],
    );
    const r = reimportar(filas, estado);
    expect(r.reporte.oc?.map((o) => [o.compra?.numero, o.accion, o.motivo ?? null])).toEqual([["C-000201", "registrada", null], ["C-000203", "omitida", "oc_repetida"]]);
    expect(r.ocs.map((o) => o.compra_id)).toEqual([ID.norte1]);
    expect(r.reporte.totales.iguales).toBe(2);
  });

  it("una OC con caracteres que no admite es `oc_invalida` y no se aplica", () => {
    const r = reimportar([n1("1", "45000/12#345"), n1("2", "45000/12#345")]);
    expect(r.reporte.oc?.[0]).toMatchObject({ accion: "omitida", motivo: "oc_invalida" });
    expect(r.ocs).toEqual([]);
    expect(reimportar([n1("1", "o".repeat(41)), n1("2", "o".repeat(41))]).reporte.oc?.[0].motivo).toBe("oc_invalida");
    expect(reimportar([n1("1", "  4500012345  "), n1("2", "4500012345")]).reporte.oc?.[0]).toMatchObject({ accion: "registrada", numero_oc: "4500012345" });
  });

  it("una compra nueva trae su OC en el plan, con `compra_id` nulo (se toma de `importar_compra`)", () => {
    const r = previsualizar([n1("1", "4500012345")], { ...estadoImportacionBase(), proveedores });
    expect(r.compras).toHaveLength(1);
    expect(r.ocs).toEqual([{ compra_clave: CLAVE_N1, compra_id: null, numero_oc: "4500012345", antes: null, motivo: "Importado de archivo" }]);
    expect(r.reporte.oc?.[0]).toMatchObject({ compra: null, accion: "registrada" });
  });

  it("si una columna de agrupador omite la fila de una compra nueva, su OC desaparece con ella", () => {
    const r = previsualizar([n1("1", "4500012345")], { ...estadoImportacionBase(), proveedores });
    const sin = omitirFilasDelPlan(r, [{ fila: 1, motivo: "embarque_desconocido" }]);
    expect(sin.compras).toEqual([]);
    expect(sin.ocs).toEqual([]);
    expect(sin.reporte.oc).toEqual([]);
  });

  const COMPRADOR = { perfil_id: "11111111-1111-4111-8111-111111111111" };
  const OTRO = "22222222-2222-4222-8222-222222222222";
  const comoComprador: OpcionesImportacion = { carga_inicial: false, k_prima: "2026-09", comprador: COMPRADOR, archivo_nombre: "mis-compras.csv" };

  it("F32: un comprador sobre una compra confirmada ajena: las líneas siguen la decisión 109 y la OC se omite con `oc_no_editable`", () => {
    const r = reimportar([n1("1", "4500012345"), n1("2", "4500012345")], estadoBase(), comoComprador);
    expect(r.reporte.oc?.[0]).toMatchObject({ accion: "omitida", motivo: "oc_no_editable" });
    expect(r.reporte.oc?.[0].detalle).toContain("C-000201");
    expect(r.ocs).toEqual([]);
    expect(r.reporte.totales.iguales).toBe(2);
    // Una línea nueva sobre esa compra ajena la omite la regla de la 109 (`compra_no_borrador`), sin tocar la OC.
    const nueva = reimportar([n1("1", "4500012345"), n1("2", "4500012345"), n1("3", "4500012345")], estadoBase(), comoComprador);
    expect(nueva.reporte.omitidas.map((o) => o.motivo)).toEqual(["compra_no_borrador"]);
    expect(nueva.reporte.oc?.[0].motivo).toBe("oc_no_editable");
  });

  it("F32: en su propio borrador y en una compra nueva suya, el comprador sí pone la OC; en un borrador ajeno, no", () => {
    const propio = estadoBase({ compras: estadoBase().compras.map((c) => (c.id === ID.norte1 ? { ...c, estado: "borrador" as const, perfil_id: COMPRADOR.perfil_id } : c)) });
    expect(reimportar([n1("1", "4500012345"), n1("2", "4500012345")], propio, comoComprador).reporte.oc?.[0]).toMatchObject({ accion: "registrada" });
    const ajeno = estadoBase({ compras: estadoBase().compras.map((c) => (c.id === ID.norte1 ? { ...c, estado: "borrador" as const, perfil_id: OTRO } : c)) });
    expect(reimportar([n1("1", "4500012345"), n1("2", "4500012345")], ajeno, comoComprador).reporte.oc?.[0].motivo).toBe("oc_no_editable");
    const nueva = previsualizarImportacionCompras([n1("1", "4500012345")], [], { ...estadoImportacionBase(), proveedores }, comoComprador);
    expect(nueva.reporte.oc?.[0]).toMatchObject({ accion: "registrada", compra: null });
    expect(nueva.ocs[0]).toMatchObject({ compra_id: null, motivo: "Importado de mis-compras.csv" });
  });

  it("admin y planner (sin `comprador`) aplican la OC en cualquier compra no cancelada, también confirmada y ajena", () => {
    expect(reimportar([n1("1", "4500012345"), n1("2", "4500012345")]).reporte.oc?.[0].accion).toBe("registrada");
  });
});
