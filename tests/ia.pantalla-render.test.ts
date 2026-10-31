import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EvaluacionesTab, InformeEvaluacion, ListaEvaluaciones, ProgresoEvaluacion } from "../src/app/(app)/administracion/ia/evaluaciones-tab";
import { AvisosConfiguracion, ConfiguracionTab, EstadoServicio, FormularioConfiguracion, VersionesConfiguracion } from "../src/app/(app)/administracion/ia/configuracion-tab";
import { IaPanel, PESTANAS_IA } from "../src/app/(app)/administracion/ia/ia-panel";
import { CONDUCCION_INACTIVA, claveAvance } from "../src/app/(app)/administracion/ia/use-evaluacion-ia";
import { UsoTab, UsoVista } from "../src/app/(app)/administracion/ia/uso-tab";
import { GenerarIaModal, ProgresoGeneracion, ResumenEstimacion } from "../src/app/(app)/planificacion/proyeccion/generar-ia-modal";
import { GmIaDetalleVista } from "../src/app/(app)/planificacion/proyeccion/gm-ia-detalle";
import { CabeceraServicioIa, PrerrequisitosIa, PropuestaIaTab, TablaGmIa, VistaPropuestaIa } from "../src/app/(app)/planificacion/proyeccion/propuesta-ia-tab";
import { GENERACION_INACTIVA, type EstadoGeneracion } from "../src/app/(app)/planificacion/proyeccion/use-propuesta-ia";
import { PESTANAS, unidades } from "../src/app/(app)/planificacion/proyeccion/vista";
import { puedeVerRuta, seccionesVisibles } from "../src/lib/nav";
import {
  CLAVE_HOMBRE_URBANO,
  CLAVE_MUJER_RESTO,
  CLAVE_MUJER_URBANO,
  RAZON_HOSTIL,
  Y,
  corrida,
  estadoIa,
  estimacion,
  evaluacion,
  evaluacionNoGana,
  gmDetalle,
  gmMujerUrbano,
  gmResto,
  gmResumen,
  respuestaConfiguracion,
  resultados,
  servicio,
  servicioApagado,
  uso,
} from "./ia.pantalla.fixture";

/** Humo de render con datos sintéticos (07e §4.1 y §4.5): nada lanza, salen los textos de la ficha y los textos de la IA se pintan como texto. Sin red. */

const nada = () => {};
// React separa con comentarios los textos que vienen de varias expresiones: se quitan para comparar frases completas.
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el).replaceAll("<!-- -->", "");
const botonDeshabilitado = (h: string, texto: string) => new RegExp(`<button[^>]*disabled=""[^>]*>${texto}`).test(h);
const hayBoton = (h: string, texto: string) => new RegExp(`<button[^>]*>${texto}</button>`).test(h);

function vistaEl(extra: Partial<Parameters<typeof VistaPropuestaIa>[0]> = {}) {
  return createElement(VistaPropuestaIa, {
    estado: estadoIa(),
    anioSiguiente: Y + 1,
    esAdmin: true,
    bloqueada: false,
    onGenerar: nada,
    onVer: nada,
    onExcel: nada,
    onCancelarCorrida: nada,
    onIrAFactores: nada,
    ...extra,
  });
}

function detalleEl(extra: Partial<Parameters<typeof GmIaDetalleVista>[0]> = {}) {
  return createElement(GmIaDetalleVista, { detalle: gmDetalle(), anioEnCurso: Y, indice: [], onVolver: nada, onIrALinea: nada, onExcel: nada, ...extra });
}

describe("la pestaña en la proyección", () => {
  it("«Propuesta IA» va entre «Crecimientos» y «Por línea»", () => {
    const ids = PESTANAS.map((p) => p.id);
    expect(ids.indexOf("ia")).toBe(ids.indexOf("crecimientos") + 1);
    expect(ids.indexOf("linea")).toBe(ids.indexOf("ia") + 1);
    expect(PESTANAS.find((p) => p.id === "ia")?.etiqueta).toBe("Propuesta IA");
  });
});

