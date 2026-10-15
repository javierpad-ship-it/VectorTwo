import { describe, expect, it } from "vitest";
import { armarEstadoCurvas, avisoInactivaConCurva, conVenta, curvaDeRecomendada, propuestaDe, type AgrupacionLeida, type CorridaVista } from "@/lib/curvas/estado";
import { evaluarObsolescencia, type CorridaParaObsolescencia, type EstadoGlobalActual } from "@/lib/curvas/obsolescencia";
import { aniosDeCorrida } from "@/lib/curvas/anios";
import type { CorridaResumenApi, VigenteResumenApi } from "@/lib/curvas/tipos-api";
import { mesesAtipicos } from "@/lib/curvas/atipicos";
import { ABRIGO_ID, CONSTANTE_ID, PERIODOS_NINO, PUBLICADOS, T4, VERANO_ID, agrupacionDe, corridaFixture, entradaFixture, filasFixture, parametros, tiendasFixture } from "./curvas.fixture";
import { ventaPorTienda } from "@/lib/curvas/entrada";

const salida = corridaFixture("base");
const resumenCorrida: CorridaResumenApi = {
  id: "corrida-1",
  created_at: "2026-10-14T10:00:00Z",
  hasta_periodo: "2026-09",
  referencia: true,
  parametros: parametros(),
  usuario_nombre: "Javier",
  resumen: {
    ...salida.resumen,
    agregado: { filas_mv: 85385, refrescada_at: "2026-10-14T10:00:00Z", duracion_ms: 2000 },
    meses_publicados: { desde: "2023-01", hasta: "2026-09", faltantes: [] },
    unidades_sin_agrupacion: 1230,
    red_huella: "r",
    cargas: {},
    duracion_ms: 3000,
  },
};
const vista: CorridaVista = { resumen: resumenCorrida, resultado: salida.resultado, efecto_atipico: salida.efecto_atipico };

const agr = (id: string, nombre: string, temporada: AgrupacionLeida["temporada"], extra: Partial<AgrupacionLeida> = {}): AgrupacionLeida => ({
  id,
  nombre,
  codigo: nombre.slice(0, 3),
  activo: true,
  orden: 0,
  temporada,
  temporada_sugerida: null,
  generos: ["HOMBRE"],
  equivalencias_activas: 10,
  ...extra,
});
const AGRUPACIONES = [agr(VERANO_ID, "VERANO", "verano"), agr(ABRIGO_ID, "ABRIGO", "invierno"), agr(CONSTANTE_ID, "CONSTANTE", "todo_el_ano")];

const vigenteDe = (modelo: "A" | "B", curva: number[], origen: "propia" | "prestada" = "propia", eat: number | null = 10): VigenteResumenApi => ({
  id: "v1",
  version: 1,
  modelo,
  origen,
  recomendada: true,
  eat,
  aprobada_at: "2026-10-14T10:00:00Z",
  usuario_nombre: "Javier",
  corrida_id: "corrida-0",
  curva,
});

const base = {
  datos: { desde: "2023-01", hasta: "2026-09", meses_publicados: 45, faltantes: [], ultimo_mes_cerrado: "2026-09" },
  corridas: [],
  periodos: [],
};

