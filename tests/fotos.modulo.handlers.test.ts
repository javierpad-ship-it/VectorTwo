import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { IDS, PERFILES, escenario, reiniciarEscenario, sembrarFoto, tabla } from "./e1.fake-db";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/guard", async () => (await import("./e1.fake-db")).guardFalso());
vi.mock("@/lib/supabase/admin", async () => {
  const { clienteFalso } = await import("./e1.fake-db");
  return { supabaseAdmin: () => clienteFalso() };
});
// El catálogo (árbol, marcas) no es lo que se prueba aquí: un catálogo con un solo nodo y una marca.
vi.mock("@/lib/compras/servicio", () => ({
  nombresDeCatalogo: async () => ({
    data: {
      marcas: new Map([["m0000000-0000-4000-8000-000000000001", "ALFA"]]),
      agrupaciones: new Map([["a0000000-0000-4000-8000-0000000000aa", "Casual"]]),
      equivalencias: new Map(),
      nodos: new Map([["90000000-0000-4000-8000-000000000001", { genero: "HOMBRE", mundo: "URBANO", linea: "DENIM", ruta: "HOMBRE · URBANO · DENIM" }]]),
    },
    respuesta: null,
  }),
}));

import { GET as fotos } from "@/app/api/compras/fotos/route";
import type { FotosModuloApi } from "@/lib/fotos/tipos-api";

const BASE = "http://localhost/api/compras/fotos";
const get = (consulta = "") => new NextRequest(`${BASE}${consulta}`);
const leer = async (r: Response) => ({ status: r.status, ...((await r.json()) as { data: FotosModuloApi; error?: string }) });
const como = (rol: "admin" | "planner" | "comprador" | "sin_sesion") => {
  escenario.usuario = rol === "sin_sesion" ? { rol, perfil: PERFILES.planner } : { rol, perfil: PERFILES[rol] };
};
const numeros = (r: FotosModuloApi) => r.lineas.map((l) => l.compra.numero);
const GML = "90000000-0000-4000-8000-000000000001";
const VIAJE = "70000000-0000-4000-8000-000000000001";
const OTRO_VIAJE = "70000000-0000-4000-8000-000000000002";
const fila = (t: string, id: string) => tabla(t).find((f) => f.id === id) as Record<string, unknown>;

beforeEach(() => {
  reiniciarEscenario();
  como("comprador");
});

