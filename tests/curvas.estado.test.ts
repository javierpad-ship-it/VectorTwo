import { describe, expect, it } from "vitest";
import { armarEstadoCurvas, avisoInactivaConCurva, curvaDeRecomendada, estadoDeAgrupacion, type AgrupacionLeida } from "@/lib/curvas/estado";
import { evaluarEstadoVigente, evaluarObsolescencia, type CorridaParaObsolescencia, type EstadoGlobalActual, type EvaluacionVigente } from "@/lib/curvas/obsolescencia";
import { agrupacionesDeTemporada, huellaTemporada } from "@/lib/curvas/huellas";
import { VERSION_MODELO } from "@/lib/curvas/modelo";
import { armarFoto, estadoGlobalActual, prepararTrabajo } from "@/lib/curvas/trabajo";
import { ventaPorTienda } from "@/lib/curvas/entrada";
import type { PeriodoAtipicoApi, VigenteResumenApi } from "@/lib/curvas/tipos-api";
import {
  ABRIGO_ID,
  CONSTANTE_ID,
  PERIODOS_NINO,
  PUBLICADOS,
  T4,
  VERANO_ID,
  agrupacionDe,
  corridaFixture,
  entradaFixture,
  filasFixture,
  insumosFixture,
  parametros,
  tiendasFixture,
} from "./curvas.fixture";

const salida = corridaFixture("base");

const agr = (id: string, nombre: string, temporada: AgrupacionLeida["temporada"], extra: Partial<AgrupacionLeida> = {}): AgrupacionLeida => ({
  id,
  nombre,
  codigo: nombre.slice(0, 3),
  activo: true,
  orden: 0,
  temporada,
  temporada_sugerida: null,
  generos: ["HOMBRE"],
  equivalencias_activas: 10,
  ...extra,
});
const AGRUPACIONES = [agr(VERANO_ID, "VERANO", "verano"), agr(ABRIGO_ID, "ABRIGO", "invierno"), agr(CONSTANTE_ID, "CONSTANTE", "todo_el_ano")];

const vigenteDe = (modelo: "A" | "B", extra: Partial<VigenteResumenApi> = {}): VigenteResumenApi => ({
  id: "v1",
  version: 1,
  modelo,
  origen: "propia",
  origen_curva: "sistema",
  curva_manual: null,
  recomendada: true,
  recomendada_entonces: "A",
  eat: 10,
  aprobada_at: "2026-10-14T10:00:00Z",
  usuario_nombre: "Javier",
  foto_id: "f1",
  hasta_periodo: "2026-09",
  hasta_fue_por_defecto: true,
  nota: null,
  curva: Array(12).fill(1 / 12),
  parametros: parametros(),
  huella_calculo: "h",
  version_modelo: VERSION_MODELO,
  anios_ajuste: [2024, 2025],
  ruido_normal: 8.2,
  ...extra,
});

const periodosApi: PeriodoAtipicoApi[] = PERIODOS_NINO.map((p) => ({
  id: p.id,
  desde: p.desde,
  hasta: p.hasta,
  motivo: p.motivo,
  descripcion: null,
  temporadas: [...(p.temporadas ?? [])],
  alcance: "invierno",
  activo: true,
  created_at: "x",
  updated_at: "x",
}));

const base = {
  datos: { desde: "2023-01", hasta: "2026-09", meses_publicados: 45, faltantes: [], ultimo_mes_cerrado: "2026-09" },
  periodos: periodosApi,
  vigentes: new Map<string, VigenteResumenApi>(),
  evaluaciones: new Map<string, EvaluacionVigente>(),
  versiones: new Map<string, number>(),
  prerrequisitos: { meses_publicados: PUBLICADOS, hasta_periodo: "2026-09", tiendas: tiendasFixture(), venta_tienda: ventaPorTienda(filasFixture("base")) },
  equivalencias_sin_agrupacion: 3,
};

