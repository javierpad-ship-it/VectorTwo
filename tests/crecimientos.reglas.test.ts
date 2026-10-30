import { describe, expect, it } from "vitest";
import {
  aniosPermitidos,
  esSinCambio,
  estadoDeGM,
  evaluarObsoleto,
  mensajeAnioSiguienteAtipico,
  mesesAtipicosDelAnio,
  motivoNotaObligatoria,
  motivoRechazoAnio,
  motivoRechazoAnioSiguienteAtipico,
  motivoRechazoAprobar,
  motivoRechazoBaseAnio,
  motivoRechazoGeneroMundo,
  motivoRechazoReferencia,
  notaObligatoria,
  referenciaPorDefecto,
  siguienteVersion,
  type AprobacionNueva,
  type VersionParaComparar,
} from "@/lib/crecimientos/reglas";
import type { ReferenciaApi } from "@/lib/crecimientos/tipos-api";

/**
 * Reglas 1 a 5 y la validación del POST (ficha 06d §5.2 y §3) con los cambios de 06e: R12 (R-N con la variante `bruto`), R13 (`sin_cambio` compara
 * `sobre_base`), R14 (orden de la obsolescencia) y R25 (`anio_siguiente_atipico`). Puro y sintético.
 */

const base = { tipo: "acumulado" as const, anio: null, variante: "corregido" as const };

const vigente = (extra: Partial<VersionParaComparar> = {}): VersionParaComparar => ({ version: 2, pct: 15, nota: "Prudente", base: { ...base, valor: 18.4 }, obsoleta: false, sobre_base: "corregida", ...extra });
const nueva = (extra: Partial<AprobacionNueva> = {}): AprobacionNueva => ({ pct: 15, nota: "Prudente", base: { ...base, valor: 18.4 }, sobre_base: "corregida", ...extra });

describe("regla 2 · R-N: cuándo la nota es obligatoria", () => {
  it("base ninguna o no calculable: siempre", () => {
    expect(notaObligatoria({ base_tipo: "ninguna", base_valor: null, pct: 10 })).toBe(true);
    expect(notaObligatoria({ base_tipo: "ninguna", base_valor: 10, pct: 10 })).toBe(true);
    expect(notaObligatoria({ base_tipo: "acumulado", base_valor: null, pct: 10 })).toBe(true);
    expect(motivoNotaObligatoria({ base_tipo: "acumulado", base_valor: null, pct: 10 })).toMatch(/no se pudo calcular/);
  });

  it("|pct − base_valor| > 0,5 pp: obligatoria; hasta 0,5 incluido, no", () => {
    expect(notaObligatoria({ base_tipo: "acumulado", base_valor: 18.4, pct: 15 })).toBe(true);
    expect(notaObligatoria({ base_tipo: "acumulado", base_valor: 18.4, pct: 18.4 })).toBe(false);
    expect(notaObligatoria({ base_tipo: "acumulado", base_valor: 18.4, pct: 18.9 })).toBe(false);
    expect(notaObligatoria({ base_tipo: "acumulado", base_valor: 18.4, pct: 17.9 })).toBe(false);
    expect(notaObligatoria({ base_tipo: "acumulado", base_valor: 18.4, pct: 18.91 })).toBe(true);
    expect(notaObligatoria({ base_tipo: "acumulado", base_valor: 18.4, pct: 17.89 })).toBe(true);
    expect(motivoNotaObligatoria({ base_tipo: "acumulado", base_valor: 18.4, pct: 15 })).toMatch(/3,4 puntos/);
  });
});

