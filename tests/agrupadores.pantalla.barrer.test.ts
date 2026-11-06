import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AsignacionApi, EmbarqueDetalleApi, PaqueteApi, PlanMovimientoApi } from "../src/lib/compras/agrupadores/tipos-api";
import { moverAPaqueteSchema } from "../src/lib/compras/agrupadores/esquemas";
import { DetalleEmbarque } from "../src/components/compras/agrupadores/detalle-embarque";
import { DialogoAPaquete } from "../src/components/compras/agrupadores/dialogo-a-paquete";
import { DialogoProgramarBarrer } from "../src/components/compras/agrupadores/dialogo-programar-barrer";
import { resumenPlan } from "../src/components/compras/agrupadores/vista-agrupadores";
import {
  CODIGOS_ERROR_BARRER,
  DESTINO_NUEVO,
  cambiaDeMes,
  cuerpoMoverAPaquete,
  frasesDelPlan,
  ingresoHeredado,
  itemsDeTanda,
  leerUnidades,
  lotesAlBarrer,
  mesDeTanda,
  mesesDelPlan,
  resumenAsignado,
  tandaInicial,
  tandaCambiaDeMes,
  tandaPideMotivo,
  textoAsignado,
  textoErrorBarrer,
  validarTandas,
  type TandaForm,
} from "../src/components/compras/agrupadores/vista-barrer";
import { asignacionApiL1Nov, embarqueDetalleApi261101, paqueteApi261101 } from "./agrupadores.fixture";

/**
 * 08b-1b (corrección del frontend): «Programar lo al barrer» (F10, F11) y «Mover a paquete» con unidades. Lógica pura y render estático;
 * las llamadas en secuencia (crear paquete, fijar ingreso, vista previa, mover, errores 409) se verificaron en el navegador con un arnés de
 * `fetch` simulado (ver el reporte de entrega).
 */

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const noop = () => {};
const fuente = (ruta: string) => readFileSync(new URL(`../${ruta}`, import.meta.url), "utf8");

// Embarque 270301: Ingreso CD 05-mar-27, mes mar-27, con el lote BETA de 1 000 u (600 en el embarque, en mar) y un lote de otra compra.
const loteBeta = (): AsignacionApi => ({
  ...asignacionApiL1Nov(),
  id: "b0a90000-0000-4000-8000-0000000000b1",
  periodo: "2027-03",
  paquete_id: null,
  unidades: 600,
  pendiente: 600,
  linea: { ...asignacionApiL1Nov().linea, id: "b0a70000-0000-4000-8000-0000000000b1", tipo: "barrer_marca", gml: null, marca: "BETA" },
});
const especifica = (): AsignacionApi => ({ ...asignacionApiL1Nov(), id: "b0a90000-0000-4000-8000-0000000000e1", periodo: "2027-03", paquete_id: null });
const paquete = (id: string, extra: Partial<PaqueteApi> = {}): PaqueteApi => ({ ...paqueteApi261101(), id, codigo: `2703${id.slice(-2)}`, nombre: `Tanda ${id.slice(-2)}`, ...extra });
const embarque0270301 = (extra: Partial<EmbarqueDetalleApi> = {}): EmbarqueDetalleApi => ({
  ...embarqueDetalleApi261101(),
  id: "b0a40000-0000-4000-8000-000000000301",
  codigo: "270301",
  nombre: "Mar-27 · California",
  fecha_llegada_estimada: "2027-03-05",
  fecha_ingreso_estimada: null,
  periodo_llegada: "2027-03",
  revision: 4,
  paquetes: [],
  asignaciones: [loteBeta(), especifica()],
  ...extra,
});

describe("lo que está al barrer", () => {
  it("solo los lotes al barrer activos del embarque; las específicas y las históricas no", () => {
    const hist = { ...loteBeta(), id: "x", historica: true };
    const e = embarque0270301({ asignaciones: [loteBeta(), especifica(), hist] });
    expect(lotesAlBarrer(e).map((l) => l.id)).toEqual([loteBeta().id]);
    expect(lotesAlBarrer(embarqueDetalleApi261101())).toEqual([]);
  });

  it("propone el ingreso del embarque y nunca antes de su piso (Ingreso CD o ingreso real)", () => {
    expect(ingresoHeredado(embarque0270301())).toBe("2027-03-05");
    expect(ingresoHeredado(embarque0270301({ fecha_ingreso_estimada: "2027-03-20" }))).toBe("2027-03-20");
    expect(ingresoHeredado(embarque0270301({ fecha_ingreso_estimada: "2027-03-01" }))).toBe("2027-03-05");
    expect(ingresoHeredado(embarque0270301({ fecha_llegada_real: "2027-03-08" }))).toBe("2027-03-08");
  });
});

