import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { IDS, PERFILES, escenario, fotosActivas, llamadasA, reiniciarEscenario, sembrarFoto, tabla } from "./e1.fake-db";
import { cuerpoMultipart, jpegSintetico, marcadoresDeMetadatos, PNG_FALSO } from "./fotos.fixture";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/guard", async () => (await import("./e1.fake-db")).guardFalso());
vi.mock("@/lib/supabase/admin", async () => {
  const { clienteFalso } = await import("./e1.fake-db");
  return { supabaseAdmin: () => clienteFalso() };
});

import { POST as subir } from "@/app/api/compras/[id]/lineas/[lineaId]/fotos/route";
import { DELETE as quitar } from "@/app/api/compras/[id]/lineas/[lineaId]/fotos/[fotoId]/route";
import { POST as traer } from "@/app/api/compras/[id]/lineas/[lineaId]/fotos/traer/route";
import { PATCH as editarFicha } from "@/app/api/compras/[id]/lineas/[lineaId]/ficha/route";
import { GET as fotoGrande } from "@/app/api/compras/fotos/[fotoId]/route";
import { GET as miniatura } from "@/app/api/compras/fotos/[fotoId]/miniatura/route";
import { GET as contarLimpieza, POST as limpiar } from "@/app/api/compras/fotos/limpiar/route";
import type { FotoGrandeApi, FotoLineaApi, LimpiezaFotosApi, LineaFichaApi, RespuestaTraerFotosApi, ResultadoLimpiezaFotosApi } from "@/lib/fotos/tipos-api";

const BASE = "http://localhost/api/compras";
const FOTO = jpegSintetico({ ancho: 800, alto: 600, metadatos: true });
const MINI = jpegSintetico({ ancho: 320, alto: 240 });

type Cuerpo<T> = { data: T; error?: string; codigo?: string; actual?: { descripcion: string | null; modelo: string | null } };
const leer = async <T>(r: Response) => ({ status: r.status, ...((await r.json()) as Cuerpo<T>) });
const como = (rol: "admin" | "planner" | "comprador" | "sin_sesion") => {
  escenario.usuario = rol === "sin_sesion" ? { rol, perfil: PERFILES.planner } : { rol, perfil: PERFILES[rol] };
};
const ctxLinea = (id: string, lineaId: string) => ({ params: Promise.resolve({ id, lineaId }) });
const ctxFotoLinea = (id: string, lineaId: string, fotoId: string) => ({ params: Promise.resolve({ id, lineaId, fotoId }) });
const ctxFoto = (fotoId: string) => ({ params: Promise.resolve({ fotoId }) });
const json = (metodo: string, ruta: string, cuerpo?: unknown) =>
  new NextRequest(`${BASE}${ruta}`, { method: metodo, ...(cuerpo === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo) }) });

/** La petición de subida tal como la manda el navegador (multipart con su `content-length`). */
async function peticionSubida(compra: string, linea: string, partes = { foto: FOTO, miniatura: MINI } as Parameters<typeof cuerpoMultipart>[0], cabeceras: Record<string, string | null> = {}) {
  const crudo = new Response(cuerpoMultipart(partes).cuerpo);
  const tipo = crudo.headers.get("content-type") ?? "";
  const bytes = new Uint8Array(await crudo.arrayBuffer());
  const h: Record<string, string> = { "content-type": tipo, "content-length": String(bytes.length) };
  for (const [k, v] of Object.entries(cabeceras)) {
    if (v === null) delete h[k];
    else h[k] = v;
  }
  return new NextRequest(`${BASE}/${compra}/lineas/${linea}/fotos`, { method: "POST", body: bytes, headers: h });
}
const subirA = async (compra: string, linea: string, partes?: Parameters<typeof cuerpoMultipart>[0], cabeceras?: Record<string, string | null>) =>
  subir(await peticionSubida(compra, linea, partes, cabeceras), ctxLinea(compra, linea));
const sinOperacionesDeAlmacen = () => expect(escenario.operaciones).toEqual([]);

beforeEach(() => {
  reiniciarEscenario();
});

