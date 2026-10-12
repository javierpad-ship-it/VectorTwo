import { describe, expect, it } from "vitest";
import { crearResolutorCombinaciones, resolverCombinacion } from "@/lib/ventas/resolver";
import { ARBOL, mapeo } from "./ventas.fixture";

/**
 * Mapeo de combinaciones en el resolutor (M5b, reglas 1 a 6 de la ficha 05b).
 * Árbol sintético de `ventas.fixture.ts`; ningún dato real de Lukers.
 */

const r = (g: string, m: string, l: string, e: string, mapeos = [mapeo("x", ["", "", "", "*"], "e1g", false)]) =>
  resolverCombinacion({ genero: g, mundo: m, linea: l, equivalencia: e }, ARBOL, mapeos);

describe("regla 1: el árbol manda", () => {
  it("ok sin `mapeo` cuando el árbol resuelve, aunque exista un mapeo para ese origen", () => {
    const m = mapeo("m1", ["HOMBRE", "CASUAL", "DENIM", "PANTALON VARIOS"], "e1l");
    expect(r("HOMBRE", "CASUAL", "DENIM", "PANTALON VARIOS", [m])).toEqual({ resultado: "ok", equivalencia_id: "e1s" });
    // también con el comodín de la terna
    const c = mapeo("m2", ["HOMBRE", "CASUAL", "DENIM", "*"], "e1l");
    expect(r("HOMBRE", "CASUAL", "DENIM", "PANTALON VARIOS", [c])).toEqual({ resultado: "ok", equivalencia_id: "e1s" });
    expect(r("HOMBRE", "CASUAL", "DENIM", "", [c])).toEqual({ resultado: "ok", equivalencia_id: "e1g" });
  });
});

describe("regla 2: mapeo exacto activo con destino vigente", () => {
  const m = mapeo("m-jean", ["HOMBRE", "CASUAL", "DENIM", "JEAN"], "e1s");

  it("devuelve ok con `mapeo.id` y `motivo_original` igual al que daría sin mapeos", () => {
    const sin = r("HOMBRE", "CASUAL", "DENIM", "JEAN", []);
    expect(sin.resultado).toBe("equivalencia_inexistente");
    const con = r("HOMBRE", "CASUAL", "DENIM", "JEAN", [m]);
    expect(con).toMatchObject({ resultado: "ok", equivalencia_id: "e1s", mapeo: { id: "m-jean", motivo_original: "equivalencia_inexistente" } });
  });

  it("indica el destino como GENERO / MUNDO / LINEA / EQUIVALENCIA para el aviso", () => {
    const con = r("HOMBRE", "CASUAL", "DENIM", "JEAN", [m]);
    expect(con.resultado === "ok" && con.mapeo?.destino).toBe("HOMBRE / CASUAL / DENIM / PANTALON VARIOS");
  });

  it("reasigna cualquiera de los once motivos mapeables (también los inactivos y la clasificación incompleta)", () => {
    const casos: [string, string, string, string, string][] = [
      ["XX", "CASUAL", "DENIM", "-", "genero_desconocido"],
      ["HOMBRE", "ZZ", "DENIM", "-", "mundo_desconocido"],
      ["HOMBRE", "CASUAL", "QQ", "-", "linea_desconocida"],
      ["MUJER", "URBANO", "DENIM", "-", "nodo_inexistente"],
      ["HOMBRE", "CASUAL", "DENIM", "NO EXISTE", "equivalencia_inexistente"],
      ["NIÑOS", "CASUAL", "DENIM", "", "genero_inactivo"],
      ["HOMBRE", "RI", "DENIM", "", "mundo_inactivo"],
      ["HOMBRE", "CASUAL", "BERMUDA", "", "linea_inactiva"],
      ["HOMBRE", "CASUAL", "POLO", "", "nodo_inactivo"],
      ["HOMBRE", "URBANO", "POLO", "POLO CLASICO", "equivalencia_inactiva"],
      ["HOMBRE", "", "DENIM", "-", "clasificacion_incompleta"],
    ];
    for (const [g, mu, l, e, motivo] of casos) {
      const mp = mapeo(`m-${motivo}`, [g, mu, l, e === "-" ? l : e === "" ? "SIN EQUIVALENCIA" : e], "e1s");
      const res = r(g, mu, l, e, [mp]);
      expect(res, motivo).toMatchObject({ resultado: "ok", equivalencia_id: "e1s", mapeo: { id: `m-${motivo}`, motivo_original: motivo } });
    }
  });

  it("el origen del mapeo se compara normalizado y con la equivalencia sustituida", () => {
    // `-` en el origen del mapeo = el nombre de la línea; vacío = SIN EQUIVALENCIA.
    const guion = mapeo("g", ["hombre", "casual", "bermuda", "-"], "e1s");
    expect(r("HOMBRE", "CASUAL", "BERMUDA", "-", [guion])).toMatchObject({ resultado: "ok", mapeo: { id: "g" } });
    expect(r("HOMBRE", "CASUAL", "BERMUDA", "BERMUDA", [guion])).toMatchObject({ resultado: "ok", mapeo: { id: "g" } });
    const vacio = mapeo("v", ["HOMBRE", "CASUAL", "BERMUDA", ""], "e1s");
    expect(r("HOMBRE", "CASUAL", "BERMUDA", "", [vacio])).toMatchObject({ resultado: "ok", mapeo: { id: "v" } });
  });
});

