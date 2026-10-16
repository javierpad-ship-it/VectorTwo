import { describe, expect, it } from "vitest";
import { evaluarCurvaUsuario } from "@/lib/curvas/curva-usuario";
import { evaluarEstadoVigente, evaluarObsolescencia, type EvaluacionVigente } from "@/lib/curvas/obsolescencia";
import { armarEstadoCurvas, estadoDeAgrupacion, type AgrupacionLeida } from "@/lib/curvas/estado";
import {
  aCurvaAprobada,
  aCurvaVigente,
  aVigenteResumen,
  curvaManualDeJson,
  esModeloAprobable,
  esModeloCurva,
  filaCurva,
  huellasDeCurva,
  motivoRechazoAprobar,
  notaRequeridaPor,
  versionesDeAgrupacion,
  type EntradaRechazoAprobar,
} from "@/lib/curvas/reglas";
import { armarFoto, comparadorContra } from "@/lib/curvas/trabajo";
import { huellaCargas } from "@/lib/curvas/huellas";
import { VERSION_MODELO } from "@/lib/curvas/modelo";
import { MODELOS, MODELOS_APROBABLES, MODELOS_CURVA, MODELOS_PROPIOS, ORIGENES_CURVA, origenCurvaDe, type CurvaManualApi, type VigenteResumenApi } from "@/lib/curvas/tipos-api";
import type { Tables } from "@/lib/supabase/database.types";
import { ABRIGO_ID, agrupacionDe, corridaFixture, parametros } from "./curvas.fixture";
import { sintInv } from "./curvas.composicion.fixture";

const USUARIO = [5, 5, 6, 8, 11, 14, 13, 12, 10, 7, 5, 4];
const salida = corridaFixture("base");
const a = agrupacionDe(salida, ABRIGO_ID);
const temporada = salida.resultado.temporadas.find((t) => t.temporada === "invierno") ?? null;
const sinBloqueo = { bloquea: [], avisa: [] };

function entrada(extra: Partial<EntradaRechazoAprobar> = {}): EntradaRechazoAprobar {
  return {
    agrupacion: { id: ABRIGO_ID, activo: true },
    prerrequisitos: sinBloqueo,
    resultado: a,
    temporada,
    modelo: "U",
    curva_usuario: USUARIO,
    huella_enviada: "h1",
    huella_actual: "h1",
    vigente: null,
    version_vigente: null,
    parametros: parametros(),
    nota: "mi motivo",
    ...extra,
  };
}

