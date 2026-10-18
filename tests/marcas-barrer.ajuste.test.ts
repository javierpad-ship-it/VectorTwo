import { describe, expect, it } from "vitest";
import {
  alcanceParaCuerpo,
  compararConVigente,
  editarCelda,
  estadoAprobacion,
  filasAjustables,
  filasParaAprobar,
  hayAjustes,
  hayEdiciones,
  leerPorcentaje,
  renormalizarResto,
  sePuedeAjustar,
  SIN_AJUSTES,
  sumaVector,
  temporadasDe,
  valorEfectivo,
  expandirRestoPantalla,
  type EstadoAjuste,
  type FilaAjustable,
} from "../src/app/(app)/planificacion/marcas-barrer/ajuste";
import { puedeAprobar } from "../src/lib/marcas-barrer/reparto";
import { analisisBeta, filaApi, GEN_H, MUN_CASUAL } from "./marcas-barrer.pantalla.fixture";

/** Lógica pura del bloque 1 de M12: filas ajustables, edición, renormalización, aprobación y cuerpo del POST (ficha 12, regla 10). */

const P_DEFECTO = { ventana_meses: 24, alcance: { generos: [] as string[], mundos: [] as string[], lineas: [] as string[] }, fuente: "historico" as const };

/** Cuatro filas con el reparto de la ficha: [41, 30, 17, 12] en el vector anual. */
function filasFicha(): FilaAjustable[] {
  const base = [41, 30, 17, 12];
  const filas = base.map((v, i) =>
    filaApi({ clave: `g${i}`, ruta: `RUTA ${i}`, unidades: 1000 - i, verano: [v / 100, null], invierno: [v / 100, null] })
  );
  return filasAjustables({ filas, restos: [] }, "historico");
}

describe("filas ajustables y temporadas", () => {
  const analisis = analisisBeta();

  it("una fila por GML con venta dentro del alcance; los pequeños van en su resto; el fuera de alcance no entra", () => {
    const filas = filasAjustables(analisis, "historico");
    expect(filas.map((f) => f.etiqueta)).toEqual([
      "HOMBRE · URBANO · DENIM",
      "HOMBRE · CASUAL · POLO",
      "HOMBRE · FORMAL · CAMISA › MANGA LARGA",
      "Resto de HOMBRE · CASUAL",
    ]);
    expect(filas[3].tipo).toBe("resto");
    expect(filas[3].miembros).toHaveLength(2);
  });

  it("las temporadas salen en el orden verano, invierno; en modo anual hay un solo vector", () => {
    expect(temporadasDe(analisis)).toEqual(["verano", "invierno"]);
    const anual = { ...analisis, filas: analisis.filas.map((f) => ({ ...f, p2: f.p2.slice(0, 1).map((x) => ({ ...x, temporada: null })) })), restos: [] };
    expect(temporadasDe(anual)).toEqual(["anual"]);
  });

  it("cada vector suma 100 con el histórico y con la cerrada", () => {
    const h = filasAjustables(analisis, "historico");
    const c = filasAjustables(analisis, "cerrada");
    for (const t of ["verano", "invierno"] as const) {
      expect(sumaVector(h, t, SIN_AJUSTES)).toBeCloseTo(100, 9);
      expect(sumaVector(c, t, SIN_AJUSTES)).toBeCloseTo(100, 9);
    }
    // El candidato de la cerrada cambia lo calculado, no lo histórico que se muestra al lado.
    expect(h[0].calculado.verano).toBeCloseTo(41, 9);
    expect(c[0].calculado.verano).toBeCloseTo(43, 9);
    expect(c[0].historico.verano).toBeCloseTo(41, 9);
  });
});

