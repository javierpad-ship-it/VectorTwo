import { describe, expect, it } from "vitest";
import { activoProveedorSchema, proveedorCreacionSchema, proveedorEdicionSchema, proveedorFichaSchema, proveedoresQuerySchema } from "@/lib/proveedores/esquemas";
import { PAISES } from "@/lib/proveedores/paises";
import { ESTADOS_EEUU } from "@/lib/proveedores/regiones";
import { FICHA_VALIDA } from "./proveedores.fixture";

const primerMensaje = (r: { success: boolean; error?: { issues: { message: string }[] } }) => r.error?.issues[0]?.message ?? "";

describe("proveedorFichaSchema", () => {
  it("acepta la ficha válida y normaliza vacíos a null", () => {
    const r = proveedorFichaSchema.parse({ ...FICHA_VALIDA, codigo: "  ", direccion: "", nota: undefined });
    expect(r.nombre).toBe("Feria Norte");
    expect(r.codigo).toBeNull();
    expect(r.direccion).toBeNull();
    expect(r.nota).toBeNull();
    expect(r.es_intercompany).toBeUndefined();
  });

  it("nombre y país son obligatorios; el nombre se recorta", () => {
    expect(proveedorFichaSchema.safeParse({ pais: "China" }).success).toBe(false);
    expect(proveedorFichaSchema.safeParse({ nombre: "X" }).success).toBe(false);
    expect(proveedorFichaSchema.parse({ nombre: "  Feria Sur  ", pais: "China" }).nombre).toBe("Feria Sur");
    expect(proveedorFichaSchema.safeParse({ nombre: "   ", pais: "China" }).success).toBe(false);
  });

  it("R14 · el país sale de PAISES y con Estados Unidos la región sale de la lista de estados", () => {
    expect(PAISES).toContain("Estados Unidos");
    expect(proveedorFichaSchema.safeParse({ nombre: "A", pais: "Narnia" }).success).toBe(false);
    expect(proveedorFichaSchema.safeParse({ nombre: "A", pais: "Estados Unidos" }).success).toBe(false);
    expect(proveedorFichaSchema.safeParse({ nombre: "A", pais: "Estados Unidos", region: "Zhejiang" }).success).toBe(false);
    expect(proveedorFichaSchema.safeParse({ nombre: "A", pais: "Estados Unidos", region: ESTADOS_EEUU[0] }).success).toBe(true);
    expect(proveedorFichaSchema.safeParse({ nombre: "A", pais: "China", region: "Cualquier provincia" }).success).toBe(true);
  });

  it("R17 · cualquier clave de banco o de origen da 400 con un mensaje claro", () => {
    for (const clave of ["banco", "cuenta", "bank_name", "bank_account", "clave_origen"]) {
      const r = proveedorFichaSchema.safeParse({ ...FICHA_VALIDA, [clave]: "x" });
      expect(r.success, clave).toBe(false);
      expect(primerMensaje(r)).toMatch(/datos bancarios/);
    }
  });

  it("valida incoterm, moneda y plazos", () => {
    expect(proveedorFichaSchema.safeParse({ ...FICHA_VALIDA, incoterm: "XYZ" }).success).toBe(false);
    expect(proveedorFichaSchema.safeParse({ ...FICHA_VALIDA, moneda: "EUR" }).success).toBe(false);
    expect(proveedorFichaSchema.safeParse({ ...FICHA_VALIDA, plazo_produccion_dias: 366 }).success).toBe(false);
    expect(proveedorFichaSchema.safeParse({ ...FICHA_VALIDA, plazo_transito_dias: 181 }).success).toBe(false);
    expect(proveedorFichaSchema.safeParse({ ...FICHA_VALIDA, plazo_transito_dias: -1 }).success).toBe(false);
    expect(proveedorFichaSchema.safeParse({ ...FICHA_VALIDA, plazo_transito_dias: 12.5 }).success).toBe(false);
    expect(proveedorFichaSchema.safeParse({ ...FICHA_VALIDA, plazo_transito_dias: 180, plazo_produccion_dias: 0, incoterm: null, moneda: null }).success).toBe(true);
  });

  it("R13 · contactos: hasta 20, un solo principal, correo válido", () => {
    const c = (n: number, extra: Record<string, unknown> = {}) => ({ nombre: `Contacto ${n}`, ...extra });
    expect(proveedorFichaSchema.safeParse({ ...FICHA_VALIDA, contactos: Array.from({ length: 20 }, (_, i) => c(i)) }).success).toBe(true);
    expect(proveedorFichaSchema.safeParse({ ...FICHA_VALIDA, contactos: Array.from({ length: 21 }, (_, i) => c(i)) }).success).toBe(false);
    expect(proveedorFichaSchema.safeParse({ ...FICHA_VALIDA, contactos: [c(1, { es_principal: true }), c(2, { es_principal: true })] }).success).toBe(false);
    expect(primerMensaje(proveedorFichaSchema.safeParse({ ...FICHA_VALIDA, contactos: [c(1, { correo: "sin-arroba" })] }))).toMatch(/correo/);
    expect(proveedorFichaSchema.safeParse({ ...FICHA_VALIDA, contactos: [{ nombre: "" }] }).success).toBe(false);
    const ok = proveedorFichaSchema.parse({ ...FICHA_VALIDA, contactos: [c(1, { correo: "", telefono: "" })] });
    expect(ok.contactos?.[0]).toMatchObject({ correo: null, telefono: null, es_principal: false });
  });

  it("contactos ausente se distingue de lista vacía (editar conserva o vacía)", () => {
    expect(proveedorFichaSchema.parse({ nombre: "A", pais: "China" }).contactos).toBeUndefined();
    expect(proveedorFichaSchema.parse({ nombre: "A", pais: "China", contactos: [] }).contactos).toEqual([]);
  });
});

