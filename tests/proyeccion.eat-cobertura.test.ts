import { describe, expect, it } from "vitest";
import { calcularProyeccion } from "@/lib/proyeccion/modelo";
import { eatM6ConCobertura, eatM6DeLinea } from "@/lib/proyeccion/calculo";
import type { FilaModelo, SalidaCalculo } from "@/lib/proyeccion/tipos";
import { AG, AM, clave, entrada, vigentes } from "./proyeccion.fixture";

/**
 * 06c · cambio mínimo de M7 (regla 77): `eat_m6_cobertura` (peso de la unidad cuyas agrupaciones traen
 * backtesting de M6, 0 a 1) y `eat_m6 = null` si es menor que 1 ("sin backtesting (cubre 70 %)"). Una curva del
 * usuario (`U`) no tiene candidata en la foto, así que no trae `eat_por_pliegue`.
 */

const fila = (s: SalidaCalculo, c: string): FilaModelo => {
  const f = s.filas.find((x) => x.clave === c);
  if (!f) throw new Error(`No existe la fila ${c}`);
  return f;
};
const prueba = (s: SalidaCalculo, c: string) => fila(s, c).historico?.prueba_anterior ?? null;

describe("eatM6DeLinea (hallazgo de QA 06c: el EAT de la línea no se muestra con cobertura parcial)", () => {
  it("una fila con U (cobertura 0) y otra con T (cobertura 1): eat null y cobertura = peso de la que sí tiene", () => {
    const r = eatM6DeLinea([
      { real: 840, eat_m6: null, eat_m6_cobertura: 0 },
      { real: 160, eat_m6: 1.02, eat_m6_cobertura: 1 },
    ]);
    expect(r.eat_m6).toBeNull();
    expect(r.cobertura).toBeCloseTo(0.16, 10);
  });
  it("todas con pliegue: promedio y cobertura 1", () => {
    const r = eatM6DeLinea([
      { real: 500, eat_m6: 2, eat_m6_cobertura: 1 },
      { real: 500, eat_m6: 4, eat_m6_cobertura: 1 },
    ]);
    expect(r.eat_m6).toBeCloseTo(3, 10);
    expect(r.cobertura).toBeCloseTo(1, 10);
  });
  it("filas guardadas antes de la cobertura: cubren por completo si traen EAT y nada si no", () => {
    expect(eatM6DeLinea([{ real: 100, eat_m6: 5 }]).eat_m6).toBe(5);
    expect(eatM6DeLinea([{ real: 100, eat_m6: 5 }, { real: 100, eat_m6: null }]).eat_m6).toBeNull();
  });
  it("sin filas: eat null y cobertura 0", () => {
    expect(eatM6DeLinea([])).toEqual({ eat_m6: null, cobertura: 0 });
  });
});

describe("eatM6ConCobertura (pura)", () => {
  const v = (...eats: (number | null)[]) => new Map(eats.map((e, i) => [`a${i}`, e === null ? {} : { eat_por_pliegue: [{ anio: 2025, eat: e }] }]));
  it("todas con pliegue: promedio ponderado y cobertura 1", () => {
    const r = eatM6ConCobertura([{ agrupacion_id: "a0", peso: 0.7 }, { agrupacion_id: "a1", peso: 0.3 }], v(10, 20), 2025);
    expect(r.eat).toBeCloseTo(13, 9);
    expect(r.cobertura).toBeCloseTo(1, 9);
  });
  it("una sin pliegue (curva del usuario): eat null y cobertura = su peso complementario (0.7)", () => {
    const r = eatM6ConCobertura([{ agrupacion_id: "a0", peso: 0.7 }, { agrupacion_id: "a1", peso: 0.3 }], v(10, null), 2025);
    expect(r.eat).toBeNull();
    expect(r.cobertura).toBeCloseTo(0.7, 9);
  });
  it("ninguna con pliegue → eat null y cobertura 0; sin agrupaciones → 0", () => {
    expect(eatM6ConCobertura([{ agrupacion_id: "a0", peso: 1 }], v(null), 2025)).toEqual({ eat: null, cobertura: 0 });
    expect(eatM6ConCobertura([], v(), 2025)).toEqual({ eat: null, cobertura: 0 });
  });
  it("el pliegue tiene que ser del año pedido", () => {
    expect(eatM6ConCobertura([{ agrupacion_id: "a0", peso: 1 }], v(10), 2024)).toEqual({ eat: null, cobertura: 0 });
  });
  it("una agrupación única con pliegue: cobertura 1 aunque los pesos sumen 1 - 1e-12", () => {
    const r = eatM6ConCobertura([{ agrupacion_id: "a0", peso: 1 - 1e-12 }], v(9.8), 2025);
    expect(r.eat).toBeCloseTo(9.8, 6);
    expect(r.cobertura).toBeCloseTo(1, 9);
  });
});

