import { describe, expect, it } from "vitest";
import { curvaDeUsuario, curvaDesde, evaluarCurvaUsuario, motivoCurvaUsuarioInvalida, normalizarA100, parsearPegado } from "@/lib/curvas/curva-usuario";
import { aprobarCurvaSchema, curvaUsuarioSchema, partidaSchema } from "@/lib/curvas/esquemas";
import { PARAMETROS_POR_DEFECTO } from "@/lib/curvas/tipos-api";
import { sintInv } from "./curvas.composicion.fixture";

const USUARIO = [5, 5, 6, 8, 11, 14, 13, 12, 10, 7, 5, 4];

describe("regla 66 · parsearPegado", () => {
  const valores = (t: string) => {
    const r = parsearPegado(t);
    if (!r.ok) throw new Error(r.error);
    return r;
  };
  it("doce valores con tabulador → porcentaje", () => {
    const r = valores("5\t5\t6\t8\t11\t14\t13\t12\t10\t7\t5\t4");
    expect(r.valores).toEqual(USUARIO);
    expect([r.origen, r.aviso]).toEqual(["porcentaje", null]);
  });
  it("separados por espacios, saltos de línea o punto y coma", () => {
    expect(valores("5 5 6 8 11 14 13 12 10 7 5 4").valores).toEqual(USUARIO);
    expect(valores("5\n5\n6\n8\n11\n14\n13\n12\n10\n7\n5\n4\n").valores).toEqual(USUARIO);
    expect(valores("5;5;6;8;11;14;13;12;10;7;5;4").valores).toEqual(USUARIO);
    expect(valores("5\r\n5\r\n6\r\n8\r\n11\r\n14\r\n13\r\n12\r\n10\r\n7\r\n5\r\n4").valores).toEqual(USUARIO);
  });
  it("coma decimal con punto y coma y con espacios", () => {
    const esperado = [4.3, 4.4, 6.4, 8.3, 11.05, 14.65, 13.6, 11.65, 9.75, 6.9, 5, 4];
    expect(valores("4,3;4,4;6,4;8,3;11,05;14,65;13,6;11,65;9,75;6,9;5;4").valores).toEqual(esperado);
    expect(valores("4,3 4,4 6,4 8,3 11,05 14,65 13,6 11,65 9,75 6,9 5 4").valores).toEqual(esperado);
  });
  it("con % y saltos de línea", () => {
    expect(valores("4.3%\n4.4%\n6.4%\n8.3%\n11.05%\n14.65%\n13.6%\n11.65%\n9.75%\n6.9%\n5%\n4%").valores).toEqual([4.3, 4.4, 6.4, 8.3, 11.05, 14.65, 13.6, 11.65, 9.75, 6.9, 5, 4]);
  });
  it("doce valores con coma como separador: el decimal es el punto", () => {
    expect(valores("4.3,4.4,6.4,8.3,11.05,14.65,13.6,11.65,9.75,6.9,5,4").valores).toEqual([4.3, 4.4, 6.4, 8.3, 11.05, 14.65, 13.6, 11.65, 9.75, 6.9, 5, 4]);
    expect(valores("5, 5, 6, 8, 11, 14, 13, 12, 10, 7, 5, 4").valores).toEqual(USUARIO);
  });
  it("doce fracciones que suman 1 se multiplican por 100", () => {
    const r = valores("0.05\t0.05\t0.06\t0.08\t0.11\t0.14\t0.13\t0.12\t0.10\t0.07\t0.05\t0.04");
    expect(r.origen).toBe("fraccion");
    expect(r.valores).toEqual(USUARIO);
  });
  it("doce unidades (suma 1 000) se normalizan con aviso y origen unidades", () => {
    const r = valores("50\t50\t60\t80\t110\t140\t130\t120\t100\t70\t50\t40");
    expect(r.origen).toBe("unidades");
    expect(r.aviso).toMatch(/normalizaron a 100/);
    expect(r.valores.reduce((s, x) => s + x, 0)).toBeCloseTo(100, 2);
    expect(r.valores[0]).toBeCloseTo(5, 6);
  });
  it("una suma entre 99.5 y 100.5 se deja tal cual (el planner decide si normaliza)", () => {
    const r = valores("5 5 6 8 11 14 13 12 10 7 5 3.7");
    expect(r.origen).toBe("porcentaje");
    expect(r.valores[11]).toBe(3.7);
  });
  it("errores: once valores, sin números, un negativo, todo cero", () => {
    expect(parsearPegado("5\t5\t6\t8\t11\t14\t13\t12\t10\t7\t5")).toEqual({ ok: false, error: "Se esperaban 12 valores y llegaron 11." });
    expect(parsearPegado("5 5 6 8 11 14 13 12 10 7 5 4 4")).toEqual({ ok: false, error: "Se esperaban 12 valores y llegaron 13." });
    const sinNumeros = parsearPegado("enero febrero marzo");
    expect(sinNumeros.ok).toBe(false);
    expect(parsearPegado("").ok).toBe(false);
    const negativo = parsearPegado("5 5 6 8 11 14 13 12 10 7 5 -4");
    expect(negativo).toEqual({ ok: false, error: "Un mes no puede ser negativo." });
    expect(parsearPegado("0 0 0 0 0 0 0 0 0 0 0 0").ok).toBe(false);
  });
});

