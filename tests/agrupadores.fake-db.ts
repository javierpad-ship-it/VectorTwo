import type { Rol } from "@/lib/auth/roles";
import { aplicarMovimientos, type MovimientoPlan, type PlanAplicable } from "@/lib/compras/agrupadores/movimiento";
import { siguienteCodigo, aammDe } from "@/lib/compras/agrupadores/codigos";
import type { RepartoVigenteApi } from "@/lib/marcas-barrer/tipos-api";
import { MARCA_M8, NODO_M8, REPARTO_BETA_V2 } from "./compras.fixture";
import { clienteFalso, escenario, reiniciarEscenario, sembrar, tablaDe, type Fila } from "./compras.fake-db";
import {
  ASIGNACION_AGR,
  CORREO_PERFIL_AGR,
  PERFIL_AGR,
  VECTOR_REPARTO_V2,
  asignacionesCaso1,
  embarquesAgrupadores,
  paquetesAgrupadores,
  registrosC101,
  registrosC102,
  registrosC103,
  viaje261001,
  PROVEEDOR_AGR,
} from "./agrupadores.fixture";

/**
 * Doble de base de los handlers de agrupadores (08b-1, T3b): la base en memoria de `compras.fake-db.ts` (sus tablas y su cliente de
 * lectura) más las tablas nuevas y las funciones `rpc` de `0032`. Las funciones de escritura se SIMULAN con los espejos puros de
 * `src/lib/compras/agrupadores` (`aplicarMovimientos`, `siguienteCodigo`): lo que prueban los handlers es la orquestación (guards, pertenencia,
 * reintentos con la huella, traducción de motivos, forma de las respuestas); el humo de SQL lo prueba la base. Todo inventado.
 *
 * El escenario de la ficha: viaje 261001 (de C1), embarques 261101, 261201 (omitido aquí), 270301 y local 261102; paquetes 261101 y 261102 del
 * 261101; compras C-000101 (con viaje), C-000102 y C-000103 (borrador). `k' = 2026-09`, «hoy» 2026-10-15.
 */

export type Respuesta = { data: unknown; error: { code: string; message: string; details: null; hint: null } | null };

export const PERFILES_AGR = {
  c1: { id: PERFIL_AGR.c1, email: CORREO_PERFIL_AGR.c1, nombre: "Comprador C1", rol: "comprador" as Rol },
  c2: { id: PERFIL_AGR.c2, email: CORREO_PERFIL_AGR.c2, nombre: "Comprador C2", rol: "comprador" as Rol },
  a: { id: PERFIL_AGR.a, email: CORREO_PERFIL_AGR.a, nombre: "Admin A", rol: "admin" as Rol },
  pl: { id: PERFIL_AGR.pl, email: CORREO_PERFIL_AGR.pl, nombre: "Planner PL", rol: "planner" as Rol },
};

/** Entra como ese perfil (rol incluido). */
export const entrarComo = (quien: keyof typeof PERFILES_AGR) => {
  escenario.usuario = { rol: PERFILES_AGR[quien].rol, perfil: PERFILES_AGR[quien] };
};

/** Reemplazos puntuales de una función `rpc` (para forzar una carrera o un fallo): nombre → respuesta. Se vacía en cada escenario. */
export const reemplazos: Record<string, (args: Record<string, unknown>) => Respuesta | null> = {};

const sello = () => new Date(Date.UTC(2026, 9, 15, 12, 0, 0) + escenario.reloj++ * 1000).toISOString();
const nuevoId = () => `b9000000-0000-4000-8000-${String(900000 + escenario.contadorId++).padStart(12, "0")}`;
const tabla = tablaDe;
const ok = (data: Record<string, unknown>): Respuesta => ({ data: { ok: true, ...data }, error: null });
const no = (motivo: string, extra: Record<string, unknown> = {}): Respuesta => ({ data: { ok: false, motivo, ...extra }, error: null });

/** Reparto v2 de BETA con los vectores del fixture (verano 50/30/20 · invierno 30/40/30); `sinInvierno` quita el de invierno (caso 5). */
export function repartoV2(sinInvierno = false): RepartoVigenteApi {
  const nodos = [NODO_M8.urbano, NODO_M8.polo, NODO_M8.sandalia];
  const fila = (temporada: "verano" | "invierno") => VECTOR_REPARTO_V2[temporada].map((pct, i) => ({ gml_id: nodos[i], equivalencia_id: null, temporada, participacion: pct / 100 }));
  return {
    marca_id: MARCA_M8.beta,
    reparto_id: REPARTO_BETA_V2,
    version: 2,
    modo: "por_temporada",
    error_reparto_pp: 8,
    temporadas_usadas: { verano: { desde_mes: 10, hasta_mes: 3 }, invierno: { desde_mes: 4, hasta_mes: 9 } },
    filas: [...fila("verano"), ...(sinInvierno ? [] : fila("invierno"))],
  } as unknown as RepartoVigenteApi;
}

