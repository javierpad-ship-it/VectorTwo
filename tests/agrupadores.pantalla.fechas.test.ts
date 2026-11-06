import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DialogoFechas } from "../src/components/compras/agrupadores/dialogo-fechas";
import { DialogoIngresoPaquete } from "../src/components/compras/agrupadores/dialogo-ingreso-paquete";
import { hojaConFechasDeExcel } from "../src/components/compras/agrupadores/descarga";
import { comprasParaLineaDeTiempo, ultimaCausaPorEmbarque } from "../src/components/compras/agrupadores/hojas-linea-tiempo";
import { LineaTiempoEmbarque } from "../src/components/compras/agrupadores/linea-tiempo";
import { ListaEmbarques } from "../src/components/compras/agrupadores/lista-embarques";
import { consultaAgrupadores, leerParametrosAgrupadores, PARAMETROS_AGRUPADORES_VACIOS } from "../src/components/compras/agrupadores/vista-agrupadores";
import {
  cambiosDeEvento,
  cuerpoDeFechas,
  cuerpoDeIngresoPaquete,
  estaMarcado,
  formInicialFechas,
  marcarHito,
  textoCambioFecha,
  textoCambiosDeEvento,
  textoEstadoCorto,
  textoProximoHito,
  type FormFechas,
} from "../src/components/compras/agrupadores/vista-fechas";
import { urlEmbarques } from "../src/lib/compras/agrupadores/use-agrupadores";
import { COLUMNA_FECHA_HORA_EMBARQUES, COLUMNAS_FECHA_EMBARQUES, hojaEmbarques, hojaPaquetes, ENCABEZADOS_EMBARQUES } from "../src/lib/compras/agrupadores/excel";
import { hitosDeEmbarque, proximoHitoEmbarque } from "../src/lib/compras/agrupadores/hitos";
import type { EmbarqueDetalleApi, EmbarqueApi, HitoApi, PaqueteApi } from "../src/lib/compras/agrupadores/tipos-api";
import { fechasExcelAIso, serieAFechaHoraIso } from "../src/lib/arbol/leer-archivo";
import { asignacionApiL1Nov, embarqueDetalleApi261101, paqueteApi261101 } from "./agrupadores.fixture";

/**
 * 08b-1b T3b-1 (§4.3 a §4.5 y §4.7): el formulario del diálogo «Fechas del embarque», el ingreso de un paquete, la línea de tiempo del
 * embarque, la lista, el historial por hito, el Excel y la lectura de la hora de Excel. Sin red ni navegador (render estático y lógica pura).
 */

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const noop = () => {};
const AHORA = { fecha: "2026-11-06", hora: "10:30" };
const HOY = AHORA.fecha;

/** Embarque 261101 (importación, planificado): zarpe 25-oct, Ingreso CD 20-nov, sin arribo, inicio ni ingreso fijado. */
const base = () => embarqueDetalleApi261101();
const formDe = (e: ReturnType<typeof base>, cambios: Partial<FormFechas> = {}): FormFechas => ({ ...formInicialFechas(e), ...cambios });
const conHitos = (e: EmbarqueDetalleApi, resumen: Parameters<typeof hitosDeEmbarque>[2] = []): EmbarqueDetalleApi => ({
  ...e,
  hitos: hitosDeEmbarque(
    {
      tipo: e.tipo,
      estado: e.estado,
      fecha_salida_estimada: e.fecha_salida_estimada,
      fecha_puerto_estimada: e.fecha_puerto_estimada ?? null,
      fecha_llegada_estimada: e.fecha_llegada_estimada,
      fecha_inicio_operativo_estimada: e.fecha_inicio_operativo_estimada ?? null,
      hora_inicio_operativo: e.hora_inicio_operativo ?? null,
      fecha_ingreso_estimada: e.fecha_ingreso_estimada ?? null,
      fecha_llegada_real: e.fecha_llegada_real,
      hito_confirmado: e.hito_confirmado ?? null,
    },
    HOY,
    resumen,
  ),
});

