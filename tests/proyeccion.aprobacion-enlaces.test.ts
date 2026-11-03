import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DecisionLoteApi } from "../src/lib/aprobacion/tipos-api";
import { BloqueDecision } from "../src/app/(app)/planificacion/proyeccion/bloque-decision";
import { BadgeDecisionLote, CeldaDecision, ayudaDecisionLote, decisionLoteDe, textoDecisionLote } from "../src/app/(app)/planificacion/proyeccion/celda-decision";
import { CerrarModal } from "../src/app/(app)/planificacion/proyeccion/cerrar-modal";
import { esLibreEnBloque, etiquetaEstadoFila, GmIaDetalleVista, textoDecisionFila } from "../src/app/(app)/planificacion/proyeccion/gm-ia-detalle";
import { destinoAprobarGm, fuenteAprobarGm, TablaGmIa, VistaPropuestaIa } from "../src/app/(app)/planificacion/proyeccion/propuesta-ia-tab";
import { estadoIa, filaDetalle, gmDetalle, gmResumen, gmMujerUrbano, CLAVE_HOMBRE_URBANO } from "./ia.pantalla.fixture";
import { proyeccion, registro, Y } from "./proyeccion.pantalla.fixture";

/** 07g, Frontend B: rótulos de «aprobada en bloque» y enlaces a la pestaña Aprobación desde Por línea, el detalle, el cierre y Propuesta IA. */

const nada = () => {};
const sinAsync = async () => true;
// React separa con comentarios los textos que vienen de varias expresiones: se quitan para comparar frases completas.
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el).replaceAll("<!-- -->", "");

const loteMetodo: DecisionLoteApi = { lote_id: "lote-1", tipo: "aprobar", created_at: "2026-11-03T15:20:00.000Z", usuario_nombre: "Ana Planner", fuente: "metodo" };
const loteIa: DecisionLoteApi = { ...loteMetodo, lote_id: "lote-2", fuente: "ia" };

describe("rótulo «Aprobada en bloque»", () => {
  it("dice la fuente y la fecha; una reaprobación lo dice; sin fuente solo el verbo", () => {
    expect(textoDecisionLote(loteMetodo)).toBe("Aprobada en bloque (Método) · 03/11/2026");
    expect(textoDecisionLote(loteIa)).toBe("Aprobada en bloque (IA) · 03/11/2026");
    expect(textoDecisionLote({ ...loteIa, tipo: "reaprobar" })).toBe("Reaprobada en bloque (IA) · 03/11/2026");
    expect(textoDecisionLote({ ...loteIa, fuente: null })).toBe("Aprobada en bloque · 03/11/2026");
    expect(ayudaDecisionLote(loteMetodo)).toContain("Ana Planner");
    expect(ayudaDecisionLote({ ...loteMetodo, usuario_nombre: null })).toBe("Aprobada en bloque (Método) · 03/11/2026");
  });

  it("el badge lleva «En bloque · IA» o «En bloque · Método» y el detalle en el título", () => {
    const s = html(createElement(BadgeDecisionLote, { decision: loteIa }));
    expect(s).toContain("En bloque · IA");
    expect(s).toContain("Aprobada en bloque (IA) · 03/11/2026 · Ana Planner");
    expect(html(createElement(BadgeDecisionLote, { decision: loteMetodo }))).toContain("En bloque · Método");
  });

  it("`decisionLoteDe` lee el lote del registro y da null sin él", () => {
    expect(decisionLoteDe(undefined)).toBeNull();
    expect(decisionLoteDe(registro(Y + 1, { decidido: 100, origen: "propuesta" }))).toBeNull();
    expect(decisionLoteDe(registro(Y + 1, { decidido: 100, origen: "propuesta", decision_lote: loteMetodo }))?.lote_id).toBe("lote-1");
  });
});

