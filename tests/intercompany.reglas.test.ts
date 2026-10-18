import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  aplicable,
  armarPctDirectoObservado,
  fraccionAPuntos,
  esRangoDefecto,
  fueraDeAmbito,
  hastaDerivado,
  mesAnterior,
  motivoRechazoRegla,
  pctCd,
  reglaAnterior,
  reglaIntercompany,
  reglaVigente,
  secuenciaPorClave,
  type EntradaRechazo,
  type ReglaBase,
} from "@/lib/intercompany/reglas";
import { pctDirectoObservado } from "@/lib/intercompany/subflujo";
import { EQ, GEN, MARCA, MUN, NODO, REGLA, SEMILLAS, filasCerrada0100, filasCerrada0101, marcasDb } from "./intercompany.fixture";

/** Reglas de negocio puras de M13 (ficha 13, sección 8, reglas 1 a 4, 6, 7 y 9). Sin base ni reloj. */

const base = (s: (typeof SEMILLAS)[number], extra: Partial<ReglaBase> = {}): ReglaBase => ({
  id: s.id,
  marca_id: s.marca_id,
  genero_mundo_linea_id: s.gml,
  equivalencia_id: s.eq,
  vigente_desde: s.desde,
  ...extra,
});
const REGLAS = SEMILLAS.map((s) => base(s));
const jh = (gml: string, eq: string | null) => ({ marca_id: MARCA.jh, genero_mundo_linea_id: gml, equivalencia_id: eq });

describe("regla 1: vigente por mes", () => {
  // JH·CAMISA en ene-2026 y jun-2026 (la segunda con otro id).
  const dos: ReglaBase[] = [
    { id: "r-ene", ...jh(NODO.camisa, null), vigente_desde: "2026-01" },
    { id: "r-jun", ...jh(NODO.camisa, null), vigente_desde: "2026-06" },
  ];
  it("en mayo rige la de enero, en junio la de junio y en diciembre de 2025 ninguna", () => {
    expect(reglaVigente(dos, jh(NODO.camisa, null), "2026-05")?.id).toBe("r-ene");
    expect(reglaVigente(dos, jh(NODO.camisa, null), "2026-06")?.id).toBe("r-jun");
    expect(reglaVigente(dos, jh(NODO.camisa, null), "2026-12")?.id).toBe("r-jun");
    expect(reglaVigente(dos, jh(NODO.camisa, null), "2025-12")).toBeNull();
  });
  it("el orden de entrada no importa y una regla inactiva no cuenta", () => {
    expect(reglaVigente([...dos].reverse(), jh(NODO.camisa, null), "2026-07")?.id).toBe("r-jun");
    const conInactiva = dos.map((r) => (r.id === "r-jun" ? { ...r, activo: false } : r));
    expect(reglaVigente(conInactiva, jh(NODO.camisa, null), "2026-07")?.id).toBe("r-ene");
    expect(reglaVigente(conInactiva.map((r) => ({ ...r, activo: false })), jh(NODO.camisa, null), "2026-07")).toBeNull();
  });
  it("otra marca u otro nodo no se mezclan", () => {
    expect(reglaVigente(dos, { ...jh(NODO.camisa, null), marca_id: MARCA.vh }, "2026-07")).toBeNull();
    expect(reglaVigente(dos, jh(NODO.terno, null), "2026-07")).toBeNull();
  });
});

describe("regla 2: la más específica manda", () => {
  it("la equivalencia con regla propia usa la suya; las demás, la del GML", () => {
    expect(reglaIntercompany(REGLAS, MARCA.jh, NODO.camisa, EQ.corta, "2026-07")?.id).toBe(REGLA.jhCorta);
    expect(reglaIntercompany(REGLAS, MARCA.jh, NODO.camisa, EQ.larga, "2026-07")?.id).toBe(REGLA.jhCamisa);
    expect(reglaIntercompany(REGLAS, MARCA.jh, NODO.camisa, null, "2026-07")?.id).toBe(REGLA.jhCamisa);
  });
  it("mientras la específica no rige (mayo) manda la del GML (caso 2 de la ficha)", () => {
    expect(reglaIntercompany(REGLAS, MARCA.jh, NODO.camisa, EQ.corta, "2026-05")?.id).toBe(REGLA.jhCamisa);
  });
  it("sin regla del GML, la equivalencia sin regla propia no tiene ninguna", () => {
    const sinGml = REGLAS.filter((r) => r.id !== REGLA.jhCamisa);
    expect(reglaIntercompany(sinGml, MARCA.jh, NODO.camisa, EQ.larga, "2026-07")).toBeNull();
    expect(reglaIntercompany(sinGml, MARCA.jh, NODO.camisa, EQ.corta, "2026-07")?.id).toBe(REGLA.jhCorta);
  });
});

