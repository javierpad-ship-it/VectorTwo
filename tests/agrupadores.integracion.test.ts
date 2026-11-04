import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BarraFiltrosCompras } from "../src/components/compras/barra-filtros-compras";
import { DetalleCompra } from "../src/components/compras/detalle-compra";
import { ImportarCompras, plantillaCompras, ReporteImportacionCompras } from "../src/components/compras/importar-compras";
import { ListaCompras } from "../src/components/compras/lista-compras";
import { ReporteAgrupadoresCompras } from "../src/components/compras/reporte-agrupadores-compras";
import {
  admiteAsignarAgrupador,
  embarquesDeCompra,
  entregaComoSinEmbarque,
  entregasSinEmbarqueDeCompra,
  hrefEmbarque,
  hrefViaje,
  opcionesEmbarqueFiltro,
  textoChipAsignacion,
  textoSinEmbarque,
  totalesAgrupadores,
  unidadesSinEmbarque,
} from "../src/components/compras/vista-agrupadores-compras";
import { consultaCompras, filtrarCompras, filtrosCompras, hayFiltrosCompras, leerParametrosCompras, PARAMETROS_COMPRAS_VACIOS } from "../src/components/compras/vista-compras";
import { ETIQUETA_MOTIVO_OMISION_COMPRA } from "../src/components/compras/vista-importar";
import { textoErrorImportar } from "../src/components/compras/use-importar-compras";
import { ErrorApi } from "../src/lib/api-client";
import { MOTIVOS_OMISION_COMPRA_AGRUPADOR } from "../src/lib/compras/agrupadores/tipos";
import type { AgrupadorImportacionCompraApi, OpcionEmbarqueApi } from "../src/lib/compras/agrupadores/tipos-api";
import { puedeImportar } from "../src/lib/compras/permisos";
import type { CompraApi } from "../src/lib/compras/tipos-api";
import { urlCompras } from "../src/lib/compras/use-compras";
import { compraApiC12Parcial, comprasApiEjemplo, reporteImportacionEjemplo } from "./compras.fixture";

/**
 * T4 de 08b-1 (integración, ficha 08b §4.5 y §3.9): el viaje activo y los agrupadores dentro de Compras (lista, detalle, filtros), el
 * importador de compras con las columnas VIAJE, EMBARQUE y PAQUETE, y el permiso del comprador para importar (sin carga inicial).
 */

const RAIZ = path.resolve(__dirname, "..");
const fuente = (ruta: string) => readFileSync(path.join(RAIZ, ruta), "utf8");
const sinComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const html = (el: ReturnType<typeof createElement>) => renderToStaticMarkup(el);
const noop = () => {};

const ID = {
  viaje: "a3000000-0000-4000-8000-000000000001",
  e1: "a4000000-0000-4000-8000-000000000001",
  e2: "a4000000-0000-4000-8000-000000000002",
  p1: "a5000000-0000-4000-8000-000000000001",
};

/** C-000012 (fixture de M8) con su viaje y, en cada línea, la primera entrega asignada a 261101 (paquete 261101) y el resto sin embarque. */
function compraConAgrupadores(): CompraApi {
  const c = compraApiC12Parcial();
  return {
    ...c,
    viaje: { id: ID.viaje, codigo: "261001", nombre: "Feria Sur", estado: "abierto" },
    lineas: c.lineas.map((l) => ({
      ...l,
      entregas: l.entregas.map((e, i) =>
        i === 0
          ? { ...e, asignaciones: [{ id: `${e.id}-a`, embarque: { id: ID.e1, codigo: "261101" }, paquete: { id: ID.p1, codigo: "261101" }, unidades: Math.min(100, e.unidades) }], sin_embarque: Math.max(0, e.unidades - 100) }
          : { ...e, asignaciones: [], sin_embarque: e.unidades },
      ),
    })),
  };
}

