import { describe, expect, it } from "vitest";
import { avisosDeCambio, dudasDeRed, motivosDesactualizada, nivelesCambiados, prerrequisitos, type EstadoActual, type ProyeccionParaEstado } from "@/lib/proyeccion/desactualizado";
import { explicar, textoCurva, textoNinoCierre } from "@/lib/proyeccion/explicar";
import { calcularProyeccion } from "@/lib/proyeccion/modelo";
import { curvaCambio, curvaFila, detalleCambioCurva, agrupacionDominante } from "@/lib/proyeccion/curva-fila";
import {
  calculoEnCurso,
  cargasIguales,
  motivoRechazoAplicarCurva,
  motivoRechazoCerrar,
  motivoRechazoDecision,
  motivoRechazoHasta,
  puedeEliminar,
} from "@/lib/proyeccion/reglas";
import { bloquesDeAnio } from "@/lib/proyeccion/bloques";
import { crearSchema, decisionSchema, decisionTiendaSchema, aplicarCurvaSchema, editarSchema, factoresPutSchema, matrizQuerySchema, parametrosSchema, mensualQuerySchema } from "@/lib/proyeccion/esquemas";
import { leerParticipaciones, participacionesFila } from "@/lib/proyeccion/participaciones";
import { AG, AM, EQ, MARCA, N, Y, agrupaciones, clave, configFlujo, entrada, meses, nodos, tiendas, vigentes } from "./proyeccion.fixture";

const AHORA = "2026-10-15T15:00:00.000Z";
const hace = (min: number) => new Date(Date.parse(AHORA) - min * 60_000).toISOString();

describe("concurrencia (caso 19, regla 39)", () => {
  it("calculando_desde de hace 2 minutos está en curso; de hace 20, abandonado; nulo, no", () => {
    expect(calculoEnCurso(hace(2), AHORA)).toBe(true);
    expect(calculoEnCurso(hace(14), AHORA)).toBe(true);
    expect(calculoEnCurso(hace(20), AHORA)).toBe(false);
    expect(calculoEnCurso(null, AHORA)).toBe(false);
  });

  it("PUT y calcular rechazan con calculo_en_curso; con el cálculo abandonado proceden", () => {
    const base = { estado: "en_trabajo" as const, ahora: AHORA, filaActiva: true, anio: Y, anioEnCurso: Y, vendido: 100, propuesto: 150, decidido: 200, origen: "manual" as const };
    expect(motivoRechazoDecision({ ...base, calculandoDesde: hace(2) })).toMatchObject({ status: 409, codigo: "calculo_en_curso" });
    expect(motivoRechazoDecision({ ...base, calculandoDesde: hace(20) })).toBeNull();
  });

  it("las tandas con cargas distintas se detectan (datos_cambiaron)", () => {
    const a = { "2026-08": "x", "2026-09": "y" };
    expect(cargasIguales([a, { ...a }, { "2026-09": "y", "2026-08": "x" }])).toBe(true);
    expect(cargasIguales([a, { ...a, "2026-09": "z" }])).toBe(false);
    expect(cargasIguales([a, { ...a, "2026-10": "w" }])).toBe(false);
  });
});

