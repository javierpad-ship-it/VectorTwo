import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChoqueModal } from "../src/app/(app)/planificacion/proyeccion/choque-modal";
import { CrecimientosTab, FormularioCrecimientos, PanelPromedio, ResultadoGuardado, TablaCrecimientos } from "../src/app/(app)/planificacion/proyeccion/crecimientos-tab";
import { borradorDesde, promedioParaPantalla, claveCelda, entradasPromedio } from "../src/app/(app)/planificacion/proyeccion/crecimientos-vista";
import { CerrarModal } from "../src/app/(app)/planificacion/proyeccion/cerrar-modal";
import { FormularioProyeccion } from "../src/app/(app)/planificacion/proyeccion/formulario-proyeccion";
import { PESTANAS } from "../src/app/(app)/planificacion/proyeccion/vista";
import { PieMatriz, TablaMatriz } from "../src/app/(app)/planificacion/proyeccion/matriz-tab";
import { bloques, proyeccion, respuestaMatriz, respuestaProyeccion } from "./proyeccion.pantalla.fixture";
import { conflicto, G_H, M_U, respuestaCrecimientos, respuestaCrecimientosVacia, resultadoGuardado } from "./proyeccion.crecimientos-pantalla.fixture";

/** Humo de render de la pestaña Crecimientos (07c): ningún componente lanza y los textos clave de la ficha salen. */

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const noop = () => {};
/** El atributo `disabled` del botón (no la clase `disabled:` de Tailwind). */
const deshabilitado = (tag: string | undefined) => /\sdisabled(=""|\s|>)/.test(tag ?? "");
const RAIZ = path.resolve(__dirname, "..");
const DIR = "src/app/(app)/planificacion/proyeccion/";
const fuente = (f: string) => readFileSync(path.join(RAIZ, DIR, f), "utf8");

const formulario = (datos = respuestaCrecimientos(), extra: Partial<Parameters<typeof FormularioCrecimientos>[0]> = {}) =>
  html(
    createElement(FormularioCrecimientos, {
      datos,
      proyeccion: proyeccion(),
      bloqueada: false,
      resultado: null,
      onCerrarResultado: noop,
      onGuardado: () => Promise.resolve(),
      onRecalcular: noop,
      onRecargar: noop,
      onCalculando: noop,
      ...extra,
    })
  );

