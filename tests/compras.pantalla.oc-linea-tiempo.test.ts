import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BarraFiltrosCompras } from "../src/components/compras/barra-filtros-compras";
import { DetalleCompra } from "../src/components/compras/detalle-compra";
import { formatoDeColumnaLineaDeTiempo, lineaDeTiempoConFechasDeExcel, serieDeFechaExcel } from "../src/components/compras/descarga";
import { CAMPOS_COMPRAS, plantillaCompras, ReporteImportacionCompras, ReporteOcCompras } from "../src/components/compras/importar-compras";
import { LineaDeTiempoCompra } from "../src/components/compras/linea-tiempo-compra";
import { ListaCompras } from "../src/components/compras/lista-compras";
import { detectarMapeo } from "../src/components/importador/mapeo";
import {
  consultaCompras,
  filtrarCompras,
  filtrosCompras,
  hayFiltrosCompras,
  leerParametrosCompras,
  PARAMETROS_COMPRAS_VACIOS,
} from "../src/components/compras/vista-compras";
import { ETIQUETA_ACCION_OC, ETIQUETA_MOTIVO_OC, totalesOc } from "../src/components/compras/vista-importar";
import { detalleTramo, notasDeHito, textoCambiosHito, textoProximoHito, TEXTO_ESTADO_HITO, tituloTramo } from "../src/components/compras/vista-linea-tiempo";
import { accionDeOc, textoBotonOc, textoConflictoOc, textoOc, textoOcGuardada, validarEdicionOc } from "../src/components/compras/vista-oc";
import { COLUMNA_FECHA_HORA_LINEA_DE_TIEMPO, COLUMNAS_FECHA_LINEA_DE_TIEMPO } from "../src/lib/compras/agrupadores/excel";
import type { HitoApi, TramoLineaTiempoApi } from "../src/lib/compras/agrupadores/tipos-api";
import type { CompraApi, MotivoOcImportacion, OcImportacionApi } from "../src/lib/compras/tipos-api";
import { compraApiC12, compraApiCancelada, reporteImportacionEjemplo } from "./compras.fixture";

/**
 * 08b-1b T3b-2: pantallas de Compras (línea de tiempo por compra, OC editable, lista con «Próximo hito», importador con la columna OC y el
 * Excel con fechas de Excel). Render estático y lógica pura; las interacciones (guardar la OC y sus 409) se probaron en el navegador con
 * un arnés de `fetch` simulado.
 */

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const noop = () => {};

const hito = (h: HitoApi["hito"], estado: HitoApi["estado"], fecha: string | null, extra: Partial<HitoApi> = {}): HitoApi => ({
  hito: h,
  fecha,
  hora: null,
  estado,
  fecha_original: null,
  retraso_dias: null,
  reprogramaciones: 0,
  manda_el_mes: h === "ingreso_stock",
  ...extra,
});

const tramoCalifornia = (): TramoLineaTiempoApi => ({
  embarque: { id: "e1", codigo: "261101", nombre: "California", origen: "Los Ángeles" },
  paquete: null,
  unidades: 300,
  mes: "2026-11",
  hitos: [
    hito("orden_compra", "real", "2026-07-06"),
    hito("zarpe", "pendiente", null),
    hito("arribo", "pendiente", null),
    hito("ingreso_cd", "real", "2026-11-02"),
    hito("inicio_operativo", "real", "2026-11-05", { hora: "09:22" }),
    hito("ingreso_stock", "previsto", "2026-11-08", { igual_a_ingreso_cd: true }),
  ],
});
const tramoNuevaYork = (): TramoLineaTiempoApi => ({
  embarque: { id: "e2", codigo: "261102", nombre: "Nueva York", origen: null },
  paquete: { id: "p1", codigo: "P261102", nombre: "Al barrer" },
  unidades: 150,
  mes: "2026-12",
  hitos: [
    hito("orden_compra", "real", "2026-07-06"),
    hito("zarpe", "real", "2026-10-01"),
    hito("arribo", "vencido", "2026-11-01", { fecha_original: "2026-10-20", retraso_dias: 12, reprogramaciones: 2 }),
    hito("ingreso_cd", "previsto", "2026-11-20"),
    hito("inicio_operativo", "pendiente", null),
    hito("ingreso_stock", "por_confirmar", "2026-11-04", { del_paquete: { codigo: "P261102", nombre: "Al barrer" } }),
  ],
});
const tramoSin = (): TramoLineaTiempoApi => ({
  embarque: null,
  paquete: null,
  unidades: 200,
  mes: "2026-12",
  hitos: [
    hito("orden_compra", "real", "2026-07-06"),
    hito("zarpe", "pendiente", null),
    hito("arribo", "pendiente", null),
    hito("ingreso_cd", "pendiente", null),
    hito("inicio_operativo", "pendiente", null),
    hito("ingreso_stock", "pendiente", null),
  ],
});

