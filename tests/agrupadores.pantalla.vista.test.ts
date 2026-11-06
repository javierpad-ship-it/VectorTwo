import { describe, expect, it } from "vitest";
import { importarAgrupadoresSchema } from "../src/lib/compras/agrupadores/esquemas";
import { COLUMNAS_IMPORTAR_AGRUPADORES, MOTIVOS_OMISION_AGRUPADOR } from "../src/lib/compras/agrupadores/tipos";
import type { EmbarqueApi, ViajeApi } from "../src/lib/compras/agrupadores/tipos-api";
import { detectarMapeo, mapeoCompleto } from "../src/components/importador/mapeo";
import {
  consultaAgrupadores,
  errorUnidades,
  esMio,
  etiquetaViaje,
  filtrarEmbarques,
  filtrarViajes,
  leerParametrosAgrupadores,
  mioEfectivo,
  ordenarEmbarques,
  ordenarViajes,
  PARAMETROS_AGRUPADORES_VACIOS,
  parsearViajeActivo,
  puedeCerrarOCancelar,
  resumenPlan,
  salidaDespuesDeLlegada,
  sugerirCodigo,
  textoCostoMonedas,
  textoFecha,
  textoResponsable,
  viajeActivoEfectivo,
  viajeParaApi,
  viajesParaSelector,
} from "../src/components/compras/agrupadores/vista-agrupadores";
import {
  armarFilasImportacion,
  CAMPOS_AGRUPADORES,
  confirmarAplicarAgrupadores,
  ENCABEZADOS_PLANTILLA_AGRUPADORES,
  ETIQUETA_MOTIVO_OMISION_AGRUPADOR,
  FILAS_EJEMPLO_AGRUPADORES,
  textoCreaciones,
} from "../src/components/compras/agrupadores/vista-importar-agrupadores";
import { hojaAgrupadores, hojaAsignaciones, hojaEmbarques, hojaPaquetes, hojaViajes } from "../src/components/compras/agrupadores/hojas-agrupadores";
import { pideRelectura, textoErrorAccion } from "../src/components/compras/agrupadores/vista-errores";
import {
  archivoAgrupadores19b,
  embarqueApi261101,
  embarqueDetalleApi261101,
  EMBARQUE_AGR,
  PERFIL_AGR,
  planCaso3,
  reporteCaso19bPrevisualizar,
  VIAJE_AGR,
  viajeApi261001,
} from "./agrupadores.fixture";

/** Lógica pura de las pantallas de agrupadores (08b-1, T3a), con los casos sintéticos de T0. */

const params = (q: Record<string, string>) => leerParametrosAgrupadores((k) => q[k] ?? null);
const viaje = (op: Partial<ViajeApi>): ViajeApi => ({ ...viajeApi261001(), ...op });
const embarque = (op: Partial<EmbarqueApi>): EmbarqueApi => ({ ...embarqueApi261101(), ...op });
const OTRO = "b0a10000-0000-4000-8000-0000000000ff";

describe("parámetros de la URL", () => {
  it("por defecto: pestaña Embarques, sin filtros; un valor desconocido se ignora", () => {
    expect(params({})).toEqual(PARAMETROS_AGRUPADORES_VACIOS);
    expect(params({ pestana: "otra", estado: "zzz", tipo: "x", embarque: "no-uuid", desde: "2026-13" })).toEqual(PARAMETROS_AGRUPADORES_VACIOS);
  });

  it("viaja a la URL y vuelve igual (ida y vuelta), sin escribir lo que es el valor por defecto", () => {
    const p = {
      ...PARAMETROS_AGRUPADORES_VACIOS,
      pestana: "viajes" as const,
      viaje: VIAJE_AGR.v261001,
      mio: false,
      estadoViaje: "cerrado" as const,
      q: "feria",
      desde: "2026-11",
      hasta: "2026-12",
    };
    const q = consultaAgrupadores(p);
    expect(q).toContain("pestana=viajes");
    expect(q).toContain("mio=0");
    expect(consultaAgrupadores(PARAMETROS_AGRUPADORES_VACIOS)).toBe("");
    const volver = (s: string) => leerParametrosAgrupadores((k) => new URLSearchParams(s).get(k));
    expect(volver(q)).toEqual(p);
  });

  it("un rango de meses al revés se ignora entero (la API lo rechazaría con 400)", () => {
    const p = params({ desde: "2026-12", hasta: "2026-11" });
    expect(p.desde).toBeNull();
    expect(p.hasta).toBeNull();
  });

  it("«Mis»: explícito manda; sin valor, solo el comprador responsable de alguno abre en «Mis» (es un filtro, no un permiso)", () => {
    expect(params({ mio: "1" }).mio).toBe(true);
    expect(params({ mio: "0" }).mio).toBe(false);
    expect(mioEfectivo(null, "comprador", true)).toBe(true);
    expect(mioEfectivo(null, "comprador", false)).toBe(false);
    expect(mioEfectivo(null, "admin", true)).toBe(false);
    expect(mioEfectivo(null, "planner", true)).toBe(false);
    expect(mioEfectivo(false, "comprador", true)).toBe(false);
    expect(mioEfectivo(true, "admin", false)).toBe(true);
  });
});

