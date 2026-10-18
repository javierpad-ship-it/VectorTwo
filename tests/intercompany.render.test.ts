import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BarraFiltros } from "../src/app/(app)/maestros/intercompany/barra-filtros";
import { CeldaAplicable, CeldaImi, CeldaPctDirecto, CeldaRuta } from "../src/app/(app)/maestros/intercompany/comunes";
import { DialogoRegla } from "../src/app/(app)/maestros/intercompany/dialogo-regla";
import { PestanaHistorial } from "../src/app/(app)/maestros/intercompany/pestana-historial";
import { PestanaReglas } from "../src/app/(app)/maestros/intercompany/pestana-reglas";
import { nodosDelArbol, PARAMETROS_VACIOS } from "../src/app/(app)/maestros/intercompany/vista";
import { arbolEjemplo, IDS, reglasEjemplo } from "./intercompany.pantalla.fixture";

/** Humo de render con datos sintéticos: ningún componente de presentación de M13 debe lanzar y los textos clave deben salir. */

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const noop = () => {};
const nodos = nodosDelArbol(arbolEjemplo());
const marcas = [
  { id: IDS.jh, nombre: "JH" },
  { id: IDS.donatelli, nombre: "DONATELLI" },
  { id: IDS.vanHeusen, nombre: "VAN HEUSEN" },
];
const vigentes = reglasEjemplo().filter((r) => r.id !== "r1" && r.id !== "r6");

describe("celdas", () => {
  it("el rango marca 'por defecto' solo cuando no se editó y el % directo muestra el del CD", () => {
    expect(html(createElement(CeldaImi, { valor: 4, defecto: true }))).toContain("por defecto");
    expect(html(createElement(CeldaImi, { valor: 3 }))).not.toContain("por defecto");
    expect(html(createElement(CeldaImi, { valor: 4, defecto: true }))).toContain("4,0");
    const h = html(createElement(CeldaPctDirecto, { regla: { pct_directo: 80, pct_cd: 20 } }));
    expect(h).toContain("80 %");
    expect(h).toContain("del CD 20 %");
  });
  it("la ruta señala la equivalencia que manda y lo que está fuera de ámbito", () => {
    const r = reglasEjemplo();
    expect(html(createElement(CeldaRuta, { regla: r[2] }))).toContain("GMLE: manda");
    expect(html(createElement(CeldaRuta, { regla: r[5 + 1] }))).toContain("Fuera de ámbito");
    expect(html(createElement(CeldaRuta, { regla: r[0] }))).not.toContain("GMLE: manda");
  });
  it("aplicable: Sí, No con los dos atajos (marcas y proyección) y 'se sabrá al cerrar'", () => {
    const r = reglasEjemplo();
    expect(html(createElement(CeldaAplicable, { regla: r[0] }))).toContain("Sí");
    const no = html(createElement(CeldaAplicable, { regla: r[4] }));
    expect(no).toContain("No: sin clave");
    expect(no).toContain(`/maestros/marcas?pestana=gml&amp;marca=${IDS.vanHeusen}`);
    expect(no).toContain("/planificacion/proyeccion");
    expect(html(createElement(CeldaAplicable, { regla: r[5] }))).toContain("Se sabrá al cerrar");
  });
});

describe("pestaña Reglas", () => {
  const props = { mes: "2026-10", cargando: false, sinReglas: false, parametros: PARAMETROS_VACIOS, nodos, marcas, onNueva: noop, onNuevaVigencia: noop, onVerHistorial: noop };

  it("tabla con las columnas de la ficha, el resumen del pie, las acciones por fila y el botón de Excel", () => {
    const h = html(createElement(PestanaReglas, { ...props, reglas: vigentes }));
    for (const t of ["Marca", "GML / unidad", "Vigente desde", "IMI mín", "IMI máx", "% directo", "% observado (M8)", "Aplicable", "Nota", "Acciones"]) expect(h).toContain(t);
    expect(h).toContain("HOMBRE · FORMAL · TERNO");
    expect(h).toContain("DONATELLI");
    expect(h).toContain("Nueva vigencia");
    expect(h).toContain("Historial");
    expect(h).toContain("Excel");
    expect(h).toContain("5 reglas vigentes");
    expect(h).toContain("rango por defecto 4–8 (editado en 3 reglas)");
    expect(h).toContain("mar-2025");
  });
  it("sin ninguna regla muestra el estado vacío con 'Nueva regla'", () => {
    const h = html(createElement(PestanaReglas, { ...props, reglas: [], sinReglas: true }));
    expect(h).toContain("Todavía no hay reglas de intercompany");
    expect(h).toContain("+ Nueva regla");
    expect(h).not.toContain("<table");
  });
  it("con reglas pero ninguna vigente en el mes lo explica en la tabla", () => {
    const h = html(createElement(PestanaReglas, { ...props, reglas: [], mes: "2024-01" }));
    expect(h).toContain("ene-2024");
    expect(h).toContain("Mira el Historial");
    expect(h).toContain("empiezan en un mes posterior");
  });
  it("si las reglas del mes quedan fuera del ámbito sugerido lo dice, no que empiezan más tarde", () => {
    const h = html(createElement(PestanaReglas, { ...props, reglas: [], vigentesEnMes: 2 }));
    expect(h).toContain("2 reglas vigentes");
    expect(h).toContain("ámbito sugerido");
    expect(h).not.toContain("mes posterior");
  });
});

