import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DetalleGM, DetalleGMVista } from "../src/app/(app)/planificacion/curvas-estacionalidad/genero-mundo/detalle-gm";
import { AprobarGM } from "../src/app/(app)/planificacion/curvas-estacionalidad/genero-mundo/aprobar-gm";
import { GeneroMundoTab } from "../src/app/(app)/planificacion/curvas-estacionalidad/genero-mundo/genero-mundo-tab";
import { GraficoGM } from "../src/app/(app)/planificacion/curvas-estacionalidad/genero-mundo/grafico-gm";
import { ListaGM } from "../src/app/(app)/planificacion/curvas-estacionalidad/genero-mundo/lista-gm";
import { ReferenciasGM } from "../src/app/(app)/planificacion/curvas-estacionalidad/genero-mundo/referencias-gm";
import { TablaGM } from "../src/app/(app)/planificacion/curvas-estacionalidad/genero-mundo/tabla-gm";
import { FotoVersionGM, VersionesGM } from "../src/app/(app)/planificacion/curvas-estacionalidad/genero-mundo/versiones-gm";
import {
  CLAVE_HOMBRE_URBANO,
  CLAVE_NINO_URBANO,
  detalle,
  detalleSinAprobar,
  lista,
  referencia,
  referenciaMetodoAnterior,
  referenciasEjemplo,
  version,
} from "./crecimientos.pantalla.fixture";

/** Humo de render con datos sintéticos: ningún componente de la pestaña debe lanzar y los textos clave de la ficha deben salir. */

const nada = () => {};
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

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

describe("lista", () => {
  it("cabecera, filtros, filas, Resto y Total", () => {
    const h = html(listaEl());
    expect(h).toContain("Crecimiento por género × mundo");
    expect(h).toContain("Año de aplicación");
    expect(h).toContain("% bruto 2027 frente a 2026 de las mismas tiendas de 2027, sin corregir por el Niño");
    expect(h).toContain("HOMBRE · URBANO");
    expect(h).toContain("Aprobado v2");
    expect(h).toContain("Sin aprobar");
    expect(h).toContain("Obsoleto");
    expect(h).toContain("mundo desactivado");
    expect(h).toContain("sigue al Resto");
    expect(h).toContain("extremo");
    expect(h).toContain("frágil");
    expect(h).toContain("Resto");
    expect(h).toContain("Total ponderado");
    expect(h).toContain("3 GM sin aprobar siguen al Resto");
    expect(h).toContain("12.3 %");
    expect(h).toContain("Descargar CSV");
    expect(h).toContain("Trabajar");
    expect(h).not.toContain("No hay proyección de 2026 calculada");
  });

  it("sin proyección de referencia válida avisa y muestra «—» en el Total", () => {
    const h = html(listaEl({ lista: lista({ proyeccion_referencia: null, proyecciones_disponibles: [], total: { pct_ponderado: null, base: 0, sin_aprobar: 4 } }) }));
    expect(h).toContain("No hay proyección de 2026 calculada con el método actual");
    expect(h).toContain("Ninguna disponible");
  });

  it("la referencia de método anterior se ve como «recalcula la proyección»", () => {
    const fila = lista().filas[1];
    const l = lista({ filas: [{ ...fila, aplicado_hoy: referenciaMetodoAnterior("aplicado_hoy") }] });
    expect(html(listaEl({ lista: l }))).toContain("recalcula la proyección (método anterior)");
  });

  it("cargando y vacío", () => {
    expect(html(listaEl({ lista: null, cargando: true }))).toContain("Cargando");
    expect(html(listaEl({ lista: null, cargando: false }))).toContain("No se pudo cargar");
    expect(html(listaEl({ estado: "obsoleto", genero: "MUJER" }))).toContain("Ningún género × mundo coincide");
  });
});

