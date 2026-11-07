import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { IDS, PERFILES, escenario, eventosProveedor, llamadasA, reiniciarEscenario, tabla } from "./e1.fake-db";
import { FICHA_VALIDA } from "./proveedores.fixture";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/guard", async () => (await import("./e1.fake-db")).guardFalso());
vi.mock("@/lib/supabase/admin", async () => {
  const { clienteFalso } = await import("./e1.fake-db");
  return { supabaseAdmin: () => clienteFalso() };
});

import { GET as listar, POST as crear } from "@/app/api/compras/proveedores/route";
import { DELETE as eliminar, GET as detalle, PATCH as editar } from "@/app/api/compras/proveedores/[id]/route";
import { POST as cambiarActivo } from "@/app/api/compras/proveedores/[id]/activo/route";
import { GET as historial } from "@/app/api/compras/proveedores/[id]/historial/route";
import type { EventoProveedorApi, ProveedorDetalleApi, ProveedorFichaApi, ProveedorListadoApi } from "@/lib/proveedores/tipos-api";

const URL_BASE = "http://localhost/api/compras/proveedores";
const get = (ruta = "", consulta = "") => new NextRequest(`${URL_BASE}${ruta}${consulta}`);
const enviar = (metodo: string, ruta: string, cuerpo?: unknown) =>
  new NextRequest(`${URL_BASE}${ruta}`, { method: metodo, ...(cuerpo === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo) }) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const leer = async <T>(r: Response) => ({ status: r.status, ...((await r.json()) as { data: T; error?: string; codigo?: string; conflicto?: { id: string; nombre: string; activo: boolean }; parecidos?: { id: string; nombre: string }[]; revision?: number }) });
const como = (rol: "admin" | "planner" | "comprador" | "sin_sesion") => {
  escenario.usuario = rol === "sin_sesion" ? { rol, perfil: PERFILES.planner } : { rol, perfil: PERFILES[rol] };
};

beforeEach(() => {
  reiniciarEscenario();
});

describe("GET /api/compras/proveedores", () => {
  it("trae contactos, compras no canceladas y si la ficha está completa; nunca clave_origen ni datos internos", async () => {
    const r = await leer<ProveedorListadoApi[]>(await listar(get()));
    expect(r.status).toBe(200);
    expect(r.data.map((p) => [p.nombre, p.compras, p.contactos.length, p.completo])).toEqual([
      ["Feria Sur", 1, 0, false],
      ["Proveedor Norte", 2, 1, false],
      ["Textiles Delta Ltd.", 0, 0, false],
    ]);
    const crudo = JSON.stringify(r.data);
    for (const prohibida of ["clave_origen", "secreto-que-no-sale", "perfil_id", "banco", "cuenta"]) expect(crudo, prohibida).not.toContain(prohibida);
    expect(r.data[1]).toMatchObject({ region: "Zhejiang", puerto_embarque: "Ningbo", incoterm: "FOB", moneda: "USD" });
  });

  it("R16 · activos=1 deja fuera a los inactivos y q filtra sin distinguir tildes ni mayúsculas", async () => {
    expect((await leer<ProveedorListadoApi[]>(await listar(get("", "?activos=1")))).data.map((p) => p.nombre)).toEqual(["Feria Sur", "Proveedor Norte"]);
    expect((await leer<ProveedorListadoApi[]>(await listar(get("", "?q=SUR")))).data.map((p) => p.nombre)).toEqual(["Feria Sur"]);
    expect((await leer<ProveedorListadoApi[]>(await listar(get("", "?q=ningbo")))).data.map((p) => p.nombre)).toEqual(["Proveedor Norte"]);
    expect((await listar(get("", "?activos=0"))).status).toBe(400);
  });

  it("sin sesión responde 401; el comprador puede leer", async () => {
    como("sin_sesion");
    expect((await listar(get())).status).toBe(401);
    como("comprador");
    expect((await listar(get())).status).toBe(200);
  });
});