describe("regla 3: exacto gana a comodín; el comodín es de la terna completa", () => {
  const exacto = mapeo("exacto", ["HOMBRE", "CASUAL", "DENIM", "JEAN"], "e1s");
  const comodin = mapeo("comodin", ["HOMBRE", "CASUAL", "DENIM", "*"], "e1l");

  it("exacto antes que comodín, sin importar el orden de la lista", () => {
    expect(r("HOMBRE", "CASUAL", "DENIM", "JEAN", [comodin, exacto])).toMatchObject({ equivalencia_id: "e1s", mapeo: { id: "exacto" } });
    expect(r("HOMBRE", "CASUAL", "DENIM", "JEAN", [exacto, comodin])).toMatchObject({ equivalencia_id: "e1s", mapeo: { id: "exacto" } });
  });

  it("el comodín cubre cualquier otra equivalencia de la terna que no resuelva", () => {
    expect(r("HOMBRE", "CASUAL", "DENIM", "BOOTCUT", [exacto, comodin])).toMatchObject({ equivalencia_id: "e1l", mapeo: { id: "comodin", motivo_original: "equivalencia_inexistente" } });
  });

  it("solo aplica a la terna completa: otro género, mundo o línea no lo usa", () => {
    expect(r("MUJER", "CASUAL", "DENIM", "BOOTCUT", [comodin]).resultado).toBe("equivalencia_inexistente");
    expect(r("HOMBRE", "URBANO", "DENIM", "BOOTCUT", [comodin]).resultado).toBe("nodo_inexistente");
    expect(r("HOMBRE", "CASUAL", "POLO", "BOOTCUT", [comodin]).resultado).toBe("nodo_inactivo");
  });

  it("cubre la genérica cuando el árbol no la resuelve (terna sin nodo)", () => {
    const c = mapeo("c", ["MUJER", "URBANO", "DENIM", "*"], "e2g");
    for (const e of ["", "SIN EQUIVALENCIA", "-", "OTRA"]) {
      expect(r("MUJER", "URBANO", "DENIM", e, [c]), e).toMatchObject({ resultado: "ok", equivalencia_id: "e2g", mapeo: { id: "c", motivo_original: "nodo_inexistente" } });
    }
  });

  it("un comodín por línea inexistente reasigna todas sus equivalencias a un solo destino", () => {
    const c = mapeo("c", ["HOMBRE", "CASUAL", "CHOMPA", "*"], "e1g");
    for (const e of ["A", "B", "SIN EQUIVALENCIA", "CHOMPA"]) {
      expect(r("HOMBRE", "CASUAL", "CHOMPA", e, [c]), e).toMatchObject({ resultado: "ok", equivalencia_id: "e1g", mapeo: { id: "c", motivo_original: "linea_desconocida" } });
    }
  });
});