describe("regla 71 · lectores aceptan F y U desde ahora", () => {
  it("MODELOS incluye F (y no U); MODELOS_PROPIOS A..F; MODELOS_CURVA A..F y T; MODELOS_APROBABLES suma U", () => {
    expect(MODELOS.map((m) => m.codigo)).toEqual(["A", "B", "C", "D", "E", "F", "T"]);
    expect(MODELOS_PROPIOS).toEqual(["A", "B", "C", "D", "E", "F"]);
    expect(MODELOS_CURVA).toEqual(["A", "B", "C", "D", "E", "F", "T"]);
    expect(MODELOS_APROBABLES).toEqual(["A", "B", "C", "D", "E", "F", "T", "U"]);
    expect(MODELOS.find((m) => m.codigo === "F")).toMatchObject({ nombre: "Modelo avanzado", prestada: false });
  });
  it("esModeloCurva('F') es true y esModeloCurva('U') sigue false; esModeloAprobable acepta U", () => {
    expect(esModeloCurva("F")).toBe(true);
    expect(esModeloCurva("U")).toBe(false);
    expect(esModeloAprobable("U")).toBe(true);
    expect(esModeloAprobable("F")).toBe(true);
    for (const x of ["G", "", "a", "AB", 3, null, undefined]) expect(esModeloAprobable(x)).toBe(false);
  });
  it("origenCurvaDe: U → usuario, F → avanzada, el resto sistema", () => {
    expect(ORIGENES_CURVA).toEqual(["sistema", "avanzada", "usuario"]);
    expect(origenCurvaDe("U")).toBe("usuario");
    expect(origenCurvaDe("F")).toBe("avanzada");
    for (const m of ["A", "B", "C", "D", "E", "T"] as const) expect(origenCurvaDe(m)).toBe("sistema");
  });

  const fila = (modelo: string, extra: Partial<Tables<"curvas_estacionalidad">> = {}): Tables<"curvas_estacionalidad"> =>
    ({
      id: "c1",
      agrupacion_estacionalidad_id: "agr",
      version: 3,
      estado: "vigente",
      corrida_id: "f1",
      modelo,
      origen: "propia",
      origen_curva: modelo === "U" ? "usuario" : modelo === "F" ? "avanzada" : "sistema",
      curva_manual: null,
      recomendada: false,
      eat: null,
      error_max: null,
      anios_utilizados: { recomendada_entonces: "A", composicion: { equivalencias: 2, huella: "k" } },
      p01: 0.05, p02: 0.05, p03: 0.06, p04: 0.08, p05: 0.11, p06: 0.14, p07: 0.13, p08: 0.12, p09: 0.1, p10: 0.07, p11: 0.05, p12: 0.04,
      medida: "unidades",
      perfil_id: null,
      usuario_nombre: "Javier",
      nota: "n",
      aprobada_at: "2026-10-15T10:00:00Z",
      created_at: "2026-10-15T10:00:00Z",
      updated_at: "2026-10-15T10:00:00Z",
      activo: true,
      ...extra,
    }) as unknown as Tables<"curvas_estacionalidad">;
  const manual: CurvaManualApi = { valores_ingresados: USUARIO, partida: { tipo: "candidata", referencia: "F" }, en_muestra: true, eat_en_muestra: 5.2, error_max_en_muestra: 1.3, eat_en_muestra_por_anio: [{ anio: 2024, eat: 4.6, error_max: 1 }], eat_parcial_en_muestra: 3.1, igual_a: null };

  it("aVigenteResumen, aCurvaAprobada, aCurvaVigente y versionesDeAgrupacion devuelven U y F (no A) con origen_curva; curva_manual solo en U", () => {
    const u = fila("U", { curva_manual: manual as never });
    const f = fila("F", { eat: 5.13 });
    expect(aVigenteResumen(u)).toMatchObject({ modelo: "U", origen_curva: "usuario", curva_manual: manual, recomendada_entonces: "A", eat: null });
    expect(aVigenteResumen(f)).toMatchObject({ modelo: "F", origen_curva: "avanzada", curva_manual: null, eat: 5.13 });
    expect(aCurvaAprobada(u)).toMatchObject({ modelo: "U", origen_curva: "usuario", curva_manual: manual });
    expect(aCurvaAprobada(f)).toMatchObject({ modelo: "F", origen_curva: "avanzada", curva_manual: null });
    expect(aCurvaVigente(u, { codigo: "X", nombre: "x" })).toMatchObject({ modelo: "U", origen_curva: "usuario" });
    expect(aCurvaVigente(f, { codigo: "X", nombre: "x" })).toMatchObject({ modelo: "F", origen_curva: "avanzada" });
    const v = versionesDeAgrupacion([u, fila("F", { id: "c0", version: 2, estado: "reemplazada" })]);
    expect(v.map((x) => [x.version, x.modelo, x.origen_curva, x.curva_manual !== null])).toEqual([[3, "U", "usuario", true], [2, "F", "avanzada", false]]);
  });
  it("un modelo desconocido sigue degradando a A, con el origen_curva que corresponde; curva_manual con basura es null", () => {
    expect(aVigenteResumen(fila("Z", { origen_curva: "otro" }))).toMatchObject({ modelo: "A", origen_curva: "sistema" });
    expect(aVigenteResumen(fila("U", { curva_manual: { x: 1 } as never })).curva_manual).toBeNull();
    expect(curvaManualDeJson(null)).toBeNull();
    expect(curvaManualDeJson([] as never)).toBeNull();
    expect(curvaManualDeJson({ valores_ingresados: [1, 2] } as never)).toBeNull();
    expect(curvaManualDeJson(manual as never)).toEqual(manual);
  });
  it("huellasDeCurva devuelve las tres huellas también en una U", () => {
    const x = fila("U", { anios_utilizados: { composicion: { equivalencias: 2, huella: "k" }, red_huella: "r", cargas_huella: "c" } as never });
    expect(huellasDeCurva(x.anios_utilizados)).toEqual({ composicion: "k", red_huella: "r", cargas_huella: "c" });
  });
});