describe("GET /api/compras/proveedores/[id]", () => {
  it("trae la ficha con contactos, permisos del rol y el resumen de compras (sin las canceladas)", async () => {
    como("comprador");
    const r = await leer<ProveedorDetalleApi>(await detalle(get(`/${IDS.provNorte}`), ctx(IDS.provNorte)));
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({
      nombre: "Proveedor Norte",
      revision: 0,
      faltan: ["identificacion", "direccion"],
      puede: { editar: true, cambiar_intercompany: false, desactivar: false, eliminar: false },
      resumen: { compras: 2, ultima_compra: "2026-10-10", unidades: 200, costo: { USD: 630, PEN: 0 } },
    });
    expect(r.data.contactos).toHaveLength(1);
    expect(r.data.modificado_por).toBeNull();
    expect(JSON.stringify(r.data)).not.toContain("clave_origen");
  });

  it("404 si no existe o el id no es un UUID", async () => {
    const otro = "10000000-0000-4000-8000-0000000000ff";
    const r = await leer(await detalle(get(`/${otro}`), ctx(otro)));
    expect([r.status, r.error]).toEqual([404, "No encontramos ese proveedor."]);
    expect((await detalle(get("/x"), ctx("x"))).status).toBe(404);
  });
});

describe("POST /api/compras/proveedores", () => {
  it("R13 · crea con la ficha completa (201), el primer contacto pasa a principal y queda el evento crear", async () => {
    como("comprador");
    const r = await leer<ProveedorFichaApi>(await crear(enviar("POST", "", { ...FICHA_VALIDA, contactos: [{ nombre: "Uno" }, { nombre: "Dos" }] })));
    expect(r.status).toBe(201);
    expect(r.data).toMatchObject({ nombre: "Feria Norte", revision: 0, activo: true, es_intercompany: false, completo: false });
    expect(r.data.contactos.map((c) => [c.nombre, c.es_principal])).toEqual([["Uno", true], ["Dos", false]]);
    expect(r.data.creado_por.nombre).toBe("Comprador Uno");
    expect(eventosProveedor(r.data.id).map((e) => e.accion)).toEqual(["crear"]);
  });

  it("R11 · «FERIA SUR » choca con «Feria Sur»: 409 nombre_repetido con el conflicto", async () => {
    const r = await leer(await crear(enviar("POST", "", { ...FICHA_VALIDA, nombre: "FERIA SUR " })));
    expect([r.status, r.codigo, r.conflicto]).toEqual([409, "nombre_repetido", { id: IDS.provSur, nombre: "Feria Sur", activo: true }]);
    expect(llamadasA("guardar_proveedor")).toHaveLength(0);
  });

  it("R11 · si el repetido está inactivo, el mensaje pide reactivarlo", async () => {
    const r = await leer(await crear(enviar("POST", "", { ...FICHA_VALIDA, nombre: "textiles delta ltd." })));
    expect(r.status).toBe(409);
    expect(r.error).toBe("Existe «Textiles Delta Ltd.», pero está inactivo: pide a un admin o planner que lo reactive.");
    expect(r.conflicto?.activo).toBe(false);
  });

  it("R11 · código repetido: 409 codigo_repetido (la base atrapa la carrera)", async () => {
    const r = await leer(await crear(enviar("POST", "", { ...FICHA_VALIDA, codigo: "delta" })));
    expect([r.status, r.codigo]).toEqual([409, "codigo_repetido"]);
    expect(r.conflicto?.nombre).toBe("Textiles Delta Ltd.");
  });

  it("R12 · modo rápido con un nombre parecido: 409 nombre_parecido con la lista; con confirmar_parecido crea", async () => {
    const r = await leer(await crear(enviar("POST", "", { modo: "rapido", nombre: "Feria Sure" })));
    expect([r.status, r.codigo]).toEqual([409, "nombre_parecido"]);
    expect(r.parecidos?.map((p) => p.nombre)).toEqual(["Feria Sur"]);
    expect(llamadasA("guardar_proveedor")).toHaveLength(0);
    const ok = await leer<ProveedorFichaApi>(await crear(enviar("POST", "", { modo: "rapido", nombre: "Feria Sure", confirmar_parecido: true })));
    expect(ok.status).toBe(201);
    expect(ok.data.faltan).toEqual(["pais", "identificacion", "direccion", "contacto"]);
  });

  it("modo rápido sin parecidos crea con «Ficha incompleta»; un nombre repetido da 409 nombre_repetido también aquí", async () => {
    const ok = await leer<ProveedorFichaApi>(await crear(enviar("POST", "", { modo: "rapido", nombre: "Hilados Andinos SAC", pais: "Perú" })));
    expect([ok.status, ok.data.pais, ok.data.completo]).toEqual([201, "Perú", false]);
    const dup = await leer(await crear(enviar("POST", "", { modo: "rapido", nombre: "feria sur" })));
    expect([dup.status, dup.codigo]).toEqual([409, "nombre_repetido"]);
  });

  it("el modo ficha avisa de parecidos sin bloquear", async () => {
    const r = await leer<ProveedorFichaApi>(await crear(enviar("POST", "", { ...FICHA_VALIDA, nombre: "Feria Sure" })));
    expect(r.status).toBe(201);
    expect(r.data.parecidos?.map((p) => p.nombre)).toEqual(["Feria Sur"]);
  });

  it("R16 · un comprador no marca intercompany al crear (403); el planner sí", async () => {
    como("comprador");
    const r = await leer(await crear(enviar("POST", "", { ...FICHA_VALIDA, es_intercompany: true })));
    expect([r.status, r.codigo]).toEqual([403, "solo_planner_intercompany"]);
    expect(llamadasA("guardar_proveedor")).toHaveLength(0);
    como("planner");
    const ok = await leer<ProveedorFichaApi>(await crear(enviar("POST", "", { ...FICHA_VALIDA, es_intercompany: true })));
    expect([ok.status, ok.data.es_intercompany]).toEqual([201, true]);
  });

  it("R17 · datos bancarios o clave_origen: 400; ficha sin país: 400; sin sesión 401", async () => {
    expect((await crear(enviar("POST", "", { ...FICHA_VALIDA, banco: "x" }))).status).toBe(400);
    expect((await crear(enviar("POST", "", { ...FICHA_VALIDA, clave_origen: "cotv:supplier:1" }))).status).toBe(400);
    expect((await crear(enviar("POST", "", { nombre: "Sin país" }))).status).toBe(400);
    como("sin_sesion");
    expect((await crear(enviar("POST", "", FICHA_VALIDA))).status).toBe(401);
  });
});