describe("línea de tiempo: textos", () => {
  it("el estado siempre tiene texto, para los siete estados", () => {
    expect(Object.values(TEXTO_ESTADO_HITO).every((t) => t.length > 0)).toBe(true);
    expect(TEXTO_ESTADO_HITO.pendiente).toBe("Pendiente");
    expect(TEXTO_ESTADO_HITO.previsto).toBe("Previsto");
    expect(TEXTO_ESTADO_HITO.vencido).toBe("Vencido");
    expect(TEXTO_ESTADO_HITO.por_confirmar).toBe("Por confirmar");
    expect(TEXTO_ESTADO_HITO.real).toContain("Real");
  });

  it("títulos de tramo: embarque con nombre y unidades, o «Sin embarque» con su mes", () => {
    expect(tituloTramo(tramoCalifornia())).toBe("Embarque 261101 · California · 300 u");
    expect(tituloTramo(tramoSin())).toBe("Sin embarque · dic-26 · 200 u");
    expect(detalleTramo(tramoNuevaYork())).toBe("Paquete P261102 · Al barrer");
    expect(detalleTramo(tramoCalifornia())).toBe("Origen: Los Ángeles");
    expect(detalleTramo(tramoSin())).toBe("");
  });

  it("notas: vencido con los días (si hay «hoy»), igual al Ingreso CD, del paquete, fecha original y «+12 d · 2 cambios»", () => {
    const [, , arribo, , , stock] = tramoNuevaYork().hitos;
    expect(notasDeHito(arribo, "2026-11-06")).toEqual(["Debía ocurrir hace 5 días", "Era 20/10/2026"]);
    expect(notasDeHito(arribo)).toEqual(["Era 20/10/2026"]);
    expect(textoCambiosHito(arribo)).toBe("+12 d · 2 cambios");
    expect(notasDeHito(stock)).toEqual(["Llegó, falta confirmar el ingreso", "Del paquete P261102 · Al barrer"]);
    expect(notasDeHito(tramoCalifornia().hitos[5])).toEqual(["Igual al Ingreso CD"]);
    expect(textoCambiosHito(tramoCalifornia().hitos[3])).toBeNull();
  });

  it("próximo hito: marcador, hito, día-mes, estado con los días vencidos y «+1 tramo»", () => {
    const p = textoProximoHito({ hito: "arribo", fecha: "2026-11-01", hora: null, estado: "vencido", embarque_codigo: "261102", tramos_mas: 1 }, "2026-11-06");
    expect(p).toMatchObject({ hito: "Arribo", fecha: "01-nov", fechaCompleta: "01/11/2026", estado: "Vencido (hace 5 días)", mas: "+1 tramo", embarque: "261102", tono: "alerta" });
    expect(textoProximoHito({ hito: "ingreso_cd", fecha: "2026-11-18", hora: null, estado: "previsto" })?.estado).toBe("Previsto");
    expect(textoProximoHito(null)).toBeNull();
  });
});

