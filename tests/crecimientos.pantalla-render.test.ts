import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AprobarGM } from "../src/app/(app)/planificacion/curvas-estacionalidad/genero-mundo/aprobar-gm";
import { CierreGM } from "../src/app/(app)/planificacion/curvas-estacionalidad/genero-mundo/cierre-gm";
import { DetalleGM, DetalleGMVista } from "../src/app/(app)/planificacion/curvas-estacionalidad/genero-mundo/detalle-gm";
import { GeneroMundoTab } from "../src/app/(app)/planificacion/curvas-estacionalidad/genero-mundo/genero-mundo-tab";
import { GraficoGM } from "../src/app/(app)/planificacion/curvas-estacionalidad/genero-mundo/grafico-gm";
import { ListaGM } from "../src/app/(app)/planificacion/curvas-estacionalidad/genero-mundo/lista-gm";
import { ReferenciasGM } from "../src/app/(app)/planificacion/curvas-estacionalidad/genero-mundo/referencias-gm";
import { TablaGM } from "../src/app/(app)/planificacion/curvas-estacionalidad/genero-mundo/tabla-gm";
import { FotoVersionGM, VersionesGM } from "../src/app/(app)/planificacion/curvas-estacionalidad/genero-mundo/versiones-gm";
import {
  CLAVE_HOMBRE_URBANO,
  CLAVE_NINO_URBANO,
  cierreEjemploA,
  detalle,
  detalleConVerano,
  detalleParaReaprobar,
  detalleSinAprobar,
  detalleSinNino,
  lista,
  referencia,
  referenciaMetodoAnterior,
  referenciasEjemplo,
  version,
  versionBruta,
} from "./crecimientos.pantalla.fixture";

/** Humo de render con datos sintéticos: ningún componente de la pestaña debe lanzar y los textos clave de la ficha 06e deben salir. */

const nada = () => {};
// React separa con comentarios los textos que vienen de varias expresiones: se quitan para comparar frases completas.
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el).replaceAll("<!-- -->", "");

function listaEl(extra: Partial<Parameters<typeof ListaGM>[0]> = {}) {
  return createElement(ListaGM, {
    lista: lista(),
    cargando: false,
    estado: "todos",
    onEstado: nada,
    genero: "",
    onGenero: nada,
    onAnio: nada,
    onProyeccion: nada,
    onTrabajar: nada,
    ...extra,
  });
}

function vistaEl(extra: Partial<Parameters<typeof DetalleGMVista>[0]> = {}) {
  return createElement(DetalleGMVista, {
    detalle: detalle(),
    anio: 2027,
    proyeccionId: null,
    enTrabajo: [{ id: "p1", nombre: "Proyección 2026" }],
    ocupado: false,
    errorAprobar: null,
    exito: null,
    onCerrarError: nada,
    onCerrarExito: nada,
    onAprobar: nada,
    onVolver: nada,
    onIrAResto: nada,
    ...extra,
  });
}

const botonDeshabilitado = (h: string, texto: string) => new RegExp(`<button[^>]*disabled=""[^>]*>${texto}`).test(h);

