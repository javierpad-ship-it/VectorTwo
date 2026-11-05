import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { MENSAJES_LECTURA_LENTA } from "@/lib/api/plazos";
import { estado as base, reiniciar, type Fila } from "./proyeccion.fake-db";
import {
  ajustes,
  catalogoFalso,
  estadoRol,
  GEN,
  GM_HU,
  GM_MC,
  GM_MU,
  GM_NINO,
  MUN,
  NODO,
  P_ID,
  seriesMujerUrbano,
  sembrarVentaPorTienda,
  T,
} from "./proyeccion.venta-por-tienda.fixture";

// Los módulos de la base y del contexto se cargan dentro de la fábrica para que sean los mismos que importa este archivo.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/guard", async () => (await import("./proyeccion.venta-por-tienda.fixture")).guardFalso());
vi.mock("@/lib/supabase/admin", async () => {
  const { clienteFalso } = await import("./proyeccion.fake-db");
  return { supabaseAdmin: () => clienteFalso() };
});
vi.mock("@/lib/proyeccion/contexto", async (original) => {
  const real = await original<typeof import("@/lib/proyeccion/contexto")>();
  const falso = await import("./proyeccion.venta-por-tienda.fixture");
  return { ...real, cargarCatalogo: async () => ({ data: { catalogo: falso.catalogoFalso(), equivalencias: [], nodosDb: [], generos: [] }, respuesta: null }) };
});

import { GET as porTienda } from "@/app/api/proyeccion/proyecciones/[id]/crecimientos/por-tienda/route";
import { GET as crecimientos } from "@/app/api/proyeccion/proyecciones/[id]/crecimientos/route";
import type { ResumenCrecimientosProyeccionApi, VentaPorTiendaApi } from "@/lib/proyeccion/tipos-api";

/**
 * 07f · `GET /api/proyeccion/proyecciones/[id]/crecimientos/por-tienda` con la base falsa (ficha §6, reglas 1, 5, 9 y 10). Sintético: ver
 * `proyeccion.venta-por-tienda.fixture.ts`. La lógica numérica se prueba en `proyeccion.venta-por-tienda.test.ts`.
 */

const URL_BASE = "http://localhost/api/proyeccion/proyecciones";
const ctx = (id: string) => ({ params: Promise.resolve({ id }) }) as never;
const pedir = (gm: string | null, id = P_ID, consulta = "") =>
  porTienda(new NextRequest(`${URL_BASE}/${id}/crecimientos/por-tienda${gm === null ? "" : `?gm=${gm}`}${consulta}`), ctx(id));
const leer = async <T = unknown>(r: Response) => (await r.json()) as { data: T; error?: string; codigo?: string };
const datos = async (gm: string) => {
  const r = await pedir(gm);
  expect(r.status, `GET gm=${gm}`).toBe(200);
  return (await leer<VentaPorTiendaApi>(r)).data;
};
const suma = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const INEXISTENTE = "00000000-0000-4000-8000-999999999999";

beforeEach(() => {
  reiniciar();
  estadoRol.rol = "admin";
  sembrarVentaPorTienda();
});