describe("cabecera de servicio", () => {
  it("encendida: dice proveedor, modelo y prompt vigentes, el gasto, la nota de cerrar a mano y enlaza a Administración (solo admin)", () => {
    const h = html(createElement(CabeceraServicioIa, { servicio: servicio(), anioSiguiente: Y + 1, esAdmin: true }));
    expect(h).toContain("IA encendida · OpenAI · modelo modelo-a · prompt v1 · meta 2027");
    expect(h).toContain("gasto del mes US$ 3.20 de 60");
    expect(h).toContain("Para cerrar, cada fila libre se decide a mano (por línea).");
    expect(h).toContain("«Desvío frente a la meta» de la Matriz es la única garantía");
    expect(h).toContain('href="/administracion/ia"');
    const planner = html(createElement(CabeceraServicioIa, { servicio: servicio(), anioSiguiente: Y + 1, esAdmin: false }));
    expect(planner).not.toContain("/administracion/ia");
  });

  it("apagada: dice el motivo con claridad, muestra el proveedor y el modelo y no es la línea de «encendida»", () => {
    for (const [motivo, frase] of [
      ["sin_clave", "Falta la clave del proveedor en el servidor"],
      ["sin_proveedor", "no tiene proveedor de IA configurado"],
      ["desactivada_entorno", "desactivada por el entorno"],
      ["sin_configuracion", "Todavía no hay una configuración de IA aprobada"],
      ["clave_invalida", "rechazó la clave"],
    ] as const) {
      const h = html(createElement(CabeceraServicioIa, { servicio: servicioApagado(motivo), anioSiguiente: Y + 1, esAdmin: false }));
      expect(h, motivo).toContain("IA apagada");
      expect(h, motivo).toContain(frase);
      expect(h, motivo).not.toContain("IA encendida");
    }
    expect(html(createElement(CabeceraServicioIa, { servicio: servicioApagado("sin_capacidades"), anioSiguiente: Y + 1, esAdmin: false }))).toContain("modelo en la configuración: modelo-a");
  });
});

