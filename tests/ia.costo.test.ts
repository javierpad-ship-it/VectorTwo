import { describe, expect, it } from "vitest";
import { armarBloquesGM } from "@/lib/ia/entrada";
import {
  costoUsd,
  estimarCorrida,
  estimarGM,
  estimarUsoLlamada,
  motivoDetencion,
  motivoNoArranca,
  redondearUsd,
  tokensDeBytes,
  MARGEN_ESTIMACION,
  TOKENS_SISTEMA,
} from "@/lib/ia/costo";
import type { PreciosIa } from "@/lib/ia/tipos-api";
import { datosGrandes, TERMINOS_J } from "./ia.fixture";
import { ProveedorFalso, USO_BASE, valida } from "./ia.proveedor-falso";

/** R14 (ficha 07e, §3.9 y ejemplo G): costo de una llamada, estimación y topes. */

const PRECIOS: PreciosIa = { entrada: 3, salida: 15, cache_escritura: 3.75, cache_lectura: 0.3 };

describe("R14 · ejemplo G", () => {
  it("4 200 de entrada, 5 400 de lectura de caché y 1 900 de salida → US$ 0,0427", () => {
    const c = costoUsd({ entrada: 4200, salida: 1900, cache_escritura: 0, cache_lectura: 5400 }, PRECIOS);
    expect(c).toBeCloseTo(0.04272, 6);
    expect(redondearUsd(c)).toBe(0.0427);
  });
  it("cada tipo de token usa su precio", () => {
    expect(costoUsd({ entrada: 1e6, salida: 0, cache_escritura: 0, cache_lectura: 0 }, PRECIOS)).toBe(3);
    expect(costoUsd({ entrada: 0, salida: 1e6, cache_escritura: 0, cache_lectura: 0 }, PRECIOS)).toBe(15);
    expect(costoUsd({ entrada: 0, salida: 0, cache_escritura: 1e6, cache_lectura: 0 }, PRECIOS)).toBe(3.75);
    expect(costoUsd({ entrada: 0, salida: 0, cache_escritura: 0, cache_lectura: 1e6 }, PRECIOS)).toBe(0.3);
    expect(costoUsd({ entrada: 0, salida: 0, cache_escritura: 0, cache_lectura: 0 }, PRECIOS)).toBe(0);
  });
});