describe("GET /api/compras/fotos · contadores, selector de proveedores y lista", () => {
  it("«8 de 12»: cuenta las líneas activas de las compras vivas con y sin foto, en orden de compra más reciente", async () => {
    sembrarFoto(IDS.compraA, IDS.lineaA1);
    const r = await leer(await fotos(get()));
    expect(r.status).toBe(200);
    // Activas y de compras vivas: A1 (C-000101), B1 (C-000102) y Nueva1 (C-000103). A2 está inactiva y la cancelada queda fuera.
    expect(r.data.contadores).toEqual({ lineas: 3, con_foto: 1, sin_foto: 2 });
    expect(r.data).toMatchObject({ total: 3, pagina: 1, por_pagina: 20 });
    expect(numeros(r.data)).toEqual(["C-000103", "C-000102", "C-000101"]);
    expect(r.data.lineas[2].fotos).toHaveLength(1);
    expect(r.data.lineas[2].fotos[0]).toMatchObject({ miniatura_url: expect.stringMatching(/^\/api\/compras\/fotos\/.+\/miniatura$/), subida_por_nombre: "Comprador Uno" });
  });

  it("por_proveedor trae todos los proveedores con sus líneas y las que no tienen foto, ordenados por nombre", async () => {
    sembrarFoto(IDS.compraOtra, IDS.lineaOtra);
    const r = await leer(await fotos(get()));
    expect(r.data.por_proveedor).toEqual([
      { id: IDS.provSur, nombre: "Feria Sur", lineas: 1, sin_foto: 0 },
      { id: IDS.provNorte, nombre: "Proveedor Norte", lineas: 2, sin_foto: 2 },
    ]);
  });

  it("filtrar por proveedor acota la lista y los contadores, pero el selector sigue mostrando a todos", async () => {
    sembrarFoto(IDS.compraA, IDS.lineaA1);
    const r = await leer(await fotos(get(`?proveedor_id=${IDS.provNorte}`)));
    expect(numeros(r.data)).toEqual(["C-000103", "C-000101"]);
    expect(r.data.contadores).toEqual({ lineas: 2, con_foto: 1, sin_foto: 1 });
    expect(r.data.por_proveedor.map((p) => p.nombre)).toEqual(["Feria Sur", "Proveedor Norte"]);
  });

  it("«solo sin foto» deja en la lista solo las líneas sin foto; el contador sigue diciendo cuántas hay con foto", async () => {
    sembrarFoto(IDS.compraA, IDS.lineaA1);
    const r = await leer(await fotos(get("?solo_sin_foto=1")));
    expect(numeros(r.data)).toEqual(["C-000103", "C-000102"]);
    expect(r.data.total).toBe(2);
    expect(r.data.contadores).toEqual({ lineas: 3, con_foto: 1, sin_foto: 2 });
    expect((await leer(await fotos(get("?solo_sin_foto=0")))).data.total).toBe(3);
  });

  it("la búsqueda mira compra, proveedor, descripción y modelo, sin distinguir tildes ni mayúsculas", async () => {
    Object.assign(fila("compra_lineas", IDS.lineaA1), { descripcion: "Jean slim azul medio", modelo: "DL-2231" });
    expect(numeros((await leer(await fotos(get("?q=JEAN")))).data)).toEqual(["C-000101"]);
    expect(numeros((await leer(await fotos(get("?q=dl-2231")))).data)).toEqual(["C-000101"]);
    expect(numeros((await leer(await fotos(get("?q=c-000102")))).data)).toEqual(["C-000102"]);
    expect(numeros((await leer(await fotos(get("?q=feria")))).data)).toEqual(["C-000102"]);
    expect((await leer(await fotos(get("?q=nada-por-aqui")))).data.total).toBe(0);
    // La búsqueda también acota el contador y el selector.
    const r = await leer(await fotos(get("?q=jean")));
    expect(r.data.contadores.lineas).toBe(1);
    expect(r.data.por_proveedor.map((p) => p.nombre)).toEqual(["Proveedor Norte"]);
  });

  it("pagina: por_pagina y pagina recortan la lista, total y contadores no cambian, y una página pasada del final sale vacía", async () => {
    const p1 = await leer(await fotos(get("?por_pagina=2&pagina=1")));
    expect(numeros(p1.data)).toEqual(["C-000103", "C-000102"]);
    expect(p1.data).toMatchObject({ total: 3, pagina: 1, por_pagina: 2 });
    const p2 = await leer(await fotos(get("?por_pagina=2&pagina=2")));
    expect(numeros(p2.data)).toEqual(["C-000101"]);
    expect(p2.data.contadores.lineas).toBe(3);
    const p9 = await leer(await fotos(get("?por_pagina=2&pagina=9")));
    expect(p9.data.lineas).toEqual([]);
    expect(p9.data.total).toBe(3);
  });

  it("filtros inválidos: 400 con mensaje en castellano (por_pagina > 100, página 0, id mal formado, estado o booleano inventado)", async () => {
    for (const mala of ["?por_pagina=101", "?por_pagina=0", "?pagina=0", "?pagina=abc", "?proveedor_id=xyz", "?compra_id=xyz", "?viaje_id=xyz", "?estado=inventado", "?origen=inventado", "?solo_sin_foto=si", `?q=${"x".repeat(101)}`]) {
      const r = await leer(await fotos(get(mala)));
      expect(r.status, mala).toBe(400);
      expect(typeof r.error, mala).toBe("string");
    }
    expect((await leer(await fotos(get(`?por_pagina=100`)))).status).toBe(200);
  });
});