describe("PATCH /api/compras/proveedores/[id]", () => {
  const cuerpo = (extra: Record<string, unknown> = {}) => ({ nombre: "Proveedor Norte", pais: "China", region: "Zhejiang", puerto_embarque: "Ningbo", incoterm: "FOB", moneda: "USD", revision: 0, ...extra });

  it("edita con la revisión vigente: sube la revisión, deja el evento editar y reemplaza los contactos en la misma llamada", async () => {
    como("comprador");
    const r = await leer<ProveedorFichaApi>(await editar(enviar("PATCH", `/${IDS.provNorte}`, cuerpo({ nombre: "Proveedor Norte Ltd.", contactos: [{ nombre: "Luis", es_principal: true }] })), ctx(IDS.provNorte)));
    expect(r.status).toBe(200);
    expect([r.data.nombre, r.data.revision]).toEqual(["Proveedor Norte Ltd.", 1]);
    expect(r.data.contactos.map((c) => c.nombre)).toEqual(["Luis"]);
    expect(r.data.modificado_por?.nombre).toBe("Comprador Uno");
    expect(llamadasA("guardar_proveedor")).toHaveLength(1);
    const ev = eventosProveedor(IDS.provNorte);
    expect(ev.map((e) => e.accion)).toEqual(["editar"]);
  });

  it("R15 · con una revisión vieja: 409 proveedor_cambio sin escribir nada", async () => {
    await editar(enviar("PATCH", `/${IDS.provNorte}`, cuerpo({ nota: "uno" })), ctx(IDS.provNorte));
    const r = await leer(await editar(enviar("PATCH", `/${IDS.provNorte}`, cuerpo({ nota: "dos" })), ctx(IDS.provNorte)));
    expect([r.status, r.codigo, r.revision]).toEqual([409, "proveedor_cambio", 1]);
    expect(tabla("proveedores").find((p) => p.id === IDS.provNorte)?.nota).toBe("uno");
    expect(eventosProveedor(IDS.provNorte)).toHaveLength(1);
  });

  it("un guardado sin cambios no sube la revisión ni deja evento; sin `contactos` se conservan", async () => {
    const r = await leer<ProveedorFichaApi>(await editar(enviar("PATCH", `/${IDS.provNorte}`, cuerpo()), ctx(IDS.provNorte)));
    expect([r.status, r.data.revision, r.data.contactos.length]).toEqual([200, 0, 1]);
    expect(eventosProveedor(IDS.provNorte)).toHaveLength(0);
  });

  it("R16 · un comprador que cambia es_intercompany: 403; si lo manda igual que está, pasa; el planner puede cambiarlo", async () => {
    como("comprador");
    const r = await leer(await editar(enviar("PATCH", `/${IDS.provNorte}`, cuerpo({ es_intercompany: true })), ctx(IDS.provNorte)));
    expect([r.status, r.codigo]).toEqual([403, "solo_planner_intercompany"]);
    expect(llamadasA("guardar_proveedor")).toHaveLength(0);
    expect((await editar(enviar("PATCH", `/${IDS.provNorte}`, cuerpo({ es_intercompany: false, nota: "ok" })), ctx(IDS.provNorte))).status).toBe(200);
    como("planner");
    const p = await leer<ProveedorFichaApi>(await editar(enviar("PATCH", `/${IDS.provNorte}`, cuerpo({ es_intercompany: true, nota: "ok", revision: 1 })), ctx(IDS.provNorte)));
    expect([p.status, p.data.es_intercompany]).toEqual([200, true]);
  });

  it("R11 · renombrar a un nombre que ya existe: 409 nombre_repetido; 404 si el proveedor no existe", async () => {
    const r = await leer(await editar(enviar("PATCH", `/${IDS.provNorte}`, cuerpo({ nombre: "feria sur" })), ctx(IDS.provNorte)));
    expect([r.status, r.codigo]).toEqual([409, "nombre_repetido"]);
    const otro = "10000000-0000-4000-8000-0000000000ff";
    expect((await editar(enviar("PATCH", `/${otro}`, cuerpo()), ctx(otro))).status).toBe(404);
  });

  it("falta la revisión: 400; sin sesión: 401", async () => {
    const { revision: _omitida, ...sinRevision } = cuerpo();
    void _omitida;
    expect((await editar(enviar("PATCH", `/${IDS.provNorte}`, sinRevision), ctx(IDS.provNorte))).status).toBe(400);
    como("sin_sesion");
    expect((await editar(enviar("PATCH", `/${IDS.provNorte}`, cuerpo()), ctx(IDS.provNorte))).status).toBe(401);
  });
});

