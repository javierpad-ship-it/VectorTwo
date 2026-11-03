import { describe, expect, it } from "vitest";
import { ErrorApi } from "../src/lib/api-client";
import { loteSchema, revertirConfirmacionSchema, revertirSchema } from "../src/lib/aprobacion/esquemas";
import { MAX_FILAS_LOTE } from "../src/lib/aprobacion/tipos-api";
import {
  CLAVES_APROBACION,
  PARAMETROS_APROBACION_INICIALES,
  accionDeBloqueo,
  agruparPorGm,
  avisosDeConfirmacion,
  combinarResultados,
  cuerpoLote,
  exigeRevision,
  filtrarFilas,
  filtroLoteDe,
  hayFiltroAprobacion,
  itemDeFila,
  leerParametrosAprobacion,
  motivoNoSeleccionable,
  parametrosAUrl,
  planearTandas,
  rechazosPorCodigo,
  resumenSeleccion,
  rutaAprobacion,
  textoBarraSeleccion,
  textoPendientesCierre,
  textoPorFuente,
  textoReaprobables,
  textoResultadoAprobar,
  textoSeAprueba,
  traducirErrorAprobacion,
  urlAprobacionApi,
  urlRevertirConfirmacion,
  urlRevertirLote,
  valorSugerido,
  type ItemSeleccion,
  type ParametrosAprobacion,
} from "../src/app/(app)/planificacion/proyeccion/aprobacion-vista";
import { PESTANAS, esPestana } from "../src/app/(app)/planificacion/proyeccion/vista";
import { aplicarReversion, aplicarTandas, idsDeReversion, resultadoDeHechas, simularConfirmacion, simularReversion, type Post } from "../src/app/(app)/planificacion/proyeccion/use-aprobacion";
import { GM_HU, GM_NI, PROYECCION_ID, Y, Y1, datos, efecto, fila, fila2026, filaConfianzaBaja, filaSinCifraIa, filaSinIa, gm, lote, resultado, resultadoFila, uuid } from "./aprobacion.pantalla.fixture";

const params = (q: string) => new URLSearchParams(q);
const P = (o: Partial<ParametrosAprobacion> = {}): ParametrosAprobacion => ({ ...PARAMETROS_APROBACION_INICIALES, ...o });
const SIN_FILTRO = { genero: "", mundo: "", linea: "", agrupacion_marca: "" };
const ids = (fs: readonly { fila_id: string }[]) => fs.map((f) => f.fila_id);

describe("la pestaña y la ruta (congelada para Frontend B)", () => {
  it("«Aprobación» va entre «Por línea» y «Matriz»", () => {
    const orden = PESTANAS.map((p) => p.id);
    expect(orden.indexOf("aprobacion")).toBe(orden.indexOf("linea") + 1);
    expect(orden.indexOf("matriz")).toBe(orden.indexOf("aprobacion") + 1);
    expect(PESTANAS.find((p) => p.id === "aprobacion")?.etiqueta).toBe("Aprobación");
    expect(esPestana("aprobacion")).toBe(true);
  });

  it("rutaAprobacion deja la pestaña y el filtro en la URL, siempre en el mismo orden, sin lo vacío ni el modo por defecto", () => {
    expect(rutaAprobacion("p1")).toBe("/planificacion/proyeccion?proyeccion=p1&pestana=aprobacion");
    expect(rutaAprobacion("p1", { anio: 2027, gm: GM_HU })).toBe(`/planificacion/proyeccion?proyeccion=p1&pestana=aprobacion&anio=2027&gm=${GM_HU}`);
    expect(rutaAprobacion("p1", { modo: "aprobar" })).toBe("/planificacion/proyeccion?proyeccion=p1&pestana=aprobacion");
    expect(rutaAprobacion("p1", { modo: "reaprobar", anio: 2026, genero: "g", mundo: "m", linea: "l", agrupacion_marca: "a" })).toBe(
      "/planificacion/proyeccion?proyeccion=p1&pestana=aprobacion&anio=2026&modo=reaprobar&genero=g&mundo=m&linea=l&agrupacion_marca=a"
    );
  });

  it("lo que escribe rutaAprobacion lo lee leerParametrosAprobacion", () => {
    const q = new URL(rutaAprobacion("p1", { modo: "reaprobar", anio: 2027, gm: GM_HU }), "http://x").searchParams;
    expect(leerParametrosAprobacion(q)).toMatchObject({ anio: 2027, modo: "reaprobar", gm: GM_HU });
  });

  it("las rutas de la API son las de la ficha §3.1", () => {
    const base = `/api/proyeccion/proyecciones/${PROYECCION_ID}/aprobacion`;
    expect(urlAprobacionApi(PROYECCION_ID, 2026, "aprobar")).toBe(`${base}?anio=2026&modo=aprobar`);
    expect(urlRevertirLote(PROYECCION_ID, "L")).toBe(`${base}/lotes/L/revertir`);
    expect(urlRevertirConfirmacion(PROYECCION_ID, "C")).toBe(`${base}/confirmaciones/C/revertir`);
  });
});

