import { describe, expect, it } from "vitest";
import {
  admiteLote,
  errorDeMotivo,
  esMesValido,
  estadoDeCompra,
  etiquetaMesCorta,
  fotoCompra,
  fundirEntregas,
  interpretarResultadoFuncion,
  mesDe,
  motivoRechazoLinea,
  primerDiaDelMes,
  recalcularModelo,
  resolverUnidadDeMarca,
  transicion,
  ultimoDiaDelMes,
  type CatalogosCompra,
  type LineaParaValidar,
} from "@/lib/compras/reglas";
import { MOTIVOS_FUNCION_COMPRA } from "@/lib/compras/tipos";
import { COMPRA, LINEA, MARCA_M8, NODO_M8, registrosC12 } from "./compras.fixture";
import { EQ_M8, TIENDA_M8, estadoImportacionBase, modeloDeRegistros } from "./compras.estado.fixture";

/** Regla 15 (línea válida), regla 16 (transiciones) y el espejo de las funciones SQL de la ficha 08. */

const catalogos = (): CatalogosCompra => {
  const e = estadoImportacionBase();
  return { nodos: e.nodos, equivalencias: e.equivalencias, marcas: e.marcas, agrupaciones: e.agrupaciones, tiendas: e.tiendas };
};

const linea = (extra: Partial<LineaParaValidar> = {}): LineaParaValidar => ({
  tipo: "especifica",
  genero_mundo_linea_id: NODO_M8.urbano,
  equivalencia_id: null,
  marca_id: MARCA_M8.alfa,
  agrupacion_marca_id: null,
  unidades: 500,
  destino: "cd",
  tienda_id: null,
  entregas: [{ periodo: "2026-11", unidades: 500 }],
  ...extra,
});

const motivo = (l: LineaParaValidar) => motivoRechazoLinea(l, catalogos())?.motivo ?? null;

