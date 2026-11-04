import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AsignableApi, EmbarqueApi, OpcionesAgrupadoresApi, ViajeApi, ViajeDetalleApi } from "../src/lib/compras/agrupadores/tipos-api";
import { BarraViajeActiva } from "../src/components/compras/agrupadores/barra-viaje-activo";
import { DetalleEmbarque } from "../src/components/compras/agrupadores/detalle-embarque";
import { DetalleViaje } from "../src/components/compras/agrupadores/detalle-viaje";
import { DialogoAPaquete } from "../src/components/compras/agrupadores/dialogo-a-paquete";
import { DialogoAsignar } from "../src/components/compras/agrupadores/dialogo-asignar";
import { DialogoCancelarAgrupador } from "../src/components/compras/agrupadores/dialogo-cancelar";
import { DialogoComprasViaje } from "../src/components/compras/agrupadores/dialogo-compras-viaje";
import { DialogoFecha } from "../src/components/compras/agrupadores/dialogo-fecha";
import { VistaPreviaPlan } from "../src/components/compras/agrupadores/dialogo-movimiento";
import { DialogoMoverPaquete } from "../src/components/compras/agrupadores/dialogo-mover-paquete";
import { DialogoPasarPendientes } from "../src/components/compras/agrupadores/dialogo-pasar-pendientes";
import { DialogoQuitar } from "../src/components/compras/agrupadores/dialogo-quitar";
import { FiltrosEmbarques } from "../src/components/compras/agrupadores/filtros-embarques";
import { HistorialAgrupador } from "../src/components/compras/agrupadores/historial";
import { ListaEmbarques, TarjetaEmbarque } from "../src/components/compras/agrupadores/lista-embarques";
import { ListaViajes } from "../src/components/compras/agrupadores/lista-viajes";
import { ModalEmbarque } from "../src/components/compras/agrupadores/modal-embarque";
import { ModalPaquete } from "../src/components/compras/agrupadores/modal-paquete";
import { ModalViaje } from "../src/components/compras/agrupadores/modal-viaje";
import { PestanaImportar, ReporteImportacionAgrupadores } from "../src/components/compras/agrupadores/pestana-importar";
import { PestanaSinAgrupador } from "../src/components/compras/agrupadores/pestana-sin-agrupador";
import { TablaCompras, TablaEntregasSinEmbarque } from "../src/components/compras/agrupadores/tablas-sin-agrupador";
import { PARAMETROS_AGRUPADORES_VACIOS } from "../src/components/compras/agrupadores/vista-agrupadores";
import {
  asignacionApiL1Nov,
  COMPRA_AGR,
  embarqueApi261101,
  embarqueDetalleApi261101,
  EMBARQUE_AGR,
  PAQUETE_AGR,
  paqueteApi261101,
  PERFIL_AGR,
  planCaso3,
  PROVEEDOR_AGR,
  reporteCaso19bPrevisualizar,
  sinAgrupadorApi,
  VIAJE_AGR,
  viajeApi261001,
} from "./agrupadores.fixture";

/** Humo de render con los casos sintéticos de T0: ningún componente de agrupadores debe lanzar y los textos y botones clave deben salir. */

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const noop = () => {};
const sinHacer = async () => {};