describe("lista", () => {
  it("cabecera, texto fijo de la ficha 06e, filtros, filas, Resto y Total", () => {
    const h = html(listaEl());
    expect(h).toContain("Crecimiento por género × mundo");
    expect(h).toContain("Año de aplicación");
    expect(h).toContain("% de 2027 sobre la venta de 2026 corregida del Niño, de las tiendas que tendrá 2027.");
    expect(h).toContain("En un GM sin Niño (corrección menor que 0.5 %), corregida = real.");
    expect(h).toContain("HOMBRE · URBANO");
    expect(h).toContain("Aprobado v2");
    expect(h).toContain("Sin aprobar");
    expect(h).toContain("Obsoleto");
    expect(h).toContain("mundo desactivado");
    expect(h).toContain("sigue al Resto");
    expect(h).toContain("extremo");
    expect(h).toContain("frágil");
    expect(h).toContain("Total ponderado");
    expect(h).toContain("ponderado por la base 2027 corregida");
    expect(h).toContain("3 GM sin aprobar siguen al Resto");
    expect(h).toContain("Descargar CSV");
    expect(h).toContain("Trabajar");
    expect(h).not.toContain("No hay proyección de 2026 calculada");
    expect(h).not.toContain("Atípico");
  });

  it("columnas nuevas: cierre 2026 por curva, base 2027 real/corregida con la corrección del Niño y la fila del Total en sus dos lecturas", () => {
    const h = html(listaEl());
    expect(h).toContain("Cierre 2026 por curva (mismas tiendas)");
    expect(h).toContain("58,750");
    expect(h).toContain("u corregidas");
    expect(h).toContain("+1.9 %");
    expect(h).toContain("+8.8 %");
    expect(h).toContain("Acumulado 2026 (real / corregido)");
    expect(h).toContain("Aplicado hoy (sobre corregido · sobre real)");
    expect(h).toContain("Base 2027 (tiendas de 2027)");
    expect(h).toContain("56,100");
    expect(h).toContain("59,925");
    expect(h).toContain("corrección del Niño +6.8 %");
    expect(h).toContain("corrección del Niño +0.1 % (no material)");
    expect(h).toContain("de la proyección de referencia");
    expect(h).toContain("412 u de venta fuera de la base de M7");
    expect(h).toContain("avance bajo");
    expect(h).toContain("sin curva 4 %");
    expect(h).toContain("factor parcial");
    expect(h).toContain("8.07 %");
    expect(h).toContain("sobre 2026 corregido");
    expect(h).toContain("sobre 2026 real");
  });

  it("el aprobado muestra «sobre 2026 corregido» o el badge «bruto · antes de 0.14.0», y «reaprobar» solo si hay Niño", () => {
    const h = html(listaEl());
    expect(h).toContain("8.00 %");
    expect(h).toContain("= +15.36 % sobre 2026 real");
    expect(h).toContain("bruto · antes de 0.14.0");
    expect(h).toContain("reaprobar");
    // una bruta en un GM sin Niño material no pide reaprobar (ejemplo E)
    const l = lista();
    const sinNino = lista({ filas: l.filas.map((f) => (f.clave === l.filas[2].clave ? { ...f, hay_nino: false, cierre: cierreEjemploA({ hay_nino: false }) } : f)) });
    const h2 = html(listaEl({ lista: sinNino }));
    expect(h2).toContain("bruto · antes de 0.14.0");
    expect(h2).not.toContain(">reaprobar<");
  });

  it("2027 marcado como Niño: alerta arriba con el mensaje de la ficha", () => {
    const h = html(listaEl({ lista: lista({ anio_siguiente_atipico: { meses: ["2027-03", "2027-04"] } }) }));
    expect(h).toContain("2027 está marcado como año del Niño en Curvas → Periodos atípicos.");
    expect(h).toContain("si no lo habrá, quita la marca; si lo habrá, hay que decidir cómo modelarlo antes de aprobar.");
    expect(h).toContain("marzo 2027, abril 2027");
    expect(h).toContain("Aprobar queda deshabilitado");
  });

  it("sin proyección de referencia de método 5 avisa, ofrece solo las de método 5 y muestra «—» en el Total", () => {
    const h = html(listaEl({ lista: lista({ proyeccion_referencia: null, proyecciones_disponibles: [], total: { pct_ponderado: null, base: 0, sin_aprobar: 4 } }) }));
    expect(h).toContain("No hay proyección de 2026 calculada con el método 5");
    expect(h).toContain("Ninguna disponible");
    const conVieja = html(listaEl());
    expect(conVieja).toContain("Proyección 2026");
    expect(conVieja).not.toContain("Proyección 2026 (vieja)");
  });

  it("la referencia de método anterior se ve como «recalcula la proyección con 0.14.0»", () => {
    const fila = lista().filas[1];
    const l = lista({ filas: [{ ...fila, aplicado_hoy: referenciaMetodoAnterior("aplicado_hoy") }] });
    expect(html(listaEl({ lista: l }))).toContain("recalcula la proyección con 0.14.0 (método anterior)");
  });

  it("cargando y vacío", () => {
    expect(html(listaEl({ lista: null, cargando: true }))).toContain("Cargando");
    expect(html(listaEl({ lista: null, cargando: false }))).toContain("No se pudo cargar");
    expect(html(listaEl({ estado: "obsoleto", genero: "MUJER" }))).toContain("Ningún género × mundo coincide");
  });
});