describe("parámetros en la URL", () => {
  it("por defecto: sin avisos fuertes, con «para revisión», modo aprobar, año en curso", () => {
    expect(leerParametrosAprobacion(params(""))).toEqual(PARAMETROS_APROBACION_INICIALES);
    expect(PARAMETROS_APROBACION_INICIALES).toMatchObject({ incluirFuertes: false, incluirRevision: true, modo: "aprobar", anio: null });
  });

  it("lee todo y descarta lo que no corresponde", () => {
    expect(leerParametrosAprobacion(params("anio=2027&modo=reaprobar&gm=a.b&fuertes=1&revision=0&conf=alta,media,otra&estado_ia=al_dia,xx&brecha=12.5"))).toEqual({
      anio: 2027,
      modo: "reaprobar",
      gm: "a.b",
      incluirFuertes: true,
      incluirRevision: false,
      confianza: ["alta", "media"],
      estadoIa: ["al_dia"],
      brechaMaxPct: 12.5,
    });
    expect(leerParametrosAprobacion(params("anio=abc&modo=x&gm=sin-punto&brecha=-3"))).toEqual(PARAMETROS_APROBACION_INICIALES);
    expect(leerParametrosAprobacion(params("anio=1999")).anio).toBeNull();
  });

  it("parametrosAUrl solo toca las claves presentes y quita lo que es el valor por defecto", () => {
    expect(parametrosAUrl({ anio: 2027 })).toEqual({ anio: "2027" });
    expect(parametrosAUrl({ modo: "aprobar", gm: "" })).toEqual({ modo: null, gm: null });
    expect(parametrosAUrl({ modo: "reaprobar" })).toEqual({ modo: "reaprobar" });
    expect(parametrosAUrl({ incluirFuertes: true, incluirRevision: false })).toEqual({ fuertes: "1", revision: "0" });
    expect(parametrosAUrl({ incluirFuertes: false, incluirRevision: true })).toEqual({ fuertes: null, revision: null });
    expect(parametrosAUrl({ confianza: ["alta"], estadoIa: [], brechaMaxPct: 5 })).toEqual({ conf: "alta", estado_ia: null, brecha: "5" });
    for (const k of Object.keys(parametrosAUrl({ anio: 1, modo: "aprobar", gm: "", incluirFuertes: false, incluirRevision: true, confianza: [], estadoIa: [], brechaMaxPct: null }))) {
      expect(CLAVES_APROBACION as readonly string[]).toContain(k);
    }
  });

  it("hayFiltroAprobacion avisa de cualquier filtro fuera de lo habitual", () => {
    expect(hayFiltroAprobacion(P(), SIN_FILTRO)).toBe(false);
    expect(hayFiltroAprobacion(P({ incluirFuertes: true }), SIN_FILTRO)).toBe(true);
    expect(hayFiltroAprobacion(P(), { ...SIN_FILTRO, linea: "x" })).toBe(true);
  });
});

describe("filtros de §4.3", () => {
  const gms = [gm(), gm({ gm_clave: GM_NI, estado_ia: null })];
  const a = fila(1);
  const fuerte = fila(2, { avisos_fuertes: true });
  const revision = fila(3, { motivo_cierre: "revision_cola_larga" });
  const media = fila(4, { ia: { ...(a.ia as NonNullable<typeof a.ia>), confianza: "media", brecha_pct: -30 } });
  const otro = filaSinIa(5);
  const todas = [a, fuerte, revision, media, otro];

  it("por defecto deja fuera los avisos fuertes y mantiene «para revisión»", () => {
    expect(ids(filtrarFilas(todas, gms, SIN_FILTRO, P()))).toEqual(ids([a, revision, media, otro]));
  });

  it("se pueden incluir los avisos fuertes a propósito y quitar «para revisión»", () => {
    expect(filtrarFilas(todas, gms, SIN_FILTRO, P({ incluirFuertes: true })).length).toBe(5);
    expect(ids(filtrarFilas(todas, gms, SIN_FILTRO, P({ incluirRevision: false })))).toEqual(ids([a, media, otro]));
  });

  it("género y mundo se comparan con la clave del GM; línea y marca, con sus ids", () => {
    expect(ids(filtrarFilas(todas, gms, { ...SIN_FILTRO, genero: "gen-nina" }, P()))).toEqual(ids([otro]));
    expect(ids(filtrarFilas(todas, gms, { ...SIN_FILTRO, mundo: "mun-urbano" }, P())).length).toBe(3);
    expect(ids(filtrarFilas(todas, gms, { ...SIN_FILTRO, linea: "lin-vestido" }, P()))).toEqual(ids([otro]));
    expect(filtrarFilas(todas, gms, { ...SIN_FILTRO, agrupacion_marca: "otra" }, P())).toEqual([]);
    expect(ids(filtrarFilas(todas, gms, SIN_FILTRO, P({ gm: GM_NI })))).toEqual(ids([otro]));
  });

  it("confianza: con el filtro puesto, las filas sin confianza de IA no se muestran", () => {
    expect(ids(filtrarFilas(todas, gms, SIN_FILTRO, P({ confianza: ["media"] })))).toEqual(ids([media]));
    expect(ids(filtrarFilas(todas, gms, SIN_FILTRO, P({ confianza: ["alta", "media"] })))).toEqual(ids([a, revision, media]));
  });

  it("estado de la IA del GM y brecha máxima (una fila sin brecha pasa)", () => {
    expect(ids(filtrarFilas(todas, gms, SIN_FILTRO, P({ estadoIa: ["al_dia"] })))).toEqual(ids([a, revision, media]));
    expect(ids(filtrarFilas(todas, gms, SIN_FILTRO, P({ brechaMaxPct: 10 })))).toEqual(ids([a, revision, otro]));
  });

  it("una fila excluida SE VE (con su motivo): el filtro no decide elegibilidad", () => {
    const excl = filaConfianzaBaja(6);
    expect(filtrarFilas([excl], gms, SIN_FILTRO, P()).length).toBe(1);
  });

  it("el contexto que se guarda con el lote refleja los filtros", () => {
    expect(filtroLoteDe({ ...SIN_FILTRO, genero: "g", linea: "l" }, P({ gm: GM_HU, confianza: ["alta"], brechaMaxPct: 5 }))).toEqual({
      generos: ["g"],
      lineas: ["l"],
      gms: [GM_HU],
      solo_sin_avisos_fuertes: true,
      incluir_revision: true,
      confianza: ["alta"],
      brecha_max_pct: 5,
    });
  });
});