describe("cuerpo de «Fechas del embarque»", () => {
  it("sin tocar nada no hay cuerpo y dice qué falta", () => {
    const r = cuerpoDeFechas(base(), formDe(base()), AHORA);
    expect(r.cuerpo).toBeNull();
    expect(r.hayCambios).toBe(false);
    expect(r.pista).toContain("Cambia alguna fecha");
  });

  it("solo viajan las claves que cambian, y cambiar el Ingreso CD reprograma: pide motivo y causa", () => {
    const e = base();
    const sin = cuerpoDeFechas(e, formDe(e, { ingresoCd: "2026-12-03" }), AHORA);
    expect(sin.reprograma).toBe(true);
    expect(sin.cuerpo).toBeNull();
    expect(sin.pista).toContain("motivo");
    const sinCausa = cuerpoDeFechas(e, formDe(e, { ingresoCd: "2026-12-03", motivo: "Aforo físico" }), AHORA);
    expect(sinCausa.cuerpo).toBeNull();
    expect(sinCausa.pista).toContain("causa");
    const ok = cuerpoDeFechas(e, formDe(e, { ingresoCd: "2026-12-03", motivo: "Aforo físico", causa: "aduana" }), AHORA);
    expect(ok.cuerpo).toEqual({ revision: e.revision, fecha_ingreso_cd: "2026-12-03", motivo: "Aforo físico", causa: "aduana" });
  });

  it("completar un hito vacío (el arribo) o confirmar un hito no reprograma: sin motivo ni causa", () => {
    const e = base();
    const arribo = cuerpoDeFechas(e, formDe(e, { arribo: "2026-11-08" }), AHORA);
    expect(arribo.reprograma).toBe(false);
    expect(arribo.cuerpo).toEqual({ revision: e.revision, fecha_arribo: "2026-11-08" });
    const zarpo = cuerpoDeFechas(e, formDe(e, { confirmado: "zarpe" }), AHORA);
    expect(zarpo.reprograma).toBe(false);
    expect(zarpo.cuerpo).toEqual({ revision: e.revision, hito_confirmado: "zarpe" });
  });

  it("cambiar o vaciar un zarpe que tenía fecha reprograma", () => {
    const e = base();
    expect(cuerpoDeFechas(e, formDe(e, { zarpe: "2026-10-30" }), AHORA).reprograma).toBe(true);
    const vaciar = cuerpoDeFechas(e, formDe(e, { zarpe: "", motivo: "No se sabe", causa: "otro" }), AHORA);
    expect(vaciar.cuerpo?.fecha_zarpe).toBeNull();
  });

  it("si solo cambia el ingreso al stock, la causa se propone «programación»", () => {
    const e = base();
    const r = cuerpoDeFechas(e, formDe(e, { ingresoFijo: true, ingresoStock: "2026-12-10", motivo: "Soltar más tarde" }), AHORA);
    expect(r.reprograma).toBe(true);
    expect(r.causaEfectiva).toBe("programacion");
    expect(r.cuerpo).toEqual({ revision: e.revision, fecha_ingreso_stock: "2026-12-10", motivo: "Soltar más tarde", causa: "programacion" });
  });

  it("«Igualar al Ingreso CD» manda el ingreso nulo; un ingreso fijado que no cambia no viaja", () => {
    const e = { ...base(), fecha_ingreso_estimada: "2026-12-10" };
    const igualar = cuerpoDeFechas(e, formDe(e, { ingresoFijo: false, ingresoStock: "", motivo: "Vuelve", causa: "programacion" }), AHORA);
    expect(igualar.cuerpo?.fecha_ingreso_stock).toBeNull();
    expect(cuerpoDeFechas(e, formDe(e), AHORA).cuerpo).toBeNull();
  });

  it("fijar sin fecha, hora sin fecha y hora fuera de rango no dejan enviar, con el mensaje de la ficha", () => {
    const e = base();
    expect(cuerpoDeFechas(e, formDe(e, { ingresoFijo: true, ingresoStock: "" }), AHORA).pista).toContain("Igualar al Ingreso CD");
    expect(cuerpoDeFechas(e, formDe(e, { inicioHora: "09:22" }), AHORA).pista).toBe("Pon la fecha del inicio operativo antes que la hora.");
    expect(cuerpoDeFechas(e, formDe(e, { inicioFecha: "2026-11-05", inicioHora: "25:00" }), AHORA).pista).toContain("hh:mm");
  });

  it("el inicio operativo lleva fecha y hora; sin hora, hora nula", () => {
    const e = base();
    const r = cuerpoDeFechas(e, formDe(e, { ingresoCd: "2026-11-02", inicioFecha: "2026-11-05", inicioHora: "09:22", confirmado: "inicio_operativo", motivo: "Llegó antes", causa: "correccion" }), AHORA);
    expect(r.noFutura).toEqual([]);
    expect(r.cuerpo?.inicio_operativo).toEqual({ fecha: "2026-11-05", hora: "09:22" });
    expect(r.cuerpo?.hito_confirmado).toBe("inicio_operativo");
    expect(cuerpoDeFechas(e, formDe(e, { inicioFecha: "2026-12-01" }), AHORA).cuerpo?.inicio_operativo).toEqual({ fecha: "2026-12-01", hora: null });
  });

  it("no deja marcar como ocurrida una fecha futura ni un hito sin fecha", () => {
    const e = base();
    const futuro = cuerpoDeFechas(e, formDe(e, { confirmado: "ingreso_cd" }), AHORA);
    expect(futuro.cuerpo).toBeNull();
    expect(futuro.pista).toContain("No puedes marcar como ocurrido");
    expect(cuerpoDeFechas(e, formDe(e, { confirmado: "arribo" }), AHORA).pista).toContain("fecha del arribo");
  });

  it("bajar «ya ocurrió» reprograma; en un local el arribo no viaja", () => {
    const e = { ...base(), hito_confirmado: "zarpe" as const };
    expect(cuerpoDeFechas(e, formDe(e, { confirmado: null }), AHORA).reprograma).toBe(true);
    const local = { ...base(), tipo: "local" as const };
    expect(cuerpoDeFechas(local, formDe(local, { arribo: "2026-11-08" }), AHORA).cuerpo).toBeNull();
  });

  it("marcar un hito marca también los anteriores; desmarcarlo deja como último al anterior", () => {
    expect(estaMarcado("ingreso_cd", "zarpe")).toBe(true);
    expect(estaMarcado("zarpe", "arribo")).toBe(false);
    expect(marcarHito("arribo", true)).toBe("arribo");
    expect(marcarHito("ingreso_cd", false)).toBe("arribo");
    expect(marcarHito("ingreso_cd", false, ["arribo"])).toBe("zarpe");
    expect(marcarHito("zarpe", false)).toBeNull();
  });
});