describe("unidades y cuerpo del movimiento (F10, F11)", () => {
  it("lee enteros con separadores; vacío no mueve; letras o decimales dan error", () => {
    expect(leerUnidades("300")).toBe(300);
    expect(leerUnidades(" 1 000 ")).toBe(1000);
    expect(leerUnidades("1.000")).toBe(1000);
    expect(leerUnidades("")).toBeNull();
    expect(leerUnidades(undefined)).toBeNull();
    expect(leerUnidades("3,5")).toMatchObject({ error: expect.any(String) });
    expect(leerUnidades("abc")).toMatchObject({ error: expect.any(String) });
  });

  it("la asignación entera va como id y una parte como {id, unidades}; el cuerpo pasa el esquema del servidor", () => {
    const l = loteBeta();
    const e = especifica();
    const items = [
      { id: l.id, unidades: 300 },
      { id: e.id, unidades: e.unidades },
    ];
    const cuerpo = cuerpoMoverAPaquete({ revision: 4, paqueteId: "b0a50000-0000-4000-8000-0000000000a1", items, asignaciones: [l, e], motivo: " Se suelta en abril ", causa: "programacion" });
    expect(cuerpo.asignaciones).toEqual([{ id: l.id, unidades: 300 }, e.id]);
    expect(cuerpo.motivo).toBe("Se suelta en abril");
    expect(moverAPaqueteSchema.safeParse(cuerpo).success).toBe(true);
    // Sin motivo ni causa, no viajan.
    const limpio = cuerpoMoverAPaquete({ revision: 4, paqueteId: null, items, asignaciones: [l, e], motivo: "  ", causa: null });
    expect("motivo" in limpio).toBe(false);
    expect("causa" in limpio).toBe(false);
    expect(moverAPaqueteSchema.safeParse(limpio).success).toBe(true);
  });

  it("adelanta si cambia de mes con la misma regla del servidor", () => {
    const l = loteBeta();
    const items = [{ id: l.id, unidades: 300 }];
    expect(cambiaDeMes(items, [l], "2027-04", "p1")).toBe(true);
    expect(cambiaDeMes(items, [l], "2027-03", "p1")).toBe(false);
    // Ya está en ese paquete: no se mueve.
    expect(cambiaDeMes(items, [{ ...l, paquete_id: "p1" }], "2027-04", "p1")).toBe(false);
  });
});