describe("curva de venta", () => {
  const d = detalle();

  it("gráfico: modos, leyenda por año, 2026 corregido, vista previa de 2027 con las tiendas de 2027 y bandas del Niño", () => {
    const h = html(createElement(GraficoGM, { detalle: d, modo: "unidades", onModo: nada, idTabla: "t", pct: 8 }));
    expect(h).toContain("Unidades");
    expect(h).toContain("Forma (%)");
    expect(h).toContain("Sin Niño");
    expect(h).toContain("2023");
    expect(h).toContain("2026 real (ene–set)");
    expect(h).toContain("2026 cierre por curva");
    expect(h).toContain("2026 corregido (sin Niño)");
    expect(h).toContain("invierno ÷ 0.80 (relativo)");
    expect(h).toContain("2027 vista previa (8.00 %)");
    expect(h).toContain("tiendas de 2027 (incluye T10)");
    expect(h).toContain("factor parcial (ene–set)");
    expect(h).toContain("Niño 2023 · verano");
    expect(h).toContain("<svg");
    // la vista previa se mueve con el %
    expect(html(createElement(GraficoGM, { detalle: d, modo: "unidades", onModo: nada, idTabla: "t", pct: 20 }))).toContain("2027 vista previa (20.00 %)");
    expect(html(createElement(GraficoGM, { detalle: d, modo: "unidades", onModo: nada, idTabla: "t", pct: null }))).not.toContain("2027 vista previa");
  });

  it("en Forma no se dibujan las dos líneas extra; en Sin Niño no hay línea corregida aparte", () => {
    const forma = html(createElement(GraficoGM, { detalle: d, modo: "forma", onModo: nada, idTabla: "t", pct: 8 }));
    expect(forma).toContain("Forma típica");
    expect(forma).not.toContain("2026 corregido (sin Niño)");
    expect(forma).not.toContain("vista previa");
    const sin = html(createElement(GraficoGM, { detalle: d, modo: "sin_nino", onModo: nada, idTabla: "t", pct: 8 }));
    expect(sin).toContain("con el efecto del Niño quitado");
    expect(sin).not.toContain("2026 corregido (sin Niño)");
    expect(sin).toContain("2027 vista previa (8.00 %)");
  });

  it("un GM sin Niño material no muestra la línea corregida (ejemplo E)", () => {
    const h = html(createElement(GraficoGM, { detalle: detalleSinNino(), modo: "unidades", onModo: nada, idTabla: "t", pct: 10 }));
    expect(h).not.toContain("2026 corregido (sin Niño)");
    expect(h).toContain("2027 vista previa (10.00 %)");
  });

  it("gráfico sin series no lanza", () => {
    const h = html(createElement(GraficoGM, { detalle: { ...d, series: [], bandas_nino: [], forma_tipica: null, serie_corregida: null, serie_base_curva: null }, modo: "forma", onModo: nada, idTabla: "t" }));
    expect(h).toContain("ninguna serie");
  });

  it("tabla año × mes: filas nuevas, «p» en lo proyectado, totales, variación y CSV", () => {
    const h = html(createElement(TablaGM, { id: "t", detalle: d, modo: "unidades", nombreArchivo: "x.csv", pct: 8 }));
    expect(h).toContain("Descargar CSV");
    expect(h).toContain("Var. año anterior");
    expect(h).toContain("con meses proyectados");
    expect(h).toContain("2026 corregido (sin Niño)");
    expect(h).toContain("Base 2027 por curva, real — tiendas de 2027 (incluye T10)");
    expect(h).toContain("Base 2027 por curva, corregida — tiendas de 2027 (incluye T10)");
    expect(h).toContain("2027 vista previa (8.00 %)");
    expect(h).toContain("+8.00 %");
    expect(h).toContain("italic");
    expect(h).toContain(">p</sup>");
    const forma = html(createElement(TablaGM, { id: "t", detalle: d, modo: "forma", nombreArchivo: "x.csv" }));
    expect(forma).toContain("Forma típica");
    expect(forma).toContain("100 %");
    expect(forma).not.toContain("vista previa (");
    expect(html(createElement(TablaGM, { id: "t", detalle: { ...d, series: [], serie_corregida: null, serie_base_curva: null }, modo: "unidades", nombreArchivo: "x.csv" }))).toContain("no tiene venta comparable");
  });
});