describe("viaje activo (§3.8)", () => {
  it("la cookie solo vale si es un uuid, «todos» o «sin_viaje»: una basura se trata como ausente (R22)", () => {
    expect(parsearViajeActivo(VIAJE_AGR.v261001)).toBe(VIAJE_AGR.v261001);
    expect(parsearViajeActivo("todos")).toBe("todos");
    expect(parsearViajeActivo("sin_viaje")).toBe("sin_viaje");
    for (const basura of ["", "xxx", "<script>", "../../etc", "TODOS ", "1; drop table", undefined, null]) expect(parsearViajeActivo(basura as string | null | undefined), String(basura)).toBeNull();
  });

  it("con un viaje existente y no cancelado se respeta lo guardado", () => {
    expect(viajeActivoEfectivo(VIAJE_AGR.v261001, [viaje({})], PERFIL_AGR.c2)).toBe(VIAJE_AGR.v261001);
    expect(viajeActivoEfectivo("sin_viaje", [], PERFIL_AGR.c1)).toBe("sin_viaje");
    expect(viajeActivoEfectivo("todos", [viaje({})], PERFIL_AGR.c1)).toBe("todos");
  });

  it("un viaje cancelado o que ya no existe se descarta y se usa el valor por defecto", () => {
    expect(viajeActivoEfectivo(VIAJE_AGR.v261001, [viaje({ estado: "cancelado" })], PERFIL_AGR.c2)).toBe("todos");
    expect(viajeActivoEfectivo(OTRO, [viaje({})], PERFIL_AGR.c2)).toBe("todos");
  });

  it("por defecto: el último viaje ABIERTO (por fecha de inicio) del que es responsable; si no tiene, «todos»", () => {
    const viejo = viaje({ id: OTRO, fecha_inicio: "2026-06-01" });
    const cerrado = viaje({ id: "b0a30000-0000-4000-8000-0000000000aa", fecha_inicio: "2026-12-01", estado: "cerrado" });
    const mioReciente = viaje({ fecha_inicio: "2026-10-05" });
    expect(viajeActivoEfectivo(null, [viejo, cerrado, mioReciente], PERFIL_AGR.c1)).toBe(VIAJE_AGR.v261001);
    expect(viajeActivoEfectivo(null, [cerrado], PERFIL_AGR.c1)).toBe("todos");
    expect(viajeActivoEfectivo(null, [mioReciente], PERFIL_AGR.c2)).toBe("todos");
    expect(viajeActivoEfectivo(null, null, PERFIL_AGR.c1)).toBe("todos");
  });

  it("sin la lista de viajes se confía en lo guardado; «todos» no manda `viaje_id` a la API", () => {
    expect(viajeActivoEfectivo(VIAJE_AGR.v261001, null, PERFIL_AGR.c1)).toBe(VIAJE_AGR.v261001);
    expect(viajeParaApi("todos")).toBeUndefined();
    expect(viajeParaApi("sin_viaje")).toBe("sin_viaje");
    expect(viajeParaApi(VIAJE_AGR.v261001)).toBe(VIAJE_AGR.v261001);
  });

  it("en los selectores: abiertos primero, cerrados al final y marcados, cancelados fuera", () => {
    const a = viaje({ id: "a", estado: "abierto", fecha_inicio: "2026-01-01" });
    const b = viaje({ id: "b", estado: "cerrado", fecha_inicio: "2026-12-01" });
    const c = viaje({ id: "c", estado: "cancelado", fecha_inicio: "2026-11-01" });
    const d = viaje({ id: "d", estado: "abierto", fecha_inicio: "2026-05-01" });
    expect(viajesParaSelector([a, b, c, d]).map((v) => v.id)).toEqual(["d", "a", "b"]);
    expect(etiquetaViaje(b)).toBe("261001 · Feria Sur · oct-2026 (cerrado)");
    expect(etiquetaViaje(a)).toBe("261001 · Feria Sur · oct-2026");
  });
});

