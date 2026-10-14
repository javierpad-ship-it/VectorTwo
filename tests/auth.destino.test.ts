import { describe, expect, it } from "vitest";
import { destinoSeguro } from "@/lib/auth/destino";

describe("destinoSeguro (M-1: open redirect del login)", () => {
  it("acepta rutas internas, con query y hash", () => {
    expect(destinoSeguro("/planificacion")).toBe("/planificacion");
    expect(destinoSeguro("/maestros/tiendas?x=1#a")).toBe("/maestros/tiendas?x=1#a");
    expect(destinoSeguro("/")).toBe("/");
  });

  it("rechaza URL con otro host", () => {
    expect(destinoSeguro("//evil.com")).toBe("/");
    expect(destinoSeguro("///evil.com")).toBe("/");
    expect(destinoSeguro("/\\evil.com")).toBe("/");
    expect(destinoSeguro("https://x")).toBe("/");
    expect(destinoSeguro("http://x/planificacion")).toBe("/");
    expect(destinoSeguro("javascript:alert(1)")).toBe("/");
    expect(destinoSeguro("evil.com")).toBe("/");
  });

  it("rechaza tabuladores y saltos de línea que el navegador elimina (/<TAB>/host => //host)", () => {
    expect(destinoSeguro("/\t/evil.com")).toBe("/");
    expect(destinoSeguro("/\n/evil.com")).toBe("/");
    expect(destinoSeguro("/\r/evil.com")).toBe("/");
  });

  it("vacío, ausente o nulo cae en la raíz", () => {
    expect(destinoSeguro("")).toBe("/");
    expect(destinoSeguro(null)).toBe("/");
    expect(destinoSeguro(undefined)).toBe("/");
  });
});
