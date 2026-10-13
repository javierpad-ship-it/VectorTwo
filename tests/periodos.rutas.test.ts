import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import type { AniosAtipicosRespuesta, PeriodoAtipicoApi, PeriodoAtipicoLista } from "@/lib/curvas/tipos-api";

/**
 * Rutas de M6 paso 1 contra una base falsa en memoria (sin red, sin datos
 * reales): el guard se simula y `supabaseAdmin` devuelve un cliente mínimo con
 * las pocas operaciones que usan los handlers.
 */

type Fila = Record<string, unknown>;
const estado = vi.hoisted(() => ({
  tablas: {} as Record<string, Fila[]>,
  rol: "planner" as "planner" | "comprador" | "sin_sesion",
  siguienteId: 1,
}));

vi.mock("@/lib/auth/guard", () => ({
  requirePlanner: async () => {
    if (estado.rol === "sin_sesion") return { user: null, perfil: null, rol: null, response: NextResponse.json({ error: "No autenticado." }, { status: 401 }) };
    if (estado.rol === "comprador") return { user: null, perfil: null, rol: null, response: NextResponse.json({ error: "Tu rol es de solo lectura." }, { status: 403 }) };
    return { user: {}, perfil: {}, rol: "planner", response: null };
  },
}));

class Consulta implements PromiseLike<{ data: unknown; error: null }> {
  private modo: "select" | "insert" | "update" | "delete" = "select";
  private filtros: Array<[string, unknown]> = [];
  private carga: Fila = {};
  private una: "single" | "maybeSingle" | null = null;
  private desde = 0;
  private hasta = Infinity;
  constructor(private readonly tabla: string) {}
  select() { return this; }
  insert(f: Fila) { this.modo = "insert"; this.carga = f; return this; }
  update(f: Fila) { this.modo = "update"; this.carga = f; return this; }
  delete() { this.modo = "delete"; return this; }
  eq(c: string, v: unknown) { this.filtros.push([c, v]); return this; }
  order() { return this; }
  limit() { return this; }
  range(d: number, h: number) { this.desde = d; this.hasta = h; return this; }
  single() { this.una = "single"; return this; }
  maybeSingle() { this.una = "maybeSingle"; return this; }
  then<A, B>(ok?: ((v: { data: unknown; error: null }) => A | PromiseLike<A>) | null, ko?: ((r: unknown) => B | PromiseLike<B>) | null) {
    return Promise.resolve(this.ejecutar()).then(ok, ko);
  }
  private ejecutar(): { data: unknown; error: null } {
    const filas = (estado.tablas[this.tabla] ??= []);
    const coincide = (f: Fila) => this.filtros.every(([c, v]) => f[c] === v);
    let afectadas: Fila[];
    if (this.modo === "insert") {
      const nueva: Fila = { id: `00000000-0000-4000-8000-${String(estado.siguienteId++).padStart(12, "0")}`, activo: true, descripcion: null, created_at: "2026-10-13T00:00:00Z", updated_at: "2026-10-13T00:00:00Z", ...this.carga };
      filas.push(nueva);
      afectadas = [nueva];
    } else if (this.modo === "update") {
      afectadas = filas.filter(coincide);
      for (const f of afectadas) Object.assign(f, this.carga);
    } else if (this.modo === "delete") {
      afectadas = filas.filter(coincide);
      estado.tablas[this.tabla] = filas.filter((f) => !coincide(f));
    } else {
      afectadas = filas.filter(coincide);
      if (this.tabla === "periodos_atipicos") afectadas.sort((a, b) => String(a.desde).localeCompare(String(b.desde)) || String(a.id).localeCompare(String(b.id)));
      afectadas = afectadas.slice(this.desde, this.hasta + 1);
    }
    if (this.una) return { data: afectadas[0] ?? null, error: null };
    return { data: afectadas, error: null };
  }
}

vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin: () => ({ from: (t: string) => new Consulta(t) }) }));

import { GET as listar, POST as crear } from "@/app/api/periodos-atipicos/route";
import { DELETE as eliminar, PATCH as editar } from "@/app/api/periodos-atipicos/[id]/route";
import { GET as anios } from "@/app/api/periodos-atipicos/anios/route";

