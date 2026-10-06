import { describe, expect, it } from "vitest";
import { aplanarEquivalencias } from "@/lib/estacionalidad/aplanar";
import { resumirMapa, rutaCorta } from "@/lib/estacionalidad/mapa";
import type { EquivalenciaPlana } from "@/lib/estacionalidad/tipos-api";
import { estadoFx } from "./estacionalidad.fixture";

/**
 * Lista plana del fixture (con inactivas, para comprobar que el mapa las
 * ignora) y catálogo con descripción, como lo recibe la pestaña.
 */
function resumen(incluirInactivos = true) {
  const e = estadoFx();
  const plana = aplanarEquivalencias(e, e.agrupaciones, { incluirInactivos });
  const agrupaciones = e.agrupaciones.map((a) => ({ ...a, descripcion: a.id === "a-inv" ? "Pico en mayo-junio" : null }));
  return resumirMapa(plana.equivalencias as EquivalenciaPlana[], agrupaciones, plana.generos, plana.lineas);
}

describe("resumirMapa · totales", () => {
  it("cuenta solo activas y vigentes: 7 en el fixture, valga o no incluirInactivos", () => {
    expect(resumen(true).total).toBe(7);
    expect(resumen(false).total).toBe(7);
    expect(resumen(true)).toEqual(resumen(false));
  });

  it("sin agrupación = las 5 faltantes (regla 7), con la inactiva y la fuera de catálogo incluidas", () => {
    const r = resumen();
    expect(r.sinAgrupacion.total).toBe(5);
    const ids = r.sinAgrupacion.lineas.flatMap((l) => l.equivalencias.map((x) => x.id)).sort();
    expect(ids).toEqual(["e1", "e12", "e3", "e5", "e7"]);
    const e3 = r.sinAgrupacion.lineas.flatMap((l) => l.equivalencias).find((x) => x.id === "e3");
    expect(e3?.motivo_faltante).toBe("agrupacion_inactiva");
  });
});

describe("resumirMapa · tarjetas", () => {
  it("una por agrupación del catálogo, activas e inactivas, por `orden, nombre`", () => {
    const r = resumen();
    expect(r.tarjetas.map((t) => t.agrupacion.id)).toEqual(["a-old", "a-inv", "a-ver"]);
    expect(r.tarjetas[1].agrupacion).toMatchObject({ codigo: "PANTALONES_INVIERNO", descripcion: "Pico en mayo-junio", activo: true });
  });

  it("conteo, género y líneas de cada tarjeta", () => {
    const r = resumen();
    const inv = r.tarjetas.find((t) => t.agrupacion.id === "a-inv")!;
    expect(inv.total).toBe(1);
    expect(inv.porGenero).toEqual([{ id: "g-h", nombre: "HOMBRE", conteo: 1 }]);
    expect(inv.lineas).toHaveLength(1);
    expect(inv.lineas[0]).toMatchObject({ id: "l-pant", nombre: "PANTALON", conteo: 1 });
    expect(inv.lineas[0].equivalencias[0]).toMatchObject({ id: "e2", nombre: "JOGGER", es_generica: false, rutaCorta: "HOMBRE / URBANO" });

    const ver = r.tarjetas.find((t) => t.agrupacion.id === "a-ver")!;
    expect(ver.total).toBe(1);
    expect(ver.porGenero).toEqual([{ id: "g-m", nombre: "MUJER", conteo: 1 }]);
    expect(ver.lineas[0].equivalencias[0]).toMatchObject({ id: "e6", es_generica: true, rutaCorta: "MUJER / URBANO" });
  });

  it("una agrupación inactiva muestra sus asignadas (están asignadas) aunque sean faltantes", () => {
    const old = resumen().tarjetas.find((t) => t.agrupacion.id === "a-old")!;
    expect(old.agrupacion.activo).toBe(false);
    expect(old.total).toBe(1);
    expect(old.lineas[0].equivalencias[0].id).toBe("e3");
  });

  it("géneros solo con conteo > 0 y en el orden del catálogo", () => {
    const sin = resumen().sinAgrupacion;
    // HOMBRE (orden 10) antes que MUJER (20); OTROS no aparece (inactivo, sin vigentes).
    expect(sin.porGenero).toEqual([
      { id: "g-h", nombre: "HOMBRE", conteo: 3 },
      { id: "g-m", nombre: "MUJER", conteo: 2 },
    ]);
    // Líneas por nombre: BLUSA antes que PANTALON.
    expect(sin.lineas.map((l) => l.nombre)).toEqual(["BLUSA", "PANTALON"]);
    expect(sin.lineas.map((l) => l.conteo)).toEqual([1, 4]);
  });

  it("las inactivas o no vigentes no aparecen en ninguna tarjeta", () => {
    const r = resumen();
    const ids = [...r.tarjetas.flatMap((t) => t.lineas), ...r.sinAgrupacion.lineas].flatMap((l) => l.equivalencias.map((x) => x.id));
    for (const id of ["e4", "e8", "e9", "e10", "e11"]) expect(ids).not.toContain(id);
  });
});

describe("resumirMapa · cobertura por género", () => {
  it("un renglón por género con equivalencias, segmentos solo de agrupaciones activas y faltantes al final", () => {
    const r = resumen();
    expect(r.cobertura.map((g) => g.nombre)).toEqual(["HOMBRE", "MUJER"]);
    const h = r.cobertura[0];
    // HOMBRE: e3 (inactiva → faltante), e12 (fuera → faltante), e2 (a-inv), e1 (faltante).
    expect(h.total).toBe(4);
    expect(h.segmentos).toEqual([{ agrupacionId: "a-inv", nombre: "PANTALONES INVIERNO", conteo: 1 }]);
    expect(h.faltantes).toBe(3);
    const m = r.cobertura[1];
    expect(m.total).toBe(3);
    expect(m.segmentos).toEqual([{ agrupacionId: "a-ver", nombre: "PANTALONES VERANO", conteo: 1 }]);
    expect(m.faltantes).toBe(2);
  });

  it("los segmentos más los faltantes suman el total del género (no se cuenta dos veces la inactiva)", () => {
    for (const g of resumen().cobertura) {
      expect(g.segmentos.reduce((s, x) => s + x.conteo, 0) + g.faltantes).toBe(g.total);
    }
  });

  it("sin agrupaciones todo es faltante y no hay tarjetas", () => {
    const e = estadoFx();
    const plana = aplanarEquivalencias(e, [], { incluirInactivos: false });
    const r = resumirMapa(plana.equivalencias as EquivalenciaPlana[], [], plana.generos, plana.lineas);
    expect(r.tarjetas).toEqual([]);
    expect(r.sinAgrupacion.total).toBe(r.total);
    for (const g of r.cobertura) expect(g.segmentos).toEqual([]);
  });
});

describe("rutaCorta", () => {
  it("quita la línea de la ruta y deja intacta una ruta corta", () => {
    expect(rutaCorta("HOMBRE / URBANO / PANTALON")).toBe("HOMBRE / URBANO");
    expect(rutaCorta("HOMBRE / URBANO")).toBe("HOMBRE / URBANO");
  });
});
