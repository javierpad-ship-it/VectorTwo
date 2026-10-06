import { describe, expect, it } from "vitest";
import { aplanarEquivalencias, armarRuta } from "@/lib/estacionalidad/aplanar";
import { ACTIVAS_VIGENTES_ORDENADAS, FALTANTES, estadoFx } from "./estacionalidad.fixture";

const activas = () => {
  const e = estadoFx();
  return aplanarEquivalencias(e, e.agrupaciones, { incluirInactivos: false });
};
const todas = () => {
  const e = estadoFx();
  return aplanarEquivalencias(e, e.agrupaciones, { incluirInactivos: true });
};
const faltantes = () => {
  const e = estadoFx();
  return aplanarEquivalencias(e, e.agrupaciones, { incluirInactivos: false, soloFaltantes: true });
};

const fila = (r: ReturnType<typeof activas>, id: string) => {
  const f = r.equivalencias.find((e) => e.id === id);
  if (!f) throw new Error(`no está ${id}`);
  return f;
};

describe("aplanarEquivalencias · regla 7: faltante", () => {
  it("sin agrupación, genérica o real, en nodo vigente → sin_agrupacion", () => {
    const r = activas();
    expect(fila(r, "e1")).toMatchObject({ es_generica: true, faltante: true, motivo_faltante: "sin_agrupacion" });
    expect(fila(r, "e5")).toMatchObject({ es_generica: false, faltante: true, motivo_faltante: "sin_agrupacion" });
    expect(fila(r, "e7")).toMatchObject({ faltante: true, motivo_faltante: "sin_agrupacion" });
  });
  it("con agrupación inactiva → agrupacion_inactiva, con la agrupación resuelta", () => {
    expect(fila(activas(), "e3")).toMatchObject({
      faltante: true,
      motivo_faltante: "agrupacion_inactiva",
      agrupacion: { id: "a-old", codigo: "VIEJA", nombre: "VIEJA", activo: false },
    });
  });
  it("con agrupación activa → no faltante, motivo null", () => {
    expect(fila(activas(), "e2")).toMatchObject({
      faltante: false,
      motivo_faltante: null,
      agrupacion: { id: "a-inv", codigo: "PANTALONES_INVIERNO", nombre: "PANTALONES INVIERNO", activo: true },
    });
    expect(fila(activas(), "e6")).toMatchObject({ es_generica: true, faltante: false, motivo_faltante: null });
  });
  it("inactiva o en nodo no vigente nunca es faltante aunque no tenga agrupación", () => {
    const r = todas();
    for (const id of ["e4", "e8", "e9", "e10", "e11"]) {
      expect(fila(r, id)).toMatchObject({ agrupacion: null, faltante: false, motivo_faltante: null });
    }
    expect(fila(r, "e4")).toMatchObject({ activo: false, vigente: true });
    expect(fila(r, "e8")).toMatchObject({ activo: true, vigente: false });
  });
});

describe("aplanarEquivalencias · regla 8: incluirInactivos", () => {
  it("sin él solo salen las activas y vigentes", () => {
    expect(activas().equivalencias.map((e) => e.id)).toEqual(ACTIVAS_VIGENTES_ORDENADAS);
    for (const e of activas().equivalencias) expect(e.activo && e.vigente).toBe(true);
  });
  it("con él salen todas, con activo y vigente correctos, y faltante no cambia", () => {
    const r = todas();
    expect(r.equivalencias).toHaveLength(12);
    expect(r.equivalencias.filter((e) => e.faltante).map((e) => e.id).sort()).toEqual([...FALTANTES].sort());
    expect(fila(r, "e9")).toMatchObject({ vigente: false, ruta: "HOMBRE / FORMAL / PANTALON" });
    expect(fila(r, "e10")).toMatchObject({ vigente: false, ruta: "HOMBRE / CASUAL / BLUSA" });
    expect(fila(r, "e11")).toMatchObject({ vigente: false, ruta: "OTROS / URBANO / PANTALON" });
  });
  it("soloFaltantes devuelve exactamente las faltantes", () => {
    const r = faltantes();
    expect(r.equivalencias.map((e) => e.id)).toEqual(FALTANTES);
    expect(r.equivalencias.every((e) => e.faltante)).toBe(true);
  });
});

