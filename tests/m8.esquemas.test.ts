import { describe, expect, it } from "vitest";
import {
  cancelarSchema,
  comprasQuerySchema,
  fechaSchema,
  importarComprasSchema,
  proveedorSchema,
  quitarRecepcionSchema,
  recibirSchema,
} from "@/lib/compras/esquemas";
import {
  aceptarSugerenciaSchema,
  conciliacionQuerySchema,
  filaQuerySchema,
  flujoQuerySchema,
  parametrosFlujoSchema,
} from "@/lib/flujo/esquemas";
import { TEMPORADAS_DEFECTO } from "@/lib/marcas-barrer/tipos-api";
import { filasImportacionEjemplo, filasMezclaEjemplo } from "./compras.fixture";

/** Esquemas de T0 (ficha 08, `0.13.0`): recibir, quitar recepción, cancelar, aceptar sugerencia, importar y parámetros. */

const U1 = "a0000000-0000-4000-8000-000000000001";
const U2 = "a0000000-0000-4000-8000-000000000002";

const primerMensaje = (r: { success: boolean; error?: { issues: { message: string }[] } }) => (r.success ? null : r.error?.issues[0]?.message);

describe("recibirSchema («Confirmar ingreso»)", () => {
  const valido = { revision: 3, recepciones: [{ linea_id: U1, recibida_periodo: "2026-10", unidades: 200, fecha_recepcion: "2026-10-20" }] };

  it("acepta un ingreso y deja el mes como aaaa-mm y la nota nula", () => {
    const r = recibirSchema.parse({ ...valido, recepciones: [{ ...valido.recepciones[0], recibida_periodo: "2026-10-01" }] });
    expect(r.recepciones[0].recibida_periodo).toBe("2026-10");
    expect(r.recepciones[0].nota).toBeNull();
  });

  it("exige revisión entera ≥ 0", () => {
    expect(recibirSchema.safeParse({ recepciones: valido.recepciones }).success).toBe(false);
    expect(recibirSchema.safeParse({ ...valido, revision: -1 }).success).toBe(false);
    expect(recibirSchema.safeParse({ ...valido, revision: 1.5 }).success).toBe(false);
    expect(recibirSchema.safeParse({ ...valido, revision: 0 }).success).toBe(true);
  });

  it("de 1 a 50 ingresos", () => {
    expect(recibirSchema.safeParse({ ...valido, recepciones: [] }).success).toBe(false);
    const cincuenta = Array.from({ length: 50 }, () => valido.recepciones[0]);
    expect(recibirSchema.safeParse({ ...valido, recepciones: cincuenta }).success).toBe(true);
    expect(recibirSchema.safeParse({ ...valido, recepciones: [...cincuenta, valido.recepciones[0]] }).success).toBe(false);
  });

  it("rechaza unidades ≤ 0 o no enteras, mes inválido, día de mes distinto de 01 y fecha inexistente", () => {
    const con = (cambio: object) => recibirSchema.safeParse({ ...valido, recepciones: [{ ...valido.recepciones[0], ...cambio }] });
    expect(con({ unidades: 0 }).success).toBe(false);
    expect(con({ unidades: -5 }).success).toBe(false);
    expect(con({ unidades: 2.5 }).success).toBe(false);
    expect(con({ recibida_periodo: "2026-13" }).success).toBe(false);
    expect(con({ recibida_periodo: "2026-10-15" }).success).toBe(false);
    expect(con({ fecha_recepcion: "2026-02-30" }).success).toBe(false);
    expect(con({ fecha_recepcion: "20/10/2026" }).success).toBe(false);
    expect(con({ linea_id: "no-es-uuid" }).success).toBe(false);
  });

  it("limita la nota a 200 caracteres", () => {
    const con = (nota: string) => recibirSchema.safeParse({ ...valido, recepciones: [{ ...valido.recepciones[0], nota }] });
    expect(con("x".repeat(200)).success).toBe(true);
    expect(primerMensaje(con("x".repeat(201)))).toContain("200");
  });
});

describe("quitarRecepcionSchema (query ?revision=)", () => {
  it("convierte el texto de la query en entero", () => {
    expect(quitarRecepcionSchema.parse({ revision: "4" })).toEqual({ revision: 4 });
  });
  it("rechaza ausente, negativa o no entera", () => {
    expect(quitarRecepcionSchema.safeParse({}).success).toBe(false);
    expect(quitarRecepcionSchema.safeParse({ revision: "-1" }).success).toBe(false);
    expect(quitarRecepcionSchema.safeParse({ revision: "1.5" }).success).toBe(false);
    expect(quitarRecepcionSchema.safeParse({ revision: "abc" }).success).toBe(false);
  });
});