describe("edición de una celda", () => {
  it("leerPorcentaje acepta coma o punto, acota a 0–100 con un decimal y rechaza lo no numérico", () => {
    expect(leerPorcentaje("41,56")).toBe(41.6);
    expect(leerPorcentaje(" 7.04 % ")).toBe(7);
    expect(leerPorcentaje("150")).toBe(100);
    expect(leerPorcentaje("-3")).toBe(0);
    expect(leerPorcentaje("")).toBeNull();
    expect(leerPorcentaje("abc")).toBeNull();
  });

  it("escribir un valor distinto lo marca editado; escribir el mismo que muestra, o vaciar, deshace la edición", () => {
    const filas = filasFicha();
    let e: EstadoAjuste = editarCelda(SIN_AJUSTES, filas[0], "verano", 50);
    expect(valorEfectivo(filas[0], "verano", e)).toBe(50);
    expect(hayEdiciones(e)).toBe(true);
    e = editarCelda(e, filas[0], "verano", 41);
    expect(hayEdiciones(e)).toBe(false);
    e = editarCelda(e, filas[0], "verano", 50);
    e = editarCelda(e, filas[0], "verano", null);
    expect(hayEdiciones(e)).toBe(false);
  });

  it("una fila sin reparto calculado en esa temporada no se puede ajustar: el valor se perdería en el servidor", () => {
    const filas = filasAjustables(analisisBeta(), "cerrada").map((f, i) => (i === 1 ? { ...f, calculado: { ...f.calculado, verano: 0 } } : f));
    expect(sePuedeAjustar(filas[1], "verano")).toBe(false);
    expect(sePuedeAjustar(filas[1], "invierno")).toBe(true);
    expect(editarCelda(SIN_AJUSTES, filas[1], "verano", 10)).toBe(SIN_AJUSTES);
    expect(hayEdiciones(editarCelda(SIN_AJUSTES, filas[1], "invierno", 10))).toBe(true);
  });

  it("al editar, la suma deja de ser 100 y lo escalado antes se descarta", () => {
    const filas = filasFicha();
    let e = editarCelda(SIN_AJUSTES, filas[0], "verano", 50);
    expect(sumaVector(filas, "verano", e)).toBeCloseTo(109, 9);
    const r = renormalizarResto(filas, "verano", e);
    expect(r.ok).toBe(true);
    e = r.estado;
    expect(sumaVector(filas, "verano", e)).toBeCloseTo(100, 9);
    e = editarCelda(e, filas[1], "verano", 20);
    expect(e.escaladas.verano).toBeUndefined();
    expect(Math.abs(sumaVector(filas, "verano", e) - 100)).toBeGreaterThan(0.05);
  });
});

describe("renormalizar el resto (ejemplo de la ficha)", () => {
  it("[41, 30, 17, 12] con la primera en 50 → [50, 25.4, 14.4, 10.2], suma exacta", () => {
    const filas = filasFicha();
    const e = editarCelda(SIN_AJUSTES, filas[0], "verano", 50);
    const r = renormalizarResto(filas, "verano", e);
    expect(r.ok).toBe(true);
    expect(filas.map((f) => valorEfectivo(f, "verano", r.estado))).toEqual([50, 25.4, 14.4, 10.2]);
    expect(sumaVector(filas, "verano", r.estado)).toBeCloseTo(100, 9);
    // El invierno no se toca.
    expect(filas.map((f) => valorEfectivo(f, "invierno", r.estado))).toEqual([41, 30, 17, 12]);
  });

  it("explica por qué no puede: sin otras filas, con lo escrito pasado de 100", () => {
    const filas = filasFicha();
    let e = SIN_AJUSTES;
    for (const f of filas) e = editarCelda(e, f, "verano", 25);
    const sinOtras = renormalizarResto(filas, "verano", e);
    expect(sinOtras.ok).toBe(false);
    expect(sinOtras.ok === false && sinOtras.motivo).toContain("No hay otras filas");
    let pasado = editarCelda(SIN_AJUSTES, filas[0], "verano", 70);
    pasado = editarCelda(pasado, filas[1], "verano", 50);
    const r = renormalizarResto(filas, "verano", pasado);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.motivo).toContain("pasa de 100");
  });

  it("una fila sin reparto calculado no recibe peso al renormalizar", () => {
    const analisis = analisisBeta();
    const filas = filasAjustables(analisis, "cerrada");
    // Con la fuente cerrada, una fila sin cerrada vale 0 y sigue en 0.
    const sin = filas.map((f, i) => (i === 1 ? { ...f, calculado: { ...f.calculado, verano: 0 } } : f));
    const e = editarCelda(SIN_AJUSTES, sin[0], "verano", 20);
    const r = renormalizarResto(sin, "verano", e);
    expect(r.ok).toBe(true);
    expect(valorEfectivo(sin[1], "verano", r.estado)).toBe(0);
    expect(sumaVector(sin, "verano", r.estado)).toBeCloseTo(100, 9);
  });
});