describe("R12 · R-N con la variante bruto en un GM con Niño", () => {
  const e = { base_tipo: "acumulado" as const, base_valor: 3, pct: 3, variante: "bruto" as const };
  it("obligatoria con variante bruto, periodo que toca un año Niño y Niño material; en cualquier otro caso, no", () => {
    expect(notaObligatoria({ ...e, hay_nino: true, periodo_toca_nino: true })).toBe(true);
    expect(motivoNotaObligatoria({ ...e, hay_nino: true, periodo_toca_nino: true })).toMatch(/base real/);
    expect(notaObligatoria({ ...e, hay_nino: false, periodo_toca_nino: true })).toBe(false);
    expect(notaObligatoria({ ...e, hay_nino: true, periodo_toca_nino: false })).toBe(false);
    expect(notaObligatoria({ ...e, variante: "corregido", hay_nino: true, periodo_toca_nino: true })).toBe(false);
    expect(notaObligatoria(e)).toBe(false);
  });

  it("el ejemplo F: 8,00 frente a +8,8 de la base por defecto exige nota (0,8 pp > 0,5)", () => {
    expect(notaObligatoria({ base_tipo: "cierre_curva", base_valor: 8.8, pct: 8 })).toBe(true);
    expect(notaObligatoria({ base_tipo: "cierre_curva", base_valor: 8.8, pct: 8.5 })).toBe(false);
  });

  it("motivoRechazoAprobar pasa lo necesario: sin nota → nota_requerida; con nota, pasa", () => {
    const args = { vigente: null, version_vigente: null, nota: { hay_nino: true, periodo_toca_nino: true } };
    const bruta = nueva({ pct: 3, nota: null, base: { ...base, variante: "bruto", valor: 3 } });
    expect(motivoRechazoAprobar({ ...args, nueva: bruta })).toMatchObject({ status: 409, codigo: "nota_requerida" });
    expect(motivoRechazoAprobar({ ...args, nueva: { ...bruta, nota: "Es lo que vendí" } })).toBeNull();
    expect(motivoRechazoAprobar({ ...args, nota: { hay_nino: false, periodo_toca_nino: true }, nueva: bruta })).toBeNull();
  });
});

describe("R25 · anio_siguiente_atipico (D7)", () => {
  const periodo = (desde: string, hasta: string, temporadas: ("invierno" | "verano")[], activo = true) => ({ id: `p-${desde}`, desde, hasta, motivo: "Niño", alcance: "invierno" as const, temporadas, activo });
  it("los meses de 2027 marcados para las temporadas del GM, ordenados; vacío si es normal o si la temporada no es del GM", () => {
    const periodos = [periodo("2026-06", "2026-08", ["invierno"]), periodo("2027-03", "2027-04", ["invierno"]), periodo("2027-10", "2027-10", ["verano"])];
    expect(mesesAtipicosDelAnio(2027, periodos, ["invierno", "verano"])).toEqual(["2027-03", "2027-04", "2027-10"]);
    expect(mesesAtipicosDelAnio(2027, periodos, ["invierno"])).toEqual(["2027-03", "2027-04"]);
    expect(mesesAtipicosDelAnio(2027, periodos, [])).toEqual([]);
    expect(mesesAtipicosDelAnio(2027, [periodo("2027-03", "2027-04", ["invierno"], false)], ["invierno"])).toEqual([]);
    expect(mesesAtipicosDelAnio(2028, periodos, ["invierno", "verano"])).toEqual([]);
  });

  it("el rechazo es 409 no forzable con el mensaje de la ficha; sin meses no hay rechazo", () => {
    expect(motivoRechazoAnioSiguienteAtipico(2027, [])).toBeNull();
    const r = motivoRechazoAnioSiguienteAtipico(2027, ["2027-03"]);
    expect(r).toMatchObject({ status: 409, codigo: "anio_siguiente_atipico" });
    expect(r?.mensaje).toBe(mensajeAnioSiguienteAtipico(2027));
    expect(r?.mensaje).toMatch(/^2027 está marcado como año del Niño en Curvas → Periodos atípicos\. Por ahora el crecimiento de 2027 no incluye el Niño/);
  });
});

describe("R13 · sin_cambio compara sobre_base", () => {
  it("una vigente bruta con el mismo % no es «sin cambio»: se puede reaprobar", () => {
    expect(esSinCambio(nueva(), vigente({ sobre_base: "bruta" }))).toBe(false);
    expect(esSinCambio(nueva(), vigente({ sobre_base: "corregida" }))).toBe(true);
    // Sin el dato, la vigente es bruta y la aprobación nueva es corregida.
    const sinDato: VersionParaComparar = { ...vigente(), sobre_base: undefined };
    expect(esSinCambio(nueva(), sinDato)).toBe(false);
    expect(motivoRechazoAprobar({ vigente: vigente({ sobre_base: "bruta" }), version_vigente: 2, nueva: nueva() })).toBeNull();
  });
});

