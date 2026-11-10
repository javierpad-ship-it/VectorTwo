import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/guard", async () => (await import("./direccion.fake-db")).guardFalso());
vi.mock("@/lib/supabase/admin", async () => {
  const { clienteFalso } = await import("./direccion.fake-db");
  return { supabaseAdmin: () => clienteFalso() };
});
vi.mock("@/lib/direccion/contexto", async (original) => {
  const real = await original<typeof import("@/lib/direccion/contexto")>();
  const fx = await import("./direccion.fixture");
  return { ...real, leerMaestros: async () => ({ data: fx.maestrosCaso(), respuesta: null }), leerNinoDeHoy: async () => ({ data: fx.ninoCaso.valor, respuesta: null }) };
});
vi.mock("@/lib/tiendas/estado", async (original) => {
  const soporte = await import("./direccion.soporte");
  return { ...(await original<typeof import("@/lib/tiendas/estado")>()), hoyLima: () => soporte.relojDePrueba.hoy };
});

import { GET as opciones } from "@/app/api/direccion/opciones/route";
import { GET as tablero } from "@/app/api/direccion/tablero/route";
import { vaciarCachesDireccion } from "@/lib/direccion/servicio";
import type { OpcionesTableroApi, TableroApi } from "@/lib/direccion/tipos-api";
import type { FilaCrecimiento } from "@/lib/proyeccion/crecimientos";
import { armarVentaPorTienda, vigentesDeTiendasNuevas, type SerieVentaTienda } from "@/lib/proyeccion/venta-por-tienda";
import { base, estadoDireccion, estadoRol, fotoDeLaBase, reiniciar, sembrar, type Fila } from "./direccion.fake-db";
import {
  AM_A,
  AM_B,
  CD1,
  ESPERADO,
  G_HOMBRE,
  G_MUJER,
  G_NINO,
  HU_BASE_2027_MESES,
  K,
  L1_HU,
  L2_HU,
  MARCA_X,
  M_URBANO,
  P_EN_TRABAJO,
  P_MOSTRADA,
  P_SEGUIMIENTO,
  T01,
  T02,
  T03,
  T04,
  T10,
  T12,
  TIENDAS,
  Y,
  bloquesCaso,
  hechosCaso,
  reiniciarNino,
  sembrarCaso,
  sembrarProyeccion,
  suma,
  ventaHU,
} from "./direccion.fixture";
import { leer, pedir, relojDePrueba } from "./direccion.soporte";

/**
 * Ficha 14 · `GET /api/direccion/tablero` y `/opciones` sobre la base falsa con el caso sintético de §6.1 (R1, R2, R3, R5, R6, R9, R10, R22 y la
 * parte de ejecución de R24). Ningún dato real.
 */

const HU = { generos: G_HOMBRE, mundo_id: M_URBANO };

beforeEach(() => {
  reiniciar();
  reiniciarNino();
  vaciarCachesDireccion();
  estadoRol.rol = "admin";
  relojDePrueba.hoy = "2026-11-10";
  sembrarCaso();
});

const ver = async (consulta: Record<string, string | undefined> = {}): Promise<TableroApi> => {
  const r = await tablero(pedir("/tablero", consulta));
  const cuerpo = await leer<TableroApi>(r);
  expect(r.status, JSON.stringify(cuerpo).slice(0, 400)).toBe(200);
  return cuerpo.data;
};
const fila = (t: TableroApi, clave: string) => {
  const f = t.tabla_mensual.filas.find((x) => x.clave === clave);
  if (!f) throw new Error(`No hay fila ${clave}`);
  return f;
};
const serie = (t: TableroApi, clave: string) => {
  const s = t.series.find((x) => x.clave === clave);
  if (!s) throw new Error(`No hay serie ${clave}`);
  return s;
};
const comparativo = (t: TableroApi, clave: string) => {
  const c = t.kpis.comparativos.find((x) => x.clave === clave);
  if (!c) throw new Error(`No hay comparativo ${clave}`);
  return c;
};
const anioDe = (t: TableroApi["desglose"]["total"], anio: number) => t.anios.find((a) => a.anio === anio)?.total ?? null;
const registros = (proyeccionId: string, anio: number): Fila[] => {
  const filas = new Set((base.tablas.proyeccion_filas ?? []).filter((f) => f.proyeccion_id === proyeccionId && f.activo).map((f) => f.id));
  return (base.tablas.proyeccion_fila_anios ?? []).filter((a) => filas.has(a.fila_id) && a.activo && a.anio === anio);
};

describe("R1 · lo proyectado es lo guardado por M7", () => {
  it("sin filtros, el total de cada año es Σ (decidido ?? propuesto) de los registros activos y cada mes es la suma de `meses`", async () => {
    const t = await ver();
    for (const [anio, clave, total] of [
      [Y, `cierre_${Y}`, t.kpis.cierre],
      [Y + 1, `proyectado_${Y + 1}`, t.kpis.siguiente],
    ] as const) {
      const rs = registros(P_MOSTRADA, anio);
      expect(total).toBe(suma(rs.map((r) => Number(r.decidido ?? r.propuesto))));
      const meses = Array.from({ length: 12 }, (_, i) => suma(rs.map((r) => (r.meses as number[])[i])));
      expect(fila(t, clave).meses).toEqual(meses);
      expect(fila(t, clave).total).toBe(total);
    }
    expect(t.kpis.cierre).toBe(78501);
    expect(t.kpis.siguiente).toBe(84714);
    expect(t.kpis.exactitud).toBe("exacto");
    expect(t.filtros).toEqual({ texto: "", exactitud: "exacto", conjunto_tiendas: null });
    expect(t.proyeccion).toMatchObject({ id: P_MOSTRADA, estado: "cerrada", k: K, hasta_periodo: "2026-09", cerrada_por_nombre: "Planner P.", usa_compras: true, version_metodo: 5 });
  });

  it("un registro sin `meses` suma al total y no al gráfico: sale la alerta `sin_curva` con la diferencia exacta", async () => {
    const r = registros(P_MOSTRADA, Y + 1).find((x) => x.decidido === 4300);
    if (!r) throw new Error("falta el registro");
    r.meses = null;
    vaciarCachesDireccion();
    const t = await ver(HU);
    expect(t.kpis.siguiente).toBe(52708);
    expect(suma(fila(t, `proyectado_${Y + 1}`).meses.map((x) => x ?? 0))).toBe(52708 - 4300);
    const alerta = t.alertas.find((a) => a.codigo === "sin_curva");
    expect(alerta?.nivel).toBe("importante");
    expect(alerta?.alcance).toBe("recorte");
    expect(alerta?.cifras.u).toBe(4300);
  });
});