describe("POST …/activo y DELETE", () => {
  it("R16 · desactivar y eliminar son del planner: el comprador recibe 403 y no toca nada", async () => {
    como("comprador");
    expect((await cambiarActivo(enviar("POST", `/${IDS.provNorte}/activo`, { activo: false }), ctx(IDS.provNorte))).status).toBe(403);
    expect((await eliminar(enviar("DELETE", `/${IDS.provNorte}`), ctx(IDS.provNorte))).status).toBe(403);
    expect(escenario.llamadas).toHaveLength(0);
  });

  it("el planner desactiva y reactiva (sube la revisión, un evento cada vez); sin cambio de estado no escribe", async () => {
    const r = await leer<ProveedorFichaApi>(await cambiarActivo(enviar("POST", `/${IDS.provNorte}/activo`, { activo: false }), ctx(IDS.provNorte)));
    expect([r.status, r.data.activo, r.data.revision]).toEqual([200, false, 1]);
    const otra = await leer<ProveedorFichaApi>(await cambiarActivo(enviar("POST", `/${IDS.provNorte}/activo`, { activo: false }), ctx(IDS.provNorte)));
    expect(otra.data.revision).toBe(1);
    const re = await leer<ProveedorFichaApi>(await cambiarActivo(enviar("POST", `/${IDS.provNorte}/activo`, { activo: true }), ctx(IDS.provNorte)));
    expect([re.data.activo, re.data.revision]).toEqual([true, 2]);
    expect(eventosProveedor(IDS.provNorte).map((e) => e.accion)).toEqual(["desactivar", "reactivar"]);
    expect((await cambiarActivo(enviar("POST", `/${IDS.provNorte}/activo`, { activo: "no" }), ctx(IDS.provNorte))).status).toBe(400);
    const otroId = "10000000-0000-4000-8000-0000000000ff";
    expect((await cambiarActivo(enviar("POST", `/${otroId}/activo`, { activo: true }), ctx(otroId))).status).toBe(404);
  });

  it("R16 · eliminar un proveedor con compras lo desactiva; sin compras lo borra y su historial queda con proveedor_id nulo", async () => {
    const con = await leer<{ accion: string }>(await eliminar(enviar("DELETE", `/${IDS.provSur}`), ctx(IDS.provSur)));
    expect([con.status, con.data.accion]).toEqual([200, "desactivado"]);
    expect(tabla("proveedores").find((p) => p.id === IDS.provSur)?.activo).toBe(false);

    const nuevo = await leer<ProveedorFichaApi>(await crear(enviar("POST", "", FICHA_VALIDA)));
    const sin = await leer<{ accion: string }>(await eliminar(enviar("DELETE", `/${nuevo.data.id}`), ctx(nuevo.data.id)));
    expect([sin.status, sin.data.accion]).toEqual([200, "borrado"]);
    expect(tabla("proveedores").some((p) => p.id === nuevo.data.id)).toBe(false);
    expect(tabla("proveedor_eventos").filter((e) => e.proveedor_id === null).map((e) => e.accion).sort()).toEqual(["crear", "eliminar"]);
    expect((await eliminar(enviar("DELETE", `/${nuevo.data.id}`), ctx(nuevo.data.id))).status).toBe(404);
  });
});