describe("regla 3: hasta derivado", () => {
  const conJunio: ReglaBase[] = [...REGLAS, { id: "jh-ago", ...jh(NODO.camisa, null), vigente_desde: "2026-08" }];
  it("la regla anterior de la MISMA clave exacta termina el mes antes de la siguiente", () => {
    expect(hastaDerivado(conJunio, REGLAS[0])).toBe("2026-07");
    expect(hastaDerivado(conJunio, conJunio[6])).toBeNull();
  });
  it("una regla de la equivalencia no cierra la del GML (caso 6 de la ficha)", () => {
    expect(hastaDerivado(REGLAS, REGLAS[0])).toBeNull();
    expect(hastaDerivado(REGLAS, REGLAS[1])).toBeNull();
  });
  it("cruza el cambio de año y salta reglas inactivas", () => {
    const r: ReglaBase[] = [
      { id: "a", ...jh(NODO.terno, null), vigente_desde: "2025-06" },
      { id: "b", ...jh(NODO.terno, null), vigente_desde: "2026-01", activo: false },
      { id: "c", ...jh(NODO.terno, null), vigente_desde: "2026-03" },
    ];
    expect(hastaDerivado(r, r[0])).toBe("2026-02");
    expect(mesAnterior("2026-01")).toBe("2025-12");
    expect(mesAnterior("2026-12")).toBe("2026-11");
  });
  it("eliminar la de junio deja la de enero abierta y `reglaAnterior` apunta a enero", () => {
    const r: ReglaBase[] = [
      { id: "ene", ...jh(NODO.camisa, null), vigente_desde: "2026-01" },
      { id: "jun", ...jh(NODO.camisa, null), vigente_desde: "2026-06" },
    ];
    expect(reglaAnterior(r, r[1])?.id).toBe("ene");
    expect(hastaDerivado(r.filter((x) => x.id !== "jun"), r[0])).toBeNull();
    expect(reglaAnterior(r, r[0])).toBeNull();
    // La específica de MANGA CORTA no tiene anterior: la clave exacta queda sin reglas.
    expect(reglaAnterior(REGLAS, REGLAS[1])).toBeNull();
  });
});

describe("regla 4: aplicable según la cerrada de M7", () => {
  const cerrada = filasCerrada0101();
  const vieja = filasCerrada0100();
  it("JH con clave unidad en CAMISA (0,40) → aplicable", () => {
    expect(aplicable({ marca_id: MARCA.jh, genero_mundo_linea_id: NODO.camisa }, cerrada)).toEqual({ aplicable: true, motivo: null });
    expect(aplicable({ marca_id: MARCA.jh, genero_mundo_linea_id: NODO.camisa }, vieja)).toEqual({ aplicable: true, motivo: null });
  });
  it("BETA al barrer con clave `barrido` en TERNO (0,50) → aplicable, sin reparto de M12", () => {
    expect(aplicable({ marca_id: MARCA.beta, genero_mundo_linea_id: NODO.terno }, cerrada).aplicable).toBe(true);
    expect(aplicable({ marca_id: MARCA.beta, genero_mundo_linea_id: NODO.terno }, vieja).aplicable).toBe(true);
  });
  it("VAN HEUSEN sin tratamiento: aplicable con una cerrada 0.10.1 (por_marca) y no con una 0.10.0", () => {
    expect(aplicable({ marca_id: MARCA.vh, genero_mundo_linea_id: NODO.polo }, cerrada)).toEqual({ aplicable: true, motivo: null });
    expect(aplicable({ marca_id: MARCA.vh, genero_mundo_linea_id: NODO.polo }, vieja)).toEqual({ aplicable: false, motivo: "marca_sin_clave" });
  });
  it("sin cerrada → null con sin_cerrada; sin fila del nodo o participación 0 → marca_sin_clave", () => {
    expect(aplicable({ marca_id: MARCA.jh, genero_mundo_linea_id: NODO.camisa }, null)).toEqual({ aplicable: null, motivo: "sin_cerrada" });
    expect(aplicable({ marca_id: MARCA.jh, genero_mundo_linea_id: NODO.urbano }, cerrada)).toEqual({ aplicable: false, motivo: "marca_sin_clave" });
    expect(aplicable({ marca_id: MARCA.jh, genero_mundo_linea_id: NODO.polo }, cerrada)).toEqual({ aplicable: false, motivo: "marca_sin_clave" });
    expect(aplicable({ marca_id: MARCA.jh, genero_mundo_linea_id: NODO.camisa }, [])).toEqual({ aplicable: false, motivo: "marca_sin_clave" });
  });
  it("una fila con por_marca manda sobre su por_clave_flujo (la marca con participación 0 en por_marca no se rescata)", () => {
    const fila = { gml_id: NODO.polo, por_clave_flujo: [{ marca_id: MARCA.vh, participacion: 0.5 }], por_marca: [{ marca_id: MARCA.vh, participacion: 0 }] };
    expect(aplicable({ marca_id: MARCA.vh, genero_mundo_linea_id: NODO.polo }, [fila]).aplicable).toBe(false);
    expect(aplicable({ marca_id: MARCA.vh, genero_mundo_linea_id: NODO.polo }, [{ ...fila, por_marca: null }]).aplicable).toBe(true);
  });
});