describe("regla 4: mapeo inactivo o con destino no vigente", () => {
  it("un mapeo inactivo se ignora (y no cuenta como no aplicable)", () => {
    const inactivo = mapeo("i", ["HOMBRE", "CASUAL", "DENIM", "JEAN"], "e1s", false);
    const res = crearResolutorCombinaciones(ARBOL, [inactivo]);
    expect(res({ genero: "HOMBRE", mundo: "CASUAL", linea: "DENIM", equivalencia: "JEAN" }).resultado).toBe("equivalencia_inexistente");
    expect(res.mapeosNoAplicables()).toEqual([]);
  });

  it("un mapeo exacto inactivo deja pasar al comodín activo", () => {
    const exacto = mapeo("e", ["HOMBRE", "CASUAL", "DENIM", "JEAN"], "e1s", false);
    const comodin = mapeo("c", ["HOMBRE", "CASUAL", "DENIM", "*"], "e1l");
    expect(r("HOMBRE", "CASUAL", "DENIM", "JEAN", [exacto, comodin])).toMatchObject({ mapeo: { id: "c" } });
  });

  it("destino con equivalencia inactiva, nodo inactivo o inexistente: no se aplica y la fila conserva su motivo", () => {
    for (const destino of ["e3x" /* equivalencia inactiva */, "e4g" /* nodo inactivo */, "no-existe"]) {
      const res = crearResolutorCombinaciones(ARBOL, [mapeo("m", ["HOMBRE", "CASUAL", "DENIM", "JEAN"], destino)]);
      const v = res({ genero: "HOMBRE", mundo: "CASUAL", linea: "DENIM", equivalencia: "JEAN" });
      expect(v, destino).toMatchObject({ resultado: "equivalencia_inexistente", mapeo_no_aplicable: "m" });
      expect(res.mapeosNoAplicables().map((x) => x.id)).toEqual(["m"]);
    }
  });

  it("destino con línea, género o mundo inactivos tampoco es vigente", () => {
    // Destino e1g = HOMBRE / CASUAL / DENIM / SIN EQUIVALENCIA; origen siempre sin resolver.
    const cambios = {
      linea: { lineas: ARBOL.lineas.map((l) => (l.id === "l-den" ? { ...l, activo: false } : l)) },
      genero: { generos: ARBOL.generos.map((g) => (g.id === "g-h" ? { ...g, activo: false } : g)) },
      mundo: { mundos: ARBOL.mundos.map((m) => (m.id === "m-cas" ? { ...m, activo: false } : m)) },
    };
    for (const [pieza, cambio] of Object.entries(cambios)) {
      const res = crearResolutorCombinaciones({ ...ARBOL, ...cambio }, [mapeo("m", ["XX", "YY", "ZZ", "QUIZA"], "e1g")]);
      const v = res({ genero: "XX", mundo: "YY", linea: "ZZ", equivalencia: "QUIZA" });
      expect(v, pieza).toMatchObject({ resultado: "genero_desconocido", mapeo_no_aplicable: "m" });
    }
    // Con todo activo el mismo mapeo sí se aplica.
    const ok = crearResolutorCombinaciones(ARBOL, [mapeo("m", ["XX", "YY", "ZZ", "QUIZA"], "e1g")]);
    expect(ok({ genero: "XX", mundo: "YY", linea: "ZZ", equivalencia: "QUIZA" })).toMatchObject({ resultado: "ok", equivalencia_id: "e1g" });
  });

  it("aparece una sola vez en `mapeosNoAplicables`, aunque cubra varias combinaciones, con su destino", () => {
    const res = crearResolutorCombinaciones(ARBOL, [mapeo("c", ["HOMBRE", "CASUAL", "DENIM", "*"], "e3x")]);
    for (const e of ["A", "B", "C"]) res({ genero: "HOMBRE", mundo: "CASUAL", linea: "DENIM", equivalencia: e });
    expect(res.mapeosNoAplicables()).toEqual([
      {
        id: "c",
        origen: { genero: "HOMBRE", mundo: "CASUAL", linea: "DENIM", equivalencia: "*" },
        motivo: "destino_inactivo",
        destino: "HOMBRE / URBANO / POLO / POLO CLASICO",
      },
    ]);
  });

  it("con el exacto sin destino vigente no se prueba el comodín (la decisión concreta manda)", () => {
    const exacto = mapeo("e", ["HOMBRE", "CASUAL", "DENIM", "JEAN"], "e3x");
    const comodin = mapeo("c", ["HOMBRE", "CASUAL", "DENIM", "*"], "e1l");
    expect(r("HOMBRE", "CASUAL", "DENIM", "JEAN", [exacto, comodin])).toMatchObject({ resultado: "equivalencia_inexistente", mapeo_no_aplicable: "e" });
  });
});

