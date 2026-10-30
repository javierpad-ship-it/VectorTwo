import { describe, expect, it } from "vitest";
import { crearAliasador } from "@/lib/ia/alias";
import { armarBloquesGM } from "@/lib/ia/entrada";
import type { BloqueGMIa, LineaEntradaIa } from "@/lib/ia/tipos";
import { leerJsonSalida, limiteCifra, sanearRazon, validarLineas, validarNatural, validarReparto } from "@/lib/ia/validar";
import { datosA, datosGrandes, TERMINOS_J } from "./ia.fixture";

/** R9 (ficha 07e, §5.2): `validarSalida` de natural, reparto y líneas. */

const bloqueDe = (datos = datosA()): BloqueGMIa => {
  const r = armarBloquesGM(datos, { terminos: TERMINOS_J });
  if (!r.ok) throw new Error("bloqueado");
  return r.lotes[0].bloque;
};
const A = bloqueDe();
const entradaN = { bloque: A, sobre: "corregida" as const };
const nat = (f: string, natural_y1: number, extra: Record<string, unknown> = {}) => ({ f, natural_y1, razon_natural: `Razón de ${f}.`, banderas: [], confianza: "media", ...extra });
const rep = (f: string, meta_y1: number, extra: Record<string, unknown> = {}) => ({ f, meta_y1, razon: `Razón de ${f}.`, banderas: [], ...extra });
const salidaNat = (filas: unknown[]) => ({ version_salida: 2, filas });
const salidaRep = (filas: unknown[], extra: Record<string, unknown> = {}) => ({ version_salida: 2, razon_gm: "Meta exigente.", banderas_gm: [], filas, ...extra });

describe("lectura del texto", () => {
  it("acepta JSON plano y en un bloque de código; rechaza lo demás", () => {
    expect(leerJsonSalida('{"a":1}')).toEqual({ ok: true, valor: { a: 1 } });
    expect(leerJsonSalida('```json\n{"a":1}\n```')).toEqual({ ok: true, valor: { a: 1 } });
    expect(leerJsonSalida("no es json")).toEqual({ ok: false });
    expect(leerJsonSalida("")).toEqual({ ok: false });
  });
});

