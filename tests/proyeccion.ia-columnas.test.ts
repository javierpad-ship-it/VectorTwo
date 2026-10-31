import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ErrorApi } from "../src/lib/api-client";
import type { IaFilaApi } from "../src/lib/ia/tipos-api";
import { BloqueDecision } from "../src/app/(app)/planificacion/proyeccion/bloque-decision";
import { CeldaDecision } from "../src/app/(app)/planificacion/proyeccion/celda-decision";
import {
  aceptarIaDe,
  BloquePropuestaIa,
  CeldasIa,
  CeldasTotalIa,
  fechaCorta,
  nombreProveedor,
  PorQueIa,
  signado,
  textoAjusteMeta,
  textoCifraCambio,
  textoDecisionIa,
  textoPieIa,
  textoUPct,
  tieneExplicacionIa,
  tonoBrecha,
  totalesIa,
} from "../src/app/(app)/planificacion/proyeccion/columnas-ia";
import { desvioAlto, ETIQUETA_FUENTE_META, TablaMatriz, textoDesvioMeta } from "../src/app/(app)/planificacion/proyeccion/matriz-tab";
import { TablaFilas } from "../src/app/(app)/planificacion/proyeccion/tabla-filas";
import { aceptarIaFila, esIaApagada, valorActualDe } from "../src/app/(app)/planificacion/proyeccion/use-ia-filas";
import type { ErrorAccion, ResultadoAccion } from "../src/app/(app)/planificacion/proyeccion/use-proyeccion";
import { hojasMatriz } from "../src/lib/proyeccion/excel";
import type { MetaSiguienteApi } from "../src/lib/proyeccion/tipos-api";
import { bloques, filasDenim, nodo, proyeccion, registro, respuestaLineas, respuestaMatriz, Y } from "./proyeccion.pantalla.fixture";

/**
 * 07e (tanda 2, Frontend B): lo que la IA añade a Por línea, al detalle de la fila y a la Matriz. Sin red, con datos sintéticos (ninguna marca ni tienda real).
 * Las columnas IA solo existen con una propuesta vigente; sin ella la pantalla es la de siempre (R27: los textos de la IA salen siempre como texto).
 */

const RAIZ = path.resolve(__dirname, "..");
const DIR = "src/app/(app)/planificacion/proyeccion/";
const fuente = (ruta: string) => readFileSync(path.join(RAIZ, ruta), "utf8");
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const noop = () => {};
const sinAsync = () => Promise.resolve(true);

function iaFila(extra: Partial<IaFilaApi> = {}): IaFilaApi {
  return {
    fila_id: "f1",
    propuesta_fila_id: "pf-1",
    estado_meta: "libre",
    estado_gm: "al_dia",
    motivos: [],
    natural_y1: 20000,
    razon_natural: "Sube con la tendencia de los últimos años.",
    meta_y1: 21200,
    meta_y1_al_generar: 21000,
    absorbido_u: 200,
    absorbido_pct: 0.9,
    brecha_u: 1200,
    brecha_pct: 6,
    contra_metodo_u: 805,
    pct_sobre_corregida: 8.9,
    pct_sobre_real: 10.2,
    razon: "La meta pide un poco más que su ritmo natural.",
    banderas: ["quiebres"],
    senales: ["nino"],
    confianza: "media",
    avisos: [],
    aceptable: { y1: true, motivo: null },
    ...extra,
  };
}

