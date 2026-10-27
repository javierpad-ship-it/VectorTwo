import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ColaLargaDetalle } from "../src/app/(app)/planificacion/proyeccion/cola-larga";
import { AntesDeProyectar } from "../src/app/(app)/planificacion/proyeccion/antes-de-proyectar";
import { BloqueDecision } from "../src/app/(app)/planificacion/proyeccion/bloque-decision";
import { CabeceraProyeccion } from "../src/app/(app)/planificacion/proyeccion/cabecera-proyeccion";
import { CeldaCrecimiento, CeldaDecision } from "../src/app/(app)/planificacion/proyeccion/celda-decision";
import { ArchivarModal } from "../src/app/(app)/planificacion/proyeccion/archivar-modal";
import { CerrarModal, GrupoLista } from "../src/app/(app)/planificacion/proyeccion/cerrar-modal";
import { AlertaError } from "../src/app/(app)/planificacion/proyeccion/comunes";
import { ComposicionBloques } from "../src/app/(app)/planificacion/proyeccion/composicion-bloques";
import { TablaFactores } from "../src/app/(app)/planificacion/proyeccion/factores-tab";
import { FiltrosVista } from "../src/app/(app)/planificacion/proyeccion/filtros-vista";
import { FormularioProyeccion } from "../src/app/(app)/planificacion/proyeccion/formulario-proyeccion";
import { GraficoBarras } from "../src/app/(app)/planificacion/proyeccion/grafico-barras";
import { GraficoMensualFila } from "../src/app/(app)/planificacion/proyeccion/grafico-mensual-fila";
import { LineaTab } from "../src/app/(app)/planificacion/proyeccion/linea-tab";
import { PieMatriz, TablaMatriz } from "../src/app/(app)/planificacion/proyeccion/matriz-tab";
import { TablaMensual } from "../src/app/(app)/planificacion/proyeccion/mensual-tab";
import { TablaFilas } from "../src/app/(app)/planificacion/proyeccion/tabla-filas";
import { TarjetaTienda } from "../src/app/(app)/planificacion/proyeccion/tarjeta-tienda";
import { AtajoTienda } from "../src/app/(app)/planificacion/proyeccion/atajo-tienda";
import { construirBarras, FILTRO_VISTA_VACIO, nombresDeTiendas, seccionesApertura, seriesMensualesDeFila } from "../src/app/(app)/planificacion/proyeccion/vista";
import { CamposTienda, camposDeTienda, cambiosDeEdicion, FORM_VACIO } from "../src/app/(app)/maestros/tiendas/formulario-tienda";
import type { TiendaFila } from "../src/lib/tiendas/tipos-api";
import {
  bloques,
  colaLarga,
  detalleFila,
  filaRevision,
  factores,
  filasDenim,
  INDICE,
  nodo,
  proyeccion,
  registro,
  respuestaLineas,
  respuestaMatriz,
  respuestaMensual,
  respuestaProyeccion,
  tiendaProyeccion,
  Y,
} from "./proyeccion.pantalla.fixture";

/** Humo de render con datos sintéticos: ningún componente de la pantalla de M7 debe lanzar y los textos clave deben salir. */

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const noop = () => {};
const sinAsync = () => Promise.resolve(true);
const sinVoid = () => Promise.resolve();

describe("gráfico de barras por año", () => {
  const barras = construirBarras({ anioEnCurso: Y, lineas: respuestaLineas(), bloques: bloques() });
  const salida = html(createElement(GraficoBarras, { barras, anioEnCurso: Y }));

  it("rotula cada año con su red de mismas tiendas y marca el Niño", () => {
    for (const [anio, n] of [[2023, 8], [2024, 8], [2025, 9], [2026, 9], [2027, 10]] as const) expect(salida).toContain(`M(${anio}) ${n} tiendas`);
    expect(salida).toContain(">Niño<");
  });

  it("el año en curso muestra vendido + resto y es accesible", () => {
    expect(salida).toContain("31,980 + 13,224");
    expect(salida).toContain("52,724");
    expect(salida).toContain('role="img"');
    expect(salida).toContain("Unidades por año");
    expect(salida).toContain("Resto de 2026");
  });
});

describe("serie mensual de una fila", () => {
  it("dibuja las series y su leyenda; sin series avisa", () => {
    const s = html(createElement(GraficoMensualFila, { series: seriesMensualesDeFila(detalleFila(), Y) }));
    expect(s).toContain("2023 (Niño)");
    expect(s).toContain("2026 (real + proyectado)");
    expect(s).toContain("2027 (proyectado)");
    expect(html(createElement(GraficoMensualFila, { series: [] }))).toContain("Sin serie mensual");
  });
});

