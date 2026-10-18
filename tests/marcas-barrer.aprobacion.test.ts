import { describe, expect, it } from "vitest";
import { analizarMarca } from "@/lib/marcas-barrer/modelo";
import { adjuntarVigente, alcanceDe, aRepartoApi, armarVersion, diferenciaConVigente, errorDeLista, estadoDeReparto, huellaConfigActual, huellaConfigDeVersion, temporadasAGuardar, temporadasDeVersion, temporadasPorDefecto, vectoresDeVersion, type CuerpoAprobacion, type VersionLeida } from "@/lib/marcas-barrer/reglas";
import { TEMPORADAS_DEFECTO, type TemporadasConfig } from "@/lib/marcas-barrer/tipos-api";
import { motivosObsoleto } from "@/lib/marcas-barrer/huellas";
import type { VentaMarcaGml } from "@/lib/marcas-barrer/tipos";
import { ALCANCE_VACIO, CLAVE, GEN, MARCA, MESES_24, NODO, OTROS, entradaBeta, hechosBeta, ventaDe, type HechoSpec } from "./marcas-barrer.fixture";

/** Regla 10 y casos 4, 6 y 9 de la ficha 12: ajuste, aprobación y lo que queda guardado en la versión. */

const analisis = (c: Partial<Parameters<typeof entradaBeta>[0]> = {}) => analizarMarca(entradaBeta({ normaliza_nino: false, ...c }));
const partes = (clave: string) => ({ genero_mundo_linea_id: clave.slice(0, clave.indexOf("|")), equivalencia_id: clave.slice(clave.indexOf("|") + 1) || null });

const cuerpo = (c: Partial<CuerpoAprobacion> = {}): CuerpoAprobacion => ({
  ventana_meses: 24,
  modo: "por_temporada",
  fuente: "historico",
  alcance: ALCANCE_VACIO,
  filas: [],
  ...c,
});

const ok = (r: ReturnType<typeof armarVersion>) => {
  if (!r.ok) throw new Error(`rechazo: ${r.rechazo.codigo} ${r.rechazo.mensaje}`);
  return r.version;
};
const sumaVigente = (v: ReturnType<typeof ok>, temporada: string | null) =>
  Math.round(v.filas.filter((f) => f.temporada === temporada).reduce((a, f) => a + f.participacion_vigente, 0) * 1e4);

describe("aprobar el reparto calculado, sin ajuste", () => {
  const a = analisis();
  const v = ok(armarVersion(a.interno, cuerpo()));

  it("guarda una fila por g y temporada con participación > 0 y cada vector suma exactamente 1,0000", () => {
    // 12 g con venta en cada temporada: tres grandes y los pequeños de su época (6 en verano y 3 en invierno).
    expect(v.filas.filter((f) => f.temporada === "verano")).toHaveLength(3 + 6);
    expect(v.filas.filter((f) => f.temporada === "invierno")).toHaveLength(3 + 3);
    expect(sumaVigente(v, "verano")).toBe(10000);
    expect(sumaVigente(v, "invierno")).toBe(10000);
    expect(Math.round(v.filas.filter((f) => f.temporada === "verano").reduce((x, f) => x + f.participacion_calculada, 0) * 1e4)).toBe(10000);
  });
  it("sin ajuste: ajustada = null, vigente = calculada, y no pide nota con ventana 24, fuente histórica y sin alcance", () => {
    expect(v.hay_ajuste).toBe(false);
    expect(v.requiere_nota).toBe(false);
    for (const f of v.filas) {
      expect(f.participacion_ajustada).toBeNull();
      expect(f.participacion_vigente).toBeCloseTo(f.participacion_calculada, 3);
    }
  });
  it("las filas de los pequeños llevan grupo_resto (género|mundo) y las grandes no; la g y la equivalencia vienen del nodo", () => {
    expect(v.filas.filter((f) => f.grupo_resto !== null && f.temporada === "verano")).toHaveLength(6);
    const denim = v.filas.find((f) => f.genero_mundo_linea_id === NODO.denim && f.temporada === "verano")!;
    expect(denim).toMatchObject({ equivalencia_id: null, grupo_resto: null, unidades_ventana: 2400 });
    expect(denim.participacion_calculada).toBeCloseTo(1200 / 2230, 3);
  });
  it("modo anual: filas sin temporada", () => {
    const anual = analisis({ modo: "anual" });
    const r = ok(armarVersion(anual.interno, cuerpo({ modo: "anual" })));
    expect(r.filas.every((f) => f.temporada === null)).toBe(true);
    expect(sumaVigente(r, null)).toBe(10000);
  });
});