describe("T4: lectura de los agrupadores de una compra", () => {
  it("una compra de M8 sin agrupadores se lee como «sin nada»: nada de embarques, nada sin embarque, nada que asignar", () => {
    const c = compraApiC12Parcial();
    expect(embarquesDeCompra(c)).toEqual([]);
    expect(unidadesSinEmbarque(c)).toBe(0);
    expect(entregasSinEmbarqueDeCompra(c)).toEqual([]);
  });

  it("agrupa los embarques sin repetir, con unidades y paquetes, y suma lo que queda sin embarque", () => {
    const c = compraConAgrupadores();
    const e = embarquesDeCompra(c);
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ id: ID.e1, codigo: "261101", paquetes: ["261101"] });
    expect(e[0].unidades).toBeGreaterThan(0);
    const totalSin = c.lineas.reduce((a, l) => a + l.entregas.reduce((b, x) => b + (x.sin_embarque ?? 0), 0), 0);
    expect(unidadesSinEmbarque(c)).toBe(totalSin);
    expect(totalSin).toBeGreaterThan(0);
  });

  it("solo se asigna en compras borrador o confirmadas y sin saldo cerrado: una recibida o cancelada no ofrece nada", () => {
    expect(admiteAsignarAgrupador({ estado: "borrador", saldo_cerrado: false })).toBe(true);
    expect(admiteAsignarAgrupador({ estado: "confirmada", saldo_cerrado: false })).toBe(true);
    for (const x of [{ estado: "recibida", saldo_cerrado: false }, { estado: "cancelada", saldo_cerrado: false }, { estado: "recibida", saldo_cerrado: true }] as const) expect(admiteAsignarAgrupador(x)).toBe(false);
    const c = { ...compraConAgrupadores(), estado: "recibida" as const };
    expect(unidadesSinEmbarque(c)).toBe(0);
    expect(entregasSinEmbarqueDeCompra(c)).toEqual([]);
  });

  it("el chip de una entrega es `Embarque 261101 · P 261101 · 300 u` y, sin paquete, no lleva la P", () => {
    expect(textoChipAsignacion({ embarque: { id: ID.e1, codigo: "261101" }, paquete: { id: ID.p1, codigo: "261101" }, unidades: 300 })).toBe("Embarque 261101 · P 261101 · 300 u");
    const sinPaquete = textoChipAsignacion({ embarque: { id: ID.e1, codigo: "261201" }, paquete: null, unidades: 80 });
    expect(sinPaquete).toBe("Embarque 261201 · 80 u");
    expect(textoSinEmbarque(120)).toBe("120 u sin embarque");
  });

  it("una entrega con unidades sin embarque se arma como la espera `DialogoAsignar` (compra, revisión y línea)", () => {
    const c = compraConAgrupadores();
    const l = c.lineas[0];
    const e = l.entregas.find((x) => (x.sin_embarque ?? 0) > 0);
    expect(e).toBeDefined();
    const x = entregaComoSinEmbarque(c, l, e!);
    expect(x).not.toBeNull();
    expect(x).toMatchObject({ entrega_id: e!.id, sin_asignar: e!.sin_embarque, periodo: e!.periodo, compra: { id: c.id, numero: c.numero, revision: c.revision, viaje_id: ID.viaje }, linea: { id: l.id, moneda: c.moneda } });
    // La que ya está toda asignada no se ofrece.
    expect(entregaComoSinEmbarque(c, l, { ...e!, sin_embarque: 0 })).toBeNull();
    expect(entregasSinEmbarqueDeCompra(c).length).toBeGreaterThan(0);
  });

  it("los enlaces llevan al detalle del embarque y del viaje en Viajes y embarques", () => {
    expect(hrefEmbarque(ID.e1)).toBe(`/compras/agrupadores?embarque=${ID.e1}`);
    expect(hrefViaje(ID.viaje)).toBe(`/compras/agrupadores?pestana=viajes&viaje=${ID.viaje}`);
  });

  it("el filtro de embarque omite los cancelados (salvo el elegido) y va por mes de llegada", () => {
    const base = { tipo: "importacion", viaje_id: null, revision: 0 } as const;
    const op = (id: string, codigo: string, estado: OpcionEmbarqueApi["estado"], periodo: string): OpcionEmbarqueApi => ({ ...base, id, codigo, nombre: `N ${codigo}`, estado, periodo_llegada: periodo });
    const lista = [op("b", "261201", "planificado", "2026-12"), op("a", "261101", "en_transito", "2026-11"), op("c", "261102", "cancelado", "2026-11")];
    expect(opcionesEmbarqueFiltro(lista).map((x) => x.id)).toEqual(["a", "b"]);
    expect(opcionesEmbarqueFiltro(lista, "c").map((x) => x.id)).toEqual(["a", "c", "b"]);
    expect(opcionesEmbarqueFiltro(lista)[0].nombre).toContain("Embarque 261101");
  });
});

