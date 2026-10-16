import { describe, expect, it } from "vitest";
import { backtestDeFoto, perturbarParticipacion, resumirBacktest, type FotoParaBacktest } from "@/lib/curvas/backtest-foto";
import { AGRUPACIONES_SINTETICAS, P3, calcularAvanzada } from "./curvas.avanzada.fixture";

/**
 * Regla 87 en CI: el mismo procedimiento del backtest offline (`scripts/backtest-fotos.ts`) sobre tres
 * agrupaciones sintéticas (P3, una de dos años y una muy ruidosa). Comprueba (a) la A recalculada coincide con la
 * de la foto, (b) F o T no se recomiendan sin ganar por más del margen y (c) ρ y λ de cada pliegue no ven el
 * año de prueba. No hay un número mínimo de victorias de F: la condición es la honestidad.
 */

const fotos = AGRUPACIONES_SINTETICAS.map(({ nombre, opciones }) => {
  const r = calcularAvanzada(opciones);
  const foto: FotoParaBacktest = {
    agrupacion: r.agrupacion,
    temporada: r.temporada,
    parametros: { margen_ruido: r.parametros.margen_ruido, recencia_f: r.parametros.recencia_f },
  };
  return { nombre, foto, resultado: backtestDeFoto(foto) };
});

describe("regla 87 · backtest de las fotos sintéticas", () => {
  it("(a) la A recalculada y su EAT coinciden con los de la foto (determinismo)", () => {
    for (const { nombre, resultado } of fotos) {
      expect(resultado.a_coincide, nombre).toBe(true);
      expect(resultado.eat_a_coincide, nombre).toBe(true);
    }
  });
  it("(b) en ninguna F o T queda recomendada con EAT ≥ EAT_A − margen", () => {
    for (const { nombre, resultado } of fotos) expect(resultado.viola_margen, nombre).toBe(false);
    for (const { nombre, resultado, foto } of fotos) {
      if (resultado.recomendada === "F" || resultado.recomendada === "T") {
        const eat = resultado.recomendada === "F" ? resultado.eat_f : resultado.eat_t;
        expect(eat as number, nombre).toBeLessThan((resultado.eat_a as number) - (resultado.margen as number));
      }
      void foto;
    }
  });
  it("(c) λ, ρ y la curva de F de cada pliegue no cambian al perturbar el año de prueba", () => {
    for (const { nombre, resultado } of fotos) {
      expect(resultado.sin_fuga, nombre).toBe(true);
      for (const p of resultado.pliegues) expect(p.sin_fuga, `${nombre} ${p.anio_prueba}`).toBe(true);
    }
    const rhos = fotos.find((f) => f.nombre === "P3")?.resultado.pliegues.map((p) => p.rho) ?? [];
    rhos.forEach((r, i) => expect(r).toBeCloseTo([4, 8, 4][i], 9));
  });
  it("(d) la tabla agregada: cuántas gana cada una, ruido mínimo y máximo y que cumple", () => {
    const resumen = resumirBacktest(fotos.map((f) => f.resultado));
    expect(resumen.fotos).toBe(3);
    expect(resumen.gana_a + resumen.gana_f + resumen.gana_t + resumen.otra + resumen.sin_recomendacion).toBe(3);
    expect(resumen.a_no_coincide + resumen.violan_margen + resumen.con_fuga).toBe(0);
    expect(resumen.cumple).toBe(true);
    expect(resumen.ruido_minimo).not.toBeNull();
    expect(resumen.ruido_maximo as number).toBeGreaterThanOrEqual(resumen.ruido_minimo as number);
  });
  it("P3 recomendada A con EAT_A 4.0, EAT_F 5.128 y EAT_T 6.667; P2: F sin backtesting (0 pruebas)", () => {
    const p3 = fotos.find((f) => f.nombre === "P3")!.resultado;
    expect([p3.recomendada, p3.pruebas_f, p3.pruebas_t]).toEqual(["A", 3, 3]);
    expect(p3.eat_a).toBeCloseTo(4, 6);
    expect(p3.eat_f).toBeCloseTo(5.128, 2);
    expect(p3.eat_t).toBeCloseTo(6.6667, 3);
    const p2 = fotos.find((f) => f.nombre === "P2")!.resultado;
    expect([p2.pruebas_f, p2.eat_f, p2.pliegues]).toEqual([0, null, []]);
  });
  it("el backtest detecta una fuga si el pliegue la tuviera: perturbar a mano el año de prueba sí mueve el EAT medido", () => {
    const p3 = fotos.find((f) => f.nombre === "P3")!;
    const modificada: FotoParaBacktest = {
      ...p3.foto,
      agrupacion: { ...p3.foto.agrupacion, anios: p3.foto.agrupacion.anios.map((a) => (a.anio === 2023 && a.participacion ? { ...a, participacion: perturbarParticipacion(a.participacion) } : a)) },
    };
    const r = backtestDeFoto(modificada);
    // La curva y ρ/λ del pliegue «sin 2023» no cambian; el EAT contra el 2023 modificado sí.
    expect(r.pliegues.find((p) => p.anio_prueba === 2023)?.rho).toBe(p3.resultado.pliegues.find((p) => p.anio_prueba === 2023)?.rho);
    expect(r.pliegues.find((p) => p.anio_prueba === 2023)?.lambda).toBe(p3.resultado.pliegues.find((p) => p.anio_prueba === 2023)?.lambda);
    expect(r.pliegues.find((p) => p.anio_prueba === 2023)?.eat_f).not.toBeCloseTo(p3.resultado.pliegues.find((p) => p.anio_prueba === 2023)?.eat_f as number, 3);
  });
  it("perturbarParticipacion mantiene la suma 1 y mueve el mes mayor", () => {
    const base = P3[2024]!.map((x) => x / 100);
    const p = perturbarParticipacion(base);
    expect(p.reduce((s, x) => s + x, 0)).toBeCloseTo(1, 12);
    expect(p).not.toEqual(base);
  });
});