const asignables: AsignableApi[] = [
  { perfil_id: PERFIL_AGR.c1, nombre: "Comprador C1", email: "c1@ejemplo.com", rol: "comprador" },
  { perfil_id: PERFIL_AGR.c2, nombre: "Comprador C2", email: "c2@ejemplo.com", rol: "comprador" },
  { perfil_id: PERFIL_AGR.a, nombre: "Admin A", email: "a@ejemplo.com", rol: "admin" },
];
const opciones = (): OpcionesAgrupadoresApi => ({
  viajes: [
    { id: VIAJE_AGR.v261001, codigo: "261001", nombre: "Feria Sur · oct-2026", estado: "abierto", fecha_inicio: "2026-10-05" },
    { id: "b0a30000-0000-4000-8000-000000000002", codigo: "260901", nombre: "Taller Lima · sep-2026", estado: "cerrado", fecha_inicio: "2026-09-05" },
  ],
  embarques: [
    { id: EMBARQUE_AGR.e261101, codigo: "261101", nombre: "Nov-26 · Feria Sur", tipo: "importacion", estado: "planificado", periodo_llegada: "2026-11", viaje_id: VIAJE_AGR.v261001, revision: 1 },
    { id: EMBARQUE_AGR.e261201, codigo: "261201", nombre: "Dic-26 · Feria Sur", tipo: "importacion", estado: "planificado", periodo_llegada: "2026-12", viaje_id: VIAJE_AGR.v261001, revision: 0 },
    { id: EMBARQUE_AGR.l261102, codigo: "261102", nombre: "Local nov-26", tipo: "local", estado: "cancelado", periodo_llegada: "2026-11", viaje_id: null, revision: 2 },
  ],
  paquetes: [{ id: PAQUETE_AGR.p261101, embarque_id: EMBARQUE_AGR.e261101, codigo: "261101", nombre: "Paquete denim", estado: "abierto" }],
  asignables,
  puertos: ["Puerto Sur", "Puerto Norte"],
});
const viajeDetalle = (): ViajeDetalleApi => ({
  viaje: viajeApi261001(),
  compras: [{ id: COMPRA_AGR.c101, numero: "C-000101", revision: 3, estado: "confirmada", proveedor: { id: PROVEEDOR_AGR.feria, nombre: "Feria Sur" }, fecha_compra: "2026-10-08", unidades: 1500, costo: { PEN: 0, USD: 41500 }, unidades_sin_embarque: 1000 }],
  embarques: [embarqueApi261101()],
});

describe("lista de embarques", () => {
  const e = embarqueApi261101();
  const local: EmbarqueApi = { ...e, id: EMBARQUE_AGR.l261102, codigo: "261102", nombre: "Local nov-26", tipo: "local", viaje: null, responsable_efectivo: null, avisos: ["sin_responsable", "atrasado"], puerto_embarque: null, fecha_salida_estimada: null };

  it("columnas de la ficha §4.1: embarque, tipo, viaje, puerto, responsable, fechas, estado, unidades, contenido, costo y avisos", () => {
    const h = html(createElement(ListaEmbarques, { embarques: [e], enlace: (x) => `/compras/agrupadores?embarque=${x.id}` }));
    for (const t of ["Embarque 261101", "Nov-26 · Feria Sur", "Importación", "261001", "Puerto Sur", "Comprador C1", "Heredado del viaje", "Sale", "25/10/2026", "20/11/2026", "(est.)", "Planificado", "300 u", "recib. (est.)", "pend.", "1 compra · 2 paquetes", "1 proveedor", "US$ 11,400.00"]) expect(h, t).toContain(t);
    expect(h).toContain("overflow-x-auto"); // dentro de DataTable
    expect(h).toContain(`href="/compras/agrupadores?embarque=${e.id}"`);
  });

  it("en el celular salen tarjetas con lo mismo (la tabla se oculta con md:hidden / hidden md:block)", () => {
    const h = html(createElement(ListaEmbarques, { embarques: [e], enlace: () => "/x" }));
    expect(h).toContain("hidden md:block");
    expect(h).toContain("md:hidden");
    expect(h).toContain("<article");
    const t = html(createElement(TarjetaEmbarque, { embarque: e, href: "/x" }));
    for (const x of ["Embarque 261101", "Puerto Sur", "Comprador C1", "20/11/2026", "300 u · 0 recibidas (est.) · 300 pendientes"]) expect(t, x).toContain(x);
  });

  it("un local sin viaje ni responsable: badge Atrasado, ⚠ de responsable faltante y «Sin responsable»", () => {
    const h = html(createElement(ListaEmbarques, { embarques: [local], enlace: () => "/x" }));
    expect(h).toContain("Local");
    expect(h).toContain("Atrasado");
    expect(h).toContain("Sin responsable");
    expect(h).toContain("Responsable faltante");
  });

  it("sin embarques, el texto de vacío", () => {
    expect(html(createElement(ListaEmbarques, { embarques: [], enlace: () => "/x" }))).toContain("Ningún embarque con estos filtros.");
  });
});

