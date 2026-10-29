import { describe, expect, it } from "vitest";
import { crearCrecimientoDe, claveGM } from "@/lib/proyeccion/crecimientos";
import { faltantesDeCierre, gmExigidos, matrizDeVigentes, restoEfectivo, sobreBaseDe, type GmConNino, type VigenteCrecimiento } from "@/lib/crecimientos/vigentes";

/** 06d §3.1 (sintético; nada real): lectura de los crecimientos aprobados vigentes desde M7. */

const HOMBRE = "g-hombre";
const MUJER = "g-mujer";
const NINO = "g-nino";
const URBANO = "m-urbano";
const RI = "m-ri";
const DEPORTIVO = "m-deportivo";
const DETALLADOS = [HOMBRE, MUJER];

let n = 0;
const vigente = (extra: Partial<VigenteCrecimiento>): VigenteCrecimiento => {
  n += 1;
  return {
    id: `id-${n}`,
    anio_aplicacion: 2027,
    alcance: "gm",
    genero_id: HOMBRE,
    mundo_id: URBANO,
    version: 1,
    pct: 10,
    usuario_nombre: "Javier",
    aprobada_at: "2026-10-27T10:00:00.000Z",
    ...extra,
  };
};
const resto = (extra: Partial<VigenteCrecimiento> = {}) => vigente({ alcance: "resto", genero_id: null, mundo_id: null, ...extra });

describe("matrizDeVigentes", () => {
  it("sin vigentes: matriz vacía y Resto sin id", () => {
    const m = matrizDeVigentes([], DETALLADOS);
    expect(m.celdas.size).toBe(0);
    expect(m.ids.size).toBe(0);
    expect(m.versiones.size).toBe(0);
    expect(m.resto).toEqual({ id: null, version: null, sobre_base: "corregida" });
    expect([...m.generos].sort()).toEqual([HOMBRE, MUJER]);
  });

  it("lleva pct, id y versión de cada GM, y el id y versión del Resto", () => {
    const a = vigente({ genero_id: HOMBRE, mundo_id: URBANO, pct: 15, version: 2 });
    const b = vigente({ genero_id: MUJER, mundo_id: RI, pct: 8.5, version: 1 });
    const r = resto({ pct: 5, version: 3 });
    const m = matrizDeVigentes([a, b, r], DETALLADOS);
    expect(m.celdas.get(claveGM(HOMBRE, URBANO))).toBe(15);
    expect(m.celdas.get(claveGM(MUJER, RI))).toBe(8.5);
    expect(m.celdas.size).toBe(2);
    expect(m.ids.get(claveGM(HOMBRE, URBANO))).toBe(a.id);
    expect(m.versiones.get(claveGM(HOMBRE, URBANO))).toBe(2);
    expect(m.versiones.get(claveGM(MUJER, RI))).toBe(1);
    expect(m.resto).toEqual({ id: r.id, version: 3, sobre_base: "bruta" });
  });

  it("regla 6: un GM de un género no detallado no se aplica", () => {
    const m = matrizDeVigentes([vigente({ genero_id: NINO, mundo_id: URBANO, pct: 40 })], DETALLADOS);
    expect(m.celdas.size).toBe(0);
    const crecimientoDe = crearCrecimientoDe({ matriz: m, resto: 5, gmDe: () => ({ genero_id: NINO, mundo_id: URBANO, nombre: "NIÑO · URBANO" }) });
    expect(crecimientoDe("|gml-1|eq|am").pct).toBe(5);
  });

  it("precedencia con crearCrecimientoDe: fila > GM aprobado > Resto", () => {
    const m = matrizDeVigentes([vigente({ genero_id: HOMBRE, mundo_id: URBANO, pct: 15 })], DETALLADOS);
    const gmDe = (gml: string) =>
      gml === "gml-1" ? { genero_id: HOMBRE, mundo_id: URBANO, nombre: "HOMBRE · URBANO" } : { genero_id: HOMBRE, mundo_id: RI, nombre: "HOMBRE · RI" };
    const crecimientoDe = crearCrecimientoDe({ matriz: m, resto: 5, gmDe });
    expect(crecimientoDe("|gml-1|eq|am", 30)).toMatchObject({ pct: 30, origen: "fila" });
    expect(crecimientoDe("|gml-1|eq|am", null)).toMatchObject({ pct: 15, origen: "celda" });
    expect(crecimientoDe("|gml-2|eq|am", null)).toMatchObject({ pct: 5, origen: "resto" });
  });

  it("un solo año: ignora las versiones de otros años cuando se pide `anio`", () => {
    const v26 = vigente({ anio_aplicacion: 2026, pct: 3 });
    const v27 = vigente({ anio_aplicacion: 2027, pct: 20 });
    expect(matrizDeVigentes([v26, v27], DETALLADOS, 2027).celdas.get(claveGM(HOMBRE, URBANO))).toBe(20);
    expect(matrizDeVigentes([v26, v27], DETALLADOS, 2028).celdas.size).toBe(0);
  });

  it("si hubiera dos vigentes de la misma clave, manda la de mayor versión", () => {
    const m = matrizDeVigentes([vigente({ version: 1, pct: 1 }), vigente({ version: 2, pct: 2 })], DETALLADOS);
    expect(m.celdas.get(claveGM(HOMBRE, URBANO))).toBe(2);
    expect(m.versiones.get(claveGM(HOMBRE, URBANO))).toBe(2);
  });

  it("ignora un alcance desconocido y un gm sin mundo", () => {
    const m = matrizDeVigentes([vigente({ alcance: "genero", pct: 9 }), vigente({ mundo_id: null })], DETALLADOS);
    expect(m.celdas.size).toBe(0);
    expect(m.resto).toEqual({ id: null, version: null, sobre_base: "corregida" });
  });
});