const URL_BASE = "http://localhost/api/periodos-atipicos";
const json = (cuerpo: unknown, metodo = "POST") =>
  new NextRequest(URL_BASE, { method: metodo, body: JSON.stringify(cuerpo), headers: { "content-type": "application/json" } });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const leer = async <T = unknown>(r: Response) => (await r.json()) as { data: T; error?: string };

const AGR_INV = "11111111-1111-4111-8111-111111111111";
const AGR_VER = "22222222-2222-4222-8222-222222222222";
const NINO = { desde: "2023-03", hasta: "2023-05", motivo: "Niño costero 2023" };

beforeEach(() => {
  estado.rol = "planner";
  estado.siguienteId = 1;
  estado.tablas = {
    periodos_atipicos: [],
    agrupaciones_estacionalidad: [
      { id: AGR_INV, temporada: "invierno", activo: true },
      { id: "x2", temporada: "invierno", activo: true },
      { id: "x3", temporada: "invierno", activo: false },
      { id: AGR_VER, temporada: "verano", activo: true },
      { id: "x4", temporada: "todo_el_ano", activo: true },
    ],
    cargas_venta_stock: [
      ...Array.from({ length: 12 }, (_, i) => ({ periodo: `2024-${String(i + 1).padStart(2, "0")}-01`, estado: "publicada" })),
      ...Array.from({ length: 9 }, (_, i) => ({ periodo: `2026-${String(i + 1).padStart(2, "0")}-01`, estado: "publicada" })),
      { periodo: "2026-10-01", estado: "en_curso" },
    ],
  };
});

describe("guards: toda la API de periodos exige planner", () => {
  it("sin sesión 401 y comprador 403 en todos los handlers", async () => {
    for (const rol of ["sin_sesion", "comprador"] as const) {
      estado.rol = rol;
      const esperado = rol === "sin_sesion" ? 401 : 403;
      expect((await listar(new NextRequest(URL_BASE))).status).toBe(esperado);
      expect((await crear(json(NINO))).status).toBe(esperado);
      expect((await editar(json({ activo: false }, "PATCH"), ctx(AGR_INV) as never)).status).toBe(esperado);
      expect((await eliminar(new NextRequest(URL_BASE, { method: "DELETE" }), ctx(AGR_INV) as never)).status).toBe(esperado);
      expect((await anios(new NextRequest(`${URL_BASE}/anios`))).status).toBe(esperado);
    }
    expect(estado.tablas.periodos_atipicos).toEqual([]);
  });
});

describe("POST /api/periodos-atipicos", () => {
  it("201 con la fila en formato aaaa-mm, alcance invierno por defecto; guarda el primer día del mes", async () => {
    const r = await crear(json(NINO));
    expect(r.status).toBe(201);
    const { data } = await leer<PeriodoAtipicoApi>(r);
    expect(data).toMatchObject({ desde: "2023-03", hasta: "2023-05", motivo: "Niño costero 2023", descripcion: null, alcance: "invierno", activo: true });
    expect(typeof data.id).toBe("string");
    expect(estado.tablas.periodos_atipicos[0]).toMatchObject({ desde: "2023-03-01", hasta: "2023-05-01" });
  });
  it("400 con hasta anterior a desde, mes mal formado o cuerpo no JSON; no guarda nada", async () => {
    expect((await crear(json({ ...NINO, desde: "2023-06" }))).status).toBe(400);
    expect((await crear(json({ ...NINO, desde: "2023-13" }))).status).toBe(400);
    const malo = await crear(new NextRequest(URL_BASE, { method: "POST", body: "no es json" }));
    expect(malo.status).toBe(400);
    expect((await leer(malo)).error).toMatch(/JSON/);
    expect(estado.tablas.periodos_atipicos).toEqual([]);
  });
  it("permite solapes y meses futuros", async () => {
    expect((await crear(json(NINO))).status).toBe(201);
    expect((await crear(json({ desde: "2023-05", hasta: "2023-07", motivo: "Otro" }))).status).toBe(201);
    expect((await crear(json({ desde: "2027-01", hasta: "2027-03", motivo: "Futuro", alcance: "todas" }))).status).toBe(201);
  });
});

