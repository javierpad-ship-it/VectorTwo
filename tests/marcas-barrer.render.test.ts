import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BloqueEstacionalidad } from "../src/app/(app)/planificacion/marcas-barrer/bloque-estacionalidad";
import { BloqueParteBarrer } from "../src/app/(app)/planificacion/marcas-barrer/bloque-parte-barrer";
import { BloquePeso } from "../src/app/(app)/planificacion/marcas-barrer/bloque-peso";
import { BloqueReparto, type AccionAprobar } from "../src/app/(app)/planificacion/marcas-barrer/bloque-reparto";
import { CeldaPorcentaje } from "../src/app/(app)/planificacion/marcas-barrer/celda-porcentaje";
import { GraficoLineas } from "../src/app/(app)/planificacion/marcas-barrer/grafico-lineas";
import { VersionesReparto } from "../src/app/(app)/planificacion/marcas-barrer/versiones-reparto";
import { editarCelda, filasAjustables, renormalizarResto, SIN_AJUSTES } from "../src/app/(app)/planificacion/marcas-barrer/ajuste";
import { DestinoModalidadDialogo } from "../src/app/(app)/maestros/marcas/destino-modalidad-dialogo";
import { analisisBeta, filaApi, repartoEjemplo } from "./marcas-barrer.pantalla.fixture";

/** Humo de render con datos sintéticos: ningún componente de presentación de M12 debe lanzar y los textos clave deben salir. */

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const accion = (extra: Partial<AccionAprobar> = {}): AccionAprobar => ({ ocupado: false, error: null, proximaVersion: 3, onAprobar: () => {}, onRecalcular: () => {}, exito: null, onCerrarExito: () => {}, ...extra });
const noop = () => {};

function bloque1(extra: { analisis?: ReturnType<typeof analisisBeta>; ajuste?: Parameters<typeof BloqueReparto>[0]["ajuste"]; nota?: string; fuente?: "historico" | "cerrada"; accion?: AccionAprobar } = {}) {
  return html(
    createElement(BloqueReparto, {
      analisis: extra.analisis ?? analisisBeta(),
      fuente: extra.fuente ?? "historico",
      onFuente: noop,
      ajuste: extra.ajuste ?? SIN_AJUSTES,
      onAjuste: noop,
      nota: extra.nota ?? "",
      onNota: noop,
      accion: extra.accion ?? accion(),
    })
  );
}

