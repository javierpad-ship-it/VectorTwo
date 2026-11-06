import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { IDS, PERFILES, escenario, eventosDe, llamadasA, reiniciarEscenario, tablaDe } from "./compras.fake-db";

// Los módulos de la base y de las fuentes se cargan dentro de la fábrica para que sean los mismos que importa este archivo.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/guard", async () => (await import("./compras.fake-db")).guardFalso());
vi.mock("@/lib/supabase/admin", async () => {
  const { clienteFalso: cliente } = await import("./compras.fake-db");
  return { supabaseAdmin: () => cliente() };
});
vi.mock("@/lib/proyeccion/servicio", async (original) => {
  const real = await original<typeof import("@/lib/proyeccion/servicio")>();
  const falso = await import("./compras.fake-db");
  return { ...real, leerCerradaParaFlujo: async (anio: number) => ({ data: falso.cerradaFalsa(anio), respuesta: null }) };
});
vi.mock("@/lib/marcas-barrer/servicio", async (original) => {
  const real = await original<typeof import("@/lib/marcas-barrer/servicio")>();
  const falso = await import("./compras.fake-db");
  return { ...real, leerRepartosVigentes: async () => ({ data: falso.repartosVigentesFalsos(), respuesta: null }) };
});
vi.mock("@/lib/intercompany/servicio", async (original) => {
  const real = await original<typeof import("@/lib/intercompany/servicio")>();
  const falso = await import("./compras.fake-db");
  return {
    ...real,
    leerVigentes: async () => {
      falso.escenario.lecturas.reglas += 1;
      return { data: { reglas: [], marcas: [] }, respuesta: null };
    },
  };
});
vi.mock("@/lib/marcas/gml/estado", async () => {
  const falso = await import("./compras.fake-db");
  return {
    cargarEstadoGml: async () => {
      falso.escenario.lecturas.configuracion += 1;
      return { error: null, ...falso.estadoGmlFalso() };
    },
  };
});
vi.mock("@/lib/arbol/consultas", async (original) => {
  const real = await original<typeof import("@/lib/arbol/consultas")>();
  const falso = await import("./compras.fake-db");
  return { ...real, leerEquivalencias: async () => ({ data: falso.equivalenciasDelEscenario(), error: null }) };
});
vi.mock("@/lib/responsables/consultas", async () => {
  const falso = await import("./compras.fake-db");
  return {
    leerAsignaciones: async () => ({ data: falso.escenario.asignaciones.map((a, i) => ({ id: `asig-${i}`, ...a })), error: null }),
    leerPerfiles: async () => ({ data: Object.values(falso.PERFILES).map((p) => ({ id: p.id, nombre: p.nombre, email: p.email, rol: p.rol, activo: true })), error: null }),
  };
});
vi.mock("@/lib/tiendas/consultas", async () => {
  const falso = await import("./compras.fake-db");
  return { leerTiendas: async () => ({ data: falso.tiendasFalsas(), error: null }) };
});
vi.mock("@/lib/proyeccion/contexto", async () => ({
  cargarContextoCalculo: async () => ({ data: { nodos: [], vigentes: [], agrupaciones: [], periodosClase: [], factores: [], hastaDefecto: "2026-09" }, respuesta: null }),
}));

import { PUT as editarOc } from "@/app/api/compras/[id]/oc/route";
import { GET as listaCompras } from "@/app/api/compras/route";
import { GET as unaCompra } from "@/app/api/compras/[id]/route";
import { POST as cancelar } from "@/app/api/compras/[id]/cancelar/route";
import { reiniciarCaches } from "@/lib/flujo/cache";
import { reiniciarCacheCatalogo } from "@/lib/compras/servicio";
import type { CompraApi, RespuestaEditarOcApi } from "@/lib/compras/tipos-api";
import { COMPRA } from "./compras.fixture";

/**
 * `PUT /api/compras/[id]/oc` (08b-1b §2.11, decisión 121; F27 a F30 y F43) con el servicio REAL y la base en memoria: el espejo de
 * `editar_oc_compra` aplica `sin_cambios` antes de `p_antes`, `oc_cambio`, `oc_repetida` (mismo proveedor, `upper(btrim)`, compras no
 * canceladas) y el aviso `oc_de_otro_proveedor`. La función real está probada contra la base en la prueba de integración.
 */

const URL_BASE = "http://localhost/api";
const put = (id: string, cuerpo: unknown) =>
  editarOc(new NextRequest(`${URL_BASE}/compras/${id}/oc`, { method: "PUT", body: JSON.stringify(cuerpo), headers: { "content-type": "application/json" } }), { params: Promise.resolve({ id }) });