describe("regla 10 · permisos y errores de la ruta", () => {
  it("sin sesión 401; el comprador 403 (no ve Planificación); admin y planner ven la venta por tienda", async () => {
    estadoRol.rol = "sin_sesion";
    expect((await pedir(GM_MU)).status).toBe(401);
    estadoRol.rol = "comprador";
    expect((await pedir(GM_MU)).status).toBe(403);
    expect(base.llamadasVentaTienda).toHaveLength(0);
    for (const rol of ["admin", "planner"] as const) {
      estadoRol.rol = rol;
      expect((await pedir(GM_MU)).status, rol).toBe(200);
    }
  });

  it("400 con gm vacío, mal formado o con un parámetro de más; el mensaje va en castellano y no se llama a la base (sin gm es la lista de conjuntos)", async () => {
    for (const gm of ["", "mujer", "abc.def", `${GEN.mujer}`, `${GEN.mujer}.${MUN.urbano}.x`, "RESTO", `${GEN.mujer},${MUN.urbano}`]) {
      const r = await pedir(gm);
      expect(r.status, String(gm)).toBe(400);
      expect(typeof (await leer(r)).error).toBe("string");
    }
    const extra = await pedir(GM_MU, P_ID, "&otro=1");
    expect(extra.status).toBe(400);
    expect(base.llamadasVentaTienda).toHaveLength(0);
  });

  it("404 con un id que no es uuid o que no existe; sin tocar la venta", async () => {
    expect((await pedir(GM_MU, "no-es-uuid")).status).toBe(404);
    const r = await pedir(GM_MU, INEXISTENTE);
    expect(r.status).toBe(404);
    expect((await leer(r)).error).toBe("Proyección no encontrada.");
    expect(base.llamadasVentaTienda).toHaveLength(0);
  });

  it("404 gm_no_encontrado con un género o un mundo que no están en el catálogo", async () => {
    for (const gm of [`${INEXISTENTE}.${MUN.urbano}`, `${GEN.mujer}.${INEXISTENTE}`]) {
      const r = await pedir(gm);
      expect(r.status).toBe(404);
      expect((await leer(r)).codigo).toBe("gm_no_encontrado");
    }
  });

  it("400 genero_no_detallado con un género que no es HOMBRE ni MUJER: va en el Resto", async () => {
    const r = await pedir(GM_NINO);
    expect(r.status).toBe(400);
    const c = await leer(r);
    expect(c.codigo).toBe("genero_no_detallado");
    expect(c.error).toBe("Ese género va en el Resto: usa gm=resto.");
    expect(base.llamadasVentaTienda).toHaveLength(0);
  });

  it("409 sin_calcular si la proyección nunca se calculó (sin bloques)", async () => {
    reiniciar();
    sembrarVentaPorTienda({ parametros: {} });
    const r = await pedir(GM_MU);
    expect(r.status).toBe(409);
    const c = await leer(r);
    expect(c.codigo).toBe("sin_calcular");
    expect(c.error).toBe("Calcula la proyección para ver la venta por tienda.");
  });

  it("409 calculo_en_curso si hay un cálculo vivo; uno caducado no bloquea", async () => {
    reiniciar();
    sembrarVentaPorTienda({ calculandoDesde: new Date().toISOString() });
    const r = await pedir(GM_MU);
    expect(r.status).toBe(409);
    expect((await leer(r)).codigo).toBe("calculo_en_curso");
    reiniciar();
    sembrarVentaPorTienda({ calculandoDesde: "2020-01-01T00:00:00.000Z" });
    expect((await pedir(GM_MU)).status).toBe(200);
  });

  it("200 con motivo_nulo = metodo_anterior en una proyección de método 3, y las columnas reales siguen; sin_filas en un GM sin filas base", async () => {
    reiniciar();
    sembrarVentaPorTienda({ resumen: { version_metodo: 3 } });
    const viejo = await datos(GM_MU);
    expect(viejo.base).toMatchObject({ total: null, corregida: null, motivo_nulo: "metodo_anterior" });
    expect(viejo.tiendas.find((t) => t.codigo === "T01")?.periodos["2026-ac"]?.u).toBe(6000);
    expect(viejo.tiendas.every((t) => t.vigente === null)).toBe(true);

    reiniciar();
    sembrarVentaPorTienda();
    const sinFilas = await datos(`${GEN.hombre}.${MUN.casual}`);
    expect(sinFilas.base).toMatchObject({ total: null, motivo_nulo: "sin_filas", tiendas: 4 });
  });

  it("503 si la lectura se corta por tiempo; 500 si la función devuelve algo que no es el documento; el mensaje no filtra el detalle o la función devuelve algo que no es el documento; el mensaje no filtra el detalle", async () => {
    base.errorVentaTienda = { code: "57014", message: "canceling statement due to statement timeout" };
    const r = await pedir(GM_MU);
    expect(r.status).toBe(503);
    const lenta = await leer(r);
    expect(lenta.codigo).toBe("lectura_lenta");
    expect(lenta.error).toBe(MENSAJES_LECTURA_LENTA.ventaTienda);
    expect(JSON.stringify(lenta)).not.toContain("statement timeout");
    base.errorVentaTienda = null;
    base.ventaTienda = () => ({ series: "no", cargas: [] });
    const malo = await pedir(GM_MU);
    expect(malo.status).toBe(500);
    expect((await leer(malo)).error).toBe("No se pudo leer la venta por tienda. Inténtalo de nuevo.");
  });

  it("la respuesta no se guarda en caché", async () => {
    expect((await pedir(GM_MU)).headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("corrección 2026-11-05 · la lista de conjuntos (GET sin gm)", () => {
  type Lista = { conjuntos: { clave: string; nombre: string; es_resto: boolean }[] };
  const MUNDOS = ["CASUAL", "DEPORTIVO", "FORMAL", "RI", "URBANO"];
  const sembrarCincoMundos = () => {
    base.tablas.mundos = MUNDOS.map((nombre, i) => ({ id: `b0000001-0000-4000-8000-00000000000${i + 1}`, nombre, orden: i + 1, activo: true }));
  };

  it("devuelve HOMBRE y MUJER × sus cinco mundos y el Resto: 11 conjuntos con la clave que acepta ?gm=", async () => {
    sembrarCincoMundos();
    const r = await pedir(null);
    expect(r.status).toBe(200);
    const { conjuntos } = (await leer<Lista>(r)).data;
    expect(conjuntos).toHaveLength(11);
    expect(conjuntos.map((c) => c.nombre)).toEqual([
      ...["HOMBRE", "MUJER"].flatMap((g) => MUNDOS.map((m) => `${g} · ${m}`)),
      "Resto",
    ]);
    expect(conjuntos.at(-1)).toEqual({ clave: "resto", nombre: "Resto", es_resto: true });
    expect(conjuntos.slice(0, -1).every((c) => !c.es_resto && /^[0-9a-f-]{36}\.[0-9a-f-]{36}$/i.test(c.clave))).toBe(true);
    expect(conjuntos.some((c) => c.nombre.startsWith("NIÑO"))).toBe(false);
  });

  it("no depende de las filas ni del cálculo: igual con una proyección de método anterior o sin calcular, y sin leer venta, filas ni tiendas", async () => {
    sembrarCincoMundos();
    for (const opciones of [{ resumen: { version_metodo: 3 } }, { parametros: {} }]) {
      reiniciar();
      sembrarVentaPorTienda(opciones);
      sembrarCincoMundos();
      const operaciones: string[] = [];
      base.alOperar = (tabla, operacion) => operaciones.push(`${operacion} ${tabla}`);
      const r = await pedir(null);
      expect(r.status).toBe(200);
      expect((await leer<Lista>(r)).data.conjuntos).toHaveLength(11);
      expect(operaciones.filter((o) => !/ (proyecciones|generos|mundos)$/.test(o))).toEqual([]);
      expect(base.llamadasVentaTienda).toHaveLength(0);
    }
  });

  it("deja fuera los mundos inactivos y los géneros que no son HOMBRE ni MUJER", async () => {
    base.tablas.mundos = [
      { id: MUN.urbano, nombre: "URBANO", orden: 1, activo: true },
      { id: MUN.casual, nombre: "CASUAL", orden: 2, activo: false },
    ];
    const { conjuntos } = (await leer<Lista>(await pedir(null))).data;
    expect(conjuntos.map((c) => c.nombre)).toEqual(["HOMBRE · URBANO", "MUJER · URBANO", "Resto"]);
  });

  it("cada clave de la lista la acepta la propia ruta con ?gm= (200)", async () => {
    const { conjuntos } = (await leer<Lista>(await pedir(null))).data;
    for (const c of conjuntos) expect((await pedir(c.clave)).status, c.clave).toBe(200);
  });

  it("404 si la proyección no existe; 401 y 403 con el mismo guard", async () => {
    expect((await pedir(null, INEXISTENTE)).status).toBe(404);
    expect((await pedir(null, "no-es-uuid")).status).toBe(404);
    estadoRol.rol = "sin_sesion";
    expect((await pedir(null)).status).toBe(401);
    estadoRol.rol = "comprador";
    expect((await pedir(null)).status).toBe(403);
  });
});

describe("la lectura de venta: nodos, rango y forma", () => {
  it("MUJER · URBANO pide solo sus dos nodos de enero de Y−3 al último mes cerrado, una sola vez", async () => {
    await datos(GM_MU);
    expect(base.llamadasVentaTienda).toHaveLength(1);
    const a = base.llamadasVentaTienda[0];
    expect([...a.p_gml_ids].sort()).toEqual([NODO.mu1, NODO.mu2].sort());
    expect(a.p_desde).toBe("2023-01-01");
    expect(a.p_hasta).toBe("2026-09-01");
  });

  it("el Resto agrupa los nodos de los géneros que no son HOMBRE ni MUJER y no pide ninguno de los otros", async () => {
    const r = await datos("resto");
    expect(base.llamadasVentaTienda[0].p_gml_ids).toEqual([NODO.nu]);
    expect(r.conjunto).toEqual({ clave: "resto", nombre: "Resto", es_resto: true });
    expect(r.base).toMatchObject({ total: 500, tiendas: 4, entran: ["T10"], motivo_nulo: null });
    // T01 es la única que vendió (450): todo el resto de la base (500) es suyo.
    expect(r.tiendas.find((t) => t.codigo === "T01")?.vigente).toEqual({ u: 500, real: 450, proyectado: 50, exacto: false });
    expect(r.tiendas.find((t) => t.codigo === "T10")?.vigente?.u).toBe(0);
  });

  it("la forma de la respuesta de MUJER · URBANO (caso sintético §8): conjunto, corte, periodos, base, tiendas, totales y avisos", async () => {
    const r = await datos(GM_MU);
    expect(r.conjunto).toEqual({ clave: GM_MU, nombre: "MUJER · URBANO", es_resto: false });
    expect(r).toMatchObject({ anio_en_curso: 2026, anio_siguiente: 2027, hasta_periodo: "2026-09", k: 9 });
    expect(r.base).toEqual({ total: 15600, corregida: 16400, tiendas: 4, entran: ["T10"], sin_atribuir: 0, motivo_nulo: null });
    expect(r.tiendas.map((t) => [t.codigo, t.grupo, t.estado])).toEqual([
      ["T01", "base", "misma"],
      ["T02", "base", "misma"],
      ["T10", "base", "entra"],
      ["T03", "base", "misma"],
      ["T04", "fuera", "sale"],
      ["T11", "fuera", "abrio_en_curso"],
      ["T09", "fuera", "cerro"],
    ]);
    expect(r.tiendas.filter((t) => t.grupo === "base").map((t) => t.vigente?.u)).toEqual([8400, 4200, 1600, 1400]);
    expect(r.totales.base.vigente).toBe(15600);
    expect(r.avisos.map((a) => a.codigo)).toEqual(["filas_sin_base"]);
    expect(Object.keys(r).sort()).toEqual(["anio_en_curso", "anio_siguiente", "avisos", "base", "conjunto", "hasta_periodo", "k", "periodos", "tiendas", "totales"]);
  });

  it("el CD, aunque la función devuelva una serie suya, no aparece en ninguna parte de la respuesta", async () => {
    // La base falsa SÍ devuelve al CD (la función SQL real no lo hace): el backend es la segunda red.
    expect(JSON.stringify(seriesMujerUrbano())).toContain(T.CD1);
    const r = await datos(GM_MU);
    expect(JSON.stringify(r)).not.toContain(T.CD1);
    expect(JSON.stringify(r)).not.toContain("CD1");
    expect(r.totales.conjunto.periodos["2026-ac"]?.u).toBe(12400);
  });

  it("aunque la función devuelva meses posteriores al corte, «2026 ene–set» no los incluye", async () => {
    ajustes.extra = [{ t: T.T01, p: "2026-10", u: 5000, s: 400000 }];
    base.ventaTienda = (args) => ({
      series: [...seriesMujerUrbano().filter((s) => s.t !== T.CD1), { t: T.T01, p: "2026-10", u: 5000, s: 400000 }].filter((s) => args.p_gml_ids.includes(NODO.mu1) && s.p >= "2023-01"),
      cargas: { "2026-09": "c9", "2026-10": "c10" },
    });
    const r = await datos(GM_MU);
    expect(r.tiendas.find((t) => t.codigo === "T01")?.periodos["2026-ac"]?.u).toBe(6000);
  });

  it("meses sin carga: el periodo lo dice y el aviso lo nombra", async () => {
    ajustes.sinCargas = ["2024-03"];
    const r = await datos(GM_MU);
    expect(r.periodos.find((p) => p.clave === "2024")?.meses_faltantes).toEqual(["2024-03"]);
    expect(r.avisos.find((a) => a.codigo === "meses_faltantes")?.mensaje).toContain("mar 2024");
  });

  it("una tienda creada después de calcular, con venta, sale sin_bloque y fuera; las fechas de M4 de hoy no mueven a las demás de grupo", async () => {
    ajustes.extra = [{ t: T.T12, p: "2026-03", u: 40, s: 2000 }];
    (base.tablas.tiendas as Fila[]).find((t) => t.id === T.T03)!.fecha_cierre = "2026-03-31";
    const r = await datos(GM_MU);
    expect(r.tiendas.find((t) => t.codigo === "T12")).toMatchObject({ grupo: "fuera", estado: "sin_bloque" });
    expect(r.tiendas.find((t) => t.codigo === "T03")).toMatchObject({ grupo: "base", estado: "misma" });
    expect(r.avisos.map((a) => a.codigo)).toContain("sin_bloque");
    expect(r.base.total).toBe(15600);
  });

  it("el código y el nombre de la tienda son los de hoy; la clasificación sigue siendo la del cálculo", async () => {
    (base.tablas.tiendas as Fila[]).find((t) => t.id === T.T01)!.nombre = "Tienda 1 renombrada";
    const r = await datos(GM_MU);
    expect(r.tiendas.find((t) => t.codigo === "T01")).toMatchObject({ nombre: "Tienda 1 renombrada", estado: "misma" });
  });
});

describe("regla 1 · el cuadre con GET …/crecimientos", () => {
  it("base.total de cada GM y del Resto es el agregado.base de la misma celda, y Σ vigente + sin atribuir = base.total en enteros", async () => {
    const r = await crecimientos(new NextRequest(`${URL_BASE}/${P_ID}/crecimientos`), ctx(P_ID));
    expect(r.status).toBe(200);
    const resumen = (await leer<ResumenCrecimientosProyeccionApi>(r)).data;
    const conjuntos = [
      { gm: GM_MU, agregado: resumen.filas.find((f) => f.clave === GM_MU)?.agregado },
      { gm: GM_HU, agregado: resumen.filas.find((f) => f.clave === GM_HU)?.agregado },
      { gm: GM_MC, agregado: resumen.filas.find((f) => f.clave === GM_MC)?.agregado },
      { gm: "resto", agregado: resumen.resto.agregado },
    ];
    for (const { gm, agregado } of conjuntos) {
      expect(agregado, gm).toBeDefined();
      const v = await datos(gm);
      expect(v.base.total, gm).toBe(agregado?.base);
      expect(v.base.corregida, gm).toBe(agregado?.base_normalizada);
      const enBase = v.tiendas.filter((t) => t.grupo === "base");
      expect(suma(enBase.map((t) => t.vigente?.u ?? 0)) + v.base.sin_atribuir, gm).toBe(v.base.total);
      expect(v.totales.base.vigente, gm).toBe(v.base.total);
    }
    // Los números del caso: MUJER · URBANO 15 600 (Σ B de A y B; la fila C sin curva no cuenta), HOMBRE · URBANO 2 000 y el Resto 500.
    expect(resumen.filas.find((f) => f.clave === GM_MU)?.agregado.base).toBe(15600);
  });

  it("HOMBRE · URBANO: la fila de T10 (77) es de este GM y no del otro; el reparto 962 / 961 / 0 cuadra con Σ B = 2 000", async () => {
    const hu = await datos(GM_HU);
    expect(hu.base.total).toBe(2000);
    const vigente = (c: string) => hu.tiendas.find((t) => t.codigo === c)?.vigente?.u;
    expect([vigente("T01"), vigente("T02"), vigente("T03"), vigente("T10")]).toEqual([962, 961, 0, 77]);
    const mu = await datos(GM_MU);
    expect(mu.tiendas.find((t) => t.codigo === "T10")?.vigente?.u).toBe(1600);
  });
});

describe("regla 9 · solo lectura y aislamiento", () => {
  it("la ruta no escribe nada: solo lecturas y la función venta_tienda_nodos (otro rpc haría fallar la base falsa)", async () => {
    const operaciones: string[] = [];
    base.alOperar = (tabla, operacion) => operaciones.push(`${operacion} ${tabla}`);
    const antes = JSON.stringify(base.tablas);
    await datos(GM_MU);
    await datos("resto");
    expect(operaciones.filter((o) => !o.startsWith("select "))).toEqual([]);
    expect(operaciones.some((o) => /ia_|venta_lineas_ia|historico/.test(o))).toBe(false);
    expect(JSON.stringify(base.tablas)).toBe(antes);
    expect(base.llamadasVentaTienda).toHaveLength(2);
  });

  it("el catálogo falso del test tiene los cinco nodos del caso (sanidad del fixture)", () => {
    expect([...catalogoFalso().nodos.keys()].sort()).toEqual(Object.values(NODO).sort());
  });
});
