import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { evaluarCurvaUsuario } from "../src/lib/curvas/curva-usuario";
import type { AgrupacionResultado, CandidataApi, EstadoCurvasApi, TrabajoAgrupacionApi } from "../src/lib/curvas/tipos-api";
import { AprobarPanel } from "../src/app/(app)/planificacion/curvas-estacionalidad/aprobar-panel";
import { CandidatasTabla } from "../src/app/(app)/planificacion/curvas-estacionalidad/candidatas-tabla";
import { ComposicionCard } from "../src/app/(app)/planificacion/curvas-estacionalidad/composicion-card";
import { CurvaUsuarioEditor } from "../src/app/(app)/planificacion/curvas-estacionalidad/curva-usuario-editor";
import { PARTIDA_EN_BLANCO, textosDeValores, textosEnBlanco } from "../src/app/(app)/planificacion/curvas-estacionalidad/curva-usuario-vista";
import { CurvasTab } from "../src/app/(app)/planificacion/curvas-estacionalidad/curvas-tab";
import { TablaAnioMes } from "../src/app/(app)/planificacion/curvas-estacionalidad/tabla-anio-mes";
import { VersionesPanel } from "../src/app/(app)/planificacion/curvas-estacionalidad/versiones-panel";
import { compararCurvas } from "../src/app/(app)/planificacion/curvas-estacionalidad/vista";
import { AntesDeProyectar } from "../src/app/(app)/planificacion/proyeccion/antes-de-proyectar";
import { textoEatM6, textoPruebaAnterior } from "../src/app/(app)/planificacion/proyeccion/vista";
import { agrupacion, anio, composicion, PLANA, vigente } from "./curvas.pantalla.fixture";
import { respuestaProyeccion } from "./proyeccion.pantalla.fixture";

/** Humo de render de la 06c (composición, F y T, Mi curva, lista, versiones y M7) con datos sintéticos. */

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const pct = (xs: number[]) => xs.map((x) => x / 100);
const P24 = pct([4.3, 4.4, 6.4, 8.3, 12.0, 13.7, 13.6, 11.65, 9.75, 6.9, 5.0, 4.0]);
const P25 = pct([4.3, 4.4, 6.4, 8.3, 10.1, 15.6, 13.6, 11.65, 9.75, 6.9, 5.0, 4.0]);
const A = pct([4.3, 4.4, 6.4, 8.3, 11.05, 14.65, 13.6, 11.65, 9.75, 6.9, 5.0, 4.0]);
const MI_CURVA = [5, 5, 6, 8, 11, 14, 13, 12, 10, 7, 5, 4];

const cand = (modelo: CandidataApi["modelo"], extra: Partial<CandidataApi> = {}): CandidataApi => ({
  modelo,
  curva: A,
  motivo: null,
  eat: 3.8,
  error_max: 1.9,
  pruebas: 2,
  pliegues: 2,
  eat_por_pliegue: [],
  eat_parcial: null,
  igual_a: null,
  prestada: modelo === "T",
  eat_en_muestra: 1.9,
  ...extra,
});

const detalleF = {
  pesos_anios: [
    { anio: 2024, peso: 3 / 7 },
    { anio: 2025, peso: 4 / 7 },
  ],
  rho: 3.8,
  delta: 4.2,
  lambda: 0.1684,
  t_usada: A,
  base: A,
  contraida: A,
  por_pliegue: [{ anio_prueba: 2024, rho: 4, lambda: 0.1684, eat: 6.5 }],
};