describe("cómo se cierra 2026", () => {
  it("lista cada agrupación con su curva, avance, factor y cierres, el total y el rótulo del factor relativo con sus dos números", () => {
    const h = html(createElement(CierreGM, { detalle: detalle() }));
    expect(h).toContain("ABRIGOS HO");
    expect(h).toContain("POLOS HO");
    expect(h).toContain("v3");
    expect(h).toContain("v2");
    expect(h).toContain("Avance a set");
    expect(h).toContain("80 %");
    expect(h).toContain("÷ 0.80");
    expect(h).toContain("Cierre 2026 real");
    expect(h).toContain("Cierre 2026 corregido");
    expect(h).toContain("Base 2027 real");
    expect(h).toContain("Base 2027 corregida");
    expect(h).toContain("18,750");
    expect(h).toContain("55,000");
    expect(h).toContain("58,750");
    expect(h).toContain("56,100");
    expect(h).toContain("59,925");
    expect(h).toContain("Género × mundo");
    expect(h).toContain("Factor del Niño · invierno 2026");
    expect(h).toContain("factor parcial · confirmado por Javier");
    expect(h).toContain("Factor 0.80 = 0.76 ÷ 0.95.");
    expect(h).toContain("<strong class=\"text-tinta\">0.76</strong>");
    expect(h).toContain("(9 de 12 meses del periodo)");
    expect(h).toContain("la red de todo el año en los mismos meses y tiendas");
    expect(h).toContain("(-5 % frente a 2025), no 2025 repetido");
    expect(h).toContain("En la proyección «Plan 2026»: base 2027 56,120 u real · 59,940 u corregida");
    expect(h).toContain('href="/planificacion/proyeccion?pestana=factores"');
    expect(h).toContain("Cambiar el factor en Proyección → Factores del Niño");
  });

  it("verano: «Cómo crece el verano atípicamente» con la tabla de la temporada y, debajo, solo las agrupaciones de verano del GM", () => {
    const h = html(createElement(CierreGM, { detalle: detalleConVerano() }));
    expect(h).toContain("Factor del Niño · verano 2026");
    expect(h).toContain("Cómo crece el verano atípicamente");
    expect(h).toContain("Factor 1.50 escrito por Javier · oct–dic de 2026 se proyecta ×1.50 (supone que el Niño sigue hasta diciembre)");
    expect(h).toContain("Setiembre: ×1.90 frente a 2025; su tendencia ene–ago ×1.20; la red ×0.95 → crece ×1.58 sobre su tendencia y ×2.00 sobre la red.");
    expect(h).toContain("1 solo mes del periodo, y es el de inicio de temporada: dato frágil.");
    expect(h).toContain("Solo las agrupaciones de verano de este género × mundo (informativo)");
    expect(h).toContain("Ratio ÷ red");
    expect(h).toContain("1.900");
    expect(h).toContain("2.000");
    expect(h).toContain('data-periodo="si"');
    expect(h).toContain("no calcula el factor");
  });

  it("verano sin factor: el aviso de la ficha y el badge «sin factor»", () => {
    const d = detalleConVerano({ factores_y: detalleConVerano().factores_y!.map((f) => (f.temporada === "verano" ? { ...f, efectivo: null, origen: null, ratio_aplicado: null, estado: "faltante" as const } : f)) });
    const h = html(createElement(CierreGM, { detalle: d }));
    expect(h).toContain("Sin factor: 2026 de verano no se corrigió y no podrás cerrar.");
    expect(h).toContain("sin factor");
  });

  it("factor por confirmar y desfasado se ven en la insignia y dicen dónde arreglarlo", () => {
    const porConfirmar = detalle({ factores_y: [{ ...detalle().factores_y![0], estado: "sin_confirmar" }] });
    expect(html(createElement(CierreGM, { detalle: porConfirmar }))).toContain("por confirmar en Factores del Niño");
    const desfasado = detalle({ factores_y: [{ ...detalle().factores_y![0], estado: "desfasado" }] });
    expect(html(createElement(CierreGM, { detalle: desfasado }))).toContain("desfasado: sincroniza en Factores del Niño");
  });

  it("avisos: avance bajo por agrupación, sin curva y meses faltantes; sin cierre no lanza", () => {
    const d = detalle({
      cierre: cierreEjemploA({ avance_bajo: true, agrupaciones_avance_bajo: ["ABRIGOS HO"], sin_curva_pct: 4 }),
      cierre_por_agrupacion: [{ ...detalle().cierre_por_agrupacion![0], avance_bajo: true }, { ...detalle().cierre_por_agrupacion![1], curva: null }],
    });
    const h = html(createElement(CierreGM, { detalle: d }));
    expect(h).toContain("Avance bajo de la curva (ABRIGOS HO)");
    expect(h).toContain("avance bajo");
    expect(h).toContain("sin curva · compuesta");
    expect(h).toContain("4 % del vendido se cerró con la curva compuesta");
    expect(html(createElement(CierreGM, { detalle: detalle({ cierre: undefined, cierre_por_agrupacion: undefined }) }))).toContain("Todavía no hay cierre por curva");
    expect(html(createElement(CierreGM, { detalle: detalle({ cierre: cierreEjemploA({ motivo_nulo: "meses_faltantes", cierre: null, cierre_corregido: null }) }) }))).toContain("Faltan meses publicados");
  });
});