describe("brecha, formato y totales (puros)", () => {
  it("la brecha es «forzada» desde +10 %, «muy forzada» desde +25 % y «cede» desde −10 %", () => {
    expect(tonoBrecha(null)).toBeNull();
    expect(tonoBrecha(9.9)).toBeNull();
    expect(tonoBrecha(0)).toBeNull();
    expect(tonoBrecha(-9.9)).toBeNull();
    expect(tonoBrecha(10)).toBe("forzada");
    expect(tonoBrecha(24.9)).toBe("forzada");
    expect(tonoBrecha(25)).toBe("muy_forzada");
    expect(tonoBrecha(-10)).toBe("cede");
    expect(tonoBrecha(-40)).toBe("cede");
  });

  it("cifras con signo, miles y decimales de es-PE; fechas dd/mm/aaaa sin zona horaria", () => {
    expect(signado(661)).toBe("+661");
    expect(signado(-1039)).toBe("-1,039");
    expect(signado(0)).toBe("0");
    expect(textoUPct(661, 6.4)).toBe("+661 u (+6.4 %)");
    expect(textoUPct(-309, -4.6)).toBe("-309 u (-4.6 %)");
    expect(textoUPct(120, null)).toBe("+120 u");
    expect(textoUPct(null, null)).toBe("—");
    expect(fechaCorta("2026-10-30T23:59:00-05:00")).toBe("30/10/2026");
    expect(fechaCorta(null)).toBe("—");
    expect(fechaCorta("ayer")).toBe("—");
    expect(nombreProveedor("openai")).toBe("OpenAI");
    expect(nombreProveedor("otro")).toBe("otro");
  });

  it("los totales de la línea suman solo las libres con natural y cifra IA; sin ninguna no hay pie", () => {
    const filas = [
      iaFila({ fila_id: "a", natural_y1: 1000, meta_y1: 1100, absorbido_u: -10 }),
      iaFila({ fila_id: "b", natural_y1: 500, meta_y1: 450, absorbido_u: 5 }),
      iaFila({ fila_id: "c", estado_meta: "fija_decidida", natural_y1: 900, meta_y1: null }),
      iaFila({ fila_id: "d", natural_y1: null, meta_y1: 300 }),
    ];
    const t = totalesIa(filas);
    expect(t).toEqual({ filas: 2, natural: 1500, conMeta: 1550, absorbido: -5, brecha_u: 50, brecha_pct: (1550 / 1500 - 1) * 100 });
    expect(textoPieIa(t)).toBe("IA en esta línea (2 filas libres): con meta 1,550 · natural 1,500 · brecha +50 u (+3.3 %).");
    expect(totalesIa([filas[2]])).toBeNull();
    expect(textoPieIa(null)).toBeNull();
  });

  it("los avisos de la pantalla: cifra que cambió y ajuste de las demás filas", () => {
    expect(textoCifraCambio(10940)).toBe("La cifra IA cambió a 10,940 porque se fijó otra fila del GM: revisa y acepta de nuevo.");
    expect(textoCifraCambio(null)).toBe("La cifra IA cambió porque se fijó otra fila del GM: revisa y acepta de nuevo.");
    expect(textoAjusteMeta("HOMBRE · URBANO")).toContain("Las demás filas libres de HOMBRE · URBANO se ajustaron para seguir sumando la meta");
    expect(textoAjusteMeta("HOMBRE · URBANO")).toContain("columna Absorbido");
  });

  it("«Aceptar IA» se ofrece con la cifra vista; sin cifra, fija, GM desactualizado o capacidad apagada va deshabilitada con su motivo", () => {
    expect(aceptarIaDe(iaFila(), noopAsync).motivo).toBeNull();
    expect(aceptarIaDe(iaFila(), noopAsync).valor).toBe(21200);
    expect(aceptarIaDe(iaFila({ meta_y1: null }), noopAsync).motivo).toBe("No hay cifra IA para esta fila");
    expect(aceptarIaDe(iaFila({ estado_meta: "fija_pct" }), noopAsync).motivo).toBe("La fila es fija: % propio");
    expect(aceptarIaDe(iaFila({ aceptable: { y1: false, motivo: "La propuesta de la IA está desactualizada: genérala otra vez." } }), noopAsync).motivo).toBe("La propuesta de la IA está desactualizada: genérala otra vez.");
    expect(aceptarIaDe(iaFila({ aceptable: { y1: false, motivo: null } }), noopAsync).motivo).toBe("La IA no se puede aceptar en esta fila");
  });
});

const noopAsync = () => Promise.resolve(true);