describe("filtros de las listas", () => {
  const e1 = embarque({});
  const e2 = embarque({ id: EMBARQUE_AGR.e261201, codigo: "261201", nombre: "Dic-26", fecha_llegada_estimada: "2026-12-10", responsable_efectivo: { perfil_id: PERFIL_AGR.c2, nombre: "Comprador C2", origen: "propio" }, puerto_embarque: null });
  const e3 = embarque({ id: EMBARQUE_AGR.e270301, codigo: "270301", nombre: "Mar-27", fecha_llegada_estimada: "2027-03-15", viaje: null, responsable_efectivo: null, puerto_embarque: null });

  it("«Mis embarques» filtra por el responsable EFECTIVO (el heredado también cuenta); sin responsable no es de nadie", () => {
    expect(esMio(e1.responsable_efectivo, PERFIL_AGR.c1)).toBe(true);
    const mis = filtrarEmbarques([e1, e2, e3], PARAMETROS_AGRUPADORES_VACIOS, PERFIL_AGR.c1, true);
    expect(mis.map((e) => e.codigo)).toEqual(["261101"]);
    expect(filtrarEmbarques([e1, e2, e3], PARAMETROS_AGRUPADORES_VACIOS, PERFIL_AGR.c1, false)).toHaveLength(3);
  });

  it("el texto busca sin distinguir mayúsculas ni acentos, también en el puerto y el proveedor", () => {
    const f = (q: string) => filtrarEmbarques([e1, e2, e3], { ...PARAMETROS_AGRUPADORES_VACIOS, q }, PERFIL_AGR.c1, false).map((e) => e.codigo);
    expect(f("puerto sur")).toEqual(["261101"]);
    expect(f("FERIA")).toEqual(["261101", "261201", "270301"]);
    expect(f("mar-27")).toEqual(["270301"]);
    expect(f("zzz")).toEqual([]);
  });

  it("los embarques se ordenan por llegada y los viajes, abiertos primero", () => {
    expect(ordenarEmbarques([e3, e2, e1]).map((e) => e.codigo)).toEqual(["261101", "261201", "270301"]);
    const vs = [viaje({ id: "1", estado: "cancelado" }), viaje({ id: "2", estado: "cerrado" }), viaje({ id: "3", estado: "abierto" })];
    expect(ordenarViajes(vs).map((v) => v.id)).toEqual(["3", "2", "1"]);
  });

  it("filtrar viajes: estado, «Mis viajes» y texto", () => {
    const v1 = viaje({});
    const v2 = viaje({ id: OTRO, codigo: "261301", nombre: "Taller Lima", estado: "cerrado", responsable: { perfil_id: PERFIL_AGR.c2, nombre: "Comprador C2" } });
    expect(filtrarViajes([v1, v2], { ...PARAMETROS_AGRUPADORES_VACIOS, estadoViaje: "cerrado" }, PERFIL_AGR.c1, false)).toEqual([v2]);
    expect(filtrarViajes([v1, v2], PARAMETROS_AGRUPADORES_VACIOS, PERFIL_AGR.c2, true)).toEqual([v2]);
    expect(filtrarViajes([v1, v2], { ...PARAMETROS_AGRUPADORES_VACIOS, q: "lima" }, PERFIL_AGR.c1, false)).toEqual([v2]);
  });
});

describe("permisos que solo ocultan botones (la API manda)", () => {
  it("cerrar, reabrir y cancelar: solo admin y planner; el comprador escribe todo lo demás", () => {
    expect(puedeCerrarOCancelar("admin")).toBe(true);
    expect(puedeCerrarOCancelar("planner")).toBe(true);
    expect(puedeCerrarOCancelar("comprador")).toBe(false);
  });
});

