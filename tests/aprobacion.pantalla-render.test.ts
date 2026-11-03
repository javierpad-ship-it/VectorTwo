import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AprobacionTab, CabeceraAprobacion, ListaAprobacion } from "../src/app/(app)/planificacion/proyeccion/aprobacion-tab";
import { PARAMETROS_APROBACION_INICIALES, combinarResultados, type ParametrosAprobacion } from "../src/app/(app)/planificacion/proyeccion/aprobacion-vista";
import { ResumenResultado, VistaConfirmacion, nombresDe, type VistaConfirmacionProps } from "../src/app/(app)/planificacion/proyeccion/confirmar-lote-modal";
import { HistorialLotes } from "../src/app/(app)/planificacion/proyeccion/historial-lotes";
import type { EstadoConfirmacion, SimulacionLote } from "../src/app/(app)/planificacion/proyeccion/use-aprobacion";
import { GM_HU, GM_NI, Y, Y1, datos, efecto, fila, fila2026, filaConfianzaBaja, filaLote, filaSinCifraIa, filaSinIa, gm, lote, resultado, resultadoFila, uuid } from "./aprobacion.pantalla.fixture";
import type { ProyeccionApi } from "../src/lib/proyeccion/tipos-api";

/** Humo de render con datos sintéticos (07g §4): nada lanza, salen los textos de la ficha, la fuente va siempre y las cifras de la IA se pintan como texto. */

const nada = () => {};
// React separa con comentarios los textos que vienen de varias expresiones: se quitan para comparar frases completas.
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el).replaceAll("<!-- -->", "");
const P = (o: Partial<ParametrosAprobacion> = {}): ParametrosAprobacion => ({ ...PARAMETROS_APROBACION_INICIALES, ...o });
const SIN_FILTRO = { genero: "", mundo: "", linea: "", agrupacion_marca: "" };

function cabecera(o: Partial<Parameters<typeof CabeceraAprobacion>[0]> = {}) {
  return createElement(CabeceraAprobacion, {
    datos: datos(),
    anio: Y1,
    anioEnCurso: Y,
    bloqueada: false,
    onAnio: nada,
    onReaprobar: nada,
    onVolverAAprobar: nada,
    onRecalcular: nada,
    onIrAFactores: nada,
    onIrACrecimientos: nada,
    onIrATiendas: nada,
    ...o,
  });
}

function lista(d = datos(), o: Partial<Parameters<typeof ListaAprobacion>[0]> = {}) {
  return createElement(ListaAprobacion, { datos: d, filtro: SIN_FILTRO, parametros: P(), editable: true, onRevisar: nada, ...o });
}

describe("cabecera (§4.2)", () => {
  it("dice lo que falta para cerrar, con las tiendas, y las pestañas de año con su cuenta", () => {
    const t = html(cabecera());
    expect(t).toContain("Para cerrar faltan: 2026 · 679 filas · 2027 · 686 filas · 290 para revisión · 3 tiendas nuevas");
    expect(t).toContain("Tiendas nuevas y cierres");
    expect(t).toContain("2026 · Método (679)");
    expect(t).toContain("2027 · IA (686)");
    expect(t).toContain("Aprueba el año en curso primero");
    expect(t).toContain("IA encendida · propuesta vigente en 1 de 2 GM");
  });

  it("IA apagada y corrida en curso", () => {
    expect(html(cabecera({ datos: datos({ ia: { disponible: false, motivo: "La capacidad está apagada.", corrida_en_curso: false, gms_con_propuesta: 0 } }) }))).toContain("IA apagada: 2027 se aprueba con el método solo en GM sin IA.");
    expect(html(cabecera({ datos: datos({ ia: { disponible: true, motivo: null, corrida_en_curso: true, gms_con_propuesta: 1 } }) }))).toContain("Hay una corrida de IA en curso");
  });

  it("avisa de las filas aprobadas en bloque que cambiaron de propuesta y ofrece «Reaprobar» por año", () => {
    const t = html(cabecera({ datos: datos({ reaprobables: { y: 12, y1: 30 } }) }));
    expect(t).toContain("42 filas aprobadas en bloque cambiaron de propuesta tras el último recálculo");
    expect(t).toContain("Reaprobar 2026 (12)");
    expect(t).toContain("Reaprobar 2027 (30)");
  });

  it("en modo reaprobar explica que no toca lo decidido a mano y deja volver", () => {
    const t = html(cabecera({ datos: datos({ modo: "reaprobar", reaprobables: { y: 12, y1: 30 } }) }));
    expect(t).toContain("No toca nada decidido a mano");
    expect(t).toContain("Volver a aprobar");
    expect(t).not.toContain("Reaprobar 2026 (12)");
  });

  it("bloqueos (D14): cada uno con su mensaje y su enlace", () => {
    const t = html(
      cabecera({
        datos: datos({
          bloqueos: [
            { codigo: "proyeccion_desactualizada", mensaje: "La proyección está desactualizada: recalcula." },
            { codigo: "factor_faltante", mensaje: "Falta el factor del Niño." },
            { codigo: "crecimientos_sin_aprobar", mensaje: "Faltan crecimientos." },
          ],
        }),
      })
    );
    expect(t).toContain("La proyección está desactualizada: recalcula.");
    expect(t).toContain("Recalcular la proyección");
    expect(t).toContain("Ir a Factores del Niño");
    expect(t).toContain("Ir a Crecimientos");
    expect(t).toContain("Mientras haya un bloqueo no hay casillas");
  });

  it("proyección cerrada: solo lectura", () => {
    expect(html(cabecera({ bloqueada: true }))).toContain("solo lectura");
  });
});

