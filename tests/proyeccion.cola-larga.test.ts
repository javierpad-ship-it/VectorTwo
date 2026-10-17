import { describe, expect, it } from "vitest";
import { aColaLargaApi, avisosColaLarga, disponibilidadFila, pendienteDeRevision, type MesDisponibilidad } from "@/lib/proyeccion/cola-larga";
import { motivosDesactualizada, type EstadoActual, type ProyeccionParaEstado } from "@/lib/proyeccion/desactualizado";
import { armarMatriz, estadoLinea } from "@/lib/proyeccion/matriz";
import { proponerFilaTienda, unidadesMadurasEntero } from "@/lib/proyeccion/tiendas-nuevas";
import { MAX_TOTAL } from "@/lib/proyeccion/tipos-api";
import { proponerCierre } from "@/lib/proyeccion/cierre";
import { proponerPorDemandaCorregida } from "@/lib/proyeccion/cola-larga";
import { conteosResumen } from "@/lib/proyeccion/resumen";
import { aplicarDecision, calcularProyeccion, recalcularBaseSiguiente, registroDe, type ContextoModelo } from "@/lib/proyeccion/modelo";
import { motivoRechazoCerrar } from "@/lib/proyeccion/reglas";
import { aAniosApi } from "@/lib/proyeccion/persistencia";
import type { DecisionPrevia, FilaModelo, PreviasCalculo, SalidaCalculo } from "@/lib/proyeccion/tipos";
import { AM, N, Y, aPlanas, clave, entrada, hechosBase, lineaDenimValor, tiendas, type Hecho } from "./proyeccion.fixture";

/**
 * Cola larga con validación de disponibilidad (ficha 07, «Cambios 0.10.1», reglas 46 y 47). Disponibilidad medida con un proxy
 * mensual (tienda-meses con stock al cierre del mes). Decisión de Javier (ronda 4): en una fila PARA REVISIÓN la propuesta es la
 * demanda corregida `A_f` y el avance normal va como referencia.
 */

