import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CabeceraProyeccion } from "../src/app/(app)/planificacion/proyeccion/cabecera-proyeccion";
import { CerrarModal } from "../src/app/(app)/planificacion/proyeccion/cerrar-modal";
import { CrecimientosTab, ResumenCrecimientos, TablaResumenCrecimientos } from "../src/app/(app)/planificacion/proyeccion/crecimientos-tab";
import { FormularioProyeccion } from "../src/app/(app)/planificacion/proyeccion/formulario-proyeccion";
import { PieMatriz, TablaMatriz } from "../src/app/(app)/planificacion/proyeccion/matriz-tab";
import { PESTANAS } from "../src/app/(app)/planificacion/proyeccion/vista";
import type { ProyeccionApi } from "../src/lib/proyeccion/tipos-api";
import { bloques, proyeccion, respuestaMatriz, respuestaProyeccion } from "./proyeccion.pantalla.fixture";
import { resumenAlDia, resumenCrecimientos } from "./proyeccion.crecimientos-pantalla.fixture";

/** Humo de render de la pestaña Crecimientos de solo lectura (06d): ningún componente lanza y los textos clave de la ficha salen. */

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const noop = () => {};
/** El atributo `disabled` del botón (no la clase `disabled:` de Tailwind). */
const deshabilitado = (tag: string | undefined) => /\sdisabled(=""|\s|>)/.test(tag ?? "");
const boton = (s: string, texto: string) => new RegExp(`<button[^>]*>${texto}</button>`).exec(s)?.[0];
const RAIZ = path.resolve(__dirname, "..");
const DIR = "src/app/(app)/planificacion/proyeccion/";
const fuente = (f: string) => readFileSync(path.join(RAIZ, DIR, f), "utf8");

const SIN_APROBAR = { faltan: [{ clave: "g.m", nombre: "MUJER · CASUAL" }], resto_provisional: true };
const conCambio = () => proyeccion({ desactualizada: [{ codigo: "crecimientos_cambiados", mensaje: "x" }] });

const resumen = (datos = resumenCrecimientos(), p: ProyeccionApi = conCambio(), extra: Partial<Parameters<typeof ResumenCrecimientos>[0]> = {}) =>
  html(createElement(ResumenCrecimientos, { datos, proyeccion: p, bloqueada: false, onRecalcular: noop, onRecargar: noop, onObjetivoGuardado: () => Promise.resolve(), ...extra }));

