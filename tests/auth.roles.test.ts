import { describe, expect, it } from "vitest";
import { DESCRIPCION_ROL, ROLES } from "@/lib/auth/roles";

describe("DESCRIPCION_ROL", () => {
  it("tiene un texto por rol", () => {
    for (const rol of ROLES) expect(DESCRIPCION_ROL[rol].trim()).not.toBe("");
  });

  it("el comprador ya no se describe como solo lectura: consulta, registra y edita compras, viajes, embarques y paquetes, e importa en borrador", () => {
    const t = DESCRIPCION_ROL.comprador;
    expect(t).not.toMatch(/solo lectura/i);
    for (const palabra of ["venta", "stock", "compras", "viajes", "embarques", "paquetes", "borrador"]) expect(t).toContain(palabra);
  });
});
