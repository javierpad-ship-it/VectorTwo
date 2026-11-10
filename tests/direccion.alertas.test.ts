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

import { GET as tablero } from "@/app/api/direccion/tablero/route";
import {
  ORDEN_ALERTAS,
  alertaComparadaDistintaK,
  alertaConcentracion,
  alertaDatosMasNuevos,
  alertaDistintaDeAprobada,
  alertaFactorProvisional,
  alertaMarcaEstimada,
  alertaMesesFaltantes,
  alertaMetodoAnterior,
  alertaOrigenDecisiones,
  alertaSinCurva,
  alertasAnomalias,
  alertasAtribucion,
  alertasBaseCorregida,
  alertasCambios,
  alertasContraTendencia,
  alertasDesvio,
  alertasTiendaNueva,
  ordenarAlertas,
} from "@/lib/direccion/alertas";
import { armarCrecimientos, type EntradaCrecimientos } from "@/lib/direccion/crecimientos";
import { vaciarCachesDireccion } from "@/lib/direccion/servicio";
import type { AlertaApi, CodigoAlerta, CrecimientoGMApi, DecisionesSql, PorGmSql, TableroProyeccionSql } from "@/lib/direccion/tipos-api";
import { base, estadoDireccion } from "./direccion.fake-db";
import { G_HOMBRE, G_MUJER, G_NINO, L1_HU, MARCA_X, M_URBANO, P_MOSTRADA, T01, T03, T10, T12, V_HU, Y, ninoCaso } from "./direccion.fixture";
import { lectorDeTablero, montarCaso } from "./direccion.montaje";

/** Ficha 14 · §4.5: cada código de alerta, su nivel y su alcance; crecimiento declarado, implícito y tendencia corregida del Niño (I-E). Sintético. */

const ver = lectorDeTablero(tablero);
beforeEach(() => montarCaso(vaciarCachesDireccion));
const codigos = (as: readonly AlertaApi[], nivel?: string, alcance?: string) => as.filter((a) => (nivel === undefined || a.nivel === nivel) && (alcance === undefined || a.alcance === alcance)).map((a) => a.codigo);
const una = (as: readonly AlertaApi[], codigo: CodigoAlerta) => as.find((a) => a.codigo === codigo);

const crecimiento = (extra: Partial<CrecimientoGMApi>): CrecimientoGMApi => ({
  gm_clave: "g|m",
  nombre: "HOMBRE · URBANO",
  declarado_pct: 5,
  sobre_base: "corregida",
  version: 2,
  autor: "Planner P.",
  aprobada_at: "2026-11-04T15:00:00.000Z",
  nota: "nota",
  base_real: 1000,
  base_corregida: 1000,
  con_nino: false,
  siguiente_mismas: 1050,
  implicito_sobre_real_pct: 5,
  implicito_sobre_corregida_pct: 5,
  desvio_pp: 0,
  tendencia_mismas_pct: 3,
  tendencia_mismas_corregida_pct: 3,
  tendencia_afectada_nino: false,
  semaforo: "coincide",
  anomalias: [],
  ...extra,
});

