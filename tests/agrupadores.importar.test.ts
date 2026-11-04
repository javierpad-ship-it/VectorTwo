import { describe, expect, it } from "vitest";
import type { FilaAgrupador } from "@/lib/compras/agrupadores/esquemas";
import { hojaAgrupadores, hojaAsignaciones, hojaEmbarques, hojaPaquetes, hojaViajes, hojasEmbarques, hojasViajes } from "@/lib/compras/agrupadores/excel";
import {
  argsImportarAgrupadores,
  evaluarAgrupadoresDeFilaCompra,
  leerFechaAgrupador,
  loteVacio,
  previsualizarImportacionAgrupadores,
  reporteAplicado,
  simularAplicacionLote,
  sinAgrupadorEnFila,
  type CatalogoAgrupadoresCompra,
  type EntradaAgrupadoresFilaCompra,
  type EstadoImportacionAgrupadores,
  type PerfilConCorreo,
} from "@/lib/compras/agrupadores/importar";
import { ENCABEZADOS_AGRUPADORES, FILAS_EJEMPLO_AGRUPADORES, filaDeAgrupador, plantillaAgrupadores } from "@/lib/compras/agrupadores/plantilla";
import { COLUMNAS_IMPORTAR_AGRUPADORES, MOTIVOS_OMISION_AGRUPADOR } from "@/lib/compras/agrupadores/tipos";
import {
  ACTOR_C1,
  CORREO_PERFIL_AGR,
  EMBARQUE_AGR,
  PAQUETE_AGR,
  PERFIL_AGR,
  VIAJE_AGR,
  archivoAgrupadores19b,
  archivoAgrupadores19c,
  asignacionApiL1Nov,
  embarqueApi261101,
  embarqueDetalleApi261101,
  embarquesAgrupadores,
  paquetesAgrupadores,
  perfilesAgrupadores,
  viajeApi261001,
  viaje261001,
} from "./agrupadores.fixture";

/** R21 (columnas VIAJE, EMBARQUE y PAQUETE del importador de compras; casos 12 a 15) y R25 (importador de agrupadores; casos 19b y 19c). */

const correo = (id: string): string => Object.values(CORREO_PERFIL_AGR)[Object.values(PERFIL_AGR).indexOf(id)];
const perfiles: PerfilConCorreo[] = perfilesAgrupadores().map((p) => ({ ...p, email: correo(p.id) }));

const estado = (cambios: Partial<EstadoImportacionAgrupadores> = {}): EstadoImportacionAgrupadores => ({
  viajes: [viaje261001()],
  embarques: embarquesAgrupadores(),
  paquetes: paquetesAgrupadores(),
  perfiles,
  ...cambios,
});

const previsualizar = (filas: FilaAgrupador[], e = estado()) => previsualizarImportacionAgrupadores(filas, e, { archivo_nombre: "agrupadores.csv" });
const fila = (n: number, p: Omit<FilaAgrupador, "fila" | "tipo"> & { tipo?: string }): FilaAgrupador => ({ fila: n, tipo: "VIAJE", ...p });
const motivos = (r: ReturnType<typeof previsualizar>) => r.reporte.filas.map((f) => [f.fila, f.clasificacion, f.motivo ?? null]);
const unica = (r: ReturnType<typeof previsualizar>) => r.reporte.filas[0];

const viajeOk = (n: number, p: Partial<FilaAgrupador> = {}): FilaAgrupador => ({ fila: n, tipo: "VIAJE", codigo: "270101", nombre: "Viaje de prueba", fecha_inicio: "2027-01-05", responsable: CORREO_PERFIL_AGR.c1, ...p });
const embarqueOk = (n: number, p: Partial<FilaAgrupador> = {}): FilaAgrupador => ({ fila: n, tipo: "EMBARQUE", codigo: "270102", nombre: "Embarque de prueba", fecha_llegada: "2027-01-20", ...p });
const paqueteOk = (n: number, p: Partial<FilaAgrupador> = {}): FilaAgrupador => ({ fila: n, tipo: "PAQUETE", codigo: "270103", nombre: "Paquete de prueba", embarque: "261101", ...p });

// ─── Lectura de fechas ───

describe("fechas del archivo", () => {
  it("aaaa-mm-dd, dd/mm/aaaa y el número de serie de Excel", () => {
    expect(leerFechaAgrupador("2026-11-20")).toBe("2026-11-20");
    expect(leerFechaAgrupador("20/11/2026")).toBe("2026-11-20");
    expect(leerFechaAgrupador("46345")).toBe("2026-11-19");
    expect(leerFechaAgrupador("")).toBeNull();
    expect(leerFechaAgrupador("2026-02-30")).toBe("invalida");
    expect(leerFechaAgrupador("mañana")).toBe("invalida");
    expect(leerFechaAgrupador("1999-01-01")).toBe("invalida");
  });
});

// ─── Caso 19b ───

