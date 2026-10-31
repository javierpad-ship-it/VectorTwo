import { beforeEach, describe, expect, it, vi } from "vitest";
import { clienteIaFalso, reiniciar, sembrar } from "./ia.fake-db";

vi.mock("server-only", () => ({}));

import { leerTerminosPrivados } from "@/lib/ia/consultas";
import { crearAliasador } from "@/lib/ia/alias";

/** Términos privados (QA/seguridad): marcas (nombre y código), tiendas (nombre, código, razón social y zona) y los términos extra. Todo sintético. */

beforeEach(() => reiniciar());

describe("leerTerminosPrivados", () => {
  it("incluye el código de la marca y la razón social y la zona de la tienda", async () => {
    sembrar("marcas", [{ id: "m-1", nombre: "MARCAX", codigo: "MX77" }]);
    sembrar("tiendas", [{ id: "t-1", nombre: "Tienda Uno", codigo: "Z901", razon_social: "Comercial Ejemplo SAC", zona: "Costa Norte" }]);
    const r = await leerTerminosPrivados(clienteIaFalso() as never, ["Grupo Ejemplo"]);
    expect(r.error).toBeNull();
    const textos = r.data.map((t) => [t.texto, t.tipo]);
    expect(textos).toEqual(
      expect.arrayContaining([
        ["MARCAX", "marca"],
        ["MX77", "marca"],
        ["Tienda Uno", "tienda"],
        ["Z901", "tienda"],
        ["Comercial Ejemplo SAC", "tienda"],
        ["Costa Norte", "tienda"],
        ["Grupo Ejemplo", "termino"],
      ])
    );
    // Los nulos o vacíos no generan términos.
    sembrar("tiendas", [{ id: "t-2", nombre: "Tienda Dos", codigo: "Z902", razon_social: null, zona: "  " }]);
    const r2 = await leerTerminosPrivados(clienteIaFalso() as never, []);
    expect(r2.data.filter((t) => t.texto.trim() === "" || t.texto === "null")).toEqual([]);
  });

  it("el aliasador oculta cada uno de esos nombres en un texto que viaja", async () => {
    sembrar("marcas", [{ id: "m-1", nombre: "MARCAX", codigo: "MX77" }]);
    sembrar("tiendas", [{ id: "t-1", nombre: "Tienda Uno", codigo: "Z901", razon_social: "Comercial Ejemplo SAC", zona: "Costa Norte" }]);
    const { data } = await leerTerminosPrivados(clienteIaFalso() as never, ["Grupo Ejemplo"]);
    const alias = crearAliasador(data);
    const salida = alias.aplicar("Polo MX77 de Comercial Ejemplo SAC en Costa Norte por Grupo Ejemplo");
    for (const real of ["MX77", "Comercial Ejemplo SAC", "Costa Norte", "Grupo Ejemplo"]) expect(salida).not.toContain(real);
    expect(alias.contiene(salida)).toBe(false);
  });
});