describe("celdas de la tabla y pie", () => {
  it("la fila libre muestra natural, con meta, absorbido y brecha; la forzada lleva su palabra", () => {
    const h = html(createElement("table", null, createElement("tbody", null, createElement("tr", null, createElement(CeldasIa, { ia: iaFila({ brecha_u: 5000, brecha_pct: 25 }) })))));
    expect(h).toContain("20,000");
    expect(h).toContain("21,200");
    expect(h).toContain("+200 u (+0.9 %)");
    expect(h).toContain("+5,000 u (+25.0 %)");
    expect(h).toContain("muy forzada");
    expect(h).toContain("font-bold text-alerta");
    expect(h).not.toContain("text-marca-oscura");
    const cede = html(createElement("table", null, createElement("tbody", null, createElement("tr", null, createElement(CeldasIa, { ia: iaFila({ brecha_u: -2200, brecha_pct: -10 }) })))));
    expect(cede).toContain("cede");
    expect(cede).toContain("text-marca-oscura");
  });

  it("la absorción alta se pinta en alerta con su aviso; el resto, normal", () => {
    const alta = html(createElement("table", null, createElement("tbody", null, createElement("tr", null, createElement(CeldasIa, { ia: iaFila({ avisos: ["absorcion_alta"], absorbido_u: -309, absorbido_pct: -13.2 }) })))));
    expect(alta).toContain("-309 u (-13.2 %)");
    expect(alta).toContain("más del 10 % de su cifra");
  });

  it("una fila fija dice por qué es fija y no muestra brecha ni absorbido", () => {
    for (const [estado, texto] of [
      ["fija_decidida", "fija: decidida"],
      ["fija_pct", "fija: % propio"],
      ["fija_cola_larga", "fija: cola larga"],
    ] as const) {
      const h = html(createElement("table", null, createElement("tbody", null, createElement("tr", null, createElement(CeldasIa, { ia: iaFila({ estado_meta: estado, meta_y1: null, brecha_u: null, brecha_pct: null, absorbido_u: null, absorbido_pct: null }) })))));
      expect(h).toContain(texto);
      expect(h).not.toContain("forzada");
    }
  });

  it("sin cifras para la fila (o la lectura caída) las cuatro celdas muestran «—»", () => {
    const h = html(createElement("table", null, createElement("tbody", null, createElement("tr", null, createElement(CeldasIa, { ia: undefined })))));
    expect(h.match(/<td/g)).toHaveLength(4);
    expect(h.match(/—/g)).toHaveLength(4);
  });

  it("los totales del pie caen bajo las cuatro columnas", () => {
    const t = totalesIa([iaFila({ natural_y1: 1000, meta_y1: 1100, absorbido_u: 0 })]);
    const h = html(createElement("table", null, createElement("tbody", null, createElement("tr", null, createElement(CeldasTotalIa, { totales: t })))));
    expect(h.match(/<td/g)).toHaveLength(4);
    expect(h).toContain("1,100");
    expect(html(createElement("table", null, createElement("tbody", null, createElement("tr", null, createElement(CeldasTotalIa, { totales: null })))))).toBe("<table><tbody><tr><td class=\"px-3 py-2\"></td><td class=\"px-3 py-2\"></td><td class=\"px-3 py-2\"></td><td class=\"px-3 py-2\"></td></tr></tbody></table>");
  });
});

describe("R27: los textos de la IA salen siempre como texto", () => {
  const maligna = "<script>alert(1)</script> **negrita** <img src=x onerror=alert(2)>";

  it("la razón, la razón del natural y la lectura de la IA se escapan: nada se interpreta como HTML ni como markdown", () => {
    const ia = iaFila({ razon: maligna, razon_natural: maligna });
    for (const h of [html(createElement(PorQueIa, { ia })), html(createElement(BloquePropuestaIa, { ia, anio: Y + 1 }))]) {
      expect(h).not.toContain("<script>");
      expect(h).not.toContain("<img");
      expect(h).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
      expect(h).toContain("**negrita**");
    }
  });

  it("en la tabla la razón solo viaja en un atributo `title`, escapado", () => {
    const h = html(createElement("table", null, createElement("tbody", null, createElement("tr", null, createElement(CeldasIa, { ia: iaFila({ razon: maligna, razon_natural: maligna }) })))));
    expect(h).not.toContain("<script>");
    expect(h).not.toContain("<img");
    expect(h).toContain("&lt;script&gt;");
  });

  it("ningún archivo de la pantalla usa dangerouslySetInnerHTML ni un intérprete de markdown", () => {
    const archivos = readdirSync(path.join(RAIZ, DIR)).filter((f) => /\.(ts|tsx)$/.test(f) && statSync(path.join(RAIZ, DIR, f)).isFile());
    for (const f of archivos) {
      const c = fuente(`${DIR}${f}`);
      expect(c, f).not.toContain("dangerouslySetInnerHTML");
      expect(c, f).not.toMatch(/from "(marked|markdown-it|react-markdown|remark[^"]*|dompurify)"/);
    }
  });
});