describe("regla 40 · estadoDeAgrupacion", () => {
  const obsoleta = { motivos: [{ codigo: "carga_nueva" as const, detalle: "x" }] };
  it("sin vigente → sin_curva; con motivos → obsoleta; recomendada → al_dia; otra → al_dia_distinta; inactiva con vigente gana", () => {
    expect(estadoDeAgrupacion(null, null, true)).toBe("sin_curva");
    expect(estadoDeAgrupacion({ recomendada: true }, obsoleta, true)).toBe("obsoleta");
    expect(estadoDeAgrupacion({ recomendada: true }, null, true)).toBe("al_dia");
    expect(estadoDeAgrupacion({ recomendada: false }, null, true)).toBe("al_dia_distinta");
    expect(estadoDeAgrupacion({ recomendada: false }, obsoleta, false)).toBe("inactiva_con_curva");
    expect(avisoInactivaConCurva(false, true)).toBe(true);
  });
});

describe("armarEstadoCurvas v2 (regla 33 y 50)", () => {
  it("sin periodos: ABRIGO y VERANO bloqueadas por periodos_temporada_faltantes, CONSTANTE no; el aviso global cuenta las agrupaciones", () => {
    const e = armarEstadoCurvas({ ...base, periodos: [], agrupaciones: AGRUPACIONES });
    const por = (id: string) => e.agrupaciones.find((a) => a.id === id)!;
    expect(por(ABRIGO_ID).bloqueada_por).toEqual(["periodos_temporada_faltantes"]);
    expect(por(VERANO_ID).bloqueada_por).toEqual(["periodos_temporada_faltantes"]);
    expect(por(CONSTANTE_ID).bloqueada_por).toEqual([]);
    const global = e.prerrequisitos_globales.find((p) => p.codigo === "periodos_temporada_faltantes")!;
    expect(global.detalle).toContain("invierno (1 agrupación)");
    expect(global.detalle).toContain("verano (1 agrupación)");
    expect(global.enlace).toEqual({ pantalla: "periodos" });
    expect(e.resumen).toMatchObject({ agrupaciones_activas: 3, sin_curva: 3, bloqueadas: 2, bloqueadas_sin_curva: 2, calculables_sin_curva: 1, equivalencias_sin_agrupacion: 3 });
  });
  it("con periodos nadie está bloqueado; periodos_aplicables cuenta los de su temporada", () => {
    const e = armarEstadoCurvas({ ...base, agrupaciones: AGRUPACIONES });
    expect(e.agrupaciones.every((a) => a.bloqueada_por.length === 0)).toBe(true);
    expect(e.agrupaciones.find((a) => a.id === ABRIGO_ID)!.periodos_aplicables).toBe(2);
    expect(e.agrupaciones.find((a) => a.id === CONSTANTE_ID)!.periodos_aplicables).toBe(0);
    expect(e.prerrequisitos_globales).toEqual([]);
  });
  it("estados, avisos y conteos: activas = al_dia + al_dia_distintas + obsoletas + sin_curva; sin_curva = bloqueadas_sin_curva + calculables", () => {
    const vigentes = new Map([
      [ABRIGO_ID, vigenteDe("A")],
      [VERANO_ID, vigenteDe("B", { recomendada: false })],
      [CONSTANTE_ID, vigenteDe("A", { origen: "prestada" })],
    ]);
    const evaluaciones = new Map<string, EvaluacionVigente>([
      [CONSTANTE_ID, { motivos: [{ codigo: "temporada_recompuesta", detalle: "cambió" }], avisos: [] }],
      [ABRIGO_ID, { motivos: [], avisos: [{ codigo: "modelo_anterior", detalle: "d" }] }],
    ]);
    const e = armarEstadoCurvas({ ...base, agrupaciones: AGRUPACIONES, vigentes, evaluaciones });
    const estados = Object.fromEntries(e.agrupaciones.map((a) => [a.id, a.estado]));
    expect(estados).toEqual({ [ABRIGO_ID]: "al_dia", [VERANO_ID]: "al_dia_distinta", [CONSTANTE_ID]: "obsoleta" });
    expect(e.agrupaciones.find((a) => a.id === ABRIGO_ID)!.avisos_vigente.map((x) => x.codigo)).toEqual(["modelo_anterior"]);
    const r = e.resumen;
    expect(r).toMatchObject({ al_dia: 1, al_dia_distintas: 1, obsoletas: 1, sin_curva: 0, con_curva_vigente: 3, vigentes_prestadas: 1 });
    expect(r.agrupaciones_activas).toBe(r.al_dia + r.al_dia_distintas + r.obsoletas + r.sin_curva);
    expect(r.sin_curva).toBe(r.bloqueadas_sin_curva + r.calculables_sin_curva);
  });
  it("una vigente que confirmó «sin años atípicos» no cuenta como bloqueada por periodos", () => {
    const vigentes = new Map([[ABRIGO_ID, vigenteDe("A", { parametros: parametros({ sin_periodos_confirmado: true }) })]]);
    const e = armarEstadoCurvas({ ...base, periodos: [], agrupaciones: AGRUPACIONES, vigentes });
    expect(e.agrupaciones.find((a) => a.id === ABRIGO_ID)!.bloqueada_por).toEqual([]);
    expect(e.prerrequisitos_globales.find((p) => p.codigo === "periodos_temporada_faltantes")!.detalle).not.toContain("invierno");
  });
  it("una tienda con venta y sin apertura bloquea las tres con enlace; es global y por fila", () => {
    const tiendas = tiendasFixture().map((t) => (t.id === T4 ? { ...t, fecha_apertura: null } : t));
    const e = armarEstadoCurvas({ ...base, agrupaciones: AGRUPACIONES, prerrequisitos: { ...base.prerrequisitos, tiendas } });
    for (const a of e.agrupaciones) expect(a.bloqueada_por).toEqual(["tienda_sin_apertura"]);
    expect(e.prerrequisitos_globales).toHaveLength(1);
    expect(e.prerrequisitos_globales[0].enlace).toEqual({ pantalla: "tiendas", id: T4 });
  });
  it("sin meses publicados: aviso global bloqueante; faltantes: aviso", () => {
    const sin = armarEstadoCurvas({ ...base, agrupaciones: AGRUPACIONES, prerrequisitos: { ...base.prerrequisitos, meses_publicados: [], hasta_periodo: null } });
    expect(sin.prerrequisitos_globales.map((p) => p.codigo)).toContain("sin_meses_publicados");
    const huecos = armarEstadoCurvas({ ...base, agrupaciones: AGRUPACIONES, prerrequisitos: { ...base.prerrequisitos, meses_publicados: PUBLICADOS.filter((m) => m !== "2025-11") } });
    expect(huecos.prerrequisitos_globales.find((p) => p.codigo === "meses_sin_cargar")!.detalle).toBe("Falta cargar 2025-11.");
  });
  it("ordena por orden y nombre, con las inactivas con curva al final y las inactivas sin curva fuera", () => {
    const todas = [
      agr("i1", "INACTIVA CON CURVA", "verano", { activo: false }),
      agr("i2", "INACTIVA SIN CURVA", "verano", { activo: false }),
      agr("z", "Z", "invierno", { orden: 2 }),
      agr("a", "A", "invierno", { orden: 1 }),
    ];
    const e = armarEstadoCurvas({ ...base, agrupaciones: todas, vigentes: new Map([["i1", vigenteDe("A")]]) });
    expect(e.agrupaciones.map((a) => a.id)).toEqual(["a", "z", "i1"]);
    expect(e.agrupaciones.at(-1)!.estado).toBe("inactiva_con_curva");
    expect(e.resumen).toMatchObject({ agrupaciones_activas: 2, inactivas_con_curva: 1 });
  });
});

