import { describe, expect, it } from "vitest";
import { asignarMasivaSchema, asignarUnaSchema, MAX_COMBINACIONES_BLOQUE } from "@/lib/responsables/esquemas";
import { uuid } from "./responsables.fixture";

const par = (n: number) => ({ genero_id: uuid(n), mundo_id: uuid(100 + n) });

describe("regla 8 · asignarUnaSchema", () => {
  it("acepta un perfil y también null (quitar)", () => {
    expect(asignarUnaSchema.safeParse({ ...par(1), perfil_id: uuid(9) }).success).toBe(true);
    expect(asignarUnaSchema.safeParse({ ...par(1), perfil_id: null }).success).toBe(true);
  });
  it("exige perfil_id presente: sin él es 400, no 'quitar'", () => {
    const r = asignarUnaSchema.safeParse(par(1));
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0].path).toEqual(["perfil_id"]);
      expect(r.error.issues[0].message).toMatch(/null para quitar/);
    }
  });
  it("rechaza cuerpo vacío e ids que no son UUID", () => {
    expect(asignarUnaSchema.safeParse({}).success).toBe(false);
    expect(asignarUnaSchema.safeParse({ ...par(1), genero_id: "x", perfil_id: null }).success).toBe(false);
    expect(asignarUnaSchema.safeParse({ ...par(1), mundo_id: 5, perfil_id: null }).success).toBe(false);
    expect(asignarUnaSchema.safeParse({ ...par(1), perfil_id: "no-uuid" }).success).toBe(false);
    expect(asignarUnaSchema.safeParse({ ...par(1), perfil_id: "" }).success).toBe(false);
  });
});

describe("regla 8 · asignarMasivaSchema", () => {
  const valido = { combinaciones: [par(1), par(2)], perfil_id: uuid(9) };

  it("solo_faltantes es false por defecto", () => {
    const r = asignarMasivaSchema.safeParse(valido);
    expect(r.success && r.data.solo_faltantes).toBe(false);
  });
  it("acepta solo_faltantes con perfil y quitar sin solo_faltantes", () => {
    expect(asignarMasivaSchema.safeParse({ ...valido, solo_faltantes: true }).success).toBe(true);
    expect(asignarMasivaSchema.safeParse({ ...valido, perfil_id: null }).success).toBe(true);
    expect(asignarMasivaSchema.safeParse({ ...valido, perfil_id: null, solo_faltantes: false }).success).toBe(true);
  });
  it("rechaza perfil_id null con solo_faltantes true, con el mensaje de la ficha", () => {
    const r = asignarMasivaSchema.safeParse({ ...valido, perfil_id: null, solo_faltantes: true });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0].message).toBe("No se puede quitar el responsable solo a las faltantes.");
      expect(r.error.issues[0].path).toEqual(["solo_faltantes"]);
    }
  });
  it("rechaza lista vacía y más de 400", () => {
    expect(asignarMasivaSchema.safeParse({ ...valido, combinaciones: [] }).success).toBe(false);
    const muchas = Array.from({ length: MAX_COMBINACIONES_BLOQUE }, (_, i) => par(i + 1));
    expect(asignarMasivaSchema.safeParse({ ...valido, combinaciones: muchas }).success).toBe(true);
    expect(asignarMasivaSchema.safeParse({ ...valido, combinaciones: [...muchas, par(999)] }).success).toBe(false);
  });
  it("rechaza ids que no son UUID, perfil_id ausente y solo_faltantes que no es booleano", () => {
    expect(asignarMasivaSchema.safeParse({ ...valido, combinaciones: [{ genero_id: "x", mundo_id: uuid(1) }] }).success).toBe(false);
    expect(asignarMasivaSchema.safeParse({ combinaciones: valido.combinaciones }).success).toBe(false);
    expect(asignarMasivaSchema.safeParse({ ...valido, solo_faltantes: "si" }).success).toBe(false);
    expect(asignarMasivaSchema.safeParse({ ...valido, perfil_id: "no-uuid" }).success).toBe(false);
    expect(asignarMasivaSchema.safeParse({ perfil_id: null }).success).toBe(false);
  });
});