export const estadoRepartos = { sinInvierno: false };

// ─── Escenario ───

const filaViaje = (v: ReturnType<typeof viaje261001>): Fila => ({
  ...v,
  perfil_id: PERFIL_AGR.c1,
  usuario_nombre: "Comprador C1",
  updated_by_id: null,
  updated_by_nombre: null,
  activo: true,
  created_at: "2026-10-01T10:00:00.000Z",
  updated_at: "2026-10-01T10:00:00.000Z",
});

/** Siembra el escenario de la ficha (sin asignaciones salvo que se pida el caso 1). */
export function iniciarAgrupadores(opciones: { caso1?: boolean } = {}): void {
  for (const k of Object.keys(reemplazos)) delete reemplazos[k];
  estadoRepartos.sinInvierno = false;
  reiniciarEscenario({ sembrar: false });
  sembrar(registrosC101(), registrosC102(), registrosC103());
  tabla("proveedores").push({ id: PROVEEDOR_AGR.taller, codigo: null, nombre: "Taller Lima Centro", activo: true, es_intercompany: false });
  for (const c of tabla("compras")) c.viaje_id = null;
  tabla("compras").find((c) => c.numero === "C-000101")!.viaje_id = viaje261001().id;
  tabla("perfiles").push(...Object.values(PERFILES_AGR).map((p) => ({ ...p, activo: true })), { id: PERFIL_AGR.c3, email: CORREO_PERFIL_AGR.c3, nombre: "Comprador C3", rol: "comprador", activo: false });
  tabla("compra_viajes").push(filaViaje(viaje261001()));
  for (const e of embarquesAgrupadores()) {
    tabla("compra_embarques").push({ ...e, perfil_id: PERFIL_AGR.c1, usuario_nombre: "Comprador C1", updated_by_id: null, updated_by_nombre: null, activo: true, created_at: "2026-10-02T10:00:00.000Z", updated_at: "2026-10-02T10:00:00.000Z" });
  }
  for (const p of paquetesAgrupadores()) tabla("compra_paquetes").push({ ...p, perfil_id: PERFIL_AGR.c1, usuario_nombre: "Comprador C1", updated_by_id: null, updated_by_nombre: null, activo: true, created_at: "2026-10-02T10:00:00.000Z", updated_at: "2026-10-02T10:00:00.000Z" });
  if (opciones.caso1) for (const a of asignacionesCaso1()) tabla("compra_entrega_asignaciones").push({ ...a, activo: true, created_at: "2026-10-03T10:00:00.000Z", updated_at: "2026-10-03T10:00:00.000Z" });
}

/** El cliente de las pruebas: lecturas del cliente de compras y `rpc` de agrupadores. */
export function clienteAgrupadores() {
  const base = clienteFalso();
  return {
    from: base.from,
    rpc: (nombre: string, args: Record<string, unknown> = {}): Promise<Respuesta> => {
      // Lo que no es de agrupadores (`importar_compra`, `stock_flujo`…) lo resuelve la base de compras.
      if (!ESCRITURAS_AGR.includes(nombre)) return base.rpc(nombre, args) as Promise<Respuesta>;
      escenario.llamadas.push({ nombre, args });
      const forzada = reemplazos[nombre]?.(args);
      if (forzada) return Promise.resolve(forzada);
      return Promise.resolve(simular(nombre, args));
    },
  };
}

export const llamadasRpc = (nombre: string) => escenario.llamadas.filter((l) => l.nombre === nombre);
/** Las escrituras de agrupadores que llegaron a la base, en orden. */
export const ESCRITURAS_AGR = ["guardar_viaje", "guardar_embarque", "guardar_paquete", "cambiar_estado_agrupador", "asignar_viaje_compras", "aplicar_movimiento_agrupador", "importar_agrupadores"];
export const escriturasAgr = () => escenario.llamadas.filter((l) => ESCRITURAS_AGR.includes(l.nombre));

// ─── Simulación de las funciones de `0032` ───

const actorDe = (a: unknown) => a as { perfil_id: string | null; nombre: string };
const get = (t: string, id: unknown) => tabla(t).find((f) => f.id === id);
const asignable = (id: unknown) => {
  const p = tabla("perfiles").find((x) => x.id === id);
  return p !== undefined && p.activo === true && (p.rol === "comprador" || p.rol === "admin");
};