describe("curvaDeRecomendada", () => {
  it("devuelve la curva de la candidata recomendada, la T si es T y null sin recomendada", () => {
    const a = agrupacionDe(salida, ABRIGO_ID);
    expect(curvaDeRecomendada(a, null)).toEqual(a.candidatas.find((c) => c.modelo === "A")?.curva);
    expect(curvaDeRecomendada({ ...a, recomendada: "T" }, { curva_T: [1] })).toEqual([1]);
    expect(curvaDeRecomendada({ ...a, recomendada: null }, null)).toBeNull();
  });
});

// ─── Obsolescencia (reglas 49, 51, 52, 55; casos 23, 26, 28, 30) ───

const trabajoDe = (id: string, opciones: Parameters<typeof insumosFixture>[2] = {}, hasta?: string, p = parametros()) => {
  const r = prepararTrabajo(insumosFixture(id, "base", opciones), p, hasta);
  if (r.rechazo) throw new Error(r.rechazo.mensaje);
  return r.trabajo;
};

/** Una foto como la deja `PUT`: SIN `resultado` (regla 52). */
function fotoDe(id: string, opciones: Parameters<typeof insumosFixture>[2] = {}, hasta?: string): CorridaParaObsolescencia {
  const insumos = insumosFixture(id, "base", opciones);
  const t = trabajoDe(id, opciones, hasta);
  const f = armarFoto(t, insumos.agrupacion, insumos.periodos, 1)!;
  return {
    id: `foto-${id}`,
    hasta_periodo: String(f.hasta_periodo).slice(0, 7),
    parametros: parametros(),
    red_comparable: t.entrada!.redes,
    resumen: f.resumen as CorridaParaObsolescencia["resumen"],
  };
}