describe("regla 67 · normalizar y validar", () => {
  it("normalizarA100: [5,5,6,8,11,14,13,12,10,7,5,2] (98) → × 100/98 y suma 100 (± 1e-9)", () => {
    const r = normalizarA100([5, 5, 6, 8, 11, 14, 13, 12, 10, 7, 5, 2]);
    expect(r.reduce((s, x) => s + x, 0)).toBeCloseTo(100, 9);
    expect(r.map((x) => Math.round(x * 1000) / 1000)).toEqual([5.102, 5.102, 6.122, 8.163, 11.224, 14.286, 13.265, 12.245, 10.204, 7.143, 5.102, 2.041]);
  });
  it("todos ceros no cambia", () => {
    expect(normalizarA100(Array(12).fill(0))).toEqual(Array(12).fill(0));
  });
  it("curvaUsuarioSchema acepta 100 ± 0.05 y rechaza 99.9, un valor fuera de 0..100, once valores y todo ceros", () => {
    expect(curvaUsuarioSchema.safeParse(USUARIO).success).toBe(true);
    expect(curvaUsuarioSchema.safeParse([5.04, 5, 6, 8, 11, 14, 13, 12, 10, 7, 5, 4]).success).toBe(true);
    expect(curvaUsuarioSchema.safeParse([5, 5, 6, 8, 11, 14, 13, 12, 10, 7, 5, 3.9]).success).toBe(false);
    expect(curvaUsuarioSchema.safeParse([101, -1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]).success).toBe(false);
    expect(curvaUsuarioSchema.safeParse([105, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, -5]).success).toBe(false);
    expect(curvaUsuarioSchema.safeParse(USUARIO.slice(1)).success).toBe(false);
    expect(curvaUsuarioSchema.safeParse(Array(12).fill(0)).success).toBe(false);
    expect(curvaUsuarioSchema.safeParse([...USUARIO.slice(0, 11), "4"]).success).toBe(false);
  });
  it("motivoCurvaUsuarioInvalida dice lo mismo que el esquema", () => {
    expect(motivoCurvaUsuarioInvalida(USUARIO)).toBeNull();
    expect(motivoCurvaUsuarioInvalida(USUARIO.slice(1))).toBe("La curva debe tener doce meses.");
    expect(motivoCurvaUsuarioInvalida([...USUARIO.slice(0, 11), 3.9])).toBe("Los doce meses deben sumar 100 % (± 0.05).");
    expect(motivoCurvaUsuarioInvalida([...USUARIO.slice(0, 11), -4])).toBe("Un mes no puede ser negativo.");
    expect(motivoCurvaUsuarioInvalida(Array(12).fill(0))).toBe("Los doce meses deben sumar 100 % (± 0.05).");
    expect(motivoCurvaUsuarioInvalida([...Array(11).fill(0), 100.02])).toBe("Un mes no puede pasar de 100 %.");
    expect(motivoCurvaUsuarioInvalida([...Array(11).fill(0), 100])).toBeNull();
    expect(motivoCurvaUsuarioInvalida([...USUARIO.slice(0, 11), Number.NaN])).toBe("Cada mes debe ser un número.");
  });
  it("la curva guardada suma exactamente 1 con seis decimales (pasa el check de la 0015) — caso 37", () => {
    const c = curvaDeUsuario([5, 5, 6, 8, 11, 14, 13, 12, 10, 7, 5, 2].map((x) => (x * 100) / 98));
    expect(c.reduce((s, x) => s + x, 0)).toBeCloseTo(1, 12);
    expect(c.every((x) => Math.round(x * 1e6) === x * 1e6 || Math.abs(Math.round(x * 1e6) - x * 1e6) < 1e-6)).toBe(true);
    const u = curvaDeUsuario(USUARIO);
    expect([u[4], u[5]]).toEqual([0.11, 0.14]);
    expect(u.reduce((s, x) => s + Math.round(x * 1e6), 0)).toBe(1e6);
  });
});

