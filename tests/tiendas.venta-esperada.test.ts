import { describe, expect, it } from "vitest";
import type { Tables } from "@/lib/supabase/database.types";
import { aTiendaFila } from "@/lib/tiendas/consultas";
import { eventosTiendas, type TiendaParaEventos } from "@/lib/tiendas/aperturas";
import { puedeEditarMaestros } from "@/lib/auth/roles";

/**
 * I-3: la venta esperada de una tienda es dato de planificación; el comprador
 * (que no puede editar maestros) la recibe en `null`. Los handlers pasan
 * `puedeEditarMaestros(rol)`; aquí se prueba la función pura y esa decisión.
 */

const HOY = "2026-10-05";

const fila = (extra: Partial<Tables<"tiendas">> = {}): Tables<"tiendas"> => ({
  id: "id-R1",
  codigo: "R1",
  nombre: "TIENDA UNO",
  tipo: "Tienda",
  zona: null,
  razon_social: null,
  tienda_referencia_id: null,
  fecha_apertura: "2027-03-01",
  fecha_cierre: null,
  venta_esperada_promedio: 85000,
  activo: true,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  ...extra,
});

const paraEventos = (extra: Partial<TiendaParaEventos> = {}): TiendaParaEventos => ({
  id: "id-R1",
  codigo: "R1",
  nombre: "TIENDA UNO",
  tipo: "Tienda",
  zona: null,
  fecha_apertura: "2027-03-01",
  fecha_cierre: null,
  venta_esperada_promedio: 85000,
  activo: true,
  ...extra,
});

describe("aTiendaFila y venta esperada", () => {
  it("por defecto (planner y admin) la devuelve como número", () => {
    expect(aTiendaFila(fila(), HOY).venta_esperada_promedio).toBe(85000);
    expect(aTiendaFila(fila({ venta_esperada_promedio: null }), HOY).venta_esperada_promedio).toBeNull();
  });

  it("sin permiso la devuelve en null y el resto de la fila no cambia", () => {
    const con = aTiendaFila(fila(), HOY, true);
    const sin = aTiendaFila(fila(), HOY, false);
    expect(sin.venta_esperada_promedio).toBeNull();
    expect({ ...sin, venta_esperada_promedio: 85000 }).toEqual(con);
  });
});

describe("eventosTiendas y venta esperada", () => {
  it("por defecto cada evento lleva la venta esperada", () => {
    const r = eventosTiendas([paraEventos()], HOY);
    expect(r.eventos[0].venta_esperada_promedio).toBe(85000);
  });

  it("sin permiso todos los eventos (apertura y cierre) la llevan en null y los conteos no cambian", () => {
    const tiendas = [paraEventos({ fecha_cierre: "2030-01-01" }), paraEventos({ id: "i2", codigo: "R2", fecha_apertura: "2027-05-01" })];
    const con = eventosTiendas(tiendas, HOY, {}, { verVentaEsperada: true });
    const sin = eventosTiendas(tiendas, HOY, {}, { verVentaEsperada: false });
    expect(sin.eventos).toHaveLength(3);
    expect(sin.eventos.every((e) => e.venta_esperada_promedio === null)).toBe(true);
    expect(sin.resumen).toEqual(con.resumen);
    expect(sin.eventos.map((e) => [e.codigo, e.evento])).toEqual(con.eventos.map((e) => [e.codigo, e.evento]));
  });
});

describe("quién ve la venta esperada", () => {
  it("solo admin y planner (los que pueden editar maestros)", () => {
    expect(puedeEditarMaestros("admin")).toBe(true);
    expect(puedeEditarMaestros("planner")).toBe(true);
    expect(puedeEditarMaestros("comprador")).toBe(false);
  });
});