const resultado = {
  agrupacion_id: "a1",
  temporada: "invierno",
  temporada_sugerida: null,
  origen: "propia",
  composicion: { equivalencias: 4, huella: "x" },
  efecto_atipico: { volumen: [], forma: null },
  anios: [anio(2024, { participacion: P24, participacion_real: P24 }), anio(2025, { participacion: P25, participacion_real: P25 })],
  candidatas: [
    cand("A"),
    cand("F", {
      eat: null,
      pruebas: 0,
      pliegues: 0,
      motivo: "sin_backtesting_honesto",
      explicacion_f: {
        anios: detalleF.pesos_anios,
        rho: 3.8,
        delta: 4.2,
        lambda: 0.1684,
        frase: "F se apoya en 2024 (43 %) y 2025 (57 %); contrae un 17 % hacia la curva de invierno (T). F se muestra pero no compite: con un solo año de entrenamiento por prueba no hay backtesting honesto.",
        por_pliegue: detalleF.por_pliegue,
      },
      detalle_f: detalleF,
    }),
    cand("T", { eat: 6.0, prestada: true, igual_a: null }),
  ],
  recomendada: "A",
  motivo_recomendacion: "menor_error",
  margen: 1,
  comparacion: { mejor: "A", eat_mejor: 3.8, eat_a: 3.8, margen: 1, pliegues: 2, ruido_normal: 3.8, margen_ruido: 0.25, frase: "A se equivoca 3.8 pp en 2 pruebas: es la de menor error." },
  ruido_normal: 3.8,
  ruido_normal_detalle: [{ anios: [2024, 2025], eat: 3.8 }],
  estabilidad: 0.7,
  nivel_estabilidad: "media",
  banda: null,
  cv_mensual: [],
  avisos: [],
} as unknown as AgrupacionResultado;

describe("composición de la agrupación", () => {
  const base = { onAbrir: () => {}, cargando: false, actual: true, error: null, onReintentar: () => {}, curvaAgrupacion: A, equivalenciasActivas: 4, seleccionados: [] as string[], onVer: () => {}, nombreArchivo: "x.csv" };

  it("plegada: dice cuántas equivalencias hay y que se lee al desplegar; no pide nada", () => {
    const h = html(createElement(ComposicionCard, { ...base, abierta: false, datos: null }));
    expect(h).toContain("Composición de la agrupación");
    expect(h).toContain("4 equivalencias activas");
    expect(h).toContain("Ver composición");
    expect(h).toContain("Plegada");
    expect(h).toContain('aria-expanded="false"');
  });

  it("abierta sin datos: «Leyendo la composición…»; con error, Reintentar", () => {
    expect(html(createElement(ComposicionCard, { ...base, abierta: true, datos: null, cargando: true }))).toContain("Leyendo la composición de la agrupación…");
    const e = html(createElement(ComposicionCard, { ...base, abierta: true, datos: null, error: "No se pudo leer." }));
    expect(e).toContain("No se pudo leer.");
    expect(e).toContain("Reintentar");
  });

  it("abierta: GML principales con peso por año, EAT vs resto, «se aparta» con motivo y enlace a M3, otras agrupaciones, «Otros N GML» y total", () => {
    const h = html(createElement(ComposicionCard, { ...base, abierta: true, datos: composicion(), seleccionados: ["g1"] }));
    expect(h).toContain("4 GML · 4 equivalencias activas · 1 se aparta");
    expect(h).toContain("HOMBRE · URBANO · CASACA");
    expect(h).toContain("HOMBRE · FORMAL · ABRIGO");
    expect(h).toContain("30.0 %");
    expect(h).toContain("56.0 · 60.0");
    expect(h).toContain("Se aparta");
    expect(h).toContain("su forma se aparta del resto de la agrupación: 56.0 pp en 2024 y 60.0 pp en 2025; umbral 3.5 pp");
    expect(h).toContain("/maestros/estacionalidad?pestana=asignacion");
    expect(h).toContain("Reasignar en M3");
    expect(h).toContain("también en otra agrupación (23 % de su venta en 2025)");
    expect(h).toContain("Otros 1 GML (0.5 %)");
    expect(h).not.toContain("HOMBRE · URBANO · GORRO");
    expect(h).toContain("Total de la agrupación");
    expect(h).toContain("2026 parcial");
    expect(h).toContain("Buscar GML o equivalencia");
    expect(h).toContain("Pequeños múltiplos");
    expect(h).toContain("Descargar CSV (todos)");
    expect(h).toContain('aria-label="Ver HOMBRE · URBANO · CASACA en el gráfico"');
    expect(h).toContain("checked");
    expect(h).toContain("3 GML principales".replace("3 GML principales", "3 principales"));
    expect(h).toContain("<caption");
    expect(h).toContain("3 se apartan".replace("3 se apartan", "1 GML se aparta"));
  });

  it("sin cálculo (faltan los periodos del Niño): se muestran pesos y «se aparta» dice que no se evalúa", () => {
    const c = composicion({ con_calculo: false });
    const h = html(createElement(ComposicionCard, { ...base, abierta: true, datos: { ...c, gml: c.gml.map((g) => ({ ...g, se_aparta: null, umbral: null })) } }));
    expect(h).toContain("«se aparta» no se evalúa todavía");
    expect(h).toContain("no se evalúa hasta que se pueda calcular");
    expect(h).not.toContain("<strong>Se aparta</strong>");
  });

  it("composición vieja (otra huella) se avisa mientras se actualiza", () => {
    expect(html(createElement(ComposicionCard, { ...base, abierta: true, datos: composicion(), actual: false, cargando: true }))).toContain("Actualizando la composición");
  });

  it("un GML con unidades negativas lo dice", () => {
    const c = composicion();
    const neg = { ...c, gml: [{ ...c.gml[0], avisos: ["unidades_negativas" as const] }] };
    expect(html(createElement(ComposicionCard, { ...base, abierta: true, datos: neg }))).toContain("Unidades negativas (devoluciones)");
  });
});