const VENTANA = ["2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];
const PLANA = Array.from({ length: 12 }, () => 1 / 12);
const UNOS = Array.from({ length: 12 }, () => 1);
const UMBRALES = { cola_larga: 100, disponibilidad: 0.75 };

/** `n` tiendas con stock y `u` unidades en cada mes de `meses` (el resto de la ventana sin fila). */
const dato = (meses: readonly string[], tcs: number, u: number, cd = 0): MesDisponibilidad[] =>
  meses.map((periodo) => ({ periodo: `${periodo}-01`, tiendas_con_stock: tcs, unidades_con_stock: u, stock_cd: cd }));

const medir = (disponibilidad: readonly MesDisponibilidad[], extra: { curva?: readonly number[] | null; phi?: (a: number) => readonly number[]; n?: number; umbrales?: typeof UMBRALES } = {}) =>
  disponibilidadFila({
    disponibilidad,
    ventana: VENTANA,
    curva: extra.curva === undefined ? PLANA : extra.curva,
    factoresMes: extra.phi ?? (() => UNOS),
    nTiendas: extra.n ?? 9,
    umbrales: extra.umbrales ?? UMBRALES,
  });

describe("disponibilidadFila (regla 46)", () => {
  it("9 tiendas, curva plana, 6 con stock en 9 de los 12 meses (54 de 108 tienda-meses): dispon 0,50; ritmo = unidades ÷ tienda-meses con stock; A = Σũ ÷ Σ(c·tcs÷n)", () => {
    const meses = VENTANA.slice(0, 9);
    const d = dato(meses, 6, 6); // 54 u en total, 6 por mes
    const r = medir(d);
    expect(r.tienda_meses).toBe(108);
    expect(r.tienda_meses_con_stock).toBe(54);
    expect(r.dispon).toBeCloseTo(0.5, 12);
    expect(r.ritmo).toBeCloseTo(1, 12); // 54 ÷ 54
    expect(r.meses_tiendas_sin_stock).toBe(3);
    // Σ c·tcs÷n = 9 × (1/12 × 6/9) = 0,5 → A = 54 ÷ 0,5 = 108.
    expect(r.demanda_corregida).toBeCloseTo(108, 9);
    // Con 48 unidades (la última de las nueve sin venta): ritmo 0,889 y A = 96.
    const r48 = medir([...dato(VENTANA.slice(0, 8), 6, 6), ...dato(VENTANA.slice(8, 9), 6, 0)]);
    expect(r48.ritmo).toBeCloseTo(48 / 54, 12);
    expect(r48.demanda_corregida).toBeCloseTo(96, 9);
  });

  it("con stock en todas las tiendas todos los meses: dispon 1 y A = Σũ (la venta normalizada del año)", () => {
    const r = medir(dato(VENTANA, 9, 10));
    expect(r.dispon).toBe(1);
    expect(r.demanda_corregida).toBeCloseTo(120, 9);
    expect(r.veredicto).toBe("cierra");
    expect(r.meses_tiendas_sin_stock).toBe(0);
  });

  it("con la mitad de las tiendas sin stock cada mes, A duplica lo vendido", () => {
    const r = medir(dato(VENTANA, 4.5, 5), { n: 9 });
    expect(r.dispon).toBeCloseTo(0.5, 12);
    expect(r.demanda_corregida).toBeCloseTo(2 * 60, 9);
  });

  it("sin una sola tienda-mes con stock → sin_dato (no se inventa una disponibilidad)", () => {
    const r = medir([]);
    expect(r).toMatchObject({ veredicto: "sin_dato", dispon: null, ritmo: null, demanda_corregida: null, tienda_meses_con_stock: 0, tienda_meses: 108, meses_tiendas_sin_stock: 12 });
    expect(medir(dato(VENTANA, 0, 0)).veredicto).toBe("sin_dato");
    expect(medir(dato(VENTANA, 3, 3), { n: 0 }).veredicto).toBe("sin_dato");
  });

  it("meses_cd_con_stock cuenta los meses con stock del CD (informativo: no cambia el veredicto)", () => {
    const sinCd = medir(dato(VENTANA.slice(0, 9), 6, 8, 0));
    const conCd = medir(dato(VENTANA.slice(0, 9), 6, 8, 40));
    expect(sinCd.meses_cd_con_stock).toBe(0);
    expect(conCd.meses_cd_con_stock).toBe(9);
    expect(conCd.veredicto).toBe(sinCd.veredicto);
    expect(conCd.demanda_corregida).toBe(sinCd.demanda_corregida);
  });

  it("el Niño normaliza ũ con φ del año de cada mes", () => {
    // Los tres meses de 2025 con φ = 0,5: sus unidades se duplican; los de 2026 con φ = 1.
    const d = dato(VENTANA, 9, 10);
    const r = medir(d, { phi: (a) => (a === 2025 ? Array.from({ length: 12 }, () => 0.5) : UNOS) });
    expect(r.demanda_corregida).toBeCloseTo(3 * 20 + 9 * 10, 9);
    // φ de un mes concreto (verano 1,24 en setiembre de 2026).
    const verano = Array.from({ length: 12 }, (_, i) => (i === 8 ? 1.24 : 1));
    const r2 = medir(dato(VENTANA, 9, 10), { phi: (a) => (a === 2026 ? verano : UNOS) });
    expect(r2.demanda_corregida).toBeCloseTo(110 + 10 / 1.24, 9);
  });

  it("una fila sin curva no tiene A_f: queda cola larga normal (cierra) con la disponibilidad medida", () => {
    const r = medir(dato(VENTANA.slice(0, 9), 6, 4), { curva: null });
    expect(r.demanda_corregida).toBeNull();
    expect(r.dispon).toBeCloseTo(0.5, 12);
    expect(r.veredicto).toBe("cierra");
  });

  it("un mes sin fila cuenta como 0 tiendas con stock; nunca más tiendas con stock que tiendas de M(Y)", () => {
    const r = medir(dato(VENTANA, 20, 1), { n: 9 });
    expect(r.tienda_meses_con_stock).toBe(108);
    expect(r.dispon).toBe(1);
  });
});

describe("veredicto de la cola larga (regla 47)", () => {
  const meses = VENTANA.slice(0, 9);
  it("dispon 0,9 → cierra (cola larga normal)", () => {
    expect(medir(dato(VENTANA, 8.1, 4)).veredicto).toBe("cierra");
  });
  it("dispon 0,5 y A = 72 < 100 → cierra_con_quiebres (se cierra sola); A = 144 ≥ 100 → revision", () => {
    // Σ c·tcs÷n = 0,5 con 6 tiendas de 9 en 9 meses: A = 2 × Σũ.
    const baja = medir(dato(meses, 6, 4)); // Σũ = 36
    expect(baja.demanda_corregida).toBeCloseTo(72, 9);
    expect(baja.veredicto).toBe("cierra_con_quiebres");
    const alta = medir(dato(meses, 6, 8)); // Σũ = 72
    expect(alta.demanda_corregida).toBeCloseTo(144, 9);
    expect(alta.veredicto).toBe("revision");
    // El umbral de cola larga manda: con 150 la de 144 se cierra sola.
    expect(medir(dato(meses, 6, 8), { umbrales: { cola_larga: 150, disponibilidad: 0.75 } }).veredicto).toBe("cierra_con_quiebres");
  });
  it("el umbral de disponibilidad es un parámetro: con 0,4 el caso de 0,5 pasa a cierra", () => {
    expect(medir(dato(meses, 6, 8), { umbrales: { cola_larga: 100, disponibilidad: 0.4 } }).veredicto).toBe("cierra");
    // Justo en el umbral cuenta como disponibilidad suficiente (dispon ≥ umbral).
    expect(medir(dato(meses, 6, 8), { umbrales: { cola_larga: 100, disponibilidad: 0.5 } }).veredicto).toBe("cierra");
  });
  it("avisosColaLarga: un aviso por veredicto; sin propuesta o con propuesta ≥ umbral no hay (salvo revision, que se hereda)", () => {
    expect(avisosColaLarga("cierra", 60, 100)).toEqual(["cola_larga"]);
    expect(avisosColaLarga(null, 60, 100)).toEqual(["cola_larga"]);
    expect(avisosColaLarga("cierra_con_quiebres", 60, 100)).toEqual(["cola_larga", "cola_larga_con_quiebres"]);
    expect(avisosColaLarga("sin_dato", 60, 100)).toEqual(["cola_larga", "sin_stock_historico"]);
    expect(avisosColaLarga("revision", 144, 100)).toEqual(["revision_cola_larga"]);
    expect(avisosColaLarga("revision", 80, 100)).toEqual(["revision_cola_larga"]);
    expect(avisosColaLarga("cierra_con_quiebres", 120, 100)).toEqual([]);
    expect(avisosColaLarga("cierra", null, 100)).toEqual([]);
    expect(avisosColaLarga("revision", null, 100)).toEqual([]);
  });
  it("aColaLargaApi redondea para mostrar y conserva el veredicto", () => {
    const api = aColaLargaApi(medir(dato(meses, 6, 8)));
    expect(api).toMatchObject({ demanda_corregida: 144, disponibilidad: 0.5, tienda_meses_con_stock: 54, tienda_meses: 108, veredicto: "revision", meses_tiendas_sin_stock: 3 });
  });
});

// ─── Con el cálculo completo ───

const CV = clave("denim", AM.val);

const calcular = (hechosExtra: Hecho[], parametros: Partial<ReturnType<typeof entrada>["parametros"]> = {}) => {
  const base = entrada({ hechos: [...hechosBase(), ...hechosExtra] });
  return calcularProyeccion({ ...base, parametros: { ...base.parametros, ...parametros } });
};
const fila = (s: SalidaCalculo, c: string): FilaModelo => s.filas.find((f) => f.clave === c) as FilaModelo;
const reg = (s: SalidaCalculo, c: string, anio: number) => registroDe(fila(s, c), anio)!;

describe("cola larga en el cálculo", () => {
  it("disponibilidad plena (los DENIM × PREMIUM del fixture, con stock en las tres tiendas): cola_larga normal y propuesta por avance", () => {
    const s = calcular([]);
    const r = reg(s, clave("denim", AM.pre), Y);
    expect(r).toMatchObject({ vendido: 45, propuesto: 60, metodo: "avance" });
    expect(r.avisos).toContain("cola_larga");
    expect(r.avisos).not.toContain("revision_cola_larga");
    expect(fila(s, clave("denim", AM.pre)).historico?.cola_larga).toMatchObject({ veredicto: "cierra", disponibilidad: 1 });
  });

  it("quiebres relevantes y A_f ≥ 100 → revision: la PROPUESTA es A_f y el avance normal va como referencia", () => {
    // T1 vende 8 al mes (V = 72, avance → 96); con stock solo en T1 y T6 de las tres tiendas: dispon 0,667, A = 96 ÷ 0,667 = 144.
    const s = calcular(lineaDenimValor(8));
    const r = reg(s, CV, Y);
    expect(r).toMatchObject({ vendido: 72, propuesto: 144, metodo: "avance", referencia_alternativa: 96, vigente: 144 });
    expect(r.avisos).toContain("revision_cola_larga");
    expect(r.avisos).not.toContain("cola_larga");
    expect(r.avisos).not.toContain("cola_larga_con_quiebres");
    // Real hasta setiembre y el resto de la nueva cifra con la curva (72 más 3 × 24).
    expect(r.meses?.slice(0, 9).reduce((a, b) => a + b, 0)).toBe(72);
    expect(r.meses?.slice(9)).toEqual([24, 24, 24]);
    expect(r.meses?.reduce((a, b) => a + b, 0)).toBe(144);
    // El detalle viaja en historico.cola_larga y en el registro de Y de la API (no en Y+1).
    const cl = fila(s, CV).historico?.cola_larga;
    expect(cl).toMatchObject({ veredicto: "revision", demanda_corregida: 144, tienda_meses_con_stock: 24, tienda_meses: 36 });
    expect(cl?.disponibilidad).toBeCloseTo(24 / 36, 4);
    const api = aAniosApi(fila(s, CV), Y);
    expect(api.find((a) => a.anio === Y)?.cola_larga).toMatchObject({ veredicto: "revision", demanda_corregida: 144 });
    expect(api.find((a) => a.anio === Y + 1)?.cola_larga).toBeNull();
    // La explicación nombra la disponibilidad, la cifra corregida y la de avance.
    expect(r.explicacion).toContain("cola larga con quiebres de stock");
    expect(r.explicacion).toContain("66.7 %");
    expect(r.explicacion).toContain("24 de 36 tienda-meses");
    expect(r.explicacion).toContain("144");
    expect(r.explicacion).toContain("saldrían 96");
  });

  it("la fila de Y+1 hereda el veredicto de Y (su base sale de Y) y queda para revisión aunque su propuesta baje del umbral", () => {
    const s = calcular(lineaDenimValor(8));
    const sig = reg(s, CV, Y + 1);
    expect(sig.propuesto).toBe(151); // 144 × 1,05
    expect(sig.avisos).toContain("revision_cola_larga");
    // Con crecimiento −40 % la de Y+1 queda en 86 (< 100) y sigue pidiendo revisión.
    const previas: PreviasCalculo = {
      filas: new Map([[`${CV}#${Y + 1}`, decision({ crecimiento_pct: -40 })]]),
      tiendas: new Map(),
    };
    const base = entrada({ hechos: [...hechosBase(), ...lineaDenimValor(8)], previas });
    const baja = calcularProyeccion(base);
    expect(reg(baja, CV, Y + 1).propuesto).toBe(86);
    expect(reg(baja, CV, Y + 1).avisos).toEqual(expect.arrayContaining(["revision_cola_larga"]));
  });

  it("quiebres relevantes pero A_f < 100 → cola_larga + cola_larga_con_quiebres y se cierra con la propuesta por avance", () => {
    // T1 vende 5 al mes: avance 60; A = 60 ÷ 0,667 = 90 < 100.
    const s = calcular(lineaDenimValor(5));
    const r = reg(s, CV, Y);
    expect(r).toMatchObject({ propuesto: 60, metodo: "avance", referencia_alternativa: null });
    expect(r.avisos).toEqual(expect.arrayContaining(["cola_larga", "cola_larga_con_quiebres"]));
    expect(r.avisos).not.toContain("revision_cola_larga");
    expect(fila(s, CV).historico?.cola_larga).toMatchObject({ veredicto: "cierra_con_quiebres", demanda_corregida: 90 });
  });

  it("sin stock cargado en W12 → sin_dato: cola larga normal con sin_stock_historico", () => {
    const s = calcular(lineaDenimValor(5, { stockT1: 0, conT6: false }));
    const r = reg(s, CV, Y);
    expect(r.propuesto).toBe(60);
    expect(r.avisos).toEqual(expect.arrayContaining(["cola_larga", "sin_stock_historico"]));
    expect(fila(s, CV).historico?.cola_larga).toMatchObject({ veredicto: "sin_dato", disponibilidad: null, demanda_corregida: null });
  });

  it("umbral_disponibilidad es parámetro de la proyección: con 0,5 la fila de dispon 0,667 deja de ser quiebre", () => {
    const s = calcular(lineaDenimValor(8), { umbral_disponibilidad: 0.5 });
    expect(reg(s, CV, Y)).toMatchObject({ propuesto: 96, metodo: "avance" });
    expect(reg(s, CV, Y).avisos).toContain("cola_larga");
  });

  it("umbral_cola_larga editable: con 150 la fila de revisión (A = 144) se cierra sola con quiebres", () => {
    const s = calcular(lineaDenimValor(8), { umbral_cola_larga: 150 });
    expect(reg(s, CV, Y)).toMatchObject({ propuesto: 96 });
    expect(reg(s, CV, Y).avisos).toContain("cola_larga_con_quiebres");
  });

  it("una fila ≥ umbral no se valida: sin cola_larga en el histórico", () => {
    const s = calcular([]);
    expect(fila(s, clave("denim", AM.rec)).historico?.cola_larga ?? null).toBeNull();
    expect(reg(s, clave("denim", AM.rec), Y).avisos.some((a) => ["cola_larga", "revision_cola_larga", "cola_larga_con_quiebres"].includes(a))).toBe(false);
  });

  it("el resumen cuenta las filas para revisión y recalcular conserva la decisión (con propuesta_cambio si la propuesta se movió)", () => {
    const s = calcular(lineaDenimValor(8));
    expect(s.resumen.filas_para_revision).toBe(1);
    expect(s.resumen.avisos.revision_cola_larga).toBe(2); // Y y Y+1
    const decidida = calcular(lineaDenimValor(8), {}).filas.length;
    expect(decidida).toBeGreaterThan(0);
    const previas: PreviasCalculo = {
      filas: new Map([[`${CV}#${Y}`, decision({ decidido: 144, origen: "propuesta", propuesta_al_decidir: 144 })]]),
      tiendas: new Map(),
    };
    const base = entrada({ hechos: [...hechosBase(), ...lineaDenimValor(8)], previas });
    const s2 = calcularProyeccion(base);
    expect(reg(s2, CV, Y)).toMatchObject({ decidido: 144, vigente: 144 });
    expect(reg(s2, CV, Y).avisos).not.toContain("propuesta_cambio");
    expect(s2.resumen.filas_para_revision).toBe(1); // la de Y+1 sigue sin decidir
    expect(pendienteDeRevision(reg(s2, CV, Y))).toBe(false);
    expect(pendienteDeRevision(reg(s2, CV, Y + 1))).toBe(true);
  });
});

const decision = (d: Partial<DecisionPrevia>): DecisionPrevia => ({
  decidido: null,
  origen: null,
  nota: null,
  propuesta_al_decidir: null,
  crecimiento_pct: null,
  decidido_por_nombre: null,
  decidido_at: null,
  meses: null,
  curva_origen_usada: [],
  ...d,
});

describe("cerrar con filas para revisión (caso 17, regla 37)", () => {
  const s = calcular(lineaDenimValor(8));
  const base = s.filas.filter((f) => f.tienda_id === null);
  const comunes = { estado: "en_trabajo" as const, calculandoDesde: null, ahora: "2026-10-15T12:00:00.000Z", anioEnCurso: Y, desactualizada: false, forzar: false, tiendas: [] };
  const filasBase = (decidir: (clave: string, anio: number, propuesto: number | null, avisos: string[]) => boolean) =>
    base.map((f) => ({
      clave: f.clave,
      anios: Object.fromEntries(
        f.registros.map((r) => [r.anio, { clave: f.clave, propuesto: r.propuesto, decidido: decidir(f.clave, r.anio, r.propuesto, r.avisos) ? (r.propuesto ?? 0) : null, avisos: r.avisos }])
      ),
    }));

  it("con todo decidido salvo la fila de revisión → 409 filas_sin_decidir que la lista como revision_cola_larga", () => {
    // Todo lo ≥ umbral queda decidido salvo DENIM × VALOR (144 y 151: la propuesta de una fila de revisión ya es ≥ umbral).
    const sinRevision = motivoRechazoCerrar({ ...comunes, filasBase: filasBase((c, _a, p) => c !== CV && (p ?? 0) >= 100) });
    expect(sinRevision.ok).toBe(false);
    if (!sinRevision.ok) {
      expect(sinRevision.rechazo.codigo).toBe("filas_sin_decidir");
      const enRevision = sinRevision.filas_sin_decidir?.filter((x) => x.clave === CV) ?? [];
      expect(enRevision.map((x) => [x.anio, x.propuesto, x.motivo])).toEqual([
        [Y + 1, 151, "revision_cola_larga"],
        [Y, 144, "revision_cola_larga"],
      ].sort((a, b) => (b[1] as number) - (a[1] as number)));
      expect(sinRevision.total_filas_para_revision).toBe(2);
      expect(sinRevision.rechazo.mensaje).toContain("cola larga con quiebres de stock");
    }
  });

  it("una fila de revisión con propuesta bajo el umbral (Y+1 con −40 %) sigue bloqueando hasta decidirla", () => {
    const filas = [{ clave: CV, anios: { [Y]: { clave: CV, propuesto: 144, decidido: 144, avisos: ["revision_cola_larga"] }, [Y + 1]: { clave: CV, propuesto: 86, decidido: null, avisos: ["revision_cola_larga"] } } }];
    const r = motivoRechazoCerrar({ ...comunes, filasBase: filas });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.filas_sin_decidir).toEqual([{ clave: CV, anio: Y + 1, propuesto: 86, motivo: "revision_cola_larga" }]);
    const decidida = [{ clave: CV, anios: { [Y]: filas[0].anios[Y], [Y + 1]: { ...filas[0].anios[Y + 1], decidido: 86 } } }];
    expect(motivoRechazoCerrar({ ...comunes, filasBase: decidida }).ok).toBe(true);
  });

  it("decidir la fila (aceptando A_f o escribiendo otra cifra) deja cerrar; la cola larga normal y con quiebres se cierra sola", () => {
    const todo = motivoRechazoCerrar({ ...comunes, filasBase: filasBase((_c, _a, p) => (p ?? 0) >= 100) });
    expect(todo.ok).toBe(true);
    if (todo.ok) expect(todo.cola_larga).toBeGreaterThan(0);
    // Con quiebres pero A < 100: ninguna fila queda para revisión y todo ≥ umbral decidido → se cierra.
    const con = calcular(lineaDenimValor(5));
    const filas = con.filas.filter((f) => f.tienda_id === null).map((f) => ({ clave: f.clave, anios: Object.fromEntries(f.registros.map((r) => [r.anio, { clave: f.clave, propuesto: r.propuesto, decidido: (r.propuesto ?? 0) >= 100 ? r.propuesto : null, avisos: r.avisos }])) }));
    expect(motivoRechazoCerrar({ ...comunes, filasBase: filas }).ok).toBe(true);
  });

  it("estadoLinea: una fila de revisión sin decidir impide `proyectada` aunque su propuesta quede bajo el umbral; decidida, vuelve", () => {
    const planas = aPlanas(s.filas).filter((f) => f.gml_id === N.denim && f.tienda_id === null);
    // Decide todas las filas con propuesta ≥ umbral menos la de revisión (Y+1 con −40 % queda bajo el umbral).
    const forzada = planas.map((f) => ({
      ...f,
      anios: f.anios.map((a) => {
        if (f.tienda_id !== null) return a;
        const esRev = f.agrupacion_marca === "VALOR";
        if (esRev && a.anio === Y + 1) return { ...a, propuesto: 86, decidido: null, vigente: 86, avisos: ["revision_cola_larga" as const] };
        return (a.propuesto ?? 0) >= 100 || a.avisos.includes("revision_cola_larga") ? { ...a, decidido: a.propuesto, origen: "propuesta" as const } : a;
      }),
    }));
    expect(estadoLinea(forzada, Y, 100)).toBe("parcial");
    const decidida = forzada.map((f) => ({ ...f, anios: f.anios.map((a) => (a.avisos.includes("revision_cola_larga") && a.decidido === null ? { ...a, decidido: 86, origen: "manual" as const } : a)) }));
    expect(estadoLinea(decidida, Y, 100)).toBe("proyectada");
  });
});