describe("cuándo se puede aprobar", () => {
  const analisis = analisisBeta();
  const filas = filasAjustables(analisis, "historico");
  const temporadas = temporadasDe(analisis);

  it("lo calculado, sin ajuste, ventana de 24, histórico y sin alcance: se aprueba sin nota", () => {
    const a = estadoAprobacion(filas, temporadas, SIN_AJUSTES, P_DEFECTO, "");
    expect(a.bloqueos).toEqual([]);
    expect(a.notaRequerida).toBe(false);
  });

  it("un ajuste sin renormalizar bloquea (suma ≠ 100) y exige nota", () => {
    const e = editarCelda(SIN_AJUSTES, filas[0], "verano", 50);
    const a = estadoAprobacion(filas, temporadas, e, P_DEFECTO, "");
    expect(a.sumaInvalida).toEqual(["verano"]);
    expect(a.bloqueos.some((b) => b.startsWith("Verano suma 109.0 %"))).toBe(true);
    expect(a.notaRequerida).toBe(true);
    expect(a.razonesNota).toContain("ajustaste algún porcentaje");
  });

  it("tras renormalizar, solo falta la nota; con nota se aprueba", () => {
    let e = editarCelda(SIN_AJUSTES, filas[0], "verano", 50);
    e = renormalizarResto(filas, "verano", e).estado;
    expect(estadoAprobacion(filas, temporadas, e, P_DEFECTO, "").bloqueos).toEqual(["Escribe una nota: ajustaste algún porcentaje."]);
    expect(estadoAprobacion(filas, temporadas, e, P_DEFECTO, "  Se compra más denim  ").bloqueos).toEqual([]);
  });

  it("ventana distinta de 24, fuente cerrada o alcance exigen nota aunque no haya ajuste", () => {
    expect(estadoAprobacion(filas, temporadas, SIN_AJUSTES, { ...P_DEFECTO, ventana_meses: 12 }, "").razonesNota).toEqual(["la ventana no es la de 24 meses"]);
    expect(estadoAprobacion(filas, temporadas, SIN_AJUSTES, { ...P_DEFECTO, fuente: "cerrada" }, "").razonesNota).toEqual(["la fuente es la cerrada"]);
    const conAlcance = { ...P_DEFECTO, alcance: { generos: [GEN_H], mundos: [], lineas: [] } };
    const a = estadoAprobacion(filas, temporadas, SIN_AJUSTES, conAlcance, "");
    expect(a.razonesNota).toEqual(["el reparto tiene alcance"]);
    expect(a.bloqueos).toHaveLength(1);
  });

  it("la nota pasa de 300 caracteres: bloquea", () => {
    const a = estadoAprobacion(filas, temporadas, SIN_AJUSTES, P_DEFECTO, "x".repeat(301));
    expect(a.bloqueos).toEqual(["La nota pasa de 300 caracteres."]);
  });

  it("sin filas no hay nada que aprobar (marca sin venta al barrer)", () => {
    const a = estadoAprobacion([], [], SIN_AJUSTES, P_DEFECTO, "");
    expect(a.bloqueos[0]).toContain("No hay reparto que aprobar");
  });

  it("coincide con `puedeAprobar` del servidor: la pantalla no habilita lo que el servidor rechazaría", () => {
    const casos: { e: EstadoAjuste; nota: string; p: typeof P_DEFECTO }[] = [
      { e: SIN_AJUSTES, nota: "", p: P_DEFECTO },
      { e: editarCelda(SIN_AJUSTES, filas[0], "verano", 50), nota: "x", p: P_DEFECTO },
      { e: renormalizarResto(filas, "verano", editarCelda(SIN_AJUSTES, filas[0], "verano", 50)).estado, nota: "", p: P_DEFECTO },
      { e: renormalizarResto(filas, "verano", editarCelda(SIN_AJUSTES, filas[0], "verano", 50)).estado, nota: "ok", p: P_DEFECTO },
      { e: SIN_AJUSTES, nota: "", p: { ...P_DEFECTO, ventana_meses: 36 } },
      { e: SIN_AJUSTES, nota: "con nota", p: { ...P_DEFECTO, ventana_meses: 36 } },
    ];
    for (const c of casos) {
      const vectores = new Map(temporadas.map((t) => [t, filas.map((f) => valorEfectivo(f, t, c.e) / 100)]));
      const servidor = puedeAprobar({
        vectores,
        nota: c.nota,
        hay_ajuste: hayAjustes(filas, temporadas, c.e),
        ventana_meses: c.p.ventana_meses,
        fuente: c.p.fuente,
        alcance_vacio: true,
      });
      const pantalla = estadoAprobacion(filas, temporadas, c.e, c.p, c.nota);
      expect(pantalla.bloqueos.length === 0, JSON.stringify(c)).toBe(servidor === null);
    }
  });
});

