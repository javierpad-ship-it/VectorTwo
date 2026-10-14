import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * M-2: desactivar un usuario lo bloquea en Auth con `ban_duration` (el
 * `signOut(id)` anterior pasaba un id donde auth-js espera un JWT) y reactivar
 * lo desbloquea. Si Auth falla el perfil no se toca; si falla el perfil, el
 * bloqueo vuelve a como estaba. Datos sintéticos; la base se simula.
 */

const ACTOR = { id: "00000000-0000-4000-8000-000000000001", rol: "admin", activo: true };
const OBJETIVO_ID = "00000000-0000-4000-8000-000000000002";

type Perfil = { id: string; email: string; nombre: string | null; rol: string; activo: boolean };
const perfilObjetivo = (activo: boolean): Perfil => ({ id: OBJETIVO_ID, email: "otra@ejemplo.test", nombre: null, rol: "planner", activo });

const estado = {
  objetivo: perfilObjetivo(true),
  errorAuth: null as { message: string; code?: string } | null,
  errorPerfil: null as { code: string; message: string } | null,
};
const updateUserById = vi.fn();
const signOut = vi.fn();
const actualizarPerfil = vi.fn();

function fakeDb() {
  return {
    auth: { admin: { updateUserById, signOut } },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: estado.objetivo, error: null }) }),
        then: (res: (v: unknown) => unknown) => res({ data: [ACTOR, estado.objetivo], error: null }),
      }),
      update: (cambios: object) => {
        actualizarPerfil(cambios);
        return {
          eq: () => ({
            select: () => ({
              single: async () =>
                estado.errorPerfil ? { data: null, error: estado.errorPerfil } : { data: { ...estado.objetivo, ...cambios }, error: null },
            }),
          }),
        };
      },
    }),
  };
}

vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin: () => fakeDb() }));
vi.mock("@/lib/auth/guard", () => ({
  requireAdmin: async () => ({ user: {}, perfil: ACTOR, rol: "admin", response: null }),
}));

import { PATCH } from "@/app/api/usuarios/[id]/route";

const patch = (cuerpo: object) =>
  PATCH(new Request(`http://localhost/api/usuarios/${OBJETIVO_ID}`, { method: "PATCH", body: JSON.stringify(cuerpo) }) as never, {
    params: Promise.resolve({ id: OBJETIVO_ID }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  estado.objetivo = perfilObjetivo(true);
  estado.errorAuth = null;
  estado.errorPerfil = null;
  updateUserById.mockImplementation(async () => ({ data: {}, error: estado.errorAuth }));
});

describe("PATCH /api/usuarios/[id]: activar y desactivar", () => {
  it("desactivar banea en Auth, guarda el perfil y no llama a signOut", async () => {
    const r = await patch({ activo: false });
    expect(r.status).toBe(200);
    expect(updateUserById).toHaveBeenCalledTimes(1);
    expect(updateUserById).toHaveBeenCalledWith(OBJETIVO_ID, { ban_duration: "876000h" });
    expect(signOut).not.toHaveBeenCalled();
    expect(actualizarPerfil).toHaveBeenCalledWith({ activo: false });
  });

  it("reactivar quita el bloqueo", async () => {
    estado.objetivo = perfilObjetivo(false);
    const r = await patch({ activo: true });
    expect(r.status).toBe(200);
    expect(updateUserById).toHaveBeenCalledWith(OBJETIVO_ID, { ban_duration: "none" });
    expect(actualizarPerfil).toHaveBeenCalledWith({ activo: true });
  });

  it("contraseña y bloqueo viajan en una sola llamada a Auth", async () => {
    await patch({ activo: false, password: "una-clave-larga-1" });
    expect(updateUserById).toHaveBeenCalledTimes(1);
    expect(updateUserById).toHaveBeenCalledWith(OBJETIVO_ID, { password: "una-clave-larga-1", ban_duration: "876000h" });
  });

  it("cambiar solo el nombre no toca Auth", async () => {
    const r = await patch({ nombre: "Ana" });
    expect(r.status).toBe(200);
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it("si Auth falla se informa el error con mensaje genérico y el perfil no se toca", async () => {
    estado.errorAuth = { message: "connection refused to db.interno:5432" };
    const r = await patch({ activo: false });
    const cuerpo = (await r.json()) as { error: string };
    expect(r.status).toBe(500);
    expect(cuerpo.error).not.toContain("interno");
    expect(actualizarPerfil).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
  });

  it("si falla el perfil, el bloqueo vuelve a como estaba", async () => {
    estado.errorPerfil = { code: "XX000", message: "detalle interno de postgres" };
    const r = await patch({ activo: false });
    const cuerpo = (await r.json()) as { error: string };
    expect(r.status).toBe(500);
    expect(cuerpo.error).not.toContain("postgres");
    expect(updateUserById).toHaveBeenCalledTimes(2);
    expect(updateUserById).toHaveBeenLastCalledWith(OBJETIVO_ID, { ban_duration: "none" });
  });
});
