import { describe, expect, it } from "vitest";
import { motivoRechazo, quedaAlgunAdminActivo } from "@/lib/usuarios/reglas";

const admin = { id: "a", rol: "admin", activo: true };
const otroAdmin = { id: "b", rol: "admin", activo: true };
const planner = { id: "p", rol: "planner", activo: true };

describe("quedaAlgunAdminActivo", () => {
  it("rechaza dejar el sistema sin admin al degradar al único", () => {
    expect(quedaAlgunAdminActivo([admin, planner], admin, { rol: "planner" })).toBe(false);
  });
  it("permite degradar si queda otro admin activo", () => {
    expect(quedaAlgunAdminActivo([admin, otroAdmin], admin, { rol: "planner" })).toBe(true);
  });
  it("cuenta la eliminación como pérdida del admin", () => {
    expect(quedaAlgunAdminActivo([admin, planner], admin, { eliminar: true })).toBe(false);
  });
  it("un admin inactivo no cuenta", () => {
    const inactivo = { ...otroAdmin, activo: false };
    expect(quedaAlgunAdminActivo([admin, inactivo], admin, { activo: false })).toBe(false);
  });
});

describe("motivoRechazo", () => {
  it("no deja que un admin se elimine a sí mismo", () => {
    expect(motivoRechazo(admin, admin, [admin, otroAdmin], { eliminar: true })).toMatch(/propio/);
  });
  it("no deja que un admin se desactive a sí mismo", () => {
    expect(motivoRechazo(admin, admin, [admin, otroAdmin], { activo: false })).toMatch(/propio/);
  });
  it("no deja que un admin se quite el rol", () => {
    expect(motivoRechazo(admin, admin, [admin, otroAdmin], { rol: "planner" })).toMatch(/rol/);
  });
  it("permite cambiar el nombre propio", () => {
    expect(motivoRechazo(admin, admin, [admin], { })).toBeNull();
  });
  it("permite editar a otro si queda un admin", () => {
    expect(motivoRechazo(admin, planner, [admin, planner], { rol: "comprador" })).toBeNull();
    expect(motivoRechazo(admin, otroAdmin, [admin, otroAdmin], { rol: "planner" })).toBeNull();
  });
  it("protege al último admin aunque lo edite otro", () => {
    const soloAdmin = { ...otroAdmin };
    expect(motivoRechazo(planner, soloAdmin, [soloAdmin, planner], { activo: false })).toMatch(/al menos un administrador/);
  });
});