describe("R14 · estimación", () => {
  it("tokens = ⌈bytes ÷ 3⌉", () => {
    expect(tokensDeBytes(300)).toBe(100);
    expect(tokensDeBytes(301)).toBe(101);
    expect(tokensDeBytes(0)).toBe(0);
  });

  it("la salida de una llamada: 85 por fila (natural) + 110 por fila (reparto) + 150 por llamada", () => {
    expect(estimarUsoLlamada({ tipo: "natural", tokens_bloque: 1000, filas_libres: 20, sistema_en_cache: true }).salida).toBe(85 * 20 + 150);
    expect(estimarUsoLlamada({ tipo: "reparto", tokens_bloque: 1000, filas_libres: 20 }).salida).toBe(110 * 20 + 150);
  });

  it("la natural escribe el bloque en caché y la de reparto lo lee; el sistema se escribe una sola vez por corrida", () => {
    const primera = estimarUsoLlamada({ tipo: "natural", tokens_bloque: 1000, filas_libres: 5, sistema_en_cache: false });
    const siguiente = estimarUsoLlamada({ tipo: "natural", tokens_bloque: 1000, filas_libres: 5, sistema_en_cache: true });
    expect(primera.cache_escritura).toBe(1000 + TOKENS_SISTEMA);
    expect(siguiente.cache_escritura).toBe(1000);
    expect(siguiente.cache_lectura).toBe(TOKENS_SISTEMA);
    expect(estimarUsoLlamada({ tipo: "reparto", tokens_bloque: 1000, filas_libres: 5 }).cache_lectura).toBe(1000 + TOKENS_SISTEMA);
  });

  it("un GM directo son 2 llamadas; uno jerárquico de k lotes, 2k + 1; un GM reusable no cuesta nada", () => {
    expect(estimarGM({ lotes: [{ bytes_bloque: 30000, filas_libres: 22 }] }, PRECIOS).llamadas).toBe(2);
    expect(estimarGM({ lotes: [{ bytes_bloque: 30000, filas_libres: 60 }, { bytes_bloque: 9000, filas_libres: 20 }], lineas: { bytes: 2000, lineas: 5 } }, PRECIOS).llamadas).toBe(5);
    expect(estimarGM({ lotes: [{ bytes_bloque: 30000, filas_libres: 22 }], reusable: true }, PRECIOS)).toEqual({ llamadas: 0, uso: { entrada: 0, salida: 0, cache_escritura: 0, cache_lectura: 0 }, costo_usd: 0 });
  });

  it("la estimación (con margen) nunca queda por debajo de lo que reporta el proveedor falso", async () => {
    // Un GM de 22 filas libres: la estimación se hace sobre el bloque armado de verdad y se compara con el uso que reporta el falso en sus dos llamadas.
    const r = armarBloquesGM(datosGrandes(22, 2), { terminos: TERMINOS_J });
    if (!r.ok) throw new Error("bloqueado");
    const lote = r.lotes[0];
    const proveedor = new ProveedorFalso([valida({}), valida({})]);
    const usos = [await proveedor.llamar({} as never), await proveedor.llamar({} as never)];
    const gastoFalso = usos.reduce((a, u) => a + costoUsd(u.uso, PRECIOS), 0);
    const e = estimarCorrida([{ lotes: [{ bytes_bloque: lote.bytes, filas_libres: lote.filas_libres.length }] }], PRECIOS, 10);
    expect(e.costo_usd).toBeGreaterThanOrEqual(redondearUsd(gastoFalso));
    expect(e.llamadas).toBe(2);
    expect(e.filas).toBe(22);
    expect(e.gms).toBe(1);
    expect(USO_BASE.salida).toBeLessThan(e.tokens_salida);
  });

  it("estimarCorrida suma los GM con el margen de 1,2 y deja fuera los reusables", () => {
    const gm = { lotes: [{ bytes_bloque: 30000, filas_libres: 22 }] };
    const uno = estimarCorrida([gm], PRECIOS, 10);
    const tres = estimarCorrida([gm, gm, { ...gm, reusable: true }], PRECIOS, 10);
    expect(uno.costo_usd).toBeCloseTo(redondearUsd(estimarGM(gm, PRECIOS).costo_usd * MARGEN_ESTIMACION), 4);
    expect(tres.gms).toBe(2);
    expect(tres.reusables).toBe(1);
    expect(tres.llamadas).toBe(4);
    // El texto fijo del sistema se escribe una vez en la corrida: dos GM salen más baratos que el doble de uno.
    expect(tres.costo_usd).toBeLessThan(uno.costo_usd * 2);
    expect(tres.tope_usd).toBe(10);
  });
});

describe("R14 · topes", () => {
  const topes = { tope_usd_corrida: 10, restante_mes_usd: 8, restante_dia_usuario_usd: 5 };

  it("la corrida no arranca si la estimación pasa del tope de la corrida, del mes que queda o del día del usuario", () => {
    expect(motivoNoArranca(3.6, topes)).toBeNull();
    expect(motivoNoArranca(5, topes)).toBeNull();
    expect(motivoNoArranca(5.01, topes)).toBe("tope_dia");
    expect(motivoNoArranca(8.01, { ...topes, restante_dia_usuario_usd: 100 })).toBe("tope_mensual");
    expect(motivoNoArranca(10.01, { ...topes, restante_mes_usd: 100, restante_dia_usuario_usd: 100 })).toBe("tope_corrida");
  });

  it("se detiene antes de la llamada que pasaría de un tope (gasto acumulado + estimación de esa llamada)", () => {
    const base = { gasto_corrida_usd: 9.9, estimacion_llamada_usd: 0.1, tope_usd_corrida: 10, gasto_mes_usd: 10, tope_usd_mes: 60, gasto_dia_usuario_usd: 2, tope_usd_dia_usuario: 15 };
    expect(motivoDetencion(base)).toBeNull();
    expect(motivoDetencion({ ...base, estimacion_llamada_usd: 0.11 })).toBe("tope_corrida");
    expect(motivoDetencion({ ...base, gasto_mes_usd: 59.95, estimacion_llamada_usd: 0.06 })).toBe("tope_mensual");
    expect(motivoDetencion({ ...base, gasto_dia_usuario_usd: 14.95, estimacion_llamada_usd: 0.06 })).toBe("tope_dia");
  });

  it("no hay errores de coma flotante en el límite exacto", () => {
    expect(motivoDetencion({ gasto_corrida_usd: 0.1 + 0.2, estimacion_llamada_usd: 0.7, tope_usd_corrida: 1, gasto_mes_usd: 0, tope_usd_mes: 60, gasto_dia_usuario_usd: 0, tope_usd_dia_usuario: 15 })).toBeNull();
  });
});