describe("ingreso propio de un paquete", () => {
  const p = (extra: Partial<PaqueteApi> = {}): PaqueteApi => ({ ...paqueteApi261101(), ingreso_propio: false, fecha_ingreso: null, lotes_al_barrer: 2, ...extra });

  it("pide fecha distinta, motivo y causa (propone programación)", () => {
    expect(cuerpoDeIngresoPaquete(p(), 3, "", "", null).pista).toContain("Elige una fecha");
    expect(cuerpoDeIngresoPaquete(p(), 3, "2027-01-15", "", null).pista).toContain("motivo");
    expect(cuerpoDeIngresoPaquete(p(), 3, "2027-01-15", " Tanda 2 ", null).cuerpo).toEqual({ revision_embarque: 3, fecha_ingreso_stock: "2027-01-15", motivo: "Tanda 2", causa: "programacion" });
  });

  it("soltar el ingreso propio manda nulo", () => {
    const r = cuerpoDeIngresoPaquete(p({ ingreso_propio: true, fecha_ingreso: "2027-01-15" }), 3, "", "Vuelve al embarque", "correccion");
    expect(r.cuerpo).toEqual({ revision_embarque: 3, fecha_ingreso_stock: null, motivo: "Vuelve al embarque", causa: "correccion" });
  });
});

