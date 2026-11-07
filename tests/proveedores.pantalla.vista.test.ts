import { describe, expect, it } from "vitest";
import {
  ayudaPlazos,
  borradorDeFicha,
  borradorVacio,
  contactoVacio,
  cuerpoProveedor,
  faltanDeListado,
  FILTROS_INICIALES,
  filtrarProveedores,
  hayNombreIgual,
  hojaProveedores,
  hrefComprasDeProveedor,
  marcarPrincipal,
  paisesDe,
  textoFaltan,
  textoParecido,
  textoResumen,
  textoRespuestaEliminar,
  textoUbicacion,
  validarBorrador,
  type BorradorProveedor,
} from "../src/components/proveedores/vista-proveedores";
import { proveedorFichaSchema } from "../src/lib/proveedores/esquemas";
import { fichaDeEjemplo, listado } from "./proveedores.pantalla.fixture";

/** Lógica pura de las pantallas de proveedores (08c, §4.2) con proveedores inventados. */

const valido = (): BorradorProveedor => ({ ...borradorVacio(), nombre: "Feria Norte", pais: "China", region: "Zhejiang" });

describe("borrador y cuerpo de la API", () => {
  it("el borrador vacío no se puede enviar: faltan nombre y país", () => {
    const e = validarBorrador(borradorVacio());
    expect(Object.keys(e).sort()).toEqual(["nombre", "pais"]);
    expect(e.nombre).toBe("Escribe el nombre del proveedor.");
    expect(e.pais).toBe("Elige un país de la lista.");
  });

  it("un borrador válido pasa el MISMO esquema que usa la API (estricto): solo las claves de la ficha, sin banco ni clave de origen", () => {
    const cuerpo = cuerpoProveedor(valido(), null);
    expect(proveedorFichaSchema.safeParse(cuerpo).success).toBe(true);
    expect(Object.keys(cuerpo).sort()).toEqual(
      ["ciudad", "codigo", "condiciones_pago", "contactos", "direccion", "es_intercompany", "identificacion", "incoterm", "moneda", "nombre", "nota", "pais", "plazo_produccion_dias", "plazo_transito_dias", "puerto_embarque", "region"].sort(),
    );
    expect(JSON.stringify(cuerpo)).not.toMatch(/banco|cuenta|clave_origen/);
  });

  it("recorta, convierte lo vacío en null y los plazos en enteros; con `revision` la manda", () => {
    const b = { ...valido(), nombre: "  Textiles Delta Ltd.  ", codigo: " ", plazo_produccion_dias: "45", plazo_transito_dias: "", incoterm: "FOB", moneda: "USD" };
    const c = cuerpoProveedor(b, 7);
    expect(c).toMatchObject({ nombre: "Textiles Delta Ltd.", codigo: null, plazo_produccion_dias: 45, plazo_transito_dias: null, incoterm: "FOB", moneda: "USD", revision: 7 });
    expect(proveedorFichaSchema.safeParse(c).success).toBe(true);
    expect("revision" in cuerpoProveedor(b, null)).toBe(false);
  });

  it("de la ficha al borrador y de vuelta conserva todo (contactos incluidos)", () => {
    const f = fichaDeEjemplo();
    const b = borradorDeFicha(f);
    expect(b).toMatchObject({ nombre: "Textiles Delta Ltd.", pais: "China", region: "Zhejiang", plazo_produccion_dias: "45", plazo_transito_dias: "35", incoterm: "FOB" });
    const c = cuerpoProveedor(b, f.revision) as { contactos: { nombre: string; es_principal: boolean }[]; revision: number };
    expect(c.contactos.map((x) => [x.nombre, x.es_principal])).toEqual([
      ["Ana Prueba", false],
      ["Luis Prueba", true],
    ]);
    expect(c.revision).toBe(3);
  });
});

