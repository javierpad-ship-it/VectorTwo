import "server-only";
import type { Rol } from "@/lib/auth/roles";
import { normalizarNombre } from "@/lib/arbol/normalizar";
import { errorConCodigo, errorConDetalle } from "@/lib/api/respuestas";
import { buscarProveedor } from "@/lib/compras/proveedores";
import { falla, fallaDb, fallaMensaje, listo, type Db, type Salida } from "@/lib/proyeccion/servicio-base";
import type { Json } from "@/lib/supabase/database.types";
import { armarFicha, armarListado, armarResumen, type ContactoFila, type ProveedorFila } from "./api";
import {
  leerComprasPorProveedor,
  leerComprasYLineasDe,
  leerContactos,
  leerContactosDe,
  leerEventosDeProveedor,
  leerProveedor,
  leerProveedores,
  rpcCambiarActivoProveedor,
  rpcEliminarProveedor,
  rpcGuardarProveedor,
  type ActorProveedorDb,
  type ProveedorDb,
  type RespuestaRpc,
} from "./consultas";
import type { ProveedorCreacionCuerpo, ProveedorEdicionCuerpo, ProveedorFichaCuerpo, ProveedoresQuery } from "./esquemas";
import { historialDeProveedor } from "./historial";
import { buscarParecidos } from "./parecidos";
import { cambiaIntercompanySinPermiso, mensajeCodigoRepetido, mensajeNombreRepetido, normalizarContactos, rechazoProveedor } from "./reglas";
import type {
  EventoProveedorApi,
  ParecidoProveedorApi,
  ProveedorDetalleApi,
  ProveedorFichaApi,
  ProveedorListadoApi,
  RespuestaEliminarProveedorApi,
} from "./tipos-api";

/**
 * Servicio de los proveedores (08c, §3.2). Solo servidor. Lee con `consultas.ts`, arma `ProveedorFichaApi` con `api.ts` y escribe SOLO con
 * las funciones `rpc` de `0039` (ficha y contactos en UNA transacción, con `revision` y un evento por cambio). Cualquiera crea y edita; el
 * planner marca intercompany, desactiva y elimina (R16). Los errores de unicidad llegan de la función con el `conflicto` y se traducen
 * a mensajes de pantalla (R11).
 */

export type UsuarioProveedores = { id: string; nombre: string; rol: Rol };

const actorDe = (u: UsuarioProveedores): ActorProveedorDb => ({ perfil_id: u.id, nombre: u.nombre, rol: u.rol });

const noEncontrado = (): Salida<never> => {
  const r = rechazoProveedor("no_encontrado");
  return fallaMensaje(r.mensaje, r.status, r.codigo);
};

function falloProveedor(codigo: Parameters<typeof rechazoProveedor>[0], detalle?: Record<string, unknown>, mensaje?: string): Salida<never> {
  const r = rechazoProveedor(codigo, mensaje);
  return falla(detalle ? errorConDetalle(r.mensaje, r.status, r.codigo, detalle) : errorConCodigo(r.mensaje, r.status, r.codigo));
}

const aFila = (p: ProveedorDb): ProveedorFila => p;

const porProveedor = (contactos: readonly ContactoFila[]): Map<string, ContactoFila[]> => {
  const m = new Map<string, ContactoFila[]>();
  for (const c of contactos) m.set(c.proveedor_id, [...(m.get(c.proveedor_id) ?? []), c]);
  return m;
};

// ─── Lectura ───