describe("T4: parámetros y filtros de Compras con viaje y embarque", () => {
  it("el embarque viaja en la URL y al servidor como embarque_id; un valor que no es uuid se ignora", () => {
    const p = leerParametrosCompras((k) => ({ embarque: ID.e1 })[k] ?? null);
    expect(p.embarque).toBe(ID.e1);
    expect(consultaCompras(p)).toBe(`embarque=${ID.e1}`);
    expect(filtrosCompras(p).embarque_id).toBe(ID.e1);
    expect(hayFiltrosCompras(p)).toBe(true);
    expect(leerParametrosCompras((k) => ({ embarque: "no-es-uuid" })[k] ?? null).embarque).toBeNull();
    expect(PARAMETROS_COMPRAS_VACIOS.embarque).toBeNull();
  });

  it("la API de la lista recibe viaje_id explícito (uuid o sin_viaje) y nada con «todos»", () => {
    expect(urlCompras({ viaje_id: ID.viaje })).toBe(`/api/compras?viaje_id=${ID.viaje}`);
    expect(urlCompras({ viaje_id: "sin_viaje", embarque_id: ID.e1 })).toBe(`/api/compras?viaje_id=sin_viaje&embarque_id=${ID.e1}`);
    expect(urlCompras({ viaje_id: undefined })).toBe("/api/compras");
  });

  it("el texto libre también busca por código y nombre del viaje y por código de embarque", () => {
    const c = compraConAgrupadores();
    expect(filtrarCompras([c], "261001")).toHaveLength(1);
    expect(filtrarCompras([c], "feria sur")).toHaveLength(1);
    expect(filtrarCompras([c], "261101")).toHaveLength(1);
    expect(filtrarCompras([c], "999999")).toHaveLength(0);
  });
});