describe("cómo crece", () => {
  it("referencias en el orden de la ficha, con % real, % corregido y «equivale para 2027 (sobre 2026 corregido)»", () => {
    const d = detalle({ referencias: [referencia({ extremo: true, fragil: true }), ...referenciasEjemplo().slice(1)] });
    const h = html(createElement(ReferenciasGM, { detalle: d }));
    const orden = ["Cierre 2026 por curva", "Acumulado ene–set 2026", "Año completo 2025", "Año completo 2024", "Aplicado hoy"].map((t) => h.indexOf(t));
    expect(orden.every((i) => i >= 0)).toBe(true);
    expect([...orden].sort((a, b) => a - b)).toEqual(orden);
    expect(h).toContain("% real");
    expect(h).toContain("% corregido");
    expect(h).toContain("Equivale para 2027 (sobre 2026 corregido)");
    expect(h).toContain("+8.8 %");
    expect(h).toContain("sobre corregido");
    expect(h).toContain("sobre real");
    expect(h).toContain("extremo");
    expect(h).toContain("frágil");
    expect(h).toContain("T07 aporta el 38.5 % de 2025; sin ella, +1.2 %");
    expect(h).toContain("ene–set es el 74 % del año 2025");
    expect(h).not.toContain("sin Niño + rebote");
    expect(h).not.toContain("Cierre proyectado");
  });

  it("con Niño: el aviso dice cuánto vale 2026 corregido en las mismas tiendas; el factor parcial pide confirmar cada mes", () => {
    const h = html(createElement(ReferenciasGM, { detalle: detalle() }));
    expect(h).toContain("2026 fue Niño en invierno: el % de 2027 se escribe sobre 2026 corregido (58,750 u en las mismas tiendas, +8.8 % frente a 2025).");
    expect(h).toContain("El factor del Niño de 2026 es parcial (ene–set)");
    expect(h).toContain("volver a confirmarlo antes de cerrar");
  });

  it("sin Niño material: sin aviso del Niño y con la nota «no material» (ejemplo E)", () => {
    const h = html(createElement(ReferenciasGM, { detalle: detalleSinNino() }));
    expect(h).not.toContain("fue Niño");
    expect(h).toContain("corrección del Niño +0.1 % (no material)");
    expect(h).toContain("una versión aprobada sobre 2026 real sigue valiendo");
  });

  it("en verano, si la base corregida queda por debajo de la real, avisa que 2026 vendió de más (ejemplo C)", () => {
    const d = detalle({ correccion_nino_pct: -10, cierre: cierreEjemploA({ correccion_curva_pct: -10 }) });
    expect(html(createElement(ReferenciasGM, { detalle: d }))).toContain("2026 vendió de más por el Niño");
  });

  it("una referencia de método anterior no muestra cifras y explica qué hacer", () => {
    const d = detalle({ referencias: [referencia(), referenciaMetodoAnterior("aplicado_hoy")], factores_parciales: false, bandas_nino: [], hay_nino: false, cierre: cierreEjemploA({ hay_nino: false }) });
    const h = html(createElement(ReferenciasGM, { detalle: d }));
    expect(h).toContain("recalcula la proyección con 0.14.0 (método anterior)");
    expect(h).toContain("Sin una proyección de 2026 calculada con el método 5");
    expect(h).not.toContain("fue Niño");
  });
});