const estadoHoy = (opciones: Parameters<typeof insumosFixture>[2] = {}, extra: Partial<EstadoGlobalActual> = {}): EstadoGlobalActual => {
  const todas = [ABRIGO_ID, VERANO_ID, CONSTANTE_ID];
  const insumos = insumosFixture(ABRIGO_ID, "base", opciones);
  const lista = [
    ...new Map(
      todas.flatMap((id) => {
        const i = insumosFixture(id, "base", opciones);
        return [[i.agrupacion.id, i.agrupacion] as const];
      })
    ).values(),
  ];
  return {
    ...estadoGlobalActual({
      tiendas: opciones.tiendas ?? tiendasFixture(),
      venta: ventaPorTienda(filasFixture("base")),
      cargas: insumos.venta.cargas,
      periodos: opciones.periodos ?? PERIODOS_NINO,
      agrupaciones: lista,
      activas: lista.filter((a) => a.activo).map((a) => ({ id: a.id, nombre: a.nombre, temporada: a.temporada, huella: a.huella })),
      hoy: "2026-10-15",
    }),
    ...extra,
  };
};

const evaluar = (id: string, foto: CorridaParaObsolescencia, modelo: string, actual: EstadoGlobalActual) =>
  evaluarObsolescencia([{ agrupacion_id: id, corrida_id: foto.id, composicion: { equivalencias: 10, huella: `huella-${id}` }, modelo }], new Map([[foto.id, foto]]), actual).get(id)!;