describe("alertas del caso de §6.1 (proyección entera)", () => {
  it("5 importantes, en el orden de la tabla, y las informativas detrás", async () => {
    const t = await ver();
    expect(codigos(t.alertas, "importante", "proyeccion")).toEqual(["contra_tendencia", "desvio_crecimiento", "factor_provisional", "tienda_nueva_relevante", "apertura_sin_historia"]);
    expect(t.decidir.alertas_importantes).toBe(5);
    expect(codigos(t.alertas, "info", "proyeccion")).toEqual(["anomalia_crecimiento", "anomalia_crecimiento", "origen_decisiones", "base_corregida_nino", "datos_mas_nuevos", "comparada_distinta_k", "distinta_de_aprobada"]);
    // Menos de 50 filas: no se evalúa la concentración.
    expect(una(t.alertas, "concentracion")).toBeUndefined();
    // Importantes primero.
    const niveles = t.alertas.map((a) => a.nivel);
    expect(niveles.lastIndexOf("importante")).toBeLessThan(niveles.indexOf("info"));
    expect(t.decidir.lineas[2]).toBe("5 alertas importantes; la primera: HOMBRE · URBANO declara +5.0 % y sus mismas tiendas van −3.9 % en ene–oct de 2026, corregido del Niño (−5.9 % en bruto).");
  });

  it("los textos y las cifras de cada una", async () => {
    const t = await ver();
    expect(una(t.alertas, "contra_tendencia")?.detalle).toBe("HOMBRE · URBANO declara +5.0 % y sus mismas tiendas van −3.9 % en ene–oct de 2026, corregido del Niño (−5.9 % en bruto).");
    expect(una(t.alertas, "desvio_crecimiento")?.detalle).toBe("MUJER · URBANO: declarado +8.0 %, implícito +12.3 % (+4.3 pp: fijado a mano +1,226 u).");
    const factor = una(t.alertas, "factor_provisional");
    expect(factor?.detalle).toContain("invierno 2026 (parcial y sin confirmar, 0.70)");
    expect(factor?.detalle).toContain("13,300 u de 2027 (15.7 %)");
    expect(factor?.cifras.expuesto).toBe(13300);
    expect(una(t.alertas, "tienda_nueva_relevante")?.detalle).toBe("T10 entra a mismas tiendas en 2027 y es el 5.4 % de la base: abrió en nov 2025 y su 2026 es real ene–set más proyectado oct–dic.");
    expect(una(t.alertas, "apertura_sin_historia")?.detalle).toBe("T12 (abr 2027) se proyecta por venta esperada y su referente: no tiene venta propia.");
    const anomalias = t.alertas.filter((a) => a.codigo === "anomalia_crecimiento").map((a) => a.detalle);
    expect(anomalias).toEqual(["HOMBRE · URBANO v2 (04 nov, Planner P.): sin nota.", "MUJER · URBANO v4 (06 nov, Planner P.): reemplazó a otra versión el mismo día."]);
    // 49 % en bloque (41 300 u), 15 % tal cual (13 000) y 36 % a mano (30 414) sobre 84 714; 6 de 8 el 07 nov.
    const origen = una(t.alertas, "origen_decisiones");
    expect(origen?.detalle).toBe("2027: 49 % aceptado en bloque, 15 % tal cual la propuesta, 36 % a mano; 6 de los 8 registros de 2027 decididos el 07 nov.");
    expect(origen?.nivel).toBe("info");
    expect(origen?.cifras.aceptado_sin_cambiar).toBeCloseTo((41300 + 13000) / 84714, 9);
    expect(una(t.alertas, "base_corregida_nino")?.detalle).toBe("HOMBRE · URBANO: base 2027 corregida del Niño +1.6 % (47,040 → 47,793).");
    expect(una(t.alertas, "datos_mas_nuevos")?.detalle).toContain("Hay oct 2026 publicado");
    expect(una(t.alertas, "distinta_de_aprobada")?.detalle).toBe("Frente a lo aprobado el 03 nov (Proyección 2026–2027 seguimiento set): 2027 +1,214 u (+1.5 %).");
    for (const a of t.alertas) {
      expect(a.titulo.length).toBeGreaterThan(0);
      expect(a.detalle.endsWith(".")).toBe(true);
    }
  });

  it("variante: con 2025 ene–oct en 35 000 la tendencia bruta es −2,0 % y la corregida +0,1 %: la alerta baja a informativa y quedan 4 importantes", async () => {
    // Se le restan 1 455 u a la venta de octubre de 2025 de las mismas tiendas de 2026 (36 455 → 35 000).
    estadoDireccion.hechos.push({ tienda_id: T01, periodo: "2025-10", gml_id: L1_HU, equivalencia_id: null, marca_id: MARCA_X, u: -1455, s: 0 });
    const t = await ver();
    const hu = t.crecimientos.find((c) => c.nombre === "HOMBRE · URBANO");
    expect(hu?.tendencia_mismas_pct).toBeCloseTo((34290 / 35000 - 1) * 100, 9);
    expect(hu?.tendencia_mismas_pct).toBeCloseTo(-2.0, 1);
    expect(hu?.tendencia_mismas_corregida_pct).toBeCloseTo(0.1, 1);
    expect(hu?.tendencia_afectada_nino).toBe(true);
    expect(hu?.semaforo).toBe("coincide");
    const alerta = una(t.alertas, "contra_tendencia");
    expect(alerta?.nivel).toBe("info");
    expect(alerta?.detalle).toBe("HOMBRE · URBANO declara +5.0 % y sus mismas tiendas van −2.0 % en bruto y +0.1 % corregido del Niño en ene–oct de 2026: tendencia afectada por el Niño.");
    expect(t.decidir.alertas_importantes).toBe(4);
    expect(codigos(t.alertas, "importante", "proyeccion")).toEqual(["desvio_crecimiento", "factor_provisional", "tienda_nueva_relevante", "apertura_sin_historia"]);
  });

  it("sin factores provisionales no hay alerta de factor; con una proyección de método anterior, `metodo_anterior`", async () => {
    ninoCaso.valor = { factoresProvisionales: [], aniosNino: [2023, 2026] };
    const p = (base.tablas.proyecciones ?? []).find((x) => x.id === P_MOSTRADA);
    if (!p) throw new Error("falta la proyección");
    p.resumen = { version_metodo: 4, desvio_prueba_anterior_pct: null };
    const t = await ver();
    expect(una(t.alertas, "factor_provisional")).toBeUndefined();
    expect(una(t.alertas, "metodo_anterior")?.detalle).toBe("Calculada con el método 4: sin base corregida del Niño.");
    expect(una(t.alertas, "metodo_anterior")?.nivel).toBe("importante");
    expect(t.decidir.precision.desvio_prueba_anterior_pct).toBeNull();
  });

  it("alertas del recorte: van aparte y no cuentan en `alertas_importantes`", async () => {
    const t = await ver({ generos: G_HOMBRE, mundo_id: M_URBANO, tiendas: T03 });
    expect(codigos(t.alertas, undefined, "recorte")).toEqual(["atribucion_estimada"]);
    expect(t.decidir.alertas_importantes).toBe(5);
    const hu = await ver({ generos: G_HOMBRE, mundo_id: M_URBANO });
    expect(codigos(hu.alertas, "importante", "recorte")).toEqual(["tienda_nueva_relevante", "apertura_sin_historia"]);
    // En el recorte de HOMBRE · URBANO, T10 es el 8,7 % de su base.
    expect(hu.alertas.find((a) => a.alcance === "recorte" && a.codigo === "tienda_nueva_relevante")?.cifras.participacion).toBeCloseTo(4100 / 47040, 9);
  });
});