describe("aprobar", () => {
  const propsBase = { anio: 2027, proyeccionId: null, enTrabajo: null, ocupado: false, error: null, onCerrarError: nada, onAprobar: nada } as const;

  it("precarga «Cierre por curva · corregido» con dos decimales y muestra en vivo el equivalente sobre real y la base en unidades", () => {
    const h = html(createElement(AprobarGM, { detalle: detalleSinAprobar(), ...propsBase }));
    expect(h).toContain("Aprobar 2027");
    expect(h).toContain("% 2027 sobre 2026 corregido");
    expect(h).toContain("Cierre 2026 por curva · corregido (+8.80 %)");
    expect(h).toContain("Cierre 2026 por curva · real (+1.85 %)");
    expect(h).toContain("Año completo 2025 · corregido");
    expect(h).toContain('value="8.80"');
    expect(h).toContain("= +16.22 % sobre 2026 real · base 2027 (tiendas de 2027): 56,100 real / 59,925 corregida → 65,198 u");
    expect(h).toContain("(opcional)");
    expect(h).toContain("Aprobar v1");
    expect(h).toContain("esta será la v1");
    expect(h).not.toContain("sin Niño + rebote");
    expect(botonDeshabilitado(h, "Aprobar v1")).toBe(false);
  });

  it("el % escrito mueve la frase en vivo (8,00 % → +15.36 % sobre real, 64,719 u) y pide nota si se aparta de la base", () => {
    const h = html(createElement(AprobarGM, { detalle: detalleSinAprobar(), ...propsBase, pctTexto: "8" }));
    expect(h).toContain("= +15.36 % sobre 2026 real · base 2027 (tiendas de 2027): 56,100 real / 59,925 corregida → 64,719 u");
    expect(h).toContain("(obligatoria)");
    expect(h).toContain("Tu % se aparta 0.8 puntos de la base");
    expect(botonDeshabilitado(h, "Aprobar v1")).toBe(true);
  });

  it("sin proyección de método 5 la misma frase usa la base por curva y dice «estimado por curva»", () => {
    const d = detalleSinAprobar({ base_siguiente: null, base_corregida: null });
    const h = html(createElement(AprobarGM, { detalle: d, ...propsBase, pctTexto: "8.80" }));
    expect(h).toContain("· estimado por curva");
    expect(h).toContain("56,100 real / 59,925 corregida");
  });

  it("con avance bajo la base por defecto es «Año completo 2025 · corregido»", () => {
    const d = detalleSinAprobar({ cierre: cierreEjemploA({ avance_bajo: true }) });
    const h = html(createElement(AprobarGM, { detalle: d, ...propsBase }));
    expect(h).toContain('value="5.00"');
    expect(h).toMatch(/<option value="anio_completo\|2025\|corregido" selected/);
  });

  it("con vigente ofrece la próxima versión y la muestra «sobre 2026 corregido»", () => {
    const h = html(createElement(AprobarGM, { detalle: detalle(), ...propsBase }));
    expect(h).toContain("Aprobar v3");
    expect(h).toContain("Vigente:");
    expect(h).toContain("8.00 % sobre 2026 corregido");
    expect(h).not.toContain("Recalcula la proyección con 0.14.0 para reaprobar");
    expect(h).not.toContain(">Reaprobar<");
  });

  it("sin ninguna base calculable exige nota y deja el botón deshabilitado", () => {
    const d = detalleSinAprobar({ referencias: [referenciaMetodoAnterior("aplicado_hoy")] });
    const h = html(createElement(AprobarGM, { detalle: d, ...propsBase }));
    expect(h).toContain("(obligatoria)");
    expect(botonDeshabilitado(h, "Aprobar v1")).toBe(true);
    expect(h).toContain("Escribe el crecimiento");
  });

  it("muestra el error del servidor y el bloqueo", () => {
    const h = html(createElement(AprobarGM, { detalle: detalleSinAprobar(), ...propsBase, error: "Los datos cambiaron.", bloqueo: "Espera: se está leyendo la proyección de referencia." }));
    expect(h).toContain("Los datos cambiaron.");
    expect(h).toContain("Espera: se está leyendo la proyección de referencia.");
    expect(botonDeshabilitado(h, "Aprobar v1")).toBe(true);
  });

  it("el obsoleto se explica sin cambiar la vigente", () => {
    const d = detalle({ estado: "obsoleto", motivo_obsoleto: "base_movida" });
    expect(html(createElement(AprobarGM, { detalle: d, ...propsBase }))).toContain("la base elegida se movió");
  });

  it("reaprobar (ejemplo D): alerta con el equivalente a dos decimales y botón; sin proyección, el botón dice qué falta y está deshabilitado", () => {
    const h = html(createElement(AprobarGM, { detalle: detalleParaReaprobar(), ...propsBase }));
    expect(h).toContain("v1 (15.00 % sobre 2026 real) se aprobó antes de 0.14.0.");
    expect(h).toContain("Hoy equivale a 7.66 % sobre 2026 corregido.");
    expect(h).toContain("Reaprobar conserva el total del GM y redistribuye entre sus líneas: suben las de invierno y bajan las demás.");
    expect(h).toContain("bruto · antes de 0.14.0");
    expect(h).toContain(">reaprobar<");
    expect(h).toMatch(/<button[^>]*>Reaprobar<\/button>/);
    expect(botonDeshabilitado(h, "Reaprobar")).toBe(false);
    const sinRef = html(createElement(AprobarGM, { detalle: detalleParaReaprobar({ reaprobar: null }), ...propsBase }));
    expect(sinRef).toContain("Recalcula la proyección con 0.14.0 para reaprobar");
    expect(botonDeshabilitado(sinRef, "Recalcula la proyección con 0.14.0 para reaprobar")).toBe(true);
    // 2027 marcado: ni siquiera se reaprueba
    const atipico = html(createElement(AprobarGM, { detalle: detalleParaReaprobar(), ...propsBase, bloqueo: "2027 está marcado como año del Niño." }));
    expect(botonDeshabilitado(atipico, "Reaprobar")).toBe(true);
  });

  it("una versión bruta en un GM sin Niño material no pide reaprobar (ejemplo E)", () => {
    const h = html(createElement(AprobarGM, { detalle: detalleSinNino(), ...propsBase }));
    expect(h).toContain("bruto · antes de 0.14.0");
    expect(h).not.toContain("Hoy equivale a");
    expect(h).not.toContain(">reaprobar<");
    expect(h).toContain("sin Niño material");
  });
});