describe("regla 52 · la foto se basta sin resultado", () => {
  it("sin cambios: ningún motivo ni aviso, con la foto SIN resultado", () => {
    const foto = fotoDe(ABRIGO_ID);
    expect((foto as { resultado?: unknown }).resultado).toBeUndefined();
    const e = evaluar(ABRIGO_ID, foto, "A", estadoHoy());
    expect(e).toEqual({ motivos: [], avisos: [] });
  });
  it("da los mismos motivos con la foto entera (resultado) que sin él", () => {
    const sin = fotoDe(ABRIGO_ID);
    const conResultado = { ...sin, resultado: { agrupaciones: [agrupacionDe(salida, ABRIGO_ID)] } };
    const hoy = estadoHoy({ periodos: PERIODOS_NINO.filter((p) => p.id !== "nino-2023-inv") });
    expect(evaluar(ABRIGO_ID, sin, "A", hoy).motivos.map((m) => m.codigo)).toEqual(["periodo_cambiado"]);
    expect(evaluar(ABRIGO_ID, conResultado, "A", hoy).motivos.map((m) => m.codigo)).toEqual(["periodo_cambiado"]);
  });
  it("resumen.temporada y resumen.atipicos son los que comparan temporada_cambiada y periodo_cambiado", () => {
    const foto = fotoDe(ABRIGO_ID);
    expect(foto.resumen.temporada).toBe("invierno");
    expect(foto.resumen.atipicos!.length).toBeGreaterThan(0);
    const actual = estadoHoy();
    (actual.agrupaciones as Map<string, { temporada: "invierno" | "verano" | "todo_el_ano"; equivalencias: number; huella: string }>).set(ABRIGO_ID, { temporada: "todo_el_ano", equivalencias: 10, huella: `huella-${ABRIGO_ID}` });
    expect(evaluar(ABRIGO_ID, foto, "A", actual).motivos.map((m) => m.codigo)).toEqual(["temporada_cambiada"]);
  });
  it("una foto de la 0.9.6 (sin atipicos ni temporada en el resumen) usa el resultado y no avisa en falso", () => {
    const vieja: CorridaParaObsolescencia = {
      id: "vieja",
      hasta_periodo: "2026-09",
      parametros: parametros(),
      red_comparable: entradaFixture("base").redes,
      resumen: { cargas: Object.fromEntries(PUBLICADOS.map((m) => [m, `carga-${m}`])) },
      resultado: { agrupaciones: salida.resultado.agrupaciones },
    };
    expect(evaluar(ABRIGO_ID, vieja, "A", estadoHoy()).motivos).toEqual([]);
    const sinResultado = { ...vieja, resultado: undefined };
    expect(evaluar(ABRIGO_ID, sinResultado, "A", estadoHoy()).motivos).toEqual([]);
  });
});