describe("armarEstadoCurvas", () => {
  it("sin corrida: sin propuesta, sin venta conocida y resumen en cero salvo temporadas", () => {
    const e = armarEstadoCurvas({ ...base, corrida: null, agrupaciones: AGRUPACIONES, vigentes: new Map(), obsoletas: new Map() });
    expect(e.corrida).toBeNull();
    expect(e.agrupaciones.every((a) => a.propuesta === null && !a.con_venta)).toBe(true);
    expect(e.resumen).toMatchObject({
      agrupaciones_activas: 3,
      por_temporada: { invierno: 1, verano: 1, todo_el_ano: 1 },
      sin_revisar_toda_temporada: 1,
      con_curva_vigente: 0,
      sin_curva_con_venta: 0,
      sin_venta: 0,
      unidades_sin_agrupacion: 0,
    });
  });
  it("con corrida: propuesta por agrupación, resumen y unidades sin agrupación del resumen de la corrida", () => {
    const e = armarEstadoCurvas({ ...base, corrida: vista, agrupaciones: AGRUPACIONES, vigentes: new Map(), obsoletas: new Map() });
    expect(e.corrida?.id).toBe("corrida-1");
    const abrigo = e.agrupaciones.find((a) => a.id === ABRIGO_ID)!;
    expect(abrigo).toMatchObject({ con_venta: true, vigente: null, obsoleta: null });
    expect(abrigo.propuesta).toMatchObject({ recomendada: "A", motivo_recomendacion: "menor_error", origen: "propia", corrida_id: "corrida-1" });
    expect(abrigo.propuesta?.curva).toHaveLength(12);
    expect(abrigo.propuesta?.anios.map((a) => a.anio)).toEqual([2023, 2024, 2025, 2026]);
    expect(abrigo.propuesta?.nino.volumen.map((v) => v.anio)).toEqual([2023, 2026]);
    expect(abrigo.propuesta?.nino.forma).toMatchObject({ veredicto: "forma_estable" });
    expect(e.resumen).toMatchObject({ sin_curva_con_venta: 3, con_curva_vigente: 0, unidades_sin_agrupacion: 1230 });
    expect(e.resumen.forma.forma_estable + e.resumen.forma.forma_cambia + e.resumen.forma.sin_comparacion).toBe(2);
  });
  it("ordena por orden y nombre, con las inactivas con curva al final y las inactivas sin curva fuera", () => {
    const inactiva = agr("zz", "INACTIVA", "verano", { activo: false });
    const inactivaSinCurva = agr("yy", "VIEJA", "verano", { activo: false });
    const e = armarEstadoCurvas({
      ...base,
      corrida: null,
      agrupaciones: [inactiva, inactivaSinCurva, ...AGRUPACIONES],
      vigentes: new Map([["zz", vigenteDe("A", Array(12).fill(1 / 12))]]),
      obsoletas: new Map(),
    });
    expect(e.agrupaciones.map((a) => a.nombre)).toEqual(["ABRIGO", "CONSTANTE", "VERANO", "INACTIVA"]);
    expect(e.resumen.inactivas_con_curva).toBe(1);
    expect(e.resumen.agrupaciones_activas).toBe(3);
    expect(avisoInactivaConCurva(false, true)).toBe(true);
    expect(avisoInactivaConCurva(true, true)).toBe(false);
    expect(avisoInactivaConCurva(false, false)).toBe(false);
  });
  it("vigente + propuesta: difiere_de_vigente y eat_vs_vigente; obsoleta con motivos", () => {
    const propuesta = propuestaDe("c", agrupacionDe(salida, ABRIGO_ID), null, null).curva!;
    const distinta = propuesta.map((v, m) => (m === 0 ? v + 0.03 : m === 1 ? v - 0.03 : v));
    const e = armarEstadoCurvas({
      ...base,
      corrida: vista,
      agrupaciones: AGRUPACIONES,
      vigentes: new Map([
        [ABRIGO_ID, vigenteDe("A", distinta)],
        [
          VERANO_ID,
          (() => {
            const a = agrupacionDe(salida, VERANO_ID).candidatas.find((c) => c.modelo === "A")!;
            return vigenteDe("A", a.curva!, "propia", a.eat);
          })(),
        ],
      ]),
      obsoletas: new Map([[ABRIGO_ID, [{ codigo: "tienda_entra_red", detalle: "la tienda T3 entra en la red de 2026" }]]]),
    });
    const abrigo = e.agrupaciones.find((a) => a.id === ABRIGO_ID)!;
    expect(abrigo.propuesta?.difiere_de_vigente).toBe(true);
    expect(abrigo.propuesta?.eat_vs_vigente).toBeCloseTo(6, 4);
    expect(abrigo.obsoleta?.motivos[0].codigo).toBe("tienda_entra_red");
    const verano = e.agrupaciones.find((a) => a.id === VERANO_ID)!;
    expect(verano.propuesta?.difiere_de_vigente).toBe(false);
    expect(verano.obsoleta).toBeNull();
    expect(e.resumen).toMatchObject({ con_curva_vigente: 2, obsoletas: 1, propuestas_distintas: 1, sin_curva_con_venta: 1 });
  });
  it("vigente prestada se cuenta aparte", () => {
    const e = armarEstadoCurvas({
      ...base,
      corrida: vista,
      agrupaciones: AGRUPACIONES,
      vigentes: new Map([[CONSTANTE_ID, vigenteDe("A", Array(12).fill(1 / 12), "prestada")]]),
      obsoletas: new Map(),
    });
    expect(e.resumen.vigentes_prestadas).toBe(1);
  });
  it("conVenta y curvaDeRecomendada", () => {
    expect(conVenta(agrupacionDe(salida, ABRIGO_ID))).toBe(true);
    expect(conVenta(undefined)).toBe(false);
    const a = agrupacionDe(salida, ABRIGO_ID);
    expect(curvaDeRecomendada(a, null)).toEqual(a.candidatas.find((c) => c.modelo === "A")?.curva);
    expect(curvaDeRecomendada({ ...a, recomendada: "T" }, { curva_T: [1] })).toEqual([1]);
    expect(curvaDeRecomendada({ ...a, recomendada: null }, null)).toBeNull();
  });
});