describe("selección, fuentes y exclusiones", () => {
  it("el método y la IA dan su cifra; el rótulo de la fuente va siempre", () => {
    expect(valorSugerido(fila(1))).toBe(10961);
    expect(valorSugerido(fila2026(1))).toBe(10000);
    expect(textoSeAprueba(fila(1))).toBe("IA 10,961");
    expect(textoSeAprueba(fila2026(1))).toBe("Método 10,000");
    expect(textoSeAprueba(filaSinIa(1))).toBe("Método · GM sin IA 841");
    expect(textoSeAprueba(filaConfianzaBaja(1))).toBeNull();
  });

  it("D5 y D4: confianza baja y libre sin cifra IA no se pueden marcar, con el motivo", () => {
    expect(motivoNoSeleccionable(filaConfianzaBaja(1), "aprobar")).toMatch(/Confianza baja/);
    expect(motivoNoSeleccionable(filaSinCifraIa(1), "aprobar")).toMatch(/regenera el GM/);
    expect(motivoNoSeleccionable(fila(1), "aprobar")).toBeNull();
    expect(itemDeFila(filaConfianzaBaja(1), "aprobar")).toBeNull();
  });

  it("sin fuente, o en reaprobar sin cifra aprobada, tampoco", () => {
    expect(motivoNoSeleccionable(fila(1, { fuente_sugerida: null, badge: null }), "aprobar")).toMatch(/Sin fuente/);
    expect(motivoNoSeleccionable(fila(1, { decidido: null }), "reaprobar")).toMatch(/No fue aprobada en bloque/);
  });

  it("el ítem de IA lleva su propuesta_fila_id y el de método no (esquema)", () => {
    const ia = itemDeFila(fila(1), "aprobar") as ItemSeleccion;
    expect(ia.item).toEqual({ fila_id: uuid("f1"), fuente: "ia", valor_esperado: 10961, propuesta_fila_id: uuid("e1") });
    const me = itemDeFila(fila2026(2), "aprobar") as ItemSeleccion;
    expect(me.item).toEqual({ fila_id: uuid("f2"), fuente: "metodo", valor_esperado: 10000 });
    const sinIa = itemDeFila(filaSinIa(3), "aprobar") as ItemSeleccion;
    expect(sinIa.item.propuesta_fila_id).toBeUndefined();
  });

  it("reaprobar manda la cifra aprobada que se vio (decidido_esperado)", () => {
    const r = itemDeFila(fila(1, { decidido: 10900 }), "reaprobar") as ItemSeleccion;
    expect(r.item.decidido_esperado).toBe(10900);
    expect(r.item.valor_esperado).toBe(10961);
  });

  it("la barra de selección suma IA y método por separado y cuenta los GM", () => {
    const filas = [fila(1), fila(2, { ia: { ...(fila(2).ia as NonNullable<ReturnType<typeof fila>["ia"]>), valor: 6677 } }), filaSinIa(3)];
    const r = resumenSeleccion(filas, [gm(), gm({ gm_clave: GM_NI, genero: "NIÑA", mundo: "CASUAL" })]);
    expect(r).toMatchObject({ filas: 3, gms: 2, ia: { filas: 2, unidades: 17638 }, metodo: { filas: 1, unidades: 841 }, unidades: 18479 });
    expect(textoBarraSeleccion(r)).toBe("3 filas · IA 2 (17,638 u) · Método 1 (841 u) · en 2 GM");
    expect(textoBarraSeleccion(resumenSeleccion([fila(1)], [gm()]))).toBe("1 fila · IA 1 (10,961 u) · en 1 GM");
  });

  it("agruparPorGm ordena por nombre de GM y agrupa por línea", () => {
    const g = agruparPorGm([filaSinIa(1), fila(2, { linea: "CAMISA" }), fila(3)], [gm(), gm({ gm_clave: GM_NI, genero: "NIÑA", mundo: "CASUAL" })]);
    expect(g.map((x) => x.nombre)).toEqual(["HOMBRE · URBANO", "NIÑA · CASUAL"]);
    expect(g[0].lineas.map((l) => l.linea)).toEqual(["CAMISA", "POLO"]);
  });
});