describe("POST …/fotos (subir)", () => {
  it("R8 · sube la foto y la miniatura sin metadatos, registra la fila y responde sin ninguna ruta", async () => {
    como("comprador");
    const r = await leer<FotoLineaApi>(await subirA(IDS.compraA, IDS.lineaA1));
    expect(r.status).toBe(201);
    expect(r.data).toMatchObject({ ancho: 800, alto: 600, subida_por: { nombre: "Comprador Uno" } });
    expect(r.data.miniatura_url).toBe(`/api/compras/fotos/${r.data.id}/miniatura`);
    expect(Object.keys(r.data).sort()).toEqual(["alto", "ancho", "id", "miniatura_url", "subida_por"]);
    expect(JSON.stringify(r.data)).not.toMatch(/"compras\/|\.jpg|ruta|clave_origen/);

    const ruta = `compras/${IDS.compraA}/${IDS.lineaA1}/${r.data.id}.jpg`;
    expect(escenario.operaciones).toEqual([`upload:${ruta}`, `upload:compras/${IDS.compraA}/${IDS.lineaA1}/${r.data.id}_min.jpg`]);
    const guardada = escenario.objetos.get(ruta);
    expect(guardada && marcadoresDeMetadatos(guardada.bytes)).toEqual([]);
    expect(fotosActivas(IDS.lineaA1)).toHaveLength(1);
    expect(fotosActivas(IDS.lineaA1)[0]).toMatchObject({ compra_id: IDS.compraA, subida_por_nombre: "Comprador Uno", bytes: guardada?.bytes.length });
  });

  it("R7 · subir una foto no toca compras.revision ni compra_eventos", async () => {
    await subirA(IDS.compraA, IDS.lineaA1);
    expect(tabla("compras").find((c) => c.id === IDS.compraA)?.revision).toBe(3);
    expect(tabla("compra_eventos")).toHaveLength(0);
  });

  it("R3 · sin content-length 411, más de 512 KB 413, Origin ajeno 403: ninguna toca Storage ni la base", async () => {
    expect((await leer(await subirA(IDS.compraA, IDS.lineaA1, undefined, { "content-length": null }))).codigo).toBe("longitud_requerida");
    const grande = await leer(await subirA(IDS.compraA, IDS.lineaA1, undefined, { "content-length": String(600 * 1024) }));
    expect([grande.status, grande.codigo]).toEqual([413, "foto_grande"]);
    const origen = await leer(await subirA(IDS.compraA, IDS.lineaA1, undefined, { origin: "https://sitio-malo.example" }));
    expect([origen.status, origen.codigo]).toEqual([403, "origen_invalido"]);
    sinOperacionesDeAlmacen();
    expect(escenario.llamadas).toHaveLength(0);
  });

  it("411 es el estado HTTP de longitud_requerida", async () => {
    expect((await subirA(IDS.compraA, IDS.lineaA1, undefined, { "content-length": null })).status).toBe(411);
  });

  it("valida las partes: falta la miniatura 400 foto_requerida, PNG 400 formato_invalido, 801 px 400 dimensiones_invalidas", async () => {
    const falta = await leer(await subirA(IDS.compraA, IDS.lineaA1, { foto: FOTO }));
    expect([falta.status, falta.codigo]).toEqual([400, "foto_requerida"]);
    const png = await leer(await subirA(IDS.compraA, IDS.lineaA1, { foto: PNG_FALSO, miniatura: MINI }));
    expect([png.status, png.codigo]).toEqual([400, "formato_invalido"]);
    const dim = await leer(await subirA(IDS.compraA, IDS.lineaA1, { foto: jpegSintetico({ ancho: 801, alto: 600 }), miniatura: MINI }));
    expect([dim.status, dim.codigo]).toEqual([400, "dimensiones_invalidas"]);
    sinOperacionesDeAlmacen();
  });

  it("404 no_pertenece con una línea de otra compra o inexistente; ids mal formados 404; nada se sube", async () => {
    const cruzada = await leer(await subirA(IDS.compraA, IDS.lineaOtra));
    expect([cruzada.status, cruzada.codigo]).toEqual([404, "no_pertenece"]);
    const otra = "30000000-0000-4000-8000-0000000000ff";
    expect((await leer(await subirA(IDS.compraA, otra))).codigo).toBe("no_pertenece");
    expect((await subir(await peticionSubida("x", "y"), ctxLinea("x", "y"))).status).toBe(404);
    sinOperacionesDeAlmacen();
  });

  it("R6 · compra cancelada o línea inactiva: 409 no_editable; una compra recibida o en borrador sí admite fotos", async () => {
    expect((await leer(await subirA(IDS.compraCancelada, IDS.lineaCancelada))).codigo).toBe("no_editable");
    expect((await leer(await subirA(IDS.compraA, IDS.lineaA2))).codigo).toBe("no_editable");
    sinOperacionesDeAlmacen();
    for (const estado of ["recibida", "borrador"]) {
      const c = tabla("compras").find((x) => x.id === IDS.compraA);
      if (c) c.estado = estado;
      expect((await subirA(IDS.compraA, IDS.lineaA1)).status, estado).toBe(201);
    }
  });

  it("R4 · la cuarta foto: 409 max_fotos y no se sube ningún objeto", async () => {
    for (let i = 0; i < 3; i += 1) expect((await subirA(IDS.compraA, IDS.lineaA1)).status).toBe(201);
    escenario.operaciones = [];
    const r = await leer(await subirA(IDS.compraA, IDS.lineaA1));
    expect([r.status, r.codigo]).toEqual([409, "max_fotos"]);
    sinOperacionesDeAlmacen();
    expect(fotosActivas(IDS.lineaA1)).toHaveLength(3);
  });

  it("R4 · si la base rechaza después de subir (carrera con otra subida), la API borra los dos objetos", async () => {
    escenario.forzarMotivoAgregar = "max_fotos";
    const r = await leer(await subirA(IDS.compraA, IDS.lineaA1));
    expect([r.status, r.codigo]).toEqual([409, "max_fotos"]);
    const subidas = escenario.operaciones.filter((o) => o.startsWith("upload:")).map((o) => o.slice(7));
    expect(subidas).toHaveLength(2);
    expect(escenario.operaciones.at(-1)).toBe(`remove:${subidas.join("|")}`);
    expect(escenario.objetos.size).toBe(0);
    expect(tabla("compra_linea_fotos")).toHaveLength(0);
  });

  it("si la función falla con un error de la base, también borra los dos objetos (500)", async () => {
    escenario.fallos.rpc = "agregar_foto_linea";
    const r = await leer(await subirA(IDS.compraA, IDS.lineaA1));
    expect(r.status).toBe(500);
    expect(escenario.objetos.size).toBe(0);
  });

  it("502 almacen_no_disponible si Storage falla: con la miniatura rota se borra la foto ya subida", async () => {
    escenario.fallos.subirN = 2;
    const r = await leer(await subirA(IDS.compraA, IDS.lineaA1));
    expect([r.status, r.codigo]).toEqual([502, "almacen_no_disponible"]);
    expect(escenario.objetos.size).toBe(0);
    expect(llamadasA("agregar_foto_linea")).toHaveLength(0);
  });

  it("502 también si falla la primera subida; no se llama a la base", async () => {
    escenario.fallos.subirN = 1;
    expect((await subirA(IDS.compraA, IDS.lineaA1)).status).toBe(502);
    expect(llamadasA("agregar_foto_linea")).toHaveLength(0);
  });

  it("sin sesión 401 antes de leer nada", async () => {
    como("sin_sesion");
    expect((await subirA(IDS.compraA, IDS.lineaA1)).status).toBe(401);
    expect(escenario.llamadas).toHaveLength(0);
    sinOperacionesDeAlmacen();
  });
});

describe("DELETE …/fotos/[fotoId] (quitar)", () => {
  it("R5 · pone activo false con quién y cuándo, y borra los dos objetos", async () => {
    como("comprador");
    const id = sembrarFoto(IDS.compraA, IDS.lineaA1);
    const r = await leer<{ id: string }>(await quitar(json("DELETE", "/x"), ctxFotoLinea(IDS.compraA, IDS.lineaA1, id)));
    expect([r.status, r.data]).toEqual([200, { id }]);
    const fila = tabla("compra_linea_fotos").find((f) => f.id === id);
    expect(fila).toMatchObject({ activo: false, quitada_por_nombre: "Comprador Uno" });
    expect(fila?.quitada_at).toBeTruthy();
    expect(escenario.operaciones).toEqual([`remove:compras/${IDS.compraA}/${IDS.lineaA1}/${id}.jpg|compras/${IDS.compraA}/${IDS.lineaA1}/${id}_min.jpg`]);
    expect(escenario.objetos.size).toBe(0);
    expect(tabla("compras").find((c) => c.id === IDS.compraA)?.revision).toBe(3);
  });

  it("R5 · una foto de otra línea o de otra compra: 404 no_pertenece; quitar dos veces: 409 ya_quitada", async () => {
    const id = sembrarFoto(IDS.compraA, IDS.lineaA1);
    const cruzada = await leer(await quitar(json("DELETE", "/x"), ctxFotoLinea(IDS.compraOtra, IDS.lineaOtra, id)));
    expect([cruzada.status, cruzada.codigo]).toEqual([404, "no_pertenece"]);
    const otraLinea = await leer(await quitar(json("DELETE", "/x"), ctxFotoLinea(IDS.compraA, IDS.lineaA2, id)));
    expect(otraLinea.codigo).toBe("no_pertenece");
    expect((await quitar(json("DELETE", "/x"), ctxFotoLinea(IDS.compraA, IDS.lineaA1, id))).status).toBe(200);
    const dos = await leer(await quitar(json("DELETE", "/x"), ctxFotoLinea(IDS.compraA, IDS.lineaA1, id)));
    expect([dos.status, dos.codigo]).toEqual([409, "ya_quitada"]);
  });

  it("R6 · en una compra cancelada solo quita el admin; comprador y planner reciben 409 no_editable", async () => {
    const id = sembrarFoto(IDS.compraCancelada, IDS.lineaCancelada);
    for (const rol of ["comprador", "planner"] as const) {
      como(rol);
      const r = await leer(await quitar(json("DELETE", "/x"), ctxFotoLinea(IDS.compraCancelada, IDS.lineaCancelada, id)));
      expect([r.status, r.codigo], rol).toEqual([409, "no_editable"]);
    }
    expect(fotosActivas(IDS.lineaCancelada)).toHaveLength(1);
    como("admin");
    expect((await quitar(json("DELETE", "/x"), ctxFotoLinea(IDS.compraCancelada, IDS.lineaCancelada, id))).status).toBe(200);
    expect(fotosActivas(IDS.lineaCancelada)).toHaveLength(0);
  });

  it("si Storage falla al borrar, la foto queda quitada igual (200) y el objeto lo recoge la limpieza", async () => {
    const id = sembrarFoto(IDS.compraA, IDS.lineaA1);
    escenario.fallos.remove = true;
    expect((await quitar(json("DELETE", "/x"), ctxFotoLinea(IDS.compraA, IDS.lineaA1, id))).status).toBe(200);
    expect(escenario.objetos.size).toBe(2);
    expect(fotosActivas(IDS.lineaA1)).toHaveLength(0);
  });

  it("ids mal formados 404; sin sesión 401", async () => {
    expect((await quitar(json("DELETE", "/x"), ctxFotoLinea(IDS.compraA, IDS.lineaA1, "no-uuid"))).status).toBe(404);
    como("sin_sesion");
    expect((await quitar(json("DELETE", "/x"), ctxFotoLinea(IDS.compraA, IDS.lineaA1, IDS.lineaA1))).status).toBe(401);
  });
});

describe("PATCH …/ficha (descripción y modelo)", () => {
  const cuerpo = (extra: Record<string, unknown> = {}) => ({ descripcion: "Jean slim azul medio", modelo: "DL-2231", antes: { descripcion: null, modelo: null }, ...extra });
  const llamar = (c: unknown, compra = IDS.compraA, linea = IDS.lineaA1) => editarFicha(json("PATCH", "/x", c), ctxLinea(compra, linea));

  it("R7 · edita, deja el evento editar_linea con antes y despues y NO cambia compras.revision", async () => {
    como("comprador");
    const r = await leer<LineaFichaApi>(await llamar(cuerpo()));
    expect([r.status, r.data]).toEqual([200, { linea_id: IDS.lineaA1, descripcion: "Jean slim azul medio", modelo: "DL-2231" }]);
    expect(tabla("compras").find((c) => c.id === IDS.compraA)?.revision).toBe(3);
    const ev = tabla("compra_eventos");
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ accion: "editar_linea", antes: { descripcion: null, modelo: null }, despues: { descripcion: "Jean slim azul medio", modelo: "DL-2231" } });
  });

  it("R7b · con `antes` distinto de lo guardado: 409 linea_cambio con el valor actual y sin escribir; con `antes` correcto edita aunque la compra haya cambiado de revisión", async () => {
    await llamar(cuerpo());
    const viejo = await leer(await llamar(cuerpo({ descripcion: "Otra", antes: { descripcion: null, modelo: null } })));
    expect([viejo.status, viejo.codigo, viejo.actual]).toEqual([409, "linea_cambio", { descripcion: "Jean slim azul medio", modelo: "DL-2231" }]);
    expect(tabla("compra_lineas").find((l) => l.id === IDS.lineaA1)?.descripcion).toBe("Jean slim azul medio");

    const compra = tabla("compras").find((c) => c.id === IDS.compraA);
    if (compra) compra.revision = 9;
    const bien = await leer<LineaFichaApi>(await llamar(cuerpo({ modelo: "DL-9999", antes: { descripcion: "Jean slim azul medio", modelo: "DL-2231" } })));
    expect([bien.status, bien.data.modelo]).toEqual([200, "DL-9999"]);
    expect(compra?.revision).toBe(9);
  });

  it("sin cambios no deja evento; vacío pasa a null", async () => {
    const r = await leer<LineaFichaApi>(await llamar({ descripcion: "", modelo: " ", antes: { descripcion: null, modelo: null } }));
    expect([r.status, r.data.descripcion, r.data.modelo]).toEqual([200, null, null]);
    expect(tabla("compra_eventos")).toHaveLength(0);
  });

  it("R6 · compra cancelada o línea inactiva: 409 no_editable; línea de otra compra: 404 no_pertenece", async () => {
    expect((await leer(await llamar(cuerpo(), IDS.compraCancelada, IDS.lineaCancelada))).codigo).toBe("no_editable");
    expect((await leer(await llamar(cuerpo(), IDS.compraA, IDS.lineaA2))).codigo).toBe("no_editable");
    const cruzada = await leer(await llamar(cuerpo(), IDS.compraA, IDS.lineaOtra));
    expect([cruzada.status, cruzada.codigo]).toEqual([404, "no_pertenece"]);
  });

  it("400 con descripción de más de 200, con `revision` (no existe aquí) o sin `antes`; 401 sin sesión", async () => {
    expect((await llamar(cuerpo({ descripcion: "x".repeat(201) }))).status).toBe(400);
    expect((await llamar(cuerpo({ revision: 1 }))).status).toBe(400);
    expect((await llamar({ descripcion: null, modelo: null })).status).toBe(400);
    como("sin_sesion");
    expect((await llamar(cuerpo())).status).toBe(401);
  });
});

