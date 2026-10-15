import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { Tables } from "@/lib/supabase/database.types";
import { describirErrorDb } from "@/lib/api/errores-db";
import { aTiendaFila, referentesDe } from "@/lib/tiendas/consultas";
import { crearTiendaSchema, editarTiendaSchema, filaImportacionTiendaSchema, importarTiendasSchema } from "@/lib/tiendas/esquemas";
import { aplicarPlanTiendas, planificarImportacionTiendas, type EstadoImportacionTiendas, type TiendaEstado } from "@/lib/tiendas/importar";
import { motivoRechazoReferencia } from "@/lib/tiendas/reglas";
import { estadoFalso } from "./curvas.fake-db";
import { estado, reiniciar, type Fila } from "./proyeccion.fake-db";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/guard", async () => {
  const f = await import("./curvas.fake-db");
  const g = f.guardFalso();
  return { ...g, requireUser: async () => (f.estadoFalso.rol === "sin_sesion" ? g.requirePlanner() : { user: {}, perfil: f.PERFIL_FALSO, rol: f.estadoFalso.rol, response: null }) };
});
vi.mock("@/lib/supabase/admin", async () => {
  const { clienteFalso } = await import("./proyeccion.fake-db");
  return { supabaseAdmin: () => clienteFalso() };
});
vi.mock("@/lib/ventas/consultas", () => ({ contarHechos: async () => ({ cuenta: 0, error: null }) }));

import { GET as listar, POST as crear } from "@/app/api/tiendas/route";
import { DELETE as eliminar, PATCH as editar } from "@/app/api/tiendas/[id]/route";
import { POST as importar } from "@/app/api/tiendas/importar/route";