describe("tandas (D17, R16) y cuerpo del lote", () => {
  const item = (n: number, gmClave: string): ItemSeleccion => ({ fila_id: uuid(1000 + n), gm_clave: gmClave, item: { fila_id: uuid(1000 + n), fuente: "metodo", valor_esperado: 5 } });

  it("ninguna tanda pasa de 300 filas y ningún GM queda partido; cada tanda lleva su lote_id", () => {
    const items = [...Array.from({ length: 119 }, (_, i) => item(i, "gm-a")), ...Array.from({ length: 119 }, (_, i) => item(200 + i, "gm-b")), ...Array.from({ length: 119 }, (_, i) => item(400 + i, "gm-c"))];
    let n = 0;
    const { tandas, gm_partidos } = planearTandas(items, () => uuid(9000 + n++));
    expect(gm_partidos).toEqual([]);
    expect(tandas.length).toBe(2);
    expect(tandas.every((t) => t.items.length <= MAX_FILAS_LOTE)).toBe(true);
    expect(new Set(tandas.flatMap((t) => t.items.map((i) => i.gm_clave))).size).toBe(3);
    for (const gmc of ["gm-a", "gm-b", "gm-c"]) expect(tandas.filter((t) => t.items.some((i) => i.gm_clave === gmc)).length).toBe(1);
    expect(new Set(tandas.map((t) => t.lote_id)).size).toBe(2);
  });

  it("el cuerpo de simular y el de aplicar cumplen loteSchema (400 si falta la huella al aplicar)", () => {
    const tanda = { lote_id: uuid(1), items: [itemDeFila(fila(1), "aprobar") as ItemSeleccion, itemDeFila(filaSinIa(2), "aprobar") as ItemSeleccion] };
    const sim = cuerpoLote({ tanda, confirmacionId: uuid(2), tipo: "aprobar", anio: Y1, simular: true, revisionConfirmada: false });
    expect(loteSchema.safeParse(sim).success).toBe(true);
    const aplicar = cuerpoLote({ tanda, confirmacionId: uuid(2), tipo: "aprobar", anio: Y1, simular: false, huellaSimulacion: "b".repeat(64), revisionConfirmada: true, nota: "  cierre de mes  ", filtro: { solo_sin_avisos_fuertes: true } });
    const ok = loteSchema.safeParse(aplicar);
    expect(ok.success).toBe(true);
    expect(ok.data?.nota).toBe("cierre de mes");
    expect(loteSchema.safeParse(cuerpoLote({ tanda, confirmacionId: uuid(2), tipo: "aprobar", anio: Y1, simular: false, revisionConfirmada: false })).success).toBe(false);
  });

  it("reaprobar pasa el esquema solo con decidido_esperado en cada ítem", () => {
    const filas = [fila(1, { decidido: 10900 }), fila(2, { decidido: 6500 })];
    const tanda = { lote_id: uuid(1), items: filas.map((f) => itemDeFila(f, "reaprobar") as ItemSeleccion) };
    expect(loteSchema.safeParse(cuerpoLote({ tanda, confirmacionId: uuid(2), tipo: "reaprobar", anio: Y1, simular: true, revisionConfirmada: false })).success).toBe(true);
    const sin = { lote_id: uuid(1), items: filas.map((f) => itemDeFila(f, "aprobar") as ItemSeleccion) };
    expect(loteSchema.safeParse(cuerpoLote({ tanda: sin, confirmacionId: uuid(2), tipo: "reaprobar", anio: Y1, simular: true, revisionConfirmada: false })).success).toBe(false);
  });
});

