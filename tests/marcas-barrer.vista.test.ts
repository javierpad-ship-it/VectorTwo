import { describe, expect, it } from "vitest";
import {
  alternarOrden,
  consultaVista,
  FILTROS_VACIOS,
  filtrarLista,
  formatearFraccion,
  formatearTendencia,
  gmlConPeso,
  hayFiltros,
  leerParametros,
  opcionesFiltro,
  ordenarLista,
  ORDEN_LISTA_DEFECTO,
  periodoCorto,
  resumenLista,
  seriesP1Mensual,
  textoAlcance,
  textoErrorReparto,
  textoEstadoReparto,
  textoGmlConVenta,
  textoNino,
  textoResumenLista,
  tituloAnio,
  urlAnalisis,
  type ParametrosVista,
} from "../src/app/(app)/planificacion/marcas-barrer/vista";
import { analisisBeta, GEN_H, LIN_DENIM, listaEjemplo, MUN_CASUAL, MUN_URBANO } from "./marcas-barrer.pantalla.fixture";

/** Presentación pura de la pantalla de M12: URL, formatos, lista (filtros, orden, resumen) y textos de estado. */

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const U3 = "33333333-3333-4333-8333-333333333333";
const leer = (q: string) => {
  const p = new URLSearchParams(q);
  return leerParametros((k) => p.get(k));
};

describe("estado de la vista en la URL", () => {
  it("sin parámetros: lista, 24 meses, por temporada, con el Niño y sin alcance", () => {
    expect(leer("")).toEqual({ marca: null, ventana: 24, modo: "por_temporada", normalizaNino: true, alcance: { generos: [], mundos: [], lineas: [] } });
  });

  it("lee la marca, la ventana, el modo y el alcance; un valor inválido cae al de defecto", () => {
    const p = leer(`marca=${U1}&ventana=12&modo=anual&nino=0&genero=${U2},${U3}&mundo=${U2}&lineas=${U3}`);
    expect(p).toEqual({ marca: U1, ventana: 12, modo: "anual", normalizaNino: false, alcance: { generos: [U2, U3], mundos: [U2], lineas: [U3] } });
    const malo = leer("marca=hola&ventana=18&modo=por_mes&genero=no-es-uuid,otro");
    expect(malo.marca).toBeNull();
    expect(malo.ventana).toBe(24);
    expect(malo.modo).toBe("por_temporada");
    expect(malo.alcance.generos).toEqual([]);
  });

  it("consultaVista y leerParametros son inversas, y la lista solo lleva la ventana", () => {
    const p: ParametrosVista = { marca: U1, ventana: 36, modo: "anual", normalizaNino: false, alcance: { generos: [U2], mundos: [], lineas: [U3] } };
    expect(leer(consultaVista(p))).toEqual(p);
    expect(consultaVista({ ...p, marca: null })).toBe("ventana=36");
  });

  it("la URL del análisis lleva ventana, modo, normaliza_nino y el alcance solo si lo hay", () => {
    const base: ParametrosVista = { marca: U1, ventana: 24, modo: "por_temporada", normalizaNino: true, alcance: { generos: [], mundos: [], lineas: [] } };
    expect(urlAnalisis(U1, base)).toBe(`/api/marcas-barrer/${U1}?ventana=24&modo=por_temporada&normaliza_nino=1`);
    const q = new URLSearchParams(urlAnalisis(U1, { ...base, normalizaNino: false, alcance: { generos: [U2, U3], mundos: [U2], lineas: [] } }).split("?")[1]);
    expect(q.get("normaliza_nino")).toBe("0");
    expect(q.get("genero")).toBe(`${U2},${U3}`);
    expect(q.get("mundo")).toBe(U2);
    expect(q.has("lineas")).toBe(false);
  });
});

