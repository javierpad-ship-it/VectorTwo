import { describe, expect, it } from "vitest";
import { filtrarCeldas } from "@/lib/responsables/filtros";
import { ANA, LUIS, PLANNER, asignacion, generos, matriz, mundos, perfiles, uuid } from "./responsables.fixture";

const asignaciones = [
  asignacion(1, 1, ANA),
  asignacion(1, 2, ANA),
  asignacion(2, 1, LUIS),
  asignacion(2, 2, PLANNER), // ya no es comprador
  asignacion(3, 1, ANA),
];
const desactivarAna = perfiles.map((p) => (p.id === LUIS ? { ...p, activo: false } : p));

describe("regla 11 · filtrarCeldas", () => {
  const m = matriz({ asignaciones, perfiles: desactivarAna });

  it("todas = las vigentes = resumen.combinaciones", () => {
    expect(filtrarCeldas(m.celdas, "todas")).toHaveLength(m.resumen.combinaciones);
    expect(filtrarCeldas(m.celdas, "todas")).toHaveLength(40);
  });

  it("faltantes = motivoFaltante ≠ null = resumen.faltantes (incluye desactivado y no comprador)", () => {
    const f = filtrarCeldas(m.celdas, "faltantes");
    expect(f).toHaveLength(m.resumen.faltantes);
    expect(f.every((c) => c.motivo_faltante !== null)).toBe(true);
    expect(f.some((c) => c.motivo_faltante === "responsable_inactivo")).toBe(true);
    expect(f.some((c) => c.motivo_faltante === "responsable_no_comprador")).toBe(true);
  });

  it("{ responsable } compara por perfil_id y no exige que sea válido", () => {
    expect(filtrarCeldas(m.celdas, { responsable: ANA })).toHaveLength(3);
    // LUIS está desactivado y aun así se ve, para poder corregirlo.
    expect(filtrarCeldas(m.celdas, { responsable: LUIS })).toHaveLength(1);
    expect(filtrarCeldas(m.celdas, { responsable: PLANNER })).toHaveLength(1);
    expect(filtrarCeldas(m.celdas, { responsable: uuid(999) })).toEqual([]);
  });

  it("'Mis combinaciones' coincide con la carga de resumen.por_responsable", () => {
    for (const carga of m.resumen.por_responsable) {
      expect(filtrarCeldas(m.celdas, { responsable: carga.perfil_id })).toHaveLength(carga.combinaciones);
    }
  });

  it("sin_responsable = vigentes sin fila", () => {
    expect(filtrarCeldas(m.celdas, "sin_responsable")).toHaveLength(40 - asignaciones.length);
    expect(filtrarCeldas(m.celdas, "sin_responsable").every((c) => c.responsable === null)).toBe(true);
  });

  it("las celdas no vigentes no entran en ningún filtro", () => {
    const inactivo = matriz({
      generos: generos.map((g, i) => (i === 0 ? { ...g, activo: false } : g)),
      mundos,
      asignaciones,
      perfiles: desactivarAna,
      incluirInactivos: true,
    });
    expect(filtrarCeldas(inactivo.celdas, "todas")).toHaveLength(7 * 5);
    expect(filtrarCeldas(inactivo.celdas, "faltantes").every((c) => c.genero_id !== uuid(1))).toBe(true);
    expect(filtrarCeldas(inactivo.celdas, { responsable: ANA })).toHaveLength(1); // solo (3,1)
    expect(filtrarCeldas(inactivo.celdas, "sin_responsable").every((c) => c.vigente)).toBe(true);
  });

  it("no muta la entrada", () => {
    const copia = JSON.stringify(m.celdas);
    filtrarCeldas(m.celdas, "faltantes");
    expect(JSON.stringify(m.celdas)).toBe(copia);
  });
});

describe("regla 12 · comprador con y sin combinaciones", () => {
  it("quien no tiene combinaciones obtiene 0 en 'Mis combinaciones'; quien tiene, más de 0", () => {
    const m = matriz({ asignaciones: [asignacion(1, 1, ANA)] });
    expect(filtrarCeldas(m.celdas, { responsable: LUIS })).toHaveLength(0);
    expect(filtrarCeldas(m.celdas, { responsable: ANA })).toHaveLength(1);
    // Ningún filtro cambia lo que recibió el cliente: "todas" siempre trae las 40.
    expect(filtrarCeldas(m.celdas, "todas")).toHaveLength(40);
  });
});
