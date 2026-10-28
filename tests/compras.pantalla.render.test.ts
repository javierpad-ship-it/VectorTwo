import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AvisoPorConfirmar } from "../src/components/compras/aviso-por-confirmar";
import { AvisosFlujo } from "../src/components/compras/avisos-flujo";
import { DetalleCompra } from "../src/components/compras/detalle-compra";
import { DetalleFila } from "../src/components/compras/detalle-fila";
import { DialogoCancelar } from "../src/components/compras/dialogo-cancelar";
import { DialogoIngreso } from "../src/components/compras/dialogo-ingreso";
import { DialogoParametros } from "../src/components/compras/dialogo-parametros";
import { BarraFiltrosCompras } from "../src/components/compras/barra-filtros-compras";
import { ImportarCompras, ReporteImportacionCompras } from "../src/components/compras/importar-compras";
import { TotalesGrupo } from "../src/components/compras/totales-grupo";
import { textoErrorImportar } from "../src/components/compras/use-importar-compras";
import { ErrorApi } from "../src/lib/api-client";
import { PARAMETROS_COMPRAS_VACIOS } from "../src/components/compras/vista-compras";
import { ListaCompras } from "../src/components/compras/lista-compras";
import { ListaFilas } from "../src/components/compras/lista-filas";
import { PestanaConciliacion } from "../src/components/compras/pestana-conciliacion";
import { MedidorImi, SelloSenal } from "../src/components/compras/senal";
import { TablaMatriz } from "../src/components/compras/tabla-matriz";
import { TarjetaHueco } from "../src/components/compras/tarjeta-hueco";
import { columnasDetalle, columnasTotales, filasMatrizDetalle, filasMatrizTotales } from "../src/components/compras/matriz";
import { unidades } from "../src/components/compras/formato";
import { filasDeLista, ORDEN_INICIAL } from "../src/components/compras/vista-flujo";
import {
  compraApiC09Vencida,
  compraApiC12,
  compraApiC12Parcial,
  compraApiC12SaldoCerrado,
  compraApiC20Lote,
  compraApiCancelada,
  comprasApiEjemplo,
  reporteImportacionEjemplo,
} from "./compras.fixture";
import { conciliacionEjemplo, filaCamisaJhEjemplo, filaDenimEjemplo, flujoEjemplo, huecosEjemplo, parametrosEjemplo } from "./flujo.fixture";

/** Humo de render con los fixtures de T0: ningún componente de presentación de M8 debe lanzar y los textos y cifras clave deben salir. */

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const noop = () => {};
const RANGO = { imi_min: 4, imi_max: 8, meses_tarjeta: 6 };