describe("tandas", () => {
  const lotes = [loteBeta()];
  const e = embarque0270301();
  const una = (extra: Partial<TandaForm> = {}): TandaForm => ({ ...tandaInicial("t1", lotes, "2027-04-04", true), ...extra });

  it("una tanda con todo el lote, paquete nuevo y fecha dentro de la llegada es válida: «Asignado 600 de 600 u»", () => {
    const t = una();
    expect(validarTandas([t], lotes, e).errores).toEqual([]);
    const r = resumenAsignado(new Map([[lotes[0].id, 600]]), [t]);
    expect(textoAsignado(r.asignado, r.total)).toBe("Asignado 600 de 600 u");
  });

  it("F11: dos tandas de 300 suman 600 y ninguna se pasa; con 700 el lote se pasa y se dice", () => {
    const t1 = una({ unidades: { [lotes[0].id]: "300" } });
    const t2 = { ...tandaInicial("t2", lotes, "2027-05-10", false), unidades: { [lotes[0].id]: "300" } };
    expect(validarTandas([t1, t2], lotes, e).errores).toEqual([]);
    const r = resumenAsignado(new Map([[lotes[0].id, 600]]), [t1, t2]);
    expect(r.asignado).toBe(600);
    const pasada = validarTandas([t1, { ...t2, unidades: { [lotes[0].id]: "400" } }], lotes, e);
    expect(pasada.errores.join(" ")).toContain("repartes 700 u y el lote tiene 600 u");
  });

  it("pide nombre, fecha no anterior a la llegada, unidades y no repite nombre ni paquete", () => {
    expect(validarTandas([una({ nombre: "  " })], lotes, e).errores.join(" ")).toContain("nombre");
    expect(validarTandas([una({ fecha: "2027-03-04" })], lotes, e).errores.join(" ")).toContain("antes de la llegada del embarque (05-mar)");
    expect(validarTandas([una({ fecha: "" })], lotes, e).errores.join(" ")).toContain("fecha");
    expect(validarTandas([una({ unidades: {} })], lotes, e).errores.join(" ")).toContain("unidades de al menos un lote");
    expect(validarTandas([una({ unidades: { [lotes[0].id]: "x" } })], lotes, e).errores.join(" ")).toContain("número entero");
    const conPaquete = embarque0270301({ paquetes: [paquete("b0a50000-0000-4000-8000-0000000000a1", { nombre: "Al barrer" })] });
    expect(validarTandas([una({ nombre: "al barrer" })], lotes, conPaquete).errores.join(" ")).toContain("ya hay un paquete llamado");
    const dos = [una({ destino: "b0a50000-0000-4000-8000-0000000000a1" }), { ...una({ destino: "b0a50000-0000-4000-8000-0000000000a1" }), clave: "t2", unidades: { [lotes[0].id]: "1" } }];
    expect(validarTandas(dos, lotes, conPaquete).errores.join(" ")).toContain("otra tanda ya va a ese paquete");
  });

  it("una tanda aplicada no se vuelve a validar ni cuenta como pendiente", () => {
    const aplicada = una({ aplicada: true });
    const v = validarTandas([aplicada], lotes, e);
    expect(v.errores).toEqual(["No queda ninguna tanda por aplicar."]);
    const mas = { ...tandaInicial("t2", lotes, "2027-05-10", false), unidades: { [lotes[0].id]: "100" } };
    expect(validarTandas([aplicada, mas], lotes, e).errores).toEqual([]);
  });

  it("motivo y causa: un paquete por crear siempre los pide; uno existente, solo si cambia de mes", () => {
    const t = una();
    const items = [{ id: lotes[0].id, unidades: 600 }];
    expect(tandaPideMotivo(t, items, e)).toBe(true);
    const p = paquete("b0a50000-0000-4000-8000-0000000000a1", { periodo_ingreso: "2027-04", ingreso_propio: true, fecha_ingreso: "2027-04-04" });
    const conP = embarque0270301({ paquetes: [p] });
    expect(tandaPideMotivo(una({ destino: p.id }), items, conP)).toBe(true);
    const mismoMes = embarque0270301({ paquetes: [{ ...p, periodo_ingreso: "2027-03", fecha_ingreso: "2027-03-20" }] });
    expect(tandaPideMotivo(una({ destino: p.id }), items, mismoMes)).toBe(false);
    // Ya creado y con ingreso fijado: solo cuenta si cambia de mes.
    expect(tandaPideMotivo(una({ creado: { paqueteId: p.id, ingresoFijado: true } }), items, conP)).toBe(true);
    expect(tandaPideMotivo(una({ creado: { paqueteId: p.id, ingresoFijado: true } }), items, mismoMes)).toBe(false);
  });

  it("un paquete por crear nunca es «el paquete donde ya está» el lote: al crearlo en otro mes, cambia de mes", () => {
    const items = [{ id: lotes[0].id, unidades: 600 }];
    // El lote no está en ningún paquete (paquete_id nulo) y el paquete nuevo es otro: con ingreso en abril cambia de mes; en marzo, no.
    expect(tandaCambiaDeMes(una({ fecha: "2027-04-04" }), items, e)).toBe(true);
    expect(tandaCambiaDeMes(una({ fecha: "2027-03-20" }), items, e)).toBe(false);
    expect(tandaCambiaDeMes(una({ fecha: "" }), items, e)).toBe(false);
  });

  it("el mes de una tanda: el de su fecha si el paquete es nuevo; el del paquete si existe", () => {
    expect(mesDeTanda(una({ fecha: "2027-04-04" }), e)).toBe("2027-04");
    expect(mesDeTanda(una({ fecha: "" }), e)).toBeNull();
    const p = paquete("b0a50000-0000-4000-8000-0000000000a1", { periodo_ingreso: "2027-05" });
    expect(mesDeTanda(una({ destino: p.id }), embarque0270301({ paquetes: [p] }))).toBe("2027-05");
    expect(mesDeTanda(una({ destino: paquete("b0a50000-0000-4000-8000-0000000000a2").id }), embarque0270301({ paquetes: [paquete("b0a50000-0000-4000-8000-0000000000a2")] }))).toBe("2027-03");
    expect(una().destino).toBe(DESTINO_NUEVO);
  });

  it("itemsDeTanda descarta vacíos y ceros", () => {
    expect(itemsDeTanda({ a: "5", b: "", c: "0" }, [{ id: "a" }, { id: "b" }, { id: "c" }])).toEqual({ items: [{ id: "a", unidades: 5 }], error: null });
  });
});