describe("pestaña Historial", () => {
  it("una tarjeta por clave con la secuencia, el hasta derivado, la vigente marcada y editar y eliminar", () => {
    const todas = reglasEjemplo();
    const h = html(createElement(PestanaHistorial, { reglas: todas, todas, mes: "2026-07", cargando: false, onEditar: noop, onNuevaVigencia: noop, onEliminada: noop }));
    expect(h).toContain("JH · HOMBRE · FORMAL · CAMISA");
    expect(h).toContain("JH · HOMBRE · FORMAL · CAMISA › MANGA CORTA");
    expect(h).toContain("may-2026");
    expect(h).toContain("abierta");
    expect(h).toContain("Rige en jul-2026");
    expect(h).toContain("Editar");
    expect(h).toContain("Eliminar");
    expect(h).toContain("Planner de prueba");
    // Solo la última vigencia de cada clave ofrece "Nueva vigencia".
    expect(h.match(/Nueva vigencia/g)).toHaveLength(6);
  });
  it("sin reglas con los filtros lo dice", () => {
    const h = html(createElement(PestanaHistorial, { reglas: [], todas: [], mes: "2026-10", cargando: false, onEditar: noop, onNuevaVigencia: noop, onEliminada: noop }));
    expect(h).toContain("No hay reglas con estos filtros");
  });
});

describe("filtros", () => {
  it("muestra mes en curso, marcas con regla, los mundos del ámbito marcados y el aviso del ámbito sugerido", () => {
    const h = html(createElement(BarraFiltros, { parametros: PARAMETROS_VACIOS, mes: "2026-10", hoy: "2026-10", nodos, marcas, mesesConReglas: ["2025-03"], onCambiar: noop }));
    expect(h).toContain("oct-2026 (mes en curso)");
    expect(h).toContain("mar-2025");
    expect(h).toContain("VAN HEUSEN");
    expect(h).toContain("FORMAL");
    expect(h).toContain('aria-checked="true"');
    expect(h).toContain("ámbito sugerido");
    expect(h).toContain("No aplicables");
    expect(h).not.toContain("Quitar filtros");
  });
  it("con un filtro elegido ofrece quitarlos", () => {
    const h = html(createElement(BarraFiltros, { parametros: { ...PARAMETROS_VACIOS, marca: IDS.jh }, mes: "2026-10", hoy: "2026-10", nodos, marcas, mesesConReglas: [], onCambiar: noop }));
    expect(h).toContain("Quitar filtros");
  });
});

describe("diálogo de regla", () => {
  const base = { marcas, nodos, reglas: reglasEjemplo(), hoy: "2026-10", onGuardada: noop, onCerrar: noop };

  it("nueva regla: marca, GML solo del ámbito, rango 4–8 por defecto, % directo con el % del CD y el mes siguiente", () => {
    const h = html(createElement(DialogoRegla, { ...base, modo: { tipo: "nueva" } }));
    expect(h).toContain("Nueva regla");
    expect(h).toContain("Elige la marca…");
    expect(h).toContain("HOMBRE · FORMAL · CAMISA (por equivalencia)");
    // El ámbito sugerido está activo: DENIM (URBANO) y el polo de MUJER no se ofrecen.
    expect(h).not.toContain("DENIM");
    expect(h).not.toContain("MUJER");
    expect(h).toContain('value="4"');
    expect(h).toContain('value="8"');
    expect(h).toContain("Por defecto 4–8");
    expect(h).toContain("% del CD: —");
    expect(h).toContain('<option value="2026-11" selected');
    expect(h).toContain("Guardar regla");
  });
  it("nueva vigencia: la clave queda fija y el rango, el % y la nota vienen de la regla anterior", () => {
    const h = html(createElement(DialogoRegla, { ...base, modo: { tipo: "vigencia", base: reglasEjemplo()[1] } }));
    expect(h).toContain("Nueva vigencia");
    expect(h).toContain("HOMBRE · FORMAL · CAMISA");
    expect(h).not.toContain("Elige la marca…");
    expect(h).toContain('value="3"');
    expect(h).toContain('value="6"');
    expect(h).toContain('value="60"');
    expect(h).toContain("% del CD: 40 %");
    expect(h).toContain("acuerdo nuevo");
  });
  it("nueva vigencia con una regla de la clave ya en el mes siguiente propone el que sigue y arranca sin error", () => {
    const todas = reglasEjemplo();
    const futura = { ...todas[1], id: "r1c", vigente_desde: "2026-11" };
    const h = html(createElement(DialogoRegla, { ...base, reglas: [...todas, futura], modo: { tipo: "vigencia", base: todas[1] } }));
    expect(h).toContain('<option value="2026-12" selected');
    expect(h).not.toContain("Ya hay una regla de esa clave");
  });
  it("el selector de mes del diálogo y de los filtros llega 36 meses atrás", () => {
    expect(html(createElement(DialogoRegla, { ...base, modo: { tipo: "nueva" } }))).toContain('<option value="2023-10"');
    expect(html(createElement(BarraFiltros, { parametros: PARAMETROS_VACIOS, mes: "2026-10", hoy: "2026-10", nodos, marcas, mesesConReglas: [], onCambiar: noop }))).toContain("oct-2023");
  });
  it("editar: sin selector de fecha, con el texto de que la fecha no se edita", () => {
    const h = html(createElement(DialogoRegla, { ...base, modo: { tipo: "editar", regla: reglasEjemplo()[0] } }));
    expect(h).toContain("Editar regla");
    expect(h).toContain("La fecha no se edita");
    expect(h).not.toContain("Vigente desde</span>");
    expect(h).toContain("Guardar cambios");
    expect(h).toContain("ene-2026");
  });
});