describe("vista de la pestaña", () => {
  it("con la IA encendida ofrece generar y descargar el Excel, y lista los GM con HOMBRE y MUJER antes del Resto", () => {
    const h = html(vistaEl());
    expect(hayBoton(h, "Generar propuesta IA")).toBe(true);
    expect(h).toContain("Descargar Excel");
    expect(h.indexOf("HOMBRE · URBANO")).toBeLessThan(h.indexOf("MUJER · URBANO"));
    expect(h.indexOf("MUJER · URBANO")).toBeLessThan(h.indexOf("MUJER · AIRE LIBRE"));
    expect(h).toContain("3 GM · 1 pendientes o desactualizados");
  });

  it("con el servicio apagado no ofrece generar (el motivo ya está en la cabecera)", () => {
    const h = html(vistaEl({ estado: estadoIa({ servicio: servicioApagado("sin_clave") }) }));
    expect(h).not.toContain("Generar propuesta IA");
    expect(h).toContain("Falta la clave del proveedor");
  });

  it("con el servicio apagado «Ver» de cada GM y el Excel quedan deshabilitados, con el motivo (el detalle respondería 409)", () => {
    const apagado = html(vistaEl({ estado: estadoIa({ servicio: servicioApagado("sin_clave") }) }));
    const botones = apagado.match(/<button[^>]*aria-label="Ver [^"]*"[^>]*>/g) ?? [];
    expect(botones).toHaveLength(3);
    for (const b of botones) {
      expect(b).toContain('disabled=""');
      expect(b).toContain("El detalle no está disponible con la IA apagada. Falta la clave del proveedor");
    }
    expect(botonDeshabilitado(apagado, "Descargar Excel")).toBe(true);
    // Encendida, «Ver» sigue activo.
    const encendido = html(vistaEl());
    for (const b of encendido.match(/<button[^>]*aria-label="Ver [^"]*"[^>]*>/g) ?? []) expect(b).not.toContain('disabled=""');
    expect(botonDeshabilitado(encendido, "Descargar Excel")).toBe(false);
  });

  it("con bloqueos o la proyección cerrada, «Generar» queda deshabilitado", () => {
    expect(botonDeshabilitado(html(vistaEl({ estado: estadoIa({ prerrequisitos: { bloquea: ["version_metodo"], avisa: [] } }) })), "Generar propuesta IA")).toBe(true);
    expect(botonDeshabilitado(html(vistaEl({ bloqueada: true })), "Generar propuesta IA")).toBe(true);
    expect(botonDeshabilitado(html(vistaEl()), "Generar propuesta IA")).toBe(false);
  });

  it("una corrida en curso de otra sesión se avisa y se puede cancelar", () => {
    const h = html(vistaEl({ estado: estadoIa({ corrida_en_curso: corrida() }) }));
    expect(h).toContain("Hay una corrida en curso de Ana Planner");
    expect(h).toContain("Cancelar esa corrida");
    expect(botonDeshabilitado(h, "Generar propuesta IA")).toBe(true);
  });

  it("prerrequisitos: lo que bloquea lleva a Factores y lo que avisa va en info, con la cuenta por GM", () => {
    const h = html(
      createElement(PrerrequisitosIa, {
        estado: estadoIa({ prerrequisitos: { bloquea: ["factor_y"], avisa: ["meta_provisional", "decisiones_y_pendientes"] } }),
        onIrAFactores: nada,
      })
    );
    expect(h).toContain("No se puede generar: el factor del Niño del año en curso falta");
    expect(h).toContain("Ir a Factores del Niño");
    expect(h).toContain("la IA reparte el % provisional");
    expect(h).toContain("HOMBRE · URBANO (2)");
    expect(html(createElement(PrerrequisitosIa, { estado: estadoIa(), onIrAFactores: nada }))).toBe("");
  });
});

describe("tabla de GM", () => {
  const tabla = (gms = [gmResumen(), gmMujerUrbano(), gmResto()], extra: Partial<Parameters<typeof TablaGmIa>[0]> = {}) => html(createElement(TablaGmIa, { gms, onVer: nada, ...extra }));

  it("las columnas de la ficha y los datos del GM", () => {
    const h = tabla();
    for (const t of ["GM", "Meta", "Fijas", "Libre", "Natural IA", "Esfuerzo", "Forzadas / ceden", "Absorbido", "Estado", "Generada"]) expect(h).toContain(t);
    expect(h).toContain("+8.00 % sobre corregido");
    expect(h).toContain("al día");
    expect(h).toContain("meta movida");
    expect(h).toContain("sin propuesta");
    expect(h).toContain("OpenAI modelo-a");
    expect(h).toContain("Ana Planner");
  });

  it("la meta del Resto provisional se marca y el esfuerzo se rotula (exigente / holgada)", () => {
    const h = tabla();
    expect(h).toContain("provisional");
    expect(h).toContain(">exigente<");
    expect(h).toContain(">holgada<");
    expect(tabla([gmResumen({ esfuerzo_pct: 30 })])).toContain(">muy exigente<");
  });

  it("la absorción dice «desde que la IA propuso» y se pone en alerta pasando del 5 %", () => {
    const h = tabla();
    expect(h).toContain("desde que la IA propuso");
    expect(h).toMatch(/text-alerta">-[\d,.]+ u \(-8\.9 %\) desde que la IA propuso/);
  });

  it("una propuesta fallida ofrece «Reintentar este GM» y «Ver» abre el detalle", () => {
    const h = tabla([gmResumen({ estado: "fallida" })], { onReintentar: nada });
    expect(h).toContain("Reintentar este GM");
    expect(h).toContain('aria-label="Ver HOMBRE · URBANO"');
    expect(tabla([gmResumen({ estado: "fallida" })])).not.toContain("Reintentar este GM");
  });

  it("estados vacíos y configuración distinta", () => {
    expect(tabla([])).toContain("Ningún género · mundo con filas base");
    expect(tabla([gmResumen({ configuracion_cambiada: true })])).toContain("configuración distinta");
    expect(tabla([gmResumen({ estado: "desactualizada", motivos: ["historia_cambiada"] })])).toContain("desactualizada (la historia cambió)");
  });
});

describe("detalle de un GM", () => {
  it("razón del GM, tarjeta de la meta con las dos cifras, fuera de la meta y desglose de la absorción", () => {
    const h = html(detalleEl());
    expect(h).toContain("HOMBRE · URBANO");
    expect(h).toContain("El GM crece parejo; la meta pide más a DENIM que a POLO.");
    expect(h).toContain("Σ propuesta del método con +8.00 % sobre corregido");
    expect(h).toContain("en filas de M7:");
    expect(h).toContain("vista previa de Curvas:");
    expect(h).toContain("Fuera de la meta: aperturas 2027");
    expect(h).toContain("líneas nuevas de 2027: se planifican aparte");
    expect(h).toContain("Desde que la IA propuso: la meta cambió 0 u;");
    expect(h).toContain("las libres que quedan absorbieron");
  });

  it("las columnas de la ficha, las filas ordenadas por cuánto se apartan del método y «Ir a la línea»", () => {
    const h = html(detalleEl({ indice: [{ genero_id: "gen-hombre", mundo_id: "mun-urbano", linea_id: "lin-denim", genero: "HOMBRE", mundo: "URBANO", linea: "DENIM", estado: "con_propuesta" } as never] }));
    for (const t of ["Línea · agrupación", "Base 2027", "Método 2027", "Natural IA", "IA con meta", "Absorbido", "Brecha", "vs método", "% sobre 2026", "Confianza", "Señales del sistema · lectura de la IA", "Razón", "Decisión 2027"]) expect(h).toContain(t);
    expect(h.indexOf(">CAMISA</p>")).toBeLessThan(h.indexOf(">DENIM</p>"));
    expect(h).toContain("muy forzada");
    expect(h).toContain("cede");
    expect(h).toContain(`+${unidades(2200)} u por tiendas que entran`);
    expect(h).toContain('aria-label="Ir a la línea DENIM"');
    expect(h).toContain("fija: decidida");
    expect(h).toContain("decidida ·");
    expect(h).toContain("pendiente");
  });

  it("los textos de la IA se pintan como texto: nada de HTML ni de markdown interpretado", () => {
    const h = html(detalleEl());
    expect(h).not.toContain("<script");
    expect(h).not.toContain("<img");
    expect(h).not.toContain("<a href=\"javascript");
    expect(h).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(h).toContain("**negrita**");
    expect(h).toContain("[enlace](javascript:alert(1))");
    expect(h).toContain("&lt;img src=x onerror=alert(1)&gt;");
    // Y la razón del GM también.
    const g = html(detalleEl({ detalle: gmDetalle({ propuesta: { ...gmDetalle().propuesta!, razon_gm: RAZON_HOSTIL } }) }));
    expect(g).not.toContain("<script");
    expect(g).toContain("&lt;script&gt;");
  });

  it("sin propuesta lo dice, sin meta lo dice y la configuración distinta avisa", () => {
    expect(html(detalleEl({ detalle: gmDetalle({ propuesta: null, estado: "sin_propuesta", absorcion: null }) }))).toContain("Este GM todavía no tiene propuesta de la IA");
    expect(html(detalleEl({ detalle: gmDetalle({ meta: null }) }))).toContain("Sin meta aprobada para este GM");
    expect(html(detalleEl({ detalle: gmDetalle({ configuracion_cambiada: true }) }))).toContain("no es la que generó esta propuesta");
  });

  it("propuestas anteriores en solo lectura y el Excel", () => {
    const h = html(detalleEl());
    expect(h).toContain("Propuestas anteriores");
    expect(h).toContain("OpenAI modelo-a · prompt v1");
    expect(h).toContain("Descargar Excel");
    expect(html(detalleEl({ detalle: gmDetalle({ anteriores: [] }) }))).not.toContain("Propuestas anteriores");
    expect(html(detalleEl({ excelOcupado: true }))).toContain("Preparando…");
  });
});

describe("generar", () => {
  const modal = (extra: Partial<Parameters<typeof GenerarIaModal>[0]> = {}) =>
    html(createElement(GenerarIaModal, { proyeccionId: "proy-1", estado: estadoIa(), onCerrar: nada, onTermino: nada, ...extra }));

  it("el modal ofrece el selector de GM, regenerar, la estimación, los topes y Confirmar con el costo", () => {
    const h = modal();
    expect(h).toContain("Generar propuesta IA");
    expect(h).toContain("GM pendientes o desactualizados");
    expect(h).toContain("Todos los GM");
    expect(h).toContain("MUJER · AIRE LIBRE (Resto)");
    expect(h).toContain("Regenerar aunque los datos no hayan cambiado");
    expect(h).toContain("2 GM · 1 se reusan sin llamar al proveedor");
    expect(h).toContain("5 llamadas · 40 filas");
    expect(h).toContain("Costo estimado US$ 3.60");
    expect(h).toContain("Tope por corrida: US$ 10.00");
    expect(h).toContain("Queda del mes: US$ 56.80");
    expect(h).toContain("Queda hoy: US$ 14.60");
    expect(h).toContain("Confirmar (US$ 3.60)");
  });

  it("para otro GM no hay estimación todavía: pide calcularla antes de confirmar", () => {
    const h = modal({ seleccionInicial: [CLAVE_MUJER_URBANO] });
    expect(h).toContain("Calcula la estimación antes de confirmar");
    expect(h).toContain("Calcular estimación");
    expect(h).not.toContain("Confirmar (");
    expect(h).toContain(`<option value="gm:${CLAVE_MUJER_URBANO}" selected`);
  });

  it("si la estimación pasa del tope por corrida, no se puede confirmar y se dice por qué", () => {
    const h = modal({ estado: estadoIa({ estimacion_pendientes: estimacion({ costo_usd: 12 }) }) });
    expect(h).toContain("pasa del tope por corrida");
    expect(botonDeshabilitado(h, "Confirmar \\(US\\$ 12\\.00\\)")).toBe(true);
  });

  it("si no hay nada que generar lo dice y deshabilita Confirmar", () => {
    const h = modal({ estado: estadoIa({ estimacion_pendientes: estimacion({ gms: 0, llamadas: 0, filas: 0, costo_usd: 0, reusables: 3 }) }) });
    expect(h).toContain("No hay GM que generar con esta selección");
    expect(botonDeshabilitado(h, "Confirmar \\(US\\$ 0\\.00\\)")).toBe(true);
  });

  const nombres = new Map([
    [CLAVE_HOMBRE_URBANO, "HOMBRE · URBANO"],
    [CLAVE_MUJER_URBANO, "MUJER · URBANO"],
    [CLAVE_MUJER_RESTO, "MUJER · AIRE LIBRE"],
  ]);
  const estadoCorriendo = (extra: Partial<EstadoGeneracion> = {}): EstadoGeneracion => ({
    ...GENERACION_INACTIVA,
    fase: "corriendo",
    corrida: corrida({ costo_usd: 0.4 }),
    plan: [
      { gm_clave: CLAVE_HOMBRE_URBANO, modo: "directo", llamadas: 2, reusa: false },
      { gm_clave: CLAVE_MUJER_URBANO, modo: "jerarquico", llamadas: 6, reusa: false },
      { gm_clave: CLAVE_MUJER_RESTO, modo: "directo", llamadas: 0, reusa: true },
    ],
    porGm: {
      [CLAVE_HOMBRE_URBANO]: { estado: "hecho", pasos_hechos: 2, pasos_total: 2 },
      [CLAVE_MUJER_URBANO]: { estado: "en_proceso", pasos_hechos: 1, pasos_total: 4 },
      [CLAVE_MUJER_RESTO]: { estado: "pendiente", pasos_hechos: 0, pasos_total: 0 },
    },
    ...extra,
  });

  it("el progreso muestra GM hechos, barra por pasos, costo acumulado y el reuso", () => {
    const h = html(createElement(ProgresoGeneracion, { estado: estadoCorriendo(), nombres }));
    expect(h).toContain("1 de 3 GM");
    expect(h).toContain("US$ 0.40 acumulado");
    expect(h).toContain('role="progressbar"');
    expect(h).toContain('aria-valuenow="25"');
    expect(h).toContain("se reusa");
    expect(h).toContain("en proceso");
    expect(h).not.toContain("Esperando al proveedor");
  });

  it("un 429 se ve como espera, no como error", () => {
    const h = html(createElement(ProgresoGeneracion, { estado: estadoCorriendo({ esperando: true }), nombres }));
    expect(h).toContain("Esperando al proveedor… se reintenta solo.");
    expect(h).not.toContain('role="alert"><span>Error');
  });

  it("un GM fallido ofrece «Reintentar este GM» solo cuando la corrida terminó", () => {
    const porGm = { ...estadoCorriendo().porGm, [CLAVE_MUJER_URBANO]: { estado: "fallido" as const, pasos_hechos: 1, pasos_total: 4 } };
    expect(html(createElement(ProgresoGeneracion, { estado: estadoCorriendo({ porGm }), nombres, onReintentar: nada }))).not.toContain("Reintentar este GM");
    expect(html(createElement(ProgresoGeneracion, { estado: estadoCorriendo({ porGm, fase: "terminada" }), nombres, onReintentar: nada }))).toContain("Reintentar este GM");
  });

  it("la estimación dice topes y costo", () => {
    const h = html(createElement(ResumenEstimacion, { estimacion: estimacion(), servicio: servicio() }));
    expect(h).toContain(`${unidades(120000)} tokens de entrada`);
    expect(h).toContain("Costo estimado US$ 3.60");
  });
});

describe("la pestaña con datos aún sin leer", () => {
  it("renderiza sin lanzar y dice que está leyendo", () => {
    const proyeccion = { id: "proy-1", anio_en_curso: Y, anio_siguiente: Y + 1, calculado_at: "2026-10-16T00:00:00Z" } as never;
    const h = html(createElement(PropuestaIaTab, { proyeccion, indice: [], gmClave: null, esAdmin: true, bloqueada: false, onGm: nada, onIrALinea: nada, onIrAFactores: nada }));
    expect(h).toContain("Leyendo el estado de la IA…");
    expect(h).toContain("La meta de 2027 por género × mundo se aprueba en Curvas.");
  });
});

// ─── Administración ───

describe("Administración → Motor de IA", () => {
  it("el menú la ofrece solo al administrador y la ruta está protegida por el mismo guard", () => {
    const etiquetas = (rol: "admin" | "planner" | "comprador") => seccionesVisibles(rol).flatMap((s) => s.links.map((l) => l.label));
    expect(etiquetas("admin")).toContain("Motor de IA");
    expect(etiquetas("planner")).not.toContain("Motor de IA");
    expect(etiquetas("comprador")).not.toContain("Motor de IA");
    expect(puedeVerRuta("admin", "/administracion/ia")).toBe(true);
    expect(puedeVerRuta("planner", "/administracion/ia")).toBe(false);
    expect(puedeVerRuta("comprador", "/administracion/ia")).toBe(false);
  });

  it("tres pestañas: Configuración, Evaluaciones y Uso", () => {
    expect(PESTANAS_IA.map((p) => p.etiqueta)).toEqual(["Configuración", "Evaluaciones", "Uso"]);
    const h = html(createElement(IaPanel));
    expect(h).toContain("Motor de IA");
    expect(h).toContain("Leyendo la configuración…");
  });

  it("estado del servicio: proveedor del entorno, modelos permitidos y «clave presente» (nunca su valor)", () => {
    const h = html(createElement(EstadoServicio, { datos: respuestaConfiguracion() }));
    expect(h).toContain("OpenAI");
    expect(h).toContain("modelo-a, modelo-b");
    expect(h).toContain("Clave presente en el servidor");
    expect(h).toContain(">sí<");
    expect(h).toContain("La IA está disponible.");
    const sin = html(createElement(EstadoServicio, { datos: respuestaConfiguracion({ servicio: servicioApagado("sin_clave", { modelos_permitidos: [] }) }) }));
    expect(sin).toContain(">no<");
    expect(sin).toContain("ninguno (falta la variable del servidor)");
    expect(sin).toContain("IA apagada: Falta la clave");
  });

  it("versiones: la vigente y las reemplazadas", () => {
    const d = respuestaConfiguracion();
    const h = html(createElement(VersionesConfiguracion, { vigente: d.vigente, versiones: d.versiones }));
    expect(h).toContain("v2");
    expect(h).toContain("vigente");
    expect(h).toContain("reemplazada");
    expect(h).toContain("ninguna (apagada)");
    expect(html(createElement(VersionesConfiguracion, { vigente: null, versiones: [] }))).toContain("la IA está apagada hasta guardar una");
  });

  const formulario = (datos = respuestaConfiguracion(), evaluaciones = [evaluacion()]) => html(createElement(FormularioConfiguracion, { datos, evaluaciones, onGuardada: async () => {} }));

  it("el formulario trae los campos de la ficha, con el proveedor de solo lectura y el modelo de la lista permitida", () => {
    const h = formulario();
    for (const t of ["Proveedor", "Modelo", "Versión de prompt", "Evaluación que lo respalda", "Tope por corrida (US$)", "Tope del mes (US$)", "Tope por usuario y día (US$)", "Filas por llamada", "Razonamiento (tokens)", "Incluir la cola larga en el reparto", "Entrada", "Entrada en caché", "Salida", "Términos que nunca salen", "Nota (opcional)", "Guardar versión"])
      expect(h, t).toContain(t);
    expect(h).toContain("Cópialos de la página de precios vigente del proveedor");
    expect(h).toContain("Marcas y tiendas ya se reemplazan solas; añade el nombre de la empresa u otros.");
    expect(h).toMatch(/<input[^>]*value="OpenAI"[^>]*/);
    expect(h).toContain('<option value="modelo-a" selected="">modelo-a</option>');
    expect(h).toContain('<option value="modelo-b">modelo-b</option>');
    expect(h).toContain("Ver texto del prompt");
  });

  it("sin evaluación ganadora la capacidad no se puede encender; con ella, sí", () => {
    const sin = formulario(respuestaConfiguracion({ vigente: null, versiones: [] }), [evaluacionNoGana()]);
    const caja = (h: string) => /<input[^>]*aria-label="Distribución de la meta[^>]*>/.exec(h)?.[0] ?? "";
    expect(caja(sin)).toContain('disabled=""');
    expect(sin).toContain("No hay una evaluación ganadora para este modelo y prompt");
    const con = formulario();
    expect(caja(con)).not.toContain('disabled=""');
    expect(caja(con)).toContain('checked=""');
    expect(con).toContain("Intento 1 · 02/11 · modelo-a · v1");
  });

  it("los avisos del servidor se muestran como información en la pestaña Configuración; sin avisos no sale nada", () => {
    const aviso = { codigo: "modelo_efectivo_distinto" as const, observados: ["modelo-a"], produccion: ["modelo-a", "modelo-a-nuevo"] };
    const h = html(createElement(AvisosConfiguracion, { avisos: [aviso] }));
    expect(h).toContain("El proveedor respondió con un modelo distinto al configurado");
    expect(h).toContain("«modelo-a-nuevo»");
    expect(html(createElement(AvisosConfiguracion, { avisos: [] }))).toBe("");
    expect(html(createElement(AvisosConfiguracion, { avisos: undefined }))).toBe("");
  });

  it("con alguna capacidad encendida «Términos que nunca salen» se marca obligatorio; sin ninguna, no", () => {
    const con = formulario();
    expect(con).toContain("Términos que nunca salen (obligatorio con la IA encendida)");
    expect(con).toContain("hace falta al menos uno: el nombre de la empresa");
    expect(con).toMatch(/<textarea[^>]*aria-required="true"/);
    const sin = formulario(respuestaConfiguracion({ vigente: null, versiones: [] }), [evaluacionNoGana()]);
    expect(sin).not.toContain("obligatorio con la IA encendida");
    expect(sin).toMatch(/<textarea[^>]*aria-required="false"/);
  });

  it("la ayuda del precio en caché dice que 0 es válido y que no pasa del de entrada", () => {
    expect(formulario()).toContain("Desde 0 y no mayor que la entrada");
  });

  it("sin proveedor o sin modelos permitidos, no deja guardar", () => {
    const h = formulario(respuestaConfiguracion({ servicio: servicioApagado("sin_proveedor", { proveedor: null, modelos_permitidos: [] }) }));
    expect(h).toContain("El servidor no tiene proveedor de IA");
    expect(botonDeshabilitado(h, "Guardar versión")).toBe(true);
  });

  it("la pestaña Configuración arranca leyendo", () => {
    expect(html(createElement(ConfiguracionTab))).toContain("Leyendo la configuración…");
  });

  it("evaluaciones: informe con veredicto, regla que falló, tablas de reparto y natural, IC, género, GM ganados, estabilidad y cobertura", () => {
    const h = html(createElement(InformeEvaluacion, { evaluacion: evaluacion() }));
    expect(h).toContain("Informe · intento n.º 1");
    expect(h).toContain("distribución de la meta: gana");
    expect(h).toContain("Regla que falló:");
    expect(h).toContain("ninguna");
    expect(h).toContain("Reparto de la meta");
    expect(h).toContain("Natural (sin la meta)");
    expect(h).toContain("IC 90 % (bootstrap)");
    expect(h).toContain("[0.4; 3.1] pp");
    expect(h).toContain("regla de tendencia");
    expect(h).toContain("Reparto por género (D25)");
    expect(h).toContain("GM ganados:");
    expect(h).toContain("21");
    expect(h).toContain("Estabilidad entre D25 y E25");
    expect(h).toContain("cobertura de respuestas válidas");
    expect(h).toContain("US$ 14.20 de US$ 50.00");
    expect(h).toContain("47 min");
    const malo = html(createElement(InformeEvaluacion, { evaluacion: evaluacionNoGana() }));
    expect(malo).toContain("distribución de la meta: no gana");
    expect(malo).toContain("el intervalo del bootstrap incluye cero");
    const sinResultados = html(createElement(InformeEvaluacion, { evaluacion: evaluacion({ estado: "cancelada", resultados: null, veredicto: null }) }));
    expect(sinResultados).toContain("no llegó a producir resultados");
    expect(html(createElement(InformeEvaluacion, { evaluacion: evaluacion({ resultados: resultados({ d24: null }) }) }))).not.toContain(">D24<");
  });

  it("evaluaciones: la lista trae todos los intentos, también los cancelados y fallidos", () => {
    const h = html(
      createElement(ListaEvaluaciones, {
        evaluaciones: [evaluacion(), evaluacionNoGana(), evaluacion({ id: "ev-3", intento: 3, estado: "cancelada", veredicto: null, resultados: null }), evaluacion({ id: "ev-4", intento: 4, estado: "fallida", veredicto: null, resultados: null })],
        elegida: "ev-2",
        onVer: nada,
      })
    );
    for (const t of ["n.º 1", "n.º 2", "n.º 3", "n.º 4", "completa", "cancelada", "fallida", "no gana"]) expect(h, t).toContain(t);
    expect(h).toContain("Todos los intentos quedan registrados");
    expect(html(createElement(ListaEvaluaciones, { evaluaciones: [], elegida: null, onVer: nada }))).toContain("Todavía no se ha evaluado ningún modelo");
  });

  it("evaluaciones: el progreso dice «preparando D25…» y luego el GM en curso", () => {
    const plan = [
      { pliegue: "D25", gm_clave: CLAVE_HOMBRE_URBANO },
      { pliegue: "D25", gm_clave: CLAVE_MUJER_URBANO },
    ];
    const preparando = html(createElement(ProgresoEvaluacion, { estado: { ...CONDUCCION_INACTIVA, fase: "corriendo", plan, preparando: "D25" } }));
    expect(preparando).toContain("Preparando D25…");
    const enCurso = html(
      createElement(ProgresoEvaluacion, {
        estado: { ...CONDUCCION_INACTIVA, fase: "corriendo", plan, costoUsd: 2.5, porGm: { [claveAvance("D25", CLAVE_HOMBRE_URBANO)]: { estado: "hecho", pasos_hechos: 2, pasos_total: 2 } } },
      })
    );
    expect(enCurso).toContain("Pliegue D25 · GM 2 de 2");
    expect(enCurso).toContain("US$ 2.50 acumulado");
  });

  it("la pestaña Evaluaciones y la de Uso arrancan leyendo; el uso por mes trae el costo, el tope, los días y las corridas", () => {
    expect(html(createElement(EvaluacionesTab))).toContain("Leyendo la configuración…");
    expect(html(createElement(UsoTab))).toContain("Leyendo el uso…");
    const h = html(createElement(UsoVista, { datos: uso() }));
    expect(h).toContain("Uso de noviembre de 2026");
    expect(h).toContain("US$ 17.80");
    expect(h).toContain("US$ 60.00");
    expect(h).toContain("02/11");
    expect(h).toContain("410");
    expect(h).toContain("OpenAI · modelo-a · v1");
    expect(h).toContain("completa");
    expect(html(createElement(UsoVista, { datos: uso({ por_dia: [], corridas: [] }) }))).toContain("Sin llamadas en este mes.");
  });
});

// ─── Estático: lo que no debe aparecer en el código de estas pantallas ───

const RAIZ = path.resolve(__dirname, "..");
const DIRS = ["src/app/(app)/administracion/ia"];
const ARCHIVOS_TAB = ["propuesta-ia-tab.tsx", "propuesta-ia-vista.ts", "gm-ia-detalle.tsx", "generar-ia-modal.tsx", "use-propuesta-ia.ts"].map((f) => `src/app/(app)/planificacion/proyeccion/${f}`);

function listar(dir: string): string[] {
  return readdirSync(path.join(RAIZ, dir)).flatMap((n) => {
    const rel = `${dir}/${n}`;
    return statSync(path.join(RAIZ, rel)).isDirectory() ? listar(rel) : [rel];
  });
}

describe("estructura de las pantallas de IA", () => {
  const archivos = [...DIRS.flatMap(listar), ...ARCHIVOS_TAB];
  const fuentes = archivos.map((f) => [f, readFileSync(path.join(RAIZ, f), "utf8")] as const);

  it("nunca pintan HTML crudo, nunca hablan con Supabase ni importan SDK de proveedor y no cablean ids de modelo ni precios", () => {
    expect(fuentes.length).toBeGreaterThan(10);
    for (const [f, s] of fuentes) {
      expect(s, f).not.toContain("dangerouslySetInnerHTML");
      expect(s, f).not.toMatch(/@supabase|supabaseAdmin|createClient\(/);
      expect(s, f).not.toMatch(/from ["'](openai|@anthropic-ai\/sdk)["']/);
      expect(s, f).not.toMatch(/\bgpt-[0-9a-z.-]+|\bclaude-[0-9a-z.-]+|\bo[134]-(mini|preview)\b/i);
      expect(s, f).not.toMatch(/OPENAI_API_KEY|sk-[A-Za-z0-9]{10,}/);
    }
  });

  it("todo va por `api` (api-client) y las escrituras de la IA piden confirm cuando son destructivas", () => {
    const tab = fuentes.find(([f]) => f.endsWith("propuesta-ia-tab.tsx"))![1];
    expect(tab).toContain('from "@/lib/api-client"');
    expect(tab).toContain("confirm(");
    const modal = fuentes.find(([f]) => f.endsWith("generar-ia-modal.tsx"))![1];
    expect(modal).toContain("confirm(");
    const evaluaciones = fuentes.find(([f]) => f.endsWith("evaluaciones-tab.tsx"))![1];
    expect(evaluaciones).toContain("confirm(");
  });

  it("la página de administración es de servidor, valida admin y renderiza un panel de cliente", () => {
    const pagina = fuentes.find(([f]) => f.endsWith("administracion/ia/page.tsx"))![1];
    expect(pagina).not.toContain('"use client"');
    expect(pagina).toContain("perfilActual()");
    expect(pagina).toContain('r.rol !== "admin"');
    expect(pagina).toContain("<IaPanel />");
    expect(fuentes.find(([f]) => f.endsWith("ia-panel.tsx"))![1]).toContain('"use client"');
  });

  it("el comprador no entra a la proyección (la página ya lo saca) y el panel no muestra IA fuera de su pestaña", () => {
    const pagina = readFileSync(path.join(RAIZ, "src/app/(app)/planificacion/proyeccion/page.tsx"), "utf8");
    expect(pagina).toContain("puedeEditarMaestros(r.rol)");
    const panel = readFileSync(path.join(RAIZ, "src/app/(app)/planificacion/proyeccion/proyeccion-panel.tsx"), "utf8");
    expect(panel).toContain('pestana === "ia"');
  });

  it("usa el formato es-PE compartido (nada de toLocaleString suelto con otro locale)", () => {
    for (const [f, s] of fuentes) {
      expect(s, f).not.toMatch(/toLocaleString\(["'](en|es-ES|es-MX)/);
    }
  });
});
