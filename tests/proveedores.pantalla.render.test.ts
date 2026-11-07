import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CamposPaisRegion } from "../src/components/proveedores/campos-pais-region";
import { Contactos } from "../src/components/proveedores/contactos";
import { FormularioProveedor } from "../src/components/proveedores/formulario-proveedor";
import { SelectorProveedor } from "../src/components/proveedores/selector-proveedor";
import { contactoVacio } from "../src/components/proveedores/vista-proveedores";
import { PAISES } from "../src/lib/proveedores/paises";
import { ESTADOS_EEUU } from "../src/lib/proveedores/regiones";
import { fichaDeEjemplo } from "./proveedores.pantalla.fixture";

/** Humo de render de las piezas de Proveedores (08c, §4.2): textos clave, permisos por rol y accesibilidad básica. */

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const noop = () => {};
const props = { puertosSugeridos: ["Ningbo", "Shenzhen"], onCerrar: noop, onGuardado: noop, onAbrirExistente: noop };

describe("formulario de proveedor", () => {
  it("alta: título, tres bloques, «+ Agregar contacto» y el botón «Crear proveedor» asociado al formulario", () => {
    const h = html(createElement(FormularioProveedor, { ...props, ficha: null, puedeIntercompany: true }));
    for (const t of ["Nuevo proveedor", "Empresa", "Importación", "Contactos", "Nombre *", "País *", "RUC / Tax ID", "Puerto de embarque habitual", "Incoterm habitual", "Moneda habitual", "Plazo de producción (días)", "Plazo de tránsito (días)", "Condiciones de pago", "+ Agregar contacto", "Crear proveedor", "Cancelar"]) expect(h, t).toContain(t);
    expect(h).toMatch(/<button[^>]*type="submit"[^>]*form="/);
    expect(h).toContain("<datalist");
    expect(h).toContain('value="Ningbo"');
    expect(h).toContain("Solo informativo");
  });

  it("el comprador ve la casilla intercompany deshabilitada con la nota «La marca el planner»; el planner la puede usar", () => {
    const comprador = html(createElement(FormularioProveedor, { ...props, ficha: null, puedeIntercompany: false }));
    expect(comprador).toMatch(/<input[^>]*type="checkbox"[^>]*\sdisabled=""/);
    expect(comprador).toContain("La marca el planner.");
    const planner = html(createElement(FormularioProveedor, { ...props, ficha: null, puedeIntercompany: true }));
    expect(planner).not.toMatch(/<input[^>]*type="checkbox"[^>]*\sdisabled=""/);
    expect(planner).not.toContain("La marca el planner.");
  });

  it("edición: llega con los datos de la ficha y sus contactos, con el radio de principal marcado", () => {
    const h = html(createElement(FormularioProveedor, { ...props, ficha: fichaDeEjemplo(), puedeIntercompany: false }));
    for (const t of ["Editar «Textiles Delta Ltd.»", 'value="Textiles Delta Ltd."', 'value="TAX-0001"', "Zhejiang", "Ana Prueba", "Luis Prueba", "ana@ejemplo.com", "Guardar cambios", "Contacto 2", "Llegada estimada ≈ fecha de compra + 80 días."]) expect(h, t).toContain(t);
    expect(h.match(/type="radio"/g)).toHaveLength(2);
    expect(h).toMatch(/type="radio"[^>]*checked/);
  });
});

describe("país y región", () => {
  const base = { pais: "", region: "", onCambiar: noop };

  it("la lista de países sale de PAISES", () => {
    const h = html(createElement(CamposPaisRegion, base));
    for (const p of ["Perú", "China", "Estados Unidos"]) expect(h, p).toContain(`>${p}</option>`);
    expect((h.match(/<option/g) ?? []).length).toBe(PAISES.length + 1);
    expect(h).toContain("Estado o provincia");
    expect(h).toMatch(/<input[^>]*placeholder="Guangdong/);
  });

  it("con Estados Unidos la región es una lista de estados obligatoria", () => {
    const h = html(createElement(CamposPaisRegion, { ...base, pais: "Estados Unidos" }));
    expect(h).toContain("Estado *");
    expect(h).toContain(">Florida</option>");
    expect((h.match(/<option/g) ?? []).length).toBe(PAISES.length + 1 + ESTADOS_EEUU.length + 1);
  });

  it("muestra el error de cada campo con aria-invalid", () => {
    const h = html(createElement(CamposPaisRegion, { ...base, pais: "Estados Unidos", errorPais: "Elige un país de la lista.", errorRegion: "Elige el estado de Estados Unidos." }));
    expect(h).toContain("Elige el estado de Estados Unidos.");
    expect(h).toContain('aria-invalid="true"');
  });
});

describe("contactos", () => {
  it("sin contactos explica qué cuenta como ficha completa y ofrece agregar", () => {
    const h = html(createElement(Contactos, { contactos: [], errores: {}, onCambiar: noop }));
    expect(h).toContain("Sin contactos todavía");
    expect(h).toContain("+ Agregar contacto");
  });

  it("cada contacto lleva nombre*, cargo, teléfono, correo, «Principal» y «Quitar»; los errores caen en su fila", () => {
    const c = { ...contactoVacio(), nombre: "Ana", correo: "mal" };
    const h = html(createElement(Contactos, { contactos: [c], errores: { "contactos.0.correo": "El correo no tiene un formato válido." }, onCambiar: noop }));
    for (const t of ["Contacto 1", "Nombre *", "Cargo", "Teléfono", "Correo", "Principal", "Quitar contacto 1", "El correo no tiene un formato válido."]) expect(h, t).toContain(t);
  });

  it("con 20 contactos no deja agregar más", () => {
    const veinte = Array.from({ length: 20 }, (_, i) => ({ ...contactoVacio(), nombre: `C${i}` }));
    const h = html(createElement(Contactos, { contactos: veinte, errores: {}, onCambiar: noop }));
    expect(h).toMatch(/<button[^>]*\sdisabled=""[^>]*>\+ Agregar contacto/);
    expect(h).toContain("Máximo 20 contactos por proveedor.");
  });
});

describe("selector de proveedor (alta al vuelo)", () => {
  const proveedores = [
    { id: "1", nombre: "Proveedor Norte" },
    { id: "2", nombre: "Feria Sur" },
  ];

  it("es un combobox accesible con la etiqueta y el proveedor elegido", () => {
    const h = html(createElement(SelectorProveedor, { proveedores, valor: "2", onElegir: noop }));
    expect(h).toContain('role="combobox"');
    expect(h).toContain('aria-expanded="false"');
    expect(h).toContain("Proveedor");
    expect(h).toContain('value="Feria Sur"');
  });

  it("deshabilitado no se puede usar", () => {
    expect(html(createElement(SelectorProveedor, { proveedores, valor: null, onElegir: noop, deshabilitado: true }))).toMatch(/<input[^>]*disabled/);
  });
});