describe("R2 · lo real es la venta publicada, sin el CD", () => {
  it("HOMBRE · URBANO: 40 000, 42 000 y 47 000; la venta del CD no aparece en ninguna cifra", async () => {
    const t = await ver(HU);
    expect([t.kpis.hace_tres, t.kpis.hace_dos, t.kpis.anterior]).toEqual([40000, 42000, 47000]);
    for (const anio of [2023, 2024, 2025]) {
      const esperado = Array.from({ length: 12 }, (_, i) => suma(TIENDAS.filter((x) => x.tipo === "Tienda").map((x) => ventaHU(x.id, anio, i + 1))));
      expect(serie(t, `real_${anio}`).meses).toEqual(esperado);
    }
    // Las 900 u del CD de junio de 2025 no están: junio es solo de tiendas.
    expect(serie(t, "real_2025").meses[5]).toBe(1837 + 1138 + 877 + 296);
    expect(estadoDireccion.hechos.some((h) => h.tienda_id === CD1 && h.u === 900)).toBe(true);
    expect(t.datos.tiendas.some((x) => x.tienda_id === CD1)).toBe(false);
    // El stock del CD solo cuenta en la cobertura.
    expect(t.apoyo.cobertura.stock_cd).toBe(12000);
  });

  it("sin filtros, el real de cada mes es la suma de unidades de las ubicaciones de tipo Tienda", async () => {
    const t = await ver();
    const tiendas = new Set(TIENDAS.filter((x) => x.tipo === "Tienda").map((x) => x.id));
    const hechos = hechosCaso().filter((h) => tiendas.has(h.tienda_id));
    for (const anio of [2023, 2024, 2025]) {
      const esperado = Array.from({ length: 12 }, (_, i) => suma(hechos.filter((h) => h.periodo === `${anio}-${String(i + 1).padStart(2, "0")}`).map((h) => h.u)));
      expect(serie(t, `real_${anio}`).meses).toEqual(esperado);
    }
    expect(t.kpis.anterior).toBe(74500);
  });
});

describe("R6 · cierre del año en curso", () => {
  it("2026 cierre = vendido guardado (ene–set) + proyectado (oct–dic); el real llega a octubre y no se suma dos veces", async () => {
    const t = await ver(HU);
    expect(t.kpis.cierre).toBe(50001);
    expect(t.kpis.proyectado_resto).toBe(16001);
    // Real de enero a setiembre (k) y de enero a octubre (k', lo publicado).
    expect(t.kpis.real_ac).toBe(34000);
    expect(t.kpis.real_ac + t.kpis.proyectado_resto).toBe(t.kpis.cierre);
    expect(t.kpis.real_ac_k_prima).toBe(38300);
    expect(t.datos.k_prima).toBe(10);
    expect(t.datos.ultimo_publicado).toBe("2026-10");
    // Octubre: real 4 300 y proyectado 3 900 a la vez.
    expect(serie(t, `real_${Y}`).meses[9]).toBe(4300);
    expect(serie(t, `proyectado_${Y}`).meses[9]).toBe(3900);
    expect(serie(t, `real_${Y}`).meses.slice(10)).toEqual([null, null]);
    expect(serie(t, `proyectado_${Y}`).meses.slice(0, 9)).toEqual(new Array(9).fill(null));
    expect(fila(t, `cierre_${Y}`).meses[9]).toBe(3900);
    expect(t.alertas.some((a) => a.codigo === "datos_mas_nuevos" && a.nivel === "info")).toBe(true);
  });

  it("2023 y 2026 son años del Niño y hay una línea «2026 sin Niño» derivada (solo sin tiendas ni bloque)", async () => {
    const t = await ver(HU);
    expect(t.datos.anios_nino).toEqual([2023, 2026]);
    expect(serie(t, "real_2023").nino).toBe(true);
    expect(serie(t, "real_2025").nino).toBe(false);
    const sinNino = serie(t, `sin_nino_${Y}`);
    expect(sinNino.tipo).toBe("sin_nino");
    // Junio a agosto: las dos filas de invierno (1 720 u) divididas por 0,70.
    const cierre = fila(t, `cierre_${Y}`).meses as number[];
    expect(suma((sinNino.meses as number[]).slice(5, 8)) - suma(cierre.slice(5, 8))).toBeCloseTo(1720 * (1 / 0.7 - 1), 1);
    expect((sinNino.meses as number[]).slice(0, 5)).toEqual(cierre.slice(0, 5));
    const conTienda = await ver({ ...HU, tiendas: T03 });
    expect(conTienda.series.some((s) => s.tipo === "sin_nino")).toBe(false);
    expect(comparativo(t, "sig_vs_anterior").etiqueta).toBe("2027 vs 2025 (último año normal)");
  });
});

