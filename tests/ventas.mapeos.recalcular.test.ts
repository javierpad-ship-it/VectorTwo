import { describe, expect, it, vi } from "vitest";
import { construirInforme } from "@/lib/ventas/informe";
import { crearPeticionPrevisualizar } from "@/lib/ventas/previsualizar";
import { recalcularInforme, totalReasignadas } from "@/lib/ventas/recalcular";
import type { PrevisualizarPeticion, PrevisualizarRespuesta } from "@/lib/ventas/tipos-api";
import { acumular, mapeo, resoluciones } from "./ventas.fixture";

/**
 * Recalcular el informe sin releer el archivo (M5b, "Recalcular"): la misma
 * petición de `previsualizar`, el acumulador en memoria y un informe nuevo.
 */

const FILAS = [{}, { equivalencia: "JEAN", venta_soles: "500" }, { equivalencia: "FOO", venta_soles: "300" }];

/** Respuesta de un `previsualizar` falso que aplica los mapeos que tenga en ese momento. */
function servidor(mapeos: ReturnType<typeof mapeo>[]) {
  const acum = acumular(FILAS);
  const llamadas: PrevisualizarPeticion[] = [];
  const previsualizar = vi.fn(async (p: PrevisualizarPeticion): Promise<PrevisualizarRespuesta> => {
    llamadas.push(p);
    const r = resoluciones(acum, { mapeos });
    return { ...r, mapeos_no_aplicables: r.mapeos_no_aplicables ?? [], mes_actual: "2026-10", agrupaciones_talla: { CENTRALES: "c", EXTREMAS: "e" }, agrupaciones_marca: [], agrupacion_defecto_id: null };
  });
  return { acum, previsualizar, llamadas };
}

describe("recalcularInforme", () => {
  it("manda la misma petición que arma el acumulador y reconstruye el informe con los mapeos nuevos", async () => {
    const { acum, previsualizar, llamadas } = servidor([mapeo("m-jean", ["HOMBRE", "CASUAL", "DENIM", "JEAN"], "e1s")]);
    const antes = construirInforme({ acumulador: acum, resoluciones: resoluciones(acum) });
    expect(totalReasignadas(antes.informe)).toBe(0);
    expect(antes.informe.meses[0].errores.pct_filas).toBeCloseTo(66.67, 1);

    const r = await recalcularInforme(acum, previsualizar);
    expect(previsualizar).toHaveBeenCalledTimes(1);
    expect(llamadas[0]).toEqual(crearPeticionPrevisualizar(acum));
    expect(r.reasignadas).toBe(1);
    expect(r.resultado.informe.meses[0].reasignadas.filas).toBe(1);
    expect(r.resultado.informe.meses[0].errores.pct_filas).toBeCloseTo(33.33, 1);
    expect(r.resultado.informe.meses[0].identidad_ok).toBe(true);
    expect(r.respuesta.combinaciones.some((c) => c.resultado === "ok" && c.mapeo?.id === "m-jean")).toBe(true);
  });

  it("es repetible: el acumulador no se modifica y una segunda llamada da lo mismo", async () => {
    const { acum, previsualizar } = servidor([mapeo("m-jean", ["HOMBRE", "CASUAL", "DENIM", "JEAN"], "e1s")]);
    const a = await recalcularInforme(acum, previsualizar);
    const b = await recalcularInforme(acum, previsualizar);
    expect(b.resultado.informe).toEqual(a.resultado.informe);
    expect(acum.filas).toBe(3);
  });

  it("si previsualizar falla el error sube tal cual", async () => {
    const acum = acumular(FILAS);
    await expect(recalcularInforme(acum, async () => Promise.reject(new Error("sin red")))).rejects.toThrow("sin red");
  });

  it("pasa los totales de QlikView al informe recalculado", async () => {
    const { acum, previsualizar } = servidor([]);
    const r = await recalcularInforme(acum, previsualizar, { totalesQlik: { "2026-09": { venta_soles: 1800 } } });
    expect(r.resultado.informe.meses[0].conciliacion.find((c) => c.medida === "venta_soles")?.qlik).toBe(1800);
  });
});