describe("resultados combinados y textos", () => {
  const r1 = resultado([resultadoFila(1, { valor: 5000, brecha_u: -10 }), resultadoFila(2, { valor: 9000, brecha_u: 300 }), resultadoFila(3, { resultado: "rechazada", codigo: "ya_decidida", valor: null, brecha_u: null })], {
    efecto_gm: [efecto()],
    crecimientos_a_reaprobar: [{ gm_clave: GM_HU, genero: "HOMBRE", mundo: "URBANO" }],
  });
  const r2 = resultado([resultadoFila(4, { gm_clave: GM_NI, fuente: "metodo", valor: 841, brecha_u: null })], {
    efecto_gm: [efecto({ gm_clave: GM_NI })],
    revision_requerida: true,
    crecimientos_a_reaprobar: [{ gm_clave: GM_HU, genero: "HOMBRE", mundo: "URBANO" }],
    pendientes_cierre: { filas_y: 1, filas_y1: 2, para_revision: 0, tiendas: 0 },
  });

  it("suma totales, junta el efecto por GM y deduplica los crecimientos a reaprobar", () => {
    const c = combinarResultados([r1, r2]);
    expect(c.totales).toMatchObject({ pedidas: 4, aplicadas: 3, rechazadas: 1, unidades: 14841, por_fuente: { ia: { filas: 2, unidades: 14000 }, metodo: { filas: 1, unidades: 841 } } });
    expect(c.efecto_gm.map((e) => e.gm_clave)).toEqual([GM_HU, GM_NI]);
    expect(c.crecimientos_a_reaprobar).toHaveLength(1);
    expect(c.revision_requerida).toBe(true);
    expect(c.pendientes_cierre).toEqual({ filas_y: 1, filas_y1: 2, para_revision: 0, tiendas: 0 });
    expect(c.tandas).toBe(2);
  });

  it("las mayores salen ordenadas de todas las filas aplicadas", () => {
    const c = combinarResultados([r1, r2]);
    expect(c.mayores_unidades.map((f) => f.valor)).toEqual([9000, 5000, 841]);
    expect(c.mayores_brechas.map((f) => f.brecha_u)).toEqual([300, -10]);
  });

  it("máximo 10 en cada lista", () => {
    const filas = Array.from({ length: 25 }, (_, i) => resultadoFila(i + 1, { valor: 100 + i, brecha_u: i }));
    const c = combinarResultados([resultado(filas)]);
    expect(c.mayores_unidades).toHaveLength(10);
    expect(c.mayores_brechas).toHaveLength(10);
  });

  it("§4.4: más de 100 filas pedidas o un GM fuera de ±1 % exigen «Revisé el resumen por GM»", () => {
    expect(exigeRevision(100, { revision_requerida: false })).toBe(false);
    expect(exigeRevision(101, { revision_requerida: false })).toBe(true);
    expect(exigeRevision(5, { revision_requerida: true })).toBe(true);
  });

  it("agrupa los rechazos por código y escribe el resultado", () => {
    expect(rechazosPorCodigo(r1.filas)).toEqual([{ codigo: "ya_decidida", filas: 1 }]);
    expect(textoResultadoAprobar({ aplicadas: 212, rechazadas: 2 })).toBe("212 aprobadas · 2 no aprobadas");
    expect(textoResultadoAprobar({ aplicadas: 3, rechazadas: 0 }, "reaprobar")).toBe("3 reaprobadas");
    expect(textoResultadoAprobar({ aplicadas: 3, rechazadas: 1 }, "revertir")).toBe("3 revertidas · 1 no revertidas");
  });

  it("avisos de la confirmación: método en GM sin IA, meta movida y crecimientos por reaprobar", () => {
    const avisos = avisosDeConfirmacion({
      filas: [filaSinIa(1), filaSinIa(2), fila(3)],
      gms: [gm({ estado_ia: "meta_movida" }), gm({ gm_clave: GM_NI, genero: "NIÑA", mundo: "CASUAL", estado_ia: null })],
      anioEnCurso: Y,
      crecimientosAReaprobar: [{ gm_clave: GM_HU, genero: "HOMBRE", mundo: "URBANO" }],
    });
    expect(avisos[0]).toBe("2 filas con método en GM sin IA.");
    expect(avisos.some((a) => a.startsWith("HOMBRE · URBANO en meta movida"))).toBe(true);
    expect(avisos.some((a) => /1 GM con crecimientos que reaprobar.*2027/.test(a))).toBe(true);
  });

  it("textos de cabecera", () => {
    expect(textoPendientesCierre({ filas_y: 679, filas_y1: 686, para_revision: 290, tiendas: 3 }, Y)).toBe("Para cerrar faltan: 2026 · 679 filas · 2027 · 686 filas · 290 para revisión · 3 tiendas nuevas");
    expect(textoReaprobables(1)).toMatch(/^1 fila aprobada en bloque cambió de propuesta/);
    expect(textoReaprobables(12)).toBe("12 filas aprobadas en bloque cambiaron de propuesta tras el último recálculo");
  });

  it("historial: texto por fuente", () => {
    expect(textoPorFuente(lote(1).resumen)).toBe("IA 2 (17,638 u)");
  });
});

describe("bloqueos (D14): qué enlace lleva cada uno", () => {
  it("recalcular, Crecimientos o Factores del Niño; los de estado, ninguno", () => {
    expect(accionDeBloqueo({ codigo: "proyeccion_desactualizada" })).toBe("recalcular");
    expect(accionDeBloqueo({ codigo: "version_metodo" })).toBe("recalcular");
    expect(accionDeBloqueo({ codigo: "crecimientos_sin_aprobar" })).toBe("crecimientos");
    expect(accionDeBloqueo({ codigo: "factor_faltante" })).toBe("factores");
    expect(accionDeBloqueo({ codigo: "anio_siguiente_atipico" })).toBe("factores");
    expect(accionDeBloqueo({ codigo: "cerrada" })).toBeNull();
    expect(accionDeBloqueo({ codigo: "calculo_en_curso" })).toBeNull();
  });
});

describe("errores de la API traducidos (ficha §3)", () => {
  const t = (codigo: string | null, mensaje = "del servidor") => traducirErrorAprobacion({ mensaje, codigo });

  it("IA no disponible, capacidad apagada y corrida en curso: no se escribió nada y se ofrece «solo método»", () => {
    for (const c of ["ia_no_disponible", "capacidad_apagada", "corrida_en_curso"]) {
      const r = t(c);
      expect(r.accion).toBe("solo_metodo");
      expect(r.mensaje).toMatch(/No se escribió nada/);
      expect(r.mensaje).toMatch(/solo las filas de método/);
    }
  });

  it("cálculo en curso y datos cambiaron", () => {
    expect(t("calculo_en_curso")).toMatchObject({ accion: "recargar" });
    expect(t("datos_cambiaron")).toMatchObject({ accion: "recalcular" });
    expect(t("datos_cambiaron").mensaje).toMatch(/vuelve a simular/);
  });

  it("lote ajeno, no revertible y conflicto a reintentar", () => {
    expect(t("lote_ajeno")).toMatchObject({ accion: "recargar" });
    expect(t("no_revertible").mensaje).toMatch(/no se puede revertir/);
    expect(t("conflicto_reintentar")).toMatchObject({ accion: "reintentar" });
    expect(t("conflicto_reintentar").mensaje).toMatch(/mismo lote/);
  });

  it("proyección cerrada o archivada", () => {
    for (const c of ["cerrada", "ya_cerrada", "proyeccion_cerrada"]) expect(t(c).mensaje).toMatch(/cerrada/);
    for (const c of ["archivada", "proyeccion_archivada"]) expect(t(c).mensaje).toMatch(/archivada/);
    expect(t("cerrada").accion).toBe("recargar");
  });

  it("simulación distinta, revisión requerida, crecimientos y Niño", () => {
    expect(t("simulacion_distinta")).toMatchObject({ accion: "simular_de_nuevo" });
    expect(t("revision_requerida")).toMatchObject({ accion: "marcar_revision" });
    expect(t("crecimientos_sin_aprobar")).toMatchObject({ accion: "crecimientos" });
    expect(t("factor_desfasado")).toMatchObject({ accion: "factores" });
  });

  it("el mensaje del servidor no se pierde: va como detalle; sin código conocido es el principal", () => {
    expect(t("lote_ajeno", "otro texto").detalleServidor).toBe("otro texto");
    expect(t("algo_raro", "No se pudo X")).toEqual({ mensaje: "No se pudo X", detalleServidor: null, accion: null });
    expect(t(null, "Error 500").mensaje).toBe("Error 500");
  });
});