describe("regla 6: ámbito (informativo)", () => {
  const nodo = (generoCodigo: string, genero: string, mundo: string) => ({ genero: { codigo: generoCodigo, nombre: genero }, mundo: { codigo: mundo, nombre: mundo } });
  it("HOMBRE · FORMAL, CASUAL y RI → dentro", () => {
    expect(fueraDeAmbito(nodo("H", "HOMBRE", "FORMAL"))).toBe(false);
    expect(fueraDeAmbito(nodo("H", "HOMBRE", "CASUAL"))).toBe(false);
    expect(fueraDeAmbito(nodo("H", "HOMBRE", "RI"))).toBe(false);
  });
  it("MUJER · CASUAL y HOMBRE · URBANO → fuera", () => {
    expect(fueraDeAmbito(nodo("M", "MUJER", "CASUAL"))).toBe(true);
    expect(fueraDeAmbito(nodo("H", "HOMBRE", "URBANO"))).toBe(true);
  });
  it("compara por nombre o por código, sin importar mayúsculas ni espacios", () => {
    expect(fueraDeAmbito({ genero: { codigo: "HOMBRE", nombre: "x" }, mundo: { codigo: "ri", nombre: " ri " } })).toBe(false);
    expect(fueraDeAmbito({ genero: { nombre: "Hombre" }, mundo: { nombre: "Formal" } })).toBe(false);
  });
});

describe("regla 7: secuencia por clave", () => {
  it("ordena por vigente_desde, agrupa por clave exacta y no cuenta las inactivas", () => {
    const r: ReglaBase[] = [
      { id: "b", ...jh(NODO.camisa, null), vigente_desde: "2026-06" },
      { id: "a", ...jh(NODO.camisa, null), vigente_desde: "2026-01" },
      { id: "e", ...jh(NODO.camisa, EQ.corta), vigente_desde: "2026-03" },
      { id: "x", ...jh(NODO.camisa, null), vigente_desde: "2026-09", activo: false },
    ];
    const s = secuenciaPorClave(r);
    expect(s.size).toBe(2);
    expect([...s.values()].map((l) => l.map((x) => x.id))).toEqual(expect.arrayContaining([["a", "b"], ["e"]]));
    for (const lista of s.values()) {
      const meses = lista.map((x) => x.vigente_desde);
      expect(new Set(meses).size).toBe(meses.length);
      expect(meses).toEqual([...meses].sort());
    }
  });
});

describe("regla 8: determinismo", () => {
  it("misma entrada, misma salida, y las funciones no mutan lo que reciben", () => {
    const copia = JSON.stringify(REGLAS);
    const a = reglaIntercompany(REGLAS, MARCA.jh, NODO.camisa, EQ.corta, "2026-07");
    const b = reglaIntercompany(REGLAS, MARCA.jh, NODO.camisa, EQ.corta, "2026-07");
    expect(a).toEqual(b);
    expect(JSON.stringify(REGLAS)).toBe(copia);
    expect(hastaDerivado(REGLAS, REGLAS[0])).toBe(hastaDerivado(REGLAS, REGLAS[0]));
  });
});