describe("regla 3 · sin_cambio", () => {
  it("igual en pct, nota, base (tipo, año, variante) y valor: sin cambio", () => {
    expect(esSinCambio(nueva(), vigente())).toBe(true);
    expect(esSinCambio(nueva({ nota: "  Prudente  " }), vigente())).toBe(true);
    expect(esSinCambio(nueva({ nota: "" }), vigente({ nota: null }))).toBe(true);
  });

  it("cualquier diferencia crea versión", () => {
    expect(esSinCambio(nueva({ pct: 15.01 }), vigente())).toBe(false);
    expect(esSinCambio(nueva({ nota: "Otra" }), vigente())).toBe(false);
    expect(esSinCambio(nueva({ base: { ...base, tipo: "cierre_curva", valor: 18.4 } }), vigente())).toBe(false);
    expect(esSinCambio(nueva({ base: { ...base, anio: 2025, valor: 18.4 } }), vigente())).toBe(false);
    expect(esSinCambio(nueva({ base: { ...base, variante: "bruto", valor: 18.4 } }), vigente())).toBe(false);
    expect(esSinCambio(nueva({ base: { ...base, valor: 17.9 } }), vigente())).toBe(false);
    expect(esSinCambio(nueva({ base: { ...base, valor: null } }), vigente())).toBe(false);
  });

  it("el valor de la base se compara a 2 decimales", () => {
    expect(esSinCambio(nueva({ base: { ...base, valor: 18.401 } }), vigente())).toBe(true);
    expect(esSinCambio(nueva({ base: { ...base, valor: 18.41 } }), vigente())).toBe(false);
  });

  it("una vigente obsoleta se puede refrescar con el mismo %; sin vigente nunca es sin cambio", () => {
    expect(esSinCambio(nueva(), vigente({ obsoleta: true }))).toBe(false);
    expect(esSinCambio(nueva(), null)).toBe(false);
  });
});

describe("regla 1 · motivoRechazoAprobar: vigente_cambiada · sin_cambio · nota_requerida, en ese orden", () => {
  it("version_vigente distinta de la vigente (o null con vigente) es vigente_cambiada, antes que sin_cambio", () => {
    expect(motivoRechazoAprobar({ vigente: vigente(), version_vigente: 1, nueva: nueva() })).toMatchObject({ status: 409, codigo: "vigente_cambiada" });
    expect(motivoRechazoAprobar({ vigente: vigente(), version_vigente: null, nueva: nueva() })?.codigo).toBe("vigente_cambiada");
    expect(motivoRechazoAprobar({ vigente: null, version_vigente: 3, nueva: nueva() })?.codigo).toBe("vigente_cambiada");
  });

  it("sin_cambio antes que nota_requerida", () => {
    const r = motivoRechazoAprobar({ vigente: vigente({ nota: null }), version_vigente: 2, nueva: nueva({ nota: null }) });
    expect(r).toMatchObject({ status: 409, codigo: "sin_cambio" });
    expect(r?.mensaje).toBe("Es igual a la v2: no se crea otra versión.");
  });

  it("nota_requerida con la nota vacía o en blanco; con nota pasa", () => {
    const sinNota = nueva({ pct: 12, nota: null });
    expect(motivoRechazoAprobar({ vigente: null, version_vigente: null, nueva: sinNota })?.codigo).toBe("nota_requerida");
    expect(motivoRechazoAprobar({ vigente: null, version_vigente: null, nueva: { ...sinNota, nota: "   " } })?.codigo).toBe("nota_requerida");
    expect(motivoRechazoAprobar({ vigente: null, version_vigente: null, nueva: { ...sinNota, nota: "Prudente" } })).toBeNull();
  });

  it("con el valor precargado no se exige nota", () => {
    expect(motivoRechazoAprobar({ vigente: null, version_vigente: null, nueva: nueva({ pct: 18.4, nota: null }) })).toBeNull();
  });

  it("siguienteVersion = max(version) + 1, contando las reemplazadas", () => {
    expect(siguienteVersion([])).toBe(1);
    expect(siguienteVersion([{ version: 1 }, { version: 3 }, { version: 2 }])).toBe(4);
  });
});

describe("regla 4 · géneros y mundos", () => {
  const detallables = new Set(["h", "m"]);
  const e = { alcance: "gm" as const, detallables, genero_id: "h", mundo_activo: true, con_filas_base_en_trabajo: false };

  it("HOMBRE, MUJER y el Resto se aprueban; otro género da genero_no_detallado", () => {
    expect(motivoRechazoGeneroMundo(e)).toBeNull();
    expect(motivoRechazoGeneroMundo({ ...e, genero_id: "m" })).toBeNull();
    expect(motivoRechazoGeneroMundo({ ...e, alcance: "resto", genero_id: null })).toBeNull();
    expect(motivoRechazoGeneroMundo({ ...e, genero_id: "n" })).toMatchObject({ status: 400, codigo: "genero_no_detallado" });
    expect(motivoRechazoGeneroMundo({ ...e, genero_id: null })?.codigo).toBe("genero_no_detallado");
  });

  it("un mundo inactivo da mundo_inactivo salvo con filas base en una proyección en trabajo (I3)", () => {
    expect(motivoRechazoGeneroMundo({ ...e, mundo_activo: false })).toMatchObject({ status: 400, codigo: "mundo_inactivo" });
    expect(motivoRechazoGeneroMundo({ ...e, mundo_activo: false, con_filas_base_en_trabajo: true })).toBeNull();
    // El género se valida antes que el mundo.
    expect(motivoRechazoGeneroMundo({ ...e, genero_id: "n", mundo_activo: false })?.codigo).toBe("genero_no_detallado");
  });
});