describe("Huecos: tarjeta, sello y medidor", () => {
  const huecos = huecosEjemplo();
  const tarjeta = (pred: (t: (typeof huecos.tarjetas)[number]) => boolean) => {
    const t = huecos.tarjetas.find(pred);
    if (!t) throw new Error("el fixture no trae la tarjeta esperada");
    return t;
  };
  const props = { imiMin: 4, imiMax: 8, periodos: huecos.datos.periodos, meses: 6, kPrima: huecos.datos.k_prima };

  it("DENIM × RECONOCIDO: falta, IMI de set con el rango, saldo de los próximos seis meses y el stock con el CD como detalle", () => {
    const t = tarjeta((x) => x.linea === "DENIM");
    const h = html(createElement(TarjetaHueco, { ...props, tarjeta: t }));
    for (const t of ["HOMBRE · URBANO", "DENIM", "RECONOCIDO", "Falta", "IMI a set", "4.4 m", "(4 · 8)", "Saldo oct–mar", "700 u", "CD 300", "500 u", "(nov)", "Ver flujo"]) expect(h, t).toContain(t);
    expect(h).toContain(`${unidades(t.resumen.saldo_n_meses)} u`);
    expect(h).toContain("falta en oct (83) y desde feb");
    expect(h).toContain('role="meter"');
  });

  it("toda la tarjeta abre el flujo de la fila con su clave en la URL", () => {
    const h = html(createElement(TarjetaHueco, { ...props, tarjeta: tarjeta((t) => t.linea === "DENIM") }));
    expect(h).toMatch(/href="\/compras\/flujo\?gml=[^"]+&amp;agr=[^"]+"/);
  });

  it("la fila de JH muestra el subflujo con su rango; una equivalencia se escribe «línea › equivalencia»", () => {
    const h = html(createElement(TarjetaHueco, { ...props, tarjeta: tarjeta((t) => t.subflujos_resumen.length > 0 && t.linea === "CAMISA") }));
    expect(h).toContain("CAMISA › MANGA LARGA");
    expect(h).toContain("JOHN HOLDEN");
    expect(h).toContain("rango 4–8");
  });

  it("una tarjeta con entregas por confirmar lleva la banda; con respaldo del inventario, «posible doble conteo»", () => {
    const base = tarjeta((t) => t.linea === "DENIM");
    const sin = html(createElement(TarjetaHueco, { ...props, tarjeta: { ...base, resumen: { ...base.resumen, por_confirmar: 200, posible_doble_conteo: 0 } } }));
    expect(sin).toContain("200 u por confirmar");
    expect(sin).not.toContain("posible doble conteo");
    const con = html(createElement(TarjetaHueco, { ...props, tarjeta: { ...base, resumen: { ...base.resumen, por_confirmar: 200, posible_doble_conteo: 200 } } }));
    expect(con).toContain("⚠ 200 u por confirmar · posible doble conteo");
    expect(html(createElement(TarjetaHueco, { ...props, tarjeta: base }))).not.toContain("por confirmar");
  });

  it("una fila sin curva lo dice y no muestra IMI", () => {
    const base = tarjeta((t) => t.linea === "DENIM");
    const h = html(createElement(TarjetaHueco, { ...props, tarjeta: { ...base, resumen: { ...base.resumen, senal: "sin_curva", imi_k: null } } }));
    expect(h).toContain("Sin curva");
    expect(h).toContain("sin repartir por mes");
    expect(h).toContain("— m");
  });

  it("el medidor: sin IMI queda vacío y el valor accesible dice el rango", () => {
    expect(html(createElement(MedidorImi, { valor: 4.4, min: 4, max: 8, etiqueta: "IMI" }))).toContain("4.4 meses; rango 4 a 8");
    expect(html(createElement(MedidorImi, { valor: null, min: 4, max: 8, etiqueta: "IMI" }))).toContain("sin IMI");
    for (const s of ["quiebre", "falta", "exceso", "al_dia", "sin_demanda", "sin_curva"] as const) expect(html(createElement(SelloSenal, { senal: s }))).toContain("uppercase");
  });
});

describe("avisos de cabecera", () => {
  const { datos } = flujoEjemplo();

  it("«Por confirmar» cuenta las entregas, avisa del posible doble conteo y ofrece Revisar; sin entregas no pinta nada", () => {
    const h = html(createElement(AvisoPorConfirmar, { resumen: { entregas: 14, unidades: 3400, con_respaldo_entregas: 5, con_respaldo_unidades: 1900 }, mes: "2026-10" }));
    expect(h).toContain("14 entregas vencidas sin confirmar");
    expect(h).toContain("3,400 u");
    expect(h).toContain("oct-2026");
    expect(h).toContain("En 5 de ellas");
    expect(h).toContain("posible doble conteo");
    expect(h).toContain("/compras/flujo?pestana=conciliacion&amp;solo=por_confirmar");
    expect(html(createElement(AvisoPorConfirmar, { resumen: { entregas: 0, unidades: 0, con_respaldo_entregas: 0, con_respaldo_unidades: 0 } }))).toBe("");
    const boton = html(createElement(AvisoPorConfirmar, { resumen: { entregas: 1, unidades: 200, con_respaldo_entregas: 0, con_respaldo_unidades: 0 }, onRevisar: noop }));
    expect(boton).toContain("<button");
    expect(boton).toContain("1 entrega vencida sin confirmar");
  });

  it("los avisos con cifras salen en castellano y `entregas_sin_confirmar` no se repite aquí", () => {
    const h = html(createElement(AvisosFlujo, { datos: { ...datos, avisos: ["entregas_sin_confirmar", "filas_sin_curva", "cerrada_atrasada", "stock_en_tiendas_inactivas"], stock_excluido: { stock: 0, unidades: 120 } }, enlaceProyeccion: true }));
    expect(h).toContain("quedan fuera del IMI total");
    expect(h).toContain("120 u en tiendas desactivadas");
    expect(h).toContain("Cierra una nueva");
    expect(h).toContain("/planificacion/proyeccion");
    expect(h).not.toContain("vencidas sin confirmar");
    expect(html(createElement(AvisosFlujo, { datos: { ...datos, avisos: ["cerrada_atrasada"] } }))).not.toContain("/planificacion/proyeccion");
    expect(html(createElement(AvisosFlujo, { datos: { ...datos, avisos: [] } }))).toBe("");
  });
});