describe("códigos propuestos aamm## (§2.2, R14)", () => {
  it("caso 6: con 261101 y 261102 ya creados, el siguiente que llega en nov-26 es 261103", () => {
    expect(sugerirCodigo("2026-11-20", ["261101", "261102"])).toBe("261103");
    expect(sugerirCodigo("2026-11-20", [])).toBe("261101");
  });

  it("un hueco no se rellena, otro mes no cuenta y un código a mano con otro formato se ignora", () => {
    expect(sugerirCodigo("2026-11-20", ["261101", "261105"])).toBe("261106");
    expect(sugerirCodigo("2026-12-01", ["261101", "261102"])).toBe("261201");
    expect(sugerirCodigo("2026-11-20", ["EXPRESS-1", "ABC", "2611"])).toBe("261101");
  });

  it("con el 99 ya usado no propone nada (hay que escribirlo a mano); una fecha inválida tampoco", () => {
    expect(sugerirCodigo("2026-11-20", ["261199"])).toBeNull();
    expect(sugerirCodigo("", ["261101"])).toBeNull();
    expect(sugerirCodigo("2026-13-01", [])).toBeNull();
  });
});

describe("textos", () => {
  it("costo por moneda sin mezclar; sin costo, raya", () => {
    expect(textoCostoMonedas({ PEN: 0, USD: 41500 })).toBe("US$ 41,500.00");
    expect(textoCostoMonedas({ PEN: 9000, USD: 11400 })).toBe("S/ 9,000.00 · US$ 11,400.00");
    expect(textoCostoMonedas({ PEN: 0, USD: 0 })).toBe("—");
  });

  it("fechas del servidor a dd/mm/aaaa", () => {
    expect(textoFecha("2026-11-20")).toBe("20/11/2026");
    expect(textoFecha(null)).toBe("—");
    expect(textoFecha("2026-11")).toBe("—");
  });

  it("responsable: propio, heredado del viaje o del embarque, y sin responsable", () => {
    expect(textoResponsable({ perfil_id: PERFIL_AGR.c2, nombre: "Comprador C2", origen: "propio" })).toEqual({ nombre: "Comprador C2", heredado: null });
    expect(textoResponsable({ perfil_id: PERFIL_AGR.c1, nombre: "Comprador C1", origen: "viaje" }).heredado).toBe("Heredado del viaje");
    expect(textoResponsable({ perfil_id: PERFIL_AGR.c1, nombre: "Comprador C1", origen: "embarque" }).heredado).toBe("Heredado del embarque");
    expect(textoResponsable(null)).toEqual({ nombre: "Sin responsable", heredado: null });
  });

  it("caso 3: la vista previa de cambiar la llegada dice qué mueve y de qué mes a cuál", () => {
    expect(resumenPlan(planCaso3())).toBe("Mueve 1 línea de 1 compra de nov-26 a dic-26 (300 u).");
  });

  it("si el mes no cambia, la vista previa dice que solo cambia el embarque (R5)", () => {
    expect(resumenPlan({ ...planCaso3(), movimientos: [], lineas: 0, compras_afectadas: 0, unidades_movidas: 0 })).toContain("no cambian el mes");
  });

  it("asignar, quitar y pasar pendientes tienen su frase", () => {
    const p = planCaso3();
    expect(resumenPlan({ ...p, operacion: "asignar" })).toContain("Asigna 300 u");
    expect(resumenPlan({ ...p, operacion: "quitar", movimientos: [] })).toContain("quedan sin embarque en el mismo mes");
    expect(resumenPlan({ ...p, operacion: "pasar_pendientes" })).toContain("pendientes");
  });

  it("unidades a asignar: entero positivo y no más de lo que queda sin asignar («Solo hay 120 u…»)", () => {
    expect(errorUnidades("100", 120)).toBeNull();
    expect(errorUnidades("120", 120)).toBeNull();
    expect(errorUnidades("121", 120)).toBe("Solo hay 120 u sin asignar en esta entrega.");
    for (const malo of ["", "0", "-5", "1.5", "abc", " "]) expect(errorUnidades(malo, 120), malo).toMatch(/entero mayor que cero/);
  });

  it("la salida no puede ser posterior a la llegada", () => {
    expect(salidaDespuesDeLlegada("2026-11-21", "2026-11-20")).toBe(true);
    expect(salidaDespuesDeLlegada("2026-11-20", "2026-11-20")).toBe(false);
    expect(salidaDespuesDeLlegada("", "2026-11-20")).toBe(false);
  });
});