describe("R9 · natural", () => {
  const validas = [nat("f001", 10300), nat("f002", 6600), nat("f003", 5100)];

  it("una salida válida pasa entera, con sus razones y banderas", () => {
    const r = validarNatural(salidaNat([nat("f001", 10300, { banderas: ["nino", "quiebres"], confianza: "alta" }), nat("f002", 6600), nat("f003", 5100)]), entradaN);
    expect(r.invalida).toBeNull();
    expect(r.filas.map((f) => [f.f, f.natural_y1])).toEqual([["f001", 10300], ["f002", 6600], ["f003", 5100]]);
    expect(r.filas[0]).toMatchObject({ banderas: ["nino", "quiebres"], confianza: "alta", avisos: [], razon_natural: "Razón de f001." });
    expect(r.faltantes).toEqual([]);
    expect(r.avisos_gm).toEqual([]);
  });

  it("zod: version equivocada, campos de más o de menos → invalida con un resumen sin datos", () => {
    const secreto = "DATO_SENSIBLE_XYZ";
    for (const mala of [{ version_salida: 3, filas: [] }, { ...salidaNat(validas), extra: secreto }, salidaNat([{ f: "f001", natural_y1: -1, razon_natural: secreto, banderas: [], confianza: "alta" }]), "texto", null, salidaNat([nat("x1", 5)])]) {
      const r = validarNatural(mala, entradaN);
      expect(r.invalida?.codigo).toBe("zod");
      expect(r.invalida?.resumen).not.toContain(secreto);
      expect(r.invalida?.resumen).toMatch(/esquema/);
    }
  });

  it("un f repetido se toma una vez (el primero) con aviso fila_duplicada", () => {
    const r = validarNatural(salidaNat([...validas, nat("f001", 999)]), entradaN);
    expect(r.invalida).toBeNull();
    expect(r.filas).toHaveLength(3);
    expect(r.filas[0].natural_y1).toBe(10300);
    expect(r.filas[0].avisos).toContain("fila_duplicada");
  });

  it("un f no pedido o fijo se ignora con aviso fila_extra", () => {
    const r = validarNatural(salidaNat([...validas, nat("f004", 3300), nat("f777", 5)]), entradaN);
    expect(r.filas.map((f) => f.f)).toEqual(["f001", "f002", "f003"]);
    expect(r.avisos_gm).toEqual(["fila_extra"]);
  });

  it("faltan ≤ 5 %: esas filas quedan sin cifra; faltan > 5 %: inválida", () => {
    const grande = bloqueDe(datosGrandes(20, 2));
    const todas = grande.filas.map((f) => nat(f.f, 100));
    const uno = validarNatural(salidaNat(todas.slice(1)), { bloque: grande, sobre: "corregida" });
    expect(uno.invalida).toBeNull();
    expect(uno.faltantes).toEqual(["f001"]);
    expect(uno.filas).toHaveLength(19);
    const dos = validarNatural(salidaNat(todas.slice(2)), { bloque: grande, sobre: "corregida" });
    expect(dos.invalida).toEqual({ codigo: "faltan_filas", resumen: "faltan 2 filas" });
    // 1 de 19 es 5,26 %: ya es demasiado.
    const diecinueve = bloqueDe(datosGrandes(19, 2));
    const r19 = validarNatural(salidaNat(diecinueve.filas.slice(1).map((f) => nat(f.f, 100))), { bloque: diecinueve, sobre: "corregida" });
    expect(r19.invalida?.codigo).toBe("faltan_filas");
  });

  it("cifra mayor que 10 × max(B^s, máximo anual, 1): se descarta con aviso ia_cifra_excesiva", () => {
    const f = A.filas[0];
    const limite = limiteCifra(f, "corregida");
    expect(limite).toBe(100000);
    const r = validarNatural(salidaNat([nat("f001", limite), nat("f002", 6600), nat("f003", 5100)]), entradaN);
    expect(r.filas[0].natural_y1).toBe(limite);
    const s = validarNatural(salidaNat([nat("f001", limite + 1), nat("f002", 6600), nat("f003", 5100)]), entradaN);
    expect(s.filas[0]).toMatchObject({ natural_y1: null, avisos: ["ia_cifra_excesiva"] });
    expect(s.invalida).toBeNull();
  });

  it("el límite usa B (no B') con sobre = bruta, y vale al menos 10", () => {
    const f = { ...A.filas[0], meses: {}, y1: { ...A.filas[0].y1, base: 2000, base_corregida: 50 } };
    expect(limiteCifra(f, "bruta")).toBe(20000);
    expect(limiteCifra(f, "corregida")).toBe(500);
    expect(limiteCifra({ ...f, y1: { ...f.y1, base: null, base_corregida: null } }, "corregida")).toBe(10);
  });

  it("banderas fuera del catálogo se descartan con aviso bandera_desconocida; las repetidas se juntan", () => {
    const r = validarNatural(salidaNat([nat("f001", 1, { banderas: ["nino", "inventada", "nino"] }), nat("f002", 1), nat("f003", 1)]), entradaN);
    expect(r.filas[0].banderas).toEqual(["nino"]);
    expect(r.filas[0].avisos).toEqual(["bandera_desconocida"]);
  });

  it("la razón restituye los alias, quita caracteres de control, de formato y saltos, y colapsa espacios", () => {
    const alias = crearAliasador(TERMINOS_J);
    const mala = "MARCA_A​  SLIM‎ rebota‏\ncon\u0007 la  base\t\tcorregida";
    const r = validarNatural(salidaNat([nat("f001", 1, { razon_natural: mala }), nat("f002", 1), nat("f003", 1)]), entradaN, { restituir: (t) => alias.restituir(t) });
    expect(r.filas[0].razon_natural).toBe("MARCAX SLIM rebota con la base corregida");
    expect(new RegExp("[\\p{Cc}\\p{Cf}\\p{Zl}\\p{Zp}]", "u").test(r.filas[0].razon_natural)).toBe(false);
  });

  it("una razón de más de 200 caracteres se recorta con aviso; una vacía tras sanear dice «sin explicación»", () => {
    const larga = "a".repeat(250);
    const r = validarNatural(salidaNat([nat("f001", 1, { razon_natural: larga }), nat("f002", 1, { razon_natural: "​‎ \n" }), nat("f003", 1)]), entradaN);
    expect(Array.from(r.filas[0].razon_natural)).toHaveLength(200);
    expect(r.filas[0].avisos).toEqual(["razon_recortada"]);
    expect(r.filas[1].razon_natural).toBe("sin explicación");
    expect(r.filas[1].avisos).toEqual([]);
  });
});