describe("regla 49 y caso 23 · carga_nueva solo hasta el hasta de la foto", () => {
  const foto0826 = () => {
    const f = fotoDe(ABRIGO_ID, { publicados: PUBLICADOS.filter((m) => m <= "2026-08") }, "2026-08");
    return f;
  };
  const todasLasCargas = Object.fromEntries(PUBLICADOS.map((m) => [m, `carga-${m}`]));
  it("hasta = 2026-08 y 2026-09 publicado pero NO cerrado → datos_posteriores, sin motivos", () => {
    const foto = foto0826();
    const e = evaluar(ABRIGO_ID, foto, "A", estadoHoy({}, { cargas: todasLasCargas, hasta_actual: "2026-08" }));
    expect(e.motivos.filter((m) => m.codigo === "carga_nueva")).toEqual([]);
    expect(e.avisos).toHaveLength(1);
    expect(e.avisos[0].codigo).toBe("datos_posteriores");
    expect(e.avisos[0].detalle).toContain("1 mes publicado después de 2026-08");
  });
  it("con el mes cerrado (hasta por defecto ya lo incluye) → carga_nueva", () => {
    const e = evaluar(ABRIGO_ID, foto0826(), "A", estadoHoy({}, { cargas: todasLasCargas, hasta_actual: "2026-09" }));
    expect(e.motivos.map((m) => m.codigo)).toEqual(["carga_nueva"]);
    expect(e.motivos[0].detalle).toContain("ya cerrado: 2026-09");
    expect(e.avisos).toEqual([]);
  });
  it("hasta_fue_por_defecto = false: los meses posteriores son SIEMPRE aviso, aunque estén cerrados (caso 28)", () => {
    const foto = foto0826();
    foto.resumen.hasta_fue_por_defecto = false;
    const e = evaluar(ABRIGO_ID, foto, "A", estadoHoy({}, { cargas: todasLasCargas, hasta_actual: "2026-09" }));
    expect(e.motivos.filter((m) => m.codigo === "carga_nueva")).toEqual([]);
    expect(e.avisos.map((a) => a.codigo)).toEqual(["datos_posteriores"]);
  });
  it("reaprobar con el hasta nuevo (2026-09) deja motivos = []", () => {
    const foto = fotoDe(ABRIGO_ID, {}, "2026-09");
    expect(evaluar(ABRIGO_ID, foto, "A", estadoHoy({}, { hasta_actual: "2026-09" }))).toEqual({ motivos: [], avisos: [] });
  });
  it("republicar un mes ≤ hasta con otro carga_id sigue siendo carga_nueva (cerrado o no)", () => {
    for (const hasta_actual of ["2026-08", "2026-09"]) {
      const e = evaluar(ABRIGO_ID, foto0826(), "A", estadoHoy({}, { cargas: { ...todasLasCargas, "2024-03": "republicada" }, hasta_actual }));
      expect(e.motivos.map((m) => m.codigo)).toContain("carga_nueva");
      expect(e.motivos.find((m) => m.codigo === "carga_nueva")!.detalle).toContain("2024-03");
    }
  });
  it("con hasta guardado y mes ≤ hasta que falta en la foto → carga_nueva (mes nuevo dentro del rango)", () => {
    const foto = foto0826();
    delete (foto.resumen.cargas as Record<string, string>)["2024-03"];
    const e = evaluar(ABRIGO_ID, foto, "A", estadoHoy({}, { cargas: todasLasCargas, hasta_actual: "2026-08" }));
    expect(e.motivos.map((m) => m.codigo)).toContain("carga_nueva");
  });
  it("sin hasta guardado (curvas de la 0.9.6) cuentan todos los meses publicados, como antes", () => {
    const foto = foto0826();
    const heredada = { ...foto, resumen: { cargas: foto.resumen.cargas } };
    const e = evaluar(ABRIGO_ID, { ...heredada, hasta_periodo: "2026-08" }, "A", estadoHoy({}, { cargas: todasLasCargas, hasta_actual: "2026-08" }));
    expect(e.motivos.filter((m) => m.codigo === "carga_nueva")).toEqual([]);
  });
});