describe("caso 38 / regla 68 · evaluarCurvaUsuario con SINT_INV", () => {
  const f = sintInv();
  const e = evaluarCurvaUsuario(USUARIO, f.resultado, f.temporada);
  it("EAT y error máximo por año de ajuste: 2024 4.6 (máx. 1.0) y 2025 5.8 (máx. 1.6); promedio 5.2 y error_max 1.3", () => {
    expect(e.eat_en_muestra_por_anio.map((x) => [x.anio, Math.round(x.eat * 100) / 100, Math.round(x.error_max * 100) / 100])).toEqual([[2024, 4.6, 1], [2025, 5.8, 1.6]]);
    expect(e.eat_en_muestra).toBeCloseTo(5.2, 6);
    expect(e.error_max_en_muestra).toBeCloseTo(1.3, 6);
    expect(e.ruido_normal).toBeCloseTo(3.8, 6);
    expect(e.en_muestra).toBe(true);
    expect(e.suma_ingresada).toBe(100);
  });
  it("la EAT parcial se mide sobre el año en curso (en muestra) y A no coincide", () => {
    expect(e.eat_parcial_en_muestra).not.toBeNull();
    expect(e.igual_a).toBeNull();
  });
  it("la A del sistema en el mismo fixture: EAT en muestra (1.9 + 1.9) ÷ 2 = 1.9", () => {
    const a = f.resultado.candidatas.find((c) => c.modelo === "A")!;
    expect(a.eat_en_muestra).toBeCloseTo(1.9, 6);
  });
  it("una curva igual a la de A (partir de A) → igual_a = «A» y EAT en muestra 1.9", () => {
    const a = (f.resultado.candidatas.find((c) => c.modelo === "A")!.curva as number[]).map((x) => Math.round(x * 1e6) / 1e4);
    const r = evaluarCurvaUsuario(a, f.resultado, f.temporada);
    expect(r.igual_a).toBe("A");
    expect(r.eat_en_muestra).toBeCloseTo(1.9, 3);
  });
  it("la copia de la partida viaja en la evaluación; por defecto en_blanco", () => {
    expect(e.partida).toEqual({ tipo: "en_blanco", referencia: null });
    expect(evaluarCurvaUsuario(USUARIO, f.resultado, f.temporada, { tipo: "pegado", referencia: null }).partida.tipo).toBe("pegado");
  });
  it("sin años de ajuste, eat_en_muestra = null", () => {
    const sinAjuste = { ...f.resultado, anios: f.resultado.anios.map((a) => ({ ...a, en_ajuste: false })) };
    const r = evaluarCurvaUsuario(USUARIO, sinAjuste, f.temporada);
    expect([r.eat_en_muestra, r.error_max_en_muestra, r.eat_en_muestra_por_anio]).toEqual([null, null, []]);
  });
  it("la curva normalizada es la que se guardaría (suma 1)", () => {
    expect(e.curva.reduce((s, x) => s + x, 0)).toBeCloseTo(1, 12);
    expect(e.curva[4]).toBe(0.11);
  });
  it("igual a la T de la temporada se marca «T»", () => {
    const t = (f.temporada?.curva_T as number[]).map((x) => Math.round(x * 1e6) / 1e4);
    // En este fixture T es A de la propia agrupación: A gana el empate por orden.
    expect(evaluarCurvaUsuario(t, f.resultado, f.temporada).igual_a).toBe("A");
    const sinA = { ...f.resultado, candidatas: f.resultado.candidatas.filter((c) => c.modelo === "T") };
    expect(evaluarCurvaUsuario(t, sinA, f.temporada).igual_a).toBe("T");
  });
});

