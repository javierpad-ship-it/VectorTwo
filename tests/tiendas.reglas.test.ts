import { describe, expect, it } from "vitest";
import {
  MENSAJE_CIERRE_ANTES_DE_APERTURA,
  MENSAJE_CIERRE_SIN_APERTURA,
  MENSAJE_VENTA_EN_CD,
  MENSAJE_VENTA_NEGATIVA,
  motivoRechazoEliminar,
  motivoRechazoTienda,
} from "@/lib/tiendas/reglas";

describe("motivoRechazoTienda (regla 4)", () => {
  it("cierre sin apertura", () => {
    expect(motivoRechazoTienda({ tipo: "Tienda", fecha_apertura: null, fecha_cierre: "2026-12-31" })).toEqual({
      mensaje: MENSAJE_CIERRE_SIN_APERTURA,
      path: ["fecha_cierre"],
    });
    expect(motivoRechazoTienda({ fecha_cierre: "2026-12-31" })?.mensaje).toBe(MENSAJE_CIERRE_SIN_APERTURA);
  });
  it("cierre anterior a la apertura; cierre = apertura permitido", () => {
    expect(motivoRechazoTienda({ fecha_apertura: "2026-10-05", fecha_cierre: "2026-10-04" })).toEqual({
      mensaje: MENSAJE_CIERRE_ANTES_DE_APERTURA,
      path: ["fecha_cierre"],
    });
    expect(motivoRechazoTienda({ fecha_apertura: "2026-10-05", fecha_cierre: "2026-10-05" })).toBeNull();
  });
  it("CD con venta esperada; venta negativa", () => {
    expect(motivoRechazoTienda({ tipo: "Centro de Distribución", venta_esperada_promedio: 1000 })).toEqual({
      mensaje: MENSAJE_VENTA_EN_CD,
      path: ["venta_esperada_promedio"],
    });
    expect(motivoRechazoTienda({ tipo: "Centro de Distribución", venta_esperada_promedio: 0 })?.mensaje).toBe(
      MENSAJE_VENTA_EN_CD
    );
    expect(motivoRechazoTienda({ tipo: "Centro de Distribución", venta_esperada_promedio: null })).toBeNull();
    expect(motivoRechazoTienda({ tipo: "Tienda", venta_esperada_promedio: -5 })).toEqual({
      mensaje: MENSAJE_VENTA_NEGATIVA,
      path: ["venta_esperada_promedio"],
    });
  });
  it("fila coherente → null; un PATCH que solo cambia nombre sobre una fila coherente nunca se rechaza", () => {
    const actual = {
      tipo: "Tienda",
      fecha_apertura: "2019-03-15",
      fecha_cierre: null,
      venta_esperada_promedio: null,
    };
    expect(motivoRechazoTienda(actual)).toBeNull();
    expect(motivoRechazoTienda({ ...actual, nombre: "OTRO" } as typeof actual)).toBeNull();
    expect(motivoRechazoTienda({ ...actual, fecha_cierre: "2026-12-31", venta_esperada_promedio: 85000 })).toBeNull();
  });
  it("actual más cambio: cambiar a CD con venta en la fila se rechaza; mandando venta null en el mismo PATCH pasa", () => {
    const actual = { tipo: "Tienda", fecha_apertura: null, fecha_cierre: null, venta_esperada_promedio: 85000 };
    expect(motivoRechazoTienda({ ...actual, tipo: "Centro de Distribución" })?.mensaje).toBe(MENSAJE_VENTA_EN_CD);
    expect(motivoRechazoTienda({ ...actual, tipo: "Centro de Distribución", venta_esperada_promedio: null })).toBeNull();
    // PATCH con fecha_cierre sobre una tienda sin apertura.
    expect(motivoRechazoTienda({ ...actual, fecha_cierre: "2026-12-31" })?.mensaje).toBe(MENSAJE_CIERRE_SIN_APERTURA);
  });
});

describe("motivoRechazoEliminar('tienda') (regla 5)", () => {
  it("sin hijos → null; con 3 → mensaje con el conteo", () => {
    expect(motivoRechazoEliminar("tienda", 0)).toBeNull();
    expect(motivoRechazoEliminar("tienda", 3)).toBe(
      "No se puede eliminar la tienda: tiene 3 registros de venta o stock. Desactívala."
    );
    expect(motivoRechazoEliminar("tienda", 1)).toBe(
      "No se puede eliminar la tienda: tiene 1 registro de venta o stock. Desactívala."
    );
  });
});