describe("matriz: para revisión", () => {
  const s = calcular(lineaDenimValor(8));
  const planas = aPlanas(s.filas);

  it("resumen.filas_para_revision cuenta las filas base con algún año pendiente y solo=para_revision deja las líneas con ellas", () => {
    const todo = armarMatriz(planas, { anio: Y });
    expect(todo.resumen.filas_para_revision).toBe(1);
    const solo = armarMatriz(planas, { anio: Y, filtro: { solo: "para_revision" } });
    expect(solo.nodos.filter((n) => n.nivel === "linea").map((n) => n.nombre)).toEqual(["DENIM"]);
    expect(solo.resumen.lineas).toBe(1);
    expect(solo.resumen.filas_para_revision).toBe(1);
    // Con la fila decidida en los dos años, ya no hay filas para revisión.
    const decididas = planas.map((f) => ({ ...f, anios: f.anios.map((a) => (a.avisos.includes("revision_cola_larga") ? { ...a, decidido: a.propuesto, origen: "propuesta" as const } : a)) }));
    expect(armarMatriz(decididas, { anio: Y }).resumen.filas_para_revision).toBe(0);
    expect(armarMatriz(decididas, { anio: Y, filtro: { solo: "para_revision" } }).nodos.filter((n) => n.nivel === "linea")).toEqual([]);
  });
});