describe("línea de tiempo: render", () => {
  const h = html(createElement(LineaDeTiempoCompra, { tramos: [tramoCalifornia(), tramoNuevaYork(), tramoSin()], hoy: "2026-11-06" }));

  it("un tramo por embarque y el tramo «Sin embarque», con los seis hitos de cada uno", () => {
    for (const t of ["Línea de tiempo", "Embarque 261101 · California · 300 u", "Embarque 261102 · Nueva York · 150 u", "Sin embarque · dic-26 · 200 u"]) expect(h, t).toContain(t);
    expect(h.match(/<ol /g)).toHaveLength(3);
    expect((h.match(/<li class="rounded-md/g) ?? []).length).toBe(18);
    for (const t of ["Orden de compra", "Zarpe", "Arribo", "Ingreso CD", "Inicio operativo", "Ingreso al stock"]) expect(h, t).toContain(t);
  });

  it("fechas en es-PE (con la hora del inicio operativo) y el estado siempre en texto", () => {
    for (const t of ["06/07/2026", "02/11/2026", "05/11/2026 09:22", "08/11/2026", "Pendiente", "Previsto", "Vencido", "Por confirmar", "Real ✓"]) expect(h, t).toContain(t);
    expect(h).toContain("Debía ocurrir hace 5 días");
    expect(h).toContain("+12 d · 2 cambios");
  });

  it("los marcadores son decorativos (aria-hidden) y el vencido lleva borde", () => {
    expect((h.match(/aria-hidden="true"/g) ?? []).length).toBeGreaterThanOrEqual(18);
    expect(h).toContain("border-alerta/40");
    expect(h).toContain('aria-label="Hitos de Embarque 261101 · California · 300 u"');
  });

  it("el embarque enlaza a su pantalla y «Sin embarque» no es un enlace", () => {
    expect(h).toMatch(/<a [^>]*href="\/compras\/agrupadores[^"]*"[^>]*>Embarque 261101/);
    expect(h).not.toMatch(/<a [^>]*>Sin embarque/);
  });

  it("«Asignar a embarque…» solo en el tramo sin embarque y solo si el panel lo ofrece", () => {
    expect(h).not.toContain("Asignar a embarque…");
    const con = html(createElement(LineaDeTiempoCompra, { tramos: [tramoCalifornia(), tramoSin()], onAsignarEmbarque: noop }));
    expect(con.match(/Asignar a embarque…/g)).toHaveLength(1);
  });

  it("sin tramos y con la compra cancelada lo dice", () => {
    const x = html(createElement(LineaDeTiempoCompra, { tramos: [], cancelada: true }));
    expect(x).toContain("todavía no tiene entregas");
    expect(x).toContain("La compra está cancelada");
  });
});

describe("detalle de compra: código X, OC y línea de tiempo", () => {
  const compra = (extra: Partial<CompraApi> = {}): CompraApi => ({ ...compraApiC12(), ...extra });
  const detalle = (c: CompraApi, extra: Record<string, unknown> = {}) =>
    html(createElement(DetalleCompra, { compra: c, puedeEscribir: false, onConfirmarIngreso: noop, onQuitarIngreso: noop, onCancelar: noop, ...extra }));

  it("el encabezado junta el código X y la OC; sin OC dice «OC sin registrar»", () => {
    expect(detalle(compra({ numero_oc: "4500012345" }))).toContain("Compra C-000012 <span");
    expect(detalle(compra({ numero_oc: "4500012345" }))).toContain("OC 4500012345");
    expect(detalle(compra())).toContain("OC sin registrar");
  });

  it("«Registrar OC» sin OC y «Cambiar OC» con OC, para los tres roles (no depende de puedeEscribir) y solo si el panel lo ofrece", () => {
    expect(detalle(compra(), { onOcGuardada: noop })).toContain("Registrar OC");
    expect(detalle(compra({ numero_oc: "4500012345" }), { onOcGuardada: noop })).toContain("Cambiar OC");
    expect(detalle(compra())).not.toContain("Registrar OC");
  });

  it("una compra cancelada no ofrece editar la OC", () => {
    const c = { ...compraApiCancelada(), numero_oc: "4500012345" };
    const h = detalle(c, { onOcGuardada: noop });
    expect(h).toContain("OC 4500012345");
    expect(h).not.toContain("Cambiar OC");
  });

  it("muestra la línea de tiempo de la compra y el historial muestra el evento editar_oc", () => {
    const base = compra({ numero_oc: "4500012345", linea_de_tiempo: [tramoCalifornia(), tramoSin()] });
    const c: CompraApi = {
      ...base,
      historial: [{ id: "ev1", linea_id: null, accion: "editar_oc", antes: { numero_oc: null }, despues: { numero_oc: "4500012345" }, motivo: null, resumen: "OC: — → 4500012345", usuario_nombre: "Planner Uno", created_at: "2026-11-05T15:00:00.000Z" }],
    };
    const h = detalle(c, { hoy: "2026-11-06" });
    expect(h).toContain("Línea de tiempo");
    expect(h).toContain("Sin embarque · dic-26 · 200 u");
    expect(h).toContain("Cambió el número de OC");
    expect(h).toContain("OC: — → 4500012345");
  });
});

describe("edición de la OC: validación y textos", () => {
  it("botón y encabezado según tenga OC", () => {
    expect(textoBotonOc(null)).toBe("Registrar OC");
    expect(textoBotonOc("X1")).toBe("Cambiar OC");
    expect(textoOc(null)).toBe("OC sin registrar");
    expect(textoOc("4500012345")).toBe("OC 4500012345");
  });

  it("registrar: sin motivo, con `antes` null y la OC sin espacios al borde", () => {
    expect(validarEdicionOc(null, "  4500012345 ", "")).toEqual({ ok: true, accion: "registrar", cuerpo: { antes: null, numero_oc: "4500012345" } });
  });

  it("cambiar pide motivo y manda `antes` tal como lo vio el formulario", () => {
    expect(validarEdicionOc("4500012300", "4500012345", "")).toEqual({ ok: false, error: "Escribe por qué cambias la OC." });
    expect(validarEdicionOc("4500012300", "4500012345", " Error de tipeo ")).toEqual({ ok: true, accion: "cambiar", cuerpo: { antes: "4500012300", numero_oc: "4500012345", motivo: "Error de tipeo" } });
  });

  it("vaciar la OC que ya tenía la quita (con motivo); vaciar sin tener es un error de formulario", () => {
    expect(validarEdicionOc("4500012300", "  ", "")).toEqual({ ok: false, error: "Escribe por qué quitas la OC." });
    expect(validarEdicionOc("4500012300", "", "Se anuló")).toMatchObject({ ok: true, accion: "quitar", cuerpo: { antes: "4500012300", numero_oc: null, motivo: "Se anuló" } });
    expect(validarEdicionOc(null, "", "")).toMatchObject({ ok: false });
  });

  it("la misma OC no se envía; el formato inválido se rechaza antes de llamar", () => {
    expect(accionDeOc("4500012300", " 4500012300 ")).toBeNull();
    expect(validarEdicionOc("4500012300", "4500012300", "x")).toMatchObject({ ok: false });
    expect(validarEdicionOc(null, "#45", "")).toMatchObject({ ok: false });
    expect(validarEdicionOc(null, "A".repeat(41), "")).toMatchObject({ ok: false });
    expect(validarEdicionOc(null, "OC-12/3_4.5 6", "")).toMatchObject({ ok: true });
  });

  it("textos de lo guardado y de los 409 que piden releer", () => {
    expect(textoOcGuardada("C-000201", "registrar", "4500012345")).toBe("OC registrada en C-000201: 4500012345. Queda en el historial.");
    expect(textoOcGuardada("C-000201", "cambiar", "4500012345")).toContain("cambiada");
    expect(textoOcGuardada("C-000201", "quitar", null)).toContain("Se quitó la OC de C-000201");
    expect(textoConflictoOc("oc_cambio", "x")).toContain("Otra persona cambió la OC");
    expect(textoConflictoOc("sin_cambios", "x")).toContain("ya era esa");
    expect(textoConflictoOc("no_editable", "x")).toContain("cancelada");
    expect(textoConflictoOc("oc_repetida", "ya está en C-000203")).toBe("ya está en C-000203");
  });
});

describe("lista de Compras: OC, próximo hito y filtro «Con hitos vencidos»", () => {
  const conHito = (): CompraApi => ({
    ...compraApiC12(),
    numero_oc: "4500012345",
    proximo_hito: { hito: "arribo", fecha: "2026-11-01", hora: null, estado: "vencido", embarque_codigo: "261102", tramos_mas: 1 },
  });
  const sinOc = (): CompraApi => ({ ...compraApiC12(), id: "otra", numero: "C-000013", numero_oc: null, proximo_hito: null });

  it("la OC va bajo el código X (y nada si no tiene) y el próximo hito con su estado en texto", () => {
    const h = html(createElement(ListaCompras, { compras: [conHito(), sinOc()], enlace: () => "/x", hoy: "2026-11-06" }));
    for (const t of ["Próximo hito", "C-000012", "OC 4500012345", "Arribo", "01-nov", "Vencido (hace 5 días)", "+1 tramo", "Embarque 261102", "Sin hitos pendientes"]) expect(h, t).toContain(t);
    expect(h.match(/OC sin registrar/g)).toBeNull();
  });

  it("una compra cancelada no tiene próximo hito: «—»", () => {
    const h = html(createElement(ListaCompras, { compras: [{ ...compraApiCancelada(), proximo_hito: null }], enlace: () => "/x" }));
    expect(h).not.toContain("Sin hitos pendientes");
  });

  it("el buscador encuentra por código X, por OC, por referencia y por proveedor", () => {
    const a = conHito();
    const b = sinOc();
    const todas = [a, b];
    expect(filtrarCompras(todas, "4500012345").map((c) => c.numero)).toEqual([a.numero]);
    expect(filtrarCompras(todas, "c-000013").map((c) => c.numero)).toEqual([b.numero]);
    expect(filtrarCompras(todas, a.referencia ?? "zzz").length).toBeGreaterThan(0);
    expect(filtrarCompras(todas, "450001").length).toBe(1);
  });

  it("«Con hitos vencidos» viaja como proximo_hito=vencido y vive en la URL", () => {
    const p = leerParametrosCompras((k) => (k === "hitos_vencidos" ? "1" : null));
    expect(p.hitosVencidos).toBe(true);
    expect(filtrosCompras(p).proximo_hito).toBe("vencido");
    expect(filtrosCompras(PARAMETROS_COMPRAS_VACIOS).proximo_hito).toBeUndefined();
    expect(consultaCompras(p)).toBe("hitos_vencidos=1");
    expect(hayFiltrosCompras(p)).toBe(true);
    expect(hayFiltrosCompras(PARAMETROS_COMPRAS_VACIOS)).toBe(false);
  });

  it("la barra ofrece el chip y el buscador dice por qué se busca", () => {
    const h = html(
      createElement(BarraFiltrosCompras, { parametros: { ...PARAMETROS_COMPRAS_VACIOS, hitosVencidos: true }, proveedores: [], generos: [], mundos: [], lineas: [], marcas: [], onCambiar: noop }),
    );
    expect(h).toContain("Con hitos vencidos");
    expect(h).toContain("Compra, OC, referencia o proveedor");
    expect(h).toMatch(/role="checkbox" aria-checked="true"[^>]*title="Compras con algún hito[^"]*"[^>]*>(?:(?!<\/button>)[\s\S])*Con hitos vencidos/);
    expect(h).toMatch(/aria-checked="false"[^>]*title="Compras con entregas vencidas sin confirmar"/);
  });
});

const MOTIVOS_OC_IMPORTACION: MotivoOcImportacion[] = ["oc_repetida", "oc_distinta_en_compra", "oc_no_editable", "oc_invalida", "oc_cambio", "oc_no_aplicada"];

describe("importador: columna OC", () => {
  it("OC es un campo opcional y REFERENCIA ya no la reconoce por alias", () => {
    const oc = CAMPOS_COMPRAS.find((c) => c.campo === "oc");
    expect(oc?.opcional).toBe(true);
    const ref = CAMPOS_COMPRAS.find((c) => c.campo === "referencia");
    expect(ref?.alias).not.toContain("OC");
    expect(ref?.alias).not.toContain("ORDEN_DE_COMPRA");
    const mapeo = detectarMapeo(["PROVEEDOR", "FECHA_COMPRA", "REFERENCIA", "OC", "LINEA_ORDINAL", "UNIDADES"], CAMPOS_COMPRAS);
    expect(mapeo.referencia).toBe("REFERENCIA");
    expect(mapeo.oc).toBe("OC");
    // Un archivo con solo OC (sin REFERENCIA) no la toma por referencia.
    const solo = detectarMapeo(["PROVEEDOR", "OC", "UNIDADES"], CAMPOS_COMPRAS);
    expect(solo.referencia).toBe("");
    expect(solo.oc).toBe("OC");
  });

  it("la plantilla lleva OC junto a REFERENCIA, vacía en la fila de ejemplo, con y sin carga inicial", () => {
    for (const ci of [true, false]) {
      const { columnas, fila } = plantillaCompras(ci);
      expect(columnas.indexOf("OC")).toBe(columnas.indexOf("REFERENCIA") + 1);
      expect(fila).toHaveLength(columnas.length);
      expect(fila[columnas.indexOf("OC")]).toBe("");
      expect(fila[columnas.indexOf("REFERENCIA")]).toBe("PO-2211");
    }
  });

  it("cada motivo de OC del contrato tiene su etiqueta y cada acción su texto antes y después de aplicar", () => {
    for (const m of MOTIVOS_OC_IMPORTACION) expect(ETIQUETA_MOTIVO_OC[m], m).toBeTruthy();
    expect(Object.keys(ETIQUETA_MOTIVO_OC).sort()).toEqual([...MOTIVOS_OC_IMPORTACION].sort());
    expect(ETIQUETA_ACCION_OC.registrada.previsto).not.toBe(ETIQUETA_ACCION_OC.registrada.aplicado);
  });

  const filaOc = (extra: Partial<OcImportacionApi>): OcImportacionApi => ({ compra_clave: `k${Math.random()}`, proveedor: "Proveedor Norte", referencia: "PO-1", compra: null, numero_oc: "4500012345", antes: null, accion: "registrada", avisos: [], ...extra });

  it("el reporte muestra la sección de OC: aplicada, sin cambio y omitida con su motivo y los avisos", () => {
    const filas = [
      filaOc({ compra: { id: "1", numero: "C-000201" }, accion: "cambiada", antes: "4500012300", avisos: [{ aviso: "oc_de_otro_proveedor", detalle: "La OC 4500012345 también está en C-000202 de Feria Sur: ¿es otra orden?" }] }),
      filaOc({ compra_clave: "b", accion: "sin_cambio", compra: { id: "2", numero: "C-000202" } }),
      filaOc({ compra_clave: "c", accion: "omitida", motivo: "oc_repetida", detalle: "La OC 4500012345 ya está en C-000203 de este proveedor." }),
      filaOc({ compra_clave: "d", accion: "omitida", motivo: "oc_no_aplicada", numero_oc: "9" }),
    ];
    expect(totalesOc(filas)).toEqual({ registradas: 0, cambiadas: 1, sinCambio: 1, omitidas: 2, aplicables: 1 });
    const previa = html(createElement(ReporteOcCompras, { filas, aplicado: false }));
    for (const t of ["Números de OC (4)", "Se cambiará", "Sin cambio", "No se aplica", "4500012300", "4500012345", "Esa OC ya está en otra compra de este proveedor", "La OC no se llegó a guardar", "también está en C-000202 de Feria Sur", "compra nueva"]) expect(previa, t).toContain(t);
    const aplicada = html(createElement(ReporteOcCompras, { filas, aplicado: true }));
    expect(aplicada).toContain("Cambiada");
    expect(aplicada).toContain("No se aplicó");
    expect(html(createElement(ReporteOcCompras, { filas: [], aplicado: false }))).toBe("");
  });

  it("el reporte completo de compras la incluye cuando viene y no la muestra cuando no", () => {
    const base = reporteImportacionEjemplo();
    expect(html(createElement(ReporteImportacionCompras, { titulo: "T", reporte: base, nombreArchivo: "a.xlsx" }))).not.toContain("Números de OC");
    const con = { ...base, oc: [filaOc({})] };
    expect(html(createElement(ReporteImportacionCompras, { titulo: "T", reporte: con, nombreArchivo: "a.xlsx" }))).toContain("Números de OC (1)");
  });
});

describe("Excel de Compras: fechas de Excel en LINEA_DE_TIEMPO", () => {
  it("número de serie: 1900-03-01 es 61; 2000-01-01 es 36526; la hora es fracción del día; lo que no es fecha queda en texto", () => {
    expect(serieDeFechaExcel("1900-03-01")).toBe(61);
    expect(serieDeFechaExcel("2000-01-01")).toBe(36526);
    expect(serieDeFechaExcel("2026-11-05 09:22")).toBeCloseTo((serieDeFechaExcel("2026-11-05") as number) + (9 * 60 + 22) / 1440, 9);
    expect(serieDeFechaExcel("2026-02-30")).toBeNull();
    expect(serieDeFechaExcel("2026-11-05 25:00")).toBeNull();
    expect(serieDeFechaExcel("Sin embarque")).toBeNull();
  });

  it("convierte solo las columnas de fecha y de fecha y hora, y deja la cabecera y los textos", () => {
    const ancho = COLUMNA_FECHA_HORA_LINEA_DE_TIEMPO + 5;
    const cabecera = Array.from({ length: ancho }, (_, i) => `COL${i}`);
    const fila: (string | number | null)[] = Array.from({ length: ancho }, () => "2026-11-02");
    fila[COLUMNA_FECHA_HORA_LINEA_DE_TIEMPO] = "2026-11-05 09:22";
    fila[0] = "2026-11-02"; // fuera de las columnas de fecha: no se toca
    const hoja = lineaDeTiempoConFechasDeExcel([cabecera, fila]);
    expect(hoja[0]).toEqual(cabecera);
    for (const c of COLUMNAS_FECHA_LINEA_DE_TIEMPO) expect(hoja[1][c], `columna ${c}`).toBe(serieDeFechaExcel("2026-11-02"));
    expect(hoja[1][COLUMNA_FECHA_HORA_LINEA_DE_TIEMPO]).toBeCloseTo(serieDeFechaExcel("2026-11-05 09:22") as number, 9);
    expect(hoja[1][0]).toBe("2026-11-02");
    expect(formatoDeColumnaLineaDeTiempo(COLUMNA_FECHA_HORA_LINEA_DE_TIEMPO)).toBe("dd/mm/yyyy hh:mm");
    expect(formatoDeColumnaLineaDeTiempo(COLUMNAS_FECHA_LINEA_DE_TIEMPO[0])).toBe("dd/mm/yyyy");
    expect(formatoDeColumnaLineaDeTiempo(0)).toBeNull();
  });
});