describe("validaciones visibles con el texto de la API", () => {
  it("Estados Unidos pide estado (aunque el resto esté bien) y con otro país la región es libre", () => {
    expect(validarBorrador({ ...valido(), pais: "Estados Unidos", region: "" }).region).toBe("Elige el estado de Estados Unidos.");
    expect(validarBorrador({ ...valido(), pais: "Estados Unidos", region: "Florida" })).toEqual({});
    expect(validarBorrador({ ...valido(), pais: "Estados Unidos", region: "Guangdong" }).region).toBeDefined();
    expect(validarBorrador({ ...valido(), pais: "Perú", region: "cualquier texto" })).toEqual({});
  });

  it("el error de estado de EE. UU. sale junto con otros (no hay que corregir uno para ver el siguiente)", () => {
    const e = validarBorrador({ ...borradorVacio(), pais: "Estados Unidos" });
    expect(Object.keys(e).sort()).toEqual(["nombre", "region"]);
  });

  it("el correo inválido se marca en la fila de su contacto, también si hay una fila en blanco antes", () => {
    const b = { ...valido(), contactos: [contactoVacio(), { ...contactoVacio(), nombre: "Ana", correo: "no-es-correo" }] };
    const e = validarBorrador(b);
    expect(e["contactos.1.correo"]).toBe("El correo no tiene un formato válido.");
  });

  it("una fila de contacto con datos pero sin nombre se marca; una fila en blanco se ignora", () => {
    expect(validarBorrador({ ...valido(), contactos: [{ ...contactoVacio(), telefono: "123" }] })["contactos.0.nombre"]).toBeDefined();
    expect(validarBorrador({ ...valido(), contactos: [contactoVacio()] })).toEqual({});
    expect((cuerpoProveedor({ ...valido(), contactos: [contactoVacio()] }, null) as { contactos: unknown[] }).contactos).toEqual([]);
  });

  it("los plazos fuera de rango o no enteros se rechazan", () => {
    expect(validarBorrador({ ...valido(), plazo_produccion_dias: "400" }).plazo_produccion_dias).toBeDefined();
    expect(validarBorrador({ ...valido(), plazo_transito_dias: "181" }).plazo_transito_dias).toBeDefined();
    expect(validarBorrador({ ...valido(), plazo_transito_dias: "2,5" }).plazo_transito_dias).toBeDefined();
    expect(validarBorrador({ ...valido(), plazo_produccion_dias: "0", plazo_transito_dias: "180" })).toEqual({});
  });

  it("a lo sumo un contacto principal: la radio marca a uno y desmarca a los demás", () => {
    const a = { ...contactoVacio(), nombre: "A", es_principal: true };
    const b = { ...contactoVacio(), nombre: "B" };
    const marcado = marcarPrincipal([a, b], b.clave);
    expect(marcado.map((c) => c.es_principal)).toEqual([false, true]);
    expect(validarBorrador({ ...valido(), contactos: marcado })).toEqual({});
    expect(validarBorrador({ ...valido(), contactos: [a, { ...b, es_principal: true }] }).contactos).toBeDefined();
  });

  it("más de 20 contactos se rechazan", () => {
    const veintiuno = Array.from({ length: 21 }, (_, i) => ({ ...contactoVacio(), nombre: `C${i}` }));
    expect(validarBorrador({ ...valido(), contactos: veintiuno }).contactos).toBeDefined();
  });
});

describe("lista: búsqueda y filtros", () => {
  const lista = [
    listado({ nombre: "Proveedor Norte", pais: "China", puerto_embarque: "Ningbo", completo: true }),
    listado({ nombre: "Feria Sur", activo: false, pais: "Perú" }),
    listado({ nombre: "Textiles Delta Ltd.", pais: "China", es_intercompany: true, contactos: [{ id: "c", nombre: "Ana Ñandú", cargo: null, telefono: null, correo: "ana@delta.test", es_principal: true }] }),
    listado({ nombre: "Hilados Andinos SAC", pais: "Perú" }),
  ];
  const nombres = (f: Partial<typeof FILTROS_INICIALES>) => filtrarProveedores(lista, { ...FILTROS_INICIALES, ...f }).map((p) => p.nombre);

  it("por defecto solo los activos", () => {
    expect(nombres({})).toEqual(["Proveedor Norte", "Textiles Delta Ltd.", "Hilados Andinos SAC"]);
    expect(nombres({ estado: "inactivos" })).toEqual(["Feria Sur"]);
    expect(nombres({ estado: "todos" })).toHaveLength(4);
  });
  it("busca sin tildes ni mayúsculas en nombre, puerto y contactos (nombre y correo)", () => {
    expect(nombres({ q: "TEXTILES" })).toEqual(["Textiles Delta Ltd."]);
    expect(nombres({ q: "ningbo" })).toEqual(["Proveedor Norte"]);
    expect(nombres({ q: "nandu" })).toEqual(["Textiles Delta Ltd."]);
    expect(nombres({ q: "ana@delta" })).toEqual(["Textiles Delta Ltd."]);
    expect(nombres({ q: "zzz" })).toEqual([]);
  });
  it("filtra por país y por intercompany, y se combinan", () => {
    expect(nombres({ pais: "Perú", estado: "todos" })).toEqual(["Feria Sur", "Hilados Andinos SAC"]);
    expect(nombres({ intercompany: true })).toEqual(["Textiles Delta Ltd."]);
    expect(nombres({ pais: "China", intercompany: true, q: "norte" })).toEqual([]);
  });
  it("los países del filtro salen sin repetir y ordenados", () => {
    expect(paisesDe(lista)).toEqual(["China", "Perú"]);
  });
  it("«Crear» solo se ofrece si no hay un nombre igual (sin tildes ni mayúsculas)", () => {
    expect(hayNombreIgual(lista, "feria sur")).toBe(true);
    expect(hayNombreIgual(lista, "  FERIA SUR ")).toBe(true);
    expect(hayNombreIgual(lista, "Feria")).toBe(false);
    expect(hayNombreIgual(lista, "")).toBe(false);
  });
});