describe("textos de la vista previa, de los estados y del historial", () => {
  it("un cambio de fecha dice de qué a qué y cuántos días; el de un paquete, qué paquete", () => {
    expect(textoCambioFecha({ hito: "ingreso_cd", antes: "2026-11-15", despues: "2026-12-03", dias: 18 }, HOY)).toBe("Ingreso CD: 15-nov → 03-dic (+18 d)");
    expect(textoCambioFecha({ hito: "ingreso_paquete", paquete: { id: "x", codigo: "261101" }, antes: "2027-04-04", despues: "2027-04-20", dias: 16 }, HOY)).toContain("Ingreso del paquete 261101: 04-abr-2027 → 20-abr-2027");
    expect(textoCambioFecha({ hito: "hito_confirmado", antes: null, despues: "zarpe", dias: null }, HOY)).toContain("el zarpe");
  });

  it("los estados salen en texto, con los días del vencido", () => {
    expect(textoEstadoCorto({ estado: "vencido", fecha: "2026-11-02" }, HOY)).toBe("Vencido (hace 4 días)");
    expect(textoEstadoCorto({ estado: "real", fecha: "2026-11-02" }, HOY)).toBe("Ocurrió ✓");
    expect(textoEstadoCorto({ estado: "por_confirmar", fecha: "2026-11-02" }, HOY)).toBe("Llegó, falta confirmar el ingreso");
    expect(textoProximoHito({ hito: "ingreso_cd", fecha: "2026-11-02", hora: null, estado: "vencido" }, HOY)).toBe("Ingreso CD · 02-nov · Vencido (hace 4 días)");
    expect(textoProximoHito(null, HOY)).toBe("Sin pendientes");
  });

  it("un evento cambiar_fecha se lee por hito de sus fotos antes y después", () => {
    const antes = { fecha_salida_estimada: "2026-10-05", fecha_puerto_estimada: null, fecha_llegada_estimada: "2026-11-15", fecha_inicio_operativo_estimada: null, hora_inicio_operativo: null, fecha_ingreso_estimada: null, hito_confirmado: null, paquetes: [{ id: "p1", codigo: "261101", fecha_ingreso_estimada: null }] };
    const despues = { ...antes, fecha_llegada_estimada: "2026-12-03", fecha_inicio_operativo_estimada: "2026-11-05", hora_inicio_operativo: "09:22:00", hito_confirmado: "zarpe", paquetes: [{ id: "p1", codigo: "261101", fecha_ingreso_estimada: "2027-01-15" }] };
    const cambios = cambiosDeEvento({ accion: "cambiar_fecha", antes, despues });
    expect(cambios.map((c) => c.hito)).toEqual(["ingreso_cd", "inicio_operativo", "ingreso_stock", "hito_confirmado", "ingreso_paquete"]);
    const texto = textoCambiosDeEvento(cambios, HOY);
    expect(texto).toContain("Ingreso CD 15-nov → 03-dic");
    expect(texto).toContain("Inicio operativo — → 05-nov 09:22");
    expect(texto).toContain("Ingreso al stock 15-nov → 03-dic (sigue al Ingreso CD)");
    expect(texto).toContain("Ya ocurrió: ninguno → el zarpe");
    expect(texto).toContain("Ingreso del paquete 261101 — → 15-ene-2027");
    expect(cambiosDeEvento({ accion: "editar", antes, despues })).toEqual([]);
    expect(cambiosDeEvento({ accion: "cambiar_fecha", antes: null, despues: null })).toEqual([]);
  });
});

describe("línea de tiempo del embarque", () => {
  it("el caso de Javier: zarpe y arribo pendientes, ingreso CD y inicio ocurridos con hora, ingreso por confirmar; todo en texto", () => {
    const e = conHitos({ ...base(), tipo: "importacion", fecha_salida_estimada: null, fecha_llegada_estimada: "2026-11-02", fecha_inicio_operativo_estimada: "2026-11-05", hora_inicio_operativo: "09:22:00", fecha_ingreso_estimada: "2026-11-04", hito_confirmado: "inicio_operativo", estado: "en_transito", periodo_llegada: "2026-11" });
    const h = html(createElement(LineaTiempoEmbarque, { embarque: e, hoy: HOY }));
    for (const t of ["Línea de tiempo del embarque", "Zarpe", "Arribo", "Ingreso CD", "Inicio operativo", "Ingreso al stock", "Ocurrió · sin fecha", "02/11/2026", "Ocurrió ✓", "05/11/2026 09:22", "Llegó, falta confirmar el ingreso", "manda el mes (nov-26)", "Hoy · 06/11/2026", "Ver los cambios por hito"]) expect(h, t).toContain(t);
    expect(h).not.toContain("Vencido");
    expect(h).toMatch(/data-hito="ingreso_stock" data-estado="por_confirmar"/);
  });

  it("un hito vencido lleva el texto «Vencido (hace N días)» y el borde; el retraso y los cambios, en texto", () => {
    const resumen = [{ hito: "ingreso_cd" as const, fecha_original: "2026-10-31", reprogramaciones: 2 }];
    const e = conHitos({ ...base(), fecha_puerto_estimada: "2026-11-02", fecha_llegada_estimada: "2026-11-10", periodo_llegada: "2026-11" }, resumen);
    const h = html(createElement(LineaTiempoEmbarque, { embarque: { ...e, reprogramaciones_total: 2 }, hoy: HOY }));
    expect(h).toContain("Vencido (hace 4 días)");
    expect(h).toContain("border-alerta");
    expect(h).toContain("+10 d");
    expect(h).toContain("2 cambios");
    expect(h).toContain("Reprogramado ×2");
    expect(h).toContain("(era 31-oct)");
  });

  it("el arribo de un local dice «No aplica»; el ingreso sin fijar, «igual al Ingreso CD»", () => {
    const h = html(createElement(LineaTiempoEmbarque, { embarque: conHitos({ ...base(), tipo: "local" }), hoy: HOY }));
    expect(h).toContain("No aplica");
    expect(h).toContain("embarque local, sin puerto");
    expect(h).toContain("igual al Ingreso CD");
  });

  it("debajo del ingreso al stock salen los paquetes con ingreso propio, con su mes y sus lotes", () => {
    const e = conHitos(base());
    e.paquetes = [{ ...paqueteApi261101(), nombre: "Al barrer · tanda 1", ingreso_propio: true, fecha_ingreso: "2027-01-15", periodo_ingreso: "2027-01", lotes_al_barrer: 2, ajustado_desde: "2026-11-04" }, e.paquetes[1]];
    const h = html(createElement(LineaTiempoEmbarque, { embarque: e, hoy: HOY }));
    for (const t of ["Paquetes con ingreso propio", "Al barrer · tanda 1", "15/01/2027", "nov-26 → ene-27", "300 u de 2 lotes al barrer", "Ajustado a la llegada del embarque (antes: 04-nov)"]) expect(h, t).toContain(t);
  });

  it("encima, el rango de las órdenes de compra y cuántas compras", () => {
    const e = conHitos({ ...base(), asignaciones: [asignacionApiL1Nov()] });
    expect(html(createElement(LineaTiempoEmbarque, { embarque: e, hoy: HOY }))).toContain("Órdenes de compra: 08-oct · 1 compra");
  });
});