describe("regla 5 y R14 · obsoleto, solo informativo", () => {
  const ref = (extra: Partial<ReferenciaApi> = {}): ReferenciaApi => ({
    tipo: "acumulado",
    anio: 2026,
    variante_defecto: "corregido",
    etiqueta: "",
    periodo: "",
    tiendas: 3,
    anterior: 1,
    actual: 1,
    pct_bruto: 3,
    pct_sin_nino: 10.5,
    equivalente: { corregido: 18.4, bruto: 3, sin_nino_mas_rebote: null },
    fragil: false,
    extremo: false,
    tienda_mayor: null,
    cobertura_pct: null,
    motivo_nulo: null,
    ...extra,
  });
  const v = (extra: Partial<Parameters<typeof evaluarObsoleto>[0]> = {}) => ({ base: { ...base, valor: 18.4 }, gml_ids: ["n1", "n2"], sobre_base: "corregida" as const, ...extra });
  const gml = new Set(["n1", "n2"]);

  it("vigente al día: no es obsoleta", () => {
    expect(evaluarObsoleto(v(), [ref()], gml)).toBeNull();
  });

  it("base movida: a partir de 1,0 pp frente a base_valor (octubre lleva +18,4 a +16,9)", () => {
    expect(evaluarObsoleto(v(), [ref({ equivalente: { corregido: 16.9, bruto: 3, sin_nino_mas_rebote: null } })], gml)).toBe("base_movida");
    expect(evaluarObsoleto(v(), [ref({ equivalente: { corregido: 17.5, bruto: 3, sin_nino_mas_rebote: null } })], gml)).toBeNull();
    expect(evaluarObsoleto(v(), [ref({ equivalente: { corregido: 17.4, bruto: 3, sin_nino_mas_rebote: null } })], gml)).toBe("base_movida");
    expect(evaluarObsoleto(v(), [ref({ equivalente: { corregido: 19.4, bruto: 3, sin_nino_mas_rebote: null } })], gml)).toBe("base_movida");
  });

  it("aplicado_hoy no se marca por moverse, solo si deja de poder calcularse", () => {
    const aplicado = v({ base: { tipo: "aplicado_hoy", anio: null, variante: "corregido", valor: 5 } });
    expect(evaluarObsoleto(aplicado, [ref({ tipo: "aplicado_hoy", equivalente: { corregido: 20, bruto: 20, sin_nino_mas_rebote: null } })], gml)).toBeNull();
    expect(evaluarObsoleto(aplicado, [ref({ tipo: "aplicado_hoy", equivalente: { corregido: null, bruto: null, sin_nino_mas_rebote: null }, motivo_nulo: "metodo_anterior" })], gml)).toBe("base_no_calculable");
  });

  it("base no calculable: la base elegida ya no se puede calcular (o ya no existe la referencia)", () => {
    expect(evaluarObsoleto(v(), [ref({ equivalente: { corregido: null, bruto: 3, sin_nino_mas_rebote: null } })], gml)).toBe("base_no_calculable");
    expect(evaluarObsoleto(v(), [], gml)).toBe("base_no_calculable");
    const anual = v({ base: { tipo: "anio_completo", anio: 2025, variante: "corregido", valor: 5 } });
    expect(evaluarObsoleto(anual, [ref({ tipo: "anio_completo", anio: 2024, equivalente: { corregido: 5, bruto: 5, sin_nino_mas_rebote: null } })], gml)).toBe("base_no_calculable");
    expect(evaluarObsoleto(anual, [ref({ tipo: "anio_completo", anio: 2025, equivalente: { corregido: 5, bruto: 5, sin_nino_mas_rebote: null } })], gml)).toBeNull();
  });

  it("sin base (ninguna) no hay nada que mover", () => {
    expect(evaluarObsoleto(v({ base: { tipo: "ninguna", anio: null, variante: "bruto", valor: null } }), [], gml)).toBeNull();
  });

  it("composición: un nodo de la foto que ya no está en el GM; los que entran no cuentan", () => {
    expect(evaluarObsoleto(v(), [ref()], new Set(["n1"]))).toBe("composicion");
    expect(evaluarObsoleto(v(), [ref()], new Set(["n1", "n2", "n3", "n4"]))).toBeNull();
    // La composición manda sobre la base.
    expect(evaluarObsoleto(v(), [ref({ equivalente: { corregido: 10, bruto: 3, sin_nino_mas_rebote: null } })], new Set(["n1"]))).toBe("composicion");
  });

  it("R14 · metodo_anterior: una bruta con Niño material manda sobre todo lo demás; sin Niño no se marca", () => {
    const bruta = v({ sobre_base: "bruta", base: { tipo: "acumulado", anio: null, variante: "bruto", valor: 3 } });
    expect(evaluarObsoleto(bruta, [ref()], gml, { hay_nino: true })).toBe("metodo_anterior");
    expect(evaluarObsoleto(bruta, [ref()], new Set(["n1"]), { hay_nino: true })).toBe("metodo_anterior");
    expect(evaluarObsoleto(bruta, [ref()], gml, { hay_nino: false })).toBeNull();
    expect(evaluarObsoleto(bruta, [ref()], gml)).toBeNull();
    // Sin Niño material solo la composición la marca; una corregida con Niño no es metodo_anterior.
    expect(evaluarObsoleto(bruta, [ref()], new Set(["n1"]), { hay_nino: false })).toBe("composicion");
    expect(evaluarObsoleto(v(), [ref()], gml, { hay_nino: true })).toBeNull();
  });

  it("R14 · una bruta con base heredada se lee con su base original: no es obsoleta por no poder compararla", () => {
    const heredada = v({ sobre_base: "bruta", base: { tipo: "cierre_proyectado", anio: null, variante: "bruto", valor: 3 } });
    expect(evaluarObsoleto(heredada, [ref()], gml, { hay_nino: false })).toBeNull();
    const rebote = v({ sobre_base: "bruta", base: { tipo: "acumulado", anio: null, variante: "sin_nino_mas_rebote", valor: 18.4 } });
    expect(evaluarObsoleto(rebote, [ref()], gml, { hay_nino: false })).toBeNull();
    // Una bruta con una base que sigue existiendo se compara como siempre.
    expect(evaluarObsoleto(v({ sobre_base: "bruta", base: { tipo: "acumulado", anio: null, variante: "bruto", valor: 3 } }), [ref()], gml, { hay_nino: false })).toBeNull();
    expect(evaluarObsoleto(v({ sobre_base: "bruta", base: { tipo: "acumulado", anio: null, variante: "bruto", valor: 6 } }), [ref()], gml, { hay_nino: false })).toBe("base_movida");
  });

  it("R14 · factor_cambiado: solo si algún factor cambió Y K'_M se mueve ≥ 0,5 % (M3); sin poder medirlo, cuenta", () => {
    const cambio = (variacion: number | null) => ({ hay_nino: true, factores: { cambiaron: true, variacion } });
    expect(evaluarObsoleto(v(), [ref()], gml, cambio(0.006))).toBe("factor_cambiado");
    expect(evaluarObsoleto(v(), [ref()], gml, cambio(0.005))).toBe("factor_cambiado");
    expect(evaluarObsoleto(v(), [ref()], gml, cambio(0.0049))).toBeNull();
    expect(evaluarObsoleto(v(), [ref()], gml, cambio(null))).toBe("factor_cambiado");
    expect(evaluarObsoleto(v(), [ref()], gml, { hay_nino: true, factores: { cambiaron: false, variacion: null } })).toBeNull();
    // Orden: composición antes que factor; factor antes que base no calculable.
    expect(evaluarObsoleto(v(), [ref()], new Set(["n1"]), cambio(0.5))).toBe("composicion");
    expect(evaluarObsoleto(v(), [], gml, cambio(0.5))).toBe("factor_cambiado");
    expect(evaluarObsoleto(v(), [], gml, cambio(0.001))).toBe("base_no_calculable");
  });

  it("estadoDeGM: sin vigente, aprobado u obsoleto", () => {
    expect(estadoDeGM(false, null)).toBe("sin_aprobar");
    expect(estadoDeGM(true, null)).toBe("aprobado");
    expect(estadoDeGM(true, "base_movida")).toBe("obsoleto");
    expect(estadoDeGM(true, "metodo_anterior")).toBe("obsoleto");
  });
});