describe("cancelarSchema", () => {
  it("exige motivo de 1 a 200 caracteres (recortado) y revisión", () => {
    expect(cancelarSchema.parse({ motivo: "  Se compró por error  ", revision: 2 })).toEqual({ motivo: "Se compró por error", revision: 2 });
    expect(cancelarSchema.safeParse({ motivo: "   ", revision: 2 }).success).toBe(false);
    expect(cancelarSchema.safeParse({ revision: 2 }).success).toBe(false);
    expect(cancelarSchema.safeParse({ motivo: "x".repeat(201), revision: 2 }).success).toBe(false);
    expect(cancelarSchema.safeParse({ motivo: "x".repeat(200), revision: 2 }).success).toBe(true);
    expect(cancelarSchema.safeParse({ motivo: "ok" }).success).toBe(false);
  });
});

describe("aceptarSugerenciaSchema", () => {
  const valido = { periodo: "2026-09", linea_id: U1, entrega_id: U2, unidades: 500, revision: 1 };

  it("acepta el cuerpo de la ficha (sin huella)", () => {
    expect(aceptarSugerenciaSchema.parse(valido)).toEqual(valido);
  });
  it("normaliza aaaa-mm-01 a aaaa-mm", () => {
    expect(aceptarSugerenciaSchema.parse({ ...valido, periodo: "2026-09-01" }).periodo).toBe("2026-09");
  });
  it("rechaza unidades ≤ 0, ids que no son uuid y periodos inválidos", () => {
    expect(aceptarSugerenciaSchema.safeParse({ ...valido, unidades: 0 }).success).toBe(false);
    expect(aceptarSugerenciaSchema.safeParse({ ...valido, unidades: 1.5 }).success).toBe(false);
    expect(aceptarSugerenciaSchema.safeParse({ ...valido, entrega_id: "x" }).success).toBe(false);
    expect(aceptarSugerenciaSchema.safeParse({ ...valido, periodo: "sep-2026" }).success).toBe(false);
    expect(aceptarSugerenciaSchema.safeParse({ ...valido, revision: undefined }).success).toBe(false);
  });
});

describe("importarComprasSchema", () => {
  const cuerpo = (extra: object = {}) => ({ modo: "previsualizar", carga_inicial: true, filas: filasImportacionEjemplo(), ...extra });

  it("acepta las seis filas del caso 13 y la hoja MEZCLA", () => {
    const r = importarComprasSchema.parse(cuerpo({ mezcla: filasMezclaEjemplo() }));
    expect(r.filas).toHaveLength(6);
    expect(r.mezcla).toHaveLength(4);
    expect(r.carga_inicial).toBe(true);
  });

  it("sin casilla, carga_inicial es false (la ruta de 0.13.0 responde 400 carga_inicial_requerida) y la mezcla queda vacía", () => {
    const r = importarComprasSchema.parse({ modo: "aplicar", filas: filasImportacionEjemplo() });
    expect(r.carga_inicial).toBe(false);
    expect(r.mezcla).toEqual([]);
  });

  it("las columnas que no vinieron valen vacío", () => {
    const r = importarComprasSchema.parse({ modo: "previsualizar", carga_inicial: true, filas: [{ proveedor: "Proveedor Norte" }] });
    expect(r.filas[0].referencia).toBe("");
    expect(r.filas[0].entregas).toBe("");
    expect(r.filas[0].unidades).toBe("");
  });

  it("modo inválido, sin filas, demasiadas filas y celdas que no son texto", () => {
    expect(primerMensaje(importarComprasSchema.safeParse(cuerpo({ modo: "otro" })))).toBe("El modo debe ser previsualizar o aplicar.");
    expect(primerMensaje(importarComprasSchema.safeParse(cuerpo({ filas: [] })))).toBe("No hay filas que importar.");
    expect(importarComprasSchema.safeParse(cuerpo({ filas: Array.from({ length: 10_001 }, () => ({})) })).success).toBe(false);
    expect(importarComprasSchema.safeParse(cuerpo({ filas: [{ unidades: 500 }] })).success).toBe(false);
  });

  it("topa cada celda en 300 caracteres (y la nota en 1 000)", () => {
    expect(importarComprasSchema.safeParse(cuerpo({ filas: [{ proveedor: "x".repeat(301) }] })).success).toBe(false);
    expect(importarComprasSchema.safeParse(cuerpo({ filas: [{ nota: "x".repeat(1000) }] })).success).toBe(true);
    expect(importarComprasSchema.safeParse(cuerpo({ filas: [{ nota: "x".repeat(1001) }] })).success).toBe(false);
  });
});