// ─── Flujos con una API de mentira ───

type Llamada = { url: string; cuerpo: Record<string, unknown> };

function apiFalsa(responder: (l: Llamada, n: number) => unknown): { post: Post; llamadas: Llamada[] } {
  const llamadas: Llamada[] = [];
  const post: Post = async <T,>(url: string, cuerpo: unknown) => {
    const l = { url, cuerpo: cuerpo as Record<string, unknown> };
    llamadas.push(l);
    const r = responder(l, llamadas.length - 1);
    if (r instanceof Error) throw r;
    return r as T;
  };
  return { post, llamadas };
}

const error409 = (codigo: string, mensaje = "x") => new ErrorApi(mensaje, 409, codigo, { error: mensaje, codigo });
const itemsDe = (filas: ReturnType<typeof fila>[], modo: "aprobar" | "reaprobar" = "aprobar") => filas.map((f) => itemDeFila(f, modo) as ItemSeleccion);

/** Una API que simula y aplica según el cuerpo (cada tanda con su huella). */
function respuestaDeLote(l: Llamada): ResultadoLoteTest {
  const filas = (l.cuerpo.filas as { fila_id: string; fuente: "ia" | "metodo"; valor_esperado: number }[]).map((f) => resultadoFila(0, { fila_id: f.fila_id, fuente: f.fuente, valor: f.valor_esperado, gm_clave: GM_HU }));
  const simular = l.cuerpo.simular === true;
  return resultado(filas, { simulado: simular, huella_simulacion: String(l.cuerpo.lote_id).slice(-12).padStart(64, "d") });
}
type ResultadoLoteTest = ReturnType<typeof resultado>;