describe("reglas de estado (36 a 38 y 42)", () => {
  const base = { estado: "en_trabajo" as const, calculandoDesde: null, ahora: AHORA, filaActiva: true, anio: Y, anioEnCurso: Y, vendido: 100, propuesto: 150, decidido: 200, origen: "manual" as const };

  it("cerrada → 409; fila inactiva → 409; año en curso con decidido < vendido → menor_que_vendido; el año siguiente no lo exige", () => {
    expect(motivoRechazoDecision({ ...base, estado: "cerrada" })).toMatchObject({ status: 409, codigo: "cerrada" });
    expect(motivoRechazoDecision({ ...base, filaActiva: false })).toMatchObject({ codigo: "fila_inactiva" });
    expect(motivoRechazoDecision({ ...base, decidido: 50 })).toMatchObject({ codigo: "menor_que_vendido" });
    expect(motivoRechazoDecision({ ...base, decidido: 50, anio: Y + 1 })).toBeNull();
    expect(motivoRechazoDecision({ ...base, decidido: null })).toBeNull();
  });

  it("origen propuesta sin propuesta → sin_propuesta", () => {
    expect(motivoRechazoDecision({ ...base, origen: "propuesta", propuesto: null, decidido: 10 })).toMatchObject({ codigo: "sin_propuesta" });
    expect(motivoRechazoDecision({ ...base, origen: "propuesta", decidido: 10 })).toBeNull();
  });

  it("aplicar-curva sobre una cerrada es 409; sobre una en trabajo procede", () => {
    expect(motivoRechazoAplicarCurva({ estado: "cerrada", calculandoDesde: null, ahora: AHORA })).toMatchObject({ status: 409, codigo: "cerrada" });
    expect(motivoRechazoAplicarCurva({ estado: "en_trabajo", calculandoDesde: null, ahora: AHORA })).toBeNull();
  });

  it("puedeEliminar: solo en_trabajo sin decisiones", () => {
    expect(puedeEliminar({ estado: "en_trabajo", hayDecisiones: false })).toBeNull();
    expect(puedeEliminar({ estado: "en_trabajo", hayDecisiones: true })).toMatchObject({ status: 409 });
    expect(puedeEliminar({ estado: "archivada", hayDecisiones: false })).toMatchObject({ status: 409 });
  });

  it("hasta_periodo: dentro del año en curso y sin pasar del último mes cerrado", () => {
    expect(motivoRechazoHasta("2026-06", 2026, "2026-09")).toBeNull();
    expect(motivoRechazoHasta("2025-12", 2026, "2026-09")).not.toBeNull();
    expect(motivoRechazoHasta("2026-10", 2026, "2026-09")).not.toBeNull();
  });
});