describe("curva de venta", () => {
  const d = detalle();

  it("gráfico: modos, leyenda por año, bandas del Niño con factor parcial", () => {
    const h = html(createElement(GraficoGM, { detalle: d, modo: "unidades", onModo: nada, idTabla: "t" }));
    expect(h).toContain("Unidades");
    expect(h).toContain("Forma (%)");
    expect(h).toContain("Sin Niño");
    expect(h).toContain("2023");
    expect(h).toContain("2026 real (ene–set)");
    expect(h).toContain("2026 proyectado");
    expect(h).toContain("factor parcial (ene–set)");
    expect(h).toContain("Niño 2023 · verano");
    expect(h).toContain("<svg");
    expect(html(createElement(GraficoGM, { detalle: d, modo: "forma", onModo: nada, idTabla: "t" }))).toContain("Forma típica");
    expect(html(createElement(GraficoGM, { detalle: d, modo: "sin_nino", onModo: nada, idTabla: "t" }))).toContain("con el efecto del Niño quitado");
  });

  it("gráfico sin series no lanza", () => {
    const h = html(createElement(GraficoGM, { detalle: { ...d, series: [], bandas_nino: [], forma_tipica: null }, modo: "forma", onModo: nada, idTabla: "t" }));
    expect(h).toContain("ninguna serie");
  });

  it("tabla año × mes: totales, variación y CSV", () => {
    const h = html(createElement(TablaGM, { id: "t", detalle: d, modo: "unidades", nombreArchivo: "x.csv" }));
    expect(h).toContain("Descargar CSV");
    expect(h).toContain("Var. año anterior");
    expect(h).toContain("con meses proyectados");
    expect(h).toContain("2026");
    expect(h).toContain("italic");
    const forma = html(createElement(TablaGM, { id: "t", detalle: d, modo: "forma", nombreArchivo: "x.csv" }));
    expect(forma).toContain("Forma típica");
    expect(forma).toContain("100 %");
    expect(html(createElement(TablaGM, { id: "t", detalle: { ...d, series: [] }, modo: "unidades", nombreArchivo: "x.csv" }))).toContain("no tiene venta comparable");
  });
});

describe("cómo crece", () => {
  it("las cuatro referencias con extremo, tienda mayor, cobertura y avisos del Niño y del factor parcial", () => {
    const d = detalle({ referencias: [referencia({ extremo: true, fragil: true }), ...referenciasEjemplo().slice(1)] });
    const h = html(createElement(ReferenciasGM, { detalle: d }));
    expect(h).toContain("Acumulado ene–set 2026");
    expect(h).toContain("Cierre proyectado 2026");
    expect(h).toContain("Año completo 2025");
    expect(h).toContain("Aplicado hoy");
    expect(h).toContain("+18.4 %");
    expect(h).toContain("extremo");
    expect(h).toContain("frágil");
    expect(h).toContain("T07 aporta el 38.5 % de 2025; sin ella, +1.2 %");
    expect(h).toContain("ene–set es el 74 % del año 2025");
    expect(h).toContain("2026 fue Niño en invierno: compara con las cifras sin Niño + rebote");
    expect(h).toContain("El factor del Niño de 2026 es parcial (ene–set)");
    expect(h).toContain("Equivalente para 2027");
  });

  it("una referencia de método anterior no muestra cifras y explica qué hacer", () => {
    const d = detalle({ referencias: [referencia(), referenciaMetodoAnterior("cierre_proyectado"), referenciaMetodoAnterior("aplicado_hoy")], rebote_nino_pct: null, factores_parciales: false, bandas_nino: [] });
    const h = html(createElement(ReferenciasGM, { detalle: d }));
    expect(h).toContain("recalcula la proyección (método anterior)");
    expect(h).toContain("Sin una proyección de 2026 calculada con el método actual");
    expect(h).not.toContain("fue Niño");
  });
});

