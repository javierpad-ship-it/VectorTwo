import { describe, expect, it } from "vitest";
import { bloquesDeAnio, clasificarTienda, clavesPertenencia, textoMotivoTienda } from "@/lib/proyeccion/bloques";
import { tiendas, Y } from "./proyeccion.fixture";

const codigos = (l: { codigo: string }[]) => l.map((t) => t.codigo).sort();

describe("bloques de tiendas (reglas 1 a 4; caso 1)", () => {
  const lista = tiendas();
  const claves = clavesPertenencia(lista, Y);

  it("2026: mismas, nuevas con subbloque, cierres y fuera con motivo", () => {
    const b = bloquesDeAnio(lista, 2026, claves);
    expect(codigos(b.mismas)).toEqual(["T1", "T5", "T6"]);
    expect(codigos(b.nuevas)).toEqual(["T2", "T3", "T9"]);
    expect(b.nuevas.find((t) => t.codigo === "T2")?.subbloque).toBe("nuevas_anterior");
    expect(b.nuevas.find((t) => t.codigo === "T3")?.subbloque).toBe("aperturas");
    expect(b.nuevas.find((t) => t.codigo === "T9")?.subbloque).toBe("aperturas");
    expect(codigos(b.cierres)).toEqual(["T7"]);
    // T8 cerró el 2025-12-31: fuera en 2026 (era misma en 2025); el CD y T4 (abre en 2027) también.
    expect(b.fuera.find((t) => t.codigo === "T8")?.motivo).toBe("cerrada_antes");
    expect(b.fuera.find((t) => t.codigo === "CD")?.motivo).toBe("cd");
    expect(b.fuera.find((t) => t.codigo === "T4")?.motivo).toBe("planificada_despues");
  });

  it("2027: T2 entra en mismas; T3 y T9 siguen nuevas del año anterior; T4 es apertura; T5 cierra; T7 fuera", () => {
    const b = bloquesDeAnio(lista, 2027, claves);
    expect(codigos(b.mismas)).toEqual(["T1", "T2", "T6"]);
    expect(codigos(b.nuevas)).toEqual(["T3", "T4", "T9"]);
    expect(b.nuevas.find((t) => t.codigo === "T3")?.subbloque).toBe("nuevas_anterior");
    expect(b.nuevas.find((t) => t.codigo === "T9")?.subbloque).toBe("nuevas_anterior");
    expect(b.nuevas.find((t) => t.codigo === "T4")?.subbloque).toBe("aperturas");
    expect(codigos(b.cierres)).toEqual(["T5"]);
    expect(b.fuera.find((t) => t.codigo === "T7")?.motivo).toBe("cerrada_antes");
  });

  it("casos borde: apertura el 1 de enero de Z−1 es misma; el 2 de enero es nueva del año anterior; cierre el 31 de diciembre nunca es cierre", () => {
    const t6 = lista.find((t) => t.id === "T6")!;
    expect(clasificarTienda(t6, 2026).bloque).toBe("mismas");
    expect(clasificarTienda({ ...t6, fecha_apertura: "2025-01-02" }, 2026)).toMatchObject({ bloque: "nuevas", subbloque: "nuevas_anterior" });
    const t8 = lista.find((t) => t.id === "T8")!;
    for (const z of [2024, 2025, 2026, 2027]) expect(clasificarTienda(t8, z).bloque).not.toBe("cierres");
    expect(clasificarTienda(t8, 2025).bloque).toBe("mismas");
    // Una apertura a mitad de año: apertura, luego nueva del año anterior y misma dos años después.
    const nueva = { ...t6, fecha_apertura: "2026-07-01" };
    expect(clasificarTienda(nueva, 2026)).toMatchObject({ bloque: "nuevas", subbloque: "aperturas" });
    expect(clasificarTienda(nueva, 2027)).toMatchObject({ bloque: "nuevas", subbloque: "nuevas_anterior" });
    expect(clasificarTienda(nueva, 2028).bloque).toBe("mismas");
  });

  it("cada tienda está en exactamente un bloque por año", () => {
    for (const z of [2023, 2024, 2025, 2026, 2027]) {
      const b = bloquesDeAnio(lista, z);
      const todas = [...b.mismas, ...b.nuevas, ...b.cierres, ...b.fuera].map((t) => t.codigo).sort();
      expect(todas).toEqual(lista.map((t) => t.codigo).sort());
    }
  });

  it("claves de pertenencia de cinco posiciones (Y−3 … Y+1); sin tienda en el CD", () => {
    expect(claves).toMatchObject({ T1: "11111", T6: "00011", T2: "00001", T8: "11100", T5: "11110", T7: "11100", T3: "00000", T4: "00000", T9: "00000" });
    expect(claves.CD).toBeUndefined();
  });

  it("sin apertura, desactivada y sin cierre: motivos; los textos de pantalla existen", () => {
    const t1 = lista.find((t) => t.id === "T1")!;
    expect(clasificarTienda({ ...t1, fecha_apertura: null }, 2026).motivo).toBe("sin_apertura");
    expect(clasificarTienda({ ...t1, activo: false }, 2026).motivo).toBe("desactivada");
    expect(textoMotivoTienda("cerrada_antes", 2026)).toContain("2026");
  });
});
