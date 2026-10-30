import { describe, expect, it } from "vitest";
import { controlFinal, crearAliasador, limpiarTexto, normalizarParaComparar, type EntradaDiccionarioAlias, type TerminoPrivado } from "@/lib/ia/alias";
import { TERMINOS_J } from "./ia.fixture";

/** R11 (ficha 07e, ejemplo J): alias de marcas, tiendas y términos, restitución y control final. Todos los nombres son sintéticos. */

describe("normalización", () => {
  it("mayúsculas, sin tildes, sin caracteres de formato y con espacios colapsados", () => {
    expect(normalizarParaComparar("  Marcáx​   Slim‎ ")).toBe("MARCAX SLIM");
    expect(normalizarParaComparar("ＭＡＲＣＡＸ")).toBe("MARCAX");
    expect(limpiarTexto("Línea​  Nueva\n")).toBe("Línea Nueva");
  });
});

describe("R11 · ejemplo J", () => {
  const alias = crearAliasador(TERMINOS_J);

  it("«MARCAX SLIM» viaja como «MARCA_A SLIM» y la agrupación «MARCAX» como «MARCA_A»; el diccionario guarda tipo e id, nunca el nombre", () => {
    const usados: Record<string, EntradaDiccionarioAlias> = {};
    expect(alias.aplicar("MARCAX SLIM", usados)).toBe("MARCA_A SLIM");
    expect(alias.aplicar("MARCAX", usados)).toBe("MARCA_A");
    expect(usados).toEqual({ MARCA_A: { tipo: "marca", id: TERMINOS_J[0].id } });
    expect(JSON.stringify(usados)).not.toMatch(/MARCAX/);
  });

  it("al volver, el alias de la razón se restituye al nombre real", () => {
    expect(alias.restituir("MARCA_A SLIM rebota con la base corregida")).toBe("MARCAX SLIM rebota con la base corregida");
    expect(alias.restituir("marca_a rebota")).toBe("MARCAX rebota");
    expect(alias.restituir("MARCA_Q no existe")).toBe("MARCA_Q no existe");
  });

  it("«MARCAXL» no es la palabra «MARCAX»: no se reemplaza ni bloquea", () => {
    expect(alias.aplicar("MARCAXL SLIM")).toBe("MARCAXL SLIM");
    expect(alias.contiene("MARCAXL SLIM")).toBe(false);
    expect(controlFinal({ linea: "MARCAXL SLIM" }, TERMINOS_J).ok).toBe(true);
  });

  it("el código de una tienda también se reemplaza (TIENDA_A)", () => {
    const usados: Record<string, EntradaDiccionarioAlias> = {};
    expect(alias.aplicar("LINEA Z901", usados)).toBe("LINEA TIENDA_A");
    expect(usados.TIENDA_A).toEqual({ tipo: "tienda", id: TERMINOS_J[1].id });
  });

  it("si un término sobrevive (el alias falló), el control final lo encuentra", () => {
    expect(controlFinal({ linea: "LINEA Z901" }, TERMINOS_J)).toEqual({ ok: false, hallazgos: ["termino"] });
    expect(controlFinal({ linea: "LINEA TIENDA_A", otra: "MARCA_A SLIM" }, TERMINOS_J).ok).toBe(true);
  });
});