describe("formatos", () => {
  it("fracciones y tendencia con el formato es-PE (punto decimal)", () => {
    expect(formatearFraccion(0.41)).toBe("41.0 %");
    expect(formatearFraccion(0.0123, 2)).toBe("1.23 %");
    expect(formatearFraccion(null)).toBe("—");
    expect(formatearTendencia(0.06)).toBe("+6 %");
    expect(formatearTendencia(-0.03)).toBe("-3 %");
    expect(formatearTendencia(0)).toBe("0 %");
    expect(formatearTendencia(null)).toBe("—");
  });

  it("periodo corto y título del año en curso con su corte", () => {
    expect(periodoCorto("2026-09-01")).toBe("set-2026");
    expect(periodoCorto("2026-09")).toBe("set-2026");
    expect(tituloAnio(2025, "2026-09-01")).toBe("2025");
    expect(tituloAnio(2026, "2026-09-01")).toBe("2026 (a set)");
    expect(tituloAnio(2026, "2026-12-01")).toBe("2026");
  });

  it("el Niño de la cabecera nombra la temporada, el año y el factor; sin normalizar lo dice", () => {
    const a = analisisBeta();
    expect(textoNino(a.parametros.factores, true)).toBe("Niño: invierno 2026 ÷ 0.66 · verano 2026 ÷ 1.24");
    expect(textoNino(a.parametros.factores, false)).toContain("sin normalizar");
    expect(textoNino([], true)).toBeNull();
  });

  it("error del reparto: «8 pp estable», «Sin backtesting»", () => {
    expect(textoErrorReparto({ pp: 8, veredicto: "estable" })).toBe("8 pp estable");
    expect(textoErrorReparto({ pp: 31, veredicto: "inestable" })).toBe("31 pp inestable");
    expect(textoErrorReparto({ pp: null, veredicto: null })).toBe("Sin backtesting");
  });

  it("estado del reparto: sin reparto, obsoleto con motivo, al día con la diferencia", () => {
    expect(textoEstadoReparto({ vigente: false, obsoleto: [], diferenciaPp: null })).toEqual({ texto: "Sin reparto", tono: "alerta" });
    expect(textoEstadoReparto({ vigente: true, obsoleto: ["config_cambiada"], diferenciaPp: null })).toEqual({ texto: "Obsoleto: config. cambiada", tono: "alerta" });
    expect(textoEstadoReparto({ vigente: true, obsoleto: ["cargas_nuevas", "ventana_distinta"], diferenciaPp: null }).texto).toBe("Obsoleto: cargas nuevas (+1)");
    expect(textoEstadoReparto({ vigente: true, obsoleto: [], diferenciaPp: 1.2 })).toEqual({ texto: "Al día (difiere 1.2 pp)", tono: "exito" });
    expect(textoEstadoReparto({ vigente: true, obsoleto: [], diferenciaPp: null }).texto).toBe("Al día");
  });

  it("alcance en palabras: todo, o los nombres elegidos", () => {
    const a = analisisBeta();
    expect(textoAlcance({ generos: [], mundos: [], lineas: [] }, a.opciones_alcance)).toBe("todo");
    expect(textoAlcance({ generos: [GEN_H], mundos: [MUN_URBANO], lineas: [] }, a.opciones_alcance)).toBe("HOMBRE · URBANO");
    expect(textoAlcance({ generos: ["otro"], mundos: [], lineas: [] }, a.opciones_alcance)).toBe("1 más");
  });
});