const leer = async <T = unknown>(r: Response) => (await r.json()) as { data: T; error?: string; codigo?: string };
const INEXISTENTE = "00000000-0000-4000-8000-999999999999";
const C12 = COMPRA.c12; // Proveedor Norte
const C09 = COMPRA.c09; // Feria Sur
const C08 = IDS.compraC08; // Proveedor Norte (recibida)
const OC = "4500012345";
const compraDe = (id: string) => tablaDe("compras").find((c) => c.id === id);
const ocDe = (id: string) => compraDe(id)?.numero_oc ?? null;
const eventosOc = (id: string) => eventosDe(id).filter((e) => e.accion === "editar_oc");
const llamadasOc = () => llamadasA("editar_oc_compra");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-15T15:00:00.000Z"));
  reiniciarEscenario();
  reiniciarCaches();
  reiniciarCacheCatalogo();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("PUT /api/compras/[id]/oc: registrar, cambiar y quitar (F27)", () => {
  it("registra la OC con la función de la base: 200 con { compra, avisos }, la revisión NO sube y deja el evento editar_oc a nombre de quien la puso", async () => {
    const revision = Number(compraDe(C12)?.revision);
    const r = await put(C12, { antes: null, numero_oc: OC });
    expect(r.status).toBe(200);
    const { data } = await leer<RespuestaEditarOcApi>(r);
    expect(data).toEqual({ compra: { id: C12, numero: "C-000012", numero_oc: OC }, avisos: [] });
    expect(ocDe(C12)).toBe(OC);
    expect(compraDe(C12)?.revision).toBe(revision);
    const e = eventosOc(C12);
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ antes: { numero_oc: null }, despues: { numero_oc: OC }, resumen: `OC: — → ${OC}`, usuario_nombre: "Planner Uno", motivo: null });
  });

  it("lo llama con p_antes y p_numero_oc ya recortados, el actor y el motivo (vacío = nulo)", async () => {
    await put(C12, { antes: "  ", numero_oc: `  ${OC}  ` });
    expect(llamadasOc()).toHaveLength(1);
    expect(llamadasOc()[0].args).toEqual({ p_compra: C12, p_antes: null, p_numero_oc: OC, p_motivo: null, p_actor: { perfil_id: PERFILES.planner.id, nombre: "Planner Uno" } });
  });

  it("cambiar una OC que ya tenía pide el motivo en pantalla; en la base es opcional: queda el antes, el después y el motivo", async () => {
    await put(C12, { antes: null, numero_oc: OC });
    const r = await put(C12, { antes: OC, numero_oc: "4500012300", motivo: "Error de tipeo" });
    expect(r.status).toBe(200);
    expect(ocDe(C12)).toBe("4500012300");
    expect(eventosOc(C12)[1]).toMatchObject({ antes: { numero_oc: OC }, despues: { numero_oc: "4500012300" }, motivo: "Error de tipeo", resumen: `OC: ${OC} → 4500012300` });
  });

  it("quitar la OC (null) deja el evento «OC: … → —» y la respuesta trae numero_oc nulo", async () => {
    await put(C12, { antes: null, numero_oc: OC });
    const r = await put(C12, { antes: OC, numero_oc: null, motivo: "Se anuló la orden" });
    expect(r.status).toBe(200);
    expect((await leer<RespuestaEditarOcApi>(r)).data.compra.numero_oc).toBeNull();
    expect(ocDe(C12)).toBeNull();
    expect(eventosOc(C12)[1].resumen).toBe(`OC: ${OC} → —`);
  });

  it("los tres roles la editan en pantalla (decisión 121): el comprador, aunque la compra sea de otra persona", async () => {
    escenario.usuario = { rol: "comprador", perfil: PERFILES.comprador2 };
    const r = await put(C12, { antes: null, numero_oc: OC });
    expect(r.status).toBe(200);
    expect(eventosOc(C12)[0].usuario_nombre).toBe("Comprador Dos");
    escenario.usuario = { rol: "admin" as never, perfil: PERFILES.planner };
    expect((await put(C09, { antes: null, numero_oc: "9900" })).status).toBe(200);
  });
});