describe("vista previa en llano (F10)", () => {
  const plan = (): PlanMovimientoApi => ({
    operacion: "mover_a_paquete",
    huella_plan: "h".repeat(64),
    compras_afectadas: 1,
    lineas: 1,
    unidades_movidas: 600,
    movimientos: [
      { compra_numero: "C-000101", linea: "LOTE · BETA", de: { periodo: "2027-03", embarque: { id: "e", codigo: "270301" }, paquete: null }, a: { periodo: "2027-04", embarque: { id: "e", codigo: "270301" }, paquete: { id: "p", codigo: "270301" } }, unidades: 600 },
    ],
    avisos: [
      { aviso: "cambia_temporada", detalle: "Lote · BETA: verano → invierno" },
      { aviso: "entregas_fusionadas", detalle: "En abr-27, C-000101 queda con una sola entrega de 1 000 u." },
    ],
  });

  it("dice el mes que se mueve y que el lote se vuelve a repartir con la temporada del mes nuevo", () => {
    expect(mesesDelPlan(plan())).toEqual([{ de: "2027-03", a: "2027-04", unidades: 600 }]);
    const f = frasesDelPlan(plan());
    expect(f.meses).toEqual(["mar-27 → abr-27: 600 u"]);
    expect(f.temporada[0]).toContain("se vuelve a repartir con la temporada del mes nuevo");
    expect(f.fusion[0]).toContain("Se funden entregas del mismo mes");
    expect(f.sinCambioDeMes).toBe(false);
    expect(frasesDelPlan({ movimientos: [], avisos: [] }).sinCambioDeMes).toBe(true);
  });

  it("la frase del plan de mover a paquete ya no dice «no cambia ningún mes» si el mes cambia", () => {
    expect(resumenPlan(plan())).toContain("las mueve de mar-27 a abr-27");
    expect(resumenPlan(plan())).not.toContain("no cambia ningún mes");
    const mismo = { ...plan(), movimientos: [{ ...plan().movimientos[0], a: { ...plan().movimientos[0].a, periodo: "2027-03" } }] };
    expect(resumenPlan(mismo)).toContain("no cambia ningún mes");
  });
});

describe("errores en español llano", () => {
  it("cada código de `…/paquete` tiene su texto, con prefijo de tanda si se pide", () => {
    for (const c of ["paquete_de_otro_embarque", "embarque_no_editable", "agrupador_cambio", "no_editable", "asignacion_con_recepciones", "excede_entrega", "compra_cambio", "plan_cambio", "motivo_requerido", "causa_requerida", "reparto_sin_vector", "no_pertenece"]) {
      expect(CODIGOS_ERROR_BARRER, c).toContain(c);
      const t = textoErrorBarrer({ mensaje: "Error 409", codigo: c });
      expect(t, c).not.toMatch(/Error 409|_/);
      expect(t.length, c).toBeGreaterThan(20);
    }
    expect(textoErrorBarrer({ mensaje: "Error 409", codigo: "reparto_sin_vector" }, "Tanda 2")).toMatch(/^Tanda 2: .*no se movió nada/);
    expect(textoErrorBarrer({ mensaje: "Cayó la red", codigo: null })).toBe("Cayó la red");
  });
});