/** `GET /api/compras/proveedores?activos=1&q=`: con contactos, cuántas compras no canceladas y si la ficha está completa. */
export async function listarProveedores(d: Db, consulta: ProveedoresQuery = {}): Promise<Salida<ProveedorListadoApi[]>> {
  const [proveedores, contactos, compras] = await Promise.all([leerProveedores(d), leerContactos(d), leerComprasPorProveedor(d)]);
  if (proveedores.error) return fallaDb(proveedores.error, "proveedores: leer");
  if (contactos.error) return fallaDb(contactos.error, "proveedores: leer los contactos");
  if (compras.error) return fallaDb(compras.error, "proveedores: contar las compras");
  const cuenta = new Map<string, number>();
  for (const c of compras.data) if (c.estado !== "cancelada") cuenta.set(c.proveedor_id, (cuenta.get(c.proveedor_id) ?? 0) + 1);
  const delProveedor = porProveedor(contactos.data);
  const q = consulta.q ? normalizarNombre(consulta.q) : "";
  const quita = (s: string | null) => (s ? normalizarNombre(s).normalize("NFD").replace(/[̀-ͯ]/g, "") : "");
  const buscado = q === "" ? "" : quita(q);
  return listo(
    proveedores.data
      .filter((p) => (consulta.activos === "1" ? p.activo : true))
      .filter((p) => buscado === "" || [p.nombre, p.codigo, p.pais, p.ciudad, p.puerto_embarque].some((t) => quita(t).includes(buscado)))
      .map((p) => armarListado(aFila(p), delProveedor.get(p.id) ?? [], cuenta.get(p.id) ?? 0)),
  );
}

async function fichaDe(d: Db, id: string, rol: Rol): Promise<Salida<{ ficha: ProveedorFichaApi; fila: ProveedorDb } | null>> {
  const p = await leerProveedor(d, id);
  if (p.error) return fallaDb(p.error, "proveedores: leer el proveedor");
  if (!p.data) return listo(null);
  const [contactos, compras] = await Promise.all([leerContactosDe(d, id), leerComprasYLineasDe(d, id)]);
  if (contactos.error) return fallaDb(contactos.error, "proveedores: leer los contactos");
  if (compras.error) return fallaDb(compras.error, "proveedores: leer las compras");
  const vigentes = compras.data.compras.filter((c) => c.estado !== "cancelada").length;
  return listo({ ficha: armarFicha(aFila(p.data), contactos.data, vigentes, rol), fila: p.data });
}

/** `GET /api/compras/proveedores/[id]`: la ficha con sus contactos y el resumen de sus compras. */
export async function leerDetalleProveedor(d: Db, rol: Rol, id: string): Promise<Salida<ProveedorDetalleApi>> {
  const f = await fichaDe(d, id, rol);
  if (f.respuesta) return f;
  if (!f.data) return noEncontrado();
  const compras = await leerComprasYLineasDe(d, id);
  if (compras.error) return fallaDb(compras.error, "proveedores: leer las compras");
  return listo({ ...f.data.ficha, resumen: armarResumen(compras.data.compras, compras.data.lineas) });
}

/** `GET /api/compras/proveedores/[id]/historial`: los cambios del proveedor (más recientes primero), campo a campo. */
export async function leerHistorialProveedor(d: Db, id: string): Promise<Salida<EventoProveedorApi[]>> {
  const p = await leerProveedor(d, id);
  if (p.error) return fallaDb(p.error, "proveedores: leer el proveedor");
  if (!p.data) return noEncontrado();
  const e = await leerEventosDeProveedor(d, id);
  if (e.error) return fallaDb(e.error, "proveedores: leer el historial");
  return listo(historialDeProveedor(e.data));
}

// ─── Escritura ───

type Funcion = { ok: boolean; motivo: string | null; datos: Record<string, unknown> };

function leerFuncion(r: RespuestaRpc): Funcion | null {
  const x = r.data;
  if (typeof x !== "object" || x === null || Array.isArray(x)) return null;
  const datos = x as Record<string, unknown>;
  return { ok: datos.ok === true, motivo: typeof datos.motivo === "string" ? datos.motivo : null, datos };
}

type Conflicto = { id: string; nombre: string; activo: boolean };
function leerConflicto(v: unknown): Conflicto | null {
  if (typeof v !== "object" || v === null) return null;
  const c = v as Record<string, unknown>;
  return typeof c.id === "string" && typeof c.nombre === "string" ? { id: c.id, nombre: c.nombre, activo: c.activo !== false } : null;
}

