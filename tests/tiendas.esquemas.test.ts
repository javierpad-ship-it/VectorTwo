import { describe, expect, it } from "vitest";
import {
  MENSAJE_CODIGO_OBLIGATORIO,
  MENSAJE_FECHA,
  crearTiendaSchema,
  editarTiendaSchema,
  filaImportacionTiendaSchema,
  filtrosAperturasSchema,
  filtrosTiendasSchema,
  importarTiendasSchema,
} from "@/lib/tiendas/esquemas";
import { MENSAJE_CIERRE_ANTES_DE_APERTURA, MENSAJE_CIERRE_SIN_APERTURA, MENSAJE_VENTA_EN_CD } from "@/lib/tiendas/reglas";

const primerError = (r: { success: boolean; error?: { issues: { message: string; path: PropertyKey[] }[] } }) =>
  r.success ? null : r.error!.issues[0];

describe("crearTiendaSchema · código (regla 6)", () => {
  it("sin código → 'El código es obligatorio'; nunca se deriva del nombre", () => {
    const r = crearTiendaSchema.safeParse({ nombre: "Lukers Iquitos" });
    expect(r.success).toBe(false);
    expect(primerError(r)?.message).toMatch(/El código es obligatorio/);
    expect(primerError(r)?.path).toEqual(["codigo"]);
  });
  it("r-401 → R_401; r401 → R401; '---' → error", () => {
    expect(crearTiendaSchema.parse({ codigo: "r-401", nombre: "X" }).codigo).toBe("R_401");
    expect(crearTiendaSchema.parse({ codigo: " r401 ", nombre: "X" }).codigo).toBe("R401");
    const r = crearTiendaSchema.safeParse({ codigo: "---", nombre: "X" });
    expect(primerError(r)?.message).toBe(MENSAJE_CODIGO_OBLIGATORIO);
  });
  it("dos cuerpos con el mismo nombre y códigos distintos pasan los dos (el nombre no propone código)", () => {
    const a = crearTiendaSchema.parse({ codigo: "R401", nombre: "Lukers Iquitos Lores" });
    const b = crearTiendaSchema.parse({ codigo: "R999", nombre: "Lukers Iquitos Lores" });
    expect(a.codigo).toBe("R401");
    expect(b.codigo).toBe("R999");
    expect(a.nombre).toBe(b.nombre);
  });
});

describe("crearTiendaSchema (regla 19)", () => {
  it("normaliza nombre, zona y razón social; vacíos → null; tipo Tienda por defecto; fechas y venta null", () => {
    expect(
      crearTiendaSchema.parse({
        codigo: "r401",
        nombre: "  lukers iquitos lores ",
        zona: " lukers sur oriente ",
        razon_social: "",
      })
    ).toEqual({
      codigo: "R401",
      nombre: "LUKERS IQUITOS LORES",
      tipo: "Tienda",
      zona: "LUKERS SUR ORIENTE",
      razon_social: null,
      fecha_apertura: null,
      fecha_cierre: null,
      venta_esperada_promedio: null,
    });
    expect(crearTiendaSchema.parse({ codigo: "X", nombre: "X", zona: null, razon_social: "   " }).zona).toBeNull();
    expect(crearTiendaSchema.parse({ codigo: "X", nombre: "Prolongación Iquitos" }).nombre).toBe("PROLONGACIÓN IQUITOS");
  });
  it("acepta fechas solo como aaaa-mm-dd; '15/03/2019' → error", () => {
    expect(crearTiendaSchema.parse({ codigo: "X", nombre: "X", fecha_apertura: "2019-03-15" }).fecha_apertura).toBe(
      "2019-03-15"
    );
    const r = crearTiendaSchema.safeParse({ codigo: "X", nombre: "X", fecha_apertura: "15/03/2019" });
    expect(primerError(r)?.message).toBe(MENSAJE_FECHA);
    expect(primerError(r)?.path).toEqual(["fecha_apertura"]);
    expect(crearTiendaSchema.safeParse({ codigo: "X", nombre: "X", fecha_apertura: "2024-02-30" }).success).toBe(false);
  });
  it("rechaza venta negativa y venta que no sea número", () => {
    expect(crearTiendaSchema.safeParse({ codigo: "X", nombre: "X", venta_esperada_promedio: -1 }).success).toBe(false);
    expect(crearTiendaSchema.safeParse({ codigo: "X", nombre: "X", venta_esperada_promedio: "85000" }).success).toBe(
      false
    );
    expect(crearTiendaSchema.parse({ codigo: "X", nombre: "X", venta_esperada_promedio: 85000 }).venta_esperada_promedio).toBe(
      85000
    );
  });
  it("cuerpos incoherentes → mensaje de motivoRechazoTienda colgado del campo", () => {
    const sinApertura = crearTiendaSchema.safeParse({ codigo: "X", nombre: "X", fecha_cierre: "2026-12-31" });
    expect(primerError(sinApertura)).toMatchObject({ message: MENSAJE_CIERRE_SIN_APERTURA, path: ["fecha_cierre"] });

    const alReves = crearTiendaSchema.safeParse({
      codigo: "X",
      nombre: "X",
      fecha_apertura: "2026-10-05",
      fecha_cierre: "2026-10-04",
    });
    expect(primerError(alReves)?.message).toBe(MENSAJE_CIERRE_ANTES_DE_APERTURA);

    const cdConVenta = crearTiendaSchema.safeParse({
      codigo: "RD50",
      nombre: "CD LUKERS",
      tipo: "Centro de Distribución",
      venta_esperada_promedio: 1000,
    });
    expect(primerError(cdConVenta)).toMatchObject({ message: MENSAJE_VENTA_EN_CD, path: ["venta_esperada_promedio"] });
  });
  it("tipo inválido → error; CD sin venta pasa", () => {
    expect(crearTiendaSchema.safeParse({ codigo: "X", nombre: "X", tipo: "CD" }).success).toBe(false);
    expect(crearTiendaSchema.parse({ codigo: "RD50", nombre: "CD", tipo: "Centro de Distribución" }).tipo).toBe(
      "Centro de Distribución"
    );
  });
});