describe("regla 72 · motivoRechazoAprobar con U", () => {
  it("sin nada raro con nota → null", () => {
    expect(motivoRechazoAprobar(entrada())).toBeNull();
  });
  it("inactiva → agrupacion_inactiva; bloqueante (incluido sin_venta) → prerrequisitos", () => {
    expect(motivoRechazoAprobar(entrada({ agrupacion: { id: ABRIGO_ID, activo: false } }))).toMatchObject({ status: 409, codigo: "agrupacion_inactiva" });
    const sinVenta = { bloquea: [{ codigo: "sin_venta" as const, nivel: "bloquea" as const, detalle: "Sin ventas.", enlace: null }], avisa: [] };
    expect(motivoRechazoAprobar(entrada({ prerrequisitos: sinVenta }))).toMatchObject({ status: 409, codigo: "prerrequisitos" });
  });
  it("origen = null (ni propias ni T) y ninguna candidata calculable NO rechazan; candidata_no_disponible nunca con U", () => {
    const sinCandidatas = { ...a, origen: null, recomendada: null, candidatas: a.candidatas.map((c) => ({ ...c, curva: null })) };
    expect(motivoRechazoAprobar(entrada({ resultado: sinCandidatas, temporada: { curva_T: null } }))).toBeNull();
    expect(motivoRechazoAprobar(entrada({ resultado: null, temporada: null }))).toBeNull();
    // Con F o T se mantienen las reglas 41 de la 06b.
    expect(motivoRechazoAprobar(entrada({ modelo: "A", resultado: sinCandidatas, temporada: { curva_T: null } }))).toMatchObject({ codigo: "sin_curva_posible" });
    expect(motivoRechazoAprobar(entrada({ modelo: "T", temporada: { curva_T: null }, nota: "x" }))).toMatchObject({ codigo: "candidata_no_disponible" });
  });
  it("huella distinta → datos_cambiados; version_vigente distinta → vigente_cambiada (en ese orden)", () => {
    expect(motivoRechazoAprobar(entrada({ huella_enviada: "otra" }))).toMatchObject({ codigo: "datos_cambiados" });
    const vigente = { version: 2, modelo: "A", huella_calculo: "h1" };
    expect(motivoRechazoAprobar(entrada({ vigente, version_vigente: 1 }))).toMatchObject({ codigo: "vigente_cambiada" });
    expect(motivoRechazoAprobar(entrada({ huella_enviada: "otra", vigente, version_vigente: 1 }))).toMatchObject({ codigo: "datos_cambiados" });
  });
  it("vigente U con la misma huella y los mismos doce valores → sin_cambio; con otros valores sigue", () => {
    const curva = [0.05, 0.05, 0.06, 0.08, 0.11, 0.14, 0.13, 0.12, 0.1, 0.07, 0.05, 0.04];
    const vigente = { version: 2, modelo: "U", huella_calculo: "h1", curva };
    expect(motivoRechazoAprobar(entrada({ vigente, version_vigente: 2 }))).toMatchObject({ status: 409, codigo: "sin_cambio" });
    expect(motivoRechazoAprobar(entrada({ vigente, version_vigente: 2, curva_usuario: [5, 5, 6, 8, 12, 13, 13, 12, 10, 7, 5, 4] }))).toBeNull();
    // Los valores sin normalizar que dan la misma curva normalizada también son sin_cambio.
    expect(motivoRechazoAprobar(entrada({ vigente, version_vigente: 2, curva_usuario: USUARIO.map((x) => x * 1.0002) }))).toMatchObject({ codigo: "sin_cambio" });
    // Misma huella pero la vigente es de otro modelo: no es sin_cambio.
    expect(motivoRechazoAprobar(entrada({ vigente: { ...vigente, modelo: "A" }, version_vigente: 2 }))).toBeNull();
    // Otra huella (hubo datos nuevos) tampoco.
    expect(motivoRechazoAprobar(entrada({ vigente: { ...vigente, huella_calculo: "vieja" }, version_vigente: 2 }))).toBeNull();
  });
  it("nota vacía → nota_requerida con «aprobaste tu propia curva (U)»", () => {
    for (const nota of [undefined, "", "   "]) {
      const r = motivoRechazoAprobar(entrada({ nota }));
      expect(r).toMatchObject({ status: 409, codigo: "nota_requerida" });
      expect(r?.mensaje).toContain("aprobaste tu propia curva (U)");
    }
    expect(notaRequeridaPor("U", "A", parametros())).toBe("aprobaste tu propia curva (U)");
    expect(notaRequeridaPor("U", null, parametros())).toBe("aprobaste tu propia curva (U)");
    // Para F y T: la recomendada no pide nota; otra sí.
    expect(notaRequeridaPor("F", "F", parametros())).toBeNull();
    expect(notaRequeridaPor("F", "A", parametros())).toMatch(/elegiste F y el sistema recomienda A/);
    expect(notaRequeridaPor("T", "T", parametros())).toBeNull();
  });
  it("con F y T se mantienen las reglas 41: T sin curva_T → candidata_no_disponible; F con curva y recomendada → sin nota", () => {
    expect(motivoRechazoAprobar(entrada({ modelo: "F", curva_usuario: undefined, nota: "x" }))).toBeNull();
    expect(motivoRechazoAprobar(entrada({ modelo: "T", curva_usuario: undefined, temporada: { curva_T: null }, nota: "x" }))).toMatchObject({ codigo: "candidata_no_disponible" });
  });
});