describe("diálogos de fechas", () => {
  it("«Fechas del embarque» muestra el ahora de cada hito y los botones de la ficha; el arribo no está en un local", () => {
    const h = html(createElement(DialogoFechas, { embarque: base(), onAplicado: noop, onCerrar: noop }));
    for (const t of ["Nueva fecha de zarpe", "Nueva fecha de arribo a puerto", "Nueva fecha de Ingreso CD", "Nueva fecha de inicio operativo", "Hora (opcional)", "Sigue al Ingreso CD", "Fijar fecha", "Si solo sabes el mes, pon el 15", "El Ingreso al stock decide el mes en que la mercadería cuenta en el flujo"]) expect(h, t).toContain(t);
    expect(html(createElement(DialogoFechas, { embarque: { ...base(), tipo: "local" }, onAplicado: noop, onCerrar: noop }))).not.toContain("Nueva fecha de arribo");
  });

  it("con un ingreso fijado ofrece «Igualar al Ingreso CD»; las causas incluyen la demora en el pago y la aduana", () => {
    const h = html(createElement(DialogoFechas, { embarque: { ...base(), fecha_ingreso_estimada: "2026-12-10" }, onAplicado: noop, onCerrar: noop }));
    expect(h).toContain("Igualar al Ingreso CD");
    expect(h).toContain("(fijado)");
    for (const c of ["Demora en el pago al proveedor", "Aduana", "Naviera, zarpe o transbordo", "Corrección de un dato mal puesto"]) expect(h, c).toContain(c);
  });

  it("«Fijar ingreso…» de un paquete: el selector no ofrece días antes de la llegada y dice cómo queda", () => {
    const e = base();
    const h = html(createElement(DialogoIngresoPaquete, { embarque: e, paquete: { ...paqueteApi261101(), ingreso_propio: true, fecha_ingreso: "2027-01-15", lotes_al_barrer: 2, ajustado_desde: "2026-11-04" }, onAplicado: noop, onCerrar: noop }));
    for (const t of ["Ingreso al stock · Paquete 261101", "ingreso propio 15/01/2027", 'min="2026-11-20"', "Soltar el ingreso propio", "Ajustado a la llegada del embarque (antes: 04-nov)", "Causa", "Motivo", "Ver vista previa", "Tiene 2 lote(s) al barrer"]) expect(h, t).toContain(t);
    expect(html(createElement(DialogoIngresoPaquete, { embarque: e, paquete: { ...paqueteApi261101(), ingreso_propio: false, fecha_ingreso: null }, onAplicado: noop, onCerrar: noop }))).toContain("hereda del embarque (20/11/2026)");
  });
});