describe("proveedorEdicionSchema", () => {
  it("exige la revisión (entero ≥ 0)", () => {
    expect(proveedorEdicionSchema.safeParse({ nombre: "A", pais: "China" }).success).toBe(false);
    expect(proveedorEdicionSchema.safeParse({ nombre: "A", pais: "China", revision: -1 }).success).toBe(false);
    expect(proveedorEdicionSchema.parse({ nombre: "A", pais: "China", revision: 0 }).revision).toBe(0);
  });
});

describe("proveedorCreacionSchema", () => {
  it("sin modo se toma como ficha; con modo rapido solo pide el nombre", () => {
    const f = proveedorCreacionSchema.parse({ ...FICHA_VALIDA });
    expect(f.modo).toBe("ficha");
    const r = proveedorCreacionSchema.parse({ modo: "rapido", nombre: " Feria Sur " });
    expect(r).toEqual({ modo: "rapido", nombre: "Feria Sur", pais: null });
    expect(proveedorCreacionSchema.parse({ modo: "rapido", nombre: "A", pais: "Perú", confirmar_parecido: true })).toMatchObject({ pais: "Perú", confirmar_parecido: true });
  });

  it("el modo rápido es estricto y la ficha mantiene sus reglas", () => {
    expect(proveedorCreacionSchema.safeParse({ modo: "rapido", nombre: "A", banco: "x" }).success).toBe(false);
    expect(proveedorCreacionSchema.safeParse({ modo: "rapido" }).success).toBe(false);
    expect(proveedorCreacionSchema.safeParse({ modo: "ficha", nombre: "A" }).success).toBe(false);
    expect(proveedorCreacionSchema.safeParse({ modo: "otro", nombre: "A" }).success).toBe(false);
    expect(proveedorCreacionSchema.safeParse("texto").success).toBe(false);
    expect(proveedorCreacionSchema.safeParse(null).success).toBe(false);
  });
});

describe("otros esquemas de proveedores", () => {
  it("activo es booleano y estricto", () => {
    expect(activoProveedorSchema.parse({ activo: false })).toEqual({ activo: false });
    expect(activoProveedorSchema.safeParse({ activo: "no" }).success).toBe(false);
    expect(activoProveedorSchema.safeParse({ activo: true, otro: 1 }).success).toBe(false);
  });

  it("la consulta admite activos=1 y q", () => {
    expect(proveedoresQuerySchema.parse({ activos: "1", q: " sur " })).toEqual({ activos: "1", q: "sur" });
    expect(proveedoresQuerySchema.safeParse({ activos: "0" }).success).toBe(false);
  });
});