describe("GET /api/compras/fotos · viaje, compra, origen y estado", () => {
  beforeEach(() => {
    tabla("compra_viajes").push({ id: VIAJE, codigo: "261001", nombre: "Feria Sur · oct-2026", estado: "abierto" }, { id: OTRO_VIAJE, codigo: "261002", nombre: "Otro viaje", estado: "cerrado" });
    fila("compras", IDS.compraA).viaje_id = VIAJE;
    fila("compras", IDS.compraNueva).viaje_id = OTRO_VIAJE;
  });

  it("viaje_id filtra por ese viaje; sin_viaje, por las compras sin viaje; todos o ausente, por ninguno (la API no lee la cookie)", async () => {
    const delViaje = await leer(await fotos(get(`?viaje_id=${VIAJE}`)));
    expect(numeros(delViaje.data)).toEqual(["C-000101"]);
    expect(delViaje.data.lineas[0].compra.viaje).toEqual({ id: VIAJE, codigo: "261001", nombre: "Feria Sur · oct-2026", estado: "abierto" });
    expect(numeros((await leer(await fotos(get("?viaje_id=sin_viaje")))).data)).toEqual(["C-000102"]);
    expect(numeros((await leer(await fotos(get("?viaje_id=todos")))).data)).toEqual(["C-000103", "C-000102", "C-000101"]);
    expect(numeros((await leer(await fotos(get("")))).data)).toEqual(["C-000103", "C-000102", "C-000101"]);
    const sinViaje = (await leer(await fotos(get("?viaje_id=sin_viaje")))).data.lineas[0];
    expect(sinViaje.compra.viaje).toBeNull();
  });

  it("compra_id y origen acotan; un origen sin compras da una lista vacía", async () => {
    expect(numeros((await leer(await fotos(get(`?compra_id=${IDS.compraOtra}`)))).data)).toEqual(["C-000102"]);
    fila("compras", IDS.compraOtra).origen = "intercompany_cd";
    expect(numeros((await leer(await fotos(get("?origen=intercompany_cd")))).data)).toEqual(["C-000102"]);
    expect((await leer(await fotos(get("?origen=carga_inicial")))).data.total).toBe(0);
  });

  it("las compras canceladas salen solo con estado=cancelada, en solo lectura; el admin conserva la ✕ para quitar", async () => {
    sembrarFoto(IDS.compraCancelada, IDS.lineaCancelada);
    expect(numeros((await leer(await fotos(get()))).data)).not.toContain("C-000090");
    for (const [rol, quitar] of [["comprador", false], ["planner", false], ["admin", true]] as const) {
      como(rol);
      const r = await leer(await fotos(get("?estado=cancelada")));
      expect(numeros(r.data), rol).toEqual(["C-000090"]);
      expect(r.data.lineas[0].puede, rol).toEqual({ subir: false, quitar, editar_ficha: false });
      expect(r.data.lineas[0].fotos).toHaveLength(1);
    }
    como("comprador");
    expect((await leer(await fotos(get("?estado=cancelada")))).data.lineas[0].fotos_en_cancelada).toBe(0);
    expect(numeros((await leer(await fotos(get("?estado=confirmada")))).data)).toEqual(["C-000103", "C-000102", "C-000101"]);
  });

  it("una compra viva deja subir, quitar y editar la ficha a los tres roles", async () => {
    for (const rol of ["comprador", "planner", "admin"] as const) {
      como(rol);
      expect((await leer(await fotos(get()))).data.lineas[0].puede, rol).toEqual({ subir: true, quitar: true, editar_ficha: true });
    }
  });

  it("la línea trae su compra, proveedor, gml, marca, tallas, unidades y costo, y la moneda de la compra", async () => {
    Object.assign(fila("compra_lineas", IDS.lineaA1), { genero_mundo_linea_id: GML, marca_id: "m0000000-0000-4000-8000-000000000001", agrupacion_marca_id: "a0000000-0000-4000-8000-0000000000aa", tallas: "ambas", unidades: 120, costo_unitario: "4.5", descripcion: "Jean slim", modelo: "DL-1" });
    const l = (await leer(await fotos(get(`?compra_id=${IDS.compraA}`)))).data.lineas[0];
    expect(l.compra).toMatchObject({ id: IDS.compraA, numero: "C-000101", estado: "confirmada", proveedor: { id: IDS.provNorte, nombre: "Proveedor Norte" } });
    expect(l.linea).toEqual({
      id: IDS.lineaA1,
      tipo: "especifica",
      gml: { genero: "HOMBRE", mundo: "URBANO", linea: "DENIM", etiqueta: "HOMBRE · URBANO · DENIM" },
      marca: "ALFA",
      agrupacion_marca: "Casual",
      tallas: "ambas",
      unidades: 120,
      costo_unitario: 4.5,
      moneda: "USD",
      descripcion: "Jean slim",
      modelo: "DL-1",
    });
  });
});