describe("R5 · los totales cuadran entre tarjetas, tabla, gráfico y desglose", () => {
  it("para cada dimensión del desglose, Σ filas = total y el total es el de las tarjetas", async () => {
    for (const desglose of ["genero", "mundo", "linea", "agrupacion_marca", "temporada", "tienda"] as const) {
      const t = await ver({ ...HU, desglose });
      const d = t.desglose;
      expect(d.dimension).toBe(desglose);
      for (const anio of [Y - 3, Y - 2, Y - 1, Y, Y + 1]) {
        expect(suma(d.filas.map((f) => anioDe(f, anio) ?? 0)), `${desglose} ${anio}`).toBe(anioDe(d.total, anio));
      }
      expect(anioDe(d.total, Y + 1), desglose).toBe(t.kpis.siguiente);
      expect(anioDe(d.total, Y), desglose).toBe(t.kpis.cierre);
      expect(anioDe(d.total, Y - 1), desglose).toBe(t.kpis.anterior);
      expect(d.total.ac_en_curso, desglose).toBe(t.kpis.real_ac_k_prima);
      expect(serie(t, `proyectado_${Y + 1}`).total, desglose).toBe(t.kpis.siguiente);
      expect(fila(t, `proyectado_${Y + 1}`).total, desglose).toBe(t.kpis.siguiente);
      expect(suma(d.filas.map((f) => f.participacion_siguiente ?? 0)), desglose).toBeCloseTo(1, 9);
    }
  });

  it("desglose por línea: una fila por nodo, filtrable, con 2027 exacto de lo guardado", async () => {
    const t = await ver({ ...HU, desglose: "linea" });
    const denim = t.desglose.filas.find((f) => f.id === L1_HU);
    const abrigo = t.desglose.filas.find((f) => f.id === L2_HU);
    expect(denim?.nombre).toBe("HOMBRE · URBANO · DENIM");
    expect(anioDe(denim as never, Y + 1)).toBe(25000 + 12000 + 1000 + 1408);
    expect(anioDe(abrigo as never, Y + 1)).toBe(9000 + 4300);
    expect(denim?.filtrable).toBe(true);
    expect(denim?.exactitud).toBe("exacto");
    // Ordenado por 2027 descendente.
    expect(t.desglose.filas.map((f) => f.id)).toEqual([L1_HU, L2_HU]);
  });

  it("con marca (redondeo por mes) la diferencia entre el total y la suma de los meses es de a lo sumo 12 u por año, y va rotulada «estimado»", async () => {
    const t = await ver({ ...HU, am: AM_A, marca: MARCA_X, desglose: "linea" });
    const s = serie(t, `proyectado_${Y + 1}`);
    expect(Math.abs((s.total ?? 0) - suma(s.meses.map((x) => x ?? 0)))).toBeLessThanOrEqual(12);
    expect(Math.abs((anioDe(t.desglose.total, Y + 1) ?? 0) - t.kpis.siguiente)).toBeLessThanOrEqual(12);
    expect(s.exactitud).toBe("estimado");
    expect(t.desglose.filas.every((f) => f.exactitud === "estimado")).toBe(true);
  });
});

describe("R9 · marca (unidad de marca)", () => {
  it("lo proyectado es la participación de la unidad en cada fila base; la venta es la de TODAS las marcas de la unidad", async () => {
    const t = await ver({ ...HU, am: AM_A, marca: MARCA_X });
    // 0,63 × (25 000 + 1 408) + 0,40 × 9 000 ≈ 20 237 (± 12 por el redondeo mensual).
    expect(Math.abs(t.kpis.siguiente - (0.63 * (25000 + 1408) + 0.4 * 9000))).toBeLessThanOrEqual(12);
    expect(t.kpis.exactitud).toBe("estimado");
    expect(t.filtros.texto).toContain("marca: Marca X");
    // Venta de 2025: las marcas X y X2 (la unidad), no solo la cabeza.
    const deUnidad = hechosCaso().filter((h) => (h.marca_id === MARCA_X || h.marca_id.endsWith("000000000002")) && h.periodo.startsWith("2025") && h.tienda_id !== CD1 && (h.gml_id === L1_HU || h.gml_id === L2_HU));
    expect(t.kpis.anterior).toBe(suma(deUnidad.map((h) => h.u)));
    const soloCabeza = suma(deUnidad.filter((h) => h.marca_id === MARCA_X).map((h) => h.u));
    expect(t.kpis.anterior).toBeGreaterThan(soloCabeza);
    const alerta = t.alertas.find((a) => a.codigo === "marca_estimada");
    expect(alerta?.nivel).toBe("info");
    expect(alerta?.detalle).toContain("Marca X");
  });

  it("una fila base sin `por_marca` suma a «sin participación» y no a la serie", async () => {
    // MUJER · URBANO: la fila L2 · AM-B no trae `por_marca`.
    const t = await ver({ generos: G_MUJER, mundo_id: M_URBANO, desglose: "marca" });
    const alerta = t.alertas.find((a) => a.codigo === "marca_estimada");
    expect(alerta?.cifras.sin_participacion).toBe(11100 + 12000);
    expect(alerta?.detalle).toContain("quedan fuera");
    const x = t.desglose.filas.find((f) => f.id === MARCA_X);
    expect(anioDe(x as never, Y + 1)).toBe(20006);
    // «Marca» se puede elegir sin agrupación: la del filtro se deduce de la unidad.
    const sinAm = await ver({ ...HU, marca: MARCA_X });
    expect(Math.abs(sinAm.kpis.siguiente - 20237)).toBeLessThanOrEqual(12);
  });

  it("400 `marca_fuera_de_agrupacion` si la unidad es de otra agrupación que las elegidas", async () => {
    const r = await tablero(pedir("/tablero", { am: AM_B, marca: MARCA_X }));
    expect(r.status).toBe(400);
    expect((await leer(r)).codigo).toBe("marca_fuera_de_agrupacion");
  });
});