describe("año permitido, referencia y base (M3)", () => {
  it("aniosPermitidos: el año siguiente al último mes cerrado y el siguiente de cada proyección en trabajo", () => {
    expect(aniosPermitidos("2026-09", [{ estado: "en_trabajo", anio_en_curso: 2026 }])).toEqual([2027]);
    expect(aniosPermitidos("2026-09", [])).toEqual([2027]);
    expect(aniosPermitidos("2026-09", [{ estado: "en_trabajo", anio_en_curso: 2027 }, { estado: "cerrada", anio_en_curso: 2030 }, { estado: "en_trabajo", anio_en_curso: 2026 }])).toEqual([2027, 2028]);
    expect(aniosPermitidos("2026-12", [])).toEqual([2027]);
    // Con enero de 2027 cerrado la proyección 2026 aún en trabajo mantiene 2027 y se abre 2028.
    expect(aniosPermitidos("2027-01", [{ estado: "en_trabajo", anio_en_curso: 2026 }])).toEqual([2027, 2028]);
  });

  it("motivoRechazoAnio: 400 anio_no_permitido fuera de los permitidos", () => {
    expect(motivoRechazoAnio(2027, [2027])).toBeNull();
    expect(motivoRechazoAnio(2028, [2027])).toMatchObject({ status: 400, codigo: "anio_no_permitido" });
  });

  it("motivoRechazoReferencia: debe existir y ser del año anterior", () => {
    expect(motivoRechazoReferencia({ anio_en_curso: 2026 }, 2027)).toBeNull();
    expect(motivoRechazoReferencia({ anio_en_curso: 2025 }, 2027)).toMatchObject({ status: 400, codigo: "referencia_otro_anio" });
    expect(motivoRechazoReferencia(undefined, 2027)?.codigo).toBe("referencia_otro_anio");
    expect(motivoRechazoReferencia(null, 2027)?.codigo).toBe("referencia_otro_anio");
  });

  it("motivoRechazoBaseAnio: anio_completo exige Y−1 o Y−2 con datos", () => {
    const anual = (anio: number, motivo: ReferenciaApi["motivo_nulo"] = null) => ({ tipo: "anio_completo", anio, motivo_nulo: motivo }) as ReferenciaApi;
    const refs = [anual(2025), anual(2024, "sin_venta")];
    expect(motivoRechazoBaseAnio({ tipo: "acumulado", anio: null }, 2026, refs)).toBeNull();
    expect(motivoRechazoBaseAnio({ tipo: "anio_completo", anio: 2025 }, 2026, refs)).toBeNull();
    expect(motivoRechazoBaseAnio({ tipo: "anio_completo", anio: 2024 }, 2026, refs)?.status).toBe(400);
    expect(motivoRechazoBaseAnio({ tipo: "anio_completo", anio: 2023 }, 2026, refs)?.status).toBe(400);
    expect(motivoRechazoBaseAnio({ tipo: "anio_completo", anio: null }, 2026, refs)?.status).toBe(400);
  });
});