describe("celdas de decisión", () => {
  const props = { anio: 2026, anioEnCurso: 2026, bloqueada: false, ocupado: false, onDecidir: sinAsync, etiqueta: "RECONOCIDO, decidido 2026" };

  it("sin decisión: el campo trae la propuesta de sombra y ✓ acepta", () => {
    const s = html(createElement(CeldaDecision, { ...props, registro: registro(2026, { propuesto: 17504 }) }));
    expect(s).toContain('placeholder="17,504"');
    expect(s).toContain("Aceptar la propuesta");
    expect(s).not.toContain("Volver a la propuesta");
  });

  it("decidida: muestra la cifra, el visto y ↺ para volver a la propuesta; con nota, la marca n", () => {
    const s = html(createElement(CeldaDecision, { ...props, registro: registro(2026, { decidido: 17600, origen: "manual", nota: "ojo" }) }));
    expect(s).toContain('value="17600"');
    expect(s).toContain("Volver a la propuesta");
    expect(s).toContain(">n<");
    expect(s).not.toContain("Aceptar la propuesta:");
  });

  it("si la propuesta se movió desde que decidiste, lo dice", () => {
    const s = html(createElement(CeldaDecision, { ...props, registro: registro(2026, { decidido: 4300, origen: "propuesta", propuesta_al_decidir: 4168, propuesto: 4402 }) }));
    expect(s).toContain("Decidiste 4,300 con la propuesta en 4,168; hoy la propuesta es 4,402.");
  });

  it("bloqueada (cerrada o calculando) deshabilita el campo y los botones", () => {
    const s = html(createElement(CeldaDecision, { ...props, bloqueada: true, registro: registro(2026) }));
    expect(s.match(/disabled/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("sin propuesta no se puede aceptar", () => {
    const s = html(createElement(CeldaDecision, { ...props, registro: registro(2026, { propuesto: null, metodo: "sin_propuesta" }) }));
    expect(s).toContain("No hay propuesta que aceptar");
  });

  it("el crecimiento por fila trae el efectivo (celda o Resto) de sombra y su origen", () => {
    const s = html(
      createElement(CeldaCrecimiento, {
        registro: registro(2027, { crecimiento_pct: 8, crecimiento_efectivo: { pct: 8, origen: "fila", celda: null } }),
        anio: 2027,
        anioEnCurso: 2026,
        bloqueada: false,
        ocupado: false,
        onDecidir: sinAsync,
        etiqueta: "crecimiento",
      })
    );
    expect(s).toContain('value="8"');
    expect(s).toContain('placeholder="8"');
    expect(s).toContain("8 % · esta fila");
    const sinPropio = html(
      createElement(CeldaCrecimiento, {
        registro: registro(2027, { crecimiento_efectivo: { pct: 20, origen: "celda", celda: "HOMBRE · URBANO", version: 2 } }),
        anio: 2027,
        anioEnCurso: 2026,
        bloqueada: false,
        ocupado: false,
        onDecidir: sinAsync,
        etiqueta: "crecimiento",
      })
    );
    expect(sinPropio).toContain('placeholder="20"');
    expect(sinPropio).toContain("20 % · HOMBRE · URBANO v2");
    expect(sinPropio).toContain("Vacío = el aprobado de HOMBRE · URBANO (20 %).");
    const resto = (efectivo: { version?: number | null; provisional?: boolean }) =>
      html(
        createElement(CeldaCrecimiento, {
          registro: registro(2027, { crecimiento_efectivo: { pct: 5, origen: "resto", celda: null, ...efectivo } }),
          anio: 2027,
          anioEnCurso: 2026,
          bloqueada: false,
          ocupado: false,
          onDecidir: sinAsync,
          etiqueta: "crecimiento",
        })
      );
    expect(resto({ version: 1 })).toContain("5 % · Resto v1");
    expect(resto({ version: null, provisional: true })).toContain("5 % · Resto provisional");
    expect(resto({ version: null, provisional: true })).toContain("Vacío = el Resto provisional (5 %).");
  });
});

describe("tabla de filas de la línea", () => {
  const datos = respuestaLineas();
  const secciones = seccionesApertura(datos, [Y, Y + 1], nombresDeTiendas(bloques()));
  const salida = html(
    createElement(TablaFilas, {
      filas: datos.filas,
      lineas: datos,
      secciones,
      anioEnCurso: Y,
      bloqueada: false,
      ocupado: false,
      filaSeleccionada: null,
      onSeleccionar: noop,
      onDecidir: sinAsync,
      onVerTienda: noop,
      onCsv: noop,
    })
  );

  it("trae las cinco filas, el histórico, el avance y los dos años", () => {
    for (const am of ["RECONOCIDO", "MID VALUE", "VALOR", "PREMIUM", "ULTRA LOW"]) expect(salida).toContain(am);
    for (const col of ["2023", "2024", "2025", "2026 vendido", "Avance", "2026 propuesto", "2026 decidido", "Crec.", "2027 propuesto", "2027 decidido"]) expect(salida).toContain(col);
    expect(salida).toContain("71.3 %");
    expect(salida).toContain("14,500");
  });

  it("el pie suma la línea de mismas tiendas con propuesta, vigente y filas decididas", () => {
    expect(salida).toContain("Línea (mismas tiendas)");
    expect(salida).toContain("44,854");
    expect(salida).toContain("45,204");
    expect(salida).toContain("2 de 5");
    expect(salida).toContain("52,724");
    expect(salida).toContain("1 de 5");
  });

  it("ofrece Ver meses y CSV, y una fila sin filas avisa", () => {
    expect(salida).toContain("Ver meses");
    expect(salida).toContain("CSV");
    const vacia = html(createElement(TablaFilas, { filas: [], lineas: respuestaLineas({ filas: [] }), secciones: [], anioEnCurso: Y, bloqueada: false, ocupado: false, filaSeleccionada: null, onSeleccionar: noop, onDecidir: sinAsync, onCsv: noop }));
    expect(vacia).toContain("no tiene filas con venta");
  });

  it("la fila con la curva nueva lleva su aviso", () => {
    const f = filasDenim();
    f[0].avisos = ["curva_cambio"];
    const s = html(createElement(TablaFilas, { filas: f, lineas: datos, secciones, anioEnCurso: Y, bloqueada: false, ocupado: false, filaSeleccionada: "f1", onSeleccionar: noop, onDecidir: sinAsync, onCsv: noop }));
    expect(s).toContain("curva cambio");
    expect(s).toContain('aria-pressed="true"');
  });
});

describe("bloque «Tu decisión»", () => {
  const base = { anioEnCurso: 2026, bloqueada: false, ocupado: false, factoresMes: null, onDecidir: sinAsync, onAplicarCurva: sinAsync };

  it("2026: explicación delante, mínimo lo vendido, aceptar y guardar", () => {
    const s = html(createElement(BloqueDecision, { ...base, anio: 2026, registro: registro(2026) }));
    expect(s).toContain("Tu decisión 2026");
    expect(s).toContain("Vendido ene–set 12,480");
    expect(s).toContain("Mínimo: lo vendido (12,480)");
    expect(s).toContain("Aceptar la propuesta");
    expect(s).toContain("Guardar esta cifra");
    expect(s).toContain("71.3 %");
    expect(s).not.toContain("Crecimiento (%)");
  });

  it("2027: lleva el crecimiento y, con factor, el Niño por mes", () => {
    const s = html(createElement(BloqueDecision, { ...base, anio: 2027, registro: registro(2027, { crecimiento_pct: 5 }), factoresMes: [1, 1, 1, 1, 1, 1, 1, 1, 1.24, 1.24, 1, 1] }));
    expect(s).toContain("Crecimiento (%)");
    expect(s).toContain("Base 19,424 × 1.05");
    expect(s).toContain("set 1.24, oct 1.24");
  });

  it("decidida: ofrece volver a la propuesta; la propuesta alternativa se rotula «por avance saldrían»", () => {
    const s = html(createElement(BloqueDecision, { ...base, anio: 2026, registro: registro(2026, { decidido: 17600, origen: "manual", vigente: 17600, metodo: "plan_anterior", referencia_alternativa: 1380 }) }));
    expect(s).toContain("Volver a la propuesta");
    expect(s).toContain("Por avance saldrían");
    expect(s).toContain("1,380");
  });

  it("la curva cambió: muestra los dos repartos y el botón Aplicar curva nueva", () => {
    const s = html(
      createElement(BloqueDecision, {
        ...base,
        anio: 2026,
        registro: registro(2026, { decidido: 17504, origen: "propuesta", meses_propuestos: [1000, 1100, 1250, 1350, 1450, 1540, 1600, 1580, 1410, 1500, 1650, 1900], avisos: ["curva_cambio"] }),
      })
    );
    expect(s).toContain("Aplicar curva nueva");
    expect(s).toContain("Guardado (curva anterior)");
    expect(s).toContain("Con la curva nueva");
    expect(s).toContain("conserva la curva anterior");
  });

  it("bloqueada no ofrece ninguna acción", () => {
    const s = html(createElement(BloqueDecision, { ...base, bloqueada: true, anio: 2026, registro: registro(2026) }));
    expect(s).not.toContain("Aceptar la propuesta");
    expect(s).not.toContain("Guardar esta cifra");
  });
});

describe("tarjeta de tienda nueva", () => {
  const props = { proyeccion: proyeccion(), perfiles: [{ tienda: "T05", ratios: [2.9, 1.8, 1.2, 1, 1, 1] }], bloqueada: false, abierta: true, onAlternar: noop, onAtajo: noop, onCambio: sinVoid, onRecalcular: noop };

  it("apertura de 2027: venta esperada sin IGV, referente, cómo se calculó, referencias y decisión", () => {
    const s = html(createElement(TarjetaTienda, { ...props, t: tiendaProyeccion() }));
    expect(s).toContain("2027 · T12 · Tienda nueva B");
    expect(s).toContain("Apertura en 2027");
    expect(s).toContain("venta mensual promedio esperada");
    expect(s).not.toContain("año de apertura");
    expect(s).toContain("S/ 85,000 al mes (sin IGV, en régimen)");
    expect(s).toContain("año maduro S/ 1,020,000");
    expect(s).toContain("en 2027 abre el 15-mar y vende el 83.7 % del año → S/ 853,597");
    expect(s).not.toContain("desde que abre hasta el 31 de diciembre");
    expect(s).toContain("T03 · Tienda 3");
    expect(s).toContain("Composición de T03");
    expect(s).toContain("año maduro completo: <span class=\"font-mono\">9,850</span> u");
    expect(s).toContain("Por venta esperada y referente");
    expect(s).toContain("Aceptar la propuesta");
    expect(s).toContain("Guardar esta cifra");
    expect(s).toContain("Cambiar en Tiendas");
    expect(s).toContain("Rampa de maduración de la tienda");
    expect(s).toContain("1 · 1 · 1");
    expect(s).toContain("(sin rampa)");
    expect(s).toContain("Abre tarde: en 2027 vende el 83.7 % de un año maduro (S/ 853,597 de S/ 1,020,000). En 2028 pasará a nueva del año anterior.");
    expect(s).not.toMatch(/restar venta|canibaliz/i);
    expect(s).toContain("Filas de T12");
  });

  it("el perfil observado de la apertura histórica acompaña a la rampa", () => {
    const s = html(createElement(TarjetaTienda, { ...props, t: tiendaProyeccion() }));
    expect(s).toContain("Perfil observado en aperturas con historia");
    expect(s).toContain("×2.9 · ×1.8 · ×1.2");
  });

  it("la nueva del año anterior que pasa a mismas tiendas avisa que alimenta la base de las líneas", () => {
    const t = tiendaProyeccion({ anio: 2026, subbloque: "nuevas_anterior", pasa_a_mismas: true, tienda_id: "tienda-10", codigo: "T10", nombre: "Tienda nueva A", metodo: "avance_propio", referencia_tres_meses: 4698, referencia_alternativa: 4610, vendido: 3420, propuesto: 4797, vigente: 4797, avisos: [] });
    const s = html(createElement(TarjetaTienda, { ...props, t }));
    expect(s).toContain("Nueva del año anterior en 2026");
    expect(s).toContain("En 2027 pasa a mismas tiendas");
    expect(s).toContain("La base de 2027 de cada línea incluye a T10: decídela antes de las líneas");
    expect(s).toContain("Últimos tres meses");
    expect(s).toContain("4,698");
    expect(s).toContain("4,610");
  });

  it("sin venta esperada lo marca y deja escribir el total igual", () => {
    const s = html(createElement(TarjetaTienda, { ...props, t: tiendaProyeccion({ venta_esperada: null, propuesto: null, vigente: null, metodo: "sin_propuesta", avisos: ["sin_venta_esperada"] }) }));
    expect(s).toContain("sin cargar");
    expect(s).toContain("no tiene venta esperada");
    expect(s).toContain("Sin propuesta: escribe el total");
  });

  it("decidida: ofrece volver a la propuesta y avisa si la propuesta se movió", () => {
    const s = html(createElement(TarjetaTienda, { ...props, t: tiendaProyeccion({ decidido: 6000, origen: "manual", vigente: 6000, propuesta_al_decidir: 7500 }) }));
    expect(s).toContain("Decidida · 6,000");
    expect(s).toContain("Volver a la propuesta");
    expect(s).toContain("Decidiste 6,000 con la propuesta en 7,500");
  });

  it("un cierre solo se clasifica: sin decisión y con el aviso de una versión próxima", () => {
    const s = html(createElement(TarjetaTienda, { ...props, t: tiendaProyeccion({ bloque: "cierres", subbloque: null, avisos: ["cierre_no_proyectado"], metodo: "cierre", venta_esperada: null }) }));
    expect(s).toContain("Cierre en 2027");
    expect(s).toContain("llega en una versión próxima");
    expect(s).not.toContain("0.10.1");
    expect(s).not.toContain("Aceptar la propuesta");
    expect(s).not.toContain("Rampa de maduración");
  });

  it("cerrada o calculando: sin acciones", () => {
    const s = html(createElement(TarjetaTienda, { ...props, bloqueada: true, t: tiendaProyeccion() }));
    expect(s).not.toContain("Aceptar la propuesta");
    expect(s).not.toContain("Cambiar en Tiendas</button>");
  });

  it("colapsada solo muestra el encabezado", () => {
    const s = html(createElement(TarjetaTienda, { ...props, abierta: false, t: tiendaProyeccion() }));
    expect(s).toContain("T12");
    expect(s).not.toContain("Cómo se calculó");
  });
});

describe("matriz", () => {
  const p = proyeccion();
  const props = { proyeccion: p, porMarca: false, plegados: new Set<string>(), onAlternar: noop, onIrALinea: noop, onIrATiendas: noop };

  it("columnas sin solapes: venta a la fecha, mismas, nuevas del año anterior, aperturas y total de cada año, variación y estado", () => {
    const s = html(createElement(TablaMatriz, { ...props, datos: respuestaMatriz() }));
    for (const t of ["Venta a la fecha", "Mismas tiendas", "Nuevas año ant.", "Aperturas", "Total 2026", "Total 2027", "Var.", "Estado"]) expect(s).toContain(t);
    expect(s).toContain("(T10)");
    expect(s).toContain("(T12)");
    expect(s).toContain("Compañía");
    expect(s).toContain("50,001");
    expect(s).toContain("53,208");
    expect(s).toContain("+6.4 %");
    expect(s).toContain("2/5 · 1/5");
    expect(s).toContain("La curva cambió");
    expect(s).not.toContain(">Cierres<");
  });

  it("las columnas de cierres aparecen solo si alguna línea tiene cierres", () => {
    const nodos = respuestaMatriz().nodos;
    nodos[3] = nodo("linea", "DENIM", { genero_id: "g-h", mundo_id: "m-u", linea_id: "l-denim" }, { en_curso: { ...nodos[3].en_curso, cierres: 120 } });
    const s = html(createElement(TablaMatriz, { ...props, datos: { nodos } }));
    expect(s).toContain(">Cierres<");
  });

  it("plegar un género oculta sus mundos y líneas", () => {
    const s = html(createElement(TablaMatriz, { ...props, datos: respuestaMatriz(), plegados: new Set(["g:g-h"]) }));
    expect(s).toContain("HOMBRE");
    expect(s).not.toContain(">DENIM<");
    expect(s).toContain("Desplegar HOMBRE");
  });

  it("sin líneas avisa", () => {
    const s = html(createElement(TablaMatriz, { ...props, datos: { nodos: [] } }));
    expect(s).toContain("Ninguna línea coincide con los filtros");
  });

  it("la vista por agrupación de marca cambia el rótulo de la primera columna", () => {
    const s = html(createElement(TablaMatriz, { ...props, porMarca: true, datos: respuestaMatriz() }));
    expect(s).toContain("Género · agrupación de marca");
  });
});

describe("vista mensual", () => {
  const props = { anioEnCurso: Y, k: 9, bloque: "todas" as const, porAgrupacion: false };

  it("distingue real (gris, redonda) de proyectado (cursiva), marca el último mes cerrado y suma los totales", () => {
    const s = html(createElement(TablaMensual, { ...props, datos: respuestaMensual() }));
    expect(s).toContain("bg-neutro-suave");
    expect(s).toContain("italic");
    expect(s).toContain("border-r-2 border-marca");
    expect(s).toContain("3,100");
    expect(s).toContain("Total (todas)");
    expect(s).toContain("Ene".toLowerCase());
    expect(s).toContain(">Total<");
  });

  it("un mes sin curva queda vacío, no en cero, y la fila lo avisa", () => {
    const s = html(createElement(TablaMensual, { ...props, datos: respuestaMensual() }));
    expect(s).toContain("Sin curva vigente");
    expect(s).toContain("sin curva");
    expect(s).toContain("43,000");
  });

  it("no tiene ningún campo editable", () => {
    const s = html(createElement(TablaMensual, { ...props, datos: respuestaMensual() }));
    expect(s).not.toContain("<input");
    expect(s).not.toContain("<button");
  });

  it("sin filas avisa", () => {
    expect(html(createElement(TablaMensual, { ...props, datos: { filas: [], totales: [] } }))).toContain("Ninguna fila coincide");
  });
});

describe("factores del Niño", () => {
  it("año × temporada con el calculado, el aplicado, el origen y los avisos", () => {
    const s = html(createElement(TablaFactores, { filas: factores(), soloLectura: false, ocupado: false, onGuardar: sinAsync }));
    expect(s).toContain("0.63");
    expect(s).toContain("0.66");
    expect(s).toContain("1.24");
    expect(s).toContain("Manual");
    expect(s).toContain("Calculado");
    expect(s).toContain("Sin factor");
    expect(s).toContain("Parcial");
    expect(s).toContain("Año objetivo");
    expect(s).toContain("9 tiendas · 9 meses");
    expect(s).toContain("ajustado por Javier");
  });

  it("solo lectura quita los botones Guardar", () => {
    const s = html(createElement(TablaFactores, { filas: factores(), soloLectura: true, ocupado: false, onGuardar: sinAsync }));
    expect(s).not.toContain(">Guardar<");
  });

  it("sin años atípicos lo explica", () => {
    expect(html(createElement(TablaFactores, { filas: [], soloLectura: false, ocupado: false, onGuardar: sinAsync }))).toContain("Todavía no hay años atípicos");
  });
});

describe("cabecera, antes de proyectar y composición de los bloques", () => {
  const acciones = { calculandoLocal: false, ocupado: false, onRecalcular: noop, onParametros: noop, onCerrar: noop, onArchivar: noop, onEliminar: noop, onCopiar: noop };

  it("en trabajo: la línea de resumen y todas las acciones", () => {
    const s = html(createElement(CabeceraProyeccion, { ...acciones, proyeccion: proyeccion() }));
    expect(s).toContain("datos hasta 2026-09");
    expect(s).toContain("2027: 10 mismas tiendas, 1 apertura (T12)");
    expect(s).toContain("dentro de muestra");
    for (const b of ["Recalcular", "Parámetros", "Cerrar proyección", "Archivar", "Eliminar"]) expect(s).toContain(b);
    expect(s).toContain("En trabajo");
  });

  it("desactualizada: dice el motivo y ofrece recalcular conservando las decisiones", () => {
    const s = html(createElement(CabeceraProyeccion, { ...acciones, proyeccion: proyeccion({ desactualizada: [{ codigo: "cargas_nuevas", mensaje: "Se publicó 2026-10 en M5." }] }) }));
    expect(s).toContain("La proyección está desactualizada");
    expect(s).toContain("Se publicó 2026-10 en M5.");
    expect(s).toContain("Recalcular ahora");
    expect(s).toContain("conserva todas tus decisiones");
  });

  it("calculando: lo dice y no deja recalcular ni cerrar", () => {
    const s = html(createElement(CabeceraProyeccion, { ...acciones, proyeccion: proyeccion({ calculando: true, calculando_desde: "2026-10-15T15:00:00Z" }) }));
    expect(s).toContain("se está calculando");
    expect(s).toContain("Calculando…");
    expect(s).not.toContain("Recalcular ahora");
  });

  it("cerrada: solo lectura, se copia para seguir y no se cierra de nuevo", () => {
    const s = html(createElement(CabeceraProyeccion, { ...acciones, proyeccion: proyeccion({ estado: "cerrada", cerrada_at: "2026-10-15T20:00:00Z", cerrada_por_nombre: "Javier" }) }));
    expect(s).toContain("Cerrada");
    expect(s).toContain("solo lectura");
    expect(s).toContain("Copiar para seguir");
    expect(s).not.toContain("Cerrar proyección");
    expect(s).not.toContain("Eliminar");
  });

  it("antes de proyectar: lista bloqueos y avisos con sus detalles", () => {
    const r = respuestaProyeccion({ prerrequisitos: { bloquea: [{ codigo: "meses_faltantes", mensaje: "Faltan meses en M5.", detalle: ["2026-05"] }], avisa: [{ codigo: "apertura_dudosa", mensaje: "T06 no vendió en enero de 2025." }] } });
    const s = html(createElement(AntesDeProyectar, { datos: r.datos, prerrequisitos: r.prerrequisitos }));
    expect(s).toContain("Antes de proyectar");
    expect(s).toContain("1 bloqueo");
    expect(s).toContain("Faltan meses en M5.");
    expect(s).toContain("2026-05");
    expect(s).toContain("T06 no vendió en enero de 2025.");
    expect(s).toContain("<details open");
  });

  it("antes de proyectar sin bloqueos queda plegado y dice que nada bloquea", () => {
    const r = respuestaProyeccion();
    const s = html(createElement(AntesDeProyectar, { datos: r.datos, prerrequisitos: r.prerrequisitos }));
    expect(s).toContain("Nada bloquea");
    expect(s).not.toContain("<details open");
  });

  it("la composición de los bloques lista las tiendas por año con su motivo", () => {
    const s = html(createElement(ComposicionBloques, { bloques: bloques(), anios: [2026, 2027], abierto: true }));
    expect(s).toContain("Mismas tiendas");
    expect(s).toContain("Nuevas del año anterior");
    expect(s).toContain("T10");
    expect(s).toContain("Aperturas del año");
    expect(s).toContain("T12");
    expect(s).toContain("abrió en 2025 después del 1 de enero");
    expect(s).toContain("Fuera de la proyección");
    expect(s).toContain("/maestros/tiendas");
  });
});

describe("línea, filtros, formulario y cierre", () => {
  const propsLinea = { proyeccion: proyeccion(), indice: INDICE, filaId: null, bloqueada: false, nombresAgrupacion: new Map<string, string>(), onFiltro: noop, onFila: noop, onIrATiendas: noop, onCambio: sinVoid, onRecalcular: noop };

  it("sin línea elegida muestra el índice con el estado de cada línea y el resumen", () => {
    const s = html(createElement(LineaTab, { ...propsLinea, filtro: FILTRO_VISTA_VACIO }));
    expect(s).toContain("Elige una línea para empezar");
    for (const e of ["Parcial", "La curva cambió", "Sin proyectar", "Proyectada"]) expect(s).toContain(e);
    expect(s).toContain("DENIM");
    expect(s).toContain("5 líneas");
    expect(s).toContain("Buscar línea");
  });

  it("con una línea elegida muestra su título, las vecinas y mientras lee, el aviso de lectura", () => {
    const s = html(createElement(LineaTab, { ...propsLinea, filtro: { ...FILTRO_VISTA_VACIO, genero: "g-h", mundo: "m-u", linea: "l-polo" } }));
    expect(s).toContain("HOMBRE · URBANO · POLO");
    expect(s).toContain("← Anterior");
    expect(s).toContain("Siguiente →");
    expect(s).toContain('aria-current="true"');
  });

  it("la barra de filtros trae los siete filtros y los chips Solo", () => {
    const s = html(createElement(FiltrosVista, { filtro: { ...FILTRO_VISTA_VACIO, solo: "sin_proyectar", genero: "g-h" }, indice: INDICE, agrupacionesEstacionalidad: [{ id: "ag1", nombre: "DENIM HO" }], agrupacionesMarca: [{ id: "am1", nombre: "RECONOCIDO" }], onCambiar: noop, onLimpiar: noop }));
    for (const t of ["Género", "Mundo", "Línea", "Temporada", "Agrupación de estacionalidad", "Agrupación de marca", "Solo", "Con tiendas nuevas", "Sin proyectar", "Parciales", "La curva cambió", "La propuesta cambió", "Cola larga"]) expect(s).toContain(t);
    expect(s).toContain("DENIM HO");
    expect(s).toContain("RECONOCIDO");
    expect(s).toContain("Quitar filtros");
  });

  it("nueva proyección: nombre por defecto, rampa sin rampa, cola larga 100, copiar de y la composición de los bloques", () => {
    const estado = respuestaProyeccion();
    const s = html(createElement(FormularioProyeccion, { estado, bloques: estado.bloques_hoy, perfiles: [{ tienda: "T05", ratios: [2.9, 1.8] }], onCerrar: noop, onGuardada: noop }));
    expect(s).toContain("Nueva proyección");
    expect(s).toContain('value="Proyección 2026–2027"');
    expect(s).toContain("Datos hasta");
    expect(s).toContain("1 · 1 · 1");
    expect(s).toContain("(sin rampa)");
    expect(s).toContain('value="100"');
    expect(s).toContain("Copiar decisiones de");
    expect(s).toContain("×2.9 · ×1.8");
    expect(s).toContain("Composición de los bloques");
    expect(s).toContain("Crear y calcular");
  });

  it("sin meses publicados no deja crear", () => {
    const estado = respuestaProyeccion({ datos: { ...respuestaProyeccion().datos, ultimo_mes_cerrado: null, hasta: null, desde: null, meses_publicados: [] } });
    const s = html(createElement(FormularioProyeccion, { estado, bloques: estado.bloques_hoy, perfiles: [], onCerrar: noop, onGuardada: noop }));
    expect(s).toContain("No hay meses publicados en M5");
  });

  it("parámetros de una proyección existente", () => {
    const estado = respuestaProyeccion();
    const s = html(createElement(FormularioProyeccion, { estado, proyeccion: proyeccion(), bloques: proyeccion().bloques, perfiles: [], onCerrar: noop, onGuardada: noop }));
    expect(s).toContain("Parámetros · Proyección 2026–2027");
    expect(s).toContain("Guardar parámetros");
    expect(s).not.toContain("Copiar decisiones de");
  });

  it("cerrar: resume filas decididas, cola larga y exige forzar si está desactualizada", () => {
    const s = html(createElement(CerrarModal, { proyeccion: proyeccion({ desactualizada: [{ codigo: "cargas_nuevas", mensaje: "Se publicó 2026-10." }] }), onCerrar: noop, onCerrada: noop, onRecalcular: noop }));
    expect(s).toContain("Cerrar Proyección 2026–2027");
    expect(s).toContain("418 filas decididas");
    expect(s).toContain("509 registros de cola larga se cerrarán con la propuesta");
    expect(s).toContain("Cerrar de todos modos");
    expect(s).toContain("100 unidades");
    expect(s).toContain("solo lectura");
    expect(s).toMatch(/<button[^>]*disabled[^>]*>Cerrar proyección<\/button>/);
  });

  it("archivar la cerrada avisa que el año queda sin proyección cerrada y que M8 no tendrá datos", () => {
    const s = html(createElement(ArchivarModal, { proyeccion: proyeccion({ estado: "cerrada" }), onCerrar: noop, onArchivada: noop }));
    expect(s).toContain("Archivar Proyección 2026–2027");
    expect(s).toContain("Esta es la proyección cerrada de 2026.");
    expect(s).toContain("quedará sin proyección cerrada");
    expect(s).toContain("M8 (flujo de mercadería) no tendrá datos");
    expect(s).toContain("Archivar y dejar 2026 sin proyección cerrada");
  });

  it("la tendencia aparece junto al crecimiento solo si la API la entrega", () => {
    const base = respuestaProyeccion();
    const sin = html(createElement(FormularioProyeccion, { estado: base, bloques: base.bloques_hoy, perfiles: [], onCerrar: noop, onGuardada: noop }));
    expect(sin).not.toContain("Referencia: la tendencia");
    const con = { ...base, datos: { ...base.datos, tendencia_ultimo_anio_pct: 4.9 } };
    const s = html(createElement(FormularioProyeccion, { estado: con, bloques: base.bloques_hoy, perfiles: [], onCerrar: noop, onGuardada: noop }));
    expect(s).toContain("Referencia: la tendencia de 2025 frente a 2024 fue +4.9 %.");
  });

  it("atajo a Tiendas: fechas, venta esperada sin IGV y tienda de referencia", () => {
    const m4: TiendaFila = { id: "tienda-12", codigo: "T12", nombre: "TIENDA NUEVA B", tipo: "Tienda", zona: "NORTE", razon_social: null, fecha_apertura: "2027-03-15", fecha_cierre: null, venta_esperada_promedio: 85000, tienda_referencia_id: "tienda-3", tienda_referencia: { codigo: "T03", nombre: "TIENDA 3" }, activo: true, created_at: "", updated_at: "", estado: "Planificada" };
    const otra: TiendaFila = { ...m4, id: "tienda-3", codigo: "T03", nombre: "TIENDA 3", tienda_referencia_id: null, tienda_referencia: null };
    const s = html(createElement(AtajoTienda, { tienda: m4, tiendas: [m4, otra], onCerrar: noop, onGuardado: noop }));
    expect(s).toContain("T12 · TIENDA NUEVA B");
    expect(s).toContain('value="2027-03-15"');
    expect(s).toContain("Venta mensual promedio esperada (S/, sin IGV)");
    expect(s).toContain('placeholder="850000"');
    expect(s).toContain("Soles que la tienda venderá en un mes promedio, ya en régimen y sin IGV. M7 la multiplica por 12");
    expect(s).not.toContain("año de apertura");
    expect(s).not.toContain("S/ por mes");
    expect(s).toContain("Tienda de referencia");
    expect(s).toContain("T03 · TIENDA 3");
    expect(s).not.toContain("T12 · TIENDA NUEVA B</option>");
    expect(s).toContain("desactualizada");
  });
});

describe("errores de la API", () => {
  it("datos_cambiaron ofrece calcular de nuevo; calculo_en_curso, actualizar; un error sin acción no ofrece nada", () => {
    const a = html(createElement(AlertaError, { error: { mensaje: "Se publicó un mes mientras se calculaba.", codigo: "datos_cambiaron" }, onCerrar: noop, onRecalcular: noop, onRecargar: noop }));
    expect(a).toContain("Se publicó un mes mientras se calculaba.");
    expect(a).toContain("Calcular de nuevo");
    const b = html(createElement(AlertaError, { error: { mensaje: "Se está calculando.", codigo: "calculo_en_curso" }, onCerrar: noop, onRecalcular: noop, onRecargar: noop }));
    expect(b).toContain("Actualizar pantalla");
    const c = html(createElement(AlertaError, { error: { mensaje: "El total no puede ser menor que lo vendido.", codigo: "menor_que_vendido" }, onCerrar: noop }));
    expect(c).not.toContain("underline");
    expect(c).toContain("menor que lo vendido");
    expect(html(createElement(AlertaError, { error: "texto suelto", onCerrar: noop }))).toContain("texto suelto");
  });
});

describe("Tiendas (M4): tienda de referencia y ayuda de la venta esperada", () => {
  const m4: TiendaFila = { id: "t1", codigo: "T01", nombre: "TIENDA 1", tipo: "Tienda", zona: null, razon_social: null, fecha_apertura: "2020-01-10", fecha_cierre: null, venta_esperada_promedio: null, activo: true, created_at: "", updated_at: "", estado: "Activa" };

  it("el formulario trae el selector de referente y la ayuda «venta mensual promedio, sin IGV»", () => {
    const s = html(createElement(CamposTienda, { valor: FORM_VACIO, onCambio: noop, idLista: "x", tiendasReferencia: [m4, { ...m4, id: "t2", codigo: "T02", nombre: "TIENDA 2" }], idActual: "t1" }));
    expect(s).toContain("Venta mensual promedio esperada (S/, sin IGV)");
    expect(s).toContain("Soles que la tienda venderá en un mes promedio, ya en régimen y sin IGV. M7 la multiplica por 12 y la reparte con la estacionalidad en los meses en que la tienda esté abierta: si abre en marzo, en ese año solo cuentan de marzo a diciembre.");
    expect(s).not.toContain("año de apertura");
    expect(s).toContain("Tienda de referencia");
    expect(s).toContain("Sin referente (promedio de la red)");
    expect(s).toContain("T02 · TIENDA 2");
    expect(s).not.toContain("T01 · TIENDA 1</option>");
  });

  it("sin lista de tiendas (p. ej. el comprador, que no recibe la referencia) el campo no aparece", () => {
    const s = html(createElement(CamposTienda, { valor: FORM_VACIO, onCambio: noop, idLista: "x" }));
    expect(s).not.toContain("Tienda de referencia");
  });

  it("el PATCH solo manda el referente si cambió", () => {
    const sin = camposDeTienda(m4);
    expect(cambiosDeEdicion(m4, sin)).toBeNull();
    expect(cambiosDeEdicion(m4, { ...sin, referencia: "t2" })).toEqual({ tienda_referencia_id: "t2" });
    const con: TiendaFila = { ...m4, tienda_referencia_id: "t2", tienda_referencia: { codigo: "T02", nombre: "TIENDA 2" } };
    expect(camposDeTienda(con).referencia).toBe("t2");
    expect(cambiosDeEdicion(con, camposDeTienda(con))).toBeNull();
    expect(cambiosDeEdicion(con, { ...camposDeTienda(con), referencia: "" })).toEqual({ tienda_referencia_id: null });
  });
});

describe("cola larga con disponibilidad y filas para revisión (0.10.1)", () => {
  const base = { anioEnCurso: 2026, bloqueada: false, ocupado: false, factoresMes: null, onDecidir: sinAsync, onAplicarCurva: sinAsync };

  it("el detalle de la fila muestra disponibilidad, tienda-meses, ritmo, meses sin stock, venta corregida, veredicto y la advertencia", () => {
    const s = html(createElement(ColaLargaDetalle, { cola: colaLarga() }));
    expect(s).toContain("Cola larga · disponibilidad");
    expect(s).toContain("62.0 %");
    expect(s).toContain("67 de 108");
    expect(s).toContain("1.4");
    expect(s).toContain("Meses sin stock en ninguna tienda");
    expect(s).toContain("180.5");
    expect(s).toContain("Para revisión: hay que decidirla para cerrar");
    expect(s).toContain("si esta línea la llevan solo algunas tiendas");
    expect(s).toContain("demanda corregida queda inflada");
    expect(s).toContain("proxy mensual");
  });

  it("cierra con quiebres: informativo, con la advertencia; sin dato: no se pudo medir y sin cifras", () => {
    const q = html(createElement(ColaLargaDetalle, { cola: colaLarga({ veredicto: "cierra_con_quiebres", demanda_corregida: 90 }) }));
    expect(q).toContain("se cierra con la propuesta");
    expect(q).toContain("demanda corregida queda inflada");
    const sd = html(createElement(ColaLargaDetalle, { cola: colaLarga({ veredicto: "sin_dato", disponibilidad: null, demanda_corregida: null }) }));
    expect(sd).toContain("no se pudo medir la disponibilidad");
    expect(sd).not.toContain("Tienda-meses con stock");
    const ok = html(createElement(ColaLargaDetalle, { cola: colaLarga({ veredicto: "cierra" }) }));
    expect(ok).not.toContain("demanda corregida queda inflada");
  });

  it("la tabla marca la fila para revisión con su disponibilidad y venta corregida", () => {
    const datos = respuestaLineas({ filas: [filaRevision()] });
    const s = html(createElement(TablaFilas, { filas: datos.filas, lineas: datos, secciones: [], anioEnCurso: Y, bloqueada: false, ocupado: false, filaSeleccionada: null, onSeleccionar: noop, onDecidir: sinAsync, onCsv: noop }));
    expect(s).toContain("Para revisión · disponibilidad 62.0 % · corregida 181");
    expect(s).toContain("revision cola larga");
  });

  it("«Tu decisión» de una fila para revisión: la propuesta es la demanda corregida y el avance normal va al lado", () => {
    const f = filaRevision();
    const s = html(createElement(BloqueDecision, { ...base, anio: 2026, registro: f.anios[0] }));
    expect(s).toContain("Para revisión: la propuesta es la demanda corregida por disponibilidad (180)");
    expect(s).toContain("el avance normal (60) queda como referencia");
    expect(s).toContain("Con el avance normal saldrían");
    expect(s).toContain("Hay que decidir esta fila para poder cerrar");
    expect(s).toContain("Aceptar la propuesta");
  });

  it("«Tu decisión» de Y+1 en una fila para revisión no repite la frase de Y: usa la base de Y × (1 + crecimiento bruto)", () => {
    const f = filaRevision();
    const s = html(createElement(BloqueDecision, { ...base, anio: 2027, registro: f.anios[1] }));
    expect(s).toContain("la propuesta es la base de 2026 de las mismas tiendas × (1 + crecimiento bruto)");
    expect(s).not.toContain("normalizada por el Niño");
    expect(s).not.toContain("la propuesta es la demanda corregida por disponibilidad");
    expect(s).not.toContain("el avance normal (—)");
    expect(s).not.toContain("Con el avance normal saldrían");
  });

  it("el bloque de cola larga no usa una frase circular", () => {
    const s = html(createElement(ColaLargaDetalle, { cola: colaLarga() }));
    expect(s).not.toContain("saldría la cifra de");
    expect(s).toContain("va la cifra que saldría con el avance normal, solo como referencia");
  });

  it("la matriz dice «N filas para revisión» con atajo al filtro; sin filas no dice nada", () => {
    const r = respuestaMatriz().resumen;
    const s = html(createElement(PieMatriz, { resumen: r, anioEnCurso: Y, solo: "", onVerRevision: noop }));
    expect(s).toContain("12 filas para revisión");
    expect(s).toContain("Ver solo las líneas para revisión");
    expect(html(createElement(PieMatriz, { resumen: r, anioEnCurso: Y, solo: "para_revision", onVerRevision: noop }))).not.toContain("Ver solo las líneas");
    expect(html(createElement(PieMatriz, { resumen: { ...r, filas_para_revision: 0 }, anioEnCurso: Y, solo: "", onVerRevision: noop }))).not.toContain("para revisión");
  });

  it("el chip «Para revisión» está entre los filtros Solo", () => {
    const s = html(createElement(FiltrosVista, { filtro: FILTRO_VISTA_VACIO, indice: INDICE, agrupacionesEstacionalidad: [], agrupacionesMarca: [], onCambiar: noop, onLimpiar: noop }));
    expect(s).toContain("Para revisión");
  });

  it("el cierre lista por separado las filas por umbral y las de revisión, con totales y el tope de 50", () => {
    const g = { total: 55, lineas: Array.from({ length: 50 }, (_, i) => `HOMBRE · URBANO · DENIM · VALOR · 2026 · propuesta ${i} (demanda corregida 180 · disponibilidad 62.0 %)`) };
    const s = html(createElement(GrupoLista, { titulo: "Filas para revisión por cola larga con quiebres de stock", grupo: g, pista: "ayuda" }));
    expect(s).toContain("primeras 50 de 55");
    expect(s).not.toMatch(/\(\d+\) \(\d+\)/);
    expect(s).toContain("… y 5 más.");
    expect(s).toContain("demanda corregida 180 · disponibilidad 62.0 %");
    const corto = html(createElement(GrupoLista, { titulo: "Filas", grupo: { total: 2, lineas: ["a", "b"] }, pista: "p" }));
    expect(corto).toContain("Filas (2)");
    expect(html(createElement(GrupoLista, { titulo: "Filas para revisión por cola larga con quiebres de stock", grupo: { total: 2, lineas: ["a", "b"] }, pista: "p" }))).toContain("quiebres de stock (2)");
    expect(corto).not.toContain("más.");
  });

  it("el cierre resume las filas para revisión y explica que bloquean", () => {
    const s = html(createElement(CerrarModal, { proyeccion: proyeccion(), onCerrar: noop, onCerrada: noop, onRecalcular: noop }));
    expect(s).toContain("12 filas para revisión: cola larga con quiebres de stock; hay que decidirlas para cerrar");
    expect(s).toContain("una fila para revisión (cola larga con quiebres de stock)");
  });

  it("«Nueva proyección» trae el umbral de disponibilidad (0.75) con la ayuda honesta del proxy", () => {
    const estado = respuestaProyeccion();
    const s = html(createElement(FormularioProyeccion, { estado, bloques: estado.bloques_hoy, perfiles: [], onCerrar: noop, onGuardada: noop }));
    expect(s).toContain("Umbral de disponibilidad (0 a 1)");
    expect(s).toContain('value="0.75"');
    expect(s).toContain("tienda-meses con stock al cierre del mes ÷ tienda-meses totales");
    expect(s).toContain("Una tienda sin stock puede ser un quiebre o una línea que no se surte en esa tienda");
    expect(s).toContain("el umbral es editable");
  });

  it("los parámetros de una proyección existente traen su umbral de disponibilidad", () => {
    const estado = respuestaProyeccion();
    const p = proyeccion();
    p.parametros.umbral_disponibilidad = 0.6;
    const s = html(createElement(FormularioProyeccion, { estado, proyeccion: p, bloques: p.bloques, perfiles: [], onCerrar: noop, onGuardada: noop }));
    expect(s).toContain('value="0.6"');
    expect(s).toContain("pendiente de recalcular");
  });

  it("la cabecera explica el método nuevo como motivo de desactualizada", () => {
    const acciones = { calculandoLocal: false, ocupado: false, onRecalcular: noop, onParametros: noop, onCerrar: noop, onArchivar: noop, onEliminar: noop, onCopiar: noop };
    const s = html(createElement(CabeceraProyeccion, { ...acciones, proyeccion: proyeccion({ desactualizada: [{ codigo: "version_metodo", mensaje: "x" }] }) }));
    expect(s).toContain("método nuevo");
    expect(s).toContain("12 filas para revisión");
  });
});