describe("la tabla de solo lectura", () => {
  const datos = resumenCrecimientos();
  const s = html(createElement(TablaResumenCrecimientos, { datos }));

  it("una fila por GM, el Resto y el Total, con el % aplicado (versión, quién y cuándo) y lo vigente hoy", () => {
    for (const n of ["HOMBRE · FORMAL", "HOMBRE · URBANO", "MUJER · FORMAL", "MUJER · CASUAL", "Resto", "Total (mismas tiendas)"]) expect(s).toContain(n);
    expect(s).toContain("20 % · v1");
    expect(s).toContain("Javier · ");
    expect(s).toContain("10 % · v1");
    expect(s).toContain("15 % · v2");
    expect(s).toContain("sin aprobar");
    // El Resto provisional lleva su badge y no tiene quién ni cuándo.
    expect(s).toContain(">provisional<");
    expect(s).toContain("5 % · provisional");
  });

  it("«cambió» solo en el GM cuyo vigente de hoy difiere de lo aplicado", () => {
    expect(s.match(/>cambió</g)).toHaveLength(1);
    expect(html(createElement(TablaResumenCrecimientos, { datos: resumenAlDia() }))).not.toContain(">cambió<");
  });

  it("base, resultante, % resultante, rebote del Niño y el desglose del Resto", () => {
    expect(s).toContain("17,800");
    expect(s).toContain("19,485");
    expect(s).toContain("+9.5 %");
    expect(s).toContain("120,000");
    expect(s).toContain("+9.6 %");
    expect(s).toContain("JOVENCITOS 8,200 · NIÑOS 6,100 · ACCESORIOS 5,700");
    expect(s).toContain("Rebote del Niño");
  });

  it("badges informativos sin acción: «1 con % propio» y «1 decidida», con el título de dónde se cambian", () => {
    expect(s).toContain(">1 con % propio<");
    expect(s).toContain(">1 decidida<");
    expect(s).toContain("Se cambian fila a fila en Por línea: vacía «Crec.» o usa «Volver a la propuesta»");
  });

  it("cada GM y el Resto traen «Analizar y aprobar» con el enlace de la API; el Total no", () => {
    expect(s.match(/>Analizar y aprobar</g)).toHaveLength(5);
    expect(s).toContain('href="/planificacion/curvas-estacionalidad?gm=g-hombre.m-urbano&amp;anio=2027&amp;proyeccion=proy-1"');
    expect(s).toContain("gm=resto");
  });

  it("no tiene campos ni botones: solo lectura, con scroll horizontal y solo tokens del tema", () => {
    expect(s).not.toContain("<input");
    expect(s).not.toContain("<button");
    expect(s).toContain("overflow-x-auto");
    expect(s).not.toMatch(/#[0-9a-fA-F]{3,6}|\b(bg|text|border)-(red|green|blue|gray|slate|white|black)-?\d*/);
  });
});

describe("el resumen de la pestaña", () => {
  it("avisa que lo aprobado cambió, con la lista y Recalcular", () => {
    const s = resumen();
    expect(s).toContain("Los crecimientos aprobados cambiaron después de calcular: HOMBRE · URBANO v1 → v2 (10 % → 15 %). Recalcula.");
    expect(s).toContain(">Recalcular</button>");
    expect(deshabilitado(boton(s, "Recalcular"))).toBe(false);
  });

  it("avisa que no se puede cerrar y manda a Crecimiento por género × mundo con el año y la proyección", () => {
    const s = resumen();
    expect(s).toContain("No se puede cerrar: falta 1 crecimiento aprobado para 2027 y el Resto es provisional.");
    expect(s).toContain("Ir a Crecimiento por género × mundo");
    expect(s).toContain('href="/planificacion/curvas-estacionalidad?pestana=genero-mundo&amp;anio=2027&amp;proyeccion=proy-1"');
    const alDia = resumen(resumenAlDia(), proyeccion());
    expect(alDia).not.toContain("No se puede cerrar");
    expect(alDia).not.toContain("cambiaron después de calcular");
  });

  it("cabecera, puente al Total 2027 y objetivo global", () => {
    const s = resumen();
    expect(s).toContain("Crecimiento bruto 2027 frente a 2026 de las mismas tiendas de 2027");
    expect(s).toContain("Puente al Total 2027 de la Matriz");
    expect(s).toContain("130,099 u");
    expect(s).toContain("Objetivo global (%)");
    expect(s).toContain("Objetivo +12.0 % → con lo aplicado te faltan 2.8 pp");
    expect(s).toContain("llevan el total de +9.2 % a +7.7 %");
  });

  it("ya no existe nada de la matriz editable: ni «Guardar y recalcular», ni «Calcular promedio», ni el Modal del choque", () => {
    const s = resumen();
    for (const t of ["Guardar y recalcular", "Calcular promedio", "Descartar cambios", "Pisar", "Conservar", "Cancelar", "Resto (%)"]) expect(s).not.toContain(t);
    expect(s).not.toContain('aria-label="Crecimiento bruto de');
    expect(s).not.toContain("required");
  });

  it("en trabajo, el objetivo se edita con «Guardar objetivo», deshabilitado mientras no cambie", () => {
    const s = resumen();
    expect(s).toContain("Guardar objetivo");
    expect(deshabilitado(boton(s, "Guardar objetivo"))).toBe(true);
    expect(deshabilitado(/<input[^>]*inputMode="decimal"[^>]*>/.exec(s)?.[0])).toBe(false);
  });

  it("cerrada o archivada: todo igual y el objetivo en solo lectura, sin avisos de cierre ni Recalcular", () => {
    const s = resumen(resumenCrecimientos(), proyeccion({ estado: "cerrada" }));
    expect(s).toContain("HOMBRE · URBANO");
    expect(s).toContain("Objetivo global (%)");
    expect(s).not.toContain("Guardar objetivo");
    expect(deshabilitado(/<input[^>]*inputMode="decimal"[^>]*>/.exec(s)?.[0])).toBe(true);
    expect(s).toContain("solo lectura");
    expect(s).not.toContain("No se puede cerrar");
    expect(s).not.toContain(">Recalcular</button>");
    const arch = resumen(resumenCrecimientos(), proyeccion({ estado: "archivada" }));
    expect(arch).not.toContain("Guardar objetivo");
  });

  it("mientras la pantalla calcula (bloqueada) el objetivo y Recalcular no se pueden tocar", () => {
    const s = resumen(resumenCrecimientos(), conCambio(), { bloqueada: true });
    expect(s).not.toContain("Guardar objetivo");
    expect(deshabilitado(boton(s, "Recalcular"))).toBe(true);
  });

  it("proyección de método anterior: solo el aviso «recalcúlala» (con Recalcular en trabajo); cerrada, solo lectura", () => {
    const vieja = resumenCrecimientos({ version_metodo: 3, total: null, sin_aprobar: null, cambiados: [] });
    const s = resumen(vieja, proyeccion());
    expect(s).toContain("Esta proyección se calculó con un método anterior: recalcúlala para ver sus crecimientos.");
    expect(s).toContain(">Recalcular</button>");
    expect(s).not.toContain("<table");
    const cerrada = resumen(vieja, proyeccion({ estado: "cerrada" }));
    expect(cerrada).toContain("método anterior");
    expect(cerrada).not.toContain("recalcúlala");
    expect(cerrada).not.toContain(">Recalcular</button>");
    expect(resumen(resumenCrecimientos({ version_metodo: null, total: null }), proyeccion())).toContain("método anterior");
  });

  it("sin Total no hay pie de puente ni objetivo", () => {
    const s = resumen(resumenCrecimientos({ total: null }));
    expect(s).not.toContain("Puente al Total");
    expect(s).not.toContain("Objetivo global");
  });

  it("la pestaña, antes de leer, muestra la carga (los datos vienen de /api)", () => {
    const s = html(createElement(CrecimientosTab, { proyeccion: proyeccion(), bloqueada: false, onCambio: () => Promise.resolve(), onRecalcular: noop }));
    expect(s).toContain("Leyendo los crecimientos…");
  });
});

describe("Cabecera y modal de cierre: crecimientos sin aprobar (06d §4.3)", () => {
  const cabecera = (p: ProyeccionApi) =>
    html(createElement(CabeceraProyeccion, { proyeccion: p, calculandoLocal: false, ocupado: false, onRecalcular: noop, onParametros: noop, onCerrar: noop, onArchivar: noop, onEliminar: noop, onCopiar: noop }));

  it("«Cerrar proyección» se deshabilita con el título del motivo y el enlace a Crecimiento por género × mundo", () => {
    const s = cabecera(proyeccion({ crecimientos_sin_aprobar: SIN_APROBAR }));
    expect(deshabilitado(boton(s, "Cerrar proyección"))).toBe(true);
    expect(boton(s, "Cerrar proyección")).toContain("No se puede cerrar: falta 1 crecimiento aprobado para 2027 y el Resto es provisional.");
    expect(s).toContain("Ir a Crecimiento por género × mundo");
    expect(s).toContain('href="/planificacion/curvas-estacionalidad?pestana=genero-mundo&amp;anio=2027&amp;proyeccion=proy-1"');
  });

  it("con todo aprobado (o sin la clave) el botón está habilitado y no hay enlace", () => {
    for (const p of [proyeccion({ crecimientos_sin_aprobar: null }), proyeccion()]) {
      const s = cabecera(p);
      expect(deshabilitado(boton(s, "Cerrar proyección"))).toBe(false);
      expect(s).not.toContain("Ir a Crecimiento por género × mundo");
    }
  });

  it("una cerrada no muestra el motivo aunque la clave venga", () => {
    const s = cabecera(proyeccion({ estado: "cerrada", crecimientos_sin_aprobar: SIN_APROBAR }));
    expect(s).not.toContain("Ir a Crecimiento por género × mundo");
  });

  const modal = (p: ProyeccionApi) => html(createElement(CerrarModal, { proyeccion: p, onCerrar: noop, onCerrada: noop, onRecalcular: noop }));

  it("cerrar con crecimientos sin aprobar: lista los GM faltantes, no ofrece «Cerrar de todos modos» y deshabilita Cerrar", () => {
    const s = modal(proyeccion({ crecimientos_sin_aprobar: { faltan: [{ clave: "a", nombre: "HOMBRE · URBANO" }, { clave: "b", nombre: "MUJER · RI" }], resto_provisional: true } }));
    expect(s).toContain("faltan crecimientos aprobados");
    expect(s).toContain("Faltan 2 crecimientos aprobados para 2027 (HOMBRE · URBANO, MUJER · RI) y el Resto es provisional");
    expect(s).toContain("<li>HOMBRE · URBANO</li>");
    expect(s).toContain("<li>Resto (provisional)</li>");
    expect(s).toContain("Curvas de estacionalidad → Crecimiento por género × mundo");
    expect(s).toContain("Este motivo no se puede saltar");
    expect(s).not.toContain("Cerrar de todos modos");
    expect(deshabilitado(boton(s, "Cerrar proyección"))).toBe(true);
    expect(s).toContain("pestana=genero-mundo");
  });

  it("también con el motivo en la lista de desactualizada: no se puede forzar", () => {
    const s = modal(proyeccion({ desactualizada: [{ codigo: "crecimientos_sin_aprobar", mensaje: "faltan" }], crecimientos_sin_aprobar: SIN_APROBAR }));
    expect(s).not.toContain("Cerrar de todos modos");
    expect(s).toContain("este motivo no se puede saltar");
  });

  it("crecimientos_cambiados y version_metodo siguen sin poder forzarse y ofrecen recalcular", () => {
    const s = modal(conCambio());
    expect(s).toContain("este motivo no se puede saltar");
    expect(s).not.toContain("Cerrar de todos modos");
    expect(s).toContain("Recalcular ahora");
  });

  it("sin faltantes y con otro motivo (cargas nuevas) sí se puede cerrar de todos modos", () => {
    const s = modal(proyeccion({ desactualizada: [{ codigo: "cargas_nuevas", mensaje: "x" }] }));
    expect(s).toContain("Cerrar de todos modos");
    expect(s).not.toContain("faltan crecimientos aprobados");
    expect(deshabilitado(boton(s, "Cerrar proyección"))).toBe(true); // desactualizada y sin tildar «Cerrar de todos modos»
    expect(deshabilitado(boton(modal(proyeccion()), "Cerrar proyección"))).toBe(false);
  });
});

describe("Nueva proyección y Parámetros: el Resto provisional", () => {
  const estado = respuestaProyeccion();

  it("al crear, el campo es «Resto provisional (%)» y su ayuda dice que solo se usa sin un Resto aprobado", () => {
    const s = html(createElement(FormularioProyeccion, { estado, bloques: bloques(), perfiles: [], onCerrar: noop, onGuardada: noop }));
    expect(s).toContain("Resto provisional (%)");
    expect(s).toContain("Se usa solo mientras no haya un Resto aprobado para 2027");
    expect(s).not.toContain("Crecimiento bruto del año siguiente (Resto) (%)");
    expect(s).not.toContain("matriz de crecimientos");
    expect(s).toContain("los crecimientos salen de los aprobados en Curvas de estacionalidad");
  });

  it("si una proyección del año ya aplicó un Resto aprobado, la ayuda lo dice", () => {
    const base = proyeccion();
    const conResto = proyeccion({ parametros: { ...base.parametros, crecimiento_resto_usado: { pct: 5, crecimiento_id: "c-1", version: 1, por_nombre: "Javier", at: "2026-10-20T00:00:00Z" } } });
    const s = html(createElement(FormularioProyeccion, { estado: respuestaProyeccion({ proyecciones: [conResto] }), bloques: bloques(), perfiles: [], onCerrar: noop, onGuardada: noop }));
    expect(s).toContain("Resto aprobado para 2027");
    expect(s).toContain("5 % (v1)");
  });

  it("al editar no hay campo: muestra el Resto de la foto con su origen y el enlace a la pestaña", () => {
    const base = proyeccion();
    const aprobada = proyeccion({ parametros: { ...base.parametros, crecimiento_resto_usado: { pct: 5, crecimiento_id: "c-1", version: 1, por_nombre: "Javier", at: "2026-10-20T00:00:00Z" } } });
    const edit = html(createElement(FormularioProyeccion, { estado, proyeccion: aprobada, bloques: bloques(), perfiles: [], onCerrar: noop, onGuardada: noop, onIrACrecimientos: noop }));
    expect(edit).not.toContain("Resto provisional (%)");
    expect(edit).toContain("5 % · Resto v1 (aprobado)");
    expect(edit).toContain("El Resto provisional solo se fija al crear la proyección");
    expect(edit).toContain("Curvas de estacionalidad → Crecimiento por género × mundo");
    expect(edit).toContain("Ver los crecimientos");
    const prov = html(createElement(FormularioProyeccion, { estado, proyeccion: proyeccion(), bloques: bloques(), perfiles: [], onCerrar: noop, onGuardada: noop }));
    expect(prov).toContain("0 % · Resto provisional");
  });
});

describe("Matriz (Parte 2): columna «Crec. mismas tiendas»", () => {
  const datos = respuestaMatriz();
  const s = html(createElement(TablaMatriz, { datos, proyeccion: proyeccion(), porMarca: false, plegados: new Set<string>(), onAlternar: noop, onIrALinea: noop, onIrATiendas: noop }));

  it("va junto a «Var.» con su título que explica la diferencia y de dónde sale el %", () => {
    expect(s).toContain("Crec. mismas tiendas");
    expect(s.indexOf("Var.")).toBeLessThan(s.indexOf("Crec. mismas tiendas"));
    expect(s).toContain("Var. = Total 2027 ÷ Total 2026 (incluye tiendas nuevas, aperturas y cierres).");
    expect(s).toContain("Crec. mismas tiendas = 2027 de las mismas tiendas ÷ su 2026: es el % aprobado en Curvas → Crecimiento por género × mundo (o el % propio de la fila).");
    expect(s).not.toContain("es lo que escribes en Crecimientos");
    expect(s).toContain("+9.8 %");
  });

  it("el pie sigue mostrando las líneas y las filas para revisión", () => {
    expect(html(createElement(PieMatriz, { resumen: datos.resumen, anioEnCurso: 2026, solo: "", onVerRevision: noop }))).toContain("filas para revisión");
  });
});

describe("el resto de la pantalla (06d)", () => {
  it("«Crecimientos» va entre «Tiendas nuevas y cierres» y «Por línea»", () => {
    const ids = PESTANAS.map((p) => p.id);
    expect(ids.indexOf("crecimientos")).toBe(ids.indexOf("tiendas") + 1);
    expect(ids.indexOf("linea")).toBe(ids.indexOf("crecimientos") + 1);
    expect(PESTANAS.find((p) => p.id === "crecimientos")?.etiqueta).toBe("Crecimientos");
  });
});

describe("estructura de la pestaña Crecimientos", () => {
  it("es de solo lectura: no hay PUT ni POST, el modal del choque se borró y el único `PATCH` es el del objetivo", () => {
    const c = fuente("crecimientos-tab.tsx");
    expect(c.startsWith('"use client"')).toBe(true);
    expect(existsSync(path.join(RAIZ, DIR, "choque-modal.tsx"))).toBe(false);
    expect(c).not.toMatch(/api\.(put|post|delete)/);
    expect(c.match(/api\.patch/g)).toHaveLength(1);
    expect(c).toContain("crecimiento_objetivo_pct");
    expect(c).not.toMatch(/resolucion|huella_choque|ChoqueModal|Guardar y recalcular/);
    expect(c).toContain("Analizar y aprobar");
  });

  it("los errores de la API se muestran con Alert y los datos van por /api con `useLectura`", () => {
    const c = fuente("crecimientos-tab.tsx");
    expect(c).toContain("<AlertaError");
    expect(c).toContain("useLectura<ResumenCrecimientosProyeccionApi>");
    expect(c).toContain("/crecimientos`");
    expect(c).not.toMatch(/@supabase/);
  });

  it("usa los tokens del tema y no mete librerías ni colores sueltos", () => {
    for (const f of ["crecimientos-tab.tsx", "crecimientos-vista.ts", "cerrar-modal.tsx", "cabecera-proyeccion.tsx", "formulario-proyeccion.tsx"]) {
      const c = fuente(f);
      expect(c, f).not.toMatch(/#[0-9a-fA-F]{6}\b/);
      expect(c, f).not.toMatch(/\b(bg|text|border)-(red|green|blue|gray|slate|zinc|amber|white|black)\b/);
      expect(c, f).not.toMatch(/\.toFixed\(/);
    }
  });

  it("Por línea ya no usa el crecimiento por defecto de la proyección: usa el efectivo de la fila", () => {
    for (const f of ["linea-tab.tsx", "detalle-fila.tsx", "tabla-filas.tsx", "bloque-decision.tsx", "celda-decision.tsx"]) {
      const c = fuente(f);
      expect(c, f).not.toContain("crecimientoDefecto");
      expect(c, f).not.toContain("crecimiento_pct_defecto");
    }
    expect(fuente("celda-decision.tsx")).toContain("crecimiento_efectivo");
    expect(fuente("bloque-decision.tsx")).not.toContain("Vacío = el de la proyección");
    expect(fuente("bloque-decision.tsx")).not.toContain("normalizada por el Niño");
  });

  it("ningún texto de M4 ni de M7 dice «año de apertura» como significado de la venta esperada", () => {
    const archivos: [string, string][] = [
      [DIR, "tarjeta-tienda.tsx"],
      [DIR, "atajo-tienda.tsx"],
      [DIR, "tiendas-tab.tsx"],
      [DIR, "vista.ts"],
      ["src/app/(app)/maestros/tiendas/", "formulario-tienda.tsx"],
      ["src/app/(app)/maestros/tiendas/", "importar-tiendas.tsx"],
      ["src/app/(app)/maestros/tiendas/", "calendario-tab.tsx"],
      ["src/app/(app)/maestros/tiendas/", "tiendas-tab.tsx"],
      ["src/app/(app)/maestros/tiendas/", "venta-esperada.ts"],
    ];
    for (const [dir, f] of archivos) expect(readFileSync(path.join(RAIZ, dir, f), "utf8").toLowerCase(), f).not.toContain("año de apertura");
    expect(readFileSync(path.join(RAIZ, "src/app/(app)/maestros/tiendas/formulario-tienda.tsx"), "utf8")).toContain("Venta mensual promedio esperada");
    expect(fuente("atajo-tienda.tsx")).toContain("Venta mensual promedio esperada");
    expect(fuente("tarjeta-tienda.tsx")).toContain("venta mensual promedio esperada");
    expect(fuente("tiendas-tab.tsx")).toContain("venta mensual promedio esperada");
  });
});