describe("caso 9: ajuste y aprobación", () => {
  const a = analisis();
  const verano = (clave: string) => ({ ...partes(clave), temporada: "verano" as const });
  const denimVerano = 1200 / 2230;

  it("editar DENIM (verano) a 0,50 sin renormalizar el resto → suma_invalida", () => {
    const r = armarVersion(a.interno, cuerpo({ filas: [{ ...verano(CLAVE.denim), participacion_ajustada: 0.5 }], nota: "ajuste" }));
    expect(r).toMatchObject({ ok: false, rechazo: { codigo: "suma_invalida" } });
  });
  it("renormalizado pero sin nota → nota_requerida; con nota aprueba y deja ajustada y vigente", () => {
    const filas = a.api.filas
      .filter((f) => f.p2.some((x) => x.temporada === "verano" && x.historico > 0))
      .map((f) => {
        const h = f.p2.find((x) => x.temporada === "verano")!.historico;
        const nuevo = f.clave === CLAVE.denim ? 0.5 : (h * (1 - 0.5)) / (1 - denimVerano);
        return { ...partes(f.clave), temporada: "verano" as const, participacion_ajustada: nuevo };
      });
    const sinNota = armarVersion(a.interno, cuerpo({ filas }));
    expect(sinNota).toMatchObject({ ok: false, rechazo: { codigo: "nota_requerida" } });
    const conNota = ok(armarVersion(a.interno, cuerpo({ filas, nota: "BETA se compra más en DENIM" })));
    expect(conNota.hay_ajuste).toBe(true);
    const denim = conNota.filas.find((f) => f.genero_mundo_linea_id === NODO.denim && f.temporada === "verano")!;
    expect(denim.participacion_ajustada).toBe(0.5);
    expect(denim.participacion_vigente).toBeCloseTo(0.5, 3);
    expect(denim.participacion_calculada).toBeCloseTo(denimVerano, 3);
    expect(sumaVigente(conNota, "verano")).toBe(10000);
    // Invierno no se tocó.
    expect(conNota.filas.filter((f) => f.temporada === "invierno").every((f) => f.participacion_ajustada === null)).toBe(true);
  });
  it("un ajuste igual a lo calculado no cuenta como ajuste", () => {
    const r = ok(armarVersion(a.interno, cuerpo({ filas: [{ ...verano(CLAVE.denim), participacion_ajustada: denimVerano }] })));
    expect(r.hay_ajuste).toBe(false);
    expect(r.filas.every((f) => f.participacion_ajustada === null)).toBe(true);
  });
  it("una fila que no pertenece al reparto calculado (g nueva o temporada que no existe) → fila_desconocida", () => {
    expect(armarVersion(a.interno, cuerpo({ filas: [{ ...partes("otra|"), temporada: "verano", participacion_ajustada: 0.1 }] }))).toMatchObject({ ok: false, rechazo: { codigo: "fila_desconocida" } });
    expect(armarVersion(a.interno, cuerpo({ filas: [{ ...partes(CLAVE.denim), temporada: null, participacion_ajustada: 0.1 }] }))).toMatchObject({ ok: false, rechazo: { codigo: "fila_desconocida" } });
    // Una g que no vende en esa temporada (un pequeño de URBANO en verano) tampoco se puede agregar.
    expect(armarVersion(a.interno, cuerpo({ filas: [{ ...verano(CLAVE.u[0]), participacion_ajustada: 0.1 }] }))).toMatchObject({ ok: false, rechazo: { codigo: "fila_desconocida" } });
  });
  it("el ajuste que deja una participación en 0 se guarda con vigente 0", () => {
    const filas = a.api.filas
      .filter((f) => f.p2.some((x) => x.temporada === "verano" && x.historico > 0))
      .map((f) => {
        const h = f.p2.find((x) => x.temporada === "verano")!.historico;
        const nuevo = f.clave === CLAVE.sandalia ? 0 : h / (1 - 240 / 2230);
        return { ...partes(f.clave), temporada: "verano" as const, participacion_ajustada: nuevo };
      });
    const r = ok(armarVersion(a.interno, cuerpo({ filas, nota: "BETA no se compra para mujer" })));
    expect(r.filas.find((f) => f.genero_mundo_linea_id === NODO.sandalia && f.temporada === "verano")?.participacion_vigente).toBe(0);
    expect(sumaVigente(r, "verano")).toBe(10000);
  });
});