describe("errores de la API", () => {
  it("se muestra el mensaje del servidor; si solo trae «Error 409», el texto del código de negocio", () => {
    expect(textoErrorAccion({ mensaje: "Ya existe uno con ese código.", codigo: "codigo_duplicado" })).toBe("Ya existe uno con ese código.");
    expect(textoErrorAccion({ mensaje: "Error 409", codigo: "local_con_viaje" })).toBe("Un embarque local no lleva viaje.");
    expect(textoErrorAccion({ mensaje: "Error 500", codigo: null })).toBe("Error 500");
  });

  it("agrupador_cambio, compra_cambio y plan_cambio piden releer antes de reintentar", () => {
    for (const c of ["agrupador_cambio", "compra_cambio", "plan_cambio"]) expect(pideRelectura(c)).toBe(true);
    for (const c of ["codigo_duplicado", "excede_entrega", null]) expect(pideRelectura(c)).toBe(false);
  });
});

describe("importador de agrupadores: plantilla, mapeo y filas", () => {
  it("los encabezados de la plantilla son los del contrato, en su orden", () => {
    expect(ENCABEZADOS_PLANTILLA_AGRUPADORES).toEqual(COLUMNAS_IMPORTAR_AGRUPADORES.map((c) => c.encabezado));
    expect(ENCABEZADOS_PLANTILLA_AGRUPADORES).toHaveLength(19);
  });

  it("la plantilla trae una fila de ejemplo de cada tipo, todas del ancho de la cabecera y con el código escrito", () => {
    expect(FILAS_EJEMPLO_AGRUPADORES.map((f) => f[0])).toEqual(["VIAJE", "EMBARQUE", "PAQUETE"]);
    for (const f of FILAS_EJEMPLO_AGRUPADORES) {
      expect(f).toHaveLength(ENCABEZADOS_PLANTILLA_AGRUPADORES.length);
      expect(f[1]).not.toBe("");
    }
  });

  it("los 19 encabezados se autodetectan y el mapeo queda completo; sin TIPO o sin NOMBRE no lo está", () => {
    const m = detectarMapeo(ENCABEZADOS_PLANTILLA_AGRUPADORES, CAMPOS_AGRUPADORES);
    for (const c of COLUMNAS_IMPORTAR_AGRUPADORES) expect(m[c.clave], c.clave).toBe(c.encabezado);
    expect(mapeoCompleto(m, CAMPOS_AGRUPADORES)).toBe(true);
    expect(mapeoCompleto({ ...m, tipo: "" }, CAMPOS_AGRUPADORES)).toBe(false);
    expect(mapeoCompleto({ ...m, nombre: "" }, CAMPOS_AGRUPADORES)).toBe(false);
    expect(mapeoCompleto({ ...m, responsable: "", puerto: "" }, CAMPOS_AGRUPADORES)).toBe(true);
  });

  it("las filas que viajan pasan el esquema del servidor: número de fila de la hoja (cabecera = 1) y claves exactas", () => {
    const archivo = {
      nombre: "agrupadores.csv",
      tamano: 100,
      columnas: ENCABEZADOS_PLANTILLA_AGRUPADORES,
      filas: [
        ...archivoAgrupadores19b().map((f) => Object.fromEntries(COLUMNAS_IMPORTAR_AGRUPADORES.map((c) => [c.encabezado, String((f as Record<string, unknown>)[c.clave] ?? "")]))),
        Object.fromEntries(ENCABEZADOS_PLANTILLA_AGRUPADORES.map((h) => [h, ""])),
      ],
      hojas: [],
      hoja: null,
    };
    const filas = armarFilasImportacion(archivo, detectarMapeo(ENCABEZADOS_PLANTILLA_AGRUPADORES, CAMPOS_AGRUPADORES));
    expect(filas).toHaveLength(9); // la fila vacía del final no se envía
    expect(filas[0].fila).toBe(2);
    expect(filas[8].fila).toBe(10);
    const r = importarAgrupadoresSchema.safeParse({ modo: "previsualizar", archivo_nombre: archivo.nombre, filas });
    expect(r.success, JSON.stringify(r.success ? "" : r.error.issues)).toBe(true);
  });

  it("toda omisión del contrato tiene su etiqueta en castellano", () => {
    for (const m of MOTIVOS_OMISION_AGRUPADOR) expect(ETIQUETA_MOTIVO_OMISION_AGRUPADOR[m], m).toBeTruthy();
  });

  it("el confirm dice cuántos viajes, embarques y paquetes se crean (caso 19b: 2, 3 y 4)", () => {
    const r = reporteCaso19bPrevisualizar();
    expect(textoCreaciones(r)).toBe("2 viajes, 3 embarques y 4 paquetes");
    const t = confirmarAplicarAgrupadores("agrupadores.csv", r);
    expect(t).toContain("Se crearán 2 viajes, 3 embarques y 4 paquetes");
    expect(t).toContain("todo junto o nada");
    expect(t).not.toContain("Quedarán fuera");
    expect(confirmarAplicarAgrupadores("a.csv", { ...r, resumen: { ...r.resumen, omitidas: 2, cambiadas: 1 } })).toContain("Quedarán fuera 3 filas");
  });

  it("sin nada nuevo, el texto dice «nada»; con un solo tipo, no lleva «y»", () => {
    const r = reporteCaso19bPrevisualizar();
    const cero = { nuevas: 0, iguales: 0, cambiadas: 0, omitidas: 0 };
    expect(textoCreaciones({ resumen: { ...r.resumen, por_tipo: { viaje: cero, embarque: cero, paquete: cero } } })).toBe("nada");
    expect(textoCreaciones({ resumen: { ...r.resumen, por_tipo: { viaje: { ...cero, nuevas: 1 }, embarque: cero, paquete: cero } } })).toBe("1 viaje");
  });
});