describe("R10 · filtros combinados", () => {
  it("la unión disjunta de las agrupaciones de marca y la de las temporadas suman el total sin ese filtro", async () => {
    const todo = await ver(HU);
    const a = await ver({ ...HU, am: AM_A });
    const b = await ver({ ...HU, am: AM_B });
    for (const k of ["siguiente", "cierre", "anterior", "hace_dos", "real_ac"] as const) expect(a.kpis[k] + b.kpis[k], k).toBe(todo.kpis[k]);
    expect((a.kpis.real_ac_k_prima ?? 0) + (b.kpis.real_ac_k_prima ?? 0)).toBe(todo.kpis.real_ac_k_prima);
    const invierno = await ver({ ...HU, temporadas: "invierno" });
    const anual = await ver({ ...HU, temporadas: "todo_el_ano" });
    for (const k of ["siguiente", "cierre", "anterior"] as const) expect(invierno.kpis[k] + anual.kpis[k], k).toBe(todo.kpis[k]);
    expect(invierno.kpis.siguiente).toBe(13300);
    expect(invierno.filtros.texto).toBe("HOMBRE · URBANO · Invierno");
    // A ∧ B es menor o igual que A y que B.
    const ambos = await ver({ ...HU, am: AM_A, temporadas: "invierno" });
    expect(ambos.kpis.siguiente).toBe(9000);
    expect(ambos.kpis.siguiente).toBeLessThanOrEqual(Math.min(a.kpis.siguiente, invierno.kpis.siguiente));
    expect(ambos.kpis.anterior).toBeLessThanOrEqual(Math.min(a.kpis.anterior, invierno.kpis.anterior));
  });

  it("varios géneros a la vez; el atajo «Resto» da lo mismo que elegir uno a uno sus géneros", async () => {
    const dos = await ver({ generos: `${G_HOMBRE},${G_MUJER}` });
    const todo = await ver();
    expect(dos.kpis.siguiente).toBe(todo.kpis.siguiente);
    expect(dos.filtros.texto).toBe("HOMBRE, MUJER");
    const resto = await ver({ resto: "1" });
    const nino = await ver({ generos: G_NINO });
    expect(resto.kpis).toEqual(nino.kpis);
    expect(resto.kpis.siguiente).toBe(0);
    expect(resto.filtros.texto).toBe("Resto");
    // Lo de «Para decidir» no depende de los filtros.
    expect(resto.puente.por_gm).toEqual(todo.puente.por_gm);
    expect(resto.crecimientos).toEqual(todo.crecimientos);
    expect(resto.huella).toBe(todo.huella);
    expect(resto.decidir.alertas_importantes).toBe(todo.decidir.alertas_importantes);
  });

  it("la línea exige un género y un mundo, y debe ser de ellos", async () => {
    const t = await ver({ ...HU, linea_id: L2_HU });
    expect(t.kpis.siguiente).toBe(13300);
    expect(t.filtros.texto).toBe("HOMBRE · URBANO · ABRIGO");
    expect((await tablero(pedir("/tablero", { generos: G_MUJER, mundo_id: M_URBANO, linea_id: L2_HU }))).status).toBe(400);
    expect((await tablero(pedir("/tablero", { mundo_id: M_URBANO, linea_id: L2_HU }))).status).toBe(400);
  });

  it("el filtro de tienda no cambia lo que se pide de venta por tienda (la atribución necesita a todas) y sí recorta stock y desglose", async () => {
    await ver({ ...HU, tiendas: T03 });
    const llamada = estadoDireccion.llamadas.tablero_venta.find((p) => p.solo_tendencia === false && Array.isArray(p.tienda_ids));
    expect(llamada?.tienda_ids).toEqual([T03]);
    expect(llamada?.gml_ids).toEqual([L1_HU, L2_HU]);
    expect(llamada).toMatchObject({ proyeccion_id: P_MOSTRADA, desde: "2023-01-01", hasta: "2026-10-01", k: 9, k_prima: 10, desglose: "mundo" });
    // `tablero_proyeccion` nunca recibe tiendas.
    expect(estadoDireccion.llamadas.tablero_proyeccion.every((x) => !("tienda_ids" in x.p))).toBe(true);
  });

  it("400 con más tiendas, agrupaciones o géneros de los permitidos, o con un parámetro desconocido o repetido", async () => {
    const muchos = (n: number) => Array.from({ length: n }, (_, i) => `a0000009-0000-4000-8000-${String(i).padStart(12, "0")}`).join(",");
    const malas: Record<string, string>[] = [{ tiendas: muchos(31) }, { am: muchos(41) }, { generos: muchos(21) }, { mundo: M_URBANO }, { bloque: "otras" }, { generos: "no-es-uuid" }];
    for (const q of malas) {
      const r = await tablero(pedir("/tablero", q));
      expect(r.status, JSON.stringify(q)).toBe(400);
      expect(typeof (await leer(r)).error).toBe("string");
    }
    const { NextRequest } = await import("next/server");
    expect((await tablero(new NextRequest(`http://localhost/api/direccion/tablero?bloque=mismas&bloque=nuevas`))).status).toBe(400);
    expect((await tablero(pedir("/tablero", { tiendas: CD1 }))).status).toBe(400);
  });
});