describe("evaluarObsolescencia (varias curvas contra el estado de hoy)", () => {
  const entrada = entradaFixture("base");
  const corrida: CorridaParaObsolescencia = {
    id: "c1",
    hasta_periodo: "2026-09",
    parametros: parametros(),
    red_comparable: entrada.redes,
    cargas: Object.fromEntries(PUBLICADOS.map((m) => [m, `carga-${m}`])),
    resultado: salida.resultado,
  };
  const curvas = [ABRIGO_ID, VERANO_ID].map((id) => ({ agrupacion_id: id, corrida_id: "c1", composicion: { equivalencias: 10, huella: `huella-${id}` } }));
  const estado = (extra: Partial<EstadoGlobalActual> = {}): EstadoGlobalActual => ({
    tiendas: tiendasFixture(),
    venta: ventaPorTienda(filasFixture("base")),
    cargas: corrida.cargas,
    periodos: PERIODOS_NINO,
    agrupaciones: new Map([
      [ABRIGO_ID, { temporada: "invierno", equivalencias: 10, huella: `huella-${ABRIGO_ID}` }],
      [VERANO_ID, { temporada: "verano", equivalencias: 10, huella: `huella-${VERANO_ID}` }],
    ]),
    hasta_actual: "2026-09",
    ...extra,
  });
  const mapa = new Map([["c1", corrida]]);

  it("sin cambios: ninguna curva obsoleta (los periodos, la red, las cargas y la composición coinciden)", () => {
    const r = evaluarObsolescencia(curvas, mapa, estado());
    expect(r.get(ABRIGO_ID)).toEqual([]);
    expect(r.get(VERANO_ID)).toEqual([]);
  });
  it("cada cambio marca solo lo que afecta: un periodo de invierno no toca a verano; una equivalencia, solo a su agrupación", () => {
    const sinNino2023 = PERIODOS_NINO.filter((p) => p.id !== "nino-2023-inv");
    const r = evaluarObsolescencia(curvas, mapa, estado({ periodos: sinNino2023 }));
    expect(r.get(ABRIGO_ID)?.map((m) => m.codigo)).toEqual(["periodo_cambiado"]);
    expect(r.get(VERANO_ID)).toEqual([]);

    const agrupaciones = new Map([
      [ABRIGO_ID, { temporada: "invierno" as const, equivalencias: 11, huella: "nueva" }],
      [VERANO_ID, { temporada: "verano" as const, equivalencias: 10, huella: `huella-${VERANO_ID}` }],
    ]);
    const c = evaluarObsolescencia(curvas, mapa, estado({ agrupaciones }));
    expect(c.get(ABRIGO_ID)?.map((m) => m.codigo)).toEqual(["composicion_cambiada"]);
    expect(c.get(VERANO_ID)).toEqual([]);
  });
  it("una tienda corregida (T4 abre en 2024-03) y un mes nuevo marcan ambas curvas con su motivo", () => {
    const tiendas = tiendasFixture().map((t) => (t.id === T4 ? { ...t, fecha_apertura: "2024-03-01" } : t));
    const r = evaluarObsolescencia(curvas, mapa, estado({ tiendas, cargas: { ...corrida.cargas, "2026-10": "nueva" } }));
    for (const id of [ABRIGO_ID, VERANO_ID]) {
      expect(r.get(id)?.map((m) => m.codigo).sort()).toEqual(["carga_nueva", "tienda_sale_red"]);
    }
  });
  it("el cambio de temporada no se cuenta también como periodo cambiado", () => {
    const agrupaciones = new Map([
      [ABRIGO_ID, { temporada: "todo_el_ano" as const, equivalencias: 10, huella: `huella-${ABRIGO_ID}` }],
      [VERANO_ID, { temporada: "verano" as const, equivalencias: 10, huella: `huella-${VERANO_ID}` }],
    ]);
    const r = evaluarObsolescencia(curvas, mapa, estado({ agrupaciones }));
    expect(r.get(ABRIGO_ID)?.map((m) => m.codigo)).toEqual(["temporada_cambiada"]);
  });
  it("una curva sin su corrida (o sin su agrupación) no se evalúa", () => {
    const r = evaluarObsolescencia([{ agrupacion_id: ABRIGO_ID, corrida_id: "borrada", composicion: null }], mapa, estado());
    expect(r.has(ABRIGO_ID)).toBe(false);
    expect(aniosDeCorrida(PUBLICADOS, "2026-09")).toHaveLength(4);
    expect(mesesAtipicos(PERIODOS_NINO, { temporada: "invierno" }).size).toBeGreaterThan(0);
  });
});