describe("referenciaPorDefecto (I1)", () => {
  const p = (id: string, estado: string, calculado_at: string | null, version_metodo: number | null, anio_en_curso = 2026) => ({ id, estado, anio_en_curso, calculado_at, version_metodo });

  it("la en trabajo del año anterior con el calculado_at más reciente y método ≥ 5; si no hay, la cerrada", () => {
    const todas = [p("a", "en_trabajo", "2026-10-01T00:00:00Z", 5), p("b", "en_trabajo", "2026-10-20T00:00:00Z", 5), p("c", "cerrada", "2026-11-01T00:00:00Z", 5), p("d", "en_trabajo", "2026-10-25T00:00:00Z", 4)];
    expect(referenciaPorDefecto(todas, 2027, 5)?.id).toBe("b");
    expect(referenciaPorDefecto(todas.filter((x) => x.estado !== "en_trabajo"), 2027, 5)?.id).toBe("c");
  });

  it("ignora las de otro año, las sin calcular y las de método anterior (una de método 4 ya no sirve de referencia)", () => {
    expect(referenciaPorDefecto([p("a", "en_trabajo", null, 5), p("b", "en_trabajo", "2026-10-01T00:00:00Z", 4), p("c", "en_trabajo", "2026-10-01T00:00:00Z", 5, 2025)], 2027, 5)).toBeNull();
  });
});