function evento(f: { viaje_id?: unknown; embarque_id?: unknown; paquete_id?: unknown; accion: string; antes?: unknown; despues?: unknown; motivo?: unknown; resumen?: string; compras?: unknown }, actor: { perfil_id: string | null; nombre: string }) {
  tabla("compra_agrupador_eventos").push({
    id: nuevoId(),
    viaje_id: f.viaje_id ?? null,
    embarque_id: f.embarque_id ?? null,
    paquete_id: f.paquete_id ?? null,
    accion: f.accion,
    antes: f.antes ?? null,
    despues: f.despues ?? null,
    motivo: f.motivo ?? null,
    resumen: f.resumen ?? null,
    compras: f.compras ?? [],
    perfil_id: actor.perfil_id,
    usuario_nombre: actor.nombre,
    created_at: sello(),
  });
}

function codigoNuevo(t: "compra_viajes" | "compra_embarques" | "compra_paquetes", escrito: string, referencia: string): string | { motivo: string } {
  const existentes = tabla(t).map((f) => String(f.codigo));
  if (escrito !== "") {
    const c = escrito.toUpperCase();
    if (!/^[A-Z0-9-]{1,30}$/.test(c)) return { motivo: "codigo_invalido" };
    return existentes.some((x) => x.toUpperCase() === c) ? { motivo: "codigo_duplicado" } : c;
  }
  const aamm = aammDe(referencia);
  const s = siguienteCodigo(aamm ?? "0000", existentes);
  return s.ok ? s.codigo : { motivo: "correlativo_agotado" };
}

function simular(nombre: string, a: Record<string, unknown>): Respuesta {
  switch (nombre) {
    case "guardar_viaje":
      return guardarViaje(a.p_viaje as Fila, a.p_revision as number | null, actorDe(a.p_actor));
    case "guardar_embarque":
      return guardarEmbarque(a.p_embarque as Fila, a.p_revision as number | null, actorDe(a.p_actor));
    case "guardar_paquete":
      return guardarPaquete(a.p_paquete as Fila, a.p_revision_embarque as number, actorDe(a.p_actor));
    case "cambiar_estado_agrupador":
      return cambiarEstado(a as { p_tipo: string; p_id: string; p_accion: string; p_revision: number; p_motivo: string | null; p_actor: unknown });
    case "asignar_viaje_compras":
      return asignarViaje(a.p_viaje as string | null, a.p_compras as { id: string; revision: number }[], actorDe(a.p_actor));
    case "aplicar_movimiento_agrupador":
      return aplicarMovimiento(a.p_plan as PlanAplicable, actorDe(a.p_actor));
    case "importar_agrupadores":
      return importarLote(a.p_lote as LoteFalso, actorDe(a.p_actor));
    default:
      return { data: null, error: { code: "42883", message: `función desconocida: ${nombre}`, details: null, hint: null } };
  }
}

function guardarViaje(v: Fila, revision: number | null, actor: { perfil_id: string | null; nombre: string }): Respuesta {
  const filas = tabla("compra_viajes");
  if (!v.id) {
    if (!asignable(v.responsable_id)) return no("responsable_no_asignable");
    const codigo = codigoNuevo("compra_viajes", String(v.codigo ?? ""), String(v.fecha_inicio));
    if (typeof codigo !== "string") return no(codigo.motivo);
    const fila: Fila = { id: nuevoId(), codigo, nombre: v.nombre, destino: v.destino ?? null, fecha_inicio: v.fecha_inicio, fecha_fin: v.fecha_fin ?? null, responsable_id: v.responsable_id, estado: "abierto", nota: v.nota ?? null, revision: 0, perfil_id: actor.perfil_id, usuario_nombre: actor.nombre, updated_by_id: actor.perfil_id, updated_by_nombre: actor.nombre, activo: true, created_at: sello(), updated_at: sello() };
    filas.push(fila);
    evento({ viaje_id: fila.id, accion: "crear", resumen: `Viaje ${codigo} creado` }, actor);
    return ok({ viaje_id: fila.id, codigo, revision: 0, creado: true });
  }
  const fila = get("compra_viajes", v.id);
  if (!fila) return no("no_encontrado");
  if (fila.estado === "cancelado") return no("no_editable");
  if (revision === null || fila.revision !== revision) return no("agrupador_cambio");
  if (v.responsable_id !== fila.responsable_id && !asignable(v.responsable_id)) return no("responsable_no_asignable");
  Object.assign(fila, { nombre: v.nombre, destino: v.destino ?? null, fecha_inicio: v.fecha_inicio, fecha_fin: v.fecha_fin ?? null, responsable_id: v.responsable_id, nota: v.nota ?? null, revision: (fila.revision as number) + 1, updated_by_nombre: actor.nombre, updated_at: sello() });
  evento({ viaje_id: fila.id, accion: "editar", resumen: `Viaje ${fila.codigo} editado` }, actor);
  return ok({ viaje_id: fila.id, codigo: fila.codigo, revision: fila.revision, creado: false });
}