describe("caso 19b: 2 viajes, 3 embarques y 4 paquetes en una hoja", () => {
  it("previsualizar: 9 nuevas; la del viaje sin código «se numera al aplicar»", () => {
    const r = previsualizar(archivoAgrupadores19b());
    expect(r.reporte.modo).toBe("previsualizar");
    expect(r.reporte.resumen).toEqual({
      nuevas: 9,
      iguales: 0,
      cambiadas: 0,
      omitidas: 0,
      por_tipo: {
        viaje: { nuevas: 2, iguales: 0, cambiadas: 0, omitidas: 0 },
        embarque: { nuevas: 3, iguales: 0, cambiadas: 0, omitidas: 0 },
        paquete: { nuevas: 4, iguales: 0, cambiadas: 0, omitidas: 0 },
      },
    });
    expect(r.reporte.filas.map((f) => f.codigo_final)).toEqual(["261201", null, "261301", "261302", "261303", "261301", null, "261302", "261303"]);
    expect(r.reporte.filas.map((f) => f.clasificacion)).toEqual(Array(9).fill("nueva"));
    expect(r.reporte.filas[1].clave).toBe("viaje|PROVEEDOR NORTE · ENE-2027|2027-01-10");
    expect(r.reporte.filas[0].clave).toBe("viaje|261201");
  });

  it("el lote: viajes, embarques y paquetes con sus referencias (existentes por id, del archivo por código)", () => {
    const { lote } = previsualizar(archivoAgrupadores19b());
    expect(lote.archivo_nombre).toBe("agrupadores.csv");
    expect(lote.viajes.map((v) => [v.fila, v.codigo, v.responsable_id])).toEqual([
      [1, "261201", PERFIL_AGR.c2],
      [2, null, PERFIL_AGR.a],
    ]);
    // 261301 apunta al viaje 261201 DEL ARCHIVO; 261302 al viaje existente 261001; 261303 es local
    expect(lote.embarques.map((e) => [e.codigo, e.viaje_id, e.viaje_codigo, e.tipo])).toEqual([
      ["261301", null, "261201", "importacion"],
      ["261302", VIAJE_AGR.v261001, null, "importacion"],
      ["261303", null, null, "local"],
    ]);
    expect(lote.embarques[0]).toMatchObject({ puerto_embarque: "Puerto Norte", referencia_logistica: "REF-0001", fecha_salida_estimada: "2026-12-20", fecha_llegada_estimada: "2027-01-15", responsable_id: PERFIL_AGR.c1 });
    expect(lote.embarques[1].responsable_id).toBeNull();
    expect(lote.paquetes.map((p) => [p.fila, p.codigo, p.embarque_codigo, p.responsable_id])).toEqual([
      [6, "261301", "261301", PERFIL_AGR.c2],
      [7, null, "261301", null],
      [8, "261302", "261302", null],
      [9, "261303", "261303", null],
    ]);
    expect(lote.paquetes.every((p) => p.embarque_id === null)).toBe(true);
    expect(loteVacio(lote)).toBe(false);
  });

  it("codigos_simulados: el viaje sin código recibe 270101 y el paquete B también 270101 (cada tipo, su numeración)", () => {
    const r = previsualizar(archivoAgrupadores19b());
    expect([...r.codigos_simulados.entries()]).toEqual([
      [2, "270101"],
      [7, "270101"],
    ]);
  });

  it("aplicar: el reporte final lleva los códigos asignados y los creados", () => {
    const r = previsualizar(archivoAgrupadores19b());
    const creados = [
      { tipo: "viaje" as const, fila: 1, id: "v1", codigo: "261201" },
      { tipo: "viaje" as const, fila: 2, id: "v2", codigo: "270101" },
    ];
    const rep = reporteAplicado(r.reporte, creados);
    expect(rep.modo).toBe("aplicar");
    expect(rep.creados).toEqual([
      { tipo: "viaje", id: "v1", codigo: "261201" },
      { tipo: "viaje", id: "v2", codigo: "270101" },
    ]);
    expect(rep.filas[1].codigo_final).toBe("270101");
    expect(rep.resumen).toEqual(r.reporte.resumen);
    expect(argsImportarAgrupadores(r.lote, ACTOR_C1)).toEqual({ p_lote: r.lote, p_actor: ACTOR_C1 });
  });

  it("reimportar el mismo archivo después de aplicar da 9 `igual` y no crea nada (idempotente, también sin código)", () => {
    const primera = previsualizar(archivoAgrupadores19b());
    const despues = simularAplicacionLote(primera.lote, estado(), primera.codigos_simulados);
    const segunda = previsualizar(archivoAgrupadores19b(), despues);
    expect(segunda.reporte.resumen).toMatchObject({ nuevas: 0, iguales: 9, cambiadas: 0, omitidas: 0 });
    expect(segunda.reporte.filas.map((f) => f.clasificacion)).toEqual(Array(9).fill("igual"));
    expect(loteVacio(segunda.lote)).toBe(true);
    // los códigos asignados al aplicar salen en el reporte de lo que ya existe
    expect(segunda.reporte.filas[1].codigo_final).toBe("270101");
    expect(segunda.reporte.filas[6].codigo_final).toBe("270101");
  });

  it("no depende del orden de las filas: un paquete antes que su embarque y un embarque antes que su viaje", () => {
    const invertido = [...archivoAgrupadores19b()].reverse();
    const r = previsualizar(invertido);
    expect(r.reporte.resumen).toMatchObject({ nuevas: 9, omitidas: 0 });
    expect(r.lote.viajes.map((v) => v.fila)).toEqual([1, 2]);
    expect(r.lote.embarques.find((e) => e.codigo === "261301")?.viaje_codigo).toBe("261201");
    // las filas del reporte salen en el orden del archivo
    expect(r.reporte.filas.map((f) => f.fila)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});

// ─── Caso 19c ───

describe("caso 19c: el mismo archivo con un cambio, una referencia sin código y un responsable planner", () => {
  it("cambiada_requiere_edicion con la diferencia; referencia_sin_codigo; responsable_no_asignable; lo demás, igual", () => {
    const primera = previsualizar(archivoAgrupadores19b());
    const despues = simularAplicacionLote(primera.lote, estado(), primera.codigos_simulados);
    const r = previsualizar(archivoAgrupadores19c(), despues);
    expect(r.reporte.filas.map((f) => [f.fila, f.clasificacion, f.motivo ?? null])).toEqual([
      [1, "igual", null],
      [2, "igual", null],
      [3, "igual", null],
      [4, "cambiada", "cambiada_requiere_edicion"],
      [5, "omitida", "responsable_no_asignable"],
      [6, "igual", null],
      [7, "igual", null],
      [8, "igual", null],
      [9, "igual", null],
      [10, "nueva", null],
      [11, "omitida", "referencia_sin_codigo"],
    ]);
    expect(r.reporte.filas[3].detalle).toBe("fecha_llegada 2027-01-25 → 2027-01-30");
    expect(r.reporte.resumen).toMatchObject({ nuevas: 1, iguales: 7, cambiadas: 1, omitidas: 2 });
    // solo crea lo nuevo: el embarque de la fila 10
    expect(r.lote.viajes).toEqual([]);
    expect(r.lote.embarques.map((e) => e.fila)).toEqual([10]);
    expect(r.lote.paquetes).toEqual([]);
  });
});

// ─── Omisiones de §3.11 ───

describe("R25: omisiones del importador de agrupadores", () => {
  const una = (f: FilaAgrupador, e = estado()) => unica(previsualizar([f], e));
  const motivoDe = (f: FilaAgrupador, e = estado()) => una(f, e).motivo;

  it("tipo_invalido (también TIPO_EMBARQUE) y fila vacía", () => {
    expect(motivoDe(viajeOk(1, { tipo: "VIAJERO" }))).toBe("tipo_invalido");
    expect(motivoDe(embarqueOk(1, { tipo_embarque: "AEREO" }))).toBe("tipo_invalido");
    expect(motivoDe({ fila: 1, tipo: "", nombre: "" })).toBe("tipo_invalido");
    expect(una(viajeOk(1, { tipo: "VIAJERO" })).tipo).toBeNull();
  });

  it("el tipo se lee sin distinguir caja ni acentos", () => {
    expect(una(viajeOk(1, { tipo: " viaje " })).clasificacion).toBe("nueva");
    expect(una(embarqueOk(1, { tipo: "Embarque", tipo_embarque: "local" })).clasificacion).toBe("nueva");
  });

  it("nombre_requerido y nombre_largo", () => {
    expect(motivoDe(viajeOk(1, { nombre: "   " }))).toBe("nombre_requerido");
    expect(motivoDe(viajeOk(1, { nombre: "x".repeat(121) }))).toBe("nombre_largo");
    expect(una(viajeOk(1, { nombre: "x".repeat(120) })).clasificacion).toBe("nueva");
  });

  it("codigo_invalido: letras, números y guiones, hasta 30", () => {
    expect(motivoDe(viajeOk(1, { codigo: "26 11" }))).toBe("codigo_invalido");
    expect(motivoDe(viajeOk(1, { codigo: "A".repeat(31) }))).toBe("codigo_invalido");
    expect(una(viajeOk(1, { codigo: "feria-1" })).codigo_final).toBe("FERIA-1");
  });

  it("campo_largo: destino, puerto, referencia y notas por tipo", () => {
    expect(motivoDe(viajeOk(1, { destino: "x".repeat(121) }))).toBe("campo_largo");
    expect(motivoDe(viajeOk(1, { nota: "x".repeat(501) }))).toBe("campo_largo");
    expect(motivoDe(embarqueOk(1, { puerto: "x".repeat(81) }))).toBe("campo_largo");
    expect(motivoDe(embarqueOk(1, { referencia_logistica: "x".repeat(81) }))).toBe("campo_largo");
    expect(motivoDe(embarqueOk(1, { nota: "x".repeat(501) }))).toBe("campo_largo");
    expect(motivoDe(paqueteOk(1, { nota: "x".repeat(301) }))).toBe("campo_largo");
    expect(una(paqueteOk(1, { nota: "x".repeat(300) })).clasificacion).toBe("nueva");
  });

  it("fechas: fecha_requerida, fecha_invalida, fin_antes_de_inicio, salida_despues_de_llegada, local_con_viaje", () => {
    expect(motivoDe(viajeOk(1, { fecha_inicio: "" }))).toBe("fecha_requerida");
    expect(motivoDe(viajeOk(1, { fecha_inicio: "2027-02-30" }))).toBe("fecha_invalida");
    expect(motivoDe(viajeOk(1, { fecha_fin: "ayer" }))).toBe("fecha_invalida");
    expect(motivoDe(viajeOk(1, { fecha_fin: "2027-01-01" }))).toBe("fin_antes_de_inicio");
    expect(motivoDe(embarqueOk(1, { fecha_llegada: "" }))).toBe("fecha_requerida");
    expect(motivoDe(embarqueOk(1, { fecha_llegada: "2027-13-01" }))).toBe("fecha_invalida");
    expect(motivoDe(embarqueOk(1, { fecha_salida: "2027-01-25" }))).toBe("salida_despues_de_llegada");
    expect(motivoDe(embarqueOk(1, { tipo_embarque: "LOCAL", viaje: "261001" }))).toBe("local_con_viaje");
    expect(una(embarqueOk(1, { fecha_salida: "2027-01-20" })).clasificacion).toBe("nueva");
  });

  it("responsable: requerido en el viaje, desconocido, no asignable (planner, inactivo) y opcional en lo demás", () => {
    expect(motivoDe(viajeOk(1, { responsable: "" }))).toBe("responsable_requerido");
    expect(motivoDe(viajeOk(1, { responsable: "nadie@ejemplo.test" }))).toBe("responsable_desconocido");
    expect(motivoDe(viajeOk(1, { responsable: CORREO_PERFIL_AGR.pl }))).toBe("responsable_no_asignable");
    expect(motivoDe(viajeOk(1, { responsable: CORREO_PERFIL_AGR.c3 }))).toBe("responsable_no_asignable");
    expect(motivoDe(embarqueOk(1, { responsable: CORREO_PERFIL_AGR.pl }))).toBe("responsable_no_asignable");
    expect(una(viajeOk(1, { responsable: CORREO_PERFIL_AGR.a })).clasificacion).toBe("nueva");
    expect(una(viajeOk(1, { responsable: " C1@Ejemplo.TEST " })).clasificacion).toBe("nueva");
    expect(una(embarqueOk(1, { responsable: "" })).clasificacion).toBe("nueva");
  });

  it("viaje_desconocido, viaje_cancelado, embarque_requerido, embarque_desconocido y embarque_no_editable", () => {
    expect(motivoDe(embarqueOk(1, { viaje: "999999" }))).toBe("viaje_desconocido");
    expect(motivoDe(embarqueOk(1, { viaje: "261001" }), estado({ viajes: [viaje261001({ estado: "cancelado" })] }))).toBe("viaje_cancelado");
    expect(motivoDe(paqueteOk(1, { embarque: "" }))).toBe("embarque_requerido");
    expect(motivoDe(paqueteOk(1, { embarque: "999999" }))).toBe("embarque_desconocido");
    const cancelado = estado({ embarques: embarquesAgrupadores().map((e) => (e.codigo === "261101" ? { ...e, estado: "cancelado" as const } : e)) });
    const recibido = estado({ embarques: embarquesAgrupadores().map((e) => (e.codigo === "261101" ? { ...e, estado: "recibido" as const } : e)) });
    expect(motivoDe(paqueteOk(1), cancelado)).toBe("embarque_no_editable");
    expect(motivoDe(paqueteOk(1), recibido)).toBe("embarque_no_editable");
  });

  it("codigo_repetido_en_archivo y fila_repetida: manda la primera fila válida", () => {
    const r = previsualizar([viajeOk(1), viajeOk(2, { nombre: "Otro nombre" })]);
    expect(motivos(r)).toEqual([[1, "nueva", null], [2, "omitida", "codigo_repetido_en_archivo"]]);
    expect(r.reporte.filas[1].detalle).toContain("fila 1");
    const natural = previsualizar([viajeOk(1, { codigo: "" }), viajeOk(2, { codigo: "", nombre: " viaje DE prueba " })]);
    expect(motivos(natural)).toEqual([[1, "nueva", null], [2, "omitida", "fila_repetida"]]);
    // la misma clave natural con otra fecha es otro viaje
    expect(previsualizar([viajeOk(1, { codigo: "" }), viajeOk(2, { codigo: "", fecha_inicio: "2027-02-01" })]).reporte.resumen.nuevas).toBe(2);
    // una fila inválida no bloquea la clave de la siguiente válida
    expect(motivos(previsualizar([viajeOk(1, { fecha_inicio: "" }), viajeOk(2)]))).toEqual([[1, "omitida", "fecha_requerida"], [2, "nueva", null]]);
  });

  it("referencia_sin_codigo y referencia_omitida: solo se refiere por código a una fila del archivo, y que no se omitió", () => {
    // embarque sin código al que un paquete apunta por nombre
    const sinCodigo = previsualizar([embarqueOk(1, { codigo: "", nombre: "Embarque X" }), paqueteOk(2, { embarque: "embarque x" })]);
    expect(motivos(sinCodigo)).toEqual([[1, "nueva", null], [2, "omitida", "referencia_sin_codigo"]]);
    // viaje sin código al que un embarque apunta por nombre
    const viajeSinCodigo = previsualizar([viajeOk(1, { codigo: "", nombre: "Viaje Y" }), embarqueOk(2, { viaje: "Viaje Y" })]);
    expect(motivos(viajeSinCodigo)).toEqual([[1, "nueva", null], [2, "omitida", "referencia_sin_codigo"]]);
    // el embarque con código al que apunta el paquete se omitió
    const omitido = previsualizar([embarqueOk(1, { codigo: "270150", fecha_llegada: "" }), paqueteOk(2, { embarque: "270150" })]);
    expect(motivos(omitido)).toEqual([[1, "omitida", "fecha_requerida"], [2, "omitida", "referencia_omitida"]]);
    // y el que apunta a un viaje omitido: lo mismo
    const viajeOmitido = previsualizar([viajeOk(1, { responsable: "" }), embarqueOk(2, { viaje: "270101" })]);
    expect(motivos(viajeOmitido)).toEqual([[1, "omitida", "responsable_requerido"], [2, "omitida", "referencia_omitida"]]);
  });

  it("un código que ya existe manda sobre el archivo: no es referencia al archivo", () => {
    const r = previsualizar([embarqueOk(1, { viaje: "261001" })]);
    expect(r.lote.embarques[0]).toMatchObject({ viaje_id: VIAJE_AGR.v261001, viaje_codigo: null });
  });

  it("cambiada_requiere_edicion nombra qué difiere (varios campos)", () => {
    const f = fila(1, { tipo: "VIAJE", codigo: "261001", nombre: "Feria Sur · oct-2026", destino: "Otra ciudad", fecha_inicio: "2026-10-05", fecha_fin: "2026-10-12", responsable: CORREO_PERFIL_AGR.c2 });
    const r = previsualizar([f]);
    expect(unica(r)).toMatchObject({ clasificacion: "cambiada", motivo: "cambiada_requiere_edicion", codigo_final: "261001" });
    expect(unica(r).detalle).toBe("destino Ciudad Sur → Otra ciudad; responsable c1@ejemplo.test → c2@ejemplo.test");
    expect(loteVacio(r.lote)).toBe(true); // nunca edita
  });

  it("igual: el mismo contenido de un embarque y de un paquete existentes; no crea nada", () => {
    const e = fila(1, { tipo: "EMBARQUE", codigo: "261101", nombre: "Nov-26 · Feria Sur", viaje: "261001", fecha_salida: "2026-10-25", fecha_llegada: "2026-11-20", puerto: "Puerto Sur" });
    const p = fila(2, { tipo: "PAQUETE", codigo: "261101", nombre: "Paquete denim", embarque: "261101", responsable: CORREO_PERFIL_AGR.c2 });
    const r = previsualizar([e, p]);
    expect(motivos(r)).toEqual([[1, "igual", null], [2, "igual", null]]);
    expect(loteVacio(r.lote)).toBe(true);
  });

  it("la clave natural encuentra lo existente aunque no se escriba el código (y distingue lo que cambió)", () => {
    const p = fila(1, { tipo: "PAQUETE", codigo: "", nombre: "paquete DENIM", embarque: "261101", responsable: CORREO_PERFIL_AGR.c2 });
    expect(unica(previsualizar([p])).clasificacion).toBe("igual");
    expect(unica(previsualizar([{ ...p, responsable: "" }])).clasificacion).toBe("cambiada");
    expect(unica(previsualizar([fila(1, { tipo: "VIAJE", codigo: "", nombre: "feria sur · oct-2026", destino: "Ciudad Sur", fecha_inicio: "2026-10-05", fecha_fin: "2026-10-12", responsable: CORREO_PERFIL_AGR.c1 })])).clasificacion).toBe("igual");
  });

  it("el código escrito reserva su correlativo antes de numerar a los demás; correlativo_agotado con 99", () => {
    // la fila 1 no trae código y la 2 trae 261101: aunque la 1 va antes, no se queda con 261101
    const r = previsualizar([viajeOk(1, { codigo: "", fecha_inicio: "2026-11-03" }), viajeOk(2, { codigo: "261101", fecha_inicio: "2026-11-05", nombre: "Otro" })]);
    expect(r.codigos_simulados.get(1)).toBe("261102");
    expect(r.reporte.filas[1].codigo_final).toBe("261101");
    // dos sin código en el mismo mes salen en orden de fila
    const dos = previsualizar([viajeOk(1, { codigo: "", fecha_inicio: "2026-11-03" }), viajeOk(2, { codigo: "", nombre: "Segundo", fecha_inicio: "2026-11-09" })]);
    expect([...dos.codigos_simulados.values()]).toEqual(["261101", "261102"]);
    // 99 usado
    const agotado = previsualizar([viajeOk(1, { codigo: "", fecha_inicio: "2026-11-03" })], estado({ viajes: [viaje261001(), viaje261001({ id: "v99", codigo: "261199" })] }));
    expect(unica(agotado)).toMatchObject({ clasificacion: "omitida", motivo: "correlativo_agotado" });
    expect(agotado.lote.viajes).toEqual([]);
  });

  it("los paquetes sin código se numeran con el mes de llegada de su embarque (existente o del archivo)", () => {
    const r = previsualizar([
      paqueteOk(1, { codigo: "", nombre: "P existente", embarque: "261101" }),
      embarqueOk(2, { codigo: "270150", fecha_llegada: "2027-03-02" }),
      paqueteOk(3, { codigo: "", nombre: "P nuevo", embarque: "270150" }),
    ]);
    // los paquetes existentes del embarque 261101 son 261101 y 261102 → el siguiente de nov-26 es 261103; el del embarque nuevo es de mar-27
    expect(r.codigos_simulados.get(1)).toBe("261103");
    expect(r.codigos_simulados.get(3)).toBe("270301");
  });

  it("avisos: viaje_cerrado en un embarque de un viaje cerrado; sin_responsable si no hay propio ni heredable", () => {
    const cerrado = estado({ viajes: [viaje261001({ estado: "cerrado" })] });
    expect(una(embarqueOk(1, { viaje: "261001", responsable: "" }), cerrado).avisos).toEqual(["viaje_cerrado"]);
    // el embarque local sin responsable y el que apunta a un viaje con responsable
    expect(una(embarqueOk(1, { tipo_embarque: "LOCAL" })).avisos).toEqual(["sin_responsable"]);
    expect(una(embarqueOk(1, { viaje: "261001" })).avisos).toEqual([]);
    expect(una(embarqueOk(1, { viaje: "261001", responsable: CORREO_PERFIL_AGR.c2 })).avisos).toEqual([]);
    // un viaje sin responsable heredable (cuyo responsable ya no es asignable) deja el embarque faltante
    const viajeSin = estado({ viajes: [viaje261001({ responsable_id: PERFIL_AGR.c3 })] });
    expect(una(embarqueOk(1, { viaje: "261001" }), viajeSin).avisos).toEqual(["sin_responsable"]);
    // paquetes: heredan del embarque y, si no, del viaje de su embarque
    expect(una(paqueteOk(1)).avisos).toEqual([]);
    const sinNada = previsualizar([embarqueOk(1, { codigo: "270150", tipo_embarque: "LOCAL" }), paqueteOk(2, { embarque: "270150", codigo: "270151" })]);
    expect(sinNada.reporte.filas.map((f) => f.avisos)).toEqual([["sin_responsable"], ["sin_responsable"]]);
  });

  it("acepta fechas del archivo como número de serie de Excel o dd/mm/aaaa", () => {
    const r = previsualizar([viajeOk(1, { fecha_inicio: "46345", fecha_fin: "20/12/2026" })]);
    expect(r.lote.viajes[0]).toMatchObject({ fecha_inicio: "2026-11-19", fecha_fin: "2026-12-20" });
  });

  it("solo usa motivos del catálogo de §3.11", () => {
    const filas = [
      viajeOk(1, { tipo: "X" }),
      viajeOk(2, { nombre: "" }),
      viajeOk(3, { responsable: "" }),
      embarqueOk(4, { viaje: "999" }),
      paqueteOk(5, { embarque: "" }),
    ];
    for (const f of previsualizar(filas).reporte.filas) expect(MOTIVOS_OMISION_AGRUPADOR).toContain(f.motivo);
  });

  it("todas las columnas de la plantilla las lee el importador (nada queda sin leer)", () => {
    expect(COLUMNAS_IMPORTAR_AGRUPADORES.map((c) => c.clave).sort()).toEqual(["codigo", "destino", "embarque", "fecha_fin", "fecha_inicio", "fecha_llegada", "fecha_salida", "nombre", "nota", "puerto", "referencia_logistica", "responsable", "tipo", "tipo_embarque", "viaje"].sort());
  });
});

// ─── Plantilla y Excel ───

describe("plantilla del importador de agrupadores", () => {
  it("encabezado de §3.11 y una fila de ejemplo de cada tipo", () => {
    const p = plantillaAgrupadores();
    expect(p.encabezados).toEqual(["TIPO", "CODIGO", "NOMBRE", "VIAJE", "EMBARQUE", "TIPO_EMBARQUE", "DESTINO", "FECHA_INICIO", "FECHA_FIN", "FECHA_SALIDA", "FECHA_LLEGADA", "PUERTO", "REFERENCIA_LOGISTICA", "RESPONSABLE", "NOTA"]);
    expect(p.filas.map((f) => f[0])).toEqual(["VIAJE", "EMBARQUE", "PAQUETE"]);
    expect(p.filas.every((f) => f.length === p.encabezados.length)).toBe(true);
    expect(p.hoja).toEqual([p.encabezados, ...p.filas]);
    expect(ENCABEZADOS_AGRUPADORES).toBe(p.encabezados);
    expect(filaDeAgrupador({ tipo: "VIAJE", nombre: "X" })).toEqual(["VIAJE", "", "X", "", "", "", "", "", "", "", "", "", "", "", ""]);
  });

  it("las filas de ejemplo, leídas como archivo, se importan sin omisiones (con un comprador de ese correo)", () => {
    const comprador: PerfilConCorreo = { id: "11111111-1111-4111-8111-111111111111", nombre: "Comprador Ejemplo", rol: "comprador", activo: true, email: "comprador@ejemplo.com" };
    const filas: FilaAgrupador[] = FILAS_EJEMPLO_AGRUPADORES.map((celdas, i) => {
      const f: Record<string, string | number> = { fila: i + 1 };
      COLUMNAS_IMPORTAR_AGRUPADORES.forEach((c, j) => {
        f[c.clave] = celdas[j];
      });
      return f as unknown as FilaAgrupador;
    });
    const r = previsualizar(filas, estado({ viajes: [], embarques: [], paquetes: [], perfiles: [...perfiles, comprador] }));
    expect(r.reporte.resumen).toMatchObject({ nuevas: 3, omitidas: 0 });
  });
});

describe("exportación a Excel", () => {
  it("la hoja AGRUPADORES lleva las columnas de la plantilla y, subida otra vez, da todo `igual`", () => {
    const hoja = hojaAgrupadores({
      viajes: [viajeApi261001()],
      embarques: [embarqueDetalleApi261101()],
      correoDe: (id) => (perfiles.find((p) => p.id === id)?.email ?? null),
    });
    expect(hoja[0]).toEqual(ENCABEZADOS_AGRUPADORES);
    expect(hoja.map((f) => f[0])).toEqual(["TIPO", "VIAJE", "EMBARQUE", "PAQUETE", "PAQUETE"]);
    const filas = hoja.slice(1).map((celdas, i) => {
      const f: Record<string, string | number> = { fila: i + 1 };
      COLUMNAS_IMPORTAR_AGRUPADORES.forEach((c, j) => {
        f[c.clave] = String(celdas[j] ?? "");
      });
      return f as unknown as FilaAgrupador;
    });
    const r = previsualizar(filas);
    expect(r.reporte.resumen).toMatchObject({ nuevas: 0, iguales: 4, cambiadas: 0, omitidas: 0 });
    expect(r.reporte.filas.map((f) => [f.fila, f.clasificacion])).toEqual([[1, "igual"], [2, "igual"], [3, "igual"], [4, "igual"]]);
  });

  it("los cancelados no salen en AGRUPADORES y el responsable heredado queda vacío", () => {
    const e = embarqueDetalleApi261101();
    const hoja = hojaAgrupadores({
      viajes: [{ ...viajeApi261001(), estado: "cancelado" }],
      embarques: [{ ...e, paquetes: e.paquetes.map((p) => (p.codigo === "261102" ? { ...p, estado: "cancelado" as const } : p)) }],
      correoDe: (id) => (perfiles.find((p) => p.id === id)?.email ?? null),
    });
    expect(hoja.map((f) => f[0])).toEqual(["TIPO", "EMBARQUE", "PAQUETE"]);
    const encabezado = hoja[0] as string[];
    expect(hoja[1][encabezado.indexOf("RESPONSABLE")]).toBe(""); // hereda de C1 por el viaje
    expect(hoja[2][encabezado.indexOf("RESPONSABLE")]).toBe(CORREO_PERFIL_AGR.c2); // propio
  });

  it("las hojas de pantalla: VIAJES, EMBARQUES, PAQUETES y ASIGNACIONES con encabezado y filas de la misma anchura", () => {
    const e = { ...embarqueDetalleApi261101(), asignaciones: [asignacionApiL1Nov()] };
    const hojas = [hojaViajes([viajeApi261001()]), hojaEmbarques([embarqueApi261101()]), hojaPaquetes([e]), hojaAsignaciones([e])];
    for (const h of hojas) {
      expect(h.length).toBeGreaterThan(1);
      for (const fila of h.slice(1)) expect(fila.length).toBe(h[0].length);
    }
    expect(hojaPaquetes([e]).slice(1).map((f) => f[1])).toEqual(["261101", "261102"]);
    expect(hojaAsignaciones([e])[1].slice(0, 3)).toEqual(["261101", "261101", "C-000101"]);
    expect(Object.keys(hojasEmbarques([e]))).toEqual(["EMBARQUES", "PAQUETES", "ASIGNACIONES"]);
    expect(Object.keys(hojasViajes({ viajes: [viajeApi261001()], embarques: [e], correoDe: () => null }))).toEqual(["VIAJES", "AGRUPADORES"]);
    // el costo se muestra por moneda, sin mezclar
    expect(hojaViajes([viajeApi261001()])[1]).toContain("US$ 41500");
  });
});

// ─── R21 · columnas VIAJE, EMBARQUE y PAQUETE del importador de compras ───

describe("R21: columnas VIAJE, EMBARQUE y PAQUETE del importador de compras (§3.9)", () => {
  const catalogo: CatalogoAgrupadoresCompra = {
    viajes: [
      { id: VIAJE_AGR.v261001, codigo: "261001", estado: "abierto" },
      { id: "v-cerrado", codigo: "260901", estado: "cerrado" },
      { id: "v-cancelado", codigo: "260801", estado: "cancelado" },
    ],
    embarques: [
      { id: EMBARQUE_AGR.e261101, codigo: "261101", estado: "planificado", viaje_id: VIAJE_AGR.v261001, periodo_llegada: "2026-11" },
      { id: EMBARQUE_AGR.e261201, codigo: "261201", estado: "planificado", viaje_id: VIAJE_AGR.v261001, periodo_llegada: "2026-12" },
      { id: EMBARQUE_AGR.e270301, codigo: "270301", estado: "en_transito", viaje_id: null, periodo_llegada: "2027-03" },
      { id: "e-cancelado", codigo: "261199", estado: "cancelado", viaje_id: null, periodo_llegada: "2026-11" },
      { id: "e-recibido", codigo: "261198", estado: "recibido", viaje_id: null, periodo_llegada: "2026-11" },
    ],
    paquetes: [
      { id: PAQUETE_AGR.p261101, codigo: "261101", embarque_id: EMBARQUE_AGR.e261101, estado: "abierto" },
      { id: "p-cancelado", codigo: "261150", embarque_id: EMBARQUE_AGR.e261101, estado: "cancelado" },
    ],
  };
  const entrada = (cambios: Partial<EntradaAgrupadoresFilaCompra> = {}): EntradaAgrupadoresFilaCompra => ({
    fila: 4,
    viaje: "",
    embarque: "",
    paquete: "",
    clasificacion: "nueva",
    entregas: [{ periodo: "2026-12", unidades: 200 }],
    compra_viaje_id: null,
    embarques_asignados: [],
    ...cambios,
  });
  const evaluar = (cambios: Partial<EntradaAgrupadoresFilaCompra>) => evaluarAgrupadoresDeFilaCompra(entrada(cambios), catalogo);

  it("sin las tres columnas no hay nada que evaluar", () => {
    expect(evaluar({})).toBeNull();
    expect(sinAgrupadorEnFila(3)).toEqual({ fila: 3, viaje: null, embarque: null, paquete: null, resultado: "sin_cambio", avisos: [] });
  });

  it("caso 12: una línea `igual` sin asignación con EMBARQUE = 261201 se asigna", () => {
    const r = evaluar({ clasificacion: "igual", embarque: "261201" });
    expect(r).toMatchObject({ omite_fila: false, aplicar: { viaje_id: null, embarque_id: EMBARQUE_AGR.e261201, paquete_id: null } });
    expect(r?.api).toMatchObject({ fila: 4, resultado: "asignado", embarque: { codigo: "261201" }, avisos: [] });
  });

  it("caso 13: el mismo archivo con LLEGADA = 2026-11 da llegada_distinta_del_embarque", () => {
    const r = evaluar({ clasificacion: "igual", embarque: "261201", entregas: [{ periodo: "2026-11", unidades: 200 }] });
    expect(r).toMatchObject({ omite_fila: true, aplicar: { viaje_id: null, embarque_id: null, paquete_id: null } });
    expect(r?.api).toMatchObject({ resultado: "omitido", motivo: "llegada_distinta_del_embarque" });
  });

  it("caso 14: ENTREGAS de dos meses con EMBARQUE da entregas_con_embarque", () => {
    const r = evaluar({ embarque: "261201", entregas: [{ periodo: "2026-11", unidades: 100 }, { periodo: "2026-12", unidades: 100 }] });
    expect(r?.api).toMatchObject({ resultado: "omitido", motivo: "entregas_con_embarque" });
    // sin entregas (no hay LLEGADA): tampoco cae en el mes del embarque
    expect(evaluar({ embarque: "261201", entregas: [] })?.api.motivo).toBe("llegada_distinta_del_embarque");
  });

  it("caso 15: reimportar después de mover el embarque sigue igual: ya asignada al mismo embarque no se toca ni avisa", () => {
    // el embarque 261101 ahora llega en dic, pero el archivo dice nov: es `igual` (la huella es la del archivo) y ya está asignada a 261101
    const movido: CatalogoAgrupadoresCompra = { ...catalogo, embarques: catalogo.embarques.map((e) => (e.codigo === "261101" ? { ...e, periodo_llegada: "2026-12" } : e)) };
    const r = evaluarAgrupadoresDeFilaCompra(entrada({ clasificacion: "igual", embarque: "261101", entregas: [{ periodo: "2026-11", unidades: 300 }], embarques_asignados: [EMBARQUE_AGR.e261101] }), movido);
    expect(r).toMatchObject({ omite_fila: false, aplicar: { viaje_id: null, embarque_id: null, paquete_id: null } });
    expect(r?.api).toMatchObject({ resultado: "sin_cambio", avisos: [] });
  });

  it("una `igual` ya asignada a OTRO embarque: aviso agrupador_distinto y no se toca", () => {
    const r = evaluar({ clasificacion: "igual", embarque: "261201", embarques_asignados: [EMBARQUE_AGR.e261101] });
    expect(r).toMatchObject({ omite_fila: false, aplicar: { viaje_id: null, embarque_id: null, paquete_id: null } });
    expect(r?.api).toMatchObject({ resultado: "sin_cambio", avisos: ["agrupador_distinto"] });
    // un código desconocido en una igual ya asignada tampoco la omite: solo avisa
    expect(evaluar({ clasificacion: "igual", embarque: "999999", embarques_asignados: [EMBARQUE_AGR.e261101] })?.api.avisos).toEqual(["agrupador_distinto"]);
  });

  it("una `cambiada` sigue su regla de M8: no se toca ningún agrupador", () => {
    const r = evaluar({ clasificacion: "cambiada", embarque: "261201", viaje: "261001" });
    expect(r).toMatchObject({ omite_fila: false, aplicar: { viaje_id: null, embarque_id: null, paquete_id: null } });
    expect(r?.api.resultado).toBe("sin_cambio");
  });

  it("una nueva con EMBARQUE y PAQUETE (del embarque) los aplica", () => {
    const r = evaluar({ embarque: "261101", paquete: "261101", entregas: [{ periodo: "2026-11", unidades: 300 }] });
    expect(r?.aplicar).toEqual({ viaje_id: null, embarque_id: EMBARQUE_AGR.e261101, paquete_id: PAQUETE_AGR.p261101 });
    expect(r?.api).toMatchObject({ resultado: "asignado", paquete: { codigo: "261101" } });
  });

  it("códigos desconocidos: viaje_desconocido, embarque_desconocido y paquete_desconocido (el importador no crea agrupadores)", () => {
    expect(evaluar({ viaje: "999999" })?.api.motivo).toBe("viaje_desconocido");
    expect(evaluar({ embarque: "999999" })?.api.motivo).toBe("embarque_desconocido");
    expect(evaluar({ embarque: "261101", paquete: "999999", entregas: [{ periodo: "2026-11", unidades: 1 }] })?.api.motivo).toBe("paquete_desconocido");
    // un paquete de otro embarque o cancelado tampoco sirve
    expect(evaluar({ embarque: "261201", paquete: "261101" })?.api.motivo).toBe("paquete_desconocido");
    expect(evaluar({ embarque: "261101", paquete: "261150", entregas: [{ periodo: "2026-11", unidades: 1 }] })?.api.motivo).toBe("paquete_desconocido");
  });

  it("paquete_sin_embarque, embarque cancelado o recibido (embarque_no_editable)", () => {
    expect(evaluar({ paquete: "261101" })?.api.motivo).toBe("paquete_sin_embarque");
    expect(evaluar({ embarque: "261199", entregas: [{ periodo: "2026-11", unidades: 1 }] })?.api.motivo).toBe("embarque_no_editable");
    expect(evaluar({ embarque: "261198", entregas: [{ periodo: "2026-11", unidades: 1 }] })?.api.motivo).toBe("embarque_no_editable");
  });

  it("VIAJE: se asigna a la compra; cerrado se acepta con aviso viaje_cerrado (los tres roles); cancelado se omite", () => {
    expect(evaluar({ viaje: "261001" })).toMatchObject({ omite_fila: false, aplicar: { viaje_id: VIAJE_AGR.v261001, embarque_id: null, paquete_id: null } });
    const cerrado = evaluar({ viaje: "260901" });
    expect(cerrado?.aplicar.viaje_id).toBe("v-cerrado");
    expect(cerrado?.api).toMatchObject({ resultado: "asignado", avisos: ["viaje_cerrado"] });
    const cancelado = evaluar({ viaje: "260801" });
    expect(cancelado).toMatchObject({ omite_fila: true });
    expect(cancelado?.api.motivo).toBe("viaje_cancelado");
  });

  it("una compra que ya tiene otro viaje no se cambia: agrupador_distinto; si ya tiene el mismo, sin cambio", () => {
    const otro = evaluar({ viaje: "261001", compra_viaje_id: "v-cerrado" });
    expect(otro?.aplicar.viaje_id).toBeNull();
    expect(otro?.api).toMatchObject({ resultado: "sin_cambio", avisos: ["agrupador_distinto"] });
    expect(evaluar({ viaje: "261001", compra_viaje_id: VIAJE_AGR.v261001 })?.api).toMatchObject({ resultado: "sin_cambio", avisos: [] });
  });

  it("viaje_distinto: el viaje de la columna no es el del embarque (aviso, no bloquea)", () => {
    const r = evaluar({ viaje: "260901", embarque: "261201" });
    expect(r?.omite_fila).toBe(false);
    expect(r?.api.avisos).toEqual(["viaje_cerrado", "viaje_distinto"]);
    expect(r?.aplicar).toEqual({ viaje_id: "v-cerrado", embarque_id: EMBARQUE_AGR.e261201, paquete_id: null });
    // un embarque sin viaje (local) no da viaje_distinto
    expect(evaluar({ viaje: "261001", embarque: "270301", entregas: [{ periodo: "2027-03", unidades: 1 }] })?.api.avisos).toEqual([]);
  });

  it("una `igual` asignada a un embarque a la que el archivo le pone un viaje que no tiene, lo recibe", () => {
    const r = evaluar({ clasificacion: "igual", viaje: "261001", embarque: "261101", embarques_asignados: [EMBARQUE_AGR.e261101] });
    expect(r?.aplicar).toEqual({ viaje_id: VIAJE_AGR.v261001, embarque_id: null, paquete_id: null });
    expect(r?.api.resultado).toBe("asignado");
  });
});