describe("lista de embarques con hitos", () => {
  const e: EmbarqueApi = (() => {
    const c = conHitos({ ...base(), hito_confirmado: "zarpe", fecha_puerto_estimada: "2026-11-02", origen: "California" }, [{ hito: "ingreso_cd", fecha_original: "2026-11-10", reprogramaciones: 2 }]);
    const hitos: HitoApi[] = c.hitos ?? [];
    return { ...c, reprogramaciones_total: 2, proximo_hito: proximoHitoEmbarque(hitos) };
  })();

  it("columnas Próximo hito y Reprogramado ×N, con el estado en texto y el origen", () => {
    const h = html(createElement(ListaEmbarques, { embarques: [e], enlace: () => "/x", hoy: HOY }));
    for (const t of ["Próximo hito", "Reprogramado ×N", "Reprogramado ×2", "California", "Vencido (hace 4 días)", "Arribo · 02-nov · Vencido (hace 4 días)", "igual al Ingreso CD"]) expect(h, t).toContain(t);
  });

  it("los filtros Atrasados, Reprogramados y Origen viajan al servidor y a la URL", () => {
    expect(urlEmbarques({ atrasados: true, reprogramados: true, origen: "Nueva York" })).toBe("/api/compras/embarques?atrasados=1&reprogramados=1&origen=Nueva+York");
    const p = { ...PARAMETROS_AGRUPADORES_VACIOS, reprogramados: true, origen: "California" };
    const q = consultaAgrupadores(p);
    expect(q).toContain("reprogramados=1");
    expect(q).toContain("origen=California");
    const leidos = leerParametrosAgrupadores((k) => new URLSearchParams(q).get(k));
    expect(leidos.reprogramados).toBe(true);
    expect(leidos.origen).toBe("California");
  });
});

