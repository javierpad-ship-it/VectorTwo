import { describe, expect, it } from "vitest";
import { difiereDeVigente, eatEntreCurvas, motivosObsoleta, type EstadoActual, type EstadoGuardado } from "@/lib/curvas/obsolescencia";
import { redComparable } from "@/lib/curvas/red";
import { ventaPorTienda } from "@/lib/curvas/entrada";
import { mesesAtipicos } from "@/lib/curvas/atipicos";
import type { TiendaMaestro } from "@/lib/curvas/tipos";
import { ABRIGO_ID, PERIODOS_NINO, PUBLICADOS, T3, T4, entradaFixture, filasFixture, parametros, tiendasFixture } from "./curvas.fixture";

const ANIOS = [2023, 2024, 2025, 2026];
const cargas = (meses: string[]) => Object.fromEntries(meses.map((m) => [m, `carga-${m}`]));
const nombres = new Map(tiendasFixture().map((t) => [t.id, { codigo: t.codigo, nombre: t.nombre }]));

function guardado(extra: Partial<EstadoGuardado> = {}, params = parametros()): EstadoGuardado {
  const entrada = entradaFixture("base", params);
  return {
    red_comparable: entrada.redes,
    cargas: cargas(PUBLICADOS),
    equivalencias: 10,
    huella_composicion: "huella-abrigo",
    atipicos: [...mesesAtipicos(PERIODOS_NINO, { temporada: "invierno" })].filter((m) => m <= "2026-09"),
    temporada: "invierno",
    ...extra,
  };
}

function actual(cambio: Partial<Omit<EstadoActual, "tiendas">> & { tiendas?: TiendaMaestro[]; publicados?: string[] } = {}, params = parametros()): EstadoActual {
  const { tiendas: tiendasNuevas, publicados: publicadosNuevos, ...resto } = cambio;
  const tiendas = tiendasNuevas ?? tiendasFixture();
  const publicados = publicadosNuevos ?? PUBLICADOS;
  return {
    red_comparable: redComparable(tiendas, ventaPorTienda(filasFixture("base")), ANIOS, "2026-09", params, { mesesPublicados: PUBLICADOS }),
    cargas: cargas(publicados),
    equivalencias: 10,
    huella_composicion: "huella-abrigo",
    atipicos: [...mesesAtipicos(PERIODOS_NINO, { temporada: "invierno" })].filter((m) => m <= "2026-09"),
    temporada: "invierno",
    tiendas: nombres,
    ...resto,
  };
}