function guardarEmbarque(e: Fila, revision: number | null, actor: { perfil_id: string | null; nombre: string }): Respuesta {
  const filas = tabla("compra_embarques");
  const avisos: unknown[] = [];
  const viaje = e.viaje_id ? get("compra_viajes", e.viaje_id) : undefined;
  if (e.viaje_id && !viaje) return no("no_encontrado");
  const actual = e.id ? get("compra_embarques", e.id) : undefined;
  if (e.id && !actual) return no("no_encontrado");
  if (viaje?.estado === "cancelado" && viaje.id !== actual?.viaje_id) return no("viaje_cancelado");
  if (viaje?.estado === "cerrado") avisos.push({ codigo: "viaje_cerrado", viaje: viaje.codigo });
  if (e.tipo === "local" && e.viaje_id) return no("local_con_viaje");
  if (!actual) {
    if (!asignable(e.responsable_id) && e.responsable_id) return no("responsable_no_asignable");
    if (!e.fecha_llegada_estimada) return no("fecha_requerida");
    if (e.fecha_salida_estimada && String(e.fecha_salida_estimada) > String(e.fecha_llegada_estimada)) return no("salida_despues_de_llegada");
    const codigo = codigoNuevo("compra_embarques", String(e.codigo ?? ""), String(e.fecha_llegada_estimada));
    if (typeof codigo !== "string") return no(codigo.motivo);
    const fila: Fila = {
      id: nuevoId(), codigo, nombre: e.nombre, tipo: e.tipo ?? "importacion", viaje_id: e.viaje_id ?? null, responsable_id: e.responsable_id ?? null, referencia_logistica: e.referencia_logistica ?? null, puerto_embarque: e.puerto_embarque ?? null,
      fecha_salida_estimada: e.fecha_salida_estimada ?? null, fecha_llegada_estimada: e.fecha_llegada_estimada, fecha_llegada_real: null, periodo_llegada: `${String(e.fecha_llegada_estimada).slice(0, 7)}-01`, estado: "planificado", nota: e.nota ?? null, revision: 0,
      perfil_id: actor.perfil_id, usuario_nombre: actor.nombre, updated_by_id: actor.perfil_id, updated_by_nombre: actor.nombre, activo: true, created_at: sello(), updated_at: sello(),
    };
    filas.push(fila);
    evento({ embarque_id: fila.id, viaje_id: fila.viaje_id, accion: "crear", resumen: `Embarque ${codigo} creado` }, actor);
    return ok({ embarque_id: fila.id, codigo, revision: 0, creado: true, avisos });
  }
  if (actual.estado === "cancelado") return no("no_editable");
  if (revision === null || actual.revision !== revision) return no("agrupador_cambio");
  if (e.fecha_llegada_estimada && e.fecha_llegada_estimada !== actual.fecha_llegada_estimada) return no("fecha_por_movimiento");
  if (e.responsable_id !== actual.responsable_id && e.responsable_id && !asignable(e.responsable_id)) return no("responsable_no_asignable");
  if (e.fecha_salida_estimada && String(e.fecha_salida_estimada) > String(actual.fecha_llegada_estimada)) return no("salida_despues_de_llegada");
  Object.assign(actual, { nombre: e.nombre, tipo: e.tipo, viaje_id: e.viaje_id ?? null, responsable_id: e.responsable_id ?? null, referencia_logistica: e.referencia_logistica ?? null, puerto_embarque: e.puerto_embarque ?? null, fecha_salida_estimada: e.fecha_salida_estimada ?? null, nota: e.nota ?? null, revision: (actual.revision as number) + 1, updated_by_nombre: actor.nombre, updated_at: sello() });
  evento({ embarque_id: actual.id, viaje_id: actual.viaje_id, accion: "editar", resumen: `Embarque ${actual.codigo} editado` }, actor);
  return ok({ embarque_id: actual.id, codigo: actual.codigo, revision: actual.revision, creado: false, avisos });
}