describe("GET /api/periodos-atipicos", () => {
  it("lista por desde con meses y agrupaciones afectadas; solo activos salvo ?incluir_inactivos=1", async () => {
    await crear(json({ desde: "2026-03", hasta: "2026-04", motivo: "Niño 2026" }));
    await crear(json(NINO));
    await crear(json({ desde: "2024-01", hasta: "2024-01", motivo: "Paro", alcance: "todas" }));
    const id = estado.tablas.periodos_atipicos[2].id as string;
    await editar(json({ activo: false }, "PATCH"), ctx(id) as never);

    const { data } = await leer<PeriodoAtipicoLista[]>(await listar(new NextRequest(URL_BASE)));
    expect(data.map((p) => [p.desde, p.meses, p.agrupaciones_afectadas])).toEqual([
      ["2023-03", 3, 2], // alcance invierno: 2 agrupaciones activas de invierno (la inactiva no cuenta)
      ["2026-03", 2, 2],
    ]);
    const todos = await leer<PeriodoAtipicoLista[]>(await listar(new NextRequest(`${URL_BASE}?incluir_inactivos=1`)));
    expect(todos.data.map((p) => p.desde)).toEqual(["2023-03", "2024-01", "2026-03"]);
    expect(todos.data[1]).toMatchObject({ alcance: "todas", agrupaciones_afectadas: 4, activo: false });
  });
});

describe("PATCH y DELETE /api/periodos-atipicos/[id]", () => {
  const crearNino = async () => (await leer<PeriodoAtipicoApi>(await crear(json(NINO)))).data.id;

  it("edita campos sueltos y devuelve la fila", async () => {
    const id = await crearNino();
    const r = await editar(json({ motivo: " Niño 2023 (ajustado) ", alcance: "todas", descripcion: "" }, "PATCH"), ctx(id) as never);
    expect(r.status).toBe(200);
    expect((await leer(r)).data).toMatchObject({ id, motivo: "Niño 2023 (ajustado)", alcance: "todas", descripcion: null, desde: "2023-03", hasta: "2023-05" });
  });
  it("400 si el rango resultante queda invertido contra la fila actual (solo viene un extremo)", async () => {
    const id = await crearNino();
    const r = await editar(json({ desde: "2023-06" }, "PATCH"), ctx(id) as never);
    expect(r.status).toBe(400);
    expect((await leer(r)).error).toBe("El mes final no puede ser anterior al inicial.");
    expect((await editar(json({ hasta: "2023-02" }, "PATCH"), ctx(id) as never)).status).toBe(400);
    expect(estado.tablas.periodos_atipicos[0]).toMatchObject({ desde: "2023-03-01", hasta: "2023-05-01" });
    expect((await editar(json({ hasta: "2023-03" }, "PATCH"), ctx(id) as never)).status).toBe(200);
  });
  it("400 con cuerpo vacío; 404 con id inexistente o no UUID", async () => {
    const id = await crearNino();
    expect((await editar(json({}, "PATCH"), ctx(id) as never)).status).toBe(400);
    expect((await editar(json({ activo: false }, "PATCH"), ctx("33333333-3333-4333-8333-333333333333") as never)).status).toBe(404);
    expect((await editar(json({ activo: false }, "PATCH"), ctx("no-es-uuid") as never)).status).toBe(404);
    expect((await eliminar(new NextRequest(URL_BASE, { method: "DELETE" }), ctx("no-es-uuid") as never)).status).toBe(404);
  });
  it("DELETE devuelve { id } y luego 404", async () => {
    const id = await crearNino();
    const r = await eliminar(new NextRequest(URL_BASE, { method: "DELETE" }), ctx(id) as never);
    expect(r.status).toBe(200);
    expect((await leer(r)).data).toEqual({ id });
    expect(estado.tablas.periodos_atipicos).toEqual([]);
    expect((await eliminar(new NextRequest(URL_BASE, { method: "DELETE" }), ctx(id) as never)).status).toBe(404);
  });
});