describe("sanearRazon", () => {
  it("recorta a 280 y a 600 sin cortar un carácter a la mitad", () => {
    expect(Array.from(sanearRazon("é".repeat(300), 280).texto)).toHaveLength(280);
    expect(sanearRazon("😀".repeat(10), 3)).toEqual({ texto: "😀😀😀", recortada: true });
    expect(sanearRazon("ok", 280)).toEqual({ texto: "ok", recortada: false });
  });
});

describe("R9 · reparto", () => {
  const entradaR = (del_lote: number) => ({ bloque: A, sobre: "corregida" as const, del_lote });
  const tres = (a: number, b: number, c: number) => salidaRep([rep("f001", a), rep("f002", b), rep("f003", c)]);

  it("ejemplo A: 11 000 · 6 700 · 5 000 (Σ 22 700, desvío +0,35 %) pasa sin aviso", () => {
    const r = validarReparto(tres(11000, 6700, 5000), entradaR(22620));
    expect(r.invalida).toBeNull();
    expect(r.filas.map((f) => f.meta_y1)).toEqual([11000, 6700, 5000]);
    expect(r.desvio_suma_modelo).toBeCloseTo(0.0035, 4);
    expect(r.avisos_gm).toEqual([]);
    expect(r.razon_gm).toBe("Meta exigente.");
  });

  it("desvío de la suma: ≤ 3 % nada; 3 a 15 % aviso ia_no_cuadro; > 15 % inválida", () => {
    const con = (suma: number) => validarReparto(tres(suma - 2000, 1000, 1000), entradaR(10000));
    expect(con(10300)).toMatchObject({ invalida: null, avisos_gm: [] });
    expect(con(9700)).toMatchObject({ invalida: null, avisos_gm: [] });
    expect(con(10301)).toMatchObject({ invalida: null, avisos_gm: ["ia_no_cuadro"] });
    expect(con(11500)).toMatchObject({ invalida: null, avisos_gm: ["ia_no_cuadro"] });
    expect(con(8500)).toMatchObject({ invalida: null, avisos_gm: ["ia_no_cuadro"] });
    expect(con(11501).invalida).toEqual({ codigo: "no_cuadra", resumen: "la suma difiere 15 %" });
    expect(con(8499).invalida?.codigo).toBe("no_cuadra");
    expect(validarReparto(tres(10000, 4000, 4000), entradaR(14400)).invalida?.resumen).toBe("la suma difiere 25 %");
  });

  it("la suma desviada un 20 % es inválida y guarda el desvío", () => {
    const r = validarReparto(tres(12000, 6000, 6000), entradaR(20000));
    expect(r.invalida).toEqual({ codigo: "no_cuadra", resumen: "la suma difiere 20 %" });
    expect(r.desvio_suma_modelo).toBeCloseTo(0.2, 6);
  });

  it("duplicados, extras, fijas, cifras excesivas, banderas, razón del GM", () => {
    const r = validarReparto(
      salidaRep([rep("f001", 11000), rep("f001", 5), rep("f002", 6700, { banderas: ["raro", "volatil"] }), rep("f003", 9_999_999), rep("f004", 3300), rep("f900", 1)], { razon_gm: "g".repeat(700), banderas_gm: ["meta_exigente", "xyz"] }),
      entradaR(17700)
    );
    expect(r.filas.map((f) => [f.f, f.meta_y1])).toEqual([["f001", 11000], ["f002", 6700], ["f003", null]]);
    expect(r.filas[0].avisos).toEqual(["fila_duplicada"]);
    expect(r.filas[1]).toMatchObject({ banderas: ["volatil"], avisos: ["bandera_desconocida"] });
    expect(r.filas[2].avisos).toEqual(["ia_cifra_excesiva"]);
    expect(r.avisos_gm).toEqual(expect.arrayContaining(["fila_extra", "razon_recortada", "bandera_desconocida"]));
    expect(Array.from(r.razon_gm)).toHaveLength(600);
    expect(r.banderas_gm).toEqual(["meta_exigente"]);
    expect(r.invalida).toBeNull();
  });

  it("faltan > 5 % de las filas: inválida por faltantes antes que por la suma", () => {
    const r = validarReparto(salidaRep([rep("f001", 11000)]), entradaR(22620));
    expect(r.invalida).toEqual({ codigo: "faltan_filas", resumen: "faltan 2 filas" });
    expect(r.faltantes).toEqual(["f002", "f003"]);
  });

  it("zod", () => {
    expect(validarReparto({ version_salida: 2, filas: [] }, entradaR(100)).invalida?.codigo).toBe("zod");
    expect(validarReparto(salidaRep([{ f: "f001", meta_y1: 1.5, razon: "x", banderas: [] }]), entradaR(100)).invalida?.codigo).toBe("zod");
  });

  it("meta del lote 0: la suma 0 es válida; con suma > 0 no", () => {
    expect(validarReparto(tres(0, 0, 0), entradaR(0)).invalida).toBeNull();
    expect(validarReparto(tres(5, 0, 0), entradaR(0)).invalida?.codigo).toBe("no_cuadra");
  });
});