describe("editarTiendaSchema (regla 19)", () => {
  it("rechaza el cuerpo vacío y acepta activo", () => {
    expect(editarTiendaSchema.safeParse({}).success).toBe(false);
    expect(editarTiendaSchema.parse({ activo: false })).toEqual({ activo: false });
  });
  it("las claves ausentes siguen ausentes; las presentes se normalizan", () => {
    expect(editarTiendaSchema.parse({ nombre: " nuevo nombre " })).toEqual({ nombre: "NUEVO NOMBRE" });
    expect(editarTiendaSchema.parse({ zona: "" })).toEqual({ zona: null });
    expect(editarTiendaSchema.parse({ fecha_cierre: null })).toEqual({ fecha_cierre: null });
    expect(editarTiendaSchema.parse({ codigo: "r-401" })).toEqual({ codigo: "R_401" });
  });
  it("no comprueba la coherencia cruzada (eso es del handler con la fila actual)", () => {
    expect(editarTiendaSchema.parse({ fecha_cierre: "2026-12-31" })).toEqual({ fecha_cierre: "2026-12-31" });
  });
  it("rechaza fechas fuera de aaaa-mm-dd y venta negativa", () => {
    expect(editarTiendaSchema.safeParse({ fecha_apertura: "15/03/2019" }).success).toBe(false);
    expect(editarTiendaSchema.safeParse({ venta_esperada_promedio: -1 }).success).toBe(false);
  });
});

describe("filtros de lectura", () => {
  it("tipo y estado solo con valores exactos; hoy como aaaa-mm-dd", () => {
    expect(filtrosTiendasSchema.parse({})).toEqual({});
    expect(filtrosTiendasSchema.parse({ estado: "Planificada", tipo: "Tienda", hoy: "2026-10-06" })).toEqual({
      estado: "Planificada",
      tipo: "Tienda",
      hoy: "2026-10-06",
    });
    expect(filtrosTiendasSchema.safeParse({ estado: "activa" }).success).toBe(false);
    expect(filtrosTiendasSchema.safeParse({ tipo: "CD" }).success).toBe(false);
    expect(filtrosTiendasSchema.safeParse({ hoy: "ayer" }).success).toBe(false);
    expect(filtrosAperturasSchema.safeParse({ desde: "2026-01-01", hasta: "2026-12-31" }).success).toBe(true);
    expect(filtrosAperturasSchema.safeParse({ desde: "01/01/2026" }).success).toBe(false);
  });
});

describe("importarTiendasSchema", () => {
  it("fila mínima con codigo y nombre; el resto entra como ''", () => {
    expect(filaImportacionTiendaSchema.parse({ codigo: "R401", nombre: "X" })).toEqual({
      codigo: "R401",
      nombre: "X",
      tipo: "",
      zona: "",
      razon_social: "",
      fecha_apertura: "",
      fecha_cierre: "",
      venta_esperada: "",
    });
  });
  it("modo y límites", () => {
    expect(importarTiendasSchema.safeParse({ modo: "aplicar", filas: [{ codigo: "A", nombre: "B" }] }).success).toBe(true);
    expect(importarTiendasSchema.safeParse({ modo: "sincronizar", filas: [{ codigo: "A", nombre: "B" }] }).success).toBe(
      false
    );
    expect(importarTiendasSchema.safeParse({ modo: "aplicar", filas: [] }).success).toBe(false);
    expect(importarTiendasSchema.safeParse({ modo: "aplicar", filas: [{ codigo: "A" }] }).success).toBe(false);
  });
});