describe("filtros y barra del viaje activo", () => {
  it("filtros: Mis embarques / Todos, estado, atrasados, tipo y mes de llegada, con los grupos de chips rotulados", () => {
    const h = html(createElement(FiltrosEmbarques, { parametros: PARAMETROS_AGRUPADORES_VACIOS, mio: true, onCambiar: noop }));
    for (const t of ["Mis embarques", "Todos", "Planificado", "En tránsito", "Recibido", "Cancelado", "Atrasados", "Llega desde", "Llega hasta", "Buscar", 'aria-label="Responsable"', 'aria-label="Estado"']) expect(h, t).toContain(t);
    expect(h).toMatch(/aria-pressed="true"[^>]*>Mis embarques/);
  });

  it("la barra: Todos, Sin viaje (locales), abiertos primero y cerrados al final marcados; con el texto de lo que filtra", () => {
    const h = html(createElement(BarraViajeActiva, { valor: "todos", viajes: opciones().viajes, onCambiar: noop }));
    expect(h).toContain("Todos los viajes");
    expect(h).toContain("Sin viaje (locales)");
    expect(h).toContain("Las listas de Compras y de Viajes y embarques muestran solo este viaje");
    expect(h.indexOf("261001 · Feria Sur")).toBeLessThan(h.indexOf("260901 · Taller Lima"));
    expect(h).toContain("(cerrado)");
    expect(html(createElement(BarraViajeActiva, { valor: "todos", viajes: [], onCambiar: noop, error: "No se pudo guardar." }))).toContain("No se pudo guardar.");
  });
});