describe("PUT /api/compras/[id]/oc: regla mínima del servidor (seguridad F2 y F3)", () => {
  it("F2: reemplazar o quitar una OC que ya tenía, sin motivo, es 409 motivo_requerido para los tres roles, y no llega a la base", async () => {
    await put(C12, { antes: null, numero_oc: OC });
    const roles = [
      { rol: "comprador", perfil: PERFILES.comprador2 },
      { rol: "planner", perfil: PERFILES.planner },
      { rol: "admin", perfil: PERFILES.planner },
    ] as const;
    for (const quien of roles) {
      escenario.usuario = { rol: quien.rol as never, perfil: quien.perfil };
      const llamadas = llamadasOc().length;
      for (const cuerpo of [{ antes: OC, numero_oc: "4500012300" }, { antes: OC, numero_oc: null }]) {
        const r = await put(C12, cuerpo);
        expect(r.status, quien.rol).toBe(409);
        expect(await leer(r)).toMatchObject({ codigo: "motivo_requerido", error: "Escribe el motivo para cambiar o quitar la OC que ya tenía esta compra." });
      }
      expect(llamadasOc()).toHaveLength(llamadas);
    }
    expect((await put(C12, { antes: OC, numero_oc: "4500012300", motivo: "   " })).status).toBe(400);
    expect(ocDe(C12)).toBe(OC);
    expect(eventosOc(C12)).toHaveLength(1);
  });

  it("F2: no pide motivo para registrar donde no había OC (antes nulo o vacío) ni para el reintento con la misma OC (409 sin_cambios)", async () => {
    expect((await put(C12, { antes: "  ", numero_oc: OC })).status).toBe(200);
    const igual = await put(C12, { antes: OC, numero_oc: ` ${OC} ` });
    expect(igual.status).toBe(409);
    expect((await leer(igual)).codigo).toBe("sin_cambios");
  });

  it("F2: con motivo, reemplazar y quitar funcionan y el motivo queda en el evento", async () => {
    await put(C12, { antes: null, numero_oc: OC });
    expect((await put(C12, { antes: OC, numero_oc: "4500012300", motivo: "Error de tipeo" })).status).toBe(200);
    expect(eventosOc(C12)[1]).toMatchObject({ motivo: "Error de tipeo" });
    expect((await put(C12, { antes: "4500012300", numero_oc: null, motivo: "Se anuló" })).status).toBe(200);
    expect(ocDe(C12)).toBeNull();
  });

  it("F3: `antes` más largo que una OC válida (40) es 400 y no escribe", async () => {
    const r = await put(C12, { antes: "9".repeat(41), numero_oc: OC });
    expect(r.status).toBe(400);
    expect((await leer(r)).error).toMatch(/OC anterior no puede superar 40/);
    expect(llamadasOc()).toHaveLength(0);
    expect((await put(C12, { antes: null, numero_oc: OC })).status).toBe(200);
    expect((await put(C12, { antes: OC, numero_oc: null, motivo: "x", extra: 1 })).status).toBe(400);
  });
});

describe("PUT /api/compras/[id]/oc: los rechazos no escriben nada", () => {
  it("F43 y F28: el reintento con la misma OC ya guardada responde 409 sin_cambios (antes de mirar `antes`), no oc_cambio", async () => {
    await put(C12, { antes: null, numero_oc: OC });
    const r = await put(C12, { antes: null, numero_oc: OC });
    expect(r.status).toBe(409);
    expect(await leer(r)).toMatchObject({ codigo: "sin_cambios", error: "La OC ya es esa: no hay nada que cambiar." });
    expect(eventosOc(C12)).toHaveLength(1);
  });

  it("F28: dos personas editan con antes = null; la segunda llega con otro número: 409 oc_cambio y la primera sigue guardada", async () => {
    await put(C12, { antes: null, numero_oc: OC });
    const r = await put(C12, { antes: null, numero_oc: "4500099999" });
    expect(r.status).toBe(409);
    expect(await leer(r)).toMatchObject({ codigo: "oc_cambio", error: "Otra persona cambió la OC mientras editabas: vuelve a abrirla." });
    expect(ocDe(C12)).toBe(OC);
    expect(eventosOc(C12)).toHaveLength(1);
  });

  it("F29: una compra cancelada no se edita (409 no_editable)", async () => {
    const c = await cancelar(new NextRequest(`${URL_BASE}/compras/${C12}/cancelar`, { method: "POST", body: JSON.stringify({ revision: Number(compraDe(C12)?.revision), motivo: "Ya no se necesita" }), headers: { "content-type": "application/json" } }), { params: Promise.resolve({ id: C12 }) } as never);
    expect(c.status).toBe(200);
    expect(compraDe(C12)?.estado).toBe("cancelada");
    const r = await put(C12, { antes: null, numero_oc: OC });
    expect(r.status).toBe(409);
    expect((await leer(r)).codigo).toBe("no_editable");
    expect(ocDe(C12)).toBeNull();
  });

  it("una compra que no existe o un id mal formado: 404 en castellano", async () => {
    const r = await put(INEXISTENTE, { antes: null, numero_oc: OC });
    expect(r.status).toBe(404);
    expect(await leer(r)).toMatchObject({ codigo: "no_encontrado", error: "No encontramos esa compra." });
    const mal = await put("no-es-un-uuid", { antes: null, numero_oc: OC });
    expect(mal.status).toBe(404);
    expect(llamadasOc()).toHaveLength(1); // el id mal formado ni llega a la base
  });

  it("el cuerpo se valida con zod antes de tocar la base: 400 sin antes, con caracteres raros, de más de 40, con un campo desconocido o motivo vacío", async () => {
    for (const cuerpo of [{ numero_oc: OC }, { antes: null, numero_oc: "45*00" }, { antes: null, numero_oc: "A".repeat(41) }, { antes: null, numero_oc: OC, extra: 1 }, { antes: null, numero_oc: OC, motivo: "  " }, { antes: null }]) {
      const r = await put(C12, cuerpo);
      expect(r.status, JSON.stringify(cuerpo)).toBe(400);
      expect(typeof (await leer(r)).error).toBe("string");
    }
    expect(llamadasOc()).toHaveLength(0);
  });

  it("sin sesión: 401 y no llega a la base", async () => {
    escenario.usuario = { rol: "sin_sesion", perfil: PERFILES.planner };
    expect((await put(C12, { antes: null, numero_oc: OC })).status).toBe(401);
    expect(llamadasOc()).toHaveLength(0);
  });
});