describe("simular y aplicar en tandas (D8, D10, D17)", () => {
  const filas = [...Array.from({ length: 150 }, (_, i) => fila(i + 1)), ...Array.from({ length: 150 }, (_, i) => fila(i + 1000, { gm_clave: "gen-mujer.mun-urbano", genero: "MUJER" }))];
  const items = itemsDe(filas);

  it("simula cada tanda por separado con simular:true y un lote_id propio; todos los cuerpos cumplen el esquema", async () => {
    const { post, llamadas } = apiFalsa((l) => respuestaDeLote(l));
    const r = await simularConfirmacion({ proyeccionId: PROYECCION_ID, anio: Y1, tipo: "aprobar", items, confirmacionId: uuid(77), soloMetodo: false, post, nuevoId: (() => { let n = 0; return () => uuid(500 + n++); })() });
    expect(r.ok).toBe(true);
    expect(llamadas).toHaveLength(1); // 300 filas caben en una tanda
    expect(llamadas[0].cuerpo.simular).toBe(true);
    expect(loteSchema.safeParse(llamadas[0].cuerpo).success).toBe(true);
    expect(llamadas[0].cuerpo.confirmacion_id).toBe(uuid(77));
  });

  it("más de 300 filas: dos tandas sin partir un GM, con la misma confirmacion_id", async () => {
    const gmA = Array.from({ length: 200 }, (_, i) => fila(i + 1));
    const gmB = Array.from({ length: 119 }, (_, i) => fila(i + 1000, { gm_clave: "gen-mujer.mun-urbano" }));
    const { post, llamadas } = apiFalsa((l) => respuestaDeLote(l));
    const r = await simularConfirmacion({ proyeccionId: PROYECCION_ID, anio: Y1, tipo: "aprobar", items: itemsDe([...gmA, ...gmB]), confirmacionId: uuid(77), soloMetodo: false, post });
    expect(r.ok && r.sim.tandas.length).toBe(2);
    expect(new Set(llamadas.map((l) => l.cuerpo.confirmacion_id)).size).toBe(1);
    expect(new Set(llamadas.map((l) => l.cuerpo.lote_id)).size).toBe(2);
    for (const l of llamadas) expect(new Set((l.cuerpo.filas as { fila_id: string }[]).map((f) => f.fila_id.slice(0, 20))).size).toBe(1);
  });

  it("aplica con la huella de cada tanda, la casilla y la nota; un reintento reusa el mismo lote_id", async () => {
    const gmA = Array.from({ length: 200 }, (_, i) => fila(i + 1));
    const gmB = Array.from({ length: 119 }, (_, i) => fila(i + 1000, { gm_clave: "gen-mujer.mun-urbano" }));
    const simApi = apiFalsa((l) => respuestaDeLote(l));
    const s = await simularConfirmacion({ proyeccionId: PROYECCION_ID, anio: Y1, tipo: "aprobar", items: itemsDe([...gmA, ...gmB]), confirmacionId: uuid(77), soloMetodo: false, post: simApi.post });
    if (!s.ok) throw new Error("no simuló");

    // La tanda 2 falla por la red una vez.
    let fallo = true;
    const hechas: Record<number, ResultadoLoteTest> = {};
    const api = apiFalsa((l) => {
      if (l.cuerpo.lote_id === s.sim.tandas[1].lote_id && fallo) {
        fallo = false;
        return new TypeError("fetch failed");
      }
      return { ...respuestaDeLote(l), simulado: false, lote: lote(1) };
    });
    const args = { proyeccionId: PROYECCION_ID, anio: Y1, tipo: "aprobar" as const, confirmacionId: uuid(77), sim: s.sim, nota: "mes de octubre", revision: true, hechas, alTanda: (i: number, r: ResultadoLoteTest) => void (hechas[i] = r), post: api.post, esperar: async () => {} };
    const primero = await aplicarTandas(args);
    expect(primero).toMatchObject({ ok: false, tanda: 1 });
    expect(Object.keys(hechas)).toEqual(["0"]);

    const segundo = await aplicarTandas(args);
    expect(segundo.ok).toBe(true);
    expect(Object.keys(hechas)).toEqual(["0", "1"]);
    // La tanda 1 no se vuelve a enviar; la 2 se reenvía con el mismo lote_id.
    expect(api.llamadas.map((l) => l.cuerpo.lote_id)).toEqual([s.sim.tandas[0].lote_id, s.sim.tandas[1].lote_id, s.sim.tandas[1].lote_id]);
    for (const [i, l] of api.llamadas.entries()) {
      const t = i === 0 ? 0 : 1;
      expect(l.cuerpo.simular).toBe(false);
      expect(l.cuerpo.huella_simulacion).toBe(s.sim.resultados[t].huella_simulacion);
      expect(l.cuerpo.revision_confirmada).toBe(true);
      expect(l.cuerpo.nota).toBe("mes de octubre");
      expect(loteSchema.safeParse(l.cuerpo).success).toBe(true);
    }
    expect(resultadoDeHechas(hechas)?.totales.aplicadas).toBe(319);
  });

  it("un 409 conflicto_reintentar se reintenta solo una vez, con el mismo lote_id", async () => {
    const s = await simularConfirmacion({ proyeccionId: PROYECCION_ID, anio: Y1, tipo: "aprobar", items: itemsDe([fila(1)]), confirmacionId: uuid(77), soloMetodo: false, post: apiFalsa((l) => respuestaDeLote(l)).post });
    if (!s.ok) throw new Error("no simuló");
    const hechas: Record<number, ResultadoLoteTest> = {};
    const a1 = apiFalsa((l, n) => (n === 0 ? error409("conflicto_reintentar") : { ...respuestaDeLote(l), simulado: false }));
    const base = { proyeccionId: PROYECCION_ID, anio: Y1, tipo: "aprobar" as const, confirmacionId: uuid(77), sim: s.sim, nota: "", revision: false, hechas, alTanda: (i: number, r: ResultadoLoteTest) => void (hechas[i] = r), esperar: async () => {} };
    expect((await aplicarTandas({ ...base, post: a1.post })).ok).toBe(true);
    expect(a1.llamadas.map((l) => l.cuerpo.lote_id)).toEqual([s.sim.tandas[0].lote_id, s.sim.tandas[0].lote_id]);

    const hechas2: Record<number, ResultadoLoteTest> = {};
    const a2 = apiFalsa(() => error409("conflicto_reintentar"));
    const r2 = await aplicarTandas({ ...base, hechas: hechas2, alTanda: (i, r) => void (hechas2[i] = r), post: a2.post });
    expect(r2).toMatchObject({ ok: false, tanda: 0, error: { codigo: "conflicto_reintentar" } });
    expect(a2.llamadas).toHaveLength(2);
  });

  it("un error de negocio se devuelve tal cual para mostrarlo (nada se traga)", async () => {
    const s = await simularConfirmacion({ proyeccionId: PROYECCION_ID, anio: Y1, tipo: "aprobar", items: itemsDe([fila(1)]), confirmacionId: uuid(77), soloMetodo: false, post: apiFalsa((l) => respuestaDeLote(l)).post });
    if (!s.ok) throw new Error("no simuló");
    const hechas: Record<number, ResultadoLoteTest> = {};
    const api = apiFalsa(() => error409("simulacion_distinta", "El resultado cambió"));
    const r = await aplicarTandas({ proyeccionId: PROYECCION_ID, anio: Y1, tipo: "aprobar", confirmacionId: uuid(77), sim: s.sim, nota: "", revision: false, hechas, alTanda: (i, x) => void (hechas[i] = x), post: api.post, esperar: async () => {} });
    expect(r).toMatchObject({ ok: false, error: { codigo: "simulacion_distinta", mensaje: "El resultado cambió" } });
    expect(Object.keys(hechas)).toEqual([]);
  });

  it("IA no disponible: el error vuelve entero; «solo método» reenvía sin los ítems de IA y con lotes nuevos", async () => {
    const mezcla = itemsDe([fila(1), fila(2), filaSinIa(3)]);
    const api = apiFalsa((l) => ((l.cuerpo.filas as { fuente: string }[]).some((f) => f.fuente === "ia") ? error409("ia_no_disponible", "IA apagada") : respuestaDeLote(l)));
    const a = await simularConfirmacion({ proyeccionId: PROYECCION_ID, anio: Y1, tipo: "aprobar", items: mezcla, confirmacionId: uuid(77), soloMetodo: false, post: api.post });
    expect(a).toMatchObject({ ok: false, error: { codigo: "ia_no_disponible" } });
    const b = await simularConfirmacion({ proyeccionId: PROYECCION_ID, anio: Y1, tipo: "aprobar", items: mezcla, confirmacionId: uuid(77), soloMetodo: true, post: api.post });
    expect(b.ok).toBe(true);
    const segunda = api.llamadas[1].cuerpo;
    expect((segunda.filas as { fuente: string }[]).map((f) => f.fuente)).toEqual(["metodo"]);
    expect(segunda.lote_id).not.toBe(api.llamadas[0].cuerpo.lote_id);
    expect(b.ok && b.sim.soloMetodo).toBe(true);
  });

  it("«solo método» sin filas de método avisa claramente y no llama a la API", async () => {
    const api = apiFalsa(() => ({}));
    const r = await simularConfirmacion({ proyeccionId: PROYECCION_ID, anio: Y1, tipo: "aprobar", items: itemsDe([fila(1)]), confirmacionId: uuid(77), soloMetodo: true, post: api.post });
    expect(r).toMatchObject({ ok: false, error: { mensaje: expect.stringMatching(/No quedan filas de método/) } });
    expect(api.llamadas).toHaveLength(0);
  });
});