describe("regla 15: una línea válida", () => {
  it("una específica correcta no tiene rechazo", () => {
    expect(motivoRechazoLinea(linea(), catalogos())).toBeNull();
    expect(motivo(linea({ marca_id: null, agrupacion_marca_id: estadoImportacionBase().agrupaciones[0].id }))).toBeNull();
  });

  it("específica: GML obligatorio y exactamente una de marca o agrupación", () => {
    const agr = estadoImportacionBase().agrupaciones[0].id;
    expect(motivo(linea({ genero_mundo_linea_id: null }))).toBe("gml_requerido");
    expect(motivo(linea({ agrupacion_marca_id: agr }))).toBe("marca_y_agrupacion");
    expect(motivo(linea({ marca_id: null }))).toBe("sin_marca_ni_agrupacion");
    expect(motivo(linea({ genero_mundo_linea_id: NODO_M8.inactivo }))).toBe("gml_inactivo");
    expect(motivo(linea({ genero_mundo_linea_id: "no-existe" }))).toBe("gml_inexistente");
  });

  it("lote de una marca: sin GML y la marca debe ser al barrer o mixta (modalidad_no_barrer)", () => {
    const lote = (marca: string | null, extra: Partial<LineaParaValidar> = {}) => linea({ tipo: "barrer_marca", genero_mundo_linea_id: null, marca_id: marca, ...extra });
    expect(motivo(lote(MARCA_M8.beta))).toBeNull(); // barrido
    expect(motivo(lote(MARCA_M8.gamma))).toBeNull(); // mixta
    expect(motivo(lote(MARCA_M8.jh))).toBe("modalidad_no_barrer"); // por GML
    expect(motivo(lote(MARCA_M8.alfa))).toBe("modalidad_no_barrer"); // sin tratamiento
    expect(motivo(lote(MARCA_M8.john))).toBe("modalidad_no_barrer"); // miembro: cuenta como su cabeza (por GML)
    expect(motivo(lote(null))).toBe("sin_marca_ni_agrupacion");
    expect(motivo(lote(MARCA_M8.beta, { genero_mundo_linea_id: NODO_M8.urbano }))).toBe("tipo_invalido");
    expect(motivo(lote(MARCA_M8.beta, { agrupacion_marca_id: estadoImportacionBase().agrupaciones[0].id }))).toBe("marca_y_agrupacion");
  });

  it("una mixta con GML es una línea específica (válida); sin GML es un lote", () => {
    expect(motivo(linea({ marca_id: MARCA_M8.gamma }))).toBeNull();
  });

  it("lote de varias marcas: no disponible en 0.13.0; con M9a exige filas y no lleva GML, marca ni agrupación", () => {
    const mezcla = (extra: Partial<LineaParaValidar> = {}) => linea({ tipo: "barrer_mezcla", genero_mundo_linea_id: null, marca_id: null, ...extra });
    expect(motivo(mezcla({ mezcla_filas: 4 }))).toBe("tipo_no_disponible");
    expect(motivoRechazoLinea(mezcla({ mezcla_filas: 4 }), catalogos(), ["especifica", "barrer_marca", "barrer_mezcla"])).toBeNull();
    expect(motivoRechazoLinea(mezcla({ mezcla_filas: 0 }), catalogos(), ["barrer_mezcla"])?.motivo).toBe("mezcla_sin_filas");
    expect(motivoRechazoLinea(mezcla({ mezcla_filas: 2, marca_id: MARCA_M8.alfa }), catalogos(), ["barrer_mezcla"])?.motivo).toBe("tipo_invalido");
  });

  it("la equivalencia solo existe en un nodo GMLE y debe ser de ese nodo", () => {
    expect(motivo(linea({ genero_mundo_linea_id: NODO_M8.camisa, equivalencia_id: EQ_M8.larga }))).toBeNull();
    expect(motivo(linea({ genero_mundo_linea_id: NODO_M8.urbano, equivalencia_id: EQ_M8.larga }))).toBe("equivalencia_requiere_gmle");
    expect(motivo(linea({ genero_mundo_linea_id: NODO_M8.camisa, equivalencia_id: EQ_M8.ternoX }))).toBe("equivalencia_de_otro_nodo");
    expect(motivo(linea({ genero_mundo_linea_id: NODO_M8.camisa, equivalencia_id: "no-existe" }))).toBe("equivalencia_desconocida");
  });

  it("destino tienda exige una tienda activa de tipo Tienda; solo él lleva tienda_id", () => {
    expect(motivo(linea({ destino: "tienda", tienda_id: TIENDA_M8.t01 }))).toBeNull();
    expect(motivo(linea({ destino: "tienda", tienda_id: null }))).toBe("tienda_requerida");
    expect(motivo(linea({ destino: "tienda", tienda_id: TIENDA_M8.cerrada }))).toBe("destino_desconocido");
    expect(motivo(linea({ destino: "tienda", tienda_id: TIENDA_M8.cd }))).toBe("destino_desconocido");
    expect(motivo(linea({ destino: "cd", tienda_id: TIENDA_M8.t01 }))).toBe("destino_desconocido");
    expect(motivo(linea({ destino: "intercompany_directo" }))).toBeNull();
  });

  it("unidades > 0 y entregas con meses válidos cuya suma es la de la línea", () => {
    expect(motivo(linea({ unidades: 0 }))).toBe("unidades_invalida");
    expect(motivo(linea({ unidades: 1.5 }))).toBe("unidades_invalida");
    expect(motivo(linea({ entregas: [{ periodo: "2026-11", unidades: 300 }, { periodo: "2026-12", unidades: 300 }] }))).toBe("entregas_invalidas");
    expect(motivo(linea({ entregas: [] }))).toBe("entregas_invalidas");
    expect(motivo(linea({ entregas: [{ periodo: "2026-11-15", unidades: 500 }] }))).toBe("entregas_invalidas");
    expect(motivo(linea({ entregas: [{ periodo: "2026-13", unidades: 500 }] }))).toBe("entregas_invalidas");
    expect(motivo(linea({ entregas: [{ periodo: "2026-11-01", unidades: 200 }, { periodo: "2026-12", unidades: 300 }] }))).toBeNull();
    expect(motivo(linea({ entregas: [{ periodo: "2026-11", unidades: 0 }, { periodo: "2026-12", unidades: 500 }] }))).toBe("entregas_invalidas");
  });

  it("el detalle de entregas dice cuánto suman", () => {
    expect(motivoRechazoLinea(linea({ entregas: [{ periodo: "2026-11", unidades: 300 }, { periodo: "2026-12", unidades: 300 }] }), catalogos())?.detalle).toBe(
      "Las entregas suman 600 y la línea es de 500.",
    );
  });

  it("un miembro de conjunto se resuelve a su cabeza", () => {
    const { marcas } = catalogos();
    const john = marcas.find((m) => m.id === MARCA_M8.john);
    if (!john) throw new Error("falta JOHN");
    const r = resolverUnidadDeMarca(john, marcas);
    expect(r.unidad.id).toBe(MARCA_M8.jh);
    expect(r.miembro_resuelto).toBe(true);
    const alfa = marcas.find((m) => m.id === MARCA_M8.alfa);
    if (!alfa) throw new Error("falta ALFA");
    expect(resolverUnidadDeMarca(alfa, marcas)).toEqual({ unidad: alfa, miembro_resuelto: false });
  });

  it("admiteLote: solo barrido y mixta", () => {
    const { marcas } = catalogos();
    const de = (id: string) => marcas.find((m) => m.id === id);
    expect(admiteLote(de(MARCA_M8.beta)!)).toBe(true);
    expect(admiteLote(de(MARCA_M8.gamma)!)).toBe(true);
    expect(admiteLote(de(MARCA_M8.jh)!)).toBe(false);
    expect(admiteLote(de(MARCA_M8.alfa)!)).toBe(false);
  });
});