describe("regla 51 y caso 26 · temporada recompuesta", () => {
  /** Dos agrupaciones de invierno (ABRIGO y OTRA) y una de verano: PEQUEÑA (prestada) vive en invierno. */
  const hoy = (cambio: (lista: { id: string; nombre: string; temporada: "invierno" | "verano" | "todo_el_ano"; huella: string }[]) => void = () => undefined) => {
    const lista = [
      { id: ABRIGO_ID, nombre: "ABRIGO", temporada: "invierno" as const, huella: `huella-${ABRIGO_ID}` },
      { id: "pequena", nombre: "PEQUEÑA", temporada: "invierno" as const, huella: "huella-pequena" },
      { id: VERANO_ID, nombre: "VERANO", temporada: "verano" as const, huella: `huella-${VERANO_ID}` },
    ];
    cambio(lista);
    const actual = estadoHoy();
    return {
      ...actual,
      agrupaciones: new Map(lista.map((a) => [a.id, { temporada: a.temporada, equivalencias: 10, huella: a.huella }])),
      activas: lista,
    };
  };
  const fotoConTrios = (id: string) => {
    const f = fotoDe(id);
    const lista = [
      { id: ABRIGO_ID, temporada: "invierno" as const, huella: `huella-${ABRIGO_ID}` },
      { id: "pequena", temporada: "invierno" as const, huella: "huella-pequena" },
      { id: VERANO_ID, temporada: "verano" as const, huella: `huella-${VERANO_ID}` },
    ];
    f.resumen.huella_temporada = huellaTemporada(agrupacionesDeTemporada("invierno", lista));
    f.resumen.agrupaciones_temporada = agrupacionesDeTemporada("invierno", lista);
    f.resumen.temporada = "invierno";
    return f;
  };
  it("sin cambios no hay motivo ni aviso", () => {
    expect(evaluar(ABRIGO_ID, fotoConTrios(ABRIGO_ID), "T", hoy())).toEqual({ motivos: [], avisos: [] });
  });
  it("curva PRESTADA (T): cambia la composición de otra agrupación de invierno → obsoleta, y el detalle nombra la agrupación", () => {
    const e = evaluar(ABRIGO_ID, fotoConTrios(ABRIGO_ID), "T", hoy((l) => { l[1].huella = "nueva"; }));
    expect(e.motivos.map((m) => m.codigo)).toEqual(["temporada_recompuesta"]);
    expect(e.motivos[0].detalle).toContain("PEQUEÑA");
    expect(e.avisos).toEqual([]);
  });
  it("curva PROPIA: el mismo cambio solo avisa, motivos = []", () => {
    const e = evaluar(ABRIGO_ID, fotoConTrios(ABRIGO_ID), "A", hoy((l) => { l[1].huella = "nueva"; }));
    expect(e.motivos).toEqual([]);
    expect(e.avisos.map((a) => a.codigo)).toEqual(["temporada_recompuesta"]);
    expect(e.avisos[0].detalle).toContain("PEQUEÑA");
  });
  it("cambia de temporada o se desactiva una agrupación de la temporada → también cuenta; revertir limpia", () => {
    const f = fotoConTrios(ABRIGO_ID);
    expect(evaluar(ABRIGO_ID, f, "T", hoy((l) => { l[1].temporada = "verano"; })).motivos.map((m) => m.codigo)).toEqual(["temporada_recompuesta"]);
    expect(evaluar(ABRIGO_ID, f, "T", hoy((l) => { l.splice(1, 1); })).motivos.map((m) => m.codigo)).toEqual(["temporada_recompuesta"]);
    expect(evaluar(ABRIGO_ID, f, "T", hoy()).motivos).toEqual([]);
  });
  it("una agrupación de verano no afecta a la prestada de invierno", () => {
    expect(evaluar(ABRIGO_ID, fotoConTrios(ABRIGO_ID), "T", hoy((l) => { l[2].huella = "otra"; }))).toEqual({ motivos: [], avisos: [] });
  });
  it("una agrupación de toda temporada movida cuenta para todas las temporadas (el control)", () => {
    const lista = [
      { id: ABRIGO_ID, temporada: "invierno" as const, huella: `huella-${ABRIGO_ID}` },
      { id: "c", temporada: "todo_el_ano" as const, huella: "c" },
    ];
    const f = fotoDe(ABRIGO_ID);
    f.resumen.huella_temporada = huellaTemporada(agrupacionesDeTemporada("invierno", lista));
    const actual = estadoHoy();
    actual.activas = [
      { id: ABRIGO_ID, nombre: "ABRIGO", temporada: "invierno", huella: `huella-${ABRIGO_ID}` },
      { id: "c", nombre: "C", temporada: "todo_el_ano", huella: "movida" },
    ];
    expect(evaluar(ABRIGO_ID, f, "T", actual).motivos.map((m) => m.codigo)).toEqual(["temporada_recompuesta"]);
  });
  it("en calcular (activas solo de su temporada) no se compara la huella de una temporada que no cubre", () => {
    const f = fotoConTrios(ABRIGO_ID);
    const actual = { ...hoy(), activas_de_temporada: "verano" as const };
    actual.agrupaciones.set(ABRIGO_ID, { temporada: "verano", equivalencias: 10, huella: `huella-${ABRIGO_ID}` });
    const e = evaluar(ABRIGO_ID, f, "T", actual);
    expect(e.motivos.map((m) => m.codigo)).toEqual(["temporada_cambiada"]);
  });
});

