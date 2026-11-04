import { describe, expect, it } from "vitest";
import { esAsignable, esMio, perfilesAsignables, responsableEfectivo, validarResponsable } from "@/lib/compras/agrupadores/responsable";
import { PERFIL_AGR, perfilesAgrupadores } from "./agrupadores.fixture";

/** R26 y §2.8 · caso 9: responsables asignables y efectivos (decisión 85). */

const perfiles = perfilesAgrupadores();

describe("R26: asignables = comprador o admin activos (el planner no)", () => {
  it("esAsignable", () => {
    expect(esAsignable({ rol: "comprador", activo: true })).toBe(true);
    expect(esAsignable({ rol: "admin", activo: true })).toBe(true);
    expect(esAsignable({ rol: "planner", activo: true })).toBe(false);
    expect(esAsignable({ rol: "comprador", activo: false })).toBe(false);
    expect(esAsignable({ rol: "admin", activo: false })).toBe(false);
    expect(esAsignable(undefined)).toBe(false);
    expect(esAsignable(null)).toBe(false);
  });

  it("perfilesAsignables deja a C1, C2 y A (C3 inactivo y el planner, fuera)", () => {
    expect(perfilesAsignables(perfiles).map((p) => p.nombre)).toEqual(["Comprador C1", "Comprador C2", "Admin A"]);
  });

  it("validarResponsable: el admin es asignable; un planner da responsable_no_asignable; también uno inactivo o inexistente", () => {
    expect(validarResponsable(PERFIL_AGR.a, perfiles)).toEqual({ ok: true });
    expect(validarResponsable(PERFIL_AGR.c1, perfiles)).toEqual({ ok: true });
    expect(validarResponsable(PERFIL_AGR.pl, perfiles)).toEqual({ ok: false, motivo: "responsable_no_asignable" });
    expect(validarResponsable(PERFIL_AGR.c3, perfiles)).toEqual({ ok: false, motivo: "responsable_no_asignable" });
    expect(validarResponsable("00000000-0000-4000-8000-000000000000", perfiles)).toEqual({ ok: false, motivo: "responsable_no_asignable" });
  });

  it("sin responsable (nulo o ausente) es válido: hereda", () => {
    expect(validarResponsable(null, perfiles)).toEqual({ ok: true });
    expect(validarResponsable(undefined, perfiles)).toEqual({ ok: true });
  });
});

describe("caso 9: responsable efectivo = paquete ?? embarque ?? viaje", () => {
  it("P261101 → C2 (propio)", () => {
    const r = responsableEfectivo({ propio: PERFIL_AGR.c2, embarque: null, viaje: PERFIL_AGR.c1 }, perfiles);
    expect(r).toEqual({ efectivo: { perfil_id: PERFIL_AGR.c2, nombre: "Comprador C2", origen: "propio" }, faltante: false });
  });

  it("P261102 → C1 (del viaje, a través del embarque que hereda)", () => {
    const r = responsableEfectivo({ propio: null, embarque: null, viaje: PERFIL_AGR.c1 }, perfiles);
    expect(r.efectivo).toEqual({ perfil_id: PERFIL_AGR.c1, nombre: "Comprador C1", origen: "viaje" });
    expect(r.faltante).toBe(false);
  });

  it("un paquete sin responsable hereda el del embarque antes que el del viaje", () => {
    const r = responsableEfectivo({ propio: null, embarque: PERFIL_AGR.c2, viaje: PERFIL_AGR.c1 }, perfiles);
    expect(r.efectivo).toMatchObject({ perfil_id: PERFIL_AGR.c2, origen: "embarque" });
  });

  it("el embarque 261101 hereda a C1 del viaje", () => {
    expect(responsableEfectivo({ propio: null, viaje: PERFIL_AGR.c1 }, perfiles).efectivo).toMatchObject({ perfil_id: PERFIL_AGR.c1, origen: "viaje" });
  });

  it("270301 (sin viaje ni responsable) → sin efectivo y sin_responsable", () => {
    expect(responsableEfectivo({ propio: null, viaje: null }, perfiles)).toEqual({ efectivo: null, faltante: true });
    expect(responsableEfectivo({}, perfiles)).toEqual({ efectivo: null, faltante: true });
  });

  it("261102 (local, de C3 inactivo) → C3, faltante: se conserva la asignación y se avisa", () => {
    const r = responsableEfectivo({ propio: PERFIL_AGR.c3 }, perfiles);
    expect(r.efectivo).toEqual({ perfil_id: PERFIL_AGR.c3, nombre: "Comprador C3", origen: "propio" });
    expect(r.faltante).toBe(true);
  });

  it("el admin como responsable no es faltante; un admin que pasa a planner sí", () => {
    expect(responsableEfectivo({ propio: PERFIL_AGR.a }, perfiles).faltante).toBe(false);
    const cambiado = perfiles.map((p) => (p.id === PERFIL_AGR.a ? { ...p, rol: "planner" as const } : p));
    expect(responsableEfectivo({ propio: PERFIL_AGR.a }, cambiado).faltante).toBe(true);
    const desactivado = perfiles.map((p) => (p.id === PERFIL_AGR.a ? { ...p, activo: false } : p));
    expect(responsableEfectivo({ propio: PERFIL_AGR.a }, desactivado).faltante).toBe(true);
  });

  it("un efectivo no asignable NO cae al nivel siguiente", () => {
    const r = responsableEfectivo({ propio: PERFIL_AGR.c3, viaje: PERFIL_AGR.c1 }, perfiles);
    expect(r.efectivo?.perfil_id).toBe(PERFIL_AGR.c3);
    expect(r.faltante).toBe(true);
  });

  it("un perfil borrado (la asignación quedó en nulo) cuenta como sin efectivo; uno que ya no existe en la lista, sin nombre y faltante", () => {
    expect(responsableEfectivo({ propio: null }, perfiles).faltante).toBe(true);
    const r = responsableEfectivo({ propio: "11111111-1111-4111-8111-111111111111" }, perfiles);
    expect(r.efectivo?.nombre).toBeNull();
    expect(r.faltante).toBe(true);
  });
});

describe("«Mis…» es un filtro, nunca un permiso", () => {
  it("esMio compara con el responsable efectivo", () => {
    const efectivo = responsableEfectivo({ propio: null, viaje: PERFIL_AGR.c1 }, perfiles).efectivo;
    expect(esMio(efectivo, PERFIL_AGR.c1)).toBe(true);
    expect(esMio(efectivo, PERFIL_AGR.c2)).toBe(false);
    expect(esMio(null, PERFIL_AGR.c1)).toBe(false);
  });
});