describe("restoEfectivo", () => {
  it("sin Resto aprobado: el provisional, sin id, versión ni autor", () => {
    expect(restoEfectivo([vigente({})], 20)).toEqual({ pct: 20, crecimiento_id: null, version: null, por_nombre: null, at: null, sobre_base: "corregida" });
  });

  it("con Resto aprobado: su pct, id, versión, autor y fecha (el provisional no se usa)", () => {
    const r = resto({ pct: 6, version: 2, usuario_nombre: "Ana", aprobada_at: "2026-10-28T08:00:00.000Z" });
    expect(restoEfectivo([r], 20)).toEqual({ pct: 6, crecimiento_id: r.id, version: 2, por_nombre: "Ana", at: "2026-10-28T08:00:00.000Z", sobre_base: "bruta" });
  });

  it("respeta el año pedido", () => {
    const r = resto({ anio_aplicacion: 2026, pct: 6 });
    expect(restoEfectivo([r], 20, 2027).pct).toBe(20);
    expect(restoEfectivo([r], 20, 2026).pct).toBe(6);
  });

  it("un pct 0 aprobado no cae al provisional", () => {
    expect(restoEfectivo([resto({ pct: 0 })], 20).pct).toBe(0);
  });
});

describe("gmExigidos (I4)", () => {
  const g = (a: string, b: string) => claveGM(a, b);

  it("solo los GM de HOMBRE y MUJER con filas base, sin repetir y ordenados", () => {
    const e = gmExigidos({ n1: g(MUJER, RI), n2: g(HOMBRE, URBANO), n3: g(MUJER, RI), n4: g(HOMBRE, DEPORTIVO) }, DETALLADOS);
    expect(e.gm).toEqual([g(HOMBRE, DEPORTIVO), g(HOMBRE, URBANO), g(MUJER, RI)].sort());
    expect(e.resto).toBe(false);
  });

  it("un GM de otro género exige el Resto y no entra en la lista de GM", () => {
    const e = gmExigidos({ n1: g(HOMBRE, URBANO), n2: g(NINO, URBANO) }, DETALLADOS);
    expect(e).toEqual({ gm: [g(HOMBRE, URBANO)], resto: true });
  });

  it("solo géneros no detallados: sin GM y con Resto", () => {
    expect(gmExigidos({ n1: g(NINO, RI) }, DETALLADOS)).toEqual({ gm: [], resto: true });
  });

  it("sin filas base no se exige nada (un GM con venta pero sin filas base no bloquea)", () => {
    expect(gmExigidos({}, DETALLADOS)).toEqual({ gm: [], resto: false });
  });
});