describe("regla 73 · filaCurva", () => {
  const base = {
    agrupacion: a,
    temporada,
    corrida_id: "corrida-1",
    red_huella: "red-md5",
    cargas_huella: huellaCargas({ "2026-01": "c1" }),
    foto: { huella_calculo: "h-calculo", huella_temporada: "h-temporada", version_modelo: VERSION_MODELO, hasta_periodo: "2026-09", hasta_fue_por_defecto: true, parametros: parametros() },
    version_anterior: 0,
    perfil: { id: "p1", nombre: "Javier" },
  };
  const evaluacion = evaluarCurvaUsuario(USUARIO, a, temporada, { tipo: "pegado", referencia: null });
  it("origen_curva = origenCurvaDe(modelo) siempre y curva_manual no nulo ⇔ modelo U", () => {
    for (const modelo of ["A", "B", "C", "D", "E", "F", "T"] as const) {
      const f = filaCurva({ ...base, modelo })!;
      expect(f, modelo).not.toBeNull();
      expect([f.origen_curva, f.curva_manual]).toEqual([origenCurvaDe(modelo), null]);
    }
    const u = filaCurva({ ...base, modelo: "U", curva_usuario: evaluacion, nota: "mi motivo" })!;
    expect(u.origen_curva).toBe("usuario");
    expect(u.curva_manual).not.toBeNull();
  });
  it("con U: modelo U, origen propia, recomendada false, eat y error_max null, p01..p12 normalizados y curva_manual completo", () => {
    const u = filaCurva({ ...base, modelo: "U", curva_usuario: evaluacion, nota: "mi motivo", version_anterior: 2 })!;
    expect(u).toMatchObject({ modelo: "U", origen: "propia", origen_curva: "usuario", recomendada: false, eat: null, error_max: null, version: 3, nota: "mi motivo", medida: "unidades", estado: "vigente" });
    expect([u.p05, u.p06]).toEqual([0.11, 0.14]);
    const p = [u.p01, u.p02, u.p03, u.p04, u.p05, u.p06, u.p07, u.p08, u.p09, u.p10, u.p11, u.p12];
    expect(p.reduce((s, v) => s + Math.round(v * 1e6), 0)).toBe(1_000_000);
    expect(u.curva_manual).toMatchObject({ valores_ingresados: USUARIO, partida: { tipo: "pegado", referencia: null }, en_muestra: true, igual_a: null });
    expect((u.anios_utilizados as { recomendada_entonces: string | null }).recomendada_entonces).toBe(a.recomendada);
    expect((u.anios_utilizados as { anios_ajuste: number[] }).anios_ajuste).toEqual(a.anios.filter((x) => x.en_ajuste).map((x) => x.anio));
    expect(filaCurva({ ...base, modelo: "U" })).toBeNull();
  });
  it("U nunca es recomendada aunque coincida con la recomendada del sistema", () => {
    const igualA = evaluarCurvaUsuario((a.candidatas.find((c) => c.modelo === a.recomendada)!.curva as number[]).map((x) => x * 100), a, temporada);
    expect(filaCurva({ ...base, modelo: "U", curva_usuario: igualA, nota: "x" })?.recomendada).toBe(false);
  });
  it("F copia su curva y su EAT de backtesting (null si no compite) con origen_curva avanzada", () => {
    const f = filaCurva({ ...base, modelo: "F" })!;
    const cand = a.candidatas.find((c) => c.modelo === "F")!;
    expect(f).toMatchObject({ modelo: "F", origen: "propia", origen_curva: "avanzada" });
    expect(f.eat).toBe(cand.eat === null ? null : Math.round(cand.eat * 100) / 100);
  });
  it("armarFoto con U deja resultado tal cual y rellena resumen.curva_usuario; sin U no lo trae", () => {
    // Una foto mínima a partir del fixture de punta a punta: se prueba la forma, no el contenido.
    const f = sintInv();
    const trabajo = {
      hasta_periodo: "2026-09", hasta_por_defecto: "2026-09", hasta_fue_por_defecto: true, ultimo_mes_cerrado: "2026-09", meses_posteriores: [],
      cargas_huella: "c", cargas: f.venta.cargas, red_huella: "r", huella_temporada: "t", agrupaciones_temporada: [], huella_calculo: "hc", parametros: f.parametros,
      prerrequisitos: sinBloqueo, entrada: f.entrada, salida: f.salida,
    };
    const agr = { id: "agr-sint-inv", nombre: "N", codigo: "C", activo: true, temporada: "invierno" as const, temporada_sugerida: null, generos: [], equivalencias_activas: 4, huella: "h", temporadas_mezcladas: false };
    const e = evaluarCurvaUsuarioDe(f);
    const con = armarFoto(trabajo, agr, [], 10, { ...e, curva: e.curva })!;
    const sin = armarFoto(trabajo, agr, [], 10)!;
    expect(con.resultado).toEqual(sin.resultado);
    expect((con.resumen as { curva_usuario?: { valores_ingresados: number[] } }).curva_usuario?.valores_ingresados).toEqual(USUARIO);
    expect((sin.resumen as { curva_usuario?: unknown }).curva_usuario).toBeUndefined();
    const candidatas = (con.resultado as { agrupaciones: { candidatas: { modelo: string }[] }[] }).agrupaciones[0].candidatas.map((c) => c.modelo);
    expect(candidatas).not.toContain("U");
  });
  it("con F, la candidata F de la foto lleva detalle_f y explicacion_f", () => {
    const f = a.candidatas.find((c) => c.modelo === "F")!;
    expect(f.detalle_f).toBeDefined();
    expect(f.explicacion_f?.frase).toMatch(/^F se apoya en/);
  });
});

