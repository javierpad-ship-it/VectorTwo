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
import { VERSION_METODO, type ProyeccionApi } from "../src/lib/proyeccion/tipos-api";
import { bloques, proyeccion, respuestaMatriz, respuestaProyeccion } from "./proyeccion.pantalla.fixture";
import { resumenAlDia, resumenConReaprobar, resumenCrecimientos } from "./proyeccion.crecimientos-pantalla.fixture";

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

  it("base real y corregida del Niño, resultante, % sobre corregido y sobre real, y el desglose del Resto", () => {
    // HOMBRE · FORMAL: 17 800 reales y 19 500 corregidas (+9.6 %); 21 570 → +10.6 % corregido y +21.2 % real.
    expect(s).toContain("17,800 real");
    expect(s).toContain("19,500 corregida");
    expect(s).toContain("corrección del Niño +9.6 %");
    expect(s).toContain("21,570");
    expect(s).toContain("+10.6 % corregido");
    expect(s).toContain("+21.2 % real");
    // Total: 120 000 reales y 125 100 corregidas, 135 010 → +7.9 % corregido y +12.5 % real.
    expect(s).toContain("120,000 real");
    expect(s).toContain("125,100 corregida");
    expect(s).toContain("135,010");
    expect(s).toContain("+7.9 % corregido");
    expect(s).toContain("+12.5 % real");
    expect(s).toContain("JOVENCITOS 8,200 · NIÑOS 6,100 · ACCESORIOS 5,700");
    expect(s).not.toContain("Rebote del Niño");
    expect(s).not.toContain("rebote");
  });

  it("un grupo sin Niño muestra un solo % y lo dice; el aplicado dice sobre qué base está", () => {
    expect(s).toContain("sin Niño");
    expect(s).toContain("sobre 2026 corregido");
    expect(s).not.toContain("sin corregir por el Niño");
  });

  it("badges informativos sin acción: «1 con % propio» y «1 decidida», con el título de dónde se cambian", () => {
    expect(s).toContain(">1 con % propio<");
    expect(s).toContain(">1 decidida<");
    expect(s).toContain("Se cambian fila a fila en Por línea: vacía «Crec.» o usa «Volver a la propuesta»");
  });

  it("«reaprobar» y las unidades fuera de la base van junto al nombre del GM; sin ellos no aparecen", () => {
    const rea = html(createElement(TablaResumenCrecimientos, { datos: resumenConReaprobar(), anioEnCurso: 2026 }));
    expect(rea.match(/>reaprobar</g)).toHaveLength(1);
    expect(rea).toContain("sobre 2026 real · antes de 0.14.0");
    expect(rea).toContain("v1 se aprobó sobre 2026 real antes de 0.14.0");
    expect(s).not.toContain(">reaprobar<");
    const fuera = html(createElement(TablaResumenCrecimientos, { datos, anioEnCurso: 2026, gmFueraBase: { "g-hombre|m-urbano": { filas: 3, unidades: 412 } } }));
    expect(fuera).toContain("412 u fuera de la base");
    expect(s).not.toContain("fuera de la base");
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
    expect(s).toContain("Crecimiento de 2027 sobre 2026 corregido del Niño, de las mismas tiendas de 2027");
    expect(s).toContain("Puente al Total 2027 de la Matriz");
    expect(s).toContain("135,924 u");
    expect(s).toContain("Base 2026 real de las mismas tiendas de 2027");
    expect(s).toContain("Base 2026 corregida del Niño");
    expect(s).toContain("+7.9 % sobre 2026 corregido (+12.5 % sobre 2026 real)");
    expect(s).toContain("Objetivo global (% sobre 2026 real)");
    expect(s).toContain("Objetivo +12.0 % → con lo aplicado te faltan 2.6 pp");
    expect(s).toContain("llevan el total de +9.4 % a +7.9 %");
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
    expect(s).toContain("Objetivo global (% sobre 2026 real)");
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
    const vieja = resumenCrecimientos({ version_metodo: VERSION_METODO - 1, total: null, sin_aprobar: null, cambiados: [] });
    const s = resumen(vieja, proyeccion());
    expect(s).toContain("Esta proyección se calculó con un método anterior (antes de 0.14.0): recalcúlala para ver sus crecimientos sobre la base corregida del Niño.");
    expect(s).toContain(">Recalcular</button>");
    expect(s).not.toContain("<table");
    const cerrada = resumen(vieja, proyeccion({ estado: "cerrada" }));
    expect(cerrada).toContain("método anterior");
    expect(cerrada).not.toContain("recalcúlala");
    expect(cerrada).not.toContain(">Recalcular</button>");
    expect(resumen(resumenCrecimientos({ version_metodo: null, total: null }), proyeccion())).toContain("método anterior");
  });

  it("avisa que hay que reaprobar (ejemplo D) y manda a la pantalla de Curvas; en una cerrada no", () => {
    const s = resumen(resumenConReaprobar(), proyeccion());
    expect(s).toContain("No se puede cerrar: HOMBRE · URBANO v1 se aprobó sobre 2026 real antes de 0.14.0 y este GM tuvo Niño en 2026 (+6.8 %): reapruébalo.");
    expect(s).toContain("Reaprobar conserva el total del GM y redistribuye entre sus líneas");
    expect(s).toContain("Ir a Crecimiento por género × mundo");
    // Lo que falta aprobar y lo que hay que reaprobar son dos avisos distintos.
    expect(s).not.toContain("falta 1 crecimiento aprobado");
    expect(resumen(resumenConReaprobar(), proyeccion({ estado: "cerrada" }))).not.toContain("No se puede cerrar");
    expect(resumen(resumenAlDia(), proyeccion())).not.toContain("reapruébalo");
  });

  it("las unidades fuera de la base y el Resto aprobado antes de 0.14.0 salen de la proyección", () => {
    const base = proyeccion();
    const p = proyeccion({
      resumen: { ...base.resumen!, gm_fuera_base: { "g-hombre|m-formal": { filas: 355, unidades: 26956 } } },
      parametros: { ...base.parametros, crecimiento_resto_usado: { pct: 5, crecimiento_id: "c-1", version: 1, por_nombre: "Javier", at: null, sobre_base: "bruta" } },
    });
    const s = resumen(resumenAlDia(), p);
    expect(s).toContain("26,956 u fuera de la base");
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

  it("el Niño de Y sin resolver deshabilita «Cerrar proyección» en la cabecera, con el mensaje y su enlace", () => {
    const p = proyeccion({
      cierre_bloqueado_por: [
        { codigo: "factor_sin_confirmar", mensaje: "El factor de invierno 2026 (0.70) es parcial y nadie lo confirmó con los datos de hoy: escríbelo en Factores del Niño." },
        { codigo: "anio_siguiente_atipico", mensaje: "2027 está marcado como año del Niño." },
        { codigo: "temporada_cambiada", mensaje: "Cambió la agrupación de alguna línea con Niño." },
      ],
    });
    const s = cabecera(p);
    expect(deshabilitado(boton(s, "Cerrar proyección"))).toBe(true);
    expect(boton(s, "Cerrar proyección")).toContain("No se puede cerrar: El factor de invierno 2026 (0.70) es parcial");
    expect(s).toContain("2027 está marcado como año del Niño.");
    expect(s).toContain("Ir a Factores del Niño");
    expect(s).toContain('href="/planificacion/proyeccion?proyeccion=proy-1&amp;pestana=factores"');
    expect(s).toContain("Curvas → Periodos atípicos");
    expect(s).toContain("Recalcula la proyección.");
    // Una cerrada no muestra la lista aunque la clave venga.
    expect(cabecera(proyeccion({ estado: "cerrada", cierre_bloqueado_por: p.cierre_bloqueado_por }))).not.toContain("Ir a Factores del Niño");
    // Con la lista vacía o nula, habilitado.
    for (const x of [proyeccion({ cierre_bloqueado_por: [] }), proyeccion({ cierre_bloqueado_por: null })]) expect(deshabilitado(boton(cabecera(x), "Cerrar proyección"))).toBe(false);
  });

  it("hay crecimientos por reaprobar: la cabecera deshabilita «Cerrar» y lo dice con el GM", () => {
    const s = cabecera(proyeccion({ crecimientos_sin_aprobar: { faltan: [], resto_provisional: false, reaprobar: [{ clave: "g|m", nombre: "HOMBRE · URBANO", version: 1, correccion_pct: 6.8 }] } }));
    expect(deshabilitado(boton(s, "Cerrar proyección"))).toBe(true);
    expect(s).toContain("HOMBRE · URBANO v1 se aprobó sobre 2026 real antes de 0.14.0");
    expect(s).toContain("Ir a Crecimiento por género × mundo");
  });

  it("una cerrada de método anterior avisa que M8 la sigue usando; una de método vigente o una en trabajo, no", () => {
    const vieja = (version: number, estado: ProyeccionApi["estado"] = "cerrada") => {
      const p = proyeccion({ estado });
      return cabecera({ ...p, resumen: { ...p.resumen!, version_metodo: version } });
    };
    expect(vieja(VERSION_METODO - 1)).toContain("M8");
    expect(vieja(VERSION_METODO - 1)).toContain("no están corregidos");
    expect(vieja(VERSION_METODO)).not.toContain("no están corregidos");
    expect(vieja(VERSION_METODO - 1, "en_trabajo")).not.toContain("M8 la");
  });

  it("también con el motivo en la lista de desactualizada: no se puede forzar", () => {
    const s = modal(proyeccion({ desactualizada: [{ codigo: "crecimientos_sin_aprobar", mensaje: "faltan" }], crecimientos_sin_aprobar: SIN_APROBAR }));
    expect(s).not.toContain("Cerrar de todos modos");
    expect(s).toContain("este motivo no se puede saltar");
  });

  it("cerrar con el Niño de Y sin resolver: lista cada motivo con su enlace, no ofrece «Cerrar de todos modos» y deshabilita Cerrar", () => {
    const s = modal(
      proyeccion({
        cierre_bloqueado_por: [
          { codigo: "factor_faltante", mensaje: "Falta el factor del Niño de verano 2026: sin él la base de 2027 no se corrige." },
          { codigo: "factor_desfasado", mensaje: "El factor de invierno 2026 se calculó con datos de setiembre y hoy hay octubre." },
          { codigo: "temporada_cambiada", mensaje: "Cambió la agrupación de alguna línea con Niño y con ella su factor: recalcula." },
        ],
      })
    );
    expect(s).toContain("No se puede cerrar: el Niño de 2026 no está resuelto.");
    expect(s).toContain("Falta el factor del Niño de verano 2026");
    expect(s).toContain("El factor de invierno 2026 se calculó con datos de setiembre");
    expect(s.match(/>Ir a Factores del Niño</g)).toHaveLength(2);
    expect(s).toContain('href="/planificacion/proyeccion?proyeccion=proy-1&amp;pestana=factores"');
    expect(s).toContain("Recalcular ahora"); // temporada_cambiada se arregla recalculando
    expect(s).toContain("no se pueden saltar con «Cerrar de todos modos»");
    expect(deshabilitado(boton(s, "Cerrar proyección"))).toBe(true);
    const atipico = modal(proyeccion({ cierre_bloqueado_por: [{ codigo: "anio_siguiente_atipico", mensaje: "2027 está marcado como año del Niño en Curvas." }] }));
    expect(atipico).toContain("Curvas → Periodos atípicos");
    expect(atipico).toContain('href="/planificacion/curvas-estacionalidad"');
  });

  it("cerrar con crecimientos por reaprobar: lista cada GM con su enlace a la pantalla del GM y no se puede saltar", () => {
    const s = modal(proyeccion({ crecimientos_sin_aprobar: { faltan: [], resto_provisional: false, reaprobar: [{ clave: "g-h|m-u", nombre: "HOMBRE · URBANO", version: 1, correccion_pct: 6.8 }] } }));
    expect(s).toContain("No se puede cerrar: hay crecimientos por reaprobar.");
    expect(s).toContain("HOMBRE · URBANO v1 se aprobó sobre 2026 real antes de 0.14.0 y este GM tuvo Niño en 2026 (+6.8 %): reapruébalo.");
    expect(s).toContain("Reaprobar HOMBRE · URBANO");
    expect(s).toContain('href="/planificacion/curvas-estacionalidad?gm=g-h.m-u&amp;anio=2027&amp;proyeccion=proy-1"');
    expect(s).toContain("Este motivo no se puede saltar");
    expect(s).not.toContain("faltan crecimientos aprobados");
    expect(s).not.toContain("Cerrar de todos modos");
    expect(deshabilitado(boton(s, "Cerrar proyección"))).toBe(true);
  });

  it("un factor de Y que cambió (no forzable) pide recalcular; el de otro año se puede forzar", () => {
    const cambio = (detalle: string[]) => modal(proyeccion({ desactualizada: [{ codigo: "factores_cambiados", mensaje: "Cambió algún factor del Niño después de calcular.", detalle }] }));
    const deY = cambio(["invierno 2026"]);
    expect(deY).toContain("Cambió el factor del Niño de invierno 2026, que corrige la base de 2027: recalcula (no se puede cerrar forzando).");
    expect(deY).toContain("este motivo no se puede saltar");
    expect(deY).not.toContain("Cerrar de todos modos");
    const deOtro = cambio(["invierno 2023"]);
    expect(deOtro).toContain("Cerrar de todos modos");
    expect(deOtro).not.toContain("este motivo no se puede saltar");
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

  it("al crear, el campo es «Resto provisional (%, sobre 2026 corregido)» y su ayuda dice que solo se usa sin un Resto aprobado", () => {
    const s = html(createElement(FormularioProyeccion, { estado, bloques: bloques(), perfiles: [], onCerrar: noop, onGuardada: noop }));
    expect(s).toContain("Resto provisional (%, sobre 2026 corregido)");
    expect(s).toContain("Se usa solo mientras no haya un Resto aprobado para 2027");
    expect(s).toContain("Se aplica sobre 2026 corregido del Niño de las mismas tiendas de 2027");
    expect(s).not.toContain("sin corregir por el Niño");
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

describe("Matriz (Parte 2): columnas «Crec. sobre 2026 corregido» y «Crec. sobre 2026 real»", () => {
  const datos = respuestaMatriz();
  const s = html(createElement(TablaMatriz, { datos, proyeccion: proyeccion(), porMarca: false, plegados: new Set<string>(), onAlternar: noop, onIrALinea: noop, onIrATiendas: noop }));

  it("van junto a «Var.», con su título que explica la diferencia y de dónde sale cada %", () => {
    expect(s).toContain("Crec. sobre 2026 corregido");
    expect(s).toContain("Crec. sobre 2026 real");
    expect(s).not.toContain("Crec. mismas tiendas");
    expect(s.indexOf("Var.")).toBeLessThan(s.indexOf("Crec. sobre 2026 corregido"));
    expect(s.indexOf("Crec. sobre 2026 corregido")).toBeLessThan(s.indexOf("Crec. sobre 2026 real"));
    expect(s).toContain("Var. = Total 2027 ÷ Total 2026 (incluye tiendas nuevas, aperturas y cierres).");
    expect(s).toContain("es el % que apruebas en Curvas → Crecimiento por género × mundo (o el % propio de la fila)");
    expect(s).toContain("Compara con lo vendido; no es el % que apruebas.");
    expect(s).toContain("El % que apruebas se aplica sobre 2026 corregido del Niño; «real» compara con lo vendido. Var. incluye además tiendas nuevas, aperturas y cierres.");
    expect(s).not.toContain("es lo que escribes en Crecimientos");
  });

  it("cada nodo muestra el % sobre corregido y el % sobre real; la celda corregida lleva las dos bases en su título", () => {
    expect(s).toContain("+3.4 %"); // crec_corregida_pct
    expect(s).toContain("+9.8 %"); // crec_mismas_pct (sobre real)
    expect(s).toContain("Base 48,000 u real · 51,000 u corregida (+6.3 %)");
  });

  it("un nodo sin la base corregida (proyección de método anterior) deja «—» en la columna corregida y conserva la real", () => {
    const antiguo = respuestaMatriz({ nodos: [{ ...datos.nodos[3], siguiente: { ...datos.nodos[3].siguiente, base_corregida: undefined, crec_corregida_pct: undefined } }] });
    const t = html(createElement(TablaMatriz, { datos: antiguo, proyeccion: proyeccion(), porMarca: false, plegados: new Set<string>(), onAlternar: noop, onIrALinea: noop, onIrATiendas: noop }));
    expect(t).toContain("+9.8 %");
    expect(t).toMatch(/title="Crec\. sobre 2026 corregido[^"]*"[^>]*>—<\/td>/);
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

  it("el corte del método anterior sale de `VERSION_METODO`, no de un número suelto", () => {
    const v = fuente("crecimientos-vista.ts");
    expect(v).toContain("VERSION_METODO");
    expect(v).not.toContain("VERSION_METODO_CRECIMIENTOS");
    expect(v).toContain("@/lib/proyeccion/tipos-api");
    expect(fuente("crecimientos-tab.tsx")).not.toContain("VERSION_METODO_CRECIMIENTOS");
  });

  it("los errores de la API se muestran con Alert y los datos van por /api con `useLectura`", () => {
    const c = fuente("crecimientos-tab.tsx");
    expect(c).toContain("<AlertaError");
    expect(c).toContain("useLectura<ResumenCrecimientosProyeccionApi>");
    expect(c).toContain("/crecimientos`");
    expect(c).not.toMatch(/@supabase/);
  });

  it("usa los tokens del tema y no mete librerías ni colores sueltos", () => {
    for (const f of ["crecimientos-tab.tsx", "crecimientos-vista.ts", "cerrar-modal.tsx", "cabecera-proyeccion.tsx", "formulario-proyeccion.tsx", "factores-tab.tsx", "factores-vista.ts", "antes-de-proyectar.tsx"]) {
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
    for (const f of ["linea-tab.tsx", "detalle-fila.tsx", "tabla-filas.tsx", "bloque-decision.tsx", "celda-decision.tsx"]) expect(fuente(f), f).not.toMatch(/crecimiento bruto|sin corregir por el Niño/);
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