describe("pantallas", () => {
  const props = { opciones: null, viajes: [], asignables: [], codigosEmbarque: ["270301"], codigosPaquete: [], hrefViaje: (id: string) => `/v/${id}`, onRecargar: async () => {}, onMensaje: noop };

  it("el detalle ofrece «Programar lo al barrer» solo si hay lotes al barrer y el embarque se puede editar", () => {
    expect(html(createElement(DetalleEmbarque, { ...props, embarque: embarque0270301(), rol: "comprador" }))).toContain("Programar lo al barrer");
    expect(html(createElement(DetalleEmbarque, { ...props, embarque: embarqueDetalleApi261101(), rol: "comprador" }))).not.toContain("Programar lo al barrer");
    expect(html(createElement(DetalleEmbarque, { ...props, embarque: embarque0270301({ estado: "cancelado" }), rol: "admin" }))).not.toContain("Programar lo al barrer");
  });

  it("el diálogo muestra los lotes, una tanda con todo el lote, «Agregar otra tanda», la suma y motivo y causa obligatorios", () => {
    const h = html(createElement(DialogoProgramarBarrer, { embarque: embarque0270301(), onAplicado: noop, onCerrar: noop }));
    for (const t of ["Programar lo al barrer", "Lo que está al barrer", "Lote · BETA", "C-000101", "mar-27", "Sin paquete", "Tanda 1", "Crear paquete nuevo", "Nombre del paquete", "Ingreso al stock del paquete", 'value="2027-03-05"', 'min="2027-03-05"', "No ofrece días antes de la llegada del embarque (05/03/2027)", "Agregar otra tanda", "Asignado 600 de 600 u", "Causa *", "Motivo *", "Programación del ingreso", "Crear paquetes y ver vista previa", "Programar"]) expect(h, t).toContain(t);
    expect(h).toContain('aria-live="polite"');
    expect(h).toContain("Unidades de C-000101, Lote · BETA, en la tanda 1");
    // Solo lo al barrer: la línea específica no es un lote.
    expect(h).not.toContain("HOMBRE · URBANO · DENIM");
    // Sin motivo escrito, ni la vista previa ni «Programar» se pueden pulsar, y la pista dice qué falta.
    expect(h).toContain("Escribe el motivo: crear el paquete o mover lo al barrer a otro mes lo pide.");
    expect(h.match(/disabled=""[^>]*>(Crear paquetes y ver vista previa|Programar)</g)).toHaveLength(2);
  });

  it("sin lotes al barrer lo dice y no ofrece programar", () => {
    const h = html(createElement(DialogoProgramarBarrer, { embarque: embarque0270301({ asignaciones: [especifica()] }), onAplicado: noop, onCerrar: noop }));
    expect(h).toContain("no tiene lotes al barrer asignados");
    expect(h).not.toContain("Agregar otra tanda");
  });

  it("«Mover a paquete» deja editar las unidades de cada asignación (todas por defecto) y no pide motivo si no cambia de mes", () => {
    const l = loteBeta();
    const h = html(createElement(DialogoAPaquete, { embarque: embarque0270301({ paquetes: [paquete("b0a50000-0000-4000-8000-0000000000a1")] }), asignaciones: [l], onAplicado: noop, onCerrar: noop }));
    for (const t of ["Mover a paquete", "Unidades de cada asignación que se mueven", 'value="600"', "de 600 u", "Se mueven 600 u.", "No cambia ningún mes", "Sin paquete", "hereda del embarque"]) expect(h, t).toContain(t);
    expect(h).not.toContain("Motivo *");
  });

  it("«Mover a paquete» a un paquete con ingreso propio en otro mes pide la vista previa, motivo y causa", () => {
    // El diálogo arranca en «Sin paquete»; con el paquete de abril elegido (estado local) cambia de mes. Aquí se comprueba la regla pura y el texto fijo.
    const l = loteBeta();
    const p = paquete("b0a50000-0000-4000-8000-0000000000a1", { periodo_ingreso: "2027-04", ingreso_propio: true, fecha_ingreso: "2027-04-04" });
    expect(cambiaDeMes([{ id: l.id, unidades: 300 }], [l], p.periodo_ingreso as string, p.id)).toBe(true);
    const h = html(createElement(DialogoAPaquete, { embarque: embarque0270301({ paquetes: [p] }), asignaciones: [l], onAplicado: noop, onCerrar: noop }));
    expect(h).toContain("ingreso propio 04/04/2027");
  });
});

describe("estático: el diálogo de programar habla solo con /api", () => {
  const src = fuente("src/components/compras/agrupadores/dialogo-programar-barrer.tsx");
  it("crea el paquete, fija su ingreso, previsualiza y mueve con la huella; nunca toca Supabase", () => {
    expect(src).toContain("crearPaquete(");
    expect(src).toContain("fijarIngresoPaquete(");
    expect(src).toMatch(/moverAPaquete\([^)]*true\)/);
    expect(src).toMatch(/huella_plan: plan\.huella_plan/);
    expect(src).not.toMatch(/supabase/i);
    // Errores: nunca se tragan (cada fallo llama a `fallar`, que los muestra) y las relecturas pasan por `pideRelectura`.
    expect(src).toContain("pideRelectura(");
    expect(src).toContain("textoErrorBarrer(");
  });
  it("accesibilidad: la suma se anuncia y cada campo de unidades tiene nombre", () => {
    expect(src).toContain('aria-live="polite"');
    expect(src).toMatch(/aria-label=\{`Unidades de /);
    expect(src).toContain("aria-required");
  });
});