describe("lista y tabla (§4.3)", () => {
  it("2027: columnas de IA, rótulos de fuente siempre, método en GM sin IA con su propio badge", () => {
    const t = html(lista());
    for (const c of ["IA con meta", "Natural IA", "Brecha", "vs método", "Absorbido", "Confianza", "Se aprueba con"]) expect(t).toContain(c);
    expect(t).toContain("HOMBRE · URBANO");
    expect(t).toContain("NIÑA · CASUAL");
    expect(t).toContain(">IA<");
    expect(t).toContain("Método · GM sin IA");
    expect(t).toContain("10,961");
  });

  it("2026: sin columnas de IA y con el rótulo «Método»", () => {
    const d = datos({ anio: Y, filas: [fila2026(1), fila2026(2, { motivo_cierre: "revision_cola_larga" })], ia: { disponible: false, motivo: null, corrida_en_curso: false, gms_con_propuesta: 0 } });
    const t = html(lista(d));
    expect(t).not.toContain("Natural IA");
    expect(t).toContain(">Método<");
    expect(t).toContain("para revisión");
  });

  it("la fila de confianza baja se ve, sin casilla habilitada y con su motivo escrito", () => {
    const d = datos({ filas: [filaConfianzaBaja(3), filaSinCifraIa(4)] });
    const t = html(lista(d));
    expect(t).toContain("Confianza baja o sin dato: se decide en Por línea.");
    expect(t).toContain("se decide en Por línea");
    expect(t).toContain("Libre sin cifra de la IA: decídela en Por línea o regenera el GM.");
    // Las dos casillas de fila (y la del GM, sin filas aprobables) están deshabilitadas.
    expect((t.match(/type="checkbox"[^>]*\sdisabled=""/g) ?? []).length).toBe(3);
  });

  it("«Solo sin avisos fuertes» deja fuera la fila fuerte; la barra empieza sin selección", () => {
    const d = datos({ filas: [fila(1), fila(2, { avisos_fuertes: true })] });
    const t = html(lista(d));
    expect(t).toContain("1 fila visible");
    expect(t).toContain("Seleccionar las 1 visibles");
    expect(t).toContain("Marca las filas que quieres aprobar.");
    expect(html(lista(d, { parametros: P({ incluirFuertes: true }) }))).toContain("2 filas visibles");
  });

  it("modo reaprobar: columna «Aprobada → hoy» y botón «Revisar y reaprobar»", () => {
    const d = datos({ modo: "reaprobar", filas: [fila(1, { decidido: 10900 })], reaprobables: { y: 0, y1: 1 } });
    const t = html(lista(d));
    expect(t).toContain("Aprobada → hoy");
    expect(t).toContain("10,900 → 10,961");
    expect(t).toContain("Revisar y reaprobar");
  });

  it("con bloqueos o proyección cerrada no hay casillas habilitadas ni botón para aprobar", () => {
    const t = html(lista(datos(), { editable: false }));
    expect((t.match(/type="checkbox"/g) ?? []).length).toBeGreaterThan(0);
    expect((t.match(/type="checkbox"(?![^>]*\sdisabled="")/g) ?? []).length).toBe(0);
    expect(t).toMatch(/<button[^>]*\sdisabled=""[^>]*>Revisar y aprobar/);
  });

  it("sin filas: dice que no queda nada que bloquee el cierre", () => {
    expect(html(lista(datos({ filas: [] })))).toContain("No quedan filas que bloqueen el cierre en 2027");
    expect(html(lista(datos({ filas: [], modo: "reaprobar" })))).toContain("Nada que reaprobar en 2027");
  });

  it("las razones y los nombres se pintan como texto, no como HTML", () => {
    const hostil = fila(1, { linea: '<img src=x onerror="alert(1)">', agrupacion_marca: "<b>X</b>" });
    const t = html(lista(datos({ filas: [hostil] }), { parametros: P(), filtro: SIN_FILTRO }));
    expect(t).not.toContain("<img");
    expect(t).not.toContain("<b>X</b>");
    expect(t).toContain("&lt;img");
  });
});