describe("tabla de filas con y sin las columnas de la IA", () => {
  const datos = respuestaLineas();
  const props = {
    filas: datos.filas,
    lineas: datos,
    secciones: [],
    anioEnCurso: Y,
    bloqueada: false,
    ocupado: false,
    filaSeleccionada: null,
    onSeleccionar: noop,
    onDecidir: sinAsync,
    onCsv: noop,
  };
  const ids = filasDenim().map((f) => f.id);
  const mapa = new Map<string, IaFilaApi>([
    [ids[0], iaFila({ fila_id: ids[0], meta_y1: 21200 })],
    [ids[1], iaFila({ fila_id: ids[1], propuesta_fila_id: "pf-2", natural_y1: 14000, meta_y1: 15700, brecha_u: 1700, brecha_pct: 12.1, razon: "Pesa más en la meta." })],
    [ids[2], iaFila({ fila_id: ids[2], propuesta_fila_id: "pf-3", estado_meta: "fija_decidida", meta_y1: null, aceptable: { y1: false, motivo: "La fila ya está decidida" } })],
  ]);

  it("sin IA (sin `verIa`, o encendido pero sin mapa ni nada) la tabla es idéntica a la de siempre", () => {
    const base = html(createElement(TablaFilas, props));
    expect(html(createElement(TablaFilas, { ...props, verIa: false, iaFilas: mapa, onAceptarIa: sinAsync }))).toBe(base);
    expect(base).not.toContain("Natural IA");
    expect(base).not.toContain("Aceptar IA");
    expect(base).not.toContain("¿por qué?");
  });

  it("con «Ver IA» la tabla gana las cuatro columnas entre la propuesta y la decisión de 2027, y cada fila su cifra", () => {
    const h = html(createElement(TablaFilas, { ...props, verIa: true, iaFilas: mapa, onAceptarIa: sinAsync }));
    for (const t of ["Natural IA", "IA con meta", "Absorbido", "Brecha"]) expect(h).toContain(t);
    expect(h.indexOf("2027 propuesto")).toBeLessThan(h.indexOf("Natural IA"));
    expect(h.indexOf("Brecha")).toBeLessThan(h.indexOf("2027 decidido"));
    expect(h).toContain("21,200");
    expect(h).toContain("15,700");
    expect(h).toContain("fija: decidida");
    // Las filas sin cifras de la IA (f4 y f5) muestran «—» en las cuatro celdas: 2 filas × 4 celdas.
    expect(h.match(/<td class="px-3 py-2 text-center text-tinta-suave">—<\/td>/g)).toHaveLength(8);
  });

  it("«Aceptar IA (cifra)» sale en las filas sin decidir y no en las ya decididas ni en las fijas habilitado", () => {
    const h = html(createElement(TablaFilas, { ...props, verIa: true, iaFilas: mapa, onAceptarIa: sinAsync }));
    expect(h).toContain("Aceptar IA (21,200)");
    expect(h).toContain("Aceptar IA (15,700)");
    // La tercera fila (f3) tiene el 2027 sin decidir en el fixture y es fija: el botón existe pero deshabilitado y con el motivo.
    expect(h).toMatch(/<button[^>]*disabled[^>]*title="La fila ya está decidida"[^>]*>Aceptar IA<\/button>|<button[^>]*title="La fila ya está decidida"[^>]*disabled[^>]*>Aceptar IA<\/button>/);
    // Sin el manejador no se ofrece.
    expect(html(createElement(TablaFilas, { ...props, verIa: true, iaFilas: mapa }))).not.toContain("Aceptar IA");
  });

  it("la fila con razón trae su «¿por qué?» y el pie de la línea dice la brecha", () => {
    const h = html(createElement(TablaFilas, { ...props, verIa: true, iaFilas: mapa, onAceptarIa: sinAsync }));
    expect(h).toContain("▸ ¿por qué?");
    expect(h).toContain("IA en esta línea (2 filas libres)");
  });

  it("con la lectura caída (`verIa` y mapa vacío) las columnas existen y todo es «—»", () => {
    const h = html(createElement(TablaFilas, { ...props, verIa: true, iaFilas: new Map(), onAceptarIa: sinAsync }));
    expect(h).toContain("Natural IA");
    expect(h).not.toContain("Aceptar IA");
    expect(h).not.toContain("IA en esta línea");
  });
});