/** Traduce un `{ ok: false, motivo }` de las funciones de proveedores a su respuesta HTTP. */
function rechazoDeFuncion(f: Funcion): Salida<never> {
  switch (f.motivo) {
    case "no_encontrado":
      return noEncontrado();
    case "proveedor_cambio":
      return falloProveedor("proveedor_cambio", { revision: typeof f.datos.revision === "number" ? f.datos.revision : null });
    case "nombre_repetido": {
      const c = leerConflicto(f.datos.conflicto);
      return falloProveedor("nombre_repetido", { conflicto: c }, mensajeNombreRepetido(c));
    }
    case "codigo_repetido": {
      const c = leerConflicto(f.datos.conflicto);
      return falloProveedor("codigo_repetido", { conflicto: c }, mensajeCodigoRepetido(c));
    }
    case "solo_planner_intercompany":
      return falloProveedor("solo_planner_intercompany");
    case "ficha_invalida":
      return fallaMensaje("La ficha del proveedor no es válida: revisa el nombre.", 400);
    case "contactos_invalidos":
      return fallaMensaje("Los contactos no son válidos: hasta 20 y un solo principal.", 400);
    default:
      console.error(`[proveedores] motivo inesperado de la base: ${f.motivo}`);
      return fallaMensaje("No pudimos completar la operación. Inténtalo de nuevo.", 500);
  }
}

const falloInesperado = (contexto: string): Salida<never> => {
  console.error(`[proveedores] respuesta inesperada de la base: ${contexto}`);
  return fallaMensaje("No pudimos completar la operación. Inténtalo de nuevo.", 500);
};

/** La ficha tal como la espera `guardar_proveedor`: la ficha COMPLETA (una clave ausente queda nula); `es_intercompany` ausente se conserva. */
function fichaParaFuncion(c: Pick<ProveedorFichaCuerpo, "nombre" | "codigo" | "pais" | "region" | "ciudad" | "direccion" | "identificacion" | "es_intercompany" | "puerto_embarque" | "incoterm" | "moneda" | "plazo_produccion_dias" | "plazo_transito_dias" | "condiciones_pago" | "nota">): Record<string, Json> {
  const ficha: Record<string, Json> = {
    nombre: c.nombre,
    codigo: c.codigo,
    pais: c.pais,
    region: c.region,
    ciudad: c.ciudad,
    direccion: c.direccion,
    identificacion: c.identificacion,
    puerto_embarque: c.puerto_embarque,
    incoterm: c.incoterm,
    moneda: c.moneda,
    plazo_produccion_dias: c.plazo_produccion_dias,
    plazo_transito_dias: c.plazo_transito_dias,
    condiciones_pago: c.condiciones_pago,
    nota: c.nota,
  };
  if (c.es_intercompany !== undefined) ficha.es_intercompany = c.es_intercompany;
  return ficha;
}

function contactosParaFuncion(c: ProveedorFichaCuerpo["contactos"]): Json | null {
  if (c === undefined) return null;
  return normalizarContactos(c).map((x) => ({ nombre: x.nombre, cargo: x.cargo, telefono: x.telefono, correo: x.correo, es_principal: x.es_principal }));
}

/**
 * `POST /api/compras/proveedores`. `modo: "ficha"` crea con la ficha completa (avisa de parecidos sin bloquear); `modo: "rapido"` es el
 * alta al vuelo: con un nombre repetido da `409 nombre_repetido` y con uno parecido `409 nombre_parecido` hasta que se confirme.
 */
export async function crearProveedor(d: Db, usuario: UsuarioProveedores, cuerpo: ProveedorCreacionCuerpo): Promise<Salida<ProveedorFichaApi>> {
  const existentes = await leerProveedores(d);
  if (existentes.error) return fallaDb(existentes.error, "proveedores: leer");
  const repetido = buscarProveedor(
    cuerpo.nombre,
    existentes.data.map((p) => ({ id: p.id, nombre: p.nombre, activo: p.activo })),
  );
  if (repetido) {
    const conflicto = { id: repetido.id, nombre: repetido.nombre, activo: repetido.activo };
    return falloProveedor("nombre_repetido", { conflicto }, mensajeNombreRepetido(conflicto));
  }
  const parecidos: ParecidoProveedorApi[] = buscarParecidos(
    cuerpo.nombre,
    existentes.data.map((p) => ({ id: p.id, nombre: p.nombre, activo: p.activo })),
  );

  let ficha: Record<string, Json>;
  let contactos: Json | null;
  if (cuerpo.modo === "rapido") {
    if (parecidos.length > 0 && cuerpo.confirmar_parecido !== true) return falloProveedor("nombre_parecido", { parecidos });
    ficha = { nombre: cuerpo.nombre, pais: cuerpo.pais };
    contactos = [];
  } else {
    if (cambiaIntercompanySinPermiso(usuario.rol, cuerpo.es_intercompany, false)) return falloProveedor("solo_planner_intercompany");
    ficha = fichaParaFuncion(cuerpo);
    contactos = contactosParaFuncion(cuerpo.contactos) ?? [];
  }

  const r = await rpcGuardarProveedor(d, { id: null, revision: null, proveedor: ficha, contactos, actor: actorDe(usuario) });
  if (r.error) return fallaDb(r.error, "proveedores: guardar_proveedor");
  const f = leerFuncion(r);
  if (!f) return falloInesperado("guardar_proveedor");
  if (!f.ok) return rechazoDeFuncion(f);
  const id = f.datos.proveedor_id;
  if (typeof id !== "string") return falloInesperado("guardar_proveedor sin proveedor_id");
  const creada = await fichaDe(d, id, usuario.rol);
  if (creada.respuesta) return creada;
  if (!creada.data) return falloInesperado("proveedor recién creado no encontrado");
  return listo({ ...creada.data.ficha, parecidos });
}