describe("aprobar", () => {
  const propsBase = { anio: 2027, proyeccionId: null, enTrabajo: null, ocupado: false, error: null, onCerrarError: nada, onAprobar: nada } as const;

  it("precarga la base y el %: la nota es opcional con el valor precargado", () => {
    const h = html(createElement(AprobarGM, { detalle: detalleSinAprobar(), ...propsBase }));
    expect(h).toContain("Aprobar 2027");
    expect(h).toContain("Base");
    expect(h).toContain("Acumulado ene–set 2026 · sin Niño + rebote");
    expect(h).toContain('value="18.4"');
    expect(h).toContain("Equivale a +10.6 %");
    expect(h).toContain("sobre la base normalizada por el Niño");
    expect(h).toContain("(opcional)");
    expect(h).toContain("Aprobar v1");
    expect(h).toContain("esta será la v1");
    expect(h).not.toMatch(/<button[^>]*disabled=""[^>]*>Aprobar v1/);
  });

  it("con vigente ofrece la próxima versión y muestra la vigente", () => {
    const h = html(createElement(AprobarGM, { detalle: detalle(), ...propsBase }));
    expect(h).toContain("Aprobar v3");
    expect(h).toContain("Vigente:");
    expect(h).toContain("v2");
  });

  it("sin ninguna base calculable exige nota y deja el botón deshabilitado", () => {
    const d = detalleSinAprobar({ referencias: [referenciaMetodoAnterior("cierre_proyectado")] });
    const h = html(createElement(AprobarGM, { detalle: d, ...propsBase }));
    expect(h).toContain("(obligatoria)");
    expect(h).toMatch(/<button[^>]*disabled=""[^>]*>Aprobar v1/);
    expect(h).toContain("Escribe el crecimiento");
  });

  it("muestra el error del servidor y el bloqueo", () => {
    const h = html(createElement(AprobarGM, { detalle: detalleSinAprobar(), ...propsBase, error: "Los datos cambiaron.", bloqueo: "Espera: se está leyendo la proyección de referencia." }));
    expect(h).toContain("Los datos cambiaron.");
    expect(h).toContain("Espera: se está leyendo la proyección de referencia.");
    expect(h).toMatch(/<button[^>]*disabled=""[^>]*>Aprobar v1/);
  });

  it("el obsoleto se explica sin cambiar la vigente", () => {
    const d = detalle({ estado: "obsoleto", motivo_obsoleto: "base_movida" });
    expect(html(createElement(AprobarGM, { detalle: d, ...propsBase }))).toContain("la base elegida se movió");
  });
});

describe("versiones", () => {
  it("lista las versiones con su base, nota, quién y «Ver foto»", () => {
    const h = html(createElement(VersionesGM, { versiones: detalle().versiones, anio: 2027 }));
    expect(h).toContain("Versiones (2)");
    expect(h).toContain("v2");
    expect(h).toContain("v1");
    expect(h).toContain("reemplazada");
    expect(h).toContain("Acumulado · sin Niño + rebote · +18.4 %");
    expect(h).toContain("sin base");
    expect(h).toContain("Javier");
    expect(h).toContain("Ver foto");
    expect(html(createElement(VersionesGM, { versiones: [], anio: 2027 }))).toContain("Todavía no hay versiones aprobadas");
  });

  it("la foto muestra lo que vio el planner si el servidor la manda", () => {
    const h = html(createElement(FotoVersionGM, { version: { ...version(), referencia: { bruto: 3, tienda_mayor: { codigo: "T07" } } }, onCerrar: nada }));
    expect(h).toContain("Foto de la v2");
    expect(h).toContain("Cifras que se vieron al aprobar");
    expect(h).toContain("T07");
    expect(html(createElement(FotoVersionGM, { version: version(), onCerrar: nada }))).toContain("no trae el detalle");
  });
});

describe("detalle completo", () => {
  it("HOMBRE · URBANO: curva, cómo crece, aprobar y versiones", () => {
    const h = html(vistaEl());
    expect(h).toContain("← Género × mundo");
    expect(h).toContain("HOMBRE · URBANO");
    expect(h).toContain("Curva de venta");
    expect(h).toContain("Mismas tiendas de 2026: 9 tiendas (abiertas todo 2025 y ene–set 2026).");
    expect(h).toContain("Cómo crece");
    expect(h).toContain("Aprobar 2027");
    expect(h).toContain("Versiones (2)");
    expect(h).toContain("1 tienda con venta quedó fuera de la comparación");
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
    const h = html(vistaEl({ detalle: d, exito: "HOMBRE · URBANO: aprobada la v3 (15.0 %) para 2027." }));
    expect(h).toContain("aprobada la v3");
    expect(h).toContain("El verano de 2023 no tiene factor.");
    expect(h).toContain("Se usó 1,00.");
    expect(h).toContain("algún nodo salió de este género × mundo");
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