describe("§3.4 y §6.1 · tiendas y bloques", () => {
  it("R3 · el «2026 cierre» de cada tienda misma es el «cierre vigente» de 07f, en enteros; el de la que entra, su vigente exacto", async () => {
    const t = await ver({ ...HU, desglose: "tienda" });
    // Las mismas entradas que arma `armarVentaPorTienda` para HOMBRE · URBANO, con la base falsa.
    const nodos = new Set([L1_HU, L2_HU]);
    const porClave = new Map<string, SerieVentaTienda>();
    for (const h of hechosCaso()) {
      if (!nodos.has(h.gml_id) || h.periodo > "2026-09") continue;
      const x = porClave.get(`${h.tienda_id}|${h.periodo}`) ?? { t: h.tienda_id, p: h.periodo, u: 0, s: 0 };
      x.u += h.u;
      x.s += h.s;
      porClave.set(`${h.tienda_id}|${h.periodo}`, x);
    }
    const filasDb = (base.tablas.proyeccion_filas ?? []).filter((f) => f.proyeccion_id === P_MOSTRADA && nodos.has(String(f.gml_id)));
    const anios = base.tablas.proyeccion_fila_anios ?? [];
    const filasBase: FilaCrecimiento[] = filasDb
      .filter((f) => f.tienda_id === null)
      .map((f) => {
        const a = anios.find((x) => x.fila_id === f.id && x.anio === Y + 1) as Fila;
        return { fila_id: String(f.id), genero_id: G_HOMBRE, mundo_id: M_URBANO, crecimiento_pct: null, decidido: a.decidido as number, propuesto: a.propuesto as number, base_siguiente: a.base_siguiente as number, base_normalizada: a.base_normalizada as number, sobre_base: "corregida" };
      });
    const conB = new Set(filasDb.filter((f) => f.tienda_id === null).map((f) => String(f.clave)));
    const nuevas = filasDb
      .filter((f) => f.tienda_id !== null)
      .flatMap((f) => {
        const a = anios.find((x) => x.fila_id === f.id && x.anio === Y && x.bloque === "nuevas");
        return a ? [{ tienda_id: String(f.tienda_id), clave: String(f.clave), vigente: Number(a.decidido ?? a.propuesto ?? 0) }] : [];
      });
    const cargas: Record<string, string> = {};
    for (const c of base.tablas.cargas_venta_stock ?? []) if (String(c.periodo).slice(0, 7) <= "2026-09") cargas[String(c.periodo).slice(0, 7)] = String(c.id);
    const bloques = bloquesCaso();
    const de07f = armarVentaPorTienda({
      conjunto: { clave: `${G_HOMBRE}.${M_URBANO}`, nombre: "HOMBRE · URBANO", es_resto: false },
      anio: Y,
      hastaPeriodo: "2026-09",
      k: K,
      versionMetodo: 5,
      series: [...porClave.values()],
      cargas,
      bloquesY: bloques[Y],
      bloquesSig: bloques[Y + 1],
      maestro: new Map(TIENDAS.map((x) => [x.id, { id: x.id, codigo: x.codigo, nombre: x.nombre, tipo: x.tipo === "Tienda" ? "Tienda" : "Centro de Distribución", fecha_apertura: x.fecha_apertura, fecha_cierre: x.fecha_cierre }])),
      filasBase,
      vigentes: vigentesDeTiendasNuevas(nuevas, conB),
      fueraBase: null,
    });
    const cierreDe = (id: string) => anioDe(t.desglose.filas.find((f) => f.id === id) as never, Y);
    for (const tienda of de07f.tiendas.filter((x) => x.estado === "misma")) {
      expect(cierreDe(tienda.tienda_id), tienda.codigo).toBe(tienda.vigente?.u);
    }
    expect(de07f.tiendas.filter((x) => x.estado === "misma").map((x) => x.codigo).sort()).toEqual(["T01", "T02", "T03"]);
    expect(cierreDe(T01)).toBe(ESPERADO.a2026[T01]);
    expect(cierreDe(T03)).toBe(7404);
    const entra = de07f.tiendas.find((x) => x.estado === "entra");
    expect(entra?.tienda_id).toBe(T10);
    expect(cierreDe(T10)).toBe(entra?.vigente?.u);
    expect(cierreDe(T10)).toBe(4100);
  });

  it("filtro T03: 2026 cierre 7 404 (real ene–set + 659, 673 y 1 072) y 2027 7 917 mes a mes, todo «estimado», con su participación a la vista", async () => {
    const t = await ver({ ...HU, tiendas: T03 });
    expect(t.kpis.anterior).toBe(7500);
    expect(t.kpis.cierre).toBe(7404);
    expect(t.kpis.siguiente).toBe(7917);
    expect(t.kpis.exactitud).toBe("estimado");
    expect(fila(t, `cierre_${Y}`).meses).toEqual([313, 281, 344, 563, 750, 812, 844, 687, 406, 659, 673, 1072]);
    expect(fila(t, `proyectado_${Y + 1}`).meses).toEqual(ESPERADO.t03_2027);
    expect(fila(t, `proyectado_${Y + 1}`).exactitud).toBe("estimado");
    expect(serie(t, "real_2025").exactitud).toBe("exacto");
    expect(t.filtros.texto).toBe("HOMBRE · URBANO · tiendas: T03 · cifras de T03 estimadas");
    expect(t.filtros.conjunto_tiendas).toEqual({ etiqueta: "Tiendas elegidas (1): T03", codigos: ["T03"] });
    expect(t.puente.recorte).toBeNull();
    const a = t.atribucion?.tiendas[0];
    expect(a?.codigo).toBe("T03");
    expect(a?.participacion_anual).toBeCloseTo(0.157, 3);
    expect(a?.participacion_mes[0]).toBeCloseTo(0.115, 3);
    expect(a?.participacion_mes[5]).toBeCloseTo(0.228, 3);
    expect(t.atribucion?.sin_atribuir).toEqual({ en_curso: 0, siguiente: 0 });
    expect(t.atribucion?.mensual).toBe(true);
    const alerta = t.alertas.find((x) => x.codigo === "atribucion_estimada");
    expect(alerta?.detalle).toBe("T03: 2027 estimado con su parte de la base 2026 (15.7 %) y, mes a mes, con su participación de cada mes de 2025 (de 11.5 % en ene a 22.8 % en jun).");
    // Cobertura: 2 500 u sin CD entre (7 906 ÷ 12) = 3,8 meses, estimado.
    expect(t.apoyo.cobertura.stock_tiendas).toBe(2500);
    expect(t.apoyo.cobertura.stock_cd).toBeNull();
    expect(t.apoyo.cobertura.imi_proyectado).toBeCloseTo(2500 / (7906 / 12), 6);
    expect(t.apoyo.cobertura.exactitud).toBe("estimado");
    // La alerta de tienda nueva (T10) no es de este recorte.
    expect(t.alertas.some((x) => x.alcance === "recorte" && x.codigo === "tienda_nueva_relevante")).toBe(false);
  });

  it("filtro T04 (cierra en 2027): 2026 estimado 2 961 (226, 260 y 475 de oct a dic) y 2027 exacto 1 000", async () => {
    const t = await ver({ ...HU, tiendas: T04 });
    expect(t.kpis.cierre).toBe(2961);
    expect(t.kpis.siguiente).toBe(1000);
    expect((fila(t, `cierre_${Y}`).meses as number[]).slice(9)).toEqual(ESPERADO.t04_oct_dic);
    expect(fila(t, `cierre_${Y}`).exactitud).toBe("estimado");
    expect(fila(t, `proyectado_${Y + 1}`).exactitud).toBe("exacto");
    expect(fila(t, `proyectado_${Y + 1}`).meses).toEqual([150, 140, 150, 160, 200, 200, 0, 0, 0, 0, 0, 0]);
    expect(t.alertas.find((x) => x.codigo === "atribucion_estimada")?.detalle).toContain("T04: su 2026 es estimado (su parte de lo que sale de la base de 2027: 2,961 u); su 2027, hasta el cierre, es exacto");
    expect(t.atribucion?.tiendas).toEqual([]);
  });

  it("filtro T12 (apertura de 2027): historia vacía, 2027 exacto 1 408, comparativos «nueva» y `apertura_sin_historia`", async () => {
    const t = await ver({ ...HU, tiendas: T12 });
    expect([t.kpis.hace_tres, t.kpis.hace_dos, t.kpis.anterior, t.kpis.cierre]).toEqual([0, 0, 0, 0]);
    expect(t.kpis.siguiente).toBe(1408);
    expect(t.kpis.exactitud).toBe("exacto");
    expect(comparativo(t, "sig_vs_cierre").total).toEqual({ pct: null, motivo: "nueva" });
    expect(comparativo(t, "sig_vs_anterior").total).toEqual({ pct: null, motivo: "nueva" });
    expect(comparativo(t, "sig_vs_cierre").mismas).toEqual({ pct: null, tiendas: [], motivo: "sin_base", pct_corregido: null });
    expect(t.alertas.some((x) => x.codigo === "apertura_sin_historia" && x.alcance === "recorte")).toBe(true);
    expect(t.alertas.some((x) => x.codigo === "atribucion_estimada")).toBe(false);
  });

  it("bloque «Mismas tiendas de 2027»: T01, T02, T03 y T10; 2025 43 800; 2026 cierre 47 040 (= B); 2027 50 300, exactos", async () => {
    const t = await ver({ ...HU, bloque: "mismas" });
    expect(t.filtros.conjunto_tiendas).toEqual({ etiqueta: "Mismas tiendas de 2027 (4): T01, T02, T03, T10", codigos: ["T01", "T02", "T03", "T10"] });
    expect(t.kpis.anterior).toBe(43800);
    expect(t.kpis.cierre).toBe(47040);
    expect(t.kpis.siguiente).toBe(50300);
    // 2026 ene–set de esas cuatro tiendas: 32 000.
    expect(t.kpis.real_ac).toBe(32000);
    expect(comparativo(t, "sig_vs_cierre").mismas.pct_corregido).toBeCloseTo((50300 / 47793 - 1) * 100, 9);
    // Cada mes de 2027 es la columna de la base.
    expect(fila(t, `proyectado_${Y + 1}`).meses).toEqual(HU_BASE_2027_MESES);
    expect(comparativo(t, "sig_vs_cierre").mismas.pct).toBeCloseTo((50300 / 47040 - 1) * 100, 9);
    // Con el bloque y además tiendas elegidas, la intersección.
    const dos = await ver({ ...HU, bloque: "mismas", tiendas: `${T03},${T04}` });
    expect(dos.filtros.conjunto_tiendas?.codigos).toEqual(["T03"]);
    expect(dos.kpis.siguiente).toBe(7917);
    const cierres = await ver({ ...HU, bloque: "cierres" });
    expect(cierres.filtros.conjunto_tiendas?.codigos).toEqual(["T04"]);
    expect([cierres.kpis.cierre, cierres.kpis.siguiente]).toEqual([2961, 1000]);
    const nuevas = await ver({ ...HU, bloque: "nuevas" });
    expect(nuevas.filtros.conjunto_tiendas?.codigos).toEqual(["T12"]);
    expect(nuevas.kpis.siguiente).toBe(1408);
  });

  it("desglose por tienda: cada tienda con su 2026 y su 2027 (exacto o estimado) y la suma es el total del recorte", async () => {
    const t = await ver({ ...HU, desglose: "tienda" });
    const de = (id: string) => t.desglose.filas.find((f) => f.id === id);
    expect(anioDe(de(T03) as never, Y + 1)).toBe(7917);
    expect(de(T03)?.exactitud).toBe("estimado");
    expect(anioDe(de(T12) as never, Y + 1)).toBe(1408);
    expect(de(T12)?.exactitud).toBe("exacto");
    expect(anioDe(de(T04) as never, Y)).toBe(2961);
    expect(anioDe(de(T10) as never, Y)).toBe(4100);
    expect(anioDe(de(T10) as never, Y + 1)).toBe(ESPERADO.a2027[T10]);
    expect(t.desglose.filas.some((f) => f.id === "sin_atribuir")).toBe(false);
    expect(t.kpis.exactitud).toBe("exacto");
  });

  it("con tiendas elegidas, el desglose por otra dimensión reparte lo atribuido con una sola tasa y sigue sumando el total (§3.4 F)", async () => {
    const t = await ver({ ...HU, tiendas: T03, desglose: "linea" });
    expect(suma(t.desglose.filas.map((f) => anioDe(f, Y + 1) ?? 0))).toBe(7917);
    expect(suma(t.desglose.filas.map((f) => anioDe(f, Y) ?? 0))).toBe(7404);
    expect(anioDe(t.desglose.total, Y - 1)).toBe(7500);
    expect(t.desglose.filas.every((f) => f.exactitud === "estimado")).toBe(true);
    // DENIM (37 000 de la base) y ABRIGO (13 300): la misma tasa para los dos.
    const denim = anioDe(t.desglose.filas.find((f) => f.id === L1_HU) as never, Y + 1) ?? 0;
    expect(Math.abs(denim - (7917 * 37000) / 50300)).toBeLessThan(1);
  });

  it("si lo vendido supera lo atribuido no hay reparto mensual por tienda: los meses salen sin dato y la alerta lo explica", async () => {
    // La base B queda por debajo de lo ya vendido: se baja B de todas las filas de HOMBRE · URBANO.
    for (const r of registros(P_MOSTRADA, Y + 1)) if (r.base_siguiente !== null && Number(r.base_siguiente) < 25000 && Number(r.base_siguiente) > 3000 && Number(r.base_siguiente) !== 17400 && Number(r.base_siguiente) !== 11100) r.base_siguiente = Math.round(Number(r.base_siguiente) * 0.6);
    vaciarCachesDireccion();
    const t = await ver({ ...HU, tiendas: T03 });
    expect(t.atribucion?.mensual).toBe(false);
    expect((fila(t, `cierre_${Y}`).meses as (number | null)[]).slice(9)).toEqual([null, null, null]);
    expect((fila(t, `cierre_${Y}`).meses as (number | null)[]).slice(0, 9).every((x) => x !== null)).toBe(true);
    expect(fila(t, `cierre_${Y}`).total).toBe(t.kpis.cierre);
    expect(t.alertas.find((x) => x.codigo === "atribucion_sin_mensual")?.nivel).toBe("importante");
    // El año siguiente sí se reparte.
    expect(suma((fila(t, `proyectado_${Y + 1}`).meses as number[]).map((x) => x ?? 0))).toBe(t.kpis.siguiente);
    expect(t.apoyo.cobertura.imi_proyectado).toBeNull();
  });
});