describe("regla 69 · curvaDesde y partidaSchema", () => {
  const f = sintInv();
  const vigente = { version: 2, curva: curvaDeUsuario(USUARIO) };
  it("candidata → la curva de esa candidata en porcentaje (cuatro decimales)", () => {
    const a = curvaDesde({ tipo: "candidata", referencia: "A" }, f.resultado, null) as number[];
    expect(a.map((x) => Math.round(x * 100) / 100)).toEqual([4.3, 4.4, 6.4, 8.3, 11.05, 14.65, 13.6, 11.65, 9.75, 6.9, 5, 4]);
    const fF = curvaDesde({ tipo: "candidata", referencia: "F" }, f.resultado, null);
    expect(fF).toHaveLength(12);
    expect(curvaDesde({ tipo: "candidata", referencia: "T" }, f.resultado, null)).toHaveLength(12);
  });
  it("año → participacion_real ?? participacion de ese año; vigente → la vigente (solo si es esa versión); inexistente → null", () => {
    const p24 = curvaDesde({ tipo: "anio", referencia: "2024" }, f.resultado, null) as number[];
    expect(p24.map((x) => Math.round(x * 100) / 100)).toEqual([4.3, 4.4, 6.4, 8.3, 12, 13.7, 13.6, 11.65, 9.75, 6.9, 5, 4]);
    expect(curvaDesde({ tipo: "anio", referencia: "2019" }, f.resultado, null)).toBeNull();
    expect(curvaDesde({ tipo: "anio", referencia: "2026" }, f.resultado, null)).toBeNull();
    expect(curvaDesde({ tipo: "vigente", referencia: "v2" }, f.resultado, vigente)).toEqual(USUARIO);
    expect(curvaDesde({ tipo: "vigente", referencia: "v3" }, f.resultado, vigente)).toBeNull();
    expect(curvaDesde({ tipo: "vigente", referencia: "v2" }, f.resultado, null)).toBeNull();
    expect(curvaDesde({ tipo: "en_blanco", referencia: null }, f.resultado, null)).toBeNull();
    expect(curvaDesde({ tipo: "pegado", referencia: null }, f.resultado, null)).toBeNull();
    expect(curvaDesde({ tipo: "candidata", referencia: "A" }, null, null)).toBeNull();
  });
  it("partidaSchema acepta cada tipo y rechaza candidata U, año de dos cifras, vigente sin v, caracteres de control y pegado con referencia", () => {
    for (const p of [{ tipo: "candidata", referencia: "A" }, { tipo: "candidata", referencia: "F" }, { tipo: "candidata", referencia: "T" }, { tipo: "anio", referencia: "2024" }, { tipo: "vigente", referencia: "v2" }, { tipo: "pegado", referencia: null }, { tipo: "en_blanco", referencia: null }]) {
      expect(partidaSchema.safeParse(p).success, JSON.stringify(p)).toBe(true);
    }
    for (const p of [
      { tipo: "candidata", referencia: "U" },
      { tipo: "candidata", referencia: "G" },
      { tipo: "anio", referencia: "24" },
      { tipo: "anio", referencia: "20\n24" },
      { tipo: "anio", referencia: "20‮24" },
      { tipo: "vigente", referencia: "2" },
      { tipo: "vigente", referencia: "v\u0000" },
      { tipo: "pegado", referencia: "x" },
      { tipo: "en_blanco", referencia: "A" },
      { tipo: "otro", referencia: null },
      { tipo: "pegado", referencia: null, extra: 1 },
      { tipo: "anio", referencia: "9".repeat(41) },
    ]) {
      expect(partidaSchema.safeParse(p).success, JSON.stringify(p)).toBe(false);
    }
    // Los espacios de los extremos se recortan (un salto de línea final no es un carácter oculto en medio).
    expect(partidaSchema.parse({ tipo: "anio", referencia: " 2024\n" })).toEqual({ tipo: "anio", referencia: "2024" });
  });
});