describe("GET /api/compras/fotos · fotos_en_cancelada (decisión 104)", () => {
  const delNuevo = async () => (await leer(await fotos(get(`?compra_id=${IDS.compraNueva}`)))).data.lineas[0];

  it("cuenta las fotos activas de la misma línea de la versión cancelada que aún no se trajeron", async () => {
    expect((await delNuevo()).fotos_en_cancelada).toBe(0);
    sembrarFoto(IDS.compraCancelada, IDS.lineaCancelada);
    sembrarFoto(IDS.compraCancelada, IDS.lineaCancelada);
    expect((await delNuevo()).fotos_en_cancelada).toBe(2);
  });

  it("no cuenta las ya traídas (por origen_foto_id), las quitadas del origen ni lo que no cabe en las 3 de la línea", async () => {
    const a = sembrarFoto(IDS.compraCancelada, IDS.lineaCancelada);
    sembrarFoto(IDS.compraCancelada, IDS.lineaCancelada);
    sembrarFoto(IDS.compraCancelada, IDS.lineaCancelada, { activo: false, quitada_at: "2026-10-30T10:00:00.000Z" });
    expect((await delNuevo()).fotos_en_cancelada).toBe(2);
    sembrarFoto(IDS.compraNueva, IDS.lineaNueva, { origen_foto_id: a });
    expect((await delNuevo()).fotos_en_cancelada).toBe(1);
    sembrarFoto(IDS.compraNueva, IDS.lineaNueva);
    sembrarFoto(IDS.compraNueva, IDS.lineaNueva);
    expect((await delNuevo()).fotos_en_cancelada).toBe(0);
  });

  it("el cupo manda: con 2 activas solo cabe 1 aunque la cancelada tenga 3", async () => {
    for (let i = 0; i < 3; i += 1) sembrarFoto(IDS.compraCancelada, IDS.lineaCancelada);
    sembrarFoto(IDS.compraNueva, IDS.lineaNueva);
    sembrarFoto(IDS.compraNueva, IDS.lineaNueva);
    expect((await delNuevo()).fotos_en_cancelada).toBe(1);
  });

  it("solo con la misma clave y el mismo proveedor, y nunca en una línea manual (sin clave)", async () => {
    sembrarFoto(IDS.compraCancelada, IDS.lineaCancelada);
    fila("compras", IDS.compraNueva).proveedor_id = IDS.provSur;
    expect((await delNuevo()).fotos_en_cancelada, "otro proveedor").toBe(0);
    fila("compras", IDS.compraNueva).proveedor_id = IDS.provNorte;
    expect((await delNuevo()).fotos_en_cancelada).toBe(1);
    fila("compra_lineas", IDS.lineaNueva).clave_importacion = null;
    expect((await delNuevo()).fotos_en_cancelada, "línea manual").toBe(0);
    fila("compra_lineas", IDS.lineaNueva).clave_importacion = "OTRA|CLAVE|9";
    expect((await delNuevo()).fotos_en_cancelada, "otra clave").toBe(0);
  });

  it("si hay varias versiones canceladas, cuenta las de la más reciente", async () => {
    sembrarFoto(IDS.compraCancelada, IDS.lineaCancelada);
    tabla("compras").push({ id: "40000000-0000-4000-8000-0000000000e1", numero: "C-000095", proveedor_id: IDS.provNorte, estado: "cancelada", origen: "comprador", fecha_compra: "2026-10-12", moneda: "USD", revision: 1, cancelada_at: "2026-10-28T10:00:00.000Z", created_at: "2026-10-11T10:00:00.000Z" });
    tabla("compra_lineas").push({ id: "30000000-0000-4000-8000-0000000000e1", compra_id: "40000000-0000-4000-8000-0000000000e1", activo: true, clave_importacion: "NORTE|REF-1|1", created_at: "2026-10-15T10:00:00.000Z" });
    sembrarFoto("40000000-0000-4000-8000-0000000000e1", "30000000-0000-4000-8000-0000000000e1");
    sembrarFoto("40000000-0000-4000-8000-0000000000e1", "30000000-0000-4000-8000-0000000000e1");
    sembrarFoto("40000000-0000-4000-8000-0000000000e1", "30000000-0000-4000-8000-0000000000e1");
    expect((await delNuevo()).fotos_en_cancelada).toBe(3);
  });
});

describe("GET /api/compras/fotos · guard y datos internos", () => {
  it("sin sesión 401; los tres roles leen", async () => {
    como("sin_sesion");
    expect((await fotos(get())).status).toBe(401);
    for (const rol of ["comprador", "planner", "admin"] as const) {
      como(rol);
      expect((await fotos(get())).status, rol).toBe(200);
    }
  });

  it("R8 · ninguna respuesta trae ruta, ruta_miniatura, clave_origen ni la revisión de la compra", async () => {
    sembrarFoto(IDS.compraA, IDS.lineaA1, { clave_origen: "cotv:photo:secreto" });
    const crudo = await (await fotos(get())).text();
    for (const prohibido of ["ruta", "_min.jpg", "clave_origen", "secreto", "revision", `/${IDS.lineaA1}/`, `compras/${IDS.compraA}/`]) expect(crudo, prohibido).not.toContain(prohibido);
    expect(crudo).toContain("/miniatura");
  });

  it("sin compras vivas: contadores en cero, sin proveedores y sin tarjetas (200)", async () => {
    tabla("compras").length = 0;
    const r = await leer(await fotos(get()));
    expect(r.status).toBe(200);
    expect(r.data).toEqual({ contadores: { lineas: 0, con_foto: 0, sin_foto: 0 }, por_proveedor: [], lineas: [], pagina: 1, por_pagina: 20, total: 0 });
  });
});