describe("cuerpo del POST: filas expandidas por GML", () => {
  const analisis = analisisBeta();
  const filas = filasAjustables(analisis, "historico");
  const temporadas = temporadasDe(analisis);

  it("sin ajuste todas las filas van con participacion_ajustada null y una por GML y temporada (los pequeños también)", () => {
    const cuerpo = filasParaAprobar(filas, temporadas, SIN_AJUSTES);
    expect(cuerpo).toHaveLength(5 * 2);
    expect(cuerpo.every((f) => f.participacion_ajustada === null)).toBe(true);
    expect(cuerpo.map((f) => f.genero_mundo_linea_id)).not.toContain("gml-sandalia");
    expect(new Set(cuerpo.map((f) => f.temporada))).toEqual(new Set(["verano", "invierno"]));
  });

  it("una fila ajustada va con su fracción y las demás con null; el fuera de alcance nunca viaja", () => {
    const e = editarCelda(SIN_AJUSTES, filas[0], "verano", 50);
    const cuerpo = filasParaAprobar(filas, temporadas, e);
    const denim = cuerpo.filter((f) => f.genero_mundo_linea_id === "gml-denim");
    expect(denim.find((f) => f.temporada === "verano")?.participacion_ajustada).toBe(0.5);
    expect(denim.find((f) => f.temporada === "invierno")?.participacion_ajustada).toBeNull();
    expect(cuerpo.filter((f) => f.participacion_ajustada !== null)).toHaveLength(1);
  });

  it("un resto editado se expande entre sus miembros en proporción a su peso y la suma es exacta", () => {
    const resto = filas.find((f) => f.tipo === "resto") as FilaAjustable;
    const e = editarCelda(SIN_AJUSTES, resto, "verano", 20); // el resto calculado era 12 %
    const cuerpo = filasParaAprobar(filas, temporadas, e).filter((f) => f.temporada === "verano" && ["gml-peq1", "gml-peq2"].includes(f.genero_mundo_linea_id));
    // Pesos 0.07 y 0.05 → 7/12 y 5/12 de 0.20.
    expect(cuerpo.map((f) => f.participacion_ajustada)).toEqual([0.1167, 0.0833]);
    expect((cuerpo[0].participacion_ajustada as number) + (cuerpo[1].participacion_ajustada as number)).toBeCloseTo(0.2, 9);
  });

  it("un resto sin tocar manda null en todos sus miembros", () => {
    const cuerpo = filasParaAprobar(filas, temporadas, SIN_AJUSTES).filter((f) => f.genero_mundo_linea_id.startsWith("gml-peq"));
    expect(cuerpo).toHaveLength(4);
    expect(cuerpo.every((f) => f.participacion_ajustada === null)).toBe(true);
  });

  it("con todo renormalizado, cada vector del cuerpo suma 1 ± 0.0005", () => {
    let e = editarCelda(SIN_AJUSTES, filas[0], "verano", 50);
    e = renormalizarResto(filas, "verano", e).estado;
    const cuerpo = filasParaAprobar(filas, temporadas, e);
    const sumaVerano = analisis.filas
      .filter((f) => f.en_alcance)
      .reduce((s, f) => {
        const fila = cuerpo.find((c) => c.genero_mundo_linea_id === f.gml_id && c.temporada === "verano");
        const calc = f.p2.find((x) => x.temporada === "verano")?.historico ?? 0;
        return s + (fila?.participacion_ajustada ?? calc);
      }, 0);
    expect(Math.abs(sumaVerano - 1)).toBeLessThan(0.0005);
  });

  it("expandirRestoPantalla reparte parejo por unidades si todos los pesos son 0", () => {
    const miembros = analisis.filas.filter((f) => f.grupo_resto).map((f) => ({ ...f, p2: f.p2.map((x) => ({ ...x, historico: 0 })) }));
    const r = expandirRestoPantalla(10, miembros, "verano");
    expect(r.map((x) => x.fraccion)).toEqual([0.06, 0.04]);
  });

  it("alcanceParaCuerpo omite las listas vacías", () => {
    expect(alcanceParaCuerpo({ generos: [], mundos: [], lineas: [] })).toEqual({});
    expect(alcanceParaCuerpo({ generos: [GEN_H], mundos: [], lineas: ["l1"] })).toEqual({ generos: [GEN_H], lineas: ["l1"] });
    expect(MUN_CASUAL).toBeTruthy();
  });
});