describe("detalle del embarque", () => {
  const props = { opciones: opciones(), viajes: [viajeApi261001()], asignables, codigosEmbarque: ["261101"], codigosPaquete: ["261101"], hrefViaje: (id: string) => `/v/${id}`, onRecargar: sinHacer, onMensaje: noop };

  it("cabecera, paquetes y «Sin paquete»: datos clave, acciones de los tres roles y el historial", () => {
    const h = html(createElement(DetalleEmbarque, { ...props, embarque: embarqueDetalleApi261101(), rol: "comprador" }));
    for (const t of ["Embarque 261101 · Nov-26 · Feria Sur", "Puerto Sur", "Viaje 261001", "Comprador C1", "Heredado del viaje", "nov-2026", "Paquete 261101 · Paquete denim", "Paquete 261102 · Paquete resto", "Sin paquete", "C-000101", "DENIM", "300", "Editar", "Cambiar fecha de llegada", "Marcar en tránsito", "Nuevo paquete", "Agregar compras", "Pasar pendientes a…", "Historial del embarque y sus paquetes"]) expect(h, t).toContain(t);
  });

  it("el comprador NO ve cancelar el embarque ni los paquetes; admin y planner sí (la API responde 403 al comprador)", () => {
    const detalle = embarqueDetalleApi261101();
    expect(html(createElement(DetalleEmbarque, { ...props, embarque: detalle, rol: "comprador" }))).not.toMatch(/Cancelar embarque|Cancelar paquete/);
    for (const rol of ["admin", "planner"] as const) {
      const h = html(createElement(DetalleEmbarque, { ...props, embarque: detalle, rol }));
      expect(h, rol).toContain("Cancelar embarque");
      expect(h, rol).toContain("Cancelar paquete");
    }
  });

  it("un embarque cancelado o recibido ya no se edita ni recibe mercadería: solo se puede quitar", () => {
    const cancelado = { ...embarqueDetalleApi261101(), estado: "cancelado" as const };
    const h = html(createElement(DetalleEmbarque, { ...props, embarque: cancelado, rol: "admin" }));
    for (const t of ["Editar", "Cambiar fecha de llegada", "Nuevo paquete", "Agregar compras", "Marcar en tránsito", "Cancelar embarque"]) expect(h, t).not.toContain(t);
  });

  it("una asignación histórica sale atenuada, marcada y sin casilla activa; una desalineada se rotula", () => {
    const base = embarqueDetalleApi261101();
    const historica = { ...asignacionApiL1Nov(), id: "b0a90000-0000-4000-8000-0000000000aa", historica: true, paquete_id: null };
    const desalineada = { ...asignacionApiL1Nov(), id: "b0a90000-0000-4000-8000-0000000000bb", periodo: "2026-12", paquete_id: null };
    const h = html(createElement(DetalleEmbarque, { ...props, embarque: { ...base, asignaciones: [historica, desalineada] }, rol: "comprador" }));
    expect(h).toContain("opacity-60");
    expect(h).toContain("Histórica");
    expect(h).toContain("Desalineada");
    expect(h).toMatch(/disabled=""[^>]*aria-label="Marcar C-000101/);
  });

  it("con avisos del servidor: atrasado y un embarque cancelado con mercadería activa explican qué hacer", () => {
    const e = { ...embarqueDetalleApi261101(), estado: "cancelado" as const, avisos: ["atrasado", "en_embarque_cancelado"] as EmbarqueApi["avisos"] };
    const h = html(createElement(DetalleEmbarque, { ...props, embarque: e, rol: "comprador" }));
    expect(h).toContain("Atrasado");
    expect(h).toContain("Quitar del embarque");
  });
});

describe("formularios", () => {
  it("embarque: crear propone el código, deja elegir tipo, viaje, responsable y puerto con sugerencias, y pide la llegada", () => {
    const h = html(createElement(ModalEmbarque, { embarque: null, viajes: opciones().viajes, asignables, puertos: ["Puerto Sur"], codigosExistentes: ["261101"], viajeInicial: VIAJE_AGR.v261001, onCerrar: noop, onGuardado: noop }));
    for (const t of ["Nuevo embarque", "Código", "Nombre", "Tipo", "Importación", "Local", "Viaje", "Responsable", "Hereda del viaje", "Puerto de embarque", "Puerto Sur", "Referencia logística", "Fecha de salida estimada", "Fecha de llegada estimada", "Crear embarque", "Comprador C1", "Admin A (administrador)", "260901 · Taller Lima · sep-2026 (cerrado)"]) expect(h, t).toContain(t);
    expect(h).toContain('list="puertos-embarque"');
    expect(h).toContain("<dialog");
  });

  it("embarque: editar no deja cambiar el código ni la llegada (esa va por «Cambiar fecha de llegada»)", () => {
    const h = html(createElement(ModalEmbarque, { embarque: embarqueApi261101(), viajes: opciones().viajes, asignables, puertos: [], codigosExistentes: [], onCerrar: noop, onGuardado: noop }));
    expect(h).toContain("Editar embarque 261101");
    expect(h).toContain("Se cambia con «Cambiar fecha de llegada»");
    expect(h).toContain("20/11/2026");
    expect(h).not.toContain(">Código<");
    expect(h).toContain("Guardar cambios");
  });

  it("viaje y paquete: campos y textos", () => {
    const v = html(createElement(ModalViaje, { viaje: null, asignables, perfilId: PERFIL_AGR.c1, codigosExistentes: [], onCerrar: noop, onGuardado: noop }));
    for (const t of ["Nuevo viaje", "Destino", "Inicio", "Fin", "Obligatorio. Compradores y administradores activos.", "Crear viaje"]) expect(v, t).toContain(t);
    const p = html(createElement(ModalPaquete, { embarque: embarqueDetalleApi261101(), paquete: null, asignables, codigosExistentes: [], onCerrar: noop, onGuardado: noop }));
    for (const t of ["Nuevo paquete del embarque 261101", "Hereda del embarque", "Crear paquete"]) expect(p, t).toContain(t);
  });
});

describe("movimientos con vista previa", () => {
  it("la vista previa del caso 3 dice qué mueve, el aviso de entregas fusionadas y la tabla de movimientos", () => {
    const h = html(createElement(VistaPreviaPlan, { plan: planCaso3() }));
    for (const t of ["Mueve 1 línea de 1 compra de nov-26 a dic-26", "C-000101", "DENIM · ALFA", "nov-26 · Embarque 261101 · P 261101", "dic-26 · Embarque 261101 · P 261101", "En dic-26, C-000101 queda con una sola entrega de 500 u."]) expect(h, t).toContain(t);
  });

  it("cambiar fecha: pide la nueva fecha y el motivo, y no deja aplicar sin vista previa", () => {
    const h = html(createElement(DialogoFecha, { embarque: embarqueDetalleApi261101(), onAplicado: noop, onCerrar: noop }));
    for (const t of ["Cambiar fecha de llegada · Embarque 261101", "Hoy llega el 20/11/2026", "Nueva fecha de llegada", "Motivo", "Ver vista previa", "Cambiar fecha", "Elige una fecha distinta de la actual."]) expect(h, t).toContain(t);
    expect(h).toMatch(/<button[^>]*disabled=""[^>]*>Ver vista previa/);
    expect(h).toMatch(/<button[^>]*disabled=""[^>]*>Cambiar fecha/);
  });

  it("agregar compras: filtros por viaje, proveedor, mes y texto; las candidatas llegan del servidor", () => {
    const h = html(createElement(DialogoAsignar, { modo: { tipo: "embarque", embarque: embarqueDetalleApi261101() }, opciones: opciones(), viajes: [viajeApi261001()], onAplicado: noop, onCerrar: noop }));
    for (const t of ["Agregar compras · Embarque 261101", "Viaje", "Compras sin viaje", "Proveedor", "Mes desde", "Mes hasta", "Buscar", "Marcar las visibles", "Cargando…"]) expect(h, t).toContain(t);
  });

  it("asignar a embarque desde Sin agrupador: las entregas llegan marcadas, con sus unidades, y se elige el embarque y el paquete", () => {
    const h = html(createElement(DialogoAsignar, { modo: { tipo: "entregas", entregas: sinAgrupadorApi().entregas }, opciones: opciones(), viajes: [], onAplicado: noop, onCerrar: noop }));
    for (const t of ["Asignar a embarque", "Embarque de destino", "Embarque 261101 · nov-26", "Embarque 261201 · dic-26", "Paquete", "C-000102", "Proveedor Norte", "HOMBRE · CASUAL · POLO", "400", "1 marcada"]) expect(h, t).toContain(t);
    // Un embarque cancelado no es destino.
    expect(h).not.toContain("Embarque 261102");
    expect(h).toContain('value="400"');
  });

  it("quitar del embarque, pasar pendientes, mover paquete y mover a paquete", () => {
    const e = embarqueDetalleApi261101();
    const q = html(createElement(DialogoQuitar, { embarque: e, asignaciones: e.asignaciones, onAplicado: noop, onCerrar: noop }));
    for (const t of ["Quitar del embarque 261101", "quedan sin embarque", "300 u", "C-000101"]) expect(q, t).toContain(t);
    const pp = html(createElement(DialogoPasarPendientes, { embarque: e, seleccionadas: [], opciones: opciones(), onAplicado: noop, onCerrar: noop }));
    for (const t of ["Pasar pendientes · Embarque 261101", "300 u pendientes de todo el embarque", "Embarque 261201", "Motivo"]) expect(pp, t).toContain(t);
    // El destino no puede ser el propio embarque ni uno cancelado.
    expect(pp).not.toContain("Embarque 261101 · nov-26");
    expect(pp).not.toContain("Embarque 261102");
    const mp = html(createElement(DialogoMoverPaquete, { embarque: e, paquete: paqueteApi261101(), opciones: opciones(), onAplicado: noop, onCerrar: noop }));
    for (const t of ["Pasar el paquete 261101 a otro embarque", "Pasar paquete"]) expect(mp, t).toContain(t);
    const ap = html(createElement(DialogoAPaquete, { embarque: e, asignaciones: e.asignaciones, onAplicado: noop, onCerrar: noop }));
    for (const t of ["Mover a paquete", "Sin paquete", "Paquete 261101 · Paquete denim", "No cambia ningún mes"]) expect(ap, t).toContain(t);
  });

  it("cancelar un agrupador: irreversible, pide el motivo y explica la condición", () => {
    const h = html(createElement(DialogoCancelarAgrupador, { tipo: "Embarque", codigo: "261201", revision: 0, llamar: async () => ({}), onCancelado: noop, onCerrar: noop }));
    for (const t of ["Cancelar embarque 261201", "Cancelar es irreversible", "Motivo", "mercadería asignada"]) expect(h, t).toContain(t);
  });
});

describe("viajes", () => {
  const lista = (rol: boolean) =>
    html(createElement(ListaViajes, { viajes: [viajeApi261001(), { ...viajeApi261001(), id: "b0a30000-0000-4000-8000-000000000009", codigo: "260901", estado: "cerrado" as ViajeApi["estado"], avisos: ["viaje_cerrado" as const] }], enlace: (v) => `/v/${v.id}`, viajeActivo: VIAJE_AGR.v261001, puedeCerrarOCancelar: rol, ocupado: false, onUsarActivo: noop, onCerrarViaje: noop, onReabrir: noop, onCancelar: noop }));

  it("lista: viaje, destino, fechas, responsable, estado, compras, unidades, costo, embarques y unidades sin embarque, con «Viaje activo» marcado", () => {
    const h = lista(true);
    for (const t of ["Viaje 261001", "Feria Sur · oct-2026", "Ciudad Sur", "05/10/2026", "Comprador C1", "Abierto", "Cerrado", "1,500", "US$ 41,500.00", "1,000 u", "Viaje activo", "Usar como viaje activo"]) expect(h, t).toContain(t);
  });

  it("Cerrar, Reabrir y Cancelar solo se ven con permiso de admin o planner", () => {
    const con = lista(true);
    expect(con).toContain(">Cerrar<");
    expect(con).toContain(">Reabrir<");
    expect(con).toContain(">Cancelar<");
    const sin = lista(false);
    expect(sin).not.toMatch(/>Cerrar<|>Reabrir<|>Cancelar<|Cancelar viaje/);
    expect(sin).toContain("Usar como viaje activo");
  });

  it("detalle: compras (agregar y quitar), embarques del viaje y «Sin embarque» con «Asignar a embarque…»", () => {
    const props = { detalle: viajeDetalle(), perfilId: PERFIL_AGR.c1, asignables, opciones: opciones(), viajes: [viajeApi261001()], esActivo: false, ocupadoActivo: false, hrefEmbarque: (id: string) => `/e/${id}`, onUsarActivo: noop, onRecargar: sinHacer, onMensaje: noop };
    const h = html(createElement(DetalleViaje, { ...props, rol: "comprador" }));
    for (const t of ["Viaje 261001 · Feria Sur · oct-2026", "Compras del viaje", "Agregar compras", "Quitar del viaje", "C-000101", "Embarques del viaje", "Embarque 261101", "Sin embarque", "Asignar a embarque…", "Nuevo embarque del viaje", "Usar como viaje activo", "Historial del viaje"]) expect(h, t).toContain(t);
    expect(h).not.toMatch(/Cerrar viaje|Cancelar viaje|Reabrir viaje/);
    const admin = html(createElement(DetalleViaje, { ...props, rol: "admin" }));
    expect(admin).toContain("Cerrar viaje");
    expect(admin).toContain("Cancelar viaje");
  });

  it("un viaje cerrado sigue aceptando compras y embarques: avisa, no bloquea (decisión 95); el comprador no puede reabrirlo", () => {
    const cerrado = { ...viajeDetalle(), viaje: { ...viajeApi261001(), estado: "cerrado" as const } };
    const props = { detalle: cerrado, perfilId: PERFIL_AGR.c2, asignables, opciones: opciones(), viajes: [cerrado.viaje], esActivo: false, ocupadoActivo: false, hrefEmbarque: () => "/e", onUsarActivo: noop, onRecargar: sinHacer, onMensaje: noop };
    const h = html(createElement(DetalleViaje, { ...props, rol: "comprador" }));
    expect(h).toContain("igual se le pueden añadir y quitar compras y embarques");
    expect(h).toContain("Agregar compras");
    expect(h).toContain("Nuevo embarque del viaje");
    expect(h).not.toContain("Reabrir viaje");
    expect(html(createElement(DetalleViaje, { ...props, rol: "admin" }))).toContain("Reabrir viaje");
  });

  it("un viaje cancelado no admite cambios", () => {
    const c = { ...viajeDetalle(), viaje: { ...viajeApi261001(), estado: "cancelado" as const } };
    const h = html(createElement(DetalleViaje, { detalle: c, rol: "admin", perfilId: PERFIL_AGR.c1, asignables, opciones: opciones(), viajes: [c.viaje], esActivo: false, ocupadoActivo: false, hrefEmbarque: () => "/e", onUsarActivo: noop, onRecargar: sinHacer, onMensaje: noop }));
    expect(h).toContain("ya no admite cambios");
    for (const t of ["Agregar compras", "Editar", "Cerrar viaje", "Cancelar viaje", "Nuevo embarque del viaje"]) expect(h, t).not.toContain(t);
  });

  it("asignar compras a un viaje: elegir el viaje (con el cerrado al final y avisado) y quitar pide confirmar", () => {
    const sin = sinAgrupadorApi().compras_sin_viaje;
    const a = html(createElement(DialogoComprasViaje, { modo: { tipo: "asignar", compras: sin, viajes: [viajeApi261001(), { ...viajeApi261001(), id: "b0a30000-0000-4000-8000-000000000009", codigo: "260901", estado: "cerrado" }] }, onHecho: noop, onCerrar: noop }));
    for (const t of ["Asignar a viaje", "Viaje de destino", "260901 · Feria Sur · oct-2026 (cerrado)", "C-000102", "Proveedor Norte", "Asignar 1 compra"]) expect(a, t).toContain(t);
    const q = html(createElement(DialogoComprasViaje, { modo: { tipo: "quitar", viaje: viajeApi261001(), compras: viajeDetalle().compras }, onHecho: noop, onCerrar: noop }));
    expect(q).toContain("Quitar compras · Viaje 261001");
    expect(q).toContain("quedan sin viaje");
  });
});

describe("sin agrupador", () => {
  it("la pestaña lleva las dos secciones y sus botones, deshabilitados hasta marcar algo", () => {
    const h = html(createElement(PestanaSinAgrupador, { parametros: PARAMETROS_AGRUPADORES_VACIOS, viajeActivo: "todos", viajes: [], opciones: opciones(), onCambiar: noop, onRecargar: sinHacer, onMensaje: noop }));
    for (const t of ["Entregas sin embarque", "Asignar a embarque…", "Compras sin viaje", "Asignar a viaje…", "Proveedor", "Mes de la entrega desde"]) expect(h, t).toContain(t);
    expect(h).toMatch(/<button[^>]*disabled=""[^>]*>Asignar a embarque…/);
    expect(h).not.toContain("Las entregas son las del viaje activo");
    expect(html(createElement(PestanaSinAgrupador, { parametros: PARAMETROS_AGRUPADORES_VACIOS, viajeActivo: VIAJE_AGR.v261001, viajes: [], opciones: null, onCambiar: noop, onRecargar: sinHacer, onMensaje: noop }))).toContain("Las entregas son las del viaje activo");
  });

  it("las tablas: entregas por mes con lo que queda sin asignar, y compras con su origen", () => {
    const d = sinAgrupadorApi();
    const e = html(createElement(TablaEntregasSinEmbarque, { entregas: d.entregas, seleccion: new Set<string>(), onAlternar: noop }));
    for (const t of ["C-000102", "Proveedor Norte", "HOMBRE · CASUAL · POLO · ALFA", "nov-26", "Confirmada", "Sin asignar"]) expect(e, t).toContain(t);
    const c = html(createElement(TablaCompras, { compras: d.compras_sin_viaje, seleccion: new Set([COMPRA_AGR.c102]), onAlternar: noop, conOrigen: true }));
    for (const t of ["C-000102", "Origen", "Sin embarque", "checked"]) expect(c, t).toContain(t);
  });
});

describe("importar agrupadores", () => {
  it("la pestaña: plantilla en CSV y Excel, reglas claras y el paso 1 con el archivo", () => {
    const h = html(createElement(PestanaImportar, { onAplicado: noop, enlaceCreado: () => null, onVerEmbarques: noop }));
    for (const t of ["Descargar plantilla (CSV)", "Descargar plantilla (Excel)", "columna TIPO", "Solo crea viajes, embarques y paquetes", "1. Archivo", "Hasta 1 000 filas"]) expect(h, t).toContain(t);
  });

  it("caso 19b, previsualizar: 2 viajes, 3 embarques y 4 paquetes nuevos; el viaje sin código «se numera al aplicar»", () => {
    const h = html(createElement(ReporteImportacionAgrupadores, { titulo: "3. Reporte", reporte: reporteCaso19bPrevisualizar(), nombreArchivo: "agrupadores.csv", enlaceCreado: () => null }));
    for (const t of ["Se crearán", "Viajes", "Embarques", "Paquetes", "Filas nuevas (9)", "se numera al aplicar", "261201", "261301"]) expect(h, t).toContain(t);
    expect(h).not.toContain("Códigos asignados");
  });

  it("caso 19c: cambiadas con su diferencia y omitidas con su motivo en castellano; al aplicar lista los códigos con enlace", () => {
    const base = reporteCaso19bPrevisualizar();
    const reporte = {
      ...base,
      modo: "aplicar" as const,
      resumen: { ...base.resumen, nuevas: 7, iguales: 0, cambiadas: 1, omitidas: 1 },
      filas: [
        ...base.filas.slice(0, 7),
        { fila: 4, tipo: "embarque" as const, clave: "embarque|261302", clasificacion: "cambiada" as const, codigo_final: "261302", detalle: "fecha_llegada 2027-01-25 → 2027-01-30", avisos: [] },
        { fila: 11, tipo: "paquete" as const, clave: "paquete|EMBARQUE SIN CÓDIGO|PAQUETE D", clasificacion: "omitida" as const, codigo_final: null, motivo: "referencia_sin_codigo" as const, avisos: ["viaje_cerrado" as const] },
      ],
      creados: [
        { tipo: "viaje" as const, id: VIAJE_AGR.v261001, codigo: "261201" },
        { tipo: "embarque" as const, id: EMBARQUE_AGR.e261101, codigo: "261301" },
        { tipo: "paquete" as const, id: PAQUETE_AGR.p261101, codigo: "261301" },
      ],
    };
    const h = html(createElement(ReporteImportacionAgrupadores, { titulo: "4. Resultado", reporte, nombreArchivo: "agrupadores.csv", enlaceCreado: (c) => (c.tipo === "paquete" ? null : `/compras/agrupadores?${c.tipo}=${c.id}`) }));
    for (const t of ["Se crearon", "fecha_llegada 2027-01-25 → 2027-01-30", "Ya existe con otros datos: corrígelo en pantalla", "La fila referida del archivo no trae código", "Estas filas NO se cargaron", "Códigos asignados (3)", "Viaje 261201", "Embarque 261301", "Paquete 261301", "Fila 11: El viaje está cerrado: igual se registra", "Descargar omitidas (CSV)"]) expect(h, t).toContain(t);
    expect(h).toContain(`href="/compras/agrupadores?viaje=${VIAJE_AGR.v261001}"`);
  });

  it("reimportar sin cambios: todo igual y nada que crear", () => {
    const base = reporteCaso19bPrevisualizar();
    const iguales = { ...base, resumen: { nuevas: 0, iguales: 9, cambiadas: 0, omitidas: 0, por_tipo: { viaje: { nuevas: 0, iguales: 2, cambiadas: 0, omitidas: 0 }, embarque: { nuevas: 0, iguales: 3, cambiadas: 0, omitidas: 0 }, paquete: { nuevas: 0, iguales: 4, cambiadas: 0, omitidas: 0 } } }, filas: base.filas.map((f) => ({ ...f, clasificacion: "igual" as const })) };
    expect(html(createElement(ReporteImportacionAgrupadores, { titulo: "3", reporte: iguales, nombreArchivo: "a.csv", enlaceCreado: () => null }))).toContain("Nada que crear: todo lo del archivo ya existe con el mismo contenido.");
  });
});

describe("historial", () => {
  it("se pide solo al abrirlo: al renderizar no se muestra nada de la lista", () => {
    const h = html(createElement(HistorialAgrupador, { referencia: { tipo: "embarque", id: EMBARQUE_AGR.e261101 } }));
    expect(h).toContain("Ver historial");
    expect(h).toContain('aria-expanded="false"');
    expect(h).not.toContain("Cargando el historial");
  });
});

describe("alta de un embarque desde una compra sin viaje ni agrupador", () => {
  it("la compra de ejemplo C-000101 se enlaza al registro de compras con su identificador", () => {
    const h = html(createElement(TablaCompras, { compras: viajeDetalle().compras, seleccion: new Set<string>(), onAlternar: noop }));
    expect(h).toContain(`href="/compras/registro?compra=${COMPRA_AGR.c101}"`);
  });
});