describe("PUT /api/compras/[id]/oc: única por proveedor entre compras no canceladas (F30, I10)", () => {
  it("la misma OC en otra compra del MISMO proveedor: 409 oc_repetida con el número de la compra que ya la tiene; con espacios o en otra caja de letras, igual", async () => {
    await put(C12, { antes: null, numero_oc: "4500AB" });
    for (const repetida of ["4500AB", " 4500AB ", "4500ab"]) {
      const r = await put(C08, { antes: null, numero_oc: repetida });
      expect(r.status, repetida).toBe(409);
      const cuerpo = await leer(r);
      expect(cuerpo.codigo).toBe("oc_repetida");
      expect(cuerpo.error).toBe(`La OC ${repetida.trim()} ya está en C-000012 de este proveedor. Una OC es de una sola compra: revisa el número o cancela la otra compra.`);
      expect(ocDe(C08)).toBeNull();
    }
    expect(eventosOc(C08)).toHaveLength(0);
  });

  it("en un proveedor DISTINTO se guarda con el aviso oc_de_otro_proveedor (con la compra y el proveedor)", async () => {
    await put(C12, { antes: null, numero_oc: OC });
    const r = await put(C09, { antes: null, numero_oc: OC });
    expect(r.status).toBe(200);
    const { data } = await leer<RespuestaEditarOcApi>(r);
    expect(ocDe(C09)).toBe(OC);
    expect(data.avisos).toEqual([{ aviso: "oc_de_otro_proveedor", detalle: `La OC ${OC} también está en C-000012 de Proveedor Norte: ¿es otra orden?` }]);
  });

  it("cancelar la compra que la tenía libera la OC: la otra compra del proveedor la guarda", async () => {
    await put(C12, { antes: null, numero_oc: OC });
    expect((await put(C08, { antes: null, numero_oc: OC })).status).toBe(409);
    compraDe(C12)!.estado = "cancelada";
    expect((await put(C08, { antes: null, numero_oc: OC })).status).toBe(200);
    expect(ocDe(C08)).toBe(OC);
  });
});

describe("la OC en la lectura de Compras (F33)", () => {
  const get = (ruta: string, consulta = "") => new NextRequest(`${URL_BASE}${ruta}${consulta}`);
  const lista = async (consulta = "") => (await leer<CompraApi[]>(await listaCompras(get("/compras", consulta)))).data;

  it("la lista y el detalle traen numero_oc (nulo si no tiene) y el código X sigue siendo `numero`", async () => {
    await put(C12, { antes: null, numero_oc: OC });
    const todas = await lista();
    expect(todas.find((c) => c.numero === "C-000012")?.numero_oc).toBe(OC);
    expect(todas.filter((c) => c.numero !== "C-000012").every((c) => c.numero_oc === null)).toBe(true);
    const d = (await leer<CompraApi>(await unaCompra(get(`/compras/${C12}`), { params: Promise.resolve({ id: C12 }) }))).data;
    expect(d.numero_oc).toBe(OC);
    expect(d.numero).toBe("C-000012");
    expect(d.historial.some((e) => e.accion === "editar_oc")).toBe(true);
  });

  it("q busca por OC (también a medias y sin mayúsculas), por código X y por referencia", async () => {
    await put(C12, { antes: null, numero_oc: "4500012345" });
    await put(C09, { antes: null, numero_oc: "AB-777" });
    expect((await lista("?q=4500012345")).map((c) => c.numero)).toEqual(["C-000012"]);
    expect((await lista("?q=450001")).map((c) => c.numero)).toEqual(["C-000012"]);
    expect((await lista("?q=ab-777")).map((c) => c.numero)).toEqual(["C-000009"]);
    expect((await lista("?q=c-000012")).map((c) => c.numero)).toEqual(["C-000012"]);
    expect((await lista("?q=PO-22")).map((c) => c.numero)).toEqual(["C-000012"]); // la referencia sigue buscándose
    expect(await lista("?q=no-existe")).toEqual([]);
  });
});