describe("coincidencia por palabra o secuencia de palabras completas", () => {
  const t = (texto: string, tipo: TerminoPrivado["tipo"] = "marca", id: string | null = null): TerminoPrivado => ({ texto, tipo, id });

  it("insensible a mayúsculas, tildes, formato y signos", () => {
    const a = crearAliasador([t("Marcáx")]);
    expect(a.aplicar("marcax slim")).toBe("MARCA_A slim");
    expect(a.aplicar("MARC​AX-SLIM")).toBe("MARCA_A-SLIM");
    expect(a.aplicar("POLO (MARCAX)")).toBe("POLO (MARCA_A)");
  });

  it("un término de varias palabras coincide como secuencia", () => {
    const a = crearAliasador([t("Casa Real")]);
    expect(a.aplicar("POLO CASA REAL SLIM")).toBe("POLO MARCA_A SLIM");
    expect(a.aplicar("POLO casa-real")).toBe("POLO MARCA_A");
    expect(a.aplicar("CASA GRANDE REAL")).toBe("CASA GRANDE REAL");
  });

  it("gana la secuencia más larga y no se pisa a sí misma", () => {
    const a = crearAliasador([t("Casa"), t("Casa Real")]);
    expect(a.aplicar("CASA REAL Y CASA")).toBe("MARCA_B Y MARCA_A");
  });

  it("solo se ignoran los términos de un carácter; uno de dos se reemplaza y no toca otras palabras", () => {
    const a = crearAliasador([t("A"), t("XY")]);
    expect(a.aplicar("A XY XYZ")).toBe("A MARCA_A XYZ");
    expect(a.contiene("A")).toBe(false);
  });

  it("alias estables: no dependen del orden de los términos ni de qué texto se alias primero", () => {
    const x = crearAliasador([t("BETA"), t("ALFA"), t("GAMMA", "tienda"), t("DELTA", "termino")]);
    const y = crearAliasador([t("DELTA", "termino"), t("GAMMA", "tienda"), t("ALFA"), t("BETA")]);
    for (const texto of ["ALFA", "BETA", "GAMMA", "DELTA"]) expect(x.aplicar(texto)).toBe(y.aplicar(texto));
    expect(x.aplicar("ALFA")).toBe("MARCA_A");
    expect(x.aplicar("BETA")).toBe("MARCA_B");
    expect(x.aplicar("GAMMA")).toBe("TIENDA_A");
    expect(x.aplicar("DELTA")).toBe("TERMINO_A");
  });

  it("un nombre repetido entre tipos toma el alias de mayor prioridad (marca)", () => {
    const a = crearAliasador([t("IGUAL", "tienda", "t"), t("IGUAL", "marca", "m")]);
    const usados: Record<string, EntradaDiccionarioAlias> = {};
    expect(a.aplicar("IGUAL", usados)).toBe("MARCA_A");
    expect(usados.MARCA_A).toEqual({ tipo: "marca", id: "m" });
  });

  it("pasadas 26 marcas, los alias siguen (AA, AB…)", () => {
    const terminos = Array.from({ length: 28 }, (_, i) => t(`NOMBRE${String(i).padStart(2, "0")}`));
    const a = crearAliasador(terminos);
    expect(a.aplicar("NOMBRE25")).toBe("MARCA_Z");
    expect(a.aplicar("NOMBRE26")).toBe("MARCA_AA");
    expect(a.aplicar("NOMBRE27")).toBe("MARCA_AB");
    expect(a.restituir("MARCA_AB")).toBe("NOMBRE27");
  });

  it("los términos extra de la configuración también se reemplazan", () => {
    const a = crearAliasador([t("Sigla Interna", "termino")]);
    expect(a.aplicar("PLAN SIGLA INTERNA")).toBe("PLAN TERMINO_A");
  });
});

describe("control final", () => {
  it("detecta un uuid, un año real en textos y en claves, y una clave fuera de la lista blanca", () => {
    expect(controlFinal({ a: "11111111-2222-4333-8444-555555555555" }, []).hallazgos).toEqual(["uuid"]);
    expect(controlFinal({ linea: "COLECCION 2025" }, []).hallazgos).toEqual(["anio"]);
    expect(controlFinal({ "2024": 1 }, []).hallazgos).toEqual(["anio"]);
    expect(controlFinal({ soles: 10 }, [], new Set(["linea"])).hallazgos).toEqual(["clave"]);
  });
  it("un número no es un año (2 026 unidades) y los años relativos pasan", () => {
    expect(controlFinal({ unidades: 2026, meses: [2024, 1999], "A-1": 5, anio: "A+1" }, [], new Set(["unidades", "meses", "A-1", "anio"])).ok).toBe(true);
  });
  it("recorre arreglos y objetos anidados", () => {
    expect(controlFinal({ filas: [{ linea: { x: ["bien", "MARCAX"] } }] }, TERMINOS_J).hallazgos).toEqual(["termino"]);
  });
});
