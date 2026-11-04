import { describe, expect, it } from "vitest";
import {
  asignarEntregasSchema,
  asignarViajeSchema,
  cambiarEstadoSchema,
  cambiarFechaSchema,
  codigoSchema,
  deduplicarComprasViaje,
  comprasAgrupadorQueryShape,
  editarEmbarqueSchema,
  editarViajeSchema,
  embarquesQuerySchema,
  filaAgrupadorSchema,
  filaImportacionCompraConAgrupadoresSchema,
  guardarEmbarqueSchema,
  guardarPaqueteSchema,
  guardarViajeSchema,
  historialQuerySchema,
  importarAgrupadoresSchema,
  importarComprasConAgrupadoresSchema,
  moverAPaqueteSchema,
  moverPaqueteSchema,
  pasarPendientesSchema,
  previsualizarQuerySchema,
  quitarAsignacionesSchema,
  recibirEmbarqueSchema,
  revertirRecepcionSchema,
  viajeActivoSchema,
  viajesQuerySchema,
} from "@/lib/compras/agrupadores/esquemas";
import { MAX_UNIDADES_LINEA } from "@/lib/compras/tipos";
import {
  ACCIONES_AGRUPADOR_EVENTO,
  ACCIONES_ESTADO,
  ACCIONES_ESTADO_POR_TIPO,
  COLUMNAS_IMPORTAR_AGRUPADORES,
  MAX_ASIGNACIONES_RECIBIR,
  MAX_FILAS_IMPORTAR_AGRUPADORES,
  MOTIVOS_FUNCION_AGRUPADOR,
  MOTIVOS_OMISION_AGRUPADOR,
  PATRON_CODIGO_AAMM,
  PATRON_CODIGO_AGRUPADOR,
  ROLES_RESPONSABLE_ASIGNABLE,
} from "@/lib/compras/agrupadores/tipos";
import {
  ESTADO_HTTP_ERROR_AGRUPADOR,
  ETIQUETA_ACCION_AGRUPADOR_EVENTO,
  ETIQUETA_AVISO_AGRUPADOR,
  MENSAJE_ERROR_AGRUPADOR,
} from "@/lib/compras/agrupadores/tipos-api";
import { AVISOS_AGRUPADOR } from "@/lib/compras/agrupadores/tipos";
import { filaImportacionCompraSchema } from "@/lib/compras/esquemas";
import {
  archivoAgrupadores19b,
  archivoAgrupadores19c,
  asignacionApiL1Nov,
  asignacionesCaso1,
  CORREO_PERFIL_AGR,
  EMBARQUE_AGR,
  embarqueApi261101,
  embarqueDetalleApi261101,
  embarquesAgrupadores,
  ENTREGA_AGR,
  paquetesAgrupadores,
  PAQUETE_AGR,
  PERFIL_AGR,
  perfilesAgrupadores,
  planCaso3,
  registrosAgrupadores,
  reporteCaso19bPrevisualizar,
  sinAgrupadorApi,
  VECTOR_REPARTO_V2,
  VIAJE_AGR,
  viajeApi261001,
} from "./agrupadores.fixture";

const U1 = "b0a30000-0000-4000-8000-000000000001";
const U2 = "b0a30000-0000-4000-8000-000000000002";
const HUELLA = "a".repeat(64);

const viajeOk = { nombre: "Feria Sur · oct-2026", fecha_inicio: "2026-10-05", responsable_id: U1 };
const embarqueOk = {
  nombre: "Nov-26",
  tipo: "importacion" as const,
  viaje_id: U1,
  responsable_id: null,
  fecha_llegada_estimada: "2026-11-20",
};

describe("codigoSchema (R14, §2.2)", () => {
  it("pasa a mayúsculas y recorta", () => {
    expect(codigoSchema.parse(" 261101 ")).toBe("261101");
    expect(codigoSchema.parse("ab-12")).toBe("AB-12");
  });
  it("vacío o ausente = sin código (autonumera)", () => {
    expect(codigoSchema.parse("")).toBeUndefined();
    expect(codigoSchema.parse("   ")).toBeUndefined();
    expect(codigoSchema.parse(undefined)).toBeUndefined();
  });
  it("rechaza espacios, símbolos y más de 30 caracteres", () => {
    expect(codigoSchema.safeParse("26 1101").success).toBe(false);
    expect(codigoSchema.safeParse("26_1101").success).toBe(false);
    expect(codigoSchema.safeParse("A".repeat(31)).success).toBe(false);
    expect(codigoSchema.safeParse("A".repeat(30)).success).toBe(true);
  });
  it("los patrones del catálogo coinciden con la ficha", () => {
    expect(PATRON_CODIGO_AGRUPADOR.test("261101")).toBe(true);
    expect(PATRON_CODIGO_AGRUPADOR.test("abc")).toBe(false);
    expect(PATRON_CODIGO_AAMM.test("261101")).toBe(true);
    expect(PATRON_CODIGO_AAMM.test("261301")).toBe(false); // mes 13
    expect(PATRON_CODIGO_AAMM.test("2611")).toBe(false);
  });
});