describe("parametrosFlujoSchema", () => {
  const valido = {
    imi_min: 4,
    imi_max: 8,
    meses_tarjeta: 6,
    extender_horizonte: true,
    temporadas: TEMPORADAS_DEFECTO,
    umbral_conciliacion_u: 10,
    umbral_conciliacion_pct: 20,
  };

  it("acepta los valores por defecto y los de la prueba 3 / 6", () => {
    expect(parametrosFlujoSchema.safeParse(valido).success).toBe(true);
    expect(parametrosFlujoSchema.safeParse({ ...valido, imi_min: 3, imi_max: 6 }).success).toBe(true);
  });

  it("8 / 6 (máximo menor que el mínimo) es 400 con el mensaje de la ficha", () => {
    expect(primerMensaje(parametrosFlujoSchema.safeParse({ ...valido, imi_min: 8, imi_max: 6 }))).toBe("El IMI máximo no puede ser menor que el mínimo.");
  });

  it("IMI entre 0,5 y 24 con un decimal", () => {
    expect(parametrosFlujoSchema.safeParse({ ...valido, imi_min: 0.4 }).success).toBe(false);
    expect(parametrosFlujoSchema.safeParse({ ...valido, imi_max: 24.5 }).success).toBe(false);
    expect(parametrosFlujoSchema.safeParse({ ...valido, imi_min: 4.25 }).success).toBe(false);
    expect(parametrosFlujoSchema.safeParse({ ...valido, imi_min: 0.5, imi_max: 24 }).success).toBe(true);
  });

  it("temporadas con solape, con hueco o fuera de 1–12 se rechazan con el motivo de M12", () => {
    const solape = { verano: { desde_mes: 10, hasta_mes: 4 }, invierno: { desde_mes: 4, hasta_mes: 9 } };
    expect(primerMensaje(parametrosFlujoSchema.safeParse({ ...valido, temporadas: solape }))).toContain("se solapan");
    const hueco = { verano: { desde_mes: 10, hasta_mes: 2 }, invierno: { desde_mes: 4, hasta_mes: 9 } };
    expect(primerMensaje(parametrosFlujoSchema.safeParse({ ...valido, temporadas: hueco }))).toContain("doce meses");
    const fuera = { verano: { desde_mes: 0, hasta_mes: 3 }, invierno: { desde_mes: 4, hasta_mes: 9 } };
    expect(parametrosFlujoSchema.safeParse({ ...valido, temporadas: fuera }).success).toBe(false);
    const cambiadas = { verano: { desde_mes: 11, hasta_mes: 4 }, invierno: { desde_mes: 5, hasta_mes: 10 } };
    expect(parametrosFlujoSchema.safeParse({ ...valido, temporadas: cambiadas }).success).toBe(true);
  });

  it("meses de la tarjeta 1–24, umbrales 0–1000 u y 0–100 %", () => {
    expect(parametrosFlujoSchema.safeParse({ ...valido, meses_tarjeta: 0 }).success).toBe(false);
    expect(parametrosFlujoSchema.safeParse({ ...valido, meses_tarjeta: 25 }).success).toBe(false);
    expect(parametrosFlujoSchema.safeParse({ ...valido, meses_tarjeta: 6.5 }).success).toBe(false);
    expect(parametrosFlujoSchema.safeParse({ ...valido, umbral_conciliacion_u: 1001 }).success).toBe(false);
    expect(parametrosFlujoSchema.safeParse({ ...valido, umbral_conciliacion_u: 0 }).success).toBe(true);
    expect(parametrosFlujoSchema.safeParse({ ...valido, umbral_conciliacion_pct: 100.5 }).success).toBe(false);
    expect(parametrosFlujoSchema.safeParse({ ...valido, umbral_conciliacion_pct: 12.345 }).success).toBe(false);
  });

  it("todos los campos son obligatorios (la fila se reemplaza entera)", () => {
    const { extender_horizonte, ...sin } = valido;
    void extender_horizonte;
    expect(parametrosFlujoSchema.safeParse(sin).success).toBe(false);
  });
});

