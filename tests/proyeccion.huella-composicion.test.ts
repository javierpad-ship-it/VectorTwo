import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clienteFalso } from "./crecimientos.fake-db";
import { HUELLA_COMPOSICION_INVIERNO, HUELLA_COMPOSICION_VERANO, sembrar } from "./crecimientos.fixture";

vi.mock("server-only", () => ({}));

import { leerHuellaComposicionTemporada } from "@/lib/curvas/consultas";
import { leerHuellasComposicion } from "@/lib/proyeccion/contexto";

/**
 * 06e (B2): la `huella_composicion` que escribe `sincronizarFactores` y la que compara la pantalla de GM (`factor_desfasado`) y el cierre de M7 salen de UNA sola función
 * (`leerHuellaComposicionTemporada`). Si dos sitios la calcularan por separado, un factor recién sincronizado saldría «desfasado» sin que nada hubiera cambiado.
 * Sintético; la base falsa es la de las pruebas de crecimientos (agrupaciones de invierno, verano y todo el año con sus equivalencias).
 */

const db = () => clienteFalso() as never;

beforeEach(() => sembrar());

describe("huella de composición de una temporada", () => {
  it("el contexto de M7 (el que escribe sincronizarFactores) y la función compartida dan el mismo valor, el que el fixture de GM espera", async () => {
    const contexto = await leerHuellasComposicion(db());
    expect(contexto.respuesta).toBeNull();
    const invierno = await leerHuellaComposicionTemporada(db(), "invierno");
    const verano = await leerHuellaComposicionTemporada(db(), "verano");
    expect(invierno.error).toBeNull();
    expect(verano.error).toBeNull();
    expect(contexto.data).toEqual({ invierno: invierno.data, verano: verano.data });
    expect(invierno.data).toBe(HUELLA_COMPOSICION_INVIERNO);
    expect(verano.data).toBe(HUELLA_COMPOSICION_VERANO);
    expect(invierno.data).not.toBe(verano.data);
  });

  it("remapear una equivalencia cambia la huella de la temporada afectada (y la de las dos si es de todo el año)", async () => {
    const antes = await leerHuellasComposicion(db());
    const equivalencias = (await import("./crecimientos.fake-db")).estadoFalso.tablas.equivalencias as { id: string; agrupacion_estacionalidad_id: string | null }[];
    const e1 = equivalencias.find((e) => e.id === "e1");
    expect(e1).toBeDefined();
    if (!e1) return;
    e1.agrupacion_estacionalidad_id = null; // e1 era de la agrupación de invierno
    const despues = await leerHuellasComposicion(db());
    expect(despues.data?.invierno).not.toBe(antes.data?.invierno);
    expect(despues.data?.verano).toBe(antes.data?.verano);
  });
});

describe("una sola función para la huella de composición", () => {
  const fuente = (ruta: string) => readFileSync(new URL(`../src/${ruta}`, import.meta.url), "utf8");

  it("ni el contexto de M7 ni la pantalla de GM llaman a huellaTemporada a mano: las dos usan leerHuellaComposicionTemporada", () => {
    for (const ruta of ["lib/proyeccion/contexto.ts", "lib/crecimientos/servicio.ts"]) {
      const texto = fuente(ruta);
      expect(texto, ruta).toContain("leerHuellaComposicionTemporada(");
      expect(texto, ruta).not.toMatch(/huellaTemporada\(/);
      expect(texto, ruta).not.toContain("leerAgrupacionesDeTemporada(");
    }
  });

  it("sincronizarFactores escribe la que lee el contexto (leerHuellasComposicion) y no calcula otra", () => {
    const texto = fuente("lib/proyeccion/servicio.ts");
    expect(texto).toContain("leerHuellasComposicion(d)");
    expect(texto).toContain("huella_composicion: composicion.data[temporada]");
    expect(texto).not.toMatch(/huellaTemporada\(|leerAgrupacionesDeTemporada\(/);
  });
});