describe("comparada", () => {
  it("por defecto se compara con la última aprobada (otra proyección): sus series, con los mismos filtros, y la alerta de «datos hasta» distintos", async () => {
    const t = await ver(HU);
    expect(t.comparada).toMatchObject({ id: P_SEGUIMIENTO, motivo: "aprobada", huella_igual_a_aprobada: true, hasta_periodo: "2026-08" });
    expect(serie(t, `comparada_${Y + 1}`).tipo).toBe("aprobada");
    expect(serie(t, `comparada_${Y + 1}`).total).toBe(52500);
    expect(t.alertas.find((a) => a.codigo === "comparada_distinta_k")?.detalle).toBe("La comparada se calculó con datos hasta ago 2026.");
    const sin = await ver({ ...HU, comparar_id: "ninguna" });
    expect(sin.comparada).toBeNull();
    expect(sin.series.some((s) => s.clave.startsWith("comparada_"))).toBe(false);
    expect(sin.alertas.some((a) => a.codigo === "comparada_distinta_k")).toBe(false);
  });

  it("una comparada elegida que no es la aprobada va como «elegida»; pedir la misma que se ve es `400 comparar_igual`", async () => {
    sembrarProyeccion({ id: P_EN_TRABAJO, nombre: "Proyección 2026–2027 seguimiento nov", estado: "en_trabajo", creada: "2026-11-08T15:00:00.000Z" });
    const t = await ver({ comparar_id: P_EN_TRABAJO });
    expect(t.comparada).toMatchObject({ id: P_EN_TRABAJO, motivo: "elegida", huella_igual_a_aprobada: null });
    expect(serie(t, `comparada_${Y + 1}`).tipo).toBe("comparada");
    expect(serie(t, `comparada_${Y + 1}`).total).toBe(84714);
    // Los dos ids explícitos e iguales los rechaza el esquema; la mostrada por defecto y la comparada pedida iguales, la ruta.
    for (const q of [{ proyeccion_id: P_MOSTRADA, comparar_id: P_MOSTRADA }, { comparar_id: P_MOSTRADA }]) {
      const r = await tablero(pedir("/tablero", q));
      expect(r.status).toBe(400);
      expect((await leer(r)).codigo).toBe("comparar_igual");
    }
    const noExiste = await tablero(pedir("/tablero", { comparar_id: "00000000-0000-4000-8000-999999999999" }));
    expect(noExiste.status).toBe(404);
    expect((await leer(noExiste)).codigo).toBe("proyeccion_no_encontrada");
  });
});