describe("la explicación de una fila para revisión", () => {
  const s = calcular(lineaDenimValor(8));

  it("Y+1 no habla de la demanda corregida como propuesta: dice que la base de Y es la venta corregida por quiebres y que crece con (1 + g)", () => {
    const sig = reg(s, CV, Y + 1);
    expect(sig.explicacion).not.toContain("La propuesta es la venta corregida");
    expect(sig.explicacion).not.toContain("saldrían");
    expect(sig.explicacion).toContain("× (1 + 5.0 % crecimiento bruto del Resto, sin corregir por el Niño)");
    expect(sig.explicacion).toContain("La cifra de 2026 de esta fila es la venta corregida por quiebres de stock (144), no el avance normal");
  });

  it("si Javier decide Y, la base de Y+1 ya no es la venta corregida y la frase deja de decirlo", () => {
    const previas: PreviasCalculo = { filas: new Map([[`${CV}#${Y}`, decision({ decidido: 100, origen: "manual", propuesta_al_decidir: 144 })]]), tiendas: new Map() };
    const d = calcularProyeccion(entrada({ hechos: [...hechosBase(), ...lineaDenimValor(8)], previas }));
    expect(reg(d, CV, Y + 1).explicacion).not.toContain("venta corregida por quiebres");
  });

  it("con poco avance la referencia es la cifra por avance (V ÷ C_k), no el plan anterior; conserva plan_anterior y avance_bajo y la frase lo aclara", () => {
    const serie = [10, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const cierre = proponerCierre({ serie, k: 2, curva: PLANA, factoresMes: UNOS, umbralAvance: 0.3, planAnterior: 80 });
    expect(cierre).toMatchObject({ metodo: "plan_anterior", propuesto: 80 });
    const porAvance = cierre.referencia_alternativa; // 20 ÷ (2/12) = 120
    expect(porAvance).toBe(120);
    const r = proponerPorDemandaCorregida({ cierre, resultado: { veredicto: "revision", demanda_corregida: 144 }, serie, k: 2, curva: PLANA, factoresMes: UNOS });
    expect(r).toMatchObject({ propuesto: 144, metodo: "avance", referencia_alternativa: 120 });
    expect(r.avisos).toContain("plan_anterior");
    // Sin poco avance (sin plan): la referencia es la propia cifra por avance del cierre.
    const normal = proponerCierre({ serie: [10, 10, 10, 10, 10, 10, 10, 10, 10, 0, 0, 0], k: 9, curva: PLANA, factoresMes: UNOS, umbralAvance: 0.3, planAnterior: null });
    expect(proponerPorDemandaCorregida({ cierre: normal, resultado: { veredicto: "revision", demanda_corregida: 150 }, serie: [10, 10, 10, 10, 10, 10, 10, 10, 10, 0, 0, 0], k: 9, curva: PLANA, factoresMes: UNOS }).referencia_alternativa).toBe(normal.propuesto);
    // Con otro veredicto no toca nada.
    expect(proponerPorDemandaCorregida({ cierre, resultado: { veredicto: "cierra", demanda_corregida: 144 }, serie, k: 2, curva: PLANA, factoresMes: UNOS })).toBe(cierre);
  });
});

describe("cifras fuera de rango (MAX_TOTAL): no tumban el cálculo", () => {
  it("A_f desbordado (casi ninguna tienda con stock entre un millón de tiendas) no es una medida: sin_dato y la propuesta sigue siendo la de avance", () => {
    const r = medir(dato(VENTANA, 1, 100), { n: 1_000_000_000 });
    expect(r).toMatchObject({ veredicto: "sin_dato", demanda_corregida: null, dispon: null });
    // Un A_f grande pero que cabe sigue siendo una medida.
    expect(medir(dato(VENTANA.slice(0, 9), 6, 8)).demanda_corregida).toBeCloseTo(144, 9);
    expect(Number.isFinite(medir(dato(VENTANA, 1, 1), { n: 1e300 }).tienda_meses)).toBe(true);
  });

  it("proponerFilaTienda: unidades maduras que desbordan (o no son finitas) → sin cifra, aviso cifra_excesiva y referencias descartadas", () => {
    const base = { esAnioEnCurso: false, k: 0, subbloque: "aperturas" as const, nCompletos: 0, real: Array(12).fill(0), curva: PLANA, rampa: UNOS, phi: UNOS, maduroPrevio: null, crecimiento: 0 };
    for (const maduras of [1e12, Infinity, Number.NaN]) {
      const r = proponerFilaTienda({ ...base, maduras });
      expect(r).toMatchObject({ propuesto: null, metodo: "sin_propuesta" });
      expect(r.avisos).toContain("cifra_excesiva");
    }
    const ok = proponerFilaTienda({ ...base, maduras: 1200 });
    expect(ok).toMatchObject({ propuesto: 1200, metodo: "apertura" });
    expect(ok.avisos).not.toContain("cifra_excesiva");
    expect(unidadesMadurasEntero(1e12)).toBeNull();
    expect(unidadesMadurasEntero(Infinity)).toBeNull();
    expect(unidadesMadurasEntero(1234.6)).toBe(1235);
  });

  it("una venta esperada absurda (1e18) deja la tienda sin cifra con cifra_excesiva, sin unidades maduras ni propuestas fuera de rango, y el resto del cálculo sigue", () => {
    const s = calcularProyeccion(entrada({ tiendasExtra: { T4: { venta_esperada: 1e18 } } }));
    const t = s.tiendas.find((x) => x.tienda_id === "T4" && x.anio === Y + 1)!;
    expect(t.propuesto).toBeNull();
    expect(t.unidades_maduras).toBeNull();
    expect(t.avisos).toContain("cifra_excesiva");
    for (const f of s.filas) for (const r of f.registros) {
      for (const v of [r.propuesto, r.vigente, r.referencia_alternativa, r.referencia_tres_meses]) if (v !== null) expect(Number.isInteger(v) && v <= MAX_TOTAL).toBe(true);
    }
    // El resto de las filas no se afecta.
    expect(reg(s, clave("denim", AM.rec), Y).propuesto).toBe(1800);
  });
});

describe("resumen: los conteos son un reflejo de lo decidido", () => {
  const s = calcular(lineaDenimValor(8));
  const comoFilas = (f: readonly FilaModelo[]) => f.map((x) => ({ clave: x.clave, tienda_id: x.tienda_id, registros: x.registros }));

  it("conteosResumen coincide con el resumen del cálculo y cambia al decidir (decididas y filas_para_revision)", () => {
    const c = conteosResumen(comoFilas(s.filas), Y);
    expect(c.decididas).toEqual(s.resumen.decididas);
    expect(c.filas_para_revision).toBe(s.resumen.filas_para_revision);
    expect(c.totales).toEqual(s.resumen.totales);
    const ctx: ContextoModelo = { anio: Y, k: 9, crecimiento_pct_defecto: 5, umbral_cola_larga: 100, rampa_maduracion: [1, 1, 1], nombresCurva: new Map(), mismasSiguiente: new Set(), tiendas: new Map() };
    const decidida = aplicarDecision(aplicarDecision(fila(s, CV), [], Y, { decidido: 0, origen: "propuesta" }, ctx), [], Y + 1, { decidido: 0, origen: "propuesta" }, ctx);
    const despues = conteosResumen(comoFilas(s.filas.map((f) => (f.clave === CV ? decidida : f))), Y);
    expect(despues.filas_para_revision).toBe(0);
    expect(despues.decididas[Y]).toBe(c.decididas[Y] + 1);
    expect(despues.decididas[Y + 1]).toBe(c.decididas[Y + 1] + 1);
  });
});

describe("decisiones sobre una fila de revisión", () => {
  const s = calcular(lineaDenimValor(8));
  const ctx: ContextoModelo = {
    anio: Y,
    k: 9,
    crecimiento_pct_defecto: 5,
    umbral_cola_larga: 100,
    rampa_maduracion: [1, 1, 1],
    nombresCurva: new Map(),
    mismasSiguiente: new Set(["T1", "T6", "T2"]),
    tiendas: new Map(),
  };

  it("aceptar la propuesta (A_f) o escribir otra cifra conserva el veredicto; la de Y+1 sigue heredándolo", () => {
    const f = fila(s, CV);
    const acepta = aplicarDecision(f, [], Y, { decidido: 0, origen: "propuesta" }, ctx);
    expect(registroDe(acepta, Y)).toMatchObject({ decidido: 144, origen: "propuesta" });
    expect(registroDe(acepta, Y)?.avisos).toContain("revision_cola_larga");
    expect(registroDe(acepta, Y + 1)?.avisos).toContain("revision_cola_larga");
    const otra = aplicarDecision(f, [], Y, { decidido: 90, origen: "manual", nota: "Esa línea no se repone" }, ctx);
    expect(registroDe(otra, Y)).toMatchObject({ decidido: 90, propuesto: 144 });
    // No se pierde el detalle de disponibilidad guardado en el histórico.
    expect(otra.historico?.cola_larga?.veredicto).toBe("revision");
    // Y+1 se rehace sobre la cifra decidida de Y (90 × 1,05 = 94,5 → 95, bajo el umbral) y hereda el veredicto.
    const sig = recalcularBaseSiguiente(otra, [], ctx);
    expect(registroDe(sig, Y + 1)?.propuesto).toBe(95);
    expect(registroDe(sig, Y + 1)?.avisos).toContain("revision_cola_larga");
  });
});

describe("version_metodo: la proyección calculada con un método anterior queda desactualizada (0.10.1)", () => {
  const salida = calcularProyeccion(entrada());
  const p = (version: number | undefined): ProyeccionParaEstado => ({
    calculado_at: "2026-10-01T12:00:00.000Z",
    hasta_periodo: "2026-09-01",
    resumen: { curvas_usadas: salida.resumen.curvas_usadas, ...(version === undefined ? {} : { version_metodo: version }) },
    parametros: { factores_usados: [{ anio: 2026, temporada: "invierno", ratio: 0.66, origen: "calculado" }, { anio: 2026, temporada: "verano", ratio: 1.24, origen: "calculado" }], bloques: salida.bloques },
  });
  const actual: EstadoActual = {
    cargas_publicadas: [{ periodo: "2026-09-01", publicada_at: "2026-09-28T10:00:00.000Z" }],
    ultimo_mes_cerrado: "2026-09",
    curvas_vigentes: salida.resumen.curvas_usadas.map((c) => ({ agrupacion_id: c.agrupacion_id, curva_id: c.curva_id })),
    niveles_cambiados: 0,
    tiendas: tiendas(),
    factores: [
      { anio: 2026, temporada: "invierno", ratio_calculado: 0.66, ratio_aplicado: null },
      { anio: 2026, temporada: "verano", ratio_calculado: 1.24, ratio_aplicado: null },
    ],
    periodos_updated_at: "2026-09-01T00:00:00.000Z",
  };
  const codigos = (v: number | undefined) => motivosDesactualizada(p(v), actual).map((m) => m.codigo);

  it("version_metodo 2 → motivo version_metodo; la actual (4) → nada", () => {
    expect(salida.resumen.version_metodo).toBe(4);
    expect(codigos(2)).toEqual(["version_metodo"]);
    expect(codigos(salida.resumen.version_metodo)).toEqual([]);
    expect(codigos(undefined)).toEqual([]);
  });
});