describe("regla 16: transiciones", () => {
  const c = (estado: "borrador" | "confirmada" | "recibida" | "cancelada", cancelada_at: string | null = null) => ({ estado, cancelada_at });

  it("solo cancelada es inmutable", () => {
    for (const a of ["editar", "confirmar", "recibir", "cancelar"] as const) expect(transicion(c("cancelada"), a)).toEqual({ ok: false, motivo: "no_editable" });
    for (const e of ["borrador", "confirmada", "recibida"] as const) expect(transicion(c(e), "editar")).toEqual({ ok: true, hacia: e });
  });

  it("confirmar: solo un borrador con al menos una línea", () => {
    expect(transicion(c("borrador"), "confirmar", { lineas_activas: 1 })).toEqual({ ok: true, hacia: "confirmada" });
    expect(transicion(c("borrador"), "confirmar", { lineas_activas: 0 })).toEqual({ ok: false, motivo: "sin_lineas" });
    expect(transicion(c("confirmada"), "confirmar", { lineas_activas: 1 })).toEqual({ ok: false, motivo: "ya_confirmada" });
  });

  it("recibir: confirmada, o recibida con saldo cerrado; un borrador no recibe", () => {
    expect(transicion(c("confirmada"), "recibir")).toEqual({ ok: true, hacia: "confirmada" });
    expect(transicion(c("recibida", "2026-10-25T00:00:00Z"), "recibir")).toEqual({ ok: true, hacia: "recibida" });
    expect(transicion(c("recibida"), "recibir")).toEqual({ ok: false, motivo: "excede_pendiente" });
    expect(transicion(c("borrador"), "recibir")).toEqual({ ok: false, motivo: "no_confirmada" });
  });

  it("cancelar: borrador o confirmada; con recepciones deja recibida (saldo cerrado); recibida responde recibida", () => {
    expect(transicion(c("borrador"), "cancelar")).toEqual({ ok: true, hacia: "cancelada" });
    expect(transicion(c("confirmada"), "cancelar", { unidades_recibidas: 0 })).toEqual({ ok: true, hacia: "cancelada" });
    expect(transicion(c("confirmada"), "cancelar", { unidades_recibidas: 300 })).toEqual({ ok: true, hacia: "recibida" });
    expect(transicion(c("recibida"), "cancelar")).toEqual({ ok: false, motivo: "recibida" });
    expect(transicion(c("recibida", "2026-10-25T00:00:00Z"), "cancelar")).toEqual({ ok: false, motivo: "recibida" });
  });
});

describe("espejo de compra_recalcular_estado y compra_foto", () => {
  it("estadoDeCompra: recibida si todas las líneas activas llegaron; confirmada si no; borrador y cancelada no cambian solas", () => {
    const base = modeloDeRegistros(registrosC12());
    expect(estadoDeCompra(base)).toBe("confirmada");
    expect(estadoDeCompra({ ...base, lineas: [{ ...base.lineas[0], unidades_recibidas: 500 }] })).toBe("recibida");
    expect(estadoDeCompra({ ...base, estado: "borrador" })).toBe("borrador");
    expect(estadoDeCompra({ ...base, estado: "cancelada" })).toBe("cancelada");
    // Una línea inactiva no cuenta; sin líneas activas sigue confirmada.
    expect(estadoDeCompra({ ...base, lineas: [{ ...base.lineas[0], activo: false }] })).toBe("confirmada");
  });

  it("con saldo cerrado: recibida si queda alguna recepción, cancelada si no", () => {
    const base = { ...modeloDeRegistros(registrosC12({ recepciones: [["2026-10", 100]] })), cancelada_at: "2026-10-25T00:00:00Z" };
    expect(recalcularModelo(base).estado).toBe("recibida");
    expect(recalcularModelo(base).lineas[0]).toMatchObject({ unidades_recibidas: 100, unidades_canceladas: 400 });
    expect(recalcularModelo({ ...base, recepciones: [] }).estado).toBe("cancelada");
  });

  it("fotoCompra lleva los meses como aaaa-mm-01 y las recepciones ordenadas por mes", () => {
    const m = modeloDeRegistros(registrosC12({ recepciones: [["2026-10", 200], ["2026-08", 100]] }));
    const foto = fotoCompra(m);
    expect(foto).toMatchObject({ estado: "confirmada", revision: 3, saldo_cerrado: false });
    expect(foto.recepciones.map((r) => r.recibida_periodo)).toEqual(["2026-08-01", "2026-10-01"]);
    expect(foto.lineas).toEqual([{ id: LINEA.c12, unidades: 500, unidades_recibidas: 300, unidades_canceladas: 0 }]);
  });
});