describe("versiones", () => {
  it("lista las versiones con «sobre 2026 corregido» o «sobre 2026 real (antes de 0.14.0)», su base, nota, quién y «Ver foto»", () => {
    const h = html(createElement(VersionesGM, { versiones: [versionBruta(), version()], anio: 2027 }));
    expect(h).toContain("Versiones (2)");
    expect(h).toContain("sobre 2026 corregido");
    expect(h).toContain("sobre 2026 real (antes de 0.14.0)");
    expect(h).toContain("bruto · antes de 0.14.0");
    expect(h).toContain("= +15.36 % sobre 2026 real");
    expect(h).toContain("8.00");
    expect(h).toContain("15.00");
    expect(h).toContain("vigente");
    expect(h).toContain("Cierre por curva · corregido · +8.8 %");
    expect(h).toContain("Acumulado · sin Niño + rebote · +18.4 %");
    expect(h).toContain("Javier");
    expect(h).toContain("Ver foto");
    expect(html(createElement(VersionesGM, { versiones: [], anio: 2027 }))).toContain("Todavía no hay versiones aprobadas");
  });

  it("la foto muestra lo que vio el planner, con el cierre por agrupación y los factores con su origen", () => {
    const referenciaFoto = {
      metodo: 5,
      sobre_base: "corregida",
      cierre_por_agrupacion: [{ nombre: "ABRIGOS HO", curva_id: "c1", curva_version: 3, avance: 0.8, cierre: 15000, cierre_corregido: 18750 }],
      factores: [{ anio: 2026, temporada: "invierno", efectivo: 0.8, origen: "aplicado", formula: "relativo_periodo", parcial: true }],
      tienda_mayor: { codigo: "T07" },
    };
    const h = html(createElement(FotoVersionGM, { version: { ...version(), referencia: referenciaFoto }, anio: 2027, onCerrar: nada }));
    expect(h).toContain("Foto de la v2");
    expect(h).toContain("8.00 % sobre 2026 corregido");
    expect(h).toContain("Cifras que se vieron al aprobar");
    expect(h).toContain("Cierre · ABRIGOS HO");
    expect(h).toContain("Factor · invierno 2026");
    expect(h).toContain("escrito por Javier");
    expect(h).toContain("T07");
    expect(html(createElement(FotoVersionGM, { version: version(), onCerrar: nada }))).toContain("no trae el detalle");
  });
});