describe("en el cálculo de M7", () => {
  const MIXTA = clave("mixta", AM.rec);
  const DENIM = clave("denim", AM.rec);
  const con = (pliegues: Record<string, number | null>) =>
    vigentes().map((x) => ({ ...x, eat_por_pliegue: x.agrupacion_id in pliegues && pliegues[x.agrupacion_id] !== null ? [{ anio: 2025, eat: pliegues[x.agrupacion_id] as number }] : undefined }));

  it("unidad con una sola agrupación con backtesting: eat_m6 9.8 y cobertura 1 (como hoy)", () => {
    const s = calcularProyeccion(entrada());
    expect(prueba(s, DENIM)).toMatchObject({ eat_m6: 9.8, eat_m6_cobertura: 1 });
  });
  it("una unidad con dos agrupaciones (pesos 0.8 y 0.2), la de 0.8 con pliegue y la de 0.2 sin él (curva del usuario): eat_m6 null y cobertura 0.8", () => {
    const s = calcularProyeccion(entrada({ vigentes: con({ [AG.inv]: 12, [AG.ver]: null }) }));
    const p = prueba(s, MIXTA);
    expect(p?.eat_m6).toBeNull();
    expect(p?.eat_m6_cobertura).toBeCloseTo(0.8, 9);
  });
  it("con las dos agrupaciones con pliegue, el promedio ponderado como hoy y cobertura 1", () => {
    const s = calcularProyeccion(entrada({ vigentes: con({ [AG.inv]: 10, [AG.ver]: 20 }) }));
    const p = prueba(s, MIXTA);
    expect(p?.eat_m6_cobertura).toBeCloseTo(1, 9);
    expect(p?.eat_m6).toBeCloseTo(0.8 * 10 + 0.2 * 20, 6);
  });
  it("una unidad cuya única agrupación tiene una curva del usuario: sin backtesting y cobertura 0", () => {
    const s = calcularProyeccion(entrada({ vigentes: con({ [AG.denim]: null }) }));
    expect(prueba(s, DENIM)).toMatchObject({ eat_m6: null, eat_m6_cobertura: 0 });
  });
});

describe("leerVigentesProy con curvas F, T y U (regla 77)", () => {
  const ids = { u: "00000000-0000-4000-8000-0000000000a1", f: "00000000-0000-4000-8000-0000000000a2", t: "00000000-0000-4000-8000-0000000000a3" };
  const curvaFila = (id: string, modelo: string, corrida: string, extra: Record<string, unknown> = {}) => ({
    id: `curva-${modelo}`,
    agrupacion_estacionalidad_id: id,
    version: 3,
    estado: "vigente",
    corrida_id: corrida,
    modelo,
    origen: modelo === "T" ? "prestada" : "propia",
    origen_curva: modelo === "U" ? "usuario" : modelo === "F" ? "avanzada" : "sistema",
    curva_manual: null,
    ...Object.fromEntries(["p01", "p02", "p03", "p04", "p05", "p06", "p07", "p08", "p09", "p10", "p11", "p12"].map((k) => [k, 1 / 12])),
    ...extra,
  });
  const foto = (id: string, candidatas: unknown[]) => ({ id: `foto-${id}`, resultado: { agrupaciones: [{ agrupacion_id: id, candidatas }], temporadas: [] } });
  const pliegue = [{ anio: 2025, eat: 7.5, error_max: 1 }];

  it("una U no trae eat_por_pliegue (sin candidata U en la foto); F y T sí, el de su candidata", async () => {
    const { estadoFalso } = await import("./curvas.fake-db");
    const { clienteFalso } = await import("./curvas.fake-db");
    const { leerVigentesProy } = await import("@/lib/proyeccion/contexto");
    estadoFalso.tablas = {
      curvas_estacionalidad: [
        curvaFila(ids.u, "U", `foto-${ids.u}`, { curva_manual: { valores_ingresados: Array(12).fill(1) } }),
        curvaFila(ids.f, "F", `foto-${ids.f}`),
        curvaFila(ids.t, "T", `foto-${ids.t}`),
      ],
      corridas_estacionalidad: [
        // La foto de una U trae las candidatas tal cual salieron (sin U): M7 no encuentra la suya.
        foto(ids.u, [{ modelo: "A", eat_por_pliegue: pliegue }, { modelo: "F", eat_por_pliegue: pliegue }]),
        foto(ids.f, [{ modelo: "A", eat_por_pliegue: [{ anio: 2025, eat: 1, error_max: 1 }] }, { modelo: "F", eat_por_pliegue: pliegue }]),
        foto(ids.t, [{ modelo: "T", eat_por_pliegue: [{ anio: 2025, eat: 4, error_max: 1 }] }]),
      ],
    };
    const r = await leerVigentesProy(clienteFalso() as never, true);
    expect(r.respuesta).toBeNull();
    const porId = new Map(r.data!.vigentes.map((v) => [v.agrupacion_id, v]));
    expect(porId.get(ids.u)).toMatchObject({ curva_id: "curva-U", version: 3 });
    expect(porId.get(ids.u)?.eat_por_pliegue).toBeUndefined();
    expect(porId.get(ids.u)?.curva).toHaveLength(12);
    expect(porId.get(ids.f)?.eat_por_pliegue).toEqual(pliegue);
    expect(porId.get(ids.t)?.eat_por_pliegue).toEqual([{ anio: 2025, eat: 4, error_max: 1 }]);
  });
});
