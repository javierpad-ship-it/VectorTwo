import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const leer = (...partes: string[]) => readFileSync(path.resolve(__dirname, "..", ...partes), "utf8");

describe("08c · el listado de proveedores no lee todo en cada llamada (QA 4)", () => {
  const consultas = leer("src", "lib", "proveedores", "consultas.ts");
  const servicio = leer("src", "lib", "proveedores", "servicio.ts");

  it("los contactos y la cuenta de compras no canceladas van embebidos en la consulta de proveedores", () => {
    expect(consultas).toContain("compras(count)");
    expect(consultas).toContain("proveedor_contactos(");
    expect(consultas).toContain('.neq("compras.estado", "cancelada")');
  });

  it("listarProveedores usa esa consulta y ya no lee todas las compras ni todos los contactos", () => {
    const cuerpo = servicio.slice(servicio.indexOf("export async function listarProveedores"), servicio.indexOf("async function fichaDe"));
    expect(cuerpo).toContain("leerProveedoresConAgregados");
    expect(cuerpo).not.toMatch(/leerComprasPorProveedor|leerContactos\(|leerDatosCompras/);
  });
});