// ─── Confirmación (§4.4) ───

function simulacion(o: { filas?: ReturnType<typeof resultadoFila>[]; revision?: boolean; crecimientos?: boolean } = {}): SimulacionLote {
  const filas = o.filas ?? [resultadoFila(1), resultadoFila(2, { valor: 6677, brecha_u: -23 }), resultadoFila(4, { gm_clave: GM_NI, fuente: "metodo", valor: 841, brecha_u: null })];
  const r = resultado(filas, {
    efecto_gm: [efecto({ desvio_despues_u: 400 }), efecto({ gm_clave: GM_NI, meta_antes: null, meta_despues: null, desvio_antes_u: null, desvio_despues_u: null })],
    revision_requerida: o.revision ?? false,
    crecimientos_a_reaprobar: o.crecimientos ? [{ gm_clave: GM_HU, genero: "HOMBRE", mundo: "URBANO" }] : [],
  });
  return { tandas: [{ lote_id: uuid(1), items: [] }], resultados: [r], soloMetodo: false, combinado: combinarResultados([r]) };
}

const ESTADO_LISTO = (sim: SimulacionLote | null, o: Partial<EstadoConfirmacion> = {}): EstadoConfirmacion => ({ fase: "listo", sim, errorSim: null, errorAplicar: null, hechas: {}, tandaActual: null, fijo: null, ...o });

function confirmacion(estado: EstadoConfirmacion, o: Partial<VistaConfirmacionProps> = {}) {
  const d = datos();
  const filas = [fila(1), fila(2), filaSinIa(4)];
  return createElement(VistaConfirmacion, {
    tipo: "aprobar",
    anio: Y1,
    anioEnCurso: Y,
    estado,
    filasSeleccion: filas,
    gms: d.gms,
    nombres: nombresDe(d.gms, filas),
    nota: "",
    onNota: nada,
    revision: false,
    onRevision: nada,
    onSoloMetodo: nada,
    onResimular: nada,
    onAplicar: nada,
    onReintentar: nada,
    onCerrar: nada,
    onDeshacer: nada,
    onIrACrecimientos: nada,
    onIrAFactores: nada,
    onRecalcular: nada,
    ...o,
  });
}