describe("Excel: hojas de Viajes y embarques", () => {
  it("la hoja AGRUPADORES lleva las columnas de la plantilla, viajes, embarques y paquetes, y los responsables como correo", () => {
    const asignables = [
      { perfil_id: PERFIL_AGR.c1, nombre: "Comprador C1", email: "c1@ejemplo.com", rol: "comprador" as const },
      { perfil_id: PERFIL_AGR.c2, nombre: "Comprador C2", email: "c2@ejemplo.com", rol: "comprador" as const },
    ];
    const h = hojaAgrupadores([viajeApi261001()], [embarqueDetalleApi261101()], asignables);
    expect(h[0]).toEqual(ENCABEZADOS_PLANTILLA_AGRUPADORES);
    expect(h.map((f) => f[0])).toEqual(["TIPO", "VIAJE", "EMBARQUE", "PAQUETE", "PAQUETE"]);
    const col = (n: string) => ENCABEZADOS_PLANTILLA_AGRUPADORES.indexOf(n);
    expect(h[1][col("CODIGO")]).toBe("261001");
    expect(h[1][col("RESPONSABLE")]).toBe("c1@ejemplo.com");
    expect(h[2][col("VIAJE")]).toBe("261001");
    expect(h[2][col("FECHA_INGRESO_CD")]).toBe("2026-11-20");
    expect(h[2][col("PUERTO")]).toBe("Puerto Sur");
    // El embarque hereda a C1 del viaje: sale vacío para que al reimportar siga heredando.
    expect(h[2][col("RESPONSABLE")]).toBe("");
    // El paquete 261101 es de C2 (propio); el 261102 hereda.
    expect(h[3][col("RESPONSABLE")]).toBe("c2@ejemplo.com");
    expect(h[4][col("RESPONSABLE")]).toBe("");
    expect(h[3][col("EMBARQUE")]).toBe("261101");
  });

  it("EMBARQUES, PAQUETES, ASIGNACIONES y VIAJES traen su cabecera y una fila por registro", () => {
    expect(hojaEmbarques([embarqueApi261101()])).toHaveLength(2);
    expect(hojaViajes([viajeApi261001()])).toHaveLength(2);
    expect(hojaPaquetes([embarqueDetalleApi261101()])).toHaveLength(3);
    const asig = hojaAsignaciones([embarqueDetalleApi261101()]);
    expect(asig).toHaveLength(2);
    expect(asig[1][0]).toBe("261101");
    expect(asig[1][1]).toBe("261101"); // el paquete
    expect(asig[1][2]).toBe("C-000101");
    expect(asig[1][asig[0].indexOf("UNIDADES")]).toBe(300);
  });
});