describe("faltantesDeCierre", () => {
  const a = claveGM(HOMBRE, URBANO);
  const b = claveGM(MUJER, RI);
  const c = claveGM(MUJER, DEPORTIVO);

  it("lista los GM sin versión vigente, en el orden de lo exigido", () => {
    const f = faltantesDeCierre({ gm: [a, b, c], resto: false }, [vigente({ genero_id: MUJER, mundo_id: RI })]);
    expect(f).toEqual({ gm: [a, c], resto_provisional: false, reaprobar: [] });
  });

  it("con todo aprobado no falta nada", () => {
    const f = faltantesDeCierre({ gm: [a, b], resto: true }, [vigente({}), vigente({ genero_id: MUJER, mundo_id: RI }), resto()]);
    expect(f).toEqual({ gm: [], resto_provisional: false, reaprobar: [] });
  });

  it("el Resto exigido y sin aprobar queda como provisional (el provisional no basta)", () => {
    const f = faltantesDeCierre({ gm: [a], resto: true }, [vigente({})]);
    expect(f).toEqual({ gm: [], resto_provisional: true, reaprobar: [] });
  });

  it("si no se exige el Resto, que sea provisional no bloquea", () => {
    expect(faltantesDeCierre({ gm: [a], resto: false }, [vigente({})])).toEqual({ gm: [], resto_provisional: false, reaprobar: [] });
  });

  it("sin vigentes falta todo lo exigido", () => {
    expect(faltantesDeCierre({ gm: [a, b], resto: true }, [])).toEqual({ gm: [a, b], resto_provisional: true, reaprobar: [] });
  });

  it("una aprobación de otro año no cuenta", () => {
    const f = faltantesDeCierre({ gm: [a], resto: true }, [vigente({ anio_aplicacion: 2026 }), resto({ anio_aplicacion: 2026 })], 2027);
    expect(f).toEqual({ gm: [a], resto_provisional: true, reaprobar: [] });
  });

  it("de punta a punta con gm_gml: 10 GM + Resto como en la medición de la ficha", () => {
    const mundos = ["m1", "m2", "m3", "m4", "m5"];
    const gmGml: Record<string, string> = {};
    mundos.forEach((m, i) => {
      gmGml[`h${i}`] = claveGM(HOMBRE, m);
      gmGml[`m${i}`] = claveGM(MUJER, m);
    });
    gmGml.otro = claveGM(NINO, "m1");
    const exigidos = gmExigidos(gmGml, DETALLADOS);
    expect(exigidos.gm).toHaveLength(10);
    expect(exigidos.resto).toBe(true);
    const aprobados = exigidos.gm.map((clave) => {
      const [genero_id, mundo_id] = clave.split("|");
      return vigente({ genero_id: genero_id as string, mundo_id: mundo_id as string });
    });
    expect(faltantesDeCierre(exigidos, aprobados)).toEqual({ gm: [], resto_provisional: true, reaprobar: [] });
    expect(faltantesDeCierre(exigidos, [...aprobados, resto()])).toEqual({ gm: [], resto_provisional: false, reaprobar: [] });
  });
});

// ─── 06e · sobre_base y reaprobar ───

describe("06e · sobre_base de lo vigente", () => {
  it("sobreBaseDe: ausente, null o desconocido es bruta; corregida solo si lo dice la versión", () => {
    expect(sobreBaseDe(undefined)).toBe("bruta");
    expect(sobreBaseDe(vigente({}))).toBe("bruta");
    expect(sobreBaseDe(vigente({ sobre_base: null }))).toBe("bruta");
    expect(sobreBaseDe(vigente({ sobre_base: "rara" }))).toBe("bruta");
    expect(sobreBaseDe(vigente({ sobre_base: "corregida" }))).toBe("corregida");
  });

  it("matrizDeVigentes lleva sobre por GM (sin dato = bruta) y el del Resto aprobado; sin Resto aprobado es corregida (provisional)", () => {
    const nuevo = vigente({ sobre_base: "corregida", genero_id: MUJER, mundo_id: RI });
    const viejo = vigente({ genero_id: HOMBRE, mundo_id: URBANO });
    const m = matrizDeVigentes([viejo, nuevo], DETALLADOS);
    expect(m.sobre?.get(claveGM(HOMBRE, URBANO))).toBe("bruta");
    expect(m.sobre?.get(claveGM(MUJER, RI))).toBe("corregida");
    expect(m.resto.sobre_base).toBe("corregida");
    expect(matrizDeVigentes([resto()], DETALLADOS).resto.sobre_base).toBe("bruta");
    expect(matrizDeVigentes([resto({ sobre_base: "corregida" })], DETALLADOS).resto.sobre_base).toBe("corregida");
  });

  it("R4 de punta a punta: la matriz alimenta crearCrecimientoDe con el sobre_base de cada fuente", () => {
    const m = matrizDeVigentes([vigente({ pct: 15 }), resto({ pct: 6, sobre_base: "corregida" })], DETALLADOS);
    const gmDe = (gml: string) => (gml === "n1" ? { genero_id: HOMBRE, mundo_id: URBANO, nombre: "HOMBRE · URBANO" } : undefined);
    const f = crearCrecimientoDe({ matriz: m, resto: 5, gmDe, pctFilaDe: (cb) => (cb === "|n1||propio" ? 3 : null) });
    expect(f("|n1||x")).toMatchObject({ origen: "celda", pct: 15, sobre_base: "bruta" });
    expect(f("|n1||propio")).toMatchObject({ origen: "fila", sobre_base: "corregida" });
    expect(f("|otro||x")).toMatchObject({ origen: "resto", pct: 5, provisional: false, sobre_base: "corregida" });
  });
});