describe("POST …/fotos/traer (fotos de la versión cancelada)", () => {
  const llamar = (compra = IDS.compraNueva, linea = IDS.lineaNueva) => traer(json("POST", "/x"), ctxLinea(compra, linea));
  let origen1: string;
  let origen2: string;
  beforeEach(() => {
    origen1 = sembrarFoto(IDS.compraCancelada, IDS.lineaCancelada, { created_at: "2026-10-12T10:00:00.000Z", ancho: 800, alto: 600 });
    origen2 = sembrarFoto(IDS.compraCancelada, IDS.lineaCancelada, { created_at: "2026-10-12T10:00:01.000Z", ancho: 600, alto: 800 });
  });

  it("RP5 · copia las fotos activas del origen a la línea nueva y deja el origen intacto", async () => {
    const r = await leer<RespuestaTraerFotosApi>(await llamar());
    expect(r.status).toBe(200);
    expect(r.data.traidas).toHaveLength(2);
    expect([r.data.saltadas, r.data.activas]).toEqual([0, 2]);
    expect(JSON.stringify(r.data)).not.toMatch(/"compras\/|\.jpg|ruta/);
    const nuevas = fotosActivas(IDS.lineaNueva);
    expect(nuevas.map((f) => f.origen_foto_id).sort()).toEqual([origen1, origen2].sort());
    expect(nuevas.every((f) => escenario.objetos.has(f.ruta as string) && escenario.objetos.has(f.ruta_miniatura as string))).toBe(true);
    expect(nuevas.every((f) => f.clave_origen === null)).toBe(true);
    expect(fotosActivas(IDS.lineaCancelada)).toHaveLength(2);
    expect(escenario.operaciones.filter((o) => o.startsWith("copy:"))).toHaveLength(4);
    expect(tabla("compras").find((c) => c.id === IDS.compraNueva)?.revision).toBe(3);
  });

  it("RP5 · traer dos veces no duplica: la segunda trae 0 y no copia nada", async () => {
    await llamar();
    escenario.operaciones = [];
    const r = await leer<RespuestaTraerFotosApi>(await llamar());
    expect([r.status, r.data.traidas.length, r.data.saltadas, r.data.activas]).toEqual([200, 0, 2, 2]);
    expect(escenario.operaciones).toEqual([]);
    expect(fotosActivas(IDS.lineaNueva)).toHaveLength(2);
  });

  it("RP5 · completa hasta 3: con una foto ya puesta trae solo las más antiguas que quepan y no deja copias sobrantes", async () => {
    sembrarFoto(IDS.compraNueva, IDS.lineaNueva);
    sembrarFoto(IDS.compraNueva, IDS.lineaNueva);
    const r = await leer<RespuestaTraerFotosApi>(await llamar());
    expect([r.status, r.data.traidas.length, r.data.activas]).toEqual([200, 1, 3]);
    expect(fotosActivas(IDS.lineaNueva).find((f) => f.origen_foto_id !== null)?.origen_foto_id).toBe(origen1);
    expect(escenario.operaciones.filter((o) => o.startsWith("copy:"))).toHaveLength(2);
  });

  it("con las 3 ya puestas: 409 max_fotos sin copiar nada", async () => {
    for (let i = 0; i < 3; i += 1) sembrarFoto(IDS.compraNueva, IDS.lineaNueva);
    const r = await leer(await llamar());
    expect([r.status, r.codigo]).toEqual([409, "max_fotos"]);
    expect(escenario.operaciones).toEqual([]);
  });

  it("RP5 · una línea sin clave de importación o sin versión cancelada: 404 sin_origen", async () => {
    const manual = await leer(await llamar(IDS.compraA, IDS.lineaA1));
    expect([manual.status, manual.codigo]).toEqual([404, "sin_origen"]);
    const otroProveedor = tabla("compras").find((c) => c.id === IDS.compraNueva);
    if (otroProveedor) otroProveedor.proveedor_id = IDS.provSur;
    expect((await leer(await llamar())).codigo).toBe("sin_origen");
    expect(escenario.operaciones).toEqual([]);
  });

  it("sin fotos activas en la versión cancelada: 404 sin_origen", async () => {
    for (const f of tabla("compra_linea_fotos")) f.activo = false;
    expect((await leer(await llamar())).codigo).toBe("sin_origen");
  });

  it("R6 · el destino cancelado o la línea inactiva: 409 no_editable; ids cruzados 404", async () => {
    expect((await leer(await llamar(IDS.compraCancelada, IDS.lineaCancelada))).codigo).toBe("no_editable");
    expect((await leer(await llamar(IDS.compraNueva, IDS.lineaOtra))).codigo).toBe("no_pertenece");
  });

  it("si Storage falla al copiar: 502 y se borran las copias ya hechas", async () => {
    escenario.fallos.copy = true;
    const r = await leer(await llamar());
    expect([r.status, r.codigo]).toEqual([502, "almacen_no_disponible"]);
    expect(fotosActivas(IDS.lineaNueva)).toHaveLength(0);
    expect([...escenario.objetos.keys()].filter((k) => k.includes(IDS.lineaNueva))).toEqual([]);
  });

  it("si la función de la base falla, se borran todas las copias (500)", async () => {
    escenario.fallos.rpc = "traer_fotos_linea";
    const r = await leer(await llamar());
    expect(r.status).toBe(500);
    expect([...escenario.objetos.keys()].filter((k) => k.includes(IDS.lineaNueva))).toEqual([]);
    expect(fotosActivas(IDS.lineaNueva)).toHaveLength(0);
  });

  it("sin sesión 401", async () => {
    como("sin_sesion");
    expect((await llamar()).status).toBe(401);
  });
});

describe("GET /api/compras/fotos/[fotoId] (foto grande)", () => {
  it("R8 · trae una URL firmada de vida corta (≤ 3 600 s), las dimensiones y la leyenda; sin ruta", async () => {
    como("comprador");
    const linea = tabla("compra_lineas").find((l) => l.id === IDS.lineaA1);
    if (linea) Object.assign(linea, { modelo: "DL-2231", descripcion: "Jean slim azul medio" });
    const id = sembrarFoto(IDS.compraA, IDS.lineaA1, { ancho: 700, alto: 500 });
    const antes = Date.now();
    const r = await leer<FotoGrandeApi>(await fotoGrande(json("GET", "/x"), ctxFoto(id)));
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({ ancho: 700, alto: 500, leyenda: "C-000101 · Proveedor Norte · DL-2231 · Jean slim azul medio" });
    expect(r.data.url).toContain("https://storage.ejemplo.test/firmada/");
    expect(r.data.url).toContain("t=3600");
    expect(Date.parse(r.data.expira_at)).toBeLessThanOrEqual(Date.now() + 3_600_000);
    expect(Date.parse(r.data.expira_at)).toBeGreaterThanOrEqual(antes + 3_599_000);
    expect(Object.keys(r.data).sort()).toEqual(["alto", "ancho", "expira_at", "leyenda", "url"]);
  });

  it("404 si la foto está quitada, no existe o el id es inválido; 502 si Storage no firma; 401 sin sesión", async () => {
    const quitada = sembrarFoto(IDS.compraA, IDS.lineaA1, { activo: false, quitada_at: "2026-11-01T10:00:00.000Z" });
    expect((await fotoGrande(json("GET", "/x"), ctxFoto(quitada))).status).toBe(404);
    expect((await fotoGrande(json("GET", "/x"), ctxFoto("30000000-0000-4000-8000-0000000000ff"))).status).toBe(404);
    expect((await fotoGrande(json("GET", "/x"), ctxFoto("no-uuid"))).status).toBe(404);
    const viva = sembrarFoto(IDS.compraA, IDS.lineaA1);
    escenario.fallos.firma = true;
    expect((await fotoGrande(json("GET", "/x"), ctxFoto(viva))).status).toBe(502);
    como("sin_sesion");
    expect((await fotoGrande(json("GET", "/x"), ctxFoto(viva))).status).toBe(401);
  });
});

describe("GET /api/compras/fotos/[fotoId]/miniatura", () => {
  it("R27 · devuelve los bytes con image/jpeg y las cabeceras privadas, cacheables y a prueba de nosniff", async () => {
    como("comprador");
    const id = sembrarFoto(IDS.compraA, IDS.lineaA1);
    const r = await miniatura(json("GET", "/x"), ctxFoto(id));
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("image/jpeg");
    expect(r.headers.get("cache-control")).toBe("private, max-age=86400, immutable");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(r.headers.get("content-disposition")).toBe("inline");
    expect(Array.from(new Uint8Array(await r.arrayBuffer()))).toEqual([0xff, 0xd8, 0xff, 2]);
    expect(escenario.operaciones).toEqual([`download:compras/${IDS.compraA}/${IDS.lineaA1}/${id}_min.jpg`]);
  });

  it("R27 · sin sesión 401; de una foto quitada o inexistente 404; si Storage no responde 502", async () => {
    const viva = sembrarFoto(IDS.compraA, IDS.lineaA1);
    const quitada = sembrarFoto(IDS.compraA, IDS.lineaA1, { activo: false, quitada_at: "2026-11-01T10:00:00.000Z" });
    expect((await miniatura(json("GET", "/x"), ctxFoto(quitada))).status).toBe(404);
    expect((await miniatura(json("GET", "/x"), ctxFoto("30000000-0000-4000-8000-0000000000ff"))).status).toBe(404);
    escenario.fallos.download = true;
    expect((await miniatura(json("GET", "/x"), ctxFoto(viva))).status).toBe(502);
    como("sin_sesion");
    expect((await miniatura(json("GET", "/x"), ctxFoto(viva))).status).toBe(401);
  });
});

describe("limpieza de huérfanas (R10)", () => {
  const viejo = "2026-10-01T10:00:00.000Z";
  const reciente = () => new Date().toISOString();

  function sembrarHuerfanas() {
    const activa = sembrarFoto(IDS.compraA, IDS.lineaA1);
    const quitadaVieja = sembrarFoto(IDS.compraA, IDS.lineaA1, { activo: false, quitada_at: viejo });
    const quitadaReciente = sembrarFoto(IDS.compraA, IDS.lineaA1, { activo: false, quitada_at: reciente() });
    escenario.objetos.set("compras/x/y/sin-fila-vieja.jpg", { bytes: new Uint8Array(1), created_at: viejo });
    escenario.objetos.set("compras/x/y/sin-fila-reciente.jpg", { bytes: new Uint8Array(1), created_at: reciente() });
    return { activa, quitadaVieja, quitadaReciente };
  }

  it("GET dice cuántos objetos borraría y no borra nada; solo el admin (comprador y planner 403, sin sesión 401)", async () => {
    sembrarHuerfanas();
    como("admin");
    const r = await leer<LimpiezaFotosApi>(await contarLimpieza());
    expect([r.status, r.data]).toEqual([200, { sin_fila: 1, quitadas: 2, horas: 24 }]);
    expect(escenario.operaciones).toEqual([]);
    for (const rol of ["comprador", "planner"] as const) {
      como(rol);
      expect((await contarLimpieza()).status, rol).toBe(403);
    }
    como("sin_sesion");
    expect((await contarLimpieza()).status).toBe(401);
  });

  it("POST borra exactamente esa lista, nunca la foto activa ni lo reciente, y no toca filas", async () => {
    const { activa, quitadaVieja, quitadaReciente } = sembrarHuerfanas();
    const filasAntes = JSON.stringify(tabla("compra_linea_fotos"));
    como("admin");
    const r = await leer<ResultadoLimpiezaFotosApi>(await limpiar(json("POST", "/limpiar", { confirmar: true })));
    expect([r.status, r.data]).toEqual([200, { borrados: 3, fallidos: 0 }]);
    const quedan = [...escenario.objetos.keys()].sort();
    const ruta = (compra: string, linea: string, id: string, min = false) => `compras/${compra}/${linea}/${id}${min ? "_min" : ""}.jpg`;
    expect(quedan).toEqual(
      [
        ruta(IDS.compraA, IDS.lineaA1, activa),
        ruta(IDS.compraA, IDS.lineaA1, activa, true),
        ruta(IDS.compraA, IDS.lineaA1, quitadaReciente),
        ruta(IDS.compraA, IDS.lineaA1, quitadaReciente, true),
        "compras/x/y/sin-fila-reciente.jpg",
      ].sort(),
    );
    expect(escenario.objetos.has(ruta(IDS.compraA, IDS.lineaA1, quitadaVieja))).toBe(false);
    expect(JSON.stringify(tabla("compra_linea_fotos"))).toBe(filasAntes);
  });

  it("POST pide confirmar: sin `confirmar: true` 400; comprador y planner 403; si Storage no borra, 502", async () => {
    sembrarHuerfanas();
    como("admin");
    expect((await limpiar(json("POST", "/limpiar", {}))).status).toBe(400);
    expect((await limpiar(json("POST", "/limpiar", { confirmar: false }))).status).toBe(400);
    escenario.fallos.remove = true;
    const r = await leer(await limpiar(json("POST", "/limpiar", { confirmar: true })));
    expect([r.status, r.codigo]).toEqual([502, "almacen_no_disponible"]);
    for (const rol of ["comprador", "planner"] as const) {
      como(rol);
      expect((await limpiar(json("POST", "/limpiar", { confirmar: true }))).status, rol).toBe(403);
    }
  });

  it("sin huérfanas devuelve 0 borrados", async () => {
    como("admin");
    const r = await leer<ResultadoLimpiezaFotosApi>(await limpiar(json("POST", "/limpiar", { confirmar: true })));
    expect(r.data).toEqual({ borrados: 0, fallidos: 0 });
  });
});