describe("confirmación del lote", () => {
  it("simulando: no se puede confirmar todavía", () => {
    const t = html(confirmacion({ ...ESTADO_LISTO(null), fase: "simulando" }));
    expect(t).toContain("Simulando el lote");
    expect(t).not.toContain("Aprobar 3 filas</button>");
  });

  it("muestra el resumen por GM, las 10 mayores, el desvío fuera de ±1 % en ámbar y el botón con la cuenta", () => {
    const t = html(confirmacion(ESTADO_LISTO(simulacion())));
    expect(t).toContain("Aprobar 3 filas de 2027");
    expect(t).toContain("HOMBRE · URBANO");
    expect(t).toContain("26,066 → 26,006");
    expect(t).toContain("fuera de ±1 %");
    expect(t).toContain("text-alerta");
    expect(t).toContain("IA 2 (17,638 u)");
    expect(t).toContain("Método 1 (841 u)");
    expect(t).toContain("Las 10 filas con más unidades");
    expect(t).toContain("Las 10 filas con mayor brecha");
    expect(t).toContain("1 fila con método en GM sin IA.");
    expect(t).toContain("Nota (opcional)");
  });

  it("con revisión requerida aparece la casilla y «Aprobar» queda deshabilitado hasta marcarla", () => {
    const sim = simulacion({ revision: true });
    const sin = html(confirmacion(ESTADO_LISTO(sim)));
    expect(sin).toContain("Revisé el resumen por GM");
    expect(sin).toMatch(/<button[^>]*\sdisabled=""[^>]*>Aprobar 3 filas/);
    const con = html(confirmacion(ESTADO_LISTO(sim), { revision: true }));
    expect(con).not.toMatch(/<button[^>]*\sdisabled=""[^>]*>Aprobar 3 filas/);
  });

  it("más de 100 filas pedidas también exigen la casilla", () => {
    const muchas = Array.from({ length: 101 }, (_, i) => fila(i + 1));
    const t = html(confirmacion(ESTADO_LISTO(simulacion()), { filasSeleccion: muchas }));
    expect(t).toContain("Revisé el resumen por GM");
  });

  it("un lote de 2026 que deja crecimientos por reaprobar lo avisa antes de confirmar", () => {
    const t = html(confirmacion(ESTADO_LISTO(simulacion({ crecimientos: true })), { anio: Y }));
    expect(t).toContain("1 GM con crecimientos que reaprobar");
  });

  it("las filas que no se aprobarían se listan con su motivo", () => {
    const sim = simulacion({ filas: [resultadoFila(1), resultadoFila(2, { resultado: "rechazada", codigo: "ya_decidida", valor: null })] });
    const t = html(confirmacion(ESTADO_LISTO(sim)));
    expect(t).toContain("No se aprobarían");
    expect(t).toContain("Ya tiene una decisión.");
  });

  it("IA no disponible: el mensaje claro y «Aprobar solo las de método»", () => {
    const t = html(confirmacion(ESTADO_LISTO(null, { errorSim: { mensaje: "ia apagada", codigo: "ia_no_disponible" } })));
    expect(t).toContain("La IA no está disponible");
    expect(t).toContain("No se escribió nada");
    expect(t).toContain("Aprobar solo las de método");
    expect(t).toContain("Detalle: ia apagada");
  });

  it("con «solo método» lo dice", () => {
    expect(html(confirmacion(ESTADO_LISTO({ ...simulacion(), soloMetodo: true })))).toContain("Se aprobarán solo las filas de método");
  });

  it("aplicando: «tanda 1 de 2» y no se puede cerrar", () => {
    const sim = { ...simulacion(), tandas: [{ lote_id: uuid(1), items: [] }, { lote_id: uuid(2), items: [] }] };
    const t = html(confirmacion({ ...ESTADO_LISTO(sim), fase: "aplicando", tandaActual: 0, fijo: { nota: "", revision: false } }));
    expect(t).toContain("tanda 1 de 2");
    expect(t).toContain("Escribiendo…");
  });

  it("falla la tanda 2 de 3: lo hecho se queda y se ofrece «Reintentar» y «Deshacer lo aplicado»", () => {
    const sim = { ...simulacion(), tandas: [1, 2, 3].map((n) => ({ lote_id: uuid(n), items: [] })) };
    const hecha = resultado([resultadoFila(1)], { simulado: false, lote: lote(1) });
    const t = html(confirmacion(ESTADO_LISTO(sim, { hechas: { 0: hecha }, tandaActual: 1, fijo: { nota: "", revision: false }, errorAplicar: { mensaje: "red", codigo: "conflicto_reintentar" } })));
    expect(t).toContain("Se aprobaron 1 de 3 tandas");
    expect(t).toContain("Reintentar");
    expect(t).toContain("Deshacer lo aplicado");
    expect(t).toContain("Choque con otro cambio");
  });

  it("terminada: «212 aprobadas · 2 no aprobadas», «Deshacer esta aprobación» y el enlace a Crecimientos si aplica", () => {
    const filas = [...Array.from({ length: 212 }, (_, i) => resultadoFila(i + 1)), resultadoFila(900, { resultado: "rechazada", codigo: "ya_decidida", valor: null }), resultadoFila(901, { resultado: "rechazada", codigo: "cambio_concurrente", valor: null })];
    const hecha = resultado(filas, { simulado: false, lote: lote(1), crecimientos_a_reaprobar: [{ gm_clave: GM_HU, genero: "HOMBRE", mundo: "URBANO" }] });
    const t = html(confirmacion({ ...ESTADO_LISTO(simulacion(), { hechas: { 0: hecha } }), fase: "terminada" }));
    expect(t).toContain("212 aprobadas · 2 no aprobadas");
    expect(t).toContain("Deshacer esta aprobación");
    expect(t).toContain("Reaprobar crecimientos");
    expect(t).toContain("Ya tiene una decisión.");
  });

  it("reaprobar: los textos hablan de reaprobar", () => {
    const t = html(confirmacion(ESTADO_LISTO(simulacion()), { tipo: "reaprobar" }));
    expect(t).toContain("Reaprobar 3 filas de 2027");
    expect(t).toContain("No toca nada decidido a mano");
  });

  it("el resumen de una reversión no lista «mayores» y habla de volver a la propuesta", () => {
    const r = combinarResultados([resultado([resultadoFila(1, { fuente: "revertir", valor: null }), resultadoFila(2, { resultado: "rechazada", codigo: "cambiada_despues", valor: null })])]);
    const t = html(createElement(ResumenResultado, { r, nombres: nombresDe([gm()], []), reversion: true }));
    expect(t).toContain("1 fila vuelve a la propuesta");
    expect(t).toContain("No se tocan");
    expect(t).toContain("Alguien la cambió después del lote");
    expect(t).not.toContain("Las 10 filas con más unidades");
  });
});