describe("R9 · líneas (modo jerárquico)", () => {
  const linea = (l: string, base_corregida: number): LineaEntradaIa => ({ l, linea: `L ${l}`, filas_libres: 2, historia: { "A-1": base_corregida, A: base_corregida / 2 }, comparable_pct: {}, base_corregida, natural_y1: base_corregida, fijas: 0 });
  const lineas = [linea("l01", 6000), linea("l02", 4000)];
  const sal = (xs: [string, number][], extra: Record<string, unknown> = {}) => ({ version_salida: 2, razon_gm: "Reparto por línea.", banderas_gm: [], lineas: xs.map(([l, m]) => ({ l, meta_y1: m, razon: `Razón ${l}.` })), ...extra });

  it("válida", () => {
    const r = validarLineas(sal([["l01", 6100], ["l02", 3900]]), { lineas, meta_libre: 10000 });
    expect(r.invalida).toBeNull();
    expect(r.lineas.map((l) => [l.l, l.meta_y1])).toEqual([["l01", 6100], ["l02", 3900]]);
    expect(r.desvio_suma_modelo).toBe(0);
  });

  it("una línea sin respuesta: su sub-meta se reparte con P^GM (aviso)", () => {
    const r = validarLineas(sal([["l01", 9800]]), { lineas, meta_libre: 10000 });
    expect(r.faltantes).toEqual(["l02"]);
    expect(r.avisos_gm).toContain("sin_propuesta_ia");
    expect(r.invalida).toBeNull();
  });

  it("línea desconocida o repetida, cifra excesiva y desvío contra Meta_libre", () => {
    const r = validarLineas(sal([["l01", 6000], ["l01", 1], ["l02", 4000], ["l09", 5]]), { lineas, meta_libre: 10000 });
    expect(r.lineas[0].avisos).toEqual(["fila_duplicada"]);
    expect(r.avisos_gm).toContain("fila_extra");
    const excesiva = validarLineas(sal([["l01", 200000], ["l02", 4000]]), { lineas, meta_libre: 4000 });
    expect(excesiva.lineas[0]).toMatchObject({ meta_y1: null, avisos: ["ia_cifra_excesiva"] });
    expect(validarLineas(sal([["l01", 6000], ["l02", 5000]]), { lineas, meta_libre: 10000 }).avisos_gm).toContain("ia_no_cuadro");
    expect(validarLineas(sal([["l01", 6000], ["l02", 7000]]), { lineas, meta_libre: 10000 }).invalida?.codigo).toBe("no_cuadra");
    expect(validarLineas({ version_salida: 2 }, { lineas, meta_libre: 1 }).invalida?.codigo).toBe("zod");
  });

  it("la razón del GM se restituye y recorta como en las demás", () => {
    const alias = crearAliasador(TERMINOS_J);
    const r = validarLineas(sal([["l01", 6000], ["l02", 4000]], { razon_gm: "MARCA_A​ empuja" }), { lineas, meta_libre: 10000 }, { restituir: (t) => alias.restituir(t) });
    expect(r.razon_gm).toBe("MARCAX empuja");
  });
});