describe("aplanarEquivalencias · regla 9: ruta, ids y agrupación", () => {
  it("cada fila trae la forma JSON de la especificación", () => {
    expect(fila(activas(), "e2")).toEqual({
      id: "e2",
      codigo: "JOGGER",
      nombre: "JOGGER",
      es_generica: false,
      activo: true,
      nodo_id: "n1",
      genero_id: "g-h",
      mundo_id: "m-ur",
      linea_id: "l-pant",
      vigente: true,
      ruta: "HOMBRE / URBANO / PANTALON",
      agrupacion: { id: "a-inv", codigo: "PANTALONES_INVIERNO", nombre: "PANTALONES INVIERNO", activo: true },
      faltante: false,
      motivo_faltante: null,
    });
    expect(armarRuta("A", "B", "C")).toBe("A / B / C");
  });
  it("una agrupación que no está en la lista se trata como sin agrupación", () => {
    expect(fila(activas(), "e12")).toMatchObject({ agrupacion: null, faltante: true, motivo_faltante: "sin_agrupacion" });
  });
  it("los catálogos viajan completos (activos e inactivos) y ordenados", () => {
    const r = activas();
    expect(r.generos.map((g) => g.nombre)).toEqual(["HOMBRE", "MUJER", "OTROS"]);
    expect(r.mundos.map((m) => m.nombre)).toEqual(["CASUAL", "URBANO", "FORMAL"]);
    expect(r.lineas.map((l) => l.nombre)).toEqual(["ABRIGO", "BLUSA", "PANTALON"]);
    expect(r.lineas[0]).toEqual({ id: "l-abr", codigo: "ABRIGO", nombre: "ABRIGO", temporada: "Invierno", activo: false });
    expect(r.agrupaciones.map((a) => a.nombre)).toEqual(["VIEJA", "PANTALONES INVIERNO", "PANTALONES VERANO"]);
    expect(r.agrupaciones[1]).toEqual({
      id: "a-inv",
      codigo: "PANTALONES_INVIERNO",
      nombre: "PANTALONES INVIERNO",
      orden: 10,
      activo: true,
      genero_ids: ["g-h", "g-m"],
    });
  });
  it("cada agrupación del catálogo trae genero_ids en el orden del catálogo de géneros", () => {
    const e = estadoFx();
    // Ids mezclados a propósito: MUJER (orden 20) antes que HOMBRE (orden 10), y uno de un género inactivo.
    e.agrupaciones[0].genero_ids = ["g-x", "g-m", "g-h"];
    e.agrupaciones[1].genero_ids = [];
    const r = aplanarEquivalencias(e, e.agrupaciones, { incluirInactivos: false });
    const porId = new Map(r.agrupaciones.map((a) => [a.id, a.genero_ids]));
    expect(porId.get("a-ver")).toEqual(["g-h", "g-m", "g-x"]);
    expect(porId.get("a-inv")).toEqual([]); // "sin género": viaja vacía
    expect(porId.get("a-old")).toEqual(["g-h"]);
  });
  it("las filas ya traen genero_id (para validar contra genero_ids sin otra llamada)", () => {
    const r = activas();
    for (const f of r.equivalencias) expect(f.genero_id).toBeTruthy();
    expect(fila(r, "e5").genero_id).toBe("g-m");
  });
  it("no depende de que la agrupación incluya el género de la equivalencia (solo informa)", () => {
    const e = estadoFx();
    e.agrupaciones.find((a) => a.id === "a-inv")!.genero_ids = ["g-m"]; // e2 es de HOMBRE
    const r = aplanarEquivalencias(e, e.agrupaciones, { incluirInactivos: false });
    expect(fila(r, "e2")).toMatchObject({ faltante: false, motivo_faltante: null });
  });
});

describe("aplanarEquivalencias · regla 10: orden y resumen", () => {
  it("géneros y mundos por orden, líneas por nombre, equivalencias con la genérica al final", () => {
    expect(todas().equivalencias.map((e) => e.id)).toEqual([
      "e10", // HOMBRE / CASUAL / BLUSA (nodo inactivo)
      "e3", // HOMBRE / URBANO / PANTALON: CARGO, CHINO, FANTASMA, JOGGER, genérica
      "e4",
      "e12",
      "e2",
      "e1",
      "e9", // HOMBRE / FORMAL / PANTALON
      "e8", // MUJER / URBANO / ABRIGO
      "e7", // MUJER / URBANO / BLUSA
      "e5", // MUJER / URBANO / PANTALON: PANTALON, genérica
      "e6",
      "e11", // OTROS / URBANO / PANTALON
    ]);
  });
  it("resumen cuenta exactamente lo devuelto", () => {
    expect(activas().resumen).toEqual({
      equivalencias: 7,
      con_agrupacion: 3, // e2, e3 (inactiva), e6
      faltantes: 5,
      faltantes_genericas: 1, // e1
      faltantes_por_agrupacion_inactiva: 1, // e3
    });
    expect(todas().resumen).toEqual({
      equivalencias: 12,
      con_agrupacion: 3,
      faltantes: 5,
      faltantes_genericas: 1,
      faltantes_por_agrupacion_inactiva: 1,
    });
    expect(faltantes().resumen).toEqual({
      equivalencias: 5,
      con_agrupacion: 1,
      faltantes: 5,
      faltantes_genericas: 1,
      faltantes_por_agrupacion_inactiva: 1,
    });
  });
  it("faltantes = reales + genéricas y con_agrupacion + sin_agrupacion = equivalencias", () => {
    for (const r of [activas(), todas(), faltantes()]) {
      const faltantesReales = r.equivalencias.filter((e) => e.faltante && !e.es_generica).length;
      const sinAgrupacion = r.equivalencias.filter((e) => e.agrupacion === null).length;
      expect(r.resumen.faltantes).toBe(faltantesReales + r.resumen.faltantes_genericas);
      expect(r.resumen.con_agrupacion + sinAgrupacion).toBe(r.resumen.equivalencias);
      expect(r.resumen.equivalencias).toBe(r.equivalencias.length);
    }
  });
  it("no muta las entradas", () => {
    const e = estadoFx();
    const copia = JSON.parse(JSON.stringify(e));
    aplanarEquivalencias(e, e.agrupaciones, { incluirInactivos: true });
    expect(e).toEqual(copia);
  });
});