describe("celda y bloque de decisión con un lote", () => {
  const props = { anio: Y + 1, anioEnCurso: Y, bloqueada: false, ocupado: false, onDecidir: sinAsync, etiqueta: "RECONOCIDO, decidido 2027" };

  it("la celda decidida en bloque muestra el badge del lote; una a mano no", () => {
    const enBloque = html(createElement(CeldaDecision, { ...props, registro: registro(Y + 1, { decidido: 17600, origen: "propuesta", decision_lote: loteMetodo }) }));
    expect(enBloque).toContain("En bloque · Método");
    expect(enBloque).toContain("Volver a la propuesta");
    const aMano = html(createElement(CeldaDecision, { ...props, registro: registro(Y + 1, { decidido: 17600, origen: "manual" }) }));
    expect(aMano).not.toContain("En bloque");
  });

  it("con traza de IA y lote, el badge del lote sustituye al «IA» suelto (no se duplica)", () => {
    const decision_ia = { proveedor: "openai", modelo: "gpt-x", version_prompt: "v1", generada_at: "2026-10-30T10:00:00.000Z" } as never;
    const s = html(createElement(CeldaDecision, { ...props, registro: registro(Y + 1, { decidido: 17600, origen: "manual", decision_ia, decision_lote: loteIa }) }));
    expect(s).toContain("En bloque · IA");
    expect(s).not.toContain("Cifra aceptada de la IA");
    // Sin lote, el badge de «Aceptar IA» sigue como antes.
    expect(html(createElement(CeldaDecision, { ...props, registro: registro(Y + 1, { decidido: 17600, origen: "manual", decision_ia }) }))).toContain("Cifra aceptada de la IA");
  });

  it("una fila sin decidir no muestra lote aunque el registro lo traiga", () => {
    const s = html(createElement(CeldaDecision, { ...props, registro: registro(Y + 1, { decidido: null, decision_lote: loteIa }) }));
    expect(s).not.toContain("En bloque");
  });

  it("el bloque «Tu decisión» dice quién y cuándo y enlaza al lote", () => {
    const base = { anio: Y + 1, anioEnCurso: Y, bloqueada: false, ocupado: false, factoresMes: undefined, onDecidir: sinAsync, onAplicarCurva: sinAsync };
    const s = html(createElement(BloqueDecision, { ...base, registro: registro(Y + 1, { decidido: 17600, origen: "propuesta", decision_lote: loteMetodo }), enlaceLote: "/planificacion/proyeccion?pestana=aprobacion" }));
    expect(s).toContain("Aprobada en bloque (Método) · 03/11/2026 por Ana Planner");
    expect(s).toContain('href="/planificacion/proyeccion?pestana=aprobacion"');
    expect(s).toContain("Ver el lote");
    const sinEnlace = html(createElement(BloqueDecision, { ...base, registro: registro(Y + 1, { decidido: 17600, origen: "propuesta", decision_lote: loteMetodo }) }));
    expect(sinEnlace).not.toContain("Ver el lote");
    const aMano = html(createElement(BloqueDecision, { ...base, registro: registro(Y + 1, { decidido: 17600, origen: "manual" }), enlaceLote: "/x" }));
    expect(aMano).not.toContain("en bloque");
  });
});

describe("modal de cierre", () => {
  it("con filas sin decidir en el resumen ofrece «Aprobar en bloque»/«Ir a Aprobación» hacia la pestaña", () => {
    const s = html(createElement(CerrarModal, { proyeccion: proyeccion(), onCerrar: nada, onCerrada: nada, onRecalcular: nada }));
    expect(s).toContain("Ir a Aprobación");
    expect(s).toContain("pestana=aprobacion");
    expect(s).toContain("proyeccion=proy-1");
  });

  it("sin filas pendientes en el resumen no ofrece el enlace", () => {
    const p = proyeccion();
    const resumen = p.resumen ? { ...p.resumen, decididas: { 2026: 1689, 2027: 1689 } } : p.resumen;
    const s = html(createElement(CerrarModal, { proyeccion: { ...p, resumen }, onCerrar: nada, onCerrada: nada, onRecalcular: nada }));
    expect(s).not.toContain("Ir a Aprobación");
  });
});

