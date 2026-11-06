import { describe, expect, it } from "vitest";
import {
  asignarEntregasSchema,
  asignarViajeSchema,
  cambiarEstadoSchema,
  cambiarFechaSchema,
  cambiarFechasSchema,
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
  ingresoPaqueteSchema,
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
  CAUSAS_FECHA,
  CAUSAS_SIN_ATRASO,
  COLUMNAS_IMPORTAR_AGRUPADORES,
  COLUMNAS_SINONIMAS_AGRUPADORES,
  ESTADOS_HITO,
  HITOS,
  HITOS_CONFIRMABLES,
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
  ETIQUETA_CAUSA_FECHA,
  MENSAJE_ERROR_AGRUPADOR,
  type EventoAgrupadorApi,
} from "@/lib/compras/agrupadores/tipos-api";
import { ACCIONES_EVENTO, MAX_NUMERO_OC, MOTIVOS_FUNCION_OC } from "@/lib/compras/tipos";
import { CODIGO_DE_MOTIVO_OC, ESTADO_HTTP_ERROR_COMPRA, ETIQUETA_ACCION_EVENTO, MENSAJE_ERROR_COMPRA, mensajeOcDeOtroProveedor, mensajeOcRepetida } from "@/lib/compras/tipos-api";
import { AVISOS_AGRUPADOR } from "@/lib/compras/agrupadores/tipos";
import { comprasQuerySchema, editarOcSchema, filaImportacionCompraSchema } from "@/lib/compras/esquemas";
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
    // 08b-1b (§3.6): 19 columnas con los nombres de los hitos; FECHA_SALIDA y FECHA_LLEGADA siguen como sinónimos (claves propias de la fila).
    expect(claves).toHaveLength(19);
    const fila = Object.fromEntries([...claves, ...COLUMNAS_SINONIMAS_AGRUPADORES.map((c) => c.clave)].map((c) => [c, "x"]));
    expect(filaAgrupadorSchema.safeParse({ fila: 1, ...fila }).success).toBe(true);
    expect(COLUMNAS_IMPORTAR_AGRUPADORES.map((c) => c.encabezado)).toEqual([
      "TIPO", "CODIGO", "NOMBRE", "VIAJE", "EMBARQUE", "TIPO_EMBARQUE", "DESTINO", "FECHA_INICIO", "FECHA_FIN", "FECHA_ZARPE", "FECHA_ARRIBO", "FECHA_INGRESO_CD", "INICIO_OPERATIVO", "FECHA_INGRESO_STOCK", "ORIGEN", "PUERTO", "REFERENCIA_LOGISTICA", "RESPONSABLE", "NOTA",
    ]);
    expect(COLUMNAS_SINONIMAS_AGRUPADORES.map((c) => [c.encabezado, c.de])).toEqual([["FECHA_SALIDA", "fecha_zarpe"], ["FECHA_LLEGADA", "fecha_ingreso_cd"]]);
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
  it("las 24 omisiones de §3.11 y las 2 de 08b-1b (`hora_invalida`, `fechas_en_conflicto`)", () => {
    expect(MOTIVOS_OMISION_AGRUPADOR).toHaveLength(26);
    expect(MOTIVOS_OMISION_AGRUPADOR).toEqual(expect.arrayContaining(["hora_invalida", "fechas_en_conflicto"]));
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

// ─── 08b-1b: contratos de fechas logísticas, ingreso por paquete y número de OC ───

describe("08b-1b · cambiarFechasSchema (POST …/fechas)", () => {
  const ok = { revision: 1 };
  const r = (cuerpo: Record<string, unknown>) => cambiarFechasSchema.safeParse({ ...ok, ...cuerpo });

  it("clave ausente no cambia; presente es el valor nuevo (null incluido) y la clave se conserva en la salida", () => {
    const zarpe = r({ fecha_zarpe: null });
    expect(zarpe.success).toBe(true);
    if (zarpe.success) expect(zarpe.data).toMatchObject({ fecha_zarpe: null });
    const sola = r({ fecha_arribo: "2026-11-18" });
    expect(sola.success && Object.keys(sola.data).sort()).toEqual(["fecha_arribo", "revision"]);
    expect(r({ fecha_ingreso_stock: null }).success).toBe(true);
    expect(r({ hito_confirmado: null }).success).toBe(true);
    expect(r({ inicio_operativo: null }).success).toBe(true);
  });

  it("sin ninguna clave de fecha (solo la revisión o solo el motivo) se rechaza con un texto llano", () => {
    expect(r({}).success).toBe(false);
    expect(r({ motivo: "x", causa: "otro" }).success).toBe(false);
    const malo = r({});
    expect(!malo.success && malo.error.issues[0].message).toBe("No indicaste ninguna fecha que cambiar.");
  });

  it("el Ingreso CD nunca es null; las fechas deben ser aaaa-mm-dd de un día real", () => {
    expect(r({ fecha_ingreso_cd: null }).success).toBe(false);
    expect(r({ fecha_ingreso_cd: "2026-12-03" }).success).toBe(true);
    expect(r({ fecha_zarpe: "2026-02-30" }).success).toBe(false);
    expect(r({ fecha_arribo: "18/11/2026" }).success).toBe(false);
  });

  it("inicio_operativo: fecha y hora hh:mm de Lima; la hora puede ser null (la fecha sola)", () => {
    const solo = r({ inicio_operativo: { fecha: "2026-11-05", hora: "09:22" } });
    expect(solo.success).toBe(true);
    const sinHora = r({ inicio_operativo: { fecha: "2026-11-05", hora: null } });
    expect(sinHora.success && sinHora.data.inicio_operativo).toEqual({ fecha: "2026-11-05", hora: null });
    const omitida = r({ inicio_operativo: { fecha: "2026-11-05" } });
    expect(omitida.success && omitida.data.inicio_operativo).toEqual({ fecha: "2026-11-05", hora: null });
    for (const hora of ["25:10", "9:22", "09:60", "24:00", "09:22:10", "nueve"]) expect(r({ inicio_operativo: { fecha: "2026-11-05", hora } }).success, hora).toBe(false);
    for (const hora of ["00:00", "23:59", "09:22"]) expect(r({ inicio_operativo: { fecha: "2026-11-05", hora } }).success, hora).toBe(true);
    expect(r({ inicio_operativo: { hora: "09:22" } }).success).toBe(false);
    expect(r({ inicio_operativo: { fecha: "2026-11-05", hora: null, extra: 1 } }).success).toBe(false);
  });

  it("hito_confirmado y causa: solo los catálogos de la ficha", () => {
    for (const h of ["zarpe", "arribo", "ingreso_cd", "inicio_operativo"]) expect(r({ hito_confirmado: h }).success, h).toBe(true);
    for (const h of ["llegada", "ingreso_stock", "orden_compra", ""]) expect(r({ hito_confirmado: h }).success, h).toBe(false);
    for (const c of CAUSAS_FECHA) expect(r({ fecha_arribo: "2026-11-18", motivo: "x", causa: c }).success, c).toBe(true);
    expect(CAUSAS_FECHA).toEqual(["pago", "produccion", "naviera", "aduana", "transporte", "cola_conteo", "programacion", "correccion", "otro"]);
    expect(r({ fecha_arribo: "2026-11-18", causa: "clima" }).success).toBe(false);
    expect(HITOS_CONFIRMABLES).toEqual(["zarpe", "arribo", "ingreso_cd", "inicio_operativo"]);
  });

  it("motivo y huella_plan son opcionales (los exige el servidor solo si reprograma o cambia un mes); motivo ≤ 300; clave desconocida da 400", () => {
    expect(r({ fecha_arribo: "2026-11-18", motivo: "x", causa: "naviera", huella_plan: HUELLA }).success).toBe(true);
    expect(r({ fecha_arribo: "2026-11-18", motivo: "m".repeat(301) }).success).toBe(false);
    expect(r({ fecha_arribo: "2026-11-18", motivo: "   " }).success).toBe(false);
    expect(r({ fecha_arribo: "2026-11-18", huella_plan: "corta" }).success).toBe(false);
    expect(r({ fecha_arribo: "2026-11-18", fecha_llegada_estimada: "2026-11-20" }).success).toBe(false);
    expect(cambiarFechasSchema.safeParse({ fecha_arribo: "2026-11-18" }).success).toBe(false); // sin revisión
  });
});

describe("08b-1b · ingresoPaqueteSchema (POST …/paquetes/[id]/ingreso)", () => {
  it("revisión del embarque, fecha (null = hereda), motivo, causa y huella opcionales; strict", () => {
    expect(ingresoPaqueteSchema.safeParse({ revision_embarque: 2, fecha_ingreso_stock: "2027-04-04" }).success).toBe(true);
    expect(ingresoPaqueteSchema.safeParse({ revision_embarque: 2, fecha_ingreso_stock: null, motivo: "Hereda", causa: "programacion", huella_plan: HUELLA }).success).toBe(true);
    expect(ingresoPaqueteSchema.safeParse({ revision_embarque: 2 }).success).toBe(false);
    expect(ingresoPaqueteSchema.safeParse({ fecha_ingreso_stock: "2027-04-04" }).success).toBe(false);
    expect(ingresoPaqueteSchema.safeParse({ revision_embarque: 2, fecha_ingreso_stock: "2027-04-04", causa: "clima" }).success).toBe(false);
    expect(ingresoPaqueteSchema.safeParse({ revision_embarque: 2, fecha_ingreso_stock: "2027-04-04", revision: 1 }).success).toBe(false);
  });
});

describe("08b-1b · moverAPaqueteSchema por unidades", () => {
  const base = { revision: 1, paquete_id: U1 };
  it("acepta ids enteros, `{ id, unidades }` y mezclas; las unidades son enteros positivos", () => {
    expect(moverAPaqueteSchema.safeParse({ ...base, asignaciones: [U1, U2] }).success).toBe(true);
    expect(moverAPaqueteSchema.safeParse({ ...base, asignaciones: [{ id: U1, unidades: 300 }, U2] }).success).toBe(true);
    expect(moverAPaqueteSchema.safeParse({ ...base, asignaciones: [{ id: U1, unidades: 0 }] }).success).toBe(false);
    expect(moverAPaqueteSchema.safeParse({ ...base, asignaciones: [{ id: U1, unidades: 1.5 }] }).success).toBe(false);
    expect(moverAPaqueteSchema.safeParse({ ...base, asignaciones: [{ id: U1, unidades: MAX_UNIDADES_LINEA + 1 }] }).success).toBe(false);
    expect(moverAPaqueteSchema.safeParse({ ...base, asignaciones: [{ id: "x", unidades: 5 }] }).success).toBe(false);
    expect(moverAPaqueteSchema.safeParse({ ...base, asignaciones: [{ id: U1, unidades: 5, extra: 1 }] }).success).toBe(false);
    expect(moverAPaqueteSchema.safeParse({ ...base, asignaciones: [] }).success).toBe(false);
  });
  it("suma motivo, causa y huella_plan opcionales", () => {
    expect(moverAPaqueteSchema.safeParse({ ...base, asignaciones: [U1], motivo: "Programar", causa: "programacion", huella_plan: HUELLA }).success).toBe(true);
    expect(moverAPaqueteSchema.safeParse({ ...base, asignaciones: [U1], causa: "clima" }).success).toBe(false);
  });
});

describe("08b-1b · guardarEmbarqueSchema y editarEmbarqueSchema con los hitos y el origen", () => {
  const crear = { nombre: "Embarque", tipo: "importacion", viaje_id: null, responsable_id: null, fecha_llegada_estimada: "2026-11-15" };
  it("al crear acepta los cinco hitos, la hora y el origen; el Ingreso CD sigue obligatorio", () => {
    expect(guardarEmbarqueSchema.safeParse({ ...crear, fecha_salida_estimada: "2026-10-05", fecha_puerto_estimada: "2026-11-08", fecha_inicio_operativo_estimada: "2026-11-16", hora_inicio_operativo: "09:22", fecha_ingreso_estimada: "2026-12-02", origen: "California" }).success).toBe(true);
    const sinCd = guardarEmbarqueSchema.safeParse({ nombre: "E", tipo: "importacion", viaje_id: null, responsable_id: null });
    expect(!sinCd.success && sinCd.error.issues[0].message).toBe("Indica la fecha de ingreso al CD.");
  });
  it("la hora tiene la forma hh:mm; origen ≤ 80 y vacío = null", () => {
    expect(guardarEmbarqueSchema.safeParse({ ...crear, hora_inicio_operativo: "9:22" }).success).toBe(false);
    expect(guardarEmbarqueSchema.safeParse({ ...crear, origen: "o".repeat(81) }).success).toBe(false);
    const vacio = guardarEmbarqueSchema.safeParse({ ...crear, origen: "  " });
    expect(vacio.success && vacio.data.origen).toBeNull();
  });
  it("el PATCH acepta el origen (y las fechas como claves, que la función rechaza con fecha_por_movimiento si cambian); exige la revisión", () => {
    expect(editarEmbarqueSchema.safeParse({ ...crear, revision: 1, origen: "Nueva York" }).success).toBe(true);
    expect(editarEmbarqueSchema.safeParse({ ...crear, origen: "Nueva York" }).success).toBe(false);
    const sinSalida = editarEmbarqueSchema.safeParse({ ...crear, revision: 1 });
    expect(sinSalida.success && "fecha_salida_estimada" in sinSalida.data).toBe(false);
  });
});

describe("08b-1b · filtros de la lista y columnas nuevas", () => {
  it("embarquesQuerySchema: reprogramados y origen", () => {
    const q = embarquesQuerySchema.parse({ reprogramados: "1", origen: "California", atrasados: "1" });
    expect(q).toMatchObject({ reprogramados: true, origen: "California", atrasados: true });
    expect(embarquesQuerySchema.parse({}).reprogramados).toBe(false);
    expect(embarquesQuerySchema.safeParse({ reprogramados: "si" }).success).toBe(false);
  });
  it("comprasQuerySchema: proximo_hito solo admite «vencido»; q busca también por OC", () => {
    expect(comprasQuerySchema.parse({ proximo_hito: "vencido" }).proximo_hito).toBe("vencido");
    expect(comprasQuerySchema.safeParse({ proximo_hito: "previsto" }).success).toBe(false);
    expect(comprasQuerySchema.parse({ q: "4500012345" }).q).toBe("4500012345");
  });
  it("la fila de agrupadores acepta los hitos nuevos y sus sinónimos viejos; el importador de compras, la columna OC (opcional)", () => {
    const fila = Object.fromEntries([...COLUMNAS_IMPORTAR_AGRUPADORES, ...COLUMNAS_SINONIMAS_AGRUPADORES].map((c) => [c.clave, "x"]));
    expect(filaAgrupadorSchema.safeParse({ fila: 1, ...fila }).success).toBe(true);
    expect(filaAgrupadorSchema.safeParse({ fila: 1, tipo: "EMBARQUE", fecha_zarpe: "2026-11-05", inicio_operativo: "2026-11-05 09:22" }).success).toBe(true);
    expect(filaImportacionCompraSchema.safeParse({}).data).not.toHaveProperty("oc");
    expect(filaImportacionCompraSchema.parse({ oc: "4500012345" }).oc).toBe("4500012345");
    expect(filaImportacionCompraSchema.safeParse({ oc: "x".repeat(301) }).success).toBe(false);
    expect(filaImportacionCompraConAgrupadoresSchema.parse({ oc: "4500012345" }).oc).toBe("4500012345");
  });
});

describe("08b-1b · editarOcSchema (PUT /api/compras/[id]/oc)", () => {
  it("antes (la OC que vio el formulario o null) y numero_oc (null = quitar); el motivo es opcional", () => {
    expect(editarOcSchema.safeParse({ antes: null, numero_oc: "4500012345" }).success).toBe(true);
    expect(editarOcSchema.safeParse({ antes: "4500012300", numero_oc: "4500012345", motivo: "Error de tipeo" }).success).toBe(true);
    expect(editarOcSchema.safeParse({ antes: "4500012300", numero_oc: null }).success).toBe(true);
    expect(editarOcSchema.safeParse({ numero_oc: "4500012345" }).success).toBe(false);
    expect(editarOcSchema.safeParse({ antes: null }).success).toBe(false);
  });
  it("el formato de la OC: empieza con letra o número; letras, números, `- / _ .` y espacios; hasta 40; sin espacios al borde (se recortan)", () => {
    for (const oc of ["4500012345", "PO-2026/11_a.b", "AB 12", "a", "A".repeat(40)]) expect(editarOcSchema.safeParse({ antes: null, numero_oc: oc }).success, oc).toBe(true);
    for (const oc of ["-123", "45000#1", "", "   ", "A".repeat(41), "ñandú"]) expect(editarOcSchema.safeParse({ antes: null, numero_oc: oc }).success, oc).toBe(false);
    const recortada = editarOcSchema.safeParse({ antes: null, numero_oc: "  4500012345  " });
    expect(recortada.success && recortada.data.numero_oc).toBe("4500012345");
  });
  it("motivo ≤ 300 y no vacío; clave desconocida da 400", () => {
    expect(editarOcSchema.safeParse({ antes: null, numero_oc: "1", motivo: "m".repeat(301) }).success).toBe(false);
    expect(editarOcSchema.safeParse({ antes: null, numero_oc: "1", motivo: "  " }).success).toBe(false);
    expect(editarOcSchema.safeParse({ antes: null, numero_oc: "1", referencia: "X" }).success).toBe(false);
  });
});

describe("08b-1b · catálogos, códigos de error y avisos nuevos", () => {
  it("los motivos nuevos de las funciones de agrupador tienen estado HTTP 409 y un mensaje en castellano", () => {
    for (const m of ["sin_cambios", "causa_requerida", "fecha_requerida", "fecha_futura", "puerto_en_local", "hora_sin_fecha", "hito_confirmado"] as const) {
      expect(MOTIVOS_FUNCION_AGRUPADOR).toContain(m);
      expect(ESTADO_HTTP_ERROR_AGRUPADOR[m]).toBe(409);
      expect(MENSAJE_ERROR_AGRUPADOR[m].length).toBeGreaterThan(10);
    }
    expect(MENSAJE_ERROR_AGRUPADOR.fecha_futura).toContain("desmarca");
    expect(MENSAJE_ERROR_AGRUPADOR.hora_sin_fecha).toBe("Pon la fecha del inicio operativo antes que la hora.");
  });
  it("los avisos nuevos están en el catálogo y tienen etiqueta", () => {
    for (const a of ["ingreso_paquete_ajustado", "orden_de_fechas", "hito_vencido", "pasa_a_en_transito"] as const) {
      expect(AVISOS_AGRUPADOR).toContain(a);
      expect(ETIQUETA_AVISO_AGRUPADOR[a]).toBeTruthy();
    }
  });
  it("la OC: motivos de la función, códigos de la API y mensajes", () => {
    for (const m of MOTIVOS_FUNCION_OC) {
      const codigo = CODIGO_DE_MOTIVO_OC[m];
      expect(ESTADO_HTTP_ERROR_COMPRA[codigo]).toBeGreaterThanOrEqual(400);
      expect(MENSAJE_ERROR_COMPRA[codigo].length).toBeGreaterThan(10);
    }
    expect(ESTADO_HTTP_ERROR_COMPRA.no_encontrado).toBe(404);
    expect(ESTADO_HTTP_ERROR_COMPRA.oc_repetida).toBe(409);
    expect(ESTADO_HTTP_ERROR_COMPRA.oc_cambio).toBe(409);
    expect(ESTADO_HTTP_ERROR_COMPRA.sin_cambios).toBe(409);
    expect(ESTADO_HTTP_ERROR_COMPRA.oc_invalida).toBe(400);
    expect(mensajeOcRepetida("4500012345", "C-000201")).toBe("La OC 4500012345 ya está en C-000201 de este proveedor. Una OC es de una sola compra: revisa el número o cancela la otra compra.");
    expect(mensajeOcDeOtroProveedor("4500012345", "C-000202", "Feria Sur")).toBe("La OC 4500012345 también está en C-000202 de Feria Sur: ¿es otra orden?");
    expect(ACCIONES_EVENTO).toContain("editar_oc");
    expect(ETIQUETA_ACCION_EVENTO.editar_oc).toBeTruthy();
    expect(MAX_NUMERO_OC).toBe(40);
  });
  it("las causas, los estados y los hitos tienen texto, marcador y orden", () => {
    for (const c of CAUSAS_FECHA) expect(ETIQUETA_CAUSA_FECHA[c]).toBeTruthy();
    expect(HITOS).toEqual(["orden_compra", "zarpe", "arribo", "ingreso_cd", "inicio_operativo", "ingreso_stock"]);
    expect(ESTADOS_HITO).toEqual(["real", "sin_registrar", "vencido", "por_confirmar", "previsto", "pendiente", "no_aplica"]);
    expect(CAUSAS_SIN_ATRASO).toEqual(["correccion", "programacion"]);
  });
  it("el evento de agrupador puede traer la causa y la opción de embarque el origen", () => {
    const evento: EventoAgrupadorApi = { id: "e", viaje_id: null, embarque_id: "x", paquete_id: null, accion: "cambiar_fecha", antes: null, despues: null, motivo: "m", causa: "aduana", resumen: null, compras: [], usuario_nombre: null, created_at: "2026-11-12T10:00:00Z" };
    expect(evento.causa).toBe("aduana");
  });
});