describe("Flujo mensual: la tabla de una fila (DENIM × RECONOCIDO, caso 1)", () => {
  const denim = filaDenimEjemplo();
  const ctx = { imiMin: 4, imiMax: 8 };
  const celda = (filas: ReturnType<typeof filasMatrizDetalle>, clave: string, periodo: string, columnas = columnasDetalle(denim, 3)) => {
    const fila = filas.find((f) => f.clave === clave);
    const i = columnas.findIndex((c) => c.periodo === periodo);
    if (!fila || i < 0) throw new Error(`sin celda ${clave} ${periodo}`);
    return fila.celdas[i];
  };

  it("tres meses de historia, el mes publicado y el horizonte; las cifras del ejemplo de la ficha", () => {
    const columnas = columnasDetalle(denim, 3);
    expect(columnas.slice(0, 3).map((c) => [c.periodo, c.fase])).toEqual([["2026-07", "historia"], ["2026-08", "historia"], ["2026-09", "k"]]);
    expect(columnas[3]).toEqual({ periodo: "2026-10", fase: "horizonte" });
    const filas = filasMatrizDetalle(denim, columnas, ctx);
    expect(celda(filas, "demanda", "2026-09").texto).toBe("1,410");
    expect(celda(filas, "demanda", "2026-10").texto).toBe("150");
    expect(celda(filas, "stock", "2026-09").texto).toBe("700");
    expect(celda(filas, "stock", "2026-10").texto).toBe("550");
    expect(celda(filas, "stock", "2026-11").texto).toBe("900");
    expect(celda(filas, "entregas", "2026-11").texto).toBe("500");
    expect(celda(filas, "vpm", "2026-10").texto).toBe("158.3");
    expect(celda(filas, "imi", "2026-09").texto).toBe("4.4");
    expect(celda(filas, "imi", "2026-10")).toMatchObject({ texto: "3.5", tono: "alerta" });
    expect(celda(filas, "saldo", "2026-10")).toMatchObject({ texto: "83", tono: "alerta" });
    expect(celda(filas, "saldo", "2026-11").texto).toBe("0");
    expect(celda(filas, "senal", "2026-10").texto).toBe("falta");
  });

  it("sin historia solo quedan el mes publicado y el horizonte; con doce meses, doce a la izquierda", () => {
    expect(columnasDetalle(denim, 1)[0]).toEqual({ periodo: "2026-09", fase: "k" });
    expect(columnasDetalle(denim, 12).filter((c) => c.fase !== "horizonte")).toHaveLength(12);
  });

  it("la fila de ingresos del inventario y las recepciones registradas marcan lo que quedó sin registrar", () => {
    const filas = filasMatrizDetalle(denim, columnasDetalle(denim, 3), ctx);
    expect(filas.find((f) => f.clave === "ingreso_inferido")?.celdas.map((c) => c.texto)[2]).toBe("120");
    const recepciones = filas.find((f) => f.clave === "recepciones");
    expect(recepciones?.celdas.some((c) => c.texto.includes("sin registrar"))).toBe(true);
  });

  it("la tabla se pinta con encabezados de mes, una fila por magnitud y la primera columna fija", () => {
    const columnas = columnasDetalle(denim, 3);
    const h = html(createElement(TablaMatriz, { columnas, filas: filasMatrizDetalle(denim, columnas, ctx), titulo: "Flujo" }));
    for (const t of ["jul-26", "ago-26", "set-26", "oct-26", "último publicado", "Stock fin de mes (cadena)", "IMI sin compras sugeridas", "Saldo por comprar (debe llegar)", "Exceso (sobre 8 meses)", "Señal (IMI fuera de 4–8)"]) expect(h, t).toContain(t);
    expect(h).toContain("sticky left-0");
    expect(h).toContain("overflow-x-auto");
  });

  it("entregas vencidas: la celda del primer mes las separa; con posible doble conteo, los meses siguientes llevan la marca", () => {
    const d = filaDenimEjemplo();
    d.entregas = [{ ...d.entregas[0], vencida: true, pendiente: 200, periodo: "2026-09" }];
    d.avisos = ["entregas_vencidas", "posible_doble_conteo"];
    d.resumen = { ...d.resumen, por_confirmar: 200, posible_doble_conteo: 200 };
    const columnas = columnasDetalle(d, 3);
    const filas = filasMatrizDetalle(d, columnas, ctx);
    expect(celda(filas, "entregas", "2026-10", columnas).texto).toContain("200 vencidas ⚠");
    expect(celda(filas, "stock", "2026-12", columnas)).toMatchObject({ tono: "alerta" });
    expect(celda(filas, "stock", "2026-12", columnas).ayuda).toContain("Puede estar inflado");
    const h = html(createElement(DetalleFila, { detalle: d, parametros: RANGO, historia: 3, onHistoria: noop }));
    expect(h).toContain("posible doble conteo");
    expect(h).toContain("Entregas que llegan");
    expect(h).toContain("C-000012");
    expect(h).toContain("/compras/registro?compra=");
  });

  it("detalle completo: título, stock de la cadena con el CD y la historia elegible", () => {
    const h = html(createElement(DetalleFila, { detalle: denim, parametros: RANGO, historia: 3, onHistoria: noop }));
    for (const t of ["HOMBRE · URBANO · DENIM", "RECONOCIDO", "cadena 700 (CD 300 · tiendas 400)", "Sin historia", "12 meses", "Ninguna compra"]) {
      if (t === "Ninguna compra") continue;
      expect(h, t).toContain(t);
    }
    expect(h).not.toContain("Subflujo intercompany");
  });

  it("una fila con JH muestra el subflujo (rango, % directo, observado frente a la regla), la reposición directa y el resto", () => {
    const camisa = filaCamisaJhEjemplo();
    const columnas = columnasDetalle(camisa, 3);
    const filas = filasMatrizDetalle(camisa, columnas, ctx);
    const repos = filas.find((f) => f.clave === "reposicion");
    expect(repos?.etiqueta).toContain("JOHN HOLDEN 80 %");
    expect(celda(filas, "reposicion", "2026-10", columnas).texto).toBe("384");
    const h = html(createElement(DetalleFila, { detalle: camisa, parametros: RANGO, historia: 3, onHistoria: noop }));
    for (const t of ["Subflujo intercompany", "JOHN HOLDEN", "rango 4–8", "80 % directo", "Directo observado", "52 %", "regla: 80 %", "se infla si no se registran las compras al CD", "Resto de la fila", "no la demanda entera"]) expect(h, t).toContain(t);
    expect(h).toContain("demanda JOHN HOLDEN (40 %)");
  });

  it("los totales de la lista suman por mes e incluyen la reposición solo si la serie la trae", () => {
    const flujo = flujoEjemplo();
    const cols = columnasTotales(flujo.datos.periodos);
    const filas = filasMatrizTotales(flujo.totales, cols, ctx);
    expect(filas.map((f) => f.clave)).toEqual(["demanda", "ingresos", "stock", "imi", "saldo", "exceso", "senal"]);
    expect(filasMatrizTotales({ ...flujo.totales, reposicion: flujo.totales.demanda }, cols, ctx).some((f) => f.clave === "reposicion")).toBe(true);
    expect(cols[0].fase).toBe("k");
  });
});