describe("resultado de las funciones SQL", () => {
  it("interpreta un ok con sus datos extra", () => {
    const r = interpretarResultadoFuncion({ ok: true, compra_id: COMPRA.c12, revision: 4, estado: "recibida", numero: "C-000012" });
    expect(r).toEqual({ ok: true, compra_id: COMPRA.c12, revision: 4, estado: "recibida", datos: { numero: "C-000012" } });
  });

  it("interpreta un rechazo conocido y marca como desconocido lo demás", () => {
    expect(interpretarResultadoFuncion({ ok: false, motivo: "compra_cambio" })).toEqual({ ok: false, motivo: "compra_cambio" });
    expect(interpretarResultadoFuncion({ ok: false, motivo: "no_confirmada" })).toEqual({ ok: false, motivo: "no_confirmada" });
    expect(interpretarResultadoFuncion({ ok: false, motivo: "otra_cosa" })).toEqual({ ok: false, motivo: "desconocido" });
    expect(interpretarResultadoFuncion(null)).toEqual({ ok: false, motivo: "desconocido" });
    expect(interpretarResultadoFuncion({ ok: true })).toEqual({ ok: false, motivo: "desconocido" });
    expect(interpretarResultadoFuncion([])).toEqual({ ok: false, motivo: "desconocido" });
  });

  it("errorDeMotivo: los de T0 usan su estado y mensaje; los extra de la función, los suyos", () => {
    expect(errorDeMotivo("compra_cambio")).toMatchObject({ status: 409, codigo: "compra_cambio" });
    expect(errorDeMotivo("no_pertenece")).toMatchObject({ status: 404, codigo: "no_pertenece" });
    expect(errorDeMotivo("recibida").mensaje).toBe("Ya llegó todo: no hay saldo que cancelar.");
    expect(errorDeMotivo("no_encontrada")).toMatchObject({ status: 404, codigo: "compra_no_encontrada" });
    expect(errorDeMotivo("no_confirmada")).toMatchObject({ status: 409 });
    expect(errorDeMotivo("motivo_requerido")).toMatchObject({ status: 400 });
    expect(errorDeMotivo("desconocido")).toMatchObject({ status: 500 });
    for (const m of MOTIVOS_FUNCION_COMPRA) expect(errorDeMotivo(m).mensaje.length).toBeGreaterThan(0);
  });
});

describe("meses y fechas", () => {
  it("ayudantes de meses", () => {
    expect(mesDe("2026-10-14")).toBe("2026-10");
    expect(primerDiaDelMes("2026-10")).toBe("2026-10-01");
    expect(primerDiaDelMes("2026-10-14")).toBe("2026-10-01");
    expect(ultimoDiaDelMes("2026-02")).toBe("2026-02-28");
    expect(ultimoDiaDelMes("2026-12")).toBe("2026-12-31");
    expect(etiquetaMesCorta("2026-09")).toBe("set-2026");
    expect(etiquetaMesCorta("2026-10")).toBe("oct-2026");
    expect(esMesValido("2026-10")).toBe(true);
    expect(esMesValido("2026-13")).toBe(false);
    expect(esMesValido("2026-10-01")).toBe(false);
  });

  it("fundirEntregas junta los meses repetidos y ordena", () => {
    expect(fundirEntregas([{ periodo: "2026-12", unidades: 100 }, { periodo: "2026-11", unidades: 200 }, { periodo: "2026-12-01", unidades: 50 }])).toEqual([
      { periodo: "2026-11", unidades: 200 },
      { periodo: "2026-12", unidades: 150 },
    ]);
  });
});