describe("bloque 1 · dónde vende la marca", () => {
  it("tabla con los candidatos lado a lado, el resto plegado, la suma, el fuera de alcance y el botón con la versión siguiente", () => {
    const h = bloque1();
    expect(h).toContain("1. Dónde vende BETA");
    for (const t of ["p2 hist.", "p2 cerrada", "p2 ajust.", "p1 (peso en el GML)", "Tendencia", "2025", "2026 (a set)", "Vigente v2"]) expect(h).toContain(t);
    expect(h).toContain("HOMBRE · URBANO · DENIM");
    expect(h).toContain("Resto de HOMBRE · CASUAL");
    expect(h).toContain("ver los 2");
    expect(h).toContain('aria-expanded="false"');
    // Los miembros del resto no se ven plegados.
    expect(h).not.toContain("HOMBRE · CASUAL · CAMPERA");
    expect(h).toContain("MUJER · CASUAL · SANDALIA 730 u");
    expect(h).toContain("Suma");
    expect(h).toContain("100.0 %");
    expect(h).toContain("Aprobar este reparto como v3");
    expect(h).toContain("Renormalizar el resto");
    expect(h).toContain("Volver a lo calculado");
  });

  it("muestra quién aprobó el vigente y cuándo, y el error del reparto con su veredicto", () => {
    const h = bloque1();
    expect(h).toContain("Reparto vigente v2");
    expect(h).toContain("2026-09-30");
    expect(h).toContain("aprobado por Planner Uno");
    expect(h).toContain("Al día (difiere 1.2 pp)");
    expect(h).toContain("8 pp estable");
  });

  it("las celdas ajustadas son inputs accesibles por GML y temporada", () => {
    const h = bloque1();
    expect(h).toContain('aria-label="p2 ajustado de HOMBRE · URBANO · DENIM (verano), en porcentaje"');
    expect(h).toContain('value="41.0"');
  });

  it("un ajuste sin renormalizar deshabilita Aprobar y explica por qué; la nota pasa a obligatoria", () => {
    const analisis = analisisBeta();
    const filas = filasAjustables(analisis, "historico");
    const ajuste = editarCelda(SIN_AJUSTES, filas[0], "verano", 50);
    const h = bloque1({ analisis, ajuste });
    expect(h).toMatch(/<button[^>]*disabled=""[^>]*>Aprobar este reparto como v3/);
    expect(h).toContain("Verano suma 109.0 %");
    expect(h).toContain("Nota (obligatoria)");
    expect(h).toContain("Con ajustes tuyos.");
    // Tras renormalizar y con nota, se habilita.
    const ok = renormalizarResto(filas, "verano", ajuste).estado;
    const h2 = bloque1({ analisis, ajuste: ok, nota: "Se compra más denim" });
    expect(h2).not.toMatch(/<button[^>]*disabled=""[^>]*>Aprobar este reparto como v3/);
  });

  it("sin cerrada solo se puede aprobar el histórico, y lo dice", () => {
    const base = analisisBeta();
    const a = { ...base, parametros: { ...base.parametros, fuente_disponible: ["historico" as const] } };
    const h = bloque1({ analisis: a });
    expect(h).toContain("Cerrada (sin cerrada)");
    expect(h).toContain("No hay proyección cerrada con participación de esta marca");
  });

  it("muestra el error de una aprobación (huella cambiada ofrece volver a calcular) y el éxito", () => {
    const h = bloque1({ accion: accion({ error: { mensaje: "Los datos cambiaron.", codigo: "huella_cambiada" } }) });
    expect(h).toContain("Los datos cambiaron.");
    expect(h).toContain("Volver a calcular con los datos de hoy");
    const h2 = bloque1({ accion: accion({ exito: "Reparto aprobado como v3 por Planner Uno el 2026-10-17." }) });
    expect(h2).toContain("Reparto aprobado como v3 por Planner Uno");
  });

  it("obsoleto: dice por qué y que no se recalcula solo; sin reparto: avisa que el flujo quedará con «sin reparto»", () => {
    const h = bloque1({ analisis: analisisBeta({ obsoleto: ["config_cambiada"] }) });
    expect(h).toContain("Obsoleto: config. cambiada");
    expect(h).toContain("No se recalcula solo");
    const h2 = bloque1({ analisis: analisisBeta({ vigente: null }) });
    expect(h2).toContain("todavía no tiene reparto aprobado");
  });

  it("sin venta al barrer: estado vacío en vez de tabla, sin botones de aprobar", () => {
    const a = analisisBeta({ filas: [], restos: [], avisos: ["sin_venta_barrer"], vigente: null, fuera_de_alcance: [] });
    const h = bloque1({ analisis: a });
    expect(h).toContain("No hay reparto que calcular");
    expect(h).not.toContain("Aprobar este reparto");
  });

  it("modo anual: un solo vector, sin selector de temporada", () => {
    const base = analisisBeta();
    const a = { ...base, filas: base.filas.map((f) => ({ ...f, p2: f.p2.slice(0, 1).map((x) => ({ ...x, temporada: null })) })), restos: base.restos.map((r) => ({ ...r, p2: r.p2.slice(0, 1).map((x) => ({ ...x, temporada: null })) })) };
    const h = bloque1({ analisis: a });
    expect(h).not.toContain("Temporada del reparto");
    expect(h).toContain("p2 ajustado de HOMBRE · URBANO · DENIM, en porcentaje");
  });
});

describe("bloques 2, 3 y 4", () => {
  it("peso: elige el GML, tabla año × mes con el año incompleto marcado", () => {
    const h = html(createElement(BloquePeso, { analisis: analisisBeta() }));
    expect(h).toContain("2. Peso de BETA en cada GML");
    expect(h).toContain("HOMBRE · URBANO · DENIM · 5,120 u");
    for (const m of ["Ene", "Jun", "Dic"]) expect(h).toContain(m);
    expect(h).toContain("2026 (a set)");
    expect(h).toContain("* año incompleto");
  });

  it("estacionalidad: gráfico SVG con las dos curvas, EAT y veredicto, y las cifras exactas plegadas", () => {
    const h = html(createElement(BloqueEstacionalidad, { analisis: analisisBeta() }));
    expect(h).toContain("3. Estacionalidad propia frente a la del GML");
    expect(h).toContain("EAT 4.8 pp · similar");
    expect(h).toContain("Propia de BETA");
    expect(h).toContain("Del GML para esta marca");
    expect(h).toContain("<svg");
    expect(h).toContain("<details");
    expect(h).toContain("Tendencia total de la marca: <span");
  });

  it("estacionalidad sin años completos: estado vacío con la razón", () => {
    const a = analisisBeta({ estacionalidad: { propia: null, gml: null, eat_pp: null, veredicto: null, anios_completos: [] }, avisos: ["sin_anio_completo"] });
    const h = html(createElement(BloqueEstacionalidad, { analisis: a }));
    expect(h).toContain("No hay estacionalidad que comparar");
    expect(h).toContain("no tiene un año completo");
  });

  it("parte al barrer: una al barrer es 100 %; una mixta enumera sus GML específicos y dice que no se reparten", () => {
    const h = html(createElement(BloqueParteBarrer, { analisis: analisisBeta() }));
    expect(h).toContain("4. Qué parte se compra al barrer");
    expect(h).toContain("BETA: 100 % al barrer.");
    const m = analisisBeta({
      marca: { id: "marca-gamma", nombre: "GAMMA", modalidad: "mixta", agrupacion_marca: "RECONOCIDO", miembros: [], gml_especificos: [{ gml_id: "g1", ruta: "HOMBRE · FORMAL · CAMISA" }, { gml_id: "g2", ruta: "HOMBRE · FORMAL · TERNO" }] },
      share_barrido: 0.61,
      unidades_barrer: 5069,
      unidades_especificas: 3241,
    });
    const h2 = html(createElement(BloqueParteBarrer, { analisis: m }));
    expect(h2).toContain("61 % al barrer, 39 % específica en HOMBRE · FORMAL · CAMISA y HOMBRE · FORMAL · TERNO (no se reparte)");
    expect(h2).toContain("Específica: 3,241 u");
    const sin = analisisBeta({ marca: { ...m.marca, gml_especificos: [] }, share_barrido: 1, unidades_especificas: 0 });
    expect(html(createElement(BloqueParteBarrer, { analisis: sin }))).toContain("mixta sin GML específicos");
  });
});