// ─── Historial (§4.5) ───

describe("historial", () => {
  const nombres = nombresDe([gm()], []);
  const el = (lotes: ReturnType<typeof lote>[] | null, o: Partial<Parameters<typeof HistorialLotes>[0]> = {}) =>
    createElement(HistorialLotes, { proyeccionId: uuid("aa"), lotes, cargando: false, error: null, editable: true, nombres, onRecargar: nada, onCambio: nada, onIrACrecimientos: nada, ...o });

  it("muestra fecha, quién, tipo, año, conteos, fuente, revisión, nota, estado y acciones", () => {
    const t = html(el([lote(1, { revision_confirmada: true, nota: "cierre de octubre" }), lote(2, { estado: "revertido_en_parte", filas_revertidas: 1 }), lote(3, { estado: "revertido" }), lote(4, { tipo: "revertir", estado: null, revierte_lote_id: uuid("11") })]));
    for (const c of ["Fecha", "Quién", "Tipo", "Pedidas", "Aplicadas", "Rechazadas", "IA y método", "Revisión", "Nota", "Estado"]) expect(t).toContain(c);
    expect(t).toContain("Ana Planner");
    expect(t).toContain("Confirmada");
    expect(t).toContain("cierre de octubre");
    expect(t).toContain("vigente");
    expect(t).toContain("revertido en parte");
    expect(t).toContain("1 fila revertida");
    expect(t).toContain("Reversión");
    expect(t).toContain("IA 2 (17,638 u)");
    expect(t).toContain(">Ver<");
  });

  it("revertir solo se ofrece en lotes vigentes (no en una reversión ni en uno revertido) y si la proyección está en trabajo", () => {
    const t = html(el([lote(1), lote(3, { estado: "revertido" }), lote(4, { tipo: "revertir", estado: null })]));
    expect((t.match(/Revertir lote/g) ?? []).length).toBe(1);
    expect(html(el([lote(1)], { editable: false }))).not.toContain("Revertir lote");
  });

  it("una confirmación con varias tandas ofrece revertirla entera y numera las tandas", () => {
    const c = uuid("c9");
    const t = html(el([lote(1, { confirmacion_id: c, created_at: "2026-11-03T15:02:00.000Z" }), lote(2, { confirmacion_id: c, created_at: "2026-11-03T15:01:00.000Z" })]));
    expect(t).toContain("tanda 1 de 2");
    expect(t).toContain("tanda 2 de 2");
    expect(t).toContain("Revertir confirmación");
  });

  it("vacío, cargando y error", () => {
    expect(html(el([]))).toContain("Todavía no se aprobó nada en bloque");
    expect(html(el(null, { cargando: true }))).toContain("Leyendo el historial");
    expect(html(el([], { error: "Error 500" }))).toContain("Error 500");
  });

  it("el detalle de un lote usa filas del fixture sin lanzar", () => {
    expect(filaLote(1).fila_clave).toContain("POLO");
  });
});

// ─── La pestaña completa (sin red: queda leyendo) ───

describe("pestaña «Aprobación»", () => {
  it("renderiza sin lanzar mientras lee", () => {
    const proyeccion = { id: uuid("aa"), anio_en_curso: Y, anio_siguiente: Y1, estado: "en_trabajo", nombre: "Proyección sintética" } as unknown as ProyeccionApi;
    const t = html(
      createElement(AprobacionTab, {
        proyeccion,
        filtro: { genero: "", mundo: "", linea: "", temporada: "", agrupacion_estacionalidad: "", agrupacion_marca: "", solo: "" },
        indice: [],
        agrupacionesMarca: [],
        parametros: P(),
        bloqueada: false,
        onFiltro: nada,
        onParametros: nada,
        onLimpiar: nada,
        onCambio: async () => {},
        onRecalcular: nada,
        onIrAFactores: nada,
        onIrACrecimientos: nada,
        onIrATiendas: nada,
      })
    );
    expect(t).toContain("Aprobación en bloque");
    expect(t).toContain("Historial de aprobaciones");
  });
});