describe("GET /api/compras/proveedores/[id]/historial", () => {
  it("RP4 · renombrar deja el nombre anterior y el nuevo; los eventos van del más reciente al más antiguo", async () => {
    como("comprador");
    await editar(enviar("PATCH", `/${IDS.provNorte}`, { nombre: "Proveedor Norte Ltd.", pais: "China", region: "Zhejiang", puerto_embarque: "Ningbo", incoterm: "FOB", moneda: "USD", revision: 0 }), ctx(IDS.provNorte));
    como("planner");
    await cambiarActivo(enviar("POST", `/${IDS.provNorte}/activo`, { activo: false }), ctx(IDS.provNorte));
    const r = await leer<EventoProveedorApi[]>(await historial(get(`/${IDS.provNorte}/historial`), ctx(IDS.provNorte)));
    expect(r.status).toBe(200);
    expect(r.data.map((e) => e.accion)).toEqual(["desactivar", "editar"]);
    expect(r.data[1].cambios).toEqual([{ campo: "Nombre", antes: "Proveedor Norte", despues: "Proveedor Norte Ltd." }]);
    expect(r.data[1].por.nombre).toBe("Comprador Uno");
  });

  it("404 si el proveedor no existe; sin sesión 401", async () => {
    const otro = "10000000-0000-4000-8000-0000000000ff";
    expect((await historial(get(`/${otro}/historial`), ctx(otro))).status).toBe(404);
    como("sin_sesion");
    expect((await historial(get(`/${IDS.provNorte}/historial`), ctx(IDS.provNorte))).status).toBe(401);
  });
});