describe("regla 9: rechazos al crear (motivoRechazoRegla)", () => {
  const marcas = marcasDb() as unknown as EntradaRechazo["marcas"];
  const nodo = (id: string, extra: Record<string, unknown> = {}) => ({ id, ruta: "HOMBRE · FORMAL · CAMISA", vigente: true, motivo_no_vigente: null, nivel_planificacion: "GMLE", ...extra });
  const entrada = (marcaId: string, extra: Partial<EntradaRechazo> = {}): EntradaRechazo => ({
    marca: marcas.find((m) => m.id === marcaId),
    marcas,
    nodo: nodo(NODO.camisa),
    equivalencia_id: null,
    equivalencia: undefined,
    ...extra,
  });
  const libre = { existentes: REGLAS, vigente_desde: "2027-01" };

  it("una regla válida no se rechaza", () => {
    expect(motivoRechazoRegla(entrada(MARCA.jh), libre)).toBeNull();
    expect(motivoRechazoRegla(entrada(MARCA.jh, { equivalencia_id: EQ.larga, equivalencia: { id: EQ.larga, genero_mundo_linea_id: NODO.camisa } }), libre)).toBeNull();
  });
  it("miembro de conjunto (JOHN) → marca_en_conjunto con 'usa JOHN HOLDEN (cabeza)'", () => {
    const r = motivoRechazoRegla(entrada(MARCA.john), libre);
    expect(r).toMatchObject({ codigo: "marca_en_conjunto", status: 409 });
    expect(r?.mensaje).toContain("usa JOHN HOLDEN (cabeza)");
  });
  it("VARIOS → marca_generica; marca inactiva → marca_inactiva; JOHN HOLDEN UNDERWEAR (otra unidad) se acepta", () => {
    expect(motivoRechazoRegla(entrada(MARCA.varios), libre)).toMatchObject({ codigo: "marca_generica", status: 409 });
    expect(motivoRechazoRegla(entrada(MARCA.inactiva), libre)).toMatchObject({ codigo: "marca_inactiva", status: 409 });
    expect(motivoRechazoRegla(entrada(MARCA.underwear), libre)).toBeNull();
  });
  it("marca, nodo o equivalencia inexistentes → 404", () => {
    expect(motivoRechazoRegla(entrada(MARCA.jh, { marca: undefined }), libre)).toMatchObject({ codigo: "marca_no_encontrada", status: 404 });
    expect(motivoRechazoRegla(entrada(MARCA.jh, { nodo: undefined }), libre)).toMatchObject({ codigo: "nodo_no_encontrado", status: 404 });
    expect(motivoRechazoRegla(entrada(MARCA.jh, { equivalencia_id: EQ.larga, equivalencia: undefined }), libre)).toMatchObject({ codigo: "equivalencia_no_encontrada", status: 404 });
  });
  it("nodo no vigente → nodo_no_vigente con el motivo; equivalencia de otro nodo; nodo que no es GMLE", () => {
    const nv = motivoRechazoRegla(entrada(MARCA.jh, { nodo: nodo(NODO.inactivo, { vigente: false, motivo_no_vigente: "nodo inactivo" }) }), libre);
    expect(nv).toMatchObject({ codigo: "nodo_no_vigente", status: 409 });
    expect(nv?.mensaje).toContain("nodo inactivo");
    expect(
      motivoRechazoRegla(entrada(MARCA.jh, { equivalencia_id: EQ.ternoX, equivalencia: { id: EQ.ternoX, genero_mundo_linea_id: NODO.terno } }), libre)
    ).toMatchObject({ codigo: "equivalencia_de_otro_nodo", status: 409 });
    expect(
      motivoRechazoRegla(
        entrada(MARCA.donatelli, { nodo: nodo(NODO.terno, { nivel_planificacion: "GML" }), equivalencia_id: EQ.ternoX, equivalencia: { id: EQ.ternoX, genero_mundo_linea_id: NODO.terno } }),
        libre
      )
    ).toMatchObject({ codigo: "nodo_no_gmle", status: 409 });
  });
  it("clave y mes repetidos → clave_mes_repetido; la misma clave en otro mes o la equivalencia con el mismo mes se aceptan", () => {
    expect(motivoRechazoRegla(entrada(MARCA.jh), { existentes: REGLAS, vigente_desde: "2026-01" })).toMatchObject({ codigo: "clave_mes_repetido", status: 409 });
    expect(motivoRechazoRegla(entrada(MARCA.jh), { existentes: REGLAS, vigente_desde: "2026-02" })).toBeNull();
    const eqLarga = { equivalencia_id: EQ.larga, equivalencia: { id: EQ.larga, genero_mundo_linea_id: NODO.camisa } };
    expect(motivoRechazoRegla(entrada(MARCA.jh, eqLarga), { existentes: REGLAS, vigente_desde: "2026-01" })).toBeNull();
  });
});