describe("GET /api/periodos-atipicos/anios", () => {
  const pedir = async (query: string) => {
    const r = await anios(new NextRequest(`${URL_BASE}/anios${query}`));
    return { status: r.status, ...(await leer<AniosAtipicosRespuesta>(r)) };
  };
  beforeEach(async () => {
    // Publicados: 2024 completo y 2026 enero a septiembre. Periodos: Niño 2023 (invierno) y 2026-03 a 2026-04 (invierno).
    await crear(json(NINO));
    await crear(json({ desde: "2026-03", hasta: "2026-04", motivo: "Niño costero 2026" }));
  });

  it("por defecto (temporada invierno): años del primer al último publicado más los años atípicos futuros", async () => {
    const { status, data } = await pedir("");
    expect(status).toBe(200);
    expect(data.criterio).toEqual({ agrupacion_id: null, temporada: "invierno" });
    // 2023 no está publicado ni entra en el rango por defecto (2024–2026) y el periodo es anterior al primer mes publicado: no se agrega.
    expect(data.anios.map((a) => [a.anio, a.clase, a.completo, a.ratio_volumen])).toEqual([
      [2024, "normal", true, null],
      [2025, "normal", false, null],
      [2026, "atipico", false, null],
    ]);
    expect(data.anios[2]).toMatchObject({ meses_atipicos: ["2026-03", "2026-04"], periodos: [{ motivo: "Niño costero 2026", alcance: "invierno" }] });
    expect(data.resumen).toEqual({ anios_atipicos: [2026], anios_normales_completos: [2024] });
  });
  it("con ?desde= y ?hasta= evalúa el rango pedido (2023 atípico aunque no esté cargado)", async () => {
    const { data } = await pedir("?desde=2023&hasta=2024");
    expect(data.anios.map((a) => [a.anio, a.clase, a.completo])).toEqual([
      [2023, "atipico", false],
      [2024, "normal", true],
    ]);
    expect(data.anios[0].meses_atipicos).toEqual(["2023-03", "2023-04", "2023-05"]);
  });
  it("con ?agrupacion_id= usa la temporada de esa agrupación: la de verano no recibe periodos de alcance invierno", async () => {
    const inv = await pedir(`?agrupacion_id=${AGR_INV}&desde=2023&hasta=2023`);
    expect(inv.data.criterio).toEqual({ agrupacion_id: AGR_INV, temporada: "invierno" });
    expect(inv.data.anios[0].clase).toBe("atipico");
    const ver = await pedir(`?agrupacion_id=${AGR_VER}&desde=2023&hasta=2023`);
    expect(ver.data.criterio).toEqual({ agrupacion_id: AGR_VER, temporada: "verano" });
    expect(ver.data.anios[0].clase).toBe("normal");
    expect(ver.data.resumen.anios_atipicos).toEqual([]);
  });
  it("?temporada=verano no ve el Niño (alcance invierno) salvo que el periodo sea de alcance todas", async () => {
    expect((await pedir("?temporada=verano&desde=2023&hasta=2023")).data.anios[0].clase).toBe("normal");
    await crear(json({ desde: "2023-07", hasta: "2023-07", motivo: "Paro", alcance: "todas" }));
    const { data } = await pedir("?temporada=verano&desde=2023&hasta=2023");
    expect(data.anios[0]).toMatchObject({ clase: "atipico", meses_atipicos: ["2023-07"] });
  });
  it("un periodo inactivo no cuenta", async () => {
    const id = estado.tablas.periodos_atipicos[1].id as string;
    await editar(json({ activo: false }, "PATCH"), ctx(id) as never);
    expect((await pedir("")).data.resumen.anios_atipicos).toEqual([]);
  });
  it("400 con los dos criterios o temporada inválida; 404 con agrupación inexistente o no UUID", async () => {
    expect((await pedir(`?agrupacion_id=${AGR_INV}&temporada=invierno`)).status).toBe(400);
    expect((await pedir("?temporada=otono")).status).toBe(400);
    expect((await pedir("?desde=2026&hasta=2023")).status).toBe(400);
    expect((await pedir("?agrupacion_id=44444444-4444-4444-8444-444444444444")).status).toBe(404);
    expect((await pedir("?agrupacion_id=basura")).status).toBe(404);
  });
  it("sin ningún mes publicado ni periodos responde años vacíos", async () => {
    estado.tablas.cargas_venta_stock = [];
    estado.tablas.periodos_atipicos = [];
    const { status, data } = await pedir("");
    expect(status).toBe(200);
    expect(data.anios).toEqual([]);
    expect(data.resumen).toEqual({ anios_atipicos: [], anios_normales_completos: [] });
  });
});