function guardarPaquete(p: Fila, revisionEmbarque: number, actor: { perfil_id: string | null; nombre: string }): Respuesta {
  const paq = p.id ? get("compra_paquetes", p.id) : undefined;
  if (p.id && !paq) return no("no_encontrado");
  const emb = get("compra_embarques", paq ? paq.embarque_id : p.embarque_id);
  if (!emb) return no("no_encontrado");
  if (emb.revision !== revisionEmbarque) return no("agrupador_cambio");
  if (emb.estado !== "planificado" && emb.estado !== "en_transito") return no("embarque_no_editable");
  let fila = paq;
  if (!fila) {
    if (p.responsable_id && !asignable(p.responsable_id)) return no("responsable_no_asignable");
    const codigo = codigoNuevo("compra_paquetes", String(p.codigo ?? ""), String(emb.periodo_llegada));
    if (typeof codigo !== "string") return no(codigo.motivo);
    fila = { id: nuevoId(), embarque_id: emb.id, codigo, nombre: p.nombre, responsable_id: p.responsable_id ?? null, estado: "abierto", nota: p.nota ?? null, perfil_id: actor.perfil_id, usuario_nombre: actor.nombre, updated_by_id: actor.perfil_id, updated_by_nombre: actor.nombre, activo: true, created_at: sello(), updated_at: sello() };
    tabla("compra_paquetes").push(fila);
  } else {
    if (fila.estado !== "abierto") return no("no_editable");
    Object.assign(fila, { nombre: p.nombre, responsable_id: p.responsable_id ?? null, nota: p.nota ?? null, updated_at: sello() });
  }
  emb.revision = (emb.revision as number) + 1;
  evento({ paquete_id: fila.id, embarque_id: emb.id, accion: p.id ? "editar" : "crear", resumen: `Paquete ${fila.codigo}` }, actor);
  return ok({ paquete_id: fila.id, embarque_id: emb.id, codigo: fila.codigo, embarque_revision: emb.revision, creado: !p.id });
}

function activa(asignacionId: unknown): boolean {
  const a = get("compra_entrega_asignaciones", asignacionId);
  const e = a ? get("compra_linea_entregas", a.entrega_id) : undefined;
  const l = e ? get("compra_lineas", e.linea_id) : undefined;
  const c = l ? get("compras", l.compra_id) : undefined;
  return !!c && !!l && (c.estado === "borrador" || c.estado === "confirmada") && l.activo === true && (l.unidades_recibidas as number) + (l.unidades_canceladas as number) < (l.unidades as number);
}

function cambiarEstado(a: { p_tipo: string; p_id: string; p_accion: string; p_revision: number; p_motivo: string | null; p_actor: unknown }): Respuesta {
  const actor = actorDe(a.p_actor);
  const motivo = (a.p_motivo ?? "").trim();
  if (a.p_tipo === "viaje") {
    const v = get("compra_viajes", a.p_id);
    if (!v) return no("no_encontrado");
    if (v.revision !== a.p_revision) return no("agrupador_cambio");
    if (v.estado === "cancelado") return no("transicion_invalida");
    let hacia: string;
    if (a.p_accion === "cerrar" && v.estado === "abierto") hacia = "cerrado";
    else if (a.p_accion === "reabrir" && v.estado === "cerrado") hacia = "abierto";
    else if (a.p_accion === "cancelar") {
      if (motivo === "") return no("motivo_requerido");
      if (tabla("compras").some((c) => c.viaje_id === v.id && c.estado !== "cancelada") || tabla("compra_embarques").some((e) => e.viaje_id === v.id && e.estado !== "cancelado")) return no("tiene_compras");
      hacia = "cancelado";
    } else return no("transicion_invalida");
    Object.assign(v, { estado: hacia, revision: (v.revision as number) + 1 });
    evento({ viaje_id: v.id, accion: "cambiar_estado", motivo: motivo || null, resumen: `Viaje ${v.codigo}: ${hacia}` }, actor);
    return ok({ tipo: "viaje", id: v.id, estado: hacia, revision: v.revision });
  }
  if (a.p_tipo === "embarque") {
    const e = get("compra_embarques", a.p_id);
    if (!e) return no("no_encontrado");
    if (e.revision !== a.p_revision) return no("agrupador_cambio");
    if (e.estado === "cancelado") return no("transicion_invalida");
    let hacia: string;
    if (a.p_accion === "en_transito" && e.estado === "planificado") hacia = "en_transito";
    else if (a.p_accion === "volver_a_planificado" && e.estado === "en_transito") hacia = "planificado";
    else if (a.p_accion === "cancelar") {
      if (motivo === "") return no("motivo_requerido");
      if (tabla("compra_entrega_asignaciones").some((x) => x.embarque_id === e.id && activa(x.id))) return no("tiene_asignaciones_activas");
      hacia = "cancelado";
    } else return no("transicion_invalida");
    Object.assign(e, { estado: hacia, revision: (e.revision as number) + 1 });
    evento({ embarque_id: e.id, viaje_id: e.viaje_id, accion: "cambiar_estado", motivo: motivo || null, resumen: `Embarque ${e.codigo}: ${hacia}` }, actor);
    return ok({ tipo: "embarque", id: e.id, estado: hacia, revision: e.revision });
  }
  const p = get("compra_paquetes", a.p_id);
  if (!p) return no("no_encontrado");
  const e = get("compra_embarques", p.embarque_id)!;
  if (e.revision !== a.p_revision) return no("agrupador_cambio");
  if (a.p_accion !== "cancelar" || p.estado !== "abierto") return no("transicion_invalida");
  if (motivo === "") return no("motivo_requerido");
  if (tabla("compra_entrega_asignaciones").some((x) => x.paquete_id === p.id && activa(x.id))) return no("tiene_asignaciones_activas");
  p.estado = "cancelado";
  e.revision = (e.revision as number) + 1;
  evento({ paquete_id: p.id, embarque_id: e.id, accion: "cambiar_estado", motivo, resumen: `Paquete ${p.codigo}: cancelado` }, actor);
  return ok({ tipo: "paquete", id: p.id, estado: "cancelado", revision: e.revision, embarque_id: e.id });
}

