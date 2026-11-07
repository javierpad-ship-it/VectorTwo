import { describe, expect, it } from "vitest";
import { elegirLineaOrigen, fotosParaTraer, type CompraCandidata, type LineaCandidata } from "@/lib/fotos/traer";

const compra = (id: string, extra: Partial<CompraCandidata> = {}): CompraCandidata => ({ id, estado: "cancelada", proveedor_id: "p1", created_at: "2026-10-01T10:00:00.000Z", cancelada_at: "2026-10-10T10:00:00.000Z", ...extra });
const linea = (id: string, compra_id: string, created_at = "2026-10-01T10:00:00.000Z"): LineaCandidata => ({ id, compra_id, created_at });
const destino = { id: "L-nueva", compra_id: "C-nueva", proveedor_id: "p1" };

describe("elegirLineaOrigen (decisión 104)", () => {
  it("elige la línea de la compra cancelada más reciente (por su fecha de cancelación)", () => {
    const compras = new Map([compra("C1", { cancelada_at: "2026-10-10T10:00:00.000Z" }), compra("C2", { cancelada_at: "2026-10-20T10:00:00.000Z" })].map((c) => [c.id, c]));
    expect(elegirLineaOrigen(destino, [linea("L1", "C1"), linea("L2", "C2")], compras)?.id).toBe("L2");
  });

  it("descarta compras vivas, de otro proveedor, la propia compra y la propia línea", () => {
    const compras = new Map(
      [compra("C-viva", { estado: "confirmada", cancelada_at: null }), compra("C-otro", { proveedor_id: "p2" }), compra("C-nueva"), compra("C-ok")].map((c) => [c.id, c]),
    );
    const candidatas = [linea("L-viva", "C-viva"), linea("L-otro", "C-otro"), linea("L-propia", "C-nueva"), linea("L-nueva", "C-ok"), linea("L-ok", "C-ok")];
    expect(elegirLineaOrigen(destino, candidatas, compras)?.id).toBe("L-ok");
    expect(elegirLineaOrigen(destino, candidatas.slice(0, 3), compras)).toBeNull();
  });

  it("a igual cancelación manda la línea más reciente y, a igualdad, el id mayor; sin candidatas, nulo", () => {
    const compras = new Map([compra("C1")].map((c) => [c.id, c]));
    expect(elegirLineaOrigen(destino, [linea("La", "C1", "2026-10-01T10:00:00.000Z"), linea("Lb", "C1", "2026-10-02T10:00:00.000Z")], compras)?.id).toBe("Lb");
    expect(elegirLineaOrigen(destino, [linea("La", "C1"), linea("Lb", "C1")], compras)?.id).toBe("Lb");
    expect(elegirLineaOrigen(destino, [], compras)).toBeNull();
  });
});

describe("fotosParaTraer", () => {
  it("trae las del origen que faltan sin pasar del cupo hasta 3", () => {
    expect(fotosParaTraer(["a", "b"], new Set(), 0)).toBe(2);
    expect(fotosParaTraer(["a", "b", "c"], new Set(), 2)).toBe(1);
    expect(fotosParaTraer(["a", "b", "c"], new Set(["a"]), 1)).toBe(2);
    expect(fotosParaTraer(["a", "b"], new Set(["a", "b"]), 2)).toBe(0);
    expect(fotosParaTraer(["a"], new Set(), 3)).toBe(0);
    expect(fotosParaTraer([], new Set(), 0)).toBe(0);
  });
});