describe("nota obligatoria (criterio 06b) y fuente", () => {
  const a = analisis();
  it("ventana distinta de 24 → nota_requerida; con nota aprueba", () => {
    expect(armarVersion(a.interno, cuerpo({ ventana_meses: 12 }))).toMatchObject({ ok: false, rechazo: { codigo: "nota_requerida" } });
    expect(ok(armarVersion(a.interno, cuerpo({ ventana_meses: 12, nota: "ventana corta" }))).requiere_nota).toBe(true);
  });
  it("con alcance → nota_requerida", () => {
    const hombre = analisis({ alcance: { generos: [GEN.hombre], mundos: [], lineas: [] } });
    const c = cuerpo({ alcance: { generos: [GEN.hombre], mundos: [], lineas: [] } });
    expect(armarVersion(hombre.interno, c)).toMatchObject({ ok: false, rechazo: { codigo: "nota_requerida" } });
    const r = ok(armarVersion(hombre.interno, { ...c, nota: "solo hombre" }));
    expect(r.filas.some((f) => f.genero_mundo_linea_id === NODO.sandalia)).toBe(false);
  });
  it("fuente cerrada sin cerrada → sin_cerrada; con cerrada y nota → calculada = la de la cerrada", () => {
    const sin = analisis({ cerrada: null });
    expect(armarVersion(sin.interno, cuerpo({ fuente: "cerrada", nota: "x" }))).toMatchObject({ ok: false, rechazo: { codigo: "sin_cerrada" } });
    expect(armarVersion(a.interno, cuerpo({ fuente: "cerrada" }))).toMatchObject({ ok: false, rechazo: { codigo: "nota_requerida" } });
    const r = ok(armarVersion(a.interno, cuerpo({ fuente: "cerrada", nota: "usar la cerrada" })));
    const denim = r.filas.filter((f) => f.genero_mundo_linea_id === NODO.denim);
    expect(denim.map((f) => [f.temporada, f.participacion_calculada])).toEqual([["invierno", 0.5], ["verano", 0.5]]);
    expect(r.filas.some((f) => f.genero_mundo_linea_id === NODO.sandalia)).toBe(false);
    expect(sumaVigente(r, "verano")).toBe(10000);
  });
  it("sin venta al barrer (DELTA) → suma_invalida: no hay nada que aprobar", () => {
    const delta = { id: MARCA.delta, nombre: "DELTA", modalidad: "barrido" as const, agrupacion_marca: "VALOR", agrupacion_marca_id: "ag", miembros: [], gml_especificos: [] };
    const sin = analizarMarca(entradaBeta({ marca: delta, venta: ventaDe([], OTROS), cerrada: null }));
    expect(armarVersion(sin.interno, cuerpo())).toMatchObject({ ok: false, rechazo: { codigo: "suma_invalida" } });
  });
  it("la nota de más de 300 caracteres se rechaza", () => {
    expect(armarVersion(a.interno, cuerpo({ ventana_meses: 12, nota: "x".repeat(301) }))).toMatchObject({ ok: false });
  });
});