describe("celda y bloque de decisión", () => {
  const celda = {
    anio: Y + 1,
    anioEnCurso: Y,
    bloqueada: false,
    ocupado: false,
    onDecidir: sinAsync,
    etiqueta: "RECONOCIDO, decidido 2027",
  };
  const decision = { propuesta_fila_id: "pf-1", proveedor: "openai", modelo: "modelo-prueba", version_prompt: "v1", generada_at: "2026-10-30T15:00:00Z" };

  it("la celda sin decidir ofrece «Aceptar IA (cifra)»; con la proyección bloqueada o la IA sin motivo, queda deshabilitado", () => {
    const aceptar = aceptarIaDe(iaFila(), sinAsync);
    const h = html(createElement(CeldaDecision, { ...celda, registro: registro(Y + 1), aceptarIa: aceptar }));
    expect(h).toContain("Aceptar IA (21,200)");
    expect(h).toContain("Aceptar la cifra de la IA: RECONOCIDO, decidido 2027");
    const b = html(createElement(CeldaDecision, { ...celda, bloqueada: true, registro: registro(Y + 1), aceptarIa: aceptar }));
    expect(b).toMatch(/<button[^>]*disabled[^>]*>Aceptar IA \(21,200\)<\/button>/);
    const sinCifra = html(createElement(CeldaDecision, { ...celda, registro: registro(Y + 1), aceptarIa: aceptarIaDe(iaFila({ meta_y1: null }), sinAsync) }));
    expect(sinCifra).toContain('title="No hay cifra IA para esta fila"');
  });

  it("la celda ya decidida no ofrece «Aceptar IA»; si la decisión vino de la IA lleva el badge «IA» y su traza", () => {
    const aceptar = aceptarIaDe(iaFila(), sinAsync);
    const manual = html(createElement(CeldaDecision, { ...celda, registro: registro(Y + 1, { decidido: 20000, origen: "manual", vigente: 20000 }), aceptarIa: aceptar }));
    expect(manual).not.toContain("Aceptar IA");
    expect(manual).not.toContain('aria-label="Cifra aceptada de la IA"');
    expect(manual).toContain("Volver a la propuesta");
    const ia = html(createElement(CeldaDecision, { ...celda, registro: registro(Y + 1, { decidido: 21200, origen: "manual", vigente: 21200, decision_ia: decision }) }));
    expect(ia).toContain('aria-label="Cifra aceptada de la IA"');
    expect(ia).toContain("OpenAI · modelo-prueba · prompt v1 · propuesta del 30/10/2026");
    expect(ia).toContain("Volver a la propuesta");
  });

  it("el bloque del detalle dice que la decisión vino de la IA (proveedor, modelo, prompt y fecha) y permite volver a la propuesta", () => {
    const props = { anio: Y + 1, anioEnCurso: Y, bloqueada: false, ocupado: false, factoresMes: null, onDecidir: sinAsync, onAplicarCurva: sinAsync };
    const h = html(createElement(BloqueDecision, { ...props, registro: registro(Y + 1, { decidido: 21200, origen: "manual", vigente: 21200, decision_ia: decision }) }));
    expect(h).toContain("La cifra decidida salió de la IA: OpenAI · modelo-prueba · prompt v1 · propuesta del 30/10/2026");
    expect(h).toContain("Volver a la propuesta");
    expect(textoDecisionIa(decision)).toBe("OpenAI · modelo-prueba · prompt v1 · propuesta del 30/10/2026");
    // Una decisión propia no habla de la IA.
    const propia = html(createElement(BloqueDecision, { ...props, registro: registro(Y + 1, { decidido: 20000, origen: "manual", vigente: 20000, decision_ia: null }) }));
    expect(propia).not.toContain("salió de la IA");
    expect(propia).not.toContain("Aceptar IA");
  });

  it("el bloque ofrece «Aceptar IA» entre sus botones solo con la fila sin decidir", () => {
    const props = { anio: Y + 1, anioEnCurso: Y, bloqueada: false, ocupado: false, factoresMes: null, onDecidir: sinAsync, onAplicarCurva: sinAsync, aceptarIa: aceptarIaDe(iaFila(), sinAsync) };
    expect(html(createElement(BloqueDecision, { ...props, registro: registro(Y + 1) }))).toContain("Aceptar IA (21,200)");
    expect(html(createElement(BloqueDecision, { ...props, registro: registro(Y + 1, { decidido: 20000, origen: "manual" }) }))).not.toContain("Aceptar IA");
    expect(html(createElement(BloqueDecision, { ...props, bloqueada: true, registro: registro(Y + 1) }))).not.toContain("Aceptar IA");
  });

  it("el bloque «Propuesta IA» muestra natural, con meta, absorbido, brecha, confianza, señales, lectura y el estado del GM", () => {
    const h = html(createElement(BloquePropuestaIa, { ia: iaFila({ estado_gm: "meta_movida", motivos: [], avisos: ["absorcion_alta", "base_movida"] }), anio: Y + 1 }));
    for (const t of ["Propuesta IA 2027", "Natural (sin meta)", "20,000", "21,200", "+1,200 u (+6.0 %)", "media", "Lectura de la IA", "quiebres", "Señales del sistema", "Niño", "GM meta movida", "regenera el GM"]) expect(h).toContain(t);
    expect(tieneExplicacionIa(iaFila())).toBe(true);
    expect(tieneExplicacionIa(iaFila({ razon: null, razon_natural: null, banderas: [], senales: [], avisos: [] }))).toBe(false);
    expect(tieneExplicacionIa(undefined)).toBe(false);
  });
});