describe("T4: lista y detalle de Compras", () => {
  it("la lista trae las columnas Viaje y Embarques, con el viaje, los embarques y lo que queda sin embarque", () => {
    const h = html(createElement(ListaCompras, { compras: [compraConAgrupadores()], enlace: (c) => `/compras/registro?compra=${c.id}` }));
    for (const t of ["Viaje", "Embarques", "261001", "Feria Sur", "261101", "sin embarque"]) expect(h, t).toContain(t);
    expect(h).toContain(`href="/compras/agrupadores?embarque=${ID.e1}"`);
    expect(h).toContain("overflow-x-auto");
  });

  it("una compra sin viaje ni embarque (o de M8 sin agrupadores) muestra «—» y la lista sigue funcionando", () => {
    const h = html(createElement(ListaCompras, { compras: comprasApiEjemplo(), enlace: () => "#" }));
    expect(h).toContain("Viaje");
    expect(h).not.toContain("sin embarque");
  });

  it("el mensaje de lista vacía se puede cambiar (con el viaje activo puesto, dice que es ese viaje)", () => {
    expect(html(createElement(ListaCompras, { compras: [], enlace: () => "", vacio: "Ninguna compra en el viaje activo." }))).toContain("Ninguna compra en el viaje activo.");
  });

  const detalle = (c: CompraApi, extra: Record<string, unknown> = {}) => html(createElement(DetalleCompra, { compra: c, puedeEscribir: false, onConfirmarIngreso: noop, onQuitarIngreso: noop, onCancelar: noop, ...extra }));

  it("el detalle muestra «Viaje: 261001 · Feria Sur», los chips por entrega y las unidades sin embarque", () => {
    const h = detalle(compraConAgrupadores());
    for (const t of ["Viaje", "261001 · Feria Sur", "Embarque 261101 · P 261101 · 100 u", "u sin embarque"]) expect(h, t).toContain(t);
  });

  it("los botones Cambiar viaje y Asignar a embarque salen para quien no es planner si el panel los ofrece (decisión 92) y no sin ellos", () => {
    const c = compraConAgrupadores();
    const con = detalle(c, { onCambiarViaje: noop, onAsignarEmbarque: noop });
    expect(con).toContain(">Cambiar<");
    expect(con).toContain("Asignar a embarque…");
    const sin = detalle(c);
    expect(sin).not.toContain(">Cambiar<");
    expect(sin).not.toContain("Asignar a embarque…");
  });

  it("sin viaje se ofrece «Asignar a viaje…»; una compra cancelada no ofrece cambiar el viaje ni asignar embarque", () => {
    const sinViaje = { ...compraConAgrupadores(), viaje: null };
    const h = detalle(sinViaje, { onCambiarViaje: noop, onAsignarEmbarque: noop });
    expect(h).toContain("Sin viaje");
    expect(h).toContain("Asignar a viaje…");
    const cancelada = { ...compraConAgrupadores(), estado: "cancelada" as const };
    const x = detalle(cancelada, { onCambiarViaje: noop, onAsignarEmbarque: noop });
    expect(x).not.toContain(">Cambiar<");
    expect(x).not.toContain("Asignar a embarque…");
  });

  it("un viaje cerrado se rotula; una compra de M8 sin la clave `viaje` no muestra la franja de agrupadores", () => {
    const cerrado = { ...compraConAgrupadores(), viaje: { id: ID.viaje, codigo: "261001", nombre: "Feria Sur", estado: "cerrado" as const } };
    expect(detalle(cerrado)).toContain("Viaje cerrado");
    expect(detalle(compraApiC12Parcial())).not.toContain("Embarques");
  });

  it("el filtro de Embarque aparece solo si hay embarques y la barra sigue igual sin él", () => {
    const props = { parametros: PARAMETROS_COMPRAS_VACIOS, proveedores: [], generos: [], mundos: [], lineas: [], marcas: [], onCambiar: noop };
    expect(html(createElement(BarraFiltrosCompras, props))).not.toContain("Embarque");
    const h = html(createElement(BarraFiltrosCompras, { ...props, embarques: [{ id: ID.e1, nombre: "Embarque 261101 · nov-26 · Dic" }] }));
    expect(h).toContain("Embarque");
    expect(h).toContain("Embarque 261101 · nov-26");
  });
});