// ─── La versión guardada frente al análisis de hoy ───

function versionDe(c: Partial<CuerpoAprobacion> = {}, a = analisis()): VersionLeida {
  const v = ok(armarVersion(a.interno, cuerpo(c)));
  const nivelDe = () => "GML" as const;
  return {
    id: "reparto-1",
    marca_id: MARCA.beta,
    version: 1,
    vigente: true,
    ventana_meses: 24,
    modo: "por_temporada",
    fuente: c.fuente ?? "historico",
    alcance: {},
    hasta_periodo: "2026-09-01",
    normaliza_nino: false,
    huella_cargas: a.interno.huella_cargas,
    huella_config: huellaConfigDeVersion(a.interno, c.fuente ?? "historico", v.filas, nivelDe),
    factores_usados: [],
    temporadas_usadas: temporadasPorDefecto(),
    share_barrido: 1,
    eat_pp: null,
    error_reparto_pp: 8.4,
    nota: null,
    aprobada_por_id: "u1",
    aprobada_por_nombre: "Javier",
    aprobada_at: "2026-10-01T10:00:00Z",
    filas: v.filas.map((f) => ({ ...f })),
  };
}

describe("regla 11 y 12: el reparto vigente frente a lo calculado hoy", () => {
  const version = versionDe();
  const nivelDe = () => "GML" as const;

  it("sin datos nuevos: diferencia 0 pp y huellas iguales → al día", () => {
    const hoy = analisis();
    expect(diferenciaConVigente(hoy.interno, version)).toBeLessThan(0.01);
    const r = motivosObsoleto(version, { huella_config: huellaConfigActual(hoy.interno, version, nivelDe, 24), huella_cargas: hoy.interno.huella_cargas }, 0);
    expect(r.motivos).toEqual([]);
    expect(r.al_dia).toBe(true);
  });
  it("un mes nuevo que mueve el p2 1,2 pp → no es obsoleto (al día con diferencia 1,2); que lo mueve 6 pp → cargas_nuevas", () => {
    const venta = (extraDenim: number) =>
      ventaDe([...hechosConMes("2026-10", extraDenim)], OTROS);
    // Un mes nuevo de DENIM mueve el reparto de verano (octubre es verano) unos pocos puntos.
    const poco = analizarMarca(entradaBeta({ normaliza_nino: false, hasta: "2026-10", venta: ventaConCargas(venta(100), "2026-10") }));
    const muchoVenta = analizarMarca(entradaBeta({ normaliza_nino: false, hasta: "2026-10", venta: ventaConCargas(venta(2500), "2026-10") }));
    const difPoco = diferenciaConVigente(poco.interno, version)!;
    const difMucho = diferenciaConVigente(muchoVenta.interno, version)!;
    expect(difPoco).toBeLessThan(5);
    expect(difMucho).toBeGreaterThan(5);
    const huellasHoy = (a: ReturnType<typeof analizarMarca>) => ({ huella_config: huellaConfigActual(a.interno, version, nivelDe, 24), huella_cargas: a.interno.huella_cargas });
    const a = motivosObsoleto(version, huellasHoy(poco), difPoco);
    expect(a.motivos).toEqual([]);
    expect(a.diferencia_pp).toBe(difPoco);
    expect(motivosObsoleto(version, huellasHoy(muchoVenta), difMucho).motivos).toEqual(["cargas_nuevas"]);
    // Y las cargas distintas pesan en la huella (el POST con la huella vieja es huella_cambiada).
    expect(poco.api.huella).not.toBe(analisis().api.huella);
  });
  it("cambiar la modalidad, un GML específico o un miembro marca config_cambiada siempre, aunque los datos no cambien", () => {
    const mixta = analizarMarca(
      entradaBeta({ normaliza_nino: false, marca: { id: MARCA.beta, nombre: "BETA", modalidad: "mixta", agrupacion_marca: "PREMIUM", agrupacion_marca_id: version.huella_config ? entradaBeta().marca.agrupacion_marca_id : "", miembros: [], gml_especificos: [{ gml_id: NODO.camisa, ruta: "x" }] } })
    );
    const r = motivosObsoleto(version, { huella_config: huellaConfigActual(mixta.interno, version, nivelDe, 24), huella_cargas: mixta.interno.huella_cargas }, 0);
    expect(r.motivos).toEqual(["config_cambiada"]);
  });
  it("el nivel de una g cambia → nivel_cambiado; otra ventana pedida → ventana_distinta", () => {
    const hoy = analisis();
    const gmlh = (id: string) => (id === NODO.polo ? ("GMLE" as const) : ("GML" as const));
    expect(motivosObsoleto(version, { huella_config: huellaConfigActual(hoy.interno, version, gmlh, 24), huella_cargas: hoy.interno.huella_cargas }, 0).motivos).toEqual(["nivel_cambiado"]);
    expect(motivosObsoleto(version, { huella_config: huellaConfigActual(hoy.interno, version, nivelDe, 12), huella_cargas: hoy.interno.huella_cargas }, 0).motivos).toEqual(["ventana_distinta"]);
  });
  it("una versión aprobada según la cerrada, sin cerrada hoy, no se puede comparar (diferencia null)", () => {
    const conCerrada = versionDe({ fuente: "cerrada", nota: "usar la cerrada" });
    expect(diferenciaConVigente(analisis({ cerrada: null }).interno, conCerrada)).toBeNull();
    expect(diferenciaConVigente(analisis().interno, conCerrada)).toBeLessThan(0.01);
  });
  it("calculado entonces vs calculado hoy: el ajuste del planner no cuenta como desviación de los datos", () => {
    const v = versionDe();
    const ajustada: VersionLeida = { ...v, filas: v.filas.map((f) => (f.genero_mundo_linea_id === NODO.denim ? { ...f, participacion_ajustada: 0.9, participacion_vigente: 0.9 } : f)) };
    expect(diferenciaConVigente(analisis().interno, ajustada)).toBeLessThan(0.01);
    expect(vectoresDeVersion(ajustada, "vigente").get(`verano|${CLAVE.denim}`)).toBe(0.9);
    expect(vectoresDeVersion(ajustada, "calculada").get(`verano|${CLAVE.denim}`)).toBeCloseTo(1200 / 2230, 3);
  });
  it("adjuntarVigente rellena p2.vigente y ajustado_vigente (también en los restos) y el bloque vigente; sin versión, aviso sin_reparto", () => {
    const base = analisis();
    const conVigente = adjuntarVigente(base.api, version, { motivos: [], diferencia_pp: 0.4 });
    const denim = conVigente.filas.find((f) => f.clave === CLAVE.denim)!;
    expect(denim.p2.find((x) => x.temporada === "verano")).toMatchObject({ ajustado_vigente: null });
    expect(denim.p2.find((x) => x.temporada === "verano")!.vigente).toBeCloseTo(1200 / 2230, 3);
    const resto = conVigente.restos.find((r) => r.etiqueta.endsWith("CASUAL"))!;
    expect(resto.p2.find((x) => x.temporada === "verano")!.vigente).toBeCloseTo(190 / 2230, 3);
    expect(conVigente.vigente).toMatchObject({ reparto_id: "reparto-1", version: 1, modo: "por_temporada", fuente: "historico", aprobada_por_nombre: "Javier", error_reparto_pp: 8.4, diferencia_pp: 0.4 });
    expect(conVigente.obsoleto).toEqual([]);
    expect(conVigente.avisos).not.toContain("sin_reparto");
    const sin = adjuntarVigente(base.api, null, { motivos: [], diferencia_pp: null });
    expect(sin.vigente).toBeNull();
    expect(sin.avisos).toContain("sin_reparto");
    const obsoleta = adjuntarVigente(base.api, version, { motivos: ["nivel_cambiado"], diferencia_pp: 0 });
    expect(obsoleta.obsoleto).toEqual(["nivel_cambiado"]);
    expect(obsoleta.avisos).toContain("nivel_cambiado");
  });
  it("aRepartoApi: filas ordenadas, rutas y alcance; estado de la lista y veredicto del error", () => {
    const api = aRepartoApi(version, (g, e) => `${g}|${e ?? ""}`);
    expect(api).toMatchObject({ version: 1, vigente: true, modo: "por_temporada", fuente: "historico", hasta_periodo: "2026-09", alcance: { generos: [], mundos: [], lineas: [] }, temporadas_usadas: { verano: { desde_mes: 10, hasta_mes: 3 } } });
    expect(api.filas[0].temporada).toBe("invierno");
    expect(alcanceDe({ generos: ["b", "a"] })).toEqual({ generos: ["a", "b"], mundos: [], lineas: [] });
    expect(estadoDeReparto(false, [])).toBe("sin_reparto");
    expect(estadoDeReparto(true, [])).toBe("al_dia");
    expect(estadoDeReparto(true, ["config_cambiada"])).toBe("obsoleto");
    expect(errorDeLista(30)).toEqual({ pp: 30, veredicto: "inestable" });
    expect(errorDeLista(null)).toEqual({ pp: null, veredicto: null });
  });
});