describe("crecimiento declarado, implícito y tendencia (§4.8, I-E)", () => {
  it("HOMBRE · URBANO «contra la tendencia» con la corregida; MUJER · URBANO «revisar»; el Total sin declarado", async () => {
    const t = await ver();
    const [hu, mu, total] = t.crecimientos;
    expect(t.crecimientos.map((c) => c.nombre)).toEqual(["HOMBRE · URBANO", "MUJER · URBANO", "Total"]);
    expect(hu).toMatchObject({ declarado_pct: 5, sobre_base: "corregida", version: 2, autor: "Planner P.", nota: null, base_real: 47040, base_corregida: 47793, con_nino: true, siguiente_mismas: 50300, semaforo: "contra_tendencia", anomalias: ["sin_nota"] });
    expect(hu.implicito_sobre_real_pct).toBeCloseTo((50300 / 47040 - 1) * 100, 9);
    expect(hu.implicito_sobre_corregida_pct).toBeCloseTo((50300 / 47793 - 1) * 100, 9);
    expect(hu.desvio_pp).toBeCloseTo(0.25, 2);
    // Bruta: 34 290 frente a 36 455. Corregida: φ̄ = 34 600 ÷ 35 337,14; 34 290 ÷ φ̄ = 35 020,5.
    expect(hu.tendencia_mismas_pct).toBeCloseTo((34290 / 36455 - 1) * 100, 9);
    const phi = 34600 / (34600 + 1720 * (1 / 0.7 - 1));
    expect(hu.tendencia_mismas_corregida_pct).toBeCloseTo((34290 / phi / 36455 - 1) * 100, 2);
    expect(hu.tendencia_mismas_corregida_pct).toBeCloseTo(-3.9, 1);
    expect(hu.tendencia_afectada_nino).toBe(false);

    expect(mu).toMatchObject({ declarado_pct: 8, version: 4, nota: "revisada con comercial", con_nino: false, semaforo: "revisar", anomalias: ["reemplazada_mismo_dia"] });
    expect(mu.desvio_pp).toBeCloseTo(4.3, 1);
    // Sin Niño: una sola cifra de tendencia.
    expect(mu.tendencia_mismas_pct).toBeCloseTo((22300 / 21000 - 1) * 100, 9);
    expect(mu.tendencia_mismas_corregida_pct).toBe(mu.tendencia_mismas_pct);

    expect(total).toMatchObject({ gm_clave: "total", declarado_pct: null, sobre_base: null, semaforo: "sin_dato", base_real: 75540, siguiente_mismas: 82306, anomalias: [] });
    expect(total.implicito_sobre_real_pct).toBeCloseTo((82306 / 75540 - 1) * 100, 9);
    // Lo declarado y lo implícito del resumen: objetivo global +6,0 %.
    expect(t.decidir.objetivo_pct).toBe(6);
    expect(t.decidir.precision).toEqual({ desvio_prueba_anterior_pct: -3.2, rotulo: "dentro de muestra" });
  });

  const gm = (g: string, extra: Partial<PorGmSql["Y1"]> = {}): PorGmSql => ({
    g,
    m: M_URBANO,
    Y: { cierre: 1000, base: 1000, fuera_base_exacto: 0, base_meses: [100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 0, 0], base_meses_sin_nino: [100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 0, 0] },
    Y1: { B: 1000, B_corr: 1000, propuesto_con_B: 1040, vigente_con_B: 1040, vigente_sin_B: 0, delta_manual: 0, delta_otras: 0, nuevas_anterior: 0, aperturas: 0, cierres: 0, total: 1040, ...extra },
  });
  const entrada = (extra: Partial<EntradaCrecimientos>): EntradaCrecimientos => ({
    porGm: [gm(G_HOMBRE), gm(G_NINO)],
    generosMatriz: new Set([G_HOMBRE, G_MUJER]),
    nombreDe: (g) => (g === G_HOMBRE ? "HOMBRE · URBANO" : "NIÑO · URBANO"),
    declarados: [{ genero_id: G_HOMBRE, mundo_id: M_URBANO, pct: 4, sobre_base: "corregida", version: 2, crecimiento_id: V_HU }],
    versiones: [{ id: V_HU, alcance: "gm", genero_id: G_HOMBRE, mundo_id: M_URBANO, version: 2, estado: "vigente", aprobada_at: "2026-11-04T15:00:00.000Z", usuario_nombre: "Planner P.", nota: "ok", base_valor: 1000 }],
    resto: { pct: -3, sobre_base: "corregida", version: 7, crecimiento_id: "v-resto", por_nombre: "Admin A.", at: "2026-11-02T15:00:00.000Z" },
    tendencia: { tiendas: [T01], filas: [[G_HOMBRE, M_URBANO, 0, 1050, 1000], [G_NINO, M_URBANO, 0, 99, 100]] },
    mismasEnCurso: new Set([T01]),
    kPrima: 10,
    ...extra,
  });

  it("el Resto declara lo de `crecimiento_resto_usado` (no el provisional); sin esa clave dice «sin dato»", () => {
    const [hu, resto, total] = armarCrecimientos(entrada({}));
    expect(hu).toMatchObject({ declarado_pct: 4, semaforo: "coincide", anomalias: [] });
    expect(resto).toMatchObject({ gm_clave: "resto", nombre: "Resto", declarado_pct: -3, sobre_base: "corregida", version: 7, autor: "Admin A.", aprobada_at: "2026-11-02T15:00:00.000Z" });
    expect(resto.desvio_pp).toBeCloseTo(7, 9);
    expect(resto.semaforo).toBe("revisar");
    expect(resto.tendencia_mismas_pct).toBeCloseTo(-1, 9);
    expect(total.gm_clave).toBe("total");

    const [, sinDato] = armarCrecimientos(entrada({ resto: { pct: null, sobre_base: null, version: null, crecimiento_id: null, por_nombre: null, at: null } }));
    expect(sinDato).toMatchObject({ declarado_pct: null, sobre_base: null, desvio_pp: null, semaforo: "sin_dato", anomalias: [] });
  });

  it("anomalías: sin base (importante), reemplazada el mismo día y sin nota; el Resto provisional no tiene anomalías de versión", () => {
    const versiones = [
      { id: V_HU, alcance: "gm", genero_id: G_HOMBRE, mundo_id: M_URBANO, version: 3, estado: "vigente", aprobada_at: "2026-11-06T23:30:00.000Z", usuario_nombre: "Planner P.", nota: " ", base_valor: null },
      // Reemplazada el mismo día EN LIMA (06 nov 09:00 de Lima) aunque en UTC sea otro día que la vigente.
      { id: "v-2", alcance: "gm", genero_id: G_HOMBRE, mundo_id: M_URBANO, version: 2, estado: "reemplazada", aprobada_at: "2026-11-06T14:00:00.000Z", usuario_nombre: "Planner P.", nota: "x", base_valor: 1000 },
      { id: "v-1", alcance: "gm", genero_id: G_MUJER, mundo_id: M_URBANO, version: 1, estado: "reemplazada", aprobada_at: "2026-11-06T14:00:00.000Z", usuario_nombre: "Planner P.", nota: "x", base_valor: 1000 },
    ];
    const [hu, resto] = armarCrecimientos(entrada({ versiones, resto: { pct: 2, sobre_base: "bruta", version: null, crecimiento_id: null, por_nombre: null, at: null } }));
    expect(hu.anomalias).toEqual(["sin_base", "reemplazada_mismo_dia", "sin_nota"]);
    expect(resto.anomalias).toEqual([]);
    const alertas = alertasAnomalias([hu, resto]);
    expect(alertas).toHaveLength(1);
    expect(alertas[0].nivel).toBe("importante");
    expect(alertas[0].detalle).toContain("se aprobó sin base de venta");
    // Otro día en Lima (05 nov 20:00 de Lima = 06 nov 01:00 UTC): no es «el mismo día».
    const otroDia = versiones.map((v) => (v.id === "v-2" ? { ...v, aprobada_at: "2026-11-06T01:00:00.000Z" } : v));
    expect(armarCrecimientos(entrada({ versiones: otroDia }))[0].anomalias).toEqual(["sin_base", "sin_nota"]);
  });

  it("la tendencia solo cuenta las tiendas de `M(Y)`; sin lectura de tendencia no hay semáforo de tendencia", () => {
    const [hu] = armarCrecimientos(entrada({ tendencia: { tiendas: [T01, T10], filas: [[G_HOMBRE, M_URBANO, 0, 900, 1000], [G_HOMBRE, M_URBANO, 1, 5000, 0]] } }));
    expect(hu.tendencia_mismas_pct).toBeCloseTo(-10, 9);
    expect(hu.semaforo).toBe("contra_tendencia");
    const [sin] = armarCrecimientos(entrada({ tendencia: null }));
    expect(sin.tendencia_mismas_pct).toBeNull();
    expect(sin.semaforo).toBe("coincide");
  });
});