/** `PATCH /api/compras/proveedores/[id]`: ficha y contactos en una transacción, con la `revision` que vio el formulario. */
export async function editarProveedor(d: Db, usuario: UsuarioProveedores, id: string, cuerpo: ProveedorEdicionCuerpo): Promise<Salida<ProveedorFichaApi>> {
  const actual = await leerProveedor(d, id);
  if (actual.error) return fallaDb(actual.error, "proveedores: leer el proveedor");
  if (!actual.data) return noEncontrado();
  if (cambiaIntercompanySinPermiso(usuario.rol, cuerpo.es_intercompany, actual.data.es_intercompany)) return falloProveedor("solo_planner_intercompany");

  const r = await rpcGuardarProveedor(d, { id, revision: cuerpo.revision, proveedor: fichaParaFuncion(cuerpo), contactos: contactosParaFuncion(cuerpo.contactos), actor: actorDe(usuario) });
  if (r.error) return fallaDb(r.error, "proveedores: guardar_proveedor");
  const f = leerFuncion(r);
  if (!f) return falloInesperado("guardar_proveedor");
  if (!f.ok) return rechazoDeFuncion(f);
  const guardada = await fichaDe(d, id, usuario.rol);
  if (guardada.respuesta) return guardada;
  if (!guardada.data) return noEncontrado();
  return listo(guardada.data.ficha);
}

/** `POST /api/compras/proveedores/[id]/activo`: desactiva o reactiva (el guard exige planner). */
export async function cambiarActivoProveedor(d: Db, usuario: UsuarioProveedores, id: string, activo: boolean): Promise<Salida<ProveedorFichaApi>> {
  const r = await rpcCambiarActivoProveedor(d, id, activo, actorDe(usuario));
  if (r.error) return fallaDb(r.error, "proveedores: cambiar_activo_proveedor");
  const f = leerFuncion(r);
  if (!f) return falloInesperado("cambiar_activo_proveedor");
  if (!f.ok) return f.motivo === "activo_invalido" ? fallaMensaje("Indica si el proveedor queda activo o inactivo.", 400) : rechazoDeFuncion(f);
  const ficha = await fichaDe(d, id, usuario.rol);
  if (ficha.respuesta) return ficha;
  if (!ficha.data) return noEncontrado();
  return listo(ficha.data.ficha);
}

/** `DELETE /api/compras/proveedores/[id]`: lo borra si no tiene compras de ningún estado; si tiene, lo desactiva (el guard exige planner). */
export async function eliminarProveedor(d: Db, usuario: UsuarioProveedores, id: string): Promise<Salida<RespuestaEliminarProveedorApi>> {
  const r = await rpcEliminarProveedor(d, id, actorDe(usuario));
  if (r.error) return fallaDb(r.error, "proveedores: eliminar_proveedor");
  const f = leerFuncion(r);
  if (!f) return falloInesperado("eliminar_proveedor");
  if (!f.ok) return rechazoDeFuncion(f);
  const accion = f.datos.accion;
  if (accion !== "borrado" && accion !== "desactivado") return falloInesperado("eliminar_proveedor sin acción");
  return listo({ accion });
}