function asignarViaje(viajeId: string | null, compras: { id: string; revision: number }[], actor: { perfil_id: string | null; nombre: string }): Respuesta {
  const avisos: unknown[] = [];
  if (viajeId) {
    const v = get("compra_viajes", viajeId);
    if (!v) return no("no_encontrado");
    if (v.estado === "cancelado") return no("viaje_cancelado");
    if (v.estado === "cerrado") avisos.push({ codigo: "viaje_cerrado", viaje: v.codigo });
  }
  const filas = compras.map((c) => get("compras", c.id));
  if (filas.some((c, i) => !c || c.revision !== compras[i].revision)) return no("compra_cambio");
  if (filas.some((c) => c!.estado === "cancelada")) return no("no_editable");
  const salida: { id: string; revision: number }[] = [];
  for (const c of filas as Fila[]) {
    if ((c.viaje_id ?? null) !== viajeId) {
      c.viaje_id = viajeId;
      c.revision = (c.revision as number) + 1;
    }
    salida.push({ id: c.id as string, revision: c.revision as number });
  }
  evento({ viaje_id: viajeId, accion: "asignar_viaje", compras: salida.map((s) => ({ compra_id: s.id, revision_nueva: s.revision })), resumen: `${salida.length} compra(s)` }, actor);
  return ok({ viaje_id: viajeId, compras: salida, avisos });
}