describe("guardarViajeSchema y editarViajeSchema (§2.3, §2.8)", () => {
  it("acepta lo mínimo y normaliza", () => {
    const r = guardarViajeSchema.parse({ ...viajeOk, codigo: "261001", destino: "", nota: null });
    expect(r.codigo).toBe("261001");
    expect(r.destino).toBeNull();
    expect(r.nota).toBeNull();
    expect(r.fecha_fin).toBeUndefined();
  });
  it("el responsable es obligatorio y debe ser un uuid", () => {
    expect(guardarViajeSchema.safeParse({ nombre: "X", fecha_inicio: "2026-10-05" }).success).toBe(false);
    expect(guardarViajeSchema.safeParse({ ...viajeOk, responsable_id: null }).success).toBe(false);
    expect(guardarViajeSchema.safeParse({ ...viajeOk, responsable_id: "no-es-uuid" }).success).toBe(false);
  });
  it("nombre de 1 a 120", () => {
    expect(guardarViajeSchema.safeParse({ ...viajeOk, nombre: "   " }).success).toBe(false);
    expect(guardarViajeSchema.safeParse({ ...viajeOk, nombre: "a".repeat(121) }).success).toBe(false);
    expect(guardarViajeSchema.safeParse({ ...viajeOk, nombre: "a".repeat(120) }).success).toBe(true);
  });
  it("destino ≤ 120 y nota ≤ 500", () => {
    expect(guardarViajeSchema.safeParse({ ...viajeOk, destino: "d".repeat(121) }).success).toBe(false);
    expect(guardarViajeSchema.safeParse({ ...viajeOk, nota: "n".repeat(501) }).success).toBe(false);
    expect(guardarViajeSchema.safeParse({ ...viajeOk, nota: "n".repeat(500) }).success).toBe(true);
  });
  it("fecha_fin no puede ser anterior a fecha_inicio; las fechas deben existir", () => {
    expect(guardarViajeSchema.safeParse({ ...viajeOk, fecha_fin: "2026-10-04" }).success).toBe(false);
    expect(guardarViajeSchema.safeParse({ ...viajeOk, fecha_fin: "2026-10-05" }).success).toBe(true);
    expect(guardarViajeSchema.safeParse({ ...viajeOk, fecha_inicio: "2026-02-30" }).success).toBe(false);
  });
  it("clave desconocida = 400 (strict)", () => {
    const r = guardarViajeSchema.safeParse({ ...viajeOk, estado: "cerrado" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toContain("estado");
  });
  it("editar exige la revisión; crear no", () => {
    expect(guardarViajeSchema.safeParse(viajeOk).success).toBe(true);
    expect(editarViajeSchema.safeParse(viajeOk).success).toBe(false);
    expect(editarViajeSchema.safeParse({ ...viajeOk, revision: 0 }).success).toBe(true);
    expect(editarViajeSchema.safeParse({ ...viajeOk, revision: -1 }).success).toBe(false);
  });
});

describe("guardarEmbarqueSchema y editarEmbarqueSchema (§2.4, R5)", () => {
  it("crear exige la fecha de llegada", () => {
    expect(guardarEmbarqueSchema.safeParse(embarqueOk).success).toBe(true);
    const { fecha_llegada_estimada: _f, ...sinFecha } = embarqueOk;
    void _f;
    expect(guardarEmbarqueSchema.safeParse(sinFecha).success).toBe(false);
  });
  it("editar exige la revisión y no exige la fecha", () => {
    const { fecha_llegada_estimada: _f, ...sinFecha } = embarqueOk;
    void _f;
    expect(editarEmbarqueSchema.safeParse({ ...sinFecha, revision: 1 }).success).toBe(true);
    expect(editarEmbarqueSchema.safeParse(sinFecha).success).toBe(false);
  });
  it("editar acepta la fecha de llegada: la función responde 409 fecha_por_movimiento (no 400)", () => {
    expect(editarEmbarqueSchema.safeParse({ ...embarqueOk, revision: 1 }).success).toBe(true);
  });
  it("tipo del catálogo; viaje_id y responsable_id son obligatorios aunque sean nulos", () => {
    expect(guardarEmbarqueSchema.safeParse({ ...embarqueOk, tipo: "aereo" }).success).toBe(false);
    const { viaje_id: _v, ...sinViaje } = embarqueOk;
    void _v;
    expect(guardarEmbarqueSchema.safeParse(sinViaje).success).toBe(false);
    expect(guardarEmbarqueSchema.safeParse({ ...embarqueOk, viaje_id: null, tipo: "local" }).success).toBe(true);
  });
  it("local con viaje y salida posterior a la llegada pasan zod: son 409 de la función", () => {
    expect(guardarEmbarqueSchema.safeParse({ ...embarqueOk, tipo: "local" }).success).toBe(true);
    expect(guardarEmbarqueSchema.safeParse({ ...embarqueOk, fecha_salida_estimada: "2026-12-01" }).success).toBe(true);
  });
  it("topes de texto: referencia y puerto 80, nota 500", () => {
    expect(guardarEmbarqueSchema.safeParse({ ...embarqueOk, referencia_logistica: "r".repeat(81) }).success).toBe(false);
    expect(guardarEmbarqueSchema.safeParse({ ...embarqueOk, puerto_embarque: "p".repeat(81) }).success).toBe(false);
    expect(guardarEmbarqueSchema.safeParse({ ...embarqueOk, puerto_embarque: "Puerto Sur", nota: "n".repeat(500) }).success).toBe(true);
    expect(guardarEmbarqueSchema.safeParse({ ...embarqueOk, nota: "n".repeat(501) }).success).toBe(false);
  });
  it("strict", () => {
    expect(guardarEmbarqueSchema.safeParse({ ...embarqueOk, estado: "recibido" }).success).toBe(false);
    expect(guardarEmbarqueSchema.safeParse({ ...embarqueOk, fecha_llegada_real: "2026-11-22" }).success).toBe(false);
  });
});

describe("guardarPaqueteSchema (§2.5)", () => {
  it("lleva la revisión del embarque", () => {
    expect(guardarPaqueteSchema.safeParse({ revision_embarque: 1, nombre: "Paquete A", responsable_id: null }).success).toBe(true);
    expect(guardarPaqueteSchema.safeParse({ nombre: "Paquete A", responsable_id: null }).success).toBe(false);
  });
  it("nota ≤ 300", () => {
    const base = { revision_embarque: 0, nombre: "A", responsable_id: U1 };
    expect(guardarPaqueteSchema.safeParse({ ...base, nota: "n".repeat(300) }).success).toBe(true);
    expect(guardarPaqueteSchema.safeParse({ ...base, nota: "n".repeat(301) }).success).toBe(false);
  });
  it("no admite embarque_id en el cuerpo (el paquete es de UN embarque, el de la ruta)", () => {
    expect(guardarPaqueteSchema.safeParse({ revision_embarque: 0, nombre: "A", responsable_id: null, embarque_id: U1 }).success).toBe(false);
  });
});

describe("cambiarEstadoSchema (R13, §0.3)", () => {
  it("acepta las cinco acciones", () => {
    for (const accion of ACCIONES_ESTADO) expect(cambiarEstadoSchema.safeParse({ revision: 1, accion }).success).toBe(true);
    expect(cambiarEstadoSchema.safeParse({ revision: 1, accion: "recibir" }).success).toBe(false);
  });
  it("motivo ≤ 200, opcional", () => {
    expect(cambiarEstadoSchema.safeParse({ revision: 1, accion: "cancelar", motivo: "m".repeat(200) }).success).toBe(true);
    expect(cambiarEstadoSchema.safeParse({ revision: 1, accion: "cancelar", motivo: "m".repeat(201) }).success).toBe(false);
  });
  it("el catálogo por tipo: el paquete solo cancela; cerrar y reabrir son del viaje", () => {
    expect(ACCIONES_ESTADO_POR_TIPO.paquete).toEqual(["cancelar"]);
    expect(ACCIONES_ESTADO_POR_TIPO.viaje).toEqual(["cerrar", "reabrir", "cancelar"]);
    expect(ACCIONES_ESTADO_POR_TIPO.embarque).toEqual(["en_transito", "volver_a_planificado", "cancelar"]);
  });
});

describe("asignarViajeSchema (§3.3)", () => {
  const compra = { id: U1, revision: 3 };
  it("1 a 500 compras; viaje_id puede ser nulo (quitar)", () => {
    expect(asignarViajeSchema.safeParse({ viaje_id: U2, compras: [compra] }).success).toBe(true);
    expect(asignarViajeSchema.safeParse({ viaje_id: null, compras: [compra] }).success).toBe(true);
    expect(asignarViajeSchema.safeParse({ viaje_id: U2, compras: [] }).success).toBe(false);
    expect(asignarViajeSchema.safeParse({ viaje_id: U2, compras: Array.from({ length: 500 }, () => compra) }).success).toBe(true);
    expect(asignarViajeSchema.safeParse({ viaje_id: U2, compras: Array.from({ length: 501 }, () => compra) }).success).toBe(false);
  });
  it("cada compra lleva su revisión y nada más", () => {
    expect(asignarViajeSchema.safeParse({ viaje_id: U2, compras: [{ id: U1 }] }).success).toBe(false);
    expect(asignarViajeSchema.safeParse({ viaje_id: U2, compras: [{ ...compra, extra: 1 }] }).success).toBe(false);
  });
});

describe("topes de `revision` y de unidades (H): un valor fuera de rango es 400, no un error de la base", () => {
  const MAX = 2_147_483_647;
  const compra = { id: U1, revision: 1 };
  it("revision: acepta hasta 2 147 483 647 y rechaza el siguiente (viaje, compra, embarque, destino)", () => {
    expect(asignarViajeSchema.safeParse({ viaje_id: U2, compras: [{ id: U1, revision: MAX }] }).success).toBe(true);
    expect(asignarViajeSchema.safeParse({ viaje_id: U2, compras: [{ id: U1, revision: MAX + 1 }] }).success).toBe(false);
    expect(asignarViajeSchema.safeParse({ viaje_id: U2, compras: [{ id: U1, revision: 1e300 }] }).success).toBe(false);
    expect(cambiarEstadoSchema.safeParse({ revision: MAX + 1, accion: "cancelar", motivo: "x" }).success).toBe(false);
    expect(revertirRecepcionSchema.safeParse({ revision: MAX }).success).toBe(true);
    expect(revertirRecepcionSchema.safeParse({ revision: MAX + 1 }).success).toBe(false);
    expect(quitarAsignacionesSchema.safeParse({ revision: 1, asignaciones: [{ id: U1, compra_revision: MAX + 1 }] }).success).toBe(false);
    expect(asignarViajeSchema.safeParse({ viaje_id: U2, compras: [compra] }).success).toBe(true);
  });
  it("unidades de asignar y de recibir: tope de una línea (10 000 000) y total confirmado dentro de un integer", () => {
    const asignar = (unidades: number) => asignarEntregasSchema.safeParse({ revision: 1, paquete_id: null, items: [{ entrega_id: U1, unidades, compra_revision: 1 }] });
    expect(asignar(MAX_UNIDADES_LINEA).success).toBe(true);
    expect(asignar(MAX_UNIDADES_LINEA + 1).success).toBe(false);
    expect(asignar(MAX).success).toBe(false);
    const recibir = (extra: Record<string, unknown>) => recibirEmbarqueSchema.safeParse({ revision: 1, modo: "llegada", fecha_llegada_real: "2026-11-05", ...extra });
    expect(recibir({ items: [{ asignacion_id: U1, unidades: MAX_UNIDADES_LINEA }] }).success).toBe(true);
    expect(recibir({ items: [{ asignacion_id: U1, unidades: MAX_UNIDADES_LINEA + 1 }] }).success).toBe(false);
    expect(recibir({ total_confirmado: MAX }).success).toBe(true);
    expect(recibir({ total_confirmado: MAX + 1 }).success).toBe(false);
  });
});

describe("deduplicarComprasViaje (B2)", () => {
  const A = { id: U1, revision: 1 };
  const B = { id: U2, revision: 4 };
  it("colapsa el mismo id con la misma revisión y conserva el orden de la primera aparición", () => {
    expect(deduplicarComprasViaje([A, B, { ...A }])).toEqual({ ok: true, compras: [A, B] });
    expect(deduplicarComprasViaje([B])).toEqual({ ok: true, compras: [B] });
  });
  it("el mismo id con revisiones distintas no se puede resolver: vista vencida", () => {
    expect(deduplicarComprasViaje([A, { ...A, revision: 2 }])).toEqual({ ok: false });
  });
});

describe("movimientos de entregas (§3.1, §3.4, §3.5)", () => {
  const item = { entrega_id: U1, unidades: 120, compra_revision: 3 };
  it("asignar: unidades enteras positivas, 1 a 2000 ítems, paquete nulo = sin paquete", () => {
    expect(asignarEntregasSchema.safeParse({ revision: 1, paquete_id: null, items: [item] }).success).toBe(true);
    expect(asignarEntregasSchema.safeParse({ revision: 1, paquete_id: U2, huella_plan: HUELLA, items: [item] }).success).toBe(true);
    expect(asignarEntregasSchema.safeParse({ revision: 1, paquete_id: null, items: [{ ...item, unidades: 0 }] }).success).toBe(false);
    expect(asignarEntregasSchema.safeParse({ revision: 1, paquete_id: null, items: [{ ...item, unidades: 1.5 }] }).success).toBe(false);
    expect(asignarEntregasSchema.safeParse({ revision: 1, paquete_id: null, items: [] }).success).toBe(false);
    expect(asignarEntregasSchema.safeParse({ revision: 1, paquete_id: null, items: Array.from({ length: 2001 }, () => item) }).success).toBe(false);
    expect(asignarEntregasSchema.safeParse({ revision: 1, items: [item] }).success).toBe(false); // paquete_id es obligatorio (puede ser null)
  });
  it("la huella del plan mide 64", () => {
    expect(asignarEntregasSchema.safeParse({ revision: 1, paquete_id: null, huella_plan: "abc", items: [item] }).success).toBe(false);
  });
  it("quitar lleva la revisión de cada compra", () => {
    expect(quitarAsignacionesSchema.safeParse({ revision: 1, asignaciones: [{ id: U1, compra_revision: 0 }] }).success).toBe(true);
    expect(quitarAsignacionesSchema.safeParse({ revision: 1, asignaciones: [{ id: U1 }] }).success).toBe(false);
    expect(quitarAsignacionesSchema.safeParse({ revision: 1, asignaciones: [] }).success).toBe(false);
  });
  it("mover a paquete: lista de uuid", () => {
    expect(moverAPaqueteSchema.safeParse({ revision: 1, paquete_id: null, asignaciones: [U1, U2] }).success).toBe(true);
    expect(moverAPaqueteSchema.safeParse({ revision: 1, paquete_id: null, asignaciones: ["x"] }).success).toBe(false);
    expect(moverAPaqueteSchema.safeParse({ revision: 1, paquete_id: null, asignaciones: [] }).success).toBe(false);
  });
  it("cambiar la fecha: motivo obligatorio (1 a 300)", () => {
    const ok = { revision: 1, fecha_llegada_estimada: "2026-12-03", motivo: "Atraso del barco" };
    expect(cambiarFechaSchema.safeParse(ok).success).toBe(true);
    expect(cambiarFechaSchema.safeParse({ ...ok, motivo: "  " }).success).toBe(false);
    expect(cambiarFechaSchema.safeParse({ ...ok, motivo: undefined }).success).toBe(false);
    expect(cambiarFechaSchema.safeParse({ ...ok, motivo: "m".repeat(301) }).success).toBe(false);
    expect(cambiarFechaSchema.safeParse({ ...ok, fecha_llegada_estimada: "2026-11" }).success).toBe(false);
  });
  it("mover un paquete: embarque de destino con su revisión y motivo", () => {
    const ok = { revision: 1, embarque_destino_id: U1, revision_destino: 2, motivo: "Sale con otro embarque" };
    expect(moverPaqueteSchema.safeParse(ok).success).toBe(true);
    expect(moverPaqueteSchema.safeParse({ ...ok, revision_destino: undefined }).success).toBe(false);
    expect(moverPaqueteSchema.safeParse({ ...ok, motivo: "" }).success).toBe(false);
  });
  it("pasar pendientes: asignaciones es opcional; paquete de destino nulo permitido", () => {
    const ok = { revision: 1, embarque_destino_id: U1, revision_destino: 2, paquete_destino_id: null, motivo: "Llegó incompleto" };
    expect(pasarPendientesSchema.safeParse(ok).success).toBe(true);
    expect(pasarPendientesSchema.safeParse({ ...ok, asignaciones: [U2] }).success).toBe(true);
    expect(pasarPendientesSchema.safeParse({ ...ok, asignaciones: Array.from({ length: 2001 }, () => U2) }).success).toBe(false);
    expect(pasarPendientesSchema.safeParse({ ...ok, paquete_destino_id: undefined }).success).toBe(false);
  });
});

describe("recibirEmbarqueSchema (08b-2, R8, R9)", () => {
  const base = { revision: 1, modo: "llegada" as const, fecha_llegada_real: "2026-11-22" };
  it("con items: al menos una unidad > 0", () => {
    expect(recibirEmbarqueSchema.safeParse({ ...base, items: [{ asignacion_id: U1, unidades: 250 }] }).success).toBe(true);
    expect(recibirEmbarqueSchema.safeParse({ ...base, items: [{ asignacion_id: U1, unidades: 0 }] }).success).toBe(false);
    expect(recibirEmbarqueSchema.safeParse({ ...base, items: [{ asignacion_id: U1, unidades: 0 }, { asignacion_id: U2, unidades: 5 }] }).success).toBe(true);
    expect(recibirEmbarqueSchema.safeParse({ ...base, items: [] }).success).toBe(false);
  });
  it("sin items: exige total_confirmado", () => {
    expect(recibirEmbarqueSchema.safeParse({ ...base, total_confirmado: 1180 }).success).toBe(true);
    expect(recibirEmbarqueSchema.safeParse(base).success).toBe(false);
    expect(recibirEmbarqueSchema.safeParse({ ...base, total_confirmado: 0 }).success).toBe(false);
  });
  it("modo del catálogo, mes X opcional como aaaa-mm, nota ≤ 200", () => {
    expect(recibirEmbarqueSchema.safeParse({ ...base, modo: "otra_llegada", total_confirmado: 30, periodo: "2026-12" }).success).toBe(true);
    expect(recibirEmbarqueSchema.parse({ ...base, total_confirmado: 30, periodo: "2026-12-01" }).periodo).toBe("2026-12");
    expect(recibirEmbarqueSchema.safeParse({ ...base, modo: "parcial", total_confirmado: 30 }).success).toBe(false);
    expect(recibirEmbarqueSchema.safeParse({ ...base, total_confirmado: 30, periodo: "2026-12-15" }).success).toBe(false);
    expect(recibirEmbarqueSchema.safeParse({ ...base, total_confirmado: 30, nota: "n".repeat(201) }).success).toBe(false);
  });
  it("tope propio de una llegada: 2000 asignaciones (no 50)", () => {
    expect(MAX_ASIGNACIONES_RECIBIR).toBe(2000);
    const items = (n: number) => Array.from({ length: n }, () => ({ asignacion_id: U1, unidades: 1 }));
    expect(recibirEmbarqueSchema.safeParse({ ...base, items: items(2000) }).success).toBe(true);
    expect(recibirEmbarqueSchema.safeParse({ ...base, items: items(2001) }).success).toBe(false);
  });
  it("revertir lleva revisión y, si vio la vista previa, la huella", () => {
    expect(revertirRecepcionSchema.safeParse({ revision: 2, huella_plan: HUELLA }).success).toBe(true);
    expect(revertirRecepcionSchema.safeParse({ revision: 2 }).success).toBe(true);
    expect(revertirRecepcionSchema.safeParse({}).success).toBe(false);
  });
});

describe("viajeActivoSchema (§3.8, R22)", () => {
  it("un uuid, todos o sin_viaje", () => {
    expect(viajeActivoSchema.safeParse({ viaje_id: U1 }).success).toBe(true);
    expect(viajeActivoSchema.safeParse({ viaje_id: "todos" }).success).toBe(true);
    expect(viajeActivoSchema.safeParse({ viaje_id: "sin_viaje" }).success).toBe(true);
    expect(viajeActivoSchema.safeParse({ viaje_id: "texto basura" }).success).toBe(false);
    expect(viajeActivoSchema.safeParse({ viaje_id: null }).success).toBe(false);
    expect(viajeActivoSchema.safeParse({}).success).toBe(false);
  });
});

describe("importador de agrupadores (§3.11, R25)", () => {
  it("el archivo del caso 19b (9 filas) pasa", () => {
    const filas = archivoAgrupadores19b();
    expect(filas).toHaveLength(9);
    const r = importarAgrupadoresSchema.safeParse({ modo: "previsualizar", archivo_nombre: "agrupadores.csv", filas });
    expect(r.success).toBe(true);
  });
  it("el 19c (con las filas extra) también pasa: sus errores son omisiones, no 400", () => {
    expect(importarAgrupadoresSchema.safeParse({ modo: "aplicar", archivo_nombre: "a.xlsx", filas: archivoAgrupadores19c() }).success).toBe(true);
  });
  it("de 1 a 1 000 filas", () => {
    const f = (n: number) => ({ fila: n, tipo: "VIAJE" });
    const filas = (n: number) => Array.from({ length: n }, (_, i) => f(i + 1));
    expect(MAX_FILAS_IMPORTAR_AGRUPADORES).toBe(1000);
    expect(importarAgrupadoresSchema.safeParse({ modo: "previsualizar", archivo_nombre: "a.csv", filas: filas(1000) }).success).toBe(true);
    expect(importarAgrupadoresSchema.safeParse({ modo: "previsualizar", archivo_nombre: "a.csv", filas: filas(1001) }).success).toBe(false);
    expect(importarAgrupadoresSchema.safeParse({ modo: "previsualizar", archivo_nombre: "a.csv", filas: [] }).success).toBe(false);
  });
  it("modo del catálogo y nombre de archivo ≤ 200", () => {
    const filas = [{ fila: 1, tipo: "VIAJE" }];
    expect(importarAgrupadoresSchema.safeParse({ modo: "borrar", archivo_nombre: "a.csv", filas }).success).toBe(false);
    expect(importarAgrupadoresSchema.safeParse({ modo: "aplicar", archivo_nombre: "a".repeat(201), filas }).success).toBe(false);
    expect(importarAgrupadoresSchema.safeParse({ modo: "aplicar", filas }).success).toBe(false);
  });
  it("la fila: número ≥ 1, tipo obligatorio, todo texto y claves estrictas", () => {
    expect(filaAgrupadorSchema.safeParse({ fila: 1, tipo: "VIAJE" }).success).toBe(true);
    expect(filaAgrupadorSchema.safeParse({ fila: 0, tipo: "VIAJE" }).success).toBe(false);
    expect(filaAgrupadorSchema.safeParse({ fila: 1 }).success).toBe(false);
    expect(filaAgrupadorSchema.safeParse({ fila: 1, tipo: "VIAJE", fecha_inicio: 46000 }).success).toBe(false);
    expect(filaAgrupadorSchema.safeParse({ fila: 1, tipo: "VIAJE", pais: "Perú" }).success).toBe(false);
  });
  it("un nombre largo NO da 400: es la omisión nombre_largo del importador (tope de celda 300)", () => {
    expect(filaAgrupadorSchema.safeParse({ fila: 1, tipo: "VIAJE", nombre: "n".repeat(200) }).success).toBe(true);
    expect(filaAgrupadorSchema.safeParse({ fila: 1, tipo: "VIAJE", nombre: "n".repeat(301) }).success).toBe(false);
  });
  it("las columnas de la plantilla coinciden con las claves del esquema, una a una", () => {
    const claves = COLUMNAS_IMPORTAR_AGRUPADORES.map((c) => c.clave);
    expect(claves).toHaveLength(15);
    const fila = Object.fromEntries(claves.map((c) => [c, "x"]));
    expect(filaAgrupadorSchema.safeParse({ fila: 1, ...fila }).success).toBe(true);
    expect(COLUMNAS_IMPORTAR_AGRUPADORES.map((c) => c.encabezado)).toEqual([
      "TIPO", "CODIGO", "NOMBRE", "VIAJE", "EMBARQUE", "TIPO_EMBARQUE", "DESTINO", "FECHA_INICIO", "FECHA_FIN", "FECHA_SALIDA", "FECHA_LLEGADA", "PUERTO", "REFERENCIA_LOGISTICA", "RESPONSABLE", "NOTA",
    ]);
  });
});

describe("columnas VIAJE, EMBARQUE y PAQUETE del importador de compras (§3.9, R21)", () => {
  it("la fila de M8 sigue válida y las tres columnas nuevas son opcionales (`\"\"`)", () => {
    const base = filaImportacionCompraSchema.parse({});
    const r = filaImportacionCompraConAgrupadoresSchema.parse(base);
    expect(r.viaje).toBe("");
    expect(r.embarque).toBe("");
    expect(r.paquete).toBe("");
    expect(filaImportacionCompraConAgrupadoresSchema.parse({ ...base, viaje: "261001", embarque: "261201", paquete: "P1" })).toMatchObject({
      viaje: "261001",
      embarque: "261201",
      paquete: "P1",
    });
  });
  it("importarComprasConAgrupadoresSchema conserva modo, carga_inicial y mezcla de M8", () => {
    const fila = filaImportacionCompraSchema.parse({});
    const r = importarComprasConAgrupadoresSchema.parse({ modo: "previsualizar", carga_inicial: true, filas: [{ ...fila, embarque: "261201" }] });
    expect(r.filas[0].embarque).toBe("261201");
    expect(r.carga_inicial).toBe(true);
    expect(r.mezcla).toEqual([]);
    expect(importarComprasConAgrupadoresSchema.safeParse({ modo: "aplicar", filas: [] }).success).toBe(false);
  });
});

describe("esquemas de lectura", () => {
  it("?previsualizar=1", () => {
    expect(previsualizarQuerySchema.parse({ previsualizar: "1" }).previsualizar).toBe(true);
    expect(previsualizarQuerySchema.parse({}).previsualizar).toBe(false);
    expect(previsualizarQuerySchema.safeParse({ previsualizar: "si" }).success).toBe(false);
  });
  it("viajes: estado, responsable, mio y texto", () => {
    expect(viajesQuerySchema.parse({ estado: "abierto", mio: "1", q: " feria " })).toMatchObject({ estado: "abierto", mio: true, q: "feria" });
    expect(viajesQuerySchema.safeParse({ estado: "recibido" }).success).toBe(false);
  });
  it("embarques: viaje_id o sin_viaje, mes de llegada desde ≤ hasta", () => {
    expect(embarquesQuerySchema.parse({ viaje_id: "sin_viaje", atrasados: "1", desde: "2026-11", hasta: "2026-12" })).toMatchObject({ viaje_id: "sin_viaje", atrasados: true });
    expect(embarquesQuerySchema.safeParse({ viaje_id: "todos" }).success).toBe(false);
    expect(embarquesQuerySchema.safeParse({ desde: "2026-12", hasta: "2026-11" }).success).toBe(false);
    expect(embarquesQuerySchema.safeParse({ tipo: "aereo" }).success).toBe(false);
  });
  it("historial: exactamente un agrupador", () => {
    expect(historialQuerySchema.safeParse({ embarque_id: U1 }).success).toBe(true);
    expect(historialQuerySchema.safeParse({}).success).toBe(false);
    expect(historialQuerySchema.safeParse({ embarque_id: U1, viaje_id: U2 }).success).toBe(false);
  });
  it("filtros nuevos de GET /api/compras", () => {
    expect(comprasAgrupadorQueryShape.viaje_id.safeParse("sin_viaje").success).toBe(true);
    expect(comprasAgrupadorQueryShape.viaje_id.safeParse(U1).success).toBe(true);
    expect(comprasAgrupadorQueryShape.viaje_id.safeParse("basura").success).toBe(false);
    expect(comprasAgrupadorQueryShape.embarque_id.safeParse(U1).success).toBe(true);
  });
});

describe("catálogos y contrato de errores", () => {
  it("cada motivo de función y cada código de la API tienen estado HTTP y mensaje en castellano", () => {
    const codigos = Object.keys(ESTADO_HTTP_ERROR_AGRUPADOR);
    expect(Object.keys(MENSAJE_ERROR_AGRUPADOR).sort()).toEqual(codigos.sort());
    for (const motivo of MOTIVOS_FUNCION_AGRUPADOR) {
      const codigo = motivo === "clave_existente" ? "vuelve_a_previsualizar" : motivo;
      expect(ESTADO_HTTP_ERROR_AGRUPADOR[codigo as keyof typeof ESTADO_HTTP_ERROR_AGRUPADOR]).toBeGreaterThanOrEqual(400);
    }
    for (const m of Object.values(MENSAJE_ERROR_AGRUPADOR)) expect(m.length).toBeGreaterThan(10);
  });
  it("solo no_encontrado y no_pertenece son 404 (R23: IDOR); el resto, 409", () => {
    const no409 = Object.entries(ESTADO_HTTP_ERROR_AGRUPADOR).filter(([, s]) => s !== 409).map(([c]) => c);
    expect(no409.sort()).toEqual(["no_encontrado", "no_pertenece"]);
  });
  it("etiquetas completas de acciones de evento y avisos", () => {
    for (const a of ACCIONES_AGRUPADOR_EVENTO) expect(ETIQUETA_ACCION_AGRUPADOR_EVENTO[a]).toBeTruthy();
    for (const a of AVISOS_AGRUPADOR) expect(ETIQUETA_AVISO_AGRUPADOR[a]).toBeTruthy();
    expect(ACCIONES_AGRUPADOR_EVENTO).toHaveLength(13);
  });
  it("las 24 omisiones de §3.11", () => {
    expect(MOTIVOS_OMISION_AGRUPADOR).toHaveLength(24);
  });
  it("responsables asignables: comprador y admin, no el planner (R26)", () => {
    expect([...ROLES_RESPONSABLE_ASIGNABLE].sort()).toEqual(["admin", "comprador"]);
  });
});

describe("fixture de los casos de la ficha (§5)", () => {
  it("todos los ids son uuid válidos y distintos", () => {
    const r = registrosAgrupadores();
    const ids = [
      ...r.perfiles.map((x) => x.id),
      ...r.viajes.map((x) => x.id),
      ...r.embarques.map((x) => x.id),
      ...r.paquetes.map((x) => x.id),
      ...r.compras.map((x) => x.id),
      ...r.lineas.map((x) => x.id),
      ...r.entregas.map((x) => x.id),
      ...asignacionesCaso1().map((x) => x.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(guardarViajeSchema.safeParse({ ...viajeOk, responsable_id: id }).success).toBe(true);
  });
  it("perfiles: C1 y C2 activos, C3 inactivo, A admin y un planner (caso 9)", () => {
    const p = Object.fromEntries(perfilesAgrupadores().map((x) => [x.id, x]));
    expect(p[PERFIL_AGR.c1]).toMatchObject({ rol: "comprador", activo: true });
    expect(p[PERFIL_AGR.c2]).toMatchObject({ rol: "comprador", activo: true });
    expect(p[PERFIL_AGR.c3]).toMatchObject({ rol: "comprador", activo: false });
    expect(p[PERFIL_AGR.a]).toMatchObject({ rol: "admin", activo: true });
    expect(p[PERFIL_AGR.pl]).toMatchObject({ rol: "planner", activo: true });
    expect(CORREO_PERFIL_AGR.c1).toContain("ejemplo.test");
  });
  it("códigos: de la forma de la ficha y únicos por tipo; el viaje 261101 puede convivir con el embarque 261101", () => {
    const e = embarquesAgrupadores().map((x) => x.codigo);
    expect(e).toEqual(["261101", "261201", "270301", "261102"]);
    expect(new Set(e).size).toBe(e.length);
    const p = paquetesAgrupadores().map((x) => x.codigo);
    expect(p).toEqual(["261101", "261102"]);
    for (const c of [...e, ...p]) expect(PATRON_CODIGO_AGRUPADOR.test(c)).toBe(true);
  });
  it("el embarque local no lleva viaje; los demás, salvo 270301, son del 261001; salida ≤ llegada", () => {
    const por = Object.fromEntries(embarquesAgrupadores().map((x) => [x.id, x]));
    expect(por[EMBARQUE_AGR.l261102]).toMatchObject({ tipo: "local", viaje_id: null, responsable_id: PERFIL_AGR.c3, periodo_llegada: "2026-11" });
    expect(por[EMBARQUE_AGR.e270301].viaje_id).toBeNull();
    expect(por[EMBARQUE_AGR.e261101]).toMatchObject({ viaje_id: VIAJE_AGR.v261001, puerto_embarque: "Puerto Sur", periodo_llegada: "2026-11", responsable_id: null });
    for (const x of embarquesAgrupadores()) {
      if (x.fecha_salida_estimada) expect(x.fecha_salida_estimada <= x.fecha_llegada_estimada).toBe(true);
      expect(x.periodo_llegada).toBe((x.fecha_llegada_real ?? x.fecha_llegada_estimada).slice(0, 7));
    }
  });
  it("los dos paquetes son del embarque 261101; C2 es el del primero", () => {
    for (const p of paquetesAgrupadores()) expect(p.embarque_id).toBe(EMBARQUE_AGR.e261101);
    expect(paquetesAgrupadores()[0].responsable_id).toBe(PERFIL_AGR.c2);
    expect(paquetesAgrupadores()[1].responsable_id).toBeNull();
  });
  it("las compras: C-000101 en el viaje (l1 500 y l2 1 000), C-000102 sin viaje, C-000103 en borrador", () => {
    const r = registrosAgrupadores();
    expect(r.compras.map((c) => [c.numero, c.estado])).toEqual([["C-000101", "confirmada"], ["C-000102", "confirmada"], ["C-000103", "borrador"]]);
    expect(r.compras.map((c) => c.proveedor_nombre)).toEqual(["Feria Sur", "Proveedor Norte", "Taller Lima Centro"]);
    expect(Object.values(r.viaje_de_compra)).toEqual([VIAJE_AGR.v261001, null, null]);
  });
  it("I3: Σ entregas de cada línea = unidades de la línea; l1 nov 300 · dic 200 y l2 mar 600 · abr 400", () => {
    const r = registrosAgrupadores();
    for (const l of r.lineas) expect(r.entregas.filter((e) => e.linea_id === l.id).reduce((a, e) => a + e.unidades, 0)).toBe(l.unidades);
    const porId = Object.fromEntries(r.entregas.map((e) => [e.id, e]));
    expect([porId[ENTREGA_AGR.l1Nov].periodo, porId[ENTREGA_AGR.l1Nov].unidades]).toEqual(["2026-11", 300]);
    expect([porId[ENTREGA_AGR.l1Dic].periodo, porId[ENTREGA_AGR.l1Dic].unidades]).toEqual(["2026-12", 200]);
    expect([porId[ENTREGA_AGR.l2Mar].periodo, porId[ENTREGA_AGR.l2Mar].unidades]).toEqual(["2027-03", 600]);
    expect([porId[ENTREGA_AGR.l2Abr].periodo, porId[ENTREGA_AGR.l2Abr].unidades]).toEqual(["2027-04", 400]);
  });
  it("R6: el reparto del lote suma las unidades de cada entrega y usa el vector de su temporada", () => {
    const r = registrosAgrupadores();
    for (const e of r.entregas.filter((x) => x.linea_id === r.lineas[1].id)) {
      const filas = r.repartos.filter((x) => x.entrega_id === e.id);
      expect(filas.reduce((a, x) => a + x.unidades, 0)).toBe(e.unidades);
      expect(new Set(filas.map((x) => x.reparto_version))).toEqual(new Set([2]));
    }
    expect(r.repartos.filter((x) => x.entrega_id === ENTREGA_AGR.l2Mar).map((x) => x.unidades)).toEqual([300, 180, 120]);
    expect(r.repartos.filter((x) => x.entrega_id === ENTREGA_AGR.l2Abr).map((x) => x.unidades)).toEqual([120, 160, 120]);
    for (const v of Object.values(VECTOR_REPARTO_V2)) expect(v.reduce((a, b) => a + b, 0)).toBe(100);
  });
  it("caso 1 (I1 e I2): las asignaciones caben en su entrega y están alineadas con el mes del embarque; el paquete es del embarque (R1)", () => {
    const r = registrosAgrupadores();
    const asignaciones = asignacionesCaso1();
    for (const a of asignaciones) {
      const e = r.entregas.find((x) => x.id === a.entrega_id);
      const emb = r.embarques.find((x) => x.id === a.embarque_id);
      expect(e && emb && e.periodo === emb.periodo_llegada).toBe(true);
      expect(a.unidades).toBeLessThanOrEqual(e?.unidades ?? 0);
      if (a.paquete_id) expect(r.paquetes.find((p) => p.id === a.paquete_id)?.embarque_id).toBe(a.embarque_id);
    }
    expect(asignaciones.map((a) => a.unidades)).toEqual([300, 200]);
  });
  it("las cifras de los objetos de API cuadran con los registros", () => {
    const r = registrosAgrupadores();
    const asig = asignacionesCaso1();
    const emb = embarqueApi261101();
    expect(emb.totales.unidades).toBe(asig.filter((a) => a.embarque_id === EMBARQUE_AGR.e261101).reduce((s, a) => s + a.unidades, 0));
    expect(emb.totales.costo.USD).toBe(300 * 38);
    expect(emb.totales.pendientes).toBe(emb.totales.unidades - emb.totales.recibidas);
    const viaje = viajeApi261001();
    expect(viaje.totales.unidades).toBe(r.lineas.filter((l) => l.compra_id === r.compras[0].id).reduce((s, l) => s + l.unidades, 0));
    expect(viaje.totales.costo.USD).toBe(500 * 38 + 1000 * 22.5);
    expect(viaje.totales.unidades_sin_embarque).toBe(viaje.totales.unidades - asig.reduce((s, a) => s + a.unidades, 0));
    const det = embarqueDetalleApi261101();
    expect(det.paquetes.map((p) => p.codigo)).toEqual(["261101", "261102"]);
    expect(det.asignaciones[0]).toEqual(asignacionApiL1Nov());
    expect(det.asignaciones[0].paquete_id).toBe(PAQUETE_AGR.p261101);
    expect(det.paquetes[0].responsable_efectivo?.origen).toBe("propio");
    expect(det.paquetes[1].responsable_efectivo).toMatchObject({ perfil_id: PERFIL_AGR.c1, origen: "viaje" });
  });
  it("el plan del caso 3 lleva una huella de 64 y el aviso entregas_fusionadas", () => {
    const plan = planCaso3();
    expect(plan.huella_plan).toHaveLength(64);
    expect(plan.avisos[0].aviso).toBe("entregas_fusionadas");
    expect(plan.unidades_movidas).toBe(plan.movimientos.reduce((s, m) => s + m.unidades, 0));
  });
  it("Sin agrupador: la entrega de C-000102 y su compra sin viaje", () => {
    const s = sinAgrupadorApi();
    expect(s.entregas[0].sin_asignar).toBe(400);
    expect(s.compras_sin_viaje[0].numero).toBe("C-000102");
  });
  it("caso 19b: 9 filas nuevas; el viaje sin código se numera al aplicar; el embarque 261301 apunta al viaje 261201 del archivo", () => {
    const rep = reporteCaso19bPrevisualizar();
    expect(rep.resumen.nuevas).toBe(9);
    expect(rep.resumen.por_tipo.viaje.nuevas + rep.resumen.por_tipo.embarque.nuevas + rep.resumen.por_tipo.paquete.nuevas).toBe(9);
    expect(rep.filas.filter((f) => f.codigo_final === null)).toHaveLength(2); // viaje sin código y paquete B sin código
    const archivo = archivoAgrupadores19b();
    expect(archivo.filter((f) => f.tipo === "VIAJE")).toHaveLength(2);
    expect(archivo.filter((f) => f.tipo === "EMBARQUE")).toHaveLength(3);
    expect(archivo.filter((f) => f.tipo === "PAQUETE")).toHaveLength(4);
    expect(archivo.find((f) => f.codigo === "261301" && f.tipo === "EMBARQUE")?.viaje).toBe("261201");
    expect(archivo.find((f) => f.codigo === "261302")?.viaje).toBe("261001");
  });
  it("caso 19c: cambia la llegada de 261302, un planner responsable y un paquete que apunta a un embarque sin código", () => {
    const a = archivoAgrupadores19c();
    expect(a.find((f) => f.fila === 4)?.fecha_llegada).toBe("2027-01-30");
    expect(a.find((f) => f.fila === 5)?.responsable).toBe(CORREO_PERFIL_AGR.pl);
    const sinCodigo = a.find((f) => f.tipo === "EMBARQUE" && !f.codigo);
    expect(sinCodigo).toBeDefined();
    expect(a.find((f) => f.tipo === "PAQUETE" && f.embarque === sinCodigo?.nombre)).toBeDefined();
  });
});