describe("textos", () => {
  it("«Ficha incompleta» nombra lo que falta", () => {
    expect(textoFaltan(["pais", "contacto"])).toBe("Falta: país y contacto");
    expect(textoFaltan(["pais", "identificacion", "contacto"])).toBe("Falta: país, RUC / Tax ID y contacto");
    expect(textoFaltan(["direccion"])).toBe("Falta: dirección");
    expect(textoFaltan([])).toBe("");
  });
  it("del listado se deduce lo que falta; si solo puede ser la dirección, se dice", () => {
    expect(faltanDeListado(listado({ nombre: "A", pais: null, identificacion: "X", contactos: [], completo: false }))).toEqual(["pais", "contacto"]);
    expect(faltanDeListado(listado({ nombre: "A", pais: "China", identificacion: "X", contactos: [{ id: "c", nombre: "N", cargo: null, telefono: null, correo: null, es_principal: true }], completo: false }))).toEqual(["direccion"]);
    expect(faltanDeListado(listado({ nombre: "A", completo: true }))).toEqual([]);
  });
  it("ubicación: país y región, o raya", () => {
    expect(textoUbicacion({ pais: "China", region: "Zhejiang" })).toBe("China · Zhejiang");
    expect(textoUbicacion({ pais: "Perú", region: null })).toBe("Perú");
    expect(textoUbicacion({ pais: null, region: null })).toBe("—");
  });
  it("parecidos: «mismo nombre sin la razón social» o la similitud con coma decimal (0,83)", () => {
    expect(textoParecido({ id: "1", nombre: "Proveedor Norte Ltd.", similitud: 1, motivo: "misma_razon_social" })).toBe("Proveedor Norte Ltd. (mismo nombre sin la razón social)");
    expect(textoParecido({ id: "2", nombre: "Textiles Delta Ltd.", similitud: 0.83, motivo: "similar" })).toBe("Textiles Delta Ltd. (0,83)");
  });
  it("la ayuda de plazos suma producción y tránsito: 45 + 35 = 80 días", () => {
    expect(ayudaPlazos("45", "35")).toBe("Llegada estimada ≈ fecha de compra + 80 días.");
    expect(ayudaPlazos("1", "")).toBe("Llegada estimada ≈ fecha de compra + 1 día.");
    expect(ayudaPlazos("", "")).toMatch(/Con los dos plazos/);
    expect(ayudaPlazos("abc", "")).toMatch(/Con los dos plazos/);
  });
  it("eliminar dice «eliminado» o «tenía compras: quedó desactivado»", () => {
    expect(textoRespuestaEliminar("borrado", "Feria Sur")).toBe("«Feria Sur» eliminado.");
    expect(textoRespuestaEliminar("desactivado", "Feria Sur")).toMatch(/tenía compras: quedó desactivado/);
  });
  it("el resumen de compras por moneda", () => {
    expect(textoResumen({ compras: 0, ultima_compra: null, unidades: 0, costo: { USD: 0, PEN: 0 } })).toBe("Sin compras");
    expect(textoResumen({ compras: 2, ultima_compra: "2026-10-01", unidades: 1200, costo: { USD: 5000, PEN: 0 } })).toMatch(/^2 compras · 1200 u · US\$ 5/);
    expect(textoResumen({ compras: 1, ultima_compra: null, unidades: 10, costo: { USD: 0, PEN: 0 } })).toMatch(/1 compra · 10 u · sin costo registrado/);
  });
  it("«Ver sus compras» abre el filtro `proveedor` de /compras/registro", () => {
    expect(hrefComprasDeProveedor("abc-1")).toBe("/compras/registro?proveedor=abc-1&viaje=todos");
  });
});

describe("Excel de proveedores (R26)", () => {
  it("la hoja trae una fila por proveedor con contacto principal y sin datos bancarios ni claves internas", () => {
    const f = fichaDeEjemplo();
    const hoja = hojaProveedores([f]);
    expect(hoja[0]).toContain("Contacto principal");
    expect(hoja[0].join("|")).not.toMatch(/banco|cuenta|clave_origen|revision/i);
    expect(hoja[1]).toEqual(["Textiles Delta Ltd.", null, "TAX-0001", "China", "Zhejiang", "Ningbo", "Ningbo", "FOB", "USD", "No", "Activo", 2, "Luis Prueba", null, null, "Completa"]);
  });
  it("un nombre como «=HYPERLINK(…)» o «+1» viaja como texto (SheetJS lo escribe como celda de texto, no como fórmula)", async () => {
    const XLSX = await import("xlsx");
    const hoja = hojaProveedores([listado({ nombre: "=HYPERLINK(\"http://x\")", codigo: "+1" })]);
    const ws = XLSX.utils.aoa_to_sheet(hoja);
    expect(ws.A2.t).toBe("s");
    expect(ws.A2.f).toBeUndefined();
    expect(ws.B2.t).toBe("s");
    expect(ws.B2.f).toBeUndefined();
  });
});