describe("«Aceptar IA»: lo que se envía y cómo se maneja un 409 de cifra cambiada (sin red)", () => {
  afterEach(() => vi.restoreAllMocks());

  /** Como `useAccion().ejecutar`, sin React. */
  function accionFalsa() {
    const limpiar = vi.fn();
    const ejecutar = async <T>(accion: () => Promise<T>): Promise<ResultadoAccion<T>> => {
      try {
        return { ok: true, valor: await accion() };
      } catch (e) {
        const error: ErrorAccion = { mensaje: (e as Error).message, codigo: e instanceof ErrorApi ? e.codigo : null, detalle: e instanceof ErrorApi ? e.cuerpo : null };
        return { ok: false, error };
      }
    };
    return { ejecutar, limpiar };
  }

  it("envía la cifra que se vio como `valor_esperado`, con el año y la propuesta de la fila", async () => {
    const post = vi.spyOn(api, "post").mockResolvedValue({});
    const r = await aceptarIaFila(accionFalsa(), "/api/proyeccion/proyecciones/p1", "f1", Y + 1, iaFila());
    expect(r).toEqual({ ok: true });
    expect(post).toHaveBeenCalledWith("/api/proyeccion/proyecciones/p1/ia/filas/f1/aceptar", { anio: 2027, propuesta_fila_id: "pf-1", valor_esperado: 21200 });
  });

  it("sin cifra IA no llama a la API", async () => {
    const post = vi.spyOn(api, "post").mockResolvedValue({});
    const r = await aceptarIaFila(accionFalsa(), "/api/x", "f1", Y + 1, iaFila({ meta_y1: null }));
    expect(r).toEqual({ ok: false, cambio: false, valorActual: null });
    expect(post).not.toHaveBeenCalled();
  });

  it("`409 ia_valor_cambio` limpia el error de la acción y devuelve la cifra nueva (suelta o dentro de `data`)", async () => {
    for (const cuerpo of [{ valor_actual: 21040 }, { data: { valor_actual: 21040 } }]) {
      vi.spyOn(api, "post").mockRejectedValue(new ErrorApi("La cifra IA cambió", 409, "ia_valor_cambio", { error: "La cifra IA cambió", codigo: "ia_valor_cambio", ...cuerpo }));
      const accion = accionFalsa();
      const r = await aceptarIaFila(accion, "/api/x", "f1", Y + 1, iaFila());
      expect(r).toEqual({ ok: false, cambio: true, valorActual: 21040 });
      expect(accion.limpiar).toHaveBeenCalledTimes(1);
    }
    expect(valorActualDe(null)).toBeNull();
    expect(valorActualDe({ valor_actual: "x" })).toBeNull();
  });

  it("cualquier otro error no se traga: queda en la acción para mostrarse (no se limpia)", async () => {
    vi.spyOn(api, "post").mockRejectedValue(new ErrorApi("La IA está apagada", 409, "capacidad_apagada", {}));
    const accion = accionFalsa();
    const r = await aceptarIaFila(accion, "/api/x", "f1", Y + 1, iaFila());
    expect(r).toEqual({ ok: false, cambio: false, valorActual: null });
    expect(accion.limpiar).not.toHaveBeenCalled();
  });

  it("«IA apagada, sin permiso o sin ruta» no es un error que mostrar; un fallo de verdad sí", () => {
    expect(esIaApagada(new ErrorApi("x", 409, "ia_no_disponible"))).toBe(true);
    expect(esIaApagada(new ErrorApi("x", 409, "capacidad_apagada"))).toBe(true);
    expect(esIaApagada(new ErrorApi("x", 403))).toBe(true);
    expect(esIaApagada(new ErrorApi("x", 404))).toBe(true);
    expect(esIaApagada(new ErrorApi("x", 500))).toBe(false);
    expect(esIaApagada(new ErrorApi("x", 409, "otro"))).toBe(false);
    expect(esIaApagada(new Error("red caída"))).toBe(false);
  });
});