describe("proveedorSchema (regla 19)", () => {
  it("acepta nombre y es_intercompany, recorta y pasa vacíos a null", () => {
    const r = proveedorSchema.parse({ nombre: "  Feria Sur ", pais: "", es_intercompany: false });
    expect(r.nombre).toBe("Feria Sur");
    expect(r.pais).toBeNull();
  });
  it("rechaza banco, cuenta bancaria y cualquier clave desconocida", () => {
    expect(primerMensaje(proveedorSchema.safeParse({ nombre: "X", banco: "BCP" }))).toContain("datos bancarios");
    expect(proveedorSchema.safeParse({ nombre: "X", cuenta_bancaria: "123" }).success).toBe(false);
  });
  it("el nombre es obligatorio y llega a 120", () => {
    expect(proveedorSchema.safeParse({ nombre: " " }).success).toBe(false);
    expect(proveedorSchema.safeParse({ nombre: "x".repeat(121) }).success).toBe(false);
    expect(proveedorSchema.safeParse({ nombre: "x".repeat(120) }).success).toBe(true);
  });
});

describe("fechaSchema", () => {
  it("acepta días reales y rechaza los que no existen", () => {
    expect(fechaSchema.safeParse("2026-10-14").success).toBe(true);
    expect(fechaSchema.safeParse("2028-02-29").success).toBe(true);
    expect(fechaSchema.safeParse("2026-02-29").success).toBe(false);
    expect(fechaSchema.safeParse("2026-04-31").success).toBe(false);
    expect(fechaSchema.safeParse("0000-01-01").success).toBe(false);
  });
});

describe("consultas de lectura", () => {
  it("flujoQuerySchema: filtros, solo, mio y meses", () => {
    const r = flujoQuerySchema.parse({ genero_id: U1, solo: "falta", mio: "1", meses: "6" });
    expect(r).toMatchObject({ genero_id: U1, solo: "falta", mio: true, meses: 6 });
    expect(flujoQuerySchema.parse({}).mio).toBe(false);
    expect(flujoQuerySchema.safeParse({ solo: "todos" }).success).toBe(false);
    expect(flujoQuerySchema.safeParse({ meses: "0" }).success).toBe(false);
    expect(flujoQuerySchema.safeParse({ meses: "25" }).success).toBe(false);
    expect(flujoQuerySchema.safeParse({ mio: "si" }).success).toBe(false);
    expect(flujoQuerySchema.safeParse({ genero_id: "x" }).success).toBe(false);
  });

  it("filaQuerySchema: gml y agrupación obligatorios, equivalencia opcional", () => {
    expect(filaQuerySchema.safeParse({ gml_id: U1, agrupacion_marca_id: U2 }).success).toBe(true);
    expect(filaQuerySchema.safeParse({ gml_id: U1, agrupacion_marca_id: U2, equivalencia_id: U1 }).success).toBe(true);
    expect(filaQuerySchema.safeParse({ gml_id: U1 }).success).toBe(false);
  });

  it("conciliacionQuerySchema: periodo opcional y solo propios de la conciliación", () => {
    expect(conciliacionQuerySchema.parse({ periodo: "2026-09", solo: "por_confirmar" })).toMatchObject({ periodo: "2026-09", solo: "por_confirmar" });
    expect(conciliacionQuerySchema.safeParse({ solo: "falta" }).success).toBe(false);
    expect(conciliacionQuerySchema.safeParse({ periodo: "2026-9" }).success).toBe(false);
  });

  it("comprasQuerySchema: catálogos, rango de llegada y banderas", () => {
    expect(comprasQuerySchema.parse({ estado: "confirmada", por_confirmar: "1", mio: "0" })).toMatchObject({ estado: "confirmada", por_confirmar: true, mio: false });
    expect(comprasQuerySchema.safeParse({ estado: "pendiente" }).success).toBe(false);
    expect(comprasQuerySchema.safeParse({ origen: "web" }).success).toBe(false);
    expect(comprasQuerySchema.safeParse({ llegada_desde: "2026-12", llegada_hasta: "2026-10" }).success).toBe(false);
    expect(comprasQuerySchema.safeParse({ llegada_desde: "2026-10", llegada_hasta: "2026-12" }).success).toBe(true);
  });
});