const HOY = "2026-10-15";
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const fila = (extra: Partial<Tables<"tiendas">> = {}): Tables<"tiendas"> => ({
  id: U(1),
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

describe("regla de la tienda de referencia", () => {
  const ok = { id: U(2), tipo: "Tienda", activo: true };
  const m = (o: Partial<Parameters<typeof motivoRechazoReferencia>[0]>) => motivoRechazoReferencia({ tiendaId: U(1), tipo: "Tienda", referenciaId: U(2), referente: ok, ...o });

  it("sin referencia no hay nada que rechazar; un referente de tipo Tienda, activo y distinto pasa", () => {
    expect(m({ referenciaId: null })).toBeNull();
    expect(m({ referenciaId: undefined })).toBeNull();
    expect(m({})).toBeNull();
    expect(m({ tiendaId: null })).toBeNull();
  });

  it("se rechaza: ella misma, un referente inexistente, un CD, desactivado, y un CD con referente", () => {
    expect(m({ referenciaId: U(1) })).toBe("Una tienda no puede ser su propia referencia.");
    expect(m({ referente: null })).toBe("La tienda de referencia no existe.");
    expect(m({ referente: { ...ok, tipo: "Centro de Distribución" } })).toBe("La tienda de referencia debe ser una Tienda, no un centro de distribución.");
    expect(m({ referente: { ...ok, activo: false } })).toBe("La tienda de referencia está desactivada.");
    expect(m({ tipo: "Centro de Distribución" })).toBe("Un centro de distribución no lleva tienda de referencia.");
  });
});

describe("aTiendaFila: la referencia es dato de planificación", () => {
  const referentes = referentesDe([{ id: U(2), codigo: "R2", nombre: "TIENDA DOS" }]);

  it("admin y planner ven el id y el código; el comprador recibe null en las dos (como la venta esperada)", () => {
    const f = fila({ tienda_referencia_id: U(2) });
    expect(aTiendaFila(f, HOY, true, referentes)).toMatchObject({ tienda_referencia_id: U(2), tienda_referencia: { id: U(2), codigo: "R2", nombre: "TIENDA DOS" }, venta_esperada_promedio: 85000 });
    const comprador = aTiendaFila(f, HOY, false, referentes);
    expect(comprador.tienda_referencia_id).toBeNull();
    expect(comprador.tienda_referencia).toBeNull();
    expect(comprador.venta_esperada_promedio).toBeNull();
  });

  it("sin referente o con un referente que no se resolvió, el nombre queda en null", () => {
    expect(aTiendaFila(fila(), HOY, true, referentes).tienda_referencia).toBeNull();
    expect(aTiendaFila(fila({ tienda_referencia_id: U(9) }), HOY, true, referentes)).toMatchObject({ tienda_referencia_id: U(9), tienda_referencia: null });
    expect(aTiendaFila(fila({ tienda_referencia_id: U(2) }), HOY).tienda_referencia).toBeNull();
  });
});

describe("esquemas de M4 con la referencia", () => {
  it("alta y edición aceptan un uuid o null; un texto cualquiera se rechaza", () => {
    expect(crearTiendaSchema.safeParse({ codigo: "R9", nombre: "Nueva", tienda_referencia_id: U(2) }).success).toBe(true);
    expect(crearTiendaSchema.safeParse({ codigo: "R9", nombre: "Nueva", tienda_referencia_id: null }).success).toBe(true);
    expect(crearTiendaSchema.safeParse({ codigo: "R9", nombre: "Nueva", tienda_referencia_id: "R2" }).success).toBe(false);
    expect(editarTiendaSchema.safeParse({ tienda_referencia_id: null }).data).toEqual({ tienda_referencia_id: null });
    expect(editarTiendaSchema.safeParse({ tienda_referencia_id: "x" }).success).toBe(false);
  });

  it("la fila del importador acepta la columna opcional TIENDA_REFERENCIA", () => {
    const r = importarTiendasSchema.safeParse({ modo: "previsualizar", filas: [{ codigo: "R9", nombre: "N", tienda_referencia: "R2" }] });
    expect(r.success && r.data.filas[0].tienda_referencia).toBe("R2");
    expect(filaImportacionTiendaSchema.parse({ codigo: "R9", nombre: "N" }).tienda_referencia).toBeUndefined();
  });
});

describe("importador con TIENDA_REFERENCIA", () => {
  const base = (extra: Partial<TiendaEstado>[] = []): EstadoImportacionTiendas => ({
    tiendas: [
      { id: U(1), codigo: "R1", nombre: "UNO", tipo: "Tienda", zona: null, razon_social: null, fecha_apertura: "2020-01-10", fecha_cierre: null, venta_esperada_promedio: null, activo: true, tienda_referencia_id: null },
      { id: U(2), codigo: "RD50", nombre: "CD", tipo: "Centro de Distribución", zona: null, razon_social: null, fecha_apertura: null, fecha_cierre: null, venta_esperada_promedio: null, activo: true },
      { id: U(3), codigo: "R3", nombre: "TRES", tipo: "Tienda", zona: null, razon_social: null, fecha_apertura: "2020-01-10", fecha_cierre: null, venta_esperada_promedio: null, activo: false },
      ...extra.map((e, i) => ({ id: U(10 + i), codigo: `X${i}`, nombre: `X${i}`, tipo: "Tienda", zona: null, razon_social: null, fecha_apertura: null, fecha_cierre: null, venta_esperada_promedio: null, activo: true, ...e })),
    ],
  });
  const fila = (codigo: string, referencia?: string, tipo = "Tienda") => ({ codigo, nombre: `NOMBRE ${codigo}`, tipo, zona: "", razon_social: "", fecha_apertura: "01/03/2027", fecha_cierre: "", venta_esperada: "", ...(referencia !== undefined ? { tienda_referencia: referencia } : {}) });

  it("una tienda nueva con referente en la base queda con su código de referencia", () => {
    const plan = planificarImportacionTiendas([fila("R9", "r1")], base(), HOY);
    expect(plan.reporte.omitidas).toEqual([]);
    expect(plan.tiendas).toHaveLength(1);
    expect(plan.tiendas[0].tienda_referencia_codigo).toBe("R1");
  });

  it("el referente puede ser otra tienda nueva del mismo archivo, antes o después", () => {
    const plan = planificarImportacionTiendas([fila("R8", "R9"), fila("R9")], base(), HOY);
    expect(plan.reporte.omitidas).toEqual([]);
    expect(plan.tiendas.map((t) => [t.codigo, t.tienda_referencia_codigo])).toEqual([["R8", "R9"], ["R9", undefined]]);
  });

  it("se omite con referencia_invalida: ella misma, un CD, una tienda desactivada, una que no existe y un CD con referente", () => {
    const filas = [fila("R4", "R4"), fila("R5", "RD50"), fila("R6", "R3"), fila("R7", "NOEXISTE"), fila("RD60", "R1", "Centro de Distribución")];
    const plan = planificarImportacionTiendas(filas, base(), HOY);
    expect(plan.reporte.omitidas.map((o) => [o.codigo, o.motivo])).toEqual([
      ["R4", "referencia_invalida"],
      ["R5", "referencia_invalida"],
      ["R6", "referencia_invalida"],
      ["R7", "referencia_invalida"],
      ["RD60", "referencia_invalida"],
    ]);
    expect(plan.reporte.omitidas[1]).toMatchObject({ detalle: "RD50", tienda_referencia: "RD50" });
    expect(plan.tiendas).toEqual([]);
  });

  it("una tienda existente solo se compara si el archivo trae la referencia: informa la diferencia sin modificarla", () => {
    const estado = base([{ tienda_referencia_id: U(1) }]);
    const sin = planificarImportacionTiendas([{ ...fila("X0"), fecha_apertura: "" }], estado, HOY);
    expect(sin.reporte.diferencias.filter((d) => d.campo === "tienda_referencia")).toEqual([]);
    const con = planificarImportacionTiendas([{ ...fila("X0", "R1"), fecha_apertura: "" }], estado, HOY);
    expect(con.reporte.diferencias.some((d) => d.campo === "tienda_referencia")).toBe(false); // ya apuntaba a R1
    const distinta = planificarImportacionTiendas([{ ...fila("X0", "R3"), fecha_apertura: "" }], estado, HOY);
    expect(distinta.reporte.omitidas[0].motivo).toBe("referencia_invalida"); // R3 está desactivada
    const otra = base([{ tienda_referencia_id: null }]);
    const d = planificarImportacionTiendas([{ ...fila("X0", "R1"), fecha_apertura: "" }], otra, HOY);
    expect(d.reporte.diferencias.find((x) => x.campo === "tienda_referencia")).toMatchObject({ codigo: "X0", en_base: "—", en_archivo: "R1" });
  });

  it("aplicarPlanTiendas no arrastra la referencia como columna", () => {
    const plan = planificarImportacionTiendas([fila("R9", "R1")], base(), HOY);
    const nuevo = aplicarPlanTiendas(base(), plan);
    expect(nuevo.tiendas.find((t) => t.codigo === "R9")).not.toHaveProperty("tienda_referencia_codigo");
  });
});

describe("errores de la base de M7 traducidos", () => {
  const unico = (n: string) => describirErrorDb("23505", `duplicate key value violates unique constraint "${n}"`);
  const check = (n: string) => describirErrorDb("23514", `new row violates check constraint "${n}"`);
  const fk = (n: string, tipo: "eliminar" | "asignar") =>
    describirErrorDb("23503", tipo === "eliminar" ? `update or delete on table "tiendas" violates foreign key constraint "${n}" on table "x"` : `insert or update on table "x" violates foreign key constraint "${n}"`);

  it("únicos: nombre por año, una sola cerrada por año, filas y factores", () => {
    expect(unico("proyecciones_nombre_anio_uniq")).toEqual({ status: 409, mensaje: "Ya existe una proyección con ese nombre para ese año." });
    expect(unico("proyecciones_cerrada_anio_uniq").status).toBe(409);
    expect(unico("factores_volumen_atipico_anio_temporada_key").mensaje).toBe("Ya existe un factor para ese año y temporada.");
    expect(unico("proyeccion_fila_anios_fila_anio_key").status).toBe(409);
  });

  it("checks de la 0018, con los nombres reales de la migración", () => {
    expect(check("tiendas_referencia_no_propia_check")).toEqual({ status: 400, mensaje: "Una tienda no puede ser su propia referencia." });
    expect(check("proyecciones_hasta_periodo_check").mensaje).toBe("«Datos hasta» debe ser un mes del año en curso.");
    expect(check("proyeccion_fila_anios_decision_check").mensaje).toContain("origen");
    expect(check("proyeccion_fila_anios_meses_check").mensaje).toBe("El reparto mensual debe tener doce meses.");
    expect(check("proyeccion_fila_anios_origen_meses_check").mensaje).toContain("real o proyectado");
    expect(check("proyeccion_fila_anios_subbloque_bloque_check").mensaje).toBe("El subbloque solo existe en las tiendas nuevas.");
    expect(check("proyeccion_fila_anios_vendido_check").mensaje).toBe("Lo vendido no puede ser negativo.");
    expect(check("proyeccion_filas_nivel_equivalencia_check").mensaje).toContain("GMLE");
    expect(check("proyeccion_tiendas_rampa_check").mensaje).toBe("La rampa necesita entre 1 y 6 valores.");
    expect(check("proyeccion_tiendas_origen_check").mensaje).toContain("propuesta o manual");
    expect(check("factores_volumen_atipico_ratio_aplicado_check").mensaje).toBe("El factor debe ser mayor que 0,05 y como máximo 3.");
    expect(check("proyecciones_estado_check").mensaje).toContain("proyección");
  });

  it("FK: eliminar una tienda que es referente de otra o que está en una proyección; un referente que no existe al asignar", () => {
    expect(fk("tiendas_tienda_referencia_id_fkey", "eliminar").mensaje).toContain("referencia de otra tienda");
    expect(fk("proyeccion_filas_tienda_id_fkey", "eliminar")).toEqual({ status: 409, mensaje: "La tienda está en una proyección: no se puede eliminar. Desactívala." });
    expect(fk("proyeccion_tiendas_tienda_id_fkey", "eliminar").status).toBe(409);
    expect(fk("tiendas_tienda_referencia_id_fkey", "asignar")).toEqual({ status: 404, mensaje: "Tienda de referencia no encontrada." });
    expect(fk("proyeccion_filas_gml_id_fkey", "eliminar").mensaje).toContain("proyección");
  });
});

// ─── Handlers de M4 con la base falsa ───

const U1 = U(101);
const U2 = U(102);
const U3 = U(103);
const tienda = (id: string, codigo: string, extra: Fila = {}): Fila => ({ id, codigo, nombre: `TIENDA ${codigo}`, tipo: "Tienda", zona: null, razon_social: null, tienda_referencia_id: null, fecha_apertura: "2025-01-01", fecha_cierre: null, venta_esperada_promedio: 1000, activo: true, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", ...extra });
const json = (metodo: string, cuerpo: unknown, ruta = "") => new NextRequest(`http://localhost/api/tiendas${ruta}`, { method: metodo, body: JSON.stringify(cuerpo), headers: { "content-type": "application/json" } });
const ctxId = (id: string) => ({ params: Promise.resolve({ id }) }) as never;
const leer = async <T = unknown>(r: Response) => (await r.json()) as { data: T; error?: string };

describe("handlers de tiendas con la referencia", () => {
  beforeEach(() => {
    reiniciar();
    estadoFalso.rol = "planner";
    estado.tablas.tiendas = [tienda(U1, "R1"), tienda(U2, "R2", { tienda_referencia_id: U1 }), tienda(U3, "RD50", { tipo: "Centro de Distribución", venta_esperada_promedio: null })];
  });
  afterEach(() => vi.restoreAllMocks());

  it("GET: planner ve la referencia con su nombre; comprador la recibe en null; los inactivos entran solo si se piden", async () => {
    const r = await leer<{ codigo: string; tienda_referencia_id: string | null; tienda_referencia: { codigo: string } | null; venta_esperada_promedio: number | null }[]>(await listar(new NextRequest("http://localhost/api/tiendas")));
    expect(r.data.find((t) => t.codigo === "R2")).toMatchObject({ tienda_referencia_id: U1, tienda_referencia: { id: U1, codigo: "R1", nombre: "TIENDA R1" }, venta_esperada_promedio: 1000 });
    estadoFalso.rol = "comprador";
    const c = await leer<typeof r.data>(await listar(new NextRequest("http://localhost/api/tiendas")));
    expect(c.data.find((t) => t.codigo === "R2")).toMatchObject({ tienda_referencia_id: null, tienda_referencia: null, venta_esperada_promedio: null });
    estadoFalso.rol = "planner";
    estado.tablas.tiendas.push(tienda(U(104), "R4", { activo: false }));
    expect((await leer<unknown[]>(await listar(new NextRequest("http://localhost/api/tiendas")))).data).toHaveLength(3);
    expect((await leer<unknown[]>(await listar(new NextRequest("http://localhost/api/tiendas?incluir_inactivos=1")))).data).toHaveLength(4);
  });

  it("POST con referencia: la guarda; rechaza un CD, una desactivada, una inexistente y un CD con referente (400)", async () => {
    const nueva = (extra: Record<string, unknown>) => crear(json("POST", { codigo: "R9", nombre: "Nueva", fecha_apertura: "2027-03-15", ...extra }));
    const ok = await nueva({ tienda_referencia_id: U1 });
    expect(ok.status).toBe(201);
    expect((await leer<{ tienda_referencia: { codigo: string } }>(ok)).data.tienda_referencia.codigo).toBe("R1");
    expect(estado.tablas.tiendas.find((t) => t.codigo === "R9")?.tienda_referencia_id).toBe(U1);
    expect((await nueva({ codigo: "R8", nombre: "Otra", tienda_referencia_id: U3 })).status).toBe(400);
    estado.tablas.tiendas.find((t) => t.id === U2)!.activo = false;
    expect((await nueva({ codigo: "R7", nombre: "Otra2", tienda_referencia_id: U2 })).status).toBe(400);
    expect((await nueva({ codigo: "R6", nombre: "Otra3", tienda_referencia_id: U(999) })).status).toBe(400);
    expect((await nueva({ codigo: "RD9", nombre: "CD nuevo", tipo: "Centro de Distribución", tienda_referencia_id: U1 })).status).toBe(400);
    expect((await nueva({ codigo: "R5", nombre: "Mal", tienda_referencia_id: "R1" })).status).toBe(400);
  });

  it("PATCH: cambia o quita la referencia; no puede ser ella misma ni un CD; una referencia vieja desactivada no impide editar otros campos", async () => {
    const r = await editar(json("PATCH", { tienda_referencia_id: U1 }, "/x"), ctxId(U3.replace("103", "102")));
    expect(r.status).toBe(200);
    const propia = await editar(json("PATCH", { tienda_referencia_id: U2 }, "/x"), ctxId(U2));
    expect(propia.status).toBe(400);
    expect((await leer(propia)).error).toBe("Una tienda no puede ser su propia referencia.");
    expect((await editar(json("PATCH", { tienda_referencia_id: U3 }, "/x"), ctxId(U1))).status).toBe(400);
    const quita = await editar(json("PATCH", { tienda_referencia_id: null }, "/x"), ctxId(U2));
    expect((await leer<{ tienda_referencia_id: string | null }>(quita)).data.tienda_referencia_id).toBeNull();
    // R2 apunta a R1; R1 se desactiva después: editar la zona de R2 sigue permitido, volver a elegir esa referencia no.
    estado.tablas.tiendas.find((t) => t.id === U2)!.tienda_referencia_id = U1;
    estado.tablas.tiendas.find((t) => t.id === U1)!.activo = false;
    expect((await editar(json("PATCH", { zona: "NORTE" }, "/x"), ctxId(U2))).status).toBe(200);
    expect((await editar(json("PATCH", { tienda_referencia_id: U1 }, "/x"), ctxId(U2))).status).toBe(400);
    // Pasar a CD una tienda con referente se rechaza.
    estado.tablas.tiendas.find((t) => t.id === U1)!.activo = true;
    expect((await editar(json("PATCH", { tipo: "Centro de Distribución", venta_esperada_promedio: null }, "/x"), ctxId(U2))).status).toBe(400);
  });

  it("DELETE: una tienda que es referente de otra, o que está en una proyección, responde 409 con un mensaje útil; una libre se elimina", async () => {
    const referente = await eliminar(new NextRequest("http://localhost/api/tiendas/x", { method: "DELETE" }), ctxId(U1));
    expect(referente.status).toBe(409);
    expect((await leer(referente)).error).toContain("referencia de otra tienda");
    estado.tablas.proyeccion_tiendas = [{ id: "pt", proyeccion_id: "p", tienda_id: U2, anio: 2026 }];
    const enProyeccion = await eliminar(new NextRequest("http://localhost/api/tiendas/x", { method: "DELETE" }), ctxId(U2));
    expect(enProyeccion.status).toBe(409);
    expect((await leer(enProyeccion)).error).toBe("La tienda está en una proyección: no se puede eliminar. Desactívala.");
    estado.tablas.proyeccion_filas = [{ id: "pf", proyeccion_id: "p", tienda_id: U3 }];
    expect((await eliminar(new NextRequest("http://localhost/api/tiendas/x", { method: "DELETE" }), ctxId(U3))).status).toBe(409);
    estado.tablas.proyeccion_tiendas = [];
    estado.tablas.proyeccion_filas = [];
    estado.tablas.tiendas.find((t) => t.id === U2)!.tienda_referencia_id = null;
    expect((await eliminar(new NextRequest("http://localhost/api/tiendas/x", { method: "DELETE" }), ctxId(U1))).status).toBe(200);
  });

  it("importar (aplicar): inserta las nuevas y asigna la referencia al final, con ids ya creados; previsualizar no escribe", async () => {
    const cuerpo = (modo: string) => ({
      modo,
      filas: [
        { codigo: "R20", nombre: "Veinte", tipo: "Tienda", fecha_apertura: "2027-03-15", tienda_tienda: "", tienda_referencia: "R21" },
        { codigo: "R21", nombre: "Veintiuno", tipo: "Tienda", fecha_apertura: "2027-04-15", tienda_referencia: "R1" },
        { codigo: "R22", nombre: "Veintidos", tipo: "Tienda", tienda_referencia: "NOEXISTE" },
      ],
    });
    const prev = await leer<{ crear: { tiendas: number }; omitidas: { codigo: string; motivo: string }[] }>(await importar(json("POST", cuerpo("previsualizar"), "/importar")));
    expect(prev.data.crear.tiendas).toBe(2);
    expect(prev.data.omitidas).toMatchObject([{ codigo: "R22", motivo: "referencia_invalida" }]);
    expect(estado.tablas.tiendas).toHaveLength(3);
    const ap = await importar(json("POST", cuerpo("aplicar"), "/importar"));
    expect(ap.status).toBe(200);
    const t = (c: string) => estado.tablas.tiendas.find((x) => x.codigo === c) as Fila;
    expect(t("R21").tienda_referencia_id).toBe(U1);
    expect(t("R20").tienda_referencia_id).toBe(t("R21").id);
    expect(estado.tablas.tiendas).toHaveLength(5);
    // Los campos extra del plan no van a la tabla.
    expect(t("R20")).not.toHaveProperty("tienda_referencia_codigo");
  });
});