describe("Matriz: meta y desvío del GM", () => {
  const meta = (extra: Partial<MetaSiguienteApi> = {}): MetaSiguienteApi => ({ meta_gm: 26006, desvio_u: 1039, desvio_pct: 4, fuente: "gm", ...extra });
  const tabla = (nodos: ReturnType<typeof nodo>[]) =>
    html(createElement(TablaMatriz, { datos: { nodos }, proyeccion: proyeccion(), porMarca: false, plegados: new Set<string>(), onAlternar: noop, onIrALinea: noop, onIrATiendas: noop }));
  const nodos = (m: MetaSiguienteApi | null | undefined) => [
    nodo("compania", "Compañía", {}),
    nodo("genero", "HOMBRE", { genero_id: "g-h" }),
    nodo("mundo", "URBANO", { genero_id: "g-h", mundo_id: "m-u" }, m === undefined ? {} : { meta_siguiente: m }),
    nodo("linea", "DENIM", { genero_id: "g-h", mundo_id: "m-u", linea_id: "l-denim" }),
  ];

  it("sin meta en ningún nodo la matriz es la de siempre", () => {
    expect(tabla(nodos(undefined))).not.toContain("Desvío frente a la meta");
    expect(tabla(nodos(undefined))).not.toContain("Meta 2027");
    expect(tabla(nodos(null))).not.toContain("Desvío frente a la meta");
  });

  it("el nodo del GM muestra la meta, el desvío en u y %, y los demás niveles dejan la celda vacía", () => {
    const h = tabla(nodos(meta()));
    expect(h).toContain("Meta 2027");
    expect(h).toContain("Desvío frente a la meta");
    expect(h).toContain("26,006");
    expect(h).toContain("+1,039 u (+4.0 %)");
    expect(h).toContain("Es la garantía de la meta: cerrar no lo exige");
    // Cuatro nodos × dos celdas nuevas: el encabezado del año 2027 abarca 7 + 2 columnas.
    expect(h).toContain('colSpan="9"');
  });

  it("el desvío pasa a alerta solo por encima de ±1 %; la fuente distinta del GM se dice en la celda", () => {
    expect(desvioAlto({ desvio_pct: 1 })).toBe(false);
    expect(desvioAlto({ desvio_pct: -1.01 })).toBe(true);
    expect(desvioAlto({ desvio_pct: null })).toBe(false);
    expect(textoDesvioMeta({ desvio_u: -120, desvio_pct: -0.5 })).toBe("-120 u (-0.5 %)");
    expect(tabla(nodos(meta({ desvio_pct: 0.4, desvio_u: 100 })))).not.toContain("font-semibold text-alerta");
    expect(tabla(nodos(meta({ desvio_pct: 4 })))).toContain("font-semibold text-alerta");
    const provisional = tabla(nodos(meta({ fuente: "resto_provisional" })));
    expect(provisional).toContain(ETIQUETA_FUENTE_META.resto_provisional);
    expect(tabla(nodos(meta({ fuente: "resto" })))).toContain("Resto aprobado");
    expect(tabla(nodos(meta()))).not.toContain("GM aprobado</span>");
  });

  it("un GM sin meta (null) junto a otro con meta muestra «—»", () => {
    const h = tabla([...nodos(meta()), nodo("mundo", "FORMAL", { genero_id: "g-h", mundo_id: "m-f" }, { meta_siguiente: null })]);
    expect(h).toContain("Este género · mundo no tiene meta aprobada");
  });

  it("el Excel de la matriz ya trae las tres columnas de la meta (u, desvío en u y en %)", () => {
    const m = respuestaMatriz({ nodos: nodos(meta({ desvio_pct: 4.04 })) });
    const hojas = hojasMatriz({ nodos: m.nodos, bloques: bloques(), anio: Y, filtro: m.filtro, datosHasta: "2026-09", nombresFiltro: {} });
    const cab = hojas.MATRIZ[0];
    const i = cab.indexOf("META 2027");
    expect(i).toBeGreaterThan(0);
    expect(cab[i + 1]).toBe("DESVÍO FRENTE A LA META 2027");
    expect(cab[i + 2]).toBe("DESVÍO FRENTE A LA META 2027 %");
    const gm = hojas.MATRIZ.find((f) => f[1] === "URBANO");
    expect(gm?.slice(i, i + 3)).toEqual([26006, 1039, 4]);
  });
});