describe("revertir un lote o una confirmación", () => {
  it("un lote: un id nuevo; simula y aplica con la huella; las filas marcadas van en el cuerpo y cumplen el esquema", async () => {
    const destino = { tipo: "lote" as const, loteId: uuid(9), filas: [uuid("f1"), uuid("f2")], etiqueta: "x" };
    const idsRev = idsDeReversion(destino, () => uuid(321));
    expect(idsRev).toEqual([uuid(321)]);
    const api = apiFalsa((l) => resultado([resultadoFila(1, { fuente: "revertir", valor: null })], { simulado: l.cuerpo.simular === true, huella_simulacion: "e".repeat(64) }));
    const s = await simularReversion({ proyeccionId: PROYECCION_ID, destino, ids: idsRev, post: api.post });
    if (!s.ok) throw new Error("no simuló");
    const a = await aplicarReversion({ proyeccionId: PROYECCION_ID, destino, ids: idsRev, nota: " deshacer ", sim: s.sim, post: api.post, esperar: async () => {} });
    expect(a.ok).toBe(true);
    expect(api.llamadas[0].url).toBe(urlRevertirLote(PROYECCION_ID, uuid(9)));
    expect(api.llamadas[0].cuerpo).toEqual({ lote_id: uuid(321), simular: true, filas: destino.filas });
    expect(api.llamadas[1].cuerpo).toEqual({ lote_id: uuid(321), simular: false, filas: destino.filas, nota: "deshacer", huella_simulacion: "e".repeat(64) });
    for (const l of api.llamadas) expect(revertirSchema.safeParse(l.cuerpo).success).toBe(true);
  });

  it("una confirmación: un lote_id por tanda, sin huella; responde una lista", async () => {
    const destino = { tipo: "confirmacion" as const, confirmacionId: uuid(8), nLotes: 3, etiqueta: "x" };
    let n = 0;
    const idsRev = idsDeReversion(destino, () => uuid(600 + n++));
    expect(idsRev).toHaveLength(3);
    const api = apiFalsa(() => idsRev.map(() => resultado([resultadoFila(1, { fuente: "revertir", valor: null })])));
    const s = await simularReversion({ proyeccionId: PROYECCION_ID, destino, ids: idsRev, post: api.post });
    if (!s.ok) throw new Error("no simuló");
    expect(s.sim.resultados).toHaveLength(3);
    await aplicarReversion({ proyeccionId: PROYECCION_ID, destino, ids: idsRev, nota: "", sim: s.sim, post: api.post, esperar: async () => {} });
    expect(api.llamadas[1].url).toBe(urlRevertirConfirmacion(PROYECCION_ID, uuid(8)));
    expect(api.llamadas[1].cuerpo).toEqual({ lote_ids: idsRev, simular: false });
    for (const l of api.llamadas) expect(revertirConfirmacionSchema.safeParse(l.cuerpo).success).toBe(true);
  });

  it("no_revertible llega tal cual a la pantalla", async () => {
    const destino = { tipo: "lote" as const, loteId: uuid(9), etiqueta: "x" };
    const api = apiFalsa(() => error409("no_revertible", "Una reversión no se puede revertir"));
    const s = await simularReversion({ proyeccionId: PROYECCION_ID, destino, ids: [uuid(1)], post: api.post });
    expect(s).toMatchObject({ ok: false, error: { codigo: "no_revertible" } });
  });
});

describe("datos de prueba de la propia pantalla", () => {
  it("el GET sintético es coherente con la tabla del fixture", () => {
    const d = datos();
    expect(d.filas.map((f) => f.badge)).toEqual(["ia", "ia", null, "metodo_gm_sin_ia"]);
    expect(d.filas.filter((f) => itemDeFila(f, "aprobar") !== null)).toHaveLength(3);
  });
});