describe("Flujo mensual: la lista de filas", () => {
  const flujo = flujoEjemplo();
  const filas = filasDeLista(flujo.filas, flujo.catalogo);
  const h = html(createElement(ListaFilas, { filas, parametros: RANGO, orden: ORDEN_INICIAL, onOrdenar: noop, enlace: (f) => `/compras/flujo?gml=${f.fila.gml_id}` }));

  it("columnas de la ficha con orden por columna, el CD como detalle y un enlace por fila", () => {
    for (const t of ["Fila", "Estado", "IMI", "Saldo 6 m", "En camino", "Stock cadena", "Por confirmar", "HOMBRE · URBANO · DENIM", "RECONOCIDO", "CD 300"]) expect(h, t).toContain(t);
    expect(h).toContain('aria-sort="descending"');
    expect(h).toContain("overflow-x-auto");
    expect(h.match(/href="\/compras\/flujo\?gml=/g)?.length).toBe(flujo.filas.length);
  });

  it("las filas sin curva llevan su aviso", () => {
    expect(h).toContain("Sin curva");
  });
});

describe("Conciliación (caso 9b)", () => {
  const datos = conciliacionEjemplo();
  const props = { datos, cargando: false, periodo: "2026-09", meses: ["2026-09", "2026-08"], onPeriodo: noop, aceptando: null, onAceptar: noop };

  it("el planner ve «Aceptar sugerencia» con el mes y las unidades; el comprador ve la sugerencia sin botón y con «Ver compra»", () => {
    const planner = html(createElement(PestanaConciliacion, { ...props, puedeEscribir: true }));
    expect(planner).toContain("Aceptar sugerencia: 500 u en set-26");
    expect(planner).toContain("C-000009");
    expect(planner).toContain("vencida");
    const comprador = html(createElement(PestanaConciliacion, { ...props, puedeEscribir: false }));
    expect(comprador).not.toContain("Aceptar sugerencia");
    expect(comprador).toContain("Ver compra");
  });

  it("la diferencia dice sin registrar o sin respaldo, el directo observado se compara con la regla y hay totales y avisos del mes", () => {
    const h = html(createElement(PestanaConciliacion, { ...props, puedeEscribir: true }));
    for (const t of ["+120 sin registrar", "+500 sin registrar", "sin respaldo", "de la cual JOHN HOLDEN", "directo observado 80 %", "regla: 80 %", "Totales", "Avisos del mes", "2 filas sin el stock del mes anterior", "Conciliación de ingresos de set-2026", "Mes conciliado"]) expect(h, t).toContain(t);
  });

  it("el botón se desactiva mientras una sugerencia se está aceptando", () => {
    const entrega = datos.filas.flatMap((f) => f.sugerencias)[0].entrega_id;
    const h = html(createElement(PestanaConciliacion, { ...props, puedeEscribir: true, aceptando: entrega }));
    expect(h).toContain("Aceptando…");
    expect(h).toMatch(/<button[^>]*disabled[^>]*>Aceptando…/);
  });

  it("un lote no ofrece el botón en 0.13.0 y manda a la compra; sin mes anterior publicado, lo explica", () => {
    const lote = conciliacionEjemplo();
    lote.filas.forEach((f) => f.sugerencias.forEach((s) => (s.boton = false)));
    const h = html(createElement(PestanaConciliacion, { ...props, datos: lote, puedeEscribir: true }));
    expect(h).not.toContain("Aceptar sugerencia");
    expect(h).toContain("toca varias filas");
    const sinMes = html(createElement(PestanaConciliacion, { ...props, datos: { ...datos, mes_anterior_publicado: false, filas: [] }, puedeEscribir: true }));
    expect(sinMes).toContain("no está publicado");
    expect(sinMes).toContain("Ninguna fila con estos filtros");
  });
});

describe("Compras: lista y detalle", () => {
  it("la lista trae las columnas de la ficha, el estado (con saldo cancelado) y el aviso de entregas por confirmar", () => {
    const h = html(createElement(ListaCompras, { compras: comprasApiEjemplo(), enlace: (c) => `/compras/registro?compra=${c.id}` }));
    for (const t of ["Compra", "Fecha", "Proveedor", "Origen", "Líneas", "Unidades", "Costo", "Entregas", "Recibidas", "Estado", "Creada por", "Último cambio", "Avisos", "C-000012", "Proveedor Norte", "Feria Sur", "Carga inicial", "Cancelada", "Recibida · saldo cancelado (200 u)", "500 u por confirmar", "S/ 19,000.00"]) expect(h, t).toContain(t);
    expect(html(createElement(ListaCompras, { compras: [], enlace: () => "" }))).toContain("Ninguna compra con estos filtros");
  });

  const detalle = (c = compraApiC12Parcial(), puedeEscribir = true) => html(createElement(DetalleCompra, { compra: c, puedeEscribir, onConfirmarIngreso: noop, onQuitarIngreso: noop, onCancelar: noop }));

  it("el planner ve Confirmar ingreso en cada entrega pendiente, Quitar en cada ingreso y Cancelar; el comprador no ve ningún botón", () => {
    const planner = detalle(compraApiC12Parcial(), true);
    expect(planner).toContain("Confirmar ingreso");
    expect(planner).toContain("Cancelar compra");
    const conIngreso = detalle(compraApiC12SaldoCerrado(), true);
    expect(conIngreso).toContain("Quitar");
    const comprador = detalle(compraApiC12Parcial(), false);
    expect(comprador).not.toContain("<button");
    expect(comprador).toContain("C-000012");
    expect(comprador).toContain("Historial de cambios");
  });

  it("muestra cabecera, líneas con costo, entregas con pendiente, ingresos e historial (más reciente primero)", () => {
    const h = detalle(compraApiC12Parcial(), true);
    for (const t of ["Compra C-000012", "Proveedor Norte", "ref. PO-2211", "HOMBRE · URBANO · DENIM", "ALFA", "centrales", "S/ 38.00", "Pendiente", "Parcial", "Ingresos confirmados", "oct-26", "Planner Uno"]) expect(h, t).toContain(t);
    const conHistorial = detalle(compraApiC12SaldoCerrado(), true);
    expect(conHistorial.indexOf("Cerró el saldo de 200 u")).toBeLessThan(conHistorial.indexOf("Importó la línea 1"));
  });

  it("el saldo cerrado se lee «Recibida · saldo cancelado», con quién y el motivo, y ofrece el ingreso tardío", () => {
    const h = detalle(compraApiC12SaldoCerrado(), true);
    expect(h).toContain("Recibida · saldo cancelado (200 u)");
    expect(h).toContain("El proveedor no entrega el saldo");
    expect(h).toContain("Confirmar ingreso tardío");
    expect(h).not.toContain("Cancelar compra");
  });

  it("una compra cancelada no ofrece ninguna acción", () => {
    const h = detalle(compraApiCancelada(), true);
    expect(h).toContain("Cancelada");
    expect(h).toContain("Se compró por error");
    expect(h).not.toContain("Confirmar ingreso");
    expect(h).not.toContain("Quitar");
    expect(h).not.toContain("Cancelar compra");
  });

  it("una entrega vencida se marca «por confirmar» y muestra el mes que propone la conciliación", () => {
    const h = detalle(compraApiC09Vencida(), true);
    expect(h).toContain("Vencida · por confirmar");
    expect(h).toContain("La conciliación propone 500 u en set-26");
    expect(h).toContain("Tiene entregas vencidas sin confirmar");
  });

  it("un lote muestra su reparto guardado por GML con la versión y el error histórico", () => {
    const h = detalle(compraApiC20Lote(), true);
    for (const t of ["Lote de una marca", "al barrer", "Reparto guardado · versión 2 · error histórico 8 pp", "HOMBRE · URBANO · DENIM", "(verano)"]) expect(h, t).toContain(t);
  });

  it("un lote sin reparto vigente lo dice", () => {
    const c = compraApiC20Lote();
    c.lineas[0].reparto = null;
    expect(detalle(c, true)).toContain("Sin reparto vigente");
  });
});

describe("diálogos", () => {
  const compra = compraApiC09Vencida();
  const linea = compra.lineas[0];

  it("Confirmar ingreso: el mes sugerido por la conciliación, las unidades sugeridas, la fecha y el efecto en el flujo", () => {
    const h = html(createElement(DialogoIngreso, { compra, linea, numeroLinea: 1, entrega: linea.entregas[0], kPrima: "2026-09", hoyFecha: "2026-10-27", onGuardado: noop, onRecargar: async () => {}, onCerrar: noop }));
    for (const t of ["Confirmar ingreso · C-000009, línea 1", "Sugerido por la conciliación", 'value="500"', "2026-09-30", "ya está publicado", "Vas a confirmar 500 u de C-000009, línea 1, como ingresadas en set-2026, a tu nombre"]) expect(h, t).toContain(t);
    expect(h).toMatch(/<option value="2026-09" selected/);
    expect(h).toContain("Confirmar ingreso</button>");
  });

  it("Confirmar ingreso de una entrega futura propone el mes en curso y dice que suma al flujo", () => {
    const futura = compraApiC12();
    const l = futura.lineas[0];
    const h = html(createElement(DialogoIngreso, { compra: futura, linea: l, numeroLinea: 1, entrega: l.entregas[0], kPrima: "2026-09", hoyFecha: "2026-10-27", onGuardado: noop, onRecargar: async () => {}, onCerrar: noop }));
    expect(h).toMatch(/<option value="2026-10" selected/);
    expect(h).toContain("2026-10-27");
    expect(h).toContain("suman al flujo en ese mes");
  });

  it("Cancelar pide el motivo y avisa de qué pasa con y sin ingresos", () => {
    const sin = html(createElement(DialogoCancelar, { compra: compraApiC12(), onCancelada: noop, onRecargar: async () => {}, onCerrar: noop }));
    expect(sin).toContain("Motivo de la cancelación");
    expect(sin).toContain("deja de contar en el flujo");
    const con = html(createElement(DialogoCancelar, { compra: compraApiC12Parcial(), onCancelada: noop, onRecargar: async () => {}, onCerrar: noop }));
    expect(con).toContain("se cancela solo el saldo");
  });

  it("Parámetros: rango, meses de la tarjeta, temporadas, umbrales y el aviso de que los repartos quedan obsoletos", () => {
    const h = html(createElement(DialogoParametros, { parametros: parametrosEjemplo(), onGuardado: noop, onCerrar: noop }));
    for (const t of ["Parámetros del flujo", "IMI mínimo (meses)", "IMI máximo (meses)", "Meses de la tarjeta", "Extender el horizonte", "Verano desde", "Invierno hasta", "Umbral de la conciliación (unidades)", "Guardar parámetros", "Último cambio: Planner Uno"]) expect(h, t).toContain(t);
  });
});

describe("Importar compras", () => {
  it("empieza con la plantilla, la casilla de carga inicial marcada y el paso del archivo", () => {
    const h = html(createElement(ImportarCompras, { onAplicado: noop }));
    for (const t of ["Descargar plantilla (Excel)", "Carga inicial de compras ya hechas", "1. Archivo"]) expect(h, t).toContain(t);
    expect(h).toMatch(/type="checkbox"[^>]*checked/);
  });

  it("la previsualización muestra proveedores a crear, compras, líneas con su clasificación, avisos y las omitidas con su motivo", () => {
    const h = html(createElement(ReporteImportacionCompras, { titulo: "3. Previsualización", reporte: reporteImportacionEjemplo("previsualizar"), nombreArchivo: "compras.xlsx" }));
    for (const t of ["Se crearán", "Proveedores que se crearán", "Feria Sur", "Compras (2)", "Líneas (3)", "Nueva", "exceso", "Filas con errores (3)", "Marca y agrupación a la vez", "Entregas inválidas", "Tipo no disponible todavía", "NO se cargarán"]) expect(h, t).toContain(t);
  });

  it("el resultado lista las compras aplicadas con su número", () => {
    const h = html(createElement(ReporteImportacionCompras, { titulo: "4. Resultado", reporte: reporteImportacionEjemplo("aplicar"), nombreArchivo: "compras.xlsx" }));
    expect(h).toContain("Se crearon");
    expect(h).toContain("Compras aplicadas (2)");
    expect(h).toContain("C-000012");
    expect(h).toContain("NO se cargaron");
  });

  it("las compras que no se aplicaron se muestran con el motivo", () => {
    const r = reporteImportacionEjemplo("aplicar");
    r.no_aplicadas = [{ clave: "FERIA SUR|FS-001", proveedor: "Feria Sur", referencia: "FS-001", motivo: "compra_cambio", mensaje: "Otra persona cambió la compra." }];
    expect(html(createElement(ReporteImportacionCompras, { titulo: "4. Resultado", reporte: r, nombreArchivo: "a.xlsx" }))).toContain("Compras que no se aplicaron (1)");
  });
});

describe("Flujo mensual: totales por género, mundo y línea", () => {
  it("la tabla trae las columnas de la ficha, empieza por género y ofrece mundo y línea", () => {
    const flujo = flujoEjemplo();
    const h = html(createElement(TotalesGrupo, { filas: filasDeLista(flujo.filas, flujo.catalogo), rango: { imi_min: 4, imi_max: 8 }, meses: 6 }));
    for (const t of ["Totales por género, mundo y línea", "Por género", "Por mundo", "Por línea", "Stock cadena", "Saldo 6 m", "En camino", "En falta", "En exceso", "Por confirmar", "HOMBRE"]) expect(h, t).toContain(t);
    expect(h).toContain("overflow-x-auto");
  });
});

describe("Compras: filtros de la lista", () => {
  const props = {
    parametros: PARAMETROS_COMPRAS_VACIOS,
    proveedores: [{ id: "p1", nombre: "Proveedor Norte" }],
    generos: [{ id: "g1", nombre: "HOMBRE" }],
    mundos: [{ id: "m1", nombre: "URBANO" }],
    lineas: [{ id: "l1", nombre: "DENIM" }],
    marcas: [{ id: "k1", nombre: "ALFA" }],
    onCambiar: noop,
  };

  it("ofrece mes de entrega, género, mundo, línea y marca además de estado, proveedor y origen", () => {
    const h = html(createElement(BarraFiltrosCompras, props));
    for (const t of ["Entrega desde", "Entrega hasta", "Género", "Mundo", "Línea", "Marca", "Proveedor", "Origen", "Buscar", "Por confirmar", "Proveedor Norte", "ALFA", "DENIM"]) expect(h, t).toContain(t);
    expect(h).toContain('type="month"');
    expect(h).not.toContain("Quitar filtros");
  });

  it("con algún filtro activo aparece «Quitar filtros»", () => {
    expect(html(createElement(BarraFiltrosCompras, { ...props, parametros: { ...PARAMETROS_COMPRAS_VACIOS, desde: "2026-11" } }))).toContain("Quitar filtros");
  });
});

describe("Importar compras: errores de la API", () => {
  it("un 403 explica quién puede importar y los demás errores salen con el mensaje de la API", () => {
    expect(textoErrorImportar(new ErrorApi("Tu rol es de solo lectura.", 403))).toContain("administración y planeamiento");
    expect(textoErrorImportar(new ErrorApi("Por ahora solo se pueden importar compras ya hechas: marca la casilla.", 400, "carga_inicial_requerida"))).toContain("marca la casilla");
    expect(textoErrorImportar(new Error("sin red"))).toBe("sin red");
  });
});