describe("R22 · qué se abre por defecto (`/opciones`)", () => {
  const leerOpciones = async () => (await leer<OpcionesTableroApi>(await opciones())).data;

  it("la cerrada que usa Compras y, para comparar, la proyección de la última aprobación no rechazada", async () => {
    const o = await leerOpciones();
    expect(o.por_defecto).toEqual({ proyeccion_id: P_MOSTRADA, motivo: "usa_compras" });
    expect(o.comparar_por_defecto).toEqual({ proyeccion_id: P_SEGUIMIENTO, aprobacion_id: "ad000000-0000-4000-8000-000000000900" });
    expect(o.proyecciones.map((p) => [p.id, p.estado, p.usa_compras, p.estado_direccion])).toEqual([
      [P_MOSTRADA, "cerrada", true, "sin_aprobacion"],
      [P_SEGUIMIENTO, "archivada", false, "aprobada"],
    ]);
    expect(o.generos).toEqual([
      { id: G_HOMBRE, nombre: "HOMBRE", es_resto: false },
      { id: G_MUJER, nombre: "MUJER", es_resto: false },
      { id: G_NINO, nombre: "NIÑO", es_resto: true },
    ]);
    expect(o.temporadas.map((x) => x.id)).toEqual(["invierno", "verano", "todo_el_ano", "sin_temporada"]);
    expect(o.lineas.find((l) => l.id === L1_HU)).toEqual({ id: L1_HU, nombre: "DENIM", genero_id: G_HOMBRE, mundo_id: M_URBANO });
    expect(o.unidades_marca.find((u) => u.id === MARCA_X)?.agrupacion_marca_id).toBe(AM_A);
    expect(o.tiendas.some((x) => x.id === CD1)).toBe(false);
    expect(o.tiendas.find((x) => x.id === T04)).toMatchObject({ codigo: "T04", fecha_cierre: "2027-06-30" });
    // No lee venta.
    expect(estadoDireccion.llamadas.tablero_venta).toHaveLength(0);
  });

  it("en enero, antes del primer cierre del año, es la cerrada del año anterior (la misma que lee el flujo)", async () => {
    sembrar("cargas_venta_stock", [
      { id: "f0000001-0000-4000-8000-000000000101", periodo: "2026-11-01", estado: "publicada" },
      { id: "f0000001-0000-4000-8000-000000000102", periodo: "2026-12-01", estado: "publicada" },
    ]);
    relojDePrueba.hoy = "2027-01-15";
    const o = await leerOpciones();
    expect(o.por_defecto).toEqual({ proyeccion_id: P_MOSTRADA, motivo: "usa_compras" });
    const t = await ver();
    expect(t.proyeccion.id).toBe(P_MOSTRADA);
    expect(t.datos.k_prima).toBe(12);
  });

  it("sin cerrada, la en trabajo más reciente; sin ninguna, nada (y el tablero responde `409 sin_proyeccion`)", async () => {
    for (const p of base.tablas.proyecciones ?? []) if (p.id === P_MOSTRADA) p.estado = "archivada";
    sembrarProyeccion({ id: P_EN_TRABAJO, nombre: "Proyección 2026–2027 seguimiento nov", estado: "en_trabajo", creada: "2026-11-08T15:00:00.000Z" });
    let o = await leerOpciones();
    expect(o.por_defecto).toEqual({ proyeccion_id: P_EN_TRABAJO, motivo: "en_trabajo_mas_reciente" });
    const t = await ver();
    expect(t.proyeccion).toMatchObject({ id: P_EN_TRABAJO, estado: "en_trabajo", usa_compras: false });

    base.tablas.proyecciones = [];
    o = await leerOpciones();
    expect(o.por_defecto).toBeNull();
    expect(o.proyecciones).toEqual([]);
    const r = await tablero(pedir("/tablero"));
    expect(r.status).toBe(409);
    expect((await leer(r)).codigo).toBe("sin_proyeccion");
  });
});