describe("candidatas con F y T, y la fila de Mi curva", () => {
  const e = evaluarCurvaUsuario(MI_CURVA, resultado, null);

  it("F: su frase, «Cómo se armó F», el aviso de honestidad, «No compite» y el EAT en muestra; T con EAT y pruebas", () => {
    const h = html(createElement(CandidatasTabla, { resultado, seleccionada: "A", onSeleccionar: () => {} }));
    expect(h).toContain("F · Modelo avanzado");
    expect(h).toContain("F se apoya en 2024 (43 %) y 2025 (57 %)");
    expect(h).toContain("Cómo se armó F");
    expect(h).toContain("ningún algoritmo avanzado garantiza ganar");
    expect(h).toContain("No compite:");
    expect(h).toContain("sin backtesting honesto");
    expect(h).toContain("1.9 pp en muestra");
    expect(h).toContain("fuera de muestra");
    expect(h).toContain("T · Curva de la temporada");
    expect(h).toContain("6.0 pp");
    expect(h).not.toContain("U · Mi curva");
  });

  it("con Mi curva válida añade la fila U con radio, EAT EN MUESTRA, ruido y «Curva del usuario»", () => {
    const h = html(createElement(CandidatasTabla, { resultado, seleccionada: "U", onSeleccionar: () => {}, usuario: e }));
    expect(h).toContain("U · Mi curva");
    expect(h).toContain("EN MUESTRA");
    expect(h).toContain("5.2 pp");
    expect(h).toContain("Curva del usuario");
    expect(h).toContain('aria-label="Elegir mi curva (curva del usuario) para aprobarla"');
    expect(h).toContain("«en muestra» es la curva completa");
  });

  it("«Igual a A» cuando Mi curva coincide con una candidata", () => {
    const igual = evaluarCurvaUsuario(A.map((x) => x * 100), resultado, null);
    expect(html(createElement(CandidatasTabla, { resultado, seleccionada: "A", onSeleccionar: () => {}, usuario: igual }))).toContain("Igual a A");
  });
});