/** Los hechos normales de BETA más un mes nuevo en el que DENIM vende `denim` unidades (y POLO y SANDALIA, lo de siempre). */
function hechosConMes(mes: string, denim: number): HechoSpec[] {
  return [
    ...hechosBeta(),
    { unidad: MARCA.beta, nodo: NODO.denim, eq: null, mes, u: denim },
    { unidad: MARCA.beta, nodo: NODO.polo, eq: null, mes, u: 50 },
    { unidad: MARCA.beta, nodo: NODO.sandalia, eq: null, mes, u: 20 },
  ];
}

/** La carga del mes nuevo entra en la huella de cargas. */
function ventaConCargas(v: VentaMarcaGml, mes: string): VentaMarcaGml {
  return { ...v, cargas: { ...Object.fromEntries(MESES_24.map((m) => [m, `carga-${m}`])), [mes]: `carga-${mes}` } };
}

// ─── `temporadas_usadas` (0024, decisión 31): lo aprobado conserva las fechas con que se calculó ───

describe("temporadas_usadas de una versión", () => {
  const OTRAS: TemporadasConfig = { verano: { desde_mes: 11, hasta_mes: 4 }, invierno: { desde_mes: 5, hasta_mes: 10 } };
  const rutaDe = (g: string) => g;

  it("temporadasDeVersion lee lo guardado tal cual (copia normalizada, sin campos de más)", () => {
    expect(temporadasDeVersion(OTRAS)).toEqual(OTRAS);
    expect(temporadasDeVersion({ ...OTRAS, extra: 1, verano: { ...OTRAS.verano, x: 1 } })).toEqual(OTRAS);
    const leida = temporadasDeVersion(OTRAS);
    expect(leida).not.toBe(OTRAS);
    expect(leida.verano).not.toBe(OTRAS.verano);
  });
  it("un valor sin la forma esperada cae al defecto (y la copia del defecto no se comparte)", () => {
    const malos: unknown[] = [
      null,
      undefined,
      "verano",
      42,
      [],
      {},
      { verano: { desde_mes: 10, hasta_mes: 3 } },
      { verano: { desde_mes: "10", hasta_mes: 3 }, invierno: { desde_mes: 4, hasta_mes: 9 } },
      { verano: { desde_mes: 13, hasta_mes: 3 }, invierno: { desde_mes: 4, hasta_mes: 9 } },
      { verano: { desde_mes: 1.5, hasta_mes: 3 }, invierno: { desde_mes: 4, hasta_mes: 9 } },
      { verano: [10, 3], invierno: [4, 9] },
      // Se solapan y no cubren los doce meses.
      { verano: { desde_mes: 10, hasta_mes: 5 }, invierno: { desde_mes: 4, hasta_mes: 9 } },
      { verano: { desde_mes: 10, hasta_mes: 2 }, invierno: { desde_mes: 4, hasta_mes: 9 } },
    ];
    for (const malo of malos) expect(temporadasDeVersion(malo)).toEqual(TEMPORADAS_DEFECTO);
    const d = temporadasDeVersion(null);
    d.verano.desde_mes = 1;
    expect(TEMPORADAS_DEFECTO.verano.desde_mes).toBe(10);
    expect(temporadasPorDefecto()).toEqual(TEMPORADAS_DEFECTO);
  });
  it("temporadasAGuardar devuelve una copia de las válidas y null si no lo son", () => {
    expect(temporadasAGuardar(OTRAS)).toEqual(OTRAS);
    expect(temporadasAGuardar(TEMPORADAS_DEFECTO)).toEqual(TEMPORADAS_DEFECTO);
    expect(temporadasAGuardar({ verano: { desde_mes: 10, hasta_mes: 5 }, invierno: { desde_mes: 4, hasta_mes: 9 } })).toBeNull();
    expect(temporadasAGuardar({ verano: { desde_mes: 0, hasta_mes: 3 }, invierno: { desde_mes: 4, hasta_mes: 9 } })).toBeNull();
  });
  it("aRepartoApi devuelve las fechas de CADA versión; una malformada, el defecto", () => {
    const v = versionDe();
    expect(aRepartoApi({ ...v, temporadas_usadas: OTRAS }, rutaDe).temporadas_usadas).toEqual(OTRAS);
    expect(aRepartoApi(v, rutaDe).temporadas_usadas).toEqual(TEMPORADAS_DEFECTO);
    expect(aRepartoApi({ ...v, temporadas_usadas: { verano: 1 } }, rutaDe).temporadas_usadas).toEqual(TEMPORADAS_DEFECTO);
    expect(aRepartoApi({ ...v, temporadas_usadas: null }, rutaDe).temporadas_usadas).toEqual(TEMPORADAS_DEFECTO);
  });
  it("cambiar las fechas de hoy no reescribe lo aprobado, pero sí marca config_cambiada (la huella lo detecta)", () => {
    const aprobada = versionDe(); // calculada con las fechas por defecto
    const hoy = analisis({ temporadas: OTRAS });
    expect(hoy.api.parametros.temporadas).toEqual(OTRAS);
    const nivelDe = () => "GML" as const;
    const actual = huellaConfigActual(hoy.interno, aprobada, nivelDe, 24);
    expect(actual).not.toBe(aprobada.huella_config);
    expect(motivosObsoleto(aprobada, { huella_config: actual, huella_cargas: hoy.interno.huella_cargas }, 0).motivos).toEqual(["config_cambiada"]);
    // Lo aprobado sigue contando sus fechas.
    expect(aRepartoApi(aprobada, rutaDe).temporadas_usadas).toEqual(TEMPORADAS_DEFECTO);
    // Y una versión aprobada con las otras fechas las conserva y su huella ya no coincide con la de las fechas por defecto.
    const conOtras = versionDe({}, hoy);
    const conOtrasV: VersionLeida = { ...conOtras, temporadas_usadas: OTRAS };
    expect(aRepartoApi(conOtrasV, rutaDe).temporadas_usadas).toEqual(OTRAS);
    expect(conOtras.huella_config).not.toBe(aprobada.huella_config);
  });
});