describe("la matriz de crecimientos", () => {
  const datos = respuestaCrecimientos();
  const s = html(createElement(TablaCrecimientos, { datos, borrador: borradorDesde(datos), pctResto: 5, deshabilitada: false, onCelda: noop, onResto: noop }));

  it("filas = mundos reales; columnas = HOMBRE, MUJER y Resto; accesible con caption y encabezados de fila", () => {
    for (const m of ["FORMAL", "URBANO", "CASUAL"]) expect(s).toContain(`>${m}</th>`);
    expect(s).toContain('scope="col"');
    expect(s).toContain('scope="row"');
    expect(s).toContain("<caption");
    const cabecera = s.slice(s.indexOf("<thead"), s.indexOf("</thead>"));
    expect(cabecera.indexOf("HOMBRE")).toBeLessThan(cabecera.indexOf("MUJER"));
    expect(cabecera.indexOf("MUJER")).toBeLessThan(cabecera.indexOf("Resto"));
  });

  it("el Resto es UNA celda que abarca todas las filas", () => {
    expect(s.match(/rowSpan="3"/g)).toHaveLength(1);
    expect(s).toContain("JOVENCITOS 8,200 · NIÑOS 6,100 · ACCESORIOS 5,700");
    expect(s).toContain("base 20,000 u");
  });

  it("cada celda con filas lleva su % obligatorio, su nota y su base; una sin filas se ve «—»", () => {
    expect(s).toContain('aria-label="Crecimiento bruto de HOMBRE · FORMAL (%)"');
    expect(s).toContain('aria-label="Crecimiento bruto de MUJER · CASUAL (%)"');
    expect(s).toContain('aria-label="Crecimiento bruto de Resto (%)"');
    expect(s).toContain("required");
    expect(s).toContain('aria-label="Nota de HOMBRE · FORMAL"');
    expect(s).toContain("base 17,800 u · hoy 2027: 19,485 u");
    // Dos celdas sin filas: HOMBRE · CASUAL y MUJER · URBANO.
    expect(s.match(/>sin filas</g)).toHaveLength(2);
    expect(s).not.toContain('aria-label="Crecimiento bruto de HOMBRE · CASUAL (%)"');
    expect(s).not.toContain('aria-label="Crecimiento bruto de MUJER · URBANO (%)"');
  });

  it("insignias: con % propio, decidida y rebote del Niño solo como referencia", () => {
    expect(s).toContain("1 con % propio");
    expect(s).toContain("1 decidida");
    expect(s).toContain("rebote del Niño +9.6 %");
    expect(s).toContain("Es referencia: no se aplica");
  });

  it("una celda vacía lleva borde de alerta y «sigue al Resto (5 %)»; el extremo avisa", () => {
    const vacia = respuestaCrecimientosVacia();
    const sv = html(createElement(TablaCrecimientos, { datos: vacia, borrador: borradorDesde(vacia), pctResto: 5, deshabilitada: false, onCelda: noop, onResto: noop }));
    expect(sv).toContain("sigue al Resto (5 %)");
    expect(sv).toContain("border-alerta!");
    const b = borradorDesde(datos);
    b.celdas[claveCelda(G_H, M_U)].pct = "60";
    const se = html(createElement(TablaCrecimientos, { datos, borrador: b, pctResto: 5, deshabilitada: false, onCelda: noop, onResto: noop }));
    expect(se).toContain(">extremo<");
    const sb = html(createElement(TablaCrecimientos, { datos: respuestaCrecimientos({ celdas: datos.celdas.map((c) => (c.mundo_id === M_U ? { ...c, agregado: { ...c.agregado, base: 0 } } : c)) }), borrador: b, pctResto: 5, deshabilitada: false, onCelda: noop, onResto: noop }));
    expect(sb).toContain("sin base");
  });

  it("solo lectura: los campos van deshabilitados", () => {
    const sl = html(createElement(TablaCrecimientos, { datos, borrador: borradorDesde(datos), pctResto: 5, deshabilitada: true, onCelda: noop, onResto: noop }));
    expect(sl.match(/disabled=""/g)!.length).toBeGreaterThanOrEqual(5);
  });

  it("se adapta al móvil (scroll horizontal) y usa solo los tokens del tema", () => {
    expect(s).toContain("overflow-x-auto");
    expect(s).not.toMatch(/#[0-9a-fA-F]{3,6}|\b(bg|text|border)-(red|green|blue|gray|slate|white|black)-?\d*/);
  });

  it("sin mundos con filas de Hombre o Mujer: todo sigue el Resto", () => {
    const sin = html(createElement(TablaCrecimientos, { datos: respuestaCrecimientos({ mundos: [], celdas: [] }), borrador: borradorDesde(datos), pctResto: 5, deshabilitada: false, onCelda: noop, onResto: noop }));
    expect(sin).toContain("Todo sigue el Resto");
    expect(sin).toContain('aria-label="Crecimiento bruto de Resto (%)"');
  });
});

describe("el formulario de la pestaña", () => {
  it("matriz completa: Calcular promedio y un ÚNICO botón de guardado, «Guardar y recalcular»; sin «Guardar» suelto", () => {
    const s = formulario();
    expect(s).toContain("Calcular promedio");
    expect(s).toContain("Guardar y recalcular");
    expect(s).toContain("Descartar cambios");
    expect(s).not.toMatch(/>Guardar</);
    expect(s).not.toContain("Usar");
    expect(s).toContain("Objetivo global (%)");
    expect(s).toContain("Crecimiento bruto 2027 frente a 2026 de las mismas tiendas de 2027 (10 tiendas)");
  });

  it("con una celda vacía los dos botones están deshabilitados y el mensaje enumera las que faltan", () => {
    const s = formulario(respuestaCrecimientosVacia());
    expect(s).toContain("Faltan 4 celdas: HOMBRE · FORMAL, MUJER · FORMAL, HOMBRE · URBANO y MUJER · CASUAL. Escribe un % en cada una (puede ser el mismo del Resto).");
    const calcular = /<button[^>]*>Calcular promedio<\/button>/.exec(s)?.[0] ?? "";
    const guardar = /<button[^>]*>Guardar y recalcular<\/button>/.exec(s)?.[0] ?? "";
    expect(deshabilitado(calcular)).toBe(true);
    expect(deshabilitado(guardar)).toBe(true);
    expect(calcular).toContain("aria-describedby");
  });

  it("completa y al día: ninguno de los dos está deshabilitado", () => {
    const s = formulario();
    expect(deshabilitado(/<button[^>]*>Calcular promedio<\/button>/.exec(s)?.[0])).toBe(false);
    expect(deshabilitado(/<button[^>]*>Guardar y recalcular<\/button>/.exec(s)?.[0])).toBe(false);
  });

  it("proyección de antes de 0.10.8: avisa «método anterior» con Recalcular y deshabilita Calcular promedio (Guardar y recalcular la pone al día)", () => {
    const s = formulario(respuestaCrecimientos({ metodo_viejo: true, al_dia: false }));
    expect(s).toContain("Calculada con el método anterior: recalcula.");
    expect(s).toContain("Recalcula: método nuevo");
    expect(deshabilitado(/<button[^>]*>Calcular promedio<\/button>/.exec(s)?.[0])).toBe(true);
    expect(deshabilitado(/<button[^>]*>Guardar y recalcular<\/button>/.exec(s)?.[0])).toBe(false);
  });

  it("matriz guardada pero sin aplicar: la alerta ofrece Recalcular", () => {
    const s = formulario(respuestaCrecimientos({ al_dia: false }));
    expect(s).toContain("Los crecimientos guardados no están aplicados (falló el recálculo o un nodo cambió de mundo).");
    expect(s).toContain(">Recalcular</button>");
  });

  it("falta un género del catálogo: lo dice y sus filas siguen el Resto", () => {
    const s = formulario(respuestaCrecimientos({ generos_faltantes: ["MUJER"] }));
    expect(s).toContain("No se encontró el género MUJER en el catálogo: sus filas siguen el Resto.");
  });

  it("cerrada o archivada: todo se ve y nada se edita; Calcular promedio sigue disponible", () => {
    const s = formulario(respuestaCrecimientos({ editable: false }), { proyeccion: proyeccion({ estado: "cerrada" }) });
    expect(s).toContain("los crecimientos se ven pero no se editan");
    expect(s).not.toContain("Guardar y recalcular");
    expect(s).not.toContain("Descartar cambios");
    expect(deshabilitado(/<button[^>]*>Calcular promedio<\/button>/.exec(s)?.[0])).toBe(false);
  });

  it("mientras la pantalla calcula (bloqueada) los campos y el guardado van deshabilitados sin cambiar de sitio", () => {
    const s = formulario(respuestaCrecimientos(), { bloqueada: true });
    expect(deshabilitado(/<button[^>]*>Guardar y recalcular<\/button>/.exec(s)?.[0])).toBe(true);
    expect(s).toContain("Guardar y recalcular");
  });

  it("tras guardar: éxito, recálculo fallido con Recalcular y filas editadas mientras se guardaba", () => {
    const ok = html(createElement(ResultadoGuardado, { resultado: resultadoGuardado({ conservadas: 2, pisadas: [{ fila_id: "fila-pantalon", pct_anterior: 5, decidido_anterior: null }] }), nombres: { "fila-pantalon": "HOMBRE · FORMAL · PANTALON" }, onCerrar: noop, onRecalcular: noop }));
    expect(ok).toContain("Guardado y recalculado.");
    expect(ok).toContain("2 filas fijadas a mano conservaron");
    expect(ok).toContain("HOMBRE · FORMAL · PANTALON: tenía +5.0 % propio");
    const mal = html(createElement(ResultadoGuardado, { resultado: resultadoGuardado({ recalculo: { ok: false, codigo: "x", mensaje: "falló el cálculo" } }), nombres: {}, onCerrar: noop, onRecalcular: noop }));
    expect(mal).toContain("Se guardó la matriz pero no se pudo recalcular: falló el cálculo");
    expect(mal).toContain(">Recalcular</button>");
    expect(mal).not.toContain("Guardado y recalculado.");
    const rev = html(createElement(ResultadoGuardado, { resultado: resultadoGuardado({ revertidas: ["a", "b"] }), nombres: {}, onCerrar: noop, onRecalcular: noop }));
    expect(rev).toContain("2 filas se editaron mientras guardabas");
  });

  it("la pestaña, antes de leer, muestra la carga (los datos vienen de /api)", () => {
    const s = html(createElement(CrecimientosTab, { proyeccion: proyeccion(), bloqueada: false, onCambio: () => Promise.resolve(), onRecalcular: noop, onCalculando: noop }));
    expect(s).toContain("Leyendo los crecimientos…");
  });
});

describe("Calcular promedio: el panel", () => {
  const r = respuestaCrecimientos();
  const e = entradasPromedio(r, borradorDesde(r));
  if (!e.ok) throw new Error("completa");
  const res = promedioParaPantalla(e.entradas, e.resto, 12, r.puente);
  const s = html(createElement(PanelPromedio, { resultado: res, obsoleto: false, anioEnCurso: 2026, anioSiguiente: 2027 }));

  it("tabla por celda con el Resto y el total, ponderado vs resultado, objetivo en pp y unidades, y el puente al Total", () => {
    expect(s).toContain("HOMBRE · FORMAL");
    expect(s).toContain("19,485");
    expect(s).toContain("Resto");
    expect(s).toContain("Total (mismas tiendas)");
    expect(s).toContain("+11.7 %");
    expect(s).toContain("+10.2 % · 132,185 u");
    expect(s).toContain("te faltan 0.3 pp");
    expect(s).toContain("≈ 2,215 u");
    expect(s).toContain("llevan el total de +11.7 % a +10.2 %");
    expect(s).toContain("Puente al Total 2027 de la Matriz");
    expect(s).toContain("133,099 u");
    expect(s).toContain("914 u");
    expect(s).toContain("±0.5 u por fila");
  });

  it("con cierres sin decidir los muestra en 0 con el aviso; si se editó después de calcular, el panel se marca vencido", () => {
    const c = promedioParaPantalla(e.entradas, e.resto, null, { ...r.puente, cierres_sin_decidir: 1 });
    expect(html(createElement(PanelPromedio, { resultado: c, obsoleto: false, anioEnCurso: 2026, anioSiguiente: 2027 }))).toContain("0 u (1 tienda sin decidir)");
    const viejo = html(createElement(PanelPromedio, { resultado: res, obsoleto: true, anioEnCurso: 2026, anioSiguiente: 2027 }));
    expect(viejo).toContain("Cambiaste celdas: vuelve a calcular.");
    expect(s).not.toContain("Cambiaste celdas");
  });

  it("sin objetivo no hay comparación", () => {
    const sin = html(createElement(PanelPromedio, { resultado: promedioParaPantalla(e.entradas, e.resto, null, r.puente), obsoleto: false, anioEnCurso: 2026, anioSiguiente: 2027 }));
    expect(sin).not.toContain("Objetivo +");
  });
});

describe("Modal del choque: Pisar / Conservar / Cancelar", () => {
  const modal = (extra: Partial<Parameters<typeof ChoqueModal>[0]> = {}) =>
    html(createElement(ChoqueModal, { conflicto: conflicto(), anioSiguiente: 2027, listaCambio: false, ocupado: false, onPisar: noop, onConservar: noop, onCancelar: noop, ...extra }));

  it("título, las dos secciones con sus tablas y la casilla desmarcada por defecto", () => {
    const s = modal();
    expect(s).toContain("Este cambio choca con filas fijadas a mano.");
    expect(s).toContain("12 filas tienen un % propio");
    expect(s).toContain("5 % → 12 %");
    expect(s).toContain("PANTALON · VALOR");
    expect(s).toContain("5 filas tienen el total de 2027 decidido: conservan su cifra y mostrarán «propuesta cambió»");
    expect(s).toContain("10,800 → 11,500");
    expect(s).toContain("Pisar también estas 5 decisiones (vuelven a la propuesta nueva)");
    const casilla = /<input[^>]*type="checkbox"[^>]*>/.exec(s)?.[0] ?? "";
    expect(casilla).not.toContain("checked");
    for (const b of ["Pisar", "Conservar", "Cancelar"]) expect(s).toContain(`>${b}</button>`);
    expect(s).toContain("Se muestran 1 de 12.");
  });

  it("sin filas decididas no hay segunda sección ni casilla; sin filas con % propio no hay primera", () => {
    const sin = modal({ conflicto: conflicto({ decididas: { total: 0, filas: [] } }) });
    expect(sin).not.toContain("total de 2027 decidido");
    expect(sin).not.toContain('type="checkbox"');
    const solo = modal({ conflicto: conflicto({ pct_propio: { total: 0, filas: [] } }) });
    expect(solo).not.toContain("tienen un % propio");
    expect(solo).toContain("total de 2027 decidido");
  });

  it("cuando la lista cambió avisa; mientras guarda bloquea los tres botones", () => {
    expect(modal({ listaCambio: true })).toContain("La lista cambió mientras decidías: revisa la lista nueva antes de elegir.");
    expect(modal()).not.toContain("La lista cambió");
    const s = modal({ ocupado: true });
    expect(s).toContain("Guardando y recalculando… (hasta 30 s)");
    for (const b of ["Pisar", "Conservar", "Cancelar"]) expect(new RegExp(`<button[^>]*disabled[^>]*>${b}</button>`).test(s)).toBe(true);
  });
});

describe("Matriz (Parte 2): columna «Crec. mismas tiendas»", () => {
  const datos = respuestaMatriz();
  const s = html(createElement(TablaMatriz, { datos, proyeccion: proyeccion(), porMarca: false, plegados: new Set<string>(), onAlternar: noop, onIrALinea: noop, onIrATiendas: noop }));

  it("va junto a «Var.» con su título que explica la diferencia", () => {
    expect(s).toContain("Crec. mismas tiendas");
    expect(s.indexOf("Var.")).toBeLessThan(s.indexOf("Crec. mismas tiendas"));
    expect(s).toContain("Var. = Total 2027 ÷ Total 2026 (incluye tiendas nuevas, aperturas y cierres).");
    expect(s).toContain("Crec. mismas tiendas = 2027 de las mismas tiendas ÷ su 2026: es lo que escribes en Crecimientos.");
    expect(s).toContain("+9.8 %");
  });

  it("el pie sigue mostrando las líneas y las filas para revisión", () => {
    expect(html(createElement(PieMatriz, { resumen: datos.resumen, anioEnCurso: 2026, solo: "", onVerRevision: noop }))).toContain("filas para revisión");
  });
});

describe("el resto de la pantalla (07c)", () => {
  it("«Crecimientos» va entre «Tiendas nuevas y cierres» y «Por línea»", () => {
    const ids = PESTANAS.map((p) => p.id);
    expect(ids.indexOf("crecimientos")).toBe(ids.indexOf("tiendas") + 1);
    expect(ids.indexOf("linea")).toBe(ids.indexOf("crecimientos") + 1);
    expect(PESTANAS.find((p) => p.id === "crecimientos")?.etiqueta).toBe("Crecimientos");
  });

  it("cerrar con crecimientos sin aplicar: no se puede forzar y ofrece recalcular", () => {
    const p = proyeccion({ desactualizada: [{ codigo: "crecimientos_cambiados", mensaje: "x" }] });
    const s = html(createElement(CerrarModal, { proyeccion: p, onCerrar: noop, onCerrada: noop, onRecalcular: noop }));
    expect(s).toContain("este motivo no se puede saltar");
    expect(s).not.toContain("Cerrar de todos modos");
    const otro = html(createElement(CerrarModal, { proyeccion: proyeccion({ desactualizada: [{ codigo: "cargas_nuevas", mensaje: "x" }] }), onCerrar: noop, onCerrada: noop, onRecalcular: noop }));
    expect(otro).toContain("Cerrar de todos modos");
  });

  it("nueva proyección: el campo es el Resto bruto y, al editar, se cambia el campo por un enlace a la pestaña", () => {
    const estado = respuestaProyeccion();
    const nueva = html(createElement(FormularioProyeccion, { estado, bloques: bloques(), perfiles: [], onCerrar: noop, onGuardada: noop }));
    expect(nueva).toContain("Crecimiento bruto del año siguiente (Resto) (%)");
    const edit = html(createElement(FormularioProyeccion, { estado, proyeccion: proyeccion(), bloques: bloques(), perfiles: [], onCerrar: noop, onGuardada: noop, onIrACrecimientos: noop }));
    expect(edit).not.toContain("Crecimiento bruto del año siguiente (Resto) (%)");
    expect(edit).toContain("Se edita en la pestaña Crecimientos");
    expect(edit).toContain("Ir a Crecimientos");
  });
});

describe("estructura de la pestaña Crecimientos", () => {
  it("el único guardado es «Guardar y recalcular» (PUT con reintento de la huella del choque); nunca manda `resolucion` sin que Javier pulse", () => {
    const c = fuente("crecimientos-tab.tsx");
    expect(c.startsWith('"use client"')).toBe(true);
    expect(c).toContain("api.put<RespuestaGuardarCrecimientosApi>");
    expect(c).toContain("/crecimientos`");
    expect(c).not.toMatch(/api\.(post|patch)/);
    expect(c).toContain("Guardar y recalcular");
    expect(c).not.toMatch(/>\s*Guardar\s*</);
    // La resolución solo sale de los manejadores del Modal.
    const usos = [...c.matchAll(/resolucion:\s*"(pisar|conservar)"/g)].map((m) => m[1]);
    expect(usos.sort()).toEqual(["conservar", "pisar"]);
    expect(c).toContain("huella_choque: conflicto.datos.huella_choque");
    expect(c).toContain("key={conflicto.datos.huella_choque}");
  });

  it("los errores de la API se muestran con Alert y la matriz parte de lo guardado (key = huella)", () => {
    const c = fuente("crecimientos-tab.tsx");
    expect(c).toContain("<AlertaError");
    expect(c).toContain("key={datos.huella}");
    expect(c).toContain("confirm(");
  });

  it("usa los tokens del tema y no mete librerías ni colores sueltos", () => {
    for (const f of ["crecimientos-tab.tsx", "choque-modal.tsx", "crecimientos-vista.ts"]) {
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