describe("detalle completo", () => {
  it("HOMBRE · URBANO: curva con las líneas nuevas, cómo se cierra, cómo crece, aprobar y versiones", () => {
    const h = html(vistaEl());
    expect(h).toContain("← Género × mundo");
    expect(h).toContain("HOMBRE · URBANO");
    expect(h).toContain("Curva de venta");
    expect(h).toContain("Mismas tiendas de 2026: 9 tiendas (abiertas todo 2025 y ene–set 2026).");
    expect(h).toContain("2026 corregido (sin Niño)");
    expect(h).toContain("2027 vista previa (8.80 %)");
    expect(h).toContain("Cómo se cierra 2026");
    expect(h).toContain("Cómo crece");
    expect(h).toContain("Aprobar 2027");
    expect(h).toContain("Versiones (2)");
    expect(h).toContain("1 tienda con venta quedó fuera de la comparación");
    expect(h).toContain("Aprobado:");
    expect(h).toContain("8.00 % sobre 2026 corregido");
    expect(h).not.toContain("está marcado como año del Niño");
  });

  it("2027 marcado como Niño: alerta y aprobar bloqueado con el mensaje de la ficha", () => {
    const h = html(vistaEl({ detalle: detalleSinAprobar(), anioSiguienteAtipico: { meses: ["2027-03"] } }));
    expect(h).toContain("2027 está marcado como año del Niño en Curvas → Periodos atípicos.");
    expect(h).toContain("Aprobar está deshabilitado");
    expect(botonDeshabilitado(h, "Aprobar v1")).toBe(true);
  });

  it("el detalle de un GM con vigente bruta y Niño ofrece «Reaprobar» y el obsoleto por método anterior", () => {
    const h = html(vistaEl({ detalle: detalleParaReaprobar() }));
    expect(h).toContain("Hoy equivale a 7.66 % sobre 2026 corregido.");
    expect(h).toContain("Obsoleto: se aprobó sobre 2026 real, antes de 0.14.0");
    expect(h).toContain("Se aprobó antes de 0.14.0.");
  });

  it("el Resto se aprueba y explica qué suma", () => {
    const d = detalleSinAprobar({ clave: "resto", genero: null, mundo: null });
    const h = html(vistaEl({ detalle: d }));
    expect(h).toContain("Resto");
    expect(h).toContain("distintos de HOMBRE y MUJER");
    expect(h).toContain("Aprobar 2027");
  });

  it("un género que sigue al Resto se analiza pero no se aprueba", () => {
    const d = detalleSinAprobar({ clave: CLAVE_NINO_URBANO, genero: "NIÑO", mundo: "URBANO", detallable: false });
    const h = html(vistaEl({ detalle: d }));
    expect(h).toContain("NIÑO · URBANO");
    expect(h).toContain("sigue al <strong>Resto</strong>");
    expect(h).toContain("Ir al Resto");
    expect(h).not.toContain("Aprobar v1");
    expect(h).toContain("Curva de venta");
  });

  it("muestra el éxito, los avisos del servidor y el obsoleto", () => {
    const d = detalle({ avisos: [{ codigo: "sin_factor", mensaje: "El verano de 2023 no tiene factor.", detalle: ["Se usó 1,00."] }], estado: "obsoleto", motivo_obsoleto: "composicion" });
    const h = html(vistaEl({ detalle: d, exito: "HOMBRE · URBANO: aprobada la v3 (8.00 % sobre 2026 corregido) para 2027. Recalcula la proyección y sigue en Por línea." }));
    expect(h).toContain("aprobada la v3");
    expect(h).toContain("Recalcula la proyección y sigue en Por línea");
    expect(h).toContain("El verano de 2023 no tiene factor.");
    expect(h).toContain("Se usó 1,00.");
    expect(h).toContain("algún nodo salió de este género × mundo");
  });

  it("un detalle de una API sin los campos de 0.14.0 no lanza (cierre, series y factores ausentes)", () => {
    const d = detalle({
      cierre: undefined,
      hay_nino: undefined,
      base_corregida: undefined,
      cierre_por_agrupacion: undefined,
      serie_corregida: undefined,
      serie_base_curva: undefined,
      factores_y: undefined,
      diagnostico_verano_gm: undefined,
      cierre_proyeccion: undefined,
      reaprobar: undefined,
    });
    const h = html(vistaEl({ detalle: d }));
    expect(h).toContain("Todavía no hay cierre por curva");
    expect(h).toContain("Aprobar 2027");
    expect(h).not.toContain("2027 vista previa (");
  });
});

describe("contenedores (sin efectos en el render del servidor)", () => {
  it("el detalle y la pestaña se montan cargando sin lanzar", () => {
    const h = html(createElement(DetalleGM, { clave: CLAVE_HOMBRE_URBANO, anioUrl: 2027, proyeccionUrl: null, proyeccionId: null, enTrabajo: null, referenciaCargando: false, onVolver: nada, onIrAResto: nada, onCambio: nada }));
    expect(h).toContain("← Género × mundo");
    expect(h).toContain("Cargando");
    const t = html(createElement(GeneroMundoTab, { gm: null, anioUrl: null, proyeccionUrl: null, onIr: nada }));
    expect(t).toContain("Cargando");
    const t2 = html(createElement(GeneroMundoTab, { gm: "resto", anioUrl: 2027, proyeccionUrl: null, onIr: nada }));
    expect(t2).toContain("Resto");
  });
});