describe("errores de estado y caché", () => {
  it("`404` si la proyección no existe, `409 sin_calcular` y `409 calculo_en_curso`; una archivada se ve y no se aprueba", async () => {
    const noExiste = await tablero(pedir("/tablero", { proyeccion_id: "00000000-0000-4000-8000-999999999999" }));
    expect(noExiste.status).toBe(404);
    expect((await leer(noExiste)).codigo).toBe("proyeccion_no_encontrada");

    const archivada = await ver({ proyeccion_id: P_SEGUIMIENTO });
    expect(archivada.proyeccion.estado).toBe("archivada");
    expect(archivada.decidir.puede_aprobar).toBe(false);
    expect(archivada.decidir.estado).toBe("aprobada");
    expect(archivada.decidir.diferencia).toMatchObject({ misma_proyeccion: true, identica: true });

    const mostrada = (base.tablas.proyecciones ?? []).find((p) => p.id === P_MOSTRADA) as Fila;
    mostrada.calculando_desde = new Date().toISOString();
    const calculando = await tablero(pedir("/tablero"));
    expect(calculando.status).toBe(409);
    expect((await leer(calculando)).codigo).toBe("calculo_en_curso");
    mostrada.calculando_desde = null;
    mostrada.resumen = null;
    const sinCalcular = await tablero(pedir("/tablero"));
    expect(sinCalcular.status).toBe(409);
    const cuerpo = await leer(sinCalcular);
    expect(cuerpo.codigo).toBe("sin_calcular");
    expect(cuerpo.error).toBe("Calcula la proyección para verla en el tablero.");
  });

  it("`puede_aprobar` solo para el admin; el planner ve lo mismo", async () => {
    const admin = await ver();
    expect(admin.decidir.puede_aprobar).toBe(true);
    estadoRol.rol = "planner";
    const planner = await ver();
    expect(planner.decidir.puede_aprobar).toBe(false);
    expect({ ...planner, decidir: { ...planner.decidir, puede_aprobar: true } }).toEqual(admin);
  });

  it("la segunda lectura sale de la caché; si cambia una cifra (otra huella) se vuelve a leer la proyección y no la venta", async () => {
    await ver(HU);
    const antes = { p: estadoDireccion.llamadas.tablero_proyeccion.length, v: estadoDireccion.llamadas.tablero_venta.length };
    await ver(HU);
    expect(estadoDireccion.llamadas.tablero_proyeccion.length).toBe(antes.p);
    expect(estadoDireccion.llamadas.tablero_venta.length).toBe(antes.v);
    const r = registros(P_MOSTRADA, Y + 1).find((x) => x.decidido === 4300) as Fila;
    r.decidido = 4400;
    const t = await ver(HU);
    expect(t.kpis.siguiente).toBe(52808);
    expect(estadoDireccion.llamadas.tablero_proyeccion.length).toBeGreaterThan(antes.p);
    expect(estadoDireccion.llamadas.tablero_venta.length).toBe(antes.v);
  });

  it("R24 · abrir el tablero con todos los filtros no cambia ninguna tabla", async () => {
    const antes = fotoDeLaBase();
    const consultas: Record<string, string>[] = [
      {},
      HU,
      { ...HU, tiendas: T03 },
      { ...HU, bloque: "mismas" },
      { ...HU, am: AM_A, marca: MARCA_X },
      { generos: `${G_HOMBRE},${G_MUJER}`, temporadas: "invierno,todo_el_ano", desglose: "temporada" },
      { resto: "1", desglose: "marca" },
      { ...HU, linea_id: L1_HU, tiendas: `${T01},${T02}`, desglose: "tienda" },
      { proyeccion_id: P_SEGUIMIENTO, comparar_id: "ninguna" },
    ];
    for (const q of consultas) await ver(q);
    await opciones();
    expect(fotoDeLaBase()).toBe(antes);
  });

  it("el tablero entero del caso, con desglose por línea, pesa mucho menos que el tope de 250 KB", async () => {
    const t = await ver({ desglose: "linea" });
    expect(Buffer.byteLength(JSON.stringify(t), "utf8")).toBeLessThan(250 * 1024);
  });
});