describe("comparar el reparto vigente con lo calculado hoy", () => {
  it("lista las diferencias en pp ordenadas por tamaño y da el máximo", () => {
    const analisis = analisisBeta();
    // Hoy DENIM en verano sería 41 pero el vigente tenía 36: +5 pp.
    analisis.filas[0].p2[0].vigente = 0.36;
    const c = compararConVigente(analisis);
    expect(c.filas[0]).toMatchObject({ etiqueta: "HOMBRE · URBANO · DENIM", temporada: "verano" });
    expect(c.filas[0].difPp).toBeCloseTo(5, 9);
    expect(c.maximoPp).toBeCloseTo(5, 9);
    expect(c.filas).toHaveLength(8); // 3 GML + 1 resto, por 2 temporadas
  });

  it("una versión aprobada con la fuente cerrada se compara con la cerrada de hoy", () => {
    const analisis = analisisBeta({ vigente: { ...analisisBeta().vigente!, fuente: "cerrada" } });
    const c = compararConVigente(analisis);
    const denim = c.filas.find((f) => f.etiqueta === "HOMBRE · URBANO · DENIM" && f.temporada === "verano");
    expect(denim?.hoy).toBeCloseTo(43, 9);
    expect(denim?.vigente).toBeCloseTo(41, 9);
  });

  it("sin versión vigente no hay nada que comparar", () => {
    const analisis = analisisBeta();
    for (const f of analisis.filas) f.p2 = f.p2.map((x) => ({ ...x, vigente: null }));
    analisis.restos = analisis.restos.map((r) => ({ ...r, p2: r.p2.map((x) => ({ ...x, vigente: null })) }));
    expect(compararConVigente({ ...analisis, vigente: null })).toEqual({ filas: [], maximoPp: 0 });
  });
});