describe("R17 · faltantesDeCierre con gmConNino: reaprobar", () => {
  const a = claveGM(HOMBRE, URBANO);
  const b = claveGM(MUJER, RI);
  const exigidos = { gm: [a, b], resto: true };
  const conNino: GmConNino = new Map([
    [a, { nombre: "HOMBRE · URBANO", correccion_pct: 6.8 }],
    ["resto", { nombre: "Resto", correccion_pct: 1.2 }],
  ]);

  it("una vigente bruta de un GM con Niño material entra en reaprobar, con su versión y la corrección", () => {
    const f = faltantesDeCierre(exigidos, [vigente({ version: 2 }), vigente({ genero_id: MUJER, mundo_id: RI }), resto({ sobre_base: "corregida" })], 2027, conNino);
    expect(f.reaprobar).toEqual([{ clave: a, nombre: "HOMBRE · URBANO", version: 2, correccion_pct: 6.8 }]);
    expect(f).toMatchObject({ gm: [], resto_provisional: false });
  });

  it("una bruta de un GM fuera de gmConNino no entra: la proyección cierra con ella (ejemplo E)", () => {
    const f = faltantesDeCierre(exigidos, [vigente({}), vigente({ genero_id: MUJER, mundo_id: RI }), resto()], 2027, new Map());
    expect(f.reaprobar).toEqual([]);
    const soloUrbano = faltantesDeCierre(exigidos, [vigente({}), vigente({ genero_id: MUJER, mundo_id: RI }), resto({ sobre_base: "corregida" })], 2027, new Map([[a, { nombre: "HOMBRE · URBANO", correccion_pct: 6.8 }]]));
    expect(soloUrbano.reaprobar.map((r) => r.clave)).toEqual([a]);
  });

  it("una versión corregida nunca se reaprueba, aunque el GM tenga Niño", () => {
    const f = faltantesDeCierre(exigidos, [vigente({ sobre_base: "corregida" }), vigente({ genero_id: MUJER, mundo_id: RI }), resto({ sobre_base: "corregida" })], 2027, conNino);
    expect(f.reaprobar).toEqual([]);
  });

  it("el Resto bruta con Niño material entra solo si se exige y hay uno aprobado", () => {
    const vs = [vigente({ sobre_base: "corregida" }), vigente({ genero_id: MUJER, mundo_id: RI, sobre_base: "corregida" }), resto({ version: 4 })];
    expect(faltantesDeCierre(exigidos, vs, 2027, conNino).reaprobar).toEqual([{ clave: "resto", nombre: "Resto", version: 4, correccion_pct: 1.2 }]);
    expect(faltantesDeCierre({ gm: [a, b], resto: false }, vs, 2027, conNino).reaprobar).toEqual([]);
    expect(faltantesDeCierre(exigidos, vs.slice(0, 2), 2027, conNino).reaprobar).toEqual([]);
  });

  it("un GM sin versión vigente va en gm (falta aprobar), no en reaprobar; sin gmConNino reaprobar sale vacío", () => {
    const f = faltantesDeCierre(exigidos, [], 2027, conNino);
    expect(f.gm).toEqual([a, b]);
    expect(f.reaprobar).toEqual([]);
    expect(faltantesDeCierre(exigidos, [vigente({})], 2027).reaprobar).toEqual([]);
  });

  it("solo cuentan las versiones del año pedido", () => {
    const f = faltantesDeCierre(exigidos, [vigente({ anio_aplicacion: 2026 })], 2027, conNino);
    expect(f.reaprobar).toEqual([]);
  });
});