describe("cerrar la proyección (caso 17, regla 37)", () => {
  const s = calcularProyeccion(entrada());
  const base = s.filas.filter((f) => f.tienda_id === null);
  const filasBase = (decidirTodas = false) =>
    base.map((f) => ({
      clave: f.clave,
      anios: Object.fromEntries(f.registros.map((r) => [r.anio, { clave: f.clave, propuesto: r.propuesto, decidido: decidirTodas || (f.clave === clave("denim", AM.pre)) ? (r.propuesto ?? 0) : null }])),
    }));
  const comunes = { estado: "en_trabajo" as const, calculandoDesde: null, ahora: AHORA, anioEnCurso: Y, desactualizada: false, forzar: false };

  it("DENIM × RECONOCIDO (≥ 100) sin decidir en 2027 → filas_sin_decidir con la lista", () => {
    const r = motivoRechazoCerrar({ ...comunes, filasBase: filasBase(), tiendas: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.rechazo).toMatchObject({ status: 409, codigo: "filas_sin_decidir" });
      expect(r.filas_sin_decidir?.some((x) => x.clave === clave("denim", AM.rec) && x.anio === Y + 1)).toBe(true);
    }
  });

  it("con las filas grandes decididas se cierra y la cola larga (DENIM × PREMIUM = 60) queda como cola", () => {
    const filas = base.map((f) => ({
      clave: f.clave,
      anios: Object.fromEntries(f.registros.map((r) => [r.anio, { clave: f.clave, propuesto: r.propuesto, decidido: (r.propuesto ?? 0) >= 100 ? r.propuesto : null }])),
    }));
    const r = motivoRechazoCerrar({ ...comunes, filasBase: filas, tiendas: [] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.cola_larga).toBeGreaterThan(0);
  });

  it("una tienda nueva con venta esperada sin decidir → tiendas_sin_decidir", () => {
    const r = motivoRechazoCerrar({ ...comunes, filasBase: filasBase(true), tiendas: [{ tienda_id: "T4", anio: Y + 1, venta_esperada: 85000, decidido: null }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rechazo.codigo).toBe("tiendas_sin_decidir");
  });

  it("desactualizada se cierra solo con forzar; una ya cerrada, no", () => {
    const e = { ...comunes, filasBase: filasBase(true), tiendas: [], desactualizada: true };
    const sin = motivoRechazoCerrar(e);
    expect(!sin.ok && sin.rechazo.codigo).toBe("desactualizada");
    expect(motivoRechazoCerrar({ ...e, forzar: true }).ok).toBe(true);
    const cerrada = motivoRechazoCerrar({ ...e, estado: "cerrada" });
    expect(!cerrada.ok && cerrada.rechazo.codigo).toBe("ya_cerrada");
  });
});

describe("desactualización (regla 33) y avisos de cambio (regla 34)", () => {
  const calculado = "2026-10-01T12:00:00.000Z";
  const s = calcularProyeccion(entrada());
  const p: ProyeccionParaEstado = {
    calculado_at: calculado,
    hasta_periodo: "2026-09-01",
    resumen: { curvas_usadas: s.resumen.curvas_usadas },
    parametros: {
      factores_usados: [
        { anio: 2026, temporada: "invierno", ratio: 0.66, origen: "calculado" },
        { anio: 2026, temporada: "verano", ratio: 1.24, origen: "calculado" },
      ],
      bloques: s.bloques,
    },
  };
  const actual = (): EstadoActual => ({
    cargas_publicadas: [{ periodo: "2026-09-01", publicada_at: "2026-09-28T10:00:00.000Z" }],
    ultimo_mes_cerrado: "2026-09",
    curvas_vigentes: s.resumen.curvas_usadas.map((c) => ({ agrupacion_id: c.agrupacion_id, curva_id: c.curva_id })),
    niveles_cambiados: 0,
    tiendas: tiendas(),
    factores: [
      { anio: 2026, temporada: "invierno", ratio_calculado: 0.66, ratio_aplicado: null },
      { anio: 2026, temporada: "verano", ratio_calculado: 1.24, ratio_aplicado: null },
    ],
    periodos_updated_at: "2026-09-01T00:00:00.000Z",
  });
  const codigos = (a: EstadoActual, proyeccion = p) => motivosDesactualizada(proyeccion, a).map((m) => m.codigo);

  it("al día: sin motivos", () => expect(codigos(actual())).toEqual([]));

  it("cargas_nuevas: una carga publicada después del cálculo dentro del rango, o un mes nuevo que adelanta k", () => {
    const a = actual();
    a.cargas_publicadas.push({ periodo: "2026-09-01", publicada_at: "2026-10-05T10:00:00.000Z" });
    expect(codigos(a)).toEqual(["cargas_nuevas"]);
    const b = actual();
    b.cargas_publicadas.push({ periodo: "2026-10-01", publicada_at: "2026-10-10T10:00:00.000Z" });
    b.ultimo_mes_cerrado = "2026-10";
    expect(codigos(b)).toEqual(["cargas_nuevas"]);
  });

  it("curvas_cambiadas, nivel_cambiado, factores_cambiados, periodos_cambiados y recalculo_pendiente", () => {
    const a = actual();
    a.curvas_vigentes = a.curvas_vigentes.map((c) => (c.agrupacion_id === AG.denim ? { ...c, curva_id: "c-denim-v2" } : c));
    expect(codigos(a)).toEqual(["curvas_cambiadas"]);
    expect(codigos({ ...actual(), niveles_cambiados: 1 })).toEqual(["nivel_cambiado"]);
    const f = actual();
    f.factores[0].ratio_aplicado = 0.7;
    expect(codigos(f)).toEqual(["factores_cambiados"]);
    expect(codigos({ ...actual(), periodos_updated_at: "2026-10-12T00:00:00.000Z" })).toEqual(["periodos_cambiados"]);
    expect(codigos(actual(), { ...p, recalculo_pendiente: true })).toEqual(["recalculo_pendiente"]);
  });

  it("M12 config_cambiada: la huella de la configuración de 02b guardada difiere de la actual, o es nula (calculada antes de M12)", () => {
    const calculada = { ...p, huella_flujo: "h1" };
    expect(codigos({ ...actual(), huella_flujo: "h1" }, calculada)).toEqual([]);
    expect(codigos({ ...actual(), huella_flujo: "h2" }, calculada)).toEqual(["config_cambiada"]);
    // Una calculada antes de M12 (huella nula): desactualizada.
    expect(codigos({ ...actual(), huella_flujo: "h1" }, { ...p, huella_flujo: null })).toEqual(["config_cambiada"]);
    // Quien llama sin la huella (ni guardada ni actual) no marca nada: así los contextos sin configuración de marcas no rompen.
    expect(codigos(actual(), calculada)).toEqual([]);
    expect(codigos({ ...actual(), huella_flujo: "h1" }, p)).toEqual([]);
    // Sin calcular no hay nada que comparar.
    expect(codigos({ ...actual(), huella_flujo: "h2" }, { ...calculada, calculado_at: null })).toEqual([]);
  });

  it("tiendas_cambiadas: fecha, venta esperada o referente distintos de la foto, o una tienda nueva", () => {
    const a = actual();
    a.tiendas = a.tiendas.map((t) => (t.id === "T4" ? { ...t, fecha_apertura: "2027-04-01" } : t));
    expect(codigos(a)).toEqual(["tiendas_cambiadas"]);
    const b = actual();
    b.tiendas = b.tiendas.map((t) => (t.id === "T4" ? { ...t, referente_id: "T6" } : t));
    expect(codigos(b)).toEqual(["tiendas_cambiadas"]);
    const c = actual();
    c.tiendas = [...c.tiendas, { ...tiendas()[0], id: "T10", codigo: "T10" }];
    expect(codigos(c)).toEqual(["tiendas_cambiadas"]);
  });

  it("avisosDeCambio: curva_cambio con el detalle v2 → v3, propuesta_cambio y bloque_cambiado", () => {
    const v2 = [{ agrupacion_id: AG.inv, curva_id: "c2", version: 2, peso: 1 }];
    const v3 = [{ agrupacion_id: AG.inv, curva_id: "c3", version: 3, peso: 1 }];
    const registro = { decidido: 4300, propuesto: 4402, propuesta_al_decidir: 4168, curva_origen_usada: v2, bloque: "nuevas", subbloque: "aperturas" };
    const r = avisosDeCambio(registro, v3, { nombres: new Map([[AG.inv, "HO INVIERNO"]]), bloqueActual: { bloque: "mismas" } });
    expect(r.avisos).toEqual(["curva_cambio", "propuesta_cambio", "bloque_cambiado"]);
    expect(r.detalle_curva).toEqual(["HO INVIERNO v2 → v3"]);
    expect(avisosDeCambio({ ...registro, decidido: null, curva_origen_usada: v3 }, v3).avisos).toEqual([]);
    expect(nivelesCambiados([{ gml_id: N.denim, nivel_proyectado: "GML" }], new Map([[N.denim, "GMLE"]]))).toBe(1);
  });
});

describe("prerrequisitos y meses faltantes (caso 21, regla 35)", () => {
  const publicados = meses("2023-01", "2026-09");
  const comunes = { anio: Y, hasta: "2026-09", tiendas: tiendas(), tiendasConVenta: new Set<string>() };

  it("sin 2026-05 publicado: bloquea con meses_faltantes", () => {
    const p = prerrequisitos({ ...comunes, mesesPublicados: publicados.filter((m) => m !== "2026-05") });
    expect(p.bloquea.map((m) => m.codigo)).toEqual(["meses_faltantes"]);
    expect(p.bloquea[0].detalle).toEqual(["2026-05"]);
  });

  it("sin 2023-04 (fuera del año en curso y de W12): solo avisa", () => {
    const p = prerrequisitos({ ...comunes, mesesPublicados: publicados.filter((m) => m !== "2023-04") });
    expect(p.bloquea).toEqual([]);
    expect(p.avisa.map((m) => m.codigo)).toContain("meses_faltantes_anteriores");
  });

  it("un mes faltante dentro de W12 (2025-11) bloquea aunque sea de otro año", () => {
    const p = prerrequisitos({ ...comunes, mesesPublicados: publicados.filter((m) => m !== "2025-11") });
    expect(p.bloquea.map((m) => m.codigo)).toEqual(["meses_faltantes"]);
  });

  it("sin meses, con tienda con venta sin apertura o sin mismas tiendas: bloquea", () => {
    expect(prerrequisitos({ ...comunes, mesesPublicados: [], hasta: null }).bloquea.map((m) => m.codigo)).toContain("sin_meses");
    const sinApertura = tiendas().map((t) => (t.id === "T9" ? { ...t, fecha_apertura: null } : t));
    const p = prerrequisitos({ ...comunes, tiendas: sinApertura, tiendasConVenta: new Set(["T9"]), mesesPublicados: publicados });
    expect(p.bloquea.map((m) => m.codigo)).toContain("tienda_sin_apertura_con_venta");
    const nadie = tiendas().map((t) => ({ ...t, fecha_apertura: "2026-06-01", fecha_cierre: null }));
    expect(prerrequisitos({ ...comunes, tiendas: nadie, mesesPublicados: publicados }).bloquea.map((m) => m.codigo)).toContain("sin_mismas_tiendas");
  });

  it("avisa: tiendas nuevas sin venta esperada o sin referente, curvas, factores y apertura dudosa", () => {
    const p = prerrequisitos({
      ...comunes,
      mesesPublicados: publicados,
      dudasDeRed: [{ tienda: "T6", anio: 2025, motivo: "apertura_dudosa", meses: ["2025-01"] }],
      agrupacionesSinCurva: [{ id: AG.ver, nombre: "MU VERANO" }],
      curvasObsoletas: 2,
      factoresFaltantes: [{ anio: 2026, temporada: "verano" }],
      anioSiguienteAtipico: true,
    });
    const c = p.avisa.map((m) => m.codigo);
    for (const esperado of ["apertura_dudosa", "agrupaciones_sin_curva", "curvas_obsoletas", "factor_sin_calcular", "anio_siguiente_atipico", "tienda_sin_venta_esperada", "tienda_sin_referente"]) expect(c).toContain(esperado);
    expect(p.avisa.find((m) => m.codigo === "apertura_dudosa")?.mensaje).toContain("T6");
    expect(p.bloquea).toEqual([]);
  });

  it("dudasDeRed usa la regla de red por datos de M6: una tienda abierta por fechas pero sin venta un mes", () => {
    const venta = meses("2024-01", "2026-09").flatMap((m) => ["T1", "T6", "T5"].filter((t) => !(t === "T6" && m === "2025-02")).map((t) => ({ tienda_id: t, periodo: m, unidades: 10 })));
    const lista = tiendas().filter((t) => ["T1", "T5"].includes(t.id)).concat(tiendas().filter((t) => t.id === "T6").map((t) => ({ ...t, fecha_apertura: "2024-01-01" })));
    const d = dudasDeRed(lista, venta, 2026, "2026-09", meses("2024-01", "2026-09"));
    expect(d.some((x) => x.tienda === "T6" && x.meses.includes("2025-02") && x.motivo === "meses_sin_venta")).toBe(true);
    expect(d.every((x) => x.tienda !== "T1")).toBe(true);
    // Sin venta desde el inicio hasta un mes: la fecha de apertura es dudosa.
    const tarde = venta.filter((v) => !(v.tienda_id === "T6" && v.periodo < "2025-03"));
    const d2 = dudasDeRed(lista, tarde, 2026, "2026-09", meses("2024-01", "2026-09"));
    expect(d2.some((x) => x.tienda === "T6" && x.motivo === "apertura_dudosa")).toBe(true);
  });
});

describe("curva de la fila (regla 25)", () => {
  const vig = new Map(vigentes().map((v) => [v.agrupacion_id, v]));
  const ags = new Map(agrupaciones().map((a) => [a.id, a]));
  const mixta = nodos().find((n) => n.gml_id === N.mixta)!;
  const eqs = mixta.equivalencias.map((e) => ({ id: e.id, agrupacion_estacionalidad_id: e.agrupacion_estacionalidad_id }));

  it("GMLE: la curva vigente de su agrupación; GML con una agrupación: esa curva; mezcla ponderada para varias", () => {
    const abrigo = curvaFila({ nivel: "GMLE", equivalencia_id: EQ.parka }, [{ id: EQ.parka, agrupacion_estacionalidad_id: AG.inv }], vig, ags, new Map());
    expect(abrigo.curva).toEqual(vigentes()[1].curva);
    expect(abrigo.curva_origen).toEqual([{ agrupacion_id: AG.inv, curva_id: "c-inv-v1", version: 1, peso: 1 }]);
    const mezcla = curvaFila({ nivel: "GML", equivalencia_id: null }, eqs, vig, ags, new Map([[EQ.mixtaInv, 80], [EQ.mixtaVer, 20]]));
    expect(mezcla.curva?.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    expect(mezcla.curva?.[2]).toBeCloseTo(0.8 * 0.06 + 0.2 * 0.08, 10);
    expect(mezcla.curva_origen.map((o) => [o.agrupacion_id, o.peso])).toEqual([[AG.inv, 0.8], [AG.ver, 0.2]]);
    expect(mezcla.avisos).toContain("temporadas_mezcladas");
    expect(mezcla.dominante?.id).toBe(AG.inv);
  });

  it("una equivalencia con peso y sin curva deja curva_incompleta; sin ninguna curva → null", () => {
    const sinVer = new Map([...vig].filter(([id]) => id !== AG.ver));
    const r = curvaFila({ nivel: "GML", equivalencia_id: null }, eqs, sinVer, ags, new Map([[EQ.mixtaInv, 80], [EQ.mixtaVer, 20]]));
    expect(r.avisos).toContain("curva_incompleta");
    expect(r.curva_origen).toHaveLength(1);
    expect(curvaFila({ nivel: "GML", equivalencia_id: null }, eqs, new Map(), ags, new Map([[EQ.mixtaInv, 1]])).curva).toBeNull();
  });

  it("agrupacionDominante: mayor peso; empate por nombre", () => {
    const a = { id: "a", nombre: "BETA", temporada: "invierno" as const };
    const b = { id: "b", nombre: "ALFA", temporada: "verano" as const };
    expect(agrupacionDominante([{ agrupacion: a, peso: 0.5 }, { agrupacion: b, peso: 0.5 }])?.id).toBe("b");
    expect(agrupacionDominante([{ agrupacion: a, peso: 0.6 }, { agrupacion: b, peso: 0.4 }])?.id).toBe("a");
  });

  it("curvaCambio ignora el peso; detalle v1 → v2", () => {
    const v1 = [{ agrupacion_id: AG.denim, curva_id: "c1", version: 1, peso: 1 }];
    const v2 = [{ agrupacion_id: AG.denim, curva_id: "c2", version: 2, peso: 1 }];
    expect(curvaCambio(v1, v2)).toBe(true);
    expect(curvaCambio(v1, [{ ...v1[0], peso: 0.5 }])).toBe(false);
    expect(curvaCambio([], v2)).toBe(false);
    expect(detalleCambioCurva(v1, v2, new Map([[AG.denim, "DENIM HO"]]))).toEqual(["DENIM HO v1 → v2"]);
  });
});

const PERIODO = { desde: "2025-10", hasta: "2026-09", meses: 12, tiendas: "mismas" as const, anio: 2026, normalizado_nino: false };

describe("participaciones históricas (reglas 26 y 48)", () => {
  it("cada eje suma 1; claveFlujo se evalúa sobre la unidad de marca (ALFA JEANS cuenta en la clave de ALFA)", () => {
    const detalle = [
      { gml_id: N.denim, equivalencia_id: null, agrupacion_marca_id: AM.rec, marca_id: MARCA.alfa, agrupacion_talla_id: "t-central", unidades: 50 },
      // La lectura ya colapsa ALFA JEANS en su cabeza ALFA.
      { gml_id: N.denim, equivalencia_id: null, agrupacion_marca_id: AM.rec, marca_id: MARCA.alfa, agrupacion_talla_id: "t-extrema", unidades: 30 },
      { gml_id: N.denim, equivalencia_id: null, agrupacion_marca_id: AM.rec, marca_id: MARCA.delta, agrupacion_talla_id: "t-central", unidades: 20 },
    ];
    const p = participacionesFila(detalle, configFlujo(), PERIODO)!;
    expect(p.por_clave_flujo.reduce((a, x) => a + x.participacion, 0)).toBeCloseTo(1, 12);
    expect(p.por_talla.reduce((a, x) => a + x.participacion, 0)).toBeCloseTo(1, 12);
    expect(p.por_clave_flujo.find((x) => x.clave_flujo === "marca:m-alfa")?.participacion).toBeCloseTo(0.8, 12);
    expect(p.por_clave_flujo.find((x) => x.clave_flujo === "otras")?.participacion).toBeCloseTo(0.2, 12);
    expect(p.por_talla.find((x) => x.agrupacion_talla_id === "t-central")?.participacion).toBeCloseTo(0.7, 12);
  });

  it("regla 48: periodo_referencia y por_marca con TODAS las unidades de marca (con o sin tratamiento); suma 1", () => {
    const detalle = [
      { gml_id: N.denim, equivalencia_id: null, agrupacion_marca_id: AM.rec, marca_id: MARCA.alfa, agrupacion_talla_id: "t-central", unidades: 50 },
      // ALFA JEANS es miembro del conjunto de ALFA: suma en ALFA.
      { gml_id: N.denim, equivalencia_id: null, agrupacion_marca_id: AM.rec, marca_id: MARCA.alfaJeans, agrupacion_talla_id: "t-extrema", unidades: 10 },
      { gml_id: N.denim, equivalencia_id: null, agrupacion_marca_id: AM.rec, marca_id: MARCA.delta, agrupacion_talla_id: "t-central", unidades: 30 },
      // BETA no tiene tratamiento en 02b y aun así aparece en por_marca.
      { gml_id: N.denim, equivalencia_id: null, agrupacion_marca_id: AM.rec, marca_id: MARCA.beta, agrupacion_talla_id: "t-central", unidades: 10 },
    ];
    const p = participacionesFila(detalle, configFlujo(), PERIODO)!;
    expect(p.periodo_referencia).toEqual(PERIODO);
    expect(p.por_marca?.map((x) => x.marca_id).sort()).toEqual([MARCA.alfa, MARCA.beta, MARCA.delta].sort());
    expect(p.por_marca?.reduce((a, x) => a + x.participacion, 0)).toBeCloseTo(1, 12);
    expect(p.por_marca?.find((x) => x.marca_id === MARCA.alfa)?.participacion).toBeCloseTo(0.6, 12);
    expect(p.por_marca?.find((x) => x.marca_id === MARCA.beta)?.participacion).toBeCloseTo(0.1, 12);
    // Los otros dos ejes siguen como antes.
    expect(p.por_clave_flujo.reduce((a, x) => a + x.participacion, 0)).toBeCloseTo(1, 12);
    expect(p.por_talla.reduce((a, x) => a + x.participacion, 0)).toBeCloseTo(1, 12);
  });

  it("una cerrada de 0.10.0 (sin periodo_referencia ni por_marca) se lee con ambos en null", () => {
    const viejo = { por_clave_flujo: [{ clave_flujo: "otras", marca_id: null, participacion: 1 }], por_talla: [{ agrupacion_talla_id: "t", participacion: 1 }] };
    expect(leerParticipaciones(viejo)).toEqual({ periodo_referencia: null, por_clave_flujo: viejo.por_clave_flujo, por_marca: null, por_talla: viejo.por_talla });
    expect(leerParticipaciones(null)).toBeNull();
    expect(leerParticipaciones({ por_marca: [] })).toBeNull();
  });

  it("una fila sin venta en W12 → null", () => {
    expect(participacionesFila([], configFlujo(), PERIODO)).toBeNull();
    expect(participacionesFila([{ gml_id: N.denim, equivalencia_id: null, agrupacion_marca_id: AM.rec, marca_id: MARCA.alfa, agrupacion_talla_id: "t", unidades: 0 }], configFlujo(), PERIODO)).toBeNull();
  });
});

describe("explicaciones (regla 27)", () => {
  const s = calcularProyeccion(entrada());
  const textos = () => [
    ...s.filas.flatMap((f) => f.registros.map((r) => r.explicacion)),
    ...s.tiendas.map((t) => t.explicacion),
  ].filter((t) => t !== "");

  it("usa el formato es-PE de la pantalla: ningún número sale crudo con decimales largos", () => {
    for (const t of textos()) {
      expect(t).not.toMatch(/\d\.\d{3,}/);
      expect(t.length).toBeGreaterThan(10);
    }
    expect(textos().length).toBeGreaterThan(10);
  });

  it("nombra el método, las cifras, la curva y la versión; con Niño lo dice; con plan_anterior, la cerrada usada", () => {
    const abrigo = s.filas.find((f) => f.clave === clave("abrigo", AM.rec, EQ.parka))!.registros;
    expect(abrigo[0].explicacion).toContain("HO INVIERNO v1");
    expect(abrigo[0].explicacion).toContain("se cancela");
    expect(abrigo[1].explicacion).toContain("a 0 % sobre la base normalizada serían");
    expect(abrigo[1].explicacion).toContain("sin corregir por el Niño");
    const san = s.filas.find((f) => f.clave === clave("sandalia", AM.val))!.registros[0].explicacion;
    expect(san).toContain("set ÷ 1.24");
    expect(san).toContain("oct–dic × 1.24");
    const plan = calcularProyeccion(entrada({ k: 2, planAnterior: { nombre: "Proyección 2025–2026", totales: new Map([[clave("sandalia", AM.val), 1200]]) } }));
    expect(plan.filas.find((f) => f.clave === clave("sandalia", AM.val))!.registros[0].explicacion).toContain("Proyección 2025–2026");
  });

  it("cambia si cambia cualquier entrada (propiedad sobre el fixture)", () => {
    const base = { metodo: "avance" as const, anio: Y, anioEnCurso: Y, k: 9, vendido: 1350, propuesto: 1800, curvaTexto: "DENIM HO v1", tiendas: 3, avance: 0.75 };
    const t0 = explicar(base);
    for (const cambio of [{ vendido: 1351 }, { propuesto: 1801 }, { curvaTexto: "DENIM HO v2" }, { tiendas: 4 }, { avance: 0.76 }, { k: 8 }]) {
      expect(explicar({ ...base, ...cambio })).not.toBe(t0);
    }
  });

  it("textoCurva y textoNinoCierre", () => {
    expect(textoCurva([])).toBeNull();
    expect(textoCurva([{ nombre: "A", version: 1, peso: 0.8 }, { nombre: "B", version: 2, peso: 0.2 }])).toBe("A v1 (80 %) + B v2 (20 %)");
    expect(textoNinoCierre(Array(12).fill(1), 9)).toBeNull();
  });
});

describe("esquemas de entrada", () => {
  it("crear: nombre obligatorio, hasta_periodo aaaa-mm, parámetros parciales y rampa válida", () => {
    expect(crearSchema.safeParse({ nombre: "  Proyección 2026–2027 " }).data?.nombre).toBe("Proyección 2026–2027");
    expect(crearSchema.safeParse({ nombre: "" }).success).toBe(false);
    expect(crearSchema.safeParse({ nombre: "x", hasta_periodo: "2026-13" }).success).toBe(false);
    expect(crearSchema.safeParse({ nombre: "x", parametros: { rampa_maduracion: [3, 1, 1] } }).success).toBe(true);
    expect(crearSchema.safeParse({ nombre: "x", parametros: { rampa_maduracion: [6] } }).success).toBe(false);
    expect(crearSchema.safeParse({ nombre: "x", parametros: { crecimiento_pct_defecto: 600 } }).success).toBe(false);
    expect(parametrosSchema.partial().safeParse({ umbral_cola_larga: 100 }).success).toBe(true);
    expect(editarSchema.safeParse({}).success).toBe(false);
  });

  it("decisión: manual exige cifra; propuesta no; nota ≤ 300; crecimiento −95..500", () => {
    expect(decisionSchema.safeParse({ origen: "manual" }).success).toBe(false);
    expect(decisionSchema.safeParse({ origen: "propuesta" }).success).toBe(true);
    expect(decisionSchema.safeParse({ decidido: 100, origen: "manual", nota: "x".repeat(301) }).success).toBe(false);
    expect(decisionSchema.safeParse({ decidido: null }).success).toBe(true);
    expect(decisionSchema.safeParse({ decidido: -1 }).success).toBe(false);
    expect(decisionSchema.safeParse({ decidido: 1.5 }).success).toBe(false);
    expect(decisionSchema.safeParse({ crecimiento_pct: -96, decidido: 5 }).success).toBe(false);
    expect(decisionTiendaSchema.safeParse({ rampa: [0.7, 0.85, 1] }).success).toBe(true);
    expect(decisionTiendaSchema.safeParse({ rampa: [0] }).success).toBe(false);
  });

  it("aplicar-curva: uno de los dos selectores; factores: rango del ratio; consultas con valores por defecto", () => {
    expect(aplicarCurvaSchema.safeParse({}).success).toBe(false);
    expect(aplicarCurvaSchema.safeParse({ gml_id: "5d0f9c3e-8a3d-4f4b-9f58-2f0c8a8d9e11", anio: 2026 }).success).toBe(true);
    expect(aplicarCurvaSchema.safeParse({ gml_id: "5d0f9c3e-8a3d-4f4b-9f58-2f0c8a8d9e11", fila_anio_ids: ["5d0f9c3e-8a3d-4f4b-9f58-2f0c8a8d9e11"] }).success).toBe(false);
    expect(factoresPutSchema.safeParse({ factores: [{ anio: 2026, temporada: "invierno", ratio_aplicado: 0.66 }] }).success).toBe(true);
    expect(factoresPutSchema.safeParse({ factores: [{ anio: 2026, temporada: "invierno", ratio_aplicado: 3.5 }] }).success).toBe(false);
    expect(factoresPutSchema.safeParse({ factores: [{ anio: 2026, temporada: "otoño", ratio_aplicado: null }] }).success).toBe(false);
    expect(matrizQuerySchema.parse({}).por).toBe("arbol");
    expect(mensualQuerySchema.parse({ por_agrupacion: "1" })).toMatchObject({ bloque: "todas", por_agrupacion: true });
    expect(mensualQuerySchema.safeParse({ bloque: "xx" }).success).toBe(false);
  });
});

void bloquesDeAnio;