describe("versiones, gráfico, celda y diálogo", () => {
  it("versiones: la más nueva primero, con la vigente marcada, quién y cuándo, y el botón de comparar", () => {
    const h = html(createElement(VersionesReparto, { analisis: analisisBeta(), repartos: [repartoEjemplo(1, false), repartoEjemplo(2, true)], cargando: false, error: null }));
    expect(h.indexOf("v2")).toBeLessThan(h.indexOf("v1"));
    expect(h).toContain("vigente");
    expect(h).toContain("2026-09-30");
    expect(h).toContain("Planner Uno");
    expect(h).toContain("HOMBRE");
    expect(h).toContain("Comparar v2 con lo calculado hoy");
    expect(h).toContain("sin ajuste");
  });

  it("versiones sin ninguna aprobada: lo dice y no ofrece comparar", () => {
    const h = html(createElement(VersionesReparto, { analisis: analisisBeta({ vigente: null }), repartos: [], cargando: false, error: null }));
    expect(h).toContain("Todavía no se aprobó ningún reparto");
    expect(h).not.toContain("Comparar v");
  });

  it("versiones con error de lectura: se muestra", () => {
    const h = html(createElement(VersionesReparto, { analisis: analisisBeta(), repartos: null, cargando: false, error: "Falla" }));
    expect(h).toContain("No se pudieron leer las versiones: Falla");
  });

  it("gráfico de líneas: leyenda, ejes en porcentaje y una polilínea por serie con su texto accesible", () => {
    const h = html(
      createElement(GraficoLineas, {
        series: [
          { clave: "a", etiqueta: "2025", valores: [0.05, 0.06, null, 0.07], color: "#14b8a6", grosor: 2 },
          { clave: "b", etiqueta: "2026", valores: Array.from({ length: 12 }, () => 0.08), color: "#f59e0b", grosor: 2 },
        ],
        resumen: "Peso mensual de prueba",
      })
    );
    expect(h).toContain('aria-label="Peso mensual de prueba"');
    expect(h).toContain("Leyenda del gráfico");
    expect(h).toContain("2025");
    expect(h).toContain(" %");
    expect(h.match(/<path/g)?.length).toBeGreaterThanOrEqual(2);
    expect(h).toContain("Ene");
  });

  it("celda de porcentaje: un decimal, etiqueta accesible y estilo distinto si está editada", () => {
    const base = { valor: 41, etiqueta: "p2 de DENIM", onCommit: noop, editada: false, escalada: false };
    expect(html(createElement(CeldaPorcentaje, base))).toContain('value="41.0"');
    expect(html(createElement(CeldaPorcentaje, base))).toContain('aria-label="p2 de DENIM"');
    expect(html(createElement(CeldaPorcentaje, { ...base, editada: true }))).toContain("Editado por ti");
    expect(html(createElement(CeldaPorcentaje, { ...base, escalada: true }))).toContain("Escalado al renormalizar");
    expect(html(createElement(CeldaPorcentaje, { ...base, disabled: true }))).toContain("disabled");
  });

  it("«¿Por GML o Mixta?»: explica las dos y ofrece Cancelar, Por GML y Mixta", () => {
    const h = html(createElement(DestinoModalidadDialogo, { marcas: [{ id: "m1", nombre: "BETA" }], onElegir: noop }));
    expect(h).toContain("¿Por GML o Mixta?");
    expect(h).toContain("BETA está al barrer y va a recibir su primer GML");
    for (const t of [">Cancelar<", ">Por GML<", ">Mixta<"]) expect(h).toContain(t);
    const varias = html(createElement(DestinoModalidadDialogo, { marcas: [{ id: "m1", nombre: "BETA" }, { id: "m2", nombre: "DELTA" }], onElegir: noop }));
    expect(varias).toContain("2 marcas están al barrer");
    expect(varias).toContain("<li>DELTA</li>");
  });

  it("una fila fuera de alcance no aparece en la tabla de reparto", () => {
    const h = bloque1();
    expect(h).not.toContain("<td class=\"px-3 py-2 align-middle \">MUJER · CASUAL · SANDALIA");
    expect(filaApi({ clave: "x", ruta: "R", unidades: 1, verano: [1, null], invierno: [1, null], enAlcance: false }).p2).toEqual([]);
  });
});