describe("lista de marcas", () => {
  const { marcas } = listaEjemplo();

  it("sin filtros se ven todas; los filtros se combinan", () => {
    expect(hayFiltros(FILTROS_VACIOS)).toBe(false);
    expect(filtrarLista(marcas, FILTROS_VACIOS)).toHaveLength(3);
    expect(filtrarLista(marcas, { ...FILTROS_VACIOS, modalidad: "mixta" }).map((m) => m.nombre)).toEqual(["GAMMA"]);
    expect(filtrarLista(marcas, { ...FILTROS_VACIOS, agrupacion: "ag-valor" }).map((m) => m.nombre)).toEqual(["DELTA"]);
    expect(filtrarLista(marcas, { ...FILTROS_VACIOS, genero: GEN_H }).map((m) => m.nombre)).toEqual(["BETA", "GAMMA"]);
    expect(filtrarLista(marcas, { ...FILTROS_VACIOS, genero: GEN_H, modalidad: "barrido" }).map((m) => m.nombre)).toEqual(["BETA"]);
    expect(filtrarLista(marcas, { ...FILTROS_VACIOS, mundo: "otro" })).toEqual([]);
  });

  it("«Solo»: sin reparto, obsoletas, mixtas e inestables; varias a la vez exigen todas", () => {
    expect(filtrarLista(marcas, { ...FILTROS_VACIOS, solo: ["sin_reparto"] }).map((m) => m.nombre)).toEqual(["DELTA"]);
    expect(filtrarLista(marcas, { ...FILTROS_VACIOS, solo: ["obsoletas"] }).map((m) => m.nombre)).toEqual(["GAMMA"]);
    expect(filtrarLista(marcas, { ...FILTROS_VACIOS, solo: ["inestables"] }).map((m) => m.nombre)).toEqual(["GAMMA"]);
    expect(filtrarLista(marcas, { ...FILTROS_VACIOS, solo: ["mixtas", "inestables"] }).map((m) => m.nombre)).toEqual(["GAMMA"]);
    expect(filtrarLista(marcas, { ...FILTROS_VACIOS, solo: ["mixtas", "sin_reparto"] })).toEqual([]);
  });

  it("el resumen del pie cuenta lo que se ve y el texto omite lo que vale 0", () => {
    const r = resumenLista(marcas);
    expect(r).toEqual({ marcas: 3, sin_reparto: 1, obsoletas: 1, mixtas: 1, inestables: 1, unidades_barrer: 12480 + 5069 + 1020 });
    expect(textoResumenLista(r, 24)).toBe("3 marcas · 18,569 unidades al barrer en 24 meses · 1 sin reparto · 1 obsoleta · 1 inestable");
    expect(textoResumenLista(resumenLista(marcas.slice(0, 1)), 12)).toBe("1 marca · 12,480 unidades al barrer en 12 meses");
    expect(resumenLista(filtrarLista(marcas, { ...FILTROS_VACIOS, modalidad: "mixta" })).marcas).toBe(1);
  });

  it("orden: por unidades descendente por defecto, por nombre, y por error con las que no lo tienen al final; no muta", () => {
    const copia = [...marcas];
    expect(ordenarLista(marcas, ORDEN_LISTA_DEFECTO).map((m) => m.nombre)).toEqual(["BETA", "GAMMA", "DELTA"]);
    expect(ordenarLista(marcas, { clave: "marca", dir: "asc" }).map((m) => m.nombre)).toEqual(["BETA", "DELTA", "GAMMA"]);
    expect(ordenarLista(marcas, { clave: "error", dir: "desc" }).map((m) => m.nombre)).toEqual(["GAMMA", "BETA", "DELTA"]);
    expect(ordenarLista(marcas, { clave: "error", dir: "asc" }).map((m) => m.nombre)).toEqual(["BETA", "GAMMA", "DELTA"]);
    expect(marcas).toEqual(copia);
  });

  it("alternarOrden invierte la misma columna; otra empieza descendente (la marca, ascendente)", () => {
    expect(alternarOrden({ clave: "unidades", dir: "desc" }, "unidades")).toEqual({ clave: "unidades", dir: "asc" });
    expect(alternarOrden({ clave: "unidades", dir: "desc" }, "error")).toEqual({ clave: "error", dir: "desc" });
    expect(alternarOrden({ clave: "unidades", dir: "desc" }, "marca")).toEqual({ clave: "marca", dir: "asc" });
  });

  it("GML con venta: «14 (6)» y los específicos de una mixta", () => {
    expect(textoGmlConVenta({ gml_con_venta: 14, gml_pequenos: 6, gml_especificos: 0 })).toBe("14 (6)");
    expect(textoGmlConVenta({ gml_con_venta: 9, gml_pequenos: 4, gml_especificos: 2 })).toBe("9 (4) +2 específicos");
    expect(textoGmlConVenta({ gml_con_venta: 9, gml_pequenos: 4, gml_especificos: 1 })).toBe("9 (4) +1 específico");
  });

  it("las opciones de los filtros son solo lo que alguna marca tiene, con los nombres del árbol", () => {
    const arbol = {
      generos: [
        { id: GEN_H, codigo: "H", nombre: "HOMBRE", orden: 1, activo: true, mundos: [{ id: MUN_URBANO, codigo: "U", nombre: "URBANO", orden: 1, activo: true, lineas: [{ linea_id: LIN_DENIM, nombre: "DENIM" }] }, { id: MUN_CASUAL, codigo: "C", nombre: "CASUAL", orden: 2, activo: true, lineas: [] }] },
        { id: "g-mujer", codigo: "M", nombre: "MUJER", orden: 2, activo: true, mundos: [] },
      ],
    } as unknown as Parameters<typeof opcionesFiltro>[1];
    const o = opcionesFiltro(marcas, arbol);
    expect(o.agrupaciones.map((x) => x.nombre)).toEqual(["PREMIUM", "RECONOCIDO", "VALOR"]);
    expect(o.generos).toEqual([{ id: GEN_H, nombre: "HOMBRE" }]);
    expect(o.mundos).toEqual([{ id: MUN_URBANO, nombre: "URBANO" }]);
    expect(o.lineas).toEqual([{ id: LIN_DENIM, nombre: "DENIM" }]);
    expect(opcionesFiltro(marcas, null).generos).toEqual([]);
  });
});

describe("peso por GML (bloque 2)", () => {
  const a = analisisBeta();

  it("los GML con peso van en orden de unidades, los pequeños incluidos", () => {
    const o = gmlConPeso(a.filas);
    expect(o[0].ruta).toBe("HOMBRE · URBANO · DENIM");
    expect(o.map((x) => x.unidades)).toEqual([...o.map((x) => x.unidades)].sort((x, y) => y - x));
    expect(o.map((x) => x.clave)).toContain("gml-peq1|");
  });

  it("una serie por año con sus doce meses y el color del año", () => {
    const s = seriesP1Mensual(a.filas[0]);
    expect(s.map((x) => x.etiqueta)).toEqual(["2025", "2026"]);
    expect(s[0].valores).toHaveLength(12);
    expect(s[1].valores.slice(9)).toEqual([null, null, null]);
    expect(s[0].color).not.toBe(s[1].color);
  });
});

describe("M7: aviso de configuración cambiada", () => {
  it("el motivo `config_cambiada` se explica en palabras y conserva las decisiones; los demás motivos siguen como los dice el servidor", async () => {
    const { textoMotivoDesactualizada } = await import("../src/app/(app)/planificacion/proyeccion/vista");
    const t = textoMotivoDesactualizada({ codigo: "config_cambiada", mensaje: "texto del servidor" });
    expect(t).toContain("Cambió la configuración de marcas");
    expect(t).toContain("modalidades, GML relevantes o conjuntos");
    expect(t).toContain("Tus decisiones se conservan");
    expect(textoMotivoDesactualizada({ codigo: "cargas_nuevas", mensaje: "hay cargas nuevas" })).toBe("hay cargas nuevas");
  });
});