describe("Por línea y detalle: estructura", () => {
  it("la lectura de la IA es aparte, solo con `GET …/ia/filas`, y «Ver IA» vive en la URL con `ia=1`", () => {
    const l = fuente(`${DIR}linea-tab.tsx`);
    expect(l).toContain("useIaFilas(urlIa)");
    expect(l).toContain("/ia/filas?");
    expect(l).toContain("genero_id");
    expect(l).toContain('get("ia") === "1"');
    expect(l).toContain('aplicarCambiosUrl(window.location.search, { ia: valor ? "1" : null })');
    expect(l).toContain('label="Ver IA"');
    // Sin propuesta (nada que ver) el interruptor ni aparece.
    expect(l).toContain("acciones={hayIa ?");
    // No toca los archivos de otros dueños.
    expect(l).not.toContain("propuesta-ia-tab");
  });

  it("al fijar una fila las columnas de la IA se vuelven a pedir y las demás filas lo dicen una vez", () => {
    const l = fuente(`${DIR}linea-tab.tsx`);
    expect(l).toMatch(/Promise\.all\(\[lineas\.recargar\(\), onCambio\(\), iaFilas\.recargar\(\)\]\)/);
    expect(l).toContain("textoAjusteMeta(nombreGm)");
    expect(l).toContain("textoCifraCambio(r.valorActual)");
  });

  it("el error de la lectura de la IA se muestra con `Alert` (no bloquea) y el de aceptar con `AlertaError`", () => {
    const l = fuente(`${DIR}linea-tab.tsx`);
    expect(l).toContain("No se pudieron leer las columnas de la IA");
    expect(l).toMatch(/accion\.error && <AlertaError/);
    expect(fuente(`${DIR}detalle-fila.tsx`)).toMatch(/accion\.error && <AlertaError/);
  });

  it("la lectura de la IA y «Aceptar IA» van por /api con `api`; ninguna toca Supabase ni `fetch`", () => {
    const h = fuente(`${DIR}use-ia-filas.ts`);
    expect(h).toMatch(/api\s*\.get</);
    expect(h).toMatch(/api\.post\(`\$\{rutaProyeccion\}\/ia\/filas\/\$\{filaId\}\/aceptar`/);
    for (const f of ["use-ia-filas.ts", "columnas-ia.tsx"]) {
      const c = fuente(`${DIR}${f}`);
      expect(c, f).not.toMatch(/@supabase|supabase\/(browser|admin|server)|\bfetch\(/);
    }
  });

  it("el comprador no ve nada: la página redirige al rol sin permiso antes de montar el panel", () => {
    const p = fuente(`${DIR}page.tsx`);
    expect(p).toContain("puedeEditarMaestros(r.rol)");
    expect(p).toContain('redirect("/")');
  });
});