describe("T4: importador de compras con VIAJE, EMBARQUE y PAQUETE", () => {
  it("la plantilla suma VIAJE, EMBARQUE y PAQUETE antes de NOTA, y sin carga inicial no lleva RECIBIDAS", () => {
    const ci = plantillaCompras(true);
    expect(ci.columnas.slice(-4)).toEqual(["VIAJE", "EMBARQUE", "PAQUETE", "NOTA"]);
    expect(ci.columnas).toContain("RECIBIDAS");
    const normal = plantillaCompras(false);
    expect(normal.columnas).not.toContain("RECIBIDAS");
    expect(normal.columnas.slice(-4)).toEqual(["VIAJE", "EMBARQUE", "PAQUETE", "NOTA"]);
    for (const p of [ci, normal]) expect(p.fila).toHaveLength(p.columnas.length);
    expect(ci.columnas).toHaveLength(normal.columnas.length + 1);
    // La fila de ejemplo deja los agrupadores vacíos: con un código que no existe, saldría omitida.
    const i = ci.columnas.indexOf("VIAJE");
    expect(ci.fila.slice(i, i + 3)).toEqual(["", "", ""]);
  });

  it("el administrador y el planner empiezan con la casilla de carga inicial marcada; el comprador no la ve y trabaja en borrador", () => {
    const planner = html(createElement(ImportarCompras, { onAplicado: noop, puedeCargaInicial: true }));
    expect(planner).toContain("Carga inicial de compras ya hechas");
    expect(planner).toMatch(/type="checkbox"[^>]*checked/);
    const comprador = html(createElement(ImportarCompras, { onAplicado: noop, puedeCargaInicial: false }));
    expect(comprador).not.toContain("Carga inicial de compras ya hechas");
    expect(comprador).not.toContain('type="checkbox"');
    expect(comprador).toContain("entran en borrador");
    expect(comprador).toContain("Descargar plantilla (Excel)");
    expect(comprador).toContain("1. Archivo");
  });

  it("la pantalla pregunta a `puedeImportar` y nunca ofrece la carga inicial a quien no puede hacerla", () => {
    expect(puedeImportar("comprador", false)).toBe(true);
    expect(puedeImportar("comprador", true)).toBe(false);
    expect(puedeImportar("planner", true)).toBe(true);
    expect(puedeImportar("admin", false)).toBe(true);
    const panel = fuente("src/app/(app)/compras/registro/registro-panel.tsx");
    expect(panel).toContain("puedeImportar(rol, false)");
    expect(panel).toContain("puedeCargaInicial={puedeImportar(rol, true)}");
  });

  it("un 403 por carga inicial se muestra con el mensaje de la API, sin repetirlo", () => {
    expect(textoErrorImportar(new ErrorApi("La carga inicial de compras ya hechas solo la hacen el planner o el administrador.", 403))).toBe("La carga inicial de compras ya hechas solo la hacen el planner o el administrador.");
    expect(textoErrorImportar(new ErrorApi("Tu rol es de solo lectura.", 403))).toContain("administración y planeamiento");
  });

  it("las ocho omisiones nuevas del importador tienen su etiqueta y todas están en el contrato", () => {
    for (const m of MOTIVOS_OMISION_COMPRA_AGRUPADOR) expect(ETIQUETA_MOTIVO_OMISION_COMPRA[m], m).toBeTruthy();
    expect(MOTIVOS_OMISION_COMPRA_AGRUPADOR).toHaveLength(8);
  });

  const filasAgrupador = (): AgrupadorImportacionCompraApi[] => [
    { fila: 2, viaje: { id: ID.viaje, codigo: "261001" }, embarque: { id: ID.e1, codigo: "261101" }, paquete: { id: ID.p1, codigo: "261101" }, resultado: "asignado", avisos: ["viaje_cerrado"] },
    { fila: 3, viaje: null, embarque: { id: ID.e2, codigo: "261201" }, paquete: null, resultado: "sin_cambio", avisos: ["agrupador_distinto"] },
    { fila: 4, viaje: null, embarque: null, paquete: null, resultado: "omitido", motivo: "embarque_desconocido", avisos: [] },
  ];

  it("el reporte de agrupadores cuenta lo asignado, lo que no cambia y lo omitido, y dice el motivo y los avisos", () => {
    expect(totalesAgrupadores(filasAgrupador())).toEqual({ asignado: 1, sin_cambio: 1, omitido: 1, no_asignado: 0 });
    const h = html(createElement(ReporteAgrupadoresCompras, { filas: filasAgrupador(), aplicado: false }));
    for (const t of ["Viaje, embarque y paquete (3)", "Se asignarán", "Sin cambio", "Omitidas por su agrupador", "Viaje 261001", "Embarque 261101", "P 261101", "El embarque no existe", "El viaje está cerrado", "Ya está asignada a otro embarque"]) expect(h, t).toContain(t);
  });

  it("al aplicar, una asignación que falló se avisa y se explica que reimportar la completa", () => {
    const filas = filasAgrupador();
    filas[0] = { ...filas[0], no_asignado: { motivo: "compra_cambio", mensaje: "Otra persona cambió la compra." } };
    const h = html(createElement(ReporteAgrupadoresCompras, { filas, aplicado: true }));
    expect(h).toContain("Asignadas");
    expect(h).toContain("No se pudo asignar: Otra persona cambió la compra.");
    expect(h).toContain("Reimporta el mismo archivo");
  });

  it("sin filas de agrupadores el reporte no pinta nada, y el reporte de compras incluye la sección cuando la API la trae", () => {
    expect(html(createElement(ReporteAgrupadoresCompras, { filas: [], aplicado: false }))).toBe("");
    const r = { ...reporteImportacionEjemplo("previsualizar"), agrupadores: filasAgrupador() };
    const h = html(createElement(ReporteImportacionCompras, { titulo: "3. Previsualización", reporte: r, nombreArchivo: "compras.xlsx" }));
    expect(h).toContain("Viaje, embarque y paquete (3)");
    expect(html(createElement(ReporteImportacionCompras, { titulo: "3. Previsualización", reporte: reporteImportacionEjemplo("previsualizar"), nombreArchivo: "compras.xlsx" }))).not.toContain("Viaje, embarque y paquete");
  });
});

