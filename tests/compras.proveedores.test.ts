import { describe, expect, it } from "vitest";
import { proveedorSchema } from "@/lib/compras/esquemas";
import {
  MAX_CONTACTOS_PROVEEDOR,
  accionEliminarProveedor,
  buscarProveedor,
  claveProveedor,
  motivoRechazoProveedor,
  puedeRecibirCompras,
  type ProveedorRegistro,
} from "@/lib/compras/proveedores";
import { PROVEEDOR } from "./compras.fixture";

/** Regla 19 de la ficha 08: proveedores. */

const existentes: ProveedorRegistro[] = [
  { id: PROVEEDOR.norte, nombre: "Proveedor Norte", codigo: "PN", activo: true },
  { id: PROVEEDOR.feria, nombre: "Feria Sur", codigo: null, activo: false },
];

describe("nombre único sobre upper (regla 19)", () => {
  it("«proveedor norte» repetido se rechaza sin mirar mayúsculas ni espacios de los bordes", () => {
    const r = motivoRechazoProveedor({ nombre: "  proveedor norte " }, existentes);
    expect(r).toMatchObject({ motivo: "nombre_repetido", conflicto: { id: PROVEEDOR.norte } });
    expect(r?.mensaje).toBe("Ya existe un proveedor con el nombre «Proveedor Norte».");
  });

  it("también cuenta un proveedor desactivado (la base lo impide igual)", () => {
    expect(motivoRechazoProveedor({ nombre: "FERIA SUR" }, existentes)?.motivo).toBe("nombre_repetido");
  });

  it("al editar, el propio proveedor no cuenta", () => {
    expect(motivoRechazoProveedor({ nombre: "Proveedor Norte" }, existentes, { propioId: PROVEEDOR.norte })).toBeNull();
    expect(motivoRechazoProveedor({ nombre: "Feria Sur" }, existentes, { propioId: PROVEEDOR.norte })?.motivo).toBe("nombre_repetido");
  });

  it("un nombre nuevo pasa; uno vacío o muy largo no", () => {
    expect(motivoRechazoProveedor({ nombre: "Taller Este" }, existentes)).toBeNull();
    expect(motivoRechazoProveedor({ nombre: "   " }, existentes)?.motivo).toBe("nombre_vacio");
    expect(motivoRechazoProveedor({ nombre: "x".repeat(121) }, existentes)?.motivo).toBe("nombre_largo");
  });

  it("el código es único sobre upper cuando existe", () => {
    expect(motivoRechazoProveedor({ nombre: "Taller Este", codigo: "pn" }, existentes)?.motivo).toBe("codigo_repetido");
    expect(motivoRechazoProveedor({ nombre: "Taller Este", codigo: " " }, existentes)).toBeNull();
    expect(motivoRechazoProveedor({ nombre: "Taller Este", codigo: null }, existentes)).toBeNull();
  });

  it("los contactos son hasta 20 (M9a)", () => {
    expect(motivoRechazoProveedor({ nombre: "Taller Este" }, existentes, { contactos: MAX_CONTACTOS_PROVEEDOR })).toBeNull();
    expect(motivoRechazoProveedor({ nombre: "Taller Este" }, existentes, { contactos: MAX_CONTACTOS_PROVEEDOR + 1 })?.motivo).toBe("contactos_demasiados");
  });
});

describe("desactivar en vez de borrar", () => {
  it("con compras de cualquier estado se desactiva; sin ellas se borra", () => {
    expect(accionEliminarProveedor(3)).toBe("desactivar");
    expect(accionEliminarProveedor(1)).toBe("desactivar");
    expect(accionEliminarProveedor(0)).toBe("borrar");
  });

  it("un proveedor inactivo no recibe compras", () => {
    expect(puedeRecibirCompras({ activo: true })).toBe(true);
    expect(puedeRecibirCompras({ activo: false })).toBe(false);
  });
});

describe("búsqueda por nombre", () => {
  it("claveProveedor y buscarProveedor", () => {
    expect(claveProveedor("  Feria Sur ")).toBe("FERIA SUR");
    expect(buscarProveedor("feria sur", existentes)?.id).toBe(PROVEEDOR.feria);
    expect(buscarProveedor("Otro", existentes)).toBeNull();
    expect(buscarProveedor("  ", existentes)).toBeNull();
  });
});

describe("sin datos bancarios (regla 19)", () => {
  it("el esquema rechaza banco, cuenta_bancaria y cualquier clave desconocida con un 400 en castellano", () => {
    const r = proveedorSchema.safeParse({ nombre: "Taller Este", banco: "Banco X", cuenta_bancaria: "123" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toMatch(/no admite datos bancarios/);
    expect(proveedorSchema.safeParse({ nombre: "Taller Este", pais: "Perú", es_intercompany: false }).success).toBe(true);
  });
});