describe("regla 70 · aprobarCurvaSchema con U", () => {
  const parametros = { ...PARAMETROS_POR_DEFECTO, hasta_periodo: "2026-09" };
  const base = { modelo: "U", curva_usuario: USUARIO, partida: { tipo: "pegado", referencia: null }, parametros, huella_calculo: "a".repeat(32), version_vigente: null };
  it("U con los doce valores válidos pasa; sin partida también", () => {
    expect(aprobarCurvaSchema.safeParse(base).success).toBe(true);
    const { partida: _p, ...sinPartida } = base;
    void _p;
    expect(aprobarCurvaSchema.safeParse(sinPartida).success).toBe(true);
  });
  it("U sin curva_usuario → 400; con curva inválida → 400", () => {
    const { curva_usuario: _c, ...sinCurva } = base;
    void _c;
    expect(aprobarCurvaSchema.safeParse(sinCurva).success).toBe(false);
    expect(aprobarCurvaSchema.safeParse({ ...base, curva_usuario: USUARIO.slice(1) }).success).toBe(false);
    expect(aprobarCurvaSchema.safeParse({ ...base, curva_usuario: Array(12).fill(0) }).success).toBe(false);
  });
  it("A o F con curva_usuario o con partida → 400", () => {
    for (const modelo of ["A", "F", "T"]) {
      expect(aprobarCurvaSchema.safeParse({ ...base, modelo, partida: undefined }).success, `${modelo} con curva`).toBe(false);
      expect(aprobarCurvaSchema.safeParse({ ...base, modelo, curva_usuario: undefined }).success, `${modelo} con partida`).toBe(false);
      expect(aprobarCurvaSchema.safeParse({ ...base, modelo, curva_usuario: undefined, partida: undefined }).success, modelo).toBe(true);
    }
  });
  it("los parámetros siguen siendo obligatorios y estrictos con U; recencia_f entra con su rango", () => {
    expect(aprobarCurvaSchema.safeParse({ ...base, parametros: { ...parametros, marcar: true } }).success).toBe(false);
    expect(aprobarCurvaSchema.safeParse({ ...base, parametros: { hasta_periodo: "2026-09" } }).success).toBe(true);
    expect(aprobarCurvaSchema.safeParse({ ...base, parametros: { hasta_periodo: "2026-09", recencia_f: 0.4 } }).success).toBe(false);
    expect(aprobarCurvaSchema.safeParse({ ...base, parametros: { hasta_periodo: "2026-09", recencia_f: 0.5 } }).success).toBe(true);
    expect(aprobarCurvaSchema.safeParse({ ...base, parametros: { hasta_periodo: "2026-09", recencia_f: 1.01 } }).success).toBe(false);
  });
});