describe("T4: estructura de la integración", () => {
  const TSX = [
    "src/app/(app)/compras/registro/registro-panel.tsx",
    "src/components/compras/dialogo-viaje-compra.tsx",
    "src/components/compras/reporte-agrupadores-compras.tsx",
    "src/components/compras/importar-compras.tsx",
    "src/components/compras/detalle-compra.tsx",
    "src/components/compras/lista-compras.tsx",
  ];

  it("la página de Compras lee la cookie del viaje activo en el servidor (solo su formato) y se la pasa al panel con el perfil", () => {
    const c = fuente("src/app/(app)/compras/registro/page.tsx");
    expect(c).toContain("COOKIE_VIAJE_ACTIVO");
    expect(c).toContain("parsearViajeActivo(");
    expect(c).toContain("<RegistroPanel rol={r.rol} perfilId={r.perfil.id} viajeActivoInicial={guardado} />");
    expect(c).not.toContain('"use client"');
  });

  it("el panel filtra la lista con `viaje_id` explícito, espera a saber el viaje activo y muestra la barra", () => {
    const p = sinComentarios(fuente("src/app/(app)/compras/registro/registro-panel.tsx"));
    expect(p).toContain("viaje_id: usaAgrupadores ? viajeParaApi(activo.valor) : undefined");
    expect(p).toContain("viajeActivoListo ? {");
    expect(p).toContain("<BarraViajeActiva");
    expect(p).toContain("DialogoViajeCompra");
    expect(p).toContain("DialogoAsignar");
    // La carga inicial y el resto de la escritura de M8 siguen siendo de admin y planner.
    expect(p).toContain('const puedeEscribir = rol === "admin" || rol === "planner"');
  });

  it("los botones de viaje y embarque no cuelgan de `puedeEscribir` (los tres roles escriben agrupadores)", () => {
    const d = sinComentarios(fuente("src/components/compras/detalle-compra.tsx"));
    expect(d).toContain("onCambiarViaje && admiteCambiarViaje(compra)");
    const franja = d.slice(d.indexOf("function AgrupadoresDeCompra"), d.indexOf("function Dato("));
    expect(franja).not.toContain("puedeEscribir");
  });

  it("quitar el viaje pide confirm y los errores de la API se muestran con Alert", () => {
    const d = sinComentarios(fuente("src/components/compras/dialogo-viaje-compra.tsx"));
    expect(d).toMatch(/confirm\(`¿Quitar el viaje/);
    expect(d).toContain("pideRelectura(");
    expect(d).toContain("error={aviso ?? (accion.error ? textoErrorAccion(accion.error) : null)}");
    expect(d).toContain("asignarComprasViaje(");
  });

  it("nada habla con Supabase desde el navegador y no hay colores sueltos en lo nuevo", () => {
    for (const f of [...TSX, "src/components/compras/vista-agrupadores-compras.ts"]) {
      const c = sinComentarios(fuente(f));
      expect(c, f).not.toMatch(/supabase/i);
      expect(c, f).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(c, f).not.toMatch(/\b(?:bg|text|border|ring|fill|stroke)-(?:red|green|blue|yellow|gray|slate|zinc|amber|emerald|white|black|orange)\b/);
    }
  });

  it("T3a ya no duplica las hojas ni la plantilla: salen de la lógica pura de T2", () => {
    const h = sinComentarios(fuente("src/components/compras/agrupadores/hojas-agrupadores.ts"));
    expect(h).toContain('from "@/lib/compras/agrupadores/excel"');
    const v = sinComentarios(fuente("src/components/compras/agrupadores/vista-importar-agrupadores.ts"));
    expect(v).toContain('from "@/lib/compras/agrupadores/plantilla"');
  });
});