describe("editor de Mi curva", () => {
  const e = evaluarCurvaUsuario(MI_CURVA, resultado, null, { tipo: "pegado", referencia: null });
  const base = {
    onAbrir: () => {},
    partida: PARTIDA_EN_BLANCO,
    onCambio: () => {},
    resultado,
    vigente: { version: 2, curva: PLANA },
    referencia: { modelo: "A" as const, curva: A },
    candidataReferencia: cand("A"),
    seleccionadaU: false,
    onElegirU: () => {},
    deshabilitado: false,
  };

  it("plegado sin borrador: «Definir mi curva»; con borrador: «Seguir con mi curva»", () => {
    expect(html(createElement(CurvaUsuarioEditor, { ...base, abierta: false, textos: textosEnBlanco(), evaluacion: null }))).toContain("Definir mi curva");
    const h = html(createElement(CurvaUsuarioEditor, { ...base, abierta: false, textos: textosDeValores(MI_CURVA), evaluacion: e }));
    expect(h).toContain("Seguir con mi curva");
    expect(h).toContain("borrador");
  });

  it("abierto y válido: doce celdas con etiqueta, suma ✓, Normalizar, Limpiar, Partir de, Pegar desde Excel, diferencia y medida en muestra", () => {
    const h = html(createElement(CurvaUsuarioEditor, { ...base, abierta: true, textos: textosDeValores(MI_CURVA), evaluacion: e }));
    expect((h.match(/aria-label="Mi curva en /g) ?? []).length).toBe(12);
    expect(h).toContain('inputMode="decimal"');
    expect(h).toContain("Suma 100.0 % ✓");
    expect(h).toContain("Normalizar a 100 %");
    expect(h).toContain("Limpiar");
    expect(h).toContain("Partir de");
    expect(h).toContain("Candidatas del sistema");
    expect(h).toContain("A · Promedio simple");
    expect(h).toContain("Un año");
    expect(h).toContain("Vigente v2");
    expect(h).toContain("En blanco");
    expect(h).toContain("Pegar desde Excel");
    expect(h).toContain("Diferencia (pp)");
    expect(h).toContain("mi curva − propuesta");
    expect(h).toContain("EN MUESTRA");
    expect(h).toContain("2024 4.6 pp");
    expect(h).toContain("A: 3.8 fuera de muestra · 1.9 en muestra");
    expect(h).toContain("la curva del usuario siempre lleva motivo");
    expect(h).toContain("No se marcará obsoleta");
    expect(h).toContain("Elegir «U · Mi curva» para aprobar");
    expect(h).toContain('scope="col"');
    expect(h).toContain("<caption");
  });

  it("con la suma mal: dice cuánto falta y no se dibuja ni se mide", () => {
    const h = html(createElement(CurvaUsuarioEditor, { ...base, abierta: true, textos: textosDeValores([5, 5, 6, 8, 11, 14, 13, 12, 10, 7, 5, 2]), evaluacion: null }));
    expect(h).toContain("Suma 98.0 % · faltan 2.0");
    expect(h).toContain("no se dibuja ni se mide");
    expect(h).not.toContain("EN MUESTRA");
  });

  it("elegida para aprobar: el botón lo dice", () => {
    expect(html(createElement(CurvaUsuarioEditor, { ...base, abierta: true, textos: textosDeValores(MI_CURVA), evaluacion: e, seleccionadaU: true }))).toContain("«U · Mi curva» elegida para aprobar");
  });
});

describe("tabla año × mes con Mi curva y aprobar U", () => {
  it("la tabla suma la fila «Mi curva» y su diferencia frente a la aprobada", () => {
    const h = html(
      createElement(TablaAnioMes, {
        id: "t",
        anios: [anio(2024)],
        propuesta: { etiqueta: "Propuesta A", curva: A },
        vigente: { etiqueta: "Aprobada v2 (A)", curva: PLANA },
        usuario: { etiqueta: "Mi curva", curva: pct(MI_CURVA) },
        umbralDominante: 0.3,
        nombreArchivo: "x.csv",
      })
    );
    expect(h).toContain("Mi curva");
    expect(h).toContain("mi curva − aprobada");
    expect(h).toMatch(/EAT \d+\.\d pp/);
  });

  it("aprobar U: botón «Aprobar mi curva (U)», la nota obligatoria y el aviso de que no se marca obsoleta; la vigente U lo dice", () => {
    const datos = {
      agrupacion: { id: "a1", nombre: "ABRIGO", codigo: "ABRIGO", activo: true, temporada: "invierno", temporada_sugerida: null, generos: [], equivalencias_activas: 4 },
      vigente: vigente({ version: 2, modelo: "U", origen_curva: "usuario", recomendada: false, curva_manual: { valores_ingresados: MI_CURVA, partida: PARTIDA_EN_BLANCO, en_muestra: true, eat_en_muestra: 5.2, error_max_en_muestra: 1.3, eat_en_muestra_por_anio: [], eat_parcial_en_muestra: null, igual_a: null } }),
      obsoleta: null,
      avisos_vigente: [{ codigo: "cambio_desde_aprobacion", detalle: "desde que la aprobaste: 1 mes publicado y cerrado después de 2026-08." }],
    } as unknown as TrabajoAgrupacionApi;
    const prop = { etiqueta: "Mi curva", curva: pct(MI_CURVA) };
    const apr = { etiqueta: "Aprobada v2 (U)", curva: PLANA };
    const h = html(
      createElement(AprobarPanel, {
        datos,
        modelo: "U",
        propuesta: prop,
        vigente: apr,
        comparacion: compararCurvas(PLANA, prop.curva, false),
        avisoNoComparable: null,
        nota: "",
        onNota: () => {},
        motivosNota: ["aprobaste tu propia curva (U): siempre lleva motivo"],
        puedeAprobar: true,
        motivoNoPuede: null,
        ocupado: false,
        error: null,
        aviso: null,
        onAprobar: () => {},
        onAccion: () => {},
        onCerrarError: () => {},
        onCerrarAviso: () => {},
      })
    );
    expect(h).toContain("Aprobar mi curva (U) como versión 3");
    expect(h).toContain("Obligatoria ahora: aprobaste tu propia curva (U)");
    expect(h).toContain("no se marcará obsoleta por datos nuevos");
    expect(h).toContain("Mi curva");
    expect(h).toContain("No se marca obsoleta");
    expect(h).toContain("Cambio desde la aprobación:");
    expect(h).toContain("EAT 5.2 pp");
  });
});

describe("lista y versiones con curvas del usuario", () => {
  const estado: EstadoCurvasApi = {
    datos: { desde: "2023-01", hasta: "2026-09", meses_publicados: 45, faltantes: [], ultimo_mes_cerrado: "2026-09" },
    prerrequisitos_globales: [],
    agrupaciones: [
      agrupacion({
        id: "u",
        nombre: "MI AGRUPACION",
        estado: "curva_usuario",
        vigente: vigente({ version: 3, modelo: "U", recomendada: false, recomendada_entonces: "A", origen_curva: "usuario", eat: null }),
        avisos_vigente: [{ codigo: "cambio_desde_aprobacion", detalle: "desde que la aprobaste: cambió la composición: +2 equivalencias." }],
      }),
      agrupacion({ id: "f", nombre: "AGRUPACION AVANZADA", estado: "al_dia", vigente: vigente({ modelo: "F", origen_curva: "avanzada" }) }),
    ],
    periodos_atipicos: [],
    resumen: {
      agrupaciones_activas: 2,
      por_temporada: { invierno: 2, verano: 0, todo_el_ano: 0 },
      sin_revisar_toda_temporada: 0,
      con_curva_vigente: 2,
      al_dia: 1,
      al_dia_distintas: 0,
      obsoletas: 0,
      curvas_usuario: 1,
      sin_curva: 0,
      bloqueadas: 0,
      bloqueadas_sin_curva: 0,
      calculables_sin_curva: 0,
      vigentes_prestadas: 0,
      inactivas_con_curva: 0,
      equivalencias_sin_agrupacion: 0,
    },
  };
  const props = { estado, cargando: false, agrupacionesM3: [], filtroTemporada: "todas" as const, onFiltroTemporada: () => {}, filtroEstado: "todas" as const, onFiltroEstado: () => {}, comparaciones: {}, onComparacion: () => {}, onTrabajar: () => {}, onIrAPeriodos: () => {}, onCambio: () => {} };

  it("curva del usuario: estado propio (no obsoleta), el aviso de cambio con su motivo visible, «A (vs U)», Comparar y los badges por origen", () => {
    const h = html(createElement(CurvasTab, props));
    expect(h).toContain("Curva del usuario");
    expect(h).toContain("el sistema proponía A; no se marca obsoleta, la cambias tú");
    expect(h).toContain("Cambio desde la aprobación");
    expect(h).toContain("cambió la composición: +2 equivalencias");
    expect(h).toContain("A (vs U)");
    expect(h).toContain("Comparar con el sistema");
    expect(h).toContain("Mi curva");
    expect(h).toContain("Avanzada");
    expect(h).toContain("1 con curva del usuario");
    expect(h).not.toContain(">Obsoleta<");
  });

  it("versiones plegadas: resumen con la letra U", () => {
    const h = html(
      createElement(VersionesPanel, {
        versiones: {
          datos: { versiones: [{ id: "c3", version: 3, estado: "vigente", modelo: "U", origen: "propia", origen_curva: "usuario", curva_manual: null, recomendada: false, recomendada_entonces: "A", eat: null, ruido_normal: 3.8, curva: PLANA, nota: "la conozco", aprobada_at: "2026-10-16T15:00:00Z", usuario_nombre: "Javier", foto_id: "f3", parametros_resumen: [] }] },
          cargando: false,
          error: null,
          setError: () => {},
        },
        ocupado: false,
        puedeRetirar: true,
        onVerFoto: () => {},
        onRetirar: () => {},
      })
    );
    expect(h).toContain("v3 vigente · U");
  });
});

describe("M7: sin backtesting con cobertura y curvas del usuario", () => {
  it("«sin backtesting de M6 (cubre 70 %…)» solo con cobertura parcial; sin dato o con cero, el texto de siempre; con EAT, el EAT", () => {
    expect(textoEatM6(null, 0.7, 2025)).toContain("sin backtesting de M6 (cubre 70 %");
    expect(textoEatM6(null, 0.7, 2025)).toContain("curva del usuario");
    expect(textoEatM6(null, undefined, 2025)).toBe("sin backtesting de M6");
    expect(textoEatM6(null, 0, 2025)).toBe("sin backtesting de M6");
    expect(textoEatM6(9.8, 1, 2025)).toBe("M6 dejando 2025 fuera: EAT 9.8 pp");
    expect(textoPruebaAnterior({ anio: 2025, propuesto: 100, real: 120, desvio_pct: -16.7, eat_m6: null, eat_m6_cobertura: 0.7 }, "2026-09-01")).toContain("cubre 70 %");
  });

  it("«Antes de proyectar»: la línea «N agrupaciones con curva del usuario», solo si hay", () => {
    const r = respuestaProyeccion();
    const con = html(createElement(AntesDeProyectar, { datos: r.datos, prerrequisitos: r.prerrequisitos, curvasUsuario: 2 }));
    expect(con).toContain("2 agrupaciones con curva del usuario");
    expect(con).toContain("no se marcan obsoletas");
    expect(html(createElement(AntesDeProyectar, { datos: r.datos, prerrequisitos: r.prerrequisitos, curvasUsuario: 1 }))).toContain("1 agrupación con curva del usuario");
    expect(html(createElement(AntesDeProyectar, { datos: r.datos, prerrequisitos: r.prerrequisitos }))).not.toContain("curva del usuario");
  });
});