describe("regla 5: nunca se encadena", () => {
  it("con A→X y un mapeo cuyo origen coincide con el nombre de X, resolver A devuelve X", () => {
    // X = HOMBRE / CASUAL / DENIM / PANTALON VARIOS (e1s). El segundo mapeo toma ese texto como origen y apunta a otro destino.
    const a = mapeo("a", ["HOMBRE", "CASUAL", "DENIM", "JEAN"], "e1s");
    const b = mapeo("b", ["HOMBRE", "CASUAL", "DENIM", "PANTALON VARIOS"], "e1l");
    expect(r("HOMBRE", "CASUAL", "DENIM", "JEAN", [a, b])).toMatchObject({ resultado: "ok", equivalencia_id: "e1s", mapeo: { id: "a" } });
    expect(r("HOMBRE", "CASUAL", "DENIM", "JEAN", [b, a])).toMatchObject({ resultado: "ok", equivalencia_id: "e1s", mapeo: { id: "a" } });
  });

  it("dos mapeos cruzados (A→B y B→A) no hacen ciclo: cada origen va a su destino", () => {
    const a = mapeo("a", ["HOMBRE", "CASUAL", "DENIM", "JEAN"], "e1s");
    const b = mapeo("b", ["HOMBRE", "CASUAL", "DENIM", "BOOTCUT"], "e1l");
    expect(r("HOMBRE", "CASUAL", "DENIM", "JEAN", [a, b])).toMatchObject({ equivalencia_id: "e1s" });
    expect(r("HOMBRE", "CASUAL", "DENIM", "BOOTCUT", [a, b])).toMatchObject({ equivalencia_id: "e1l" });
  });
});

describe("regla 6: clasificacion_incompleta la decide el resolutor", () => {
  it("uno o dos en blanco → clasificacion_incompleta con el detalle `HOMBRE / (vacío) / PANTALON`", () => {
    expect(r("HOMBRE", "", "PANTALON", "X", [])).toEqual({ resultado: "clasificacion_incompleta", detalle: "HOMBRE / (vacío) / PANTALON" });
    expect(r("", "", "DENIM", "X", [])).toEqual({ resultado: "clasificacion_incompleta", detalle: "(vacío) / (vacío) / DENIM" });
    expect(r("HOMBRE", "CASUAL", "", "X", [])).toMatchObject({ resultado: "clasificacion_incompleta" });
  });

  it("es mapeable: con un mapeo exacto o de terna pasa a ok con el motivo original", () => {
    const m = mapeo("m", ["HOMBRE", "", "DENIM", "SIN EQUIVALENCIA"], "e1g");
    expect(r("HOMBRE", "", "DENIM", "", [m])).toMatchObject({ resultado: "ok", equivalencia_id: "e1g", mapeo: { motivo_original: "clasificacion_incompleta" } });
    const c = mapeo("c", ["", "", "DENIM", "*"], "e1s");
    expect(r("", "", "DENIM", "CUALQUIERA", [c])).toMatchObject({ resultado: "ok", equivalencia_id: "e1s" });
  });

  it("con los tres en blanco no es mapeable: no hay origen que mapear", () => {
    const loco = mapeo("loco", ["", "", "", "*"], "e1g");
    const res = r("", "", "", "X", [loco]);
    expect(res.resultado).not.toBe("ok");
  });
});

describe("el resolutor sin mapeos se comporta como antes", () => {
  it("la función devuelta sigue siendo un resolutor simple y `mapeosNoAplicables` empieza vacío", () => {
    const res = crearResolutorCombinaciones(ARBOL);
    expect(res({ genero: "HOMBRE", mundo: "CASUAL", linea: "DENIM", equivalencia: "-" })).toEqual({ resultado: "ok", equivalencia_id: "e1l" });
    expect(res.mapeosNoAplicables()).toEqual([]);
  });
});