describe("cada alerta (puro)", () => {
  it("`contra_tendencia`: importante con la corregida negativa y 5 pp o más; nada si la tendencia no es negativa o faltan puntos", () => {
    expect(alertasContraTendencia([crecimiento({ declarado_pct: 5, tendencia_mismas_pct: -1, tendencia_mismas_corregida_pct: -1 })], Y, 10).map((a) => a.nivel)).toEqual(["importante"]);
    expect(alertasContraTendencia([crecimiento({ declarado_pct: 3.9, tendencia_mismas_pct: -1, tendencia_mismas_corregida_pct: -1 })], Y, 10)).toEqual([]);
    expect(alertasContraTendencia([crecimiento({ declarado_pct: 20, tendencia_mismas_pct: 2, tendencia_mismas_corregida_pct: 2 })], Y, 10)).toEqual([]);
    expect(alertasContraTendencia([crecimiento({ declarado_pct: null })], Y, 10)).toEqual([]);
    expect(alertasContraTendencia([crecimiento({ gm_clave: "total", declarado_pct: 9, tendencia_mismas_pct: -9, tendencia_mismas_corregida_pct: -9 })], Y, 10)).toEqual([]);
    // Sin Niño se dice una sola cifra.
    expect(alertasContraTendencia([crecimiento({ declarado_pct: 5, tendencia_mismas_pct: -1, tendencia_mismas_corregida_pct: -1 })], Y, 10)[0].detalle).toBe("HOMBRE · URBANO declara +5.0 % y sus mismas tiendas van −1.0 % en ene–oct de 2026.");
  });

  it("`desvio_crecimiento`: desde 2 pp, hacia arriba o hacia abajo, con lo fijado y las otras diferencias del GM", () => {
    const puente = { gm_clave: "g|m", lineas: [{ clave: "manual" as const, etiqueta: "", u: -40, acumulado: 0, subtotal: false }, { clave: "otras" as const, etiqueta: "", u: 15, acumulado: 0, subtotal: false }], pct: { base_sobre_real: null, nino: null, crecimiento: null, manual: null, otras: null, total_vs_cierre: null } };
    expect(alertasDesvio([crecimiento({ desvio_pp: 1.99 })], [puente])).toEqual([]);
    const a = alertasDesvio([crecimiento({ declarado_pct: 5, desvio_pp: -2.5 })], [puente]);
    expect(a[0].nivel).toBe("importante");
    expect(a[0].detalle).toBe("HOMBRE · URBANO: declarado +5.0 %, implícito +2.5 % (−2.5 pp: fijado a mano −40 u y otras diferencias con la propuesta +15 u).");
  });

  it("`factor_provisional`: UNA alerta con todos los factores y UNA cifra, sobre la unión de temporadas (cada una una vez)", () => {
    const porTemporada: TableroProyeccionSql["por_temporada"] = [
      { temporada: "invierno", Y1: 1000, Y1_con_factor_Y: 900 },
      { temporada: "todo_el_ano", Y1: 3000, Y1_con_factor_Y: 400 },
      { temporada: "verano", Y1: 2000, Y1_con_factor_Y: 700 },
      { temporada: null, Y1: 100, Y1_con_factor_Y: 0 },
    ];
    expect(alertaFactorProvisional([], porTemporada, 6100, Y)).toEqual([]);
    const uno = alertaFactorProvisional([{ anio: Y, temporada: "invierno", estado: "sin_confirmar", efectivo: 0.7, parcial: true }], porTemporada, 6100, Y);
    expect(uno).toHaveLength(1);
    expect(uno[0].cifras.expuesto).toBe(900 + 400);
    const dos = alertaFactorProvisional(
      [
        { anio: Y, temporada: "invierno", estado: "sin_confirmar", efectivo: 0.7, parcial: true },
        { anio: Y, temporada: "verano", estado: "desfasado", efectivo: 1.2, parcial: false },
      ],
      porTemporada,
      6100,
      Y
    );
    expect(dos).toHaveLength(1);
    // `todo_el_ano` cuenta una sola vez aunque lo afecten los dos factores.
    expect(dos[0].cifras.expuesto).toBe(900 + 400 + 700);
    expect(dos[0].titulo).toBe("2 factores del Niño son provisionales");
    expect(dos[0].detalle).toContain("cota superior");
    expect(alertaFactorProvisional([{ anio: Y, temporada: "verano", estado: "faltante", efectivo: null, parcial: false }], porTemporada, 6100, Y)[0].detalle).toContain("verano 2026 (sin valor)");
  });

  it("`tienda_nueva_relevante`: la que entra pesa 5 % o más de B, o una nueva o apertura pesa 5 % o más del año siguiente", () => {
    const doc = (paraBase: number, apertura: number): Pick<TableroProyeccionSql, "anios"> =>
      ({
        anios: [
          { anio: Y, base: { vigente: 900 }, tiendas: [{ t: T10, bloque: "nuevas", subbloque: "nuevas_anterior", meses: [], vigente: paraBase, sin_meses: 0, para_base: paraBase }] },
          { anio: Y + 1, base: { vigente: 1000, B: 1000 }, tiendas: [{ t: T12, bloque: "nuevas", subbloque: "aperturas", meses: [], vigente: apertura, sin_meses: 0, para_base: null }] },
        ],
      }) as unknown as Pick<TableroProyeccionSql, "anios">;
    const tiendas = new Map([
      [T10, { id: T10, codigo: "T10", fecha_apertura: "2025-11-15" }],
      [T12, { id: T12, codigo: "T12", fecha_apertura: "2027-04-01" }],
    ]);
    expect(alertasTiendaNueva(doc(49, 10), tiendas, "proyeccion", 9)).toEqual([]);
    const entra = alertasTiendaNueva(doc(50, 10), tiendas, "proyeccion", 9);
    expect(entra.map((a) => a.cifras.tipo)).toEqual(["entra"]);
    const apertura = alertasTiendaNueva(doc(10, 60), tiendas, "recorte", 12);
    expect(apertura.map((a) => [a.cifras.tipo, a.alcance])).toEqual([["aperturas", "recorte"]]);
    expect(apertura[0].detalle).toBe("T12 abre en 2027 y es el 5.7 % de 2027 (60 u).");
    // Con tiendas elegidas, solo las del conjunto.
    expect(alertasTiendaNueva(doc(50, 60), tiendas, "recorte", 9, new Set([T12])).map((a) => a.cifras.codigo)).toEqual(["T12"]);
  });

  it("`origen_decisiones`: importante si lo aceptado sin cambiar es 80 % o más y el día pico concentra la mitad o más; sin decisiones, nada", () => {
    const d = (extra: Partial<DecisionesSql>): DecisionesSql => ({
      lote: { n: 0, u: 0 },
      ia: { n: 0, u: 0 },
      propuesta: { n: 0, u: 0 },
      manual: { n: 0, u: 0 },
      escalada: { n: 0, u: 0 },
      sin_decidir: { n: 0, u: 0 },
      autores: [{ nombre: "Planner P.", n: 10, u: 1000, desde: "2026-11-07", hasta: "2026-11-07" }],
      dia_pico: { fecha: "2026-11-07", n: 6 },
      ...extra,
    });
    expect(alertaOrigenDecisiones(d({ sin_decidir: { n: 4, u: 500 }, dia_pico: null, autores: [] }), 2027)).toEqual([]);
    // 80 % exacto entre lote, IA y propuesta, y 6 de 10 en un día.
    const masiva = alertaOrigenDecisiones(d({ lote: { n: 5, u: 500 }, ia: { n: 2, u: 200 }, propuesta: { n: 1, u: 100 }, manual: { n: 2, u: 200 } }), 2027);
    expect(masiva[0].nivel).toBe("importante");
    expect(masiva[0].detalle).toBe("2027: 50 % aceptado en bloque, 20 % aceptado de la IA, 10 % tal cual la propuesta, 20 % a mano; 6 de los 10 registros de 2027 decididos el 07 nov por Planner P.");
    // «Escalada» y «sin decidir» no cuentan como aceptado sin cambiar; el denominador son TODOS los registros.
    expect(alertaOrigenDecisiones(d({ lote: { n: 7, u: 790 }, escalada: { n: 1, u: 110 }, sin_decidir: { n: 2, u: 100 }, dia_pico: { fecha: "2026-11-07", n: 8 } }), 2027)[0].nivel).toBe("info");
    // 80 % pero repartido en muchos días.
    expect(alertaOrigenDecisiones(d({ lote: { n: 10, u: 900 }, manual: { n: 2, u: 100 }, dia_pico: { fecha: "2026-11-07", n: 5 } }), 2027)[0].nivel).toBe("info");
  });

  it("`concentracion`: solo con 50 filas o más; las 10 mayores 40 % o más, o una sola 5 % o más", () => {
    const mayores = (us: number[]) => us.map((u, i) => ({ clave: `c${i}`, gml_id: "g", am_id: "a", Y1: u, B: null }));
    const parejas = mayores(new Array(20).fill(30));
    expect(alertaConcentracion(mayores([700, 100]), 49, 1000, 2027)).toEqual([]);
    expect(alertaConcentracion(parejas, 50, 1000, 2027)).toEqual([]);
    const top = alertaConcentracion(mayores(new Array(20).fill(41)), 60, 1000, 2027);
    expect(top[0].detalle).toBe("Las 10 filas mayores son el 41 % de 2027; una sola, el 4 %.");
    expect(top[0]).toMatchObject({ nivel: "importante", alcance: "recorte" });
    expect(alertaConcentracion(mayores([50, 10, 10]), 60, 1000, 2027)).toHaveLength(1);
    expect(alertaConcentracion(mayores([49, 10, 10]), 60, 1000, 2027)).toEqual([]);
  });

  it("`base_corregida_nino`, `metodo_anterior`, `sin_curva`, `propuesta_cambio`, `curva_cambio`, `datos_mas_nuevos` y `meses_faltantes`", () => {
    expect(alertasBaseCorregida([crecimiento({ con_nino: false })], Y)).toEqual([]);
    expect(alertasBaseCorregida([crecimiento({ con_nino: true, base_real: 1000, base_corregida: 1016.4 })], Y)[0].detalle).toBe("HOMBRE · URBANO: base 2027 corregida del Niño +1.6 % (1,000 → 1,016).");
    expect(alertaMetodoAnterior(5)).toEqual([]);
    expect(alertaMetodoAnterior(null)[0].detalle).toContain("método anterior");
    expect(alertaSinCurva(0, 2027)).toEqual([]);
    expect(alertaSinCurva(1240, 2027)[0].detalle).toBe("1,240 u de 2027 sin reparto mensual: suman al total, no al gráfico.");
    expect(alertasCambios({ propuesta_cambio: 0, curva_cambio: 0 })).toEqual([]);
    expect(alertasCambios({ propuesta_cambio: 112, curva_cambio: 1 }).map((a) => [a.codigo, a.nivel, a.detalle])).toEqual([
      ["propuesta_cambio", "info", "112 filas decididas cuya propuesta cambió al recalcular."],
      ["curva_cambio", "info", "1 fila tiene una curva nueva propuesta que todavía no se aplicó a su reparto mensual."],
    ]);
    expect(alertaDatosMasNuevos("2026-09", "2026-09")).toEqual([]);
    expect(alertaDatosMasNuevos("2026-09", null)).toEqual([]);
    expect(alertaDatosMasNuevos("2026-09", "2026-10")).toHaveLength(1);
    expect(alertaMesesFaltantes([])).toEqual([]);
    expect(alertaMesesFaltantes(["2024-03", "2025-01"])[0].detalle).toBe("Faltan mar 2024 y ene 2025: 2024 y 2025 están incompletos.");
  });

  it("`atribucion_estimada` y `atribucion_sin_mensual`", () => {
    const basica = { anio: Y, k: 9, tiendas: [], salen: [], sinAtribuir: { en_curso: 0, siguiente: 0 }, filasSinB: false, mensual: true };
    expect(alertasAtribucion(basica).map((a) => [a.codigo, a.nivel, a.alcance])).toEqual([["atribucion_estimada", "info", "recorte"]]);
    const completa = alertasAtribucion({
      ...basica,
      tiendas: [{ codigo: "T10", participacion_anual: 0.087, participacion_mes: new Array(12).fill(null) }],
      sinAtribuir: { en_curso: -12, siguiente: 40 },
      filasSinB: true,
      mensual: false,
    });
    expect(completa.map((a) => [a.codigo, a.nivel])).toEqual([
      ["atribucion_estimada", "info"],
      ["atribucion_sin_mensual", "importante"],
    ]);
    expect(completa[0].detalle).toContain("T10: 2027 estimado con su parte de la base 2026 (8.7 %), la misma en todos los meses (no tiene un año completo de historia)");
    expect(completa[0].detalle).toContain("Hay filas proyectadas por otro método: lo que no forma la base de 2027 queda sin atribuir.");
    expect(completa[0].detalle).toContain("Sin atribuir a ninguna tienda: −12 u en 2026 y +40 u en 2027.");
    expect(completa[1].detalle).toBe("El real de ene–set cambió desde el cálculo (o la base quedó por debajo de lo vendido): el reparto mensual por tienda de oct–dic no se puede hacer; el total anual sí.");
  });

  it("`marca_estimada`, `comparada_distinta_k` y `distinta_de_aprobada`", () => {
    expect(alertaMarcaEstimada({ nombre: "X", sinParticipacion: null, proyectado: 10 })[0].detalle).toContain("Unidad de marca X: lo proyectado es estimado con su participación de los últimos 12 meses en cada fila.");
    expect(alertaMarcaEstimada({ nombre: "X", sinParticipacion: { Y: 30, Y1: 70 }, proyectado: 10 })[0].detalle).toContain("100 u de filas sin participación por marca quedan fuera.");
    expect(alertaMarcaEstimada({ nombre: "X", sinParticipacion: { Y: 30, Y1: 70 }, proyectado: 0 })[0].detalle).toContain("la proyección no trae participación por marca");
    expect(alertaComparadaDistintaK("2026-09", "2026-09")).toEqual([]);
    expect(alertaComparadaDistintaK("2026-09", null)).toEqual([]);
    expect(alertaComparadaDistintaK("2026-09", "2026-08")[0].nivel).toBe("info");
    expect(alertaDistintaDeAprobada(null, 2027)).toEqual([]);
    expect(alertaDistintaDeAprobada({ identica: true, fecha: "2026-11-03T15:00:00.000Z", proyeccion_nombre: "p", siguiente: { u: 0, pct: 0 } }, 2027)).toEqual([]);
    expect(alertaDistintaDeAprobada({ identica: false, fecha: "2026-11-03T15:00:00.000Z", proyeccion_nombre: "p", siguiente: { u: -50, pct: -1 } }, 2027)[0].detalle).toBe("Frente a lo aprobado el 03 nov (p): 2027 −50 u (−1.0 %).");
  });

  it("orden: importantes primero y, dentro de cada nivel, el de la tabla de §4.5 (estable entre iguales)", () => {
    const a = (codigo: CodigoAlerta, nivel: "importante" | "info", detalle = ""): AlertaApi => ({ codigo, nivel, alcance: "proyeccion", titulo: "", detalle, cifras: {}, enlace: null });
    const ordenadas = ordenarAlertas([a("datos_mas_nuevos", "info"), a("sin_curva", "importante"), a("anomalia_crecimiento", "info", "1"), a("contra_tendencia", "info"), a("anomalia_crecimiento", "info", "2"), a("contra_tendencia", "importante")]);
    expect(ordenadas.map((x) => `${x.nivel}:${x.codigo}${x.detalle}`)).toEqual(["importante:contra_tendencia", "importante:sin_curva", "info:contra_tendencia", "info:anomalia_crecimiento1", "info:anomalia_crecimiento2", "info:datos_mas_nuevos"]);
    expect(new Set(ORDEN_ALERTAS).size).toBe(20);
  });
});