describe("Propuesta IA: aprobar en bloque", () => {
  it("la fuente de un GM: IA con propuesta aceptable; método con filas del año en curso sin decidir; nada si no hay", () => {
    expect(fuenteAprobarGm(gmResumen())).toBe("ia");
    expect(fuenteAprobarGm(gmResumen({ estado: "meta_movida" }))).toBe("ia");
    expect(fuenteAprobarGm(gmResumen({ estado: "desactualizada", filas_y_sin_decidir: 3 }))).toBe("metodo");
    expect(fuenteAprobarGm(gmResumen({ estado: "sin_propuesta", propuesta: null, filas_y_sin_decidir: 0 }))).toBeNull();
  });

  it("«Aprobar este GM» lleva a 2027 con la IA y a 2026 con el método, con género y mundo", () => {
    const ia = destinoAprobarGm(gmResumen(), "proy-1", Y);
    expect(ia).toContain("pestana=aprobacion");
    expect(ia).toContain(String(Y + 1));
    expect(ia).toContain("gen-hombre");
    expect(ia).toContain("mun-urbano");
    const metodo = destinoAprobarGm(gmResumen({ estado: "desactualizada", filas_y_sin_decidir: 3 }), "proy-1", Y);
    expect(metodo).toContain(String(Y));
    expect(metodo).not.toContain(String(Y + 1));
    expect(destinoAprobarGm(gmResumen({ propuesta: null, estado: "sin_propuesta", filas_y_sin_decidir: 0 }), "proy-1", Y)).toBeNull();
    expect(destinoAprobarGm(gmResumen({ gm_clave: "resto" }), "proy-1", Y)).toBeNull();
  });

  it("la tabla ofrece «Aprobar este GM» solo con `aprobar` y solo donde hay qué aprobar", () => {
    const gms = [gmResumen(), gmMujerUrbano({ estado: "sin_propuesta", propuesta: null, filas_y_sin_decidir: 0 })];
    const con = html(createElement(TablaGmIa, { gms, onVer: nada, aprobar: { proyeccionId: "proy-1", anioEnCurso: Y } }));
    expect(con.match(/Aprobar este GM<\/a>/g)).toHaveLength(1);
    expect(html(createElement(TablaGmIa, { gms, onVer: nada }))).not.toContain("Aprobar este GM");
  });

  it("la vista pone «Aprobar en bloque» en la cabecera y lo dice en la nota de cierre; sin `aprobar` queda como antes", () => {
    const base = { estado: estadoIa(), anioSiguiente: Y + 1, esAdmin: true, bloqueada: false, onGenerar: nada, onVer: nada, onExcel: nada, onCancelarCorrida: nada, onIrAFactores: nada };
    const con = html(createElement(VistaPropuestaIa, { ...base, aprobar: { proyeccionId: "proy-1" } }));
    expect(con).toContain("Aprobar en bloque");
    // H4: la nota dice que las filas libres se deciden por línea o por lotes en Aprobación, y el enlace es solo «Ir a Aprobación».
    expect(con).toContain("por lotes en la pestaña Aprobación");
    expect(con).toContain("Ir a Aprobación</a>");
    const sin = html(createElement(VistaPropuestaIa, base));
    expect(sin).not.toContain("Aprobar en bloque");
    expect(sin).not.toContain("pestana=aprobacion");
  });
});

describe("detalle del GM: libre_en_bloque", () => {
  const enBloque = filaDetalle({ estado_meta: "libre_en_bloque" as never, decidida_y1: true, vigente_y1: 10961, meta_y1: 11223 });

  it("se reconoce, se etiqueta y se compara con la IA de hoy", () => {
    expect(esLibreEnBloque(enBloque)).toBe(true);
    expect(esLibreEnBloque(filaDetalle())).toBe(false);
    expect(etiquetaEstadoFila(enBloque)).toBe("libre · aprobada en bloque");
    expect(etiquetaEstadoFila(filaDetalle())).toBe("libre");
    const d = textoDecisionFila(enBloque);
    expect(d.texto).toBe("aprobada en bloque: 10,961 · IA hoy: 11,223");
    expect(d.reaprobable).toBe(true);
  });

  it("si la IA de hoy coincide con lo aprobado no hay nada que reaprobar; una libre normal sigue diciendo decidida o pendiente", () => {
    expect(textoDecisionFila({ ...enBloque, meta_y1: 10961 }).reaprobable).toBe(false);
    expect(textoDecisionFila(filaDetalle({ decidida_y1: false })).texto).toBe("pendiente");
    expect(textoDecisionFila(filaDetalle({ decidida_y1: true, vigente_y1: 500 })).texto).toBe("decidida · 500 u");
  });

  it("la tabla pinta la fila aprobada en bloque con su rótulo y el aviso de reaprobar", () => {
    const d = gmDetalle({ gm_clave: CLAVE_HOMBRE_URBANO, filas: [enBloque] });
    const s = html(createElement(GmIaDetalleVista, { detalle: d, anioEnCurso: Y, indice: [], onVolver: nada, onIrALinea: nada }));
    expect(s).toContain("libre · aprobada en bloque");
    expect(s).toContain("aprobada en bloque: 10,961 · IA hoy: 11,223");
    expect(s).toContain("se puede reaprobar en Aprobación");
  });
});