describe("Excel de Viajes y embarques", () => {
  const e = conHitos({ ...base(), hito_confirmado: "zarpe", fecha_puerto_estimada: "2026-11-02", fecha_inicio_operativo_estimada: "2026-11-03", hora_inicio_operativo: "09:22:00", origen: "California" }, [{ hito: "ingreso_cd", fecha_original: "2026-11-10", reprogramaciones: 2 }]);
  const filaEmbarque = hojaEmbarques([{ ...e, reprogramaciones_total: 2, proximo_hito: proximoHitoEmbarque(e.hitos ?? []) }])[1];
  const col = (n: (typeof ENCABEZADOS_EMBARQUES)[number]) => ENCABEZADOS_EMBARQUES.indexOf(n);

  it("EMBARQUES trae los cinco hitos con su estado en texto, el origen, el mes, el próximo hito y las reprogramaciones", () => {
    expect(hojaEmbarques([e])[0]).toEqual([...ENCABEZADOS_EMBARQUES]);
    expect(filaEmbarque[col("ORIGEN")]).toBe("California");
    expect(filaEmbarque[col("ZARPE")]).toBe("2026-10-25");
    expect(filaEmbarque[col("ESTADO ARRIBO")]).toBe("Vencido");
    expect(filaEmbarque[col("INICIO OPERATIVO")]).toBe("2026-11-03 09:22");
    expect(filaEmbarque[col("INGRESO AL STOCK")]).toBe("2026-11-20");
    expect(filaEmbarque[col("MES DEL FLUJO")]).toBe("2026-11");
    expect(filaEmbarque[col("PRÓXIMO HITO")]).toBe("Arribo · 02/11/2026 · Vencido");
    expect(filaEmbarque[col("REPROGRAMACIONES")]).toBe(2);
    expect(hojaEmbarques([e])[1]).toHaveLength(ENCABEZADOS_EMBARQUES.length);
  });

  it("PAQUETES trae el ingreso propio (vacío si hereda)", () => {
    const d = { ...e, paquetes: [{ ...paqueteApi261101(), ingreso_propio: true, fecha_ingreso: "2027-01-15", lotes_al_barrer: 1 }, e.paquetes[1]] };
    const h = hojaPaquetes([d]);
    expect(h[0].slice(5, 7)).toEqual(["INGRESO AL STOCK PROPIO", "INGRESO"]);
    expect(h[1].slice(5, 7)).toEqual(["2027-01-15", "Propio"]);
    expect(h[2].slice(5, 7)).toEqual([null, "Hereda del embarque"]);
  });

  it("las fechas se convierten a fecha de Excel con su formato; la hora del inicio operativo, como fracción del día; lo demás no se toca", () => {
    const { filas, formatos } = hojaConFechasDeExcel(hojaEmbarques([e]), { fecha: COLUMNAS_FECHA_EMBARQUES, fechaHora: [COLUMNA_FECHA_HORA_EMBARQUES] });
    expect(filas[0]).toEqual([...ENCABEZADOS_EMBARQUES]);
    expect(typeof filas[1][col("ZARPE")]).toBe("number");
    expect(formatos.get(`1,${col("ZARPE")}`)).toBe("dd/mm/yyyy");
    expect(formatos.get(`1,${col("INICIO OPERATIVO")}`)).toBe("dd/mm/yyyy hh:mm");
    const inicio = filas[1][col("INICIO OPERATIVO")] as number;
    expect(Math.round((inicio % 1) * 1440)).toBe(9 * 60 + 22);
    expect(filas[1][col("MES DEL FLUJO")]).toBe("2026-11");
    expect(filas[1][col("CÓDIGO")]).toBe("261101");
  });

  it("LINEA_DE_TIEMPO: una fila por compra y tramo con lo asignado y lo que sigue sin embarque", () => {
    const d = { ...e, asignaciones: [asignacionApiL1Nov()] };
    const sinAsignar = { entregas: [{ entrega_id: "entrega-x", periodo: "2026-12", unidades: 500, sin_asignar: 200, compra: { ...asignacionApiL1Nov().compra, id: "compra-x", numero: "C-000999", numero_oc: "4500012345", viaje_id: null }, linea: asignacionApiL1Nov().linea }], compras_sin_viaje: [] };
    const compras = comprasParaLineaDeTiempo({ detalles: [d], sinAsignar, viajes: [], hoy: HOY });
    expect(compras.map((c) => c.numero).sort()).toEqual(["C-000101", "C-000999"]);
    const c101 = compras.find((c) => c.numero === "C-000101");
    expect(c101?.linea_de_tiempo).toHaveLength(1);
    expect(c101?.linea_de_tiempo[0].embarque?.codigo).toBe("261101");
    expect(c101?.linea_de_tiempo[0].hitos.find((h) => h.hito === "ingreso_cd")?.reprogramaciones).toBe(2);
    const c999 = compras.find((c) => c.numero === "C-000999");
    expect(c999?.numero_oc).toBe("4500012345");
    expect(c999?.linea_de_tiempo.map((t) => [t.embarque, t.unidades, t.mes])).toEqual([[null, 200, "2026-12"]]);
  });

  it("la última causa de un embarque sale del último cambio de fechas con causa", () => {
    const causa = ultimaCausaPorEmbarque(new Map([["e1", [{ accion: "cambiar_fecha", causa: "pago" }, { accion: "editar", causa: null }, { accion: "cambiar_fecha", causa: "aduana" }]]]));
    expect(causa("e1")).toBe("aduana");
    expect(causa("otro")).toBeNull();
  });
});

describe("el lector de Excel conserva la hora del inicio operativo", () => {
  const celda = (v: number, z: string) => ({ t: "n" as const, v, z, w: "" });

  it("la serie de fecha y hora pasa a aaaa-mm-dd hh:mm, con el redondeo al minuto", () => {
    expect(serieAFechaHoraIso(46331 + (9 * 60 + 22) / 1440)).toBe("2026-11-05 09:22");
    expect(serieAFechaHoraIso(46331 + 0.99999)).toBe("2026-11-06 00:00");
  });

  it("con conHora, una celda de fecha y hora sale con hora; sin la opción (los demás importadores), solo la fecha", () => {
    const hoja = { A1: celda(46331 + (9 * 60 + 22) / 1440, "dd/mm/yyyy hh:mm"), A2: celda(46331, "dd/mm/yyyy hh:mm"), A3: celda(46331.5, "dd/mm/yyyy") };
    fechasExcelAIso(hoja as never, { conHora: true });
    expect(hoja.A1.w).toBe("2026-11-05 09:22");
    expect(hoja.A2.w).toBe("2026-11-05");
    expect(hoja.A3.w).toBe("2026-11-05");
    const vieja = { A1: celda(46331 + (9 * 60 + 22) / 1440, "dd/mm/yyyy hh:mm") };
    fechasExcelAIso(vieja as never);
    expect(vieja.A1.w).toBe("2026-11-05");
  });
});