/** Aplica un `PlanAplicable` sobre las tablas con los espejos puros (la función SQL hace lo mismo con `agrupador_mover_entregas`). */
function aplicarMovimiento(plan: PlanAplicable, actor: { perfil_id: string | null; nombre: string }): Respuesta {
  const embarques = plan.embarques.map((e) => get("compra_embarques", e.id));
  if (embarques.some((e) => !e)) return no("no_encontrado");
  if (embarques.some((e, i) => e!.revision !== plan.embarques[i].revision)) return no("agrupador_cambio");
  if (plan.compras.some((c) => get("compras", c.id)?.revision !== c.revision)) return no("compra_cambio");

  const lineas = new Set(plan.movimientos.map((m) => m.linea_id));
  const entregas = tabla("compra_linea_entregas").filter((e) => lineas.has(e.linea_id as string));
  const base = {
    entregas: entregas.map((e) => ({ id: e.id as string, linea_id: e.linea_id as string, periodo: String(e.periodo).slice(0, 7), unidades: e.unidades as number, origen: e.origen as "manual" })),
    asignaciones: tabla("compra_entrega_asignaciones")
      .filter((a) => entregas.some((e) => e.id === a.entrega_id))
      .map((a) => ({ id: a.id as string, entrega_id: a.entrega_id as string, embarque_id: a.embarque_id as string, paquete_id: (a.paquete_id ?? null) as string | null, unidades: a.unidades as number })),
  };
  const r = aplicarMovimientos(base, plan.movimientos as MovimientoPlan[], plan.paquete_a_mover ? [plan.paquete_a_mover] : []);
  if (!r.ok) return no(r.motivo);

  if (plan.paquete_a_mover) {
    const paq = get("compra_paquetes", plan.paquete_a_mover.paquete_id);
    if (paq) paq.embarque_id = plan.paquete_a_mover.embarque_destino_id;
    for (const a of tabla("compra_entrega_asignaciones")) if (a.paquete_id === plan.paquete_a_mover.paquete_id) a.embarque_id = plan.paquete_a_mover.embarque_destino_id;
  }
  const idDeEntrega = new Map<string, string>();
  for (const ef of r.entregas) {
    const clave = `${ef.linea_id}|${ef.periodo}`;
    if (ef.id !== null) {
      idDeEntrega.set(clave, ef.id);
      const fila = get("compra_linea_entregas", ef.id)!;
      if (ef.borrada) tabla("compra_linea_entregas").splice(tabla("compra_linea_entregas").indexOf(fila), 1);
      else fila.unidades = ef.unidades;
    } else if (!ef.borrada) {
      const id = nuevoId();
      idDeEntrega.set(clave, id);
      tabla("compra_linea_entregas").push({ id, linea_id: ef.linea_id, periodo: `${ef.periodo}-01`, unidades: ef.unidades, origen: "embarque", activo: true });
    }
  }
  for (const af of r.asignaciones) {
    const entregaId = af.entrega_id ?? idDeEntrega.get(`${af.linea_id}|${af.periodo}`);
    if (af.id !== null) {
      const fila = get("compra_entrega_asignaciones", af.id)!;
      if (af.borrada) tabla("compra_entrega_asignaciones").splice(tabla("compra_entrega_asignaciones").indexOf(fila), 1);
      else Object.assign(fila, { entrega_id: entregaId, embarque_id: af.embarque_id, paquete_id: af.paquete_id, unidades: af.unidades });
    } else if (!af.borrada) {
      tabla("compra_entrega_asignaciones").push({ id: nuevoId(), entrega_id: entregaId, embarque_id: af.embarque_id, paquete_id: af.paquete_id, unidades: af.unidades, activo: true });
    }
  }
  for (const rp of plan.repartos) {
    const entregaId = idDeEntrega.get(`${rp.linea_id}|${rp.periodo}`) ?? tabla("compra_linea_entregas").find((e) => e.linea_id === rp.linea_id && String(e.periodo).slice(0, 7) === rp.periodo)?.id;
    const resto = tabla("compra_linea_repartos").filter((x) => x.entrega_id !== entregaId);
    tabla("compra_linea_repartos").splice(0, tabla("compra_linea_repartos").length, ...resto);
    for (const f of rp.filas) tabla("compra_linea_repartos").push({ id: nuevoId(), linea_id: rp.linea_id, entrega_id: entregaId, ...f, activo: true });
  }
  const emb = plan.embarques.find((e) => e.fecha_llegada_estimada);
  if (emb) {
    const fila = get("compra_embarques", emb.id)!;
    fila.fecha_llegada_estimada = emb.fecha_llegada_estimada;
    fila.periodo_llegada = `${String(emb.fecha_llegada_estimada).slice(0, 7)}-01`;
  }
  const comprasNuevas = plan.compras.map((c) => {
    const fila = get("compras", c.id)!;
    fila.revision = (fila.revision as number) + 1;
    return { id: c.id, revision: fila.revision as number };
  });
  const embarquesNuevos = plan.embarques.map((e) => {
    const fila = get("compra_embarques", e.id)!;
    fila.revision = (fila.revision as number) + 1;
    evento({ embarque_id: e.id, viaje_id: fila.viaje_id, accion: plan.accion, motivo: plan.motivo, resumen: plan.resumen, compras: comprasNuevas.map((c) => ({ compra_id: c.id, revision_nueva: c.revision })) }, actor);
    return { id: e.id, revision: fila.revision as number };
  });
  return ok({ embarques: embarquesNuevos, compras: comprasNuevas });
}

type LoteFalso = {
  archivo_nombre: string;
  viajes: { fila: number; codigo: string | null; nombre: string; destino: string | null; fecha_inicio: string; fecha_fin: string | null; responsable_id: string; nota: string | null }[];
  embarques: { fila: number; codigo: string | null; nombre: string; tipo: string; viaje_id: string | null; viaje_codigo: string | null; responsable_id: string | null; referencia_logistica: string | null; puerto_embarque: string | null; fecha_salida_estimada: string | null; fecha_llegada_estimada: string; nota: string | null }[];
  paquetes: { fila: number; codigo: string | null; nombre: string; embarque_id: string | null; embarque_codigo: string | null; responsable_id: string | null; nota: string | null }[];
};