describe("regla 55 y caso 30 · modelo anterior", () => {
  it("una foto con version_modelo menor produce el aviso modelo_anterior y NO obsoleta", () => {
    const foto = fotoDe(ABRIGO_ID);
    foto.resumen.version_modelo = VERSION_MODELO - 1;
    const e = evaluar(ABRIGO_ID, foto, "A", estadoHoy());
    expect(e.motivos).toEqual([]);
    expect(e.avisos.map((a) => a.codigo)).toEqual(["modelo_anterior"]);
    const lista = armarEstadoCurvas({
      ...base,
      agrupaciones: [agr(ABRIGO_ID, "ABRIGO", "invierno")],
      vigentes: new Map([[ABRIGO_ID, vigenteDe("A", { version_modelo: VERSION_MODELO - 1 })]]),
      evaluaciones: new Map([[ABRIGO_ID, e]]),
    });
    expect(lista.agrupaciones[0]).toMatchObject({ estado: "al_dia", obsoleta: null });
    expect(lista.agrupaciones[0].avisos_vigente.map((a) => a.codigo)).toEqual(["modelo_anterior"]);
  });
  it("la versión actual o sin dato no avisa", () => {
    const foto = fotoDe(ABRIGO_ID);
    expect(foto.resumen.version_modelo).toBe(VERSION_MODELO);
    expect(evaluar(ABRIGO_ID, foto, "A", estadoHoy()).avisos).toEqual([]);
    delete foto.resumen.version_modelo;
    expect(evaluar(ABRIGO_ID, foto, "A", estadoHoy()).avisos).toEqual([]);
  });
});

describe("evaluarObsolescencia (la red y la composición con la foto de la 06b)", () => {
  it("una tienda corregida (T4 abre en 2024-03) y un mes republicado marcan la curva con su motivo", () => {
    const tiendas = tiendasFixture().map((t) => (t.id === T4 ? { ...t, fecha_apertura: "2024-03-01" } : t));
    const foto = fotoDe(ABRIGO_ID);
    const cargas = { ...Object.fromEntries(PUBLICADOS.map((m) => [m, `carga-${m}`])), "2025-02": "republicada" };
    const e = evaluar(ABRIGO_ID, foto, "A", estadoHoy({ tiendas }, { cargas, hasta_actual: "2026-09" }));
    expect([...new Set(e.motivos.map((m) => m.codigo))].sort()).toEqual(["carga_nueva", "tienda_sale_red"]);
  });
  it("un cambio de composición solo marca a su agrupación", () => {
    const foto = fotoDe(ABRIGO_ID);
    const actual = estadoHoy();
    (actual.agrupaciones as Map<string, { temporada: "invierno" | "verano" | "todo_el_ano"; equivalencias: number; huella: string }>).set(ABRIGO_ID, { temporada: "invierno", equivalencias: 11, huella: "nueva" });
    expect(evaluar(ABRIGO_ID, foto, "A", actual).motivos.map((m) => m.codigo)).toEqual(["composicion_cambiada"]);
  });
  it("una curva sin su foto (o sin su agrupación) no se evalúa", () => {
    const r = evaluarObsolescencia([{ agrupacion_id: ABRIGO_ID, corrida_id: "borrada", composicion: null }], new Map(), estadoHoy());
    expect(r.has(ABRIGO_ID)).toBe(false);
  });
  it("evaluarEstadoVigente: sin dato de huella_temporada no evalúa temporada_recompuesta", () => {
    const foto = fotoDe(ABRIGO_ID);
    const e = evaluarEstadoVigente(
      { red_comparable: foto.red_comparable, cargas: foto.resumen.cargas ?? {}, equivalencias: 10, huella_composicion: "h", atipicos: [], temporada: "invierno" },
      { red_comparable: foto.red_comparable, cargas: foto.resumen.cargas ?? {}, equivalencias: 10, huella_composicion: "h", atipicos: [], temporada: "invierno", tiendas: new Map(), huella_temporada: "x" }
    );
    expect(e).toEqual({ motivos: [], avisos: [] });
  });
});