describe("ayudas", () => {
  it("el rango por defecto es 4–8 exactos y pct_cd no arrastra decimales de coma flotante", () => {
    expect(esRangoDefecto(4, 8)).toBe(true);
    expect(esRangoDefecto(3, 6)).toBe(false);
    expect(esRangoDefecto(4, 9)).toBe(false);
    expect(pctCd(80)).toBe(20);
    expect(pctCd(85)).toBe(15);
    expect(pctCd(80.1)).toBe(19.9);
    expect(pctCd(0)).toBe(100);
  });
  it("los ids del fixture son UUID válidos (los esquemas zod los exigen)", () => {
    for (const id of [GEN.hombre, MUN.formal, MARCA.jh, NODO.camisa, EQ.corta, REGLA.jhCamisa]) expect(z.uuid().safeParse(id).success, id).toBe(true);
  });
});

describe("unidad de pct_directo_observado: M8 calcula FRACCIÓN 0–1, el contrato de M13 va en PUNTOS 0–100", () => {
  it("fraccionAPuntos: 0,8 → 80, 0,1234 → 12,34, 0 → 0, 1 → 100 (sin ruido de coma flotante)", () => {
    expect(fraccionAPuntos(0.8)).toBe(80);
    expect(fraccionAPuntos(0.1234)).toBe(12.34);
    expect(fraccionAPuntos(0.07)).toBe(7);
    expect(fraccionAPuntos(0)).toBe(0);
    expect(fraccionAPuntos(1)).toBe(100);
  });
  it("pctDirectoObservado sigue devolviendo fracción y armarPctDirectoObservado la expone en puntos, con el mismo caso de la ficha (384, 0, 480)", () => {
    const fraccion = pctDirectoObservado(384, 0, 480);
    expect(fraccion).toBeCloseTo(0.8, 12);
    expect(armarPctDirectoObservado("2026-09", fraccion)).toEqual({ periodo: "2026-09", valor: 80 });
    expect(armarPctDirectoObservado("2026-09", pctDirectoObservado(384, 384, 480))).toEqual({ periodo: "2026-09", valor: 0 });
  });
  it("sin dato (V = 0) el contrato lleva null", () => {
    expect(armarPctDirectoObservado("2026-09", pctDirectoObservado(384, 0, 0))).toBeNull();
  });
  it("el valor del contrato es comparable con pct_directo (puntos): 80 observado contra 80 de la regla", () => {
    const observado = armarPctDirectoObservado("2026-09", pctDirectoObservado(384, 0, 480));
    expect(observado?.valor).toBe(80);
  });
});

describe("regla 9: equivalencia inactiva", () => {
  const marcas = marcasDb() as unknown as EntradaRechazo["marcas"];
  const base = (activo?: boolean): EntradaRechazo => ({
    marca: marcas.find((m) => m.id === MARCA.jh),
    marcas,
    nodo: { id: NODO.camisa, ruta: "HOMBRE · FORMAL · CAMISA", vigente: true, motivo_no_vigente: null, nivel_planificacion: "GMLE" },
    equivalencia_id: EQ.larga,
    equivalencia: { id: EQ.larga, genero_mundo_linea_id: NODO.camisa, ...(activo === undefined ? {} : { activo }) },
  });
  const libre = { existentes: [], vigente_desde: "2027-01" };
  it("inactiva → 409 equivalencia_inactiva; activa o sin dato de activo → se acepta", () => {
    expect(motivoRechazoRegla(base(false), libre)).toMatchObject({ codigo: "equivalencia_inactiva", status: 409 });
    expect(motivoRechazoRegla(base(true), libre)).toBeNull();
    expect(motivoRechazoRegla(base(), libre)).toBeNull();
  });
  it("la de otro nodo se rechaza antes que la inactiva", () => {
    const e = base(false);
    expect(motivoRechazoRegla({ ...e, equivalencia: { id: EQ.ternoX, genero_mundo_linea_id: NODO.terno, activo: false } }, libre)).toMatchObject({ codigo: "equivalencia_de_otro_nodo" });
  });
});