function evaluarCurvaUsuarioDe(f: ReturnType<typeof sintInv>) {
  const e = evaluarCurvaUsuario(USUARIO, f.resultado, f.temporada);
  return { valores_ingresados: e.valores_ingresados, partida: e.partida, en_muestra: e.en_muestra, eat_en_muestra: e.eat_en_muestra, error_max_en_muestra: e.error_max_en_muestra, eat_en_muestra_por_anio: e.eat_en_muestra_por_anio, eat_parcial_en_muestra: e.eat_parcial_en_muestra, igual_a: e.igual_a, curva: e.curva };
}

describe("comparadorContra con F y T", () => {
  const vigente = { modelo: "A" as const, curva: a.candidatas.find((c) => c.modelo === "A")!.curva as number[], eat: 1, anios_ajuste: a.anios.filter((x) => x.en_ajuste).map((x) => x.anio) };
  it("?modelo=F y ?modelo=T comparan la candidata pedida contra la vigente", () => {
    expect(comparadorContra(a, temporada, vigente, "F")?.modelo).toBe("F");
    expect(comparadorContra(a, temporada, vigente, "T")).toMatchObject({ modelo: "T", propuesta: temporada?.curva_T });
  });
});

describe("regla 75 · estado y avisos de una vigente U", () => {
  const sistema = (s: Partial<VigenteResumenApi> = {}) => ({ recomendada: true, ...s });
  it("estadoDeAgrupacion → curva_usuario aunque haya motivos; inactiva_con_curva gana a todo; F y T siguen la regla de siempre", () => {
    const motivos = { motivos: [{ codigo: "carga_nueva" as const, detalle: "x" }] };
    expect(estadoDeAgrupacion({ recomendada: false, origen_curva: "usuario", modelo: "U" }, motivos, true)).toBe("curva_usuario");
    expect(estadoDeAgrupacion({ recomendada: false, origen_curva: "usuario" }, null, true)).toBe("curva_usuario");
    expect(estadoDeAgrupacion({ recomendada: false, origen_curva: "usuario" }, null, false)).toBe("inactiva_con_curva");
    expect(estadoDeAgrupacion(sistema({ origen_curva: "avanzada", modelo: "F" }), null, true)).toBe("al_dia");
    expect(estadoDeAgrupacion({ recomendada: false, origen_curva: "avanzada", modelo: "F" }, null, true)).toBe("al_dia_distinta");
    expect(estadoDeAgrupacion(sistema({ origen_curva: "avanzada" }), motivos, true)).toBe("obsoleta");
    expect(estadoDeAgrupacion(null, null, true)).toBe("sin_curva");
  });

  const guardado = (extra = {}) => ({ red_comparable: [], cargas: { "2026-01": "c1" }, equivalencias: 2, huella_composicion: "k", atipicos: [], temporada: "invierno" as const, hasta_periodo: "2026-01", hasta_fue_por_defecto: true, version_modelo: VERSION_MODELO, ...extra });
  const actual = (extra = {}) => ({ red_comparable: [], cargas: { "2026-01": "c1", "2026-02": "c2" }, equivalencias: 4, huella_composicion: "otra", atipicos: [], temporada: "invierno" as const, tiendas: new Map(), hasta_por_defecto: "2026-02", ...extra });
  it("evaluarEstadoVigente con origen_curva usuario: motivos = [] y un aviso cambio_desde_aprobacion por cada motivo (mismo detalle)", () => {
    const sis = evaluarEstadoVigente(guardado(), actual());
    expect(sis.motivos.map((m) => m.codigo).sort()).toEqual(["carga_nueva", "composicion_cambiada"]);
    const u = evaluarEstadoVigente(guardado({ origen_curva: "usuario" }), actual());
    expect(u.motivos).toEqual([]);
    expect(u.avisos.filter((x) => x.codigo === "cambio_desde_aprobacion")).toHaveLength(2);
    for (const m of sis.motivos) expect(u.avisos).toContainEqual({ codigo: "cambio_desde_aprobacion", detalle: m.detalle, motivo: m.codigo });
    expect(u.avisos.find((x) => x.motivo === "composicion_cambiada")?.detalle).toMatch(/\+2 equivalencias/);
  });
  it("datos_posteriores y modelo_anterior siguen siendo avisos propios en una U; temporada_cambiada pasa a cambio_desde_aprobacion", () => {
    const u = evaluarEstadoVigente(
      guardado({ origen_curva: "usuario", hasta_periodo: "2026-01", version_modelo: 1, huella_composicion: "k" }),
      actual({ huella_composicion: "k", equivalencias: 2, cargas: { "2026-01": "c1", "2026-02": "c2" }, hasta_por_defecto: "2026-01", temporada: "verano" })
    );
    expect(u.motivos).toEqual([]);
    const codigos = u.avisos.map((x) => x.codigo);
    expect(codigos).toContain("datos_posteriores");
    expect(codigos).toContain("modelo_anterior");
    expect(u.avisos.find((x) => x.codigo === "cambio_desde_aprobacion")).toMatchObject({ motivo: "temporada_cambiada" });
  });
  it("una U sin cambios no lleva avisos; una vigente T sigue obsoleta por temporada_recompuesta y una U/propia la recibe como aviso", () => {
    expect(evaluarEstadoVigente(guardado({ origen_curva: "usuario", huella_composicion: "k", equivalencias: 2, cargas: { "2026-01": "c1" } }), actual({ huella_composicion: "k", equivalencias: 2, cargas: { "2026-01": "c1" }, hasta_por_defecto: "2026-01" }))).toEqual({ motivos: [], avisos: [] });
    const base = { huella_composicion: "k", equivalencias: 2, cargas: { "2026-01": "c1" } };
    const act = actual({ ...base, hasta_por_defecto: "2026-01", huella_temporada: "nueva" });
    const t = evaluarEstadoVigente(guardado({ ...base, modelo: "T", huella_temporada: "vieja" }), act);
    expect(t.motivos.map((m) => m.codigo)).toEqual(["temporada_recompuesta"]);
    const u = evaluarEstadoVigente(guardado({ ...base, modelo: "U", origen_curva: "usuario", huella_temporada: "vieja" }), act);
    expect(u.motivos).toEqual([]);
    expect(u.avisos.map((x) => x.codigo)).toEqual(["temporada_recompuesta"]);
    const propia = evaluarEstadoVigente(guardado({ ...base, modelo: "F", huella_temporada: "vieja" }), act);
    expect(propia.motivos).toEqual([]);
    expect(propia.avisos.map((x) => x.codigo)).toEqual(["temporada_recompuesta"]);
  });
  it("evaluarObsolescencia pasa origen_curva al evaluar la foto", () => {
    const f = sintInv();
    const corrida = {
      id: "f1",
      hasta_periodo: "2026-09",
      parametros: f.parametros,
      red_comparable: f.entrada.redes,
      resumen: { cargas: f.venta.cargas, temporada: "invierno" as const, atipicos: [], hasta_fue_por_defecto: true, version_modelo: VERSION_MODELO },
    };
    const estadoActual = {
      tiendas: f.entrada.tiendas,
      venta: f.venta.temporadas.map((t) => ({ tienda_id: t.tienda_id, periodo: t.periodo, unidades: t.unidades })),
      cargas: { ...f.venta.cargas, "2026-10": "nueva" },
      periodos: [],
      agrupaciones: new Map([["agr-sint-inv", { temporada: "invierno" as const, equivalencias: 4, huella: "otra-huella" }]]),
      hasta_actual: "2026-10",
    };
    const curva = (origen: string | null) => [{ agrupacion_id: "agr-sint-inv", corrida_id: "f1", composicion: { equivalencias: 4, huella: "huella-sint-inv" }, modelo: origen === "usuario" ? "U" : "A", origen_curva: origen }];
    const usuario = evaluarObsolescencia(curva("usuario"), new Map([["f1", corrida]]), estadoActual).get("agr-sint-inv")!;
    expect(usuario.motivos).toEqual([]);
    expect(usuario.avisos.map((x) => x.motivo)).toEqual(expect.arrayContaining(["composicion_cambiada"]));
    const sis = evaluarObsolescencia(curva("sistema"), new Map([["f1", corrida]]), estadoActual).get("agr-sint-inv")!;
    expect(sis.motivos.map((m) => m.codigo)).toContain("composicion_cambiada");
  });
  it("la lista: resumen.curvas_usuario las cuenta aparte y obsoletas nunca las incluye", () => {
    const agr = (id: string): AgrupacionLeida => ({ id, nombre: id.toUpperCase(), codigo: id, activo: true, orden: 0, temporada: "invierno", temporada_sugerida: null, generos: [], equivalencias_activas: 2 });
    const vig = (modelo: VigenteResumenApi["modelo"], origen_curva: VigenteResumenApi["origen_curva"]): VigenteResumenApi => ({
      id: "v", version: 1, modelo, origen: "propia", origen_curva, curva_manual: null, recomendada: false, recomendada_entonces: "A", eat: null, ruido_normal: null, aprobada_at: "2026-10-15T00:00:00Z", usuario_nombre: null, foto_id: "f", hasta_periodo: "2026-09", hasta_fue_por_defecto: true, nota: null, curva: Array(12).fill(1 / 12), parametros: null, huella_calculo: null, version_modelo: 2, anios_ajuste: [2024, 2025],
    });
    const motivos: EvaluacionVigente = { motivos: [{ codigo: "carga_nueva" as const, detalle: "x" }], avisos: [] };
    const evaluaciones = new Map<string, EvaluacionVigente>([
      ["u", { motivos: [], avisos: [{ codigo: "cambio_desde_aprobacion", detalle: "x", motivo: "carga_nueva" }] }],
      ["s", motivos],
    ]);
    const r = armarEstadoCurvas({
      datos: { desde: "2024-01", hasta: "2026-09", meses_publicados: 33, faltantes: [], ultimo_mes_cerrado: "2026-09" },
      agrupaciones: [agr("u"), agr("s"), agr("n")],
      vigentes: new Map([["u", vig("U", "usuario")], ["s", vig("A", "sistema")]]),
      evaluaciones,
      versiones: new Map([["u", 1], ["s", 1]]),
      periodos: [],
      prerrequisitos: { meses_publicados: [], hasta_periodo: null, tiendas: [], venta_tienda: [] },
      equivalencias_sin_agrupacion: 0,
    });
    expect(r.agrupaciones.map((x) => [x.id, x.estado])).toEqual([["n", "sin_curva"], ["s", "obsoleta"], ["u", "curva_usuario"]]);
    expect(r.resumen).toMatchObject({ curvas_usuario: 1, obsoletas: 1, con_curva_vigente: 2, al_dia: 0, al_dia_distintas: 0 });
    expect(r.agrupaciones.find((x) => x.id === "u")?.obsoleta).toBeNull();
    expect(r.agrupaciones.find((x) => x.id === "u")?.avisos_vigente).toHaveLength(1);
  });
});