/** `importar_agrupadores`: todo o nada (se escribe en copia y se confirma al final), con `clave_existente` si alguien ya creó la clave. */
function importarLote(lote: LoteFalso, actor: { perfil_id: string | null; nombre: string }): Respuesta {
  const copia = { v: [...tabla("compra_viajes")], e: [...tabla("compra_embarques")], p: [...tabla("compra_paquetes")] };
  const creados: { tipo: string; fila: number; id: string; codigo: string }[] = [];
  const fallo = (motivo: string, tipo: string, fila: number): Respuesta => no(motivo, { tipo, fila });
  const codigoDe = (lista: Fila[], escrito: string | null, ref: string): string | { motivo: string } => {
    const existentes = lista.map((f) => String(f.codigo));
    if (escrito) return existentes.some((x) => x.toUpperCase() === escrito.toUpperCase()) ? { motivo: "clave_existente" } : escrito;
    const s = siguienteCodigo(aammDe(ref) ?? "0000", existentes);
    return s.ok ? s.codigo : { motivo: "correlativo_agotado" };
  };
  const ordenar = <T extends { fila: number; codigo: string | null }>(l: T[]) => [...l.filter((x) => x.codigo), ...l.filter((x) => !x.codigo).sort((a, b) => a.fila - b.fila)];
  for (const v of ordenar(lote.viajes)) {
    if (!asignable(v.responsable_id)) return fallo("responsable_no_asignable", "viaje", v.fila);
    const c = codigoDe(copia.v, v.codigo, v.fecha_inicio);
    if (typeof c !== "string") return fallo(c.motivo, "viaje", v.fila);
    const fila: Fila = { id: nuevoId(), codigo: c, nombre: v.nombre, destino: v.destino, fecha_inicio: v.fecha_inicio, fecha_fin: v.fecha_fin, responsable_id: v.responsable_id, estado: "abierto", nota: v.nota, revision: 0, perfil_id: actor.perfil_id, usuario_nombre: actor.nombre, updated_by_id: null, updated_by_nombre: null, activo: true, created_at: sello(), updated_at: sello() };
    copia.v.push(fila);
    creados.push({ tipo: "viaje", fila: v.fila, id: fila.id as string, codigo: c });
  }
  for (const e of ordenar(lote.embarques)) {
    const viajeId = e.viaje_id ?? (e.viaje_codigo ? (copia.v.find((x) => String(x.codigo).toUpperCase() === e.viaje_codigo!.toUpperCase())?.id as string | undefined) ?? null : null);
    if (e.viaje_codigo && viajeId === null) return fallo("no_encontrado", "embarque", e.fila);
    const c = codigoDe(copia.e, e.codigo, e.fecha_llegada_estimada);
    if (typeof c !== "string") return fallo(c.motivo, "embarque", e.fila);
    const fila: Fila = { id: nuevoId(), codigo: c, nombre: e.nombre, tipo: e.tipo, viaje_id: viajeId, responsable_id: e.responsable_id, referencia_logistica: e.referencia_logistica, puerto_embarque: e.puerto_embarque, fecha_salida_estimada: e.fecha_salida_estimada, fecha_llegada_estimada: e.fecha_llegada_estimada, fecha_llegada_real: null, periodo_llegada: `${e.fecha_llegada_estimada.slice(0, 7)}-01`, estado: "planificado", nota: e.nota, revision: 0, perfil_id: actor.perfil_id, usuario_nombre: actor.nombre, updated_by_id: null, updated_by_nombre: null, activo: true, created_at: sello(), updated_at: sello() };
    copia.e.push(fila);
    creados.push({ tipo: "embarque", fila: e.fila, id: fila.id as string, codigo: c });
  }
  for (const p of ordenar(lote.paquetes)) {
    const emb = copia.e.find((x) => x.id === p.embarque_id || (p.embarque_codigo !== null && String(x.codigo).toUpperCase() === p.embarque_codigo.toUpperCase()));
    if (!emb) return fallo("no_encontrado", "paquete", p.fila);
    const c = codigoDe(copia.p, p.codigo, String(emb.periodo_llegada));
    if (typeof c !== "string") return fallo(c.motivo, "paquete", p.fila);
    const fila: Fila = { id: nuevoId(), embarque_id: emb.id, codigo: c, nombre: p.nombre, responsable_id: p.responsable_id, estado: "abierto", nota: p.nota, perfil_id: actor.perfil_id, usuario_nombre: actor.nombre, updated_by_id: null, updated_by_nombre: null, activo: true, created_at: sello(), updated_at: sello() };
    copia.p.push(fila);
    creados.push({ tipo: "paquete", fila: p.fila, id: fila.id as string, codigo: c });
  }
  tabla("compra_viajes").splice(0, tabla("compra_viajes").length, ...copia.v);
  tabla("compra_embarques").splice(0, tabla("compra_embarques").length, ...copia.e);
  tabla("compra_paquetes").splice(0, tabla("compra_paquetes").length, ...copia.p);
  for (const c of creados) evento({ [`${c.tipo}_id`]: c.id, accion: "crear", motivo: `Importado de ${lote.archivo_nombre}`, resumen: `${c.tipo} ${c.codigo}` }, actor);
  return ok({ creados });
}

export { ASIGNACION_AGR, escenario, tablaDe };
