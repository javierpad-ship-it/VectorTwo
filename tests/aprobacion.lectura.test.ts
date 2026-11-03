import { beforeEach, describe, expect, it } from "vitest";
import { clienteFalso, estado, reiniciar, sembrar } from "./proyeccion.fake-db";
import { leerAniosHistoricoDeGML, leerFilasConAnios } from "@/lib/proyeccion/consultas";

/**
 * 07g · H2: las lecturas por columnas de la aprobación en bloque (sin el `historico` entero) y las listas largas de `ids` en tandas.
 */

const PROY = "00000000-0000-4000-8000-0000000000aa";
const GML = (i: number) => `00000000-0000-4000-8000-${String(0xd000 + (i % 3)).padStart(12, "0")}`;
const db = () => clienteFalso() as unknown as Parameters<typeof leerFilasConAnios>[0];

beforeEach(() => {
  reiniciar();
  const filas = Array.from({ length: 400 }, (_, i) => ({
    proyeccion_id: PROY,
    tienda_id: null,
    gml_id: GML(i),
    equivalencia_id: null,
    agrupacion_marca_id: "am",
    clave: `|${GML(i)}||am-${String(i).padStart(4, "0")}`,
    nivel_proyectado: "GML",
    curva_origen: [],
    historico: { anios: [{ anio: 2025, total: 100 + i }, { anio: 2026, total: 50 }], salientes: [{ tienda_id: "t", vendido: i, meses: [] }], cola_larga: i === 0 ? { veredicto: "revision" } : null, relleno: "x".repeat(500) },
    activo: true,
  }));
  const creadas = sembrar("proyeccion_filas", filas);
  sembrar(
    "proyeccion_fila_anios",
    creadas.map((f) => ({ fila_id: f.id, anio: 2026, bloque: "mismas", vendido: 1, propuesto: 2 }))
  );
});

describe("leerFilasConAnios: ids largos en tandas y columnas de decisión", () => {
  it("400 ids se leen completos (en tandas de 150), sin repetir ni perder filas", async () => {
    const ids = estado.tablas.proyeccion_filas.map((f) => f.id as string);
    const r = await leerFilasConAnios(db(), PROY, { columnas: "decision", ids, tiendaId: null, soloActivas: true });
    expect(r.error).toBeNull();
    expect(r.data).toHaveLength(400);
    expect(new Set(r.data.map((f) => f.id)).size).toBe(400);
  });

  it("`decision` no trae `historico`; `decision_historico` trae solo `salientes` y `cola_larga` (alias), nunca el resto del `historico`", async () => {
    const ids = estado.tablas.proyeccion_filas.slice(0, 3).map((f) => f.id as string);
    const sin = await leerFilasConAnios(db(), PROY, { columnas: "decision", ids });
    for (const f of sin.data) expect("historico" in f).toBe(false);
    const con = await leerFilasConAnios(db(), PROY, { columnas: "decision_historico", ids });
    const texto = JSON.stringify(con.data);
    expect(texto).not.toContain("relleno");
    expect(texto).not.toContain("historico");
    const primera = con.data.find((f) => f.id === ids[0]) as unknown as { salientes: unknown[]; cola_larga: { veredicto: string } | null };
    expect(primera.salientes).toHaveLength(1);
    expect(primera.cola_larga).toEqual({ veredicto: "revision" });
  });

  it("`leerAniosHistoricoDeGML` devuelve solo `historico->anios` de las filas base activas de esos nodos", async () => {
    const r = await leerAniosHistoricoDeGML(db(), PROY, [GML(0)]);
    expect(r.error).toBeNull();
    expect(r.data.size).toBe(estado.tablas.proyeccion_filas.filter((f) => f.gml_id === GML(0)).length);
    for (const anios of r.data.values()) expect(anios.map((a) => a.anio)).toEqual([2025, 2026]);
    expect(JSON.stringify([...r.data])).not.toContain("relleno");
  });
});
