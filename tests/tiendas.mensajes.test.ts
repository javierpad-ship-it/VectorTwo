import { describe, expect, it } from "vitest";
import { causaSinCreaciones } from "@/lib/tiendas/mensajes";

const base = {
  crear: { tiendas: 0, centros_distribucion: 0 },
  existentes: { tiendas: 0 },
  existentes_inactivos: { tiendas: 0 },
  omitidas: [] as { motivo: string }[],
};

describe("causaSinCreaciones", () => {
  it("si se crean tiendas o centros de distribución no hay causa", () => {
    expect(causaSinCreaciones({ ...base, crear: { tiendas: 3, centros_distribucion: 0 } })).toBeNull();
    expect(causaSinCreaciones({ ...base, crear: { tiendas: 0, centros_distribucion: 1 } })).toBeNull();
  });

  it("todas las filas con errores y la tabla vacía: solo_errores, no 'ya existen'", () => {
    const r = { ...base, omitidas: [{ motivo: "fecha_apertura_invalida" }, { motivo: "codigo_vacio" }] };
    expect(causaSinCreaciones(r)).toBe("solo_errores");
  });

  it("si ya había tiendas con esos códigos, ya_existen", () => {
    expect(causaSinCreaciones({ ...base, existentes: { tiendas: 4 } })).toBe("ya_existen");
    expect(causaSinCreaciones({ ...base, existentes_inactivos: { tiendas: 1 }, omitidas: [{ motivo: "codigo_vacio" }] })).toBe("ya_existen");
  });

  it("las repetidas dentro del archivo no cuentan como errores", () => {
    expect(causaSinCreaciones({ ...base, omitidas: [{ motivo: "duplicada_en_archivo" }] })).toBe("sin_filas");
  });

  it("un archivo sin filas utilizables: sin_filas", () => {
    expect(causaSinCreaciones(base)).toBe("sin_filas");
  });
});