describe("regla 24 · motivosObsoleta (caso 9)", () => {
  it("(f) nada cambió → []", () => {
    expect(motivosObsoleta(guardado(), actual())).toEqual([]);
  });
  it("(a) publicar octubre a diciembre → carga_nueva con los meses", () => {
    const nuevos = [...PUBLICADOS, "2026-10", "2026-11", "2026-12"];
    const m = motivosObsoleta(guardado(), actual({ publicados: nuevos }));
    expect(m.map((x) => x.codigo)).toEqual(["carga_nueva"]);
    expect(m[0].detalle).toContain("2026-10");
    expect(m[0].detalle).toContain("2026-12");
  });
  it("un mes republicado con otro carga_id también es carga_nueva", () => {
    const c = cargas(PUBLICADOS);
    c["2025-05"] = "otra-carga";
    const m = motivosObsoleta(guardado(), actual({ cargas: c }));
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ codigo: "carga_nueva" });
    expect(m[0].detalle).toContain("2025-05");
  });
  it("(b) corregir T4 a apertura 2024-03-01 → tienda_sale_red (2024), nombrando tienda y año", () => {
    const tiendas = tiendasFixture().map((t) => (t.id === T4 ? { ...t, fecha_apertura: "2024-03-01" } : t));
    const m = motivosObsoleta(guardado(), actual({ tiendas }));
    expect(m.map((x) => x.codigo)).toEqual(["tienda_sale_red"]);
    expect(m[0].detalle).toContain("T4");
    expect(m[0].detalle).toContain("2024");
  });
  it("una tienda desactivada → tienda_sale_red con «desactivada»", () => {
    const tiendas = tiendasFixture().map((t) => (t.id === T4 ? { ...t, activo: false } : t));
    const m = motivosObsoleta(guardado(), actual({ tiendas }));
    expect(m[0]).toMatchObject({ codigo: "tienda_sale_red" });
    expect(m[0].detalle).toMatch(/desactiv/);
  });
  it("(c) una tienda que cumple su primer año completo entra → tienda_entra_red con tienda y año", () => {
    // La corrida se calculó con 12 meses de tienda nueva (T3 fuera de 2026); hoy T3 cumple (apertura corregida a 2024-12-01).
    const con12 = parametros({ meses_tienda_nueva: 12 });
    const tiendas = tiendasFixture().map((t) => (t.id === T3 ? { ...t, fecha_apertura: "2024-12-01" } : t));
    const m = motivosObsoleta(guardado({}, con12), actual({ tiendas }, con12));
    const entra = m.find((x) => x.codigo === "tienda_entra_red");
    expect(entra?.detalle).toContain("T3");
    expect(entra?.detalle).toContain("2026");
  });
  it("(d) añadir una equivalencia → composicion_cambiada con el conteo (+1)", () => {
    const m = motivosObsoleta(guardado(), actual({ equivalencias: 11, huella_composicion: "otra" }));
    expect(m).toHaveLength(1);
    expect(m[0].codigo).toBe("composicion_cambiada");
    expect(m[0].detalle).toContain("+1");
  });
  it("misma cantidad de equivalencias pero otra huella también cambia la composición", () => {
    const m = motivosObsoleta(guardado(), actual({ huella_composicion: "otra" }));
    expect(m[0].detalle).toMatch(/mismo número/);
  });
  it("periodo_cambiado: los meses atípicos de hoy difieren de los de la corrida", () => {
    const sin = [...mesesAtipicos(PERIODOS_NINO, { temporada: "invierno" })].filter((m) => m <= "2026-09" && m !== "2023-03");
    const m = motivosObsoleta(guardado(), actual({ atipicos: sin }));
    expect(m.map((x) => x.codigo)).toEqual(["periodo_cambiado"]);
    expect(m[0].detalle).toContain("2023-03");
    const mas = [...mesesAtipicos(PERIODOS_NINO, { temporada: "invierno" }), "2024-02"].filter((x) => x <= "2026-09");
    expect(motivosObsoleta(guardado(), actual({ atipicos: mas }))[0].detalle).toContain("2024-02");
  });
  it("(e) cambiar la temporada → temporada_cambiada", () => {
    const m = motivosObsoleta(guardado(), actual({ temporada: "todo_el_ano" }));
    expect(m.map((x) => x.codigo)).toEqual(["temporada_cambiada"]);
    expect(m[0].detalle).toContain("invierno");
  });
  it("combinados: cada motivo aparece una vez y por separado", () => {
    const tiendas = tiendasFixture().map((t) => (t.id === T4 ? { ...t, fecha_apertura: "2024-03-01" } : t));
    const m = motivosObsoleta(
      guardado(),
      actual({ tiendas, equivalencias: 9, huella_composicion: "x", publicados: [...PUBLICADOS, "2026-10"], temporada: "verano" })
    );
    expect(m.map((x) => x.codigo).sort()).toEqual(["carga_nueva", "composicion_cambiada", "temporada_cambiada", "tienda_sale_red"]);
    expect(ABRIGO_ID).toBe("abrigo");
  });
});

describe("regla 25 · difiereDeVigente y eatEntreCurvas", () => {
  const curva = Array(12).fill(1 / 12);
  const mover = (c: number[], m: number, d: number) => c.map((v, i) => (i === m ? v + d : i === (m + 1) % 12 ? v - d : v));
  it("eatEntreCurvas de dos curvas iguales es 0", () => {
    expect(eatEntreCurvas(curva, curva)).toBe(0);
    expect(eatEntreCurvas(mover(curva, 0, 0.01), curva)).toBeCloseTo(2, 9);
  });
  it("modelo distinto, o algún mes que cambia más de 0,005, o EAT que cambia más de 0,5 → verdadero", () => {
    const v = { modelo: "A", curva, eat: 10 };
    expect(difiereDeVigente({ modelo: "B", curva, eat: 10 }, v)).toBe(true);
    expect(difiereDeVigente({ modelo: "A", curva: mover(curva, 2, 0.006), eat: 10 }, v)).toBe(true);
    expect(difiereDeVigente({ modelo: "A", curva, eat: 10.6 }, v)).toBe(true);
    expect(difiereDeVigente({ modelo: "A", curva: mover(curva, 2, 0.004), eat: 10.2 }, v)).toBe(false);
    expect(difiereDeVigente({ modelo: "A", curva, eat: null }, v)).toBe(false);
  });
});
